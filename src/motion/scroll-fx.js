/**
 * scroll-fx.js — everything that reacts to the scroll position, in ONE
 * passive listener and ONE rAF per frame.
 *
 * ── What was wrong before ──────────────────────────────────────────────────
 * The inline <script> in index.html ran, on every single scroll event with no
 * throttling and no passive flag:
 *
 *     window.addEventListener('scroll', () => {
 *       document.querySelector('nav').style.padding =
 *         window.scrollY > 60 ? '12px 56px' : '18px 56px';
 *     });
 *
 * Three defects in four lines: (1) a `querySelector` per scroll event,
 * (2) a non-passive listener, which tells the browser it may need to block
 * scrolling until JS has run, and (3) an unconditional write of a *layout*
 * property (`padding`) on every event — forcing a reflow of the whole document
 * dozens of times per second. `src/animations.js` then bound a second,
 * rAF-throttled copy of the same logic, so both ran.
 *
 * This module:
 *   - resolves `nav` once;
 *   - animates a composited `--nav-shrink` variable rather than padding;
 *   - writes only when the boolean state actually changes;
 *   - publishes scroll progress as a single custom property for the progress
 *     bar, hero parallax and anything else, so N effects cost one frame.
 */

import { prefersReducedMotion, deviceTier } from './prefs.js';

export function initScrollFx({ root = document } = {}) {
  const nav = root.querySelector('nav');
  const progress = root.querySelector('.scroll-progress');
  const parallaxNodes = Array.from(root.querySelectorAll('[data-parallax]'));
  const reduced = prefersReducedMotion() || deviceTier() === 'off';

  let ticking = false;
  let lastShrunk = null;
  let lastProgress = -1;

  function read() {
    ticking = false;
    const y = window.scrollY || 0;

    // ── nav shrink ────────────────────────────────────────────────────────
    const shrunk = y > 60;
    if (shrunk !== lastShrunk) {
      lastShrunk = shrunk;
      nav?.classList.toggle('is-scrolled', shrunk);
      nav?.style.setProperty('--nav-pad-y', shrunk ? '12px' : '18px');
    }

    // ── progress ──────────────────────────────────────────────────────────
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const p = Math.min(1, Math.max(0, y / max));
    if (Math.abs(p - lastProgress) > 0.001) {
      lastProgress = p;
      document.documentElement.style.setProperty('--scroll-progress', p.toFixed(4));
      progress?.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    }

    // ── parallax (transform-only, capped travel) ──────────────────────────
    if (!reduced) {
      for (const el of parallaxNodes) {
        const speed = Number.parseFloat(el.dataset.parallax || '0.15');
        const offset = Math.max(-80, Math.min(80, -y * speed));
        el.style.setProperty('--parallax-y', `${offset.toFixed(1)}px`);
      }
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(read);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  read();

  return {
    destroy() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    },
  };
}

/**
 * Smooth in-page navigation with correct focus management.
 *
 * The old code bound `a[href^="#"]` in two places and called
 * `scrollIntoView()` without ever moving focus. A keyboard user who activated
 * "How It Works" had the page scroll away underneath them while focus stayed
 * on the link — the next Tab went to the *nav*, not the section (WCAG 2.4.3).
 */
export function initAnchorNavigation({ root = document } = {}) {
  function onClick(event) {
    const link = event.target.closest?.('a[href^="#"]');
    if (!link) return;
    const hash = link.getAttribute('href');
    if (!hash || hash === '#' || hash.length < 2) return;

    let target;
    try {
      target = document.querySelector(hash);
    } catch {
      return; // not a valid selector
    }
    if (!target) return;

    event.preventDefault();
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    target.scrollIntoView({ behavior, block: 'start' });

    // Move focus so assistive tech and the Tab order follow the viewport.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });

    if (location.hash !== hash) history.pushState(null, '', hash);
  }

  root.addEventListener('click', onClick);
  return { destroy: () => root.removeEventListener('click', onClick) };
}
