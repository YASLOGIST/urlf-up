/**
 * renderer-2d.test.js — contract tests for the Canvas2D backend.
 *
 * The Canvas2D renderer is the path most phones actually run (tier `mid`),
 * and the 2026-10 upgrade gave it the same story layer as WebGL: depth-banded
 * sprites, an ember heart while a contact flares, and contact ripples. These
 * specs pin the *budget* the renderer is designed around — banded strokes,
 * bounded ring strokes, one sprite blit per particle (+1 only while flaring) —
 * using a recording 2D context, because none of that is observable through
 * jsdom's no-op canvas.
 */

import { describe, it, expect } from 'vitest';
import { Field } from '../../src/visual/sim.js';

function recorder() {
  const calls = {
    clearRect: 0,
    beginPath: 0,
    stroke: 0,
    drawImage: 0,
    setTransform: 0,
    arcs: [],
    sprites: new Set(),
    strokeStyles: new Set(),
  };
  const ctx = {
    lineWidth: 1,
    globalAlpha: 1,
    strokeStyle: '',
    fillStyle: '',
    globalCompositeOperation: 'source-over',
    setTransform() {
      calls.setTransform++;
    },
    clearRect() {
      calls.clearRect++;
    },
    beginPath() {
      calls.beginPath++;
    },
    moveTo() {},
    lineTo() {},
    arc(x, y, r) {
      calls.arcs.push({ x, y, r });
    },
    stroke() {
      calls.stroke++;
    },
    drawImage(sprite) {
      calls.drawImage++;
      calls.sprites.add(sprite);
    },
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  // Record the strokeStyle strings actually painted with.
  let lastStyle = '';
  Object.defineProperty(ctx, 'strokeStyle', {
    get: () => lastStyle,
    set: (v) => {
      lastStyle = v;
      calls.strokeStyles.add(v);
    },
  });
  return { ctx, calls };
}

function makeCanvas(ctx) {
  const canvas = document.createElement('canvas');
  canvas.getContext = () => ctx; // own property shadows the jsdom patch
  return canvas;
}

/** A field with a live ripple and a flaring particle, deterministically. */
function storyField() {
  const f = new Field({
    count: 90,
    width: 1280,
    height: 800,
    seed: 77,
    maxMeetings: 1,
    meetingMinDelay: 1,
    meetingMaxDelay: 1,
  });
  for (let i = 0; i < 1000 && f.rippleCount === 0; i++) f.step(1);
  if (f.rippleCount === 0) throw new Error('precondition: no ripple staged');
  return f;
}

describe('createCanvas2DRenderer', () => {
  it('returns null when no 2D context is available', async () => {
    const { createCanvas2DRenderer } = await import('../../src/visual/renderer-2d.js');
    const canvas = document.createElement('canvas');
    canvas.getContext = () => null;
    expect(createCanvas2DRenderer(canvas, new Field({ count: 10, seed: 1 }))).toBeNull();
  });

  it('holds its stroke budget: 6 link bands + ≤ 3 ring strokes', async () => {
    const { createCanvas2DRenderer } = await import('../../src/visual/renderer-2d.js');
    const field = storyField();
    // Stage two more well-formed ripples up to the drawn cap (3) to
    // exercise the loop bound. The renderer's contract is "paint
    // `rippleCount` rings from the ripple{X,Y,R,A} arrays"; sim validity
    // is enforced by rendezvous.test.js.
    field.rippleX[1] = 200;
    field.rippleY[1] = 300;
    field.rippleR[1] = 40;
    field.rippleA[1] = 0.2;
    field.rippleX[2] = 500;
    field.rippleY[2] = 250;
    field.rippleR[2] = 70;
    field.rippleA[2] = 0.1;
    field.rippleCount = 3;
    const { ctx, calls } = recorder();
    const r = createCanvas2DRenderer(makeCanvas(ctx), field);
    r.resize(1280, 800, 1);
    r.draw();
    // 6 link bands MAX (an empty band skips its stroke) + exactly 3 rings.
    expect(calls.stroke).toBeLessThanOrEqual(6 + 3);
    expect(calls.arcs).toHaveLength(3); // one arc per drawn ring
    expect(calls.stroke - calls.arcs.length).toBeLessThanOrEqual(6);
    for (const arc of calls.arcs) {
      expect(arc.r).toBeGreaterThan(0);
      expect(arc.x).toBeGreaterThanOrEqual(0);
    }
    r.destroy();
  });

  it('blits one sprite per particle, plus an ember heart only while flaring', async () => {
    const { createCanvas2DRenderer } = await import('../../src/visual/renderer-2d.js');
    const field = storyField();
    const flaring = [];
    for (let i = 0; i < field.count; i++) if (field.flare[i] > 0.08) flaring.push(i);
    expect(flaring.length).toBeGreaterThan(0); // precondition: a contact glow

    const { ctx, calls } = recorder();
    const r = createCanvas2DRenderer(makeCanvas(ctx), field);
    r.resize(1280, 800, 1);
    r.draw();
    // Every particle paints once; each flaring particle paints twice (ember).
    expect(calls.drawImage).toBe(field.count + flaring.length);
    // …and the ember sprite is a distinct pre-rendered canvas.
    expect(calls.sprites.size).toBeGreaterThanOrEqual(2);
    r.destroy();
  });

  it('paints depth: near, mid and far particles use different sprites', async () => {
    const { createCanvas2DRenderer } = await import('../../src/visual/renderer-2d.js');
    // Freeze drift, then pin three particles at near/mid/far depths.
    const field = new Field({ count: 12, width: 1280, height: 800, seed: 3, speed: 0 });
    field.z[0] = 100; // s ≈ 0.84 → near
    field.z[1] = 250; // s ≈ 0.68 → mid
    field.z[2] = 450; // s ≈ 0.54 → far
    field.step(1);
    const { ctx, calls } = recorder();
    const r = createCanvas2DRenderer(makeCanvas(ctx), field);
    r.resize(1280, 800, 1);
    r.draw();
    const distinct = [...calls.sprites].filter((s) => s instanceof HTMLCanvasElement);
    expect(distinct.length).toBe(3); // near/mid/far ladder
    r.destroy();
  });

  it('sizes the backing store with the DPR and clears on destroy', async () => {
    const { createCanvas2DRenderer } = await import('../../src/visual/renderer-2d.js');
    const field = new Field({ count: 10, seed: 1 });
    const { ctx, calls } = recorder();
    const canvas = makeCanvas(ctx);
    const r = createCanvas2DRenderer(canvas, field);
    r.resize(500, 400, 2);
    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(800);
    expect(canvas.style.width).toBe('500px');
    expect(calls.setTransform).toBe(1);
    r.destroy();
    expect(calls.clearRect).toBe(1);
  });
});
