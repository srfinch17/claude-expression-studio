# Studio Frame-Expression Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-studio palette-based 8×8 paint editor for existing frame-expressions (`mcp_server/expressions/*.json`) — edit pixels, frames, palette, timing — saving back through the engine, which auto-un-approves the edited expression and regenerates the gallery data.

**Architecture:** A pure op module (`studio/frame-editor.js`) over an expression object; a dedicated paint page (`studio/frame-editor.html`); a shared validator (`scripts/check-expression.mjs`, mirroring `check-manifest.mjs`); an engine write surface (`mcp_server/expression-api.ts` + a `PUT /api/expression/:name` route, mirroring the manifest path); and a migration of the approval list from a hardcoded `Set` to an engine-owned `studio/approved.json` so "edit → orange" is automatic.

**Tech Stack:** Native ES modules, no bundler, no new deps. `node:test` + `node:assert/strict`. TypeScript for the engine (compiled via the existing `tsc` step in `npm test`).

## Global Constraints

- **Branch `feat/expression-studio`. No merge** — the repo cut is the final step of the whole arc.
- **No new runtime dependencies.** Native ES modules only. Reuse `../shared/` (`Panel`, `resolveExpression`) — no second renderer copy.
- **Edit existing only.** Creating new expressions stays with `matrix_animate`. The engine rejects an unknown name with `404`.
- **Source of truth = `mcp_server/expressions/<name>.json`.** Only `source === "saved"` expressions are editable (canned glyphs live compiled in the MCP; bored animations live in `claude-hooks/` — both out of scope).
- **The browser cannot write files** — all writes go through the engine (`PUT /api/expression/:name`), exactly like the manifest save.
- **Lossless / pure ops:** every `frame-editor.js` op returns a NEW expression and never mutates its input. A frame is always exactly 8 strings × 8 chars.
- **Char-art is hidden from the user:** the palette UI shows color swatches; chars (`A`,`B`,…) are auto-assigned internally.
- **`studio/gallery-data.json` is a committed generated artifact.** After the migration and after any source edit it must be regenerated (the engine regenerates it live on save; the repo copy is committed when source changes).
- **Privacy:** never the maintainer's real name; "the user".
- **`npm test` must stay green** (it runs `node scripts/check-manifest.mjs`, the `tsc` build, then the `node --test` globs over `scripts/`, `mcp_server/`, `shared/`, `studio/`).

---

## File Structure

- **Create** `studio/approved.json` — `{ "approved": [<names>] }`, the migrated approval source.
- **Create** `scripts/check-expression.mjs` — pure `validateExpression(name, expr)` (mirrors `check-manifest.mjs`).
- **Create** `scripts/check-expression.test.js` — validator unit tests.
- **Create** `mcp_server/expression-api.ts` — `writeExpressionValidated(opts)` (validate → write → un-approve → regen).
- **Create** `studio/frame-editor.js` — pure expression-edit ops.
- **Create** `studio/frame-editor.test.js` — op unit tests.
- **Create** `studio/frame-editor.html` — the paint UI.
- **Modify** `scripts/build-gallery-data.mjs` — read `approved.json` (add an `approvedPath` param) instead of the hardcoded `APPROVED` Set.
- **Modify** `scripts/build-gallery-data.test.js` — assert the `approved` flag comes from `approved.json` (create this test file if absent).
- **Modify** `mcp_server/engine-server.ts` — add the `PUT /api/expression/:name` route.
- **Modify** `mcp_server/engine-server.test.ts` — route tests.
- **Modify** `studio/gallery.js` and `studio/editor.html` — an "✎ edit" link on `source:"saved"` frame-expression tiles.

Task order: T1 (approval migration) → T2 (validator) → T3 (engine route) → T4 (paint ops) → T5 (paint UI) → T6 (entry points).

---

## Task 1: Migrate approval list to `studio/approved.json`

**Files:**
- Create: `studio/approved.json`
- Modify: `scripts/build-gallery-data.mjs`
- Test: `scripts/build-gallery-data.test.js`

**Interfaces:**
- Produces: `buildGalleryData({ canned, savedDir, manifestPath, boredDir, approvedPath })` — same return as today (`{ expressions, firmware, groups }`), but each expression's `approved` flag now comes from the JSON at `approvedPath` (`{ "approved": string[] }`). `approvedPath` is REQUIRED.

- [ ] **Step 1: Create `studio/approved.json`** (seed = today's `APPROVED` set, verbatim)

```json
{
  "approved": [
    "aurora", "bloom", "claude-idle", "crystal-ball", "fireflies",
    "idea", "inchworm", "soundwave", "task-complete",
    "hourglass", "reticle", "skull", "spinning-coin",
    "compactor", "confetti", "dusk",
    "lightning", "warp-portal",
    "goldfish", "lava-lamp", "ringed-planet", "swarm-merge",
    "atom", "double-slit", "jupiter", "meteor", "ufo",
    "black-hole", "butterfly", "galaxy", "jellyfish", "newtons-cradle", "rain", "tornado",
    "jack-o-lantern", "mushroom-cloud", "volcano",
    "bomb", "potion", "sunrise", "warrocket"
  ]
}
```

- [ ] **Step 2: Write the failing test** (create `scripts/build-gallery-data.test.js`)

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGalleryData } from "./build-gallery-data.mjs";

// Minimal fixture: one saved expression "fish", empty bored dir, a manifest binding nothing.
function fixture(approvedNames) {
  const dir = mkdtempSync(join(tmpdir(), "gallery-"));
  const saved = join(dir, "saved"); mkdirSync(saved);
  const bored = join(dir, "bored"); mkdirSync(bored);
  writeFileSync(join(saved, "fish.json"), JSON.stringify({
    frames: [["........","........","........","........","........","........","........","........"]],
    colors: {}, frame_ms: 150, loop: 0, description: "test",
  }));
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ version: "1.0", intents: {}, harnesses: {}, renderers: {} }));
  const approvedPath = join(dir, "approved.json");
  writeFileSync(approvedPath, JSON.stringify({ approved: approvedNames }));
  return { canned: {}, savedDir: saved, manifestPath, boredDir: bored, approvedPath };
}

test("buildGalleryData reads the approved flag from approvedPath", () => {
  const onF = buildGalleryData(fixture(["fish"]));
  assert.equal(onF.expressions.find((e) => e.name === "fish").approved, true);
  const offF = buildGalleryData(fixture([]));
  assert.equal(offF.expressions.find((e) => e.name === "fish").approved, false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test scripts/build-gallery-data.test.js`
Expected: FAIL — `buildGalleryData` does not accept `approvedPath` yet (the `approved` flag still comes from the hardcoded set; `fish` is not in it, so the `true` assertion fails).

- [ ] **Step 4: Modify `scripts/build-gallery-data.mjs`**

Replace the hardcoded set (lines 9-23, the comment + `const APPROVED = new Set([...]);`) with a reader:

```javascript
// User-approved ("done") expressions live in studio/approved.json (the engine-owned approval
// source). The studio gallery renders a green ✓ on these. The expression editor's save
// auto-removes a name here (edit → orange / pending re-review). buildGalleryData reads the
// file via the required `approvedPath` param.
function readApproved(approvedPath) {
  try { return new Set(JSON.parse(readFileSync(approvedPath, "utf8")).approved || []); }
  catch { return new Set(); }
}
```

Change the `buildGalleryData` signature and body to take + use `approvedPath`:

```javascript
export function buildGalleryData({ canned, savedDir, manifestPath, boredDir, approvedPath }) {
  const approved = readApproved(approvedPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const roles = manifestRoles(manifest);                       // name -> wait/ask/bored/wired
  const boredNames = new Set(readDir(boredDir, "bored").map(([n]) => n));
  const cannedNames = new Set(Object.keys(canned));

  // Merge expression DATA from all three sources, de-duped by name (saved > canned > bored).
  const byName = new Map();
  for (const [name, data] of readDir(boredDir, "bored")) byName.set(name, data);
  for (const [name, e] of Object.entries(canned)) {
    byName.set(name, { source: "canned", frames: e.frames, colors: e.colors,
      frame_ms: e.frame_ms || 150, loop: e.loop ?? 0, description: e.description || "" });
  }
  for (const [name, data] of readDir(savedDir, "saved")) byName.set(name, data);

  const expressions = [];
  const groups = { wait: [], ask: [], bored: [], wired: [], canned: [], orphan: [] };
  const ctx = { roles, boredNames, cannedNames };
  for (const [name, data] of byName) {
    const group = classifyExpression(name, ctx);
    expressions.push({ name, ...data, group, approved: approved.has(name) });
    groups[group].push(name);
  }

  return { expressions, firmware: FIRMWARE, groups };
}
```

Update `main()` to pass `approvedPath` (add the line into the existing `buildGalleryData({...})` call):

```javascript
  const data = buildGalleryData({
    canned,
    savedDir: join(root, "mcp_server/expressions"),
    manifestPath: join(root, "shared/manifest.json"),
    boredDir: join(root, "claude-hooks/bored_animations"),
    approvedPath: join(root, "studio/approved.json"),
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test scripts/build-gallery-data.test.js`
Expected: PASS.

- [ ] **Step 6: Regenerate gallery-data + run the full suite**

Run: `npm run build:gallery && npm test`
Expected: `gallery-data.json` regenerates (the `approved` flags are unchanged, since `approved.json` was seeded from the same set — so the only diff, if any, is incidental); full suite PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/approved.json scripts/build-gallery-data.mjs scripts/build-gallery-data.test.js studio/gallery-data.json
git commit -m "refactor(gallery): approval list -> studio/approved.json (data-driven)"
```

---

## Task 2: `scripts/check-expression.mjs` validator

**Files:**
- Create: `scripts/check-expression.mjs`
- Test: `scripts/check-expression.test.js`

**Interfaces:**
- Produces: `validateExpression(name, expr) -> string[]` — returns an array of human-readable error strings (empty = valid). Pure; no fs. (Mirrors `check-manifest.mjs`'s `validateManifest`.)

- [ ] **Step 1: Write the failing tests** (create `scripts/check-expression.test.js`)

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateExpression } from "./check-expression.mjs";

const ROWS8 = ["........","....A...","........","........","........","........","........","........"];
function good() { return { frames: [ROWS8], colors: { A: "#ff0000" }, frame_ms: 150, loop: 0, description: "ok" }; }

test("a well-formed expression validates", () => {
  assert.deepEqual(validateExpression("goldfish", good()), []);
});

test("rejects a bad name", () => {
  assert.ok(validateExpression("Bad Name", good()).some((e) => /name/i.test(e)));
});

test("rejects wrong frame dimensions", () => {
  const e = good(); e.frames = [["x"]]; // not 8 rows
  assert.ok(validateExpression("g", e).some((m) => /8 rows|8 chars/.test(m)));
});

test("rejects a used char with no color entry", () => {
  const e = good(); e.colors = {}; // 'A' used but undefined
  assert.ok(validateExpression("g", e).some((m) => /char 'A'/.test(m)));
});

test("rejects an invalid hex and bad frame_ms/loop", () => {
  const e = good(); e.colors = { A: "red" }; e.frame_ms = 0; e.loop = -1;
  const errs = validateExpression("g", e);
  assert.ok(errs.some((m) => /hex/.test(m)));
  assert.ok(errs.some((m) => /frame_ms/.test(m)));
  assert.ok(errs.some((m) => /loop/.test(m)));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/check-expression.test.js`
Expected: FAIL — module not found / `validateExpression` not exported.

- [ ] **Step 3: Create `scripts/check-expression.mjs`**

```javascript
// scripts/check-expression.mjs — pure validator for a frame-expression payload, shared by the
// engine's PUT /api/expression write surface (trust boundary) and optionally the editor UI
// (pre-save UX). Mirrors check-manifest.mjs: a pure validateExpression(name, expr) -> string[].

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function validateExpression(name, expr) {
  const errors = [];
  if (typeof name !== "string" || !NAME_RE.test(name)) errors.push(`invalid name: ${name}`);
  if (!expr || typeof expr !== "object") { errors.push("expr must be an object"); return errors; }

  const { frames, colors, frame_ms, loop } = expr;
  if (!Array.isArray(frames) || frames.length === 0) {
    errors.push("frames must be a non-empty array");
  } else {
    frames.forEach((f, i) => {
      if (!Array.isArray(f) || f.length !== 8) { errors.push(`frame ${i}: must be 8 rows`); return; }
      f.forEach((row, r) => {
        if (typeof row !== "string" || row.length !== 8) errors.push(`frame ${i} row ${r}: must be 8 chars`);
      });
    });
  }

  const cols = (colors && typeof colors === "object") ? colors : {};
  for (const [k, v] of Object.entries(cols)) {
    if (typeof v !== "string" || !HEX_RE.test(v)) errors.push(`color '${k}': invalid hex`);
  }

  if (Array.isArray(frames)) {
    const used = new Set();
    for (const f of frames) if (Array.isArray(f)) for (const row of f) {
      if (typeof row === "string") for (const ch of row) if (ch !== ".") used.add(ch);
    }
    for (const ch of used) if (!(ch in cols)) errors.push(`char '${ch}' has no color`);
  }

  if (!Number.isInteger(frame_ms) || frame_ms <= 0) errors.push("frame_ms must be a positive integer");
  if (!Number.isInteger(loop) || loop < 0) errors.push("loop must be an integer >= 0");
  return errors;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/check-expression.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-expression.mjs scripts/check-expression.test.js
git commit -m "feat(studio): frame-expression validator (shared by engine write + editor)"
```

---

## Task 3: Engine write surface + `PUT /api/expression/:name`

**Files:**
- Create: `mcp_server/expression-api.ts`
- Modify: `mcp_server/engine-server.ts`
- Test: `mcp_server/engine-server.test.ts`

**Interfaces:**
- Consumes: `validateExpression(name, expr)` from `scripts/check-expression.mjs` (Task 2, dynamic-imported by absolute file URL — the same pattern `manifest-api.ts` uses for `check-manifest.mjs`); `buildGalleryData({canned, savedDir, manifestPath, boredDir, approvedPath})` + `loadCanned(cannedModulePath)` from `scripts/build-gallery-data.mjs` (Task 1, dynamic-imported).
- Produces: `writeExpressionValidated(opts) -> Promise<{ok:true} | {ok:false; status:number; errors:string[]}>`; the route `PUT /api/expression/:name`.

`opts` shape (all absolute paths, computed by the route from the engine's known dirs):
```
{ name: string; expr: unknown;
  expressionsDir, validatorPath, generatorPath, cannedPath,
  manifestPath, boredDir, approvedPath, galleryDataPath: string }
```

- [ ] **Step 1: Write the failing test** (append to `mcp_server/engine-server.test.ts`)

First read the existing `engine-server.test.ts` (it's ESM, imports the COMPILED `./dist/engine-server.js`, defines `const MCP_DIR = path.dirname(fileURLToPath(import.meta.url))`, and starts the engine with `startEngineServer({ mcpDir: MCP_DIR, port: 0 })`). Reuse that harness; do NOT use `__dirname` (this is ESM).

**First, add `fs` helpers to the TOP-OF-FILE imports** (ESM imports must be hoisted — match the existing import block):
```typescript
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
```

**Then append this test** (uses the existing `MCP_DIR`; `MCP_DIR` IS the `mcp_server/` dir, repo root is its parent). The test writes a throwaway saved expression into the real `mcp_server/expressions/`, PUTs an edit, asserts file + approval + gallery-data updated, then cleans up in `finally`:
```typescript
test("PUT /api/expression/:name writes the file, un-approves, regenerates gallery-data", async () => {
  const repo = path.join(MCP_DIR, "..");
  const exprPath = path.join(MCP_DIR, "expressions", "zzz-test.json");
  const approvedPath = path.join(repo, "studio", "approved.json");
  const galleryPath = path.join(repo, "studio", "gallery-data.json");
  const blank = ["........","........","........","........","........","........","........","........"];
  const seed = { frames: [blank], colors: {}, frame_ms: 150, loop: 0, description: "seed" };
  writeFileSync(exprPath, JSON.stringify(seed, null, 2));
  const approvedRaw = readFileSync(approvedPath, "utf8");
  const approvedBefore = JSON.parse(approvedRaw); approvedBefore.approved.push("zzz-test");
  writeFileSync(approvedPath, JSON.stringify(approvedBefore, null, 2));

  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  try {
    const edited = { ...seed, frames: [["A.......", ...blank.slice(1)]], colors: { A: "#00ff00" }, description: "edited" };
    const r = await fetch(`${eng.url}/api/expression/zzz-test`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(edited),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json() as any, { ok: true });
    assert.equal(JSON.parse(readFileSync(exprPath, "utf8")).description, "edited");              // file written
    assert.ok(!JSON.parse(readFileSync(approvedPath, "utf8")).approved.includes("zzz-test"));    // un-approved
    const gd = JSON.parse(readFileSync(galleryPath, "utf8"));                                    // gallery regenerated
    const e = gd.expressions.find((x: any) => x.name === "zzz-test");
    assert.equal(e.description, "edited");
    assert.equal(e.approved, false);

    const bad = await fetch(`${eng.url}/api/expression/zzz-test`, {                              // bad shape -> 400
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...edited, frames: [["x"]] }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json() as any).ok, false);

    const missing = await fetch(`${eng.url}/api/expression/does-not-exist`, {                    // unknown -> 404
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(edited),
    });
    assert.equal(missing.status, 404);
  } finally {
    await eng.close();
    if (existsSync(exprPath)) rmSync(exprPath);          // remove the throwaway source
    writeFileSync(approvedPath, approvedRaw);            // restore approved.json byte-for-byte
  }
});
```

(The test mutates the real `studio/approved.json` and `studio/gallery-data.json`; `finally` removes the throwaway expression and restores `approved.json` exactly. `gallery-data.json` is left regenerated — Step 5 rebuilds the committed copy so it excludes `zzz-test`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test` (it compiles TS first, then runs the suite)
Expected: FAIL — the `/api/expression/` route returns 404/405 for every request (route not implemented), so the 200 assertion fails.

- [ ] **Step 3: Create `mcp_server/expression-api.ts`**

```typescript
// mcp_server/expression-api.ts — the engine's frame-expression write surface. Mirrors
// manifest-api.ts: writes are VALIDATED through the same shared validator the editor uses
// (scripts/check-expression.mjs), the source JSON is written to mcp_server/expressions/, the
// edited name is removed from studio/approved.json (edit -> orange), and studio/gallery-data.json
// is regenerated in-process via buildGalleryData so the studio reflects the edit immediately.
// Edit-only: an unknown name is rejected (no creating new expressions here).
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface ExprWriteOpts {
  name: string;
  expr: unknown;
  expressionsDir: string;
  validatorPath: string;
  generatorPath: string;
  cannedPath: string;
  manifestPath: string;
  boredDir: string;
  approvedPath: string;
  galleryDataPath: string;
}

type Result = { ok: true } | { ok: false; status: number; errors: string[] };

export async function writeExpressionValidated(opts: ExprWriteOpts): Promise<Result> {
  const file = path.join(opts.expressionsDir, `${opts.name}.json`);
  if (!existsSync(file)) return { ok: false, status: 404, errors: [`unknown expression: ${opts.name}`] };

  const { validateExpression } = await import(pathToFileURL(opts.validatorPath).href);
  const errors: string[] = validateExpression(opts.name, opts.expr);
  if (errors.length) return { ok: false, status: 400, errors };

  // 1. write the source JSON (pretty, 2-space)
  await writeFile(file, JSON.stringify(opts.expr, null, 2) + "\n", "utf8");

  // 2. un-approve (edit -> pending re-review / orange)
  try {
    const approved = JSON.parse(await readFile(opts.approvedPath, "utf8"));
    approved.approved = (approved.approved || []).filter((n: string) => n !== opts.name);
    await writeFile(opts.approvedPath, JSON.stringify(approved, null, 2) + "\n", "utf8");
  } catch { /* if approved.json is missing, nothing to un-approve */ }

  // 3. regenerate studio/gallery-data.json in-process (matches the CLI output exactly)
  const gen = await import(pathToFileURL(opts.generatorPath).href);
  const canned = await gen.loadCanned(opts.cannedPath);
  const data = gen.buildGalleryData({
    canned, savedDir: opts.expressionsDir, manifestPath: opts.manifestPath,
    boredDir: opts.boredDir, approvedPath: opts.approvedPath,
  });
  await writeFile(opts.galleryDataPath, JSON.stringify(data, null, 2), "utf8");

  return { ok: true };
}
```

- [ ] **Step 4: Add the route to `mcp_server/engine-server.ts`**

First add the import near the top (next to the `manifest-api.js` import on line 7):

```typescript
import { writeExpressionValidated } from "./expression-api.js";
```

Then insert the route handler immediately AFTER the `if (url.startsWith("/api/manifest")) { … }` block (it ends with `}` before the `/api/framebuffer` block around line 64). Insert:

```typescript
      if (url.startsWith("/api/expression/")) {
        if (method !== "PUT") { res.writeHead(405); res.end(); return; }
        const name = decodeURIComponent(url.slice("/api/expression/".length).split("?")[0]);
        let expr: unknown;
        try { expr = JSON.parse(await readBody(req)); }   // readBody: the same helper the manifest PUT uses
        catch { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, errors: ["invalid JSON body"] })); return; }
        const result = await writeExpressionValidated({
          name, expr,
          expressionsDir: path.join(mcpDir, "expressions"),
          validatorPath: path.join(repoRoot, "scripts", "check-expression.mjs"),
          generatorPath: path.join(repoRoot, "scripts", "build-gallery-data.mjs"),
          cannedPath: path.join(mcpDir, "dist", "expressions.js"),
          manifestPath: path.join(mfDir, "manifest.json"),
          boredDir: path.join(repoRoot, "claude-hooks", "bored_animations"),
          approvedPath: path.join(base, "studio", "approved.json"),
          galleryDataPath: path.join(base, "studio", "gallery-data.json"),
        });
        const status = result.ok ? 200 : (result as any).status;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.ok ? { ok: true } : { ok: false, errors: (result as any).errors }));
        return;
      }
```

(The handler reads the body via `for await (const c of req)`. `mcpDir`, `mfDir`, `repoRoot`, and `base` are all already in scope in `startEngineServer` — `base = resolveStaticBase(mcpDir)`. Confirm `path` is imported at the top of the file; it is used by the manifest block already.)

- [ ] **Step 5: Run the test, then restore the committed gallery-data**

Run: `npm test`
Expected: PASS (the new route test + the full suite).

Then restore the committed artifacts the test mutated:
Run: `npm run build:gallery`
Expected: regenerates `studio/gallery-data.json` WITHOUT `zzz-test` (the throwaway was removed in the test's `finally`), and `studio/approved.json` is already restored to its real contents.

Verify no stray test artifact remains:
Run: `git status --porcelain studio/gallery-data.json studio/approved.json mcp_server/expressions/`
Expected: `gallery-data.json` may show formatting-only churn (re-pretty) or nothing; NO `zzz-test.json` under `mcp_server/expressions/`.

- [ ] **Step 6: Commit**

```bash
git add mcp_server/expression-api.ts mcp_server/engine-server.ts mcp_server/engine-server.test.ts studio/gallery-data.json studio/approved.json
git commit -m "feat(engine): PUT /api/expression/:name (validate, write, un-approve, regen)"
```

---

## Task 4: `studio/frame-editor.js` — pure paint ops

**Files:**
- Create: `studio/frame-editor.js`
- Test: `studio/frame-editor.test.js`

**Interfaces:**
- Produces (all pure; input never mutated; an expr is `{ description, frames: string[][], colors: {char:hex}, frame_ms, loop }`):
  `blankFrame() -> string[]` · `paintCell(expr, frameIdx, x, y, char) -> expr` · `addFrame(expr, atIdx, copyFromIdx?) -> expr` · `duplicateFrame(expr, idx) -> expr` · `deleteFrame(expr, idx) -> expr` (≥1-frame guard) · `moveFrame(expr, from, to) -> expr` · `addColor(expr, hex) -> {expr, char}` · `setColor(expr, char, hex) -> expr` · `removeColor(expr, char) -> expr` · `setFrameMs(expr, ms) -> expr` · `setLoop(expr, n) -> expr` · `setDescription(expr, text) -> expr`.

- [ ] **Step 1: Write the failing tests** (create `studio/frame-editor.test.js`)

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankFrame, paintCell, addFrame, duplicateFrame, deleteFrame, moveFrame,
         addColor, setColor, removeColor, setFrameMs, setLoop, setDescription } from "./frame-editor.js";

function fresh() {
  return {
    description: "d",
    frames: [
      ["........","........","........","........","........","........","........","........"],
      ["AAAAAAAA","........","........","........","........","........","........","........"],
    ],
    colors: { A: "#ff0000" }, frame_ms: 150, loop: 0,
  };
}

test("blankFrame is 8 rows of 8 dots", () => {
  assert.deepEqual(blankFrame(), Array(8).fill("........"));
});

test("paintCell sets one cell and does not mutate input", () => {
  const e0 = fresh(); const snap = JSON.stringify(e0);
  const e = paintCell(e0, 0, 3, 1, "A");
  assert.equal(e.frames[0][1], "...A....");
  assert.equal(JSON.stringify(e0), snap);
});

test("paintCell out of bounds is a no-op copy", () => {
  const e = paintCell(fresh(), 0, 9, 0, "A");
  assert.equal(e.frames[0][0], "........");
});

test("addFrame inserts blank; copyFromIdx copies", () => {
  assert.equal(addFrame(fresh(), 1).frames.length, 3);
  assert.deepEqual(addFrame(fresh(), 2).frames[2], Array(8).fill("........"));
  assert.equal(addFrame(fresh(), 0, 1).frames[0][0], "AAAAAAAA");
});

test("duplicateFrame copies a frame after it", () => {
  const e = duplicateFrame(fresh(), 1);
  assert.equal(e.frames.length, 3);
  assert.equal(e.frames[2][0], "AAAAAAAA");
});

test("deleteFrame removes; never below 1 frame", () => {
  assert.equal(deleteFrame(fresh(), 0).frames.length, 1);
  const one = { ...fresh(), frames: [blankFrame()] };
  assert.equal(deleteFrame(one, 0).frames.length, 1); // guard
});

test("moveFrame reorders", () => {
  const e = moveFrame(fresh(), 0, 1);
  assert.equal(e.frames[0][0], "AAAAAAAA");
});

test("addColor assigns the next free char", () => {
  const { expr, char } = addColor(fresh(), "#00ff00");
  assert.equal(char, "B");                 // A is taken
  assert.equal(expr.colors.B, "#00ff00");
});

test("setColor recolors an existing char; unknown is a no-op", () => {
  assert.equal(setColor(fresh(), "A", "#0000ff").colors.A, "#0000ff");
  assert.equal(setColor(fresh(), "Z", "#0000ff").colors.Z, undefined);
});

test("removeColor drops the char and blanks cells using it", () => {
  const e = removeColor(fresh(), "A");
  assert.equal("A" in e.colors, false);
  assert.equal(e.frames[1][0], "........");
});

test("meta setters", () => {
  assert.equal(setFrameMs(fresh(), 80).frame_ms, 80);
  assert.equal(setLoop(fresh(), 3).loop, 3);
  assert.equal(setDescription(fresh(), "hi").description, "hi");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test studio/frame-editor.test.js`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Create `studio/frame-editor.js`**

```javascript
// studio/frame-editor.js — pure ops over a frame-expression { description, frames, colors,
// frame_ms, loop }. Every op returns a NEW expression (deep-cloned) and never mutates its input;
// a frame is always 8 strings of 8 chars. Chars are the palette keys ('.' = off); the UI hides
// them behind color swatches (addColor auto-assigns the next free char).

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const clone = (e) => JSON.parse(JSON.stringify(e));

export function blankFrame() { return Array(8).fill("........"); }

export function paintCell(expr, frameIdx, x, y, char) {
  const e = clone(expr);
  if (!e.frames[frameIdx] || x < 0 || x > 7 || y < 0 || y > 7) return e;
  const row = e.frames[frameIdx][y];
  e.frames[frameIdx][y] = row.slice(0, x) + (char || ".") + row.slice(x + 1);
  return e;
}

export function addFrame(expr, atIdx, copyFromIdx) {
  const e = clone(expr);
  const f = (copyFromIdx != null && e.frames[copyFromIdx]) ? e.frames[copyFromIdx].slice() : blankFrame();
  const i = Math.max(0, Math.min(atIdx, e.frames.length));
  e.frames.splice(i, 0, f);
  return e;
}

export function duplicateFrame(expr, idx) {
  const e = clone(expr);
  if (!e.frames[idx]) return e;
  e.frames.splice(idx + 1, 0, e.frames[idx].slice());
  return e;
}

export function deleteFrame(expr, idx) {
  const e = clone(expr);
  if (e.frames.length <= 1 || !e.frames[idx]) return e;
  e.frames.splice(idx, 1);
  return e;
}

export function moveFrame(expr, from, to) {
  const e = clone(expr);
  if (!e.frames[from] || to < 0 || to >= e.frames.length) return e;
  const [f] = e.frames.splice(from, 1);
  e.frames.splice(to, 0, f);
  return e;
}

export function addColor(expr, hex) {
  const e = clone(expr); e.colors = e.colors || {};
  const used = new Set(Object.keys(e.colors));
  const char = CHARSET.find((c) => !used.has(c)) || null;
  if (char) e.colors[char] = hex;
  return { expr: e, char };
}

export function setColor(expr, char, hex) {
  const e = clone(expr);
  if (e.colors && char in e.colors) e.colors[char] = hex;
  return e;
}

export function removeColor(expr, char) {
  const e = clone(expr);
  if (!e.colors || !(char in e.colors)) return e;
  delete e.colors[char];
  e.frames = e.frames.map((f) => f.map((row) => row.split("").map((ch) => (ch === char ? "." : ch)).join("")));
  return e;
}

export function setFrameMs(expr, ms) { const e = clone(expr); e.frame_ms = ms; return e; }
export function setLoop(expr, n) { const e = clone(expr); e.loop = n; return e; }
export function setDescription(expr, text) { const e = clone(expr); e.description = text; return e; }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test studio/frame-editor.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/frame-editor.js studio/frame-editor.test.js
git commit -m "feat(studio): frame-editor.js pure paint/frame/palette ops"
```

---

## Task 5: `studio/frame-editor.html` — the paint UI

**Files:**
- Create: `studio/frame-editor.html`

**Interfaces:**
- Consumes: the ops from `./frame-editor.js` (Task 4); `Panel` from `../shared/render.js`; `resolveExpression` from `../shared/expressions.js`; the engine route `PUT /api/expression/:name` (Task 3); `./gallery-data.json` (read source).
- Produces: the page (no exports).

**Note:** browser glue — no unit test; the controller verifies visually on the engine-served Studio. Create the complete file below.

- [ ] **Step 1: Create `studio/frame-editor.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Frame Editor — Expression Studio</title>
  <style>
    :root { --bg:#0a0a0e; --panel:#111118; --sub:#15151b; --text:#e8e8ef; --dim:#9a9aa8;
      --faint:#5a5a68; --orange:#ff5008; --cyan:#22ddff; --green:#16a34a;
      --mono:'IBM Plex Mono',ui-monospace,monospace; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:14px var(--mono); padding:0 0 40px; }
    header { position:sticky; top:0; z-index:5; background:var(--bg); border-bottom:1px solid #1e1e26;
      display:flex; align-items:center; gap:12px; padding:12px 18px; }
    header h1 { font-size:1rem; margin:0; flex:1; }
    #banner { color:var(--orange); font-size:.78rem; }
    #status { font-size:.76rem; color:var(--dim); min-width:14ch; }
    button { font:inherit; font-size:.8rem; color:var(--text); background:var(--sub);
      border:1px solid #2a2a34; border-radius:7px; padding:5px 11px; cursor:pointer; }
    button:disabled { opacity:.4; cursor:not-allowed; }
    button.save { border-color:var(--green); color:#9affc8; }
    main { display:grid; grid-template-columns:220px minmax(0,1fr); gap:16px; padding:16px; align-items:start; }
    .side { background:var(--panel); border:1px solid #1c1c24; border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:10px; }
    h2 { font-size:.72rem; letter-spacing:.12em; text-transform:uppercase; color:var(--faint); margin:0 0 4px; }
    .swatches { display:flex; flex-direction:column; gap:5px; }
    .swatch { display:flex; align-items:center; gap:8px; padding:3px 5px; border:1px solid transparent; border-radius:6px; cursor:pointer; font-size:.7rem; }
    .swatch.active { border-color:var(--cyan); }
    .swatch .chip { width:16px; height:16px; border-radius:4px; border:1px solid #0006; }
    .swatch .off { width:16px; height:16px; border-radius:4px; border:1px dashed #555; }
    .palrow { display:flex; gap:6px; }
    .palrow button { flex:1; padding:3px; font-size:.66rem; }
    .meta label { display:flex; justify-content:space-between; align-items:center; font-size:.72rem; color:var(--dim); margin-top:4px; }
    .meta input { width:70px; font:inherit; background:#000; color:var(--text); border:1px solid #2a2a34; border-radius:4px; }
    .meta textarea { width:100%; height:46px; font:inherit; font-size:.66rem; background:#000; color:var(--text); border:1px solid #2a2a34; border-radius:4px; resize:vertical; margin-top:4px; }
    .preview canvas { width:120px; height:120px; border-radius:6px; background:#060608; display:block; }
    .stage { background:var(--panel); border:1px solid #1c1c24; border-radius:10px; padding:14px; }
    .grid { display:grid; grid-template-columns:repeat(8,40px); grid-template-rows:repeat(8,40px); gap:2px; background:#1c1c24; padding:2px; border-radius:6px; width:max-content; touch-action:none; user-select:none; }
    .px { width:40px; height:40px; border-radius:3px; background:#060608; cursor:crosshair; }
    .frames { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:14px; }
    .fcell { position:relative; border:2px solid #22222c; border-radius:6px; padding:2px; cursor:pointer; }
    .fcell.active { border-color:var(--cyan); }
    .fcell canvas { width:46px; height:46px; border-radius:3px; background:#060608; display:block; }
    .fcell .fn { position:absolute; top:1px; left:3px; font-size:.5rem; color:var(--faint); }
    .fbtns { display:flex; gap:6px; margin-left:8px; }
  </style>
</head>
<body>
  <header>
    <h1 id="title">Frame Editor</h1>
    <span id="banner"></span>
    <span id="status"></span>
    <button id="revert">Revert</button>
    <button id="save" class="save">Save</button>
  </header>
  <main>
    <div class="side">
      <div>
        <h2>Palette</h2>
        <div id="swatches" class="swatches"></div>
        <div class="palrow">
          <button id="addColor">+ color</button>
          <button id="recolor">recolor</button>
          <button id="removeColor">remove</button>
        </div>
      </div>
      <div class="meta">
        <h2>Timing</h2>
        <label>frame_ms <input id="frameMs" type="number" min="10" max="10000"></label>
        <label>loop <input id="loop" type="number" min="0" max="999"></label>
        <h2>Description</h2>
        <textarea id="desc"></textarea>
      </div>
      <div class="preview">
        <h2>Preview</h2>
        <canvas id="preview" width="120" height="120"></canvas>
      </div>
    </div>
    <div class="stage">
      <div id="grid" class="grid"></div>
      <div class="frames">
        <div id="fstrip" style="display:flex; gap:8px; flex-wrap:wrap;"></div>
        <div class="fbtns">
          <button id="addF">+ frame</button>
          <button id="dupF">dup</button>
          <button id="delF">del</button>
        </div>
      </div>
    </div>
  </main>

  <script type="module">
    import { Panel } from "../shared/render.js";
    import { resolveExpression } from "../shared/expressions.js";
    import { paintCell, addFrame, duplicateFrame, deleteFrame, moveFrame,
             addColor, setColor, removeColor, setFrameMs, setLoop, setDescription } from "./frame-editor.js";

    const qs = new URLSearchParams(location.search);
    const NAME = qs.get("name") || "";
    const titleEl = document.getElementById("title");
    const bannerEl = document.getElementById("banner");
    const statusEl = document.getElementById("status");
    const saveBtn = document.getElementById("save");
    const revertBtn = document.getElementById("revert");
    const gridEl = document.getElementById("grid");
    const swatchesEl = document.getElementById("swatches");
    const fstripEl = document.getElementById("fstrip");

    let expr = null, original = null, activeFrame = 0, brush = ".", readOnly = false, dirty = false;
    let previewPanel = null, fpanels = [];
    const REDUCE = matchMedia("(prefers-reduced-motion:reduce)").matches;

    function setDirty(d) { dirty = d; statusEl.textContent = readOnly ? "read-only (no engine)" : d ? "unsaved changes" : "saved"; saveBtn.disabled = readOnly || !d; }
    function edit(fn) { expr = fn(expr); setDirty(true); renderAll(); }

    // Resolve a single frame to a flat lit-pixel array via the expression resolver.
    function resolvedFrames() { return resolveExpression(expr).frames; }

    function renderGrid() {
      gridEl.innerHTML = "";
      const lit = resolvedFrames()[activeFrame] || [];
      const cols = expr.colors || {};
      const rows = expr.frames[activeFrame];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const ch = rows[y][x];
        const px = document.createElement("div"); px.className = "px";
        px.style.background = (ch !== "." && cols[ch]) ? cols[ch] : "#060608";
        const paint = (b) => edit((e) => paintCell(e, activeFrame, x, y, b));
        px.addEventListener("pointerdown", (ev) => { ev.preventDefault(); if (readOnly) return; paint(ev.button === 2 ? "." : brush); });
        px.addEventListener("pointerenter", (ev) => { if (readOnly || !(ev.buttons & 1)) return; paint(brush); });
        px.addEventListener("contextmenu", (ev) => ev.preventDefault());
        gridEl.appendChild(px);
      }
    }

    function renderSwatches() {
      swatchesEl.innerHTML = "";
      const off = document.createElement("div"); off.className = "swatch" + (brush === "." ? " active" : "");
      off.innerHTML = `<span class="off"></span> off / eraser`;
      off.onclick = () => { brush = "."; renderSwatches(); };
      swatchesEl.appendChild(off);
      for (const [ch, hex] of Object.entries(expr.colors || {})) {
        const sw = document.createElement("div"); sw.className = "swatch" + (brush === ch ? " active" : "");
        sw.innerHTML = `<span class="chip" style="background:${hex}"></span> ${hex}`;
        sw.onclick = () => { brush = ch; renderSwatches(); };
        swatchesEl.appendChild(sw);
      }
    }

    function renderFrames() {
      fstripEl.innerHTML = ""; fpanels = [];
      expr.frames.forEach((_, i) => {
        const cell = document.createElement("div"); cell.className = "fcell" + (i === activeFrame ? " active" : "");
        cell.draggable = !readOnly;
        const cv = document.createElement("canvas"); cv.width = 46; cv.height = 46; cell.appendChild(cv);
        const fn = document.createElement("div"); fn.className = "fn"; fn.textContent = i; cell.appendChild(fn);
        cell.onclick = () => { activeFrame = i; renderAll(); };
        cell.addEventListener("dragstart", (ev) => ev.dataTransfer.setData("text/plain", String(i)));
        cell.addEventListener("dragover", (ev) => { if (!readOnly) ev.preventDefault(); });
        cell.addEventListener("drop", (ev) => { ev.preventDefault(); if (readOnly) return; const from = Number(ev.dataTransfer.getData("text/plain")); edit((e) => moveFrame(e, from, i)); });
        fstripEl.appendChild(cell);
        const p = new Panel(cv); const rf = resolvedFrames()[i]; p.setFrames([rf], 1e9); fpanels.push(p);
      });
    }

    function renderAll() {
      if (activeFrame >= expr.frames.length) activeFrame = expr.frames.length - 1;
      titleEl.textContent = `Frame Editor — ${NAME}`;
      document.getElementById("frameMs").value = expr.frame_ms;
      document.getElementById("loop").value = expr.loop;
      document.getElementById("desc").value = expr.description || "";
      renderGrid(); renderSwatches(); renderFrames();
      const ex = resolveExpression(expr); previewPanel.setFrames(ex.frames, ex.frame_ms);
    }

    // --- palette buttons ---
    document.getElementById("addColor").onclick = () => {
      if (readOnly) return; const hex = prompt("New color (hex, e.g. #44ccff):", "#44ccff");
      if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
      const r = addColor(expr, hex); expr = r.expr; if (r.char) brush = r.char; setDirty(true); renderAll();
    };
    document.getElementById("recolor").onclick = () => {
      if (readOnly || brush === ".") return; const hex = prompt("Recolor:", expr.colors[brush]);
      if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return; edit((e) => setColor(e, brush, hex));
    };
    document.getElementById("removeColor").onclick = () => {
      if (readOnly || brush === ".") return; if (!confirm(`Remove this color? Cells using it become off.`)) return;
      const ch = brush; brush = "."; edit((e) => removeColor(e, ch));
    };

    // --- frame buttons + meta ---
    document.getElementById("addF").onclick = () => { if (!readOnly) { edit((e) => addFrame(e, activeFrame + 1, activeFrame)); activeFrame++; renderAll(); } };
    document.getElementById("dupF").onclick = () => { if (!readOnly) { edit((e) => duplicateFrame(e, activeFrame)); } };
    document.getElementById("delF").onclick = () => { if (!readOnly) { edit((e) => deleteFrame(e, activeFrame)); } };
    document.getElementById("frameMs").addEventListener("change", (e) => edit((x) => setFrameMs(x, Number(e.target.value))));
    document.getElementById("loop").addEventListener("change", (e) => edit((x) => setLoop(x, Number(e.target.value))));
    document.getElementById("desc").addEventListener("change", (e) => edit((x) => setDescription(x, e.target.value)));

    // --- save / revert ---
    saveBtn.onclick = async () => {
      saveBtn.disabled = true; statusEl.textContent = "saving…";
      try {
        const r = await fetch(`/api/expression/${encodeURIComponent(NAME)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(expr) });
        const res = await r.json();
        if (res.ok) { original = JSON.parse(JSON.stringify(expr)); setDirty(false); statusEl.textContent = "saved — now pending re-review (orange)"; }
        else { statusEl.textContent = "save failed: " + (res.errors || []).join("; "); setDirty(true); }
      } catch (e) { statusEl.textContent = "save error: " + e.message; setDirty(true); }
    };
    revertBtn.onclick = () => { expr = JSON.parse(JSON.stringify(original)); activeFrame = 0; setDirty(false); renderAll(); };

    // --- boot ---
    previewPanel = new Panel(document.getElementById("preview"));
    if (!REDUCE) { let last = performance.now(); (function loop(now){ previewPanel.tick(now-last, now); last=now; requestAnimationFrame(loop); })(last); }

    async function boot() {
      let data;
      try { data = await (await fetch("./gallery-data.json")).json(); }
      catch { bannerEl.textContent = "Could not load gallery-data.json."; return; }
      const found = (data.expressions || []).find((e) => e.name === NAME);
      if (!found) { bannerEl.textContent = `No expression named "${NAME}".`; return; }
      if (found.source !== "saved") { readOnly = true; bannerEl.textContent = `"${NAME}" is a ${found.source} expression — not editable here (only saved expressions).`; }
      expr = { description: found.description || "", frames: found.frames, colors: found.colors || {}, frame_ms: found.frame_ms || 150, loop: found.loop ?? 0 };
      original = JSON.parse(JSON.stringify(expr));
      // Engine gate: a save needs the engine. If /api/manifest isn't reachable, go read-only.
      try { const r = await fetch("/api/manifest"); if (!r.ok) throw 0; }
      catch { if (!readOnly) { readOnly = true; bannerEl.textContent = "Editing needs the live engine — launch the Studio via matrix_studio. (Read-only; Save disabled.)"; } }
      setDirty(false); renderAll();
    }
    boot();
  </script>
</body>
</html>
```

- [ ] **Step 2: Sanity-check the file loads** (controller verifies on the engine; implementer does a static check)

The implementer cannot reach the live engine. Confirm the file is well-formed: the `<script type="module">` imports resolve to existing files (`../shared/render.js`, `../shared/expressions.js`, `./frame-editor.js`), every `getElementById` has a matching element id, and there are no syntax errors (e.g. open it through `node --check` is not applicable to HTML — instead grep that each imported symbol is used). No automated test.

- [ ] **Step 3: Run the full suite** (unchanged — this task adds no logic under test)

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add studio/frame-editor.html
git commit -m "feat(studio): frame-editor.html palette paint UI"
```

---

## Task 6: "✎ edit" entry points (Gallery + binding editor)

**Files:**
- Modify: `studio/gallery.js`
- Modify: `studio/editor.html`

**Interfaces:**
- Consumes: the gallery-data expression's `source` field (`"saved"` = editable) and `name`. Links to `frame-editor.html?name=<name>`.

**Note:** browser glue — no unit test; the controller verifies visually. The edit link appears ONLY on `source === "saved"` frame-expression tiles.

- [ ] **Step 1: Read the current Gallery cell builder**

Read `studio/gallery.js` around the `cell(...)` function (≈lines 28-40) and its call sites (≈lines 66-76). The function currently is `function cell(grid, name, desc, group, approved)` and returns the canvas. Note exactly how it's called for expressions (`cell(grid, it.name, it.description, group, it.approved)`).

- [ ] **Step 2: Add an edit link in the Gallery** — modify `studio/gallery.js`

Change the `cell` signature to accept an `editable` flag and append the link. Find:
```javascript
  const nm = document.createElement("div"); nm.className = "name"; nm.textContent = name; el.appendChild(nm);
```
Replace with:
```javascript
  const nm = document.createElement("div"); nm.className = "name"; nm.textContent = name; el.appendChild(nm);
  if (editable) { const ed = document.createElement("a"); ed.className = "editlink"; ed.href = `./frame-editor.html?name=${encodeURIComponent(name)}`;
    ed.textContent = "✎ edit"; ed.title = "Edit this expression"; el.appendChild(ed); }
```
Update the `cell` signature — find `function cell(grid, name, desc, group, approved) {` and replace with `function cell(grid, name, desc, group, approved, editable) {`.
Update the expression call site — find:
```javascript
        const cv = cell(grid, it.name, it.description, group, it.approved);
```
Replace with:
```javascript
        const cv = cell(grid, it.name, it.description, group, it.approved, it.source === "saved");
```
Add a style rule for `.editlink` — find the `<style>` block in `studio/index.html` (the Gallery's HTML host) OR, if `gallery.js` has no style access, add it to `studio/index.html`'s `<style>`. Append:
```css
    .editlink { display:inline-block; margin-top:3px; font-size:.6rem; color:var(--cyan,#22ddff); text-decoration:none; }
    .editlink:hover { text-decoration:underline; }
```
(Confirm the actual host HTML file for the Gallery — it loads `gallery.js`. Add the rule to that file's `<style>`.)

- [ ] **Step 3: Add an edit link in the binding editor** — modify `studio/editor.html`

In the pool-tile render loop, the item's source is `byName.get(name)?.entry?.source`. Find (in `render()`, the tile name line):
```javascript
            const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = name; tile.appendChild(nm);
```
Replace with:
```javascript
            const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = name; tile.appendChild(nm);
            if (byName.get(name)?.entry?.source === "saved") { const ed = document.createElement("a"); ed.className = "editlink";
              ed.href = `./frame-editor.html?name=${encodeURIComponent(name)}`; ed.textContent = "✎"; ed.title = "Edit pixels";
              ed.onclick = (ev) => ev.stopPropagation(); tile.appendChild(ed); }
```
Add the `.editlink` style — find `.tile .pct { font-size:.6rem; color:var(--cyan); }` and add after it:
```css
    .tile .editlink { display:inline-block; font-size:.58rem; color:var(--cyan); text-decoration:none; margin-top:2px; }
    .tile .editlink:hover { text-decoration:underline; }
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS (unchanged — glue only).

- [ ] **Step 5: Commit**

```bash
git add studio/gallery.js studio/index.html studio/editor.html
git commit -m "feat(studio): '✎ edit' link to frame-editor on saved-expression tiles"
```

---

## Self-Review (controller, after all tasks)

Against `docs/superpowers/specs/2026-06-27-frame-expression-editor-design.md`:

- **§3 files & data flow** → T1 (approved.json + generator), T3 (engine route), T5/T6 (read from gallery-data, entry points) ✓.
- **§4 engine route** → T3: validate (T2) → write → drop from approved.json → regen → edit-only 404 ✓.
- **§5 pure ops** → T4: all twelve ops + immutability + ≥1-frame guard + char auto-assign + cell-blanking ✓.
- **§6 UI** → T5: palette swatches (chars hidden), paint grid (click/drag/right-erase), frames strip (add/dup/del/reorder), live preview, meta, engine-gated Save/Revert ✓.
- **§7 entry points** → T6: "✎ edit" on `source==="saved"` tiles in Gallery + binding editor ✓.
- **§8 approval migration** → T1: data-driven `approved.json`, same flags as before; T3 auto-removes on save ✓.
- **§9 tests** → T1/T2/T4 unit-tested (RED-proven); T3 integration-tested; T5/T6 visual ✓.
- **Discriminating tests:** every op/validator/route test asserts a value the pre-change code cannot produce (missing exports / route returns 404). Verified RED at each task's run step.

**Controller does the live visual pass** (engine on :8787): open `frame-editor.html?name=goldfish`, paint a pixel, add/reorder a frame, add a color, edit timing, Save → confirm the file updated, the Gallery tile flipped to orange, and `git checkout` the throwaway changes after.

---

## Execution Handoff

Two execution options:
1. **Subagent-Driven (recommended)** — fresh implementer per task (T1/T2/T4 = cheap/transcription tier: fully-specified code; T3 = standard tier: TS engine integration; T5/T6 = standard tier: DOM glue), task review per task, opus whole-branch review at the end.
2. **Inline Execution** — batch with checkpoints.
