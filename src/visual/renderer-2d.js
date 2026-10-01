/**
 * renderer-2d.js — Canvas2D backend for the ambient field.
 *
 * Used when WebGL2 is unavailable or the device tier is 'mid'.
 *
 * Two optimisations carry almost all of the win over the previous renderer:
 *
 *  1. **Pre-rendered glow sprite.** The old code called
 *     `ctx.createRadialGradient(...)` once per particle per frame. Here the
 *     gradient is rasterised ONCE into a small offscreen canvas at
 *     construction time and then blitted with `drawImage`, which is a plain
 *     textured quad for the rasteriser.
 *
 *  2. **Alpha bucketing for links.** The old code set `strokeStyle` and called
 *     `stroke()` for every single segment (up to 3,160 state changes +
 *     draw calls per frame). Here segments are bucketed into 6 alpha bands and
 *     each band is drawn as ONE path with ONE `stroke()` — at most 6 draw
 *     calls per frame regardless of link count.
 */

const GLOW_SIZE = 64; // sprite is 64×64; particles are scaled down from it
const ALPHA_BANDS = 6;

export function createCanvas2DRenderer(canvas, field, opts = {}) {
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) return null;

  const tint = opts.tint ?? [244, 215, 122];
  const linkTint = opts.linkTint ?? [212, 175, 55];

  // ── build the glow sprite once ──────────────────────────────────────────
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = GLOW_SIZE;
  const sctx = sprite.getContext('2d');
  const g = sctx.createRadialGradient(
    GLOW_SIZE / 2,
    GLOW_SIZE / 2,
    0,
    GLOW_SIZE / 2,
    GLOW_SIZE / 2,
    GLOW_SIZE / 2
  );
  g.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},1)`);
  g.addColorStop(0.35, `rgba(${tint[0]},${tint[1]},${tint[2]},0.35)`);
  g.addColorStop(1, `rgba(${tint[0]},${tint[1]},${tint[2]},0)`);
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);

  // Pre-computed stroke colours, one per alpha band — no per-segment strings.
  const bandStyles = [];
  for (let b = 0; b < ALPHA_BANDS; b++) {
    const a = ((b + 1) / ALPHA_BANDS) * 0.3;
    bandStyles.push(`rgba(${linkTint[0]},${linkTint[1]},${linkTint[2]},${a.toFixed(3)})`);
  }

  let dpr = 1;
  let cssW = 0;
  let cssH = 0;

  function resize(width, height, pixelRatio) {
    cssW = width;
    cssH = height;
    dpr = pixelRatio;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    ctx.clearRect(0, 0, cssW, cssH);

    // ── links: ALPHA_BANDS paths, ALPHA_BANDS stroke() calls ──────────────
    ctx.lineWidth = 0.6;
    for (let b = 0; b < ALPHA_BANDS; b++) {
      const lo = (b / ALPHA_BANDS) * 0.3;
      const hi = ((b + 1) / ALPHA_BANDS) * 0.3;
      let started = false;
      for (let k = 0; k < field.linkCount; k++) {
        const a = field.linkAlpha[k];
        if (a < lo || a >= hi) continue;
        if (!started) {
          ctx.beginPath();
          started = true;
        }
        const i = field.linkA[k];
        const j = field.linkB[k];
        ctx.moveTo(field.px[i], field.py[i]);
        ctx.lineTo(field.px[j], field.py[j]);
      }
      if (started) {
        ctx.strokeStyle = bandStyles[b];
        ctx.stroke();
      }
    }

    // ── particles: one drawImage each, back to front ──────────────────────
    ctx.globalCompositeOperation = 'lighter';
    for (let o = 0; o < field.count; o++) {
      const i = field.order[o];
      const s = field.scale[i];
      const size = field.r[i] * s * 7;
      ctx.globalAlpha = Math.min(1, 0.22 + s * 0.8);
      ctx.drawImage(sprite, field.px[i] - size / 2, field.py[i] - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  return {
    kind: 'canvas2d',
    resize,
    draw,
    destroy() {
      ctx.clearRect(0, 0, cssW, cssH);
    },
  };
}
