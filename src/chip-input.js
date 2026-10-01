import { showToast } from './ui.js'

export function makeChipInput(container, {
  max = 30,
  normalize = s => s.trim().toLowerCase(),
} = {}) {
  let chips = []

  const chipsEl = container.querySelector('[data-chips]')
  const input = container.querySelector('input[type=text]')
  if (!chipsEl || !input) return null

  function render() {
    chipsEl.textContent = ''
    for (const chip of chips) {
      const span = document.createElement('span')
      span.className = 'skill-chip'
      span.textContent = chip

      const rm = document.createElement('button')
      rm.type = 'button'
      rm.className = 'skill-chip-remove'
      rm.setAttribute('aria-label', `Remove ${chip}`)
      rm.textContent = '×'
      rm.addEventListener('click', () => {
        chips = chips.filter(c => c !== chip)
        render()
      })
      span.appendChild(rm)
      chipsEl.appendChild(span)
    }
  }

  function add(raw) {
    const val = normalize(raw)
    if (!val) return
    if (chips.includes(val)) return
    if (chips.length >= max) {
      showToast({ type: 'info', message: `Max ${max} reached` })
      return
    }
    chips.push(val)
    render()
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(input.value)
      input.value = ''
      return
    }
    if (e.key === 'Backspace' && input.value === '' && chips.length) {
      chips.pop()
      render()
    }
  })

  input.addEventListener('blur', () => {
    if (input.value.trim()) { add(input.value); input.value = '' }
  })

  container.addEventListener('click', e => {
    if (e.target === container || e.target === chipsEl) input.focus()
  })

  return {
    getChips() { return [...chips] },
    setChips(arr) {
      chips = Array.isArray(arr) ? arr.map(normalize).filter(Boolean) : []
      render()
    },
    destroy() {
      input.removeEventListener('keydown', () => {})
      input.removeEventListener('blur', () => {})
    },
  }
}
