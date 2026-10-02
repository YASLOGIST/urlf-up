/**
 * sim.js — the particle simulation behind the ambient "constellation" field.
 *
 * Deliberately pure and renderer-agnostic: it owns typed-array state and a
 * uniform spatial hash, and knows nothing about canvas, WebGL or the DOM.
 * That makes it unit-testable AND benchmarkable in plain Node, which is how
 * the before/after numbers in docs/VERIFICATION.md were produced.
 *
 * ── Why it was rewritten ───────────────────────────────────────────────────
 * The previous implementation (src/render.js `renderFrame`) did, per frame:
 *
 *   for (i = 0; i < 80; i++)
 *     for (j = i + 1; j < 80; j++)      // 3,160 pair tests, unconditionally
 *
 * …plus a full `Array.prototype.sort` of all 80 nodes, plus — the expensive
 * part — `ctx.createRadialGradient()` **once per node per frame**. That is 80
 * gradient objects allocated and discarded 60 times a second (4,800/s), each
 * requiring the rasteriser to build a new gradient ramp. Line colour was also
 * rebuilt as a template string per segment (up to 3,160 string allocations
 * per frame), and `strokeStyle` was reassigned before every single `stroke()`,
 * which defeats path batching entirely.
 *
 * ── What this version does ─────────────────────────────────────────────────
 *  - State lives in `Float32Array`s (no per-particle objects → no GC churn).
 *  - Neighbour search uses a uniform grid with cell size = link distance, so
 *    each particle only tests the 9 cells around it. Complexity drops from
 *    Θ(n²) to ~Θ(n·k) where k is the local density.
 *  - Depth ordering uses a counting sort over 32 depth buckets instead of a
 *    comparison sort.
 *  - Nothing is allocated inside `step()` after construction.
 *
 * ── The rendezvous layer (2026-10) ────────────────────────────────────────
 * The brand promise is "Where Minds Meet", and the backdrop now performs it.
 * Every few seconds the field stages a *rendezvous*: two nearby particles
 * ease toward a shared point, touch, flare (a warm ember-gold bloom the
 * renderers read from `flare[]`), and part. A soft ripple ring expands from
 * the contact point and fades. Active state is bounded (a handful of slots),
 * the arithmetic is a few dozen operations per frame, and the spawn schedule
 * is driven by the same seeded PRNG family as the initial layout — a given
 * seed still reproduces a given film, frame for frame.
 */

/** @typedef {{count:number, width:number, height:number, linkDistance:number, speed:number, seed:number, maxMeetings:number, meetingMinDelay:number, meetingMaxDelay:number}} SimOptions */

const DEPTH_BUCKETS = 32;

/** World-space pan applied to the whole field as the page scrolls (px). */
const PARALLAX_RANGE = 130;
/** Rendezvous timing, in 60 fps frames. */
const MEETING_APPROACH = 150;
const MEETING_COOLDOWN = 80;
const RIPPLE_LIFETIME = 55;
const RIPPLE_SLOTS = 6;
/** How strongly a link brightens inside the pointer wake (screen-space). */
const WAKE_RADIUS = 190;

/** Deterministic PRNG so visual output is reproducible in tests/benchmarks. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Field {
  /** @param {Partial<SimOptions>} [opts] */
  constructor(opts = {}) {
    this.count = Math.max(1, opts.count ?? 90);
    this.width = opts.width ?? 1440;
    this.height = opts.height ?? 900;
    this.linkDistance = opts.linkDistance ?? 150;
    this.speed = opts.speed ?? 1;
    this.depthNear = 60;
    this.depthFar = 520;

    const rnd = mulberry32(opts.seed ?? 0x9e3779b9);

    const n = this.count;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.r = new Float32Array(n);

    // Projected screen-space cache, refreshed once per step.
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.scale = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      this.x[i] = (rnd() - 0.5) * this.width * 1.4;
      this.y[i] = (rnd() - 0.5) * this.height * 1.4;
      this.z[i] = this.depthNear + rnd() * (this.depthFar - this.depthNear);
      this.vx[i] = (rnd() - 0.5) * 0.34;
      this.vy[i] = (rnd() - 0.5) * 0.34;
      this.vz[i] = (rnd() - 0.5) * 0.12;
      this.r[i] = 0.5 + rnd() * 2;
    }

    // ── Pre-allocated neighbour-pair output ───────────────────────────────
    // Worst case is bounded by MAX_LINKS; beyond that the frame simply stops
    // adding links, which is visually imperceptible and keeps the frame time
    // bounded on pathological clustering.
    this.maxLinks = Math.min(4000, this.count * 14);
    this.linkA = new Uint16Array(this.maxLinks);
    this.linkB = new Uint16Array(this.maxLinks);
    this.linkAlpha = new Float32Array(this.maxLinks);
    this.linkCount = 0;

    // ── Rendezvous state ("where minds meet") ─────────────────────────────
    // Fixed slot count, typed arrays, zero allocation per frame. A slot is
    // free when mtT[m] < 0; it walks 0 → 1 through the approach phase, holds
    // through a short cooldown after contact, then is released.
    this.maxMeetings = Math.max(0, opts.maxMeetings ?? 3);
    this.mtA = new Uint16Array(this.maxMeetings);
    this.mtB = new Uint16Array(this.maxMeetings);
    this.mtT = new Float32Array(this.maxMeetings); // <0 = free, else 0..1 approach
    this.mtX = new Float32Array(this.maxMeetings); // meeting point, world space
    this.mtY = new Float32Array(this.maxMeetings);
    this.mtZ = new Float32Array(this.maxMeetings);
    this.mtHold = new Float32Array(this.maxMeetings); // post-contact cooldown
    // Float32Array zero-fills; −1 is the "free slot" sentinel, so mark it.
    this.mtT.fill(-1);
    this.meetingCount = 0;
    this.meetingsHeld = 0;

    // Per-particle flare: 0 = quiet, 1 = at contact moment, decaying.
    this.flare = new Float32Array(n);

    // Contact ripples: world-space state (rippleW*) + the derived screen
    // values (rippleX/Y/R/A) the renderers read. All rebuilt each step.
    this.rippleWX = new Float32Array(RIPPLE_SLOTS);
    this.rippleWY = new Float32Array(RIPPLE_SLOTS);
    this.rippleWZ = new Float32Array(RIPPLE_SLOTS);
    this.rippleT = new Float32Array(RIPPLE_SLOTS);
    this.rippleX = new Float32Array(RIPPLE_SLOTS);
    this.rippleY = new Float32Array(RIPPLE_SLOTS);
    this.rippleR = new Float32Array(RIPPLE_SLOTS);
    this.rippleA = new Float32Array(RIPPLE_SLOTS);
    this.rippleCount = 0;

    // Scroll parallax: camY is a world-space pan, smoothed toward a target.
    this.camY = 0;
    this._camTargetY = 0;

    // Runtime PRNG for event staging — seeded, so runs stay reproducible.
    this._rnd = mulberry32((opts.seed ?? 0x9e3779b9) ^ 0x51ed2701);
    this._nextMeetingIn = 150 + this._rnd() * 150; // first event after ~3 s
    this._meetingMinDelay = Math.max(1, opts.meetingMinDelay ?? 240);
    this._meetingMaxDelay = Math.max(this._meetingMinDelay, opts.meetingMaxDelay ?? 480);

    // ── Depth order (counting sort buffers) ───────────────────────────────
    this.order = new Uint16Array(n);
    this._bucketCounts = new Uint32Array(DEPTH_BUCKETS + 1);

    // ── Spatial hash ──────────────────────────────────────────────────────
    this._grid = null;
    this._gridNext = new Int32Array(n);
    this._cols = 0;
    this._rows = 0;
    this._cellSize = this.linkDistance;
    this._rebuildGrid();

    // Pointer influence (set by the renderer; 0 = no pointer).
    this.pointerX = 0;
    this.pointerY = 0;
    this.pointerStrength = 0;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this._rebuildGrid();
  }

  _rebuildGrid() {
    // Grid spans the simulation volume in world space, which is 1.4× the
    // viewport in each axis (see the constructor spread).
    this._worldW = this.width * 1.6;
    this._worldH = this.height * 1.6;
    this._cellSize = Math.max(32, this.linkDistance);
    this._cols = Math.max(1, Math.ceil(this._worldW / this._cellSize));
    this._rows = Math.max(1, Math.ceil(this._worldH / this._cellSize));
    const cells = this._cols * this._rows;
    if (!this._grid || this._grid.length !== cells) this._grid = new Int32Array(cells);
  }

  _cellIndex(x, y) {
    let cx = Math.floor((x + this._worldW / 2) / this._cellSize);
    let cy = Math.floor((y + this._worldH / 2) / this._cellSize);
    if (cx < 0) cx = 0;
    else if (cx >= this._cols) cx = this._cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this._rows) cy = this._rows - 1;
    return cy * this._cols + cx;
  }

  /**
   * Advance the simulation and recompute projection, depth order and links.
   * Allocation-free.
   * @param {number} dt frame delta normalised to 60 fps (1.0 == 16.67 ms)
   */
  step(dt = 1) {
    const n = this.count;
    const sp = this.speed * Math.min(3, Math.max(0.1, dt));
    const halfW = this.width * 0.7;
    const halfH = this.height * 0.7;

    // ── integrate ─────────────────────────────────────────────────────────
    for (let i = 0; i < n; i++) {
      this.x[i] += this.vx[i] * sp;
      this.y[i] += this.vy[i] * sp;
      this.z[i] += this.vz[i] * sp;

      if (this.x[i] > halfW || this.x[i] < -halfW) this.vx[i] = -this.vx[i];
      if (this.y[i] > halfH || this.y[i] < -halfH) this.vy[i] = -this.vy[i];
      if (this.z[i] > this.depthFar || this.z[i] < this.depthNear) this.vz[i] = -this.vz[i];
    }

    // ── rendezvous: stage, steer, flare ──────────────────────────────────
    // Runs before projection so the frame the renderer sees is consistent.
    if (this.maxMeetings > 0) this._updateMeetings(dt);

    // Flare decay — a soft exponential so the bloom reads as a glow, not a
    // flash. ~0.5 s half-life at 60 fps.
    const fl = this.flare;
    const decay = Math.pow(0.975, sp);
    for (let i = 0; i < n; i++) {
      if (fl[i] > 0.001) fl[i] *= decay;
      else fl[i] = 0;
    }

    // ── camera: ease toward the scroll-driven target ─────────────────────
    // Eased on wall-clock delta (not `sp`): even a de-facto frozen field
    // (speed 0, or a degraded tab) must still track the reader's scroll.
    this.camY += (this._camTargetY - this.camY) * Math.min(1, 0.06 * Math.min(3, Math.max(0.2, dt)));

    // ── project (perspective divide, once per particle) ───────────────────
    // The world-space `camY` pan multiplies through the perspective scale,
    // so NEAR particles travel further than far ones — real differential
    // parallax, not a uniform screen shift.
    const fov = 520;
    const cx = this.width / 2;
    const cy = this.height / 2;
    for (let i = 0; i < n; i++) {
      const s = fov / (fov + this.z[i]);
      this.scale[i] = s;
      this.px[i] = this.x[i] * s + cx;
      this.py[i] = (this.y[i] + this.camY) * s + cy;
    }

    // ── pointer repulsion (screen space, cheap, optional) ─────────────────
    if (this.pointerStrength > 0) {
      const pr = 170;
      const pr2 = pr * pr;
      for (let i = 0; i < n; i++) {
        const dx = this.px[i] - this.pointerX;
        const dy = this.py[i] - this.pointerY;
        const d2 = dx * dx + dy * dy;
        if (d2 > pr2 || d2 < 1) continue;
        const f = (1 - Math.sqrt(d2) / pr) * this.pointerStrength * 0.6;
        this.px[i] += dx * f;
        this.py[i] += dy * f;
      }
    }

    this._updateRipples(sp);
    this._sortByDepth();
    this._buildLinks();
  }

  /**
   * Scroll-linked camera pan, 0 (top of page) → 1 (bottom). The field drifts
   * *up* as the reader descends, near layers moving further than far ones —
   * the page acquires depth without a single extra draw call.
   * @param {number} p clamped externally or internally, both are safe
   */
  setScrollProgress(p) {
    const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
    this._camTargetY = -clamped * PARALLAX_RANGE;
  }

  /**
   * Rendezvous scheduler + per-slot steering. A slot's life:
   *   free → (spawn) → approach t: 0 → 1 → contact (flare + ripple)
   *        → hold cooldown → free again.
   * The steering is a position lerp whose strength grows with t, so the
   * approach visibly *accelerates* into the meeting — two particles deciding
   * to meet, not two magnets snapping.
   */
  _updateMeetings(dt) {
    const n = this.count;

    // Schedule the next event.
    this._nextMeetingIn -= dt;
    if (this._nextMeetingIn <= 0 && this.meetingCount < this.maxMeetings) {
      if (this._spawnMeeting()) this.meetingCount++;
      // Retry shortly whether or not a partner was found.
      this._nextMeetingIn = 30 + this._rnd() * 60;
    }

    for (let m = 0; m < this.maxMeetings; m++) {
      const t = this.mtT[m];
      if (t < 0) continue;
      const a = this.mtA[m];
      const b = this.mtB[m];

      // The governor can shrink `count` under an active meeting; drop the
      // slot rather than steering a particle that no longer renders.
      if (a >= n || b >= n) {
        this.mtT[m] = -1;
        this.meetingCount--;
        continue;
      }

      if (t < 1) {
        // Approach phase — ease-in pull toward the shared point. The pull is
        // deliberately NOT multiplied by dt: a stalled tab must not teleport
        // anyone across the volume on resume. Slower frames simply take a
        // touch longer to arrive, which is invisible at this scale.
        const nt = Math.min(1, t + dt / MEETING_APPROACH);
        const k = 0.03 + 0.09 * nt;
        this.x[a] += (this.mtX[m] - this.x[a]) * k;
        this.y[a] += (this.mtY[m] - this.y[a]) * k;
        this.z[a] += (this.mtZ[m] - this.z[a]) * k;
        this.x[b] += (this.mtX[m] - this.x[b]) * k;
        this.y[b] += (this.mtY[m] - this.y[b]) * k;
        this.z[b] += (this.mtZ[m] - this.z[b]) * k;
        if (nt >= 1) {
          // Contact: ignite both particles and stamp a ripple at the point.
          this.flare[a] = 1;
          this.flare[b] = 1;
          this.meetingsHeld++;
          this._spawnRipple(this.mtX[m], this.mtY[m], this.mtZ[m]);
        }
        this.mtT[m] = nt;
      } else {
        // Cooldown, then release the slot.
        this.mtHold[m] -= dt;
        if (this.mtHold[m] <= 0) {
          this.mtT[m] = -1;
          this.meetingCount--;
        }
      }
    }
  }

  /**
   * Pick a particle, then the nearest of a small random sample of candidates.
   * Sampling keeps the spawn O(1)-ish and, seeded, reproducible.
   * @returns {boolean} true if a meeting was staged
   */
  _spawnMeeting() {
    const n = this.count;
    if (n < 8) return false;
    let slot = -1;
    for (let m = 0; m < this.maxMeetings; m++) {
      if (this.mtT[m] < 0) {
        slot = m;
        break;
      }
    }
    if (slot < 0) return false;

    const a = (this._rnd() * n) | 0;
    let best = -1;
    let bestD2 = Infinity;
    for (let tries = 0; tries < 8; tries++) {
      const c = (this._rnd() * n) | 0;
      if (c === a) continue;
      const dx = this.x[c] - this.x[a];
      const dy = this.y[c] - this.y[a];
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = c;
      }
    }
    if (best < 0) return false;

    // Meeting point: the pair's midpoint, pulled slightly toward the centre
    // of the volume so events tend to happen on-stage, not at the edges.
    const halfW = this.width * 0.7;
    const halfH = this.height * 0.7;
    let mx = (this.x[a] + this.x[best]) * 0.5;
    let my = (this.y[a] + this.y[best]) * 0.5;
    mx += (0 - mx) * 0.25;
    my += (0 - my) * 0.25;
    if (mx > halfW) mx = halfW;
    else if (mx < -halfW) mx = -halfW;
    if (my > halfH) my = halfH;
    else if (my < -halfH) my = -halfH;

    this.mtA[slot] = a;
    this.mtB[slot] = best;
    this.mtX[slot] = mx;
    this.mtY[slot] = my;
    this.mtZ[slot] = (this.z[a] + this.z[best]) * 0.5;
    this.mtT[slot] = 0;
    this.mtHold[slot] = MEETING_COOLDOWN;
    return true;
  }

  /**
   * Contact ripple. Stored in world space; screen position, radius and alpha
   * are re-derived every step so the ring rides the same parallax and
   * projection as everything else.
   */
  _spawnRipple(x, y, z) {
    if (this.rippleCount >= RIPPLE_SLOTS) return;
    const i = this.rippleCount++;
    this.rippleWX[i] = x;
    this.rippleWY[i] = y;
    this.rippleWZ[i] = z;
    this.rippleT[i] = 0;
  }

  _updateRipples(sp) {
    const fov = 520;
    const cx = this.width / 2;
    const cy = this.height / 2;
    let w = 0;
    for (let i = 0; i < this.rippleCount; i++) {
      const t = this.rippleT[i] + sp / RIPPLE_LIFETIME;
      if (t >= 1) continue; // expired — dropped by the compaction below
      const s = fov / (fov + this.rippleWZ[i]);
      // Ease-out cubic: fast bloom, long fade.
      const e = 1 - Math.pow(1 - t, 3);
      // Compact survivors in place; renderers read the derived slots only.
      this.rippleWX[w] = this.rippleWX[i];
      this.rippleWY[w] = this.rippleWY[i];
      this.rippleWZ[w] = this.rippleWZ[i];
      this.rippleT[w] = t;
      this.rippleX[w] = this.rippleWX[i] * s + cx;
      this.rippleY[w] = (this.rippleWY[i] + this.camY) * s + cy;
      this.rippleR[w] = (8 + e * 92) * s;
      this.rippleA[w] = Math.pow(1 - t, 2) * 0.3;
      w++;
    }
    this.rippleCount = w;
  }

  /** Counting sort, back-to-front, O(n + buckets). */
  _sortByDepth() {
    const n = this.count;
    const counts = this._bucketCounts.fill(0);
    const span = this.depthFar - this.depthNear || 1;

    for (let i = 0; i < n; i++) {
      // Far particles first → bucket 0 is the farthest.
      let b = DEPTH_BUCKETS - 1 - Math.floor(((this.z[i] - this.depthNear) / span) * DEPTH_BUCKETS);
      if (b < 0) b = 0;
      else if (b >= DEPTH_BUCKETS) b = DEPTH_BUCKETS - 1;
      counts[b + 1]++;
    }
    for (let b = 1; b <= DEPTH_BUCKETS; b++) counts[b] += counts[b - 1];
    for (let i = 0; i < n; i++) {
      let b = DEPTH_BUCKETS - 1 - Math.floor(((this.z[i] - this.depthNear) / span) * DEPTH_BUCKETS);
      if (b < 0) b = 0;
      else if (b >= DEPTH_BUCKETS) b = DEPTH_BUCKETS - 1;
      this.order[counts[b]++] = i;
    }
  }

  /** Uniform-grid neighbour search in screen space. */
  _buildLinks() {
    const n = this.count;
    const grid = this._grid.fill(-1);
    const next = this._gridNext;

    for (let i = 0; i < n; i++) {
      const c = this._cellIndex(this.px[i] - this.width / 2, this.py[i] - this.height / 2);
      next[i] = grid[c];
      grid[c] = i;
    }

    const maxD = this.linkDistance;
    const maxD2 = maxD * maxD;
    const wake = this.pointerStrength > 0;
    const wakeR2 = WAKE_RADIUS * WAKE_RADIUS;
    const ptrX = this.pointerX;
    const ptrY = this.pointerY;
    const ptrS = this.pointerStrength;
    let w = 0;
    const cols = this._cols;
    const rows = this._rows;

    for (let i = 0; i < n && w < this.maxLinks; i++) {
      const ix = this.px[i] - this.width / 2;
      const iy = this.py[i] - this.height / 2;
      let cx = Math.floor((ix + this._worldW / 2) / this._cellSize);
      let cy = Math.floor((iy + this._worldH / 2) / this._cellSize);
      if (cx < 0) cx = 0;
      else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0;
      else if (cy >= rows) cy = rows - 1;

      for (let oy = -1; oy <= 1; oy++) {
        const gy = cy + oy;
        if (gy < 0 || gy >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox;
          if (gx < 0 || gx >= cols) continue;
          for (let j = grid[gy * cols + gx]; j !== -1; j = next[j]) {
            if (j <= i) continue; // each unordered pair exactly once
            const dx = this.px[i] - this.px[j];
            const dy = this.py[i] - this.py[j];
            const d2 = dx * dx + dy * dy;
            if (d2 >= maxD2) continue;
            if (w >= this.maxLinks) break;
            const d = Math.sqrt(d2);
            this.linkA[w] = i;
            this.linkB[w] = j;
            // Base: proximity × average perspective scale.
            let alpha = (1 - d / maxD) * 0.3 * ((this.scale[i] + this.scale[j]) * 0.5);
            // A meeting in progress warms the web around it.
            const f = this.flare[i] + this.flare[j];
            if (f > 0.001) alpha = Math.min(0.85, alpha + f * 0.35);
            // Pointer wake — links wake up where the reader is looking.
            if (wake) {
              const mx = (this.px[i] + this.px[j]) * 0.5 - ptrX;
              const my = (this.py[i] + this.py[j]) * 0.5 - ptrY;
              const dp2 = mx * mx + my * my;
              if (dp2 < wakeR2) {
                alpha = Math.min(0.85, alpha * (1 + 1.6 * (1 - dp2 / wakeR2) * ptrS));
              }
            }
            this.linkAlpha[w] = alpha;
            w++;
          }
        }
      }
    }
    this.linkCount = w;
  }

  /** Diagnostic helper used by the benchmark + tests. */
  stats() {
    return {
      particles: this.count,
      links: this.linkCount,
      cells: this._cols * this._rows,
      meetings: this.meetingCount,
      meetingsHeld: this.meetingsHeld,
      ripples: this.rippleCount,
      camY: Number(this.camY.toFixed(2)),
    };
  }
}

/**
 * Reference O(n²) link builder — kept so the benchmark can measure the exact
 * algorithm the previous renderer used, on the same data, in the same process.
 * Not used at runtime.
 */
export function bruteForceLinkCount(field) {
  const n = field.count;
  const maxD2 = field.linkDistance * field.linkDistance;
  let pairs = 0;
  let tests = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      tests++;
      const dx = field.px[i] - field.px[j];
      const dy = field.py[i] - field.py[j];
      if (dx * dx + dy * dy < maxD2) pairs++;
    }
  }
  return { pairs, tests };
}
