/**
 * Automated accessibility audit with axe-core, run against the real
 * `index.html` in three states: default, Arabic/RTL, and with a dialog open.
 *
 * jsdom has no layout engine, so colour-contrast and any rule that needs
 * geometry cannot be evaluated here; those rules are disabled explicitly
 * rather than silently passing. Everything structural — names, roles,
 * labels, landmarks, heading order, duplicate ids, ARIA validity — is real.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axe from 'axe-core';
import { mountIndexHtml, flush } from '../helpers/page.js';
import { initI18n, setLanguage, __resetI18nForTests } from '../../src/app/i18n.js';
import { initModalSystem, openModal, __resetModalsForTests } from '../../src/app/modal.js';

/** Rules that require real layout/paint and cannot be judged inside jsdom. */
const LAYOUT_DEPENDENT = ['color-contrast', 'scrollable-region-focusable', 'target-size', 'meta-viewport'];

const AXE_OPTIONS = {
  resultTypes: ['violations'],
  // The meeting dialog hosts a cross-origin Cal.com iframe. axe cannot (and
  // must not) reach into it, and jsdom has no frame messaging, so frame
  // traversal is off. The embed's own accessibility is Cal.com's contract.
  iframes: false,
  rules: Object.fromEntries(LAYOUT_DEPENDENT.map((id) => [id, { enabled: false }])),
};

async function analyse(context = document) {
  const results = await axe.run(context, AXE_OPTIONS);
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 4).map((n) => n.html.slice(0, 160)),
  }));
}

describe('accessibility — axe-core', () => {
  beforeEach(() => {
    __resetI18nForTests();
    __resetModalsForTests();
    mountIndexHtml();
  });
  afterEach(() => {
    __resetI18nForTests();
    __resetModalsForTests();
    localStorage.clear();
  });

  it('has zero violations in the default English state', async () => {
    initI18n();
    initModalSystem();
    await flush();
    const violations = await analyse();
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }, 30000);

  it('has zero violations in Arabic / RTL', async () => {
    initI18n();
    initModalSystem();
    setLanguage('ar');
    await flush();
    expect(document.documentElement.dir).toBe('rtl');
    const violations = await analyse();
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  }, 30000);

  /**
   * While a dialog is open the rest of the page is deliberately `inert`, so
   * the document-scoped rules `landmark-one-main` and `page-has-heading-one`
   * necessarily report — that is the correct modal behaviour, not a defect.
   * The audit is therefore scoped to the dialog subtree, which is exactly the
   * region a user is confined to at that moment.
   */
  for (const [label, id] of [
    ['auth', 'auth-modal'],
    ['idea', 'idea-modal'],
    ['meeting', 'cal-modal'],
  ]) {
    it(`has zero violations inside the ${label} dialog`, async () => {
      initI18n();
      initModalSystem();
      openModal(id);
      await flush();
      const violations = await analyse(document.getElementById(id));
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    }, 30000);
  }
});

describe('accessibility — hand-written invariants axe cannot see', () => {
  beforeEach(() => {
    __resetI18nForTests();
    __resetModalsForTests();
    mountIndexHtml();
  });
  afterEach(() => {
    __resetI18nForTests();
    __resetModalsForTests();
  });

  it('the skip link targets a real, focusable landmark', () => {
    const skip = document.querySelector('.skip-link');
    const target = document.querySelector(skip.getAttribute('href'));
    expect(target).not.toBeNull();
    expect(target.tagName).toBe('MAIN');
    expect(target.getAttribute('tabindex')).toBe('-1');
  });

  it('the decorative canvas and cursor are hidden from assistive tech', () => {
    for (const sel of ['#field-canvas', '#cur', '#cur-ring']) {
      const el = document.querySelector(sel);
      expect(el, sel).not.toBeNull();
      expect(el.getAttribute('aria-hidden'), sel).toBe('true');
    }
  });

  it('the scroll progress bar is a labelled progressbar', () => {
    const bar = document.querySelector('.scroll-progress');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-label')).toBeTruthy();
  });

  it('heading levels never skip a step', () => {
    const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i++) {
      expect(
        levels[i] - levels[i - 1],
        `h${levels[i - 1]} → h${levels[i]} at index ${i}`
      ).toBeLessThanOrEqual(1);
    }
  });

  it('every interactive control has an accessible name', () => {
    const controls = document.querySelectorAll('button, a[href], input, select, textarea');
    const unnamed = [];
    for (const el of controls) {
      if (el.type === 'hidden') continue;
      const name =
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        el.textContent.trim() ||
        el.getAttribute('title') ||
        (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent.trim()) ||
        el.closest('label')?.textContent.trim();
      if (!name) unnamed.push(el.outerHTML.slice(0, 120));
    }
    expect(unnamed).toEqual([]);
  });

  it('every error slot is a live region so screen readers announce it', () => {
    const slots = document.querySelectorAll('[id$="-error"]');
    expect(slots.length).toBeGreaterThan(2);
    for (const slot of slots) {
      expect(slot.getAttribute('role'), slot.id).toBe('alert');
      expect(slot.hasAttribute('hidden'), slot.id).toBe(true);
    }
  });

  it('respects prefers-reduced-motion in CSS, not just in JS', () => {
    const css = ['src/styles/motion.css', 'src/styles/a11y.css', 'src/styles/components.css'];
    const fs = require('node:fs');
    const joined = css.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    expect(joined).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it('provides a visible focus ring that is not removed globally', () => {
    const fs = require('node:fs');
    const a11y = fs.readFileSync('src/styles/a11y.css', 'utf8');
    expect(a11y).toMatch(/:focus-visible/);
    expect(a11y).toMatch(/outline/);
  });
});
