/**
 * validators.js — pure, dependency-free input predicates.
 *
 * HARDENING NOTE (2026-10)
 * Every function here used to assume a string and call `.length` / `.trim()`
 * / `.split()` on it directly. A single `undefined` — a form field that was
 * renamed, a draft restored from sessionStorage written by an older build —
 * therefore threw a TypeError *inside the submit handler*, which aborted the
 * handler before any error slot was populated. The user saw a button that did
 * nothing. Each predicate now coerces defensively and returns `false` for
 * anything that is not a usable string, so a bad input is a validation
 * failure with a visible message rather than a silent crash.
 *
 * `parseAndDedupeSkills` additionally caps its output. Without a cap, pasting
 * a comma-separated document produced a multi-thousand-element array that was
 * sent straight to Postgres.
 */

/** Largest number of skills accepted from a single field. */
export const MAX_SKILLS = 20;

/** Coerce to a trimmed string; anything non-stringish becomes ''. */
function str(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function isValidEmail(email) {
  const t = str(email);
  // Deliberately conservative: one @, no whitespace, a dot-separated host.
  // Full RFC 5322 is not worth the false negatives on a sign-up form.
  return t.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

export function isValidPassword(password) {
  // Not trimmed: leading/trailing spaces are legitimate password characters.
  if (typeof password !== 'string') return false;
  return password.length >= 8 && /[0-9]/.test(password) && /[a-zA-Z]/.test(password);
}

export const MAX_FULL_NAME = 80;

export function isValidFullName(name) {
  const t = str(name);
  return t.length >= 2 && t.length <= MAX_FULL_NAME;
}

/** The three values of the `user_role_type` Postgres enum — nothing else. */
export const ROLE_TYPES = Object.freeze(['visionary', 'builder', 'enabler']);

export function isValidRoleType(role) {
  return typeof role === 'string' && ROLE_TYPES.includes(role);
}

/**
 * Split a free-text field into a normalised skill list.
 * Lower-cased, trimmed, de-duplicated, length-bounded per entry and capped
 * overall at {@link MAX_SKILLS}.
 */
export function parseAndDedupeSkills(raw, max = MAX_SKILLS) {
  const source = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(',') : '';
  const seen = new Set();
  for (const part of source.split(',')) {
    const skill = part.trim().toLowerCase().slice(0, 40);
    if (skill) seen.add(skill);
    if (seen.size >= max) break;
  }
  return [...seen];
}

export function isValidSkillsList(skills) {
  return Array.isArray(skills) && skills.length >= 1 && skills.length <= MAX_SKILLS;
}

export function isValidIdeaTitle(title) {
  const t = str(title);
  return t.length >= 5 && t.length <= 200;
}

export function isValidIndustry(industry) {
  const i = str(industry);
  return i.length >= 2 && i.length <= 80;
}

export function isValidProblemSolved(text) {
  const t = str(text);
  return t.length >= 20 && t.length <= 5000;
}

export function isValidRequiredSkills(skills) {
  return Array.isArray(skills) && skills.length <= MAX_SKILLS;
}

/** True for `https:` URLs only — used for user-supplied avatar links. */
export function isValidHttpsUrl(value) {
  const t = str(value);
  if (!t) return false;
  try {
    return new URL(t).protocol === 'https:';
  } catch {
    return false;
  }
}
