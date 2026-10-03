# UPGRADE LOG — Arena session (2026-10-03)

- **TARGET:** `/home/user/urlf-up` (whole repository)
- **MODE:** UPGRADE · **AUTONOMY:** FULL
- **Branch:** `arena/01a10028-urlf-up` (session-fixed)
- **Primary domain:** Web product / accessibility / runtime rendering
- **Secondary domains:** product truth, i18n/RTL, WebGL/Canvas lifecycle, interaction design

## W0–W1 recon and baseline

- The application is a Vite 6, vanilla-ESM, static SPA with a lazy Supabase
  console and a dependency-free WebGL2 → Canvas2D ambient renderer.
- **MEASURED:** `npm run verify` passed: lint; **270/270** specs; production
  build; bundle measure; contrast audit (**223/223 pass**); high/critical
  dependency audit (0).
- **MEASURED:** `npm run bench` reported a median **0.0234 ms/simulation frame**
  at the shipping high-tier setting (130 particles); rendezvous scheduling added
  no measurable CPU cost in that benchmark.
- **UNMEASURED:** browser FPS, p95 frame time, GPU time, LCP/CLS/TBT and mobile
  render output. This sandbox has no usable installed browser.
- **BLOCKED (external):** `npm run check:links` cannot verify the live Cal.com
  booking route or canonical host from this sandbox (network/DNS failures). The
  existing default booking path must still be set to a verified live URL by the
  operator; no replacement URL was invented.

## Findings routed into implementation

1. The accepted-interest “Deal Room” called a local `EscrowEngine` simulation
   “Cryptographic Sign & Lock” and showed “Locked in Escrow.” It neither signed,
   persisted, transferred, nor escrowed anything. This was a material product
   truth failure.
2. That same dynamic dialog bypassed the app’s modal stack, focus trap, inert
   background, scroll lock, and focus restoration.
3. The renderer documented runtime OS reduced-motion support, but did not
   subscribe to the preference after initial boot. A user changing the setting
   mid-session could still receive continuous animation.
4. Landing-page copy described the shipped deterministic matching system as a
   live GPT-4 / AI evaluation product. The in-repository implementation ranks
   declared roles, skills, interests, trust and data-completeness signals;
   future AI concepts are not active capabilities.

## W2–W6 implementation

| Upgrade                     | Result                                                                                                                                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Truthful terms workspace    | Replaced fake escrow/signing with a local “Terms workspace.” It validates proposed 0–100% shares and a milestone, clearly says nothing is signed/sent/funded/escrowed, and reports only that the draft is ready to discuss. Removed the unused simulation module.                   |
| Accessible dialog lifecycle | Terms workspace now uses `app/modal.js`: focus starts in the first control, background becomes inert, Tab is trapped, Escape/backdrop close work, scroll is locked, and focus returns to the initiating control.                                                                    |
| Runtime reduced-motion      | `visual/field.js` now observes preference changes, stops immediately, hides the canvas, exposes the CSS fallback, and resumes only if motion is re-enabled. Context-loss replacement now owns the active canvas node, preventing later lifecycle writes to a detached WebGL canvas. |
| Product truth copy          | Current matching is now described as explainable/transparent. The AI panel and technology cards are explicitly marked as planned direction / inactive integrations rather than present capability. Meta descriptions and language-switched description follow the same rule.        |
| Verification coverage       | Added terms-workspace lifecycle and truth-boundary specs; added a runtime reduced-motion state-change flow spec.                                                                                                                                                                    |

## W7 verification (final measured state)

- **PASS:** `npm run verify` — ESLint; **274/274** specs across 16 files;
  production Vite build; bundle measure; **223/223** static contrast checks;
  and zero high/critical dependency advisories. The audit reports three
  lower-severity advisories, which were not force-upgraded without review.
- **PASS:** `npm run test:coverage` — 78.1% statements, 76.2% branches and
  70.9% functions across `src/`; configured global and per-file thresholds
  passed. The new terms workspace is 98.2% line-covered.
- **PASS:** `npm run measure:baseline` — critical path **54.9 kB gzip**, three
  files, **73.7 kB / 57.3% smaller** than the committed baseline. All assets:
  144.4 kB gzip; optional dashboard/terms CSS remains lazy.
- **PASS:** `npm run bench` — shipping high-tier field simulation median
  0.0236 ms/frame (minimum 0.0227 ms); the spatial-hash implementation was
  3.33× faster than the legacy minimum in the final run’s benchmark headline.
- **PASS:** `git diff --check`; no stale `escrowEngine` references remain in
  active source or current documentation. The production build emits a separate
  3.3 kB raw dashboard/terms stylesheet, so the new workspace does not inflate
  the first-paint CSS.
- The CSP contract caught the changed JSON-LD body after the truth-copy edit;
  its exact SHA-256 source hash was regenerated and the contract now passes.

## Decisions

- Preserved the app’s distinctive rendezvous field rather than adding a 3D
  framework: the existing two-draw-call renderer already has an adaptive
  quality governor, typed-array simulation and a static fallback.
- Did not fabricate booking availability or a Cal.com replacement URL.
- Did not make terms persistent: durable agreements, signatures, escrow and
  financial/legal meaning need explicit product, backend and authorization
  design, which are out of scope for a static client-side draft.

---

## Prior session record (verbatim, 2026-10-02)

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
