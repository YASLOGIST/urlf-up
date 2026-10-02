#!/usr/bin/env node
/**
 * render-preview.mjs — software preview of the ambient field (dev tool).
 *
 * NOT a browser: this rasterises the exact sim frame data with a CPU model of
 * the shaders (additive premultiplied glow, depth-graded tint, flare → ember)
 * so the composition can be inspected on machines with no WebGL. It is a
 * close cousin of renderer-webgl.js, not a substitute for it.
 *
 * Usage: node scripts/render-preview.mjs out.png [frames] [pointer]
 */

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { Field } from '../src/visual/sim.js';

const W = 1280;
const H = 800;

/* ── minimal PNG encoder (truecolour, 8-bit) ────────────────────────────── */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writePNG(path, rgb, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    rgb.copy
      ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
      : raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

/* ── the frame: sim data → additive pixels ──────────────────────────────── */
const NEAR = [244, 215, 122];
const FAR = [135, 107, 43];
const FLARE = [255, 122, 69];
const LINK = [212, 175, 55];

function render(field, path, { scrollProgress = 0, pointer = null, settle = 30 } = {}) {
  if (scrollProgress) field.setScrollProgress(scrollProgress);
  for (let i = 0; i < settle; i++) field.step(1); // settle camera/flare
  if (pointer) {
    field.pointerX = pointer[0];
    field.pointerY = pointer[1];
    field.pointerStrength = 1;
    field.step(1);
  }
  const px = new Float32Array(W * H * 3); // linear-ish accumulation
  const add = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    px[o] += r;
    px[o + 1] += g;
    px[o + 2] += b;
  };
  const addGlow = (cx, cy, radius, tint, strength) => {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(W - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(H - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const rr = Math.sqrt(d2) / radius; // 0..1
        const core = 1 - rr;
        const glow = core * core * core + core * core * 0.22;
        const a = Math.min(1, glow * strength);
        add(x, y, tint[0] * a, tint[1] * a, tint[2] * a);
      }
    }
  };
  const drawLine = (x0, y0, x1, y1, a) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      add(
        Math.round(x0 + (x1 - x0) * t),
        Math.round(y0 + (y1 - y0) * t),
        LINK[0] * a,
        LINK[1] * a,
        LINK[2] * a
      );
    }
  };

  // links (with the flare + wake boosts the sim computed)
  for (let k = 0; k < field.linkCount; k++) {
    const i = field.linkA[k];
    const j = field.linkB[k];
    const a = field.linkAlpha[k];
    drawLine(field.px[i], field.py[i], field.px[j], field.py[j], a);
  }
  // ripples
  for (let r = 0; r < field.rippleCount; r++) {
    const steps = 96;
    for (let s = 0; s < steps; s++) {
      const a0 = (s / steps) * Math.PI * 2;
      const a1 = ((s + 1) / steps) * Math.PI * 2;
      drawLine(
        field.rippleX[r] + Math.cos(a0) * field.rippleR[r],
        field.rippleY[r] + Math.sin(a0) * field.rippleR[r],
        field.rippleX[r] + Math.cos(a1) * field.rippleR[r],
        field.rippleY[r] + Math.sin(a1) * field.rippleR[r],
        field.rippleA[r]
      );
    }
  }
  // particles: depth-graded tint, flare → ember, sized like the shaders
  for (let p = 0; p < field.count; p++) {
    const i = field.order[p];
    const s = field.scale[i];
    const fl = field.flare[i];
    const warm = Math.max(0, Math.min(1, (s - 0.5) / 0.4));
    const tint = [
      FAR[0] + (NEAR[0] - FAR[0]) * warm + (FLARE[0] - NEAR[0]) * fl * 0.85,
      FAR[1] + (NEAR[1] - FAR[1]) * warm + (FLARE[1] - NEAR[1]) * fl * 0.85,
      FAR[2] + (NEAR[2] - FAR[2]) * warm + (FLARE[2] - NEAR[2]) * fl * 0.85,
    ];
    const size = Math.max(2, field.r[i] * s * 9) * (1 + fl * 0.9);
    const alpha = Math.min(1, (0.22 + s * 0.85) * (1 + fl * 1.2));
    addGlow(field.px[i], field.py[i], size, tint, alpha);
  }

  // tone-map: Reinhard on LUMA, scaling RGB by the same factor so hue
  // ratios survive (the shaders emit tint*alpha directly; only the preview
  // needs a tone-map at all, and it must not lie about colour).
  const rgb = Buffer.alloc(W * H * 3);
  const bg = 11; // obsidian, added AFTER gamma so black stays black
  for (let o = 0; o < W * H * 3; o += 3) {
    const r = px[o];
    const g = px[o + 1];
    const b = px[o + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (l <= 0) {
      rgb[o] = rgb[o + 1] = rgb[o + 2] = bg;
      continue;
    }
    const mapped = l / 255 / (1 + l / 255); // Reinhard on luma
    const scale = Math.pow(mapped, 1 / 2.2) * (255 - bg); // sRGB encode
    for (let c = 0; c < 3; c++) {
      rgb[o + c] = Math.max(bg, Math.min(255, Math.round((px[o + c] / l) * scale + bg)));
    }
  }
  writePNG(path, rgb, W, H);
  console.log(path, field.stats());
}

/* ── scenes ──────────────────────────────────────────────────────────────── */
const out = process.argv[2] ?? '/tmp/field.png';
const frames = Number(process.argv[3] ?? 0);

// Scene: settle, then a meeting in approach, then contact.
const f = new Field({
  count: 130,
  width: W,
  height: H,
  linkDistance: 150,
  seed: 0x5eed1234,
  maxMeetings: 3,
  meetingMinDelay: 1,
  meetingMaxDelay: 1,
});

if (frames === 0) {
  // (1) plain field, no meetings yet
  for (let i = 0; i < 120; i++) f.step(1);
  render(f, out.replace(/\.png$/, '-calm.png'));
  // (2) mid-approach
  for (let i = 0; i < 200; i++) f.step(1);
  render(f, out.replace(/\.png$/, '-approach.png'));
  // (3) keep going until a contact frame: flare + ripple alive — capture
  // WITHOUT settling so the flare is at peak, not decayed.
  let guard = 0;
  while (guard++ < 400 && !(f.rippleCount > 0 && f.flare.some((v) => v > 0.4))) f.step(1);
  render(f, out.replace(/\.png$/, '-contact.png'), { pointer: [W * 0.3, H * 0.45], settle: 0 });
  // (4) scrolled: parallax engaged
  render(f, out.replace(/\.png$/, '-scrolled.png'), { scrollProgress: 1 });
} else {
  for (let i = 0; i < frames; i++) f.step(1);
  render(f, out);
}
