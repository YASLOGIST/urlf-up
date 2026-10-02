/**
 * main.js — the ONE module entry point for the application.
 *
 * index.html loads exactly this file. Everything else is reached through the
 * import graph (or a dynamic import), which lets Vite build a correct
 * dependency order, split chunks sensibly, and hash every asset.
 *
 * Previously index.html loaded eight independent module entries, each racing
 * the others. See the header of src/app/boot.js for the full account.
 */

import './styles/index.css';
import { boot, teardownBoot } from './app/boot.js';
import { showNotice } from './app/network.js';
import { logger } from './lib/logger.js';

function start() {
  boot().catch((err) => logger.error('boot', 'fatal', err));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

// Vite can re-evaluate this module during development. Release every owned
// observer/listener before the replacement boot runs instead of stacking them.
if (import.meta.hot) import.meta.hot.dispose(teardownBoot);

/* ── Service worker ────────────────────────────────────────────────────────
 * Registered after `load` so it never competes with the critical path for
 * bandwidth, and only in a secure context (it throws on plain http://).
 * `import.meta.env.DEV` guards against the SW caching Vite's dev modules,
 * which is the classic "my edits do not appear" trap.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        logger.debug('sw', 'registered', { scope: reg.scope });
        // Surface an update without forcing a reload on the user.
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          next?.addEventListener('statechange', () => {
            if (next.state === 'installed' && navigator.serviceWorker.controller) {
              const message = document.createElement('span');
              message.textContent = 'A new version of UrLife is ready.';
              const reload = document.createElement('button');
              reload.type = 'button';
              reload.textContent = 'Update now';
              reload.addEventListener('click', () => window.location.reload(), { once: true });
              showNotice([message, reload], { id: 'app-update' });
              window.dispatchEvent(new CustomEvent('urlife:update-available'));
              logger.info('sw', 'a new version is available');
            }
          });
        });
      })
      .catch((err) => logger.warn('sw', 'registration failed', err));
  });
}
