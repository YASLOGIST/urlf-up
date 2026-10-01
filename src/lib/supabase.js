/**
 * supabase.js — the ONE Supabase client for the whole application.
 *
 * ── The bug this file fixes ────────────────────────────────────────────────
 * The repository used to contain two independent client factories:
 *
 *   src/lib/supabase.js        storageKey: 'urlife-auth', flowType: 'pkce'
 *   src/lib/supabaseClient.ts  storageKey: default ('sb-<ref>-auth-token')
 *
 * `main.js` imported the first, `auth.js`, `ideas.js`, `settings.js` and
 * `dashboard.js` imported the second. Two GoTrue instances therefore ran
 * side by side against two different localStorage keys, each with its own
 * refresh timer. Observable consequences:
 *   - A sign-in performed through `auth.js` was invisible to anything that
 *     asked the other client for a session.
 *   - Two concurrent refresh timers raced on the same refresh token; the
 *     loser gets `invalid_refresh_token` and silently signs the user out.
 *   - supabase-js itself warns: "Multiple GoTrueClient instances detected".
 *
 * There is now exactly one instance, created lazily, keyed on globalThis so
 * that HMR cannot produce a second one.
 *
 * ── Degraded mode ──────────────────────────────────────────────────────────
 * When credentials are absent the module exports a *stub* that satisfies the
 * surface the app actually uses and resolves every call with a typed
 * `BackendUnavailableError`. The landing page therefore renders and scrolls
 * perfectly without a database, and only the authenticated flows report that
 * they are unavailable.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, isBackendConfigured } from './env.js';
import { logger } from './logger.js';

export class BackendUnavailableError extends Error {
  constructor(message = 'Backend is not configured') {
    super(message);
    this.name = 'BackendUnavailableError';
    this.code = 'BACKEND_UNAVAILABLE';
  }
}

const GLOBAL_KEY = '__urlife_supabase_client__';

/** Resolved shape: `{ data, error }` — identical to supabase-js, so callers need no branch. */
function unavailable() {
  return Promise.resolve({ data: null, error: new BackendUnavailableError() });
}
function unavailableList() {
  return Promise.resolve({ data: [], error: new BackendUnavailableError() });
}

/**
 * Minimal chainable stub. Every terminal method resolves with an error instead
 * of rejecting, because the entire codebase destructures `{ data, error }`
 * rather than using try/catch.
 */
function createStubClient() {
  const thenable = (resolver) => {
    const chain = {
      select: () => chain,
      insert: () => chain,
      update: () => chain,
      upsert: () => chain,
      delete: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      order: () => chain,
      range: () => chain,
      limit: () => chain,
      single: () => resolver(),
      maybeSingle: () => resolver(),
      then: (onFulfilled, onRejected) => resolver().then(onFulfilled, onRejected),
    };
    return chain;
  };

  const noopSubscription = { unsubscribe() {} };

  return {
    __stub: true,
    from: () => thenable(unavailableList),
    rpc: unavailable,
    channel: () => ({
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
      unsubscribe() {},
    }),
    removeChannel: () => {},
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      signInWithPassword: unavailable,
      signInWithOtp: unavailable,
      signUp: unavailable,
      signOut: () => Promise.resolve({ error: null }),
      updateUser: unavailable,
      onAuthStateChange: () => ({ data: { subscription: noopSubscription } }),
    },
    storage: {
      from: () => ({
        upload: unavailable,
        remove: unavailable,
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  };
}

function createRealClient(createClient) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Keep the historical key so already-signed-in users are not logged out
      // by this consolidation.
      storageKey: 'urlife-auth',
      flowType: 'pkce',
    },
    realtime: { params: { eventsPerSecond: 10 } },
    global: { headers: { 'x-application-name': 'urlife-web' } },
  });
}

/**
 * The client is created on first access. `getSupabase()` is async because the
 * real `@supabase/supabase-js` bundle (≈110 kB gzipped) is dynamically
 * imported — it must never be part of the landing-page critical path.
 *
 * @returns {Promise<object>} the shared client (real or stub)
 */
export async function getSupabase() {
  if (globalThis[GLOBAL_KEY]) return globalThis[GLOBAL_KEY];

  if (!isBackendConfigured()) {
    logger.warn('supabase', 'credentials absent — running in degraded mode');
    globalThis[GLOBAL_KEY] = createStubClient();
    return globalThis[GLOBAL_KEY];
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    globalThis[GLOBAL_KEY] = createRealClient(createClient);
  } catch (err) {
    logger.error('supabase', 'client bootstrap failed', err);
    globalThis[GLOBAL_KEY] = createStubClient();
  }
  return globalThis[GLOBAL_KEY];
}

/** Lazily-created stub, kept OUT of `globalThis[GLOBAL_KEY]` so that returning
 *  it from the sync accessor can never block the real client from being
 *  installed later by `getSupabase()`. */
let _stub = null;

/**
 * Synchronous accessor for modules written before the lazy-loading change.
 * Returns the stub until `getSupabase()` has resolved at least once, so a
 * caller never gets `undefined` and never throws.
 */
export function getSupabaseSync() {
  return globalThis[GLOBAL_KEY] || (_stub ||= createStubClient());
}

/** `true` when the resolved client talks to a real backend. */
export function isLive() {
  return Boolean(globalThis[GLOBAL_KEY]) && !globalThis[GLOBAL_KEY].__stub;
}

/** Health probe. Resolves `false` instead of throwing on any failure path. */
export async function pingSupabase() {
  if (!isBackendConfigured()) return false;
  try {
    const client = await getSupabase();
    const { error } = await client.from('profiles').select('id', { count: 'exact', head: true });
    return !error;
  } catch {
    return false;
  }
}

export async function getCurrentProfile() {
  const client = await getSupabase();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;
  const { data, error } = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
  return error ? null : data;
}

export async function requireAuth() {
  const client = await getSupabase();
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) throw new Error('UrLife: authentication required');
  return session;
}

/**
 * Back-compat named export. Historically modules did `import { supabase } from
 * './lib/supabaseClient'` and used it synchronously at call time (never at
 * module-evaluation time), so a Proxy that resolves lazily is a faithful
 * drop-in without touching 5 call sites.
 */
export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getSupabaseSync();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  }
);
