import { logger } from './lib/logger.js'
import { supabase } from './lib/supabase.js'
import {
  showError,
  clearError,
  setLoading,
  showToast,
  closeModal,
  buildIdeaCard,
  debounce,
} from './ui.js'
import {
  parseAndDedupeSkills,
  isValidIdeaTitle,
  isValidIndustry,
  isValidProblemSolved,
  isValidRequiredSkills,
} from './validators.js'
import { getCachedProfile } from './auth.js'
import { openSettings } from './settings.js'

export const handleIdeaSubmit = debounce(async (fields, session) => {
  const btn = document.getElementById('idea-submit')
  clearError('idea-error')

  const { title, industry, problem, skillsRaw } = fields
  const requiredSkills = parseAndDedupeSkills(skillsRaw)

  // Input validation
  if (!isValidIdeaTitle(title)) {
    showError('idea-error', 'Idea title must be 5–200 characters.', { field: 'idea-title' })
    return
  }
  if (!isValidIndustry(industry)) {
    showError('idea-error', 'Industry must be 2–80 characters.', { field: 'idea-industry' })
    return
  }
  if (!isValidProblemSolved(problem)) {
    showError(
      'idea-error',
      'Problem description must be at least 20 characters (max 5000).',
      { field: 'idea-problem' }
    )
    return
  }
  if (!isValidRequiredSkills(requiredSkills)) {
    showError('idea-error', 'Required skills list cannot exceed 30 items.', { field: 'idea-skills' })
    return
  }

  // Role check BEFORE insert — zero-friction conversion funnel
  const profile = getCachedProfile()
  if (!profile || profile.role_type !== 'visionary') {
    // Cache form data for automatic retry after role switch (TTL: 10 min)
    try {
      sessionStorage.setItem('nexus_pending_idea', JSON.stringify({
        title: title.trim(),
        industry: industry.trim(),
        problem_solved: problem.trim(),
        required_skills: requiredSkills,
        ts: Date.now(),
      }))
    } catch {
      /* Draft persistence is best-effort; a storage failure must not block
         the submission the user already completed. */
    }
    // Close idea modal before showing toast
    closeModal('idea-modal')
    // Toast with keyboard-focused CTA (auto-focused by showToast)
    showToast({
      message: 'Only visionaries can submit ideas.',
      type: 'error',
      action: {
        label: 'Switch to Visionary',
        onClick: () => openSettings({
          prefocus: 'role_type',
          preset: { role_type: 'visionary' },
          mode: 'rapid-switch',
          onSaveSuccess: 'retry-last-action',
        }),
      },
    })
    window.__nexus_track?.('role_switch_prompted', { from: profile?.role_type || 'unknown' })
    return
  }

  setLoading(btn, true)
  try {
    const { data, error } = await supabase
      .from('ideas')
      .insert({
        user_id: session.user.id,
        title: title.trim(),
        industry: industry.trim(),
        problem_solved: problem.trim(),
        required_skills: requiredSkills,
      })
      .select()
      .single()

    if (error) {
      logger.error('ideas', 'insert failed', error)
      showError('idea-error', 'Failed to submit your idea. Please try again.')
      return
    }

    // Optimistic success path
    closeModal('idea-modal')
    showToast({ message: 'Idea launched', icon: 'rocket', type: 'success' })
    _appendIdeaCard(data)
    document.getElementById('idea-form')?.reset()
  } finally {
    setLoading(btn, false)
  }
}, 800)

function _appendIdeaCard(idea) {
  const feed = document.getElementById('ideas-feed-list')
  if (!feed) return

  const card = buildIdeaCard(idea)
  feed.insertBefore(card, feed.firstChild)

  const section = document.getElementById('ideas-feed-section')
  if (section) section.hidden = false

  // Trigger reveal animation on the freshly inserted card
  requestAnimationFrame(() =>
    requestAnimationFrame(() => card.classList.add('in'))
  )
}

window.addEventListener('nexus:retry-pending-idea', ({ detail }) => {
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) handleIdeaSubmit(detail.fields, session)
  })
})

export async function loadUserIdeas(userId) {
  const { data, error } = await supabase
    .from('ideas')
    .select('id, title, industry, problem_solved, required_skills, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    logger.error('ideas', 'load failed', error)
    return
  }
  if (!data || data.length === 0) return

  const feed = document.getElementById('ideas-feed-list')
  const section = document.getElementById('ideas-feed-section')
  if (!feed || !section) return

  feed.textContent = '' // safe clear — no innerHTML
  data.forEach(idea => feed.appendChild(buildIdeaCard(idea)))
  section.hidden = false
}
