/**
 * logger.js — structured, level-aware, scope-tagged logging.
 *
 * Replaces 20+ ad-hoc `console.log('🔥 UrLife Nexus Connected Successfully!')`
 * calls scattered across the codebase. Those were:
 *   - unconditional (shipped to production consoles),
 *   - unstructured (impossible to grep or forward to a log sink),
 *   - occasionally leaking error objects straight from Supabase.
 *
 * Design:
 *   - Default level is `warn` in production, `debug` in development.
 *   - `?log=debug` in the URL raises the level at runtime for field debugging
 *     without a redeploy.
 *   - Every record is `{ ts, level, scope, msg, data }`. A sink can be
 *     attached with `logger.sink(fn)` to forward to Sentry/Logflare later.
 *   - `redact()` strips anything that looks like a token before it is emitted.
 */

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function detectLevel() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '');
    const forced = q.get('log');
    if (forced && forced in LEVELS) return LEVELS[forced];
  } catch {
    /* non-browser context */
  }
  const dev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV === true;
  return dev ? LEVELS.debug : LEVELS.warn;
}

let current = detectLevel();
/** @type {((record: object) => void) | null} */
let sinkFn = null;

const TOKEN_RE = /(eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})|(sb[-_][a-z0-9-]{12,})|(bearer\s+\S+)/gi;

/** Remove anything shaped like a JWT, Supabase key, or bearer token. */
export function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') return value.replace(TOKEN_RE, '[redacted]');
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), code: value.code };
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /token|key|secret|password|authorization/i.test(k) ? '[redacted]' : redact(v);
    }
    return out;
  }
  return value;
}

function emit(level, scope, msg, data) {
  if (LEVELS[level] > current) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(data === undefined ? {} : { data: redact(data) }),
  };
  if (sinkFn) {
    try {
      sinkFn(record);
    } catch {
      /* a broken sink must never break the app */
    }
  }
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${scope}] ${msg}`, data === undefined ? '' : redact(data));
}

export const logger = {
  error: (scope, msg, data) => emit('error', scope, msg, data),
  warn: (scope, msg, data) => emit('warn', scope, msg, data),
  info: (scope, msg, data) => emit('info', scope, msg, data),
  debug: (scope, msg, data) => emit('debug', scope, msg, data),
  /** @param {keyof typeof LEVELS} level */
  setLevel(level) {
    if (level in LEVELS) current = LEVELS[level];
  },
  getLevel() {
    return Object.keys(LEVELS).find((k) => LEVELS[k] === current);
  },
  /** Attach a forwarder, e.g. `logger.sink(r => beacon('/logs', r))`. */
  sink(fn) {
    sinkFn = typeof fn === 'function' ? fn : null;
  },
};
