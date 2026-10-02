import { logger } from './lib/logger.js'
import { supabase } from './lib/supabase.js'
import { showError, clearError, setLoading, debounce } from './ui.js'
import {
  isValidEmail,
  isValidPassword,
  isValidFullName,
  isValidRoleType,
  parseAndDedupeSkills,
  isValidSkillsList,
} from './validators.js'

let _authSubscription = null
let _cachedProfile = null

export function getCachedProfile() {
  return _cachedProfile
}

function _usernameFromUser(user, fallbackName = '') {
  const source = user.email?.split('@')[0] || fallbackName || 'member'
  const base = source
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'member'
  const fallbackId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()
  const suffix = String(user.id || fallbackId).replace(/-/g, '').slice(0, 6)
  return `${base}_${suffix}`.slice(0, 32)
}

function _skillsFromMeta(meta) {
  return parseAndDedupeSkills(meta.skills_list || meta.skills || meta.skills_csv || '')
}

function _profilePayloadFromUser(user) {
  const meta = user.user_metadata || {}
  const fullName = String(meta.full_name || meta.fullName || user.email?.split('@')[0] || 'New Member')
    .trim()
    .slice(0, 80)
  const roleType = isValidRoleType(meta.role_type) ? meta.role_type : isValidRoleType(meta.role) ? meta.role : 'visionary'
  return {
    id: user.id,
    username: _usernameFromUser(user, fullName),
    full_name: fullName.length >= 2 ? fullName : 'New Member',
    role_type: roleType,
    skills: _skillsFromMeta(meta),
  }
}

async function _fetchAndCacheProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, full_name, role_type, skills, interests, bio, avatar_url, reputation, is_verified')
    .eq('id', userId)
    .single()
  _cachedProfile = error ? null : data
  return _cachedProfile
}

// Called after email-link confirmation: creates or repairs the profile from
// user_metadata. The committed schema requires `username`, so the client must
// not rely on a partial insert when the database trigger did not run.
async function _upsertProfileFromMeta(user) {
  const { error } = await supabase.from('profiles').upsert(_profilePayloadFromUser(user), { onConflict: 'id' })
  if (error) logger.error('auth', 'profile upsert failed', error)
  return _fetchAndCacheProfile(user.id)
}

/**
 * Bootstrap auth:
 *   1. Hydrates session from storage.
 *   2. Subscribes to all future auth state changes.
 *   3. Calls onSessionChange(session) synchronously for the initial state
 *      and on every subsequent change.
 *
 * Store the return value and call teardownAuth() on beforeunload.
 */
export async function initAuth(onSessionChange) {
  const isMagicLinkCallback =
    window.location.hash.includes('access_token') ||
    window.location.search.includes('token_hash') ||
    window.location.search.includes('type=magiclink');

  if (isMagicLinkCallback) {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        const profile = await _fetchAndCacheProfile(session.user.id)
        if (!profile) await _upsertProfileFromMeta(session.user)
      } else {
        _cachedProfile = null
      }
      onSessionChange(session)
    })
    _authSubscription = subscription
    return
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (session) await _fetchAndCacheProfile(session.user.id)
  onSessionChange(session)

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      const profile = await _fetchAndCacheProfile(session.user.id)
      // Profile missing means this is the first sign-in after email confirmation
      if (!profile) await _upsertProfileFromMeta(session.user)
    } else {
      _cachedProfile = null
    }
    onSessionChange(session)
  })

  _authSubscription = subscription
}

export function teardownAuth() {
  if (_authSubscription) _authSubscription.unsubscribe()
  _authSubscription = null
}

export const handleSignIn = debounce(async (email, password, onSuccess) => {
  const btn = document.getElementById('login-submit')
  clearError('login-error')

  // Client-side validation before any network call
  if (!isValidEmail(email.trim())) {
    showError('login-error', 'Please enter a valid email address.', { field: 'login-email' })
    return
  }
  if (!password) {
    showError('login-error', 'Password is required.', { field: 'login-password' })
    return
  }

  setLoading(btn, true)
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) {
      logger.error('auth', 'signIn failed', error)
      showError('login-error', 'Incorrect email or password. Please try again.')
      return
    }
    onSuccess(data.session)
  } finally {
    setLoading(btn, false)
  }
}, 800)

export const handleMagicLinkSignIn = debounce(async (email, onSuccess) => {
  const btn = document.getElementById('login-submit')
  clearError('login-error')

  if (!isValidEmail(email.trim())) {
    showError('login-error', 'Please enter a valid email address.', { field: 'login-email' })
    return
  }

  setLoading(btn, true)
  try {
    const { data, error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin
      }
    })
    if (error) {
      logger.error('auth', 'magic link failed', error)
      showError('login-error', 'Failed to send magic link. Please try again.')
      return
    }
    if (onSuccess) onSuccess(data)
  } finally {
    setLoading(btn, false)
  }
}, 800)

export const handleSignUp = debounce(
  async (fields, onSuccess, onConfirmNeeded) => {
    const btn = document.getElementById('register-submit')
    clearError('register-error')

    const { fullName, email, password, roleType, skillsRaw } = fields
    const skills = parseAndDedupeSkills(skillsRaw)

    if (!isValidFullName(fullName)) {
      showError('register-error', 'Full name must be 2–80 characters.', { field: 'register-name' })
      return
    }
    if (!isValidEmail(email.trim())) {
      showError('register-error', 'Please enter a valid email address.', { field: 'register-email' })
      return
    }
    if (!isValidPassword(password)) {
      showError(
        'register-error',
        'Password must be at least 8 characters and include at least one letter and one number.',
        { field: 'register-password' }
      )
      return
    }
    if (!isValidRoleType(roleType)) {
      showError('register-error', 'Please select a role.', { field: 'register-role' })
      return
    }
    if (!isValidSkillsList(skills)) {
      showError(
        'register-error',
        'Please enter at least one skill (comma-separated, max 20).',
        { field: 'register-skills' }
      )
      return
    }

    setLoading(btn, true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            role: roleType,
            role_type: roleType,
            skills: skills.join(', '),
            skills_list: skills,
          },
        },
      })

      if (error) {
        logger.error('auth', 'signUp failed', error)
        showError(
          'register-error',
          'Registration failed. This email may already be in use.'
        )
        return
      }

      // Email confirmation pending — no session yet
      if (!data.session) {
        onConfirmNeeded()
        return
      }

      // Immediate session (email confirmation disabled) — the database trigger
      // normally creates the row. Upsert a full schema-valid profile so local
      // dev projects without the trigger do not produce an orphan auth user.
      const profilePayload = {
        id: data.user.id,
        username: _usernameFromUser(data.user, fullName),
        full_name: fullName.trim(),
        role_type: roleType,
        skills,
      }
      const { error: profileErr } = await supabase
        .from('profiles')
        .upsert(profilePayload, { onConflict: 'id' })

      if (profileErr) {
        logger.error('auth', 'profile upsert failed', profileErr)
        // Rollback: sign out to prevent an orphan auth user with no profile
        await supabase.auth.signOut()
        showError(
          'register-error',
          'Account setup failed. Please try again.'
        )
        return
      }

      _cachedProfile = profilePayload
      onSuccess(data.session)
    } finally {
      setLoading(btn, false)
    }
  },
  800
)

export async function handleSignOut() {
  await supabase.auth.signOut()
  _cachedProfile = null
}
