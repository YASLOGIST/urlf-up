/**
 * Console internationalisation.
 *
 * The marketing document has been bilingual since the first upgrade wave, but
 * everything behind the session — dashboard, dialogs, toasts, deal room —
 * rendered English literals even when the page was in Arabic/RTL. These specs
 * pin the console dictionary that closed that gap:
 *
 *  1. en/ar key parity — a missing key is a missing translation, not a
 *     silent English fallback the operator can see in production.
 *  2. `data-i18n*` markup contract — every key referenced by index.html
 *     resolves in the dictionary.
 *  3. matching-engine noteKeys resolve (they are produced deep inside
 *     scoring code; a typo there would render the raw key).
 *  4. Plural categories use real CLDR rules (Arabic has six).
 *  5. The dashboard re-renders in place on language change — no refetch,
 *     no skeletons.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountIndexHtml, readIndexHtml, flush } from '../helpers/page.js';
import { initI18n, setLanguage, __resetI18nForTests } from '../../src/app/i18n.js';
import {
  STRINGS,
  t,
  tCount,
  localeShortDate,
  applyConsoleTranslations,
  initConsoleI18n,
  __resetConsoleI18nForTests,
} from '../../src/app/strings.js';
import { createVerificationBadge } from '../../src/components/VerificationBadge.js';
import { calculateMatch } from '../../src/matchingEngine.js';

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Dictionary integrity
 * ════════════════════════════════════════════════════════════════════════ */

describe('console dictionary', () => {
  it('en and ar carry exactly the same key set', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.ar).sort());
  });

  it('no translation is an empty string', () => {
    for (const [lang, table] of Object.entries(STRINGS)) {
      for (const [key, value] of Object.entries(table)) {
        expect(String(value).length, `${lang}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('placeholders are consistently named in both languages', () => {
    // Every {param} used by a key must appear in both languages' version —
    // except that plural-category keys (.one/.two/.zero) may render the
    // quantity as a natural number word ("اهتمام واحد") instead of {count}.
    const PLURAL_KEY = /\.(one|two|zero)$/;
    for (const key of Object.keys(STRINGS.en)) {
      const en = [...STRINGS.en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const ar = [...STRINGS.ar[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      if (PLURAL_KEY.test(key)) {
        const arNonCount = ar.filter((p) => p !== 'count');
        const enNonCount = en.filter((p) => p !== 'count');
        expect(arNonCount, key).toEqual(enNonCount);
      } else {
        expect(ar, key).toEqual(en);
      }
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 2. Lookup behaviour
 * ════════════════════════════════════════════════════════════════════════ */

describe('t() / tCount()', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetI18nForTests();
    initI18n();
  });
  afterEach(() => {
    localStorage.clear();
    __resetI18nForTests();
  });

  it('interpolates params', () => {
    expect(t('nx.confidence', { value: 87 })).toBe('87% confidence');
    setLanguage('ar');
    expect(t('nx.confidence', { value: 87 })).toBe('ثقة 87%');
  });

  it('falls back to English, then to the raw key — never to blank', () => {
    setLanguage('ar');
    // Simulate a key missing from ar only.
    const arTable = STRINGS.ar;
    const saved = arTable['nx.retry'];
    delete arTable['nx.retry'];
    expect(t('nx.retry')).toBe('Retry');
    arTable['nx.retry'] = saved;
    expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });

  it('ignores a non-object params argument instead of mis-interpolating', () => {
    expect(t('nx.retry', 'fallback-as-string')).toBe('Retry');
  });

  it('uses the real CLDR plural categories for Arabic', () => {
    setLanguage('ar');
    expect(tCount('nx.incomingInterest', 0)).toBe('لا اهتمامات واردة بعد');
    expect(tCount('nx.incomingInterest', 1)).toBe('اهتمام واحد وارد');
    expect(tCount('nx.incomingInterest', 2)).toBe('اهتمامان واردان');
    expect(tCount('nx.incomingInterest', 5)).toContain('5');
    expect(tCount('nx.incomingInterest', 5)).not.toContain('{count}');
    expect(tCount('nx.incomingInterest', 15)).toContain('15');
    expect(tCount('nx.incomingInterest', 100)).toContain('100');
  });

  it('English plurals distinguish one/other', () => {
    expect(tCount('nx.incomingInterest', 1)).toBe('1 incoming interest');
    expect(tCount('nx.incomingInterest', 3)).toBe('3 incoming interests');
    expect(tCount('nx.incomingInterest', 0)).toBe('No incoming interest yet');
  });

  it('formats dates in the active language with Latin digits for Arabic', () => {
    const iso = '2026-03-12T10:00:00Z';
    expect(localeShortDate(iso)).toMatch(/^Mar 12$/);
    setLanguage('ar');
    const ar = localeShortDate(iso);
    expect(ar).toMatch(/12/);
    expect(ar).toMatch(/مارس/);
    expect(ar).not.toMatch(/[٠-٩]/); // Latin digits, consistent with scores
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 3. Markup + engine contracts
 * ════════════════════════════════════════════════════════════════════════ */

describe('data-i18n markup contract', () => {
  it('every data-i18n* key referenced by index.html resolves in the dictionary', () => {
    const html = readIndexHtml();
    const used = new Set();
    for (const attr of [
      'data-i18n',
      'data-i18n-rich',
      'data-i18n-placeholder',
      'data-i18n-aria',
      'data-i18n-title',
    ]) {
      for (const m of html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(40); // the console surface is real
    const missing = [...used].filter((k) => !(k in STRINGS.en) || !(k in STRINGS.ar));
    expect(missing, `unresolved keys: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('matching engine note keys', () => {
  const idea = {
    title: 'Desert solar marketplace',
    industry: 'Energy',
    problem_statement: 'Hard to finance small solar installs',
    required_skills: ['finance', 'web'],
    role_type: 'visionary',
  };
  const candidates = [
    {
      full_name: 'A',
      role_type: 'builder',
      skills: ['web'],
      industries: ['energy'],
      reputation: 60,
      is_verified: true,
    },
    { full_name: 'B', role_type: 'enabler', skills: [], industries: [], availableFunds: 5000 },
    {}, // fully sparse: exercises every "missing data" note
  ];

  it('every emitted noteKey exists in the dictionary (both languages)', () => {
    for (const candidate of candidates) {
      const match = calculateMatch(idea, candidate, { includeRejected: true });
      for (const reason of match.reasons) {
        expect(reason.noteKey, `axis ${reason.axis}`).toBeTruthy();
        expect(STRINGS.en[reason.noteKey], `en:${reason.noteKey}`).toBeTruthy();
        expect(STRINGS.ar[reason.noteKey], `ar:${reason.noteKey}`).toBeTruthy();
      }
    }
  });

  it('role params are dictionary keys so they translate at render time', () => {
    const match = calculateMatch(idea, candidates[0], { includeRejected: true });
    const roleNote = match.reasons.find((r) => r.axis === 'role');
    expect(roleNote.noteParams.candidate).toMatch(/^role\./);
    expect(roleNote.noteParams.source).toMatch(/^role\./);
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 4. Static console markup translation
 * ════════════════════════════════════════════════════════════════════════ */

describe('applyConsoleTranslations', () => {
  beforeEach(() => {
    __resetI18nForTests();
    __resetConsoleI18nForTests();
    mountIndexHtml();
    initI18n();
  });
  afterEach(() => {
    localStorage.clear();
    __resetI18nForTests();
    __resetConsoleI18nForTests();
  });

  it('translates labels, placeholders and aria-labels into Arabic', () => {
    setLanguage('ar');
    applyConsoleTranslations();
    expect(document.getElementById('login-email').previousElementSibling.textContent).toBe(
      'البريد الإلكتروني'
    );
    expect(document.getElementById('idea-title').getAttribute('placeholder')).toBe('ما اسم فكرتك؟');
    expect(document.getElementById('nav-settings-btn').getAttribute('aria-label')).toBe('إعدادات الحساب');
    expect(document.getElementById('register-role').options[1].textContent).toBe(
      'صاحب فكرة — لديّ فكرة أريد بناءها'
    );
  });

  it('the rich variant keeps inline markup but only from the allow-list', () => {
    setLanguage('ar');
    applyConsoleTranslations();
    const gate = document.querySelector('#idea-role-gate p');
    expect(gate.querySelector('strong')).toBeTruthy();
    expect(gate.textContent).toContain('أصحاب الأفكار');
  });

  it('initConsoleI18n re-applies on every language change, once initialised', async () => {
    initConsoleI18n();
    setLanguage('ar');
    await flush(1);
    expect(document.getElementById('nav-logout-btn').textContent).toBe('تسجيل الخروج');
    setLanguage('en');
    await flush(1);
    expect(document.getElementById('nav-logout-btn').textContent).toBe('Sign Out');
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 5. Components
 * ════════════════════════════════════════════════════════════════════════ */

describe('VerificationBadge', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetI18nForTests();
    initI18n();
  });
  afterEach(() => {
    localStorage.clear();
    __resetI18nForTests();
  });

  it('shows tier names in the active language and uses the active font face', () => {
    setLanguage('ar');
    const badge = createVerificationBadge('gold');
    expect(badge.textContent).toBe('ذهبي');
    expect(badge.style.fontFamily).toContain('--font-active');
  });

  it('falls back gracefully for an unknown tier id', () => {
    const badge = createVerificationBadge('platinum');
    expect(badge.textContent).toBe('platinum');
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * 6. Dashboard renders — and re-renders — in the active language
 * ════════════════════════════════════════════════════════════════════════ */

vi.mock('../../src/lib/supabase.js', () => {
  /** Mutable fixture store the specs write to; the mock reads from it. */
  const store = {
    profile: {
      id: 'u1',
      full_name: 'Layla Hassan',
      role_type: 'builder',
      skills: ['web'],
      interests: ['energy'],
      reputation: 10,
      is_verified: false,
    },
    ideas: [
      {
        id: 'i1',
        author_id: 'v1',
        author_name: 'Omar',
        author_verified: true,
        title: 'Desert solar marketplace',
        industry: 'Energy',
        problem_statement: 'Hard to finance small solar installations in remote areas.',
        required_skills: ['web', 'finance'],
        status: 'open',
        interest_count: 3,
        published_at: '2026-03-12T10:00:00Z',
      },
    ],
    interests: [],
  };

  const query = (resolver) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      single: () => resolver(),
      maybeSingle: () => resolver(),
      then: (ok, err) => resolver().then(ok, err),
    };
    return chain;
  };

  const supabase = {
    __store: store,
    __fromCalls: [],
    from(table) {
      supabase.__fromCalls.push(table);
      if (table === 'profiles') return query(() => Promise.resolve({ data: store.profile, error: null }));
      if (table === 'ideas_public' || table === 'ideas')
        return query(() => Promise.resolve({ data: store.ideas, error: null }));
      if (table === 'idea_interests')
        return query(() => Promise.resolve({ data: store.interests, error: null }));
      if (table === 'profiles_public') return query(() => Promise.resolve({ data: [], error: null }));
      return query(() => Promise.resolve({ data: [], error: null }));
    },
    channel() {
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel() {},
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
  };

  return { supabase, __esModule: true };
});

describe('dashboard language behaviour', () => {
  let initDashboard;

  beforeAll(async () => {
    ({ initDashboard } = await import('../../src/dashboard.js'));
  });

  beforeEach(async () => {
    __resetI18nForTests();
    __resetConsoleI18nForTests();
    mountIndexHtml();
    initI18n();
    const { supabase } = await import('../../src/lib/supabase.js');
    supabase.__fromCalls.length = 0;
    if (process.env.DEBUG_NX) {
      console.log('state:', {
        error: document.getElementById('nx-error')?.textContent,
        empty: document.getElementById('nx-empty')?.textContent,
        hidden: document.getElementById('nx-matches-panel')?.hidden,
      });
    }
  });
  afterEach(() => {
    localStorage.clear();
    __resetI18nForTests();
  });

  it('renders the operator view in English, then re-renders in Arabic with no refetch', async () => {
    await initDashboard({ user: { id: 'u1', email: 'layla@example.com' } });
    await flush(5);

    expect(document.getElementById('nx-title').textContent).toContain('NEXUS — Layla Hassan');
    expect(document.getElementById('nx-user-role').textContent).toContain('Builder');
    const express = [...document.querySelectorAll('#nx-matches-list button')].find((b) =>
      b.textContent.includes("I'm interested")
    );
    expect(express).toBeTruthy();
    expect(document.getElementById('nx-ai-matches-title').textContent).toBe('Recommended next meetings');

    const { supabase } = await import('../../src/lib/supabase.js');
    const callsBefore = supabase.__fromCalls.length;

    setLanguage('ar');
    await flush(5);

    // Re-rendered copy — no new network traffic.
    expect(supabase.__fromCalls.length).toBe(callsBefore);
    expect(document.getElementById('nx-user-role').textContent).toContain('البنّاء');
    const expressAr = [...document.querySelectorAll('#nx-matches-list button')].find((b) =>
      b.textContent.includes('أنا مهتم')
    );
    expect(expressAr).toBeTruthy();
    expect(document.getElementById('nx-ai-matches-title').textContent).toBe('الاجتماعات الموصى بها التالية');

    // Matching notes render through the dictionary, with translated axes.
    const reasons = document.querySelector('#nx-matches-list .nx-reasons');
    expect(reasons.textContent).toContain('المهارات');

    // Status of the page follows the document direction.
    expect(document.documentElement.dir).toBe('rtl');
  });
});
