/**
 * tests/helpers/page.js — load the REAL index.html into jsdom.
 *
 * The flow specs run against the shipped markup, not a hand-written fixture.
 * That is the point: a test that passes against a fixture tells you nothing
 * about whether the id a module queries actually exists in the document —
 * which is precisely the class of bug this upgrade fixed (`#canvas3d`,
 * `#app`, `#lang-en`, `#magic-link-submit` were all queried by code and
 * absent from the page).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const INDEX_HTML_PATH = resolve(ROOT, 'index.html');

export function readIndexHtml() {
  return readFileSync(INDEX_HTML_PATH, 'utf8');
}

/** Replace the current jsdom document with the real page markup. */
export function mountIndexHtml() {
  const html = readIndexHtml();
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (!bodyMatch) throw new Error('index.html has no <body>');

  // Strip <script> tags: the module graph is imported directly by the spec so
  // we control initialisation order explicitly.
  const body = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '');
  const head = (headMatch?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/gi, '');

  document.documentElement.className = '';
  document.documentElement.setAttribute('lang', 'en');
  document.documentElement.setAttribute('dir', 'ltr');
  document.head.innerHTML = head;
  document.body.innerHTML = body;
  return document;
}

/** Collect duplicate `id` attributes — a hard HTML validity failure. */
export function duplicateIds(html = readIndexHtml()) {
  const counts = new Map();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) {
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => ({ id, count: n }));
}

/**
 * Flush pending microtasks, animation frames and short timers.
 *
 * jsdom's requestAnimationFrame runs on a ~16 ms frame clock when
 * `pretendToBeVisual` is on, so a bare `setTimeout(0)` is not enough to see
 * work scheduled inside a rAF callback.
 */
export async function flush(frames = 3) {
  for (let i = 0; i < frames; i++) {
    await new Promise((resolve) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
