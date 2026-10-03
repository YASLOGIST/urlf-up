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
   _bilingual Arabic and English from day one_.
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
   measured audit, then fixes where real. _(Resolved in W-C — the `--dim`
   override to 0.62 in `a11y.css` was already correct; the audit then found 20
   further real failures elsewhere, all fixed.)_

## Waves

| Wave | Scope                                                                              | Status                     | Evidence                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-A  | P0 content/link fixes + link-liveness gate                                         | ✅ done — commit `3fae6e0` | roadmap sentence restored; `npm run check:links` + CI `link-liveness` job                                                                                     |
| W-B  | Bilingual member console (dictionary, all modules, re-render on langchange, tests) | ✅ done — commit `a1bf07c` | 18 new specs (`tests/flows/console-i18n.test.js`), 270/270 total; strings-*.js lazy chunk 7.3 kB gz off critical path; critical path 54.5 kB gz (gate green)  |
| W-C  | Measured WCAG AA contrast audit wired to CI + fixes                                | ✅ done (this commit)      | `scripts/audit-contrast.mjs` — first run **20 failures / 8 root causes**, after fixes **223/223 pass · 0 unmeasured**; in `npm run verify` + CI `quality` job |
| W-D  | README/docs truth pass, final verify                                               | ✅ done (this commit)      | README §9 gap #2 now carries measured numbers; full verify green at commit                                                                                    |

### W-C detail (measured 2026-10-02)

First audit run: 20 failing elements, 0 false positives after three tool bugs were
found and fixed while verifying like a hostile reviewer (minified-CSS last-declaration
parsing, alpha compositing that collapsed translucent stacks to solid colour, `px`
falling through a `switch` so every explicit px font-size read as 16 px).

Real defects found and fixed (all in `src/styles/a11y.css`, measured before → after):

| Surface                                            | Before                     | After                                                                  |
| -------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `.htitle .l3` hero ghost outline (stroke 25% gold) | 1.47:1 (needs 3:1 @ 42 px) | stroke 62% ≈ 3.7:1                                                     |
| `.rev-list li` revenue list                        | 4.34:1 @ 12 px             | 0.68 alpha ≈ 6:1                                                       |
| `.rev-pill` (worst gradient stop)                  | 4.39:1 @ 11 px             | `#ff6a56` ≈ 6:1                                                        |
| footer brand statement group                       | 2.83:1 @ 11 px             | 0.66 white ≈ 7:1                                                       |
| `.role-card-desc`                                  | 3.82:1 @ 10 px             | 0.70 white ≈ 7:1                                                       |
| `.glass-modal-close` ✕                             | 3.81:1 @ 20 px             | 0.70 white ≈ 7:1                                                       |
| `.avatar-placeholder` +                            | 1.98:1 (needs 3:1 @ 32 px) | 0.8 gold ≈ 5:1                                                         |
| `.rm-n` numerals, `.manifesto-watermark`           | 1.05–1.06:1                | decorative → `aria-hidden="true"` (also stops SR reading stray digits) |

Honest limits kept visible in the script header: cascade approximation (order, not
full specificity), desktop media values (mobile overrides only shrink text, so a
desktop pass is the lenient direction), pseudo-element text excluded, dynamic
overlays audited via their literal inline-style pairs instead of the DOM.

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

---

## Run — 2026-10-03 (APEX V14)

- **Mode / depth:** UPGRADE · STANDARD
- **Baseline:** `npm run verify` passed after dependency install; 277 specs,
  55.6 kB gzip critical path, 223/223 static contrast checks.
- **Finding:** local avatar uploads produced base64 data URLs, while the committed
  database constraint accepts HTTPS URLs only. Every uploaded avatar therefore
  failed at profile save. The implementation also assumed `OffscreenCanvas`,
  excluding Safari / the iOS Capacitor shell.
- **Resolution:** avatar images are now bounded, centre-cropped WebP blobs uploaded
  to an RLS-protected Supabase Storage path before the HTTPS URL is saved. Added
  HTML-canvas fallback, bitmap/object-URL cleanup, localized size failures,
  HTTPS-only remote URLs, bucket migration/rollback notes, and two regression specs.
- **Deployment dependency:** apply the idempotent Storage section in
  `nexus-schema.sql` before deploying this client. No production migration was
  executed from this workspace.
