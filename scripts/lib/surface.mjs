/**
 * surface.mjs — a tiny linear-light software rasteriser.
 *
 * Everything composites in LINEAR RGB and is encoded to sRGB exactly once, at
 * the end. That is the whole reason the gold glows look like light rather than
 * like a beige film: additive blending in gamma space darkens midtones and
 * turns overlapping highlights grey, which is the single most common reason
 * procedurally-generated "premium" artwork looks cheap.
 *
 * Geometry is anti-aliased from a signed distance field rather than
 * supersampled per primitive, so a 1.4 px hairline stays a 1.4 px hairline at
 * any supersample factor and costs one pass.
 */

/* ── Colour ───────────────────────────────────────────────────────────────── */

export const srgbToLinear = (u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** `#RRGGBB` → linear-light triplet. */
export function color(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [
    srgbToLinear(((n >> 16) & 0xff) / 255),
    srgbToLinear(((n >> 8) & 0xff) / 255),
    srgbToLinear((n & 0xff) / 255),
  ];
}

export const mixColor = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ── Surface ──────────────────────────────────────────────────────────────── */

export class Surface {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Float32Array(width * height * 3);
  }

  clone() {
    const s = new Surface(this.width, this.height);
    s.data.set(this.data);
    return s;
  }

  copyFrom(other) {
    this.data.set(other.data);
    return this;
  }

  /** Per-pixel generator, used once for the static backdrop. */
  paint(fn) {
    const { width, height, data } = this;
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i += 3) {
        const c = fn(x, y);
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
      }
    }
    return this;
  }

  /** Additive radial falloff — the only light source primitive in the system. */
  addRadial(cx, cy, radius, rgb, intensity, falloff = 2.2) {
    const { width, height, data } = this;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(width - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(height - 1, Math.ceil(cy + radius));
    const inv = 1 / radius;
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) * inv;
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) * inv;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= 1) continue;
        const k = (1 - d) ** falloff * intensity;
        const i = (y * width + x) * 3;
        data[i] += rgb[0] * k;
        data[i + 1] += rgb[1] * k;
        data[i + 2] += rgb[2] * k;
      }
    }
    return this;
  }

  /**
   * Stroke one segment with round caps.
   * @param {boolean} additive true = light, false = alpha-over paint
   */
  segment(ax, ay, bx, by, strokeWidth, rgb, alpha = 1, additive = false) {
    if (alpha <= 0) return this;
    const { width, height, data } = this;
    const hw = strokeWidth / 2;
    const pad = hw + 1.5;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + pad));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - pad));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by) + pad));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-6;

    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - (ax + dx * t);
        const qy = py - (ay + dy * t);
        const d = Math.sqrt(qx * qx + qy * qy) - hw;
        const cov = clamp(0.5 - d, 0, 1) * alpha;
        if (cov <= 0.002) continue;
        const i = (y * width + x) * 3;
        if (additive) {
          data[i] += rgb[0] * cov;
          data[i + 1] += rgb[1] * cov;
          data[i + 2] += rgb[2] * cov;
        } else {
          data[i] += (rgb[0] - data[i]) * cov;
          data[i + 1] += (rgb[1] - data[i + 1]) * cov;
          data[i + 2] += (rgb[2] - data[i + 2]) * cov;
        }
      }
    }
    return this;
  }

  polyline(points, strokeWidth, rgb, alpha = 1, additive = false) {
    for (let i = 1; i < points.length; i++) {
      this.segment(
        points[i - 1][0],
        points[i - 1][1],
        points[i][0],
        points[i][1],
        strokeWidth,
        rgb,
        alpha,
        additive
      );
    }
    if (points.length === 1) {
      const [x, y] = points[0];
      this.segment(x, y, x, y, strokeWidth, rgb, alpha, additive);
    }
    return this;
  }

  /** Circle outline, flattened to the pixel grid it will be drawn on. */
  circle(cx, cy, r, strokeWidth, rgb, alpha = 1, additive = false, from = 0, to = 360) {
    const steps = Math.max(24, Math.ceil((Math.abs(to - from) / 360) * (r * 1.4)));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return this.polyline(pts, strokeWidth, rgb, alpha, additive);
  }

  /** Soft disc with a hot core — a point light, not a filled circle. */
  spark(cx, cy, r, rgb, intensity, core = 0.28) {
    const { width, height, data } = this;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(height - 1, Math.ceil(cy + r));
    const inv = 1 / r;
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) * inv;
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) * inv;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= 1) continue;
        const halo = (1 - d) ** 3;
        const hot = d < core ? (1 - d / core) ** 2 * 1.9 : 0;
        const k = (halo + hot) * intensity;
        const i = (y * width + x) * 3;
        data[i] += rgb[0] * k;
        data[i + 1] += rgb[1] * k;
        data[i + 2] += rgb[2] * k;
      }
    }
    return this;
  }

  /** Multiply the whole surface by a per-pixel scalar. Used for the vignette. */
  modulate(fn) {
    const { width, height, data } = this;
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++, i += 3) {
        const k = fn(x, y);
        data[i] *= k;
        data[i + 1] *= k;
        data[i + 2] *= k;
      }
    }
    return this;
  }
}

/* ── Coverage masks ───────────────────────────────────────────────────────── */

/**
 * A single-channel coverage buffer. Text is rasterised into one of these once,
 * then composited every frame with a different colour function — which is how
 * the headline gets a moving specular sweep for the cost of one bounding box
 * rather than a full re-rasterisation per frame.
 */
export class Mask {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Float32Array(width * height);
    this.minX = width;
    this.minY = height;
    this.maxX = -1;
    this.maxY = -1;
  }

  get isEmpty() {
    return this.maxX < 0;
  }

  segment(ax, ay, bx, by, strokeWidth) {
    const { width, height, data } = this;
    const hw = strokeWidth / 2;
    const pad = hw + 1.5;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + pad));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - pad));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by) + pad));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-6;

    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - (ax + dx * t);
        const qy = py - (ay + dy * t);
        const d = Math.sqrt(qx * qx + qy * qy) - hw;
        const cov = clamp(0.5 - d, 0, 1);
        if (cov <= 0.002) continue;
        const i = y * width + x;
        if (cov > data[i]) data[i] = cov; // max-combine: no seams at joins
        if (x < this.minX) this.minX = x;
        if (x > this.maxX) this.maxX = x;
        if (y < this.minY) this.minY = y;
        if (y > this.maxY) this.maxY = y;
      }
    }
    return this;
  }

  polyline(points, strokeWidth) {
    for (let i = 1; i < points.length; i++) {
      this.segment(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], strokeWidth);
    }
    if (points.length === 1) {
      const [x, y] = points[0];
      this.segment(x, y, x, y, strokeWidth);
    }
    return this;
  }

  /** Rasterise a laid-out string from `type.mjs`. */
  text(layout) {
    for (const run of layout.runs) this.polyline(run.points, run.width);
    return this;
  }
}

/**
 * Composite a mask onto a surface.
 * @param {(x:number,y:number,cov:number)=>number[]|null} shade returns linear RGB, or null to skip
 */
export function paintMask(surface, mask, shade, { additive = false } = {}) {
  if (mask.isEmpty) return surface;
  const { width, data } = surface;
  for (let y = mask.minY; y <= mask.maxY; y++) {
    for (let x = mask.minX; x <= mask.maxX; x++) {
      const cov = mask.data[y * mask.width + x];
      if (cov <= 0.002) continue;
      const rgb = shade(x, y, cov);
      if (!rgb) continue;
      const i = (y * width + x) * 3;
      if (additive) {
        data[i] += rgb[0] * cov;
        data[i + 1] += rgb[1] * cov;
        data[i + 2] += rgb[2] * cov;
      } else {
        data[i] += (rgb[0] - data[i]) * cov;
        data[i + 1] += (rgb[1] - data[i + 1]) * cov;
        data[i + 2] += (rgb[2] - data[i + 2]) * cov;
      }
    }
  }
  return surface;
}

/* ── Output ───────────────────────────────────────────────────────────────── */

/**
 * Filmic shoulder. Linear below the knee, asymptotic to 1 above it, C¹ at the
 * join — so a hot specular core rolls off to white instead of clipping into a
 * flat disc.
 */
const KNEE = 0.78;
const tone = (v) => (v <= KNEE ? v : 1 - (1 - KNEE) * Math.exp(-(v - KNEE) / (1 - KNEE)));

/**
 * Resolve a (possibly supersampled) linear surface to packed 8-bit sRGB.
 * @param {Surface} surface
 * @param {number} ss supersample factor; 2 means the surface is 2× the output
 * @returns {Uint8Array} packed RGB, (width/ss) × (height/ss)
 */
export function resolve(surface, ss = 1) {
  const outW = Math.round(surface.width / ss);
  const outH = Math.round(surface.height / ss);
  const out = new Uint8Array(outW * outH * 3);
  const inv = 1 / (ss * ss);
  const { width, data } = surface;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < ss; sy++) {
        const row = (y * ss + sy) * width;
        for (let sx = 0; sx < ss; sx++) {
          const i = (row + x * ss + sx) * 3;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
      }
      const o = (y * outW + x) * 3;
      out[o] = Math.round(clamp(linearToSrgb(tone(r * inv)), 0, 1) * 255);
      out[o + 1] = Math.round(clamp(linearToSrgb(tone(g * inv)), 0, 1) * 255);
      out[o + 2] = Math.round(clamp(linearToSrgb(tone(b * inv)), 0, 1) * 255);
    }
  }
  return out;
}

/** Deterministic PRNG — the card must be byte-identical on every machine. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
