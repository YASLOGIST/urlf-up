/**
 * debug-overlay.js — live performance HUD, loaded only for `?debug=1`.
 *
 * This exists so the performance claims in docs/VERIFICATION.md are
 * reproducible by anyone on their own hardware rather than taken on trust.
 * It is a dynamic import, so it contributes 0 bytes to the default bundle.
 *
 * Reports: backend in use, instantaneous fps, rolling average frame time,
 * live particle/link counts, and how many times the adaptive governor had to
 * shed density.
 */

export function mountDebugOverlay(field) {
  const box = document.createElement('div');
  box.id = 'urlife-debug';
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, {
    position: 'fixed',
    insetInlineStart: '12px',
    insetBlockEnd: '12px',
    zIndex: '10001',
    padding: '10px 12px',
    borderRadius: '10px',
    background: 'rgba(5,5,5,.86)',
    border: '1px solid rgba(212,175,55,.35)',
    color: '#F4D77A',
    font: '500 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
    pointerEvents: 'none',
    whiteSpace: 'pre',
    minWidth: '190px',
  });
  document.body.appendChild(box);

  let frames = 0;
  let lastSample = performance.now();
  let displayFps = 0;
  let worst = 0;
  let lastFrame = performance.now();

  function loop(now) {
    frames += 1;
    const dt = now - lastFrame;
    lastFrame = now;
    if (dt > worst && frames > 10) worst = dt;

    if (now - lastSample >= 500) {
      displayFps = (frames * 1000) / (now - lastSample);
      frames = 0;
      lastSample = now;
      const s = field.getStats();
      box.textContent = [
        `backend    ${s.mode}`,
        `fps        ${displayFps.toFixed(1)}`,
        `frame avg  ${s.avgFrameMs ?? '—'} ms`,
        `worst      ${worst.toFixed(1)} ms`,
        `particles  ${s.particles}`,
        `links      ${s.links}`,
        `meetings   ${s.meetings ?? 0}${s.meetingsHeld ? ` (held ${s.meetingsHeld})` : ''}`,
        `ripples    ${s.ripples ?? 0}`,
        `camY       ${s.camY ?? 0}`,
        `degrades   ${s.degradations ?? 0}`,
      ].join('\n');
      worst = 0;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return { destroy: () => box.remove() };
}
