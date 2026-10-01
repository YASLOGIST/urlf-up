# `archive/` — nothing is deleted, only quarantined

Every file in this directory was **removed from the live application** during the
2026-10 reverse-engineering + upgrade pass. Nothing was deleted; everything is
recoverable with `git mv` or a plain copy.

| Folder | What is in it | Evidence it was dead |
| --- | --- | --- |
| `legacy-html/` | `index.html.bak` (142 KB), `index.html.bak.1779247551` (756 KB) | Not referenced by `vite.config.js`, not an entry point, never served. 898 KB of repo weight. |
| `legacy-src/` | `*.bak.20260520` copies of `animations/cursor/main/render`, `extract.js` | Byte-for-byte superseded copies; `extract.js` was a one-shot scaffolding script. |
| `legacy-reports/` | `OPTIMIZATION_REPORT.md`, `DOM_SANITIZATION_REPORT.md`, `SPRINT-1-FOUNDATION-LOCK.md` | Point-in-time reports with self-declared *analytical* (unmeasured) numbers. Superseded by `docs/VERIFICATION.md`, which contains measured numbers. |
| `unused-3d/` | `ur-life-app.js` (44 KB three.js scene), `Earth3D.tsx`, `EarthScene.tsx`, `EarthScene.css` | `grep -rn "ur-life-app\|EarthScene" src index.html` → 0 importers. React / `@react-three/fiber` / `@react-three/drei` / `three` / `gsap` / `lenis` were in `package.json` **only** for these orphans. |
| `legacy-pwa/` | the root `manifest.json` and the original 2-line `sw.js` | The manifest pointed at placeholder CDN icons and was duplicated at `public/manifest.json`. The worker was `caches.addAll(['./','./manifest.json'])` plus an unconditional `caches.match(req) \|\| fetch(req)` — cache-first on the *navigation* request with no versioning and no revalidation, so the first `index.html` a visitor received was the one they kept forever. Because Vite hash-names its chunks, that stale shell referenced assets that no longer exist: a permanently blank page fixable only by a manual cache purge. Replaced by `public/manifest.webmanifest` and a versioned, strategy-based `public/sw.js`. |
| `legacy-html/` (second wave) | `dashboard.html`, `submit-idea.html` | Orphan prototypes; nothing linked to either. `dashboard.html` was a 25-line "Awaiting Execution Protocols" placeholder. `submit-idea.html` carried a second, incompatible design system (`--void:#02040A`, Newsreader) plus a 10.8 kB inline `<style>` and a submit handler whose only action was `console.log`. |
| `legacy-reports/README-manifesto.md` | the previous root `README.md` | Described a different product — a "$100M sovereignty operating system delivered through a 3D WebGL ceremony" — matching neither the shipped markup nor `nexus-schema.sql`. Replaced by an honest `README.md`. |
| `unused-templates/` | 12 template-string section components (`Header.js` … `Footer.js`) | They are rendered by `renderApp()` into `#app`. `#app` does not exist in `index.html` (`grep -c 'id="app"' index.html` → `0`), and `renderApp()` has no callers. The real markup is static in `index.html`. |

## Restoring something

```bash
git mv archive/unused-3d/ur-life-app.js src/ur-life-app.js
npm i three gsap          # the deps were removed from package.json
```

## Why the 3D was not simply re-enabled

The archived 3D stack pulled in `react` + `react-dom` + `@react-three/fiber` +
`@react-three/drei` + `three` (~1.1 MB of `node_modules` deps, ~450 KB of
shipped JS) into an application that contains **zero** other React code. The
upgrade replaces it with `src/visual/field.js`: a dependency-free WebGL2
renderer with a 2D-canvas fallback and a static fallback, measured in
`docs/VERIFICATION.md`.
