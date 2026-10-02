#!/usr/bin/env node
/**
 * audit-contrast.mjs — static WCAG 2.2 AA contrast audit for the shipped page.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The axe-core suite runs in jsdom, which has no layout or paint engine, so
 * the `color-contrast` rule is explicitly disabled there (see
 * tests/a11y/axe.test.js) — contrast has been "Unknown" in the known-gaps
 * table ever since. This script closes that gap *statically but against the
 * real document*: it loads the real index.html DOM, matches the real shipped
 * CSS rules per element (jsdom's selector engine), resolves the token chain
 * (var() → var() → literal), blends alpha over the nearest opaque ancestor
 * background, and computes WCAG contrast ratios with the correct AA threshold
 * (4.5:1 body text, 3:1 large text ≥ 24 px or ≥ 18.66 px bold).
 *
 * ── Honest limits (also printed in the report) ─────────────────────────────
 *  - Cascade approximation: source order wins; specificity is compared only
 *    by (stylesheet order, index) — not a full specificity algorithm. The
 *    stylesheet is authored with single-class selectors, so this is close.
 *  - Base (desktop) media-query values are used; mobile overrides can only
 *    make text SMALLER, so a desktop pass is the lenient direction — anything
 *    failing here fails on mobile too.
 *  - Gradient backgrounds and background images are reported as UNMEASURED,
 *    never silently passed.
 *  - Pseudo-element text (::placeholder etc.) is not audited.
 *  - Dynamically built overlays (DealRoom, toasts) are audited via the
 *    literal color/background pairs extracted from src/ inline style strings.
 *
 * Usage: node scripts/audit-contrast.mjs [--dist dist] [--html index.html]
 * Exit codes: 0 = no AA failures · 1 = failures found · 2 = usage/parse error.
 */

import { readFile, readdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DIST = flag('dist', 'dist');
const HTML = flag('html', 'index.html');

/* ── colour math ─────────────────────────────────────────────────────────── */

function parseColor(input, tokens = {}, depth = 0) {
  if (input == null || depth > 12) return null;
  // Strip !important FIRST — it can follow a var() reference with no space
  // (`var(--ice)!important`), which would corrupt the slice below.
  const v = String(input)
    .trim()
    .toLowerCase()
    .replace(/!important$/, '')
    .trim();
  // var(--x) → resolve through the token table (which itself may chain vars).
  if (v.startsWith('var(')) {
    const inner = v.slice(4, -1).split(',')[0].trim();
    return parseColor(tokens[inner] ?? '', tokens, depth + 1);
  }
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (v === 'currentcolor' || v === 'inherit' || v === 'initial') return null; // cannot resolve statically
  const hex = v.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1];
    const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    const [r, g, b] = parts
      .slice(0, 3)
      .map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
    let a = 1;
    if (parts.length >= 4) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return { r, g, b, a };
  }
  const hsl = v.match(/^hsla?\(([^)]+)\)$/);
  if (hsl) {
    const parts = hsl[1].split(/[\s,/]+/).filter(Boolean);
    const h = parseFloat(parts[0]) % 360;
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const seg = Math.floor(h / 60) % 6;
    const t = [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ][seg].map((v2) => (v2 + m) * 255);
    return { r: t[0], g: t[1], b: t[2], a: parts[3] ? parseFloat(parts[3]) : 1 };
  }
  // Named colours actually used by this codebase.
  const NAMED = { white: '#ffffff', black: '#000000', gold: '#d4af37', red: '#ff0000' };
  if (v in NAMED) return parseColor(NAMED[v], tokens, depth + 1);
  return null;
}

/** Source-over compositing for non-premultiplied colours. */
/** Colour stops of a gradient value, or null if the value is not a gradient. */
function gradientStops(value, tokens) {
  if (!value || !/gradient\(/i.test(value)) return null;
  const stops = [];
  for (const m of String(value).matchAll(
    /(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(--[\w-]+[^)]*\))/gi
  )) {
    const c = parseColor(m[1], tokens);
    if (c && (c.a ?? 1) > 0) stops.push(c);
  }
  return stops.length ? stops : null;
}

function blend(fg, bg) {
  if (bg == null) return fg;
  const fa = fg.a ?? 1;
  const ba = bg.a ?? 1;
  const outA = fa + ba * (1 - fa);
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (fg.r * fa + bg.r * ba * (1 - fa)) / outA,
    g: (fg.g * fa + bg.g * ba * (1 - fa)) / outA,
    b: (fg.b * fa + bg.b * ba * (1 - fa)) / outA,
    a: outA,
  };
}

function luminance({ r, g, b }) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ── CSS parsing (flat rules + @media inlining) ──────────────────────────── */

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Extract `--token: value;` declarations from :root blocks, in order. */
function extractTokens(css) {
  const tokens = {};
  const rootRe = /:root\s*\{([^}]*)\}/g;
  // NOTE: the trailing delimiter is `;` OR end-of-block — minified CSS omits
  // the semicolon on the last declaration, and missing that silently dropped
  // the a11y override of --dim (the exact bug this audit exists to catch).
  for (const m of css.matchAll(rootRe)) {
    for (const decl of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
      tokens[decl[1]] = decl[2].replace(/!important/g, '').trim();
    }
  }
  return tokens;
}

/**
 * Extract flat rules. @media blocks are inlined (their condition is dropped —
 * see the honest-limits note). @font-face / @keyframes are ignored.
 */
function extractRules(css) {
  const rules = [];
  const walk = (text) => {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(text))) {
      const selector = m[1].trim();
      if (selector.startsWith('@media') || selector.startsWith('@supports')) {
        walk(m[2]);
        continue;
      }
      if (selector.startsWith('@')) continue;
      const decls = {};
      for (const decl of m[2].matchAll(/([\w-]+)\s*:\s*([^;}]+)/g))
        decls[decl[1].toLowerCase()] = decl[2].trim();
      rules.push({ selector, decls, order: rules.length });
    }
  };
  walk(stripComments(css));
  return rules;
}

/** Selectors that describe a transient state, not the default rendering. */
const STATEFUL = /:(hover|focus|active|visited|focus-visible|focus-within)\b/;

function declarationsFor(rules, el) {
  const found = [];
  for (const rule of rules) {
    let matched = false;
    for (const sel of rule.selector.split(',').map((s) => s.trim())) {
      if (!sel || sel.startsWith('@')) continue;
      if (STATEFUL.test(sel)) continue;
      try {
        if (el.matches(sel)) {
          matched = true;
          break;
        }
      } catch {
        /* selector jsdom cannot parse — ignore that selector */
      }
    }
    if (matched) found.push(rule);
  }
  return found;
}

/* ── main ────────────────────────────────────────────────────────────────── */

const html = await readFile(HTML, 'utf8');
const distFiles = (await readdir(`${DIST}/assets`)).filter((f) => f.endsWith('.css'));
let css = '';
for (const f of distFiles) css += `\n${await readFile(`${DIST}/assets/${f}`, 'utf8')}`;

// Inline <style> blocks in the document count too (JSON-LD is a script, fine).
for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) css += `\n${m[1]}`;

const tokens = extractTokens(css);
const rules = extractRules(css);

const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/gi, ''), { pretendToBeVisual: false });
const { document } = dom.window;

const DEFAULT_BG = parseColor(tokens['--bg'] ?? '#0B0B0B', tokens);
const DEFAULT_FG = parseColor(tokens['--white'] ?? '#F5F5F5', tokens);

/**
 * Nearest declared background walking up the DOM, alpha-composited.
 * Layers are folded outermost-first over the opaque base so translucent
 * cards stack correctly instead of collapsing to solid colour.
 */
function effectiveBackground(el) {
  const chain = []; // [element, ancestor, …] in walk order
  let node = el;
  while (node && node.nodeType === 1) {
    const decls = {};
    // inline style wins
    const inline = node.getAttribute('style');
    if (inline)
      for (const d of inline.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) decls[d[1].toLowerCase()] = d[2].trim();
    for (const rule of declarationsFor(rules, node)) Object.assign(decls, rule.decls);
    // Gradient-clipped text: the gradient is the INK, never the background —
    // skip it here; effectiveForeground picks it up as foreground stops.
    const clippedToText =
      /text/i.test(decls['background-clip'] ?? '') || decls['-webkit-text-fill-color'] === 'transparent';
    const bgDecl = decls['background-color'] ?? decls['background'] ?? decls['background-image'];
    if (bgDecl && !clippedToText) {
      if (/gradient\(/i.test(bgDecl)) {
        const stops = gradientStops(bgDecl, tokens);
        if (stops) return { color: null, stops, chain };
      }
      if (/url\(/i.test(bgDecl)) return { color: null, reason: 'image background', chain };
      const c = parseColor(bgDecl, tokens);
      if (c) {
        chain.push(c);
        if ((c.a ?? 1) >= 1) break; // first opaque layer ends the walk
      }
    }
    node = node.parentElement;
  }
  if (!chain.length) return { color: DEFAULT_BG, chain };
  // Fold from the outermost layer down onto the page base.
  let acc = chain[chain.length - 1];
  if ((acc.a ?? 1) < 1) acc = blend(acc, DEFAULT_BG);
  for (let i = chain.length - 2; i >= 0; i--) acc = blend(chain[i], acc);
  return { color: acc, chain };
}

function effectiveForeground(el, bg) {
  let node = el;
  while (node && node.nodeType === 1) {
    const decls = {};
    const inline = node.getAttribute('style');
    if (inline)
      for (const d of inline.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) decls[d[1].toLowerCase()] = d[2].trim();
    for (const rule of declarationsFor(rules, node)) Object.assign(decls, rule.decls);
    if (decls['-webkit-text-fill-color'] && decls['-webkit-text-fill-color'] !== 'transparent') {
      const c = parseColor(decls['-webkit-text-fill-color'], tokens);
      if (c) return blend(c, bg);
    }
    // Gradient-clipped text: the ink is the gradient's stops. The caller
    // computes the worst-stop ratio against the underlay background.
    if (
      node === el &&
      (decls['-webkit-text-fill-color'] === 'transparent' || /text/i.test(decls['background-clip'] ?? ''))
    ) {
      const stops =
        gradientStops(decls['background-image'] ?? '', tokens) ??
        gradientStops(decls['background'] ?? '', tokens);
      if (stops) return { stops };
    }
    if (decls.color) {
      const c = parseColor(decls.color, tokens);
      // Ghost/outline typography: the fill is transparent and the visible
      // ink is the stroke. Measure the stroke colour, not the (absent) fill.
      if (c && (c.a ?? 1) === 0 && decls['-webkit-text-stroke']) {
        const stroke = decls['-webkit-text-stroke'].match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/i);
        if (stroke) {
          const sc = parseColor(stroke[0], tokens);
          if (sc) return blend(sc, bg);
        }
      }
      if (c) return blend(c, bg);
      if (DEBUG_SEL) console.log('  unresolvable color at', node.tagName, '→', decls.color);
      return null;
    }
    node = node.parentElement;
  }
  return blend(DEFAULT_FG, bg);
}

function typographyFor(el) {
  let fontSize = 16;
  let fontWeight = 400;
  let node = el;
  const collect = (n) => {
    const decls = {};
    const inline = n.getAttribute('style');
    if (inline)
      for (const d of inline.matchAll(/([\w-]+)\s*:\s*([^;]+);?/g)) decls[d[1].toLowerCase()] = d[2].trim();
    for (const rule of declarationsFor(rules, n)) Object.assign(decls, rule.decls);
    return decls;
  };
  const elDecls = collect(el);
  if (elDecls['font-size']) fontSize = parseFontSize(elDecls['font-size'], fontSize, tokens);
  if (elDecls['font-weight']) fontWeight = parseWeight(elDecls['font-weight']);
  if (elDecls['font-size'] || elDecls['font-weight']) return { fontSize, fontWeight };
  // walk ancestors only if the element itself declares nothing
  while (node && node.nodeType === 1) {
    const d = collect(node);
    let touched = false;
    if (d['font-size']) {
      fontSize = parseFontSize(d['font-size'], fontSize, tokens);
      touched = true;
    }
    if (d['font-weight']) {
      fontWeight = parseWeight(d['font-weight']);
      touched = true;
    }
    if (touched) break;
    node = node.parentElement;
  }
  return { fontSize, fontWeight };
}

function parseFontSize(v, current, tokens) {
  v = String(v);
  // clamp(min, preferred, max) — audit against the MINIMUM size, the
  // conservative bound for the large-text exemption.
  const clampMatch = v.match(/^clamp\(\s*([\d.]+)(px|rem|em)?/);
  if (clampMatch) return parseFontSize(`${clampMatch[1]}${clampMatch[2] ?? 'px'}`, current, tokens);
  const m = v.match(/^([\d.]+)(px|rem|em|pt)?$/);
  if (!m) return current;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'rem':
      return n * 16;
    case 'em':
      return n * current;
    case 'pt':
      return n * (96 / 72);
    case 'px':
    case undefined: // unitless px assumption in this codebase
      return n;
    default:
      return current;
  }
}

function parseWeight(v) {
  if (/^bold$/i.test(v)) return 700;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 400;
}

const isLargeText = (px, weight) => px >= 24 || (px >= 18.66 && weight >= 700);

/* Collect every element that directly contains visible text. */
const textEls = [...document.querySelectorAll('body *')].filter((el) => {
  if (el.closest('[aria-hidden="true"]')) return false;
  if (el.closest('[hidden]')) return false;
  if (el.closest('script, style, template, svg')) return false;
  return [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim().length > 0);
});

const DEBUG_SEL = flag('debug-selector', null);
let fgStopRatios = null;

const results = [];
const unmeasured = [];
for (const el of textEls) {
  if (DEBUG_SEL && !el.matches(DEBUG_SEL)) continue;
  if (DEBUG_SEL) {
    console.log('DEBUG', describe(el));
    console.log('  matched rules:');
    for (const rule of declarationsFor(rules, el)) {
      console.log('   ', rule.selector.slice(0, 70), JSON.stringify(rule.decls).slice(0, 140));
    }
  }
  const bgInfo = effectiveBackground(el);
  if (DEBUG_SEL) console.log('  bg:', JSON.stringify(bgInfo));
  if (bgInfo.color == null && !bgInfo.stops) {
    unmeasured.push({ el: describe(el), reason: bgInfo.reason });
    continue;
  }
  const underlay = bgInfo.stops ? compositeChain(bgInfo.chain) : bgInfo.color;
  const fg = effectiveForeground(el, underlay);
  if (DEBUG_SEL) console.log('  fg:', JSON.stringify(fg));
  if (fg == null) {
    unmeasured.push({ el: describe(el), reason: 'unresolvable colour token' });
    continue;
  }

  let bg = underlay;
  if (bgInfo.stops) {
    // Worst-case gradient background for this foreground: the lightest stop
    // under light text, the darkest under dark text.
    const fgLum = fg.stops ? Math.max(...fg.stops.map(luminance)) : luminance(fg);
    const worst = bgInfo.stops.reduce((a, b) =>
      fgLum > luminance(underlay)
        ? luminance(a) >= luminance(b)
          ? a
          : b
        : luminance(a) <= luminance(b)
          ? a
          : b
    );
    bg = blend(worst, underlay);
  }
  if (fg.stops) {
    // Gradient text: every stop is ink — the WORST stop must pass.
    fgStopRatios = fg.stops.map((stop) => contrast(blend(stop, bg), bg));
  }
  const { fontSize, fontWeight } = typographyFor(el);
  if (DEBUG_SEL) console.log('  typography:', fontSize, 'px', fontWeight);
  const ratio = fgStopRatios ? Math.min(...fgStopRatios) : contrast(fg, bg);
  const threshold = isLargeText(fontSize, fontWeight) ? 3 : 4.5;
  results.push({
    el: describe(el),
    text: (el.textContent || '').trim().slice(0, 40),
    ratio,
    threshold,
    fontSize,
    fontWeight,
    pass: ratio >= threshold,
  });
  fgStopRatios = null;
}

function compositeChain(chain) {
  if (!chain || !chain.length) return DEFAULT_BG;
  let acc = chain[chain.length - 1];
  if ((acc.a ?? 1) < 1) acc = blend(acc, DEFAULT_BG);
  for (let i = chain.length - 2; i >= 0; i--) acc = blend(chain[i], acc);
  return acc;
}

function describe(el) {
  const id = el.id ? `#${el.id}` : '';
  const cls = el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : '';
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

/* Also extract literal inline-style pairs from dynamically built overlays. */
const srcFiles = [];
for (const d of ['src', 'src/components', 'src/app']) {
  for (const f of await readdir(d).catch(() => [])) if (f.endsWith('.js')) srcFiles.push(`${d}/${f}`);
}
const dynPairs = [];
for (const file of srcFiles) {
  const js = await readFile(file, 'utf8');
  for (const m of js.matchAll(/style:\s*'([^']+)'/g)) {
    const styleStr = m[1];
    const colorDecl = styleStr.match(/(?:^|;)\s*color:\s*([^;]+)/);
    const bgDecl = styleStr.match(/background(?:-color)?:\s*([^;]+)/);
    if (!colorDecl) continue;
    const fg = parseColor(colorDecl[1], tokens);
    const bg = bgDecl ? parseColor(bgDecl[1], tokens) : null;
    if (!fg) continue;
    if (bgDecl && bg && /gradient|url\(/i.test(bgDecl[1])) {
      dynPairs.push({ file, style: styleStr.slice(0, 60), unmeasured: true });
      continue;
    }
    const containerBg = bg ?? parseColor('#0b0f1a', tokens); // modal surface
    const ratio = contrast(blend(fg, containerBg), containerBg);
    dynPairs.push({
      file,
      style: styleStr.slice(0, 60),
      ratio,
      threshold: 4.5,
      pass: ratio >= 4.5,
      unmeasured: false,
    });
  }
}

/* ── report ─────────────────────────────────────────────────────────────── */

const failures = results.filter((r) => !r.pass);
const dynFailures = dynPairs.filter((r) => !r.unmeasured && !r.pass);
const dynUnmeasured = dynPairs.filter((r) => r.unmeasured);

console.log(`\n  WCAG 2.2 AA contrast audit — ${DIST} + ${HTML}`);
console.log(`  ${results.length} text elements · ${dynPairs.length} dynamic style pairs\n`);

if (process.env.VERBOSE) {
  for (const r of [...results].sort((a, b) => a.ratio - b.ratio)) {
    console.log(
      `  ${r.pass ? '·' : '✗'} ${r.ratio.toFixed(2).padStart(6)}:1  (need ${r.threshold})  ${r.fontSize.toFixed(0)}px/${r.fontWeight}  ${r.el}  "${r.text}"`
    );
  }
}

if (failures.length) {
  console.log('  FAILURES:');
  for (const r of failures) {
    console.log(
      `    ✗ ${r.el} — ${r.ratio.toFixed(2)}:1 (needs ${r.threshold}) @ ${r.fontSize.toFixed(0)}px/${r.fontWeight}  "${r.text}"`
    );
  }
}
if (dynFailures.length) {
  console.log('  FAILURES (dynamic inline styles):');
  for (const r of dynFailures) console.log(`    ✗ ${r.file} — ${r.ratio.toFixed(2)}:1  ${r.style}`);
}
if (unmeasured.length) {
  console.log(`  UNMEASURED (${unmeasured.length}):`);
  for (const u of unmeasured.slice(0, 20)) console.log(`    ? ${u.el} — ${u.reason}`);
}
if (dynUnmeasured.length) {
  console.log('  UNMEASURED (dynamic gradients):');
  for (const u of dynUnmeasured) console.log(`    ? ${u.file} — ${u.style}`);
}

console.log(
  `\n  ${results.length - failures.length}/${results.length} pass · ${failures.length} fail · ${unmeasured.length} unmeasured`
);
console.log('  Desktop media-query values; gradient surfaces and pseudo-elements excluded (see header).\n');

if (failures.length || dynFailures.length) process.exit(1);
process.exit(0);
