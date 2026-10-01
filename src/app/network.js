/**
 * network.js — online/offline awareness and a degraded-mode notice.
 *
 * Before this module the app had no offline handling at all: with the service
 * worker serving a cached shell, a user on a dead connection saw a fully
 * rendered page whose every button failed silently against Supabase.
 */

import { logger } from '../lib/logger.js';
import { isBackendConfigured, backendConfigProblems } from '../lib/env.js';

let banner = null;

function ensureBanner() {
  if (banner && document.contains(banner)) return banner;
  banner = document.createElement('div');
  banner.className = 'env-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  document.body.appendChild(banner);
  return banner;
}

export function showNotice(messageNodes, { dismissible = true, id = 'notice' } = {}) {
  const el = ensureBanner();
  el.dataset.noticeId = id;
  el.replaceChildren(...messageNodes);
  if (dismissible) {
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    close.addEventListener('click', () => el.remove());
    el.appendChild(close);
  }
  return el;
}

function textNode(text, tag = 'span') {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
}

/**
 * Reflect connectivity on `<html data-offline>` so CSS can dim network-only
 * controls, and surface a single polite notice.
 */
export function initNetworkStatus() {
  const apply = () => {
    const offline = navigator.onLine === false;
    document.documentElement.dataset.offline = String(offline);
    if (offline) {
      showNotice(
        [textNode('You are offline. Cached content is shown; sign-in and submissions are paused.')],
        {
          id: 'offline',
        }
      );
      logger.warn('network', 'offline');
    } else if (banner?.dataset.noticeId === 'offline') {
      banner.remove();
    }
  };
  window.addEventListener('online', apply);
  window.addEventListener('offline', apply);
  apply();
  return {
    destroy() {
      window.removeEventListener('online', apply);
      window.removeEventListener('offline', apply);
    },
  };
}

/**
 * Explain degraded mode exactly once, in development only. In production a
 * misconfigured deploy must not leak its configuration surface to visitors,
 * so the message is logged rather than rendered.
 */
export function reportBackendConfig({ dev = false } = {}) {
  if (isBackendConfigured()) return false;
  const problems = backendConfigProblems();
  logger.warn('env', 'backend not configured — authenticated features disabled', { problems });

  if (dev) {
    showNotice(
      [
        textNode('Running without a backend: '),
        (() => {
          const code = document.createElement('code');
          code.textContent = problems.join(' · ');
          return code;
        })(),
        textNode(' Copy .env.example to .env.local and fill it in.'),
      ],
      { id: 'env' }
    );
  }
  return true;
}
