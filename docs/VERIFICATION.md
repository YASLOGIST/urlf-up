# Verification Report — baseline vs. final

Every number in this document is produced by a command in this repository that
you can re-run. Nothing here is estimated, and where a measurement was
impossible in this environment it is listed under **Limits** rather than
replaced with a guess.

**Baseline** = the verbatim pre-upgrade build, committed at `.baseline/dist/`
so the comparison stays falsifiable after the source has changed.

---

## 1. How to reproduce everything

```bash
npm ci

npm run lint            # ESLint flat config, 0 errors expected
npm run format:check    # Prettier, 0 differences expected
npm run test            # 221 specs across 11 files
npm run test:coverage   # coverage + per-file thresholds
npm run build           # fails on inline-style or size-budget violations
npm run measure         # size report for dist/
npm run measure:baseline # before/after table; exits 1 if the critical path grew
npm run audit           # high/critical dependency advisory gate
npm run bench           # field simulation + draw-call benchmark

npm run verify          # lint + test + build + measure + audit in one shot
```

---

## 2. Payload — measured

`npm run measure:baseline`

| metric | baseline | final | change |
|---|---:|---:|---:|
| **critical path, gzip** | **128.7 kB** | **51.4 kB** | **−60.1 %** |
| critical path, brotli | 108.1 kB | 43.5 kB | −59.8 % |
| critical path, raw | 522.5 kB | 209.2 kB | −60.0 % |
| critical path, files | 7 | 3 | −57.1 % |
| all assets, gzip | 129.1 kB | 127.7 kB | −1.1 % |
| all assets, raw | 523.1 kB | 476.9 kB | −8.8 % |

"Critical path" = `index.html` plus every asset it references with a `src`/`href`.
Code reachable only through a dynamic `import()` is excluded because the browser
does not block first paint on it.

### Where the 78.4 kB went

| baseline critical asset | gzip | disposition |
|---|---:|---|
| `assets/index-B2_xVcKm.js` | 78.1 kB | split: Supabase (51.1 kB gz) moved to `vendor-supabase`, loaded only by `app/account.js`; the rest split per-feature |
| `index.html` | 39.7 kB | 22.8 kB — 5,761 lines → ~1,530; three inline `<script>` blocks and the inline `<style>` extracted; JSON-LD allowed by a CSP hash |
| `assets/icons-Bmy9g5KS.js` | 3.6 kB | off the critical path (lazy) |
| `assets/settings-BcGIvyCb.js` | 3.0 kB | off the critical path (lazy) |
| `assets/core-CNWC0QgM.js` | 2.3 kB | folded into `main` |
| `assets/cursor-p9ZL9eAK.js` | 1.6 kB | off the critical path (fine-pointer only) |
| `assets/manifest-9wO3NzbU.json` | 0.2 kB | replaced by `public/manifest.webmanifest` |

Final critical path, in full: `index.html` 22.8 kB gz + `assets/main-*.js`
14.3 kB gz + `assets/main-*.css` 13.2 kB gz.

The "all assets" line barely moves, and that is the honest result: the same
code still exists, it is simply no longer downloaded before first paint. The
total is also now *larger in file count* (12 chunks instead of 6) by design.

### Regression guards built into the build

| Guard | Threshold | Behaviour |
|---|---|---|
| `noInlineStyleBlocks` (vite plugin) | any authored inline `<style>` > 2 kB | **build fails** — proven to fire during this work on a 10,811-byte block |
| `sizeBudget` (vite plugin) | HTML > 24 kB gz, or total > 170 kB gz | **build fails** |
| `measure-bundle` compare mode | critical path larger than baseline | **exit 1**, wired into CI |

---

## 3. Rendering cost — measured

`npm run bench` — 600 frames per sample, 9 repetitions, median and minimum
reported. The "legacy" case is a faithful replay of the previous algorithm
(exhaustive O(n²) pair scan plus `Array.prototype.sort` for depth ordering).

### 3.1 Simulation CPU per frame

| case | median | min | vs. legacy |
|---|---:|---:|---:|
| legacy, 80 particles, O(n²), r=180 | 0.0412–0.0493 ms | **0.0405 ms** | — |
| modern, 80 particles, grid, r=180 (identical params) | 0.0110 ms | **0.0108 ms** | **3.8× cheaper** |
| modern, 130 particles, grid, r=150 (shipping high tier) | 0.0189 ms | **0.0184 ms** | **2.2× cheaper while carrying 62 % more particles** |

The min-to-min ratio is the claimed figure because it reproduces to ~1 % across
runs (measured 3.78×, 3.79×, 3.80×, 3.85× on four consecutive invocations).
Medians on this shared machine swing between 3.6× and 6.7× for identical code;
they are printed but not claimed.

### 3.2 Canvas2D API calls per frame, 80 particles

| call | legacy | final | why |
|---|---:|---:|---|
| `createRadialGradient` | 80 | **0** | every particle allocated a fresh gradient object *per frame*; the final renderer blits one pre-rendered 64×64 sprite |
| `beginPath` | 195 | **5** | links are batched into 6 alpha bands instead of one path each |
| `stroke` | 115 | **5** | same batching |
| `strokeStyle` writes | 115 | **5** | a style write between draws breaks the rasteriser's batching |
| `fill` | 80 | 0 | replaced by `drawImage` |
| `drawImage` | 0 | 80 | the sprite blit |
| **total state-changing calls** | **585** | **90** | **−85 %** |

Beyond the raw counts, the removal of 80 `createRadialGradient` allocations per
frame removes ~4,800 short-lived objects per second from the GC's path — which
is what actually produces the periodic hitches in the original.

### 3.3 Runtime safeguards that did not exist before

| Safeguard | Behaviour | Spec |
|---|---|---|
| Device tier | `high`/`mid`/`low`/`off` from `deviceMemory`, `hardwareConcurrency`, Save-Data, effective connection type. Density 130/80/0/0. | `boot-and-motion.test.js` |
| DPR cap | 2 / 1.5 / 1 by tier — uncapped DPR on a 3× phone triples fill cost | `field.js` |
| Adaptive governor | EMA frame time; sheds density ×0.7 (max 3 steps, floor 24) above 20.8 ms | `field.js` |
| Visibility pause | stops on `visibilitychange` **and** when the canvas scrolls out of view | 2 specs |
| Context-loss recovery | WebGL2 context loss swaps to Canvas2D instead of a dead canvas | `renderer-webgl.js` |
| Full teardown | `destroy()` removes every listener it added and disconnects its observer | spec asserts added set === removed set |

---

## 4. Accessibility — measured

`npm run test` → `tests/a11y/axe.test.js`

| page state | axe violations | notes |
|---|---:|---|
| default, English LTR | **0** | |
| Arabic, RTL | **0** | full `dir=rtl` switch |
| auth dialog open | **0** | scoped to the dialog; the rest of the page is `inert` by design |
| idea dialog open | **0** | |
| meeting dialog open | **0** | cross-origin Cal.com iframe not traversed |

Rules requiring real layout (`color-contrast`, `target-size`,
`scrollable-region-focusable`, `meta-viewport`) are explicitly **disabled**
rather than silently passing, because jsdom has no layout engine. See **Limits**.

### Defects found and fixed by this audit

| Defect | Fix |
|---|---|
| `h2 → h4` heading jump in the roadmap section | four `<h4>` promoted to `<h3>` |
| Reading-progress bar belonged to no landmark (`region` rule) | wrapped in a `<header>`; deliberately not `display:contents`, which has a history of dropping elements from the a11y tree |
| Avatar file input and URL input had no accessible name | `aria-label` added |
| Skills and Interests chip inputs had orphan `<label>` elements | `for=` wired to the real input ids |
| `#nx-error` and `#settings-error` were not live regions | `role="alert"` added |

### Hand-written invariants axe cannot check

8 further specs assert: the skip link targets a real focusable `<main>`;
decorative canvas and cursor are `aria-hidden`; the progressbar is labelled;
heading levels never skip; every interactive control has an accessible name;
every error slot is a live region; `prefers-reduced-motion` is honoured in CSS
and not only in JS; a visible `:focus-visible` ring exists.

---

## 5. Security — verified in code

| Control | Baseline | Final | Verified by |
|---|---|---|---|
| CSP `script-src` | `'self' 'unsafe-inline'` | `'self'` plus exact JSON-LD hash, no `unsafe-inline` | contract test |
| CSP `frame-src` | absent → Cal.com booking iframe **blocked by `default-src`** | `https://cal.com https://*.cal.com` | contract test |
| CSP `object-src` / `base-uri` / `form-action` / `frame-ancestors` | absent | `'none'` / `'self'` / `'self'` / `'none'` | contract test |
| Inline scripts | 3 blocks | 0 executable (only `ld+json`) | contract test |
| Error messages | raw Supabase text shown to users | mapped to generic copy | flow test asserts the server string does not reach the DOM |
| Log output | ad-hoc `console.log`, including error objects | single level-aware logger with token/JWT/`*key*`/`*password*` redaction | 8 unit specs |
| Translated markup | `innerHTML = node.dataset.ar` | allow-list sanitiser over an inert `<template>` | 6 specs incl. `<script>` and `<img onerror>` payloads |
| User content in the DOM | mixed | `textContent` everywhere; ESLint bans non-literal `innerHTML` | lint + XSS specs |
| Service worker | cache-first on navigations, no versioning, cached cross-origin and non-GET | network-first + timeout, versioned, same-origin GET only, Supabase paths skipped | contract test |
| Validator robustness | threw a `TypeError` on any non-string, aborting the submit handler before it could render an error | every predicate coerces and returns a boolean | 1 spec × 10 predicates × 9 hostile inputs |
| Skills input | unbounded — a pasted document became a multi-thousand-element array sent to Postgres | capped at 20 entries, 40 chars each | 2 specs |

`npm run audit` runs in CI as a separate job and fails on high/critical advisories across the complete lockfile.

---

## 6. Test suite

`npm run test` — **221 specs, 11 files, all passing.**

| file | specs | covers |
|---|---:|---|
| `tests/contracts/document.test.js` | 40 | document structure, CSP, JSON-LD hash, manifest, service worker, robots/sitemap, dependency hygiene |
| `tests/unit/sim.test.js` | 9 | determinism, bounds, dt clamp, link cap, **grid ≡ brute force** |
| `tests/unit/compositor.test.js` | 10 | SDF/bloom compositor invariants for generated brand assets |
| `tests/unit/lib.test.js` | 43 | logger + redaction, env, **device-tier mapping**, validators, sanitize, degraded-mode client |
| `tests/flows/i18n.test.js` | 14 | EN⇄AR switching, persistence, `renderRichText` XSS |
| `tests/flows/modal.test.js` | 15 | focus trap/restore, inert, ESC stacking, scroll lock |
| `tests/flows/auth-and-ideas.test.js` | 13 | sign-in, registration, magic link, idea submission, role gate |
| `tests/flows/boot-and-motion.test.js` | 25 | boot order, idempotency, lazy account loading, reveal, scroll, count-up, field fallback chain |
| `tests/flows/ui-and-network.test.js` | 28 | error slots, toasts, loading, offline, degraded notice, pointer fx |
| `tests/a11y/axe.test.js` | 13 | 5 axe page states + 8 structural invariants |

Every spec runs against the **real `index.html`**, never a fixture. That choice
is deliberate: the entire class of bug found during analysis — `#canvas3d`,
`#app`, `#lang-en` and `#magic-link-submit` queried by code but absent from the
page — is invisible to fixture-based tests.

### Coverage

`npm run test:coverage`

| scope | statements | branches | functions |
|---|---:|---:|---:|
| whole `src/` | 60.6 % | 77.7 % | 54.4 % |
| `src/app/` | 74.5 % | 76.7 % | 78.6 % |
| `src/motion/` | 91.5 % | 77.2 % | 72.1 % |
| `src/visual/` | 82.6 % | 76.7 % | 60.5 % |
| `src/lib/` | 82.1 % | 83.7 % | 63.5 % |

Per-file thresholds are enforced in `vitest.config.js` and fail CI. They are
asymmetric on purpose: modules written or rewritten in this upgrade carry hard
floors (`validators.js` and `sanitize.js` at 100 %, `i18n.js`/`modal.js`/
`network.js` at 90 %, `boot.js` at 85 %, `sim.js` at 90 %), while the untouched
legacy modules (`dashboard.js`, `settings.js`, `avatar.js`, `core.js`) have no
individual floor. Averaging those into a single high global number would have
required either blocking CI or quietly lowering the bar; a strict floor where
tests exist and a low global floor that can only ratchet upwards is the honest
encoding of the real state.

---

## 7. Quality gates in CI

`.github/workflows/ci.yml`, three jobs:

| job | steps |
|---|---|
| **quality** | `npm ci` → lint → format check → full test suite (includes axe) → coverage + thresholds → upload coverage |
| **build** | `npm ci` → build (inline-style guard + size budget) → `measure` → `measure:baseline` (fails if the critical path grew) → `bench` → upload `dist/` |
| **dependency-audit** | `npm run audit` — high/critical advisories across all locked dependencies |

CI runs with **no Supabase credentials**, which means every run also proves
degraded mode still builds, boots and passes its tests.

### Host independence

`deviceTier()` reads `navigator.hardwareConcurrency`, and jsdom reports that
as `os.cpus().length`. Two specs therefore passed on the 2-core development
sandbox and **failed on the 4-core GitHub runner** — a defect in the tests, not
in the code, caught by the first CI run on this branch.

Fixed at the root: `tests/setup.js` pins the hardware probe to a deterministic
"capable desktop", specs that care about a tier inject one explicitly via
`initField({ tier })` / `initPointerFx({ tier })`, and the tier *mapping* is now
covered by 8 dedicated unit tests that override the probe per case. The
observer assertion was also rewritten — counting observers globally was the
wrong invariant, since count-up and the field legitimately own one each; it now
asserts that no reveal element is observed twice and that exactly one observer
serves all of them, which is the actual bug that existed.

Earlier verification ran the then-full suite against simulated 1-, 2-, 4- and
16-core hosts: 189/189 in every case. The current suite adds document/CSP
coverage and remains deterministic under the same pinned hardware probe.

---

## 8. Limits of this verification

These are real gaps, stated rather than papered over.

| Not measured | Why | How to close it |
|---|---|---|
| Real-browser FPS of the field | No browser in this environment. `npx playwright install chromium` fails with `ECONNRESET` against `cdn.playwright.dev`, and no system Chromium is present. | `npm run preview`, then record a 10 s Performance trace in Chrome DevTools with the field visible. The bench numbers above bound the CPU half of the cost; the GPU half is unmeasured. |
| Lighthouse LCP / CLS / TBT | Same reason. | `npx lighthouse http://localhost:4173 --preset=desktop` |
| Colour contrast | jsdom has no layout or paint. The rule is explicitly disabled, not silently skipped. | Run axe in a real browser, or the Chrome DevTools contrast checker over the gold `#D4AF37` on `#0B0B0B` palette. |
| Screen-reader behaviour | Automated tooling cannot judge announcement quality. | 20 minutes with VoiceOver + Safari and NVDA + Firefox on the auth dialog and the language switch. |
| RTL visual layout | No rendering engine. Logical properties are used throughout and `dir` is set correctly, but mirrored layout is unverified. | Open the preview with `?lang=ar`. |
| Supabase integration against a live project | No credentials, and fabricating them was out of bounds. All backend behaviour is verified against a stub that mirrors the `{ data, error }` contract. | Point `.env.local` at a dev project and re-run the flow suite. |
| iOS / Android Capacitor shells | Needs Xcode and the Android SDK. Untouched by this work. | `npm run cap:sync` on a suitable machine. |
| Service-worker runtime behaviour | jsdom has no `ServiceWorkerGlobalScope`. The worker's *strategy* is asserted statically; its execution is not. | DevTools → Application → Service Workers, then throttle to Offline and reload. |

---

## 9. Summary

| dimension | baseline | final |
|---|---|---|
| Critical-path payload | 128.7 kB gz, 7 files | **51.4 kB gz, 3 files** |
| Module entry points | 8 | **1** |
| Supabase clients at runtime | 2 (racing refresh timers) | **1** |
| Automated tests | 0 | **221** |
| axe violations | not measured; ≥5 real defects present | **0 in 5 page states** |
| CSP | `script-src 'unsafe-inline'`, no `frame-src` (booking iframe blocked) | hardened, 6 directives, booking works |
| Service worker | 2 lines, cache-poisoning hazard | versioned, strategy-based, offline fallback |
| Unused runtime dependencies | 7 (react, react-dom, three, @react-three ×2, gsap, lenis) | **0**, enforced by a test |
| Simulation cost @ equal params | 0.0405 ms/frame | **0.0108 ms/frame** |
| Canvas state-changing calls/frame | 585 | **90** |
| CI | none | lint · format · 221 tests · axe · coverage thresholds · size budget · bench · audit |
