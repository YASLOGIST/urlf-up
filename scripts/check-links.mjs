#!/usr/bin/env node
/**
 * check-links.mjs — external link liveness gate.
 *
 * Why this exists: the "Request a Closed Meeting" conversion path embeds a
 * Cal.com iframe whose URL is baked into the build (`CAL_LINK` in
 * src/lib/env.js, overridable with VITE_CAL_LINK). On 2026-10-02 that link was
 * measured dead — https://cal.com/ahmed-urlfxup/15min returns 404 because the
 * username `ahmed-urlfxup` has never been registered on cal.com — and nothing
 * in the repository could ever notice. A visitor who clicked the site's core
 * CTA saw Cal.com's 404 page inside the booking modal.
 *
 * What it checks:
 *   - functional links  — URLs a visitor's browser actually requests:
 *     the Cal booking link and the Google Fonts stylesheet. Dead ⇒ exit 1.
 *   - deployment links  — the canonical/OG/sitemap URLs on the production
 *     origin. Reported always; fatal only with --strict, because a pre-launch
 *     repository may deliberately declare a domain it has not deployed yet.
 *
 * Bot-walled responses (401/403/429) are reported as "blocked", not dead:
 * they prove the host resolved and answered, which is all this gate needs.
 *
 * Usage:
 *   node scripts/check-links.mjs                 # functional links are fatal
 *   node scripts/check-links.mjs --strict        # deployment links fatal too
 *   node scripts/check-links.mjs <url> [url…]    # ad-hoc check of given URLs
 *
 * Exit codes: 0 = no dead functional links · 1 = dead link found · 2 = usage.
 */

import { readFile } from 'node:fs/promises';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 urlife-link-check/1.0';
const TIMEOUT_MS = 15_000;

/* ── URL collection ─────────────────────────────────────────────────────── */

const DEPLOYMENT_ORIGIN = 'https://urlifeisup.com';

/** Extract every absolute https URL from a text blob, de-duplicated. */
function extractUrls(text) {
  const out = new Set();
  for (const match of text.matchAll(/https:\/\/[^\s"'<>);&,]+/g)) {
    let url = match[0].replace(/[.,;:]+$/, '');
    // CSP directive hosts like https://*.cal.com are patterns, not URLs.
    if (url.includes('*')) continue;
    // Markup placeholder from the avatar URL example input.
    if (url.endsWith('…')) continue;
    out.add(url);
  }
  return [...out];
}

async function collectFromRepo() {
  const links = new Map(); // url → { kind, source }

  const add = (url, kind, source) => {
    if (!links.has(url)) links.set(url, { kind, source });
  };

  // 1. The booking link — the one URL whose death breaks the core CTA.
  const env = await readFile('src/lib/env.js', 'utf8');
  const cal = env.match(/CAL_LINK\s*=\s*read\([^)]*\)\s*\|\|\s*'([^']+)'/);
  if (cal) add(cal[1], 'functional', 'src/lib/env.js CAL_LINK default');
  const localEnv = await readFile('.env.local', 'utf8').catch(() => '');
  const localCal = localEnv.match(/^VITE_CAL_LINK=(\S+)\s*$/m);
  if (localCal) add(localCal[1], 'functional', '.env.local VITE_CAL_LINK');

  // 2. Every absolute URL the shipped document references.
  const html = await readFile('index.html', 'utf8');
  for (const url of extractUrls(html)) {
    if (url.startsWith(DEPLOYMENT_ORIGIN)) add(url, 'deployment', 'index.html');
    else if (url.startsWith('https://fonts.')) {
      // Only the stylesheet is a resource the page needs. Bare preconnect
      // origins are connection hints — the stylesheet check covers them.
      if (url.includes('/css2?')) add(url, 'functional', 'index.html <head>');
    }
    // schema.org is a vocabulary namespace, not a fetched resource.
    else if (url.startsWith('https://schema.org')) continue;
  }

  // 3. Sitemap locations.
  const sitemap = await readFile('public/sitemap.xml', 'utf8').catch(() => '');
  for (const url of extractUrls(sitemap)) {
    if (url.startsWith(DEPLOYMENT_ORIGIN)) add(url, 'deployment', 'public/sitemap.xml');
  }

  return [...links.entries()].map(([url, meta]) => ({ url, ...meta }));
}

/* ── Liveness probing ───────────────────────────────────────────────────── */

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET', // HEAD is rejected by some hosts; a GET of a page/asset is cheap
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': UA, accept: '*/*' },
    });
    if (res.ok) return { status: 'ok', code: res.status, note: res.redirected ? `→ ${res.url}` : '' };
    if ([401, 403, 429, 503].includes(res.status)) {
      return { status: 'blocked', code: res.status, note: 'host answered; bot-walled (not dead)' };
    }
    return { status: 'dead', code: res.status, note: 'HTTP error' };
  } catch (err) {
    const cause = err?.cause?.code || err?.name || 'unknown';
    const note =
      cause === 'ENOTFOUND' || cause === 'EAI_AGAIN'
        ? 'DNS does not resolve'
        : cause === 'AbortError'
          ? `no answer within ${TIMEOUT_MS / 1000}s`
          : cause === 'CERT_HAS_EXPIRED'
            ? 'TLS certificate expired'
            : `connection failed (${cause})`;
    return { status: 'unreachable', code: null, note };
  } finally {
    clearTimeout(timer);
  }
}

/* ── Main ───────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const adHoc = args.filter((a) => !a.startsWith('--'));

if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: node scripts/check-links.mjs [--strict] [url …]');
  process.exit(0);
}

const targets = adHoc.length
  ? adHoc.map((url) => ({ url, kind: 'functional', source: 'argument' }))
  : await collectFromRepo();

if (!targets.length) {
  console.error('check-links: no URLs found — nothing to do (build the document first?)');
  process.exit(2);
}

console.log(`\n  ${targets.length} external link${targets.length === 1 ? '' : 's'} to check\n`);

const rows = [];
for (const target of targets) {
  const result = await probe(target.url);
  rows.push({ ...target, ...result });
  const mark = result.status === 'ok' ? '✓' : result.status === 'blocked' ? '~' : '✗';
  console.log(
    `  ${mark} ${result.status.toUpperCase().padEnd(11)} ` +
      `${result.code ?? '—'}  ${target.url}` +
      (result.note ? `   (${result.note})` : '')
  );
}

const dead = rows.filter((r) => r.status === 'dead' || r.status === 'unreachable');
const blocked = rows.filter((r) => r.status === 'blocked');
const fatal = dead.filter((r) => strict || r.kind === 'functional');

console.log(
  `\n  ${rows.length} checked · ${rows.length - dead.length - blocked.length} ok · ` +
    `${blocked.length} bot-walled · ${dead.length} dead\n`
);

if (fatal.length) {
  for (const row of fatal) {
    console.error(`  DEAD ${row.kind} link (${row.source}): ${row.url} — ${row.note}`);
  }
  if (fatal.some((r) => r.url.includes('cal.com'))) {
    console.error(
      '\n  The booking link is dead. Fix: register the Cal.com username OR set\n' +
        '  VITE_CAL_LINK in .env.local to a live booking page (and keep the CSP\n' +
        '  frame-src directive in index.html in sync with the new host).\n'
    );
  }
  process.exit(1);
}

if (dead.length) {
  console.log('  Non-fatal dead links (pass --strict to make them fail):');
  for (const row of dead) console.log(`    ${row.url} — ${row.note} [${row.kind}]`);
}
process.exit(0);
