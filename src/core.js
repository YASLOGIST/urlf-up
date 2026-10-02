import { logger } from './lib/logger.js';
/**
 * YAS CORE — Global Interaction Engine
 * Zero dead clicks. Zero double-fires. Full telemetry.
 * Single delegator on document — capture phase for max coverage.
 */

const TELEMETRY = (typeof window !== 'undefined' && window.__nexus_track)
  ? window.__nexus_track
  : (event, payload) => {
      // No-op fallback. Wire to PostHog / Plausible later.
      logger.debug('telemetry', event, payload);
    };

const ACTION_DEBOUNCE_MS = 350;
const lastFiredAt = new WeakMap();

function shouldDebounce(target) {
  const now = performance.now();
  const last = lastFiredAt.get(target) || 0;
  if (now - last < ACTION_DEBOUNCE_MS) return true;
  lastFiredAt.set(target, now);
  return false;
}

function pulseTactile(el) {
  if (!el || el.dataset.actionPending === 'true') return;
  el.dataset.actionPending = 'true';
  // Remove after one animation cycle
  el.addEventListener('animationend', () => {
    delete el.dataset.actionPending;
  }, { once: true });
  // Failsafe: clear after 500ms even if animationend never fires
  setTimeout(() => { delete el.dataset.actionPending; }, 500);
}

function identifyTarget(el) {
  return (
    el.dataset.action ||
    el.id ||
    el.getAttribute('aria-label') ||
    el.innerText?.trim().slice(0, 40) ||
    el.tagName.toLowerCase()
  );
}

function isExternalLink(href) {
  if (!href) return false;
  try {
    const url = new URL(href, location.href);
    return url.origin !== location.origin;
  } catch { return false; }
}

function handleClick(e) {
  // Use closest() to handle clicks on child elements (icon inside button)
  const target = e.target.closest(
    'button, a, .btn, [role="button"], [data-action]'
  );
  if (!target) return;

  // Honor explicit opt-out
  if (target.dataset.coreIgnore === 'true') return;

  // Disabled guard — closer to UX than letting CSS pointer-events fail
  if (target.disabled || target.getAttribute('aria-disabled') === 'true') {
    e.preventDefault();
    return;
  }

  const href = target.getAttribute('href');
  const label = identifyTarget(target);

  // ── BRANCH 1: Hash links → navigation module owns scrolling/focus ──
  // Do not call preventDefault here: scroll-fx.js is the single owner of
  // anchor navigation and moves keyboard focus along with the viewport.
  if (href && href.startsWith('#') && href.length > 1) {
    TELEMETRY('nav_scroll', { to: href, from: label });
    return;
  }

  // ── BRANCH 2: External links → let browser handle, just track ──
  if (href && isExternalLink(href)) {
    TELEMETRY('outbound_click', { href, label });
    return;  // No preventDefault — let it navigate
  }

  // ── BRANCH 3: Real internal links (non-hash) → let through ──
  if (href && !href.startsWith('#') && href !== '#') {
    TELEMETRY('internal_nav', { href, label });
    return;
  }

  // ── BRANCH 4: Language toggle → handled by its own module ──
  if (target.classList.contains('lang-btn')) {
    TELEMETRY('lang_toggle_click', { label });
    return;  // /src/rtl.js owns this
  }

  // ── BRANCH 5: Action buttons (no href, or href="#") ──
  //   This is where zero-dead-click guarantee lives.
  if (target.tagName === 'BUTTON' || !href || href === '#') {
    // Debounce double-clicks (prevents accidental double-submits)
    if (shouldDebounce(target)) {
      e.preventDefault();
      return;
    }

    // If button has a registered initializer, let it run
    if (target.dataset.initialized === 'true') {
      // Module owns it. Just emit telemetry, don't preventDefault.
      TELEMETRY('action_click', { label, owned: true });
      return;
    }

    // Orphan control — report it, but never cancel native button semantics.
    // Cancelling here used to prevent submit buttons from dispatching their
    // form's submit event, breaking sign-in, registration and idea creation.
    if (href === '#') e.preventDefault();
    pulseTactile(target);
    TELEMETRY('orphan_click', {
      label,
      id: target.id || null,
      classes: target.className || null,
      ts: Date.now(),
    });

    // Surfaces unimplemented modules. The logger decides whether this is
    // visible (debug in development, suppressed in production) instead of the
    // call site sniffing location.hostname.
    logger.warn('core', 'orphan click — wire this control to a module', {
      label,
      id: target.id || null,
    });
  }
}

function handleKeydown(e) {
  // Space / Enter on focused button-like elements
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = document.activeElement;
  if (!el) return;
  if (el.matches('[role="button"], [data-action]') &&
      !el.matches('button, a, input, textarea, select')) {
    e.preventDefault();
    el.click();  // Triggers our delegator naturally
  }
}

// ── LIFECYCLE ──
let booted = false;

function onHashChange() {
  let section;
  try {
    section = document.querySelector(location.hash);
  } catch {
    return;
  }
  if (!section) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/** Start the global interaction engine. Owned by app/boot.js like every other subsystem. */
export function initCore() {
  if (booted) return { destroy: destroyCore };
  booted = true;

  // Capture phase so telemetry sees interactions even when a component stops propagation.
  document.addEventListener('click', handleClick, { capture: true });
  document.addEventListener('keydown', handleKeydown);
  window.addEventListener('hashchange', onHashChange);

  TELEMETRY('core_online', { ts: Date.now() });
  logger.debug('core', 'global interaction engine online');
  return { destroy: destroyCore };
}

export function destroyCore() {
  if (!booted) return;
  document.removeEventListener('click', handleClick, { capture: true });
  document.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('hashchange', onHashChange);
  booted = false;
}

// Public API for other modules to mark buttons as 'owned'
export function claimButton(el, handler) {
  if (!el) return;
  el.dataset.initialized = 'true';
  if (handler) el.addEventListener('click', handler);
}

export function emitTelemetry(event, payload) {
  TELEMETRY(event, payload);
}
