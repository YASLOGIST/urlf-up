# UPGRADE LOG — Arena session (V8 engine)

- **TARGET:** `/home/user/urlf-up` (whole repository)
- **MODE:** UPGRADE · **AUTONOMY:** FULL
- **Branch:** `arena/01a0fe18-urlf-up` (session-fixed; the engine's suggested
  `upgrade/<target>-<date>` branch is not usable here — session constraint wins).
- **Baseline:** `npm run verify` all green · 252 specs · critical path 53.9 kB gz
  (headroom to baseline gate: 74.8 kB).

## Classification

- **PRIMARY:** WEB (single-page marketing site + progressively-loaded member console)
- **SECONDARY:** BACKEND-client (Supabase/RLS), DESIGN (token system), I18N/RTL
- **SPECIALIST:** none supplied
- **CROSS-CUTTING:** SECURITY (CSP, sanitisation — existing), TRUTH, ACCESSIBILITY

## Environment facts (measured)

- No real browser available (Playwright CDN blocked from sandbox) → LCP/CLS/FPS
  remain UNMEASURED (Known gap #1 stays honestly open).
- Sandbox egress restricted (cal.com unreachable via curl) → external link
  liveness must be tested via the platform fetch tool now, and by CI later.

## Key recon findings

1. **P0 — Booking link is DEAD (verified via fetch):** `https://cal.com/ahmed-urlfxup/15min`
   returns 404; the username `ahmed-urlfxup` is unclaimed on cal.com. The default
   `CAL_LINK` in `src/lib/env.js` is baked into every build without
   `VITE_CAL_LINK`. The "Request a Closed Meeting" path — the site's core
   conversion action — renders Cal.com's 404 inside the modal. Cannot be fixed
   from inside the repo (claiming a cal.com account is an operator action);
   the repo-side fix is a link-liveness CI gate + honest docs + graceful fallback.
2. **P0 — Corrupted English copy in Roadmap (MVP milestone):**
   "…Notion for active projects. from day one." — a clause was lost. The Arabic
   string (`عربي وإنجليزي من اليوم الأول`) preserves the intended meaning:
   *bilingual Arabic and English from day one*.
3. **P1 — Member console is English-only:** marketing page is fully bilingual
   (180+ nodes), but everything behind login — dashboard, toasts, validation
   errors, Deal Room, settings, ideas feed — renders English strings even when
   the page is in Arabic/RTL. Audience is the Arab world; roadmap promises
   "Arabic and English from day one".
4. **P1 — `VerificationBadge`/`DealRoom` hardcode `var(--font-en)`** → wrong
   font for Arabic glyphs; `DealRoom` uses `alert()`, hardcoded z-index 1000
   (below modals 9500 / toasts 9800), and `shortDate` hardcodes `Intl … 'en'`.
5. **P2 — Contrast unmeasured (Known gap #2):** `--dim` (ice @ 0.45 alpha) on
   obsidian computes to ≈4.4:1 — likely AA-fail for small text. Needs a
   measured audit, then fixes where real.

## Waves

| Wave | Scope | Status |
|---|---|---|
| W-A | P0 content/link fixes + link-liveness gate | ✅ done |
| W-B | Bilingual member console (dictionary, all modules, re-render on langchange, tests) | ✅ done |
| W-C | Static WCAG contrast audit gate + token fixes | ✅ done |
| W-D | README/docs truth pass, final verify | ✅ done |

## Assumptions

- Operator must claim `cal.com/ahmed-urlfxup` (or set `VITE_CAL_LINK`); repo now
  fails CI (`npm run check:links`) until that is true. Recorded, not assumed away.
- Arabic copy edits preserve author voice; only clear grammar/idiom errors fixed.
- The corrupted roadmap sentence is restored from the parallel Arabic string,
  which is treated as ground truth for the missing clause.

## Decisions / rejected

- No Playwright/Lighthouse numbers: environment cannot run a browser; claiming
  them would violate the Truth Protocol. Left UNMEASURED in docs.
- Did not replace or "improve" the dead Cal link with an invented one.
- No UI framework, no new runtime deps (dictionary is plain JS) — preserves the
  2-runtime-dependency contract.
