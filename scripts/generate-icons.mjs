/**
 * generate-icons.mjs — produces every PWA / favicon asset from code.
 *
 * WHY THIS EXISTS
 * `manifest.json` used to point its only icon at
 *   https://via.placeholder.com/512/02040a/c8942a?text=UL
 * That is a third-party request for the app's own identity. It (a) fails
 * entirely offline, which is the one situation a PWA icon matters most,
 * (b) is blocked by the page's own `img-src` policy intent, (c) sends every
 * install to a tracker-capable third party, and (d) the placeholder service
 * is not a durable dependency. It also used the OLD brand gold (#c8942a)
 * rather than the canonical #D4AF37.
 *
 * Everything is now generated locally, deterministically, with zero
 * dependencies: a tiny supersampled SDF rasteriser plus Node's own `zlib` to
 * emit valid PNGs.
 *
 * The PNG encoder and the palette live in `scripts/lib/` because
 * `generate-og.mjs` needs both, and two copies of a brand colour is how a
 * brand drifts. The Open Graph card is no longer produced here — see
 * `npm run og`.
 *
 * Usage:  node scripts/generate-icons.mjs
 * Output: public/icons/*.png, public/icons/favicon.svg
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RGB } from './lib/brand.mjs';
import { encodePNG } from './lib/png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/icons');

/* ── brand tokens (single source of truth: scripts/lib/brand.mjs) ── */
const { obsidian: OBSIDIAN, gold: GOLD, goldBright: GOLD_BRIGHT, ember: FIRE } = RGB;

/* ── signed distance helpers (all in normalised 0..1 space) ──────────────── */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function sdRoundedRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

function sdSegment(x, y, ax, ay, bx, by, thickness) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay));
  return Math.hypot(pax - bax * h, pay - bay * h) - thickness;
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Paint one pixel of the mark.
 * @param {number} u 0..1 horizontal
 * @param {number} v 0..1 vertical
 * @param {boolean} maskable when true the art is inset to survive the 40% safe-zone crop
 * @returns {[number,number,number,number]} rgba 0..255
 */
function shade(u, v, maskable) {
  const inset = maskable ? 0.78 : 1;
  // Re-map so the artwork occupies the central `inset` fraction.
  const x = 0.5 + (u - 0.5) / inset;
  const y = 0.5 + (v - 0.5) / inset;

  // Background plate: full-bleed for maskable, rounded square otherwise.
  let rgb = OBSIDIAN;
  let alpha = 1;
  if (!maskable) {
    const plate = sdRoundedRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.22);
    alpha = clamp01(0.5 - plate * 160);
    if (alpha <= 0) return [0, 0, 0, 0];
  }

  // Subtle vertical lift so the plate is not flat black.
  rgb = mix(rgb, [0x16, 0x14, 0x10], clamp01(1 - y) * 0.55);

  // Outer gold ring.
  const ring = Math.abs(sdCircle(x, y, 0.5, 0.5, 0.385)) - 0.021;
  const ringA = clamp01(0.5 - ring * 170);
  rgb = mix(rgb, mix(GOLD, GOLD_BRIGHT, clamp01(1 - y)), ringA);

  // The ✘ mark: two strokes, gold and fire, matching the wordmark lockup.
  const s1 = sdSegment(x, y, 0.33, 0.33, 0.67, 0.67, 0.038);
  const s2 = sdSegment(x, y, 0.67, 0.33, 0.33, 0.67, 0.038);
  rgb = mix(rgb, GOLD_BRIGHT, clamp01(0.5 - s1 * 170));
  rgb = mix(rgb, mix(FIRE, GOLD, 0.25), clamp01(0.5 - s2 * 170) * 0.92);

  // Centre node.
  rgb = mix(rgb, [0xff, 0xf4, 0xd0], clamp01(0.5 - sdCircle(x, y, 0.5, 0.5, 0.045) * 190));

  return [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]), Math.round(alpha * 255)];
}

function renderIcon(size, maskable = false, samples = 3) {
  const data = new Uint8Array(size * size * 4);
  const inv = 1 / samples;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (px + (sx + 0.5) * inv) / size;
          const v = (py + (sy + 0.5) * inv) / size;
          const c = shade(u, v, maskable);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const n = samples * samples;
      const o = (py * size + px) * 4;
      data[o] = a > 0 ? Math.round(r / a) : 0;
      data[o + 1] = a > 0 ? Math.round(g / a) : 0;
      data[o + 2] = a > 0 ? Math.round(b / a) : 0;
      data[o + 3] = Math.round(a / n);
    }
  }
  return encodePNG(data, size, size);
}

/* ── vector assets ───────────────────────────────────────────────────────── */

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="UR LF x UP">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F4D77A"/><stop offset="1" stop-color="#D4AF37"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="#0B0B0B"/>
  <circle cx="32" cy="32" r="24.5" fill="none" stroke="url(#g)" stroke-width="2.7"/>
  <path d="M21 21 L43 43" stroke="#F4D77A" stroke-width="5" stroke-linecap="round"/>
  <path d="M43 21 L21 43" stroke="#E04A2A" stroke-width="5" stroke-linecap="round"/>
  <circle cx="32" cy="32" r="3.1" fill="#FFF4D0"/>
</svg>
`;

/* ── main ────────────────────────────────────────────────────────────────── */

mkdirSync(OUT, { recursive: true });

const written = [];
function write(path, data) {
  writeFileSync(path, data);
  written.push([path.replace(`${ROOT}/`, ''), data.length]);
}

for (const size of [48, 64, 96, 128, 192, 256, 384, 512]) {
  write(resolve(OUT, `icon-${size}.png`), renderIcon(size, false));
}
for (const size of [192, 512]) {
  write(resolve(OUT, `maskable-${size}.png`), renderIcon(size, true));
}
write(resolve(OUT, 'favicon.svg'), Buffer.from(FAVICON_SVG, 'utf8'));

const total = written.reduce((sum, [, n]) => sum + n, 0);
for (const [path, n] of written) console.log(`${String(n).padStart(8)}  ${path}`);
console.log(`\n${written.length} files · ${(total / 1024).toFixed(1)} kB total`);
