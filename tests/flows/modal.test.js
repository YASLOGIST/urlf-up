/**
 * Flow: overlay dialogs (auth, idea, meeting).
 *
 * Covers the keyboard and screen-reader contract the previous three competing
 * implementations never satisfied: focus trap, focus restore, inert
 * background, ESC on the topmost dialog only, and scroll lock symmetry.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountIndexHtml, flush } from '../helpers/page.js';
import {
  initModalSystem,
  openModal,
  closeModal,
  closeAllModals,
  isOpen,
  openCount,
  __resetModalsForTests,
} from '../../src/app/modal.js';

function key(k, opts = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
}

describe('modal system', () => {
  beforeEach(() => {
    __resetModalsForTests();
    mountIndexHtml();
    initModalSystem();
  });
  afterEach(() => __resetModalsForTests());

  it('every overlay the code opens exists in the document', () => {
    for (const id of ['auth-modal', 'idea-modal', 'cal-modal']) {
      expect(document.getElementById(id), id).not.toBeNull();
      expect(document.getElementById(id).classList.contains('modal-overlay'), id).toBe(true);
    }
  });

  it('opens and closes, keeping aria-hidden in sync', () => {
    const modal = document.getElementById('auth-modal');
    expect(modal.getAttribute('aria-hidden')).toBe('true');

    openModal('auth-modal');
    expect(modal.classList.contains('modal--open')).toBe(true);
    expect(modal.getAttribute('aria-hidden')).toBe('false');

    closeModal('auth-modal');
    expect(modal.classList.contains('modal--open')).toBe(false);
    expect(modal.getAttribute('aria-hidden')).toBe('true');
  });

  it('returns focus to the element that opened it', async () => {
    const trigger = document.getElementById('nav-join-btn');
    trigger.focus();
    openModal('auth-modal', { trigger });
    await flush();
    expect(document.activeElement).not.toBe(trigger);

    closeModal('auth-modal');
    expect(document.activeElement).toBe(trigger);
  });

  it('moves focus into the dialog on open', async () => {
    openModal('auth-modal', { focus: '#login-email' });
    await flush();
    expect(document.activeElement.id).toBe('login-email');
  });

  it('closes on Escape', () => {
    openModal('idea-modal');
    expect(isOpen('idea-modal')).toBe(true);
    key('Escape');
    expect(isOpen('idea-modal')).toBe(false);
  });

  it('Escape closes only the topmost dialog when two are stacked', () => {
    openModal('auth-modal');
    openModal('idea-modal');
    expect(openCount()).toBe(2);
    key('Escape');
    expect(isOpen('idea-modal')).toBe(false);
    expect(isOpen('auth-modal')).toBe(true);
    key('Escape');
    expect(openCount()).toBe(0);
  });

  it('traps Tab inside the open dialog', async () => {
    openModal('auth-modal');
    await flush();
    const modal = document.getElementById('auth-modal');
    const focusables = [
      ...modal.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ),
    ].filter((el) => !el.closest('[hidden]'));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    key('Tab');
    expect(document.activeElement).toBe(first);

    first.focus();
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('marks the background inert while open and restores it on close', () => {
    openModal('auth-modal');
    const pageWrap = document.querySelector('.page-wrap');
    expect(pageWrap.hasAttribute('inert')).toBe(true);
    closeModal('auth-modal');
    expect(pageWrap.hasAttribute('inert')).toBe(false);
  });

  it('locks and unlocks body scroll symmetrically, even when stacked', () => {
    openModal('auth-modal');
    expect(document.body.style.overflow).toBe('hidden');
    openModal('idea-modal');
    closeModal('idea-modal');
    expect(document.body.style.overflow).toBe('hidden'); // auth still open
    closeModal('auth-modal');
    expect(document.body.style.overflow).toBe('');
  });

  it('closes when the backdrop itself is clicked, not when the card is', () => {
    openModal('auth-modal');
    const overlay = document.getElementById('auth-modal');
    overlay.querySelector('.modal-card').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isOpen('auth-modal')).toBe(true);
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(isOpen('auth-modal')).toBe(false);
  });

  it('closes from the declarative [data-modal-close] button', () => {
    openModal('idea-modal');
    document.getElementById('idea-modal-close').click();
    expect(isOpen('idea-modal')).toBe(false);
  });

  it('clears the inline style overrides the old controller used to leave behind', () => {
    const modal = document.getElementById('auth-modal');
    modal.style.opacity = '1';
    modal.style.visibility = 'visible';
    openModal('auth-modal');
    closeModal('auth-modal');
    expect(modal.style.opacity).toBe('');
    expect(modal.style.visibility).toBe('');
  });

  it('is idempotent: opening twice does not stack the same dialog', () => {
    openModal('auth-modal');
    openModal('auth-modal');
    expect(openCount()).toBe(1);
  });

  it('never throws for a missing element', () => {
    expect(() => openModal('does-not-exist')).not.toThrow();
    expect(openModal('does-not-exist')).toBe(false);
  });

  it('closeAllModals empties the stack and releases the page', () => {
    openModal('auth-modal');
    openModal('idea-modal');
    closeAllModals();
    expect(openCount()).toBe(0);
    expect(document.body.style.overflow).toBe('');
    expect(document.querySelector('.page-wrap').hasAttribute('inert')).toBe(false);
  });
});
