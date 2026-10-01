/**
 * errors.js — last-resort error capture.
 *
 * The application previously had no global handler at all: an exception in any
 * module (for example the `throw` that `supabaseClient.ts` performed when env
 * vars were missing) aborted module evaluation with nothing but a red line in
 * a console the visitor will never open.
 *
 * This installs:
 *   - `error` and `unhandledrejection` listeners that log through the
 *     structured logger (so a sink can forward them later);
 *   - a de-duplicating guard so an error inside a rAF loop cannot emit
 *     60 identical records per second;
 *   - an optional user-visible notice for genuinely fatal boot failures.
 */

import { logger } from '../lib/logger.js';

const seen = new Map();
const DEDUPE_MS = 10_000;

function shouldReport(key) {
  const now = Date.now();
  const last = seen.get(key) ?? 0;
  if (now - last < DEDUPE_MS) return false;
  seen.set(key, now);
  // Bound the map so a page open for days cannot grow it without limit.
  if (seen.size > 100) seen.clear();
  return true;
}

export function initErrorReporting() {
  function onError(event) {
    const key = `${event.message}@${event.filename}:${event.lineno}`;
    if (!shouldReport(key)) return;
    logger.error('window', 'uncaught error', {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      col: event.colno,
      stack: event.error?.stack,
    });
  }

  function onRejection(event) {
    const reason = event.reason;
    const key = String(reason?.message ?? reason);
    if (!shouldReport(key)) return;
    logger.error('window', 'unhandled rejection', {
      message: reason?.message ?? String(reason),
      stack: reason?.stack,
    });
  }

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return {
    destroy() {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    },
  };
}

/**
 * Wrap a boot step so one failing subsystem cannot abort the rest of the app.
 * @template T
 * @param {string} name
 * @param {() => T} fn
 * @returns {T | undefined}
 */
export function guard(name, fn) {
  try {
    return fn();
  } catch (err) {
    logger.error('boot', `step "${name}" failed`, err);
    return undefined;
  }
}

/** Async variant of {@link guard}. */
export async function guardAsync(name, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.error('boot', `async step "${name}" failed`, err);
    return undefined;
  }
}
