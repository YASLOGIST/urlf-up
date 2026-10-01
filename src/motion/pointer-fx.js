/**
 * pointer-fx.js — tilt, sheen and magnetic micro-interactions.
 *
 * ── What was wrong before ──────────────────────────────────────────────────
 * Two copies of the tilt effect were bound at once (inline <script> in
 * index.html and `initAnimations()` in src/animations.js), both on
 * `.role-card, .ps, .rev-card`. Each `mousemove` therefore ran twice and
 * wrote `card.style.transform` twice. The inline copy also called
 * `getBoundingClientRect()` *synchronously inside the event handler*, which
 * forces a style+layout flush on every pointer sample — the textbook cause of
 * scroll/hover jank.
 *
 * ── How this version behaves ───────────────────────────────────────────────
 *  - ONE delegated `pointermove` listener on the document, `{passive:true}`.
 *  - Geometry is read once per element, cached, and invalidated by a
 *    ResizeObserver + scroll ticker — never read inside the hot path.
 *  - The handler writes CSS custom properties only (`--tilt-x`, `--tilt-y`,
 *    `--tilt-px`, `--tilt-py`); the transform itself lives in motion.css.
 *    Custom-property writes on a composited element skip layout entirely.
 *  - At most one rAF is scheduled per frame regardless of pointer rate
 *    (a 1000 Hz gaming mouse cannot schedule 1000 callbacks).
 *  - Disabled outright for coarse pointers and reduced-motion users.
 */

import { prefersReducedMotion, hasFinePointer, deviceTier } from './prefs.js';

const MAX_TILT_DEG = 9;
const MAGNET_STRENGTH = 0.28; // fraction of half-size the element may travel
const MAGNET_MAX_PX = 10;

/** @type {WeakMap<Element, DOMRect>} */
const rectCache = new WeakMap();
let cacheEpoch = 0;
/** @type {WeakMap<Element, number>} */
const rectEpoch = new WeakMap();

function rectOf(el) {
  if (rectEpoch.get(el) === cacheEpoch) return rectCache.get(el);
  const r = el.getBoundingClientRect();
  rectCache.set(el, r);
  rectEpoch.set(el, cacheEpoch);
  return r;
}

function invalidate() {
  cacheEpoch += 1;
}

/**
 * @param {{root?: ParentNode, tier?: string}} [options]
 *   `tier` is injectable for the same reason `initField` accepts one: the
 *   hardware probe is a heuristic, and both the debug overlay and the test
 *   suite need to exercise a specific tier deterministically.
 */
export function initPointerFx({ root = document, tier = deviceTier() } = {}) {
  if (prefersReducedMotion() || !hasFinePointer() || tier === 'off' || tier === 'low') {
    return { destroy() {}, enabled: false };
  }

  // Promote the historical class-based cards to the declarative API.
  root.querySelectorAll('.role-card, .ps, .rev-card, .tech-card, .mb-flow').forEach((el) => {
    if (!el.hasAttribute('data-tilt')) el.setAttribute('data-tilt', '');
    // The sheen pseudo-element needs a positioned, clipped box.
    const cs = getComputedStyle(el);
    if (cs.position === 'static') el.style.position = 'relative';
  });
  root
    .querySelectorAll('.btn-primary, .nav-cta, #hero-submit-btn, #cta-submit-btn, #meeting-cta-btn')
    .forEach((el) => el.setAttribute('data-magnetic', ''));

  let pending = false;
  let lastEvent = null;
  /** @type {Element|null} */
  let activeTilt = null;
  /** @type {Set<Element>} */
  const activeMagnets = new Set();

  function frame() {
    pending = false;
    const e = lastEvent;
    if (!e) return;

    // ── tilt ───────────────────────────────────────────────────────────────
    const card = e.target.closest?.('[data-tilt]');
    if (card !== activeTilt && activeTilt) {
      activeTilt.removeAttribute('data-tilt-active');
      activeTilt.style.setProperty('--tilt-x', '0deg');
      activeTilt.style.setProperty('--tilt-y', '0deg');
      activeTilt.style.setProperty('--tilt-lift', '0px');
      activeTilt = null;
    }
    if (card) {
      const r = rectOf(card);
      if (r.width && r.height) {
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--tilt-y', `${(px - 0.5) * 2 * MAX_TILT_DEG}deg`);
        card.style.setProperty('--tilt-x', `${(0.5 - py) * 2 * MAX_TILT_DEG}deg`);
        card.style.setProperty('--tilt-lift', '-6px');
        card.style.setProperty('--tilt-px', `${px * 100}%`);
        card.style.setProperty('--tilt-py', `${py * 100}%`);
        card.setAttribute('data-tilt-active', '');
        activeTilt = card;
      }
    }

    // ── magnetic buttons within a 120px radius ─────────────────────────────
    for (const el of activeMagnets) {
      el.style.setProperty('--mag-x', '0px');
      el.style.setProperty('--mag-y', '0px');
    }
    activeMagnets.clear();

    const near = document.elementsFromPoint?.(e.clientX, e.clientY) ?? [];
    const btn = near.find((n) => n.hasAttribute?.('data-magnetic'));
    if (btn) {
      const r = rectOf(btn);
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const mx = Math.max(-MAGNET_MAX_PX, Math.min(MAGNET_MAX_PX, dx * MAGNET_STRENGTH));
      const my = Math.max(-MAGNET_MAX_PX, Math.min(MAGNET_MAX_PX, dy * MAGNET_STRENGTH));
      btn.style.setProperty('--mag-x', `${mx.toFixed(2)}px`);
      btn.style.setProperty('--mag-y', `${my.toFixed(2)}px`);
      activeMagnets.add(btn);
    }
  }

  function onPointerMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    lastEvent = e;
    if (pending) return;
    pending = true;
    requestAnimationFrame(frame);
  }

  function onPointerLeave() {
    if (activeTilt) {
      activeTilt.removeAttribute('data-tilt-active');
      activeTilt.style.setProperty('--tilt-x', '0deg');
      activeTilt.style.setProperty('--tilt-y', '0deg');
      activeTilt.style.setProperty('--tilt-lift', '0px');
      activeTilt = null;
    }
    for (const el of activeMagnets) {
      el.style.setProperty('--mag-x', '0px');
      el.style.setProperty('--mag-y', '0px');
    }
    activeMagnets.clear();
  }

  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', onPointerLeave, { passive: true });
  window.addEventListener('scroll', invalidate, { passive: true });
  window.addEventListener('resize', invalidate, { passive: true });

  return {
    enabled: true,
    destroy() {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('scroll', invalidate);
      window.removeEventListener('resize', invalidate);
      onPointerLeave();
    },
  };
}
