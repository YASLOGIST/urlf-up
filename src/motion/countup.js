/**
 * countup.js — odometer animation for statistic numerals.
 *
 * Replaces `animCounter()` from the inline <script>, which was dead code
 * (defined, never called) and, had it been called, would have been wrong:
 *
 *     const t = setInterval(() => { ... }, 16);
 *
 * `setInterval(16)` is not frame-synchronised — it drifts, keeps firing in
 * background tabs, and on a 120 Hz display updates at a different cadence to
 * the compositor. It also had no `clearInterval` on teardown, so navigating
 * away leaked the timer.
 *
 * This version is rAF-driven, eased, viewport-triggered, respects
 * reduced-motion (jumps straight to the final value), and reserves the glyph
 * box up front so the animation contributes exactly 0 to Cumulative Layout
 * Shift.
 */

import { prefersReducedMotion } from './prefs.js';

const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * @param {HTMLElement} el must carry `data-countup="<number>"`
 */
function run(el) {
  const target = Number.parseFloat(el.dataset.countup ?? '');
  if (!Number.isFinite(target)) return;

  const decimals = Number.parseInt(el.dataset.countupDecimals ?? '0', 10) || 0;
  const prefix = el.dataset.countupPrefix ?? '';
  const suffix = el.dataset.countupSuffix ?? '';
  const duration = Number.parseInt(el.dataset.countupDuration ?? '1400', 10);

  const format = (v) =>
    `${prefix}${v.toLocaleString(document.documentElement.lang || 'en', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${suffix}`;

  // Reserve the final width BEFORE animating → no reflow, no CLS.
  el.style.setProperty('--countup-reserve', `${format(target).length}ch`);

  if (prefersReducedMotion() || duration <= 0) {
    el.textContent = format(target);
    el.setAttribute('data-countup-done', '');
    return;
  }

  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    el.textContent = format(target * easeOutExpo(t));
    if (t < 1) requestAnimationFrame(tick);
    else {
      el.textContent = format(target);
      el.setAttribute('data-countup-done', '');
    }
  }
  requestAnimationFrame(tick);
}

/**
 * Observe every `[data-countup]` and fire once when it scrolls into view.
 * @returns {{destroy(): void, count: number}}
 */
export function initCountUp({ root = document } = {}) {
  const nodes = Array.from(root.querySelectorAll('[data-countup]'));
  if (!nodes.length) return { destroy() {}, count: 0 };

  // `aria-live` would announce every intermediate value; instead the final
  // value is the accessible name and the animation is purely visual.
  nodes.forEach((el) => {
    el.setAttribute('aria-hidden', 'false');
    if (!el.hasAttribute('aria-label')) {
      const t = Number.parseFloat(el.dataset.countup ?? '');
      if (Number.isFinite(t)) {
        el.setAttribute(
          'aria-label',
          `${el.dataset.countupPrefix ?? ''}${t}${el.dataset.countupSuffix ?? ''}`
        );
      }
    }
  });

  if (typeof IntersectionObserver === 'undefined') {
    nodes.forEach(run);
    return { destroy() {}, count: nodes.length };
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        run(entry.target);
      }
    },
    { threshold: 0.4 }
  );
  nodes.forEach((el) => io.observe(el));

  return { destroy: () => io.disconnect(), count: nodes.length };
}
