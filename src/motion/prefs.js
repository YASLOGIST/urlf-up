/**
 * prefs.js — one source of truth for "how much motion may we spend here?".
 *
 * Everything visual asks this module instead of each re-implementing its own
 * `matchMedia` check (previously: scroll-engine.js, animations.js and three
 * separate inline scripts each probed independently and could disagree).
 *
 * Tiers are derived from signals that are cheap, synchronous, and available
 * before first paint — no benchmarking frame-loop that itself costs frames.
 */

const mq = (q) =>
  globalThis.matchMedia ? globalThis.matchMedia(q) : { matches: false, addEventListener() {} };

export const reducedMotionQuery = mq('(prefers-reduced-motion: reduce)');
export const coarsePointerQuery = mq('(pointer: coarse)');
export const finePointerQuery = mq('(hover: hover) and (pointer: fine)');

export function prefersReducedMotion() {
  return reducedMotionQuery.matches === true;
}

export function hasFinePointer() {
  return finePointerQuery.matches === true;
}

/** Honour the Save-Data client hint — users on metered connections opt out. */
export function saveData() {
  return globalThis.navigator?.connection?.saveData === true;
}

/** `true` on 2g/slow-2g effective connection types. */
export function slowConnection() {
  const t = globalThis.navigator?.connection?.effectiveType;
  return t === 'slow-2g' || t === '2g';
}

/**
 * Coarse hardware tier.
 *   'off'  — no decorative animation at all
 *   'low'  — reveals only, no continuous canvas loop
 *   'mid'  — canvas loop at reduced density, DPR capped at 1
 *   'high' — full density, DPR capped at 2
 *
 * Inputs are all free to read: media queries, `deviceMemory`,
 * `hardwareConcurrency`, and the Network Information API.
 */
export function deviceTier() {
  if (prefersReducedMotion() || saveData()) return 'off';
  if (slowConnection()) return 'low';

  const mem = globalThis.navigator?.deviceMemory ?? 8; // GB, Chromium only
  const cores = globalThis.navigator?.hardwareConcurrency ?? 8;

  if (mem <= 2 || cores <= 2) return 'low';
  if (mem <= 4 || cores <= 4) return 'mid';
  return 'high';
}

/** Device-pixel-ratio ceiling. Uncapped DPR on a 3× phone triples fill cost. */
export function maxPixelRatio(tier = deviceTier()) {
  if (tier === 'high') return 2;
  if (tier === 'mid') return 1.5;
  return 1;
}

/**
 * Subscribe to preference changes (OS-level reduced-motion can flip at
 * runtime). Returns an unsubscribe function.
 * @param {(state: {reducedMotion: boolean, tier: string}) => void} fn
 */
export function onPreferenceChange(fn) {
  const handler = () => fn({ reducedMotion: prefersReducedMotion(), tier: deviceTier() });
  reducedMotionQuery.addEventListener?.('change', handler);
  coarsePointerQuery.addEventListener?.('change', handler);
  return () => {
    reducedMotionQuery.removeEventListener?.('change', handler);
    coarsePointerQuery.removeEventListener?.('change', handler);
  };
}
