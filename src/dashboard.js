import { logger } from './lib/logger.js'
import { supabase } from './lib/supabase.js'
import { safeName } from './sanitize.js'
import { rankMatches } from './matchingEngine.js'
import { icon } from './icons.js'
import { getEscrowStatusForMatch } from './escrowEngine.js'
import { createVerificationBadge } from './components/VerificationBadge.js'
import { openDealRoom } from './components/DealRoom.js'

// ── Telemetry no-op (swap for PostHog/Plausible) ──────────────────────────
window.__nexus_track = window.__nexus_track || function () {}
function _track(event, payload) {
  window.__nexus_track(event, payload)
}

// ── Module-level state ─────────────────────────────────────────────────────
let _realtimeChannel = null
let _intersectionObs = null
let _refreshTimer = null

// ── Minimal createElement helper — no innerHTML ever ──────────────────────
function el(tag, attrs = {}, text) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v
    else if (k === 'dataset') Object.assign(node.dataset, v)
    else node.setAttribute(k, v)
  }
  if (text != null) node.textContent = text
  return node
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
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith(prefix))
    keys.forEach(k => sessionStorage.removeItem(k))
  } catch {
    /* Storage unavailable — nothing to purge. */
  }
}

// ── SVG Viability Ring (pure SVG, no library) ─────────────────────────────
function _buildViabilityRing(score) {
  const R = 38
  const C = 2 * Math.PI * R
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score))
  const dash = (pct / 100) * C

  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('width', '60')
  svg.setAttribute('height', '60')
  svg.setAttribute('aria-label', `Viability score: ${pct}`)

  const track = document.createElementNS(ns, 'circle')
  track.setAttribute('cx', '50')
  track.setAttribute('cy', '50')
  track.setAttribute('r', String(R))
  track.setAttribute('fill', 'none')
  track.setAttribute('stroke-width', '8')
  track.classList.add('score-ring-track')

  const fill = document.createElementNS(ns, 'circle')
  fill.setAttribute('cx', '50')
  fill.setAttribute('cy', '50')
  fill.setAttribute('r', String(R))
  fill.setAttribute('fill', 'none')
  fill.setAttribute('stroke-width', '8')
  fill.setAttribute('stroke-dasharray', `${dash} ${C}`)
  fill.setAttribute('stroke-dashoffset', String(C * 0.25)) // start at top
  fill.setAttribute('transform', 'rotate(-90 50 50)')
  fill.classList.add('score-ring-fill')

  const label = document.createElementNS(ns, 'text')
  label.setAttribute('x', '50')
  label.setAttribute('y', '50')
  label.setAttribute('text-anchor', 'middle')
  label.setAttribute('dominant-baseline', 'central')
  label.setAttribute('font-size', '18')
  label.setAttribute('font-weight', '700')
  label.setAttribute('fill', '#d4af37')
  label.textContent = score == null ? '—' : String(pct)

  svg.appendChild(track)
  svg.appendChild(fill)
  svg.appendChild(label)
  return svg
}

// ── Match card (builder/enabler perspective) ───────────────────────────────
function _buildMatchCard(match) {
  const card = el('div', {
    className: 'nx-card match-card',
    dataset: { id: match.id, status: match.status },
  })

  const score = el('div', { className: 'nx-match-score' })
  const scoreNum = el('span', { className: 'nx-score-num' }, String(match.match_score))
  const scoreLabel = el('span', { className: 'nx-score-label' }, 'match')
  score.appendChild(scoreNum)
  score.appendChild(scoreLabel)

  const body = el('div', { className: 'nx-card-body' })
  const title = el('h3', { className: 'nx-idea-title' }, match.idea_title || 'Untitled Idea')
  const industry = el('span', { className: 'nx-chip' }, match.idea_industry || '')
  const problem = el('p', { className: 'nx-idea-problem' }, match.idea_problem_solved || '')

  body.appendChild(title)
  body.appendChild(industry)
  body.appendChild(problem)

  // Skills matched
  const reasoning = match.reasoning || {}
  const matched = Array.isArray(reasoning.matched_skills) ? reasoning.matched_skills : []
  if (matched.length) {
    const skillsWrap = el('div', { className: 'nx-skills' })
    matched.forEach(s => {
      skillsWrap.appendChild(el('span', { className: 'nx-skill-tag' }, s))
    })
    body.appendChild(skillsWrap)
  }

  // Accept / Pass buttons — only for 'suggested' status
  if (match.status === 'suggested') {
    const actions = el('div', { className: 'nx-actions' })
    const acceptBtn = el('button', { className: 'btn-accept', type: 'button' }, 'Accept')
    const passBtn = el('button', { className: 'btn-pass', type: 'button' }, 'Pass')

    acceptBtn.addEventListener('click', () => _handleAccept(match.id, card))
    passBtn.addEventListener('click', () => _handlePass(match.id, card))

    actions.appendChild(acceptBtn)
    actions.appendChild(passBtn)
    body.appendChild(actions)
  } else {
    const statusWrap = el('div', { style: 'display: flex; gap: 8px; align-items: center; margin-top: 12px;' })
    const statusBadge = el('span', {
      className: `nx-status-badge nx-status--${match.status}`,
    }, match.status)
    statusWrap.appendChild(statusBadge)
    
    const escrowStatus = card.dataset.escrowStatus || getEscrowStatusForMatch(match.status);
    if (escrowStatus) {
      const escrowBadge = el('span', {
        className: 'nx-escrow-badge',
        style: 'font-size: 11px; padding: 2px 8px; border-radius: 12px; background: rgba(212,175,55,0.12); color: #D4AF37; border: 1px solid rgba(212,175,55,0.2); font-weight: bold;'
      }, `Escrow: ${escrowStatus}`)
      statusWrap.appendChild(escrowBadge)

      if (escrowStatus === 'Pending') {
        const dealBtn = el('button', {
          style: 'margin-left: auto; background: transparent; border: 1px solid rgba(212,175,55,0.5); color: #D4AF37; padding: 4px 12px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer;'
        }, 'Initiate Closed Meeting');
        
        dealBtn.onclick = () => {
          openDealRoom(match, (newEscrowState) => {
            card.dataset.escrowStatus = newEscrowState;
            escrowBadge.textContent = `Escrow: ${newEscrowState}`;
            dealBtn.remove();
          });
        };
        statusWrap.appendChild(dealBtn);
      }
    }

    body.appendChild(statusWrap)
  }

  card.appendChild(score)
  card.appendChild(body)
  return card
}

// ── Idea card (visionary perspective) with viability ring ─────────────────
function _buildIdeaCard(idea, matchCards) {
  const card = el('div', { className: 'nx-card idea-card-nx' })

  const header = el('div', { className: 'nx-idea-header' })
  const meta = el('div', { className: 'nx-idea-meta' })
  const title = el('h3', { className: 'nx-idea-title' }, idea.title || 'Untitled')
  const industry = el('span', { className: 'nx-chip' }, idea.industry || '')
  meta.appendChild(title)
  meta.appendChild(industry)

  const ringWrap = el('div', { className: 'nx-ring-wrap' })
  const ringLabel = el('div', { className: 'nx-ring-label' }, 'Viability')
  ringWrap.appendChild(_buildViabilityRing(idea.viability_score))
  ringWrap.appendChild(ringLabel)

  header.appendChild(meta)
  header.appendChild(ringWrap)
  card.appendChild(header)

  const problem = el('p', { className: 'nx-idea-problem' }, idea.problem_solved || '')
  card.appendChild(problem)

  // Matches sub-section
  if (matchCards && matchCards.length) {
    const matchesSection = el('div', { className: 'nx-idea-matches' })
    const matchesHeading = el('h4', { className: 'nx-matches-heading' },
      `${matchCards.length} Candidate${matchCards.length !== 1 ? 's' : ''} Matched`)
    matchesSection.appendChild(matchesHeading)
    matchCards.forEach(mc => matchesSection.appendChild(mc))
    card.appendChild(matchesSection)
  } else {
    const noMatch = el('p', { className: 'nx-no-matches' },
      'Matching is running — check back shortly.')
    card.appendChild(noMatch)
  }

  return card
}

// ── Skeleton loader ────────────────────────────────────────────────────────
function _renderSkeletons(count = 3) {
  const host = document.getElementById('nx-skeleton')
  if (!host) return
  host.textContent = ''
  for (let i = 0; i < count; i++) {
    const s = el('div', { className: 'nx-skeleton' })
    s.style.height = '140px'
    s.style.marginBottom = '16px'
    host.appendChild(s)
  }
  host.hidden = false
}

function _hideSkeletons() {
  const host = document.getElementById('nx-skeleton')
  if (host) { host.hidden = true; host.textContent = '' }
}

// ── Empty state ────────────────────────────────────────────────────────────
function _renderEmptyState(role) {
  const host = document.getElementById('nx-empty')
  if (!host) return
  host.textContent = ''
  const wrap = el('div', { className: 'nx-empty' })
  const t = el('div', { className: 'nx-empty-title' })
  const s = el('div', { className: 'nx-empty-sub' })

  if (role === 'visionary') {
    t.textContent = 'No ideas yet.'
    s.textContent = 'Submit your first idea — the engine will find your team.'
  } else {
    t.textContent = 'No matches yet.'
    s.textContent = 'Make sure your profile skills are up to date so ideas can find you.'
  }

  wrap.appendChild(t)
  wrap.appendChild(s)
  host.appendChild(wrap)
  host.hidden = false
}

// ── Error state ────────────────────────────────────────────────────────────
function _renderError(err, retryFn) {
  const host = document.getElementById('nx-error')
  if (!host) return
  host.textContent = ''
  const wrap = el('div', { className: 'nx-error-state' })
  const msg = el('p', { className: 'nx-error-msg' },
    'Something went wrong. Check your connection and try again.')
  wrap.appendChild(msg)

  if (retryFn) {
    const btn = el('button', { className: 'btn-accept', type: 'button' }, 'Retry')
    btn.addEventListener('click', retryFn)
    wrap.appendChild(btn)
  }

  host.appendChild(wrap)
  host.hidden = false
  logger.error('dashboard', 'render failed', err)
}

function _hideError() {
  const host = document.getElementById('nx-error')
  if (host) { host.hidden = true; host.textContent = '' }
}

// ── Data fetching ─────────────────────────────────────────────────────────
async function _loadVisionaryData(session) {
  const { data: ideas, error: ideasErr } = await supabase
    .from('ideas')
    .select('id, title, industry, problem_solved, required_skills, status, viability_score, created_at')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (ideasErr) throw ideasErr
  if (!ideas || ideas.length === 0) return { ideas: [], matches: [] }

  const ideaIds = ideas.map(i => i.id)
  const { data: matches, error: matchesErr } = await supabase
    .from('v_top_matches')
    .select('id, idea_id, profile_id, match_score, status, reasoning, profile_full_name, profile_role_type, profile_skills')
    .in('idea_id', ideaIds)
    .order('match_score', { ascending: false })
    .limit(50)

  if (matchesErr) throw matchesErr
  return { ideas, matches: matches || [] }
}

async function _loadBuilderData(session) {
  const { data: matches, error } = await supabase
    .from('v_top_matches')
    .select('id, idea_id, profile_id, match_score, status, reasoning, idea_title, idea_industry, idea_problem_solved')
    .eq('profile_id', session.user.id)
    .order('match_score', { ascending: false })
    .limit(20)

  if (error) throw error
  return { matches: matches || [] }
}

// ── Render logic ───────────────────────────────────────────────────────────
function _renderVisionary(data) {
  const panel = document.getElementById('nx-ideas-panel')
  const list = document.getElementById('nx-ideas-list')
  if (!panel || !list) return
  list.textContent = ''

  if (!data.ideas.length) {
    _renderEmptyState('visionary')
    return
  }

  // Group matches by idea_id
  const matchesByIdea = {}
  for (const m of data.matches) {
    if (!matchesByIdea[m.idea_id]) matchesByIdea[m.idea_id] = []
    matchesByIdea[m.idea_id].push(m)
  }

  for (const idea of data.ideas) {
    const ideaMatches = (matchesByIdea[idea.id] || []).map(m => {
      // Adapt match structure for _buildMatchCard (visionary-side: candidate info)
      const mc = el('div', { className: 'nx-card match-card match-card--candidate', dataset: { id: m.id, status: m.status } })

      const nameWrap = el('div', { className: 'nx-candidate-info' })
      const name = el('span', { className: 'nx-candidate-name' }, safeName(m.profile_full_name || 'Anonymous'))
      const role = el('span', { className: 'nx-chip' }, m.profile_role_type || '')
      nameWrap.appendChild(name)
      nameWrap.appendChild(role)

      const scoreWrap = el('div', { className: 'nx-match-score-small' })
      const scoreNum = el('span', { className: 'nx-score-num-small' }, String(m.match_score))
      const scoreLabel = el('span', { className: 'nx-score-label-small' }, '%')
      scoreWrap.appendChild(scoreNum)
      scoreWrap.appendChild(scoreLabel)

      const skills = Array.isArray(m.profile_skills) ? m.profile_skills : []
      const skillsWrap = el('div', { className: 'nx-skills' })
      skills.slice(0, 5).forEach(s => {
        skillsWrap.appendChild(el('span', { className: 'nx-skill-tag' }, s))
      })

      mc.appendChild(nameWrap)
      mc.appendChild(scoreWrap)
      mc.appendChild(skillsWrap)
      return mc
    })

    const card = _buildIdeaCard(idea, ideaMatches)
    list.appendChild(card)
  }

  panel.hidden = false
  _track('dashboard_view', { role: 'visionary', ideaCount: data.ideas.length })
}

function _renderBuilder(data) {
  const panel = document.getElementById('nx-matches-panel')
  const list = document.getElementById('nx-matches-list')
  if (!panel || !list) return
  list.textContent = ''

  if (!data.matches.length) {
    _renderEmptyState('builder')
    return
  }

  for (const match of data.matches) {
    const card = _buildMatchCard(match)
    list.appendChild(card)
    // Flash animation on new cards
    requestAnimationFrame(() =>
      requestAnimationFrame(() => card.classList.add('nx-card--new'))
    )
  }

  panel.hidden = false
  _track('dashboard_view', { role: 'builder', matchCount: data.matches.length })
}

// ── AI Matching Engine ─────────────────────────────────────────────────────
async function _loadAIMatches(session) {
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, full_name, role_type, skills, interests, bio, reputation, is_verified')
    .eq('id', session.user.id)
    .single()
    
  if (profileErr) throw profileErr
  
  const { data: candProfiles, error: candErr } = await supabase
    .from('profiles')
    .select('id, full_name, role_type, skills, interests, bio, reputation, is_verified')
    .neq('id', session.user.id)
    .limit(100)
    
  if (candErr) throw candErr

  const toEngineProfile = p => ({
    ...p,
    role: p.role_type === 'visionary' ? 'Executor' : p.role_type === 'builder' ? 'Architect' : 'Allocator',
    industry: Array.isArray(p.interests) && p.interests.length ? p.interests[0] : '',
    required_skills: p.skills || [],
    expertise: p.skills || [],
    riskAppetite: p.role_type === 'visionary' ? 'High' : p.role_type === 'enabler' ? 'Low' : 'Medium',
    capitalCapacity: p.role_type === 'enabler' ? 'High' : 'Low'
  });
  
  const userProfile = toEngineProfile(profile)
  const candidates = candProfiles.map(toEngineProfile)
  
  return rankMatches(userProfile, candidates)
}

function _renderAIMatches(matches) {
  const panel = document.getElementById('nx-ai-matches-panel')
  const list = document.getElementById('nx-ai-matches-list')
  if (!panel || !list) return
  
  list.textContent = ''
  
  if (!matches || matches.length === 0) {
    panel.hidden = true
    return
  }
  
  panel.hidden = false
  
  for (const m of matches) {
    const card = el('div', { className: 'nx-card match-card', style: 'flex: 1 1 300px; padding: 20px; border: 1px solid var(--goldl); background: rgba(212,175,55,0.03); margin-bottom: 16px;' })
    
    const head = el('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;' })
    
    const nameWrap = el('div', { style: 'display:flex; align-items:center; gap:8px;' })
    const name = el('h4', { style: 'margin:0; font-family: var(--font-en); font-size: 16px; color: var(--gold2);' }, safeName(m.full_name || 'Anonymous'))
    
    const tier = m.reputation > 50 ? 'Gold' : m.reputation > 20 ? 'Silver' : 'Bronze';
    const badge = createVerificationBadge(tier);
    
    nameWrap.appendChild(name)
    nameWrap.appendChild(badge)
    
    const scoreBadge = el('div', { className: 'nx-score-label-small', style: 'background: var(--gold); color: #000; padding: 2px 8px; border-radius: 12px; font-weight: bold; font-size: 12px;' }, m.match_score + ' pts')
    
    head.appendChild(nameWrap)
    head.appendChild(scoreBadge)
    
    const body = el('div', { style: 'font-size: 13px; color: var(--dim); display: flex; flex-direction: column; gap: 8px;' })
    
    const roleEl = el('div', { style: 'display: flex; align-items: center; gap: 6px;' })
    roleEl.appendChild(icon('star', { size: 14 }))
    roleEl.appendChild(document.createTextNode(m.role_type || 'Unknown Role'))
    
    const indEl = el('div', { style: 'display: flex; align-items: center; gap: 6px;' })
    indEl.appendChild(icon('bolt', { size: 14 }))
    indEl.appendChild(document.createTextNode(m.industry || 'Any Industry'))
    
    body.appendChild(roleEl)
    body.appendChild(indEl)
    
    card.appendChild(head)
    card.appendChild(body)
    
    list.appendChild(card)
  }
}

// ── Optimistic accept / pass ───────────────────────────────────────────────
async function _handleAccept(matchId, card) {
  const prevStatus = card.dataset.status
  card.dataset.status = 'accepted'
  card.classList.add('match-card--accepted')

  // Hide action buttons immediately
  card.querySelectorAll('.btn-accept, .btn-pass').forEach(b => { b.disabled = true })

  try {
    const { error } = await supabase
      .from('matches')
      .update({ status: 'accepted' })
      .eq('id', matchId)
    if (error) throw error
    _track('match_accepted', { matchId })
  } catch (err) {
    // rollback
    card.dataset.status = prevStatus
    card.classList.remove('match-card--accepted')
    card.querySelectorAll('.btn-accept, .btn-pass').forEach(b => { b.disabled = false })
    _renderError(err)
  }
}

async function _handlePass(matchId, card) {
  const prevStatus = card.dataset.status
  card.dataset.status = 'rejected'
  card.classList.add('match-card--rejected')
  card.querySelectorAll('.btn-accept, .btn-pass').forEach(b => { b.disabled = true })

  try {
    const { error } = await supabase
      .from('matches')
      .update({ status: 'rejected' })
      .eq('id', matchId)
    if (error) throw error
    _track('match_rejected', { matchId })
  } catch (err) {
    card.dataset.status = prevStatus
    card.classList.remove('match-card--rejected')
    card.querySelectorAll('.btn-accept, .btn-pass').forEach(b => { b.disabled = false })
    _renderError(err)
  }
}

// ── Realtime ───────────────────────────────────────────────────────────────
function _handleMatchChange(payload) {
  const { eventType, new: record } = payload
  if (!record) return

  // Flash new match card in builder view
  if (eventType === 'INSERT') {
    const list = document.getElementById('nx-matches-list')
    if (list) {
      const card = _buildMatchCard({
        id: record.id,
        idea_id: record.idea_id,
        match_score: record.match_score,
        status: record.status,
        reasoning: record.reasoning || {},
        idea_title: '',
        idea_industry: '',
        idea_problem_solved: '',
      })
      card.classList.add('nx-card--new')
      list.insertBefore(card, list.firstChild)
      const panel = document.getElementById('nx-matches-panel')
      if (panel) panel.hidden = false
    }
  }

  if (eventType === 'UPDATE') {
    const existing = document.querySelector(`.match-card[data-id="${record.id}"]`)
    if (existing) {
      existing.dataset.status = record.status
      existing.classList.toggle('match-card--accepted', record.status === 'accepted')
      existing.classList.toggle('match-card--rejected', record.status === 'rejected')
    }
  }

  // Invalidate SWR cache on any change
  _clearCache('nexus_')
}

function _handleIdeaChange() {
  _clearCache('nexus_')
}

function _setupRealtime(session) {
  _teardownRealtime()
  _realtimeChannel = supabase.channel('nexus')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'matches',
      filter: `profile_id=eq.${session.user.id}`,
    }, _handleMatchChange)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'ideas',
      filter: `user_id=eq.${session.user.id}`,
    }, _handleIdeaChange)
    .subscribe()
}

function _teardownRealtime() {
  if (_realtimeChannel) {
    supabase.removeChannel(_realtimeChannel)
    _realtimeChannel = null
  }
}

// ── IntersectionObserver for sentinels ────────────────────────────────────
function _setupIntersectionObserver(session, role) {
  if (_intersectionObs) {
    _intersectionObs.disconnect()
    _intersectionObs = null
  }
  const sentinelId = role === 'visionary' ? 'nx-ideas-sentinel' : 'nx-matches-sentinel'
  const sentinel = document.getElementById(sentinelId)
  if (!sentinel) return

  _intersectionObs = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting) return
    // Pagination: disconnect while loading to prevent multiple fires
    _intersectionObs.disconnect()
    // Future: load next page. Currently bounded at 20 — extend with offset.
  })
  _intersectionObs.observe(sentinel)
}

// ── Dashboard header text ─────────────────────────────────────────────────
function _setHeader(profile) {
  const titleEl = document.getElementById('nx-title')
  const roleEl = document.getElementById('nx-user-role')
  if (titleEl) {
    titleEl.textContent = `NEXUS — ${safeName(profile.full_name || 'Welcome')}`
  }
  if (roleEl) {
    roleEl.innerHTML = '';
    const roleText = el('span', {}, (profile.role_type || 'builder').charAt(0).toUpperCase() + (profile.role_type || 'builder').slice(1));
    roleEl.appendChild(roleText);
    
    // Append verification badge as a metric
    const tier = profile.reputation > 50 ? 'Gold' : profile.reputation > 20 ? 'Silver' : 'Bronze';
    const badge = createVerificationBadge(tier);
    badge.style.marginLeft = '12px';
    roleEl.appendChild(badge);
  }
}

// ── Main init / cleanup ───────────────────────────────────────────────────
export async function initDashboard(session) {
  // Fetch real profile from Supabase
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role_type, reputation, is_verified')
    .eq('id', session.user.id)
    .single();

  const userProfile = profile || { full_name: session.user.user_metadata?.full_name, role_type: session.user.user_metadata?.role_type, reputation: 0 };
  const role = userProfile.role_type || 'builder';
  
  _setHeader(userProfile)

  // Set up refresh button
  const refreshBtn = document.getElementById('nexus-refresh')
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      if (_refreshTimer) return
      _clearCache('nexus_')
      _refreshTimer = setTimeout(() => { _refreshTimer = null }, 3000)
      refreshBtn.disabled = true
      setTimeout(() => { refreshBtn.disabled = false }, 3000)
      initDashboard(session)
    }
  }

  // Hide panels / error
  const ideasPanel = document.getElementById('nx-ideas-panel')
  const matchesPanel = document.getElementById('nx-matches-panel')
  if (ideasPanel) ideasPanel.hidden = true
  if (matchesPanel) matchesPanel.hidden = true
  _hideError()

  // SWR cache key
  const cacheKey = `nexus_${session.user.id}_${role}`
  const cached = _getCache(cacheKey)

  if (cached) {
    // Render stale immediately
    if (role === 'visionary') _renderVisionary(cached)
    else _renderBuilder(cached)
    _hideSkeletons()

    // Revalidate in background
    const fetcher = role === 'visionary'
      ? () => _loadVisionaryData(session)
      : () => _loadBuilderData(session)

    fetcher()
      .then(fresh => {
        _setCache(cacheKey, fresh)
        if (ideasPanel) ideasPanel.hidden = true
        if (matchesPanel) matchesPanel.hidden = true
        if (role === 'visionary') _renderVisionary(fresh)
        else _renderBuilder(fresh)
      })
      .catch(() => {}) // silent background revalidation failure
  } else {
    _renderSkeletons(3)
    try {
      const data = role === 'visionary'
        ? await _loadVisionaryData(session)
        : await _loadBuilderData(session)

      _setCache(cacheKey, data)
      _hideSkeletons()
      if (role === 'visionary') _renderVisionary(data)
      else _renderBuilder(data)
    } catch (err) {
      _hideSkeletons()
      _renderError(err, () => initDashboard(session))
      return
    }
  }

  // Fetch AI Recommendations in parallel
  _loadAIMatches(session).then(_renderAIMatches).catch(err => logger.error('dashboard', 'AI matching failed', err))

  _setupRealtime(session)
  _setupIntersectionObserver(session, role)
}

export function cleanupDashboard() {
  _teardownRealtime()
  if (_intersectionObs) { _intersectionObs.disconnect(); _intersectionObs = null }
  if (_refreshTimer) { clearTimeout(_refreshTimer); _refreshTimer = null }
  _clearCache('nexus_')
}

// ── Hero ↔ Dashboard swap ─────────────────────────────────────────────────
function _showDashboard(session) {
  const dashboard = document.getElementById('nexus-dashboard')
  const hero = document.querySelector('.hero')
  if (!dashboard) return
  if (hero) hero.classList.add('hero--transitioning')
  dashboard.removeAttribute('hidden')
  requestAnimationFrame(() =>
    requestAnimationFrame(() => dashboard.classList.add('nexus--visible'))
  )
  initDashboard(session)
}

function _hideDashboard() {
  const dashboard = document.getElementById('nexus-dashboard')
  const hero = document.querySelector('.hero')
  if (hero) hero.classList.remove('hero--transitioning')
  if (dashboard) {
    dashboard.classList.remove('nexus--visible')
    // Re-hide after transition completes
    setTimeout(() => { dashboard.setAttribute('hidden', '') }, 600)
  }
  cleanupDashboard()
}

// ── Self-initialization ────────────────────────────────────────────────────
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'SIGNED_IN') await _showDashboard(session)
  if (event === 'SIGNED_OUT') _hideDashboard()
})

// Hydrate on page load if already signed in
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) _showDashboard(session)
})

window.addEventListener('beforeunload', cleanupDashboard)

window.addEventListener('nexus:profile-updated', async () => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) initDashboard(session)
})
