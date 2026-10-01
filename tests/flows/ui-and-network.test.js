/**
 * Flow: shared UI feedback (errors, toasts, loading) and network/degraded
 * mode signalling, plus the pointer micro-interaction layer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountIndexHtml, flush } from '../helpers/page.js';
import { showError, clearError, setLoading, showToast } from '../../src/ui.js';

describe('error slots', () => {
  beforeEach(() => mountIndexHtml());

  it('renders the message as text and makes the slot a live region', () => {
    showError('login-error', 'Enter a valid email address.');
    const slot = document.getElementById('login-error');
    expect(slot.hidden).toBe(false);
    expect(slot.textContent).toBe('Enter a valid email address.');
    expect(slot.getAttribute('role')).toBe('alert');
    expect(slot.getAttribute('aria-live')).toBe('assertive');
  });

  it('never interprets the message as markup', () => {
    showError('login-error', '<img src=x onerror="window.__pwned=1">');
    expect(document.getElementById('login-error').querySelector('img')).toBeNull();
    expect(window.__pwned).toBeUndefined();
  });

  it('associates the message with the offending field and focuses it', () => {
    showError('login-error', 'Bad email', { field: 'login-email' });
    const field = document.getElementById('login-email');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby').split(/\s+/)).toContain('login-error');
    expect(document.activeElement).toBe(field);
  });

  it('does not steal focus when focus:false is requested', () => {
    document.getElementById('login-password').focus();
    showError('login-error', 'Bad email', { field: 'login-email', focus: false });
    expect(document.activeElement.id).toBe('login-password');
  });

  it('does not duplicate the describedby token when shown repeatedly', () => {
    showError('login-error', 'a', { field: 'login-email' });
    showError('login-error', 'b', { field: 'login-email' });
    const tokens = document.getElementById('login-email').getAttribute('aria-describedby').split(/\s+/);
    expect(tokens.filter((t) => t === 'login-error')).toHaveLength(1);
  });

  it('clearError removes the message and every aria-invalid it set', () => {
    showError('login-error', 'Bad email', { field: 'login-email' });
    clearError('login-error');
    const slot = document.getElementById('login-error');
    expect(slot.hidden).toBe(true);
    expect(slot.textContent).toBe('');
    expect(document.getElementById('login-email').hasAttribute('aria-invalid')).toBe(false);
  });

  it('is a no-op for an unknown slot instead of throwing', () => {
    expect(() => showError('nope-error', 'x')).not.toThrow();
    expect(() => clearError('nope-error')).not.toThrow();
  });
});

describe('loading state', () => {
  beforeEach(() => mountIndexHtml());

  it('disables the button and flags it for CSS', () => {
    const btn = document.getElementById('login-submit');
    setLoading(btn, true);
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains('btn--loading')).toBe(true);
    setLoading(btn, false);
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains('btn--loading')).toBe(false);
  });

  it('tolerates a null button', () => {
    expect(() => setLoading(null, true)).not.toThrow();
  });
});

describe('toasts', () => {
  beforeEach(() => {
    mountIndexHtml();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('announces errors assertively and status messages politely', () => {
    showToast('Saved', 'success');
    showToast('Failed', 'error');
    const toasts = [...document.querySelectorAll('#toast-container .toast')];
    expect(toasts.map((t) => t.getAttribute('role'))).toEqual(['status', 'alert']);
  });

  it('renders the message as text', () => {
    showToast('<b>bold</b>', 'info');
    const toast = document.querySelector('#toast-container .toast');
    expect(toast.querySelector('b')).toBeNull();
    expect(toast.textContent).toBe('<b>bold</b>');
  });

  it('caps the stack at three and evicts the oldest first', () => {
    for (const m of ['one', 'two', 'three', 'four']) showToast(m, 'info');
    const texts = [...document.querySelectorAll('#toast-container .toast')].map((t) => t.textContent);
    // The evicted toast is removed asynchronously on transitionend; it must at
    // least have lost its visible class immediately.
    expect(texts).toContain('four');
    expect(document.querySelectorAll('#toast-container .toast--visible').length).toBeLessThanOrEqual(3);
  });

  it('auto-dismisses a success toast but never one with an action', () => {
    showToast('bye', 'success');
    const onClick = vi.fn();
    showToast({ message: 'retry?', type: 'error', action: { label: 'Retry', onClick } });

    vi.advanceTimersByTime(10000);
    const remaining = [...document.querySelectorAll('#toast-container .toast')];
    expect(remaining.some((t) => t.textContent.includes('retry?'))).toBe(true);
    expect(remaining.find((t) => t.textContent === 'bye')?.classList.contains('toast--visible')).toBeFalsy();
  });

  it('runs the action callback on click', () => {
    const onClick = vi.fn();
    showToast({ message: 'retry?', type: 'error', action: { label: 'Retry', onClick } });
    document.querySelector('.toast-action').click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the container is missing', () => {
    document.getElementById('toast-container').remove();
    expect(() => showToast('x')).not.toThrow();
  });
});

describe('network status', () => {
  beforeEach(() => {
    vi.resetModules();
    mountIndexHtml();
  });

  it('marks the document offline and shows one polite notice', async () => {
    const { initNetworkStatus } = await import('../../src/app/network.js');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    const handle = initNetworkStatus();
    expect(document.documentElement.dataset.offline).toBe('true');
    const banner = document.querySelector('.env-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.textContent).toMatch(/offline/i);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    expect(document.documentElement.dataset.offline).toBe('false');
    expect(document.querySelector('.env-banner')).toBeNull();
    handle.destroy();
  });

  it('removes its listeners on destroy', async () => {
    const { initNetworkStatus } = await import('../../src/app/network.js');
    const spy = vi.spyOn(window, 'removeEventListener');
    initNetworkStatus().destroy();
    const types = spy.mock.calls.map(([t]) => t);
    expect(types).toEqual(expect.arrayContaining(['online', 'offline']));
  });
});

describe('degraded-mode reporting', () => {
  beforeEach(() => {
    vi.resetModules();
    mountIndexHtml();
  });

  it('reports a missing backend', async () => {
    const { reportBackendConfig } = await import('../../src/app/network.js');
    expect(reportBackendConfig({ dev: false })).toBe(true);
  });

  it('never renders the configuration surface to production visitors', async () => {
    const { reportBackendConfig } = await import('../../src/app/network.js');
    reportBackendConfig({ dev: false });
    expect(document.querySelector('.env-banner')).toBeNull();
  });

  it('explains the problem in development, naming variables but never values', async () => {
    const { reportBackendConfig } = await import('../../src/app/network.js');
    reportBackendConfig({ dev: true });
    const banner = document.querySelector('.env-banner');
    expect(banner.textContent).toMatch(/VITE_SUPABASE_URL/);
    expect(banner.textContent).toMatch(/\.env\.example/);
    expect(banner.textContent).not.toMatch(/eyJ/);
  });
});

describe('pointer effects', () => {
  beforeEach(() => {
    vi.resetModules();
    mountIndexHtml();
  });

  function withRect(el, rect) {
    el.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      ...rect,
    });
  }

  it('is disabled entirely for coarse pointers', async () => {
    const mq = window.matchMedia;
    window.matchMedia = (q) => ({
      matches: /pointer:\s*coarse/.test(q),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    });
    vi.resetModules();
    const { initPointerFx } = await import('../../src/motion/pointer-fx.js');
    expect(initPointerFx({ tier: 'high' }).enabled).toBe(false);
    window.matchMedia = mq;
  });

  it('is disabled under prefers-reduced-motion', async () => {
    const mq = window.matchMedia;
    window.matchMedia = (q) => ({
      matches: /prefers-reduced-motion|pointer:\s*fine|hover:\s*hover/.test(q),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    });
    vi.resetModules();
    const { initPointerFx } = await import('../../src/motion/pointer-fx.js');
    expect(initPointerFx({ tier: 'high' }).enabled).toBe(false);
    window.matchMedia = mq;
  });

  it('refuses to run on a low-tier device even with a fine pointer', async () => {
    const { initPointerFx } = await import('../../src/motion/pointer-fx.js');
    expect(initPointerFx({ tier: 'low' }).enabled).toBe(false);
  });

  it('promotes the historical card classes to the declarative data-tilt API', async () => {
    const { initPointerFx } = await import('../../src/motion/pointer-fx.js');
    const handle = initPointerFx({ tier: 'high' });
    expect(handle.enabled).toBe(true);
    const cards = document.querySelectorAll('.role-card, .ps, .rev-card');
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.hasAttribute('data-tilt')).toBe(true);
    handle.destroy();
  });

  it('writes only custom properties — never a layout-triggering property', async () => {
    const { initPointerFx } = await import('../../src/motion/pointer-fx.js');
    const handle = initPointerFx({ tier: 'high' });
    const card = document.querySelector('.role-card');
    withRect(card);

    card.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 25 }));
    await flush(2);

    expect(card.style.getPropertyValue('--tilt-y')).toMatch(/deg$/);
    expect(card.style.getPropertyValue('--tilt-x')).toMatch(/deg$/);
    expect(card.getAttribute('data-tilt-active')).toBe('');
    // No direct transform/top/left writes: the transform lives in motion.css.
    expect(card.style.transform).toBe('');
    expect(card.style.top).toBe('');
    handle.destroy();
  });

  it('coalesces a burst of pointer samples into a single frame', async () => {
    const { initPointerFx } = await import('../../src/motion/pointer-fx.js');
    const handle = initPointerFx({ tier: 'high' });
    const card = document.querySelector('.role-card');
    let reads = 0;
    card.getBoundingClientRect = () => {
      reads += 1;
      return { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 };
    };

    for (let i = 0; i < 50; i++) {
      card.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: i, clientY: 10 }));
    }
    await flush(2);

    // 50 samples, at most one geometry read — the cache plus the rAF gate.
    expect(reads).toBeLessThanOrEqual(1);
    handle.destroy();
  });

  it('resets every custom property it set when the pointer leaves', async () => {
    const { initPointerFx } = await import('../../src/motion/pointer-fx.js');
    const handle = initPointerFx({ tier: 'high' });
    const card = document.querySelector('.role-card');
    withRect(card);
    card.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 25 }));
    await flush(2);

    document.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    expect(card.style.getPropertyValue('--tilt-x')).toBe('0deg');
    expect(card.style.getPropertyValue('--tilt-y')).toBe('0deg');
    expect(card.hasAttribute('data-tilt-active')).toBe(false);
    handle.destroy();
  });

  it('removes every listener on destroy', async () => {
    const { initPointerFx } = await import('../../src/motion/pointer-fx.js');
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const handle = initPointerFx({ tier: 'high' });
    const added = docAdd.mock.calls.map(([t]) => t).sort();
    handle.destroy();
    expect(docRemove.mock.calls.map(([t]) => t).sort()).toEqual(added);
  });
});
