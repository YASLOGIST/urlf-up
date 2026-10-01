// ── dom-cache.js ─────────────────────────────────────────────
// Single source of truth for DOM element refs and per-element cached sizes.
// Populated once on init(); size cache invalidated on resize via ResizeObserver.
//
// WHY: eliminates repeated querySelector/offsetWidth calls from hot paths.
// Use getCardSize() for tilt-card math instead of getBoundingClientRect().

export const DOMCache = {
  nav:        null,
  app:        null,
  canvas3d:   null,
  cur:        null,
  curRing:    null,
  htmlRoot:   null,
  langToggle: null,
  pageWrap:   null,

  // WeakMap<Element, {w, h}> — cleared on resize, populated lazily on access
  _sizes:    null,
  _observer: null,

  init() {
    this.nav        = document.querySelector('nav');
    this.app        = document.getElementById('app');
    this.canvas3d   = document.getElementById('canvas3d');
    this.cur        = document.getElementById('cur');
    this.curRing    = document.getElementById('cur-ring');
    this.htmlRoot   = document.getElementById('html-root');
    this.langToggle = document.getElementById('langToggle');
    this.pageWrap   = document.querySelector('.page-wrap');
    this._sizes     = new WeakMap();

    // Invalidate cached element sizes on any viewport resize
    this._observer  = new ResizeObserver(() => { this._sizes = new WeakMap(); });
    this._observer.observe(document.documentElement);
  },

  // Returns {w, h} for el — reads offsetWidth/Height once, then caches until resize
  getSize(el) {
    let s = this._sizes.get(el);
    if (!s) {
      s = { w: el.offsetWidth, h: el.offsetHeight };
      this._sizes.set(el, s);
    }
    return s;
  },

  // Re-read structural refs after dynamic DOM replacement (e.g. renderApp())
  refresh() {
    this.nav      = document.querySelector('nav');
    this.pageWrap = document.querySelector('.page-wrap');
    this._sizes   = new WeakMap();
  },
};
