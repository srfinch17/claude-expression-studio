# Pages Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the studio + board + landing as a read-only static portfolio site on GitHub Pages, with a deploy workflow that runs from the feature branch now.

**Architecture:** A pure-node build script assembles a gitignored `pages-dist/` bundle that mirrors the repo-root dev layout (`studio/` + `shared/` as siblings) so every existing relative import resolves unchanged; only the landing (`site/index.html`) moves to the bundle root and has its `../studio/`/`../shared/` paths rewritten. A one-line Gallery change gates edit affordances behind the existing engine probe so the static site has no dead-end buttons. A GitHub Actions workflow builds and deploys the bundle.

**Tech Stack:** Node 20 built-ins (`node:fs` `cpSync`/`rmSync`, `node:path`, `node:url`), `node --test`, GitHub Actions (`actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`).

## Global Constraints

- All work stays on branch `feat/expression-studio` — **no merge** (the repo cut is the final step of the whole arc).
- `pages-dist/` is build output — **gitignored, never committed** (avoids the committed-generated-tree drift class of bug).
- The build script uses **only node built-ins** — no new dependencies, no `npm install` step in CI.
- The bundle **mirrors the repo-root layout**: `studio/` files keep their `../shared/` imports untouched; only the landing (which moves up a level) is rewritten.
- The static site is **read-only by design** — no engine emulation. Write affordances must be absent when no engine is present.
- Never use the maintainer's real name in any emitted file (refer to "the user").
- Spec: `docs/superpowers/specs/2026-06-27-pages-showcase-design.md`.

---

### Task 1: Bundle build script

**Files:**
- Create: `scripts/build-pages.mjs`
- Test: `scripts/build-pages.test.js`
- Modify: `.gitignore` (append `pages-dist/`)
- Modify: `package.json` (add `"build:pages"` script)

**Interfaces:**
- Produces:
  - `rewriteLandingPaths(html: string) -> string` — pure; replaces `../studio/`→`studio/` and `../shared/`→`shared/`.
  - `buildPages({ repoRoot?: string, outDir?: string }) -> string` — wipes `outDir`, copies `studio/` + `shared/` as siblings, writes the rewritten landing to `outDir/index.html`, writes `outDir/.nojekyll`; returns `outDir`. Defaults: `repoRoot` = repo root (one level up from `scripts/`), `outDir` = `<repoRoot>/pages-dist`.

- [ ] **Step 1: Write the failing test**

Create `scripts/build-pages.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { rewriteLandingPaths, buildPages } from "./build-pages.mjs";

test("rewriteLandingPaths strips ../ on sibling links", () => {
  const out = rewriteLandingPaths(
    `<a href="../studio/index.html">x</a><script>import "../shared/render.js";</script>`,
  );
  assert.ok(!out.includes("../studio"), "still has ../studio");
  assert.ok(!out.includes("../shared"), "still has ../shared");
  assert.ok(out.includes('href="studio/index.html"'));
  assert.ok(out.includes('"shared/render.js"'));
});

test("buildPages mirrors the dev tree into outDir", () => {
  const out = path.join(mkdtempSync(path.join(os.tmpdir(), "pages-")), "dist");
  try {
    const ret = buildPages({ outDir: out });
    assert.equal(ret, out);
    for (const f of [
      "index.html",
      "studio/gallery.js",
      "studio/gallery-data.json",
      "studio/board.html",
      "shared/render.js",
      ".nojekyll",
    ]) {
      assert.ok(existsSync(path.join(out, f)), `missing ${f}`);
    }
    // landing at root: sibling paths rewritten
    const root = readFileSync(path.join(out, "index.html"), "utf8");
    assert.ok(!root.includes("../studio"), "root index still has ../studio");
    assert.ok(!root.includes("../shared"), "root index still has ../shared");
    // studio file keeps its own sibling import untouched
    assert.ok(
      readFileSync(path.join(out, "studio/gallery.js"), "utf8").includes("../shared/"),
      "studio import was wrongly rewritten",
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/build-pages.test.js`
Expected: FAIL — `Cannot find module './build-pages.mjs'` (file not created yet).

- [ ] **Step 3: Write the implementation**

Create `scripts/build-pages.mjs`:

```js
// scripts/build-pages.mjs — assemble the read-only static showcase bundle for GitHub Pages.
// Mirrors the repo-root dev layout (studio/ + shared/ as siblings) so every relative import the
// studio + landing already use (`../shared/`, `./gallery-data.json`) resolves unchanged. Only the
// landing moves up a level (site/index.html -> bundle root), so only its `../studio/` and
// `../shared/` references are rewritten. Pure node built-ins; no dependencies.
import { rmSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Pure: rewrite the landing's sibling-relative links for life at the bundle root.
// site/index.html lives in site/, so it references ../studio/ and ../shared/. At the
// bundle root those are simply studio/ and shared/.
export function rewriteLandingPaths(html) {
  return html.replaceAll("../studio/", "studio/").replaceAll("../shared/", "shared/");
}

export function buildPages({ repoRoot = REPO_ROOT, outDir = path.join(REPO_ROOT, "pages-dist") } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // 1. studio/ and shared/ copied as siblings (preserve the dev layout so ../shared resolves)
  cpSync(path.join(repoRoot, "studio"), path.join(outDir, "studio"), { recursive: true });
  cpSync(path.join(repoRoot, "shared"), path.join(outDir, "shared"), { recursive: true });

  // 2. landing at the clean bundle root, its sibling paths rewritten
  const landing = readFileSync(path.join(repoRoot, "site", "index.html"), "utf8");
  writeFileSync(path.join(outDir, "index.html"), rewriteLandingPaths(landing), "utf8");

  // 3. disable Jekyll so no file/dir is silently dropped or transformed
  writeFileSync(path.join(outDir, ".nojekyll"), "", "utf8");

  return outDir;
}

// CLI entry — guarded so importing this module in a test does not run the build.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = buildPages();
  console.log(`pages bundle written to ${out}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/build-pages.test.js`
Expected: PASS — both tests green.

- [ ] **Step 5: Add gitignore entry + npm script**

Append to `.gitignore` (after the existing `mcp_server/.engine-url` line):

```
# Generated: read-only static showcase bundle for GitHub Pages (scripts/build-pages.mjs)
pages-dist/
```

In `package.json`, add this line to `"scripts"` immediately after the `"build:gallery"` entry:

```json
    "build:pages": "node scripts/build-pages.mjs",
```

- [ ] **Step 6: Verify the CLI runs and the bundle is ignored**

Run: `node scripts/build-pages.mjs && git status --porcelain pages-dist`
Expected: prints `pages bundle written to .../pages-dist`, and `git status` shows **no** `pages-dist` entries (gitignored). Then run `node --test scripts/build-pages.test.js` once more — still PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-pages.mjs scripts/build-pages.test.js .gitignore package.json
git commit -m "feat(pages): build-pages.mjs assembles the read-only static showcase bundle"
```

---

### Task 2: Gate Gallery edit affordances behind the engine probe

**Files:**
- Modify: `studio/gallery.js`
- Test: `studio/gallery.test.js`

**Why:** On a static host there is no engine, so the ✎ edit link is a dead-end (it deep-links to the frame-editor, which boots read-only). The approve toggle is already gated on the `canApprove` engine probe; gate the edit link the same way so the static Gallery is purely browse. This also requires making `gallery.js` import-safe in node (move the module-scope `matchMedia` call into `build()` and guard the auto-run) so the predicate can be unit-tested.

**Interfaces:**
- Produces: `showEditAffordances(editable: boolean, hasEngine: boolean) -> boolean` — exported pure predicate; `true` only when both are true. Drives both the edit link and the approve toggle in `cell()`.

- [ ] **Step 1: Write the failing test**

Create `studio/gallery.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { showEditAffordances } from "./gallery.js";

test("edit affordances require a saved expression AND a live engine", () => {
  assert.equal(showEditAffordances(true, true), true);
  assert.equal(showEditAffordances(true, false), false); // no engine -> read-only
  assert.equal(showEditAffordances(false, true), false); // not a saved expression
  assert.equal(showEditAffordances(false, false), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test studio/gallery.test.js`
Expected: FAIL — importing `./gallery.js` throws `ReferenceError: matchMedia is not defined` (module-scope call at the top) OR `showEditAffordances is not a function`. Either failure confirms the test runs against the unmodified module.

- [ ] **Step 3: Make the module import-safe and add the predicate**

In `studio/gallery.js`, **remove** the module-scope line (currently line 5):

```js
const REDUCE = matchMedia("(prefers-reduced-motion:reduce)").matches;
```

Add the exported predicate near the other top-level helpers (e.g. directly above `function cell(...)`):

```js
// Edit affordances (✎ edit link, approve toggle) require BOTH a saved expression and a live
// engine to write through. On a static host (no engine) the Gallery is purely browse.
export function showEditAffordances(editable, hasEngine) {
  return editable && hasEngine;
}
```

- [ ] **Step 4: Gate both affordances in `cell()`**

In `cell(grid, name, desc, group, approved, editable, canApprove)`, replace the edit-link and approve-toggle blocks. The current code is:

```js
  if (editable) { const ed = document.createElement("a"); ed.className = "editlink"; ed.href = `./frame-editor.html?name=${encodeURIComponent(name)}`;
    ed.textContent = "✎ edit"; ed.title = "Edit this expression"; el.appendChild(ed); }
  if (editable && canApprove) {
```

Change it to compute the gate once and use it for both:

```js
  const showEdits = showEditAffordances(editable, canApprove);
  if (showEdits) { const ed = document.createElement("a"); ed.className = "editlink"; ed.href = `./frame-editor.html?name=${encodeURIComponent(name)}`;
    ed.textContent = "✎ edit"; ed.title = "Edit this expression"; el.appendChild(ed); }
  if (showEdits) {
```

(Only those two lines change — the body of the approve-toggle block below it is untouched.)

- [ ] **Step 5: Restore reduced-motion inside `build()` and guard the auto-run**

In `build()`, the rAF loop currently reads `if (!REDUCE) { ... }`. Add the `REDUCE` definition at the top of that block, so it reads:

```js
  const REDUCE = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion:reduce)").matches;
  if (!REDUCE) {
```

At the very bottom of the file, change the bare auto-run:

```js
build();
```

to a DOM guard so a node import does not execute it:

```js
if (typeof document !== "undefined") build();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test studio/gallery.test.js`
Expected: PASS — module imports cleanly, predicate truth table holds.

- [ ] **Step 7: Commit**

```bash
git add studio/gallery.js studio/gallery.test.js
git commit -m "feat(pages): gate Gallery edit link behind the engine probe (read-only on static)"
```

---

### Task 3: Deploy workflow + docs + full-bundle verification

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `site/README.md` (append a "Deploying the full studio to Pages" section)

**Interfaces:**
- Consumes: `scripts/build-pages.mjs` (Task 1) — the workflow runs `node scripts/build-pages.mjs` and uploads `pages-dist/`.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/pages.yml`:

```yaml
name: Deploy showcase to Pages

# Deploys the read-only static studio + board + landing. Triggers on the feature branch
# (live URL now, before the arc's final merge) and on master (so it keeps working after
# the merge), plus manual runs.
on:
  push:
    branches: [feat/expression-studio, master]
  workflow_dispatch:

# Least-privilege token the Pages deploy needs.
permissions:
  contents: read
  pages: write
  id-token: write

# Never run two deploys at once; let an in-progress deploy finish.
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Build the static bundle
        run: node scripts/build-pages.mjs
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: pages-dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Append the docs section**

Append to `site/README.md`:

```markdown
## Deploying the full studio to Pages

The landing page here is the front door, but the Pages deploy publishes the **whole
read-only showcase** — landing + Expression Studio Gallery + the desk/board sim —
assembled by `scripts/build-pages.mjs` into a gitignored `pages-dist/` bundle.

- **Workflow:** `.github/workflows/pages.yml` runs the build and deploys on every push to
  `feat/expression-studio` and `master`, plus manual runs (Actions tab → "Run workflow").
- **One-time repo setting:** Settings → Pages → **Source: "GitHub Actions"**.
- **URLs:** `https://<user>.github.io/<repo>/` → landing · `/studio/` → Gallery ·
  `/studio/board.html` → board sim.

The site is read-only: there is no engine on a static host, so edit/approve affordances
are hidden (they reappear only when the local engine is running). Build it locally with
`npm run build:pages` and serve `pages-dist/` with any static server to preview.
```

- [ ] **Step 3: Verify the bundle builds and the full suite is green**

Run: `node scripts/build-pages.mjs && npm test`
Expected: bundle prints its path; full suite passes (previous count + the 3 new tests from Tasks 1–2, i.e. **222 passing** — was 219). `check-manifest` reports `manifest OK`, `tsc` clean.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml site/README.md
git commit -m "feat(pages): GitHub Actions deploy workflow + Pages docs"
```

---

## Notes for the executor

- **YAML can't be unit-tested** here; Task 3's gate is structural review + the real build run in Step 3. The reviewer should sanity-check the action versions and the `path: pages-dist` matching the build output dir.
- **Local read-only smoke (controller-run, not a committed test):** after Task 3, serve the bundle on a throwaway port and confirm the Gallery renders with **no** ✎ edit links / approve toggles, and the board cycles. Use a port other than **8787** — that is the user's own running engine; never kill it.

  ```bash
  node scripts/build-pages.mjs
  npx --yes http-server pages-dist -p 8791 -c-1   # any free non-8787 port
  ```

  Then load `http://127.0.0.1:8791/studio/index.html` and `/studio/board.html`.
- **One manual step is the user's:** repo → Settings → Pages → Source = "GitHub Actions". The workflow cannot set this; flag it to the user at the end.
