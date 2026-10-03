import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountIndexHtml, flush } from '../helpers/page.js';
import { initModalSystem, __resetModalsForTests, openCount } from '../../src/app/modal.js';
import { initI18n, setLanguage, __resetI18nForTests } from '../../src/app/i18n.js';

describe('terms workspace', () => {
  beforeEach(() => {
    mountIndexHtml();
    initModalSystem();
    initI18n();
  });

  afterEach(() => {
    __resetModalsForTests();
    __resetI18nForTests();
  });

  function openWorkspace(onReady = vi.fn()) {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = 'Open terms workspace';
    document.body.appendChild(trigger);
    trigger.focus();

    return import('../../src/components/DealRoom.js').then(({ openDealRoom }) => {
      openDealRoom(
        { idea_title: 'Cross-border settlement', full_name: 'Ada Lovelace', role_type: 'builder' },
        onReady,
        { trigger }
      );
      return { trigger, onReady };
    });
  }

  it('uses the shared modal lifecycle rather than a second unmanaged dialog', async () => {
    const { trigger } = await openWorkspace();
    await flush();

    const dialog = document.getElementById('deal-room-modal');
    expect(dialog).not.toBeNull();
    expect(openCount()).toBe(1);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBe('deal-draft-notice');
    expect(document.querySelector('.page-wrap').hasAttribute('inert')).toBe(true);
    expect(document.activeElement.id).toBe('deal-equity');

    dialog.querySelector('.deal-room-close').click();
    await flush();
    expect(document.getElementById('deal-room-modal')).toBeNull();
    expect(openCount()).toBe(0);
    expect(document.activeElement).toBe(trigger);
  });

  it('validates proposed shares and marks only a local discussion draft as ready', async () => {
    const onReady = vi.fn();
    await openWorkspace(onReady);
    await flush();

    const form = document.querySelector('.deal-room-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const error = document.querySelector('.deal-room-error');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toMatch(/percentage/i);
    expect(document.getElementById('deal-equity').getAttribute('aria-invalid')).toBe('true');

    document.getElementById('deal-equity').value = '15';
    document.getElementById('deal-revenue').value = '5';
    document.getElementById('deal-milestone').value = 'MVP launch';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(onReady).toHaveBeenCalledWith({ equity: 15, revenue: 5, milestone: 'MVP launch' });
    expect(document.querySelector('.deal-room-status').textContent).toMatch(/not been saved or sent/i);
    expect(document.querySelector('.deal-room-form button[type="submit"]').disabled).toBe(true);
    const copy = document.getElementById('deal-room-modal').textContent.toLowerCase();
    expect(copy).toContain('nothing is signed, sent, funded, or placed in escrow');
    expect(copy).not.toContain('locked in escrow');
    expect(copy).not.toContain('cryptographic');
  });

  it('renders the same truth boundary in Arabic', async () => {
    setLanguage('ar');
    await openWorkspace();
    await flush();

    const dialog = document.getElementById('deal-room-modal');
    expect(dialog.textContent).toContain('مسودة للنقاش فقط');
    expect(dialog.querySelector('#deal-equity').getAttribute('placeholder')).toBe('مثال: 15');
  });
});
