# Trigger Manifest Plan 3b — The Live Flips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip every live consumer (the Studio gallery classifier, the MCP `matrix_express("wait")` / `presence_set` / `matrix_idle` handlers, and the Claude Code Python hook) off its scattered ad-hoc config and onto `shared/manifest.json` + the shared resolver, then delete the dead config — leaving the manifest the single source of truth.

**Architecture:** The shared **resolver** (`shared/resolver.js`, mirrored in `claude-hooks/manifest_resolver.py`) is the one brain that turns moment→intent→a concrete animation pick. Each *engine* keeps rendering with its own already-proven board I/O: the MCP server resolves, then dispatches to `/api/display/{animation,frames}` + `/api/brightness`; the Python hook resolves, then POSTs the same. A new pure `shared/firmware-names.js` tells both engines which picks are firmware animations (→ `/api/display/animation`, transient) vs frame-expressions (→ `/api/display/frames`). The gallery is read-only: it re-derives each expression's rotation role from the manifest's bindings instead of name prefixes (so "orphan" now means "unbound by the manifest"). The `.mcpb` packs only `mcp_server/`, so a build step copies the resolver + manifest into the bundle and the MCP loads them repo-first (dev) / bundle-fallback (installed).

**Tech Stack:** Node ESM (`shared/*.js`, `scripts/*.mjs`), TypeScript→`dist` (MCP server, Node16 modules, strict), Python 3 stdlib (hooks), `node --test`, JSON Schema + `scripts/check-manifest.mjs`.

## Global Constraints

- **Privacy:** never use the maintainer's real name in code, comments, or docs — refer to "the user". This repo is distributable.
- **Single source of truth:** `shared/manifest.json` is the ONLY place moment→intent→renderer config lives after this plan. Do not introduce a new scattered config or a third copy of the resolver logic. The JS resolver (`shared/resolver.js`) and the Python mirror (`claude-hooks/manifest_resolver.py`) are the ONLY duplicated logic; both are proven against `shared/resolver-fixtures.json` — keep them in lockstep and do NOT edit resolver logic in this plan.
- **`FIRMWARE_NAMES` is mirrored** JS↔Python (`shared/firmware-names.js` ↔ a literal set in `claude-hooks/matrix_signal.py`); keep the two in sync.
- **Board-state safety:** launch firmware animations with `transient: true` so a busy/idle indicator never overwrites the user's NVS boot animation.
- **Never blank the board:** a resolve/render miss must degrade to a safe glyph (`working` for the busy path, `info`/`smiley` for presence) — never leave the panel dark and never throw. The hooks already "fail silently (exit 0) if the board is unreachable"; preserve that.
- **Distributable bundle:** the `.mcpb` must function with NO `../shared` present (it bundles `mcp_server/shared-runtime/`), and is always built with `secrets.h` ABSENT (`scripts/build-release.mjs` refuses otherwise). The packaging task here makes the *installed* extension self-sufficient — verify it, do not assume "works in the repo" = "works installed" (see the v1.0 installability lesson).
- **Green gates:** at every task boundary, BOTH `npm test` (runs `node scripts/check-manifest.mjs && node --test "scripts/**/*.test.js" "mcp_server/**/*.test.ts" "shared/**/*.test.js"`) AND `npm run build:mcpb` (runs `copy-shared-runtime` + `tsc` + pack, after Task 9) must pass.
- **D1 — LIVE BOARD BEHAVIOR CHANGES (hardware-verify before merge):** this plan makes presence/idle adopt the manifest's bindings, which DIFFER from today's live behavior. The branch `feat/expression-studio` must NOT be merged until verified on the physical board. The specific changes are listed in the "D1 hardware-verification checklist" at the end of this plan.
- **Hook live-copy discipline:** `claude-hooks/*.py` have LIVE installed copies at `~/.claude/hooks/`. Editing `matrix_signal.py` or `manifest_resolver.py` requires updating BOTH the repo copy and the live copy. Changing `claude-hooks/settings.hooks.snippet.json` requires re-merging it into `~/.claude/settings.json` (hooks load at session start). These are manual deploy steps the user performs — call them out, do not attempt them from a subagent.
- **TDD:** every behavior change lands a test that FAILS before the change (discriminates). Plan-supplied tests that pass against the old code prove nothing — confirm the RED step actually fails (this bit Plan 3a twice).

---

### Task 1: `shared/firmware-names.js` — single source of firmware animation names

**Files:**
- Create: `shared/firmware-names.js`
- Test: `shared/firmware-names.test.js`

**Interfaces:**
- Produces: `FIRMWARE_NAMES: Set<string>` and `isFirmwareName(name: string) => boolean`. Consumed by Task 5 (MCP engine) and mirrored as a literal in Task 8 (Python hook).

- [ ] **Step 1: Write the failing test**

`shared/firmware-names.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRMWARE_NAMES, isFirmwareName } from "./firmware-names.js";

test("firmware names include every idle + working pool member", () => {
  for (const n of ["fire", "dancefloor", "fireworks", "clock", "frostbite", "matrix_rain", "snow", "claudesweep"])
    assert.ok(isFirmwareName(n), `${n} is a firmware animation`);
});

test("frame-expression names are NOT firmware", () => {
  for (const n of ["wait-claude", "working", "ask-question", "done", "skull", "wait-logo-boot"])
    assert.equal(isFirmwareName(n), false, `${n} is not firmware`);
});

test("FIRMWARE_NAMES is a Set covering the matrix_set_animation enum", () => {
  assert.ok(FIRMWARE_NAMES instanceof Set);
  assert.ok(FIRMWARE_NAMES.has("starfield") && FIRMWARE_NAMES.has("timer_text"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test shared/firmware-names.test.js`
Expected: FAIL — `Cannot find module './firmware-names.js'`.

- [ ] **Step 3: Write minimal implementation**

`shared/firmware-names.js`:
```js
// shared/firmware-names.js
// Single source of truth for FIRMWARE animation type names — the names launched via
// POST /api/display/animation (the firmware renders them) rather than pushed as
// frame-expressions via POST /api/display/frames. The manifest engines use this to
// pick the wire path for a resolved animation name.
// MIRRORED as a literal set in claude-hooks/matrix_signal.py (FIRMWARE_NAMES); keep
// the two in sync. (Source list = the matrix_set_animation enum in mcp_server/index.ts.)
export const FIRMWARE_NAMES = new Set([
  "fire", "rainbow", "breathe", "wave", "solid", "liquid", "imu", "chiptemp",
  "weather", "timer_fill", "timer_snow", "timer_text", "clock", "matrix_rain",
  "snow", "dancefloor", "spiral", "starfield", "fireworks", "fireworks2",
  "comet", "sun", "frostbite", "calendar", "sound", "claudesweep",
]);

export function isFirmwareName(name) {
  return FIRMWARE_NAMES.has(name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test shared/firmware-names.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/firmware-names.js shared/firmware-names.test.js
git commit -m "feat(manifest): add shared/firmware-names.js single-source firmware list"
```

---

### Task 2: Manifest fidelity — faithful `working` pool + presence intent vocab

Make the seed manifest a faithful characterization of today's live behavior BEFORE anything flips: (a) the `working` pool must contain all 9 live wait-pool members with their exact weights from `mcp_server/wait-weights.json`; (b) the intent vocab must cover the presence intents `ok` and `question` (today they map via `INTENT_TO_CANNED`; without manifest entries they would resolve to a blank board).

**Files:**
- Modify: `shared/manifest.json` (intents map + `esp32-8x8` → `working` binding)
- Test: `shared/manifest.test.js` (add cases)

**Interfaces:**
- Consumes: `resolve`, `effectiveBindings` from `shared/resolver.js` (already imported by the test).
- Produces: the faithful manifest consumed by Tasks 3–8.

**Reference — the exact live weights** (`mcp_server/wait-weights.json` → `weights`): `wait-claude:40, wait-rainbow:30, wait-orbit:20, claudesweep:20, working:10, wait-logo-breathe:8, wait-logo-chase:8, wait-logo-boot:8, wait-logo-ripple:8`.

- [ ] **Step 1: Write the failing tests**

Append to `shared/manifest.test.js`:
```js
test("seed manifest: working pool is faithful to wait-weights.json (9 members, exact weights)", () => {
  const b = effectiveBindings(MANIFEST, "esp32-8x8");
  assert.deepEqual(b.working, { pool: {
    "wait-claude": 40, "wait-rainbow": 30, "wait-orbit": 20, "claudesweep": 20,
    "working": 10, "wait-logo-breathe": 8, "wait-logo-chase": 8,
    "wait-logo-boot": 8, "wait-logo-ripple": 8,
  } });
});

test("seed manifest: presence intent 'ok' resolves (ok -> approve -> done -> 'done')", () => {
  const got = resolve(MANIFEST, { renderer: "esp32-8x8", intent: "ok" });
  assert.deepEqual(got, { intent: "done", value: "done" });
});

test("seed manifest: presence intent 'question' resolves (question -> awaiting-input -> 'ask-question')", () => {
  const got = resolve(MANIFEST, { renderer: "esp32-8x8", intent: "question" });
  assert.deepEqual(got, { intent: "awaiting-input", value: "ask-question" });
});
```

Also UPDATE the existing `"a working pool pick returns a pool member"` test's allow-list to include the logo variants:
```js
test("seed manifest: a working pool pick returns a pool member", () => {
  const got = resolve(MANIFEST, { renderer: "esp32-8x8", intent: "working" }, { rng: () => 0 });
  assert.ok([
    "working", "wait-claude", "wait-rainbow", "wait-orbit", "claudesweep",
    "wait-logo-breathe", "wait-logo-chase", "wait-logo-boot", "wait-logo-ripple",
  ].includes(got.value));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test shared/manifest.test.js`
Expected: FAIL — the `working` pool deepEqual fails (only 5 members today), and `ok`/`question` resolve to `null` (intents absent).

- [ ] **Step 3: Make the manifest changes**

In `shared/manifest.json`, add two intents to the `intents` object (place after `"approve"` for readability):
```json
    "ok":             { "fallback": "approve",        "doc": "acknowledged" },
    "question":       { "fallback": "awaiting-input", "doc": "asking the human" },
```

And replace the `esp32-8x8` → `working` binding with the faithful 9-member pool:
```json
        "working":        { "pool": { "wait-claude": 40, "wait-rainbow": 30, "wait-orbit": 20, "claudesweep": 20, "working": 10, "wait-logo-breathe": 8, "wait-logo-chase": 8, "wait-logo-boot": 8, "wait-logo-ripple": 8 } },
```

- [ ] **Step 4: Run tests + the validator to verify green**

Run: `node --test shared/manifest.test.js && node scripts/check-manifest.mjs`
Expected: all manifest tests PASS; validator prints `manifest OK` (the new intents' fallback chains `ok→approve→done` and `question→awaiting-input→attention` both terminate at a root; pool weights ≥ 0).

- [ ] **Step 5: Run the parity suite (resolver logic unchanged, must stay green)**

Run: `node --test shared/resolver.test.js shared/resolver-parity.test.js && python -m unittest discover -s claude-hooks -p "*_test.py" 2>/dev/null || python claude-hooks/manifest_resolver_test.py`
Expected: PASS. (If the Python parity test has a different invocation, use whatever `npm test`/CI uses; the point is JS↔Python parity is unaffected — this task only adds manifest DATA.)

- [ ] **Step 6: Commit**

```bash
git add shared/manifest.json shared/manifest.test.js
git commit -m "fix(manifest): faithful 9-member working pool + ok/question presence intents"
```

---

### Task 3: Gallery classifier — manifest-driven rotation roles in `shared/catalog.js`

Rewrite `catalog.js` so an expression's rotation role comes from the manifest's `esp32-8x8` bindings (not name prefixes). New roles: `wait` (in the `working` pool), `ask` (bound to `awaiting-input`/`attention`), `bored` (the host-side bored-watcher lineup — still by directory membership, since the manifest's `idle` pool is firmware apps, an orthogonal system), `wired` (bound to any OTHER manifest intent), `canned` (a canned glyph bound to nothing), `orphan` (a saved expression bound to nothing).

**Files:**
- Modify (rewrite): `shared/catalog.js`
- Test (rewrite): `shared/catalog.test.js`

**Interfaces:**
- Consumes: `effectiveBindings` from `shared/resolver.js`.
- Produces:
  - `manifestRoles(manifest, rendererId = "esp32-8x8") => Map<string, "wait"|"ask"|"bored"|"wired">` — name→role from bindings.
  - `classifyExpression(name, ctx) => "wait"|"ask"|"bored"|"wired"|"canned"|"orphan"` where `ctx = { roles: Map, boredNames: Set, cannedNames: Set }`.
  - `buildCatalog(names, ctx) => { wait, ask, bored, wired, canned, orphan }`.
  Consumed by Task 4 (`scripts/build-gallery-data.mjs`).

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `shared/catalog.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { manifestRoles, classifyExpression, buildCatalog } from "./catalog.js";

// A compact manifest exercising every role source.
const MANIFEST = {
  intents: {
    info: { root: true }, working: { root: true }, done: { root: true },
    attention: { root: true }, fail: { root: true }, idle: { root: true },
    "awaiting-input": { fallback: "attention" }, celebrate: { fallback: "done" },
    fatal: { fallback: "error" }, error: { fallback: "fail" },
  },
  renderers: {
    "esp32-8x8": { bindings: {
      info: "smiley",
      working: { pool: { working: 10, "wait-claude": 40 } },
      done: "done",
      attention: "ask-attention",
      "awaiting-input": "ask-question",
      fail: "cross",
      idle: { pool: { fire: 1, snow: 1 } },
      celebrate: { pool: { party: 1, confetti: 1 } },
      fatal: "skull",
    } },
  },
};

const roles = manifestRoles(MANIFEST);

test("manifestRoles maps pool + single bindings to rotation roles", () => {
  assert.equal(roles.get("wait-claude"), "wait");   // working pool
  assert.equal(roles.get("ask-question"), "ask");    // awaiting-input
  assert.equal(roles.get("ask-attention"), "ask");   // attention
  assert.equal(roles.get("confetti"), "wired");      // celebrate (other intent)
  assert.equal(roles.get("skull"), "wired");         // fatal (other intent)
  assert.equal(roles.get("done"), "wired");          // done (other intent)
  assert.equal(roles.get("fire"), "bored");          // idle pool -> bored role
});

test("classifyExpression: manifest role wins, then bored dir, then canned, else orphan", () => {
  const ctx = {
    roles,
    boredNames: new Set(["pacman", "dizzy"]),
    cannedNames: new Set(["smiley", "done", "cross", "party", "sparkle", "working"]),
  };
  assert.equal(classifyExpression("wait-claude", ctx), "wait");
  assert.equal(classifyExpression("ask-question", ctx), "ask");
  assert.equal(classifyExpression("skull", ctx), "wired");
  assert.equal(classifyExpression("pacman", ctx), "bored");     // host watcher dir
  assert.equal(classifyExpression("sparkle", ctx), "canned");   // canned, unbound
  assert.equal(classifyExpression("goldfish", ctx), "orphan");  // saved, unbound
});

test("buildCatalog buckets names into the six roles", () => {
  const ctx = { roles, boredNames: new Set(["pacman"]), cannedNames: new Set(["sparkle"]) };
  const cat = buildCatalog(["wait-claude", "ask-question", "skull", "pacman", "sparkle", "goldfish"], ctx);
  assert.deepEqual(cat.wait, ["wait-claude"]);
  assert.deepEqual(cat.ask, ["ask-question"]);
  assert.deepEqual(cat.wired, ["skull"]);
  assert.deepEqual(cat.bored, ["pacman"]);
  assert.deepEqual(cat.canned, ["sparkle"]);
  assert.deepEqual(cat.orphan, ["goldfish"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test shared/catalog.test.js`
Expected: FAIL — `manifestRoles` is not exported (old `catalog.js` has `classifyExpression(name, ctx)` with `waitNames`/`boredNames` prefixes only).

- [ ] **Step 3: Rewrite `shared/catalog.js`**

```js
// Maps an expression name to the Studio rotation role it plays, derived from the
// Trigger Manifest's bindings (the single source of truth). "bored" is the one role
// still taken from directory membership: the host-side bored-watcher lineup
// (claude-hooks/bored_animations/ played by matrix_idle.py) is an orthogonal system,
// distinct from the manifest's `idle` binding (firmware screensaver apps).
import { effectiveBindings } from "./resolver.js";

// Which manifest intent a name binds to maps to a coarse rotation role.
const INTENT_ROLE = { working: "wait", "awaiting-input": "ask", attention: "ask", idle: "bored" };
// Priority when a name is referenced by multiple intents (lower wins).
const RANK = { wait: 0, ask: 1, bored: 2, wired: 3 };

// The animation names a binding references: a single value or every pool key.
// (Object bindings like the card's {glyph,text,color} reference no animation name.)
function bindingNames(binding) {
  if (binding == null) return [];
  if (typeof binding === "string") return [binding];
  if (typeof binding === "object" && binding.pool) return Object.keys(binding.pool);
  return [];
}

// name -> role, built from a renderer's effective (inheritance-merged) bindings.
export function manifestRoles(manifest, rendererId = "esp32-8x8") {
  const roles = new Map();
  const bindings = effectiveBindings(manifest, rendererId);
  for (const [intent, binding] of Object.entries(bindings)) {
    const role = INTENT_ROLE[intent] || "wired";
    for (const name of bindingNames(binding)) {
      const cur = roles.get(name);
      if (!cur || RANK[role] < RANK[cur]) roles.set(name, role);
    }
  }
  return roles;
}

// ctx: { roles: Map (from manifestRoles), boredNames: Set, cannedNames: Set }.
export function classifyExpression(name, ctx) {
  const role = ctx.roles && ctx.roles.get(name);
  if (role) return role;
  if (ctx.boredNames && ctx.boredNames.has(name)) return "bored";
  if (ctx.cannedNames && ctx.cannedNames.has(name)) return "canned";
  return "orphan";
}

export function buildCatalog(names, ctx) {
  const cat = { wait: [], ask: [], bored: [], wired: [], canned: [], orphan: [] };
  for (const name of names) cat[classifyExpression(name, ctx)].push(name);
  return cat;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test shared/catalog.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/catalog.js shared/catalog.test.js
git commit -m "feat(studio): manifest-driven rotation-role classifier in catalog.js"
```

---

### Task 4: Gallery flip — `build-gallery-data.mjs`, `studio/gallery.js`, studio CSS

Make the gallery builder feed the manifest into the new classifier (orphan now = manifest-unbound), and render the new `wired` group. Read-only: no board behavior.

**Files:**
- Modify: `scripts/build-gallery-data.mjs`
- Modify: `studio/gallery.js`
- Modify: `studio/index.html` (badge CSS)
- Regenerate: `studio/gallery-data.json` (via `npm run build:gallery`)
- Test (update): `scripts/build-gallery-data.test.js`

**Interfaces:**
- Consumes: `manifestRoles`, `classifyExpression` from `shared/catalog.js`; the real `shared/manifest.json`.
- `buildGalleryData` signature changes: `waitWeightsPath` → `manifestPath`. New param shape: `{ canned, savedDir, manifestPath, boredDir }`.

- [ ] **Step 1: Update the failing test**

In `scripts/build-gallery-data.test.js`: change the call to pass `manifestPath` instead of `waitWeightsPath`, update the orphan expectations (manifest-bound names move OUT of orphan), and allow the `wired` group.

Replace the test body's `buildGalleryData({...})` call:
```js
  const data = buildGalleryData({
    canned,
    savedDir: join(ROOT, "mcp_server/expressions"),
    manifestPath: join(ROOT, "shared/manifest.json"),
    boredDir: join(ROOT, "claude-hooks/bored_animations"),
  });
```

Replace the orphan + role assertions block with:
```js
  // Orphan = saved AND unbound by the manifest. The unwired v1 library lands here…
  const orphans = data.expressions.filter((e) => e.group === "orphan").map((e) => e.name);
  for (const n of ["claude-idle", "idea", "task-complete", "goldfish"])
    assert.ok(orphans.includes(n), `${n} is an unwired orphan`);

  // …but a manifest-BOUND saved expression is NOT an orphan — it is wired.
  const groupOf = (n) => data.expressions.find((e) => e.name === n)?.group;
  assert.equal(groupOf("skull"), "wired", "skull is bound to fatal -> wired, not orphan");
  assert.equal(groupOf("swarm-merge"), "wired", "swarm-merge is bound to results-merged -> wired");

  // Rotation roles from the manifest:
  assert.equal(groupOf("wait-claude"), "wait", "in the working pool -> wait");
  assert.equal(groupOf("ask-question"), "ask", "bound to awaiting-input -> ask");
  assert.equal(groupOf("sparkle"), "canned", "canned + unbound -> canned");
  assert.equal(groupOf("pacman"), "bored", "host bored-watcher dir -> bored");

  for (const e of data.expressions) {
    assert.ok(Array.isArray(e.frames) && e.frames.length > 0, `${e.name} has frames`);
    assert.ok(["wait","ask","bored","wired","orphan","canned"].includes(e.group), `${e.name} grouped`);
  }
```
(Keep the `data.firmware.length === 7` assertion as-is.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/build-gallery-data.test.js`
Expected: FAIL — `buildGalleryData` still expects `waitWeightsPath`/old grouping; `skull` is currently `orphan`, not `wired`.

- [ ] **Step 3: Update `scripts/build-gallery-data.mjs`**

Change the import and the `buildGalleryData` function. Replace the top import line:
```js
import { manifestRoles, classifyExpression } from "../shared/catalog.js";
```

Replace `buildGalleryData` with:
```js
export function buildGalleryData({ canned, savedDir, manifestPath, boredDir }) {
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

  // Classify every unique name by manifest-derived rotation role. Orphan = saved AND
  // unbound by the manifest (the unwired v1 library + {claude-idle, idea}).
  const expressions = [];
  const groups = { wait: [], ask: [], bored: [], wired: [], canned: [], orphan: [] };
  const ctx = { roles, boredNames, cannedNames };
  for (const [name, data] of byName) {
    const group = classifyExpression(name, ctx);
    expressions.push({ name, ...data, group, approved: APPROVED.has(name) });
    groups[group].push(name);
  }

  return { expressions, firmware: FIRMWARE, groups };
}
```

Update `main()`'s call + the summary log:
```js
  const data = buildGalleryData({
    canned,
    savedDir: join(root, "mcp_server/expressions"),
    manifestPath: join(root, "shared/manifest.json"),
    boredDir: join(root, "claude-hooks/bored_animations"),
  });
  writeFileSync(join(root, "studio/gallery-data.json"), JSON.stringify(data, null, 2));
  console.log(`gallery-data.json: ${data.expressions.length} expressions, ${data.firmware.length} firmware sims`);
  console.log(`groups: wait=${data.groups.wait.length}, ask=${data.groups.ask.length}, bored=${data.groups.bored.length}, wired=${data.groups.wired.length}, canned=${data.groups.canned.length}, orphan=${data.groups.orphan.length}`);
  console.log(`orphans: [${data.groups.orphan.join(", ")}]`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/build-gallery-data.test.js`
Expected: PASS.

- [ ] **Step 5: Add the `wired` group to the Studio UI**

In `studio/gallery.js`, update the group order, titles, and bucket init:
```js
const GROUP_ORDER = ["orphan", "wired", "canned", "wait", "ask", "bored", "firmware"];
const GROUP_TITLE = {
  orphan:   "Orphans — no rotation",
  wired:    "Wired (other moments)",
  canned:   "Canned glyphs (matrix_express)",
  wait:     "Wait pool",
  ask:      "Ask / attention",
  bored:    "Bored pool",
  firmware: "Firmware animations",
};
```
And the `byGroup` initializer:
```js
  const byGroup = { orphan: [], wired: [], canned: [], wait: [], ask: [], bored: [], firmware: [] };
```

In `studio/index.html`, add a badge color rule next to the other `.badge.*` rules (around line 185–195):
```css
  .badge.wired    { color: #9ab0c8;        border-color: #2a3645; }
```

- [ ] **Step 6: Regenerate gallery data and sanity-check counts**

Run: `npm run build:gallery`
Expected: prints the new `groups:` line including `wired=…`; `orphans: [...]` no longer contains `skull`/`swarm-merge`/`galaxy`/`black-hole`/`aurora`/`confetti` (those are now `wired`), and still contains the unwired v1 library + `claude-idle`, `idea`.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-gallery-data.mjs scripts/build-gallery-data.test.js studio/gallery.js studio/index.html studio/gallery-data.json
git commit -m "feat(studio): gallery groups derived from the manifest (orphan = unbound)"
```

---

### Task 5: MCP engine bootstrap + flip `matrix_express("wait")`

Create a pure, testable render-decision module and a manifest/resolver loader, then flip the `"wait"` group to resolve via the manifest's `working` intent.

**Files:**
- Create: `mcp_server/engine.ts`
- Test: `mcp_server/engine.test.ts`
- Modify: `mcp_server/index.ts` (imports, bootstrap helpers, `matrix_express` handler)

**Interfaces:**
- `engine.ts` produces:
  - `interface Resolved { intent: string; value: unknown; params?: Record<string, unknown>; label?: string; brightness?: number }`
  - `type RenderPlan = { kind: "animation"; type: string; params: Record<string, unknown>; brightness?: number } | { kind: "frames"; name: string; brightness?: number } | { kind: "noop" }`
  - `decideRender(resolved: Resolved | null, isFirmware: (n: string) => boolean): RenderPlan` (PURE)
  - `engineDir(mcpDir: string): string` — repo `../shared` if present, else `<mcpDir>/shared-runtime`
  - `loadEngine(mcpDir: string): Promise<{ manifest: any; resolve: Function; isFirmwareName: (n: string) => boolean }>`
- `index.ts` adds (consumed by Tasks 6–7): module `renderCtx = { last: {} }`, `engine()` (memoized `loadEngine`), `runPlan(plan)`, `renderIntent({intent?,moment?,harness?})`.

- [ ] **Step 1: Write the failing test**

`mcp_server/engine.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRender, engineDir } from "./engine.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isFw = (n: string) => ["fire", "claudesweep", "clock"].includes(n);

test("firmware value -> transient animation plan with params + brightness", () => {
  const plan = decideRender({ intent: "idle", value: "fire", params: { speed: 50 }, brightness: 5 }, isFw);
  assert.deepEqual(plan, { kind: "animation", type: "fire", params: { speed: 50 }, brightness: 5 });
});

test("frame-expression value -> frames plan (no params, no brightness)", () => {
  const plan = decideRender({ intent: "working", value: "wait-claude" }, isFw);
  assert.deepEqual(plan, { kind: "frames", name: "wait-claude" });
});

test("frame-expression value carries brightness when present", () => {
  const plan = decideRender({ intent: "x", value: "done", brightness: 5 }, isFw);
  assert.deepEqual(plan, { kind: "frames", name: "done", brightness: 5 });
});

test("null / non-string value -> noop", () => {
  assert.deepEqual(decideRender(null, isFw), { kind: "noop" });
  assert.deepEqual(decideRender({ intent: "x", value: 42 } as any, isFw), { kind: "noop" });
});

test("engineDir falls back to <mcpDir>/shared-runtime when no ../shared", () => {
  const fake = join(tmpdir(), "no-such-mcp-dir-3b");
  assert.ok(engineDir(fake).endsWith("shared-runtime"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test mcp_server/engine.test.ts`
Expected: FAIL — `Cannot find module './engine.ts'`.

- [ ] **Step 3: Implement `mcp_server/engine.ts`**

```ts
// mcp_server/engine.ts — the bridge from the shared Trigger Manifest resolver to the
// board's HTTP API. The resolver (shared/resolver.js) is the single brain; this module
// only decides HOW to render a resolved pick and WHERE to load the manifest/resolver from.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface Resolved {
  intent: string;
  value: unknown;
  params?: Record<string, unknown>;
  label?: string;
  brightness?: number;
}

export type RenderPlan =
  | { kind: "animation"; type: string; params: Record<string, unknown>; brightness?: number }
  | { kind: "frames"; name: string; brightness?: number }
  | { kind: "noop" };

// PURE: firmware names go to /api/display/animation (transient); everything else is a
// frame-expression name for /api/display/frames. brightness rides along when present.
export function decideRender(resolved: Resolved | null, isFirmware: (n: string) => boolean): RenderPlan {
  if (!resolved || typeof resolved.value !== "string") return { kind: "noop" };
  const name = resolved.value;
  const bri = resolved.brightness != null ? { brightness: resolved.brightness } : {};
  if (isFirmware(name)) return { kind: "animation", type: name, params: resolved.params ?? {}, ...bri };
  return { kind: "frames", name, ...bri };
}

// Locate the shared engine assets: prefer the live repo source (always fresh in dev),
// fall back to the in-bundle copy (the packed .mcpb has no ../shared — see Task 9).
export function engineDir(mcpDir: string): string {
  const repo = path.join(mcpDir, "..", "shared");
  if (existsSync(path.join(repo, "manifest.json"))) return repo;
  return path.join(mcpDir, "shared-runtime");
}

// Load the manifest (JSON) + the resolver and firmware-name helpers (dynamic import of a
// computed file URL — typed `any`, so no .d.ts is needed for the plain-JS shared modules).
export async function loadEngine(mcpDir: string) {
  const dir = engineDir(mcpDir);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  const { resolve } = await import(pathToFileURL(path.join(dir, "resolver.js")).href);
  const { isFirmwareName } = await import(pathToFileURL(path.join(dir, "firmware-names.js")).href);
  return { manifest, resolve, isFirmwareName: isFirmwareName as (n: string) => boolean };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test mcp_server/engine.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the bootstrap helpers into `index.ts`**

Add the import near the other local imports (top of `mcp_server/index.ts`):
```ts
import { decideRender, loadEngine, type RenderPlan } from "./engine.js";
```

Add these helpers after the `BOARD_URL` / `lastIdleType` block (replace `lastIdleType` usage later in Task 7; leave it for now):
```ts
// The manifest engine: shared resolver + manifest, loaded once. Repo-first so dev edits
// to shared/manifest.json are live; falls back to the bundled copy inside the .mcpb.
let enginePromise: ReturnType<typeof loadEngine> | null = null;
function engine() { return (enginePromise ??= loadEngine(MCP_DIR)); }

// noRepeat memory for pooled bindings (idle), shared across calls in this process.
const renderCtx: { last: Record<string, string> } = { last: {} };

// Execute a render plan against the board; returns a short note for the tool reply.
async function runPlan(plan: RenderPlan): Promise<string> {
  if (plan.kind === "noop") return "no binding";
  if (plan.brightness != null) await post("/api/brightness", { level: plan.brightness });
  if (plan.kind === "animation") {
    const r = await post("/api/display/animation", { type: plan.type, ...plan.params, transient: true });
    return r.ok ? `${plan.type} (transient anim)` : `anim error ${r.status}`;
  }
  const expr = CANNED[plan.name] ?? (await loadSavedExpression(plan.name));
  if (!expr) return `no glyph for "${plan.name}"`;
  const r = await post("/api/display/frames", expressionToWire(expr));
  return r.ok ? plan.name : `frames error ${r.status}`;
}

// Resolve an intent (or moment) for the esp32-8x8 renderer and render it. Returns the note.
async function renderIntent(opts: { intent?: string; moment?: string; harness?: string }): Promise<string> {
  const { manifest, resolve, isFirmwareName } = await engine();
  const resolved = resolve(manifest, { ...opts, renderer: "esp32-8x8" }, renderCtx);
  return runPlan(decideRender(resolved, isFirmwareName));
}
```

- [ ] **Step 6: Flip the `matrix_express("wait")` branch**

In the `case "matrix_express":` handler, replace the `"wait"`-group + `isWaitAnimation` block. The handler currently starts:
```ts
        let exprName = String(args.name ?? "");
        if (exprName === "wait") exprName = await resolveWait();
        if (isWaitAnimation(exprName)) {
          const r = await post("/api/display/animation", { type: exprName, transient: true });
          return { content: [{ type: "text", text: r.ok ? `Busy indicator: ${exprName} (transient animation).` : `Error ${r.status}: ${r.body}` }] };
        }
```
Replace those lines with:
```ts
        const exprName = String(args.name ?? "");
        // "wait" is the busy GROUP: resolve the manifest's `working` intent (the weighted
        // pool faithful to wait-weights.json) and render the pick (frame-expr or firmware).
        if (exprName === "wait") {
          const note = await renderIntent({ intent: "working" });
          return { content: [{ type: "text", text: `Busy indicator: ${note}.` }] };
        }
```
(The rest of `matrix_express` — explicit canned/saved name lookup — stays unchanged. Note `exprName` is now `const`.)

- [ ] **Step 7: Build + smoke**

Run: `cd mcp_server && npx tsc --project tsconfig.json && cd ..`
Expected: compiles clean (no missing-import errors; `resolveWait`/`isWaitAnimation` are still defined — removed in Task 10).
Run: `node --test mcp_server/engine.test.ts shared/manifest.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add mcp_server/engine.ts mcp_server/engine.test.ts mcp_server/index.ts
git commit -m "feat(mcp): manifest engine bootstrap + flip matrix_express(wait) to the working pool"
```

---

### Task 6: Flip `presence_set` to the manifest

Render the presence intent's 8×8 glyph via the manifest (keep the data-native path and `normalizePresence` untouched). Never blank: a miss falls back to `info`.

**Files:**
- Modify: `mcp_server/index.ts` (`case "presence_set"`)

**Interfaces:**
- Consumes: `renderIntent` (Task 5), `normalizePresence` (unchanged).

- [ ] **Step 1: Replace the glyph branch**

In `case "presence_set":`, the no-data branch currently computes `cannedFor`/`resolveWait`/`isWaitAnimation`. Replace the whole `else` block (the `// No data → ...` branch) so the handler reads:
```ts
        let ledNote: string;
        if (msg.data) {
          // Data present → the board renders it natively (v0.5). Unchanged.
          const lr = await post("/api/display/animation", { type: "presence" });
          ledNote = lr.ok ? "8x8 → data" : `8x8 data error ${lr.status}`;
        } else {
          // No data → resolve the intent's binding via the manifest and render the glyph.
          // Never blank: a missing/unbound intent falls back to `info`.
          let note = await renderIntent({ intent: msg.intent });
          if (note === "no binding" || note.startsWith("no glyph")) {
            note = await renderIntent({ intent: "info" });
          }
          ledNote = `8x8 → ${note}`;
        }
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd mcp_server && npx tsc --project tsconfig.json && cd ..`
Expected: compiles clean. (`cannedFor` is now unused but still imported — removed in Task 10; strict mode does not error on unused imports.)

- [ ] **Step 3: Manual reasoning check (no board in the loop)**

Confirm by reading the seed bindings that each presence intent resolves to a sensible glyph (these are the D1 changes — record them for the hardware checklist):
- `working`/`thinking` → working pool · `done` → `done` · `ok` → `done` (ok→approve→done) · `celebrate` → pool{party,confetti} · `alert` → `ask-attention` (alert→attention) · `error` → `cross` (error→fail) · `question` → `ask-question` (question→awaiting-input) · `info` → `smiley` · `idle` → `sleep`.

- [ ] **Step 4: Commit**

```bash
git add mcp_server/index.ts
git commit -m "feat(mcp): flip presence_set glyph path to the manifest (info fallback)"
```

---

### Task 7: Flip `matrix_idle` to the manifest

Resolve the `idle` intent (the lossless rich pool from Plan 3a: 8 firmware apps + params + `brightness:5` + labels + `noRepeat`). Replace `IDLE_APPS`/`pickIdleApp`/`lastIdleType`.

**Files:**
- Modify: `mcp_server/index.ts` (`case "matrix_idle"`)

**Interfaces:**
- Consumes: `engine`, `decideRender`, `runPlan`, `renderCtx` (Task 5).

- [ ] **Step 1: Replace the handler**

Replace the entire `case "matrix_idle":` block with:
```ts
      case "matrix_idle": {
        const { manifest, resolve, isFirmwareName } = await engine();
        const resolved = resolve(manifest, { renderer: "esp32-8x8", intent: "idle" }, renderCtx);
        if (!resolved) return { content: [{ type: "text", text: "No idle binding configured." }] };
        const note = await runPlan(decideRender(resolved, isFirmwareName));
        const label = resolved.label ?? String(resolved.value);
        return { content: [{ type: "text", text: `Idle pick: ${label} (${note}).` }] };
      }
```
Notes: `runPlan` applies `brightness:5` (from the binding) before the transient animation; `params` (speed/palette/etc.) forward verbatim; `noRepeat` is honored via `renderCtx.last["esp32-8x8:idle"]`. The pick is now **transient** (idle no longer persists to NVS as the boot animation) — a D1 change.

- [ ] **Step 2: Build to verify it compiles**

Run: `cd mcp_server && npx tsc --project tsconfig.json && cd ..`
Expected: compiles clean. (`IDLE_APPS`/`IDLE_BRIGHTNESS`/`pickIdleApp`/`lastIdleType` are now unused — removed in Task 10.)

- [ ] **Step 3: Manual reasoning check**

Confirm the idle binding in `shared/manifest.json` is the 8-app rich pool (fire/dancefloor/fireworks/clock/frostbite/matrix_rain/snow/claudesweep) with `brightness:5` and `noRepeat:true` — i.e. app-for-app identical to the old `IDLE_APPS` + `IDLE_BRIGHTNESS` (Plan 3a already verified this).

- [ ] **Step 4: Commit**

```bash
git add mcp_server/index.ts
git commit -m "feat(mcp): flip matrix_idle to the manifest idle pool (params+brightness+noRepeat)"
```

---

### Task 8: Flip the Python hook to the manifest + re-key the settings snippet

Make `matrix_signal.py` resolve a HARNESS MOMENT via the manifest (using `manifest_resolver.py`) and render the pick, mirroring the MCP's dispatch. Re-key `settings.hooks.snippet.json` to pass manifest moment keys. Keep the bored-watcher/activity-token system intact (re-keyed to moments). Keep the silent-fail and `.matrix_off` behaviors.

**Files:**
- Modify: `claude-hooks/matrix_signal.py`
- Modify: `claude-hooks/settings.hooks.snippet.json`
- (Manual, by the user) update the live copies at `~/.claude/hooks/` and re-merge the snippet into `~/.claude/settings.json`.

**Interfaces:**
- Consumes: `resolve` from `claude-hooks/manifest_resolver.py`; the manifest JSON; the mirrored `FIRMWARE_NAMES`.

- [ ] **Step 1: Pre-flight RED check (resolver gives the expected picks)**

Run (proves the manifest+resolver return what the new hook will render, BEFORE editing the hook):
```bash
python -c "import json,sys; sys.path.insert(0,'claude-hooks'); from manifest_resolver import resolve; m=json.load(open('shared/manifest.json')); print(resolve(m,{'harness':'claude-code','renderer':'esp32-8x8','moment':'hook:Stop'})); print(resolve(m,{'harness':'claude-code','renderer':'esp32-8x8','moment':'hook:PreToolUse:AskUserQuestion'}))"
```
Expected output: `{'intent': 'done', 'value': 'done'}` then `{'intent': 'awaiting-input', 'value': 'ask-question'}`.

- [ ] **Step 2: Edit `claude-hooks/matrix_signal.py`**

Add the resolver import + manifest loader + FIRMWARE_NAMES near the top (after the existing constants):
```python
sys.path.insert(0, HOOK_DIR)            # manifest_resolver.py sits next to this script
from manifest_resolver import resolve   # pure mirror of shared/resolver.js

# Firmware animation names — MIRROR of shared/firmware-names.js (keep in sync). These
# render via POST /api/display/animation (transient); everything else is a frame-expression.
FIRMWARE_NAMES = {
    "fire", "rainbow", "breathe", "wave", "solid", "liquid", "imu", "chiptemp",
    "weather", "timer_fill", "timer_snow", "timer_text", "clock", "matrix_rain",
    "snow", "dancefloor", "spiral", "starfield", "fireworks", "fireworks2",
    "comet", "sun", "frostbite", "calendar", "sound", "claudesweep",
}

def load_manifest():
    # Repo-first (sibling of mcp_server/), then the in-bundle copy (installed .mcpb).
    for cand in (os.path.join(MCP_DIR, "..", "shared", "manifest.json"),
                 os.path.join(MCP_DIR, "shared-runtime", "manifest.json")):
        try:
            with open(cand, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            continue
    return None
```

Add the brightness POST + render-resolved + render-moment functions (near `post_animation`/`send_saved`):
```python
def post_brightness(level):
    try:
        data = json.dumps({"level": level}).encode("utf-8")
        req = urllib.request.Request(BOARD_URL + "/api/brightness", data=data,
            headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=TIMEOUT).read()
    except Exception:
        pass

def render_resolved(resolved):
    """Render a manifest-resolved pick. Mirrors the MCP's decideRender/runPlan."""
    if not resolved:
        return
    value = resolved.get("value")
    if not isinstance(value, str):
        return
    if resolved.get("brightness") is not None:
        post_brightness(resolved["brightness"])
    if value in FIRMWARE_NAMES:
        if not post_animation(value, resolved.get("params") or {}):
            send_named("working")        # never blank
        return
    if value in EXPR:
        send_named(value)
        return
    if not send_saved(value):
        send_named("working")            # never blank

def render_moment(moment):
    manifest = load_manifest()
    if not manifest:
        send_named("working")            # degrade, never blank
        return
    render_resolved(resolve(manifest, {"harness": "claude-code", "renderer": "esp32-8x8", "moment": moment}))
```

Update `post_animation` to accept params (currently `post_animation(anim_type, transient=True)`):
```python
def post_animation(anim_type, params=None, transient=True):
    """Best-effort POST /api/display/animation for a firmware-animation pick (transient)."""
    try:
        body = {"type": anim_type, "transient": transient}
        if params:
            body.update(params)
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(BOARD_URL + "/api/display/animation", data=data,
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=3).read()
        return True
    except Exception:
        return False
```

Rewrite `main()` to be moment-keyed (re-keying the activity-token/bored beats to moments):
```python
def main():
    if len(sys.argv) < 2:
        return 0
    if os.path.exists(FLAG_OFF):         # at-will kill switch
        return 0
    moment = sys.argv[1].strip()
    # "user is active" beats stamp the token (any pending idle watcher then exits);
    # the Stop beat arms the board's screensaver + spawns the bored watcher.
    is_done = (moment == "hook:Stop")
    is_active = moment in ("hook:UserPromptSubmit",
                           "hook:PostToolUse:AskUserQuestion",
                           "hook:PostToolUse:ExitPlanMode")
    token = write_activity_token() if (is_active or is_done) else None
    render_moment(moment)
    if is_done and token is not None:
        arm_board_idle()
        spawn_idle_watcher(token)
    return 0
```

Delete the now-dead wait-pool machinery from `matrix_signal.py`: `WAIT_WEIGHTS_FILE`, `WAIT_BUILTINS`, `WAIT_PREFIX`, `WAIT_ANIMATIONS`, `build_wait_pool`, `load_wait_weights`, `pick_wait`, `send_wait`. Keep `EXPR`, `art_to_hex`, `post_frames`, `send_named`, `send_saved`, `arm_board_idle`, `write_activity_token`, `spawn_idle_watcher`, `EXPR_DIR`, `MCP_DIR`. Update the module docstring's Usage line to say it takes a manifest MOMENT key (e.g. `hook:Stop`).

- [ ] **Step 3: Re-key `claude-hooks/settings.hooks.snippet.json`**

Replace each command's trailing argument with the manifest moment key, and SPLIT the `PostToolUse` block into two (one per tool, matching the manifest's two PostToolUse moments):
- `UserPromptSubmit` → `matrix_signal.py hook:UserPromptSubmit`
- `Stop` → `matrix_signal.py hook:Stop`
- `PreToolUse` matcher `AskUserQuestion` → `matrix_signal.py hook:PreToolUse:AskUserQuestion`
- `PreToolUse` matcher `ExitPlanMode` → `matrix_signal.py hook:PreToolUse:ExitPlanMode`
- `PostToolUse` matcher `AskUserQuestion` → `matrix_signal.py hook:PostToolUse:AskUserQuestion`
- `PostToolUse` matcher `ExitPlanMode` → `matrix_signal.py hook:PostToolUse:ExitPlanMode`
- `Notification` matcher `permission_prompt` → `matrix_signal.py hook:Notification:permission_prompt`

Update the `_comment` to explain the new moment-keyed model and that the manifest (`shared/manifest.json`, `harnesses.claude-code`) maps moment→intent, weights/pools now live in the manifest (not `wait-weights.json`), and that BOTH `matrix_signal.py` AND `manifest_resolver.py` must be installed to `~/.claude/hooks/`.

- [ ] **Step 4: Post-edit smoke (script imports + resolves without the board)**

Run:
```bash
python -c "import sys; sys.path.insert(0,'claude-hooks'); import importlib.util as u; s=u.spec_from_file_location('m','claude-hooks/matrix_signal.py'); m=u.module_from_spec(s); s.loader.exec_module(m); mani=m.load_manifest(); print('manifest loaded:', bool(mani)); print('Stop ->', m.resolve(mani,{'harness':'claude-code','renderer':'esp32-8x8','moment':'hook:Stop'}))"
```
Expected: `manifest loaded: True` and `Stop -> {'intent': 'done', 'value': 'done'}`. (Importing the module must not POST anything — `main()` only runs under `__main__`.)

- [ ] **Step 5: Commit**

```bash
git add claude-hooks/matrix_signal.py claude-hooks/settings.hooks.snippet.json
git commit -m "feat(hooks): resolve harness moments via the manifest; re-key settings snippet"
```

> **Manual deploy (user, before hardware verification):** copy the updated `matrix_signal.py` AND `manifest_resolver.py` to `~/.claude/hooks/`, re-merge `settings.hooks.snippet.json` into `~/.claude/settings.json`, and restart Claude Code (hooks load at session start). See [[hook_live_copy_sync]].

---

### Task 9: Bundle the shared engine into the `.mcpb`

The packed extension contains only `mcp_server/`, so copy the resolver + manifest + firmware-names into it and make the build do this before packing.

**Files:**
- Create: `scripts/copy-shared-runtime.mjs`
- Test: `scripts/copy-shared-runtime.test.js`
- Modify: `package.json` (`build:mcpb` script)
- Modify: `.gitignore` (ignore the generated copy)

**Interfaces:**
- Produces `mcp_server/shared-runtime/{manifest.json,resolver.js,firmware-names.js}` (the dir `engine.ts`/`engineDir` falls back to).

- [ ] **Step 1: Write the failing test**

`scripts/copy-shared-runtime.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { copySharedRuntime } from "./copy-shared-runtime.mjs";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("copySharedRuntime places the engine files in mcp_server/shared-runtime", () => {
  const dst = copySharedRuntime();
  for (const f of ["manifest.json", "resolver.js", "firmware-names.js"])
    assert.ok(existsSync(join(dst, f)), `${f} copied`);
  // manifest is valid JSON with the 6 conformance roots
  const m = JSON.parse(readFileSync(join(dst, "manifest.json"), "utf8"));
  for (const root of ["info", "working", "done", "attention", "fail", "idle"])
    assert.ok(root in m.intents, `manifest has root ${root}`);
  assert.ok(dst.endsWith(join("mcp_server", "shared-runtime")));
  assert.ok(dst.startsWith(ROOT));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/copy-shared-runtime.test.js`
Expected: FAIL — `Cannot find module './copy-shared-runtime.mjs'`.

- [ ] **Step 3: Implement `scripts/copy-shared-runtime.mjs`**

```js
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The packed .mcpb contains only mcp_server/, so the MCP engine's resolver + manifest +
// firmware-name list must be copied in. Dev runs read ../shared directly (see engineDir),
// so this generated dir is gitignored. Keep the file list in sync with mcp_server/engine.ts.
const FILES = ["manifest.json", "resolver.js", "firmware-names.js"];

export function copySharedRuntime() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const src = join(root, "shared");
  const dst = join(root, "mcp_server", "shared-runtime");
  mkdirSync(dst, { recursive: true });
  for (const f of FILES) copyFileSync(join(src, f), join(dst, f));
  return dst;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dst = copySharedRuntime();
  console.log(`copied ${FILES.length} shared engine files -> ${dst}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/copy-shared-runtime.test.js`
Expected: PASS.

- [ ] **Step 5: Wire it into the build + gitignore**

In `package.json`, prepend the copy to `build:mcpb`:
```json
    "build:mcpb": "node scripts/copy-shared-runtime.mjs && cd mcp_server && npx tsc --project tsconfig.json && cd .. && node -e \"require('fs').mkdirSync('release',{recursive:true})\" && npx @anthropic-ai/mcpb pack mcp_server release/esp32-matrix.mcpb",
```

In `.gitignore`, add:
```
# Generated: shared engine copied into the MCP bundle for packing (see scripts/copy-shared-runtime.mjs)
mcp_server/shared-runtime/
```

- [ ] **Step 6: Build the bundle and verify it contains the engine**

Run: `npm run build:mcpb`
Expected: prints the copy line + a packed `.mcpb`. Then verify the engine files are inside the pack:
```bash
npx @anthropic-ai/mcpb info release/esp32-matrix.mcpb 2>/dev/null | grep -i shared-runtime || unzip -l release/esp32-matrix.mcpb | grep shared-runtime
```
Expected: lists `shared-runtime/manifest.json`, `resolver.js`, `firmware-names.js`. (If `mcpb` honors an ignore file that drops the dir, add `shared-runtime/` to its include set or `mcp_server/.mcpbignore` allow-list.)

- [ ] **Step 7: Commit**

```bash
git add scripts/copy-shared-runtime.mjs scripts/copy-shared-runtime.test.js package.json .gitignore
git commit -m "build(mcp): bundle the shared resolver+manifest into the .mcpb"
```

---

### Task 10: Delete the dead config

Remove the migrated config now that every consumer resolves via the manifest. Reconcile the tests that referenced it.

**Files:**
- Delete: `mcp_server/wait.ts`, `mcp_server/wait.test.ts`
- Delete: `mcp_server/idle.ts`, `mcp_server/idle.test.ts`
- Delete: `mcp_server/wait-weights.json`
- Modify: `mcp_server/presence.ts` (remove `INTENT_TO_CANNED` + `cannedFor`; keep `INTENTS`, `normalizePresence`, types)
- Modify: `mcp_server/presence-vocab.test.ts` (drop the `cannedFor` test + import)
- Modify: `mcp_server/index.ts` (remove dead imports + helpers)

- [ ] **Step 1: Confirm nothing still imports the doomed modules**

Run: `grep -rn "from \"./wait" mcp_server; grep -rn "from \"./idle" mcp_server; grep -rn "cannedFor\|INTENT_TO_CANNED" mcp_server; grep -rn "wait-weights" mcp_server scripts claude-hooks`
Expected: matches ONLY in the files this task edits/deletes (`index.ts`, `presence.ts`, `presence-vocab.test.ts`, and the files being deleted). If `wait-weights` matches in `scripts/` or `claude-hooks/`, those were missed in Tasks 4/8 — fix before deleting.

- [ ] **Step 2: Delete the dead files**

```bash
git rm mcp_server/wait.ts mcp_server/wait.test.ts mcp_server/idle.ts mcp_server/idle.test.ts mcp_server/wait-weights.json
```

- [ ] **Step 3: Trim `mcp_server/presence.ts`**

Remove the `INTENT_TO_CANNED` constant (and its comment) and the `cannedFor` function. Keep `INTENTS`, `normalizePresence`, the types, and `normalizeData`.

- [ ] **Step 4: Trim `mcp_server/presence-vocab.test.ts`**

Change the import to `import { INTENTS } from "./presence.ts";` and delete the second test (`"every intent maps to a canned 8x8 expression name"`). Keep the first test (the card vocab coverage).

- [ ] **Step 5: Trim `mcp_server/index.ts`**

Remove the now-unused imports and helpers:
- import line: drop `buildWaitPool, pickWait, isWaitAnimation` (delete the whole `./wait.js` import).
- import line: drop `IDLE_APPS, IDLE_BRIGHTNESS, pickIdleApp` (delete the whole `./idle.js` import).
- import line: change `import { normalizePresence, cannedFor } from "./presence.js";` → `import { normalizePresence } from "./presence.js";`.
- delete the `resolveWait()` and `loadWaitWeights()` functions.
- delete the `let lastIdleType` declaration.
- Keep `loadSavedExpression`, `listSavedExpressions`, `CANNED`, `expressionToWire` (still used).

- [ ] **Step 6: Full green gate**

Run: `cd mcp_server && npx tsc --project tsconfig.json && cd .. && npm test && npm run build:mcpb`
Expected: `tsc` clean; `manifest OK`; ALL `node --test` files PASS (the deleted `wait.test.ts`/`idle.test.ts` are simply gone from the glob); `.mcpb` packs. If `tsc` reports an unused/missing symbol, a reference was missed in Tasks 5–7 — fix it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(manifest): delete migrated config (wait.ts, idle.ts, wait-weights.json, INTENT_TO_CANNED)"
```

---

## D1 hardware-verification checklist (before merging `feat/expression-studio`)

Deploy the manual steps (Task 8 note: install hook copies + re-merge settings + restart), reconnect the MCP (`/mcp`), then verify on the physical board. Restore a comfortable brightness afterward (idle drops it to 5; it persists to NVS).

- [ ] `matrix_express("wait")` and the `UserPromptSubmit` hook play the weighted pool (wait-claude most often; the 4 `wait-logo-*` appear) — i.e. **no perceptible change** vs today (fidelity check).
- [ ] `presence_set` glyphs: `done`→done glyph · `ok`→done glyph (was the OK text) · `alert`→ask-attention (was the `!` glyph) · `celebrate`→party/confetti pool · `question`→ask-question · `error`→cross · `info`→smiley · `idle`→sleep · `working`/`thinking`→pool.
- [ ] `presence_set` WITH `data` still renders the native data view (progress/series/values) — unchanged.
- [ ] `matrix_idle` rotates the 8 apps at brightness 5, no immediate repeat, params applied (fire intensity, dancefloor palette, etc.); confirm the idle pick is **transient** (power-cycle → board boots into the prior non-idle animation, not the idle pick).
- [ ] Hook moments: Stop→done glyph then arms the screensaver; AskUserQuestion/ExitPlanMode (Pre)→ask-question; permission_prompt→ask-attention; the answer (Post)→busy pool; the bored-watcher still goofs off after a quiet period and exits on the next prompt.
- [ ] Board unreachable → hooks still exit 0 (no blocked turn); MCP tools return a readable "could not reach board".

---

## Self-Review (run before dispatching Task 1)

1. **Spec coverage:** gallery flip (T3+T4), MCP wait/presence/idle flips (T5/T6/T7), Python hook flip (T8), delete dead config (T10), bundle for installability (T9), manifest fidelity prerequisite (T2), firmware single-source (T1) — all present.
2. **Placeholders:** none — every code/test step shows full content; commands have expected output.
3. **Type/name consistency:** `Resolved`/`RenderPlan`/`decideRender`/`engineDir`/`loadEngine` (T5) are used verbatim in T6/T7; `manifestRoles`/`classifyExpression`/`buildCatalog` (T3) match T4's import; `copySharedRuntime` (T9) matches its test; `renderIntent`/`runPlan`/`renderCtx`/`engine()` defined in T5 used in T6/T7; `FIRMWARE_NAMES` mirrored T1↔T8.
