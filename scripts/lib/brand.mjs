/**
 * brand.mjs — the single source of truth for every generated brand asset.
 *
 * `scripts/generate-icons.mjs` (PWA icons, favicon) and `scripts/generate-og.mjs`
 * (the animated Open Graph card) both read their palette and their copy from
 * here, so the mark on an Android home screen and the mark in a Slack unfurl
 * can never drift apart. The values mirror `src/styles/legacy.css`.
 */

/** @param {string} hex `#RRGGBB` @returns {[number,number,number]} 0..255 bytes */
export function hexToBytes(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/* ── Palette ─────────────────────────────────────────────────────────────── */

export const BRAND = {
  /** Page black. Deliberately not #000: pure black kills the OLED gradient. */
  obsidian: '#0B0B0B',
  /** The deepest tone in the card, used at the bottom of the backdrop. */
  ink: '#060608',
  /** Canonical gold. The old placeholder icon used #c8942a — a different brand. */
  gold: '#D4AF37',
  goldBright: '#F4D77A',
  goldDeep: '#B8941F',
  /** Accent used for exactly one of the two strokes of the ✘. */
  ember: '#FF1E00',
  emberSoft: '#E04A2A',
  /** Type colours. */
  bone: '#F7F6F3',
  smoke: '#9A9A9A',
  /** The hottest highlight in the system — specular cores only. */
  filament: '#FFF4D0',
};

/** Byte triplets for the rasterisers that predate the hex-string API. */
export const RGB = {
  obsidian: hexToBytes(BRAND.obsidian),
  gold: hexToBytes(BRAND.gold),
  goldBright: hexToBytes(BRAND.goldBright),
  ember: hexToBytes(BRAND.ember),
};

/* ── Copy ────────────────────────────────────────────────────────────────── */

export const COPY = {
  wordmark: 'UR LF \u2718 UP',
  headline: ['WHERE', 'MINDS MEET'],
  sub: ['A PROJECT GENERATION ENGINE.', 'ZERO FINANCIAL BARRIERS \u00B7 100% MERIT-BASED.'],
  roles: ['VISIONARY', 'BUILDER', 'ENABLER'],
  domain: 'URLIFEISUP.COM',
  alt: 'UR LF \u2718 UP — Where Minds Meet. A project generation engine.',
};

/** Open Graph canvas, fixed by the 1.91:1 contract every unfurl assumes. */
export const OG = { width: 1200, height: 630 };
