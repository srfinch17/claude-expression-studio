# Trigger Manifest — Plan 1: Protocol Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the renderer-agnostic core of the Expression Trigger Manifest — a single
`manifest.json`, its JSON Schema, a pure resolver (JS + a Python mirror), and a validator —
with **nothing consuming it yet** (pure addition, the live board cannot break).

**Architecture:** Three data layers in one JSON file (`intents` / `harnesses` / `renderers`).
A pure, I/O-free resolver turns *(harness, renderer, moment|intent)* into a concrete
*(intent, value)* by mapping the moment to an intent, walking the intent's **fallback chain**
until the renderer has a binding, and (if that binding is a weighted **pool**) picking one
entry. The resolver is written once in `shared/` JS and mirrored in Python (the hook can't
call JS); both are proven identical against one shared fixtures file. A bespoke validator
enforces the rules JSON Schema can't (no fallback cycles, chains end at a root, every binding
references a real animation).

**Tech Stack:** Node.js ESM (`node --test`, `node:assert/strict`), plain `shared/*.js`
modules (matches `catalog.js`), Python 3 stdlib (matches `matrix_signal.py`), JSON.

## Global Constraints

- **No new runtime dependencies.** Root `package.json` has zero deps; `mcp_server` has only
  the MCP SDK; the Python hooks use stdlib only. The validator is bespoke JS (no `ajv`).
- **`shared/` modules are pure ESM JS with no I/O** — they take an already-parsed `manifest`
  object (the pattern in `shared/catalog.js`). Loading (fs/fetch/`json.load`) is the caller's job.
- **Privacy:** never use the maintainer's real name in code/comments/docs — say "the user".
- **Resolver logic must be byte-identical across JS and Python** — both consume the injected
  RNG the same way (one `rng()` call per pool pick, after any `noRepeat` exclusion).
- **Tests auto-discover** via the existing root script:
  `node --test "scripts/**/*.test.js" "mcp_server/**/*.test.ts" "shared/**/*.test.js"`.
  New JS tests go in `shared/*.test.js` or `scripts/*.test.js` to be picked up.
- **End commit messages with:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Work on branch `feat/expression-studio` (current).

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/resolver.js` (create) | Pure resolution: `intentForMoment`, `effectiveBindings`, `resolveBoundIntent`, `pickWeighted`, `resolve`. No I/O. |
| `shared/resolver.test.js` (create) | Unit tests for the resolver, driven by the shared fixtures file + extra edge cases. |
| `shared/resolver-fixtures.json` (create) | Shared input→expected cases. Consumed by BOTH the JS test and the Python test (the anti-drift contract). |
| `shared/manifest.json` (create) | The seed manifest: full intent vocabulary, the `claude-code` moments, and `esp32-8x8` / `web-sim` / `card` bindings. Representative + valid (exact behavioral characterization is Plan 3). |
| `shared/manifest.schema.json` (create) | JSON Schema describing the manifest's structure (published contract / documentation). |
| `shared/manifest.test.js` (create) | Asserts the seed manifest resolves real moments correctly and passes the validator. |
| `scripts/check-manifest.mjs` (create) | Bespoke validator + CLI. Exports `validateManifest(manifest, animationNames)` and `collectAnimationNames(root)`; runs as `npm run check:manifest`. |
| `scripts/check-manifest.test.js` (create) | Feeds broken manifests, asserts each rule fires; asserts the real seed passes. |
| `claude-hooks/manifest_resolver.py` (create) | Python mirror of `shared/resolver.js`. |
| `claude-hooks/test_manifest_resolver.py` (create) | Runs the Python resolver over `shared/resolver-fixtures.json`, asserts expected. Exit 0 = pass. |
| `shared/resolver-parity.test.js` (create) | Node test that spawns the Python test; skips cleanly if no `python`/`python3`. |
| `package.json` (modify) | Add `check:manifest` script; fold it into `test`. |

---

### Task 1: The pure resolver + its fixtures

**Files:**
- Create: `shared/resolver.js`
- Create: `shared/resolver-fixtures.json`
- Test: `shared/resolver.test.js`

**Interfaces:**
- Consumes: nothing (pure, leaf module).
- Produces (exact signatures later tasks + the Python mirror must match):
  - `intentForMoment(manifest, harnessId, momentKey) -> string | null`
  - `effectiveBindings(manifest, rendererId) -> object` (own bindings merged over inherited)
  - `resolveBoundIntent(manifest, rendererId, intent) -> string | null`
  - `pickWeighted(weights, rng = Math.random, exclude = null) -> string | null`
  - `resolve(manifest, { harness, renderer, moment?, intent? }, ctx = {}) -> { intent, value } | null`
    where `ctx = { rng?: ()=>number, last?: Record<string,string> }`.

- [ ] **Step 1: Write the shared fixtures file**

Create `shared/resolver-fixtures.json`. `manifests` holds tiny named manifests; `cases` are
input→expected. `rngSeq` is a list the stub RNG returns in order (one value consumed per pool pick).

```json
{
  "manifests": {
    "basic": {
      "version": "1.0",
      "intents": {
        "info":    { "fallback": null, "root": true },
        "working": { "fallback": null, "root": true },
        "done":    { "fallback": null, "root": true },
        "attention": { "fallback": null, "root": true },
        "fail":    { "fallback": null, "root": true },
        "idle":    { "fallback": null, "root": true },
        "thinking":{ "fallback": "working" },
        "fatal":   { "fallback": "error" },
        "error":   { "fallback": "fail" }
      },
      "harnesses": {
        "claude-code": { "moments": [ { "on": "hook:Stop", "intent": "done" } ] }
      },
      "renderers": {
        "r1": { "bindings": {
          "info": "a-info", "working": "a-work", "done": "a-done",
          "attention": "a-att", "fail": "a-fail", "idle": "a-idle"
        } },
        "r2": { "inherits": "r1", "bindings": { "done": "a-done2" } },
        "pooler": { "bindings": {
          "info": "a-info", "working": "a-work", "done": "a-done",
          "attention": "a-att", "fail": "a-fail",
          "idle": { "pool": { "x": 1, "y": 3 } }
        } }
      }
    }
  },
  "cases": [
    { "name": "moment maps to intent + binding",
      "manifest": "basic", "harness": "claude-code", "renderer": "r1",
      "moment": "hook:Stop", "rngSeq": [], "expect": { "intent": "done", "value": "a-done" } },
    { "name": "unknown moment resolves to null",
      "manifest": "basic", "harness": "claude-code", "renderer": "r1",
      "moment": "hook:Nope", "rngSeq": [], "expect": null },
    { "name": "fallback walk: fatal -> error -> fail (only fail bound)",
      "manifest": "basic", "renderer": "r1",
      "intent": "fatal", "rngSeq": [], "expect": { "intent": "fail", "value": "a-fail" } },
    { "name": "inherited binding used when not overridden",
      "manifest": "basic", "renderer": "r2",
      "intent": "info", "rngSeq": [], "expect": { "intent": "info", "value": "a-info" } },
    { "name": "own binding overrides inherited",
      "manifest": "basic", "renderer": "r2",
      "intent": "done", "rngSeq": [], "expect": { "intent": "done", "value": "a-done2" } },
    { "name": "pool pick: rng 0.9 over weights x:1,y:3 -> y",
      "manifest": "basic", "renderer": "pooler",
      "intent": "idle", "rngSeq": [0.9], "expect": { "intent": "idle", "value": "y" } },
    { "name": "pool pick: rng 0.1 over weights x:1,y:3 -> x",
      "manifest": "basic", "renderer": "pooler",
      "intent": "idle", "rngSeq": [0.1], "expect": { "intent": "idle", "value": "x" } }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `shared/resolver.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  intentForMoment, effectiveBindings, resolveBoundIntent, pickWeighted, resolve,
} from "./resolver.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(HERE, "resolver-fixtures.json"), "utf8"));

// Deterministic RNG: returns the given values in order (then repeats).
const seq = (values) => { let i = 0; return () => values[(i++) % values.length]; };

test("resolver matches every shared fixture case", () => {
  for (const c of FIX.cases) {
    const manifest = FIX.manifests[c.manifest];
    const ctx = { rng: seq(c.rngSeq && c.rngSeq.length ? c.rngSeq : [0]) , last: {} };
    const got = resolve(manifest, { harness: c.harness, renderer: c.renderer,
      moment: c.moment, intent: c.intent }, ctx);
    assert.deepEqual(got, c.expect, c.name);
  }
});

test("pickWeighted: zero weight disables; all-zero falls back to uniform", () => {
  assert.equal(pickWeighted({ a: 0, b: 5 }, () => 0.99), "b");
  assert.equal(pickWeighted({ a: 0, b: 0 }, () => 0), "a"); // all zero -> uniform, first bucket
});

test("pickWeighted: exclude avoids the repeat when alternatives exist", () => {
  assert.equal(pickWeighted({ a: 1, b: 1 }, () => 0, "a"), "b");
  // only one option and it's excluded -> still returns it (never blank)
  assert.equal(pickWeighted({ a: 1 }, () => 0, "a"), "a");
});

test("resolveBoundIntent returns null when no chain member is bound", () => {
  const m = { intents: { x: { fallback: null } }, renderers: { r: { bindings: {} } } };
  assert.equal(resolveBoundIntent(m, "r", "x"), null);
});

test("noRepeat remembers the last pick via ctx.last", () => {
  const m = { intents: { idle: { fallback: null, root: true } },
    renderers: { r: { bindings: { idle: { noRepeat: true, pool: { a: 1, b: 1 } } } } } };
  const ctx = { rng: () => 0, last: {} };
  const first = resolve(m, { renderer: "r", intent: "idle" }, ctx);   // rng 0 -> a
  const second = resolve(m, { renderer: "r", intent: "idle" }, ctx);  // exclude a -> b
  assert.equal(first.value, "a");
  assert.equal(second.value, "b");
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `node --test shared/resolver.test.js`
Expected: FAIL — `Cannot find module './resolver.js'` (it doesn't exist yet).

- [ ] **Step 4: Implement the resolver**

Create `shared/resolver.js`:

```js
// shared/resolver.js
// Pure, data-driven resolution for the Expression Trigger Manifest.
// No I/O — the caller passes an already-parsed manifest object (cf. catalog.js).
// MIRRORED in claude-hooks/manifest_resolver.py; keep the two in lockstep
// (both are proven against shared/resolver-fixtures.json).

// moment key (e.g. "hook:Stop") -> the intent a harness maps it to, or null.
export function intentForMoment(manifest, harnessId, momentKey) {
  const h = manifest.harnesses && manifest.harnesses[harnessId];
  if (!h) return null;
  for (const m of h.moments || []) if (m.on === momentKey) return m.intent;
  return null;
}

// A renderer's effective bindings: inherited bindings merged UNDER its own.
// `inherits` may chain; cycles are guarded by _seen.
export function effectiveBindings(manifest, rendererId, _seen = new Set()) {
  const r = manifest.renderers && manifest.renderers[rendererId];
  if (!r || _seen.has(rendererId)) return {};
  _seen.add(rendererId);
  const inherited = r.inherits ? effectiveBindings(manifest, r.inherits, _seen) : {};
  return { ...inherited, ...(r.bindings || {}) };
}

// Walk the fallback chain from `intent` toward its root; return the first intent
// that has a binding on this renderer, or null. (A conformant manifest always
// binds the roots, so null only happens for malformed/partial manifests.)
export function resolveBoundIntent(manifest, rendererId, intent) {
  const bindings = effectiveBindings(manifest, rendererId);
  const seen = new Set();
  let cur = intent;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (Object.prototype.hasOwnProperty.call(bindings, cur)) return cur;
    const def = manifest.intents && manifest.intents[cur];
    cur = def && def.fallback != null ? def.fallback : null;
  }
  return null;
}

// Weighted random pick. weights: { name: number>=0 }. rng() in [0,1).
// `exclude`: a name to avoid when alternatives exist (noRepeat). Mirrors wait.ts.
export function pickWeighted(weights, rng = Math.random, exclude = null) {
  let names = Object.keys(weights);
  if (names.length === 0) return null;
  if (exclude != null && names.length > 1) {
    const filtered = names.filter((n) => n !== exclude);
    if (filtered.length) names = filtered;
  }
  let entries = names
    .map((n) => [n, Math.max(0, typeof weights[n] === "number" ? weights[n] : 1)])
    .filter(([, w]) => w > 0);
  if (entries.length === 0) entries = names.map((n) => [n, 1]); // all zero -> uniform
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [n, w] of entries) { r -= w; if (r < 0) return n; }
  return entries[entries.length - 1][0]; // float-rounding safety
}

// Top-level resolve. opts: { harness, renderer, moment?, intent? }.
// ctx: { rng?, last? } — `last` is a mutable map keyed `${renderer}:${intent}`
// giving noRepeat its memory. Returns { intent, value } or null (degrade to nothing).
export function resolve(manifest, opts, ctx = {}) {
  const rng = ctx.rng || Math.random;
  const intent = opts.intent != null
    ? opts.intent
    : intentForMoment(manifest, opts.harness, opts.moment);
  if (!intent) return null;
  const bound = resolveBoundIntent(manifest, opts.renderer, intent);
  if (!bound) return null;
  const binding = effectiveBindings(manifest, opts.renderer)[bound];
  if (binding && typeof binding === "object" && binding.pool) {
    const key = `${opts.renderer}:${bound}`;
    const exclude = binding.noRepeat && ctx.last ? (ctx.last[key] ?? null) : null;
    const picked = pickWeighted(binding.pool, rng, exclude);
    if (ctx.last && picked != null) ctx.last[key] = picked;
    return { intent: bound, value: picked };
  }
  return { intent: bound, value: binding };
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `node --test shared/resolver.test.js`
Expected: PASS (all tests, 0 failures).

- [ ] **Step 6: Commit**

```bash
git add shared/resolver.js shared/resolver.test.js shared/resolver-fixtures.json
git commit -m "feat(manifest): pure trigger-manifest resolver + shared fixtures

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: The seed manifest + JSON Schema

**Files:**
- Create: `shared/manifest.json`
- Create: `shared/manifest.schema.json`
- Test: `shared/manifest.test.js`

**Interfaces:**
- Consumes: `resolve` from Task 1.
- Produces: the canonical `shared/manifest.json` consumed by Tasks 3–4 and all later plans;
  the published `shared/manifest.schema.json` structural contract.

> Note: this seed is **representative and valid**. Exact behavioral characterization of every
> current caller (e.g. presence-`working`'s snake vs. the hook's weighted pool) is Plan 3's job.

- [ ] **Step 1: Write the seed manifest**

Create `shared/manifest.json`. Every referenced animation already exists: canned (`smiley`,
`done`, `cross`, `party`, `working`, `ok`, `sleep`, `alert`), saved
(`ask-question`, `ask-attention`, `wait-claude`, `wait-rainbow`, `wait-orbit`, `swarm-merge`,
`black-hole`, `skull`, `confetti`, `galaxy`, `aurora`, `jellyfish`), firmware
(`fire`, `frostbite`, `snow`, `claudesweep`).

```json
{
  "version": "1.0",
  "intents": {
    "info":           { "fallback": null,      "root": true, "doc": "neutral status / floor" },
    "working":        { "fallback": null,      "root": true, "doc": "busy, in progress" },
    "done":           { "fallback": null,      "root": true, "doc": "turn / task finished" },
    "attention":      { "fallback": null,      "root": true, "doc": "engage with me" },
    "fail":           { "fallback": null,      "root": true, "doc": "a setback / something wrong" },
    "idle":           { "fallback": null,      "root": true, "doc": "ambient / away" },
    "thinking":       { "fallback": "working", "doc": "reasoning hard" },
    "heard":          { "fallback": "working", "doc": "got your message" },
    "compacting":     { "fallback": "working", "doc": "folding memory down" },
    "session-start":  { "fallback": "info",    "doc": "booting / waking" },
    "session-end":    { "fallback": "idle",    "doc": "signing off" },
    "results-merged": { "fallback": "done",    "doc": "a helper reported back" },
    "approve":        { "fallback": "done",    "doc": "acknowledgement / thumbs-up" },
    "celebrate":      { "fallback": "done",    "doc": "a win / milestone" },
    "delight":        { "fallback": "celebrate", "doc": "pleasant surprise" },
    "awaiting-input": { "fallback": "attention", "doc": "blocked on the human" },
    "alert":          { "fallback": "attention", "doc": "active look-here" },
    "error":          { "fallback": "fail",    "doc": "an error" },
    "fatal":          { "fallback": "error",   "doc": "something died" },
    "sleep":          { "fallback": "idle",    "doc": "resting" },
    "greet":          { "fallback": "info",    "doc": "hello" },
    "affection":      { "fallback": "info",    "doc": "warmth" },
    "fun":            { "fallback": "info",    "doc": "playful" }
  },
  "harnesses": {
    "claude-code": {
      "moments": [
        { "on": "hook:UserPromptSubmit",               "intent": "working" },
        { "on": "hook:Stop",                           "intent": "done" },
        { "on": "hook:SubagentStop",                   "intent": "results-merged" },
        { "on": "hook:PreCompact",                     "intent": "compacting" },
        { "on": "hook:PreToolUse:AskUserQuestion",     "intent": "awaiting-input" },
        { "on": "hook:PreToolUse:ExitPlanMode",        "intent": "awaiting-input" },
        { "on": "hook:PostToolUse:AskUserQuestion",    "intent": "working" },
        { "on": "hook:PostToolUse:ExitPlanMode",       "intent": "working" },
        { "on": "hook:Notification:permission_prompt", "intent": "attention" },
        { "on": "hook:SessionStart",                   "intent": "session-start" },
        { "on": "hook:SessionEnd",                     "intent": "session-end" },
        { "on": "discretionary", "intent": "celebrate" },
        { "on": "discretionary", "intent": "fatal" },
        { "on": "discretionary", "intent": "idle" }
      ]
    }
  },
  "renderers": {
    "esp32-8x8": {
      "doc": "8x8 WS2812B board",
      "bindings": {
        "info":           "smiley",
        "working":        { "pool": { "working": 10, "wait-claude": 40, "wait-rainbow": 30, "wait-orbit": 20, "claudesweep": 20 } },
        "done":           "done",
        "attention":      "ask-attention",
        "fail":           "cross",
        "idle":           { "noRepeat": true, "pool": { "fire": 1, "frostbite": 1, "snow": 1, "claudesweep": 1 } },
        "awaiting-input": "ask-question",
        "results-merged": "swarm-merge",
        "compacting":     { "pool": { "black-hole": 2, "galaxy": 1 } },
        "celebrate":      { "pool": { "party": 1, "confetti": 1 } },
        "fatal":          "skull",
        "session-start":  "aurora",
        "session-end":    "sleep"
      }
    },
    "web-sim": { "doc": "browser canvas board", "inherits": "esp32-8x8" },
    "card": {
      "doc": "desktop presence card",
      "bindings": {
        "info":      { "glyph": "•",  "text": "Info",       "color": "#28c8ff" },
        "working":   { "glyph": "...", "text": "Working",   "color": "#c8e6ff" },
        "done":      { "glyph": "OK", "text": "Done",       "color": "#00c83c" },
        "attention": { "glyph": "!",  "text": "Needs you",  "color": "#ff6000" },
        "fail":      { "glyph": "x",  "text": "Problem",    "color": "#ff3030" },
        "idle":      { "glyph": "z",  "text": "Idle",       "color": "#32509b" }
      }
    }
  }
}
```

- [ ] **Step 2: Write the JSON Schema**

Create `shared/manifest.schema.json` (the structural contract; semantic rules live in the
validator — Task 3):

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Expression Trigger Manifest",
  "type": "object",
  "required": ["version", "intents", "harnesses", "renderers"],
  "properties": {
    "version": { "type": "string" },
    "intents": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["fallback"],
        "properties": {
          "fallback": { "type": ["string", "null"] },
          "root": { "type": "boolean" },
          "doc": { "type": "string" }
        },
        "additionalProperties": false
      }
    },
    "harnesses": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["moments"],
        "properties": {
          "moments": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["on", "intent"],
              "properties": { "on": { "type": "string" }, "intent": { "type": "string" } },
              "additionalProperties": false
            }
          }
        },
        "additionalProperties": false
      }
    },
    "renderers": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "properties": {
          "doc": { "type": "string" },
          "inherits": { "type": "string" },
          "bindings": {
            "type": "object",
            "additionalProperties": {
              "oneOf": [
                { "type": "string" },
                { "type": "object",
                  "required": ["pool"],
                  "properties": {
                    "pool": { "type": "object", "additionalProperties": { "type": "number" } },
                    "noRepeat": { "type": "boolean" }
                  },
                  "additionalProperties": false },
                { "type": "object" }
              ]
            }
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

- [ ] **Step 3: Write the failing test**

Create `shared/manifest.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolve, effectiveBindings } from "./resolver.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));
const ROOTS = ["info", "working", "done", "attention", "fail", "idle"];

test("seed manifest: Stop -> done -> 'done' on esp32-8x8", () => {
  const got = resolve(MANIFEST, { harness: "claude-code", renderer: "esp32-8x8", moment: "hook:Stop" });
  assert.deepEqual(got, { intent: "done", value: "done" });
});

test("seed manifest: SubagentStop -> results-merged -> swarm-merge", () => {
  const got = resolve(MANIFEST, { harness: "claude-code", renderer: "esp32-8x8", moment: "hook:SubagentStop" });
  assert.deepEqual(got, { intent: "results-merged", value: "swarm-merge" });
});

test("seed manifest: web-sim inherits esp32-8x8 bindings", () => {
  const got = resolve(MANIFEST, { renderer: "web-sim", intent: "done" });
  assert.deepEqual(got, { intent: "done", value: "done" });
});

test("seed manifest: every renderer covers the 6 roots", () => {
  for (const rid of Object.keys(MANIFEST.renderers)) {
    const b = effectiveBindings(MANIFEST, rid);
    for (const root of ROOTS) assert.ok(root in b, `${rid} binds root ${root}`);
  }
});

test("seed manifest: a working pool pick returns a pool member", () => {
  const got = resolve(MANIFEST, { renderer: "esp32-8x8", intent: "working" }, { rng: () => 0 });
  assert.ok(["working", "wait-claude", "wait-rainbow", "wait-orbit", "claudesweep"].includes(got.value));
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `node --test shared/manifest.test.js`
Expected: FAIL — cannot read `manifest.json` (until Step 1's file exists) or assertion errors
if a binding/root is wrong.

- [ ] **Step 5: Make it pass**

The files from Steps 1–2 should make every assertion pass. If a "covers the 6 roots" assertion
fails for `card`, add the missing root object binding; if a resolve assertion fails, correct the
binding value to the intended animation name. Re-run until green.

Run: `node --test shared/manifest.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/manifest.json shared/manifest.schema.json shared/manifest.test.js
git commit -m "feat(manifest): seed manifest + JSON Schema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: The validator (bespoke) + CLI + npm wiring

**Files:**
- Create: `scripts/check-manifest.mjs`
- Test: `scripts/check-manifest.test.js`
- Modify: `package.json` (add `check:manifest`, fold into `test`)

**Interfaces:**
- Consumes: `shared/manifest.json`; the animation library on disk.
- Produces:
  - `validateManifest(manifest, animationNames) -> string[]` (array of error strings; empty = valid)
  - `collectAnimationNames(root) -> Set<string>` (all valid animation reference names)
  - CLI: `node scripts/check-manifest.mjs` exits 0 (valid) or 1 (prints errors).

- [ ] **Step 1: Write the failing test**

Create `scripts/check-manifest.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateManifest, collectAnimationNames } from "./check-manifest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = JSON.parse(readFileSync(join(ROOT, "shared/manifest.json"), "utf8"));
const NAMES = collectAnimationNames(ROOT);

// A minimal valid manifest (roots bound, no dangling fallbacks).
const ok = () => ({
  version: "1.0",
  intents: {
    info: { fallback: null, root: true }, working: { fallback: null, root: true },
    done: { fallback: null, root: true }, attention: { fallback: null, root: true },
    fail: { fallback: null, root: true }, idle: { fallback: null, root: true },
    error: { fallback: "fail" },
  },
  harnesses: { "claude-code": { moments: [{ on: "hook:Stop", intent: "done" }] } },
  renderers: { r: { bindings: {
    info: "skull", working: "skull", done: "skull",
    attention: "skull", fail: "skull", idle: "skull", error: "skull",
  } } },
});

test("the real seed manifest is valid", () => {
  assert.deepEqual(validateManifest(SEED, NAMES), []);
});

test("minimal manifest is valid", () => {
  assert.deepEqual(validateManifest(ok(), new Set(["skull"])), []);
});

test("flags a fallback to a nonexistent intent", () => {
  const m = ok(); m.intents.error.fallback = "ghost";
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /ghost/.test(e)));
});

test("flags a fallback cycle", () => {
  const m = ok();
  m.intents.a = { fallback: "b" }; m.intents.b = { fallback: "a" };
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /cycle/i.test(e)));
});

test("flags a non-root intent whose chain dead-ends (fallback null, not root)", () => {
  const m = ok(); m.intents.lonely = { fallback: null };
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /lonely/.test(e) && /root/i.test(e)));
});

test("flags a missing required root", () => {
  const m = ok(); delete m.intents.idle;
  // idle no longer an intent AND not bound -> at least one error mentions idle
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /idle/.test(e)));
});

test("flags a renderer not covering a root", () => {
  const m = ok(); delete m.renderers.r.bindings.fail;
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /fail/.test(e) && /root/i.test(e)));
});

test("flags a binding referencing a missing animation", () => {
  const m = ok(); m.renderers.r.bindings.done = "no-such-anim";
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /no-such-anim/.test(e)));
});

test("flags a negative pool weight", () => {
  const m = ok(); m.renderers.r.bindings.idle = { pool: { skull: -2 } };
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /weight/i.test(e)));
});

test("flags an x- intent with no fallback", () => {
  const m = ok(); m.intents["x-thing"] = { fallback: null };
  assert.ok(validateManifest(m, new Set(["skull"])).some((e) => /x-thing/.test(e)));
});

test("collectAnimationNames includes canned, saved, bored, firmware", () => {
  for (const n of ["done", "skull", "claudesweep"]) assert.ok(NAMES.has(n), `${n} known`);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test scripts/check-manifest.test.js`
Expected: FAIL — `Cannot find module './check-manifest.mjs'`.

- [ ] **Step 3: Implement the validator + CLI**

Create `scripts/check-manifest.mjs`:

```js
// scripts/check-manifest.mjs
// Bespoke validator for shared/manifest.json. Enforces the semantic rules a JSON
// Schema cannot: no fallback cycles, every chain ends at a root, the 6 roots exist
// and are covered by every renderer, every binding references a real animation,
// pool weights are numbers >= 0, and x- intents declare a fallback.
// No external deps. CLI exits 0 (valid) / 1 (errors). Also exported for tests.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REQUIRED_ROOTS = ["info", "working", "done", "attention", "fail", "idle"];
// Firmware animation types that are valid references but are not JSON files.
const FIRMWARE = ["fire", "dancefloor", "fireworks", "clock", "frostbite", "matrix_rain", "snow", "claudesweep"];

// Gather every name a binding may legally reference: saved + bored JSON file
// stems, canned keys (from the compiled MCP module), and firmware types.
export function collectAnimationNames(root) {
  const names = new Set(FIRMWARE);
  const addDir = (dir) => {
    if (!existsSync(dir)) return;
    for (const fn of readdirSync(dir)) if (fn.endsWith(".json")) names.add(basename(fn, ".json"));
  };
  addDir(join(root, "mcp_server/expressions"));
  addDir(join(root, "claude-hooks/bored_animations"));
  // canned names from the compiled dist (best-effort; skip if not built).
  try {
    const cannedPath = join(root, "mcp_server/dist/expressions.js");
    if (existsSync(cannedPath)) {
      // Synchronous require-like read: parse exported keys without importing.
      const src = readFileSync(cannedPath, "utf8");
      // CANNED is an object literal/Map; capture top-level "name": entries.
      for (const m of src.matchAll(/["'`]([a-z0-9_-]+)["'`]\s*:/gi)) names.add(m[1]);
    }
  } catch { /* canned optional */ }
  // Always include the canned names this manifest relies on, in case dist is stale.
  for (const n of ["smiley", "done", "cross", "party", "working", "ok", "sleep", "alert"]) names.add(n);
  return names;
}

// Returns an array of human-readable error strings; empty array means valid.
export function validateManifest(manifest, animationNames) {
  const errors = [];
  const intents = manifest.intents || {};
  const renderers = manifest.renderers || {};

  // 1. Required roots exist and are marked root:true with fallback null.
  for (const root of REQUIRED_ROOTS) {
    const def = intents[root];
    if (!def) { errors.push(`missing required root intent "${root}"`); continue; }
    if (def.root !== true) errors.push(`root intent "${root}" must have root:true`);
    if (def.fallback != null) errors.push(`root intent "${root}" must have fallback:null`);
  }

  // 2. Fallbacks reference real intents; x- intents must declare a fallback.
  for (const [name, def] of Object.entries(intents)) {
    if (name.startsWith("x-") && def.fallback == null)
      errors.push(`extension intent "${name}" must declare a fallback`);
    if (def.fallback != null && !intents[def.fallback])
      errors.push(`intent "${name}" falls back to unknown intent "${def.fallback}"`);
  }

  // 3. Each chain has no cycle and terminates at a root (fallback null + root:true).
  for (const name of Object.keys(intents)) {
    const seen = new Set();
    let cur = name;
    while (cur != null) {
      if (seen.has(cur)) { errors.push(`intent "${name}" is in a fallback cycle`); break; }
      seen.add(cur);
      const def = intents[cur];
      if (!def) break; // unknown intent already reported by rule 2
      if (def.fallback == null) {
        if (def.root !== true)
          errors.push(`intent "${name}" chain dead-ends at non-root "${cur}" (must reach a root)`);
        break;
      }
      cur = def.fallback;
    }
  }

  // 4. Renderer inheritance resolves (no cycle, target exists) + covers the roots.
  const effective = (rid, seen = new Set()) => {
    const r = renderers[rid];
    if (!r) { errors.push(`renderer "${rid}" inherits unknown renderer`); return {}; }
    if (seen.has(rid)) { errors.push(`renderer "${rid}" has an inherits cycle`); return {}; }
    seen.add(rid);
    const inh = r.inherits ? effective(r.inherits, seen) : {};
    return { ...inh, ...(r.bindings || {}) };
  };
  for (const [rid, r] of Object.entries(renderers)) {
    const bindings = effective(rid);
    for (const root of REQUIRED_ROOTS)
      if (!(root in bindings)) errors.push(`renderer "${rid}" does not bind required root "${root}"`);

    // 5. Binding values: string -> anim exists; {pool} -> each key exists + weight>=0;
    //    other object -> renderer-custom (card), accepted.
    for (const [intent, value] of Object.entries(r.bindings || {})) {
      if (intents[intent] === undefined)
        errors.push(`renderer "${rid}" binds unknown intent "${intent}"`);
      if (typeof value === "string") {
        if (!animationNames.has(value))
          errors.push(`renderer "${rid}" intent "${intent}" references missing animation "${value}"`);
      } else if (value && typeof value === "object" && value.pool) {
        for (const [anim, w] of Object.entries(value.pool)) {
          if (!animationNames.has(anim))
            errors.push(`renderer "${rid}" pool "${intent}" references missing animation "${anim}"`);
          if (typeof w !== "number" || w < 0)
            errors.push(`renderer "${rid}" pool "${intent}" has invalid weight for "${anim}"`);
        }
      }
    }
  }
  return errors;
}

// CLI entrypoint.
function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(readFileSync(join(root, "shared/manifest.json"), "utf8"));
  const errors = validateManifest(manifest, collectAnimationNames(root));
  if (errors.length === 0) { console.log("manifest OK"); return; }
  console.error(`manifest INVALID (${errors.length}):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

> Implementer note: transcribe the validator as written. Rule 3 reports both fallback cycles
> and chains that dead-end at a non-root intent; rules 1–5 each correspond to a test in Step 1.
> All Step-1 tests must pass before committing.

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test scripts/check-manifest.test.js`
Expected: PASS. If the "real seed is valid" test fails, read the printed errors and fix the
seed (Task 2) — that is the validator doing its job.

- [ ] **Step 5: Wire npm scripts**

Modify `package.json` — add the `check:manifest` script and fold it into `test` so CI gates on it:

```json
  "scripts": {
    "bump:patch": "node scripts/version-bump.js patch",
    "bump:minor": "node scripts/version-bump.js minor",
    "bump:major": "node scripts/version-bump.js major",
    "stamp": "node scripts/version-stamp.js",
    "check": "node scripts/version-check.js",
    "check:manifest": "node scripts/check-manifest.mjs",
    "test": "node scripts/check-manifest.mjs && node --test \"scripts/**/*.test.js\" \"mcp_server/**/*.test.ts\" \"shared/**/*.test.js\"",
    "build:mcpb": "cd mcp_server && npx tsc --project tsconfig.json && cd .. && node -e \"require('fs').mkdirSync('release',{recursive:true})\" && npx @anthropic-ai/mcpb pack mcp_server release/esp32-matrix.mcpb",
    "build:gallery": "node scripts/build-gallery-data.mjs",
    "build:release": "node scripts/build-release.mjs"
  }
```

- [ ] **Step 6: Run the validator CLI + full suite**

Run: `npm run check:manifest`
Expected: prints `manifest OK`.

Run: `npm test`
Expected: validator prints `manifest OK`, then all tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-manifest.mjs scripts/check-manifest.test.js package.json
git commit -m "feat(manifest): bespoke validator + check:manifest CI gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: The Python resolver mirror + parity test

**Files:**
- Create: `claude-hooks/manifest_resolver.py`
- Create: `claude-hooks/test_manifest_resolver.py`
- Create: `shared/resolver-parity.test.js`

**Interfaces:**
- Consumes: `shared/resolver-fixtures.json` (the SAME file Task 1's JS test uses).
- Produces: `resolve(manifest, opts, ctx)` in Python with behavior identical to `shared/resolver.js`.

- [ ] **Step 1: Write the Python parity test (the spec)**

Create `claude-hooks/test_manifest_resolver.py`. It reads the shared fixtures and asserts the
Python resolver matches every expected result; exits non-zero on any mismatch.

```python
#!/usr/bin/env python3
"""Parity test: the Python resolver must match shared/resolver-fixtures.json
exactly (the same file the JS resolver test asserts against), so the two
implementations cannot drift. Exit 0 = pass, 1 = mismatch."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "..", "shared", "resolver-fixtures.json")

sys.path.insert(0, HERE)
from manifest_resolver import resolve  # noqa: E402


def seq(values):
    vals = values or [0]
    state = {"i": 0}
    def rng():
        v = vals[state["i"] % len(vals)]
        state["i"] += 1
        return v
    return rng


def main():
    data = json.load(open(FIX, encoding="utf-8"))
    failures = []
    for c in data["cases"]:
        manifest = data["manifests"][c["manifest"]]
        ctx = {"rng": seq(c.get("rngSeq")), "last": {}}
        got = resolve(manifest, {"harness": c.get("harness"), "renderer": c["renderer"],
                                 "moment": c.get("moment"), "intent": c.get("intent")}, ctx)
        if got != c["expect"]:
            failures.append(f'{c["name"]}: got {got!r} want {c["expect"]!r}')
    if failures:
        print("PARITY FAIL:")
        for f in failures:
            print("  - " + f)
        sys.exit(1)
    print(f"parity OK ({len(data['cases'])} cases)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it, verify it fails**

Run: `python claude-hooks/test_manifest_resolver.py` (or `python3`)
Expected: FAIL — `ModuleNotFoundError: No module named 'manifest_resolver'`.

- [ ] **Step 3: Implement the Python resolver mirror**

Create `claude-hooks/manifest_resolver.py` — a line-for-line port of `shared/resolver.js`.
Note the expected `{intent, value}` dict uses JS key names so it deep-equals the fixtures.

```python
#!/usr/bin/env python3
"""Python mirror of shared/resolver.js — pure, no I/O. Keep in lockstep with the
JS version (both proven against shared/resolver-fixtures.json). Returns dicts with
the SAME keys as the JS object ({"intent":..., "value":...}) so fixtures match."""
import random


def intent_for_moment(manifest, harness_id, moment_key):
    h = (manifest.get("harnesses") or {}).get(harness_id)
    if not h:
        return None
    for m in h.get("moments", []):
        if m.get("on") == moment_key:
            return m.get("intent")
    return None


def effective_bindings(manifest, renderer_id, _seen=None):
    if _seen is None:
        _seen = set()
    r = (manifest.get("renderers") or {}).get(renderer_id)
    if not r or renderer_id in _seen:
        return {}
    _seen.add(renderer_id)
    inherited = effective_bindings(manifest, r["inherits"], _seen) if r.get("inherits") else {}
    out = dict(inherited)
    out.update(r.get("bindings") or {})
    return out


def resolve_bound_intent(manifest, renderer_id, intent):
    bindings = effective_bindings(manifest, renderer_id)
    seen = set()
    cur = intent
    while cur is not None and cur not in seen:
        seen.add(cur)
        if cur in bindings:
            return cur
        d = (manifest.get("intents") or {}).get(cur)
        cur = d["fallback"] if d and d.get("fallback") is not None else None
    return None


def pick_weighted(weights, rng=random.random, exclude=None):
    names = list(weights.keys())
    if not names:
        return None
    if exclude is not None and len(names) > 1:
        filtered = [n for n in names if n != exclude]
        if filtered:
            names = filtered
    entries = [(n, max(0, weights[n] if isinstance(weights[n], (int, float)) else 1)) for n in names]
    entries = [(n, w) for n, w in entries if w > 0]
    if not entries:
        entries = [(n, 1) for n in names]
    total = sum(w for _, w in entries)
    r = rng() * total
    for n, w in entries:
        r -= w
        if r < 0:
            return n
    return entries[-1][0]


def resolve(manifest, opts, ctx=None):
    if ctx is None:
        ctx = {}
    rng = ctx.get("rng") or random.random
    intent = opts.get("intent")
    if intent is None:
        intent = intent_for_moment(manifest, opts.get("harness"), opts.get("moment"))
    if not intent:
        return None
    bound = resolve_bound_intent(manifest, opts["renderer"], intent)
    if not bound:
        return None
    binding = effective_bindings(manifest, opts["renderer"]).get(bound)
    if isinstance(binding, dict) and binding.get("pool"):
        key = f'{opts["renderer"]}:{bound}'
        last = ctx.get("last") or {}
        exclude = last.get(key) if binding.get("noRepeat") else None
        picked = pick_weighted(binding["pool"], rng, exclude)
        if ctx.get("last") is not None and picked is not None:
            ctx["last"][key] = picked
        return {"intent": bound, "value": picked}
    return {"intent": bound, "value": binding}
```

- [ ] **Step 4: Run the Python parity test, verify it passes**

Run: `python claude-hooks/test_manifest_resolver.py`
Expected: `parity OK (7 cases)`.

- [ ] **Step 5: Bridge it into `npm test` (skip-if-no-python)**

Create `shared/resolver-parity.test.js` so CI runs the Python parity test, skipping cleanly
where Python isn't installed (node-only CI must not fail):

```js
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PY_TEST = join(ROOT, "claude-hooks", "test_manifest_resolver.py");

function findPython() {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return cmd;
  }
  return null;
}

test("JS/Python resolver parity (skips if no python)", (t) => {
  const py = findPython();
  if (!py) { t.skip("python not found"); return; }
  const r = spawnSync(py, [PY_TEST], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("parity failed:\n" + (r.stdout || "") + (r.stderr || ""));
});
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: `manifest OK`, then all JS tests pass and the parity test passes (or skips with a
message if Python is absent).

- [ ] **Step 7: Commit**

```bash
git add claude-hooks/manifest_resolver.py claude-hooks/test_manifest_resolver.py shared/resolver-parity.test.js
git commit -m "feat(manifest): Python resolver mirror + JS/Python parity test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (Plan 1 portion of the spec):**
- §3 vocabulary + fallback chains → seed `intents` (Task 2) + validator rules 1–3 (Task 3) ✓
- §3.2 roots/conformance → validator rules 1 & 4 + manifest test "covers 6 roots" ✓
- §3.4 `x-` extension must declare fallback → validator rule 2 + test ✓
- §4 schema (intents/harnesses/renderers, universal pooling, inheritance) → seed + schema + resolver pool handling ✓
- §4.1 universal pooling + unified picker → `pickWeighted` + pool resolution (Task 1) ✓
- §4.2 assignability (bindings reference any animation) → validator rule 5 references the full library ✓
- §5 resolver + inheritance → Task 1 (`effectiveBindings`, `resolveBoundIntent`, `resolve`) ✓
- §5.5 TS/Python parity via shared fixtures → Tasks 1 & 4 ✓
- §6.2 fail-safe (degrade to null, never throw) → `resolve` returns null; tested ✓
- §6.3 validation rules + CI gate → Task 3 ✓
- §6.4 testing (resolver, validator, parity) → Tasks 1, 3, 4 ✓
- Deferred to later plans (correctly out of Plan 1 scope): renderer `render()` implementations
  (Plan 2), consumer migration + exact characterization (Plan 3), engine/Studio (Plan 4),
  width/height authoring (later), assigning the 40 (Plan 6).

**2. Placeholder scan:** No TBD/TODO; every code step contains complete code; the one
implementer note (validator rule 3) points at a concrete final `if` and a named test, not a vague
"handle edge cases." OK.

**3. Type consistency:** `resolve`/`effectiveBindings`/`resolveBoundIntent`/`pickWeighted`/
`intentForMoment` names + signatures are identical across `shared/resolver.js`, the tests, and
`manifest_resolver.py` (snake_case in Python, same shapes). Return shape `{ intent, value }`
(JS) ⇿ `{"intent","value"}` (Python) matches the fixtures. RNG is one call per pool pick after
exclusion in both. OK.

---

## Execution Handoff

Plan complete and saved to
`docs/superpowers/plans/2026-06-25-trigger-manifest-plan1-protocol-core.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between
   tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batched with
   checkpoints for review.

Which approach?
