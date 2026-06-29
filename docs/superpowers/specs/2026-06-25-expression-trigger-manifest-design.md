# Expression Trigger Manifest — design

**Status:** design approved (brainstorming), pending implementation plan.
**Date:** 2026-06-25.
**Supersedes/absorbs:** the wiring portion of
`2026-06-24-hooks-and-animation-moments.md` and the rotation-role grouping in the
Expression Studio plan. Matures the presence protocol
(`2026-06-17-presence-protocol-v0-design.md`) into its trigger + rendering layer.

---

## 1. Overview & north star

**One sentence:** a one-file install (`.mcpb`) gives an LLM an **animation engine** —
it serves a browser **Studio** where the user assigns an animation library to the
harness's events, and plays the result on a **real board or a built-in virtual one**,
with no extra software.

**How the project evolved (context for the design):**
- *Started as:* an MCP server that triggers firmware animations on the board on command
  ("show fire", "show the clock").
- *Became:* the board is a generic **display with an API**; the value is the authored
  **animation library** plus a system that plays animations **automatically on the
  harness's lifecycle events**, not only on command.
- *Now adds:* a **Studio** to choose which animations fire on which events (with weights),
  routed through a **render function** to a **display interface**; each display knows how
  to draw the animations on its own surface.

**Design pillars (all chosen explicitly during brainstorming):**
1. **Layered & renderer-agnostic** — moment → intent → renderer. The portable layer
   (intents) knows nothing about pixels.
2. **One live source of truth** — a single `manifest.json` every consumer reads at
   runtime; the scattered config (wait pool, idle lineup, presence map, hook signals,
   name-convention classifier) is migrated onto it and deleted.
3. **A real, adoptable vocabulary** — a curated **core** intent set plus a reserved
   **`x-` extension** namespace, with **fallback chains** so coarse and rich
   implementations interoperate.
4. **Pluggable renderers** — a renderer is essentially one function; a new display drops
   in without touching the protocol.
5. **Bulletproof** — strict at build/CI (reject malformed manifests), lenient at runtime
   (always degrade, never blank the board or break a turn).
6. **Claude-first, harness-agnostic** — tuned for Claude today; ready for other harnesses
   by adding a `harnesses.<id>` block, with no downstream changes.

---

## 2. The model — three layers

```
   MOMENT          →        INTENT         →        RENDERER(S)
(when it happens)      (what it means)         (how/where it shows)

 Stop hook        →    intent "done"      →  ┌─ esp32-8x8 → bloom.json (LEDs)
 SubagentStop     →    "results-merged"   →  ├─ web-sim   → bloom on a canvas
 agent decides    →    "celebrate"        →  └─ card      → "✓ Done" + green
```

- **Moment** — the trigger. Three flavors: **lifecycle hook** (host-fired), **discretionary**
  (the agent calls a tool when the moment fits), **rotation** (a moment whose binding is a
  weighted pool).
- **Intent** — the portable, renderer-agnostic semantic. *This is the protocol.* The
  manifest maps moments → intents and knows nothing about pixels.
- **Renderer** — a plugin that turns a resolved intent into output on one surface.

This is the presence protocol's "one semantic message, many renderers" generalized to the
*trigger* side. Presence intents become a subset of this vocabulary; `INTENT_TO_CANNED`
becomes one renderer's binding table.

---

## 3. Intent vocabulary & fallback chains

### 3.1 Fallback chains (graceful degradation / cross-harness folding)

Every intent may declare a **`fallback`** — a broader intent it degrades to. Resolution
walks **specific → general** until it finds an intent the renderer (or harness) actually
implements. Consequences:
- A renderer **only must implement the roots**; anything richer degrades automatically, so
  a renderer is never caught not knowing an intent.
- **Cross-harness folding:** harness A emits `error`; a renderer that only binds `fail`
  still works because `error → fail`. They stay distinct when both sides are rich, and fold
  when one side is coarse.
- **Adding an intent never breaks anyone** — unknown intents degrade to a known ancestor.

### 3.2 Roots / conformance set

A valid renderer **must** implement these six (the chains all terminate here):

`info` · `working` · `done` · `attention` · `fail` · `idle`

`info` is the ultimate semantic floor ("neutral status"). Conformance = "bind the six roots;
bind more for richer output." This single rule is what makes it an adoptable spec.

### 3.3 Core vocabulary (covers everything Claude expresses today)

| Intent | Fallback | Meaning | Origin folded in |
|---|---|---|---|
| `info` | — (root) | neutral status / ultimate floor | presence `info` |
| `working` | — (root) | busy, in progress | presence `working`, wait spinner |
| `done` | — (root) | turn / task finished | presence `done`, canned `done` |
| `attention` | — (root) | engage with me | presence `alert` |
| `fail` | — (root) | a setback / something wrong | presence `error`, canned `sad` |
| `idle` | — (root) | ambient / away | presence `idle` |
| `thinking` | `working` | reasoning hard | presence `thinking` |
| `heard` | `working` | "got your message" | (new; UserPromptSubmit) |
| `compacting` | `working` | folding memory down | (new; PreCompact) |
| `session-start` | `info` | booting / waking | (new; SessionStart) |
| `session-end` | `idle` | signing off | (new; SessionEnd) |
| `results-merged` | `done` | a helper/subagent reported back | (new; SubagentStop) |
| `approve` | `done` | acknowledgement / thumbs-up | presence `ok`, canned `thumbsup` |
| `celebrate` | `done` | a win / milestone | presence `celebrate`, canned `party` |
| `delight` | `celebrate` | pleasant surprise | canned `sparkle` |
| `awaiting-input` | `attention` | blocked on the human | presence `question`, ask-* |
| `alert` | `attention` | active "look here" | canned `alert` |
| `error` | `fail` | an error | presence `error`, canned `cross` |
| `fatal` | `error` | something died | (new) |
| `sleep` | `idle` | resting | canned `sleep` |
| `greet` | `info` | hello | canned `smiley` |
| `affection` | `info` | warmth | canned `heart` |
| `fun` | `info` | playful | canned `spaceship` |

### 3.4 Extension namespace

Any `x-*` intent (e.g. `x-deploy-shipped`, `x-coffee-break`) is a valid **custom** intent.
It **must** declare a `fallback` to a known (core or other custom) intent, validated at
build time. This is how other people grow the vocabulary without collisions and without
breaking renderers that have never heard of their intent.

---

## 4. The manifest schema

One file, `shared/manifest.json`, three sections mirroring the three layers. Format is
**JSON** (TS and Python parse it natively, no deps; public-spec-friendly), with a sibling
`manifest.schema.json` (JSON Schema) for validation.

```jsonc
{
  "version": "1.0",

  // LAYER 1 — the protocol: vocabulary + fallback chains (mostly static).
  "intents": {
    "info":           { "fallback": null, "root": true, "doc": "neutral status" },
    "working":        { "fallback": null, "root": true, "doc": "busy" },
    "done":           { "fallback": null, "root": true, "doc": "finished" },
    "attention":      { "fallback": null, "root": true, "doc": "engage with me" },
    "fail":           { "fallback": null, "root": true, "doc": "a setback" },
    "idle":           { "fallback": null, "root": true, "doc": "ambient" },
    "thinking":       { "fallback": "working", "doc": "reasoning hard" },
    "compacting":     { "fallback": "working", "doc": "folding memory" },
    "results-merged": { "fallback": "done", "doc": "a helper reported back" },
    "celebrate":      { "fallback": "done", "doc": "a win" },
    "error":          { "fallback": "fail", "doc": "an error" },
    "fatal":          { "fallback": "error", "doc": "something died" }
    // …rest of §3.3…
  },

  // LAYER 2 — moment → intent, PER HARNESS (Claude-first; others additive).
  "harnesses": {
    "claude-code": {
      "moments": [
        // Seed maps UserPromptSubmit → `working` to reproduce today's wait spinner
        // exactly. `heard` is the richer alternative (a distinct "ingest" animation)
        // the user can switch to later; it falls back to `working` regardless.
        { "on": "hook:UserPromptSubmit",               "intent": "working" },
        { "on": "hook:Stop",                           "intent": "done" },
        { "on": "hook:SubagentStop",                   "intent": "results-merged" },
        { "on": "hook:PreCompact",                     "intent": "compacting" },
        { "on": "hook:PreToolUse:AskUserQuestion",     "intent": "awaiting-input" },
        { "on": "hook:PreToolUse:ExitPlanMode",        "intent": "awaiting-input" },
        // clear-on-answer: flip back to busy the moment the human responds
        { "on": "hook:PostToolUse:AskUserQuestion",    "intent": "working" },
        { "on": "hook:PostToolUse:ExitPlanMode",       "intent": "working" },
        { "on": "hook:Notification:permission_prompt", "intent": "attention" },
        { "on": "hook:SessionStart",                   "intent": "session-start" },
        { "on": "hook:SessionEnd",                     "intent": "session-end" },
        { "on": "discretionary", "intent": "celebrate" },
        { "on": "discretionary", "intent": "fatal" },
        { "on": "discretionary", "intent": "idle" }
        // …other discretionary emotes…
      ]
    }
  },

  // LAYER 3 — intent → concrete output, PER RENDERER (the registry).
  "renderers": {
    "esp32-8x8": {
      "doc": "8×8 WS2812B board",
      "bindings": {
        "done":           "bloom",
        "results-merged": "swarm-merge",
        "fatal":          "skull",
        "compacting":     { "pool": { "black-hole": 2, "galaxy": 1 } },
        "celebrate":      { "pool": { "confetti": 1, "party": 1, "fireworks": 1 } },
        "working":        { "pool": { "wait-claude": 40, "wait-rainbow": 30, "working": 10 } },
        "idle":           { "noRepeat": true, "pool": { "galaxy": 1, "aurora": 1, "jellyfish": 1 } }
        // …roots required; everything else optional…
      }
    },
    "web-sim": { "doc": "browser canvas board", "inherits": "esp32-8x8" },
    "card":    { "doc": "desktop presence card",
                 "bindings": { "done": { "glyph": "✓", "text": "Done", "color": "#00c83c" } } }
  }
}
```

### 4.1 Universal pooling

Pooling is a property of a **binding**, not of an intent — so **any** intent on **any**
renderer can bind to either a single animation (a string) or a weighted **pool**
(`{ "pool": { name: weight, … } }`). `working` and `idle` are not special; they are simply
intents bound to pools. This is what lets the whole library be used everywhere
(`compact1/2/3` weighted under `compacting`, the same animation reused across many intents,
even "butterfly for everything").

Picking semantics (one unified weighted picker replaces `pickWait` + `pickIdleApp`):
- weight defaults to `1` when omitted; `0` disables an entry; all-zero → uniform.
- optional per-pool `"noRepeat": true` avoids an immediate repeat (good for ambient `idle`;
  the wait pool leaves it off so weights stay exact — now a per-pool choice).

### 4.2 Reuse & assignability guarantee

A binding is a **reference**, not ownership; there is **no uniqueness constraint** and **no
eligibility gate** (names are plain identifiers — the old `wait-`/`ask-` name-convention
roles are removed). Therefore **every animation is always assignable to every intent on
every renderer.** "Orphan" stops being a structural category and becomes a query result:
*not referenced by any binding yet* — always fixable, never a lock-out. Some animations
staying unused is fine and expected.

### 4.3 Forward-compat: animation dimensions

Animation files gain optional `width`/`height` (default `8`/`8`). A future higher-res
renderer can either **upscale** 8×8 frames (integer multiples scale cleanly; bloom softens
the blocks) or bind to **native** higher-res assets — without a format change. Authoring
tooling stays 8×8 for v1.

---

## 5. The renderer plugin interface

The goal: **adding a renderer is tiny.** Everything generic lives once in `shared/`; a
renderer implements essentially one method.

### 5.1 Shared resolver (renderer-agnostic)

```
fire(manifest, momentOrIntent, rendererId, ctx):
  1. moment → intent        (look up harnesses.<id>.moments)
  2. resolve intent         (walk fallback chain until rendererId has a binding)
  3. if binding is a pool   (pick one — weighted; honor noRepeat via ctx)
  4. hand the leaf value to the renderer's render()
```

### 5.2 The plugin contract

```ts
interface Renderer {
  id: string;
  render(value: BindingValue): Promise<void>;   // the ONLY required method
}
```

`value` is *that renderer's own* binding shape (the 8×8 gets an animation name; the card
gets `{glyph,text,color}`). The renderer interprets its own bindings; the shared core never
needs to. Conformance ("covers the 6 roots?") and validation are generic, computed from the
manifest. A new renderer is: pick an `id`, write `render()`, register it.

### 5.3 Registry + dispatch

```ts
registry.register(esp32Renderer);
registry.register(webSimRenderer);
registry.register(cardRenderer);
fire(manifest, "hook:PreCompact", registry.active());  // resolves + dispatches to all active
```

### 5.4 Reference renderers (v1)

| Renderer | `render(value)` does | Runs in |
|---|---|---|
| `esp32-8x8` | name → load `expressions/<name>.json` → POST to board | MCP (TS) **+** hook (Python) |
| `web-sim` | name → draw frames via `shared/render.js` bloom Panel on a canvas | browser |
| `card` | `{glyph,text,color}` → update the presence-card DOM | browser |

**Binding inheritance:** a renderer may declare `"inherits": "<id>"` to reuse another's
bindings (the web-sim is the 8×8 renderer drawn in a browser, so it inherits — no duplicate
binding table).

### 5.5 Cross-language parity (the only duplicated logic)

The 8×8 is driven from two runtimes — the MCP server (TS) and `matrix_signal.py` (Python,
because hooks can't call MCP). The ~40-line resolver is therefore mirrored in TS and Python.
It is bulletproofed by: **both read the one `manifest.json`** (data is single-source) and
**both run against the same shared test fixtures** so they cannot drift. (This shrinks and
formalizes the existing pattern where the Python hook mirrors `wait.ts`.)

---

## 6. Runtime & bulletproofing

**Philosophy:** strict at build/CI, lenient at runtime.

### 6.1 Loading

`manifest.json` is located via a resolved path (env var `MATRIX_MANIFEST`, sensible
default), so every independently-installed component reads the **same file**. Consumers:
the MCP server (TS), the Python hook, and the Studio (browser, via the engine).

### 6.2 Fail-safe behavior (runtime never crashes/blanks)

| Failure | Behavior |
|---|---|
| manifest missing / unparseable | fall back to built-in defaults (snake/done), log once |
| intent has no binding on this renderer | walk fallback chain → a root (guaranteed) |
| pool entry names a missing animation | skip it, re-pick from the rest of the pool |
| animation file missing / board offline | existing silent no-op (turn never blocked) |

The root conformance requirement is what guarantees the fallback walk terminates.

### 6.3 Validation — `npm run check:manifest` (CI-gated + load-time)

`manifest.schema.json` + a validator assert:
- structure well-formed (schema);
- every `fallback` resolves to a real intent; **no cycles**; every chain ends at a root;
- every renderer covers all 6 roots (conformance);
- every binding/pool entry references an animation that **exists** in the library;
- weights are numbers ≥ 0; `x-*` intents declare a fallback.

### 6.4 Testing

- **Resolver unit tests (TS):** fallback walking, weighted pick (seeded RNG), `noRepeat`,
  missing-binding degradation.
- **Parity fixtures:** the same cases run against the **Python** resolver (no drift).
- **Validator tests:** broken manifests assert each rule fires.
- **Gallery integration:** wired/orphan state derives correctly from a sample manifest.

---

## 7. Packaging & runtime topology (how a user installs and runs it)

The MCP server **evolves into a small local "engine."** The crucial fact: a Claude Desktop
`.mcpb` extension requires **no other software** — Claude Desktop provides the runtime. The
engine *also* serves the Studio, so there is nothing else to install.

```
ONE download:  esp32matrix.mcpb  ──double-click──▶  Claude Desktop installs it
                                                    (runtime provided — no Node, no server)

THE ENGINE (the MCP server, evolved), running inside Claude Desktop:
   ├─ gives Claude its tools  (express intents, "show fire", etc.)
   ├─ reads/writes the ONE manifest.json
   ├─ serves the Studio UI at  http://localhost:<port>
   └─ on a fired intent, dispatches to active displays:
        ├─ real board    → HTTP POST frames        (if hardware present)
        └─ virtual board → WebSocket → browser      (if not)

User opens  http://localhost:<port>  in their normal browser → the Studio,
   with a built-in virtual 8×8 board that becomes their display when no hardware exists.
```

**Two front doors (same Studio codebase, two deployments):**

| | Showcase (portfolio front door) | The engine (real use) |
|---|---|---|
| Where | public GitHub Pages URL | `localhost:<port>`, served by the engine |
| Install | none — open the link | the one `.mcpb` |
| Claude wired? | no — a playground | yes — real events |
| Writes manifest? | no (demo/local) | yes (engine writes the file) |
| Virtual board? | yes | yes |

**Linchpin to validate first:** that a `.mcpb` extension can bind a localhost port and serve
the page from inside Claude Desktop's sandbox. It is a plain Node process, so it should — but
it is the load-bearing assumption, validated in implementation step one. **Fallback** if it
cannot: ship the Studio as static files the user opens, talking to the engine over the same
localhost API.

---

## 8. Portability / harness support

**Claude-first, agnostic by design.** The boundary is deliberate and honest:

| Capability | Claude Desktop / Code | Other harness (e.g. ChatGPT) |
|---|---|---|
| Manifest + intents + renderers + board | ✅ | ✅ (host-agnostic data + resolver + HTTP display) |
| MCP tools (discretionary "express(intent)") | ✅ | ⚠️ via remote MCP server/connectors |
| `.mcpb` one-click, no-runtime install | ✅ | ❌ (Claude Desktop feature; others need a runtime/hosting) |
| Automatic event-firing (hooks) | ✅ (Claude Code hooks) | ❌ (no lifecycle-hook system to fire on) |

**Implication:** on a non-Claude harness the board, library, intents, and *discretionary*
expression work; the frictionless install and the *automatic* event-firing do not (the host
doesn't expose them). The architecture is ready regardless — add a `harnesses.<id>` block
mapping that host's events to intents, with **no downstream changes**. The limit lives in
what each host exposes, not in this design.

---

## 9. Migration & assignment

### 9.1 Phased migration (characterization-first; the board never goes dark)

1. **Build the core, change nothing else.** Add `manifest.json`, `manifest.schema.json`,
   the shared resolver, validator, tests. Nothing reads it yet — pure addition.
2. **Seed the manifest from today's reality.** Encode current behavior exactly (wait pool +
   weights, idle lineup, presence map, hook signals). Validate it reproduces today.
3. **Flip consumers one at a time, verifying after each:** gallery (read-only, safest) →
   MCP server → Python hook. Each flip is confirmed against the seed (identical behavior).
4. **Delete the dead config** (`wait-weights.json` folded in, `idle.ts` list,
   `INTENT_TO_CANNED`, the name-convention classifier) once unreferenced.

### 9.2 Assigning the ~40-animation library

Propose → approve, animation by animation: a recommended intent placement + weight (with
frequency-aware reasoning — no multi-second loop on a per-tool-call moment), confirmed or
overridden, written into the `esp32-8x8` bindings. Reuse and pools are free.

### 9.3 Orange-ring tracking (derived, not maintained)

The Studio computes state from the manifest: **green ✓** = user-approved (existing
`APPROVED` set); **orange ring** = approved but **not referenced by any binding**; assigned
→ ring clears, shows placement chips. "Wired" is a query over the manifest, always honest.

---

## 10. v1 scope vs. roadmap

**v1 builds:**
- manifest + schema + resolver (TS + Python parity) + validator + tests;
- the three renderers (`esp32-8x8`, `web-sim`, `card`);
- the engine (MCP server serving the Studio over localhost + manifest read/write + WebSocket
  dispatch to the virtual board);
- the zero-install showcase (static Pages);
- migration of today's consumers onto the manifest, then assigning the ~40 animations.

**Roadmap (not v1, not dropped):**
- stranger-grade install hardening / cross-platform polish;
- a published resolver library + a formal public spec doc for outside adopters;
- the parked **board local-control mode** (an NVS setting to ignore host pushes; see memory).

---

## 11. Open questions / risks

- **`.mcpb` port-binding** (§7 linchpin) — validate in step one; static-file fallback exists.
- **WebSocket from engine → browser virtual board** — confirm the engine can push to a
  same-origin page it serves (expected straightforward).
- **Discretionary firing on non-Claude harnesses** — depends on host MCP support maturity;
  out of v1 scope to solve, but the manifest is ready.
- **Studio write path without the engine running** — the Pages showcase is read/local-only by
  design; live writes require the engine.

---

## 12. Components & boundaries (summary)

| Unit | Purpose | Reads/Writes | Depends on |
|---|---|---|---|
| `manifest.json` | single source of truth (intents/harnesses/renderers) | — (data) | — |
| `manifest.schema.json` + validator | strict build/CI validation | reads manifest | schema |
| shared resolver (TS + Python) | moment→intent, fallback, weighted pick | reads manifest | manifest |
| renderer plugins | `render(value)` per surface | — | resolver output |
| engine (MCP server) | tools + serve Studio + dispatch to renderers | reads/writes manifest | resolver, renderers |
| Studio (browser) | assignment UI + virtual board | via engine API | engine |
| validator CLI / tests | drift + correctness gates | reads manifest + library | resolver, schema |
```
