#!/usr/bin/env node
/**
 * render-readme-assets.mjs — renders the README's cinematic visual system from code.
 *
 * Produces (all deterministic, no network, no runtime dependencies):
 *   assets/readme/urlife-hero.gif           1920×720 animated hero, 9 s seamless loop
 *   assets/readme/urlife-hero-poster.png    static still of the hero (fallback / reduced motion)
 *   assets/readme/divider.gif               luminous section divider, 3.6 s loop
 *   assets/readme/yaslogist-signature.gif   closing YASLOGIST signature, 2.9 s loop
 *   assets/readme/yaslogist-signature.png   static still of the closing signature
 *
 * Built on the same zero-dependency pipeline as scripts/generate-og.mjs:
 * linear-light compositing, SDF anti-aliasing, a geometric monoline typeface
 * authored as stroke geometry (so no third-party font is vendored), brand-seeded
 * median-cut palette, ordered dithering, and a temporal-diff GIF encoder.
 *
 * ── THE CONCEPT ──────────────────────────────────────────────────────────────
 * UrLife is a collaboration platform that brings three roles together:
 * VISIONARY, BUILDER and ENABLER. The hero stages that workflow as an
 * instrument: the two complementary pairings the matching engine recognises
 * (Visionary ↔ Builder, Visionary ↔ Enabler) flow along a matching orbit,
 * every role streams its signal into the core, and a 45-minute dial — the
 * length of the closed session — sweeps once per loop.
 *
 * ── THE LOOP ─────────────────────────────────────────────────────────────────
 * Every animated quantity is a periodic function of T ∈ [0, 1) built from
 * integer harmonics of 2π·T, so frame N−1 flows into frame 0 with no seam.
 * Only the instrument moves; the typography and the field are rendered once
 * and never re-encoded, which is what keeps the file small.
 *
 * Usage:
 *   node assets/readme/render-readme-assets.mjs [--only=hero|divider|signature]
 *        [--frames=180] [--poster=70] [--out=assets/readme]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BRAND, hexToBytes } from '../../scripts/lib/brand.mjs';
import { encodePNGFromRGB } from '../../scripts/lib/png.mjs';
import { buildPalette, createMapper, quantizeFrame, encodeAnimatedGIF } from '../../scripts/lib/gif.mjs';
import { layoutText, measureText } from '../../scripts/lib/type.mjs';
import { Mask, Surface, color, mixColor, mulberry32, paintMask, resolve, smoothstep } from '../../scripts/lib/surface.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

/* ── Canvas ───────────────────────────────────────────────────────────────── */

const W = 1920;
const H = 720;
/** Supersample factor. Hairlines and the brand mark are sub-pixel at 1×. */
const SS = 2;
const FRAMES = Number(argv.frames ?? 180);
/** 5 cs per frame × 180 frames = 9.0 s. 4 cs is the floor browsers honour. */
const DELAY_CS = 5;
const DITHER = 3;

const S = (v) => v * SS;

/* ── Palette: the UrLife obsidian + gold system, plus one cool structural accent ── */

const C = {
  top: color('#0E0E13'),
  bottom: color('#040405'),
  gold: color(BRAND.gold),
  goldBright: color(BRAND.goldBright),
  goldDeep: color(BRAND.goldDeep),
  ember: color(BRAND.ember),
  bone: color(BRAND.bone),
  smoke: color(BRAND.smoke),
  filament: color(BRAND.filament),
  /** Structural accent: coordinate ticks and the ambient field only. */
  cyan: color('#7FD3E0'),
};

const PINNED = [
  hexToBytes('#0E0E13'),
  hexToBytes('#040405'),
  hexToBytes(BRAND.gold),
  hexToBytes(BRAND.goldBright),
  hexToBytes(BRAND.goldDeep),
  hexToBytes(BRAND.ember),
  hexToBytes(BRAND.bone),
  hexToBytes(BRAND.smoke),
  hexToBytes(BRAND.filament),
  hexToBytes('#7FD3E0'),
  [255, 255, 255],
  [0, 0, 0],
];

/* ── Geometry ─────────────────────────────────────────────────────────────── */

/** The instrument. Everything dynamic lives inside the 660 px box around it. */
const HUB = { x: 1500, y: 360 };
const RING = { coord: 320, roles: 262, dash: 130, mid: 150, dialIn: 196, dialOut: 214, core: 40 };

const polar = (cx, cy, angleDeg, r) => [cx + Math.cos(angleDeg * DEG) * r, cy - Math.sin(angleDeg * DEG) * r];

/** Role nodes sit on the matching orbit. Angles are math-convention (CCW). */
const ROLES = [
  { key: 'visionary', label: 'VISIONARY', angle: 90, place: 'right' },
  { key: 'builder', label: 'BUILDER', angle: 210, place: 'below' },
  { key: 'enabler', label: 'ENABLER', angle: 330, place: 'below' },
].map((r, i) => {
  const [x, y] = polar(HUB.x, HUB.y, r.angle, RING.roles);
  return { ...r, x, y, i, bow: i === 1 ? 0.07 : -0.07 };
});

const VISIONARY = ROLES[0];

/**
 * Convergence filaments: a bowed quadratic from each role to the core.
 * Packets ride these curves. Points are ordered node → core.
 */
function convergenceCurve(role) {
  const end = polar(HUB.x, HUB.y, Math.atan2(HUB.y - role.y, role.x - HUB.x) / DEG, RING.core);
  const dx = end[0] - role.x;
  const dy = end[1] - role.y;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const cx = (role.x + end[0]) / 2 + nx * len * role.bow;
  const cy = (role.y + end[1]) / 2 + ny * len * role.bow;
  const pts = [];
  for (let i = 0; i <= 96; i++) {
    const t = i / 96;
    const u = 1 - t;
    pts.push([u * u * role.x + 2 * u * t * cx + t * t * end[0], u * u * role.y + 2 * u * t * cy + t * t * end[1]]);
  }
  return pts;
}

/**
 * Packet schedule. Each role departs three packets per loop, staggered so the
 * nine arrivals at the core land on the nine equal slots j/9. A packet takes
 * two thirds of the loop to travel, so two are in flight per filament.
 */
const PACKET_TRAVEL = 2 / 3;

/** Matching arcs along the orbit, from Visionary to each complementary role. */
const MATCH_ARCS = [
  { from: 90, to: 210, dir: 1 },
  { from: 90, to: -30, dir: -1 },
];

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const wrap01 = (x) => x - Math.floor(x);
const wrapSigned = (x) => x - Math.round(x);
const wrapDeg = (d) => ((d % 360) + 360) % 360;
const gauss = (d, sigma) => Math.exp(-(d * d) / (2 * sigma * sigma));

/** Arrival instants at the core: nine equal slots across the loop. */
const ARRIVALS = Array.from({ length: 9 }, (_, j) => j / 9);
/** Periodic core flare: sum of Gaussian arrival pulses, wrapped into the loop. */
function coreFlare(T) {
  let f = 0;
  for (const t of ARRIVALS) f += gauss(wrapSigned(T - t), 0.011);
  return Math.min(1.6, f);
}

/** Activation envelope: a single slow cycle, brightest at Act IV (brand resolution). */
const activation = (T) => 0.72 + 0.28 * Math.cos(TAU * (T - 0.85));

/* ── Static scene (built once) ────────────────────────────────────────────── */

function buildScene() {
  const rand = mulberry32(0x0c0ffee);

  // Ambient field: outside the coordinate ring, never beneath the type column.
  const ambient = [];
  let guard = 0;
  while (ambient.length < 62 && guard++ < 40000) {
    const x = 1000 + rand() * 890;
    const y = 40 + rand() * 646;
    if (Math.hypot(x - HUB.x, y - HUB.y) < RING.coord + 26) continue;
    if (x > 1640 && y < 130) continue; // keep the corner caption clear
    if (ambient.some((n) => Math.hypot(n.x - x, n.y - y) < 56)) continue;
    const z = rand(); // depth: far nodes are smaller and dimmer
    ambient.push({ x, y, z, r: 1.0 + 1.6 * z });
  }

  // Constellation links between near neighbours, kept clear of the instrument.
  const links = [];
  const seen = new Set();
  ambient.forEach((a, i) => {
    ambient
      .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
      .filter((o) => o.j !== i && o.d < 190)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2)
      .forEach(({ j }) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        const b = ambient[j];
        let clear = true;
        for (let t = 0; t <= 1; t += 0.05) {
          const px = a.x + (b.x - a.x) * t;
          const py = a.y + (b.y - a.y) * t;
          if (Math.hypot(px - HUB.x, py - HUB.y) < RING.coord + 14) clear = false;
        }
        if (clear) links.push({ a, b, z: (a.z + b.z) / 2 });
      });
  });

  // Bokeh discs in the field, depth-graded and kept off the instrument.
  const bokeh = [];
  guard = 0;
  while (bokeh.length < 14 && guard++ < 8000) {
    const x = 1010 + rand() * 860;
    const y = 60 + rand() * 600;
    if (Math.hypot(x - HUB.x, y - HUB.y) < RING.coord + 60) continue;
    bokeh.push({ x, y, r: 26 + rand() * 60, warm: rand() > 0.5 });
  }

  return { ambient, links, bokeh };
}

const SCENE = buildScene();

/** Static typography. Built once; the glyphs are authored geometry, not a font file. */
function textMask(text, opts) {
  const m = new Mask(W * SS, H * SS);
  m.text(layoutText(text, opts));
  return m;
}

function paintStaticText(s, text, opts, rgb) {
  paintMask(s, textMask(text, opts), () => rgb, { additive: false });
}

/** Arguments are in supersampled px. The ✘ is two strokes; one carries ember, as in the OG card. */
function paintBrandMark(s, cx, cy, size, weight) {
  const probe = layoutText('\u2718', { x: 0, y: 0, size, weight, tracking: 0 });
  const { runs } = layoutText('\u2718', { x: cx - probe.width / 2, y: cy + size / 2, size, weight, tracking: 0 });
  runs.forEach((run, idx) => {
    const m = new Mask(W * SS, H * SS);
    m.polyline(run.points, run.width);
    const rgb = idx === 0 ? mixColor(C.gold, C.goldBright, 0.25) : C.ember;
    paintMask(s, m, () => rgb, { additive: false });
  });
}

/** Backdrop: everything that never moves. Rendered once, copied per frame. */
function buildBackdrop(scene) {
  const s = new Surface(W * SS, H * SS);

  // Obsidian gradient, then dimensional haze. No flat black.
  s.paint((x, y) => mixColor(C.top, C.bottom, smoothstep(0, (H * SS) * 0.95, y)));
  s.addRadial(S(HUB.x), S(HUB.y), S(860), C.gold, 0.034, 2.6);
  s.addRadial(S(HUB.x), S(HUB.y), S(330), C.goldDeep, 0.03, 2.2);
  s.addRadial(S(170), S(640), S(620), C.cyan, 0.0065, 2.2);
  s.addRadial(S(1880), S(40), S(460), C.cyan, 0.0075, 2.2);

  // Bokeh: out-of-focus depth in the field.
  for (const b of scene.bokeh) {
    s.addRadial(S(b.x), S(b.y), S(b.r), b.warm ? C.gold : C.cyan, b.warm ? 0.012 : 0.009, 3.2);
  }

  // Volumetric shafts falling into the instrument.
  s.glowLine(S(1260), S(-30), S(1470), S(300), S(70), C.gold, 0.012, 0.0);
  s.glowLine(S(1500), S(-30), S(1500), S(290), S(60), C.goldBright, 0.009, 0.0);
  s.glowLine(S(1760), S(-30), S(1530), S(300), S(70), C.gold, 0.01, 0.0);

  // Ambient constellation: the product's ambient field, depth-graded.
  for (const l of scene.links) {
    s.segment(S(l.a.x), S(l.a.y), S(l.b.x), S(l.b.y), S(1.0), C.cyan, 0.11 + 0.12 * l.z, true);
  }
  for (const n of scene.ambient) {
    s.spark(S(n.x), S(n.y), S(n.r * 3.2), mixColor(C.cyan, C.bone, 0.3), 0.16 + 0.42 * n.z, 0.22);
  }

  // Coordinate frame: precision, not decoration.
  s.circle(S(HUB.x), S(HUB.y), S(RING.coord), S(1.1), C.cyan, 0.3, false);
  s.circle(S(HUB.x), S(HUB.y), S(RING.mid), S(1.4), C.gold, 0.2, false);
  // Mid ring: lit by one key light at 132°, so it reads as a machined edge.
  for (let a = 0; a < 360; a += 3) {
    const k = 0.18 + 0.82 * Math.max(0, Math.cos((a - 132) * DEG)) ** 1.6;
    s.circle(S(HUB.x), S(HUB.y), S(RING.mid), S(1.6), C.goldBright, 0.55 * k, true, a, a + 3.2);
  }
  // Dial base ticks: forty-five of them, one per minute of the closed session.
  for (let m = 0; m < 45; m++) {
    const major = m % 5 === 0;
    const [x0, y0] = polar(HUB.x, HUB.y, 90 - 8 * m, major ? RING.dialIn - 8 : RING.dialIn);
    const [x1, y1] = polar(HUB.x, HUB.y, 90 - 8 * m, RING.dialOut);
    s.segment(S(x0), S(y0), S(x1), S(y1), S(major ? 1.6 : 1.0), C.smoke, major ? 0.42 : 0.2, false);
  }
  // Matching orbit base: the complementary pairings the engine recognises.
  for (const arc of MATCH_ARCS) {
    const pts = [];
    for (let a = arc.from; arc.dir > 0 ? a <= arc.to : a >= arc.to; a += arc.dir * 1.5) {
      const [x, y] = polar(HUB.x, HUB.y, a, RING.roles);
      pts.push([S(x), S(y)]);
    }
    s.polyline(pts, S(1.0), C.gold, 0.22, true);
  }
  // Convergence filaments, faint at rest.
  for (const role of ROLES) {
    const pts = convergenceCurve(role).map(([x, y]) => [S(x), S(y)]);
    s.polyline(pts, S(1.0), C.filament, 0.16, true);
  }

  // Frame: a hairline inset with four technical corner brackets.
  const inset = 26;
  const frameRgb = mixColor(C.gold, C.bone, 0.2);
  s.segment(S(inset), S(inset), S(W - inset), S(inset), S(1), frameRgb, 0.14);
  s.segment(S(inset), S(H - inset), S(W - inset), S(H - inset), S(1), frameRgb, 0.14);
  s.segment(S(inset), S(inset), S(inset), S(H - inset), S(1), frameRgb, 0.14);
  s.segment(S(W - inset), S(inset), S(W - inset), S(H - inset), S(1), frameRgb, 0.14);
  const L = 44;
  for (const [x, y, dx, dy] of [
    [inset, inset, 1, 0],
    [inset, inset, 0, 1],
    [W - inset, inset, -1, 0],
    [W - inset, inset, 0, 1],
    [inset, H - inset, 1, 0],
    [inset, H - inset, 0, -1],
    [W - inset, H - inset, -1, 0],
    [W - inset, H - inset, 0, -1],
  ]) {
    s.segment(S(x), S(y), S(x + dx * L), S(y + dy * L), S(2.2), C.gold, 0.9);
  }

  // ── Typography: the product, the brief, and the signature ──
  // Eyebrow: the product mark as the brand carries it everywhere else.
  paintStaticText(
    s,
    'UR LF \u2718 UP',
    { x: S(120), y: S(150), size: S(22), tracking: S(10), weight: S(2.4) },
    mixColor(C.gold, C.goldBright, 0.3)
  );

  // Headline: lit, not filled. Near-white at the cap line, warm bone at the baseline.
  const headLines = [
    { text: 'WHERE', y: 318 },
    { text: 'MINDS MEET', y: 444 },
  ];
  const hTop = S(318 - 118);
  const hBot = S(444 + 4);
  const headMask = new Mask(W * SS, H * SS);
  for (const line of headLines) {
    headMask.text(layoutText(line.text, { x: S(120), y: S(line.y), size: S(118), tracking: S(8), weight: S(9) }));
  }
  paintMask(
    s,
    headMask,
    (x, y) => {
      const t = smoothstep(hTop, hBot, y);
      const shade = mixColor(mixColor(C.filament, C.bone, 0.45), mixColor(C.bone, C.gold, 0.2), t);
      return shade;
    },
    { additive: false }
  );

  // Brief line. A rule, then the two sentences the product actually promises.
  s.segment(S(120), S(490), S(270), S(490), S(3), C.gold, 1.0);
  paintStaticText(
    s,
    'A PROJECT COLLABORATION PLATFORM FOR THE ARAB WORLD.',
    { x: S(120), y: S(548), size: S(22), tracking: S(2.6), weight: S(1.9) },
    mixColor(C.bone, C.smoke, 0.25)
  );
  paintStaticText(
    s,
    'STRUCTURED BRIEF \u00B7 EXPLAINABLE MATCHING \u00B7 45-MINUTE CLOSED MEETING',
    { x: S(120), y: S(590), size: S(17), tracking: S(3.1), weight: S(1.6) },
    C.smoke
  );

  // Signature, lower left. The YASLOGIST wordmark is lettered from the same geometry as the product mark.
  s.segment(S(120), S(624), S(1000), S(624), S(1), C.gold, 0.22);
  const sigOpts = { x: S(120), y: S(684), size: S(40), tracking: S(14), weight: S(4.2) };
  paintStaticText(s, 'YASLOGIST', sigOpts, C.bone);
  const sigW = measureText('YASLOGIST', { size: 40, tracking: 14 });
  s.segment(S(120 + sigW + 30), S(650), S(120 + sigW + 30), S(684), S(1.2), C.gold, 0.7);
  paintStaticText(
    s,
    'WWW.YASLOGIST.COM',
    { x: S(120 + sigW + 56), y: S(684), size: S(16), tracking: S(4), weight: S(1.7) },
    mixColor(C.gold, C.goldBright, 0.3)
  );

  // Top-right caption over the instrument, outside the coordinate ring.
  paintStaticText(
    s,
    'CONVERGENCE',
    { x: S(1860), y: S(84), size: S(14), tracking: S(5), weight: S(1.5), align: 'right' },
    C.smoke
  );

  // Role labels, placed to clear the ring and each other.
  for (const n of ROLES) {
    const size = 17;
    const tracking = 4.2;
    const w = measureText(n.label, { size, tracking });
    const pos = n.place === 'below' ? { x: S(n.x - w / 2), y: S(n.y + 42) } : { x: S(n.x + 22), y: S(n.y + 6) };
    paintStaticText(s, n.label, { ...pos, size: S(size), tracking: S(tracking), weight: S(1.6) }, mixColor(C.smoke, C.goldBright, 0.55));
  }

  // Role nodes: a fixed ring of light. Their brightness is animated; their geometry is not.
  for (const n of ROLES) {
    s.circle(S(n.x), S(n.y), S(9), S(1.4), C.goldBright, 0.7, true);
    s.spark(S(n.x), S(n.y), S(20), C.gold, 0.55, 0.3);
  }

  // The brand mark sits at the core; it is painted before the bloom so it glows.
  paintBrandMark(s, S(HUB.x), S(HUB.y), S(92), S(5.4));
  s.bloom({ threshold: 0.55, radius: 20, intensity: 0.3 });
  return s;
}

/* ── Dynamic instrument ───────────────────────────────────────────────────── */

/**
 * Draw everything that moves. This is the only region of the GIF that changes
 * between frames, so it is kept inside a single 660 px box around the hub.
 */
function drawInstrument(s, T) {
  const A = activation(T);
  const cx = S(HUB.x);
  const cy = S(HUB.y);

  // 1) Outer coordinate ticks rotate one 30° step per loop. The pattern repeats every 30°, so the loop closes.
  const rot = 30 * T;
  for (let i = 0; i < 180; i++) {
    const a = i * 2 + rot;
    const major = i % 15 === 0;
    const r0 = RING.coord - (major ? 16 : 5);
    const [x0, y0] = polar(HUB.x, HUB.y, a, r0);
    const [x1, y1] = polar(HUB.x, HUB.y, a, RING.coord);
    s.segment(S(x0), S(y0), S(x1), S(y1), S(major ? 1.8 : 1.0), major ? C.gold : C.cyan, (major ? 0.9 : 0.4) * A, true);
  }

  // 2) Dashed inner ring counter-rotates one full turn per loop. The 10° pattern divides 360°, so it closes too.
  const dashRot = -360 * T;
  for (let k = 0; k < 36; k++) {
    const from = k * 10 + dashRot;
    s.circle(cx, cy, S(RING.dash), S(2.0), C.goldBright, 0.5 * A, true, from, from + 6);
  }

  // 3) The 45-minute dial. The sweep arm turns once per loop, clockwise.
  const sweep = 90 - 360 * T;
  // Trail first, behind the head.
  for (let k = 0; k < 56; k++) {
    const a = sweep + k * 2;
    const alpha = 0.55 * (1 - k / 56) ** 2.4 * A;
    const [x0, y0] = polar(HUB.x, HUB.y, a, RING.mid + 2);
    const [x1, y1] = polar(HUB.x, HUB.y, a, RING.dialIn - 3);
    s.segment(S(x0), S(y0), S(x1), S(y1), S(3.2), C.gold, alpha, true);
  }
  // Ticks light as the head passes, then fade out behind it.
  for (let m = 0; m < 45; m++) {
    const tickAngle = 90 - 8 * m;
    const behind = wrapDeg(tickAngle - sweep);
    const lit = Math.exp(-behind / 22);
    const major = m % 5 === 0;
    const [x0, y0] = polar(HUB.x, HUB.y, tickAngle, major ? RING.dialIn - 8 : RING.dialIn);
    const [x1, y1] = polar(HUB.x, HUB.y, tickAngle, RING.dialOut);
    s.segment(S(x0), S(y0), S(x1), S(y1), S(major ? 2.2 : 1.6), C.goldBright, 0.12 + 0.88 * lit, true);
  }
  // Head.
  const [hx0, hy0] = polar(HUB.x, HUB.y, sweep, RING.mid - 4);
  const [hx1, hy1] = polar(HUB.x, HUB.y, sweep, RING.dialOut + 6);
  s.segment(S(hx0), S(hy0), S(hx1), S(hy1), S(2.6), C.filament, 0.95, true);
  const [tipX, tipY] = polar(HUB.x, HUB.y, sweep, RING.dialOut);
  s.spark(S(tipX), S(tipY), S(16), C.goldBright, 0.55 * A, 0.3);

  // 4) Matching orbit: light moves from Visionary toward each complementary role.
  for (const arc of MATCH_ARCS) {
    const span = Math.abs(arc.to - arc.from);
    for (let u = 0; u < span; u += 1.5) {
      const a = arc.from + arc.dir * u;
      const along = u * RING.roles * DEG;
      // Ten dash periods per loop: an integer, so the flow closes on itself.
      const phase = wrap01(along / 46 - 10 * T);
      if (phase > 0.34) continue;
      const fade = 1 - smoothstep(0.24, 0.34, phase);
      const [x0, y0] = polar(HUB.x, HUB.y, a, RING.roles);
      const [x1, y1] = polar(HUB.x, HUB.y, a + arc.dir * 1.5, RING.roles);
      s.segment(S(x0), S(y0), S(x1), S(y1), S(3.0), C.goldBright, 0.95 * fade * A, true);
    }
  }

  // 5) Role nodes breathe, three cycles per loop, each out of phase.
  for (const n of ROLES) {
    const breath = 0.5 + 0.5 * Math.sin(TAU * (3 * T + n.i / 3));
    s.spark(S(n.x), S(n.y), S(44), C.gold, (0.1 + 0.12 * breath) * A, 0.12);
    s.spark(S(n.x), S(n.y), S(10), C.goldBright, 0.35 + 0.35 * breath, 0.35);
  }

  // 6) Convergence packets travel node → core along each filament.
  for (const n of ROLES) {
    const pts = convergenceCurve(n);
    const last = pts.length - 1;
    for (let k = 0; k < 3; k++) {
      const departure = k / 3 + n.i / 9;
      const dt = wrap01(T - departure);
      if (dt >= PACKET_TRAVEL) continue;
      const p = dt / PACKET_TRAVEL;
      const fade = smoothstep(0.0, 0.08, p) * (1 - smoothstep(0.88, 1.0, p));
      if (fade <= 0.01) continue;
      const head = Math.min(last, Math.floor(p * last));
      // Tail: fading sparks behind the head.
      for (let t = 0; t < 9; t++) {
        const idx = head - t * 2;
        if (idx < 0) break;
        const [x, y] = pts[idx];
        s.spark(S(x), S(y), S(7 - t * 0.5), C.filament, (0.5 - t * 0.05) * fade * A, 0.3);
      }
      const [hx, hy] = pts[head];
      s.spark(S(hx), S(hy), S(9), C.filament, 0.9 * fade, 0.35);
    }
  }

  // 7) Core: arrivals flare the mark. Between arrivals, the brand rests at its activation level.
  const F = coreFlare(T);
  s.addRadial(cx, cy, S(70 + 26 * F), C.goldBright, (0.09 + 0.2 * F) * A, 2.4);
  s.spark(cx, cy, S(24 + 8 * F), C.goldBright, (0.2 + 0.5 * F) * A, 0.3);
}

/* ── Frame loop ───────────────────────────────────────────────────────────── */

function renderHero() {
  const started = Date.now();
  const outDir = resolvePath(HERE, String(argv.out ?? '.'));
  mkdirSync(outDir, { recursive: true });

  process.stdout.write(`  hero: composing ${FRAMES} frames at ${W}×${H} (${SS}× supersampled)…\n`);
  const backdrop = buildBackdrop(SCENE);
  const work = new Surface(W * SS, H * SS);

  const rgbFrames = [];
  for (let i = 0; i < FRAMES; i++) {
    work.copyFrom(backdrop);
    drawInstrument(work, i / FRAMES);
    rgbFrames.push(resolve(work, SS));
    if ((i + 1) % 30 === 0 || i === FRAMES - 1) {
      process.stdout.write(`    frame ${String(i + 1).padStart(3)}/${FRAMES}\n`);
    }
  }

  process.stdout.write('  quantising…\n');
  const { table, size } = buildPalette(rgbFrames, { pinned: PINNED, sampleStride: 2 });
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

  const gifPath = resolvePath(outDir, 'urlife-hero.gif');
  writeFileSync(gifPath, buffer);

  const posterIndex = Math.min(FRAMES - 1, Math.max(0, Number(argv.poster ?? Math.round(FRAMES * 0.36))));
  const png = encodePNGFromRGB(rgbFrames[posterIndex], W, H);
  const pngPath = resolvePath(outDir, 'urlife-hero-poster.png');
  writeFileSync(pngPath, png);

  const moved = ((stats.changedPx / stats.totalPx) * 100).toFixed(1);
  process.stdout.write(
    `  ${(buffer.length / 1024).toFixed(1)} kB  urlife-hero.gif  ` +
      `(${FRAMES} frames · ${(FRAMES * DELAY_CS) / 100}s loop · ${size} colours · ${moved}% of pixels re-encoded)\n` +
      `  ${(png.length / 1024).toFixed(1)} kB  urlife-hero-poster.png  (frame ${posterIndex})\n` +
      `  ${((Date.now() - started) / 1000).toFixed(1)}s\n`
  );
}

/* ── Luminous divider ─────────────────────────────────────────────────────── */

function renderDivider() {
  const DW = 1920;
  const DH = 16;
  const frames = 72;
  const outDir = resolvePath(HERE, String(argv.out ?? '.'));
  mkdirSync(outDir, { recursive: true });

  const base = new Surface(DW, DH);
  base.paint(() => C.bottom);
  // Hairline: fades at both ends, so the divider has no hard edges.
  const hairY = 8;
  for (let x = 0; x < DW; x++) {
    const u = x / (DW - 1);
    const a = 0.34 * smoothstep(0, 0.14, u) * (1 - smoothstep(0.86, 1, u));
    const i = (hairY * DW + x) * 3;
    base.data[i] += C.gold[0] * a;
    base.data[i + 1] += C.gold[1] * a;
    base.data[i + 2] += C.gold[2] * a;
  }
  // Four structural nodes on the hairline.
  const nodes = [0.2, 0.4, 0.6, 0.8];
  const rgbFrames = [];
  const work = new Surface(DW, DH);
  for (let f = 0; f < frames; f++) {
    const T = f / frames;
    work.copyFrom(base);
    // A packet travels left to right and lights each node as it passes.
    for (let x = 0; x < DW; x++) {
      const u = x / DW;
      const d = wrapSigned(u - T);
      const head = Math.exp(-(d * d) / (2 * 0.0105 * 0.0105));
      const tail = d < 0 ? Math.exp(d / 0.04) * 0.5 : 0;
      const k = (head + tail) * 0.85;
      const i = (hairY * DW + x) * 3;
      work.data[i] += C.goldBright[0] * k;
      work.data[i + 1] += C.goldBright[1] * k;
      work.data[i + 2] += C.goldBright[2] * k;
    }
    for (const nx of nodes) {
      const pass = gauss(wrapSigned(T - nx), 0.02);
      work.spark(nx * DW, hairY, 5, C.goldBright, 0.12 + 0.6 * pass, 0.3);
      work.segment(nx * DW - 4, hairY, nx * DW + 4, hairY, 1, C.filament, 0.4 + 0.6 * pass, true);
      work.segment(nx * DW, hairY - 4, nx * DW, hairY + 4, 1, C.filament, 0.25 + 0.5 * pass, true);
    }
    rgbFrames.push(resolve(work, 1));
  }
  const { table, size } = buildPalette(rgbFrames, { pinned: PINNED, sampleStride: 2 });
  const nearest = createMapper(table, size);
  const indexed = rgbFrames.map((f) => quantizeFrame(f, DW, DH, nearest, DITHER));
  const { buffer } = encodeAnimatedGIF({ width: DW, height: DH, palette: table, frames: indexed, delayCs: 5, loop: 0 });
  writeFileSync(resolvePath(outDir, 'divider.gif'), buffer);
  process.stdout.write(`  ${(buffer.length / 1024).toFixed(1)} kB  divider.gif  (${frames} frames · ${(frames * 5) / 100}s loop)\n`);
}

/* ── Closing signature ────────────────────────────────────────────────────── */

function renderSignature() {
  const SW = 1200;
  const SH = 300;
  const frames = 48;
  const outDir = resolvePath(HERE, String(argv.out ?? '.'));
  mkdirSync(outDir, { recursive: true });

  const opts = { size: S(84), tracking: S(22), weight: S(9.5) };
  const word = 'YASLOGIST';
  const wordW = measureText(word, { size: 84, tracking: 22 });
  const x0 = SW / 2 - wordW / 2;

  const base = new Surface(SW * SS, SH * SS);
  base.paint((x, y) => mixColor(C.top, C.bottom, smoothstep(0, SH * SS * 0.9, y)));
  base.addRadial(S(SW / 2), S(SH / 2), S(560), C.gold, 0.022, 2.4);
  // Rule above the wordmark.
  base.segment(S(SW / 2 - 40), S(72), S(SW / 2 + 40), S(72), S(2.2), C.gold, 1.0);
  // The wordmark, lettered from geometry, with a bone-to-warm gradient.
  const mask = new Mask(SW * SS, SH * SS);
  mask.text(layoutText(word, { x: S(x0), y: S(190), ...opts }));
  paintMask(base, mask, (x, y) => mixColor(C.filament, C.bone, smoothstep(S(96), S(200), y)), { additive: false });
  // Address line.
  paintStaticText(
    base,
    'WWW.YASLOGIST.COM',
    { x: S(SW / 2), y: S(246), size: S(16), tracking: S(6), weight: S(1.7), align: 'center' },
    mixColor(C.gold, C.goldBright, 0.3)
  );

  const work = new Surface(SW * SS, SH * SS);
  const rgbFrames = [];
  for (let f = 0; f < frames; f++) {
    const T = f / frames;
    work.copyFrom(base);
    // Sheen: a narrow band sweeps across the wordmark once per loop, from outside to outside.
    const span = wordW + 260;
    const sx = x0 - 130 + span * T;
    paintMask(
      work,
      mask,
      (x, y) => {
        const d = x / SS - sx;
        const k = Math.exp(-(d * d) / 1800);
        if (k < 0.01) return null;
        return [C.goldBright[0] * k * 1.1, C.goldBright[1] * k, C.goldBright[2] * k * 0.6];
      },
      { additive: true }
    );
    rgbFrames.push(resolve(work, SS));
  }
  const { table, size } = buildPalette(rgbFrames, { pinned: PINNED, sampleStride: 2 });
  const nearest = createMapper(table, size);
  const indexed = rgbFrames.map((f) => quantizeFrame(f, SW, SH, nearest, DITHER));
  const { buffer } = encodeAnimatedGIF({ width: SW, height: SH, palette: table, frames: indexed, delayCs: 6, loop: 0 });
  writeFileSync(resolvePath(outDir, 'yaslogist-signature.gif'), buffer);
  const png = encodePNGFromRGB(rgbFrames[0], SW, SH);
  writeFileSync(resolvePath(outDir, 'yaslogist-signature.png'), png);
  process.stdout.write(
    `  ${(buffer.length / 1024).toFixed(1)} kB  yaslogist-signature.gif  (${frames} frames · ${(frames * 6) / 100}s loop)\n` +
      `  ${(png.length / 1024).toFixed(1)} kB  yaslogist-signature.png\n`
  );
}

/* ── Entry ────────────────────────────────────────────────────────────────── */

const only = argv.only ?? 'all';
if (only === 'all' || only === 'hero') renderHero();
if (only === 'all' || only === 'divider') renderDivider();
if (only === 'all' || only === 'signature') renderSignature();
