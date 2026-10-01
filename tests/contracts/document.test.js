/**
 * Static contracts on the shipped document, the policy header and the PWA
 * assets. Each assertion encodes a defect that was actually present before
 * the upgrade, so the suite fails loudly if any of them regresses.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readIndexHtml, duplicateIds } from '../helpers/page.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readIndexHtml();

/**
 * The document carries long explanatory comments documenting what was removed
 * and why. Those comments legitimately quote the old markup, so every
 * assertion about what the page *contains* must run against the
 * comment-stripped source.
 */
const markup = html.replace(/<!--[\s\S]*?-->/g, '');

function cspDirectives() {
  const m = html.match(/http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"/i);
  if (!m) return null;
  const map = new Map();
  for (const part of m[1].split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    map.set(tokens[0], tokens.slice(1));
  }
  return map;
}

describe('index.html structure', () => {
  it('has no duplicate element ids', () => {
    expect(duplicateIds(html)).toEqual([]);
  });

  it('declares exactly one module entry point', () => {
    const entries = [...markup.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g)].map((m) => m[1]);
    expect(entries).toEqual(['/src/main.js']);
  });

  it('does not hard-code the Vite dev client (it 404s in any other context)', () => {
    expect(markup).not.toContain('@vite/client');
  });

  it('carries no large inline <style> block', () => {
    const blocks = [...markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1].length);
    expect(Math.max(0, ...blocks)).toBeLessThan(2048);
  });

  it('carries no executable inline <script> (only ld+json)', () => {
    const scripts = [...markup.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    const executable = scripts.filter(
      ([, attrs, body]) => body.trim().length > 0 && !/type="application\/ld\+json"/.test(attrs)
    );
    expect(executable.map(([, a]) => a)).toEqual([]);
  });

  it('exposes the landmarks a screen reader navigates by', () => {
    expect(markup).toMatch(/<main\b[^>]*id="main"/);
    expect(markup).toMatch(/<nav\b[^>]*aria-label="Primary"/);
    expect(markup).toMatch(/<footer\b/);
    expect(markup).toMatch(/class="skip-link"[^>]*href="#main"/);
  });

  it('contains the elements the render engine queries', () => {
    // `#canvas3d` and `#app` were queried by code and absent from the page.
    expect(markup).toContain('id="field-canvas"');
    expect(markup).toContain('class="field-fallback"');
    expect(markup).toContain('id="toast-container"');
  });

  it('declares SEO metadata', () => {
    expect(markup).toMatch(/<meta name="description"\s+content="[^"]{80,}"/);
    expect(markup).toMatch(/<link rel="canonical"/);
    expect(markup).toMatch(/property="og:image"/);
    expect(markup).toMatch(/name="twitter:card"/);
    expect(markup).toMatch(/hreflang="ar"/);
    expect(markup).toMatch(/application\/ld\+json/);
  });

  it('every <img> has an alt attribute', () => {
    const imgs = [...markup.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
    expect(imgs.filter((t) => !/\balt=/.test(t))).toEqual([]);
  });

  it('every form control referenced by an error slot exists', () => {
    for (const id of [
      'login-email',
      'login-password',
      'register-name',
      'register-email',
      'register-password',
      'register-role',
      'register-skills',
      'idea-title',
      'idea-industry',
      'idea-problem',
      'idea-skills',
      'magic-link-submit',
    ]) {
      expect(markup, id).toContain(`id="${id}"`);
    }
  });
});

describe('Content-Security-Policy', () => {
  const csp = cspDirectives();

  it('is present', () => {
    expect(csp).not.toBeNull();
  });

  it('allows the Cal.com booking iframe (it was blocked by default-src)', () => {
    expect(csp.has('frame-src')).toBe(true);
    expect(csp.get('frame-src').join(' ')).toMatch(/cal\.com/);
  });

  it('no longer permits inline script execution', () => {
    expect(csp.get('script-src')).toEqual(["'self'"]);
  });

  it('locks down the dangerous defaults', () => {
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('allows the Supabase REST and realtime origins', () => {
    const connect = csp.get('connect-src').join(' ');
    expect(connect).toMatch(/https:\/\/\*\.supabase\.co/);
    expect(connect).toMatch(/wss:\/\/\*\.supabase\.co/);
  });

  it('never allows a wildcard default-src', () => {
    expect(csp.get('default-src')).toEqual(["'self'"]);
  });
});

describe('PWA assets', () => {
  const manifestPath = resolve(ROOT, 'public/manifest.webmanifest');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  it('is referenced by the document', () => {
    expect(markup).toContain('manifest.webmanifest');
  });

  it('ships only first-party icons (no placeholder CDN)', () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(8);
    for (const icon of manifest.icons) {
      expect(icon.src, icon.src).not.toMatch(/^https?:/);
      expect(existsSync(resolve(ROOT, 'public', icon.src)), icon.src).toBe(true);
    }
  });

  it('includes both a 192 and a 512 maskable icon', () => {
    const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
    expect(maskable.map((i) => i.sizes).sort()).toEqual(['192x192', '512x512']);
  });

  it('uses the canonical brand colours', () => {
    expect(manifest.theme_color).toBe('#0B0B0B');
    expect(manifest.background_color).toBe('#0B0B0B');
  });

  it('declares scope, id and a start_url inside that scope', () => {
    expect(manifest.scope).toBe('./');
    expect(manifest.start_url.startsWith('./')).toBe(true);
    expect(manifest.id).toBeTruthy();
  });
});

/**
 * Open Graph is the highest-leverage conversion surface the product has, and
 * it was silently broken: `og:image` pointed at an SVG, which Facebook,
 * LinkedIn, Slack, WhatsApp, Discord and X all refuse to render. These
 * assertions make that class of defect impossible to reintroduce — including
 * a structural walk of the generated GIF, which doubles as a test of the
 * encoder in `scripts/lib/gif.mjs`.
 */
describe('Open Graph card', () => {
  /** Content values of every `<meta>` with this property, in document order. */
  const metaAll = (prop, attr = 'property') =>
    [...markup.matchAll(new RegExp(`<meta\\s+${attr}="${prop}"\\s+content="([^"]*)"`, 'g'))].map((m) => m[1]);

  const images = [...metaAll('og:image'), ...metaAll('twitter:image', 'name')];

  it('declares at least one og:image and one twitter:image', () => {
    expect(metaAll('og:image').length).toBeGreaterThanOrEqual(1);
    expect(metaAll('twitter:image', 'name').length).toBe(1);
  });

  it('never serves SVG to a crawler — no major unfurler renders it', () => {
    for (const src of images) expect(src, src).not.toMatch(/\.svg(\?|$)/i);
  });

  it('leads with the animated GIF, and every declared image exists in public/', () => {
    expect(metaAll('og:image')[0]).toMatch(/\/og-image-animated\.gif$/);
    for (const src of images) {
      const file = resolve(ROOT, 'public', new URL(src).pathname.replace(/^\//, ''));
      expect(existsSync(file), src).toBe(true);
    }
  });

  it('declares the 1.91:1 dimensions every unfurler lays out against', () => {
    expect(metaAll('og:image:width')).toEqual(['1200', '1200']);
    expect(metaAll('og:image:height')).toEqual(['630', '630']);
    expect(metaAll('og:image:type')).toEqual(['image/gif', 'image/png']);
  });

  it('gives the card alternative text', () => {
    expect(metaAll('og:image:alt')[0].length).toBeGreaterThan(20);
    expect(metaAll('twitter:image:alt', 'name')[0].length).toBeGreaterThan(20);
  });

  /**
   * Walks the GIF block by block. A malformed sub-block chain, a wrong canvas
   * size or a missing loop extension all fail here rather than in someone's
   * Slack channel.
   */
  const gif = readFileSync(resolve(ROOT, 'public/og-image-animated.gif'));

  function walkGIF(buf) {
    expect(buf.subarray(0, 6).toString('ascii')).toBe('GIF89a');
    const width = buf.readUInt16LE(6);
    const height = buf.readUInt16LE(8);
    const packed = buf[10];
    let p = 13;
    if (packed & 0x80) p += 3 * 2 ** ((packed & 7) + 1);

    const skipSubBlocks = () => {
      for (;;) {
        const len = buf[p++];
        if (!len) return;
        p += len;
      }
    };

    let frames = 0;
    let loops = null;
    let delay = null;
    for (;;) {
      const marker = buf[p++];
      if (marker === 0x3b) break; // trailer
      if (marker === 0x21) {
        const label = buf[p++];
        if (label === 0xf9) {
          delay ??= buf.readUInt16LE(p + 2);
        } else if (label === 0xff && buf.subarray(p + 1, p + 12).toString('ascii') === 'NETSCAPE2.0') {
          loops = buf.readUInt16LE(p + 15);
        }
        skipSubBlocks();
      } else if (marker === 0x2c) {
        frames++;
        const lp = buf[p + 8];
        p += 9;
        if (lp & 0x80) p += 3 * 2 ** ((lp & 7) + 1);
        p += 1; // LZW minimum code size
        skipSubBlocks();
      } else {
        throw new Error(`unknown block 0x${marker.toString(16)} at ${p - 1}`);
      }
    }
    return { width, height, frames, loops, delay, consumed: p };
  }

  const info = walkGIF(gif);

  it('is a structurally complete GIF89a that ends exactly at its trailer', () => {
    expect(info.consumed).toBe(gif.length);
  });

  it('is 1200×630, multi-frame, and loops forever', () => {
    expect([info.width, info.height]).toEqual([1200, 630]);
    expect(info.frames).toBeGreaterThanOrEqual(24);
    expect(info.loops).toBe(0);
  });

  it('uses a frame delay no browser will silently rewrite (≥ 4 cs)', () => {
    expect(info.delay).toBeGreaterThanOrEqual(4);
  });

  it('stays well inside the 5 MB ceiling crawlers enforce', () => {
    expect(gif.length).toBeLessThan(2 * 1024 * 1024);
  });

  it('ships a true-colour still of the same card at the same size', () => {
    const png = readFileSync(resolve(ROOT, 'public/og-cover.png'));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});

describe('service worker', () => {
  const sw = readFileSync(resolve(ROOT, 'public/sw.js'), 'utf8');

  it('versions its caches and deletes old ones on activate', () => {
    expect(sw).toMatch(/const VERSION\s*=/);
    expect(sw).toMatch(/caches\.delete/);
  });

  it('uses network-first for navigations so a stale shell cannot strand users', () => {
    expect(sw).toMatch(/request\.mode === 'navigate'/);
    expect(sw).toMatch(/networkFirst/);
  });

  it('ignores non-GET and cross-origin traffic', () => {
    expect(sw).toMatch(/request\.method !== 'GET'/);
    expect(sw).toMatch(/url\.origin !== self\.location\.origin/);
  });

  it('ships an offline fallback document', () => {
    expect(sw).toMatch(/OFFLINE_HTML/);
  });
});

describe('crawl and indexing files', () => {
  it('ships robots.txt pointing at the sitemap', () => {
    const robots = readFileSync(resolve(ROOT, 'public/robots.txt'), 'utf8');
    expect(robots).toMatch(/Sitemap:\s*https:\/\//);
  });

  it('ships a sitemap with hreflang alternates', () => {
    const sitemap = readFileSync(resolve(ROOT, 'public/sitemap.xml'), 'utf8');
    expect(sitemap).toMatch(/hreflang="ar"/);
    expect(sitemap).toMatch(/hreflang="x-default"/);
  });
});

describe('dependency hygiene', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

  it('does not ship React or three.js for a vanilla-JS application', () => {
    for (const dep of ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei']) {
      expect(Object.keys(pkg.dependencies ?? {}), dep).not.toContain(dep);
    }
  });

  /**
   * `@capacitor/core` is consumed by the native iOS/Android shells through
   * `capacitor.config.ts`, not by `src/`, so it is exempt by name rather than
   * by weakening the rule.
   */
  const NATIVE_SHELL_ONLY = new Set(['@capacitor/core']);

  it('every runtime dependency is actually imported somewhere in src/', () => {
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (NATIVE_SHELL_ONLY.has(dep)) continue;
      const hits = execSync(`grep -rl "from '${dep}'\\|from \\"${dep}\\"\\|import('${dep}')" src || true`, {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim();
      expect(hits, `${dep} is declared but never imported`).not.toBe('');
    }
  });
});
