import { EscrowEngine } from '../escrowEngine.js';
import { icon } from '../icons.js';
import { safeName } from '../sanitize.js';

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

/**
 * Opens the Deal Room modal for finalizing terms before Escrow.
 * @param {Object} match - The matched operator profile data.
 * @param {Function} onSignSuccess - Callback triggered after successful signing (passes new escrow state).
 */
export function openDealRoom(match, onSignSuccess) {
  const backdrop = el('div', {
    id: 'deal-room-modal',
    style: 'position: fixed; inset: 0; z-index: 1000; background: rgba(2, 4, 10, 0.85); backdrop-filter: blur(12px); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.3s ease;'
  });

  const modal = el('div', {
    style: 'width: 100%; max-width: 600px; background: #0b0f1a; border: 1px solid rgba(212, 175, 55, 0.2); border-radius: 16px; padding: 32px; box-shadow: 0 24px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05); transform: translateY(20px); transition: transform 0.3s ease;'
  });

  // Header
  const header = el('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 16px;' });
  const titleWrap = el('div', { style: 'display: flex; align-items: center; gap: 12px;' });
  titleWrap.appendChild(icon('vault', { size: 24, color: '#D4AF37' }));
  const title = el('h2', { style: 'margin: 0; font-family: var(--font-en); font-size: 24px; color: #D4AF37;' }, 'Closed Meeting Protocol');
  titleWrap.appendChild(title);
  
  const closeBtn = el('button', { style: 'background: transparent; border: none; color: var(--dim); cursor: pointer; font-size: 24px;' }, '×');
  closeBtn.onclick = () => closeDealRoom(backdrop);
  
  header.appendChild(titleWrap);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Operators Section
  const operatorsSec = el('div', { style: 'margin-bottom: 24px;' });
  operatorsSec.appendChild(el('h4', { style: 'margin: 0 0 12px 0; font-size: 14px; color: var(--white); text-transform: uppercase; letter-spacing: 1px;' }, 'Matched Operators'));
  
  const opGrid = el('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px;' });
  
  // Operator 1: Current Session User (Project Lead)
  const op1 = el('div', { style: 'background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 16px; border-radius: 8px;' });
  op1.appendChild(el('div', { style: 'font-size: 11px; color: var(--dim); margin-bottom: 4px;' }, 'Project Lead'));
  op1.appendChild(el('div', { style: 'font-size: 15px; color: var(--white); font-weight: bold;' }, match.idea_title || 'Initiator'));

  // Operator 2: Matched Candidate
  const op2 = el('div', { style: 'background: rgba(212,175,55,0.05); border: 1px solid rgba(212,175,55,0.2); padding: 16px; border-radius: 8px;' });
  op2.appendChild(el('div', { style: 'font-size: 11px; color: #D4AF37; margin-bottom: 4px;' }, match.profile_role_type || match.role_type || 'Partner'));
  op2.appendChild(el('div', { style: 'font-size: 15px; color: var(--white); font-weight: bold;' }, safeName(match.profile_full_name || match.full_name || 'Anonymous Operator')));

  opGrid.appendChild(op1);
  opGrid.appendChild(op2);
  operatorsSec.appendChild(opGrid);
  modal.appendChild(operatorsSec);

  // Terms Form
  const formSec = el('div', { style: 'margin-bottom: 32px;' });
  formSec.appendChild(el('h4', { style: 'margin: 0 0 12px 0; font-size: 14px; color: var(--white); text-transform: uppercase; letter-spacing: 1px;' }, 'Partnership Terms'));

  const formGrid = el('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;' });
  
  const equityWrap = el('div');
  equityWrap.appendChild(el('label', { style: 'display: block; font-size: 12px; color: var(--dim); margin-bottom: 6px;' }, 'Equity Allocation (%)'));
  const equityInput = el('input', { type: 'number', placeholder: 'e.g. 15', style: 'width: 100%; background: #02040A; border: 1px solid rgba(255,255,255,0.1); color: var(--white); padding: 10px 12px; border-radius: 6px; font-family: inherit; font-size: 14px; outline: none;' });
  equityWrap.appendChild(equityInput);

  const revWrap = el('div');
  revWrap.appendChild(el('label', { style: 'display: block; font-size: 12px; color: var(--dim); margin-bottom: 6px;' }, 'Revenue Share (%)'));
  const revInput = el('input', { type: 'number', placeholder: 'e.g. 5', style: 'width: 100%; background: #02040A; border: 1px solid rgba(255,255,255,0.1); color: var(--white); padding: 10px 12px; border-radius: 6px; font-family: inherit; font-size: 14px; outline: none;' });
  revWrap.appendChild(revInput);

  formGrid.appendChild(equityWrap);
  formGrid.appendChild(revWrap);
  formSec.appendChild(formGrid);

  const mileWrap = el('div');
  mileWrap.appendChild(el('label', { style: 'display: block; font-size: 12px; color: var(--dim); margin-bottom: 6px;' }, 'Key Milestone to Unlock Escrow'));
  const mileInput = el('input', { type: 'text', placeholder: 'e.g. MVP Launch / Smart Contract Audit', style: 'width: 100%; background: #02040A; border: 1px solid rgba(255,255,255,0.1); color: var(--white); padding: 10px 12px; border-radius: 6px; font-family: inherit; font-size: 14px; outline: none;' });
  mileWrap.appendChild(mileInput);
  formSec.appendChild(mileWrap);

  modal.appendChild(formSec);

  // Actions
  const actionSec = el('div', { style: 'display: flex; justify-content: flex-end; gap: 16px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 24px;' });
  
  const cancelBtn = el('button', { style: 'background: transparent; border: 1px solid rgba(255,255,255,0.1); color: var(--white); padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer; transition: all 0.2s;' }, 'Cancel');
  cancelBtn.onclick = () => closeDealRoom(backdrop);

  const signBtn = el('button', { style: 'background: #D4AF37; border: none; color: #02040A; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s;' });
  signBtn.appendChild(icon('rocket', { size: 16, color: '#02040A' }));
  signBtn.appendChild(document.createTextNode('Cryptographic Sign & Lock'));
  
  signBtn.onclick = () => {
    if (!equityInput.value || !revInput.value || !mileInput.value) {
      alert('Please fill out all terms to proceed.');
      return;
    }

    // Initialize Escrow Engine directly passing to locked state logically
    const engine = new EscrowEngine();
    engine.lock(); // Moves from Pending -> Locked
    
    signBtn.innerHTML = ''; // safe to use for clearing
    signBtn.appendChild(icon('check-seal', { size: 16, color: '#02040A' }));
    signBtn.appendChild(document.createTextNode('Locked in Escrow'));
    signBtn.style.background = '#00d4a0'; // mint success
    signBtn.style.pointerEvents = 'none';

    setTimeout(() => {
      closeDealRoom(backdrop);
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
  });
}

function closeDealRoom(backdrop) {
  backdrop.style.opacity = '0';
  backdrop.firstChild.style.transform = 'translateY(20px)';
  setTimeout(() => backdrop.remove(), 300);
}
