/**
 * env.js — the single place the app reads build-time configuration.
 *
 * WHY THIS EXISTS
 * Before this module there were two competing readers of `import.meta.env`:
 *
 *   src/lib/supabase.js       → console.error()  and carried on with undefined
 *   src/lib/supabaseClient.ts → `throw new Error()` at module-evaluation time
 *
 * Because `supabaseClient.ts` throws during module evaluation, and because it
 * sits in the static import graph of main.js (main → auth → supabaseClient),
 * a missing `.env` did not degrade the site: it killed the entire bundle
 * before a single line of UI code ran. A marketing landing page that cannot
 * render without database credentials is a single point of failure with no
 * upside.
 *
 * The contract now:
 *   - Missing credentials is a *degraded mode*, never a crash.
 *   - `isBackendConfigured()` is the one predicate the UI branches on.
 *   - Nothing here ever logs or returns the key material itself.
 */

/** @type {Record<string, string | undefined>} */
const RAW = (typeof import.meta !== 'undefined' && import.meta.env) || {};

/** Trim and normalise; treat empty strings and the literal placeholders as unset. */
function read(name) {
  const value = RAW[name];
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  // `.env.example` ships these keys with empty values; some CI systems inject
  // the literal string "undefined". Both mean "not configured".
  if (trimmed === 'undefined' || trimmed === 'null') return '';
  return trimmed;
}

export const SUPABASE_URL = read('VITE_SUPABASE_URL');
export const SUPABASE_ANON_KEY = read('VITE_SUPABASE_ANON_KEY');

/** Public booking link. Overridable per-environment; falls back to the historical value. */
export const CAL_LINK = read('VITE_CAL_LINK') || 'https://cal.com/ahmed-urlfxup/15min';

/** Canonical origin used for SEO tags and auth redirects. */
export const SITE_URL = read('VITE_SITE_URL') || '';

export const MODE = read('MODE') || 'production';
export const IS_DEV = RAW.DEV === true || MODE === 'development';

/**
 * True when both Supabase credentials are present AND the URL is a well-formed
 * https origin. A malformed URL fails here rather than inside supabase-js,
 * where it surfaces as an opaque fetch error at first use.
 */
export function isBackendConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const u = new URL(SUPABASE_URL);
    return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/**
 * Human-readable explanation of why the backend is unavailable.
 * Never includes any part of the key.
 * @returns {string[]} zero entries when everything is configured
 */
export function backendConfigProblems() {
  const problems = [];
  if (!SUPABASE_URL) problems.push('VITE_SUPABASE_URL is not set');
  else {
    try {
      new URL(SUPABASE_URL);
    } catch {
      problems.push('VITE_SUPABASE_URL is not a valid URL');
    }
  }
  if (!SUPABASE_ANON_KEY) problems.push('VITE_SUPABASE_ANON_KEY is not set');
  return problems;
}
