import { logger } from './lib/logger.js'
import { supabase } from './lib/supabase.js'
import { safeName } from './sanitize.js'
import { t, tCount, localeShortDate } from './app/strings.js'
import { ideaProblem, rankIdeasForProfile, rankMatches } from './matchingEngine.js'
import { icon } from './icons.js'
import { showToast } from './ui.js'
import { createVerificationBadge } from './components/VerificationBadge.js'
import { openDealRoom } from './components/DealRoom.js'

// ── Telemetry no-op (swap for PostHog/Plausible) ──────────────────────────
window.__nexus_track = window.__nexus_track || function () {}
function _track(event, payload) {
  window.__nexus_track(event, payload)
}

const PROFILE_SELECT =
  'id, username, full_name, avatar_url, role_type, bio, skills, interests, is_verified, reputation, last_seen_at, created_at'
const IDEA_SELECT =
  'id, author_id, title, problem_statement, industry, required_skills, status, interest_count, is_featured, published_at, created_at, updated_at'
const PUBLIC_IDEA_SELECT =
  'id, author_id, title, problem_statement, industry, required_skills, status, interest_count, is_featured, published_at, created_at, updated_at, author_name, author_avatar, author_verified'
const INTEREST_SELECT =
  'id, idea_id, interested_user_id, role_at_time, message, status, responded_at, created_at, updated_at'

let _realtimeChannel = null
let _intersectionObs = null
let _refreshTimer = null
let _currentSession = null
let _currentProfile = null
let _authSubscription = null
let _lastLoadId = 0
/** Last rendered payload per role — lets a language flip re-render in place. */
let _lastRender = null

// ── Minimal createElement helper — no innerHTML ever ──────────────────────
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue
    if (k === 'className') node.className = v
    else if (k === 'dataset') Object.assign(node.dataset, v)
    else if (k === 'style') node.style.cssText = v
    else node.setAttribute(k, v)
  }
  if (text != null) node.textContent = text
  return node
}

function appendIcon(parent, name, options = {}) {
  try {
    parent.appendChild(icon(name, options))
  } catch {
    /* Icons are decorative; a missing symbol must not suppress content. */
  }
}

function normaliseIdea(row) {
  return {
    ...row,
    problem_solved: ideaProblem(row),
    required_skills: Array.isArray(row?.required_skills) ? row.required_skills : [],
  }
}

/* Console copy is bilingual — every label resolves through the dictionary
   in src/app/strings.js, so the dashboard follows the page language. */
/** Translate `key`, falling back to `fallback` when the key is unknown. */
function tr(key, fallback) {
  const label = t(key)
  return label !== key ? label : fallback
}

function statusLabel(status = '') {
  const key = `status.${(status || 'pending').replace(/_/g, '')}`
  const label = t(key)
  return label !== key ? label : (status || 'pending').replace(/_/g, ' ')
}

function roleLabel(role = '') {
  const key = `role.${role}`
  const label = t(key)
  if (label !== key) return label
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : t('role.member')
}

function reputationTier(profile = {}) {
  if (profile.is_verified || profile.reputation >= 50) return 'gold'
  if (profile.reputation >= 20) return 'silver'
  return 'bronze'
}

// ── SWR cache ─────────────────────────────────────────────────────────────
function _setCache(key, data) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }))
  } catch {
    /* Private mode / quota exceeded. The cache is an optimisation; losing a
       write must never surface to the user. */
  }
}

function _getCache(key, ttl = 60000) {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    return Date.now() - ts < ttl ? data : null
  } catch {
    return null
  }
}

function _clearCache(prefix) {
  try {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith(prefix))
      .forEach(k => sessionStorage.removeItem(k))
  } catch {
    /* Storage unavailable — nothing to purge. */
  }
}

// ── SVG Viability Ring (pure SVG, no library) ─────────────────────────────
function _ideaReadinessScore(idea) {
  const skills = Array.isArray(idea.required_skills) ? idea.required_skills.length : 0
  const problemLength = ideaProblem(idea).length
  let score = 25
  if (idea.title?.length >= 5) score += 15
  if (idea.industry?.length >= 2) score += 15
  if (problemLength >= 160) score += 25
  else if (problemLength >= 60) score += 15
  if (skills >= 3) score += 15
  else if (skills > 0) score += 8
  if (idea.status === 'open') score += 5
  return Math.min(100, score)
}

function _buildScoreRing(score, label = 'Readiness') {
  const r = 38
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score ?? 0))
  const dash = (pct / 100) * c
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('width', '60')
  svg.setAttribute('height', '60')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `${label}: ${pct}`)

  const track = document.createElementNS(ns, 'circle')
  track.setAttribute('cx', '50')
  track.setAttribute('cy', '50')
  track.setAttribute('r', String(r))
  track.setAttribute('fill', 'none')
  track.setAttribute('stroke-width', '8')
  track.classList.add('score-ring-track')

  const fill = document.createElementNS(ns, 'circle')
  fill.setAttribute('cx', '50')
  fill.setAttribute('cy', '50')
  fill.setAttribute('r', String(r))
  fill.setAttribute('fill', 'none')
  fill.setAttribute('stroke-width', '8')
  fill.setAttribute('stroke-dasharray', `${dash} ${c}`)
  fill.setAttribute('stroke-dashoffset', String(c * 0.25))
  fill.setAttribute('transform', 'rotate(-90 50 50)')
  fill.classList.add('score-ring-fill')

  const text = document.createElementNS(ns, 'text')
  text.setAttribute('x', '50')
  text.setAttribute('y', '50')
  text.setAttribute('text-anchor', 'middle')
  text.setAttribute('dominant-baseline', 'central')
  text.setAttribute('font-size', '18')
  text.setAttribute('font-weight', '700')
  text.setAttribute('fill', '#d4af37')
  text.textContent = String(Math.round(pct))

  svg.append(track, fill, text)
  return svg
}

function _buildSkillTags(skills = [], limit = 8) {
  const wrap = el('div', { className: 'nx-skills' })
  skills.slice(0, limit).forEach(skill => wrap.appendChild(el('span', { className: 'nx-skill-tag' }, skill)))
  if (skills.length > limit) wrap.appendChild(el('span', { className: 'nx-skill-tag' }, `+${skills.length - limit}`))
  return wrap
}

function _axisLabel(axis) {
  const key = `match.axis.${axis}`
  const label = t(key)
  return label !== key ? label : axis
}

/** noteParams values that are themselves keys (role.*) resolve recursively. */
function _noteText(reason) {
  if (reason.noteKey) {
    const params = {}
    for (const [k, v] of Object.entries(reason.noteParams || {})) {
      const resolved = t(v)
      params[k] = resolved !== v ? resolved : v
    }
    return t(reason.noteKey, params)
  }
  return reason.note
}

function _buildReasonList(match) {
  const list = el('ul', { className: 'nx-reasons' })
  const reasons = (match.reasons || [])
    .filter(reason => reason.score >= 55 || reason.axis === 'skills')
    .slice(0, 3)
  reasons.forEach(reason => {
    const item = el('li')
    item.appendChild(el('strong', {}, `${_axisLabel(reason.axis)}: `))
    item.appendChild(document.createTextNode(_noteText(reason)))
    list.appendChild(item)
  })
  return list
}

function _buildMatchMeter(match) {
  const meter = el('div', { className: 'nx-match-meter' })
  const score = el('div', { className: 'nx-match-meter-score' })
  score.appendChild(el('span', { className: 'nx-score-num' }, String(match.matchScore)))
  score.appendChild(el('span', { className: 'nx-score-label' }, t('nx.score')))
  const tier = el('span', { className: 'nx-tier-badge' }, tr(`match.tier.${match.tier}`, match.tier))
  const confidence = el('span', { className: 'nx-confidence' }, t('nx.confidence', { value: Math.round(match.confidence * 100) }))
  meter.append(score, tier, confidence)
  return meter
}

// ── Skeleton / state helpers ──────────────────────────────────────────────
function _renderSkeletons(count = 3) {
  const host = document.getElementById('nx-skeleton')
  if (!host) return
  host.textContent = ''
  for (let i = 0; i < count; i += 1) {
    const s = el('div', { className: 'nx-skeleton' })
    s.style.height = i === 0 ? '180px' : '140px'
    s.style.marginBottom = '16px'
    host.appendChild(s)
  }
  host.hidden = false
}

function _hideSkeletons() {
  const host = document.getElementById('nx-skeleton')
  if (host) {
    host.hidden = true
    host.textContent = ''
  }
}

function _hideError() {
  const host = document.getElementById('nx-error')
  if (host) {
    host.hidden = true
    host.textContent = ''
  }
}

function _renderError(err, retryFn) {
  const host = document.getElementById('nx-error')
  if (!host) return
  host.textContent = ''
  const wrap = el('div', { className: 'nx-error-state' })
  wrap.appendChild(el('p', { className: 'nx-error-msg' }, t('nx.error')))

  if (retryFn) {
    const btn = el('button', { className: 'btn-accept', type: 'button' }, t('nx.retry'))
    btn.addEventListener('click', retryFn)
    wrap.appendChild(btn)
  }

  host.appendChild(wrap)
  host.hidden = false
  logger.error('dashboard', 'render failed', err)
}

function _renderEmptyState(role) {
  const host = document.getElementById('nx-empty')
  if (!host) return
  host.textContent = ''
  const wrap = el('div', { className: 'nx-empty' })
  const t = el('div', { className: 'nx-empty-title' })
  const s = el('div', { className: 'nx-empty-sub' })

  // Remember the empty state so a language flip re-renders it too.
  _lastRender = { role, data: null }

  if (role === 'visionary') {
    t.textContent = t('nx.empty.visionary.title')
    s.textContent = t('nx.empty.visionary.sub')
  } else {
    t.textContent = t('nx.empty.operator.title')
    s.textContent = t('nx.empty.operator.sub')
  }

  wrap.append(t, s)
  host.appendChild(wrap)
  host.hidden = false
}

function _hideAllPanels() {
  for (const id of ['nx-ideas-panel', 'nx-matches-panel', 'nx-ai-matches-panel', 'nx-empty']) {
    const node = document.getElementById(id)
    if (node) node.hidden = true
  }
  for (const id of ['nx-ideas-list', 'nx-matches-list', 'nx-ai-matches-list']) {
    const node = document.getElementById(id)
    if (node) node.textContent = ''
  }
}

// ── Data fetching ─────────────────────────────────────────────────────────
async function _fetchCurrentProfile(session) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', session.user.id)
    .single()

  if (!error && data) return data
  return {
    id: session.user.id,
    full_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Member',
    role_type: session.user.user_metadata?.role_type || session.user.user_metadata?.role || 'builder',
    skills: [],
    interests: [],
    reputation: 0,
    is_verified: false,
  }
}

async function _loadInterestProfiles(interests) {
  const ids = [...new Set(interests.map(i => i.interested_user_id).filter(Boolean))]
  if (!ids.length) return new Map()
  const { data, error } = await supabase.from('profiles_public').select(PROFILE_SELECT).in('id', ids)
  if (error) throw error
  return new Map((data || []).map(profile => [profile.id, profile]))
}

async function _loadCandidateProfiles(excludeId) {
  const { data, error } = await supabase
    .from('profiles_public')
    .select(PROFILE_SELECT)
    .neq('id', excludeId)
    .limit(100)
  if (error) throw error
  return (data || []).filter(profile => profile.role_type !== 'visionary')
}

async function _loadVisionaryData(session) {
  const { data: ideaRows, error: ideasErr } = await supabase
    .from('ideas')
    .select(IDEA_SELECT)
    .eq('author_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(20)
  if (ideasErr) throw ideasErr

  const ideas = (ideaRows || []).map(normaliseIdea)
  const ideaIds = ideas.map(idea => idea.id)
  let interests = []
  if (ideaIds.length) {
    const { data, error } = await supabase
      .from('idea_interests')
      .select(INTEREST_SELECT)
      .in('idea_id', ideaIds)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error
    interests = data || []
  }

  const [interestProfiles, candidates] = await Promise.all([
    _loadInterestProfiles(interests),
    _loadCandidateProfiles(session.user.id).catch(err => {
      logger.warn('dashboard', 'candidate recommendations unavailable', err)
      return []
    }),
  ])

  const recommendationsByIdea = new Map()
  for (const idea of ideas) {
    recommendationsByIdea.set(
      idea.id,
      rankMatches(idea, candidates, { includeRejected: false, limit: 3, threshold: 45 })
    )
  }

  return { ideas, interests, interestProfiles, recommendationsByIdea }
}

async function _loadOperatorData(session, profile) {
  const [{ data: ideaRows, error: ideasErr }, { data: interestRows, error: interestErr }] = await Promise.all([
    supabase
      .from('ideas_public')
      .select(PUBLIC_IDEA_SELECT)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(60),
    supabase
      .from('idea_interests')
      .select(INTEREST_SELECT)
      .eq('interested_user_id', session.user.id)
      .limit(100),
  ])

  if (ideasErr) throw ideasErr
  if (interestErr) throw interestErr

  const ownInterestByIdea = new Map((interestRows || []).map(row => [row.idea_id, row]))
  const ideas = (ideaRows || [])
    .map(normaliseIdea)
    .filter(idea => idea.author_id !== session.user.id)
  const ranked = rankIdeasForProfile(profile, ideas, { includeRejected: true, limit: 24, threshold: 0 })
    .filter(match => match.matchScore >= 30 || ownInterestByIdea.has(match.idea.id))

  return { matches: ranked, ownInterestByIdea }
}

// ── Visionary rendering ───────────────────────────────────────────────────
function _buildInterestCard(interest, profile, idea) {
  const card = el('div', { className: 'nx-card match-card match-card--candidate', dataset: { id: interest.id, status: interest.status } })
  const info = el('div', { className: 'nx-candidate-info' })
  const name = el('span', { className: 'nx-candidate-name' }, safeName(profile?.full_name || t('nx.anonymous')))
  const role = el('span', { className: 'nx-chip' }, roleLabel(profile?.role_type || interest.role_at_time))
  info.append(name, role, createVerificationBadge(reputationTier(profile)))

  if (profile?.skills?.length) info.appendChild(_buildSkillTags(profile.skills, 5))
  if (interest.message) info.appendChild(el('p', { className: 'nx-interest-message' }, interest.message))

  const statusWrap = el('div', { className: 'nx-interest-actions' })
  statusWrap.appendChild(el('span', { className: `nx-status-badge nx-status--${interest.status}` }, statusLabel(interest.status)))

  if (interest.status === 'pending' || interest.status === 'acknowledged') {
    const accept = el('button', { className: 'btn-accept', type: 'button' }, t('nx.accept'))
    const decline = el('button', { className: 'btn-pass', type: 'button' }, t('nx.decline'))
    accept.addEventListener('click', () => _handleInterestStatus(interest.id, 'accepted', card))
    decline.addEventListener('click', () => _handleInterestStatus(interest.id, 'declined', card))
    statusWrap.append(accept, decline)
  } else if (interest.status === 'accepted') {
    const deal = el('button', { className: 'btn-accept', type: 'button' }, t('nx.dealRoom'))
    deal.addEventListener('click', () => openDealRoom(
      { ...profile, ...interest, idea_title: idea.title },
      () => showToast({ message: t('nx.toast.termsReady'), icon: 'check-seal', type: 'success' }),
      { trigger: deal }
    ))
    statusWrap.appendChild(deal)
  }

  card.append(info, statusWrap)
  return card
}

function _buildCandidateCard(match) {
  const profile = match.candidate
  const card = el('div', { className: 'nx-card match-card match-card--candidate nx-recommendation-card' })
  const info = el('div', { className: 'nx-candidate-info' })
  const name = el('span', { className: 'nx-candidate-name' }, safeName(profile.full_name || profile.username || t('nx.recommendedMember')))
  const role = el('span', { className: 'nx-chip' }, roleLabel(profile.role_type))
  info.append(name, role, createVerificationBadge(reputationTier(profile)))
  if (profile.skills?.length) info.appendChild(_buildSkillTags(profile.skills, 5))
  card.append(_buildMatchMeter(match), info, _buildReasonList(match))
  return card
}

function _buildVisionaryIdeaCard(idea, interests, interestProfiles, recommendations) {
  const card = el('article', { className: 'nx-card idea-card-nx' })
  const header = el('div', { className: 'nx-idea-header' })
  const meta = el('div', { className: 'nx-idea-meta' })
  meta.appendChild(el('h3', { className: 'nx-idea-title' }, idea.title || t('nx.untitled')))
  const chips = el('div', { className: 'nx-chip-row' })
  chips.appendChild(el('span', { className: 'nx-chip' }, idea.industry || t('nx.uncategorised')))
  chips.appendChild(el('span', { className: `nx-status-badge nx-status--${idea.status}` }, statusLabel(idea.status)))
  if (idea.published_at || idea.created_at) chips.appendChild(el('span', { className: 'nx-muted-chip' }, localeShortDate(idea.published_at || idea.created_at)))
  meta.appendChild(chips)

  const ringWrap = el('div', { className: 'nx-ring-wrap' })
  ringWrap.appendChild(_buildScoreRing(_ideaReadinessScore(idea), t('nx.readinessAria')))
  ringWrap.appendChild(el('div', { className: 'nx-ring-label' }, t('nx.readiness')))

  header.append(meta, ringWrap)
  card.appendChild(header)
  card.appendChild(el('p', { className: 'nx-idea-problem' }, ideaProblem(idea)))
  if (idea.required_skills?.length) card.appendChild(_buildSkillTags(idea.required_skills))

  const interestSection = el('section', { className: 'nx-idea-matches', 'aria-label': t('nx.interestAria', { title: idea.title || t('nx.untitledIdea') }) })
  interestSection.appendChild(el('h4', { className: 'nx-matches-heading' }, tCount('nx.incomingInterest', interests.length)))
  if (interests.length) {
    interests.forEach(interest => interestSection.appendChild(_buildInterestCard(interest, interestProfiles.get(interest.interested_user_id), idea)))
  } else {
    interestSection.appendChild(el('p', { className: 'nx-no-matches' }, t('nx.noInterestYet')))
  }
  card.appendChild(interestSection)

  const recSection = el('section', { className: 'nx-idea-matches', 'aria-label': t('nx.recommendedOperatorsAria', { title: idea.title || t('nx.untitledIdea') }) })
  recSection.appendChild(el('h4', { className: 'nx-matches-heading' }, t('nx.recommendedOperators')))
  if (recommendations.length) {
    recommendations.forEach(match => recSection.appendChild(_buildCandidateCard(match)))
  } else {
    recSection.appendChild(el('p', { className: 'nx-no-matches' }, t('nx.improveRecommendations')))
  }
  card.appendChild(recSection)
  return card
}

function _renderVisionary(data) {
  const panel = document.getElementById('nx-ideas-panel')
  const list = document.getElementById('nx-ideas-list')
  if (!panel || !list) return
  list.textContent = ''

  if (!data.ideas.length) {
    _renderEmptyState('visionary')
    return
  }

  const interestsByIdea = new Map()
  for (const interest of data.interests) {
    if (!interestsByIdea.has(interest.idea_id)) interestsByIdea.set(interest.idea_id, [])
    interestsByIdea.get(interest.idea_id).push(interest)
  }

  for (const idea of data.ideas) {
    const card = _buildVisionaryIdeaCard(
      idea,
      interestsByIdea.get(idea.id) || [],
      data.interestProfiles,
      data.recommendationsByIdea.get(idea.id) || []
    )
    list.appendChild(card)
  }

  panel.hidden = false
  _lastRender = { role: 'visionary', data }
  _renderRecommendationSpotlight(data)
  _track('dashboard_view', { role: 'visionary', ideaCount: data.ideas.length })
}

// ── Builder / enabler rendering ───────────────────────────────────────────
function _interestForMatch(match, ownInterestByIdea) {
  return ownInterestByIdea.get(match.idea.id) || null
}

function _buildOpportunityCard(match, ownInterestByIdea) {
  const idea = match.idea
  const interest = _interestForMatch(match, ownInterestByIdea)
  const card = el('article', { className: 'nx-card match-card nx-opportunity-card', dataset: { id: idea.id } })
  const body = el('div', { className: 'nx-card-body' })

  const head = el('div', { className: 'nx-opportunity-head' })
  const titleWrap = el('div')
  titleWrap.appendChild(el('h3', { className: 'nx-idea-title' }, idea.title || t('nx.untitledIdea')))
  const author = safeName(idea.author_name || t('role.visionary'))
  titleWrap.appendChild(el('p', { className: 'nx-author-line' }, `${author}${idea.author_verified ? ` · ${t('nx.verified')}` : ''}`))
  head.append(titleWrap, _buildMatchMeter(match))

  const chips = el('div', { className: 'nx-chip-row' })
  chips.appendChild(el('span', { className: 'nx-chip' }, idea.industry || t('nx.uncategorised')))
  if (idea.interest_count) chips.appendChild(el('span', { className: 'nx-muted-chip' }, tCount('nx.interestedCount', idea.interest_count)))
  if (idea.published_at || idea.created_at) chips.appendChild(el('span', { className: 'nx-muted-chip' }, localeShortDate(idea.published_at || idea.created_at)))

  body.append(head, chips, el('p', { className: 'nx-idea-problem' }, ideaProblem(idea)))
  if (idea.required_skills?.length) body.appendChild(_buildSkillTags(idea.required_skills))
  body.appendChild(_buildReasonList(match))

  const actions = el('div', { className: 'nx-actions' })
  if (interest) {
    actions.appendChild(el('span', { className: `nx-status-badge nx-status--${interest.status}` }, tr(`nx.interestBadge.${interest.status}`, `Interest ${statusLabel(interest.status)}`)))
    if (interest.status === 'pending' || interest.status === 'acknowledged') {
      const withdraw = el('button', { className: 'btn-pass', type: 'button' }, t('nx.withdraw'))
      withdraw.addEventListener('click', () => _handleInterestStatus(interest.id, 'withdrawn', card))
      actions.appendChild(withdraw)
    }
  } else {
    const express = el('button', { className: 'btn-accept', type: 'button' })
    appendIcon(express, 'spark', { size: 14 })
    express.appendChild(document.createTextNode(t('nx.express')))
    express.addEventListener('click', () => _handleExpressInterest(match, card))
    actions.appendChild(express)
  }
  body.appendChild(actions)

  card.append(body)
  return card
}

function _renderBuilder(data) {
  const panel = document.getElementById('nx-matches-panel')
  const list = document.getElementById('nx-matches-list')
  if (!panel || !list) return
  list.textContent = ''

  if (!data.matches.length) {
    _renderEmptyState(_currentProfile?.role_type || 'builder')
    return
  }

  data.matches.forEach(match => {
    const card = _buildOpportunityCard(match, data.ownInterestByIdea)
    list.appendChild(card)
    requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('nx-card--new')))
  })

  panel.hidden = false
  _lastRender = { role: _currentProfile?.role_type || 'builder', data }
  _renderRecommendationSpotlight(data)
  _track('dashboard_view', { role: _currentProfile?.role_type || 'builder', matchCount: data.matches.length })
}

function _renderRecommendationSpotlight(data) {
  const panel = document.getElementById('nx-ai-matches-panel')
  const list = document.getElementById('nx-ai-matches-list')
  const title = document.getElementById('nx-ai-matches-title')
  const sub = document.getElementById('nx-ai-matches-subtitle')
  if (!panel || !list) return
  list.textContent = ''

  if (_currentProfile?.role_type === 'visionary') {
    const top = []
    for (const idea of data.ideas || []) {
      for (const match of data.recommendationsByIdea.get(idea.id) || []) top.push({ idea, match })
    }
    top.sort((a, b) => b.match.matchScore - a.match.matchScore)
    if (!top.length) {
      panel.hidden = true
      return
    }
    if (title) title.textContent = t('nx.spotlight.visionary.title')
    if (sub) sub.textContent = t('nx.spotlight.visionary.sub')
    top.slice(0, 3).forEach(({ idea, match }) => {
      const wrap = _buildCandidateCard(match)
      wrap.prepend(el('div', { className: 'nx-muted-chip' }, t('nx.for', { title: idea.title || t('nx.untitledIdea') })))
      list.appendChild(wrap)
    })
  } else {
    const top = (data.matches || []).slice(0, 3)
    if (!top.length) {
      panel.hidden = true
      return
    }
    if (title) title.textContent = t('nx.spotlight.operator.title')
    if (sub) sub.textContent = t('nx.spotlight.operator.sub')
    top.forEach(match => list.appendChild(_buildOpportunityCard(match, data.ownInterestByIdea)))
  }
  panel.hidden = false
}

// ── Mutations ─────────────────────────────────────────────────────────────
async function _handleExpressInterest(match, card) {
  if (!_currentSession) return
  const buttons = card.querySelectorAll('button')
  buttons.forEach(btn => { btn.disabled = true })

  try {
    const { error } = await supabase
      .from('idea_interests')
      .insert({ idea_id: match.idea.id, interested_user_id: _currentSession.user.id })
      .select(INTEREST_SELECT)
      .single()
    if (error) throw error
    _clearCache('nexus_')
    card.classList.add('match-card--accepted')
    showToast({ message: t('nx.toast.interestSent'), icon: 'rocket', type: 'success' })
    _track('idea_interest_created', { ideaId: match.idea.id, score: match.matchScore })
    initDashboard(_currentSession)
  } catch (err) {
    logger.error('dashboard', 'interest insert failed', err)
    const duplicate = /duplicate|unique|already/i.test(err?.message || '') || err?.code === '23505'
    showToast({ message: duplicate ? t('nx.toast.interestDuplicate') : t('nx.toast.interestSendFailed'), type: 'error' })
    buttons.forEach(btn => { btn.disabled = false })
  }
}

async function _handleInterestStatus(interestId, status, card) {
  const prevStatus = card.dataset.status
  card.dataset.status = status
  card.querySelectorAll('button').forEach(btn => { btn.disabled = true })
  try {
    const { error } = await supabase
      .from('idea_interests')
      .update({ status })
      .eq('id', interestId)
    if (error) throw error
    _clearCache('nexus_')
    showToast({ message: tr(`nx.toast.interestStatus.${status}`, `Interest ${statusLabel(status)}.`), type: status === 'declined' || status === 'withdrawn' ? 'info' : 'success' })
    _track('idea_interest_status_changed', { interestId, status })
    if (_currentSession) initDashboard(_currentSession)
  } catch (err) {
    card.dataset.status = prevStatus
    card.querySelectorAll('button').forEach(btn => { btn.disabled = false })
    logger.error('dashboard', 'interest update failed', err)
    showToast({ message: t('nx.toast.interestUpdateFailed'), type: 'error' })
  }
}

// ── Realtime ───────────────────────────────────────────────────────────────
function _handleRealtimeChange() {
  _clearCache('nexus_')
  if (_currentSession) initDashboard(_currentSession)
}

function _setupRealtime() {
  _teardownRealtime()
  _realtimeChannel = supabase.channel('nexus')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'idea_interests',
    }, _handleRealtimeChange)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'ideas',
    }, _handleRealtimeChange)
    .subscribe()
}

function _teardownRealtime() {
  if (_realtimeChannel) {
    supabase.removeChannel(_realtimeChannel)
    _realtimeChannel = null
  }
}

// ── IntersectionObserver for sentinels ────────────────────────────────────
function _setupIntersectionObserver(role) {
  if (_intersectionObs) {
    _intersectionObs.disconnect()
    _intersectionObs = null
  }
  const sentinelId = role === 'visionary' ? 'nx-ideas-sentinel' : 'nx-matches-sentinel'
  const sentinel = document.getElementById(sentinelId)
  if (!sentinel) return

  _intersectionObs = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return
    _track('dashboard_sentinel_seen', { role })
  })
  _intersectionObs.observe(sentinel)
}

// ── Language change: re-render in place from the last payload ─────────────
// The marketing document re-translates its own nodes on `urlife:langchange`;
// the dashboard is rendered by this module, so it owns its own re-render.
// No skeletons, no refetch — the data is already on screen, only the copy
// changes.
window.addEventListener('urlife:langchange', () => {
  if (!_currentSession || !_lastRender) return
  const { role, data } = _lastRender
  _hideError()
  _hideAllPanels()
  _hideSkeletons()
  if (data == null) _renderEmptyState(role)
  else if (role === 'visionary') _renderVisionary(data)
  else _renderBuilder(data)
  _setHeader(_currentProfile || {})
})

// ── Dashboard header text ─────────────────────────────────────────────────
function _setHeader(profile) {
  const titleEl = document.getElementById('nx-title')
  const roleEl = document.getElementById('nx-user-role')
  if (titleEl) titleEl.textContent = t('nx.header', { name: safeName(profile.full_name || '') || t('nx.welcome') })
  if (roleEl) {
    roleEl.textContent = ''
    roleEl.appendChild(el('span', {}, roleLabel(profile.role_type || 'builder')))
    const badge = createVerificationBadge(reputationTier(profile))
    badge.classList.add('nx-header-badge')
    roleEl.appendChild(badge)
  }
}

function _wireRefresh(session) {
  const refreshBtn = document.getElementById('nexus-refresh')
  if (!refreshBtn) return
  refreshBtn.onclick = () => {
    if (_refreshTimer) return
    _clearCache('nexus_')
    refreshBtn.disabled = true
    _refreshTimer = setTimeout(() => {
      _refreshTimer = null
      refreshBtn.disabled = false
    }, 3000)
    initDashboard(session)
  }
}

// ── Main init / cleanup ───────────────────────────────────────────────────
export async function initDashboard(session) {
  if (!session?.user?.id) return
  const loadId = ++_lastLoadId
  _currentSession = session
  _hideError()
  _hideAllPanels()
  _renderSkeletons(3)

  try {
    const profile = await _fetchCurrentProfile(session)
    if (loadId !== _lastLoadId) return
    _currentProfile = profile
    const role = profile.role_type || 'builder'
    _setHeader(profile)
    _wireRefresh(session)

    const cacheKey = `nexus_${session.user.id}_${role}`
    const cached = _getCache(cacheKey)
    if (cached) {
      _hideSkeletons()
      if (role === 'visionary') _renderVisionary(cached)
      else _renderBuilder(cached)
    }

    const fresh = role === 'visionary'
      ? await _loadVisionaryData(session)
      : await _loadOperatorData(session, profile)
    if (loadId !== _lastLoadId) return

    _setCache(cacheKey, fresh)
    _hideSkeletons()
    _hideAllPanels()
    if (role === 'visionary') _renderVisionary(fresh)
    else _renderBuilder(fresh)

    _setupRealtime()
    _setupIntersectionObserver(role)
  } catch (err) {
    if (loadId !== _lastLoadId) return
    _hideSkeletons()
    _renderError(err, () => initDashboard(session))
  }
}

export function cleanupDashboard() {
  _lastLoadId += 1
  _teardownRealtime()
  if (_intersectionObs) {
    _intersectionObs.disconnect()
    _intersectionObs = null
  }
  if (_refreshTimer) {
    clearTimeout(_refreshTimer)
    _refreshTimer = null
  }
  _clearCache('nexus_')
}

// ── Hero ↔ Dashboard swap ─────────────────────────────────────────────────
function _showDashboard(session) {
  const dashboard = document.getElementById('nexus-dashboard')
  const hero = document.querySelector('.hero')
  if (!dashboard) return
  if (hero) hero.classList.add('hero--transitioning')
  dashboard.removeAttribute('hidden')
  requestAnimationFrame(() => requestAnimationFrame(() => dashboard.classList.add('nexus--visible')))
  initDashboard(session)
}

function _hideDashboard() {
  const dashboard = document.getElementById('nexus-dashboard')
  const hero = document.querySelector('.hero')
  if (hero) hero.classList.remove('hero--transitioning')
  if (dashboard) {
    dashboard.classList.remove('nexus--visible')
    setTimeout(() => { dashboard.setAttribute('hidden', '') }, 600)
  }
  cleanupDashboard()
  _currentSession = null
  _currentProfile = null
}

function _installAuthBridge() {
  if (_authSubscription) return
  const result = supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) await _showDashboard(session)
    if (event === 'SIGNED_OUT') _hideDashboard()
  })
  _authSubscription = result?.data?.subscription || null

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) _showDashboard(session)
  })
}

_installAuthBridge()
window.addEventListener('beforeunload', cleanupDashboard)
window.addEventListener('nexus:profile-updated', async ({ detail }) => {
  const session = detail?.session || (await supabase.auth.getSession()).data.session
  if (session) initDashboard(session)
})
