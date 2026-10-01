/**
 * compositor.test.js — invariants for the two optical primitives that the
 * Open Graph card's look depends on.
 *
 * `tests/contracts/document.test.js` already proves the *shipped* GIF is
 * structurally valid. These specs prove the things that would silently
 * degrade the art instead of breaking it: a bloom that leaks below its
 * threshold washes the card out, a box blur that reads past the buffer edge
 * darkens the border, and a beam that ignores its endpoint clamp paints light
 * where the layout says there is none. All three are invisible in a diff and
 * obvious on a shared link.
 */

import { describe, it, expect } from 'vitest';
import { Surface, color } from '../../scripts/lib/surface.mjs';

const WHITE = color('#FFFFFF');
const energy = (s) => s.data.reduce((a, b) => a + b, 0);
const at = (s, x, y) => s.data[(y * s.width + x) * 3];

describe('Surface#bloom', () => {
  it('leaves a surface entirely below the threshold untouched', () => {
    const s = new Surface(32, 32);
    s.paint(() => [0.05, 0.05, 0.05]);
    const before = Float32Array.from(s.data);
    s.bloom({ threshold: 0.4, radius: 6, intensity: 1 });
    expect(Array.from(s.data)).toEqual(Array.from(before));
  });

  it('extracts only the overshoot above the threshold, and conserves it', () => {
    // A uniform field at 1.0 with threshold 0.75 must contribute exactly 25 %
    // of its energy, and the blur must neither create nor destroy any of it.
    // Getting this wrong is how a bloom pass turns a dark card beige.
    const s = new Surface(64, 64);
    s.paint(() => [1, 1, 1]);
    const lit = energy(s);
    s.bloom({ threshold: 0.75, radius: 8, intensity: 1 });
    expect(energy(s) - lit).toBeCloseTo(lit * 0.25, 1);
  });

  it('spreads light outward — neighbours gain, and the falloff is monotonic', () => {
    const s = new Surface(96, 96);
    s.segment(48, 48, 48, 48, 2, WHITE, 1);
    expect(at(s, 48, 60)).toBe(0);
    s.bloom({ threshold: 0.2, radius: 24, intensity: 1 });
    const ring = [4, 8, 12, 16, 20].map((d) => at(s, 48 + d, 48));
    expect(ring[0]).toBeGreaterThan(0);
    for (let i = 1; i < ring.length; i++) expect(ring[i]).toBeLessThan(ring[i - 1]);
  });

  it('clamps at the buffer edge instead of blurring in blackness', () => {
    // A uniformly bright surface must bloom uniformly. If the box blur treats
    // out-of-bounds as zero, the border loses energy and the card gets a dark
    // picture-frame artefact that only shows up on a real unfurl.
    const s = new Surface(48, 48);
    s.paint(() => [1, 1, 1]);
    s.bloom({ threshold: 0.5, radius: 12, intensity: 1 });
    const corner = at(s, 0, 0);
    const middle = at(s, 24, 24);
    expect(corner).toBeCloseTo(middle, 4);
  });

  it('confines its work to `region` when one is given', () => {
    const s = new Surface(80, 80);
    s.segment(20, 20, 20, 20, 3, WHITE, 1); // outside the region
    s.segment(60, 60, 60, 60, 3, WHITE, 1); // inside it
    const outsideBefore = at(s, 26, 20);
    s.bloom({ threshold: 0.2, radius: 10, intensity: 1, region: [40, 40, 79, 79] });
    expect(at(s, 26, 20)).toBe(outsideBefore);
    expect(at(s, 66, 60)).toBeGreaterThan(0);
  });

  it('is a no-op on a region too small to blur', () => {
    const s = new Surface(40, 40);
    s.paint(() => [1, 1, 1]);
    const before = energy(s);
    s.bloom({ threshold: 0.1, radius: 4, intensity: 1, region: [10, 10, 11, 11] });
    expect(energy(s)).toBe(before);
  });
});

describe('Surface#glowLine', () => {
  it('peaks on the axis and decays monotonically across it', () => {
    const s = new Surface(80, 80);
    s.glowLine(10, 40, 70, 40, 12, WHITE, 1, 1);
    const axis = at(s, 40, 40);
    const off = [2, 4, 6, 9, 13].map((d) => at(s, 40, 40 + d));
    expect(axis).toBeGreaterThan(off[0]);
    for (let i = 1; i < off.length; i++) expect(off[i]).toBeLessThan(off[i - 1]);
  });

  it('interpolates intensity along its length', () => {
    const s = new Surface(80, 80);
    s.glowLine(10, 40, 70, 40, 10, WHITE, 1, 0);
    expect(at(s, 12, 40)).toBeGreaterThan(at(s, 40, 40));
    expect(at(s, 40, 40)).toBeGreaterThan(at(s, 68, 40));
  });

  it('paints nothing beyond its endpoints', () => {
    const s = new Surface(80, 80);
    s.glowLine(30, 40, 50, 40, 10, WHITE, 1, 1);
    expect(at(s, 24, 40)).toBe(0);
    expect(at(s, 56, 40)).toBe(0);
    expect(at(s, 40, 40)).toBeGreaterThan(0);
  });

  it('is additive, so two overlapping beams sum rather than replace', () => {
    const one = new Surface(60, 60);
    one.glowLine(5, 30, 55, 30, 8, WHITE, 0.5, 0.5);
    const two = new Surface(60, 60);
    two.glowLine(5, 30, 55, 30, 8, WHITE, 0.5, 0.5);
    two.glowLine(5, 30, 55, 30, 8, WHITE, 0.5, 0.5);
    expect(at(two, 30, 30)).toBeCloseTo(at(one, 30, 30) * 2, 5);
  });
});
