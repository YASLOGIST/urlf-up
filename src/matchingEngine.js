/**
 * matchingEngine.js — deterministic, explainable matching for UrLife.
 *
 * The dashboard runs fully in the browser against the committed Supabase
 * schema. This engine therefore accepts plain `ideas`, `profiles_public` rows
 * and the older capital-pool shape that early prototypes used. It never throws
 * on sparse data: missing fields reduce confidence instead of breaking the
 * conversion path.
 *
 * Every axis result carries a human `note` (English, used by the CLI report)
 * plus a stable `noteKey` (+ `noteParams`) so the UI can render the same note
 * in the active language — see src/app/strings.js. `noteParams` values that
 * start with `role.` are i18n keys, not literals.
 */

const DEFAULT_WEIGHTS = Object.freeze({
  role: 0.16,
  skills: 0.34,
  industry: 0.2,
  capital: 0.1,
  reputation: 0.08,
  dataQuality: 0.12,
});

const ROLE_ALIASES = Object.freeze({
  visionary: 'visionary',
  executor: 'visionary',
  founder: 'visionary',
  builder: 'builder',
  architect: 'builder',
  maker: 'builder',
  enabler: 'enabler',
  allocator: 'enabler',
  investor: 'enabler',
  capital: 'enabler',
});

const COMPLEMENTARY_ROLES = Object.freeze({
  visionary: new Set(['builder', 'enabler']),
  builder: new Set(['visionary']),
  enabler: new Set(['visionary']),
});

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : 0));
}

function round(n, places = 2) {
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
}

function norm(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const token = norm(value);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function list(value) {
  if (Array.isArray(value)) return uniq(value);
  if (value == null) return [];
  if (typeof value === 'string') return uniq(value.split(/[,،;|]/));
  return [];
}

function firstList(...values) {
  for (const value of values) {
    const parsed = list(value);
    if (parsed.length) return parsed;
  }
  return [];
}

function numberFrom(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = Number(String(value).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function roleOf(record) {
  const raw = norm(record?.role_type ?? record?.role ?? record?.roleType ?? record?.role_at_time);
  return ROLE_ALIASES[raw] || raw || '';
}

export function ideaProblem(idea) {
  return idea?.problem_statement ?? idea?.problem_solved ?? idea?.problem ?? '';
}

function ideaSkills(idea) {
  return firstList(idea?.required_skills, idea?.requiredSkills, idea?.skills_needed, idea?.skills);
}

function candidateSkills(candidate) {
  return firstList(candidate?.skills, candidate?.expertise, candidate?.required_skills);
}

function candidateIndustries(candidate) {
  return firstList(candidate?.interests, candidate?.preferredIndustries, candidate?.industries, candidate?.industry);
}

function stemToken(token) {
  return token.length > 3 ? token.replace(/(?:ies|s)$/u, (m) => (m === 'ies' ? 'y' : '')) : token;
}

function tokenSet(value) {
  const tokens = norm(value).split(' ').filter(Boolean);
  return new Set(tokens.flatMap(token => [token, stemToken(token)]));
}

export function fuzzySkillScore(required, offered) {
  const req = norm(required);
  const off = norm(offered);
  if (!req || !off) return 0;
  if (req === off) return 1;
  if (off.includes(req) || req.includes(off)) return 0.72;

  const reqTokens = tokenSet(req);
  const offTokens = tokenSet(off);
  if (!reqTokens.size || !offTokens.size) return 0;

  let overlap = 0;
  for (const token of reqTokens) if (offTokens.has(token)) overlap += 1;
  if (overlap > 0) return Math.max(0.62, Math.min(0.68, overlap / Math.max(1, reqTokens.size)));
  const union = new Set([...reqTokens, ...offTokens]).size;
  return union ? Math.min(0.68, overlap / union) : 0;
}

function bestSkillMatch(required, offered) {
  let best = { skill: '', score: 0 };
  for (const skill of offered) {
    const score = fuzzySkillScore(required, skill);
    if (score > best.score) best = { skill, score };
  }
  return best;
}

function scoreSkills(idea, candidate) {
  const required = ideaSkills(idea);
  const offered = candidateSkills(candidate);

  if (!required.length) {
    return {
      raw: 72,
      confidence: 0.35,
      matched: [],
      missing: [],
      note: 'Idea has not declared required skills yet.',
      noteKey: 'match.skills.ideaEmpty',
    };
  }
  if (!offered.length) {
    return {
      raw: 22,
      confidence: 0.25,
      matched: [],
      missing: required,
      note: 'Candidate profile has no skills yet.',
      noteKey: 'match.skills.candidateEmpty',
    };
  }

  const matched = [];
  const missing = [];
  let total = 0;
  for (const req of required) {
    const best = bestSkillMatch(req, offered);
    total += best.score;
    if (best.score >= 0.55) matched.push({ required: req, offered: best.skill, score: round(best.score) });
    else missing.push(req);
  }

  const coverage = total / required.length;
  const breadthBonus = Math.min(8, Math.max(0, offered.length - required.length) * 1.5);
  return {
    raw: clamp(coverage * 100 + breadthBonus),
    confidence: round(0.45 + 0.55 * Math.min(1, offered.length / required.length)),
    matched,
    missing,
    note: matched.length
      ? `${matched.length}/${required.length} required skills covered.`
      : 'No strong skill overlap yet.',
    noteKey: matched.length ? 'match.skills.covered' : 'match.skills.none',
    noteParams: matched.length ? { matched: matched.length, required: required.length } : undefined,
  };
}

function scoreIndustry(idea, candidate) {
  const industry = norm(idea?.industry);
  const prefs = candidateIndustries(candidate);

  if (!industry || !prefs.length) {
    return {
      raw: 56,
      confidence: 0.35,
      matched: [],
      note: 'Industry preference is incomplete.',
      noteKey: 'match.industry.incomplete',
    };
  }

  let best = { industry: '', score: 0 };
  for (const pref of prefs) {
    let score = 0;
    if (pref === industry) score = 100;
    else if (pref.includes(industry) || industry.includes(pref)) score = 80;
    else score = 100 * fuzzySkillScore(industry, pref);
    if (score > best.score) best = { industry: pref, score };
  }

  return {
    raw: best.score || 32,
    confidence: 0.85,
    matched: best.score >= 55 ? [best.industry] : [],
    note: best.score >= 55 ? `Industry aligns with ${best.industry}.` : 'Industry is outside declared interests.',
    noteKey: best.score >= 55 ? 'match.industry.aligns' : 'match.industry.outside',
    noteParams: best.score >= 55 ? { industry: best.industry } : undefined,
  };
}

function scoreRole(idea, candidate) {
  const candidateRole = roleOf(candidate);
  const sourceRole = roleOf(idea) || 'visionary';
  if (!candidateRole) {
    return { raw: 58, confidence: 0.3, note: 'Candidate role is missing.', noteKey: 'match.role.missing' };
  }
  if (COMPLEMENTARY_ROLES[sourceRole]?.has(candidateRole)) {
    return { raw: candidateRole === 'builder' ? 96 : 90, confidence: 1, note: `${candidateRole} complements ${sourceRole}.`, noteKey: 'match.role.complements', noteParams: { candidate: `role.${candidateRole}`, source: `role.${sourceRole}` } };
  }
  if (candidateRole === sourceRole) {
    return { raw: 24, confidence: 0.95, note: `${candidateRole} is not the primary counterpart for this flow.`, noteKey: 'match.role.same', noteParams: { candidate: `role.${candidateRole}` } };
  }
  return { raw: 62, confidence: 0.55, note: 'Role fit is plausible but not explicit.', noteKey: 'match.role.plausible' };
}

function scoreCapital(idea, candidate) {
  const required = numberFrom(idea?.requiredCapital, idea?.required_capital, idea?.capital_required);
  const ideal = numberFrom(idea?.idealCapital, idea?.ideal_capital) ?? (required ? required * 2.5 : null);
  const available = numberFrom(candidate?.availableFunds, candidate?.available_funds, candidate?.capitalAvailable);
  const candidateRole = roleOf(candidate);

  if (!required) {
    return {
      raw: candidateRole === 'enabler' ? 72 : 58,
      confidence: 0.25,
      note: 'Capital requirement is not declared.',
      noteKey: 'match.capital.requirementMissing',
    };
  }
  if (available == null) {
    return {
      raw: candidateRole === 'enabler' ? 60 : 38,
      confidence: 0.35,
      note: 'Available capital is not declared.',
      noteKey: 'match.capital.availableMissing',
    };
  }
  if (available < required) {
    return { raw: (available / required) * 45, confidence: 0.9, note: 'Below the requested capital floor.', noteKey: 'match.capital.belowFloor' };
  }

  const ceiling = Math.max(required + 1, ideal ?? required * 2.5);
  const scaled = 65 + (Math.min(available, ceiling) - required) * (35 / (ceiling - required));
  return { raw: clamp(scaled), confidence: 0.95, note: 'Capital capacity clears the floor.', noteKey: 'match.capital.clears' };
}

function scoreReputation(candidate) {
  const rep = numberFrom(candidate?.reputation);
  const verified = Boolean(candidate?.is_verified ?? candidate?.verified ?? candidate?.author_verified);
  if (rep == null && !verified) {
    return { raw: 50, confidence: 0.25, note: 'No reputation signal yet.', noteKey: 'match.trust.none' };
  }
  return {
    raw: clamp(45 + Math.min(rep ?? 0, 100) * 0.45 + (verified ? 10 : 0)),
    confidence: 0.8,
    note: verified ? 'Verified profile with reputation signal.' : 'Reputation signal present.',
    noteKey: verified ? 'match.trust.verified' : 'match.trust.present',
  };
}

function scoreDataQuality(idea, candidate) {
  const fields = [
    idea?.title,
    idea?.industry,
    ideaProblem(idea),
    ideaSkills(idea).length ? 'skills' : '',
    candidate?.full_name ?? candidate?.name,
    roleOf(candidate),
    candidateSkills(candidate).length ? 'skills' : '',
    candidateIndustries(candidate).length ? 'interests' : '',
    candidate?.bio,
  ];
  const filled = fields.filter(Boolean).length;
  return {
    raw: (filled / fields.length) * 100,
    confidence: 0.7,
    note: `${filled}/${fields.length} matching signals available.`,
    noteKey: 'match.data.signals',
    noteParams: { filled, total: fields.length },
  };
}

export function createWeightProfile(overrides = {}) {
  const weights = { ...DEFAULT_WEIGHTS };
  let explicit = 0;
  for (const [axis, value] of Object.entries(overrides || {})) {
    if (!(axis in weights)) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new RangeError(`Invalid weight for ${axis}`);
    explicit += n;
    weights[axis] = n;
  }
  if (explicit > 1.000001) throw new RangeError('Match weights cannot exceed 1.0');

  const untouched = Object.keys(weights).filter((axis) => !(axis in (overrides || {})));
  if (untouched.length && Object.keys(overrides || {}).some((axis) => axis in DEFAULT_WEIGHTS)) {
    const remaining = Math.max(0, 1 - explicit);
    const originalUntouchedTotal = untouched.reduce((sum, axis) => sum + DEFAULT_WEIGHTS[axis], 0) || 1;
    for (const axis of untouched) {
      weights[axis] = (DEFAULT_WEIGHTS[axis] / originalUntouchedTotal) * remaining;
    }
  }
  return Object.freeze(weights);
}

export function matchTier(score) {
  if (score >= 90) return 'Perfect Match';
  if (score >= 75) return 'Strong Match';
  if (score >= 50) return 'Viable Match';
  if (score >= 30) return 'Weak Match';
  return 'Not Recommended';
}

function synergyList(breakdown) {
  const out = [];
  const matchedSkills = breakdown.skills.matched.map((m) => m.required);
  if (matchedSkills.length) out.push(`Skills: ${matchedSkills.slice(0, 4).join(', ')}`);
  if (breakdown.industry.matched.length) out.push(`Industry: ${breakdown.industry.matched[0]}`);
  if (breakdown.role.raw >= 80) out.push('Role fit');
  if (breakdown.capital.raw >= 70) out.push('Capital fit');
  if (breakdown.reputation.raw >= 70) out.push('Trust signal');
  return out;
}

export function calculateMatch(idea, candidate, options = {}) {
  const weights = createWeightProfile(options.weights);
  const breakdown = {
    role: scoreRole(idea, candidate),
    skills: scoreSkills(idea, candidate),
    industry: scoreIndustry(idea, candidate),
    capital: scoreCapital(idea, candidate),
    reputation: scoreReputation(candidate),
    dataQuality: scoreDataQuality(idea, candidate),
  };

  let weighted = 0;
  let confidence = 0;
  for (const [axis, result] of Object.entries(breakdown)) {
    weighted += result.raw * weights[axis];
    confidence += result.confidence * weights[axis];
  }

  const matchScore = Math.round(clamp(weighted));
  const threshold = options.threshold ?? 50;
  const roleGate = breakdown.role.raw >= 30 || options.allowSameRole === true;

  return {
    isMatch: roleGate && matchScore >= threshold,
    matchScore,
    confidence: round(clamp(confidence, 0, 1), 2),
    tier: matchTier(matchScore),
    synergies: synergyList(breakdown),
    reasons: Object.entries(breakdown)
      .sort((a, b) => weights[b[0]] - weights[a[0]])
      .map(([axis, result]) => ({ axis, score: Math.round(result.raw), confidence: result.confidence, note: result.note, noteKey: result.noteKey, noteParams: result.noteParams })),
    breakdown,
  };
}

export function rankMatches(idea, pool, options = {}) {
  const includeRejected = Boolean(options.includeRejected);
  const limit = Number.isFinite(options.limit) ? options.limit : Infinity;

  return (Array.isArray(pool) ? pool : [])
    .map((candidate) => ({
      candidate,
      profile: candidate,
      capital: candidate,
      ...calculateMatch(idea, candidate, options),
    }))
    .filter((match) => includeRejected || match.isMatch)
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return (Number(b.candidate?.reputation) || 0) - (Number(a.candidate?.reputation) || 0);
    })
    .slice(0, limit);
}

export function rankIdeasForProfile(profile, ideas, options = {}) {
  const includeRejected = options.includeRejected ?? true;
  const limit = Number.isFinite(options.limit) ? options.limit : Infinity;
  return (Array.isArray(ideas) ? ideas : [])
    .map((idea) => ({ idea, ...calculateMatch(idea, profile, options) }))
    .filter((match) => includeRejected || match.isMatch)
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return b.confidence - a.confidence;
    })
    .slice(0, limit);
}

export async function* batchRankMatches(ideas, pool, options = {}) {
  const signal = options.signal;
  for (const idea of Array.isArray(ideas) ? ideas : []) {
    if (signal?.aborted) return;
    yield { visionary: idea, idea, matches: rankMatches(idea, pool, options) };
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function formatMatchReport(match, label = match?.candidate?.full_name || match?.idea?.title || 'Match') {
  const lines = [
    `━━━ Match Report: ${label} ━━━`,
    `Score : ${match.matchScore}/100 | Tier: ${match.tier} | Confidence: ${Math.round(match.confidence * 100)}%`,
    `Status: ${match.isMatch ? 'MATCH' : 'REVIEW'}`,
    '',
    'Axis Breakdown:',
  ];
  for (const reason of match.reasons || []) {
    lines.push(`  ${reason.axis.padEnd(12)} ${String(reason.score).padStart(3)}/100 — ${reason.note}`);
  }
  return lines.join('\n');
}
