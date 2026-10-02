/**
 * renderer-2d.js — Canvas2D backend for the ambient field.
 *
 * Used when WebGL2 is unavailable or the device tier is 'mid'.
 *
 * Optimisations that carry almost all of the win over the previous renderer:
 *
 *  1. **Pre-rendered glow sprites.** The old code called
 *     `ctx.createRadialGradient(...)` once per particle per frame. Here the
 *     gradients are rasterised ONCE into small offscreen canvases at
 *     construction time and then blitted with `drawImage`, which is a plain
 *     textured quad for the rasteriser.
 *
 *  2. **Alpha bucketing for links.** The old code set `strokeStyle` and called
 *     `stroke()` for every single segment (up to 3,160 state changes + draw
 *     calls per frame). Here segments are bucketed into 6 alpha bands and
 *     each band is drawn as ONE path with ONE `stroke()` — at most 6 draw
 *     calls per frame regardless of link count.
 *
 * ── The 2026-10 upgrade ───────────────────────────────────────────────────
 * The 2D backend now renders the same story as the WebGL one — depth, flare,
 * contact ripples — because most phones land on this path and a muted
 * backdrop there would make "premium" mean "desktop only":
 *
 *   - three glow sprites (near gold / mid gold / far amber) selected by
 *     perspective scale, so depth reads without per-particle tinting;
 *   - a rendezvous flare enlarges and brightens the particle and overlays a
 *     small ember core (one extra drawImage, only while flaring);
 *   - contact ripples stroke ≤ 3 arcs per frame, inside the same banded
 *     stroke budget philosophy (bounded, tiny, predictable).
 */

const GLOW_SIZE = 64; // sprites are 64×64; particles are scaled down from it
const ALPHA_BANDS = 6;
const MAX_RING_STROKES = 3; // ripples drawn per frame on this backend

function makeGlowSprite(rgb, stops) {
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
  for (const [pos, a] of stops) g.addColorStop(pos, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
  sctx.fillStyle = g;
  sctx.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  return sprite;
}

export function createCanvas2DRenderer(canvas, field, opts = {}) {
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) return null;

  const linkTint = opts.linkTint ?? [212, 175, 55];

  // ── build the sprite ladder once ────────────────────────────────────────
  // Near → bright warm gold, far → dim amber: the same depth grading the
  // WebGL shader performs with uTintNear/uTintFar.
  const spriteNear = makeGlowSprite(opts.tintNear ?? [247, 227, 160], [
    [0, 1],
    [0.35, 0.38],
    [1, 0],
  ]);
  const spriteMid = makeGlowSprite(opts.tintMid ?? [212, 175, 55], [
    [0, 0.92],
    [0.35, 0.3],
    [1, 0],
  ]);
  const spriteFar = makeGlowSprite(opts.tintFar ?? [138, 112, 48], [
    [0, 0.7],
    [0.35, 0.2],
    [1, 0],
  ]);
  const spriteEmber = makeGlowSprite(opts.tintFlare ?? [255, 122, 69], [
    [0, 0.9],
    [0.3, 0.42],
    [1, 0],
  ]);

  // Pre-computed stroke colours, one per alpha band — no per-segment strings.
  const bandStyles = [];
  for (let b = 0; b < ALPHA_BANDS; b++) {
    const a = ((b + 1) / ALPHA_BANDS) * 0.3;
    bandStyles.push(`rgba(${linkTint[0]},${linkTint[1]},${linkTint[2]},${a.toFixed(3)})`);
  }
  // Ring strokes are few (≤3) and continuously fading; one string per ring
  // per frame is 3 allocations/s vs the 3,160 the old renderer spent.
  let ringStyleCache = '';
  let ringStyleAlpha = -1;
  function ringStyle(alpha) {
    if (alpha !== ringStyleAlpha) {
      ringStyleAlpha = alpha;
      ringStyleCache = `rgba(${linkTint[0]},${linkTint[1]},${linkTint[2]},${alpha.toFixed(3)})`;
    }
    return ringStyleCache;
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

    // ── contact ripples: ≤ MAX_RING_STROKES arcs ──────────────────────────
    const ripples = Math.min(field.rippleCount ?? 0, MAX_RING_STROKES);
    for (let r = 0; r < ripples; r++) {
      ctx.beginPath();
      ctx.arc(field.rippleX[r], field.rippleY[r], field.rippleR[r], 0, Math.PI * 2);
      ctx.strokeStyle = ringStyle(field.rippleA[r]);
      ctx.stroke();
    }

    // ── particles: back to front, depth-banded sprite, flare-aware ───────
    ctx.globalCompositeOperation = 'lighter';
    for (let p = 0; p < field.count; p++) {
      const i = field.order[p];
      const s = field.scale[i];
      const fl = field.flare[i];
      const size = field.r[i] * s * 7 * (1 + fl * 0.9);
      ctx.globalAlpha = Math.min(1, (0.22 + s * 0.8) * (1 + fl * 1.2));
      // Perspective scale bands: s ∈ ~[0.5, 0.9] over the depth range.
      const sprite = s > 0.75 ? spriteNear : s > 0.62 ? spriteMid : spriteFar;
      ctx.drawImage(sprite, field.px[i] - size / 2, field.py[i] - size / 2, size, size);
      if (fl > 0.08) {
        // Ember heart while a rendezvous contact glows.
        const es = size * 0.55;
        ctx.globalAlpha = Math.min(1, fl * 0.55);
        ctx.drawImage(spriteEmber, field.px[i] - es / 2, field.py[i] - es / 2, es, es);
      }
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
