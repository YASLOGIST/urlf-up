import { EscrowEngine } from '../escrowEngine.js';
import { icon } from '../icons.js';
import { safeName } from '../sanitize.js';
import { t } from '../app/strings.js';

// Minimal DOM helper locally
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v
    else if (k === 'dataset') Object.assign(node.dataset, v)
    else if (k === 'style') node.style.cssText = v
    else node.setAttribute(k, v)
  }
  if (text != null) node.textContent = text
  return node
}

/* Localised role label for the "partner" slot (falls back to the raw value). */
function roleLabel(role) {
  return role ? t(`role.${role}`) !== `role.${role}` ? t(`role.${role}`) : role : t('deal.partner')
}

/**
 * Opens the Deal Room modal for finalizing terms before Escrow.
 *
 * Layering: this overlay sits ABOVE the generic modal layer but BELOW toasts
 * and the custom cursor (z-index 9600 vs 9500/9800/10000) — previously it
 * hardcoded 1000, which put it under every other overlay in the design
 * system. Validation failures render inline instead of a blocking alert().
 *
 * @param {Object} match - The matched operator profile data.
 * @param {Function} onSignSuccess - Callback triggered after successful signing (passes new escrow state).
 */
export function openDealRoom(match, onSignSuccess) {
  // Close any previous instance (defensive: focus + ESC listeners are per-instance)
  document.getElementById('deal-room-modal')?.remove();

  const backdrop = el('div', {
    id: 'deal-room-modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'deal-room-title',
    style: 'position: fixed; inset: 0; z-index: calc(var(--z-overlay, 9500) + 100); background: rgba(2, 4, 10, 0.85); backdrop-filter: blur(12px); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.3s ease;'
  });

  const modal = el('div', {
    style: 'width: 100%; max-width: 600px; margin: 16px; background: #0b0f1a; border: 1px solid rgba(212, 175, 55, 0.2); border-radius: 16px; padding: 32px; box-shadow: 0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05); transform: translateY(20px); transition: transform 0.3s ease;'
  });

  // Header
  const header = el('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 16px;' });
  const titleWrap = el('div', { style: 'display: flex; align-items: center; gap: 12px;' });
  titleWrap.appendChild(icon('vault', { size: 24, color: '#D4AF37' }));
  const title = el('h2', { id: 'deal-room-title', style: 'margin: 0; font-family: var(--font-active, var(--font-en)); font-size: 24px; color: #D4AF37;' }, t('deal.title'));
  titleWrap.appendChild(title);

  const closeBtn = el('button', { type: 'button', 'aria-label': t('deal.cancel'), style: 'background: transparent; border: none; color: var(--dim); cursor: pointer; font-size: 24px;' }, '×');

  header.appendChild(titleWrap);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Operators Section
  const operatorsSec = el('div', { style: 'margin-bottom: 24px;' });
  operatorsSec.appendChild(el('h4', { style: 'margin: 0 0 12px 0; font-size: 14px; color: var(--white); text-transform: uppercase; letter-spacing: 1px;' }, t('deal.operators')));

  const opGrid = el('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px;' });

  // Operator 1: Current Session User (Project Lead)
  const op1 = el('div', { style: 'background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 16px; border-radius: 8px;' });
  op1.appendChild(el('div', { style: 'font-size: 11px; color: var(--dim); margin-bottom: 4px;' }, t('deal.projectLead')));
  op1.appendChild(el('div', { style: 'font-size: 15px; color: var(--white); font-weight: bold;' }, match.idea_title || t('deal.initiator')));

  // Operator 2: Matched Candidate
  const op2 = el('div', { style: 'background: rgba(212,175,55,0.05); border: 1px solid rgba(212,175,55,0.2); padding: 16px; border-radius: 8px;' });
  op2.appendChild(el('div', { style: 'font-size: 11px; color: #D4AF37; margin-bottom: 4px;' }, roleLabel(match.profile_role_type || match.role_type)));
  op2.appendChild(el('div', { style: 'font-size: 15px; color: var(--white); font-weight: bold;' }, safeName(match.profile_full_name || match.full_name || t('deal.anonymousOperator'))));

  opGrid.appendChild(op1);
  opGrid.appendChild(op2);
  operatorsSec.appendChild(opGrid);
  modal.appendChild(operatorsSec);

  // Terms Form
  const formSec = el('div', { style: 'margin-bottom: 32px;' });
  formSec.appendChild(el('h4', { style: 'margin: 0 0 12px 0; font-size: 14px; color: var(--white); text-transform: uppercase; letter-spacing: 1px;' }, t('deal.terms')));

  const formGrid = el('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;' });

  const equityWrap = el('div');
  equityWrap.appendChild(el('label', { for: 'deal-equity', style: 'display: block; font-size: 12px; color: var(--dim); margin-bottom: 6px;' }, t('deal.equity')));
  const equityInput = el('input', { id: 'deal-equity', type: 'number', placeholder: t('deal.equityPh'), style: 'width: 100%; background: #02040A; border: 1px solid rgba(255,255,255,0.1); color: var(--white); padding: 10px 12px; border-radius: 6px; font-family: inherit; font-size: 14px; outline: none;' });
  equityWrap.appendChild(equityInput);

  const revWrap = el('div');
  revWrap.appendChild(el('label', { for: 'deal-revenue', style: 'display: block; font-size: 12px; color: var(--dim); margin-bottom: 6px;' }, t('deal.revenue')));
  const revInput = el('input', { id: 'deal-revenue', type: 'number', placeholder: t('deal.revenuePh'), style: 'width: 100%; background: #02040A; border: 1px solid rgba(255,255,255,0.1); color: var(--white); padding: 10px 12px; border-radius: 6px; font-family: inherit; font-size: 14px; outline: none;' });
  revWrap.appendChild(revInput);

  formGrid.appendChild(equityWrap);
  formGrid.appendChild(revWrap);
  formSec.appendChild(formGrid);

  const mileWrap = el('div');
  mileWrap.appendChild(el('label', { for: 'deal-milestone', style: 'display: block; font-size: 12px; color: var(--dim); margin-bottom: 6px;' }, t('deal.milestone')));
  const mileInput = el('input', { id: 'deal-milestone', type: 'text', placeholder: t('deal.milestonePh'), style: 'width: 100%; background: #02040A; border: 1px solid rgba(255,255,255,0.1); color: var(--white); padding: 10px 12px; border-radius: 6px; font-family: inherit; font-size: 14px; outline: none;' });
  mileWrap.appendChild(mileInput);

  // Inline validation message (replaces the old blocking alert())
  const errorSlot = el('p', { role: 'alert', style: 'display: none; margin: 12px 0 0 0; color: #ff6b5e; font-size: 13px;' });
  mileWrap.appendChild(errorSlot);

  formSec.appendChild(mileWrap);
  modal.appendChild(formSec);

  // Actions
  const actionSec = el('div', { style: 'display: flex; justify-content: flex-end; gap: 16px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 24px;' });

  const cancelBtn = el('button', { type: 'button', style: 'background: transparent; border: 1px solid rgba(255,255,255,0.1); color: var(--white); padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer; transition: all 0.2s;' }, t('deal.cancel'));

  const signBtn = el('button', { type: 'button', style: 'background: #D4AF37; border: none; color: #02040A; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s;' });
  signBtn.appendChild(icon('rocket', { size: 16, color: '#02040A' }));
  signBtn.appendChild(document.createTextNode(t('deal.sign')));

  const closeDealRoom = () => {
    document.removeEventListener('keydown', onKeydown);
    backdrop.style.opacity = '0';
    if (backdrop.firstChild) backdrop.firstChild.style.transform = 'translateY(20px)';
    setTimeout(() => backdrop.remove(), 300);
    restoreFocus();
  };
  cancelBtn.onclick = closeDealRoom;
  closeBtn.onclick = closeDealRoom;

  const onKeydown = (e) => {
    if (e.key === 'Escape') closeDealRoom();
  };
  document.addEventListener('keydown', onKeydown);

  // Focus management: enter the dialog on open, restore on close.
  const previouslyFocused = document.activeElement;
  const restoreFocus = () => {
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
  };

  signBtn.onclick = () => {
    if (!equityInput.value || !revInput.value || !mileInput.value) {
      errorSlot.textContent = t('deal.error.fillAll');
      errorSlot.style.display = 'block';
      (!equityInput.value ? equityInput : !revInput.value ? revInput : mileInput).focus();
      return;
    }

    // Initialize Escrow Engine directly passing to locked state logically
    const engine = new EscrowEngine();
    engine.lock(); // Moves from Pending -> Locked

    signBtn.replaceChildren(); // rebuild the signed state
    signBtn.appendChild(icon('check-seal', { size: 16, color: '#02040A' }));
    signBtn.appendChild(document.createTextNode(t('deal.locked')));
    signBtn.style.background = '#00d4a0'; // mint success
    signBtn.style.pointerEvents = 'none';

    setTimeout(() => {
      closeDealRoom();
      if (onSignSuccess) onSignSuccess(engine.getState());
    }, 1200);
  };

  actionSec.appendChild(cancelBtn);
  actionSec.appendChild(signBtn);
  modal.appendChild(actionSec);

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Trigger intro animation
  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    modal.style.transform = 'translateY(0)';
    closeBtn.focus();
  });
}
