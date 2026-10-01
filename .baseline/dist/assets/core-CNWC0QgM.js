/**
 * YAS CORE — Global Interaction Engine
 * Zero dead clicks. Zero double-fires. Full telemetry.
 * Single delegator on document — capture phase for max coverage.
 */

const TELEMETRY = (typeof window !== 'undefined' && window.__nexus_track)
  ? window.__nexus_track
  : (event, payload) => {
      // No-op fallback. Wire to PostHog / Plausible later.
      if (location.hostname === 'localhost') {
        console.debug('[YAS:telemetry]', event, payload);
      }
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

  // ── BRANCH 1: Hash links → smooth scroll, update history ──
  if (href && href.startsWith('#') && href.length > 1) {
    const section = document.querySelector(href);
    if (section) {
      e.preventDefault();
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Push state so back-button works
      if (location.hash !== href) {
        history.pushState(null, '', href);
      }
      TELEMETRY('nav_scroll', { to: href, from: label });
      return;
    }
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

    // Orphan button — no module claimed it yet
    e.preventDefault();
    pulseTactile(target);
    TELEMETRY('orphan_click', {
      label,
      id: target.id || null,
      classes: target.className || null,
      ts: Date.now(),
    });

    // Dev-mode log to surface unimplemented modules
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      console.warn(
        `%c[YAS CORE] Orphan click: "${label}" — ` +
        `wire this button to a module via data-action.`,
        'color: #D4AF37; font-weight: 600;'
      );
    }
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

// ── BOOT ──
let booted = false;
function boot() {
  if (booted) return;
  booted = true;

  // Capture phase so we fire BEFORE inline handlers can stopPropagation
  document.addEventListener('click', handleClick, { capture: true });
  document.addEventListener('keydown', handleKeydown);

  // Browser back-button on hash links → smooth scroll
  window.addEventListener('hashchange', () => {
    const section = document.querySelector(location.hash);
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  TELEMETRY('core_online', { ts: Date.now() });
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    console.log(
      '%c[YAS CORE] ⚡ Global Interaction Engine Online',
      'color: #D4AF37; font-weight: 700; font-size: 12px;'
    );
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();  // Already past DOMContentLoaded — boot immediately
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
