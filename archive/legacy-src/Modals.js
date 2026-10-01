// ─── Modal Controller ─────────────────────────────────────────
export function initModals() {
  const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

  function openModal(modalEl) {
    modalEl.classList.add('modal--open');
    modalEl.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    // Focus trap: move focus to first focusable child
    const first = modalEl.querySelector(FOCUSABLE);
    if (first) first.focus();
  }

  function closeModal(modalEl) {
    modalEl.classList.remove('modal--open');
    modalEl.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  // Single delegated listener on document — replaces all scattered listeners
  document.addEventListener('click', (e) => {
    // Open trigger
    const trigger = e.target.closest('[data-modal-target]');
    if (trigger) {
      const target = document.getElementById(trigger.dataset.modalTarget);
      if (target) openModal(target);
    }
    // Close trigger (backdrop click or close button)
    if (e.target.closest('[data-modal-close]')) {
      const modal = e.target.closest('.modal');
      if (modal) closeModal(modal);
    }
  });

  // Escape key to close any open modal
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal.modal--open').forEach(closeModal);
  });

  // Focus trap on Tab key
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const modal = document.querySelector('.modal.modal--open');
    if (!modal) return;
    const focusable = [...modal.querySelectorAll(FOCUSABLE)];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  });

  document.addEventListener('submit', (e) => {
    // Magic link callback detection — do not intercept Supabase token processing
    const isMagicCallback =
      window.location.hash.includes('access_token') ||
      window.location.search.includes('token_hash');
    if (isMagicCallback) return;

    // We do NOT prevent ALL submits here globally because we want forms to handle it in main.js, 
    // BUT the prompt explicitly requires: "Prevent ALL form submits from causing page reload"
    e.preventDefault();
  });
}

export const Modals = () => {
  const isMagicLinkCallback =
    typeof window !== 'undefined' &&
    (window.location.hash.includes('access_token') ||
    window.location.search.includes('token_hash') ||
    window.location.search.includes('type=magiclink'));

  if (isMagicLinkCallback) {
    return '';
  }

  return `
<!-- ══════════ AUTH MODAL ══════════ -->
<div id="modal-auth" class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-auth-title" aria-hidden="true" data-modal>
  <div class="modal__backdrop" data-modal-close></div>
  <div class="modal__surface" role="document">
    <button class="modal__close" data-modal-close aria-label="Close modal">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    
    <div class="modal-tabs" role="tablist">
      <button id="auth-tab-login" class="modal-tab modal-tab--active" role="tab" aria-selected="true">Sign In</button>
      <button id="auth-tab-register" class="modal-tab" role="tab" aria-selected="false">Join Now</button>
    </div>

    <!-- Login panel -->
    <div id="auth-panel-login" role="tabpanel">
      <h2 id="modal-auth-title" class="modal__title">Welcome Back</h2>
      <form id="login-form" novalidate autocomplete="on">
        <div class="field-group">
          <label for="login-email">Email</label>
          <input type="email" id="login-email" name="email" autocomplete="email" placeholder="you@example.com" required>
        </div>
        <div class="field-group">
          <label for="login-password">Password</label>
          <input type="password" id="login-password" name="password" autocomplete="current-password" placeholder="••••••••" required>
        </div>
        <div id="login-error" class="error-slot" hidden></div>
        <button type="submit" id="login-submit" class="btn-primary" style="margin-top:4px;">Sign In</button>
        <button type="button" id="magic-link-submit" class="btn-outline" style="margin-top:8px;">Sign In with Magic Link</button>
      </form>
    </div>

    <!-- Register panel -->
    <div id="auth-panel-register" role="tabpanel" hidden>
      <h2 class="modal__title">Join UrLife</h2>
      <form id="register-form" novalidate autocomplete="on">
        <div class="field-group">
          <label for="register-name">Full Name</label>
          <input type="text" id="register-name" name="fullName" autocomplete="name" placeholder="Your full name" required>
        </div>
        <div class="field-group">
          <label for="register-email">Email</label>
          <input type="email" id="register-email" name="email" autocomplete="email" placeholder="you@example.com" required>
        </div>
        <div class="field-group">
          <label for="register-password">Password</label>
          <input type="password" id="register-password" name="password" autocomplete="new-password" placeholder="Min 8 chars · letters + numbers" required>
        </div>
        <div class="field-group">
          <label for="register-role">Your Role</label>
          <select id="register-role" name="role" required>
            <option value="" disabled selected>Select your role</option>
            <option value="visionary">Visionary — I have an idea to build</option>
            <option value="builder">Builder — I build things</option>
            <option value="enabler">Enabler — I fund and enable</option>
          </select>
        </div>
        <div class="field-group">
          <label for="register-skills">Skills (comma-separated)</label>
          <input type="text" id="register-skills" name="skills" autocomplete="off" placeholder="e.g. design, react, marketing" required>
        </div>
        <div id="register-error" class="error-slot" hidden></div>
        <button type="submit" id="register-submit" class="btn-primary" style="margin-top:4px;">Create Account</button>
      </form>
      <div id="register-confirm-msg" class="confirm-msg" hidden>
        Check your inbox — we sent you a confirmation link. Once verified, sign in above.
      </div>
    </div>

  </div>
</div>

<!-- ══════════ IDEA MODAL ══════════ -->
<div id="modal-idea" class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-idea-title" aria-hidden="true" data-modal>
  <div class="modal__backdrop" data-modal-close></div>
  <div class="modal__surface" style="width: min(600px, 90vw);" role="document">
    <button class="modal__close" data-modal-close aria-label="Close modal">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>

    <div id="idea-role-gate" class="role-gate" hidden>
      <p>Only <strong>Visionaries</strong> can submit ideas.<br>Update your role in your profile to continue.</p>
    </div>

    <div id="idea-form-wrap">
      <h2 id="modal-idea-title" class="modal__title">Launch Your Idea</h2>
      <form id="idea-form" novalidate>
        <div class="field-group">
          <label for="idea-title">Idea Name</label>
          <input type="text" id="idea-title" placeholder="What do you call it?" required>
        </div>
        <div class="field-group">
          <label for="idea-industry">Industry / Vertical</label>
          <input type="text" id="idea-industry" placeholder="e.g. Fintech, AI, Healthcare" required>
        </div>
        <div class="field-group">
          <label for="idea-problem">The Problem It Solves</label>
          <textarea id="idea-problem" rows="3" placeholder="Describe the pain point..." required></textarea>
        </div>
        <div class="field-group">
          <label for="idea-skills">Required Skills (Team Needed)</label>
          <input type="text" id="idea-skills" placeholder="e.g. React Native, Machine Learning" required>
        </div>
        <div id="idea-error" class="error-slot" hidden></div>
        <button type="submit" id="idea-submit" class="btn-primary" style="margin-top:4px;">Submit for AI Evaluation</button>
      </form>
    </div>
  </div>
</div>

<!-- ══════════ TOAST NOTIFICATIONS ══════════ -->
<div id="toast-container" class="toast-container"></div>
`;
};