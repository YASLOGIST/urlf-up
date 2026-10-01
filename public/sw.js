/* eslint-env serviceworker */
/**
 * sw.js — offline shell for UrLife.
 *
 * ── Why the previous one was dangerous ─────────────────────────────────────
 * The whole of the old worker was:
 *
 *   install: caches.open('urlf-up-v1').then(c => c.addAll(['./','./manifest.json']))
 *   fetch:   caches.match(req).then(r => r || fetch(req))
 *
 * Four defects:
 *   1. **Permanent staleness.** Cache-first on the navigation request with no
 *      revalidation and no cache-busting means the FIRST `index.html` a
 *      visitor ever received is the one they keep. Vite hashes its assets, so
 *      a stale `index.html` references chunk filenames that no longer exist
 *      on the server → a blank page that only a manual cache purge fixes.
 *   2. **No version cleanup.** Nothing ever deleted an old cache, so storage
 *      grew without bound across deploys.
 *   3. **Everything was cached, including POSTs and cross-origin requests.**
 *      `caches.match` on a Supabase auth POST is a no-op that still costs a
 *      cache lookup on the critical path of every API call.
 *   4. `addAll(['./'])` fails the whole install if any one entry 404s, which
 *      silently leaves the user with no worker at all.
 *
 * ── Strategy now ───────────────────────────────────────────────────────────
 *   navigation   → network-first with a 4s timeout, falling back to the
 *                  cached shell, falling back to an inline offline page.
 *   hashed asset → cache-first (immutable by construction).
 *   other static → stale-while-revalidate.
 *   non-GET / cross-origin / Supabase → never touched.
 */

const VERSION = 'v3';
const SHELL_CACHE = `urlife-shell-${VERSION}`;
const ASSET_CACHE = `urlife-assets-${VERSION}`;
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE]);

const SHELL_URLS = ['./', './index.html', './manifest.webmanifest', './icons/favicon.svg'];
const NAV_TIMEOUT_MS = 4000;

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — UrLife</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;min-height:100svh;display:grid;place-items:center;background:#0B0B0B;color:#F5F5F5;
      font:400 16px/1.6 Inter,system-ui,sans-serif;text-align:center;padding:24px}
 h1{font-size:1.5rem;margin:0 0 8px;color:#D4AF37}
 p{margin:0 0 20px;color:rgba(245,245,245,.62);max-width:38ch}
 button{background:#D4AF37;color:#0B0B0B;border:0;border-radius:8px;padding:12px 24px;
        font:600 15px Inter,system-ui,sans-serif;cursor:pointer}
</style></head>
<body><main><h1>You are offline</h1>
<p>UrLife could not reach the network. Reconnect and try again — your place will be restored.</p>
<button onclick="location.reload()">Retry</button></main></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Add entries individually: one 404 must not abort the whole install.
      await Promise.all(
        SHELL_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !KEEP.has(n)).map((n) => caches.delete(n)));
      // Trim the asset cache so a long-lived install cannot grow forever.
      const assets = await caches.open(ASSET_CACHE);
      const keys = await assets.keys();
      if (keys.length > 120) {
        await Promise.all(keys.slice(0, keys.length - 120).map((k) => assets.delete(k)));
      }
      await self.clients.claim();
    })()
  );
});

/** Vite emits `name-[hash].ext`; those are safe to cache forever. */
function isImmutable(url) {
  return /\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|svg|jpg|webp|avif)$/.test(url.pathname);
}

function isStatic(url) {
  return /\.(?:css|js|mjs|png|jpg|jpeg|webp|avif|svg|ico|woff2?|json|webmanifest)$/.test(url.pathname);
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    clearTimeout(timer);
    const cached = (await cache.match(request)) || (await cache.match('./index.html')) || (await cache.match('./'));
    return (
      cached ||
      new Response(OFFLINE_HTML, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never intercept: non-GET, cross-origin, range requests, or API traffic.
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (isStatic(url)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

/** Lets the page trigger an immediate update ("a new version is available"). */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
