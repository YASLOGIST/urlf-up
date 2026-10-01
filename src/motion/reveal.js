/**
 * reveal.js — scroll-driven entrance animations.
 *
 * Replaces FOUR independent IntersectionObservers that were all running at the
 * same time on overlapping element sets:
 *   - inline <script> in index.html   (`.reveal, .reveal-scale`, threshold .08)
 *   - src/animations.js initAnimations (`.reveal, .reveal-scale`, threshold .08)
 *   - src/scroll-engine.js            (`.reveal-3d`, REPEAT = true)
 *   - src/dashboard.js                (per-card observer)
 *
 * The scroll-engine instance had `REPEAT = true`, so every element it tracked
 * *re-ran its transition each time it left and re-entered the viewport*, and
 * it wrote `transitionDelay` inline onto every child on every intersection.
 * Scrolling up and down a long page therefore replayed the entire page's
 * animation set indefinitely.
 *
 * This implementation:
 *   - one observer, one pass, unobserve-on-reveal (no replay, no churn);
 *   - stagger is expressed as a CSS custom property (`--mo-delay`), so the
 *     delay lives in the style system rather than in imperative inline styles;
 *   - `will-change` is granted at observe time and *released* on
 *     `transitionend`, so we never hold more than a viewport of GPU layers;
 *   - reduced motion / `off` tier short-circuits to "reveal everything now",
 *     which is also what a no-JS visitor sees.
 */

import { prefersReducedMotion, deviceTier } from './prefs.js';
import { logger } from '../lib/logger.js';

const SELECTOR = '[data-reveal]';
/** Legacy class names kept working so index.html needs no sweeping rewrite. */
const LEGACY = ['.reveal', '.reveal-scale', '.reveal-3d'];

let observer = null;

function revealNow(el) {
  el.setAttribute('data-revealed', '');
  // Keep the historical class contract: legacy.css styles `.in` / `.is-revealed`.
  el.classList.add('in', 'is-revealed');
}

function markDone(el) {
  el.setAttribute('data-reveal-done', '');
  el.style.willChange = '';
}

/** Promote legacy class-based nodes to the declarative attribute API. */
function upgradeLegacyNodes(root) {
  for (const sel of LEGACY) {
    root.querySelectorAll(sel).forEach((el) => {
      if (el.hasAttribute('data-reveal')) return;
      el.setAttribute('data-reveal', sel === '.reveal-scale' ? 'scale' : 'rise');
      // index.html ships many of these pre-marked `.in`; that was the old
      // "already revealed" state, so respect it and skip the animation.
      if (el.classList.contains('in')) {
        el.setAttribute('data-revealed', '');
        el.setAttribute('data-reveal-done', '');
      }
    });
  }
}

/**
 * Assign stagger delays to the children of a `[data-stagger]` container.
 * Written once, at observe time, as a CSS variable — not on every frame.
 */
function applyStagger(container) {
  const step = Number.parseInt(container.dataset.stagger ?? '', 10);
  if (!Number.isFinite(step) || step <= 0) return;
  Array.from(container.children).forEach((child, i) => {
    child.style.setProperty('--mo-delay', `${i * step}ms`);
    if (!child.hasAttribute('data-reveal')) child.setAttribute('data-reveal', 'rise-sm');
  });
}

/**
 * @param {{root?: ParentNode, threshold?: number, rootMargin?: string}} [opts]
 * @returns {{observe(el: Element): void, disconnect(): void, count: number}}
 */
export function initReveal(opts = {}) {
  const { root = document, threshold = 0.12, rootMargin = '0px 0px -8% 0px' } = opts;

  upgradeLegacyNodes(root);
  const targets = Array.from(root.querySelectorAll(SELECTOR));

  // Degraded path: show everything immediately. Still correct, just static.
  if (prefersReducedMotion() || deviceTier() === 'off' || typeof IntersectionObserver === 'undefined') {
    targets.forEach((el) => {
      revealNow(el);
      markDone(el);
    });
    logger.debug('reveal', 'static mode', { nodes: targets.length });
    return { observe: revealNow, disconnect() {}, count: targets.length };
  }

  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        revealNow(el);
        observer.unobserve(el); // one-way: no replay on scroll-back
        el.addEventListener('transitionend', () => markDone(el), { once: true });
        // Failsafe: transitionend does not fire if the element was already in
        // its final state (e.g. duration collapsed to 1ms).
        setTimeout(() => markDone(el), 1200);
      }
    },
    { root: null, rootMargin, threshold }
  );

  for (const el of targets) {
    if (el.hasAttribute('data-revealed')) continue;
    applyStagger(el);
    el.style.willChange = 'transform, opacity';
    observer.observe(el);
  }

  logger.debug('reveal', 'observer online', { nodes: targets.length });

  return {
    /** Register a node mounted after init (dashboard cards, idea feed items). */
    observe(el) {
      if (!el || el.hasAttribute('data-revealed')) return;
      if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', 'rise-sm');
      applyStagger(el);
      observer?.observe(el);
    },
    disconnect() {
      observer?.disconnect();
      observer = null;
    },
    count: targets.length,
  };
}
