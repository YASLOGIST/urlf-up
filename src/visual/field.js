/**
 * field.js — orchestrator for the ambient constellation backdrop.
 *
 * Responsibilities, in order of importance:
 *   1. Decide whether to run at all (reduced motion, save-data, tier, no canvas).
 *   2. Pick the cheapest backend that works here: WebGL2 → Canvas2D → nothing.
 *   3. Keep the frame budget. An adaptive governor measures real frame time
 *      and sheds particle density before the page drops below the target.
 *   4. Never burn a frame the user cannot see: paused on tab hide, window
 *      blur, and when the canvas itself scrolls out of view.
 *   5. Tell the story the page exists to tell: the field stages "rendezvous"
 *      events (see sim.js) and dollies with scroll, so the backdrop reads as
 *      a place where minds meet — not as wallpaper.
 *
 * ── Problems in the previous implementation (src/render.js) ────────────────
 *   - `getRenderer()` looked up `#canvas3d`, an element that does not exist in
 *     index.html (`grep -c 'id="canvas3d"' index.html` → 0). The whole engine
 *     was therefore inert in production while still shipping in the bundle.
 *   - The legacy "parachute" <style> block forced `canvas { z-index: -1 }`, so
 *     even if the element had existed it would have painted behind the root
 *     stacking context.
 *   - `window.addEventListener('blur', stopLoop)` with a matching `focus`
 *     handler meant clicking into the devtools permanently stopped the loop if
 *     `visibilityState` never changed.
 *   - No reduced-motion check, no device tier, no DPR cap, no fallback.
 */

import { Field } from './sim.js';
import { createWebGLRenderer } from './renderer-webgl.js';
import { createCanvas2DRenderer } from './renderer-2d.js';
import {
  deviceTier,
  maxPixelRatio,
  prefersReducedMotion,
  hasFinePointer,
  onPreferenceChange,
} from '../motion/prefs.js';
import { logger } from '../lib/logger.js';

/** Particle budget per tier. Chosen so link work stays ~linear on each class. */
const DENSITY = { high: 130, mid: 80, low: 0, off: 0 };
/** Concurrent rendezvous events per tier ("where minds meet"). */
const MEETINGS = { high: 3, mid: 2, low: 0, off: 0 };
const TARGET_FRAME_MS = 1000 / 60;
/** Shed density when the rolling average exceeds this. 60 fps budget + 25%. */
const DEGRADE_FRAME_MS = TARGET_FRAME_MS * 1.25;

export function initField(options = {}) {
  const { canvasId = 'field-canvas', root = document, tier = deviceTier() } = options;

  const canvas = root.getElementById?.(canvasId) ?? document.getElementById(canvasId);
  // WebGL context loss replaces this node with a Canvas2D sibling. Keep the
  // active node authoritative so subsequent resize, preference and lifecycle
  // work never writes to the detached WebGL canvas.
  let activeCanvas = canvas;
  const result = {
    mode: 'none',
    reason: '',
    start() {},
    stop() {},
    destroy() {},
    getStats: () => ({ mode: 'none', running: false, fps: 0, particles: 0, links: 0 }),
  };

  /**
   * Bail out cleanly. The canvas is hidden rather than left as an empty
   * transparent layer, so the pure-CSS `.field-fallback` gradient is the one
   * thing the user sees and the page never looks half-rendered.
   */
  function disable(reason, level = 'debug') {
    result.reason = reason;
    if (activeCanvas) {
      activeCanvas.hidden = true;
      activeCanvas.removeAttribute('data-ready');
    }
    document.documentElement.classList.remove('has-field');
    document.documentElement.classList.add('field-static');
    logger[level]('field', 'disabled', { reason });
    return result;
  }

  if (!canvas) return disable(`#${canvasId} not found`);
  if (prefersReducedMotion()) return disable('prefers-reduced-motion');

  const count = DENSITY[tier] ?? 0;
  if (!count) return disable(`device tier "${tier}"`);

  const dprCap = maxPixelRatio(tier);
  const field = new Field({
    count,
    width: window.innerWidth,
    height: window.innerHeight,
    linkDistance: tier === 'high' ? 150 : 130,
    seed: 0x5eed1234,
    maxMeetings: MEETINGS[tier] ?? 0,
  });

  // ── backend selection ─────────────────────────────────────────────────
  let renderer =
    tier === 'high'
      ? createWebGLRenderer(canvas, field, {
          onError: (msg) => logger.warn('field', 'webgl init failed', { msg }),
          onContextLost: () => {
            logger.warn('field', 'webgl context lost — falling back to canvas2d');
            swapToCanvas2D();
          },
        })
      : null;
  if (!renderer) renderer = createCanvas2DRenderer(canvas, field);

  if (!renderer) return disable('no 2d or webgl2 context', 'warn');

  function swapToCanvas2D() {
    const previousCanvas = activeCanvas;
    try {
      renderer.destroy();
    } catch {
      /* already gone */
    }
    // A canvas cannot change context type; replace the element and make every
    // later lifecycle operation point at the replacement, not the detached
    // WebGL node.
    const replacement = previousCanvas.cloneNode(false);
    previousCanvas.replaceWith(replacement);
    activeCanvas = replacement;
    const next = createCanvas2DRenderer(activeCanvas, field);
    if (next) {
      renderer = next;
      sizeToViewport();
      // The IntersectionObserver still watches the detached element, so it
      // would keep reporting stale visibility without this handoff.
      io?.unobserve(previousCanvas);
      io?.observe(activeCanvas);
    } else {
      disable('canvas2d fallback unavailable', 'warn');
    }
  }

  function sizeToViewport() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(dprCap, window.devicePixelRatio || 1);
    field.resize(w, h);
    renderer.resize(w, h, dpr);
  }

  // ── adaptive governor ─────────────────────────────────────────────────
  let activeCount = field.count;
  let frameAvg = TARGET_FRAME_MS;
  let degradations = 0;

  function governor(frameMs) {
    // Exponential moving average; 0.1 ≈ a 10-frame window.
    frameAvg += (frameMs - frameAvg) * 0.1;
    if (frameAvg > DEGRADE_FRAME_MS && degradations < 3 && activeCount > 24) {
      activeCount = Math.max(24, Math.round(activeCount * 0.7));
      field.count = activeCount;
      degradations += 1;
      frameAvg = TARGET_FRAME_MS;
      logger.info('field', 'density reduced to hold the frame budget', {
        particles: activeCount,
        avgFrameMs: Number(frameAvg.toFixed(2)),
      });
    }
  }

  // ── loop ──────────────────────────────────────────────────────────────
  let rafId = null;
  let running = false;
  let last = 0;
  let fps = 0;
  let inViewport = true;
  let preferencePaused = false;

  function tick(now) {
    if (!running) {
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(tick);

    const delta = last ? now - last : TARGET_FRAME_MS;
    last = now;
    // Clamp: after a tab resume `delta` can be seconds, which would teleport
    // every particle across the screen.
    const dt = Math.min(3, delta / TARGET_FRAME_MS);

    const t0 = performance.now();
    field.step(dt);
    renderer.draw();
    governor(performance.now() - t0);

    fps = delta > 0 ? 1000 / delta : 0;
  }

  function start() {
    if (running || preferencePaused) return;
    if (document.visibilityState === 'hidden' || !inViewport) return;
    running = true;
    last = 0;
    rafId = requestAnimationFrame(tick);
    activeCanvas.hidden = false;
    activeCanvas.setAttribute('data-ready', '');
    document.documentElement.classList.remove('field-static');
    document.documentElement.classList.add('has-field');
  }

  function stop() {
    running = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // ── lifecycle wiring ──────────────────────────────────────────────────
  let resizeRaf = 0;
  function onResize() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      sizeToViewport();
    });
  }

  // Scroll parallax: as the reader descends the page the whole field eases
  // upward, near layers travelling further than far ones (the sim applies
  // the pan in world space, before the perspective divide). One passive
  // listener, at most one write per frame — the sim does the easing.
  let scrollRaf = 0;
  function readScroll() {
    scrollRaf = 0;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    field.setScrollProgress((window.scrollY || 0) / max);
  }
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(readScroll);
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') stop();
    else start();
  }

  // The preference can change while the page is open (for example, an OS
  // accessibility toggle). Stop immediately, reveal the static fallback, and
  // resume only when the user explicitly allows motion again.
  const unsubscribePreferences = onPreferenceChange(({ reducedMotion }) => {
    preferencePaused = reducedMotion;
    if (preferencePaused) {
      stop();
      activeCanvas.hidden = true;
      activeCanvas.removeAttribute('data-ready');
      document.documentElement.classList.remove('has-field');
      document.documentElement.classList.add('field-static');
      return;
    }
    start();
  });

  // Pause when the backdrop scrolls out of view (long pages spend most of
  // their time with the fixed canvas fully covered by content).
  let io = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver(
      ([entry]) => {
        inViewport = entry.isIntersecting;
        if (inViewport) start();
        else stop();
      },
      { threshold: 0 }
    );
    io.observe(canvas);
  }

  // Pointer interaction — fine pointers only, throttled to one write per frame.
  let pointerBound = false;
  function onPointerMove(e) {
    field.pointerX = e.clientX;
    field.pointerY = e.clientY;
    field.pointerStrength = 1;
  }
  function onPointerLeave() {
    field.pointerStrength = 0;
  }
  if (hasFinePointer()) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });
    pointerBound = true;
  }

  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('orientationchange', onResize, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  sizeToViewport();
  readScroll(); // a deep link can land mid-page; start the camera where we are
  start();

  logger.info('field', 'online', {
    backend: renderer.kind,
    tier,
    particles: count,
    dprCap,
    meetings: MEETINGS[tier] ?? 0,
  });

  return {
    mode: renderer.kind,
    reason: '',
    start,
    stop,
    destroy() {
      stop();
      io?.disconnect();
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      if (pointerBound) {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerleave', onPointerLeave);
      }
      unsubscribePreferences();
      renderer.destroy();
      document.documentElement.classList.remove('has-field');
    },
    getStats: () => ({
      mode: renderer.kind,
      running,
      preferencePaused,
      fps: Number(fps.toFixed(1)),
      avgFrameMs: Number(frameAvg.toFixed(2)),
      particles: field.count,
      links: field.linkCount,
      meetings: field.meetingCount,
      meetingsHeld: field.meetingsHeld,
      ripples: field.rippleCount,
      camY: Number(field.camY.toFixed(1)),
      degradations,
    }),
  };
}
