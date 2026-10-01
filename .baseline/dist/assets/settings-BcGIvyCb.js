import { supabase } from './lib/supabaseClient'
import { getCachedProfile } from './auth'
import { showToast, showError, clearError, setLoading } from './ui'
import {
  parseAndDedupeSkills,
  isValidFullName,
  isValidRoleType,
  isValidSkillsList,
} from './validators'
import { icon } from './icons'
import { promoteCursorTo, restoreCursorRoot } from './cursor.js'
import { makeChipInput } from './chip-input.js'
import { initAvatarZone } from './avatar.js'

// ── Module state ───────────────────────────────────────────────────────────
let _dialog = null
let _skillChipInput = null
let _interestChipInput = null
let _avatarDataUrl = null   // current avatar value (base64 or URL or null)
let _currentSession = null
let _openedAt = 0
let _fromRole = null

function _track(event, payload) {
  window.__nexus_track?.(event, payload)
}

// ── Form prefill ───────────────────────────────────────────────────────────
function _fillForm(profile) {
  const nameInput = document.getElementById('settings-name')
  if (nameInput && profile?.full_name) nameInput.value = profile.full_name

  const roleType = profile?.role_type || 'builder'
  const radio = document.querySelector(`input[name="role_type"][value="${roleType}"]`)
  if (radio) radio.checked = true

  if (_skillChipInput) {
    _skillChipInput.setChips(Array.isArray(profile?.skills) ? profile.skills : [])
  }

  if (_interestChipInput) {
    _interestChipInput.setChips(Array.isArray(profile?.interests) ? profile.interests : [])
  }

  // Bio textarea
  const bioEl = document.getElementById('settings-bio')
  if (bioEl) {
    bioEl.value = profile?.bio || ''
    _updateBioCounter(bioEl.value.length)
  }

  // Avatar preview
  _avatarDataUrl = profile?.avatar_url || null
  const avatarZone = document.getElementById('settings-avatar-zone')
  if (avatarZone) {
    const img = avatarZone.querySelector('.avatar-img')
    const placeholder = avatarZone.querySelector('.avatar-placeholder')
    const btnRemove = avatarZone.querySelector('[data-action=remove]')
    if (_avatarDataUrl && img) {
      img.src = _avatarDataUrl
      img.hidden = false
      if (placeholder) placeholder.hidden = true
      if (btnRemove) btnRemove.hidden = false
      avatarZone.dataset.mode = 'filled'
    } else {
      if (img) { img.src = ''; img.hidden = true }
      if (placeholder) placeholder.hidden = false
      if (btnRemove) btnRemove.hidden = true
      avatarZone.dataset.mode = 'empty'
    }
  }
}

function _updateBioCounter(len) {
  const counter = document.getElementById('settings-bio-count')
  if (!counter) return
  counter.textContent = len
  const wrap = counter.closest('.char-counter')
  if (!wrap) return
  if (len >= 158) {
    wrap.style.color = 'var(--fire, #ff1e00)'
  } else if (len >= 145) {
    wrap.style.color = 'var(--gold-vivid, #d4af37)'
  } else {
    wrap.style.color = 'var(--ice-dim, rgba(245,245,245,0.62))'
  }
}

// ── Open settings ──────────────────────────────────────────────────────────
export async function openSettings({
  prefocus = null,
  preset = null,
  mode = 'normal',
  onSaveSuccess = null,
} = {}) {
  _dialog = document.getElementById('settings-modal')
  if (!_dialog) return

  const settingsBtn = document.getElementById('nav-settings-btn')
  if (settingsBtn && !settingsBtn.querySelector('svg')) {
    settingsBtn.appendChild(icon('gear-luxe', { size: 18 }))
  }

  const roleIcons = { visionary: 'spark', builder: 'bolt', enabler: 'vault' }
  for (const [role, iconName] of Object.entries(roleIcons)) {
    const el = document.getElementById(`role-icon-${role}`)
    if (el && !el.querySelector('svg')) {
      el.appendChild(icon(iconName, { size: 20 }))
    }
  }

  const { data: { session } } = await supabase.auth.getSession()
  _currentSession = session
  if (!session) return

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, full_name, role_type, skills, interests, bio, avatar_url')
    .eq('id', session.user.id)
    .single()

  if (profileErr) {
    showToast({ message: 'Failed to load profile. Please try again.', type: 'error' })
    return
  }

  _fromRole = profile?.role_type || null
  _openedAt = Date.now()

  _fillForm(profile)

  if (preset?.role_type) {
    const radio = document.querySelector(`input[name="role_type"][value="${preset.role_type}"]`)
    if (radio) radio.checked = true
  }

  _dialog.dataset.mode = mode
  _dialog.dataset.onSaveSuccess = onSaveSuccess || ''
  clearError('settings-error')

  _dialog.showModal()

  if (prefocus) {
    requestAnimationFrame(() => {
      if (prefocus === 'role_type') {
        const checked = document.querySelector('input[name="role_type"]:checked')
        checked?.focus()
      } else {
        document.getElementById(prefocus)?.focus()
      }
    })
  }
}

// ── Submit handler ─────────────────────────────────────────────────────────
async function _handleSubmit(e) {
  e.preventDefault()
  if (!_currentSession || !_dialog) return

  const mode = _dialog.dataset.mode || 'normal'
  const onSaveSuccess = _dialog.dataset.onSaveSuccess || ''
  const submitBtn = document.getElementById('settings-submit')
  clearError('settings-error')

  const fullName = document.getElementById('settings-name')?.value.trim() || ''
  const roleType = document.querySelector('input[name="role_type"]:checked')?.value || ''
  const skills = _skillChipInput ? _skillChipInput.getChips() : []
  const interests = _interestChipInput ? _interestChipInput.getChips() : []
  const bio = document.getElementById('settings-bio')?.value.trim() || null
  const avatar_url = _avatarDataUrl || null

  if (!isValidRoleType(roleType)) {
    showError('settings-error', 'Please select a role.')
    return
  }

  if (mode !== 'rapid-switch') {
    if (!isValidFullName(fullName)) {
      showError('settings-error', 'Full name must be 2–120 characters.')
      return
    }
    if (!isValidSkillsList(skills)) {
      showError('settings-error', 'Please enter at least one skill (max 50).')
      return
    }
  }

  setLoading(submitBtn, true)
  try {
    const updatePayload = { role_type: roleType }
    if (mode !== 'rapid-switch' || fullName) updatePayload.full_name = fullName || undefined
    if (mode !== 'rapid-switch' || skills.length) updatePayload.skills = skills.length ? skills : undefined
    // Always include new fields (null is valid for bio/avatar)
    updatePayload.interests = interests
    updatePayload.bio = bio
    updatePayload.avatar_url = avatar_url

    for (const k of Object.keys(updatePayload)) {
      if (updatePayload[k] === undefined) delete updatePayload[k]
    }

    const { error } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', _currentSession.user.id)

    if (error) throw error

    if (roleType !== _fromRole) {
      _track('zero_friction_conversion', {
        elapsed_ms: Date.now() - _openedAt,
        from_role: _fromRole,
        to_role: roleType,
      })
    }

    _dialog.classList.add('glass-modal--closing')
    setTimeout(() => {
      _dialog?.close()
      _dialog?.classList.remove('glass-modal--closing')
    }, 200)

    const msg = roleType !== _fromRole
      ? `You're a ${roleType.charAt(0).toUpperCase() + roleType.slice(1)} now`
      : 'Profile updated'
    showToast({ message: msg, icon: roleType !== _fromRole ? 'check-seal' : null, type: 'success' })

    window.dispatchEvent(new CustomEvent('nexus:profile-updated', {
      detail: { session: _currentSession, newRole: roleType },
    }))

    if (onSaveSuccess === 'retry-last-action') {
      _retryPendingIdea()
    }

  } catch (err) {
    console.error('[settings] update:', err.message)
    showError('settings-error', 'Failed to save changes. Please try again.')
  } finally {
    setLoading(submitBtn, false)
  }
}

// ── Pending idea retry ─────────────────────────────────────────────────────
function _retryPendingIdea() {
  try {
    const raw = sessionStorage.getItem('nexus_pending_idea')
    if (!raw) return
    const { ts, ...fields } = JSON.parse(raw)
    if (Date.now() - ts > 10 * 60 * 1000) {
      sessionStorage.removeItem('nexus_pending_idea')
      return
    }
    sessionStorage.removeItem('nexus_pending_idea')
    window.dispatchEvent(new CustomEvent('nexus:retry-pending-idea', { detail: { fields } }))
  } catch {}
}

// ── Wire the modal ─────────────────────────────────────────────────────────
function _initModal() {
  const dialog = document.getElementById('settings-modal')
  if (!dialog) return

  const form = document.getElementById('settings-form')
  form?.addEventListener('submit', _handleSubmit)

  document.getElementById('settings-cancel')?.addEventListener('click', () => dialog.close())
  document.getElementById('settings-modal-close')?.addEventListener('click', () => dialog.close())

  // Chip inputs — skills
  const skillWrap = document.getElementById('settings-skill-chips-wrap')
  if (skillWrap) {
    _skillChipInput = makeChipInput(skillWrap, { name: 'skills', max: 50 })
  }

  // Chip inputs — interests
  const interestWrap = document.getElementById('settings-interest-chips-wrap')
  if (interestWrap) {
    _interestChipInput = makeChipInput(interestWrap, { name: 'interests', max: 30 })
  }

  // Avatar zone
  const avatarZone = document.getElementById('settings-avatar-zone')
  if (avatarZone) {
    initAvatarZone(avatarZone, { onchange: (val) => { _avatarDataUrl = val } })
  }

  // Bio counter
  const bioEl = document.getElementById('settings-bio')
  bioEl?.addEventListener('input', () => _updateBioCounter(bioEl.value.length))

  // Cursor: re-parent into top layer on open, restore on close
  dialog.addEventListener('toggle', () => {
    if (dialog.open) promoteCursorTo(dialog)
    else restoreCursorRoot()
  })

  dialog.addEventListener('click', e => {
    if (e.target === dialog) dialog.close()
  })

  dialog.addEventListener('close', () => {
    clearError('settings-error')
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initModal)
} else {
  _initModal()
}
