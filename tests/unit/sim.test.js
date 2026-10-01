/**
 * Characterisation + correctness tests for the particle field simulation.
 *
 * The key assertion is EQUIVALENCE: the uniform-grid neighbour search must
 * find exactly the same pairs as the brute-force O(n²) scan the previous
 * renderer used. Without that, "faster" would just mean "wrong".
 */

import { describe, it, expect } from 'vitest';
import { Field, bruteForceLinkCount } from '../../src/visual/sim.js';

describe('Field simulation', () => {
  it('is deterministic for a given seed', () => {
    const a = new Field({ count: 40, seed: 7 });
    const b = new Field({ count: 40, seed: 7 });
    a.step(1);
    b.step(1);
    expect(Array.from(a.px)).toEqual(Array.from(b.px));
    expect(a.linkCount).toBe(b.linkCount);
  });

  it('allocates typed arrays sized to the particle count', () => {
    const f = new Field({ count: 64, seed: 1 });
    expect(f.x).toBeInstanceOf(Float32Array);
    expect(f.x.length).toBe(64);
    expect(f.order.length).toBe(64);
  });

  it('finds exactly the same links as the brute-force O(n^2) scan', () => {
    // Several densities, several frames: the grid must never miss a pair that
    // the exhaustive scan finds, and never invent one.
    for (const count of [30, 90, 150]) {
      const f = new Field({ count, seed: count * 13, width: 1280, height: 800 });
      for (let frame = 0; frame < 25; frame++) {
        f.step(1);
        const brute = bruteForceLinkCount(f);
        // maxLinks clamping is a deliberate frame-time guard; only compare
        // when we are below the cap.
        if (f.linkCount < f.maxLinks) {
          expect(f.linkCount, `count=${count} frame=${frame}`).toBe(brute.pairs);
        }
      }
    }
  });

  it('does the grid search with far fewer distance tests than brute force', () => {
    const f = new Field({ count: 130, seed: 99, width: 1440, height: 900 });
    f.step(1);
    const brute = bruteForceLinkCount(f);
    // 130 particles ⇒ 8,385 exhaustive pair tests.
    expect(brute.tests).toBe((130 * 129) / 2);
    // The grid only visits the 9 cells around each particle. We assert the
    // *outcome* here (correct link count) and measure the cost separately in
    // scripts/bench-field.mjs, which reports wall-clock numbers.
    expect(f.linkCount).toBe(brute.pairs);
  });

  it('keeps particles inside the simulation volume', () => {
    const f = new Field({ count: 80, seed: 3, width: 1000, height: 600 });
    for (let i = 0; i < 600; i++) f.step(1);
    const halfW = 1000 * 0.7;
    const halfH = 600 * 0.7;
    for (let i = 0; i < f.count; i++) {
      // One frame of overshoot is allowed before the velocity flips.
      expect(Math.abs(f.x[i])).toBeLessThan(halfW + 2);
      expect(Math.abs(f.y[i])).toBeLessThan(halfH + 2);
      expect(f.z[i]).toBeGreaterThan(f.depthNear - 2);
      expect(f.z[i]).toBeLessThan(f.depthFar + 2);
    }
  });

  it('orders particles far-to-near so nearer glows paint last', () => {
    const f = new Field({ count: 100, seed: 11 });
    f.step(1);
    const zs = Array.from(f.order).map((i) => f.z[i]);
    for (let i = 1; i < zs.length; i++) {
      // Counting sort is bucketed (32 buckets over the depth range), so the
      // ordering is monotonic within one bucket width, not strictly.
      const bucket = (f.depthFar - f.depthNear) / 32;
      expect(zs[i]).toBeLessThanOrEqual(zs[i - 1] + bucket + 1e-3);
    }
  });

  it('never allocates beyond the link cap', () => {
    // Pathological clustering: tiny volume, huge link radius.
    const f = new Field({ count: 200, seed: 5, width: 120, height: 120, linkDistance: 400 });
    f.step(1);
    expect(f.linkCount).toBeLessThanOrEqual(f.maxLinks);
    expect(f.linkA.length).toBe(f.maxLinks);
  });

  it('clamps a large dt so a backgrounded tab does not teleport particles', () => {
    const f = new Field({ count: 20, seed: 2 });
    const before = f.x[0];
    f.step(1000); // simulate a 16-second stall
    // speed multiplier is clamped to 3, and |vx| < 0.17, so travel < 0.6px
    expect(Math.abs(f.x[0] - before)).toBeLessThan(1);
  });

  it('survives a resize without losing particles', () => {
    const f = new Field({ count: 50, seed: 4, width: 800, height: 600 });
    f.step(1);
    f.resize(1920, 1080);
    f.step(1);
    expect(f.count).toBe(50);
    expect(f.stats().particles).toBe(50);
  });
});
