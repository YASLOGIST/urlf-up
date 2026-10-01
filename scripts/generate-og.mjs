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

/**
 * Atmospheric depth field: large, very dim, very soft discs sitting *behind*
 * the network. Individually invisible; collectively they stop the background
 * from reading as a flat gradient and give the constellation something to sit
 * in front of. Static, therefore free.
 */
function buildBokeh(count = 30) {
  const rand = mulberry32(0x0b0ca1);
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < 4000) {
    const x = 60 + rand() * (W - 120);
    const y = 40 + rand() * (H - 80);
    // Keep the softest, largest ones away from the headline: a bokeh disc
    // behind type is a smudge, not depth.
    const overType = x < 700 && y > 120 && y < 520;
    const r = overType ? 14 + rand() * 16 : 20 + rand() * 46;
    if (overType && rand() > 0.22) continue;
    out.push({ x, y, r, a: 0.0045 + rand() * 0.0085, warm: rand() });
  }
  return out;
}

const BOKEH = buildBokeh();

/**
 * Volumetric shafts from the hub. Clamped so none of them reaches the type
 * column — light behind letterforms costs contrast, and contrast is the only
 * thing that makes an OG card legible at 240 px wide in a Slack sidebar.
 */
function buildRays(count = 20) {
  const rand = mulberry32(0x5a7e11);
  const rays = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 360 + rand() * 9;
    const dx = Math.cos(angle * DEG);
    const dy = -Math.sin(angle * DEG);
    let len = 150 + rand() * 230;
    // Clamp against the type column and the frame.
    if (dx < 0) len = Math.min(len, (L.hub.x - 712) / -dx);
    if (dx > 0) len = Math.min(len, (W - 46 - L.hub.x) / dx);
    if (dy < 0) len = Math.min(len, (L.hub.y - 46) / -dy);
    if (dy > 0) len = Math.min(len, (H - 46 - L.hub.y) / dy);
    if (len < 150) continue;
    rays.push({
      x0: L.hub.x + dx * (L.hub.r + 6),
      y0: L.hub.y + dy * (L.hub.r + 6),
      x1: L.hub.x + dx * len,
      y1: L.hub.y + dy * len,
      w: 22 + rand() * 38,
      a: 0.0035 + rand() * 0.0085,
    });
  }
  return rays;
}

const RAYS = buildRays();

function buildBackdrop() {
  const s = new Surface(W * SS, H * SS);

  // 1. Graded base. Cool near-black at the top, true ink at the bottom, with a
  //    slight lateral warm bias towards the mark so the card has a direction.
  const invH = 1 / (H * SS);
  const invW = 1 / (W * SS);
  s.paint((x, y) => {
    const t = smoothstep(0, 1, y * invH);
    const lateral = smoothstep(0.25, 1, x * invW) * 0.35;
    return mixColor(mixColor(C.top, C.bottom, t), C.top, lateral * (1 - t) * 0.5);
  });

  // 2. Light sources, in linear light so they add like light. Kept deliberately
  //    faint: the card is obsidian with light in it, not a gold gradient.
  //    Anything above ~0.04 here turns the background bronze and costs the type
  //    its contrast.
  s.addRadial(S(W * 0.1), S(-60), S(760), C.gold, 0.034, 2.6);
  s.addRadial(S(W * 1.06), S(H * 1.1), S(620), C.ember, 0.026, 2.8);
  s.addRadial(S(L.hub.x), S(L.hub.y), S(430), C.gold, 0.042, 2.9);
  s.addRadial(S(300), S(300), S(440), C.gold, 0.02, 2.2);

  // 3. Atmospheric depth, furthest layer first.
  for (const b of BOKEH) {
    s.addRadial(S(b.x), S(b.y), S(b.r), mixColor(C.gold, C.ember, b.warm * 0.35), b.a, 1.7);
  }

  // 4. Two wide shafts raking the card from the upper left. At this intensity
  //    they are not visible as beams — they are visible as the card having air
  //    in it.
  s.glowLine(S(-120), S(-90), S(760), S(H + 60), S(190), C.gold, 0.0062, 0.0);
  s.glowLine(S(120), S(-120), S(1080), S(H + 90), S(130), C.gold, 0.0038, 0.0);

  // 5. Volumetric shafts from the mark.
  for (const r of RAYS) {
    s.glowLine(S(r.x0), S(r.y0), S(r.x1), S(r.y1), S(r.w), C.gold, r.a, 0.0);
  }

  // 6. Engineering grid. Density is a texture cue; it must never read as noise.
  for (let gy = L.inset + 16; gy < H - L.inset; gy += 30) {
    for (let gx = L.inset + 16; gx < W - L.inset; gx += 30) {
      const d = Math.hypot(gx - L.hub.x, gy - L.hub.y);
      const a = 0.055 * (1 - smoothstep(60, 520, d)) + 0.012;
      s.segment(S(gx), S(gy), S(gx), S(gy), S(1.5), C.gold, a);
    }
  }

  // 7. Vignette, then a cool rim of light along the top edge — the single cue
  //    that most reliably makes a dark surface read as a physical object.
  const cx = W * 0.5;
  const cy = H * 0.5;
  const norm = 1 / Math.hypot(cx, cy);
  s.modulate((x, y) => {
    const d = Math.hypot(x / SS - cx, y / SS - cy) * norm;
    return 1 - 0.7 * smoothstep(0.26, 1.02, d);
  });
  s.glowLine(S(L.inset), S(L.inset + 1), S(W - L.inset), S(L.inset + 1), S(24), C.gold, 0.013, 0.007);

  // 8. Inset frame + corner brackets. Double-ruled brackets with a tick read as
  //    a registration mark rather than a border decoration.
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
  const B = 30;
  for (const [cxp, cyp, sx, sy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x1, y1, -1, -1],
    [x0, y1, 1, -1],
  ]) {
    s.segment(S(cxp), S(cyp), S(cxp + sx * B), S(cyp), S(2.2), C.gold, 0.55);
    s.segment(S(cxp), S(cyp), S(cxp), S(cyp + sy * B), S(2.2), C.gold, 0.55);
    s.segment(S(cxp + sx * 7), S(cyp + sy * 7), S(cxp + sx * 19), S(cyp + sy * 7), S(1), C.gold, 0.22);
    s.segment(S(cxp + sx * 7), S(cyp + sy * 7), S(cxp + sx * 7), S(cyp + sy * 19), S(1), C.gold, 0.22);
  }

  // 9. The network, at rest. Motion is added per frame on top of this.
  for (const link of LINKS) {
    s.segment(S(link.a.x), S(link.a.y), S(link.b.x), S(link.b.y), S(0.9), C.gold, link.alpha);
  }
  for (const f of FILAMENTS) {
    const pts = f.pts.map(([x, y]) => [S(x), S(y)]);
    s.polyline(pts, S(1.05), C.gold, f.node.role ? 0.32 : 0.17);
  }

  // 10a. The lens inside the ring. Without it the hub is a hole in the card.
  s.addRadial(S(L.hub.x), S(L.hub.y), S(L.hub.r - 4), C.gold, 0.055, 1.5);
  s.addRadial(S(L.hub.x), S(L.hub.y), S(62), C.goldBright, 0.05, 2.2);

  // 10b. The hub as an instrument, outside in:
  //      a faint containment ring, a graduated dial, the solid rim, a dashed
  //      track and an inner hairline. Four concentric rhythms at four
  //      different densities is what separates "a circle" from "a mechanism".
  //      Every circular element is lit from the upper left rather than stroked
  //      at a constant alpha. A ring of uniform opacity reads as a drawn
  //      outline; a ring whose brightness tracks a light source reads as a
  //      turned metal edge. `key(a)` is that light, shared by all of them.
  const KEY = 132; // degrees — matches the backdrop's top-left light source
  const key = (a) => 0.42 + 0.58 * (0.5 + 0.5 * Math.cos((a - KEY) * DEG)) ** 1.5;

  s.circle(S(L.hub.x), S(L.hub.y), S(L.hub.r + 38), S(0.9), C.gold, 0.1);
  for (let a = 0; a < 360; a += 90) {
    const [tx0, ty0] = polar(a, L.hub.r + 30);
    const [tx1, ty1] = polar(a, L.hub.r + 46);
    s.segment(S(tx0), S(ty0), S(tx1), S(ty1), S(1.3), C.gold, 0.3);
  }
  for (let i = 0; i < 72; i++) {
    const a = i * 5;
    const major = i % 6 === 0;
    const [tx0, ty0] = polar(a, L.hub.r + 9);
    const [tx1, ty1] = polar(a, L.hub.r + (major ? 21 : 15));
    s.segment(S(tx0), S(ty0), S(tx1), S(ty1), S(major ? 1.5 : 0.9), C.gold, (major ? 0.36 : 0.18) * key(a));
  }
  // The rim, as a machined edge: a bright lit face with a dark bevel inside it.
  for (let a = 0; a < 360; a += 3) {
    const k = key(a);
    s.circle(
      S(L.hub.x),
      S(L.hub.y),
      S(L.hub.r),
      S(1.6),
      mixColor(C.gold, C.goldBright, k * 0.5),
      0.4 * k,
      false,
      a,
      a + 3.3
    );
    s.circle(
      S(L.hub.x),
      S(L.hub.y),
      S(L.hub.r - 2.6),
      S(1),
      C.bottom,
      0.5 * (1 - k * 0.6),
      false,
      a,
      a + 3.3
    );
  }
  for (let a = 0; a < 360; a += 7.5) {
    s.circle(S(L.hub.x), S(L.hub.y), S(L.hub.inner), S(1.1), C.gold, 0.22 * key(a), false, a, a + 3.4);
  }
  s.circle(S(L.hub.x), S(L.hub.y), S(74), S(0.8), C.gold, 0.14);

  // 11. The mark. Gold stroke over ember stroke, exactly as the favicon.
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

  // 12. Node discs, depth-graded: the further from the mark, the dimmer and
  //     the smaller. Uniform nodes read as a flat diagram; graded nodes read as
  //     a volume.
  for (const n of NODES) {
    const d = Math.hypot(n.x - L.hub.x, n.y - L.hub.y);
    const near = 1 - smoothstep(150, 330, d);
    const a = n.role ? 0.92 : 0.42 + 0.46 * near;
    s.segment(S(n.x), S(n.y), S(n.x), S(n.y), S(n.r * 2), n.role ? C.goldBright : C.gold, a);
  }

  // 13. The rule under the headline, with a lozenge terminal.
  s.segment(S(L.rule.x), S(L.rule.y), S(L.rule.x + L.rule.w), S(L.rule.y), S(L.rule.h), C.goldDeep, 0.85);
  s.segment(
    S(L.rule.x + L.rule.w + 11),
    S(L.rule.y),
    S(L.rule.x + L.rule.w + 11),
    S(L.rule.y),
    S(4.4),
    C.gold,
    0.6
  );

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

  // Headline, at rest. Not flat bone: a vertical gradient from near-white at
  // the cap line to a warm bone at the baseline of the second line. The eye
  // reads the gradient as a light source above the card, and it is the
  // difference between type that is *lit* and type that is *filled*.
  const hTop = S(L.headline.y[0] - L.headline.size);
  const hBot = S(L.headline.y[1] + 4);
  const headWarm = mixColor(C.bone, C.gold, 0.2);
  paintMask(s, headlineMask, (x, y) => {
    const t = smoothstep(hTop, hBot, y);
    const shade = mixColor(mixColor(C.filament, C.bone, 0.45), headWarm, t);
    // Very slight left-to-right cool-down, matching the key light at top left.
    const lat = 1 - 0.07 * smoothstep(S(L.left), S(L.left + 540), x);
    return [shade[0] * lat, shade[1] * lat, shade[2] * lat];
  });

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

/** The box the per-frame bloom is confined to: everything inside the dial. */
const HUB_BOX = [
  S(L.hub.x - L.hub.r - 54),
  S(L.hub.y - L.hub.r - 54),
  S(L.hub.x + L.hub.r + 54),
  S(L.hub.y + L.hub.r + 54),
];

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

  /* A single shock ring, released once per loop and contained by the rim.
     This started as three continuously-expanding rings. They looked good and
     they cost 236 kB of the file on their own — a ring sweeping the dial means
     a large annulus of changed pixels on every single frame, and changed
     pixels are the only thing a diff-encoded GIF charges for. One ring with a
     55 % rest is the same idea at a quarter of the price, and it reads better:
     a pulse you notice, rather than a wobble you tune out. */
  {
    const u = smoothstep(0, 1, Math.min(1, t / 0.45));
    const a = 0.34 * (1 - u) ** 1.6 * smoothstep(0, 0.1, t) * (t < 0.46 ? 1 : 0);
    if (a > 0.006) {
      surface.circle(S(L.hub.x), S(L.hub.y), S(26 + u * 74), S(1.3 + 2.4 * (1 - u)), C.goldBright, a, true);
    }
  }

  /* Two satellites on the inner tracks, counter-rotating. */
  for (const sat of [
    { r: 74, speed: -1, size: 3.1, tint: C.goldBright },
    { r: L.hub.inner, speed: 0.5, size: 2.4, tint: mixColor(C.ember, C.goldBright, 0.55) },
  ]) {
    const a = (t * sat.speed * 360 + sat.r) * DEG;
    const sxp = L.hub.x + Math.cos(a) * sat.r;
    const syp = L.hub.y - Math.sin(a) * sat.r;
    for (let k = 0; k < 6; k++) {
      const a2 = a - sat.speed * k * 0.021 * TAU;
      const fade = (1 - k / 6) ** 2.1;
      surface.spark(
        S(L.hub.x + Math.cos(a2) * sat.r),
        S(L.hub.y - Math.sin(a2) * sat.r),
        S(sat.size * 2.1 * fade + 2),
        sat.tint,
        0.5 * fade,
        0.34
      );
    }
    surface.spark(S(sxp), S(syp), S(sat.size * 2.6), C.filament, 0.6, 0.42);
  }

  /* A reading head sweeping the graduated dial — the instrument is live. */
  const dialA = 96 - t * 360;
  for (let k = 0; k < 9; k++) {
    const a = dialA + k * 3.1;
    const fade = (1 - k / 9) ** 2;
    const [dx0, dy0] = polar(a, L.hub.r + 9);
    const [dx1, dy1] = polar(a, L.hub.r + 21);
    surface.segment(S(dx0), S(dy0), S(dx1), S(dy1), S(1.6), C.goldBright, 0.5 * fade, true);
  }

  /* Node breathing. */
  for (const n of NODES) {
    const b = 0.5 + 0.5 * Math.sin((t * (n.role ? 1 : n.speed) + n.phase) * TAU);
    const i = (n.role ? 0.34 : 0.17) * (0.35 + 0.65 * b);
    surface.spark(S(n.x), S(n.y), S(n.r * 4.2 + 4), n.role ? C.goldBright : C.gold, i, 0.34);
  }

  /* Edge runners, locked to the sheen.
     An earlier cut had a point of light orbiting the whole perimeter on every
     frame. It looked fine and it was the single most expensive thing on the
     card: a lit pixel on the left edge and a lit pixel on the right edge force
     the frame's changed rectangle to span the entire 1200 px, so all 71 deltas
     paid to re-encode the headline, the dial and everything between them.
     Tying the runners to the sheen instead makes the whole card read as ONE
     scanning gesture that crosses and then rests — and it collapses the
     changed rectangle to the right-hand third for the half of the loop where
     nothing on the left is moving. Better composition, half the bytes. */
  if (sx > -320 && sx < W + 240) {
    for (let k = 0; k < 16; k++) {
      const ex = sx - 150 - k * 13;
      if (ex < L.inset - 10 || ex > W - L.inset + 10) continue;
      const fade = (1 - k / 16) ** 2.1;
      surface.spark(S(ex), S(L.inset), S(5.5 * fade + 3), C.goldBright, 0.46 * fade, 0.34);
      surface.spark(
        S(W - L.inset - (ex - L.inset)),
        S(H - L.inset),
        S(5.5 * fade + 3),
        C.goldBright,
        0.4 * fade,
        0.34
      );
    }
  }

  /* Bloom the dial. The static layer is bloomed once at build time; without
     this pass the moving light would be the only thing on the card that does
     not bleed, and the eye picks that up immediately as "drawn on top".
     Restricted to the hub's bounding box, which is the only region where the
     animation is bright enough to bloom at all — a full-surface pass per frame
     would cost ~25× more for no visible difference. */
  surface.bloom({ threshold: 0.5, radius: 18, intensity: 0.34, region: HUB_BOX });
}

/* ── Render ───────────────────────────────────────────────────────────────── */

function main() {
  const started = Date.now();
  const outDir = resolvePath(ROOT, String(argv.out ?? 'public'));
  mkdirSync(outDir, { recursive: true });

  process.stdout.write(`  composing ${FRAMES} frames at ${W}×${H} (${SS}× supersampled)…\n`);

  const headlineMask = buildHeadlineMask();
  const backdrop = burnStaticType(buildBackdrop(), headlineMask);

  // Optical finish on the static layer. Both of these are the reason the card
  // reads as a photograph of a lit object rather than as vector art, and both
  // are FREE in the animation: they are baked once, before the per-frame loop,
  // so they appear in frame 0's full payload and in no frame delta afterwards.
  backdrop.bloom({ threshold: 0.55, radius: 22, intensity: 0.3 });

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
