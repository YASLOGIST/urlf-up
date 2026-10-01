/**
 * account.js — everything that needs the backend: auth, the idea form, the
 * settings entry point and the Cal.com booking embed.
 *
 * This module is **dynamically imported**. Nothing here is in the landing
 * page's critical path, so the first paint no longer pays for
 * `@supabase/supabase-js` (≈110 kB gzipped). It is loaded when:
 *   - the visitor touches any auth / idea / meeting CTA, or
 *   - the browser reports idle time after load (speculative warm-up), or
 *   - the URL carries a magic-link token, which must be processed eagerly.
 *
 * It was extracted from `src/main.js`, which previously mixed auth wiring,
 * canvas bootstrapping, duplicate-DOM purging and animation init in one file.
 */

import { openModal, closeModal } from './modal.js';
import { logger } from '../lib/logger.js';
import { CAL_LINK, isBackendConfigured } from '../lib/env.js';
import { getSupabase } from '../lib/supabase.js';
import { showToast, clearError } from '../ui.js';
import { safeName } from '../sanitize.js';

let _session = null;
let _ideasLoaded = false;
let _wired = false;
let _calFrameLoaded = false;

/* ── auth modal ─────────────────────────────────────────────────────────── */

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  const tabLogin = document.getElementById('auth-tab-login');
  const tabRegister = document.getElementById('auth-tab-register');
  const panelLogin = document.getElementById('auth-panel-login');
  const panelRegister = document.getElementById('auth-panel-register');
  const confirmMsg = document.getElementById('register-confirm-msg');
  const registerForm = document.getElementById('register-form');

  tabLogin?.classList.toggle('modal-tab--active', isLogin);
  tabRegister?.classList.toggle('modal-tab--active', !isLogin);
  tabLogin?.setAttribute('aria-selected', String(isLogin));
  tabRegister?.setAttribute('aria-selected', String(!isLogin));
  if (panelLogin) panelLogin.hidden = !isLogin;
  if (panelRegister) panelRegister.hidden = isLogin;
  if (confirmMsg) confirmMsg.hidden = true;
  if (registerForm) registerForm.hidden = false;
  clearError('login-error');
  clearError('register-error');
}

export function openAuthModal(defaultTab = 'login', trigger = null) {
  switchAuthTab(defaultTab);
  openModal('auth-modal', { trigger, focus: defaultTab === 'login' ? '#login-email' : '#register-name' });
}

async function openIdeaModal(trigger = null) {
  if (!_session) {
    openAuthModal('register', trigger);
    return;
  }
  const { getCachedProfile } = await import('../auth.js');
  const profile = getCachedProfile();
  const isVisionary = profile?.role_type === 'visionary';
  const gate = document.getElementById('idea-role-gate');
  const form = document.getElementById('idea-form-wrap');
  if (gate) gate.hidden = isVisionary;
  if (form) form.hidden = !isVisionary;
  clearError('idea-error');
  openModal('idea-modal', { trigger, focus: isVisionary ? '#idea-title' : null });
}

/* ── Cal.com embed ──────────────────────────────────────────────────────── */

function buildCalEmbedSrc() {
  const base = CAL_LINK.split('?')[0];
  const params = new URLSearchParams({ embed: '1', theme: 'dark', layout: 'month_view' });
  return `${base}?${params.toString()}`;
}

function openCalModal(trigger = null) {
  const target = document.getElementById('cal-modal');
  const frame = document.getElementById('cal-modal-frame');
  const spinner = document.getElementById('cal-modal-spinner');
  if (!target || !frame) return;

  if (!_calFrameLoaded) {
    spinner?.classList.remove('is-hidden');
    // Hard timeout: if the third-party embed does not load (blocked, offline,
    // ad-blocker), swap the spinner for an actionable link instead of leaving
    // the visitor staring at "Loading calendar…" forever.
    const timeout = setTimeout(() => {
      if (_calFrameLoaded || !spinner) return;
      spinner.replaceChildren();
      const p = document.createElement('p');
      p.textContent = 'The booking calendar could not load here.';
      const a = document.createElement('a');
      a.href = CAL_LINK;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'btn-outline';
      a.textContent = 'Open the calendar in a new tab';
      spinner.append(p, a);
      logger.warn('cal', 'embed did not load within 8s', { src: CAL_LINK });
    }, 8000);

    frame.addEventListener(
      'load',
      () => {
        _calFrameLoaded = true;
        clearTimeout(timeout);
        spinner?.classList.add('is-hidden');
      },
      { once: true }
    );
    frame.src = buildCalEmbedSrc();
  } else {
    spinner?.classList.add('is-hidden');
  }
  openModal(target, { trigger });
}

/* ── session → UI ───────────────────────────────────────────────────────── */

async function updateUI(session) {
  _session = session;
  const joinBtn = document.getElementById('nav-join-btn');
  const userWrap = document.getElementById('nav-user-wrap');
  const userName = document.getElementById('nav-user-name');

  if (session) {
    if (joinBtn) joinBtn.hidden = true;
    if (userWrap) userWrap.hidden = false;
    const name = safeName(
      session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User'
    );
    if (userName) userName.textContent = name;
    if (!_ideasLoaded) {
      _ideasLoaded = true;
      const { loadUserIdeas } = await import('../ideas.js');
      loadUserIdeas(session.user.id).catch((err) => logger.error('ideas', 'load failed', err));
    }
  } else {
    if (joinBtn) joinBtn.hidden = false;
    if (userWrap) userWrap.hidden = true;
    _ideasLoaded = false;
  }
}

/* ── wiring ─────────────────────────────────────────────────────────────── */

const CTA_SELECTOR = [
  '#hero-submit-btn',
  '#cta-submit-btn',
  '#nav-join-btn',
  '#nav-meeting-btn',
  '#meeting-cta-btn',
  '#nav-settings-btn',
  '#nav-logout-btn',
  '#auth-tab-login',
  '#auth-tab-register',
].join(', ');

async function wire() {
  if (_wired) return;
  _wired = true;

  const auth = await import('../auth.js');

  document.addEventListener('click', async (event) => {
    const hit = event.target.closest?.(CTA_SELECTOR);
    if (!hit) return;
    event.preventDefault();

    switch (hit.id) {
      case 'hero-submit-btn':
      case 'cta-submit-btn':
        await openIdeaModal(hit);
        break;
      case 'nav-join-btn':
        openAuthModal('register', hit);
        break;
      case 'nav-meeting-btn':
      case 'meeting-cta-btn':
        openCalModal(hit);
        break;
      case 'nav-settings-btn': {
        const { openSettings } = await import('../settings.js');
        openSettings();
        break;
      }
      case 'nav-logout-btn':
        await auth.handleSignOut();
        showToast('Signed out successfully.', 'info');
        break;
      case 'auth-tab-login':
        switchAuthTab('login');
        break;
      case 'auth-tab-register':
        switchAuthTab('register');
        break;
      default:
        break;
    }
  });

  // Mark CTAs as owned so core.js's orphan-click guard stops calling
  // preventDefault() on them.
  document.querySelectorAll(CTA_SELECTOR).forEach((el) => {
    el.dataset.initialized = 'true';
  });

  // ── login ──────────────────────────────────────────────────────────────
  document.getElementById('login-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    auth.handleSignIn(
      document.getElementById('login-email')?.value ?? '',
      document.getElementById('login-password')?.value ?? '',
      () => {
        closeModal('auth-modal');
        showToast('Welcome back!');
      }
    );
  });

  document.getElementById('magic-link-submit')?.addEventListener('click', (event) => {
    event.preventDefault();
    auth.handleMagicLinkSignIn(document.getElementById('login-email')?.value ?? '', () => {
      closeModal('auth-modal');
      showToast('Magic link sent! Check your inbox.');
    });
  });

  // ── register ───────────────────────────────────────────────────────────
  document.getElementById('register-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    auth.handleSignUp(
      {
        fullName: document.getElementById('register-name')?.value ?? '',
        email: document.getElementById('register-email')?.value ?? '',
        password: document.getElementById('register-password')?.value ?? '',
        roleType: document.getElementById('register-role')?.value ?? '',
        skillsRaw: document.getElementById('register-skills')?.value ?? '',
      },
      () => {
        closeModal('auth-modal');
        showToast('Welcome to UrLife!');
      },
      () => {
        const confirmMsg = document.getElementById('register-confirm-msg');
        const form = document.getElementById('register-form');
        if (confirmMsg) confirmMsg.hidden = false;
        if (form) form.hidden = true;
      }
    );
  });

  // ── idea submission ────────────────────────────────────────────────────
  document.getElementById('idea-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!_session) {
      closeModal('idea-modal');
      openAuthModal('login');
      return;
    }
    const { handleIdeaSubmit } = await import('../ideas.js');
    handleIdeaSubmit(
      {
        title: document.getElementById('idea-title')?.value ?? '',
        industry: document.getElementById('idea-industry')?.value ?? '',
        problem: document.getElementById('idea-problem')?.value ?? '',
        skillsRaw: document.getElementById('idea-skills')?.value ?? '',
      },
      _session
    );
  });

  // Subscribing last means the UI is wired before the first session callback.
  await auth.initAuth(updateUI);
  window.addEventListener('beforeunload', auth.teardownAuth);
}

/**
 * Entry point used by boot.js.
 * Resolves once the account surface is interactive.
 */
export async function initAccount() {
  if (!isBackendConfigured()) {
    logger.info('account', 'backend unavailable — wiring UI in read-only mode');
  }
  await getSupabase(); // installs the single shared client before anything uses it
  await wire();

  // The Nexus dashboard self-subscribes to auth state on import, so it must
  // be loaded AFTER the real client is installed — otherwise it would bind to
  // the degraded-mode stub and never see a session. It is ~29 kB and only
  // matters to signed-in users, so it stays out of the first-paint graph.
  import('../dashboard.js').catch((err) => logger.warn('dashboard', 'load failed', err));

  return { openAuthModal, openIdeaModal, openCalModal };
}

export function hasSession() {
  return Boolean(_session);
}
