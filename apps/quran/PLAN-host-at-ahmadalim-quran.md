# Host the 3D Qur'an app at ahmadalim.com/quran

> **Status (2026-09-25):** Plan only. Nothing has been changed yet in either project.
> To resume: open Claude Code in `/Users/alimakhsan/app/quran` and say
> "implement PLAN-host-at-ahmadalim-quran.md".

## Context

The goal is to serve the Vite + Three.js Qur'an app (`/Users/alimakhsan/app/quran`,
package `quran-3d`) at **ahmadalim.com/quran**, in the **same GitHub repo** as the
ahmadalim.com portfolio.

Two assumptions in the original request turned out to be wrong, and both make the work simpler:

- **ahmadalim.com is NOT Astro.** It is a hand-written static site with no dependencies
  (`github.com/alimakhsan/portfolio-letters`), auto-deployed on **Netlify** with
  `publish = "."` and an **empty build command**, so the repo root is the web root.
  No framework migration is needed. Any folder added to the repo is served at that path
  (the existing `case-studies/<name>/index.html` → `/case-studies/<name>/` pattern already
  shows subpaths work).
- **The Qur'an app has no backend and no URL routing.** It's a static single-page app. All
  data comes from external APIs that need no keys and allow cross-origin requests
  (quran.com, qurancdn, tarteel.ai). So it needs no server, no env vars and **no SPA rewrite rules**.

**Chosen approach: Netlify builds the app from source.** The Qur'an source moves into the
portfolio repo, and Netlify runs the Vite build on each push and puts the output in
`/quran/`. This fits the Netlify free tier easily (about 1–2 build minutes per deploy,
out of 300 per month).

Local folders:
- Qur'an source: `/Users/alimakhsan/app/quran` (not a git repo yet)
- Portfolio repo: `/Users/alimakhsan/Playground/portfolio`

---

## Changes

### 1. Make the Qur'an app work under a subpath (edit in `/Users/alimakhsan/app/quran` first)

The build currently emits **root-absolute** asset URLs (`/assets/...`), which return 404
under `/quran/`.

**a. Add `vite.config.js`** (new file) at the app root:
```js
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/quran/',
  build: {
    outDir: '../../quran',   // relative to apps/quran/ after the move (step 3)
    emptyOutDir: true,
  },
})
```
`base: '/quran/'` fixes the bundled JS/CSS URLs. `outDir` sends the build output to the
repo-root `quran/` folder so Netlify serves it at `/quran/`.
(Use `outDir: 'dist'` for local testing before the move, then switch to `'../../quran'`
once the source lives at `apps/quran/`.)

**b. Fix two hardcoded root-absolute paths that Vite's `base` does NOT rewrite:**
- `src/pageRenderer.js:309`: change `img.src = '/sura-border.svg';` to
  `img.src = import.meta.env.BASE_URL + 'sura-border.svg';`
- `src/style.css:3`: Vite leaves `@font-face url("/fonts/UthmanicHafs.woff2")` unchanged.
  Cleanest fix: **move the local woff2 files** (`public/fonts/UthmanicHafs.woff2`, plus
  `IndoPakNastaleeq.woff2` if something references it) into `src/fonts/` and reference them
  **relatively** (`url("./fonts/UthmanicHafs.woff2")`). Vite then fingerprints them and
  applies the base path. Delete the unused `public/fonts/` copies afterwards.
  (Simpler alternative: hardcode `url("/quran/fonts/UthmanicHafs.woff2")`.)

**c. Search for any other root-absolute local references** before building. Check `src/`
and `index.html` for paths such as `/fonts/`, `/sura-border.svg` or any other local asset
starting with `/`, and fix them the same way. External `https://` URLs are fine; step 4
allows them in the CSP.

### 2. Verify the build locally (before touching the portfolio repo)

Run `npm ci && npm run build && npm run preview`, then open the preview's `/quran/` URL.
Check that JS/CSS load with no 404s, the sura-border SVG and fallback font load, pages
render, and recitation audio plays.

### 3. Move the Qur'an source into the portfolio repo

Copy the app **source** to `/Users/alimakhsan/Playground/portfolio/apps/quran/`, leaving
out `node_modules/` and `dist/`.
- With the source at `apps/quran/`, `outDir: '../../quran'` writes the build to the repo-root `quran/`.
- Add to the portfolio `.gitignore`: `apps/quran/node_modules`, `apps/quran/dist` and
  `/quran/`. Netlify regenerates the build output on every deploy, so don't commit it.

### 4. Update Netlify config in the portfolio repo

**`netlify.toml`**
```toml
[build]
  publish = "."
  command = "cd apps/quran && npm ci && npm run build"

[build.environment]
  NODE_VERSION = "20"
```
`publish = "."` stays the same, so the root site is still served as-is. Vite 6 needs
Node 18 or newer.

**`_headers`**: the global `/*` Content-Security-Policy (CSP) only allows the site's own
origin (`default-src 'self'`, `connect-src 'self'`), so it would **block** the app's
external APIs, fonts and audio. Add a `/quran/*` block. On Netlify, the most specific path
wins for a given header, so this block overrides the global one only on `/quran/*`:
```
/quran/*
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com https://static-cdn.tarteel.ai; script-src 'self' 'unsafe-inline'; connect-src 'self' https://api.quran.com https://api.qurancdn.com https://static-cdn.tarteel.ai https://verses.quran.com; media-src 'self' https://verses.quran.com; worker-src 'self' blob:
```
Origins added compared with the global policy:
- `api.quran.com` and `api.qurancdn.com`: verse and page-layout data
- `static-cdn.tarteel.ai`: per-page mushaf fonts
- `verses.quran.com`: recitation audio (`media-src`)
- `blob:` and `worker-src`: Three.js

During the deploy-preview check (Verification step 4), fine-tune this list from the
browser console's CSP error messages.

**`_redirects`**: no change. The existing rules only match `/work` and `/case-studies/*`.
The app has no client-side routing, so it doesn't need a fallback rule.

### 5. (Optional) Link to the app from the portfolio

Add a link to `/quran` in the portfolio `index.html` so visitors can find the app.

---

## Verification

1. **Local build:** in `apps/quran/`, run `npm ci && npm run build`. Check that the output
   lands in the repo-root `quran/` and that `quran/index.html` references `/quran/assets/...`.
2. **Local serve of the repo root** (this mimics Netlify's publish=`.`): in the portfolio
   repo, run `python3 -m http.server 8000` and open `http://localhost:8000/quran/`. This
   server doesn't enforce the CSP, so step 4 is still needed.
3. **Netlify Deploy Preview:** push a branch or open a PR. Check that the build succeeds and
   that `/quran/` loads on the preview URL.
4. **CSP check:** open DevTools on `/quran/` in the preview. There should be **zero** CSP
   errors. If any appear, add the blocked origin to the matching part of the `/quran/*` rule.
5. **Regression check:** confirm `/`, the `/case-studies/*` redirects and the vanity
   redirects still work.
6. **Merge to `main`.** Netlify deploys to production; check `https://ahmadalim.com/quran`.

---

## Files touched

- **New:** `apps/quran/vite.config.js`
- **Edited (Qur'an source):** `src/pageRenderer.js` (~line 309), `src/style.css` (line 3),
  plus the local fonts moved into `src/fonts/`
- **Moved:** `/Users/alimakhsan/app/quran/*` → `portfolio/apps/quran/`
- **Edited (portfolio):** `netlify.toml`, `_headers`, `.gitignore`
- **Unchanged:** `_redirects`, portfolio `index.html` (unless you add the optional link)
