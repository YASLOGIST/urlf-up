/**
 * rendezvous.test.js — specs for the "where minds meet" layer of the field.
 *
 * sim.js gained three behaviours in the 2026-10 upgrade, and each one has an
 * invariant worth enforcing (each of these failing would be invisible in a
 * diff and obvious on screen):
 *
 *   RENDEZVOUS  two particles must actually converge, contact must ignite a
 *               flare and stamp a ripple, and the flare must decay. The
 *               schedule must stay deterministic for a seed.
 *   PARALLAX    the scroll camera must move near particles further than far
 *               ones (differential, not a screen shift), and must be bounded.
 *   WAKE        links near the pointer brighten; links far away do not.
 *
 * Everything here runs in plain Node — no canvas, no GL — because the
 * simulation was kept renderer-agnostic.
 */

import { describe, it, expect } from 'vitest';
import { Field, bruteForceLinkCount } from '../../src/visual/sim.js';

/** Field with meetings scheduled as fast as the scheduler allows. */
function eagerField(extra = {}) {
  return new Field({
    count: 120,
    width: 1440,
    height: 900,
    seed: 1234,
    maxMeetings: 2,
    meetingMinDelay: 1,
    meetingMaxDelay: 1,
    ...extra,
  });
}

describe('rendezvous', () => {
  it('stages meetings, and only up to the configured maximum', () => {
    const f = eagerField();
    for (let i = 0; i < 600; i++) f.step(1);
    expect(f.meetingsHeld).toBeGreaterThan(0);
    expect(f.meetingCount).toBeLessThanOrEqual(f.maxMeetings);
  });

  it('converges the pair before contact — the meeting is real, not cosmetic', () => {
    const f = eagerField({ maxMeetings: 1 });
    let firstDistance = null;
    let distanceAtContact = Infinity;
    for (let i = 0; i < 400 && distanceAtContact === Infinity; i++) {
      f.step(1);
      if (f.meetingCount > 0 && f.mtT[0] < 1) {
        const a = f.mtA[0];
        const b = f.mtB[0];
        const d = Math.hypot(f.x[a] - f.x[b], f.y[a] - f.y[b]);
        if (firstDistance === null) firstDistance = d;
      }
      // mtT reaches exactly 1 on the contact frame; flare is lit that frame.
      if (f.mtT[0] === 1) {
        const a = f.mtA[0];
        const b = f.mtB[0];
        distanceAtContact = Math.hypot(f.x[a] - f.x[b], f.y[a] - f.y[b]);
      }
    }
    expect(firstDistance).toBeGreaterThan(50); // they started apart…
    expect(distanceAtContact).toBeLessThan(12); // …and actually met
  });

  it('ignites a flare on contact and lets it decay', () => {
    const f = eagerField({ maxMeetings: 1 });
    let sawPeak = false;
    let peak = 0;
    for (let i = 0; i < 400; i++) {
      f.step(1);
      let frameMax = 0;
      for (let k = 0; k < f.count; k++) if (f.flare[k] > frameMax) frameMax = f.flare[k];
      if (frameMax > peak) peak = frameMax;
      if (peak >= 0.9) sawPeak = true;
    }
    expect(sawPeak).toBe(true);
    // …and 120 quiet frames later the field has settled again.
    for (let i = 0; i < 120; i++) f.step(1);
    let residual = 0;
    for (let k = 0; k < f.count; k++) if (f.flare[k] > residual) residual = f.flare[k];
    expect(residual).toBeLessThan(0.05);
  });

  it('stamps a ripple at the contact point that expands and dies', () => {
    const f = eagerField({ maxMeetings: 1 });
    let sawRipple = false;
    let firstR = 0;
    let lastR = 0;
    for (let i = 0; i < 700; i++) {
      f.step(1);
      if (f.rippleCount > 0) {
        if (!sawRipple) firstR = f.rippleR[0];
        sawRipple = true;
        lastR = f.rippleR[0];
        expect(f.rippleA[0]).toBeGreaterThan(0);
        expect(f.rippleA[0]).toBeLessThanOrEqual(0.31);
      }
    }
    expect(sawRipple).toBe(true);
    expect(lastR).toBeGreaterThan(firstR); // it expands…
    // …and eventually disappears entirely.
    for (let i = 0; i < 120; i++) f.step(1);
    expect(f.rippleCount).toBe(0);
  });

  it('releases its slots — no leak of permanently reserved meetings', () => {
    const f = eagerField({ maxMeetings: 2, meetingMinDelay: 400, meetingMaxDelay: 400 });
    // One long pass: at most a handful of meetings, slots always recycled.
    for (let i = 0; i < 2000; i++) f.step(1);
    expect(f.meetingCount).toBeLessThanOrEqual(2);
    const active = Array.from(f.mtT).filter((t) => t >= 0).length;
    expect(active).toBe(f.meetingCount); // bookkeeping agrees with the slots
  });

  it('drops a meeting whose particles were shed by the adaptive governor', () => {
    const f = eagerField({ maxMeetings: 1 });
    for (let i = 0; i < 200; i++) f.step(1); // a meeting is in flight
    f.count = 10; // governor sheds density below the meeting's partners
    for (let i = 0; i < 400; i++) f.step(1);
    const active = Array.from(f.mtT).filter((t) => t >= 0);
    // Any surviving meeting must reference particles that still render.
    for (let m = 0; m < f.maxMeetings; m++) {
      if (f.mtT[m] >= 0) {
        expect(f.mtA[m]).toBeLessThan(f.count);
        expect(f.mtB[m]).toBeLessThan(f.count);
      }
    }
    expect(active.length).toBe(f.meetingCount);
  });

  it('stays deterministic with the rendezvous layer active', () => {
    const a = eagerField();
    const b = eagerField();
    for (let i = 0; i < 500; i++) {
      a.step(1);
      b.step(1);
    }
    expect(Array.from(a.px)).toEqual(Array.from(b.px));
    expect(a.meetingsHeld).toBe(b.meetingsHeld);
    expect(a.rippleCount).toBe(b.rippleCount);
  });

  it('never changes WHICH links exist — only their brightness', () => {
    const f = eagerField();
    for (let frame = 0; frame < 200; frame++) {
      f.step(1);
      const brute = bruteForceLinkCount(f);
      if (f.linkCount < f.maxLinks) {
        expect(f.linkCount, `frame=${frame}`).toBe(brute.pairs);
      }
    }
  });
});

describe('scroll parallax camera', () => {
  it('moves the field upward as the page is read, smoothly and bounded', () => {
    // speed 0 freezes drift so the measurement isolates the camera exactly.
    const f = new Field({ count: 60, seed: 5, maxMeetings: 0, speed: 0 });
    f.step(1);
    const before = Array.from(f.py);
    f.setScrollProgress(1);
    for (let i = 0; i < 300; i++) f.step(1); // let the ease settle
    let maxShift = 0;
    for (let i = 0; i < f.count; i++) {
      const shift = before[i] - f.py[i]; // upward = positive
      if (shift > maxShift) maxShift = shift;
      expect(shift).toBeGreaterThan(-1); // never moves the wrong way
    }
    expect(maxShift).toBeGreaterThan(40); // visibly parallaxed…
    expect(maxShift).toBeLessThan(135); // …but bounded by the range
  });

  it('is differential: near layers travel further than far layers', () => {
    const f = new Field({ count: 80, seed: 5, maxMeetings: 0, speed: 0 });
    f.step(1);
    const pyBefore = Array.from(f.py);
    const zBefore = Array.from(f.z);
    f.setScrollProgress(1);
    for (let i = 0; i < 300; i++) f.step(1);
    const shifts = [];
    for (let i = 0; i < f.count; i++) shifts.push([zBefore[i], pyBefore[i] - f.py[i]]);
    shifts.sort((a, b) => a[0] - b[0]); // near (small z) first
    const nearAvg = avg(shifts.slice(0, 20).map((s) => s[1]));
    const farAvg = avg(shifts.slice(-20).map((s) => s[1]));
    expect(nearAvg).toBeGreaterThan(farAvg);
  });

  it('clamps out-of-range progress instead of trusting the caller', () => {
    const f = new Field({ count: 10, seed: 1, maxMeetings: 0 });
    f.setScrollProgress(5);
    f.step(1);
    expect(f._camTargetY).toBeGreaterThanOrEqual(-131);
    f.setScrollProgress(-3);
    f.step(1);
    expect(Math.abs(f._camTargetY)).toBe(0); // -0 is still zero; sign is noise
  });
});

describe('pointer wake', () => {
  it('brightens links near the pointer and leaves distant links alone', () => {
    const f = new Field({ count: 130, seed: 99, width: 1440, height: 900, maxMeetings: 0 });
    f.step(1);

    // Same frame, same links, only the pointer differs. Compare alphas by
    // pair identity (i, j) so ordering changes cannot fake a pass.
    const quiet = new Map();
    for (let k = 0; k < f.linkCount; k++) quiet.set(pairKey(f, k), f.linkAlpha[k]);

    // Park the pointer on a particle that has at least one link.
    let anchor = 0;
    for (let k = 0; k < f.linkCount; k++) {
      anchor = f.linkA[k];
      break;
    }
    f.pointerX = f.px[anchor];
    f.pointerY = f.py[anchor];
    f.pointerStrength = 1;
    f.step(1);

    let nearBrightened = 0;
    let farUntouched = 0;
    for (let k = 0; k < f.linkCount; k++) {
      const before = quiet.get(pairKey(f, k));
      if (before === undefined) continue; // a brand-new pair this frame
      const mx = (f.px[f.linkA[k]] + f.px[f.linkB[k]]) * 0.5;
      const my = (f.py[f.linkA[k]] + f.py[f.linkB[k]]) * 0.5;
      const near = Math.hypot(mx - f.pointerX, my - f.pointerY) < 150;
      if (near && f.linkAlpha[k] > before + 0.001) nearBrightened++;
      if (!near && Math.abs(f.linkAlpha[k] - before) < 0.001) farUntouched++;
    }
    expect(nearBrightened).toBeGreaterThan(0);
    expect(farUntouched).toBeGreaterThan(0);
  });
});

function pairKey(f, k) {
  const a = f.linkA[k];
  const b = f.linkB[k];
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function avg(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
