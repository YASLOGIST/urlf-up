import { icon } from './icons.js'
import { ideaProblem } from './matchingEngine.js'

/**
 * Display an error in a named slot element.
 *
 * Uses textContent — never innerHTML — to prevent XSS.
 *
 * Accessibility upgrade (WCAG 3.3.1 Error Identification / 4.1.3 Status
 * Messages): previously this only toggled `hidden`, so a screen-reader user
 * who submitted an invalid form heard nothing at all. The slot is now a live
 * region, the offending fields are marked `aria-invalid`, and focus moves to
 * the first invalid control.
 *
 * @param {string} slotId   id of the message container
 * @param {string} message  plain text shown to the user
 * @param {{field?: string, focus?: boolean}} [opts] optional field to flag
 */
export function showError(slotId, message, opts = {}) {
  const slot = document.getElementById(slotId)
  if (!slot) return
  slot.textContent = message
  slot.hidden = false
  slot.setAttribute('role', 'alert')
  slot.setAttribute('aria-live', 'assertive')

  const field = opts.field ? document.getElementById(opts.field) : null
  if (field) {
    field.setAttribute('aria-invalid', 'true')
    const describedBy = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
    if (!describedBy.includes(slotId)) {
      field.setAttribute('aria-describedby', [...describedBy, slotId].join(' '))
    }
    if (opts.focus !== false) field.focus({ preventScroll: false })
  }
}

export function clearError(slotId) {
  const slot = document.getElementById(slotId)
  if (!slot) return
  slot.textContent = ''
  slot.hidden = true
  // Drop every aria-invalid flag that pointed at this slot.
  document.querySelectorAll(`[aria-describedby~="${slotId}"]`).forEach(field => {
    field.removeAttribute('aria-invalid')
  })
}

/**
 * Toggle loading state via CSS class.
 * Always call in finally{} to guarantee the button is re-enabled.
 */
export function setLoading(btn, loading) {
  if (!btn) return
  btn.disabled = loading
  btn.classList.toggle('btn--loading', loading)
}

// Active toast stack for FIFO eviction
const _activeToasts = []

function _dismissToast(toast) {
  toast.classList.remove('toast--visible')
  toast.addEventListener('transitionend', () => {
    toast.remove()
    const idx = _activeToasts.indexOf(toast)
    if (idx !== -1) _activeToasts.splice(idx, 1)
  }, { once: true })
}

/**
 * Show a transient toast.
 * Accepts: showToast(message, type) OR showToast({message, icon?, action?, type?})
 * Types: 'success' | 'error' | 'info'
 * Action: { label: string, onClick: () => void } — auto-focused, no auto-dismiss.
 */
export function showToast(msgOrOpts, typeArg = 'success') {
  const opts = typeof msgOrOpts === 'string'
    ? { message: msgOrOpts, type: typeArg }
    : msgOrOpts
  const { message, icon: iconName, action, type = 'success' } = opts

  const container = document.getElementById('toast-container')
  if (!container) return

  // FIFO eviction: max 3 toasts
  if (_activeToasts.length >= 3) {
    _dismissToast(_activeToasts[0])
  }

  const toast = document.createElement('div')
  toast.className = `toast toast--${type}`
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status')

  // Optional icon
  if (iconName) {
    try {
      const iconEl = icon(iconName, { size: 16, className: 'toast-icon' })
      toast.appendChild(iconEl)
    } catch {
      /* An unknown icon name must never suppress the message itself. */
    }
  }

  const msgEl = document.createElement('span')
  msgEl.className = 'toast-msg'
  msgEl.textContent = message
  toast.appendChild(msgEl)

  let actionBtn = null
  if (action) {
    actionBtn = document.createElement('button')
    actionBtn.type = 'button'
    actionBtn.className = 'toast-action'
    actionBtn.textContent = action.label
    actionBtn.addEventListener('click', () => {
      action.onClick()
      _dismissToast(toast)
    }, { once: true })
    toast.appendChild(actionBtn)
  }

  container.appendChild(toast)
  _activeToasts.push(toast)

  // Double rAF ensures the transition fires after paint
  requestAnimationFrame(() =>
    requestAnimationFrame(() => toast.classList.add('toast--visible'))
  )

  // Auto-focus action button (keyboard-accessible)
  if (actionBtn) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => actionBtn.focus())
    )
  }

  // Auto-dismiss: never if action; 6500ms error; 4000ms success/info
  if (!action) {
    const delay = type === 'error' ? 6500 : 4000
    setTimeout(() => _dismissToast(toast), delay)
  }
}

/**
 * Leading-edge throttle: fires immediately, then blocks for `ms` ms.
 * Prevents double-submit while keeping instant UX feedback.
 */
export function debounce(fn, ms) {
  let locked = false
  return function (...args) {
    if (locked) return
    locked = true
    setTimeout(() => { locked = false }, ms)
    return fn.apply(this, args)
  }
}

/**
 * Overlay helpers — thin wrappers around the single modal controller in
 * src/app/modal.js.
 *
 * They used to be a second, independent implementation: `openModal()` here
 * added `.modal--open`, locked body scroll and focused the first input, but
 * had no focus trap, no focus restore, no inert background and no stack. Two
 * controllers meant `document.body.style.overflow` could be unlocked by one
 * while the other still had a dialog open. Delegating keeps the old import
 * sites working while there is exactly one state machine.
 */
export { openModal, closeModal } from './app/modal.js'

/**
 * Build an idea card using only createElement + textContent.
 * No innerHTML anywhere — XSS-safe.
 */
export function buildIdeaCard(idea) {
  const card = document.createElement('div')
  card.className = 'idea-card reveal'

  const chip = document.createElement('span')
  chip.className = 'idea-chip'
  chip.textContent = idea.industry || ''

  const title = document.createElement('h3')
  title.className = 'idea-title'
  title.textContent = idea.title || ''

  const problem = document.createElement('p')
  problem.className = 'idea-problem'
  problem.textContent = ideaProblem(idea)

  card.appendChild(chip)
  card.appendChild(title)
  card.appendChild(problem)

  const skills = Array.isArray(idea.required_skills) ? idea.required_skills : []
  if (skills.length) {
    const wrap = document.createElement('div')
    wrap.className = 'idea-skills'
    skills.forEach(s => {
      const tag = document.createElement('span')
      tag.className = 'skill-tag'
      tag.textContent = s
      wrap.appendChild(tag)
    })
    card.appendChild(wrap)
  }

  return card
}
