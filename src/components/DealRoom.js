import './deal-room.css'

import { icon } from '../icons.js'
import { safeName } from '../sanitize.js'
import { openModal, closeModal } from '../app/modal.js'
import { t } from '../app/strings.js'

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue
    if (key === 'className') node.className = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    else node.setAttribute(key, value)
  }
  if (text != null) node.textContent = text
  return node
}

function roleLabel(role) {
  const key = `role.${role}`
  return role && t(key) !== key ? t(key) : t('deal.partner')
}

function numberInput(id, label, placeholder) {
  const wrap = el('div', { className: 'deal-room-field' })
  wrap.appendChild(el('label', { for: id }, label))
  wrap.appendChild(
    el('input', {
      id,
      name: id,
      type: 'number',
      min: '0',
      max: '100',
      step: '0.01',
      inputmode: 'decimal',
      placeholder,
      'aria-describedby': 'deal-draft-notice',
    })
  )
  return wrap
}

function clearInvalid(fields, errorSlot) {
  fields.forEach((field) => field.removeAttribute('aria-invalid'))
  errorSlot.hidden = true
  errorSlot.textContent = ''
}

function validateDraft({ equity, revenue, milestone }, errorSlot) {
  const fields = [equity, revenue, milestone]
  clearInvalid(fields, errorSlot)

  const invalidPercentage = [equity, revenue].find((field) => {
    const value = Number(field.value)
    return field.value.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100
  })
  const invalidMilestone = milestone.value.trim().length < 3
  const invalid = invalidPercentage || (invalidMilestone ? milestone : null)
  if (!invalid) return true

  invalid.setAttribute('aria-invalid', 'true')
  errorSlot.textContent = t(invalidPercentage ? 'deal.error.percentage' : 'deal.error.milestone')
  errorSlot.hidden = false
  invalid.focus()
  return false
}

/**
 * Opens an accessible, private workspace for discussing proposed terms.
 *
 * This intentionally does not claim to sign, store, transfer, or escrow
 * anything: those actions require a durable agreement service and explicit
 * legal / financial controls that this static client does not implement.
 * The workspace is still useful as a constrained agenda for the next meeting.
 *
 * @param {Object} match matched profile / interest data
 * @param {(draft: {equity: number, revenue: number, milestone: string}) => void} [onReady]
 * @param {{trigger?: Element|null}} [options]
 */
export function openDealRoom(match = {}, onReady, options = {}) {
  const existing = document.getElementById('deal-room-modal')
  if (existing) {
    closeModal(existing)
    existing.remove()
  }

  const backdrop = el('section', {
    id: 'deal-room-modal',
    className: 'modal-overlay deal-room-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-hidden': 'true',
    'aria-labelledby': 'deal-room-title',
    'aria-describedby': 'deal-draft-notice',
  })
  const modal = el('div', { className: 'modal-card deal-room-card' })

  const header = el('header', { className: 'deal-room-head' })
  const titleWrap = el('div', { className: 'deal-room-title-wrap' })
  titleWrap.appendChild(icon('vault', { size: 22, color: '#D4AF37' }))
  titleWrap.appendChild(el('h2', { id: 'deal-room-title' }, t('deal.title')))
  const closeButton = el(
    'button',
    { type: 'button', className: 'modal-close deal-room-close', 'aria-label': t('ui.close') },
    '×'
  )
  header.append(titleWrap, closeButton)

  const notice = el('p', { id: 'deal-draft-notice', className: 'deal-room-notice' })
  notice.appendChild(icon('diamond', { size: 15, color: '#F4D77A' }))
  notice.appendChild(document.createTextNode(t('deal.draftNotice')))

  const people = el('section', { className: 'deal-room-section', 'aria-labelledby': 'deal-people-title' })
  people.appendChild(el('h3', { id: 'deal-people-title' }, t('deal.operators')))
  const peopleGrid = el('div', { className: 'deal-room-people' })
  const lead = el('div', { className: 'deal-person' })
  lead.append(
    el('span', { className: 'deal-person-label' }, t('deal.projectLead')),
    el('strong', {}, safeName(match.idea_title || t('deal.initiator')))
  )
  const partner = el('div', { className: 'deal-person deal-person--partner' })
  partner.append(
    el('span', { className: 'deal-person-label' }, roleLabel(match.profile_role_type || match.role_type)),
    el('strong', {}, safeName(match.profile_full_name || match.full_name || t('deal.anonymousOperator')))
  )
  peopleGrid.append(lead, partner)
  people.appendChild(peopleGrid)

  const form = el('form', { className: 'deal-room-form', novalidate: '' })
  form.appendChild(el('h3', {}, t('deal.terms')))
  const percentageGrid = el('div', { className: 'deal-room-percentages' })
  const equityField = numberInput('deal-equity', t('deal.equity'), t('deal.equityPh'))
  const revenueField = numberInput('deal-revenue', t('deal.revenue'), t('deal.revenuePh'))
  percentageGrid.append(equityField, revenueField)

  const milestoneField = el('div', { className: 'deal-room-field deal-room-field--full' })
  milestoneField.appendChild(el('label', { for: 'deal-milestone' }, t('deal.milestone')))
  milestoneField.appendChild(
    el('input', {
      id: 'deal-milestone',
      name: 'deal-milestone',
      type: 'text',
      maxlength: '160',
      placeholder: t('deal.milestonePh'),
      'aria-describedby': 'deal-draft-notice',
    })
  )

  const errorSlot = el('p', { className: 'deal-room-error', role: 'alert', hidden: '' })
  const status = el('p', { className: 'deal-room-status', role: 'status', hidden: '' })

  const actions = el('div', { className: 'deal-room-actions' })
  const cancelButton = el('button', { type: 'button', className: 'btn-ghost' }, t('deal.cancel'))
  const readyButton = el('button', { type: 'submit', className: 'btn-gold' })
  readyButton.append(icon('check-seal', { size: 16, color: '#02040A' }), document.createTextNode(t('deal.ready')))
  actions.append(cancelButton, readyButton)

  form.append(percentageGrid, milestoneField, errorSlot, status, actions)
  modal.append(header, notice, people, form)
  backdrop.appendChild(modal)
  document.body.appendChild(backdrop)

  const close = () => closeModal(backdrop)
  closeButton.addEventListener('click', close)
  cancelButton.addEventListener('click', close)
  form.addEventListener('input', () => clearInvalid([equityField.querySelector('input'), revenueField.querySelector('input'), milestoneField.querySelector('input')], errorSlot))
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const equity = equityField.querySelector('input')
    const revenue = revenueField.querySelector('input')
    const milestone = milestoneField.querySelector('input')
    if (!validateDraft({ equity, revenue, milestone }, errorSlot)) return

    const draft = { equity: Number(equity.value), revenue: Number(revenue.value), milestone: milestone.value.trim() }
    readyButton.disabled = true
    form.classList.add('deal-room-form--ready')
    status.textContent = t('deal.readyStatus')
    status.hidden = false
    onReady?.(draft)
  })

  openModal(backdrop, {
    trigger: options.trigger,
    focus: '#deal-equity',
    onClose: () => backdrop.remove(),
  })
}
