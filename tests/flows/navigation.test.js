/**
 * Flow: responsive primary navigation.
 *
 * The links are rendered from the production document so a future refactor
 * cannot silently remove the only mobile entry point again.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountIndexHtml } from '../helpers/page.js';
import { initMobileNavigation } from '../../src/app/navigation.js';

let navigation;

function setViewport(width) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

describe('responsive primary navigation', () => {
  beforeEach(() => {
    mountIndexHtml();
    setViewport(390);
    navigation = initMobileNavigation();
  });

  afterEach(() => navigation?.destroy());

  it('ships a real menu control for the links hidden on narrow screens', () => {
    const button = document.getElementById('nav-menu-btn');
    const links = document.getElementById('primary-links');

    expect(button).not.toBeNull();
    expect(button.getAttribute('aria-controls')).toBe('primary-links');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(links.getAttribute('aria-hidden')).toBe('true');
    expect(links.querySelectorAll('a')).toHaveLength(5);
  });

  it('opens the drawer, exposes its links, and locks page scroll', () => {
    const button = document.getElementById('nav-menu-btn');
    const links = document.getElementById('primary-links');

    button.click();

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Close navigation');
    expect(links.classList.contains('is-open')).toBe(true);
    expect(links.getAttribute('aria-hidden')).toBe('false');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes on Escape and returns focus to the menu button', () => {
    const button = document.getElementById('nav-menu-btn');
    button.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.getElementById('primary-links').classList.contains('is-open')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
    expect(document.body.style.overflow).toBe('');
  });

  it('closes after selecting a section and restores the previous overflow value', () => {
    const button = document.getElementById('nav-menu-btn');
    const link = document.querySelector('#primary-links a[href="#roles"]');
    document.body.style.overflow = 'auto';

    button.click();
    link.click();

    expect(document.getElementById('primary-links').classList.contains('is-open')).toBe(false);
    expect(document.body.style.overflow).toBe('auto');
  });

  it('promotes the links back to desktop navigation when the viewport grows', () => {
    const button = document.getElementById('nav-menu-btn');
    const links = document.getElementById('primary-links');
    button.click();

    setViewport(1280);
    window.dispatchEvent(new Event('resize'));

    expect(links.classList.contains('is-open')).toBe(false);
    expect(links.getAttribute('aria-hidden')).toBe('false');
    expect(document.body.style.overflow).toBe('auto');
  });

  it('updates the control label when the document language changes', () => {
    const button = document.getElementById('nav-menu-btn');
    document.documentElement.lang = 'ar';
    window.dispatchEvent(new CustomEvent('urlife:langchange'));

    expect(button.getAttribute('aria-label')).toBe('فتح القائمة');
  });
});
