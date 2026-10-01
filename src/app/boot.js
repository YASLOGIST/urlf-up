/**
 * boot.js — the single, ordered startup sequence.
 *
 * ── What it replaces ───────────────────────────────────────────────────────
 * index.html used to load EIGHT separate `<script type="module">` entry
 * points (main, dashboard, core, icons, cursor, scroll-engine, settings,
 * avatar). Each had its own `DOMContentLoaded` guard and its own idea of what
 * had already been initialised, which is how the page ended up with four
 * IntersectionObservers, three language switchers, two tilt handlers and two
 * Supabase clients. Module execution order between eight independent entries
 * is also not guaranteed, which produced the race the old
 * `purgeDuplicates()` + `MutationObserver` hack was written to paper over.
 *
 * There is now ONE entry (`src/main.js` → this file) with an explicit order.
 * Every step is wrapped in `guard()` so a failure in one subsystem degrades
 * that subsystem only.
 *
 * ── Order and why ──────────────────────────────────────────────────────────
 *  1. `.js` class + error reporting  — before anything can throw.
 *  2. i18n                           — text must be correct before it is revealed.
 *  3. modal system                   — two document listeners, needed by every CTA.
 *  4. reveal / scroll / countup      — layout-affecting, must run before paint settles.
 *  5. pointer fx + cursor            — pointer-only, cheap, non-blocking.
 *  6. ambient field                  — the only continuous loop; starts last.
 *  7. account (dynamic import)       — network-dependent, deferred off the critical path.
 */

import { logger } from '../lib/logger.js';
import { guard, guardAsync, initErrorReporting } from './errors.js';
import { initI18n } from './i18n.js';
import { initModalSystem } from './modal.js';
import { initNetworkStatus, reportBackendConfig } from './network.js';
import { initReveal } from '../motion/reveal.js';
import { initScrollFx, initAnchorNavigation } from '../motion/scroll-fx.js';
import { initCountUp } from '../motion/countup.js';
import { initPointerFx } from '../motion/pointer-fx.js';
import { initField } from '../visual/field.js';
import { deviceTier, hasFinePointer, prefersReducedMotion } from '../motion/prefs.js';
import { IS_DEV } from '../lib/env.js';

/** Resolved once boot has finished; exposed for tests and the debug overlay. */
export const ready = {
  /** @type {null | Record<string, unknown>} */
  value: null,
};

/**
 * Teardown registry.
 *
 * Boot attaches a handful of long-lived document listeners. Nothing in the
 * browser ever needs to remove them, but two situations do:
 *   - Vite HMR, which re-evaluates the entry and would otherwise stack a
 *     second set of capture-phase listeners on every save;
 *   - the test suite, where jsdom's `document` is shared across specs in a
 *     file, so leaked listeners from one boot fire during the next.
 * Rather than special-casing tests, boot is simply made idempotent.
 */
let booted = false;
/** @type {Array<() => void>} */
const teardowns = [];

function listen(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  teardowns.push(() => target.removeEventListener(type, handler, options));
}

/** Undo everything `boot()` attached. Safe to call when boot never ran. */
export function teardownBoot() {
  while (teardowns.length) {
    try {
      teardowns.pop()();
    } catch {
      /* a failing teardown must not block the rest */
    }
  }
  booted = false;
  ready.value = null;
}

/** @internal test-only alias, kept name-consistent with the other modules. */
export const __resetBootForTests = teardownBoot;

function isMagicLinkCallback() {
  const { hash, search } = window.location;
  return (
    hash.includes('access_token') ||
    search.includes('token_hash') ||
    search.includes('type=magiclink') ||
    search.includes('code=')
  );
}

/**
 * `requestIdleCallback` with a setTimeout fallback for Safari.
 * Returns a canceller so the scheduled work can be dropped on teardown —
 * otherwise an idle callback registered by a torn-down boot still fires.
 */
function onIdle(fn, timeout = 2500) {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(fn, { timeout });
    return () => cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(fn, 400);
  return () => clearTimeout(handle);
}

export async function boot() {
  if (booted) {
    logger.warn('boot', 'boot() called twice — ignoring the second call');
    return ready.value;
  }
  booted = true;
  const t0 = performance.now();
  const html = document.documentElement;

  // 1 ── environment flags ────────────────────────────────────────────────
  html.classList.add('js');
  html.classList.toggle('has-custom-cursor', hasFinePointer() && !prefersReducedMotion());
  html.dataset.tier = deviceTier();

  guard('errors', initErrorReporting);
  guard('network', initNetworkStatus);
  guard('env-report', () => reportBackendConfig({ dev: IS_DEV }));

  // 2 ── language ─────────────────────────────────────────────────────────
  guard('i18n', initI18n);

  // 3 ── overlays ─────────────────────────────────────────────────────────
  guard('modals', initModalSystem);

  // 4 ── scroll-driven motion ─────────────────────────────────────────────
  const reveal = guard('reveal', initReveal);
  guard('scroll-fx', initScrollFx);
  guard('anchors', initAnchorNavigation);
  guard('countup', initCountUp);

  // 5 ── pointer-driven motion ────────────────────────────────────────────
  guard('pointer-fx', initPointerFx);
  await guardAsync('cursor', async () => {
    if (!hasFinePointer() || prefersReducedMotion()) return;
    const { initCursor } = await import('../cursor.js');
    initCursor();
  });

  // 6 ── ambient backdrop (the only continuous rAF loop) ──────────────────
  const field = guard('field', () => initField());
  if (field) teardowns.push(() => field.destroy?.());

  // 7 ── account surface ──────────────────────────────────────────────────
  // Eager when a magic-link token is present (the token must be consumed
  // before it expires), otherwise on first intent or at idle.
  let accountPromise = null;
  const loadAccount = () => {
    accountPromise ||= guardAsync('account', async () => {
      const mod = await import('./account.js');
      return mod.initAccount();
    });
    return accountPromise;
  };

  if (isMagicLinkCallback()) {
    await loadAccount();
  } else {
    const intentSelector =
      '#hero-submit-btn, #cta-submit-btn, #nav-join-btn, #nav-meeting-btn, ' +
      '#meeting-cta-btn, #nav-settings-btn, #nav-logout-btn, #auth-modal, #idea-modal';
    const onIntent = (event) => {
      if (!event.target.closest?.(intentSelector)) return;
      loadAccount();
    };
    // `pointerdown`/`focusin` fire before `click`, so the module is already in
    // flight by the time the click handler inside it is registered. The click
    // itself is replayed below.
    listen(document, 'pointerdown', onIntent, { passive: true, capture: true });
    listen(document, 'focusin', onIntent, { passive: true, capture: true });
    listen(
      document,
      'click',
      async (event) => {
        const hit = event.target.closest?.(intentSelector);
        if (!hit || hit.dataset.initialized === 'true') return;
        event.preventDefault();
        await loadAccount();
        hit.click(); // replay now that the real handler exists
      },
      { capture: true }
    );
    teardowns.push(onIdle(loadAccount));
  }

  const bootMs = Number((performance.now() - t0).toFixed(1));
  ready.value = {
    bootMs,
    tier: html.dataset.tier,
    field: field?.mode ?? 'none',
    fieldReason: field?.reason ?? '',
    revealCount: reveal?.count ?? 0,
  };
  logger.info('boot', 'ready', ready.value);
  window.dispatchEvent(new CustomEvent('urlife:ready', { detail: ready.value }));

  // Debug overlay: `?debug=1` prints live field stats. Never shipped on by default.
  if (field && new URLSearchParams(location.search).has('debug')) {
    const { mountDebugOverlay } = await import('./debug-overlay.js');
    mountDebugOverlay(field);
  }

  return ready.value;
}
