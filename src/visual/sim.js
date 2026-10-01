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
 */

/** @typedef {{count:number, width:number, height:number, linkDistance:number, speed:number, seed:number}} SimOptions */

const DEPTH_BUCKETS = 32;

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

    // ── project (perspective divide, once per particle) ───────────────────
    const fov = 520;
    const cx = this.width / 2;
    const cy = this.height / 2;
    for (let i = 0; i < n; i++) {
      const s = fov / (fov + this.z[i]);
      this.scale[i] = s;
      this.px[i] = this.x[i] * s + cx;
      this.py[i] = this.y[i] * s + cy;
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

    this._sortByDepth();
    this._buildLinks();
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
            this.linkAlpha[w] = (1 - d / maxD) * 0.3 * ((this.scale[i] + this.scale[j]) * 0.5);
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
