# Pages Showcase — Design

**Date:** 2026-06-27
**Branch:** `feat/expression-studio` (no merge — part of the larger arc; repo cut is last)
**Status:** design approved (user delegated decisions: "use best practices")

## Goal

Publish the expression studio + board + landing page as a **read-only, statically
hosted portfolio surface** on GitHub Pages — the shareable face of the project — with
zero backend. Every write-feature (manifest edit, expression save, approve toggle)
gracefully degrades to browse-only because there is no engine on a static host.

## Why this is mostly packaging, not new code

The studio is already static-host-ready by construction:

- All cross-page links are **relative** (`../shared/`, `./gallery-data.json`,
  studio-nav, edit links), so the subtree survives project-pages subpath hosting
  (`user.github.io/<repo>/`).
- Every write affordance is gated behind an engine probe (`GET /api/manifest` /
  `GET /api/framebuffer`) that **fails closed** on 404 → read-only. The Gallery,
  board ambient cycle, and desk companion render purely client-side off the
  committed `studio/gallery-data.json`.

So the deliverable is: assemble the right subtree, close one remaining dead-end
affordance, and wire a deploy workflow.

## Architecture

### 1. Bundle assembly — `scripts/build-pages.mjs` → `pages-dist/` (gitignored)

A pure "copy + a couple of generated files" build, mirroring how the project is
previewed locally (`python -m http.server` from repo root):

- `pages-dist/studio/`  ← copy of `studio/` (pages, `gallery.js`, `gallery-data.json`, nav, board)
- `pages-dist/shared/`  ← copy of `shared/` (the render core the studio + landing import via `../shared/`)
- `pages-dist/index.html` ← copy of `site/index.html` with its handful of
  `../studio/` → `studio/` and `../shared/` → `shared/` references rewritten, so the
  **landing is the clean root** (no redirect, no `/site/` in the URL). The landing
  is otherwise self-contained (inline CSS, data-URI favicon, CDN fonts).
- `pages-dist/.nojekyll` ← empty file; disables GitHub's Jekyll processing so no
  file/dir is silently dropped or transformed.
- Idempotent: wipe `pages-dist/` at the start of each run.

`studio/` files keep their `../shared/` imports untouched (they resolve because
`shared/` is a sibling under `pages-dist/`). Only the landing — the one file that
*moves up a level* (from `site/` to root) — gets its paths rewritten.

**Rewrite safety:** a global replace of `../studio/` → `studio/` and `../shared/` →
`shared/`, verified by a test asserting the emitted root `index.html` contains no
remaining `../studio` or `../shared` and still references `studio/` and `shared/`.

### 2. Read-only honesty — gate the ✎ edit link (`studio/gallery.js`)

Today the ✎ edit link renders whenever `source === "saved"`, regardless of engine,
and deep-links to the frame-editor (which itself boots read-only). On a static
deploy that's a dead-end affordance. Gate it on the existing `canApprove`
(the `/api/manifest` probe) so it only appears when an engine is present — identical
treatment to the approve toggle. With no engine the Gallery is purely browse.

(The frame-editor's read-only mode still exists for anyone who deep-links a
`?name=` URL directly — we simply don't advertise it from the Gallery.)

### 3. Deploy workflow — `.github/workflows/pages.yml`

- **Triggers:** `push` to `feat/expression-studio` **and** `master` (so it keeps
  working after the eventual merge), plus `workflow_dispatch` for manual runs.
- **Permissions:** `pages: write`, `id-token: write`. Concurrency group `pages`
  (cancel-in-progress false) per the official Pages action guidance.
- **Job steps:** `actions/checkout` → `actions/setup-node` → `node
  scripts/build-pages.mjs` → `actions/configure-pages` → `actions/upload-pages-artifact`
  (`path: pages-dist`) → `actions/deploy-pages`.
- **One-time repo setting (documented, not automated):** Settings → Pages →
  Source = "GitHub Actions".

### 4. Docs

Extend `site/README.md` with a "Deploying the full studio to Pages" section: the
workflow, the one-time Pages source setting, and the resulting URL shape
(`https://<user>.github.io/<repo>/` → landing, `/studio/` → Gallery, `/studio/board.html`).

## Testing

- **Unit (`scripts/build-pages.test.js`, `node --test`):** run the build into a
  temp dir; assert the tree shape (`index.html`, `studio/gallery.js`,
  `studio/gallery-data.json`, `shared/render.js`, `.nojekyll` all present); assert
  the root `index.html` has no `../studio`/`../shared` and does reference
  `studio/`/`shared/`; assert a copied studio file still references `../shared/`.
- **Gallery gate (`studio/*.test.js` or DOM smoke):** with no engine, the ✎ edit
  link and approve toggle are absent; with an engine present, both appear. (Pure
  predicate extracted if needed for unit testing.)
- **Local smoke (manual/Playwright, controller-run during execution):** serve
  `pages-dist/` on a throwaway port, load `studio/index.html` + `board.html`,
  confirm the Gallery renders, the board cycles, and **no** edit/approve
  affordances appear — read-only proof. (Throwaway port — never touch the user's
  engine on 8787.)

## Out of scope (YAGNI)

- Custom domain / CNAME, analytics, SEO meta beyond what the landing already has.
- Any engine emulation on Pages — the site is read-only by design; the engine is local-only.
- Touching `mcp_server/`, firmware, or `release/` — none are part of the public face.

## Constraints carried from the project

- Stays on `feat/expression-studio`; **no merge** (repo cut is the final step of the arc).
- `pages-dist/` is build output — **gitignored**, never committed (avoids the
  committed-generated-tree drift class of bug).
- Never use the maintainer's real name in any emitted file.
