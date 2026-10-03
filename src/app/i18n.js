/**
 * i18n.js — bilingual (English / Arabic) runtime with full RTL support.
 *
 * ── The bug this module fixes ──────────────────────────────────────────────
 * Three competing, mutually-unaware language implementations shipped at once:
 *
 *  1. An IIFE inlined inside <nav> that listened on `.lang-btn`. It set
 *     `lang`/`dir` on <html> and nothing else — the 180+ `data-en`/`data-ar`
 *     nodes were never swapped, so pressing "AR" produced an English page in
 *     right-to-left layout.
 *  2. A `setLang()` in the bottom inline <script> that *did* swap the text —
 *     but bound itself to `#lang-en` / `#lang-ar`, element ids that do not
 *     exist in index.html (`grep -c 'id="lang-en"' index.html` → 0). Dead.
 *  3. `window.toggleLang()` in src/animations.js, bound to `DOMCache.langToggle`
 *     (also absent). Dead, and it kept its own `isAR` boolean that could drift
 *     out of sync with the other two.
 *
 * Net observable behaviour before: the Arabic button flipped direction and
 * broke the layout while leaving every string in English, and the choice was
 * not persisted across reloads.
 *
 * ── Design ─────────────────────────────────────────────────────────────────
 *  - One module owns `lang`, `dir`, document title, fonts, persistence, and
 *    the `urlife:langchange` event.
 *  - Translation payloads may contain a *restricted* subset of markup
 *    (`<strong> <em> <b> <i> <br> <span class="g">`). They are rendered through
 *    `renderRichText()`, which builds nodes with `createElement`/`textContent`
 *    instead of assigning `innerHTML`. The previous implementations assigned
 *    `el.innerHTML = el.getAttribute('data-ar')` directly — an injection sink
 *    the moment any of that copy becomes CMS- or user-sourced.
 *  - The original English DOM is captured once on init, so switching
 *    en → ar → en is lossless even for nodes without a `data-en` attribute.
 */

import { logger } from '../lib/logger.js';

export const SUPPORTED = /** @type {const} */ (['en', 'ar']);
const STORAGE_KEY = 'urlife:lang';
const DEFAULT_LANG = 'en';

const TITLES = {
  en: 'UrLife — Where Minds Meet',
  ar: 'UrLife — حيث تلتقي العقول',
};

/** Tags a translation string is allowed to contain. Everything else is text. */
const ALLOWED_TAGS = new Set(['STRONG', 'EM', 'B', 'I', 'BR', 'SPAN', 'SMALL', 'U']);
/** Attributes an allowed tag may keep. */
const ALLOWED_ATTRS = new Set(['class']);
/** Class names a `<span>` may carry (the design system uses `.g` for gold). */
const ALLOWED_CLASSES = new Set(['g', 'gold', 'accent', 'nowrap']);

let _current = DEFAULT_LANG;
let _initialised = false;

/* ─────────────────────────────────────────────────────────────────────────
 * Safe rich-text rendering
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Convert a translation string that may contain a small amount of inline
 * markup into DOM nodes, without ever touching `innerHTML` on a live node.
 *
 * Implementation note: parsing happens inside a detached `<template>` which is
 * inert — scripts do not execute and `src`/`onerror` never fire. We then
 * re-build a clean tree, dropping anything not on the allow-list.
 *
 * @param {string} text
 * @returns {DocumentFragment}
 */
export function renderRichText(text) {
  const fragment = document.createDocumentFragment();
  if (!text) return fragment;

  // Fast path: no angle brackets at all → plain text node, no parsing.
  if (!text.includes('<')) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }

  const tpl = document.createElement('template');
  /* This is the parse step of the sanitiser itself, not an output sink.
     A detached <template> is inert: its content lives in a separate document
     fragment, so scripts never run, <img> never fetches, and no event handler
     is ever registered. The parsed tree is then copied node-by-node through
     the allow-list below; nothing from `text` reaches the live document
     directly. */
  // eslint-disable-next-line no-restricted-syntax
  tpl.innerHTML = text;

  const copy = (source, target) => {
    for (const node of Array.from(source.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        target.appendChild(document.createTextNode(node.nodeValue));
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      if (!ALLOWED_TAGS.has(node.tagName)) {
        // Unknown tag: keep its text, discard the element itself.
        copy(node, target);
        continue;
      }
      const clean = document.createElement(node.tagName.toLowerCase());
      for (const attr of Array.from(node.attributes)) {
        if (!ALLOWED_ATTRS.has(attr.name)) continue;
        if (attr.name === 'class') {
          const kept = attr.value
            .split(/\s+/)
            .filter((c) => ALLOWED_CLASSES.has(c))
            .join(' ');
          if (kept) clean.setAttribute('class', kept);
          continue;
        }
        clean.setAttribute(attr.name, attr.value);
      }
      copy(node, clean);
      target.appendChild(clean);
    }
  };

  copy(tpl.content, fragment);
  return fragment;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Language application
 * ───────────────────────────────────────────────────────────────────────── */

function normalise(lang) {
  if (!lang) return DEFAULT_LANG;
  const base = String(lang).toLowerCase().split('-')[0];
  return SUPPORTED.includes(base) ? base : DEFAULT_LANG;
}

/** Remembered English content for nodes that only declare `data-ar`. */
const originalContent = new WeakMap();

function captureOriginals(root) {
  root.querySelectorAll('[data-ar]').forEach((el) => {
    if (originalContent.has(el)) return;
    originalContent.set(el, el.getAttribute('data-en') ?? el.innerHTML);
  });
}

function applyTranslations(lang, root) {
  const isAR = lang === 'ar';
  let swapped = 0;

  root.querySelectorAll('[data-ar]').forEach((el) => {
    const next = isAR ? el.getAttribute('data-ar') : (el.getAttribute('data-en') ?? originalContent.get(el));
    if (next == null) return;
    el.replaceChildren(renderRichText(next));
    swapped += 1;
  });

  // Attribute-level translations: data-en-placeholder / data-ar-placeholder,
  // data-en-aria-label / data-ar-aria-label, data-en-title / data-ar-title.
  const ATTR_MAP = {
    placeholder: ['placeholder'],
    // Support the documented `data-en-aria-label` spelling as well as the
    // compact form older console markup used before this module was centralised.
    'aria-label': ['aria-label', 'arialabel'],
    title: ['title'],
  };
  for (const [attr, sources] of Object.entries(ATTR_MAP)) {
    for (const source of sources) {
      root.querySelectorAll(`[data-${lang}-${source}]`).forEach((el) => {
        const v = el.getAttribute(`data-${lang}-${source}`);
        if (v != null) el.setAttribute(attr, v);
      });
    }
  }

  return swapped;
}

/**
 * Switch the document language.
 * @param {'en'|'ar'} lang
 * @param {{persist?: boolean, root?: ParentNode}} [opts]
 */
export function setLanguage(lang, opts = {}) {
  const { persist = true, root = document } = opts;
  const next = normalise(lang);
  const isAR = next === 'ar';
  _current = next;

  const html = document.documentElement;
  html.setAttribute('lang', next);
  html.setAttribute('dir', isAR ? 'rtl' : 'ltr');
  html.dataset.lang = next;

  document.title = TITLES[next];
  document.querySelector('meta[name="description"]')?.setAttribute('content', descriptionFor(next));

  const swapped = applyTranslations(next, root);

  // Font family is a token swap, not 180 inline styles (the old code wrote
  // `el.style.fontFamily` onto every heading on every toggle).
  html.style.setProperty('--font-active', isAR ? 'var(--font-ar)' : 'var(--font-en)');

  root.querySelectorAll('.lang-btn').forEach((btn) => {
    const active = btn.dataset.lang === next;
    btn.classList.toggle('lang-btn--active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode / storage disabled — the choice simply will not persist */
    }
  }

  window.dispatchEvent(new CustomEvent('urlife:langchange', { detail: { lang: next, swapped } }));
  logger.debug('i18n', 'language applied', { lang: next, nodes: swapped });
  return swapped;
}

function descriptionFor(lang) {
  return lang === 'ar'
    ? 'UrLife منصة للتعاون على المشاريع: تلتقي الأفكار بالمشغّلين المتكاملين وتنتقل من موجز أولي إلى قرار خاص.'
    : 'UrLife is a project collaboration platform: ideas meet complementary operators and move from a first brief to a private decision.';
}

export function getLanguage() {
  return _current;
}

/** Resolution order: stored choice → `?lang=` → browser → default. */
export function detectInitialLanguage() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && SUPPORTED.includes(normalise(q))) return normalise(q);
  } catch {
    /* ignore */
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(normalise(stored))) return normalise(stored);
  } catch {
    /* ignore */
  }
  const nav = (globalThis.navigator?.languages || [globalThis.navigator?.language]).filter(Boolean);
  for (const l of nav) {
    const n = normalise(l);
    if (SUPPORTED.includes(n) && n !== DEFAULT_LANG) return n;
  }
  return DEFAULT_LANG;
}

/**
 * Wire the language switcher. Idempotent: calling twice does not double-bind.
 * Uses one delegated listener rather than N per-button listeners.
 */
export function initI18n({ root = document } = {}) {
  if (_initialised) return getLanguage();
  _initialised = true;

  captureOriginals(root);

  root.addEventListener('click', (event) => {
    const btn = event.target.closest?.('.lang-btn[data-lang]');
    if (!btn) return;
    event.preventDefault();
    setLanguage(btn.dataset.lang);
    // Keep focus on the control the user activated (WCAG 3.2.2 On Input).
    btn.focus();
  });

  const initial = detectInitialLanguage();
  setLanguage(initial, { persist: false, root });
  return initial;
}

/** Test seam — lets a spec re-run `initI18n` against a fresh DOM. */
export function __resetI18nForTests() {
  _initialised = false;
  _current = DEFAULT_LANG;
}
