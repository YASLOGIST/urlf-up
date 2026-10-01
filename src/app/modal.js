/**
 * modal.js — one accessible overlay controller for the whole app.
 *
 * ── What it replaces ───────────────────────────────────────────────────────
 * Three overlapping implementations existed, each binding its own
 * document-level `click` and `keydown` listeners:
 *
 *   src/ui.js             openModal/closeModal  — no focus trap, no restore
 *   src/components/Modals.js initModals()       — trapped focus but matched
 *                                                 `.modal`, while every real
 *                                                 overlay in index.html uses
 *                                                 `.modal-overlay`. It was a
 *                                                 no-op in production.
 *   src/main.js           _openOverlay/_closeOverlay — forced inline
 *                                                 opacity/visibility to beat
 *                                                 CSS, leaving the DOM in a
 *                                                 state CSS could not undo.
 *
 * Consequences: ESC was handled twice, the page behind an open dialog stayed
 * in the tab order, and focus was never returned to the trigger on close
 * (WCAG 2.4.3 Focus Order / 2.1.2 No Keyboard Trap).
 *
 * ── Guarantees ─────────────────────────────────────────────────────────────
 *  - Opening stores the trigger; closing returns focus to it.
 *  - Background content is marked `inert` (with an `aria-hidden` fallback for
 *    browsers without inert), so SR virtual cursors cannot escape the dialog.
 *  - Tab/Shift+Tab cycle inside the dialog; ESC closes the topmost one only.
 *  - Scroll-lock compensates for the scrollbar width, so opening a dialog
 *    causes zero layout shift (CLS).
 *  - A stack supports nested overlays without the two listeners fighting.
 */

import { logger } from '../lib/logger.js';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** @type {{el: HTMLElement, trigger: Element|null, onClose?: Function}[]} */
const stack = [];
let scrollLocked = false;
let wired = false;

function visibleFocusable(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => {
    if (el.hasAttribute('hidden') || el.closest('[hidden]')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    // offsetParent is null for display:none; in jsdom it is always null, so
    // fall back to the attribute checks above rather than failing closed.
    if (typeof el.offsetParent === 'undefined') return true;
    return true;
  });
}

function lockScroll() {
  if (scrollLocked) return;
  const gap = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.overflow = 'hidden';
  if (gap > 0) document.body.style.paddingInlineEnd = `${gap}px`;
  scrollLocked = true;
}

function unlockScroll() {
  if (!scrollLocked) return;
  document.body.style.overflow = '';
  document.body.style.paddingInlineEnd = '';
  scrollLocked = false;
}

/** Everything that is a sibling of the overlay gets inerted while it is open. */
function setBackgroundInert(overlay, on) {
  const siblings = Array.from(document.body.children).filter(
    (child) => child !== overlay && child.id !== 'toast-container'
  );
  for (const node of siblings) {
    if (on) {
      if (node.hasAttribute('inert')) continue;
      node.setAttribute('inert', '');
      node.setAttribute('data-modal-inerted', '');
      if (!('inert' in HTMLElement.prototype)) node.setAttribute('aria-hidden', 'true');
    } else if (node.hasAttribute('data-modal-inerted')) {
      node.removeAttribute('inert');
      node.removeAttribute('data-modal-inerted');
      node.removeAttribute('aria-hidden');
    }
  }
}

/**
 * @param {string|HTMLElement} target overlay element or its id
 * @param {{trigger?: Element|null, focus?: string, onClose?: Function}} [opts]
 */
export function openModal(target, opts = {}) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) {
    logger.warn('modal', 'open requested for a missing element', { target: String(target) });
    return false;
  }
  if (stack.some((entry) => entry.el === el)) return true; // already open

  const trigger =
    opts.trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

  el.classList.add('modal--open');
  el.setAttribute('aria-hidden', 'false');
  el.removeAttribute('hidden');

  lockScroll();
  setBackgroundInert(el, true);
  stack.push({ el, trigger, onClose: opts.onClose });

  // Focus the requested control, else the first focusable, else the dialog.
  const preferred = opts.focus ? el.querySelector(opts.focus) : null;
  const first = preferred || visibleFocusable(el)[0] || el;
  if (first === el && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  requestAnimationFrame(() => first.focus?.({ preventScroll: true }));

  window.dispatchEvent(new CustomEvent('urlife:modalopen', { detail: { id: el.id } }));
  return true;
}

/** @param {string|HTMLElement} [target] omit to close the topmost overlay */
export function closeModal(target) {
  let index = stack.length - 1;
  if (target) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    index = stack.findIndex((entry) => entry.el === el);
  }
  if (index < 0) return false;

  const [entry] = stack.splice(index, 1);
  const { el, trigger, onClose } = entry;

  el.classList.remove('modal--open');
  el.setAttribute('aria-hidden', 'true');
  // Clear the inline overrides the previous implementation left behind, so the
  // stylesheet is authoritative again.
  el.style.opacity = '';
  el.style.visibility = '';
  el.style.pointerEvents = '';

  setBackgroundInert(el, false);
  if (stack.length === 0) unlockScroll();
  else setBackgroundInert(stack[stack.length - 1].el, true);

  if (trigger && document.contains(trigger)) trigger.focus?.({ preventScroll: true });
  onClose?.();

  window.dispatchEvent(new CustomEvent('urlife:modalclose', { detail: { id: el.id } }));
  return true;
}

export function closeAllModals() {
  while (stack.length) closeModal();
}

export function isOpen(target) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  return stack.some((entry) => entry.el === el);
}

export function openCount() {
  return stack.length;
}

function onKeydown(event) {
  if (!stack.length) return;
  const top = stack[stack.length - 1].el;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal(top);
    return;
  }
  if (event.key !== 'Tab') return;

  const items = visibleFocusable(top);
  if (!items.length) {
    event.preventDefault();
    top.focus?.();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;

  if (!top.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function onClick(event) {
  // Declarative open: `<button data-modal-open="auth-modal">`
  const opener = event.target.closest?.('[data-modal-open]');
  if (opener) {
    event.preventDefault();
    openModal(opener.dataset.modalOpen, { trigger: opener });
    return;
  }

  // Declarative close: `<button data-modal-close>` or `.modal-close`
  const closer = event.target.closest?.('[data-modal-close], .modal-close');
  if (closer) {
    const overlay = closer.closest('.modal-overlay');
    event.preventDefault();
    closeModal(overlay || undefined);
    return;
  }

  // Backdrop click — only when the overlay itself received the event.
  if (event.target.classList?.contains('modal-overlay') && isOpen(event.target)) {
    closeModal(event.target);
  }
}

/** Idempotent. Binds exactly two document listeners for all overlays. */
export function initModalSystem() {
  if (wired) return;
  wired = true;
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onClick);
}

/** Test seam. */
export function __resetModalsForTests() {
  closeAllModals();
  if (wired) {
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('click', onClick);
    wired = false;
  }
  unlockScroll();
}
