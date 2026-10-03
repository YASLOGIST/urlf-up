/**
 * navigation.js — responsive primary navigation.
 *
 * The desktop links used to disappear below 1024px because the stylesheet hid
 * `.nav-links` while the hamburger markup had been removed from the document.
 * That left the page's main navigation unavailable to touch and keyboard users.
 *
 * This module keeps the same link set and turns it into an accessible,
 * full-height drawer on narrow viewports. It owns the drawer state, focus-safe
 * Escape handling, scroll locking, and the button's expanded name. No layout
 * or account behaviour belongs here.
 */

const DEFAULT_BREAKPOINT = 1024;
const COPY = {
  en: { open: 'Open navigation', close: 'Close navigation' },
  ar: { open: 'فتح القائمة', close: 'إغلاق القائمة' },
};

function isNarrowViewport(breakpoint) {
  return typeof window !== 'undefined' && window.innerWidth <= breakpoint;
}

function languageCopy(kind) {
  return COPY[document.documentElement.lang === 'ar' ? 'ar' : 'en'][kind];
}

/**
 * @param {{root?: Document, breakpoint?: number}} [options]
 * @returns {{destroy: () => void}}
 */
export function initMobileNavigation({ root = document, breakpoint = DEFAULT_BREAKPOINT } = {}) {
  const button = root.getElementById('nav-menu-btn');
  const links = root.getElementById('primary-links');
  if (!button || !links) return { destroy() {} };

  let narrow = isNarrowViewport(breakpoint);
  let open = false;
  let previousOverflow = '';

  const syncLabel = () => {
    button.setAttribute('aria-label', languageCopy(open ? 'close' : 'open'));
  };

  const syncAvailability = () => {
    links.setAttribute('aria-hidden', String(narrow && !open));
    if ('inert' in links) links.inert = narrow && !open;
    else if (narrow && !open) links.setAttribute('inert', '');
    else links.removeAttribute('inert');
  };

  const setOpen = (next, { focusButton = false } = {}) => {
    open = Boolean(next) && narrow;
    links.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
    syncLabel();
    syncAvailability();

    if (open) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else if (document.body.style.overflow === 'hidden') {
      document.body.style.overflow = previousOverflow;
    }

    if (focusButton) button.focus({ preventScroll: true });
  };

  const onButtonClick = (event) => {
    event.preventDefault();
    setOpen(!open);
  };

  const onLinkClick = () => {
    if (open) setOpen(false);
  };

  const onKeydown = (event) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false, { focusButton: true });
    }
  };

  const onResize = () => {
    const nextNarrow = isNarrowViewport(breakpoint);
    if (nextNarrow === narrow) return;
    narrow = nextNarrow;
    setOpen(false);
    syncAvailability();
  };

  button.addEventListener('click', onButtonClick);
  links.addEventListener('click', onLinkClick);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('urlife:langchange', syncLabel);

  button.dataset.initialized = 'true';
  button.setAttribute('aria-expanded', 'false');
  syncLabel();
  syncAvailability();

  return {
    destroy() {
      button.removeEventListener('click', onButtonClick);
      links.removeEventListener('click', onLinkClick);
      document.removeEventListener('keydown', onKeydown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('urlife:langchange', syncLabel);
      if (open && document.body.style.overflow === 'hidden') document.body.style.overflow = previousOverflow;
      links.classList.remove('is-open');
      links.removeAttribute('aria-hidden');
      links.removeAttribute('inert');
      if ('inert' in links) links.inert = false;
      button.setAttribute('aria-expanded', 'false');
      delete button.dataset.initialized;
    },
  };
}
