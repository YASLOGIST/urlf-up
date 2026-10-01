import { Header } from './components/Header.js';
import { Hero } from './components/Hero.js';
import { Dashboard } from './components/Dashboard.js';
import { Process } from './components/Process.js';
import { Roles } from './components/Roles.js';
import { Meeting } from './components/Meeting.js';
import { Revenue } from './components/Revenue.js';
import { AI } from './components/AI.js';
import { Roadmap } from './components/Roadmap.js';
import { Manifesto } from './components/Manifesto.js';
import { TechStack } from './components/TechStack.js';
import { Footer } from './components/Footer.js';
import { Modals } from './components/Modals.js';

export function renderApp() {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    ${Header()}
    ${Hero()}
    ${Dashboard()}
    <div class="divline"></div>
    ${Process()}
    <div class="divline"></div>
    ${Roles()}
    <div class="divline"></div>
    ${Meeting()}
    <div class="divline"></div>
    ${Revenue()}
    <div class="divline"></div>
    ${AI()}
    <div class="divline"></div>
    ${Roadmap()}
    ${Manifesto()}
    ${TechStack()}
    ${Footer()}
    ${Modals()}
  `;
}

// ── 2.1 SINGLETON GUARD — Canvas & WebGL Context ──
let _renderer = null;
let _canvas = null;
let W, H;

export function getRenderer(canvas) {
  if (_renderer) return _renderer;
  _canvas = canvas || document.getElementById('canvas3d');
  if (!_canvas) return null;
  _renderer = _canvas.getContext('2d');
  return _renderer;
}

// ── 2.2 RAF LOOP CONTROL ──
let _rafId = null;
let _isRunning = false;
let nodes = [];
const NUM = 80, MAX_DIST = 180;

// ── 2.3 FRAME RATE LIMITER ──
// Cap at ~60 FPS to prevent the loop from burning every frame on a 120/144Hz display.
// Mac fans spin when WebGL/canvas paints faster than the display can present.
const TARGET_FPS = 60;
const FRAME_BUDGET_MS = 1000 / TARGET_FPS;  // ≈ 16.67ms
let _lastFrameTime = 0;

// Pre-allocated sort buffer — eliminates a 80-element array allocation every frame
const sorted = new Array(NUM);

function initNodes() {
  if (nodes.length > 0) return; 
  for(let i=0; i<NUM; i++){
    nodes.push({
      x: Math.random()*2000-1000,
      y: Math.random()*1200-600,
      z: Math.random()*400+100,
      vx: (Math.random()-.5)*.3,
      vy: (Math.random()-.5)*.3,
      vz: (Math.random()-.5)*.1,
      r: Math.random()*2+.5
    });
  }
}

export function resizeCanvas() {
  if (!_canvas) return;
  W = _canvas.width = window.innerWidth;
  H = _canvas.height = window.innerHeight;
}

function project(x, y, z) {
  const fov = 500, scale = fov / (fov + z);
  return { px: x * scale + W / 2, py: y * scale + H / 2, scale };
}

// Pure physics and drawing tick — no DOM reads
function renderFrame() {
  if (!_renderer) return;
  _renderer.clearRect(0, 0, W, H);

  for (let i = 0; i < NUM; i++) {
    const n = nodes[i];
    n.x += n.vx;
    n.y += n.vy;
    n.z += n.vz;
    if (n.x > 1000 || n.x < -1000) n.vx *= -1;
    if (n.y > 700 || n.y < -700) n.vy *= -1;
    if (n.z > 600 || n.z < 50) n.vz *= -1;
  }

  // Reuse pre-allocated buffer — avoids a 80-element heap allocation per frame
  for (let i = 0; i < NUM; i++) sorted[i] = nodes[i];
  sorted.sort((a,b) => b.z - a.z);

  for (let i = 0; i < NUM; i++) {
    for (let j = i + 1; j < NUM; j++) {
      const a = sorted[i], b = sorted[j];
      const dx = a.x - b.x, dy = a.y - b.y;
      const dist2 = dx*dx + dy*dy;
      if (dist2 < MAX_DIST * MAX_DIST) {
        const dist = Math.sqrt(dist2);
        const pa = project(a.x, a.y, a.z);
        const pb = project(b.x, b.y, b.z);
        const alpha = (1 - dist / MAX_DIST) * 0.25 * pa.scale;
        _renderer.beginPath();
        _renderer.moveTo(pa.px, pa.py);
        _renderer.lineTo(pb.px, pb.py);
        _renderer.strokeStyle = `rgba(212,175,55,${alpha})`;
        _renderer.lineWidth = 0.5;
        _renderer.stroke();
      }
    }
  }

  for (let i = 0; i < NUM; i++) {
    const n = sorted[i];
    const p = project(n.x, n.y, n.z);
    const r = n.r * p.scale;
    _renderer.beginPath();
    _renderer.arc(p.px, p.py, r, 0, Math.PI * 2);
    const g = _renderer.createRadialGradient(p.px, p.py, 0, p.px, p.py, r * 3);
    g.addColorStop(0, `rgba(244,211,116,${0.8*p.scale})`);
    g.addColorStop(1, 'transparent');
    _renderer.fillStyle = g;
    _renderer.fill();
  }
}

export function startLoop() {
  if (_isRunning) return;          // already running — strict no-op
  if (document.visibilityState === 'hidden') return; // never start on a hidden tab
  if (_rafId !== null) {           // cancel any orphaned handle from a dirty stop
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
  _isRunning = true;
  _lastFrameTime = 0;               // reset so first frame always paints
  initNodes();
  resizeCanvas();
  function tick(now) {
    if (!_isRunning) { _rafId = null; return; } // clean exit: release handle
    _rafId = requestAnimationFrame(tick);
    // FPS limiter: only paint when the next frame budget has elapsed.
    // On a 120Hz display this means we skip every other rAF callback, cutting
    // GPU/CPU load roughly in half while leaving the animation buttery-smooth.
    const elapsed = now - _lastFrameTime;
    if (elapsed < FRAME_BUDGET_MS) return;
    // Advance the timestamp by exact budget multiples (drop the leftover) so
    // we don't drift slower than 60 FPS over time.
    _lastFrameTime = now - (elapsed % FRAME_BUDGET_MS);
    renderFrame();
  }
  _rafId = requestAnimationFrame(tick);
}

export function stopLoop() {
  if (_rafId !== null) cancelAnimationFrame(_rafId);
  _isRunning = false;
  _rafId = null;
}

// Pause when tab is hidden or window loses focus — frees main thread and GPU.
// document.visibilityState is the source of truth: 'hidden' covers tab switch,
// window minimize, and screen lock. blur/focus catch alt-tab on Safari where
// visibilitychange can lag.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopLoop();
    else startLoop();
  });
  window.addEventListener('blur',  stopLoop);
  window.addEventListener('focus', () => {
    if (document.visibilityState === 'visible') startLoop();
  });
}