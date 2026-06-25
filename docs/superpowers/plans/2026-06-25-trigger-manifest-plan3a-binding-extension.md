# Trigger Manifest — Plan 3a: Binding-Format Extension (rich pools) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the manifest binding format so a pool can carry per-pick launch metadata
(`params`, `label`) and a pool-level ambient `brightness`, then teach the resolver (JS + Python),
schema, validator, `fire()` dispatcher, and the `esp32-8x8`/`web-sim` renderers to carry it through —
so the live `matrix_idle` migration (Plan 3b) can move idle's 8 tuned apps onto the manifest
**losslessly** (params + brightness 5 + human labels all preserved).

**Architecture:** A *targeted, backward-compatible* extension. Today a pool entry is `{ name: number }`
(a weight) and a binding is a string, a `{ pool, noRepeat? }` object, or a renderer-custom object
(the card's `{glyph,text,color}`). This plan widens **only the pool case**: a pool entry becomes
`number | { weight?, params?, label? }`, and a `{pool}` binding may carry `brightness`. The resolver
keeps returning `{ intent, value }` and *adds optional* `params`/`label`/`brightness` keys only when a
rich pool produces them — so every existing string/number binding resolves byte-identically. Nothing
live is wired in this plan: it is a pure extension proven entirely under `node --test` + the JS↔Python
parity gate. The live flips that consume it are Plan 3b.

**Tech Stack:** Node.js ESM (`node --test`), the existing `shared/resolver.js` + `shared/registry.js`
+ `shared/renderers/*.js`, `shared/manifest.schema.json`, `scripts/check-manifest.mjs`, the Python
mirror `claude-hooks/manifest_resolver.py`, and the shared parity fixtures
`shared/resolver-fixtures.json`.

## Global Constraints

- **No new runtime dependencies.** Plain ESM JS in `shared/`; node stdlib in tests; stdlib-only Python.
- **Backward compatibility is mandatory.** Every existing number-weighted pool and string/object binding
  must resolve to the EXACT same `{intent, value}` as before (no new keys unless a rich entry/brightness
  is actually present). The full suite (currently 110/110) stays green.
- **JS and Python resolvers are MIRRORED** and must stay in lockstep — both proven against
  `shared/resolver-fixtures.json`. Any logic change lands in both, with a parity fixture covering it.
- **Renderers do NO I/O directly** — every side effect arrives through an injected dependency, so each
  renderer stays pure-logic + unit-testable with fakes (this plan adds a `setBrightness` injected dep
  to `esp32-8x8`; it is faked in tests, real board HTTP is Plan 3b).
- **The card renderer and its `{glyph,text,color}` object bindings are NOT touched** — the extension is
  scoped to the pool case so it can never collide with the card's renderer-custom object form.
- **Rich-binding shape (exact):** a `{pool}` binding is
  `{ "pool": { "<anim>": number | { "weight"?: number, "params"?: object, "label"?: string }, ... }, "noRepeat"?: boolean, "brightness"?: number }`.
  A missing `weight` defaults to 1. `params` is an opaque object passed through verbatim to the board
  animation launch. `brightness` is 0–255.
- **Resolver return shape (exact):** `resolve(...)` returns `null` or
  `{ intent, value, params?, label?, brightness? }`. `params`/`label` are present only when the *picked*
  pool entry is an object that carries them; `brightness` is present only when the `{pool}` binding
  carries it. Non-pool bindings return `{ intent, value }` exactly as today.
- **Privacy:** never use the maintainer's real name — say "the user".
- **Branch** `feat/expression-studio`. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Carry-forwards folded into this plan** (do them where noted, not separately):
  - From Plan 2's final review (T1): `fire()`'s `resolveExisting` re-pick path must become noRepeat-aware
    — honor the `exclude` and update `ctx.last` — and must surface the re-picked entry's `params`/`label`
    (Task 4).
  - From Plan 1's final review: add a validator rule "duplicate moment `on` within a harness" (Task 3).
- **Deferred to Plan 3b (do NOT do here):** wiring any renderer to real board HTTP / a real
  `loadExpression`/`exists` (incl. the requirement that `exists` cover **canned** names from
  `mcp_server/expressions.ts`, not just `expressions/*.json`); flipping `wait.ts`/`idle.ts`/`presence.ts`,
  the Python hook, or the gallery classifier; deleting dead config.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `shared/resolver.js` | `pickWeighted` reads object entries; `resolve` surfaces pool params/label/brightness | Modify |
| `shared/resolver.test.js` | unit cases for the rich-pool resolve + object-weight pick | Modify |
| `claude-hooks/manifest_resolver.py` | Python mirror of the same two changes | Modify |
| `shared/resolver-fixtures.json` | JS↔Python parity cases for object weights + rich resolve | Modify |
| `shared/manifest.schema.json` | pool entry `oneOf` number\|object; `{pool}` allows `brightness` | Modify |
| `scripts/check-manifest.mjs` | rule 5 weight-from-object; new rule 6 duplicate-moment | Modify |
| `scripts/check-manifest.test.mjs` | failing-case tests for the new validator behavior | Modify |
| `shared/registry.js` | `fire()` passes `meta` to `render(value, meta)`; noRepeat-aware re-pick + params surface | Modify |
| `shared/registry.test.js` | meta passthrough + noRepeat re-pick cases | Modify |
| `shared/renderers/esp32.js` | `render(name, meta)` applies `meta.brightness` (injected `setBrightness`) + `meta.params` | Modify |
| `shared/renderers/esp32.test.js` | brightness + params dispatch cases | Modify |
| `shared/renderers/web-sim.js` | `render(name, meta)` accepts + ignores board-only meta (documented) | Modify |
| `shared/renderers/web-sim.test.js` | meta-arg tolerance case | Modify |
| `shared/manifest.json` | rewrite the `esp32-8x8` `idle` binding to the rich 8-app lossless form | Modify |
| `shared/renderers/integration.test.js` | align idle assertions to the rich 8-app pool | Modify |

> Note on the existing test filename: Plan 1 created the validator test as `scripts/check-manifest.test.mjs`.
> Before Task 3, confirm the exact path with `git ls-files scripts/` and edit that file (do not create a
> second copy).

**Interfaces produced/changed by this plan (Plan 3b relies on these exact shapes):**
- `pickWeighted(weights, rng?, exclude?)` — `weights` values may now be `number | { weight?: number, ... }`.
- `resolve(manifest, opts, ctx?)` → `null | { intent, value, params?, label?, brightness? }`.
- `fire(manifest, opts, registry, ctx?)` → `Promise<Array<{renderer,intent,value,params?,label?,brightness?}|null>>`;
  it now calls `renderer.render(value, meta)` where `meta = { params?, label?, brightness? }`.
- `makeEsp32Renderer({ loadExpression, postFrames, postAnimation, setBrightness, isFirmware })` — adds
  `setBrightness(level) -> Promise`; `postAnimation(type, params?)` gains an optional 2nd arg.
- `makeWebSimRenderer({ panel, loadExpression, firmwareSims })` — `render(name, meta?)` (meta tolerated, ignored).

---

### Task 1: Resolver (JS) — object pool entries + rich resolve

**Files:**
- Modify: `shared/resolver.js`
- Test: `shared/resolver.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `pickWeighted` accepting object weights; `resolve` returning optional `params`/`label`/`brightness`.

- [ ] **Step 1: Write the failing tests**

Add to `shared/resolver.test.js` (keep existing tests):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickWeighted, resolve } from "./resolver.js";

test("pickWeighted reads weight from an object entry (rng 0.9 over x:{weight:1}, y:{weight:3} -> y)", () => {
  const picked = pickWeighted({ x: { weight: 1 }, y: { weight: 3 } }, () => 0.9);
  assert.equal(picked, "y");
});

test("pickWeighted: object entry with no weight defaults to 1", () => {
  // x:{} (=>1) vs y:1 : equal halves; rng 0.4 -> x, rng 0.6 -> y
  assert.equal(pickWeighted({ x: {}, y: 1 }, () => 0.4), "x");
  assert.equal(pickWeighted({ x: {}, y: 1 }, () => 0.6), "y");
});

test("resolve surfaces params + label from the picked rich pool entry, and pool brightness", () => {
  const manifest = {
    intents: { idle: { fallback: null, root: true } },
    renderers: { r: { bindings: { idle: {
      brightness: 5, noRepeat: false,
      pool: { fire: { weight: 1, params: { speed: 50 }, label: "fire" } },
    } } } },
  };
  const res = resolve(manifest, { renderer: "r", intent: "idle" }, { rng: () => 0 });
  assert.deepEqual(res, { intent: "idle", value: "fire", params: { speed: 50 }, label: "fire", brightness: 5 });
});

test("resolve on a number-weighted pool with no brightness stays {intent,value} (no new keys)", () => {
  const manifest = {
    intents: { idle: { fallback: null, root: true } },
    renderers: { r: { bindings: { idle: { pool: { x: 1, y: 3 } } } } },
  };
  const res = resolve(manifest, { renderer: "r", intent: "idle" }, { rng: () => 0.1 });
  assert.deepEqual(res, { intent: "idle", value: "x" });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test shared/resolver.test.js`
Expected: FAIL — the rich-resolve test sees `{intent,value}` without `params/label/brightness`; the
object-weight pick may mis-weight (treats the object as weight 1 today via the `typeof===number` else-branch).

- [ ] **Step 3: Implement in `shared/resolver.js`**

Replace the entry-weight line in `pickWeighted` so it reads `.weight` from object entries:

```js
  let entries = names
    .map((n) => {
      const wv = weights[n];
      const w = typeof wv === "number" ? wv
        : (wv && typeof wv === "object" && typeof wv.weight === "number" ? wv.weight : 1);
      return [n, Math.max(0, w)];
    })
    .filter(([, w]) => w > 0);
```

Replace the pool branch of `resolve` (the `if (binding && typeof binding === "object" && binding.pool)`
block) with one that surfaces the rich fields:

```js
  if (binding && typeof binding === "object" && binding.pool) {
    const key = `${opts.renderer}:${bound}`;
    const exclude = binding.noRepeat && ctx.last ? (ctx.last[key] ?? null) : null;
    const picked = pickWeighted(binding.pool, rng, exclude);
    if (ctx.last && picked != null) ctx.last[key] = picked;
    const out = { intent: bound, value: picked };
    const entry = picked != null ? binding.pool[picked] : null;
    if (entry && typeof entry === "object") {
      if (entry.params != null) out.params = entry.params;
      if (entry.label != null) out.label = entry.label;
    }
    if (binding.brightness != null) out.brightness = binding.brightness;
    return out;
  }
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `node --test shared/resolver.test.js`
Expected: PASS (new + all existing resolver tests).

- [ ] **Step 5: Commit**

```bash
git add shared/resolver.js shared/resolver.test.js
git commit -m "feat(manifest): resolver supports object pool entries + rich resolve (params/label/brightness)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Resolver (Python) mirror + parity fixtures

**Files:**
- Modify: `claude-hooks/manifest_resolver.py`
- Modify: `shared/resolver-fixtures.json`

**Interfaces:**
- Consumes: the JS behavior from Task 1 (this task makes Python identical and proves it).
- Produces: matching `pick_weighted`/`resolve`; new parity cases.

- [ ] **Step 1: Add the parity fixtures (the failing spec)**

In `shared/resolver-fixtures.json`, add a renderer to the `basic` manifest's `renderers` object:

```json
        "rich": { "bindings": {
          "idle": { "brightness": 5, "pool": {
            "fire": { "weight": 1, "params": { "speed": 50 }, "label": "fire" },
            "snow": { "weight": 3 }
          } }
        } }
```

And append these to the `cases` array:

```json
    { "name": "rich pool: rng 0.1 picks fire (weight 1 of 4) and surfaces params+label+brightness",
      "manifest": "basic", "renderer": "rich",
      "intent": "idle", "rngSeq": [0.1],
      "expect": { "intent": "idle", "value": "fire", "params": { "speed": 50 }, "label": "fire", "brightness": 5 } },
    { "name": "rich pool: rng 0.9 picks snow (bare weight 3) — brightness only, no params/label",
      "manifest": "basic", "renderer": "rich",
      "intent": "idle", "rngSeq": [0.9],
      "expect": { "intent": "idle", "value": "snow", "brightness": 5 } }
```

> The `rich` renderer omits the 6 required roots; that is fine for the resolver fixtures (they exercise
> `resolve`, not the conformance validator — which runs in Task 3 against the real seed only).

- [ ] **Step 2: Run the parity test, verify it fails**

Run: `node --test shared/resolver-parity.test.js`
Expected: FAIL — Python `pick_weighted` treats the object entry as weight 1 and `resolve` omits the new
keys, so the new cases mismatch (and/or the JS side already emits the keys, diverging from Python).

- [ ] **Step 3: Implement in `claude-hooks/manifest_resolver.py`**

In `pick_weighted`, replace the `entries = [...]` weight line:

```python
    def _w(v):
        if isinstance(v, (int, float)):
            return v
        if isinstance(v, dict) and isinstance(v.get("weight"), (int, float)):
            return v["weight"]
        return 1
    entries = [(n, max(0, _w(weights[n]))) for n in names]
```

In `resolve`, replace the pool branch (the `if isinstance(binding, dict) and binding.get("pool"):` block):

```python
    if isinstance(binding, dict) and binding.get("pool"):
        key = f'{opts["renderer"]}:{bound}'
        last = ctx.get("last") or {}
        exclude = last.get(key) if binding.get("noRepeat") else None
        picked = pick_weighted(binding["pool"], rng, exclude)
        if ctx.get("last") is not None and picked is not None:
            ctx["last"][key] = picked
        out = {"intent": bound, "value": picked}
        entry = binding["pool"].get(picked) if picked is not None else None
        if isinstance(entry, dict):
            if entry.get("params") is not None:
                out["params"] = entry["params"]
            if entry.get("label") is not None:
                out["label"] = entry["label"]
        if binding.get("brightness") is not None:
            out["brightness"] = binding["brightness"]
        return out
```

- [ ] **Step 4: Run the parity test, verify it passes**

Run: `node --test shared/resolver-parity.test.js`
Expected: PASS — JS≡Python across all fixture cases (old + 2 new). If Python is unavailable in the
environment the parity bridge skips; in that case ALSO run the Python file's own test if present
(`git ls-files claude-hooks/ | grep test`) and report which path ran.

- [ ] **Step 5: Commit**

```bash
git add claude-hooks/manifest_resolver.py shared/resolver-fixtures.json
git commit -m "feat(manifest): Python resolver mirrors rich pool entries + parity fixtures

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Schema + validator (rich pool shape + duplicate-moment rule)

**Files:**
- Modify: `shared/manifest.schema.json`
- Modify: `scripts/check-manifest.mjs`
- Test: `scripts/check-manifest.test.mjs` (confirm exact path first — see File Structure note)

**Interfaces:**
- Consumes: nothing new.
- Produces: a schema + validator that accept rich pools and reject malformed ones + duplicate moments.

- [ ] **Step 1: Write the failing validator tests**

Add to `scripts/check-manifest.test.mjs` (keep existing tests). These use `validateManifest(manifest, names)`
directly with a tiny name set:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateManifest } from "./check-manifest.mjs";

const NAMES = new Set(["a-info", "a-work", "a-done", "a-att", "a-fail", "fire", "snow"]);
function roots(extra = {}) {
  return { info: "a-info", working: "a-work", done: "a-done", attention: "a-att", fail: "a-fail", ...extra };
}
function mf(bindings, moments = [{ on: "hook:Stop", intent: "done" }]) {
  return {
    version: "1.0",
    intents: {
      info: { fallback: null, root: true }, working: { fallback: null, root: true },
      done: { fallback: null, root: true }, attention: { fallback: null, root: true },
      fail: { fallback: null, root: true }, idle: { fallback: null, root: true },
    },
    harnesses: { h: { moments } },
    renderers: { r: { bindings } },
  };
}

test("validator accepts a rich pool (object entries + brightness)", () => {
  const errors = validateManifest(mf(roots({
    idle: { brightness: 5, pool: { fire: { weight: 1, params: { speed: 50 }, label: "fire" }, snow: 3 } },
  })), NAMES);
  assert.deepEqual(errors, []);
});

test("validator flags a negative weight inside an object pool entry", () => {
  const errors = validateManifest(mf(roots({
    idle: { pool: { fire: { weight: -2 } } },
  })), NAMES);
  assert.ok(errors.some((e) => /invalid weight/i.test(e) && /fire/.test(e)), errors.join("; "));
});

test("validator flags a missing animation inside an object pool entry", () => {
  const errors = validateManifest(mf(roots({
    idle: { pool: { ghost: { weight: 1 } } },
  })), NAMES);
  assert.ok(errors.some((e) => /missing animation "ghost"/i.test(e)), errors.join("; "));
});

test("validator flags a duplicate moment `on` within a harness", () => {
  const errors = validateManifest(mf(roots({ idle: "fire" }), [
    { on: "hook:Stop", intent: "done" },
    { on: "hook:Stop", intent: "working" },
  ]), NAMES);
  assert.ok(errors.some((e) => /duplicate moment/i.test(e) && /hook:Stop/.test(e)), errors.join("; "));
});

test("validator does NOT flag repeated on:\"discretionary\" (intent-path, not moment-lookup)", () => {
  const errors = validateManifest(mf(roots({ idle: "fire" }), [
    { on: "hook:Stop", intent: "done" },
    { on: "discretionary", intent: "idle" },
    { on: "discretionary", intent: "fail" },
  ]), NAMES);
  assert.deepEqual(errors, []);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test scripts/check-manifest.test.mjs`
Expected: FAIL — the object-entry pool tests error today (rule 5 reads `w` as the object and rejects the
weight / mis-reports), and there is no duplicate-moment rule yet.

- [ ] **Step 3: Update the schema `shared/manifest.schema.json`**

Replace the `{pool}` arm of the bindings `oneOf` (the object with `required: ["pool"]`) with:

```json
                { "type": "object",
                  "required": ["pool"],
                  "properties": {
                    "pool": { "type": "object", "additionalProperties": {
                      "oneOf": [
                        { "type": "number" },
                        { "type": "object",
                          "properties": {
                            "weight": { "type": "number" },
                            "params": { "type": "object" },
                            "label":  { "type": "string" }
                          },
                          "additionalProperties": false }
                      ]
                    } },
                    "noRepeat": { "type": "boolean" },
                    "brightness": { "type": "number" }
                  },
                  "additionalProperties": false }
```

- [ ] **Step 4: Update the validator `scripts/check-manifest.mjs`**

In rule 5, replace the pool loop body so the weight is read from a number OR an object's `.weight`:

```js
      } else if (value && typeof value === "object" && value.pool) {
        for (const [anim, w] of Object.entries(value.pool)) {
          if (!animationNames.has(anim))
            errors.push(`renderer "${rid}" pool "${intent}" references missing animation "${anim}"`);
          const weight = typeof w === "number" ? w
            : (w && typeof w === "object" ? (typeof w.weight === "number" ? w.weight : 1) : NaN);
          if (typeof weight !== "number" || Number.isNaN(weight) || weight < 0)
            errors.push(`renderer "${rid}" pool "${intent}" has invalid weight for "${anim}"`);
        }
      }
```

Add a new rule 6 (place it after the rule-5 renderer loop closes, before `return errors;`): duplicate
moment `on` within a harness. `discretionary` is reached via the intent path, not moment-lookup, so
multiple `on:"discretionary"` rows are legal and must be exempt.

```js
  // 6. No duplicate moment `on` within a harness (intentForMoment returns the FIRST
  //    match, so a duplicate hook moment would silently never fire). "discretionary"
  //    is exempt: it is reached via the intent path, not moment-lookup, and is shared
  //    by the discretionary intents intentionally.
  for (const [hid, h] of Object.entries(manifest.harnesses || {})) {
    const seen = new Set();
    for (const m of (h.moments || [])) {
      const on = m && m.on;
      if (on == null || on === "discretionary") continue;
      if (seen.has(on)) errors.push(`harness "${hid}" has duplicate moment "${on}"`);
      seen.add(on);
    }
  }
```

- [ ] **Step 5: Run the validator tests, verify they pass**

Run: `node --test scripts/check-manifest.test.mjs`
Expected: PASS (new + existing). Also run `npm run check:manifest` and confirm the REAL seed still
reports `manifest OK` (the seed has no rich pools yet — that lands in Task 7 — and no duplicate moments).

- [ ] **Step 6: Commit**

```bash
git add shared/manifest.schema.json scripts/check-manifest.mjs scripts/check-manifest.test.mjs
git commit -m "feat(manifest): schema+validator accept rich pools; add duplicate-moment rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `fire()` — pass meta to renderers + noRepeat-aware re-pick

**Files:**
- Modify: `shared/registry.js`
- Test: `shared/registry.test.js`

**Interfaces:**
- Consumes: `resolve`, `effectiveBindings`, `pickWeighted` (Task 1 shapes).
- Produces: `fire()` calling `render(value, meta)` with `meta = { params?, label?, brightness? }`; the
  re-pick path now honors noRepeat (exclude + `ctx.last` update) and surfaces the re-picked entry's params/label.

- [ ] **Step 1: Write the failing tests**

Add to `shared/registry.test.js` (keep existing tests):

```js
test("fire passes meta (params/label/brightness) as the 2nd arg to render", async () => {
  const manifest = {
    intents: { idle: { fallback: null, root: true } },
    harnesses: {},
    renderers: { r: { bindings: { idle: {
      brightness: 5, pool: { fire: { weight: 1, params: { speed: 50 }, label: "fire" } },
    } } } },
  };
  const got = [];
  const reg = createRegistry();
  reg.register({ id: "r", render: (v, meta) => { got.push({ v, meta }); } });
  const out = await fire(manifest, { intent: "idle", renderers: ["r"] }, reg, { rng: () => 0 });
  assert.equal(got[0].v, "fire");
  assert.deepEqual(got[0].meta, { params: { speed: 50 }, label: "fire", brightness: 5 });
  assert.equal(out[0].value, "fire");
  assert.equal(out[0].brightness, 5);
});

test("fire re-pick surfaces the re-picked entry's params and honors noRepeat", async () => {
  // pool: missing (rich) is absent on disk; real (rich) exists. rng=0 would pick "missing"
  // first; fire must exclude it, re-pick "real", and surface real's params.
  const manifest = {
    intents: { idle: { fallback: null, root: true } },
    harnesses: {},
    renderers: { r: { bindings: { idle: {
      noRepeat: true,
      pool: { missing: { weight: 5, params: { a: 1 } }, real: { weight: 1, params: { b: 2 }, label: "real" } },
    } } } },
  };
  const got = [];
  const reg = createRegistry();
  reg.register({ id: "r", render: (v, meta) => { got.push({ v, meta }); } });
  const out = await fire(manifest, { intent: "idle", renderers: ["r"] }, reg,
    { rng: () => 0, exists: (n) => n !== "missing", last: {} });
  assert.equal(got[0].v, "real");
  assert.deepEqual(got[0].meta, { params: { b: 2 }, label: "real" });
  assert.equal(out[0].value, "real");
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test shared/registry.test.js`
Expected: FAIL — `render` currently gets only one arg (meta undefined), and the re-pick path returns
`{intent,value}` with no params and does not honor noRepeat/`ctx.last`.

- [ ] **Step 3: Implement in `shared/registry.js`**

Replace `resolveExisting` so the re-pick honors noRepeat, updates `ctx.last`, and surfaces the
re-picked entry's `params`/`label` + the binding `brightness`:

```js
function resolveExisting(manifest, rendererId, opts, ctx) {
  const base = resolve(manifest, { ...opts, renderer: rendererId }, ctx);
  if (!base || !ctx || typeof ctx.exists !== "function") return base;
  if (ctx.exists(base.value)) return base;
  // The pick named a missing animation. Re-pick from the same pool, excluding misses.
  const binding = effectiveBindings(manifest, rendererId)[base.intent];
  if (!binding || typeof binding !== "object" || !binding.pool) return base; // not a pool
  const remaining = Object.fromEntries(
    Object.entries(binding.pool).filter(([name]) => ctx.exists(name)));
  if (Object.keys(remaining).length === 0) return base; // all missing; caller no-ops
  const key = `${rendererId}:${base.intent}`;
  const exclude = binding.noRepeat && ctx.last ? (ctx.last[key] ?? null) : null;
  const value = pickWeighted(remaining, ctx.rng || Math.random, exclude);
  if (ctx.last && value != null) ctx.last[key] = value;
  const out = { intent: base.intent, value };
  const entry = value != null ? remaining[value] : null;
  if (entry && typeof entry === "object") {
    if (entry.params != null) out.params = entry.params;
    if (entry.label != null) out.label = entry.label;
  }
  if (binding.brightness != null) out.brightness = binding.brightness;
  return out;
}
```

Replace the dispatch line in `fire()` so each renderer receives `(value, meta)`:

```js
    const renderer = registry.get(id);
    const res = renderer ? resolveExisting(manifest, id, opts, ctx) : null;
    if (renderer && res) {
      const { intent, value, ...meta } = res;     // meta = params?/label?/brightness?
      await renderer.render(value, meta);
      out.push({ renderer: id, ...res });
    } else {
      out.push(null);
    }
```

> `meta` is `{}` for a plain string/number-pool binding (then `render(value, {})` — renderers must treat
> an empty/absent meta as "no extras", which they already do). `out` keeps the flat
> `{renderer,intent,value,...rich}` shape its existing tests assert.

- [ ] **Step 4: Run the tests, verify they pass**

Run: `node --test shared/registry.test.js`
Expected: PASS (new + existing, including the prior re-pick test which now also exercises noRepeat-safe behavior).

- [ ] **Step 5: Commit**

```bash
git add shared/registry.js shared/registry.test.js
git commit -m "feat(manifest): fire() passes meta to render(); noRepeat-aware re-pick with params

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `esp32-8x8` renderer — apply meta brightness + params

**Files:**
- Modify: `shared/renderers/esp32.js`
- Test: `shared/renderers/esp32.test.js`

**Interfaces:**
- Consumes: `expressionToWire` (unchanged).
- Produces: `makeEsp32Renderer({ loadExpression, postFrames, postAnimation, setBrightness, isFirmware })`;
  `render(name, meta)` where `meta = { params?, brightness? }`. `postAnimation(type, params?)` gains an
  optional 2nd arg; `setBrightness(level) -> Promise` is a new injected dep.

- [ ] **Step 1: Write the failing tests**

Add to `shared/renderers/esp32.test.js` (keep existing tests; update the existing `harness()` helper to
also capture brightness + animation params — shown here as a fresh helper for the new tests):

```js
function richHarness() {
  const posted = { frames: [], anims: [], brightness: [] };
  const deps = {
    isFirmware: (n) => ["fire", "claudesweep"].includes(n),
    loadExpression: () => null,
    postFrames: async (w) => { posted.frames.push(w); },
    postAnimation: async (t, params) => { posted.anims.push({ t, params }); },
    setBrightness: async (level) => { posted.brightness.push(level); },
  };
  return { deps, posted };
}

test("a firmware pick applies meta.brightness then posts the animation with meta.params", async () => {
  const h = richHarness();
  await makeEsp32Renderer(h.deps).render("fire", { brightness: 5, params: { speed: 50, intensity: 70 } });
  assert.deepEqual(h.posted.brightness, [5]);
  assert.deepEqual(h.posted.anims, [{ t: "fire", params: { speed: 50, intensity: 70 } }]);
});

test("no meta -> no brightness call, animation posted with undefined params (back-compat)", async () => {
  const h = richHarness();
  await makeEsp32Renderer(h.deps).render("fire");
  assert.equal(h.posted.brightness.length, 0);
  assert.deepEqual(h.posted.anims, [{ t: "fire", params: undefined }]);
});
```

> Update the EXISTING esp32 tests' `harness()` deps to include `setBrightness: async () => {}` and a
> `postAnimation: async (t) => { posted.anims.push(t); }` that still records just the type (or migrate
> those assertions to the `{t,params}` shape) — pick one and keep the file internally consistent.

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test shared/renderers/esp32.test.js`
Expected: FAIL — `render` ignores the 2nd arg, never calls `setBrightness`, and passes no params to `postAnimation`.

- [ ] **Step 3: Implement in `shared/renderers/esp32.js`**

```js
export function makeEsp32Renderer({ loadExpression, postFrames, postAnimation, setBrightness, isFirmware }) {
  return {
    id: "esp32-8x8",
    async render(name, meta = {}) {
      if (typeof name !== "string") return;          // defensive: only animation names here
      if (meta && meta.brightness != null && typeof setBrightness === "function") {
        await setBrightness(meta.brightness);        // ambient idle dimming, etc.
      }
      if (isFirmware(name)) { await postAnimation(name, meta ? meta.params : undefined); return; }
      const json = loadExpression(name);
      if (!json) return;                              // missing expression -> no-op (never throw)
      await postFrames(expressionToWire(json));
    },
  };
}
```

> Update the file's top comment to note the new `setBrightness` dep + that `meta.params` is forwarded to
> firmware launches. (Frame-expressions ignore `params` — they have no launch params — but DO honor
> `meta.brightness`, which is applied above before the branch.)

- [ ] **Step 4: Run the tests, verify they pass**

Run: `node --test shared/renderers/esp32.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/renderers/esp32.js shared/renderers/esp32.test.js
git commit -m "feat(manifest): esp32-8x8 applies meta brightness + forwards firmware params

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `web-sim` renderer — tolerate the meta arg

**Files:**
- Modify: `shared/renderers/web-sim.js`
- Test: `shared/renderers/web-sim.test.js`

**Interfaces:**
- Produces: `render(name, meta?)` — meta is accepted and ignored (board-only concerns: brightness is a
  physical-panel setting, firmware params tune the board firmware; the JS sim ports are param-less). Kept
  in the signature so `fire()`'s uniform `render(value, meta)` call is explicit and documented.

- [ ] **Step 1: Write the failing test**

Add to `shared/renderers/web-sim.test.js` (keep existing tests):

```js
test("render tolerates a meta 2nd arg (ignored) and still drives the firmware sim", async () => {
  const f = fakePanel();
  await makeWebSimRenderer({ panel: f.panel, loadExpression, firmwareSims })
    .render("claudesweep", { brightness: 5, params: { speed: 90 } });
  assert.equal(f.calls.steppers.length, 1);
  assert.equal(f.calls.frames.length, 0);
});
```

> This passes against the current code already if `render` simply ignores extra args — so to make it a
> genuine RED first, the implementer should first add `meta` to the signature with a comment, OR accept
> that this test documents/guards existing tolerant behavior. If it is green on first run, note that in
> the report (it is a guard test, not a behavior change) and proceed; do not fabricate a failure.

- [ ] **Step 2: Run it**

Run: `node --test shared/renderers/web-sim.test.js`
Expected: PASS (JS ignores extra args). This task is a signature/documentation hardening, not a behavior change.

- [ ] **Step 3: Update `shared/renderers/web-sim.js`**

Make the meta arg explicit + documented:

```js
    render(name, _meta) {
      // _meta (params/brightness/label) is intentionally ignored: brightness is a
      // physical-panel setting and firmware params tune the board firmware, neither of
      // which applies to the in-browser canvas sim. Kept in the signature so the
      // uniform fire() render(value, meta) call is explicit. label could drive a future
      // caption but is not rendered here in v1.
      if (typeof name !== "string") return;
```

(Leave the rest of the function body unchanged.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test shared/renderers/web-sim.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/renderers/web-sim.js shared/renderers/web-sim.test.js
git commit -m "feat(manifest): web-sim render(name, meta) tolerates+documents ignored board meta

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Seed the rich `idle` binding (lossless 8-app) + prove the whole stack

**Files:**
- Modify: `shared/manifest.json`
- Modify: `shared/renderers/integration.test.js`

**Interfaces:**
- Consumes: the extended schema/validator (Task 3), resolver (Task 1), `fire()` (Task 4), esp32 (Task 5).
- Produces: a seed whose `esp32-8x8` `idle` binding losslessly encodes today's `matrix_idle` lineup, ready
  for Plan 3b's live flip. (web-sim inherits it.)

This is the capstone: encode `idle.ts`'s `IDLE_APPS` (8 apps + params), `IDLE_BRIGHTNESS = 5`, and the
human labels into the manifest's rich pool, then prove the extended stack resolves + dispatches it across
all three renderers against the REAL seed.

- [ ] **Step 1: Rewrite the `esp32-8x8` `idle` binding in `shared/manifest.json`**

Replace the current `"idle": { "noRepeat": true, "pool": { "fire": 1, "frostbite": 1, "snow": 1, "claudesweep": 1 } }`
with the lossless rich form (values copied verbatim from `mcp_server/idle.ts` `IDLE_APPS` + `IDLE_BRIGHTNESS`):

```json
        "idle": {
          "noRepeat": true,
          "brightness": 5,
          "pool": {
            "fire":        { "weight": 1, "params": { "speed": 50, "intensity": 70 }, "label": "🔥 fire" },
            "dancefloor":  { "weight": 1, "params": { "palette": 0, "hold": 6 }, "label": "🪩 dance floor" },
            "fireworks":   { "weight": 1, "params": { "color1": "#ff0050", "color2": "#00e0ff", "color3": "#ffd000" }, "label": "🎆 fireworks" },
            "clock":       { "weight": 1, "params": { "color1": "#00ff88", "color2": "#0088ff", "color3": "#ff4040" }, "label": "🕐 clock" },
            "frostbite":   { "weight": 1, "params": { "color": "#66ccff", "sparkle": 5, "mist": 4 }, "label": "❄️ frostbite" },
            "matrix_rain": { "weight": 1, "params": { "theme": "classic", "speed": 60 }, "label": "🟩 matrix" },
            "snow":        { "weight": 1, "params": { "speed": 110 }, "label": "❄️ snow" },
            "claudesweep": { "weight": 1, "params": {}, "label": "🟠 claude sweep" }
          }
        }
```

- [ ] **Step 2: Validate the seed**

Run: `npm run check:manifest`
Expected: `manifest OK`. (All 8 names are in the validator's `FIRMWARE` set; weights are valid; no
duplicate moments.) If it errors, read the error and fix the binding to match the rich shape — do NOT
relax the validator.

- [ ] **Step 3: Update the idle assertions in `shared/renderers/integration.test.js`**

The integration test's second test fires `{ intent: "idle" }` with `rng: () => 0`. With the rich 8-app
pool the first key is `fire` (firmware), so esp32 still posts an animation and web-sim still drives a
stepper — but esp32 now also receives `meta.brightness=5` + `meta.params`, so its fake deps need
`setBrightness`, and the test should assert the richer dispatch. Update the `build()` helper's esp32
registration and the idle test:

```js
  // in build(): give the esp32 fake a setBrightness recorder and capture anim params
  const board = { frames: [], anims: [], brightness: [] };
  ...
  reg.register(makeEsp32Renderer({
    isFirmware: (n) => FIRMWARE.includes(n),
    loadExpression,
    postFrames: async (w) => board.frames.push(w),
    postAnimation: async (t, params) => board.anims.push({ t, params }),
    setBrightness: async (level) => board.brightness.push(level),
  }));
```

```js
test("idle pool resolves a firmware sim on web-sim and an animation+brightness on esp32", async () => {
  const b = build();
  const out = await fire(MANIFEST, { intent: "idle" }, b.reg, { rng: () => 0 });
  assert.equal(out.length, 3);
  for (const o of out) assert.equal(o.intent, "idle");
  // rng 0 -> first pool key "fire": firmware -> esp32 posts an animation (with its params)
  // at idle brightness 5; web-sim plays the "fire" sim via a stepper.
  assert.equal(b.board.anims.length, 1);
  assert.equal(b.board.anims[0].t, "fire");
  assert.deepEqual(b.board.anims[0].params, { speed: 50, intensity: 70 });
  assert.deepEqual(b.board.brightness, [5]);
  assert.equal(b.panelCalls.steppers, 1);
});
```

> If the seed's first idle key changes in a future edit, realign these to the actual first key (read the
> manifest) rather than changing the renderers. The web-sim `firmwareSims` map (`FIRMWARE_SIMS`) has no
> `clock` port; the seed's first key is `fire` (which DOES have a sim), so this test is unaffected — but
> note in the report that a future seed reordering putting `clock` first would make web-sim no-op on that pick.

- [ ] **Step 4: Run the integration test + the full suite**

Run: `node --test shared/renderers/integration.test.js`
Expected: PASS.
Run: `npm test`
Expected: `manifest OK` then the full suite green (the prior 110 plus this plan's new cases; report the count).

- [ ] **Step 5: Commit**

```bash
git add shared/manifest.json shared/renderers/integration.test.js
git commit -m "feat(manifest): seed rich lossless idle binding (8 apps + params + brightness)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage (Plan 3a portion — the foundation the spec §9.1 migration needs + the user's two decisions):**
- "Extend binding to carry params" (user decision) → object pool entries `{weight,params,label}` + pool
  `brightness`, end-to-end through resolver/schema/validator/fire/esp32 (Tasks 1,3,4,5) ✓
- Lossless idle (params + brightness 5 + labels preserved) → rich seed `idle` binding (Task 7) ✓
- JS↔Python parity preserved (spec "mirrored resolvers") → Task 2 + parity fixtures ✓
- Bulletproof-at-CI (spec) → schema + validator extended to accept rich pools and reject malformed ones
  (Task 3) ✓
- Carry-forward T1 (noRepeat-aware re-pick) → Task 4 ✓; Plan 1 carry (duplicate-moment rule) → Task 3 ✓
- Backward compatibility (every existing binding resolves identically) → Tasks 1/2 keep `{intent,value}`
  for number pools + strings; full suite stays green (Task 7 Step 4) ✓
- Correctly DEFERRED (not here): real board/`loadExpression`/`exists` wiring incl. canned-name coverage,
  the consumer flips, dead-config deletion — all Plan 3b.

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. The two "may already be green"
notes (web-sim meta tolerance in Task 6; the parity skip-if-no-Python in Task 2) describe real
environment behavior with explicit instructions, not deferred work. OK.

**3. Type consistency:** `resolve` → `{intent,value,params?,label?,brightness?}` is used identically by
Task 1 (JS), Task 2 (Python, same dict keys), Task 4 (`fire` destructures `{intent,value,...meta}`), and
Task 5 (esp32 reads `meta.params`/`meta.brightness`). `pickWeighted` object-weight reading is identical
in resolver.js (Task 1), manifest_resolver.py (Task 2), and check-manifest.mjs rule 5 (Task 3). The rich
pool shape `{weight?,params?,label?}` + binding `brightness` matches across schema (Task 3), seed (Task 7),
and the resolver. `makeEsp32Renderer` dep set gains `setBrightness` consistently in esp32.js (Task 5) and
the integration test's registration (Task 7). OK.

---

## Execution Handoff

Plan complete and saved to
`docs/superpowers/plans/2026-06-25-trigger-manifest-plan3a-binding-extension.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task (implementers can be cheap-tier for the
   transcription-heavy tasks; Tasks 1/2/4 carry real logic edits and merit a standard-tier implementer),
   task review between, broad review at the end. Same cadence as Plans 1 & 2.
2. **Inline Execution** — execute the tasks in-session with checkpoints.

Which approach?
