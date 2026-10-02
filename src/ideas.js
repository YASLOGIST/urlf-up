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
import { t } from './app/strings.js'
import { openSettings } from './settings.js'

export const handleIdeaSubmit = debounce(async (fields, session) => {
  const btn = document.getElementById('idea-submit')
  clearError('idea-error')

  const { title, industry, problem, skillsRaw } = fields
  const requiredSkills = parseAndDedupeSkills(skillsRaw)

  // Input validation
  if (!isValidIdeaTitle(title)) {
    showError('idea-error', t('idea.error.title'), { field: 'idea-title' })
    return
  }
  if (!isValidIndustry(industry)) {
    showError('idea-error', t('idea.error.industry'), { field: 'idea-industry' })
    return
  }
  if (!isValidProblemSolved(problem)) {
    showError(
      'idea-error',
      t('idea.error.problem'),
      { field: 'idea-problem' }
    )
    return
  }
  if (!isValidRequiredSkills(requiredSkills)) {
    showError('idea-error', t('idea.error.skills'), { field: 'idea-skills' })
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
        problem: problem.trim(),
        skillsRaw: requiredSkills.join(', '),
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
      message: t('idea.toast.visionaryOnly'),
      type: 'error',
      action: {
        label: t('idea.action.switchToVisionary'),
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
        author_id: session.user.id,
        title: title.trim(),
        industry: industry.trim(),
        problem_statement: problem.trim(),
        required_skills: requiredSkills,
        status: 'open',
        published_at: new Date().toISOString(),
      })
      .select('id, author_id, title, industry, problem_statement, required_skills, status, published_at, created_at')
      .single()

    if (error) {
      logger.error('ideas', 'insert failed', error)
      showError('idea-error', t('idea.error.submitFailed'))
      return
    }

    // Optimistic success path
    closeModal('idea-modal')
    showToast({ message: t('idea.toast.launched'), icon: 'rocket', type: 'success' })
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
    .select('id, author_id, title, industry, problem_statement, required_skills, status, published_at, created_at')
    .eq('author_id', userId)
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
