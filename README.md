# UrLife — Where Minds Meet

A single-page marketing site and member console for an Arab-world startup
studio. Visionaries submit ideas, Builders bring skills, Enablers bring
capital; an AI pre-brief and a 45-minute closed meeting decide what gets built.

Vanilla ES modules. No UI framework. Two runtime dependencies.

```
critical path   49.8 kB gzip  ·  3 files
tests           181 specs     ·  axe: 0 violations in 5 page states
build           Vite 6        ·  fails on inline styles or a blown size budget
```

> The previous README described a different product entirely — a "$100M
> sovereignty operating system delivered through a 3D WebGL ceremony" — which
> matched neither the shipped markup nor the database schema. It is preserved
> verbatim at `archive/legacy-reports/README-manifesto.md` rather than deleted.

---

## Quick start

```bash
npm ci
npm run dev        # http://localhost:5173
```

No `.env` is required. With no Supabase credentials the site runs in
**degraded mode**: everything renders, scrolls and animates; only the
authenticated flows report that they are unavailable. A development-only
banner names the missing variables.

To enable the backend:

```bash
cp .env.example .env.local   # then fill in VITE_SUPABASE_URL and ..._ANON_KEY
```

## Commands

| command | what it does |
|---|---|
| `npm run dev` | Vite dev server, bound to `0.0.0.0` |
| `npm run build` | production build; **fails** on an inline `<style>` over 2 kB or a blown size budget |
| `npm run preview` | serve `dist/` |
| `npm test` | 181 specs (unit, flow, contract, accessibility) |
| `npm run test:watch` | the same, in watch mode |
| `npm run test:coverage` | coverage with enforced per-file thresholds |
| `npm run lint` / `lint:fix` | ESLint flat config |
| `npm run format` / `format:check` | Prettier |
| `npm run measure` | raw/gzip/brotli report for `dist/`, split by critical path |
| `npm run measure:baseline` | before/after vs. the committed pre-upgrade build; **exits 1 if the critical path grew** |
| `npm run bench` | field simulation + Canvas2D draw-call benchmark |
| `npm run icons` | regenerate all PWA icons and the OG cover from code |
| `npm run verify` | lint + test + build + measure |
| `npm run cap:sync` / `cap:ios` / `cap:android` | Capacitor native shells |

## Project layout

```
index.html              the single document — no inline script, no large inline style
src/
  main.js               the only module entry point
  app/
    boot.js             one ordered, idempotent startup sequence
    i18n.js             sole owner of lang/dir; allow-list sanitiser for translations
    modal.js            dialog stack: focus trap, focus restore, inert, ESC, scroll lock
    account.js          ALL backend wiring — dynamically imported, never on first paint
    errors.js           global error reporting + per-step guard()
    network.js          online/offline, degraded-mode notice
    debug-overlay.js    ?debug=1 live field stats
  lib/
    env.js              the single reader of import.meta.env
    supabase.js         the single Supabase client (lazy) + degraded-mode stub
    logger.js           level-aware structured logging with token redaction
  motion/
    prefs.js            device tier, reduced motion, pointer capability
    reveal.js           one IntersectionObserver for every reveal
    scroll-fx.js        one passive scroll listener → --scroll-progress, parallax
    pointer-fx.js       one delegated, rAF-batched pointer handler
    countup.js          number animation
  visual/
    sim.js              DOM-free particle simulation (Float32Array, spatial hash)
    renderer-webgl.js   dependency-free WebGL2, 2 draw calls
    renderer-2d.js      Canvas2D sprite-blit fallback
    field.js            backend selection, frame governor, lifecycle
  styles/               legacy.css (frozen) + motion/components/a11y/index
  auth.js ideas.js dashboard.js settings.js ...  feature modules, all lazy
public/                 icons, manifest.webmanifest, sw.js, robots.txt, sitemap.xml
scripts/                icon generation, bundle measurement, benchmark
tests/                  unit · flows · contracts · a11y
docs/                   ARCHITECTURE.md · VERIFICATION.md · MIGRATIONS.md
archive/                superseded code and documents, kept for provenance
.baseline/dist/         the verbatim pre-upgrade build, for falsifiable comparisons
```

## Architecture in one paragraph

`index.html` loads exactly one module. `boot.js` runs a fixed sequence — error
reporting, network, i18n, dialogs, scroll/reveal/count-up, pointer effects,
ambient field — with each step wrapped so that a failure disables only that
subsystem. Nothing that touches the backend is in that graph: `account.js` and
the 51 kB Supabase client are imported on a magic-link callback, on the first
sign of CTA intent (with the click replayed once the real handler exists), or
when the browser goes idle, whichever comes first. The full reconstruction,
including Mermaid diagrams, the data model and a testable behavioural spec, is
in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Invariants

These are the rules that keep the codebase from regressing. Each one is
enforced mechanically, not by convention.

| Rule | Enforced by |
|---|---|
| One module entry point | contract test |
| No executable inline `<script>` | contract test + CSP without `unsafe-inline` |
| No inline `<style>` over 2 kB | Vite plugin — **build fails** |
| Critical path ≤ 24 kB gz HTML, ≤ 170 kB gz total | Vite plugin — **build fails** |
| Critical path never larger than the baseline | `measure:baseline` in CI |
| One Supabase client | global-keyed singleton + ESLint import ban |
| One owner of `lang`/`dir` | `i18n.js`; flow test |
| `console.*` only in `logger.js` | ESLint |
| No non-literal `innerHTML` | ESLint (one documented exemption, in the sanitiser) |
| Nothing imports `archive/` | ESLint |
| Every runtime dependency is actually imported | contract test |
| Zero axe violations | a11y suite in CI |

## Accessibility

Zero axe-core violations in five page states (English, Arabic/RTL, and each of
the three dialogs). Full keyboard support: skip link, focus trap with restore,
`inert` background, Escape closing only the topmost dialog, `role="alert"`
error slots wired to their fields with `aria-invalid` and `aria-describedby`.
`prefers-reduced-motion` is honoured in both CSS and JS — under it, the ambient
field does not start at all and a pure-CSS gradient is shown instead.

Known gaps (no browser available in the build environment): colour contrast,
real screen-reader announcement quality, and RTL visual layout are unverified.
They are listed with resolution steps in
[`docs/VERIFICATION.md`](docs/VERIFICATION.md) § Limits.

## Performance

| | baseline | now |
|---|---:|---:|
| critical path, gzip | 128.7 kB | **49.8 kB** (−61.3 %) |
| critical path, files | 7 | **3** |
| simulation, 80 particles, identical params | 0.0405 ms/frame | **0.0108 ms/frame** |
| Canvas2D state-changing calls / frame | 585 | **90** |

Re-derive any of these with `npm run measure:baseline` and `npm run bench`.

## Browser support

Requires `IntersectionObserver`, CSS custom properties, ES2022 modules and
`:focus-visible` — Chrome/Edge 111+, Firefox 113+, Safari 16.4+. WebGL2 is
optional; without it the field falls back to Canvas2D, and without that to a
static CSS gradient. Without JavaScript the page still renders its content:
`html` ships with `class="no-js"` and the reveal animations are opt-in.

## Security notes

- All credentials are `VITE_`-prefixed and therefore **public by construction**.
  Security rests on Postgres row-level security, which `nexus-schema.sql`
  both `ENABLE`s and `FORCE`s on `public.profiles`.
- The CSP forbids inline script, `object-src`, framing, and cross-origin form
  posts, and allows exactly one third-party frame origin (Cal.com).
- Supabase error text is never shown to users verbatim.
- The logger redacts anything shaped like a JWT, a Supabase key or a bearer
  token, and any value under a key matching `token|key|secret|password|authorization`.

## License

Proprietary — all rights reserved. Third-party dependencies retain their own
licenses; see `node_modules/*/LICENSE`. All brand imagery in `public/icons/` is
generated from code in `scripts/generate-icons.mjs`; no third-party artwork is
vendored.
