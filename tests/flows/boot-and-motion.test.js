/**
 * Flow: the single boot sequence and the motion subsystems it starts.
 *
 * The regression these lock down: the page previously had eight independent
 * module entry points, four IntersectionObservers, three language switchers
 * and no defined ordering between them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountIndexHtml, flush } from '../helpers/page.js';

/**
 * Every boot in this file is torn down afterwards: jsdom shares one
 * `document` across the specs in a file, so a leaked capture-phase listener
 * from boot N would fire during boot N+1.
 */
let activeBoot = null;

async function bootOnce() {
  vi.resetModules();
  mountIndexHtml();
  const mod = await import('../../src/app/boot.js');
  activeBoot = mod;
  const result = await mod.boot();
  await flush();
  return result;
}

async function freshBoot() {
  return bootOnce();
}

describe('boot sequence', () => {
  beforeEach(() => {
    globalThis.__IO_INSTANCES__.length = 0;
    localStorage.clear();
  });
  afterEach(() => {
    activeBoot?.teardownBoot();
    activeBoot = null;
    vi.restoreAllMocks();
    document.documentElement.className = '';
    delete document.documentElement.dataset.tier;
  });

  it('completes without throwing and reports a ready payload', async () => {
    const ready = await freshBoot();
    expect(ready).toMatchObject({
      tier: expect.stringMatching(/^(high|mid|low|off)$/),
      field: expect.any(String),
    });
    expect(ready.bootMs).toBeGreaterThanOrEqual(0);
  });

  it('swaps the no-js class for js, so CSS can depend on it', async () => {
    document.documentElement.className = 'no-js';
    await freshBoot();
    expect(document.documentElement.classList.contains('js')).toBe(true);
  });

  it('publishes the device tier as a data attribute for CSS to read', async () => {
    await freshBoot();
    expect(['high', 'mid', 'low', 'off']).toContain(document.documentElement.dataset.tier);
  });

  it('is idempotent — a second boot() is refused rather than doubling listeners', async () => {
    const mod = await import('../../src/app/boot.js');
    activeBoot = mod;
    mountIndexHtml();
    const first = await mod.boot();
    const second = await mod.boot();
    expect(second).toBe(first);
  });

  it('dispatches urlife:ready exactly once', async () => {
    vi.resetModules();
    mountIndexHtml();
    const seen = [];
    window.addEventListener('urlife:ready', (e) => seen.push(e.detail));
    const mod = await import('../../src/app/boot.js');
    activeBoot = mod;
    await mod.boot();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveProperty('field');
  });

  /**
   * The original defect was four IntersectionObservers all watching the SAME
   * `[data-reveal]` nodes, because four modules each built their own. Counting
   * observers globally is the wrong assertion — count-up and the field both
   * legitimately own one. The real invariant is that no element is observed
   * twice.
   */
  it('observes each reveal element exactly once, never by competing observers', async () => {
    await freshBoot();

    const watchers = new Map();
    for (const io of globalThis.__IO_INSTANCES__) {
      for (const el of io.elements) watchers.set(el, (watchers.get(el) ?? 0) + 1);
    }

    const revealNodes = [...document.querySelectorAll('[data-reveal]')];
    expect(revealNodes.length).toBeGreaterThan(10);

    const doubleObserved = revealNodes.filter((el) => (watchers.get(el) ?? 0) > 1);
    expect(doubleObserved.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);

    // One observer instance serves every reveal node.
    const revealObservers = globalThis.__IO_INSTANCES__.filter((io) =>
      revealNodes.some((el) => io.elements.has(el))
    );
    expect(revealObservers).toHaveLength(1);
  });

  it('survives a subsystem that throws — guard() isolates failures', async () => {
    vi.resetModules();
    mountIndexHtml();
    vi.doMock('../../src/motion/countup.js', () => ({
      initCountUp: () => {
        throw new Error('synthetic countup failure');
      },
    }));
    const mod = await import('../../src/app/boot.js');
    activeBoot = mod;
    await expect(mod.boot()).resolves.toBeTruthy();
    vi.doUnmock('../../src/motion/countup.js');
  });

  /**
   * Boot captures the idle callback instead of running it so the spec can
   * distinguish "loaded eagerly" from "loaded when the browser went idle".
   */
  async function bootWithDeferredIdle() {
    vi.resetModules();
    mountIndexHtml();
    const initAccount = vi.fn();
    vi.doMock('../../src/app/account.js', () => ({ initAccount }));

    const realIdle = globalThis.requestIdleCallback;
    let idleCallback = null;
    globalThis.requestIdleCallback = (cb) => {
      idleCallback = cb;
      return 1;
    };

    const mod = await import('../../src/app/boot.js');
    activeBoot = mod;
    await mod.boot();
    await flush(2);

    return {
      initAccount,
      runIdle: async () => {
        idleCallback?.({ didTimeout: false, timeRemaining: () => 8 });
        await flush(3);
      },
      restore: () => {
        globalThis.requestIdleCallback = realIdle;
        vi.doUnmock('../../src/app/account.js');
      },
    };
  }

  it('does not import the account module during a plain page load', async () => {
    const h = await bootWithDeferredIdle();
    expect(h.initAccount).not.toHaveBeenCalled();
    h.restore();
  });

  it('imports the account module once the browser goes idle', async () => {
    const h = await bootWithDeferredIdle();
    await h.runIdle();
    expect(h.initAccount).toHaveBeenCalledTimes(1);
    h.restore();
  });

  it('imports the account module on first CTA intent, before the idle window', async () => {
    const h = await bootWithDeferredIdle();
    document.getElementById('nav-join-btn').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flush(3);
    expect(h.initAccount).toHaveBeenCalledTimes(1);

    // Idle must not import it a second time.
    await h.runIdle();
    expect(h.initAccount).toHaveBeenCalledTimes(1);
    h.restore();
  });

  it('imports the account module eagerly when a magic-link token is present', async () => {
    vi.resetModules();
    mountIndexHtml();
    const initAccount = vi.fn();
    vi.doMock('../../src/app/account.js', () => ({ initAccount }));
    const original = window.location.hash;
    history.replaceState(null, '', '#access_token=abc');

    const mod = await import('../../src/app/boot.js');
    activeBoot = mod;
    await mod.boot();
    expect(initAccount).toHaveBeenCalledTimes(1);

    history.replaceState(null, '', original || '/');
    vi.doUnmock('../../src/app/account.js');
  });
});

describe('reveal observer', () => {
  beforeEach(() => {
    globalThis.__IO_INSTANCES__.length = 0;
    mountIndexHtml();
  });

  it('marks elements revealed when they intersect and then stops observing them', async () => {
    const { initReveal } = await import('../../src/motion/reveal.js');
    const handle = initReveal();
    expect(handle.count).toBeGreaterThan(10);

    const target = document.querySelector('[data-reveal]');
    expect(target.classList.contains('is-revealed')).toBe(false);

    globalThis.__IO_INSTANCES__.forEach((io) => io.triggerAll(true));
    await flush();

    expect(target.classList.contains('is-revealed')).toBe(true);
    expect(globalThis.__IO_INSTANCES__[0].unobserved.length).toBeGreaterThan(0);
  });

  it('reveals everything immediately when the user prefers reduced motion', async () => {
    const mq = window.matchMedia;
    window.matchMedia = (q) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    vi.resetModules();
    const { initReveal } = await import('../../src/motion/reveal.js');
    initReveal();
    const hidden = [...document.querySelectorAll('[data-reveal]')].filter(
      (el) => !el.classList.contains('is-revealed')
    );
    expect(hidden).toEqual([]);
    window.matchMedia = mq;
  });
});

describe('scroll effects', () => {
  beforeEach(() => {
    vi.resetModules();
    mountIndexHtml();
  });

  it('writes the scroll progress to a custom property and to aria-valuenow', async () => {
    const { initScrollFx } = await import('../../src/motion/scroll-fx.js');
    initScrollFx();

    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 4000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true, writable: true });
    window.scrollY = 1500;
    window.dispatchEvent(new Event('scroll'));
    await flush();

    const progress = document.documentElement.style.getPropertyValue('--scroll-progress');
    expect(Number(progress)).toBeGreaterThan(0.4);
    expect(Number(progress)).toBeLessThanOrEqual(1);
    expect(document.querySelector('.scroll-progress').getAttribute('aria-valuenow')).toBe(
      String(Math.round(Number(progress) * 100))
    );
  });

  it('registers exactly one scroll listener regardless of how many parallax nodes exist', async () => {
    const spy = vi.spyOn(window, 'addEventListener');
    const { initScrollFx } = await import('../../src/motion/scroll-fx.js');
    initScrollFx();
    const scrollListeners = spy.mock.calls.filter(([type]) => type === 'scroll');
    expect(scrollListeners).toHaveLength(1);
    expect(scrollListeners[0][2]).toMatchObject({ passive: true });
    spy.mockRestore();
  });

  it('smooth-scrolls in-page anchors instead of jumping', async () => {
    const { initAnchorNavigation } = await import('../../src/motion/scroll-fx.js');
    initAnchorNavigation();
    const target = document.getElementById('how');
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    document
      .querySelector('a[href="#how"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
  });
});

describe('count-up', () => {
  beforeEach(() => {
    globalThis.__IO_INSTANCES__.length = 0;
    vi.resetModules();
    mountIndexHtml();
  });

  it('lands exactly on the declared target value', async () => {
    const { initCountUp } = await import('../../src/motion/countup.js');
    initCountUp();
    const el = document.querySelector('[data-countup]');
    expect(el).not.toBeNull();

    globalThis.__IO_INSTANCES__.forEach((io) => io.triggerAll(true));
    for (let i = 0; i < 80; i++) await flush(1);

    expect(el.textContent.replace(/[^\d]/g, '')).toBe(String(el.dataset.countup).replace(/[^\d]/g, ''));
  });
});

describe('ambient field', () => {
  beforeEach(() => {
    vi.resetModules();
    mountIndexHtml();
  });

  it('refuses to run at all on a low-tier device', async () => {
    const { initField } = await import('../../src/visual/field.js');
    // Injected rather than inferred: the host's CPU count must not decide
    // whether this spec is testing the low tier.
    const handle = initField({ tier: 'low' });
    expect(handle.mode).toBe('none');
    expect(handle.reason).toMatch(/tier/);
    expect(document.getElementById('field-canvas').hidden).toBe(true);
    expect(document.documentElement.classList.contains('field-static')).toBe(true);
  });

  it('falls back from WebGL2 to Canvas2D when no WebGL context is available', async () => {
    const { initField } = await import('../../src/visual/field.js');
    // tests/setup.js returns null for every webgl context request, so the
    // high tier must land on the Canvas2D backend rather than disabling.
    const handle = initField({ tier: 'high' });
    expect(handle.mode).toBe('canvas2d');
    expect(document.getElementById('field-canvas').hidden).toBe(false);
    handle.destroy();
  });

  it('pauses when the canvas scrolls out of view and resumes when it returns', async () => {
    globalThis.__IO_INSTANCES__.length = 0;
    const { initField } = await import('../../src/visual/field.js');
    const handle = initField({ tier: 'mid' });
    const io = globalThis.__IO_INSTANCES__.at(-1);
    expect(io).toBeTruthy();

    io.cb([{ target: document.getElementById('field-canvas'), isIntersecting: false }], io);
    expect(handle.getStats().running).toBe(false);
    io.cb([{ target: document.getElementById('field-canvas'), isIntersecting: true }], io);
    expect(handle.getStats().running).toBe(true);
    handle.destroy();
  });

  it('stops the loop when the tab is hidden', async () => {
    const { initField } = await import('../../src/visual/field.js');
    const handle = initField({ tier: 'mid' });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(handle.getStats().running).toBe(false);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(handle.getStats().running).toBe(true);
    handle.destroy();
  });

  it('removes every listener it added on destroy', async () => {
    const { initField } = await import('../../src/visual/field.js');
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const handle = initField({ tier: 'mid' });
    const addedTypes = added.mock.calls.map(([t]) => t).sort();
    handle.destroy();
    const removedTypes = removed.mock.calls.map(([t]) => t).sort();
    expect(removedTypes).toEqual(addedTypes);
    expect(globalThis.__IO_INSTANCES__.at(-1).disconnected).toBe(true);
  });

  it('degrades to no renderer at all under prefers-reduced-motion, and shows the CSS fallback', async () => {
    const mq = window.matchMedia;
    window.matchMedia = (q) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    vi.resetModules();
    const { initField } = await import('../../src/visual/field.js');
    const handle = initField({ tier: 'high' });
    expect(handle.mode).toBe('none');
    expect(handle.reason).toBe('prefers-reduced-motion');
    expect(document.getElementById('field-canvas').hidden).toBe(true);
    expect(document.documentElement.classList.contains('field-static')).toBe(true);
    expect(document.querySelector('.field-fallback')).not.toBeNull();
    window.matchMedia = mq;
  });

  it('never throws when the canvas element is absent', async () => {
    document.getElementById('field-canvas').remove();
    const { initField } = await import('../../src/visual/field.js');
    expect(() => initField()).not.toThrow();
  });

  it('exposes live stats for the debug overlay', async () => {
    const { initField } = await import('../../src/visual/field.js');
    const handle = initField({ tier: 'high' });
    const stats = handle.getStats();
    expect(stats).toMatchObject({
      mode: 'canvas2d',
      particles: expect.any(Number),
      // The rendezvous channels the renderers read must be surfaced too.
      meetings: expect.any(Number),
      meetingsHeld: expect.any(Number),
      ripples: expect.any(Number),
      camY: expect.any(Number),
    });
    expect(stats.particles).toBeGreaterThan(0);
    handle.destroy();
  });

  it('dollies the field camera as the reader scrolls the page', async () => {
    const { initField } = await import('../../src/visual/field.js');
    const handle = initField({ tier: 'mid' });
    expect(handle.getStats().camY).toBe(0); // top of page: no offset

    Object.defineProperty(window, 'scrollY', { value: 4000, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    // One rAF for the throttled read, then frames for the sim ease.
    for (let i = 0; i < 60; i++) await flush(1);
    const camY = handle.getStats().camY;
    expect(camY).toBeLessThan(-30); // eased (or reached) the parallax target
    expect(camY).toBeGreaterThanOrEqual(-130); // and never past it

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    for (let i = 0; i < 60; i++) await flush(1);
    expect(handle.getStats().camY).toBeGreaterThan(camY + 30); // it follows back up
    handle.destroy();
  });
});
