/**
 * Unit coverage for the shared library layer: logging/redaction, environment
 * reading, input validation, HTML sanitisation and the degraded-mode
 * Supabase client.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logger, redact } from '../../src/lib/logger.js';
import * as env from '../../src/lib/env.js';
import * as validators from '../../src/validators.js';
import { stripEmoji, safeName } from '../../src/sanitize.js';

describe('logger.redact', () => {
  it('masks a JWT embedded in a string', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(redact(`failed with ${jwt}`)).toBe('failed with [redacted]');
  });

  it('masks a bearer header', () => {
    expect(redact('Authorization: Bearer abc.def.ghi')).toMatch(/\[redacted\]/);
  });

  it('masks values under sensitive key names, at any depth', () => {
    const out = redact({
      ok: 'visible',
      nested: { apiKey: 'super-secret', password: 'hunter2', session: { access_token: 'xyz' } },
    });
    expect(out.ok).toBe('visible');
    expect(out.nested.apiKey).toBe('[redacted]');
    expect(out.nested.password).toBe('[redacted]');
    expect(out.nested.session.access_token).toBe('[redacted]');
  });

  it('reduces an Error to name/message/code and redacts the message', () => {
    const err = new Error('token sb-abcdefghijklmno expired');
    err.code = 'E42';
    expect(redact(err)).toEqual({ name: 'Error', message: 'token [redacted] expired', code: 'E42' });
  });

  it('leaves primitives and null alone', () => {
    expect(redact(null)).toBeNull();
    expect(redact(7)).toBe(7);
    expect(redact(false)).toBe(false);
  });
});

describe('logger levels and sink', () => {
  let spy;
  beforeEach(() => {
    spy = {
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
    logger.setLevel('silent');
    logger.sink(null);
  });

  it('suppresses everything below the active level', () => {
    logger.setLevel('error');
    logger.debug('t', 'hidden');
    logger.info('t', 'hidden');
    expect(spy.log).not.toHaveBeenCalled();
    logger.error('t', 'shown');
    expect(spy.error).toHaveBeenCalled();
  });

  it('emits a structured record to an attached sink', () => {
    const records = [];
    logger.setLevel('debug');
    logger.sink((r) => records.push(r));
    logger.warn('auth', 'bad thing', { token: 'secret-value' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ level: 'warn', scope: 'auth', msg: 'bad thing' });
    expect(records[0].data.token).toBe('[redacted]');
    expect(Date.parse(records[0].ts)).not.toBeNaN();
  });

  it('a throwing sink can never break the caller', () => {
    logger.setLevel('debug');
    logger.sink(() => {
      throw new Error('sink is down');
    });
    expect(() => logger.info('t', 'still fine')).not.toThrow();
  });
});

describe('env', () => {
  it('reports the backend as unconfigured when no credentials are injected', () => {
    // The test environment deliberately injects none.
    expect(env.isBackendConfigured()).toBe(false);
    expect(env.backendConfigProblems().length).toBeGreaterThan(0);
  });

  it('never exposes key material through its problem messages', () => {
    for (const p of env.backendConfigProblems()) {
      expect(p).not.toMatch(/eyJ/);
      expect(p).toMatch(/is not set|is not a valid URL/);
    }
  });

  it('falls back to the historical booking link rather than undefined', () => {
    expect(env.CAL_LINK).toMatch(/^https:\/\/cal\.com\//);
  });
});

describe('validators', () => {
  it('accepts well-formed email addresses', () => {
    for (const ok of ['a@b.co', 'first.last+tag@sub.domain.org']) {
      expect(validators.isValidEmail(ok), ok).toBe(true);
    }
  });

  it('rejects malformed email addresses', () => {
    for (const bad of ['', 'a@', '@b.com', 'a b@c.com', 'a@b']) {
      expect(validators.isValidEmail(bad), String(bad)).toBe(false);
    }
  });

  it('rejects an over-long address instead of forwarding it to the backend', () => {
    expect(validators.isValidEmail(`${'a'.repeat(250)}@b.com`)).toBe(false);
  });

  it('enforces length + digit + letter on passwords', () => {
    expect(validators.isValidPassword('passwor')).toBe(false); // 7 chars
    expect(validators.isValidPassword('password')).toBe(false); // no digit
    expect(validators.isValidPassword('12345678')).toBe(false); // no letter
    expect(validators.isValidPassword('password1')).toBe(true);
  });

  it('does not trim passwords — spaces are legitimate characters', () => {
    expect(validators.isValidPassword('  pass1  ')).toBe(true);
  });

  it('only accepts the three role types the database enum allows', () => {
    expect(validators.ROLE_TYPES.every(validators.isValidRoleType)).toBe(true);
    for (const bad of ['admin', 'VISIONARY', 'visionary ', '']) {
      expect(validators.isValidRoleType(bad), String(bad)).toBe(false);
    }
  });

  it('parses a skills string into a trimmed, lower-cased, deduplicated list', () => {
    expect(validators.parseAndDedupeSkills(' Solidity , risk,  SOLIDITY ,,ops ')).toEqual([
      'solidity',
      'risk',
      'ops',
    ]);
  });

  it('caps the number of skills so a paste bomb cannot reach the database', () => {
    const many = Array.from({ length: 500 }, (_, i) => `skill${i}`).join(',');
    expect(validators.parseAndDedupeSkills(many)).toHaveLength(validators.MAX_SKILLS);
  });

  it('bounds the length of a single skill', () => {
    expect(validators.parseAndDedupeSkills('x'.repeat(400))[0]).toHaveLength(40);
  });

  it('bounds the idea title, industry and problem statement', () => {
    expect(validators.isValidIdeaTitle('abcd')).toBe(false);
    expect(validators.isValidIdeaTitle('abcde')).toBe(true);
    expect(validators.isValidIdeaTitle('x'.repeat(201))).toBe(false);
    expect(validators.isValidIndustry('a')).toBe(false);
    expect(validators.isValidProblemSolved('short')).toBe(false);
    expect(validators.isValidProblemSolved('x'.repeat(20))).toBe(true);
    expect(validators.isValidProblemSolved('x'.repeat(5001))).toBe(false);
  });

  it('only accepts https for a user-supplied avatar URL', () => {
    expect(validators.isValidHttpsUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(validators.isValidHttpsUrl('http://cdn.example.com/a.png')).toBe(false);
    expect(validators.isValidHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(validators.isValidHttpsUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false);
  });

  /**
   * Regression guard: every predicate used to throw on a non-string, which
   * aborted the submit handler before it could show an error message.
   */
  it('never throws on null, undefined, numbers, objects or arrays', () => {
    const hostile = [null, undefined, 0, 42, {}, [], true, NaN, Symbol.iterator];
    const predicates = [
      'isValidEmail',
      'isValidPassword',
      'isValidFullName',
      'isValidRoleType',
      'isValidSkillsList',
      'isValidIdeaTitle',
      'isValidIndustry',
      'isValidProblemSolved',
      'isValidRequiredSkills',
      'isValidHttpsUrl',
    ];
    for (const name of predicates) {
      for (const value of hostile) {
        expect(() => validators[name](value), `${name}(${String(value)})`).not.toThrow();
        expect(typeof validators[name](value), `${name}(${String(value)})`).toBe('boolean');
      }
    }
    for (const value of hostile) {
      expect(() => validators.parseAndDedupeSkills(value)).not.toThrow();
      expect(Array.isArray(validators.parseAndDedupeSkills(value))).toBe(true);
    }
  });
});

describe('sanitize', () => {
  it('removes emoji, flags, ZWJ sequences and variation selectors', () => {
    expect(stripEmoji('Ada 🚀 Lovelace 🇸🇦')).toBe('Ada Lovelace');
    expect(stripEmoji('a 👩‍💻 b')).toBe('a b');
  });

  it('collapses the whitespace left behind', () => {
    expect(stripEmoji('a   b')).toBe('a b');
  });

  it('returns an empty string for falsy input rather than throwing', () => {
    for (const bad of ['', null, undefined, 0, false]) {
      expect(stripEmoji(bad), String(bad)).toBe('');
    }
  });

  it('safeName truncates to the requested maximum', () => {
    expect(safeName('x'.repeat(100))).toHaveLength(60);
    expect(safeName('x'.repeat(100), 10)).toHaveLength(10);
  });

  it('leaves Arabic script intact — it is content, not decoration', () => {
    expect(stripEmoji('أحمد 🚀')).toBe('أحمد');
  });
});

describe('supabase client — degraded mode', () => {
  beforeEach(() => {
    vi.resetModules();
    delete globalThis.__urlife_supabase_client__;
  });
  afterEach(() => {
    delete globalThis.__urlife_supabase_client__;
  });

  it('getSupabaseSync() returns a chainable stub instead of undefined', async () => {
    const { getSupabaseSync } = await import('../../src/lib/supabase.js');
    const client = getSupabaseSync();
    expect(client).toBeTruthy();
    expect(() => client.from('ideas').select('*').eq('id', 1).order('x').limit(1)).not.toThrow();
  });

  /**
   * The whole codebase destructures `{ data, error }`; it never uses
   * try/catch around a Supabase call. The stub therefore *resolves* with a
   * typed error rather than rejecting, so existing call sites report
   * "unavailable" instead of producing an unhandled rejection.
   */
  it('resolves write operations with a typed BackendUnavailableError', async () => {
    const { getSupabaseSync, BackendUnavailableError } = await import('../../src/lib/supabase.js');
    const client = getSupabaseSync();

    const signIn = await client.auth.signInWithPassword({ email: 'a@b.com', password: 'x' });
    expect(signIn.error).toBeInstanceOf(BackendUnavailableError);
    expect(signIn.error.code).toBe('BACKEND_UNAVAILABLE');

    const insert = await client.from('ideas').insert({});
    expect(insert.error).toBeInstanceOf(BackendUnavailableError);
  });

  it('reports "no session" cleanly so boot can proceed without a backend', async () => {
    const { getSupabaseSync } = await import('../../src/lib/supabase.js');
    const { data, error } = await getSupabaseSync().auth.getSession();
    expect(error).toBeNull();
    expect(data.session).toBeNull();
  });

  it('exposes a no-op realtime channel so dashboard subscriptions cannot throw', async () => {
    const { getSupabaseSync } = await import('../../src/lib/supabase.js');
    const channel = getSupabaseSync().channel('x');
    expect(() => channel.on('postgres_changes', {}, () => {}).subscribe()).not.toThrow();
  });

  it('isLive() is false in degraded mode', async () => {
    const mod = await import('../../src/lib/supabase.js');
    expect(mod.isLive()).toBe(false);
    expect(await mod.getSupabase()).toHaveProperty('__stub', true);
    expect(mod.isLive()).toBe(false);
  });

  it('the stub is never memoised into the real singleton slot', async () => {
    const mod = await import('../../src/lib/supabase.js');
    mod.getSupabaseSync();
    expect(globalThis.__urlife_supabase_client__).toBeUndefined();
  });

  it('a pre-installed client is reused rather than re-created', async () => {
    const fake = { marker: 'injected', auth: {}, from: () => ({}) };
    globalThis.__urlife_supabase_client__ = fake;
    const mod = await import('../../src/lib/supabase.js');
    expect(mod.getSupabaseSync()).toBe(fake);
    expect(await mod.getSupabase()).toBe(fake);
  });
});
