/**
 * Flow: language switching (English ⇄ Arabic).
 *
 * This is the regression test for the headline correctness bug: the AR button
 * flipped `dir` but left every string in English, because the only live
 * listener never read `data-ar`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountIndexHtml } from '../helpers/page.js';
import {
  initI18n,
  setLanguage,
  getLanguage,
  renderRichText,
  __resetI18nForTests,
} from '../../src/app/i18n.js';

describe('language switching', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetI18nForTests();
    mountIndexHtml();
  });
  afterEach(() => {
    __resetI18nForTests();
    localStorage.clear();
  });

  it('the page ships translatable nodes to switch', () => {
    expect(document.querySelectorAll('[data-ar]').length).toBeGreaterThan(100);
  });

  it('clicking AR actually translates the visible copy', () => {
    initI18n();
    const nav = document.querySelector('a[href="#how"]');
    expect(nav.textContent.trim()).toBe('How It Works');

    document.querySelector('.lang-btn[data-lang="ar"]').click();

    expect(nav.textContent.trim()).toBe('كيف يعمل');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.title).toContain('حيث تلتقي العقول');
  });

  it('switching back to EN restores the original copy', () => {
    initI18n();
    const nav = document.querySelector('a[href="#how"]');
    document.querySelector('.lang-btn[data-lang="ar"]').click();
    document.querySelector('.lang-btn[data-lang="en"]').click();
    expect(nav.textContent.trim()).toBe('How It Works');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('reflects the active language in aria-pressed on both buttons', () => {
    initI18n();
    const en = document.querySelector('.lang-btn[data-lang="en"]');
    const ar = document.querySelector('.lang-btn[data-lang="ar"]');
    expect(en.getAttribute('aria-pressed')).toBe('true');
    expect(ar.getAttribute('aria-pressed')).toBe('false');
    ar.click();
    expect(en.getAttribute('aria-pressed')).toBe('false');
    expect(ar.getAttribute('aria-pressed')).toBe('true');
  });

  it('persists the choice across a reload', () => {
    initI18n();
    document.querySelector('.lang-btn[data-lang="ar"]').click();
    expect(localStorage.getItem('urlife:lang')).toBe('ar');

    __resetI18nForTests();
    mountIndexHtml();
    initI18n();
    expect(getLanguage()).toBe('ar');
    expect(document.querySelector('a[href="#how"]').textContent.trim()).toBe('كيف يعمل');
  });

  it('honours ?lang= over the stored value', () => {
    localStorage.setItem('urlife:lang', 'ar');
    const original = window.location.search;
    // jsdom allows replacing location.search via history.
    history.replaceState(null, '', '?lang=en');
    initI18n();
    expect(getLanguage()).toBe('en');
    history.replaceState(null, '', original || '/');
  });

  it('updates the meta description for the active locale', () => {
    initI18n();
    const meta = document.querySelector('meta[name="description"]');
    const before = meta.getAttribute('content');
    setLanguage('ar');
    expect(meta.getAttribute('content')).not.toBe(before);
    expect(meta.getAttribute('content')).toMatch(/[\u0600-\u06FF]/);
  });

  it('keeps the small amount of inline markup translations are allowed', () => {
    initI18n();
    setLanguage('en');
    const hero = document.querySelector('.hero-desc span[data-ar]');
    expect(hero.querySelectorAll('strong').length).toBeGreaterThan(0);
  });
});

describe('renderRichText (translation sanitiser)', () => {
  it('keeps allow-listed inline tags', () => {
    const f = renderRichText('a <strong>b</strong> <em>c</em><br>d');
    const host = document.createElement('div');
    host.appendChild(f);
    expect(host.querySelector('strong')?.textContent).toBe('b');
    expect(host.querySelector('em')?.textContent).toBe('c');
    expect(host.querySelector('br')).not.toBeNull();
  });

  it('drops a <script> element and keeps nothing executable', () => {
    const host = document.createElement('div');
    host.appendChild(renderRichText(`safe<script>window.__pwned = 1</${'script'}>`));
    expect(host.querySelector('script')).toBeNull();
    expect(window.__pwned).toBeUndefined();
  });

  it('drops an <img onerror> payload entirely', () => {
    const host = document.createElement('div');
    host.appendChild(renderRichText('<img src=x onerror="window.__pwned=1">hello'));
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toBe('hello');
    expect(window.__pwned).toBeUndefined();
  });

  it('strips event-handler attributes from allowed tags', () => {
    const host = document.createElement('div');
    host.appendChild(renderRichText('<strong onclick="window.__pwned=1" class="g">x</strong>'));
    const strong = host.querySelector('strong');
    expect(strong.hasAttribute('onclick')).toBe(false);
    expect(strong.getAttribute('class')).toBe('g');
  });

  it('drops class names that are not in the design-system allow-list', () => {
    const host = document.createElement('div');
    host.appendChild(renderRichText('<span class="g evil">x</span>'));
    expect(host.querySelector('span').getAttribute('class')).toBe('g');
  });

  it('unwraps unknown tags but keeps their text', () => {
    const host = document.createElement('div');
    host.appendChild(renderRichText('<div><iframe>bad</iframe>good</div>'));
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('div')).toBeNull();
    expect(host.textContent).toBe('badgood');
  });
});
