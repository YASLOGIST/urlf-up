#!/usr/bin/env node
/**
 * generate-og.mjs — renders the Open Graph card, animated, from code.
 *
 * ── WHY THIS REPLACED AN SVG ──────────────────────────────────────────────
 * `og:image` used to point at `public/og-cover.svg`. SVG is not a valid Open
 * Graph image for the crawlers that matter: Facebook, LinkedIn, Slack,
 * WhatsApp, Discord and Twitter/X all either refuse to render it or fall back
 * to a blank card. Every share of this site was therefore unfurling with no
 * image at all — the highest-leverage, lowest-cost conversion surface the
 * product has, silently broken.
 *
 * The replacement is `public/og-image-animated.gif`: a 1200×630 GIF89a that
 * every one of those crawlers accepts, that Slack, Discord, Telegram and
 * GitHub play as an animation, and whose FIRST FRAME is a complete, composed
 * poster — because Facebook, LinkedIn and Twitter/X show exactly that one
 * frame. Nothing in the card depends on the animation to make sense. A true
 * colour PNG of the same frame is emitted alongside it as `og-cover.png` for
 * clients that prefer a still.
 *
 * ── HOW IT IS BUILT ───────────────────────────────────────────────────────
 *   · no dependencies, no network, no binary assets in the tree
 *   · deterministic: same bytes on every machine, so the diff is meaningful
 *   · composited in LINEAR light at 2× and resolved once  (scripts/lib/surface.mjs)
 *   · lettered with a geometric monoline face authored as geometry
 *                                                        (scripts/lib/type.mjs)
 *   · quantised with a brand-seeded median-cut palette and encoded with a
 *     temporal diff, so an ambient loop costs a fraction of its pixel count
 *                                                         (scripts/lib/gif.mjs)
 *
 * ── THE ANIMATION ─────────────────────────────────────────────────────────
 * One idea, stated four ways: minds converging. Light packets travel inward
 * along the filaments from VISIONARY, BUILDER, ENABLER and the ambient network
 * into the mark at the centre; each arrival flares the core. A specular sweep
 * crosses the headline once per loop. Two counter-rotating arcs orbit the
 * ring. A single point of light walks the frame. Everything else is still —
 * which is both a design decision and a compression strategy.
 *
 * Usage:
 *   node scripts/generate-og.mjs [--frames=72] [--delay=5] [--dither=3]
 *                                [--no-poster] [--out=public]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BRAND, COPY, OG, hexToBytes } from './lib/brand.mjs';
import { encodePNGFromRGB } from './lib/png.mjs';
import { buildPalette, createMapper, quantizeFrame, encodeAnimatedGIF } from './lib/gif.mjs';
import { layoutText, measureText } from './lib/type.mjs';
import {
  Mask,
  Surface,
  color,
  mixColor,
  mulberry32,
  paintMask,
  resolve,
  smoothstep,
} from './lib/surface.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/* ── Parameters ───────────────────────────────────────────────────────────── */

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const W = OG.width;
const H = OG.height;
/** Supersample factor. Every hairline in this card is sub-pixel at 1×. */
const SS = 2;
const FRAMES = Number(argv.frames ?? 72);
/** Centiseconds. Below 4 every browser silently rewrites the delay to 10. */
const DELAY_CS = Number(argv.delay ?? 5);
const DITHER = Number(argv.dither ?? 3);

/* ── Palette ──────────────────────────────────────────────────────────────── */

const C = {
  top: color('#0D0D11'),
  bottom: color('#050506'),
  gold: color(BRAND.gold),
  goldBright: color(BRAND.goldBright),
  goldDeep: color(BRAND.goldDeep),
  ember: color(BRAND.ember),
  emberSoft: color(BRAND.emberSoft),
  bone: color(BRAND.bone),
  smoke: color(BRAND.smoke),
  filament: color(BRAND.filament),
};

/* ── Layout (logical px; multiply by SS at draw time) ─────────────────────── */

const L = {
  inset: 34,
  left: 88,
  eyebrow: { y: 158, size: 21, tracking: 11, weight: 2.2 },
  headline: { y: [268, 364], size: 76, tracking: 7, weight: 6.2 },
  rule: { y: 404, x: 88, w: 164, h: 3 },
  sub: { y: [452, 484], size: 17, tracking: 2.6, weight: 1.7 },
  footer: { y: 558, size: 15, tracking: 7, weight: 1.7 },
  hub: { x: 872, y: 312, r: 132, inner: 103 },
  label: { size: 13, tracking: 4.6, weight: 1.5 },
};

const S = (v) => v * SS;

/* ── The network ──────────────────────────────────────────────────────────── */

const DEG = Math.PI / 180;
const polar = (angleDeg, radius) => [
  L.hub.x + Math.cos(angleDeg * DEG) * radius,
  L.hub.y - Math.sin(angleDeg * DEG) * radius,
];

/** The three roles the product is built around, placed as the loudest nodes. */
const ROLE_NODES = [
  { label: COPY.roles[0], angle: 66, radius: 228, place: 'right', r: 4.6 },
  { label: COPY.roles[1], angle: -24, radius: 238, place: 'below', r: 4.6 },
  { label: COPY.roles[2], angle: 243, radius: 236, place: 'right', r: 4.6 },
].map((n) => {
  const [x, y] = polar(n.angle, n.radius);
  return { ...n, x, y, role: true };
});

/** Ambient nodes: rejection-sampled so none lands on type or outside the frame. */
function buildAmbientNodes(count = 15) {
  const rand = mulberry32(0x5e1f0a);
  const nodes = [];
  const clear = (x, y) => {
    if (x < 642 || x > 1148 || y < 64 || y > 574) return false;
    if (x < 706 && y > 112 && y < 528) return false; // the type column
    for (const n of [...ROLE_NODES, ...nodes]) {
      if (Math.hypot(n.x - x, n.y - y) < 62) return false;
    }
    return true;
  };
  let guard = 0;
  while (nodes.length < count && guard++ < 6000) {
    const angle = -112 + rand() * 288;
    const radius = 170 + rand() * 150;
    const [x, y] = polar(angle, radius);
    if (!clear(x, y)) continue;
    nodes.push({ x, y, r: 1.5 + rand() * 1.7, phase: rand(), speed: 1 + Math.floor(rand() * 2) });
  }
  return nodes;
}

const AMBIENT = buildAmbientNodes();
const NODES = [...ROLE_NODES.map((n) => ({ ...n, phase: 0, speed: 1 })), ...AMBIENT];

/** Filament from a node to the rim of the ring, bowed slightly off-axis. */
function filament(node, bow = 0.07) {
  const dx = L.hub.x - node.x;
  const dy = L.hub.y - node.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const end = [L.hub.x - ux * L.hub.r, L.hub.y - uy * L.hub.r];
  const mx = (node.x + end[0]) / 2 - uy * len * bow;
  const my = (node.y + end[1]) / 2 + ux * len * bow;
  const pts = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const u = 1 - t;
    pts.push([
      u * u * node.x + 2 * u * t * mx + t * t * end[0],
      u * u * node.y + 2 * u * t * my + t * t * end[1],
    ]);
  }
  return { pts, end, len };
}

/**
 * Only the roles and the nearest ambient nodes are wired to the hub. Wiring
 * all of them produced a sunburst; the point is convergence, not a flower.
 */
const WIRED = [
  ...ROLE_NODES.map((n) => ({ ...n, phase: 0, speed: 1 })),
  ...AMBIENT.map((n) => ({ ...n, d: Math.hypot(n.x - L.hub.x, n.y - L.hub.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 8),
];

const FILAMENTS = WIRED.map((node, i) => ({
  node,
  ...filament(node, i % 2 ? 0.075 : -0.06),
  phase: (i * 0.618) % 1, // golden-ratio stagger: no two arrivals coincide
  speed: node.role ? 1 : node.speed,
}));

/** Short links between neighbouring ambient nodes — texture, not structure. */
const LINKS = [];
for (let i = 0; i < AMBIENT.length; i++) {
  for (let j = i + 1; j < AMBIENT.length; j++) {
    const d = Math.hypot(AMBIENT[i].x - AMBIENT[j].x, AMBIENT[i].y - AMBIENT[j].y);
    if (d < 168) LINKS.push({ a: AMBIENT[i], b: AMBIENT[j], alpha: 0.16 * (1 - d / 168) });
  }
}

/* ── Static layers ────────────────────────────────────────────────────────── */

/** Point sampled along the inset frame's perimeter, t ∈ [0,1), clockwise. */
function framePoint(t) {
  const x0 = L.inset;
  const y0 = L.inset;
  const x1 = W - L.inset;
  const y1 = H - L.inset;
  const w = x1 - x0;
  const h = y1 - y0;
  const per = 2 * (w + h);
  let d = (((t % 1) + 1) % 1) * per;
  if (d < w) return [x0 + d, y0];
  d -= w;
  if (d < h) return [x1, y0 + d];
  d -= h;
  if (d < w) return [x1 - d, y1];
  d -= w;
  return [x0, y1 - d];
}

function buildBackdrop() {
  const s = new Surface(W * SS, H * SS);

  // 1. Graded base. Cool near-black at the top, true ink at the bottom.
  const invH = 1 / (H * SS);
  s.paint((x, y) => {
    const v = y * invH;
    const t = smoothstep(0, 1, v);
    return mixColor(C.top, C.bottom, t);
  });

  // 2. Three light sources, in linear light so they add like light.
  //    Kept deliberately faint: the card is obsidian with light in it, not a
  //    gold gradient. Anything above ~0.04 here turns the background bronze
  //    and costs the type its contrast.
  s.addRadial(S(W * 0.1), S(-60), S(760), C.gold, 0.034, 2.6);
  s.addRadial(S(W * 1.06), S(H * 1.1), S(620), C.ember, 0.026, 2.8);
  s.addRadial(S(L.hub.x), S(L.hub.y), S(430), C.gold, 0.042, 2.9);
  // A fourth, barely-there lift behind the type column so the headline sits
  // *in* the card rather than on top of it.
  s.addRadial(S(300), S(300), S(440), C.gold, 0.02, 2.2);

  // 3. Engineering grid. Density is a texture cue; it must never read as noise.
  for (let gy = L.inset + 16; gy < H - L.inset; gy += 30) {
    for (let gx = L.inset + 16; gx < W - L.inset; gx += 30) {
      const d = Math.hypot(gx - L.hub.x, gy - L.hub.y);
      const a = 0.055 * (1 - smoothstep(60, 520, d)) + 0.012;
      s.segment(S(gx), S(gy), S(gx), S(gy), S(1.5), C.gold, a);
    }
  }

  // 4. Vignette. Applied before the frame so the border stays crisp.
  const cx = W * 0.5;
  const cy = H * 0.5;
  const norm = 1 / Math.hypot(cx, cy);
  s.modulate((x, y) => {
    const d = Math.hypot(x / SS - cx, y / SS - cy) * norm;
    return 1 - 0.55 * smoothstep(0.34, 1.04, d);
  });

  // 5. Inset frame + corner brackets.
  const x0 = L.inset;
  const y0 = L.inset;
  const x1 = W - L.inset;
  const y1 = H - L.inset;
  s.polyline(
    [
      [S(x0), S(y0)],
      [S(x1), S(y0)],
      [S(x1), S(y1)],
      [S(x0), S(y1)],
      [S(x0), S(y0)],
    ],
    S(1.1),
    C.gold,
    0.17
  );
  const B = 26;
  for (const [cxp, cyp, sx, sy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x1, y1, -1, -1],
    [x0, y1, 1, -1],
  ]) {
    s.segment(S(cxp), S(cyp), S(cxp + sx * B), S(cyp), S(2.2), C.gold, 0.5);
    s.segment(S(cxp), S(cyp), S(cxp), S(cyp + sy * B), S(2.2), C.gold, 0.5);
  }

  // 6. The network, at rest. Motion is added per frame on top of this.
  for (const link of LINKS) {
    s.segment(S(link.a.x), S(link.a.y), S(link.b.x), S(link.b.y), S(0.9), C.gold, link.alpha);
  }
  for (const f of FILAMENTS) {
    const pts = f.pts.map(([x, y]) => [S(x), S(y)]);
    s.polyline(pts, S(1.05), C.gold, f.node.role ? 0.3 : 0.17);
  }

  // 7a. The lens inside the ring. Without it the hub is a hole in the card.
  s.addRadial(S(L.hub.x), S(L.hub.y), S(L.hub.r - 4), C.gold, 0.055, 1.5);
  s.addRadial(S(L.hub.x), S(L.hub.y), S(62), C.goldBright, 0.05, 2.2);

  // 7b. Ring. Solid rim, dashed inner track — the dashes read as a mechanism.
  s.circle(S(L.hub.x), S(L.hub.y), S(L.hub.r), S(1.5), C.gold, 0.34);
  for (let a = 0; a < 360; a += 7.5) {
    s.circle(S(L.hub.x), S(L.hub.y), S(L.hub.inner), S(1.1), C.gold, 0.2, false, a, a + 3.4);
  }

  // 8. The mark. Gold stroke over ember stroke, exactly as the favicon.
  const m = 38;
  const mw = 8.4;
  s.segment(S(L.hub.x - m), S(L.hub.y - m), S(L.hub.x + m), S(L.hub.y + m), S(mw), C.goldBright, 0.97);
  s.segment(
    S(L.hub.x + m),
    S(L.hub.y - m),
    S(L.hub.x - m),
    S(L.hub.y + m),
    S(mw),
    mixColor(C.ember, C.gold, 0.3),
    0.95
  );

  // 9. Node discs.
  for (const n of NODES) {
    s.segment(S(n.x), S(n.y), S(n.x), S(n.y), S(n.r * 2), n.role ? C.goldBright : C.gold, 0.9);
  }

  // 10. The rule under the headline.
  s.segment(S(L.rule.x), S(L.rule.y), S(L.rule.x + L.rule.w), S(L.rule.y), S(L.rule.h), C.goldDeep, 0.85);

  return s;
}

/**
 * The headline is the one text run that is both burned into the backdrop AND
 * kept as a mask: the base letterform never changes, the specular sweep rides
 * over it every frame.
 */
function buildHeadlineMask() {
  const mask = new Mask(W * SS, H * SS);
  COPY.headline.forEach((line, i) => {
    mask.text(
      layoutText(line, {
        x: S(L.left),
        y: S(L.headline.y[i]),
        size: S(L.headline.size),
        tracking: S(L.headline.tracking),
        weight: S(L.headline.weight),
      })
    );
  });
  return mask;
}

/** All type is burned into the backdrop once, at rest. */
function burnStaticType(s, headlineMask) {
  const put = (text, opts, rgb) => {
    const mask = new Mask(W * SS, H * SS);
    mask.text(layoutText(text, opts));
    paintMask(s, mask, () => rgb, { additive: false });
  };

  // Headline, at rest. A faint warm bloom under it keeps it from looking
  // pasted onto the backdrop.
  paintMask(s, headlineMask, () => C.bone);

  put(
    COPY.wordmark,
    {
      x: S(L.left),
      y: S(L.eyebrow.y),
      size: S(L.eyebrow.size),
      tracking: S(L.eyebrow.tracking),
      weight: S(L.eyebrow.weight),
    },
    C.gold
  );

  COPY.sub.forEach((line, i) => {
    put(
      line,
      {
        x: S(L.left),
        y: S(L.sub.y[i]),
        size: S(L.sub.size),
        tracking: S(L.sub.tracking),
        weight: S(L.sub.weight),
      },
      i === 0 ? mixColor(C.smoke, C.bone, 0.35) : C.smoke
    );
  });

  put(
    COPY.domain,
    {
      x: S(L.left),
      y: S(L.footer.y),
      size: S(L.footer.size),
      tracking: S(L.footer.tracking),
      weight: S(L.footer.weight),
    },
    mixColor(C.gold, C.goldBright, 0.3)
  );

  // Role labels, placed so none of them can collide with the ring or the edge.
  for (const n of ROLE_NODES) {
    const opts = {
      size: S(L.label.size),
      tracking: S(L.label.tracking),
      weight: S(L.label.weight),
    };
    const w = measureText(n.label, { size: L.label.size, tracking: L.label.tracking });
    const pos =
      n.place === 'below' ? { x: S(n.x - w / 2), y: S(n.y + 26) } : { x: S(n.x + 15), y: S(n.y + 4.5) };
    put(n.label, { ...opts, ...pos }, mixColor(C.smoke, C.goldBright, 0.5));
  }
  return s;
}

/* ── Animation ────────────────────────────────────────────────────────────── */

/**
 * The specular sweep. Rests for most of the loop, crosses in the rest — so
 * two thirds of the frames carry no headline delta at all.
 */
function sheenPosition(t) {
  const p = smoothstep(0, 1, Math.min(1, Math.max(0, (t - 0.06) / 0.42)));
  return -340 + p * 1180;
}

function drawFrame(surface, headlineMask, t) {
  const TAU = Math.PI * 2;

  /* Specular sweep across the headline. */
  const sx = sheenPosition(t);
  if (sx > -320 && sx < 860) {
    const top = L.headline.y[0] - L.headline.size;
    paintMask(
      surface,
      headlineMask,
      (x, y) => {
        const d = x / SS - sx + ((y / SS - top) * 0.42 - 60);
        const k = Math.exp(-(d * d) / 8600);
        if (k < 0.01) return null;
        const hot = k * k;
        return [
          C.goldBright[0] * (k * 1.5 + hot * 0.9),
          C.goldBright[1] * (k * 1.25 + hot * 0.9),
          C.goldBright[2] * (k * 0.72 + hot * 0.9),
        ];
      },
      { additive: true }
    );
  }

  /* The same light crossing the rule. */
  const rp = (sx + 340) / 1180;
  if (rp > 0 && rp < 1) {
    const rx = L.rule.x - 20 + rp * (L.rule.w + 40);
    if (rx > L.rule.x - 10 && rx < L.rule.x + L.rule.w + 10) {
      surface.spark(S(rx), S(L.rule.y), S(16), C.goldBright, 0.5, 0.2);
    }
  }

  /* Counter-rotating arcs on the ring. */
  const headA = -36 - t * 360;
  for (let i = 0; i < 22; i++) {
    const a = headA + i * 2.4;
    const fade = (1 - i / 22) ** 2.4;
    surface.circle(S(L.hub.x), S(L.hub.y), S(L.hub.r), S(2.3), C.goldBright, 0.55 * fade, true, a, a + 2.6);
  }
  const headB = 150 + t * 360;
  for (let i = 0; i < 16; i++) {
    const a = headB - i * 2.3;
    const fade = (1 - i / 16) ** 2.4;
    surface.circle(
      S(L.hub.x),
      S(L.hub.y),
      S(L.hub.inner),
      S(1.9),
      mixColor(C.ember, C.goldBright, 0.5),
      0.46 * fade,
      true,
      a,
      a + 2.5
    );
  }

  /* Packets converging on the mark. */
  let arrivals = 0;
  for (const f of FILAMENTS) {
    const u = (t * f.speed + f.phase) % 1;
    const travel = smoothstep(0, 1, u); // ease so arrival reads as "landing"
    const at = (p) => {
      const idx = Math.min(f.pts.length - 1, Math.max(0, p * (f.pts.length - 1)));
      const i0 = Math.floor(idx);
      const i1 = Math.min(f.pts.length - 1, i0 + 1);
      const k = idx - i0;
      return [
        f.pts[i0][0] + (f.pts[i1][0] - f.pts[i0][0]) * k,
        f.pts[i0][1] + (f.pts[i1][1] - f.pts[i0][1]) * k,
      ];
    };
    const bright = f.node.role ? 1 : 0.62;
    for (let k = 0; k < 7; k++) {
      const p = travel - k * 0.022;
      if (p < 0 || p > 1) continue;
      const [px, py] = at(p);
      const fade = (1 - k / 7) ** 2.2;
      surface.spark(S(px), S(py), S(5.5 + 2 * fade), C.goldBright, 0.5 * fade * bright, 0.3);
    }
    // Arrival flare at the rim.
    const land = smoothstep(0.86, 1, u) * (1 - smoothstep(1, 1.04, u));
    if (land > 0.01) {
      surface.spark(S(f.end[0]), S(f.end[1]), S(20 * land + 6), C.goldBright, 0.75 * land, 0.22);
      arrivals += land * bright;
    }
  }

  /* The core answers every arrival. */
  const breath = 0.5 + 0.5 * Math.sin(t * TAU);
  // Capped: the flare must never wash out the mark, which is the one element
  // on the card that has to survive being scaled down to a 120 px thumbnail.
  const core = 0.5 + 0.26 * breath + Math.min(0.78, arrivals * 0.42);
  surface.spark(S(L.hub.x), S(L.hub.y), S(26 + 10 * core), C.filament, 0.42 * core, 0.3);
  surface.spark(S(L.hub.x), S(L.hub.y), S(9), C.filament, 0.95, 0.5);

  /* Node breathing. */
  for (const n of NODES) {
    const b = 0.5 + 0.5 * Math.sin((t * (n.role ? 1 : n.speed) + n.phase) * TAU);
    const i = (n.role ? 0.34 : 0.17) * (0.35 + 0.65 * b);
    surface.spark(S(n.x), S(n.y), S(n.r * 4.2 + 4), n.role ? C.goldBright : C.gold, i, 0.34);
  }

  /* One point of light walking the frame. */
  for (let k = 0; k < 20; k++) {
    const [fx, fy] = framePoint(t - k * 0.0019);
    const fade = (1 - k / 20) ** 2.2;
    surface.spark(S(fx), S(fy), S(6 * fade + 3.2), C.goldBright, 0.5 * fade, 0.34);
  }
}

/* ── Render ───────────────────────────────────────────────────────────────── */

function main() {
  const started = Date.now();
  const outDir = resolvePath(ROOT, String(argv.out ?? 'public'));
  mkdirSync(outDir, { recursive: true });

  process.stdout.write(`  composing ${FRAMES} frames at ${W}×${H} (${SS}× supersampled)…\n`);

  const headlineMask = buildHeadlineMask();
  const backdrop = burnStaticType(buildBackdrop(), headlineMask);
  const work = new Surface(W * SS, H * SS);

  const rgbFrames = [];
  for (let i = 0; i < FRAMES; i++) {
    work.copyFrom(backdrop);
    drawFrame(work, headlineMask, i / FRAMES);
    rgbFrames.push(resolve(work, SS));
    if ((i + 1) % 12 === 0 || i === FRAMES - 1) {
      process.stdout.write(`    frame ${String(i + 1).padStart(3)}/${FRAMES}\n`);
    }
  }

  // Pin the brand so quantisation can never shift the gold.
  const pinned = [
    hexToBytes(BRAND.obsidian),
    hexToBytes(BRAND.ink),
    hexToBytes(BRAND.gold),
    hexToBytes(BRAND.goldBright),
    hexToBytes(BRAND.goldDeep),
    hexToBytes(BRAND.ember),
    hexToBytes(BRAND.emberSoft),
    hexToBytes(BRAND.bone),
    hexToBytes(BRAND.smoke),
    hexToBytes(BRAND.filament),
    [255, 255, 255],
    [0, 0, 0],
  ];

  process.stdout.write('  quantising…\n');
  const { table, size } = buildPalette(rgbFrames, { pinned, sampleStride: 2 });
  const nearest = createMapper(table, size);
  const indexed = rgbFrames.map((f) => quantizeFrame(f, W, H, nearest, DITHER));

  process.stdout.write('  encoding…\n');
  const { buffer, stats } = encodeAnimatedGIF({
    width: W,
    height: H,
    palette: table,
    frames: indexed,
    delayCs: DELAY_CS,
    loop: 0,
  });

  const written = [];
  const gifPath = resolvePath(outDir, 'og-image-animated.gif');
  writeFileSync(gifPath, buffer);
  written.push([gifPath, buffer.length]);

  if (!argv['no-poster']) {
    // `--poster=N` picks which frame becomes the still. It is also how the
    // animation gets art-directed: render, look at a frame, adjust.
    const posterIndex = Math.min(FRAMES - 1, Math.max(0, Number(argv.poster ?? 0)));
    const png = encodePNGFromRGB(rgbFrames[posterIndex], W, H);
    const pngPath = resolvePath(outDir, 'og-cover.png');
    writeFileSync(pngPath, png);
    written.push([pngPath, png.length]);
  }

  const moved = ((stats.changedPx / stats.totalPx) * 100).toFixed(1);
  for (const [p, n] of written) {
    process.stdout.write(`${String((n / 1024).toFixed(1)).padStart(9)} kB  ${p.replace(`${ROOT}/`, '')}\n`);
  }
  process.stdout.write(
    `\n  ${FRAMES} frames · ${(FRAMES * DELAY_CS) / 100}s loop · ${size} colours · ` +
      `${moved}% of pixels re-encoded · ${((Date.now() - started) / 1000).toFixed(1)}s\n`
  );
}

main();
