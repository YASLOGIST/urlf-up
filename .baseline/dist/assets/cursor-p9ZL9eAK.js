// ── cursor.js ─────────────────────────────────────────────
// Depends on: #cur (14×14px) and #cur-ring (28×28px) in index.html
//   CSS base: position:fixed; top:0; left:0; will-change:transform
// Called from: main.js boot sequence via initCursor()

const HOVER_SELECTORS = 'a, button, [data-cursor-hover], label, [role="button"]';
// Half-dimensions for centering elements on the pointer via translate3d
const DOT_HALF  = 7;   // #cur is 14×14px
const RING_HALF = 14;  // #cur-ring is 28×28px
const LERP      = 0.12; // ring spring coefficient (0.08 = slow, 0.18 = snappy)

export function initCursor() {
  const cur     = document.getElementById('cur');
  const curRing = document.getElementById('cur-ring');

  // ── DOM Guard ──────────────────────────────────────────
  if (!cur || !curRing) {
    console.warn(
      '[cursor.js] #cur or #cur-ring not found in DOM.\n' +
      'Ensure both elements are the first children of <body> in index.html.\n' +
      'Cursor disabled — all other modules unaffected.'
    );
    return;
  }

  // ── GPU-only movement state ────────────────────────────
  let mx = 0, my = 0; // pointer coords — captured synchronously at event time
  let rx = 0, ry = 0; // ring lerp position
  let queued = false;  // prevents double-scheduling of rAF per frame

  // ── pointermove: capture NOW, schedule at most one rAF ─
  // WHY pointermove over mousemove: fires for mouse, pen, and touch;
  // passive:true eliminates scroll-blocking and the browser's jank warning.
  function onPointerMove(e) {
    mx = e.clientX;
    my = e.clientY;
    if (!queued) {
      queued = true;
      requestAnimationFrame(tick);
    }
  }

  function tick() {
    rx += (mx - rx) * LERP;
    ry += (my - ry) * LERP;

    // translate3d guarantees compositor-layer promotion — zero main-thread paint
    cur.style.transform     = `translate3d(${mx - DOT_HALF}px,${my - DOT_HALF}px,0)`;
    curRing.style.transform = `translate3d(${Math.round(rx) - RING_HALF}px,${Math.round(ry) - RING_HALF}px,0)`;

    // Re-queue only until ring converges — idle frames cost nothing
    const dx = mx - rx, dy = my - ry;
    queued = dx * dx + dy * dy > 0.25; // 0.25 = 0.5px threshold
    if (queued) requestAnimationFrame(tick);
  }

  // ── Named handler refs — required for removeEventListener ─
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  function onDown() { cur.classList.add('is-clicking'); }
  function onUp()   { cur.classList.remove('is-clicking'); }
  document.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('pointerup',   onUp,   { passive: true });

  function onOver(e) {
    if (e.target.closest(HOVER_SELECTORS)) {
      cur.classList.add('cursor--hover');     // triggers CSS glow on #cur
      curRing.classList.add('is-hovered');
    }
  }
  function onOut(e) {
    if (e.target.closest(HOVER_SELECTORS)) {
      cur.classList.remove('cursor--hover');
      curRing.classList.remove('is-hovered');
    }
  }
  // mouseover/out intentionally kept (not pointermove) — needed for delegated hover
  document.addEventListener('mouseover', onOver, { passive: true });
  document.addEventListener('mouseout',  onOut,  { passive: true });

  function onLeave() {
    cur.classList.add('is-hidden');
    curRing.classList.add('is-hidden');
  }
  function onEnter() {
    cur.classList.remove('is-hidden');
    curRing.classList.remove('is-hidden');
  }
  document.addEventListener('mouseleave', onLeave, { passive: true });
  document.addEventListener('mouseenter', onEnter, { passive: true });

  // ── Cleanup export (for SPA route changes or teardown) ─
  return function destroyCursor() {
    window.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointerup',   onUp);
    document.removeEventListener('mouseover',   onOver);
    document.removeEventListener('mouseout',    onOut);
    document.removeEventListener('mouseleave',  onLeave);
    document.removeEventListener('mouseenter',  onEnter);
    cur.classList.remove('is-clicking', 'cursor--hover', 'is-hidden');
    curRing.classList.remove('is-hovered', 'is-hidden');
  };
}

// ── Dummy exports for backward compatibility ──
export function promoteCursorTo() {}
export function restoreCursorRoot() {}
