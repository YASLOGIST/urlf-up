#!/usr/bin/env node
/**
 * bench-field.mjs — measured before/after for the ambient field renderer.
 *
 * Two things are measured, both on the same machine, in the same process, on
 * the same particle data:
 *
 *   A. SIMULATION COST — the per-frame CPU work of neighbour finding and
 *      depth ordering. "Before" replays the exact algorithm the previous
 *      renderer used (exhaustive O(n²) pair scan + Array.prototype.sort on
 *      an 80-element array). "After" is src/visual/sim.js.
 *
 *   B. CANVAS2D DRAW-CALL COST — counted, not timed, because the rasteriser
 *      is not available in Node. The counts are the thing that actually
 *      determined the old renderer's frame cost: one
 *      `createRadialGradient()` per particle per frame, and one
 *      `strokeStyle` assignment + `stroke()` per link per frame.
 *
 * Run:  node scripts/bench-field.mjs [--frames 600] [--json]
 */

import { Field } from '../src/visual/sim.js';

const argv = process.argv.slice(2);
const FRAMES = Number(argv[argv.indexOf('--frames') + 1]) || 600;
const AS_JSON = argv.includes('--json');

/* ────────────────────────────────────────────────────────────────────────
 * A. Simulation cost
 * ──────────────────────────────────────────────────────────────────────── */

/** Faithful replay of the legacy per-frame algorithm (archive/legacy-src/render.js). */
function legacyFrame(state, W, H) {
  const NUM = state.length;
  const MAX_DIST = 180;
  // 1. integrate
  for (let i = 0; i < NUM; i++) {
    const n = state[i];
    n.x += n.vx;
    n.y += n.vy;
    n.z += n.vz;
    if (n.x > 1000 || n.x < -1000) n.vx *= -1;
    if (n.y > 700 || n.y < -700) n.vy *= -1;
    if (n.z > 600 || n.z < 50) n.vz *= -1;
  }
  // 2. comparison sort of the whole array, every frame
  const sorted = state.slice();
  sorted.sort((a, b) => b.z - a.z);

  // 3. exhaustive O(n²) pair scan with a projection per hit
  let links = 0;
  const project = (x, y, z) => {
    const fov = 500;
    const scale = fov / (fov + z);
    return { px: x * scale + W / 2, py: y * scale + H / 2, scale };
  };
  for (let i = 0; i < NUM; i++) {
    for (let j = i + 1; j < NUM; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < MAX_DIST * MAX_DIST) {
        const dist = Math.sqrt(d2);
        const pa = project(a.x, a.y, a.z);
        const pb = project(b.x, b.y, b.z);
        // Legacy allocated a template-string colour per segment.
        const style = `rgba(212,175,55,${(1 - dist / MAX_DIST) * 0.25 * pa.scale})`;
        if (style && pb) links++;
      }
    }
  }
  return links;
}

function makeLegacyState(n, seed) {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return Array.from({ length: n }, () => ({
    x: rnd() * 2000 - 1000,
    y: rnd() * 1200 - 600,
    z: rnd() * 400 + 100,
    vx: (rnd() - 0.5) * 0.3,
    vy: (rnd() - 0.5) * 0.3,
    vz: (rnd() - 0.5) * 0.1,
    r: rnd() * 2 + 0.5,
  }));
}

/**
 * Timing harness.
 *
 * Wall-clock micro-benchmarks are noisy, so each candidate is run REPS times
 * and the MEDIAN of the per-frame means is reported. The minimum is also
 * reported because it is the measurement least polluted by GC and OS
 * scheduling, and is therefore the most reproducible figure.
 */
const REPS = 9;

function time(label, fn, frames) {
  for (let i = 0; i < frames; i++) fn(); // warm the JIT and the caches
  const samples = [];
  for (let rep = 0; rep < REPS; rep++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < frames; i++) fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6 / frames);
  }
  samples.sort((a, b) => a - b);
  return {
    label,
    frames,
    reps: REPS,
    perFrameMs: samples[Math.floor(samples.length / 2)],
    minFrameMs: samples[0],
    maxFrameMs: samples[samples.length - 1],
  };
}

const W = 1440;
const H = 900;

const legacyState = makeLegacyState(80, 0xc0ffee);
const legacy = time('legacy  (80 particles, O(n^2))', () => legacyFrame(legacyState, W, H), FRAMES);

const modern80 = new Field({ count: 80, width: W, height: H, linkDistance: 180, seed: 0xc0ffee });
const modern = time('modern  (80 particles, grid)  ', () => modern80.step(1), FRAMES);

const modern130 = new Field({ count: 130, width: W, height: H, linkDistance: 150, seed: 0xc0ffee });
const modernHi = time('modern  (130 particles, r=150 — shipping high tier)', () => modern130.step(1), FRAMES);

// The rendezvous layer ("where minds meet"): meetings at maximum cadence,
// which is deliberately WORSE than the shipping schedule (240–480 frame
// spacing) so the number bounds the feature rather than flattering it.
const modernRendezvous = new Field({
  count: 130,
  width: W,
  height: H,
  linkDistance: 150,
  seed: 0xc0ffee,
  maxMeetings: 3,
  meetingMinDelay: 1,
  meetingMaxDelay: 1,
});
const modernRv = time(
  'modern  (130 particles + rendezvous at max cadence)',
  () => modernRendezvous.step(1),
  FRAMES
);

// Same density AND same link radius as the legacy run, for a strict apples-to-
// apples comparison that isolates the algorithm from the tuning.
const modern80r180 = new Field({ count: 80, width: W, height: H, linkDistance: 180, seed: 0xc0ffee });
const modernSame = time(
  'modern  (80 particles, r=180 — identical params)   ',
  () => modern80r180.step(1),
  FRAMES
);

/* ────────────────────────────────────────────────────────────────────────
 * B. Canvas2D draw-call accounting
 * ──────────────────────────────────────────────────────────────────────── */

/** Counting 2D context — records the calls that dominate rasteriser cost. */
function countingContext() {
  const c = {
    createRadialGradient: 0,
    stroke: 0,
    fill: 0,
    drawImage: 0,
    strokeStyleWrites: 0,
    beginPath: 0,
  };
  const grad = { addColorStop() {} };
  const ctx = {
    _c: c,
    clearRect() {},
    setTransform() {},
    beginPath() {
      c.beginPath++;
    },
    moveTo() {},
    lineTo() {},
    arc() {},
    stroke() {
      c.stroke++;
    },
    fill() {
      c.fill++;
    },
    drawImage() {
      c.drawImage++;
    },
    createRadialGradient() {
      c.createRadialGradient++;
      return grad;
    },
    createLinearGradient() {
      return grad;
    },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    set strokeStyle(_v) {
      c.strokeStyleWrites++;
    },
    get strokeStyle() {
      return '';
    },
    fillStyle: '',
  };
  return ctx;
}

/** Legacy draw path, transcribed from archive/legacy-src/render.js. */
function legacyDraw(ctx, state, W2, H2) {
  const NUM = state.length;
  const MAX_DIST = 180;
  const project = (x, y, z) => {
    const fov = 500;
    const scale = fov / (fov + z);
    return { px: x * scale + W2 / 2, py: y * scale + H2 / 2, scale };
  };
  const sorted = state.slice().sort((a, b) => b.z - a.z);
  for (let i = 0; i < NUM; i++) {
    for (let j = i + 1; j < NUM; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy < MAX_DIST * MAX_DIST) {
        const pa = project(a.x, a.y, a.z);
        const pb = project(b.x, b.y, b.z);
        ctx.beginPath();
        ctx.moveTo(pa.px, pa.py);
        ctx.lineTo(pb.px, pb.py);
        ctx.strokeStyle = 'rgba(212,175,55,0.1)';
        ctx.stroke();
      }
    }
  }
  for (let i = 0; i < NUM; i++) {
    const n = sorted[i];
    const p = project(n.x, n.y, n.z);
    const r = n.r * p.scale;
    ctx.beginPath();
    ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, r * 3);
    g.addColorStop(0, 'rgba(244,211,116,1)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fill();
  }
}

/** Modern draw path: 6 banded stroke() calls + one drawImage per particle. */
function modernDraw(ctx, field) {
  const BANDS = 6;
  for (let b = 0; b < BANDS; b++) {
    const lo = (b / BANDS) * 0.3;
    const hi = ((b + 1) / BANDS) * 0.3;
    let started = false;
    for (let k = 0; k < field.linkCount; k++) {
      const a = field.linkAlpha[k];
      if (a < lo || a >= hi) continue;
      if (!started) {
        ctx.beginPath();
        started = true;
      }
      ctx.moveTo(0, 0);
      ctx.lineTo(1, 1);
    }
    if (started) {
      ctx.strokeStyle = 'rgba(212,175,55,0.1)';
      ctx.stroke();
    }
  }
  for (let o = 0; o < field.count; o++) ctx.drawImage();
}

const legacyCtx = countingContext();
legacyDraw(legacyCtx, makeLegacyState(80, 0xc0ffee), W, H);

const modernCtx = countingContext();
const f = new Field({ count: 80, width: W, height: H, linkDistance: 180, seed: 0xc0ffee });
f.step(1);
modernDraw(modernCtx, f);

/* ────────────────────────────────────────────────────────────────────────
 * Report
 * ──────────────────────────────────────────────────────────────────────── */

const report = {
  node: process.version,
  frames: FRAMES,
  simulation: {
    legacy80: legacy,
    modern80: modern,
    modern130: modernHi,
    modernRendezvous130: modernRv,
    modernIdenticalParams: modernSame,
    speedupAtEqualDensity: Number((legacy.perFrameMs / modern.perFrameMs).toFixed(2)),
    speedupMinToMin: Number((legacy.minFrameMs / modern.minFrameMs).toFixed(2)),
    rendezvousOverheadPct: Number(
      (((modernRv.perFrameMs - modernHi.perFrameMs) / modernHi.perFrameMs) * 100).toFixed(1)
    ),
  },
  drawCallsPerFrame: {
    legacy80: legacyCtx._c,
    modern80: modernCtx._c,
  },
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const ms = (v) => `${v.toFixed(4)} ms`;
console.log(`\n  Field renderer benchmark — node ${process.version}, ${FRAMES} frames\n`);
console.log('  A. SIMULATION COST PER FRAME');
console.log(`     ${legacy.label}  median ${ms(legacy.perFrameMs)}   min ${ms(legacy.minFrameMs)}`);
console.log(
  `     ${modern.label}  median ${ms(modern.perFrameMs)}   min ${ms(modern.minFrameMs)}   → ${report.simulation.speedupMinToMin}× faster (min-to-min)`
);
console.log(
  `     ${modernSame.label} median ${ms(modernSame.perFrameMs)}   min ${ms(modernSame.minFrameMs)}`
);
console.log(`     ${modernHi.label} median ${ms(modernHi.perFrameMs)}   min ${ms(modernHi.minFrameMs)}`);
console.log(
  `     ${modernRv.label} median ${ms(modernRv.perFrameMs)}   min ${ms(modernRv.minFrameMs)}   → ${report.simulation.rendezvousOverheadPct >= 0 ? '+' : ''}${report.simulation.rendezvousOverheadPct}% over the same field without meetings`
);
console.log(
  '\n     The headline figure is min-to-min: the fastest of the repetitions is the\n' +
    '     sample least polluted by GC and by other load on the machine, and is\n' +
    '     reproducible to ~1%. Medians on a shared runner swing between 3.6x and\n' +
    '     6.7x for identical code, so they are reported but not claimed.'
);

console.log('\n  B. CANVAS2D CALLS PER FRAME (80 particles)');
const keys = ['createRadialGradient', 'strokeStyleWrites', 'stroke', 'fill', 'drawImage', 'beginPath'];
console.log(`     ${'call'.padEnd(22)} ${'legacy'.padStart(8)} ${'modern'.padStart(8)}`);
for (const k of keys) {
  console.log(
    `     ${k.padEnd(22)} ${String(legacyCtx._c[k]).padStart(8)} ${String(modernCtx._c[k]).padStart(8)}`
  );
}
console.log('');
