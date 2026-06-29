# Studio Re-Approval Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Studio mark a saved frame-expression **approved** (green) again — the inverse of the frame-editor's auto-un-approve — via a Gallery toggle and a frame-editor button, both hitting one new engine route.

**Architecture:** A pure `setApproval` helper (`scripts/approval.mjs`, TDD) mutates the approval set; the engine's `setApprovalValidated` (in `mcp_server/expression-api.ts`) writes `studio/approved.json` + regenerates `gallery-data.json` (reusing the expression-write machinery, extracted into a shared private regen helper); a `POST /api/approval/:name` route exposes it; the Gallery and frame-editor call it and update optimistically.

**Tech Stack:** Native ES modules, no bundler, no new deps. `node:test` + `node:assert/strict`. TypeScript engine (compiled via the existing `tsc` step in `npm test`).

## Global Constraints

- **Branch `feat/expression-studio`. No merge** — the repo cut is the final step of the whole arc.
- **No new runtime dependencies.** Native ES modules only. Reuse existing engine machinery.
- **Saved expressions only.** Approval applies only to a real saved expression (`mcp_server/expressions/<name>.json`); the engine returns **404** for an unknown name. Canned glyphs / firmware sims are not approvable here.
- **One route, body-driven:** `POST /api/approval/:name` with `{ approved: true|false }` (idempotent). A non-boolean `approved` → **400**.
- **Pure / no input mutation:** `setApproval(approvedObj, name, approved)` returns a NEW object, never mutating its input.
- **Byte-format parity:** `approved.json` is written `JSON.stringify(obj, null, 2) + "\n"` (matching how it is committed + how `writeExpressionValidated` already writes it); `gallery-data.json` is written `JSON.stringify(data, null, 2)` with **no** trailing newline (matching the CLI generator). An engine test that mutates the committed `approved.json` / `gallery-data.json` MUST restore BOTH byte-for-byte in `finally`.
- **Optimistic UI:** the Gallery toggle and frame-editor button flip on `{ok:true}` without re-fetching/re-rendering the whole gallery; the engine persists + regenerates server-side.
- **Engine-gated:** approval needs the engine; surfaces hide/disable the control when the engine isn't reachable (a `GET /api/manifest` probe), like the existing Save gate.
- **Privacy:** never the maintainer's real name; "the user".
- **`npm test` must stay green** (runs `check-manifest`, the `tsc` build, then the `node --test` globs over `scripts/`, `mcp_server/`, `shared/`, `studio/`).

---

## File Structure

- **Create** `scripts/approval.mjs` — pure `setApproval(approvedObj, name, approved)`.
- **Create** `scripts/approval.test.js` — helper unit tests.
- **Modify** `mcp_server/expression-api.ts` — extract a private `regenerateGalleryData`; add `ApprovalOpts` + `setApprovalValidated`.
- **Modify** `mcp_server/engine-server.ts` — add the `POST /api/approval/:name` route.
- **Modify** `mcp_server/engine-server.test.ts` — route integration test.
- **Modify** `studio/gallery.js` (+ `studio/index.html` CSS) — the Gallery approve toggle.
- **Modify** `studio/frame-editor.html` — the header approve button.

Task order: T1 (pure helper) → T2 (engine surface + route) → T3 (UI).

---

## Task 1: `scripts/approval.mjs` — pure approval-set helper

**Files:**
- Create: `scripts/approval.mjs`
- Test: `scripts/approval.test.js`

**Interfaces:**
- Produces: `setApproval(approvedObj, name, approved) -> { approved: string[], ... }` — returns a NEW object with `name` added (when `approved` truthy, no duplicate) or removed (when falsy); never mutates the input; tolerates a missing/non-array `approved` field (treats as empty).

- [ ] **Step 1: Write the failing tests** (create `scripts/approval.test.js`)

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { setApproval } from "./approval.mjs";

test("adds a name (no duplicate), removes a name, idempotently", () => {
  assert.deepEqual(setApproval({ approved: [] }, "x", true), { approved: ["x"] });
  assert.deepEqual(setApproval({ approved: ["x"] }, "x", true), { approved: ["x"] });   // no dup
  assert.deepEqual(setApproval({ approved: ["x", "y"] }, "x", false), { approved: ["y"] });
  assert.deepEqual(setApproval({ approved: ["y"] }, "x", false), { approved: ["y"] });   // remove absent = no-op
});

test("tolerates a missing/non-array approved field", () => {
  assert.deepEqual(setApproval({}, "x", true), { approved: ["x"] });
  assert.deepEqual(setApproval({ approved: "nope" }, "x", true), { approved: ["x"] });
});

test("does not mutate the input object", () => {
  const input = { approved: ["a"] }; const snap = JSON.stringify(input);
  setApproval(input, "b", true);
  assert.equal(JSON.stringify(input), snap);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/approval.test.js`
Expected: FAIL — module/export not found.

- [ ] **Step 3: Create `scripts/approval.mjs`**

```javascript
// scripts/approval.mjs — pure approval-set mutation for studio/approved.json. setApproval returns
// a NEW { approved: string[] } with `name` added (approved=true, no duplicate) or removed (false),
// never mutating the input. Imported by the engine's POST /api/approval write surface.

export function setApproval(approvedObj, name, approved) {
  const list = (approvedObj && Array.isArray(approvedObj.approved)) ? approvedObj.approved : [];
  const next = list.filter((n) => n !== name);   // drop any existing copy (prevents duplicates)
  if (approved) next.push(name);
  return { ...approvedObj, approved: next };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/approval.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/approval.mjs scripts/approval.test.js
git commit -m "feat(studio): pure setApproval helper for approved.json"
```

---

## Task 2: Engine approval write surface + `POST /api/approval/:name`

**Files:**
- Modify: `mcp_server/expression-api.ts`
- Modify: `mcp_server/engine-server.ts`
- Test: `mcp_server/engine-server.test.ts`

**Interfaces:**
- Consumes: `setApproval(approvedObj, name, approved)` from `scripts/approval.mjs` (Task 1, dynamic-imported by absolute file URL — the same pattern `expression-api.ts` already uses for the validator/generator); `buildGalleryData`/`loadCanned` from `scripts/build-gallery-data.mjs`.
- Produces: `setApprovalValidated(opts: ApprovalOpts) -> Promise<{ok:true; approved:boolean} | {ok:false; status:number; errors:string[]}>`; the route `POST /api/approval/:name`.

`ApprovalOpts`:
```
{ name: string; approved: boolean;
  expressionsDir, approvalHelperPath, generatorPath, cannedPath,
  manifestPath, boredDir, approvedPath, galleryDataPath: string }
```

- [ ] **Step 1: Write the failing test** (append to `mcp_server/engine-server.test.ts`)

The file already imports `readFileSync, writeFileSync, existsSync, rmSync` (added for the expression-route test) and defines `const MCP_DIR = path.dirname(fileURLToPath(import.meta.url))`. Reuse that harness. Append:

```typescript
test("POST /api/approval/:name toggles approved.json + regenerates gallery-data", async () => {
  const repo = path.join(MCP_DIR, "..");
  const exprPath = path.join(MCP_DIR, "expressions", "zzz-approve.json");
  const approvedPath = path.join(repo, "studio", "approved.json");
  const galleryPath = path.join(repo, "studio", "gallery-data.json");
  const blank = ["........","........","........","........","........","........","........","........"];
  writeFileSync(exprPath, JSON.stringify({ frames: [blank], colors: {}, frame_ms: 150, loop: 0, description: "seed" }, null, 2));
  const approvedRaw = readFileSync(approvedPath, "utf8");
  const galleryRaw = readFileSync(galleryPath, "utf8");

  const eng = await startEngineServer({ mcpDir: MCP_DIR, port: 0 });
  try {
    // approve
    const a = await fetch(`${eng.url}/api/approval/zzz-approve`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true }),
    });
    assert.equal(a.status, 200);
    assert.deepEqual(await a.json() as any, { ok: true, approved: true });
    assert.ok(JSON.parse(readFileSync(approvedPath, "utf8")).approved.includes("zzz-approve"));
    assert.equal(JSON.parse(readFileSync(galleryPath, "utf8")).expressions.find((e: any) => e.name === "zzz-approve").approved, true);

    // un-approve
    const u = await fetch(`${eng.url}/api/approval/zzz-approve`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: false }),
    });
    assert.equal(u.status, 200);
    assert.ok(!JSON.parse(readFileSync(approvedPath, "utf8")).approved.includes("zzz-approve"));

    // non-boolean body -> 400
    const bad = await fetch(`${eng.url}/api/approval/zzz-approve`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: "yes" }),
    });
    assert.equal(bad.status, 400);

    // unknown name -> 404
    const missing = await fetch(`${eng.url}/api/approval/does-not-exist`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: true }),
    });
    assert.equal(missing.status, 404);
  } finally {
    await eng.close();
    if (existsSync(exprPath)) rmSync(exprPath);
    writeFileSync(approvedPath, approvedRaw);   // restore byte-for-byte
    writeFileSync(galleryPath, galleryRaw);     // restore byte-for-byte (engine regen mutated it)
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `/api/approval/` route doesn't exist (falls through to the static server → 404 for the approve POST), so the `200` assert fails.

- [ ] **Step 3: Refactor `expression-api.ts` to extract the regen, and add the approval surface**

First, extract the gallery-data regen into a private helper. Find (the step-3 block of `writeExpressionValidated`):
```typescript
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
Replace with:
```typescript
  // 3. regenerate studio/gallery-data.json in-process (matches the CLI output exactly)
  await regenerateGalleryData(opts);

  return { ok: true };
}

// Shared gallery-data regen used by both write surfaces. Reads the compiled canned module + the
// manifest + bored dir + approved.json via the dynamic-imported generator, and writes the studio
// artifact with the SAME bytes the CLI `npm run build:gallery` produces (no trailing newline).
async function regenerateGalleryData(opts: {
  generatorPath: string; cannedPath: string; expressionsDir: string;
  manifestPath: string; boredDir: string; approvedPath: string; galleryDataPath: string;
}): Promise<void> {
  const gen = await import(pathToFileURL(opts.generatorPath).href);
  const canned = await gen.loadCanned(opts.cannedPath);
  const data = gen.buildGalleryData({
    canned, savedDir: opts.expressionsDir, manifestPath: opts.manifestPath,
    boredDir: opts.boredDir, approvedPath: opts.approvedPath,
  });
  await writeFile(opts.galleryDataPath, JSON.stringify(data, null, 2), "utf8");
}

export interface ApprovalOpts {
  name: string;
  approved: boolean;
  expressionsDir: string;
  approvalHelperPath: string;
  generatorPath: string;
  cannedPath: string;
  manifestPath: string;
  boredDir: string;
  approvedPath: string;
  galleryDataPath: string;
}

// Mark a saved expression approved (green) or not (orange). Edit-only: an unknown name is 404.
// Idempotent via the pure setApproval helper. Persists approved.json + regenerates gallery-data.
export async function setApprovalValidated(
  opts: ApprovalOpts,
): Promise<{ ok: true; approved: boolean } | { ok: false; status: number; errors: string[] }> {
  const file = path.join(opts.expressionsDir, `${opts.name}.json`);
  if (!existsSync(file)) return { ok: false, status: 404, errors: [`unknown expression: ${opts.name}`] };
  if (typeof opts.approved !== "boolean") return { ok: false, status: 400, errors: ["'approved' must be a boolean"] };

  const { setApproval } = await import(pathToFileURL(opts.approvalHelperPath).href);
  let approvedObj: any;
  try { approvedObj = JSON.parse(await readFile(opts.approvedPath, "utf8")); }
  catch { approvedObj = { approved: [] }; }
  const next = setApproval(approvedObj, opts.name, opts.approved);
  await writeFile(opts.approvedPath, JSON.stringify(next, null, 2) + "\n", "utf8");

  await regenerateGalleryData(opts);
  return { ok: true, approved: opts.approved };
}
```

- [ ] **Step 4: Add the route to `engine-server.ts`**

Add the import near the existing one (`import { writeExpressionValidated } from "./expression-api.js";`):
```typescript
import { writeExpressionValidated, setApprovalValidated } from "./expression-api.js";
```
Then insert this block immediately AFTER the `if (url.startsWith("/api/expression/")) { … }` block:
```typescript
      if (url.startsWith("/api/approval/")) {
        if (method !== "POST") { res.writeHead(405); res.end(); return; }
        const name = decodeURIComponent(url.slice("/api/approval/".length).split("?")[0]);
        let body: any;
        try { body = JSON.parse(await readBody(req)); }
        catch { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, errors: ["invalid JSON body"] })); return; }
        const result = await setApprovalValidated({
          name, approved: body?.approved,
          expressionsDir: path.join(mcpDir, "expressions"),
          approvalHelperPath: path.join(repoRoot, "scripts", "approval.mjs"),
          generatorPath: path.join(repoRoot, "scripts", "build-gallery-data.mjs"),
          cannedPath: path.join(mcpDir, "dist", "expressions.js"),
          manifestPath: path.join(mfDir, "manifest.json"),
          boredDir: path.join(repoRoot, "claude-hooks", "bored_animations"),
          approvedPath: path.join(base, "studio", "approved.json"),
          galleryDataPath: path.join(base, "studio", "gallery-data.json"),
        });
        const status = result.ok ? 200 : (result as any).status;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.ok ? { ok: true, approved: (result as any).approved } : { ok: false, errors: (result as any).errors }));
        return;
      }
```

- [ ] **Step 5: Run the test, then restore the committed artifacts**

Run: `npm test`
Expected: PASS (the new approval test + the existing expression-route test — which still passes, confirming the regen-extract refactor is correct — and the full suite).

The test restores `approved.json`/`gallery-data.json` in its `finally`, but run a clean rebuild to be certain the committed copies are pristine:
Run: `npm run build:gallery`
Then verify:
Run: `git status --porcelain studio/gallery-data.json studio/approved.json mcp_server/expressions/`
Expected: no `zzz-approve.json` under `mcp_server/expressions/`; `gallery-data.json`/`approved.json` clean (or only the formatting they already have).

- [ ] **Step 6: Commit**

```bash
git add mcp_server/expression-api.ts mcp_server/engine-server.ts mcp_server/engine-server.test.ts studio/gallery-data.json studio/approved.json
git commit -m "feat(engine): POST /api/approval/:name (toggle approved.json + regen)"
```

---

## Task 3: UI — Gallery approve toggle + frame-editor approve button

**Files:**
- Modify: `studio/gallery.js`
- Modify: `studio/index.html` (CSS)
- Modify: `studio/frame-editor.html`

**Interfaces:**
- Consumes: `POST /api/approval/:name { approved }` (Task 2). Reads each expression's `approved` flag + `source` from `gallery-data.json` (already loaded).

**Note:** browser glue — no unit test; the controller verifies visually on the engine-served Studio. The approve control appears only on `source:"saved"` expressions and only when the engine is reachable.

- [ ] **Step 1: Gallery — probe the engine + pass `canApprove` to cells** (`studio/gallery.js`)

Find (the start of `build()`, the gallery-data load):
```javascript
  const byGroup = { orphan: [], wired: [], canned: [], wait: [], ask: [], bored: [], firmware: [] };
  for (const e of data.expressions) (byGroup[e.group] ||= []).push(e);
```
Replace with:
```javascript
  // Approval needs the engine (the POST route). Probe once; if absent, the toggle is hidden.
  let canApprove = false;
  try { canApprove = (await fetch("/api/manifest")).ok; } catch { canApprove = false; }

  const byGroup = { orphan: [], wired: [], canned: [], wait: [], ask: [], bored: [], firmware: [] };
  for (const e of data.expressions) (byGroup[e.group] ||= []).push(e);
```

Find the saved-expression cell call:
```javascript
          const cv = cell(grid, it.name, it.description, group, it.approved, it.source === "saved");
```
Replace with:
```javascript
          const cv = cell(grid, it.name, it.description, group, it.approved, it.source === "saved", canApprove);
```

- [ ] **Step 2: Gallery — add the approve toggle inside `cell()`** (`studio/gallery.js`)

Find the `cell` signature and the edit-link block:
```javascript
function cell(grid, name, desc, group, approved, editable) {
```
Replace with:
```javascript
function cell(grid, name, desc, group, approved, editable, canApprove) {
```
Then find:
```javascript
  if (editable) { const ed = document.createElement("a"); ed.className = "editlink"; ed.href = `./frame-editor.html?name=${encodeURIComponent(name)}`;
    ed.textContent = "✎ edit"; ed.title = "Edit this expression"; el.appendChild(ed); }
```
Replace with:
```javascript
  if (editable) { const ed = document.createElement("a"); ed.className = "editlink"; ed.href = `./frame-editor.html?name=${encodeURIComponent(name)}`;
    ed.textContent = "✎ edit"; ed.title = "Edit this expression"; el.appendChild(ed); }
  if (editable && canApprove) {
    let isApproved = approved;
    const tg = document.createElement("button"); tg.className = "approvetoggle";
    const paint = () => { tg.textContent = isApproved ? "✓ approved" : "○ approve"; tg.classList.toggle("on", isApproved); };
    paint();
    tg.onclick = async () => {
      tg.disabled = true;
      try {
        const r = await fetch(`/api/approval/${encodeURIComponent(name)}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: !isApproved }),
        });
        const res = await r.json();
        if (res.ok) {
          isApproved = res.approved;
          el.classList.toggle("approved", isApproved);
          let ck = el.querySelector(".check");
          if (isApproved && !ck) { ck = document.createElement("div"); ck.className = "check"; ck.textContent = "✓"; ck.title = "Approved / done"; el.insertBefore(ck, el.firstChild); }
          else if (!isApproved && ck) { ck.remove(); }
          paint();
        }
      } catch { /* leave state unchanged on network error */ }
      tg.disabled = false;
    };
    el.appendChild(tg);
  }
```

- [ ] **Step 3: Gallery — add the toggle CSS** (`studio/index.html`)

Find the `.editlink` rule appended to `studio/index.html`'s `<style>` (added in the prior plan):
```css
    .editlink { display:inline-block; margin-top:3px; font-size:.6rem; color:var(--cyan,#22ddff); text-decoration:none; }
    .editlink:hover { text-decoration:underline; }
```
Replace with:
```css
    .editlink { display:inline-block; margin-top:3px; font-size:.6rem; color:var(--cyan,#22ddff); text-decoration:none; }
    .editlink:hover { text-decoration:underline; }
    .approvetoggle { display:block; margin-top:4px; font:inherit; font-size:.58rem; cursor:pointer;
      color:#9a9aa8; background:#15151b; border:1px solid #2a2a34; border-radius:6px; padding:2px 6px; }
    .approvetoggle:hover { color:#e8e8ef; }
    .approvetoggle.on { color:#9affc8; border-color:#16a34a; }
    .approvetoggle:disabled { opacity:.5; cursor:default; }
```
(If the exact `.editlink` block text differs, append the `.approvetoggle` rules just before the closing `</style>` of `studio/index.html` instead.)

- [ ] **Step 4: Frame-editor — add the approve button to the header** (`studio/frame-editor.html`)

Find:
```html
    <button id="revert">Revert</button>
    <button id="save" class="save">Save</button>
```
Replace with:
```html
    <button id="approve">○ approve</button>
    <button id="revert">Revert</button>
    <button id="save" class="save">Save</button>
```

- [ ] **Step 5: Frame-editor — wire the approve button** (`studio/frame-editor.html`)

Find the element grabs:
```javascript
    const saveBtn = document.getElementById("save");
    const revertBtn = document.getElementById("revert");
```
Replace with:
```javascript
    const saveBtn = document.getElementById("save");
    const revertBtn = document.getElementById("revert");
    const approveBtn = document.getElementById("approve");
```

Find the state declaration:
```javascript
    let expr = null, original = null, activeFrame = 0, brush = ".", readOnly = false, dirty = false;
```
Replace with:
```javascript
    let expr = null, original = null, activeFrame = 0, brush = ".", readOnly = false, dirty = false, approved = false;
```

Add a `paintApprove` helper + button handler — insert immediately after the `revertBtn.onclick = …` line:
```javascript
    function paintApprove() { approveBtn.textContent = approved ? "✓ approved" : "○ approve"; approveBtn.classList.toggle("save", approved); approveBtn.disabled = readOnly; }
    approveBtn.onclick = async () => {
      if (readOnly) return;
      approveBtn.disabled = true;
      try {
        const r = await fetch(`/api/approval/${encodeURIComponent(NAME)}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: !approved }),
        });
        const res = await r.json();
        if (res.ok) approved = res.approved;
      } catch { /* leave state unchanged */ }
      paintApprove();
    };
```

In the save handler, set `approved = false` after a successful save (the server un-approves) — find:
```javascript
        if (res.ok) { original = JSON.parse(JSON.stringify(expr)); setDirty(false); statusEl.textContent = "saved — now pending re-review (orange)"; }
```
Replace with:
```javascript
        if (res.ok) { original = JSON.parse(JSON.stringify(expr)); setDirty(false); approved = false; paintApprove(); statusEl.textContent = "saved — now pending re-review (orange)"; }
```

In `boot()`, capture the loaded approval state and paint the button — find:
```javascript
      expr = { description: found.description || "", frames: found.frames, colors: found.colors || {}, frame_ms: found.frame_ms || 150, loop: found.loop ?? 0 };
      original = JSON.parse(JSON.stringify(expr));
```
Replace with:
```javascript
      expr = { description: found.description || "", frames: found.frames, colors: found.colors || {}, frame_ms: found.frame_ms || 150, loop: found.loop ?? 0 };
      original = JSON.parse(JSON.stringify(expr));
      approved = !!found.approved;
```

At the end of `boot()`, find:
```javascript
      setDirty(false); renderAll();
    }
```
Replace with:
```javascript
      setDirty(false); renderAll(); paintApprove();
    }
```

- [ ] **Step 6: Run the full suite + commit**

Run: `npm test`
Expected: PASS (unchanged — this task is browser glue).

```bash
git add studio/gallery.js studio/index.html studio/frame-editor.html
git commit -m "feat(studio): approve toggle (Gallery) + approve button (frame editor)"
```

---

## Self-Review (controller, after all tasks)

Against `docs/superpowers/specs/2026-06-27-reapproval-toggle-design.md`:

- **§3 route** → T2: `POST /api/approval/:name`, 404 unknown, 400 non-boolean, idempotent, regen ✓.
- **§4 pure helper** → T1: `setApproval` add/remove idempotent, no-mutation, tolerant of missing field ✓.
- **§5 Gallery toggle** → T3: saved+engine-only, optimistic flip of class/badge/label ✓.
- **§6 frame-editor button** → T3: reflects loaded state, re-approves, `approved=false` after Save, disabled in read-only ✓.
- **§7 byte-format parity + finally-restore** → T2 writes `approved.json` with `+ "\n"`, regen without; test restores both ✓.
- **Discriminating tests:** T1 asserts exact resulting objects (no-op vs mutation); T2 asserts 200/{approved} + on-disk approved.json + gallery `approved` flag + 400 + 404 — all impossible before the route exists (RED-proven at each task's run step).

**Controller live pass** (engine on :8787): in the Gallery, toggle a saved tile → it flips green⟷orange and the engine persists; in the frame editor, Save an edit (button → "approve") then click approve (→ "✓ approved"); confirm `approved.json`/`gallery-data.json` updated, then `git checkout` any throwaway changes.

---

## Execution Handoff

Two execution options:
1. **Subagent-Driven (recommended)** — fresh implementer per task (T1 = cheap/transcription tier; T2 = standard, TS engine; T3 = standard, DOM glue), task review per task, opus whole-branch review at the end.
2. **Inline Execution** — batch with checkpoints.
