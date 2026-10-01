/**
 * Flow: sign-in, registration and idea submission, end to end at the DOM
 * level, against the real markup, with Supabase stubbed through the single
 * shared client.
 *
 * These are the money paths. Before this suite none of them had any
 * automated coverage at all.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountIndexHtml, flush } from '../helpers/page.js';
import { initModalSystem, __resetModalsForTests } from '../../src/app/modal.js';

/** Build a controllable fake that matches the slice of supabase-js we use. */
function makeFakeClient(overrides = {}) {
  const calls = { signIn: [], signUp: [], otp: [], insert: [], select: [] };
  const table = (name) => {
    const chain = {
      _name: name,
      select(...a) {
        calls.select.push([name, ...a]);
        return chain;
      },
      insert(row) {
        calls.insert.push([name, row]);
        return chain;
      },
      upsert() {
        return chain;
      },
      eq() {
        return chain;
      },
      order() {
        return chain;
      },
      limit() {
        return chain;
      },
      single: () => Promise.resolve(overrides.single ?? { data: { id: 'row-1' }, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (res) => Promise.resolve({ data: [], error: null }).then(res),
    };
    return chain;
  };

  return {
    calls,
    from: table,
    auth: {
      getSession: () => Promise.resolve({ data: { session: overrides.session ?? null }, error: null }),
      getUser: () => Promise.resolve({ data: { user: overrides.session?.user ?? null }, error: null }),
      signInWithPassword(args) {
        calls.signIn.push(args);
        return Promise.resolve(
          overrides.signIn ?? { data: { session: { user: { id: 'u1' } } }, error: null }
        );
      },
      signInWithOtp(args) {
        calls.otp.push(args);
        return Promise.resolve(overrides.otp ?? { data: {}, error: null });
      },
      signUp(args) {
        calls.signUp.push(args);
        return Promise.resolve(
          overrides.signUp ?? { data: { session: null, user: { id: 'u1' } }, error: null }
        );
      },
      signOut: () => Promise.resolve({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
}

const GLOBAL_KEY = '__urlife_supabase_client__';

describe('authentication flows', () => {
  let fake;

  beforeEach(async () => {
    vi.resetModules();
    __resetModalsForTests();
    mountIndexHtml();
    initModalSystem();
    fake = makeFakeClient();
    globalThis[GLOBAL_KEY] = fake;
  });

  afterEach(() => {
    delete globalThis[GLOBAL_KEY];
    __resetModalsForTests();
  });

  it('rejects an invalid email before making any network call', async () => {
    const { handleSignIn } = await import('../../src/auth.js');
    document.getElementById('login-email').value = 'not-an-email';
    document.getElementById('login-password').value = 'password1';

    handleSignIn('not-an-email', 'password1', () => {});
    await flush();

    const err = document.getElementById('login-error');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toMatch(/valid email/i);
    expect(fake.calls.signIn).toHaveLength(0);
  });

  it('marks the offending field aria-invalid and describes it', async () => {
    const { handleSignIn } = await import('../../src/auth.js');
    handleSignIn('nope', 'password1', () => {});
    await flush();
    const field = document.getElementById('login-email');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain('login-error');
  });

  it('signs in with a valid credential pair and invokes the success callback', async () => {
    const { handleSignIn } = await import('../../src/auth.js');
    const onSuccess = vi.fn();
    handleSignIn('a@b.com', 'password1', onSuccess);
    await flush(4);
    expect(fake.calls.signIn[0]).toMatchObject({ email: 'a@b.com', password: 'password1' });
    expect(onSuccess).toHaveBeenCalled();
  });

  it('shows a generic message on a wrong password and does not leak the server text', async () => {
    globalThis[GLOBAL_KEY] = makeFakeClient({
      signIn: { data: null, error: { message: 'Invalid login credentials: user 4b21 not found' } },
    });
    const { handleSignIn } = await import('../../src/auth.js');
    handleSignIn('a@b.com', 'wrongpass1', () => {});
    await flush(4);
    const text = document.getElementById('login-error').textContent;
    expect(text).toMatch(/Incorrect email or password/i);
    expect(text).not.toMatch(/4b21/);
  });

  it('enforces the password policy on registration before any network call', async () => {
    const { handleSignUp } = await import('../../src/auth.js');
    handleSignUp(
      {
        fullName: 'Ada Lovelace',
        email: 'a@b.com',
        password: 'short',
        roleType: 'builder',
        skillsRaw: 'maths',
      },
      () => {},
      () => {}
    );
    await flush();
    expect(document.getElementById('register-error').textContent).toMatch(/at least 8 characters/i);
    expect(fake.calls.signUp).toHaveLength(0);
  });

  it('rejects an unknown role type', async () => {
    const { handleSignUp } = await import('../../src/auth.js');
    handleSignUp(
      { fullName: 'Ada', email: 'a@b.com', password: 'password1', roleType: 'admin', skillsRaw: 'maths' },
      () => {},
      () => {}
    );
    await flush();
    expect(document.getElementById('register-error').textContent).toMatch(/select a role/i);
    expect(fake.calls.signUp).toHaveLength(0);
  });

  it('sends the magic link and reports success', async () => {
    const { handleMagicLinkSignIn } = await import('../../src/auth.js');
    const onSuccess = vi.fn();
    handleMagicLinkSignIn('ops@urlifeisup.com', onSuccess);
    await flush(4);
    expect(fake.calls.otp[0].email).toBe('ops@urlifeisup.com');
    expect(onSuccess).toHaveBeenCalled();
  });

  it('the magic-link trigger exists in the markup (it used to be missing)', () => {
    expect(document.getElementById('magic-link-submit')).not.toBeNull();
  });
});

describe('idea submission', () => {
  beforeEach(() => {
    vi.resetModules();
    __resetModalsForTests();
    mountIndexHtml();
    initModalSystem();
    globalThis[GLOBAL_KEY] = makeFakeClient();
    sessionStorage.clear();
  });
  afterEach(() => {
    delete globalThis[GLOBAL_KEY];
    __resetModalsForTests();
  });

  const session = { user: { id: 'u1' } };
  const good = {
    title: 'Sovereign liquidity rails',
    industry: 'FinTech',
    problem: 'Cross-border settlement takes three days and costs far too much for small operators.',
    skillsRaw: 'solidity, risk, ops',
  };

  it('rejects a too-short title', async () => {
    const { handleIdeaSubmit } = await import('../../src/ideas.js');
    handleIdeaSubmit({ ...good, title: 'Hi' }, session);
    await flush();
    expect(document.getElementById('idea-error').textContent).toMatch(/5–200 characters/);
  });

  it('rejects a problem statement under 20 characters', async () => {
    const { handleIdeaSubmit } = await import('../../src/ideas.js');
    handleIdeaSubmit({ ...good, problem: 'too short' }, session);
    await flush();
    expect(document.getElementById('idea-error').textContent).toMatch(/at least 20 characters/);
  });

  it('blocks a non-visionary and offers the role switch instead of failing silently', async () => {
    const auth = await import('../../src/auth.js');
    vi.spyOn(auth, 'getCachedProfile').mockReturnValue({ role_type: 'builder' });
    const { handleIdeaSubmit } = await import('../../src/ideas.js');

    handleIdeaSubmit(good, session);
    await flush(4);

    const toast = document.querySelector('#toast-container .toast');
    expect(toast?.textContent).toMatch(/Only visionaries/i);
    expect(toast?.querySelector('.toast-action')?.textContent).toMatch(/Switch to Visionary/i);
    // The draft must survive so the retry is lossless.
    expect(JSON.parse(sessionStorage.getItem('nexus_pending_idea')).title).toBe(good.title);
  });

  it('inserts the idea for a visionary and renders the card', async () => {
    const auth = await import('../../src/auth.js');
    vi.spyOn(auth, 'getCachedProfile').mockReturnValue({ role_type: 'visionary' });
    const client = makeFakeClient({
      single: {
        data: {
          id: 'i1',
          title: good.title,
          industry: 'FinTech',
          problem_solved: good.problem,
          required_skills: ['solidity'],
        },
        error: null,
      },
    });
    globalThis[GLOBAL_KEY] = client;

    const { handleIdeaSubmit } = await import('../../src/ideas.js');
    handleIdeaSubmit(good, session);
    await flush(5);

    expect(client.calls.insert[0][0]).toBe('ideas');
    expect(client.calls.insert[0][1]).toMatchObject({ user_id: 'u1', title: good.title });
    const card = document.querySelector('#ideas-feed-list .idea-card');
    expect(card).not.toBeNull();
    expect(card.querySelector('.idea-title').textContent).toBe(good.title);
    expect(document.getElementById('ideas-feed-section').hidden).toBe(false);
  });

  it('renders idea content as text, never as markup', async () => {
    const { buildIdeaCard } = await import('../../src/ui.js');
    const card = buildIdeaCard({
      title: '<img src=x onerror="window.__pwned=1">',
      industry: '<script>1</script>',
      problem_solved: 'ok',
      required_skills: ['<b>x</b>'],
    });
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('script')).toBeNull();
    expect(card.querySelector('b')).toBeNull();
    expect(card.querySelector('.idea-title').textContent).toContain('<img');
    expect(window.__pwned).toBeUndefined();
  });
});
