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
import { boot } from './app/boot.js';
import { logger } from './lib/logger.js';

// The interaction engine attaches its own capture-phase listener at import
// time; keeping it in the static graph preserves the existing telemetry and
// orphan-click behaviour.
import './core.js';

function start() {
  boot().catch((err) => logger.error('boot', 'fatal', err));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

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
              window.dispatchEvent(new CustomEvent('urlife:update-available'));
              logger.info('sw', 'a new version is available');
            }
          });
        });
      })
      .catch((err) => logger.warn('sw', 'registration failed', err));
  });
}
