/**
 * tests/setup.js — jsdom shims for browser APIs the app legitimately uses but
 * jsdom does not implement.
 *
 * Every shim here is a *faithful minimum*: it mimics the contract the real API
 * guarantees, nothing more. Nothing in `src/` is modified to accommodate the
 * test environment.
 */

import { beforeEach, vi } from 'vitest';

/* ── matchMedia ──────────────────────────────────────────────────────────── */
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    media: query,
    // Default to "no preference / fine pointer / desktop" so the full-motion
    // path is the one exercised; specs override per-case.
    matches: /pointer:\s*fine|hover:\s*hover/.test(query),
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
}

/* ── rAF / rIC ───────────────────────────────────────────────────────────── */
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
if (!globalThis.requestIdleCallback) {
  globalThis.requestIdleCallback = (cb) =>
    setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 8 }), 0);
  globalThis.cancelIdleCallback = (id) => clearTimeout(id);
}

/* ── IntersectionObserver ────────────────────────────────────────────────── */
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    constructor(cb, options) {
      this.cb = cb;
      this.options = options;
      this.elements = new Set();
      /** Targets the subject stopped observing — proves one-shot behaviour. */
      this.unobserved = [];
      this.disconnected = false;
      // Expose instances so a spec can drive intersections deterministically.
      globalThis.__IO_INSTANCES__.push(this);
    }
    observe(el) {
      this.elements.add(el);
    }
    unobserve(el) {
      this.unobserved.push(el);
      this.elements.delete(el);
    }
    disconnect() {
      this.disconnected = true;
      this.elements.clear();
    }
    /** Test helper: pretend everything currently observed entered the viewport. */
    triggerAll(isIntersecting = true) {
      const entries = [...this.elements].map((target) => ({
        target,
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
      }));
      if (entries.length) this.cb(entries, this);
    }
  };
}
globalThis.__IO_INSTANCES__ = [];

/* ── ResizeObserver ──────────────────────────────────────────────────────── */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/* ── Canvas: jsdom returns null from getContext without the `canvas` pkg ─── */
if (!HTMLCanvasElement.prototype.getContext.__patched) {
  const stubGradient = () => ({ addColorStop() {} });
  const ctx2d = () => ({
    canvas: null,
    setTransform() {},
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    stroke() {},
    fill() {},
    drawImage() {},
    createRadialGradient: stubGradient,
    createLinearGradient: stubGradient,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
  });
  const patched = function getContext(type) {
    // Only Canvas2D is emulated. WebGL2 returns null, which is exactly the
    // signal the field orchestrator uses to fall back — so the fallback chain
    // is genuinely exercised by the suite rather than mocked away.
    return type === '2d' ? ctx2d() : null;
  };
  patched.__patched = true;
  HTMLCanvasElement.prototype.getContext = patched;
}

/* ── misc ────────────────────────────────────────────────────────────────── */
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!globalThis.performance?.now) globalThis.performance = { now: () => Date.now() };
if (!document.elementsFromPoint) document.elementsFromPoint = () => [];

beforeEach(() => {
  globalThis.__IO_INSTANCES__.length = 0;
  vi.restoreAllMocks();
});

/* ── Keep the suite output readable ───────────────────────────────────────
 * The structured logger defaults to `debug` when it cannot prove it is in
 * production. Tests assert behaviour, not log output, so silence it unless
 * VERBOSE=1 is set. */
import { logger } from '../src/lib/logger.js';
logger.setLevel(process.env.VERBOSE ? 'debug' : 'silent');
