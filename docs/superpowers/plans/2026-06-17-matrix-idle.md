# matrix_idle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Claude-callable MCP tool `matrix_idle` that launches a random pre-approved app (from a fixed curated lineup) at ambient brightness 5, for idle/bored "show something cool" moments.

**Architecture:** A small pure module (`mcp_server/idle.ts`) holds the fixed `IDLE_APPS` lineup, the `IDLE_BRIGHTNESS` constant, and a unit-tested `pickIdleApp` (random, avoids immediate repeat). `mcp_server/index.ts` adds the `matrix_idle` tool: pick → set brightness → launch via the existing `/api/display/animation`. MCP-only; no firmware/web changes.

**Tech Stack:** TypeScript (MCP server, Node16 modules, runs from compiled `dist/`), Node built-in test runner (type-stripping).

## Global Constraints

- **MCP runs from compiled `dist/index.js`.** After `.ts` edits: `cd mcp_server && npx tsc --project tsconfig.json`, then the user runs `/mcp` reconnect. Tool changes are NOT live until rebuild + reconnect.
- **MCP imports use `.js` extensions** (`import ... from "./idle.js"`) even though the source is `idle.ts` (Node16 resolution). Test files import `.ts` directly (`./idle.ts`) and run via `node --test` (Node 26 type-stripping); they are excluded from the tsc build by the existing `mcp_server/tsconfig.json` `"exclude": ["**/*.test.ts"]`.
- **Launch params POST straight to `/api/display/animation`** as `{ type, ...params }`. `speed` values are firmware ms-per-frame (no 1–5 remap — that remap only exists in `matrix_set_animation`, which we are NOT routing through).
- **Brightness 5** is set via `POST /api/brightness { level: IDLE_BRIGHTNESS }` BEFORE the launch; a failed brightness set is non-fatal (note it, don't fail the call).
- **No version bump in this plan.** This is an MCP-only change (no firmware/web touched); bumping the single repo VERSION would make firmware/web show false drift in `matrix_version`. If the user wants to cut a release later, they bump then.
- **Reuse the existing `post()` helper** in index.ts; do not add a new HTTP helper.
- Curated `params` are sensible starters the user tunes later by editing `IDLE_APPS` (rebuild + reconnect).

---

## File Structure

- **Create** `mcp_server/idle.ts` — `IdleApp` type, `IDLE_APPS` lineup, `IDLE_BRIGHTNESS`, pure `pickIdleApp`.
- **Create** `mcp_server/idle.test.ts` — unit tests for the picker + lineup sanity.
- **Modify** `mcp_server/index.ts` — import from `./idle.js`; module-level `lastIdleType`; `matrix_idle` ListTools entry + dispatch case.
- **Modify** `CLAUDE.md` — mention `matrix_idle` in the expression/presence tool area.

---

## Task 1: `idle.ts` lineup + pure picker (+ tests)

**Files:**
- Create: `mcp_server/idle.ts`
- Test: `mcp_server/idle.test.ts`

**Interfaces:**
- Produces:
  - `interface IdleApp { type: string; label: string; params: Record<string, unknown>; }`
  - `const IDLE_APPS: IdleApp[]` (6 curated apps)
  - `const IDLE_BRIGHTNESS = 5`
  - `pickIdleApp(apps: IdleApp[], lastType: string | null, rng?: () => number): IdleApp` — random member; avoids `lastType` when `apps.length >= 2`; throws on empty; `rng` injectable for tests (default `Math.random`).

- [ ] **Step 1: Write the failing test** — create `mcp_server/idle.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_APPS, IDLE_BRIGHTNESS, pickIdleApp, type IdleApp } from "./idle.ts";

const KNOWN_TYPES = ["fire", "dancefloor", "fireworks", "clock", "frostbite", "matrix_rain"];

test("IDLE_APPS is non-empty and well-formed", () => {
  assert.ok(IDLE_APPS.length > 0);
  for (const a of IDLE_APPS) {
    assert.equal(typeof a.type, "string");
    assert.equal(typeof a.label, "string");
    assert.ok(a.params && typeof a.params === "object" && !Array.isArray(a.params));
    assert.ok(KNOWN_TYPES.includes(a.type), `unknown animation type: ${a.type}`);
  }
});

test("IDLE_BRIGHTNESS is the ambient baseline 5", () => {
  assert.equal(IDLE_BRIGHTNESS, 5);
});

test("pickIdleApp always returns a member of the list", () => {
  for (let i = 0; i < 50; i++) assert.ok(IDLE_APPS.includes(pickIdleApp(IDLE_APPS, null)));
});

test("pickIdleApp never repeats lastType across a run (>=2 apps)", () => {
  let last: string | null = null;
  for (let i = 0; i < 200; i++) {
    const app = pickIdleApp(IDLE_APPS, last);
    assert.notEqual(app.type, last);
    last = app.type;
  }
});

test("pickIdleApp avoids lastType even when rng would pick it", () => {
  // rng()=0 → index 0 of the pool. With lastType = IDLE_APPS[0].type, index 0
  // is filtered out, so the result must differ from it.
  const app = pickIdleApp(IDLE_APPS, IDLE_APPS[0].type, () => 0);
  assert.notEqual(app.type, IDLE_APPS[0].type);
});

test("pickIdleApp returns the sole app when length===1 (no repeat-avoidance lockup)", () => {
  const one: IdleApp[] = [{ type: "fire", label: "🔥", params: {} }];
  assert.equal(pickIdleApp(one, "fire").type, "fire");
});

test("pickIdleApp throws on an empty list", () => {
  assert.throws(() => pickIdleApp([], null), /empty/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test mcp_server/idle.test.ts`
Expected: FAIL — cannot find module `./idle.ts`.

- [ ] **Step 3: Write the implementation** — create `mcp_server/idle.ts`:

```ts
// matrix_idle — curated lineup of pre-approved apps + a pure picker.
// Claude calls the matrix_idle MCP tool when idle/bored to show "something cool".
// Edit IDLE_APPS (or any app's params) to change the lineup or tune a look —
// the list is fixed in code, so changes need `npx tsc` + an /mcp reconnect.

export interface IdleApp {
  type: string;                     // firmware animation type
  label: string;                    // human label used in the tool's reply
  params: Record<string, unknown>;  // launch params POSTed to /api/display/animation
}

// Ambient brightness every idle launch applies, so a pick never blasts at full.
export const IDLE_BRIGHTNESS = 5;

// Sensible starter params (real keys from each app's control page) — tune later.
// "matrix" = the matrix_rain type. speed is firmware ms-per-frame.
export const IDLE_APPS: IdleApp[] = [
  { type: "fire",        label: "🔥 fire",        params: { speed: 50, intensity: 70 } },
  { type: "dancefloor",  label: "🪩 dance floor", params: { palette: 0, hold: 6 } },
  { type: "fireworks",   label: "🎆 fireworks",   params: { color1: "#ff0050", color2: "#00e0ff", color3: "#ffd000" } },
  { type: "clock",       label: "🕐 clock",       params: { color1: "#00ff88", color2: "#0088ff", color3: "#ff4040" } },
  { type: "frostbite",   label: "❄️ frostbite",   params: { color: "#66ccff", sparkle: 5, mist: 4 } },
  { type: "matrix_rain", label: "🟩 matrix",      params: { theme: "classic", speed: 60 } },
];

// Pick a random app, avoiding an immediate repeat of lastType when there are
// >=2 apps. rng is injectable so tests are deterministic.
export function pickIdleApp(
  apps: IdleApp[],
  lastType: string | null,
  rng: () => number = Math.random,
): IdleApp {
  if (apps.length === 0) throw new Error("IDLE_APPS is empty");
  const filtered = apps.length >= 2 ? apps.filter((a) => a.type !== lastType) : apps;
  const pool = filtered.length > 0 ? filtered : apps; // safety if all share lastType
  return pool[Math.floor(rng() * pool.length)];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test mcp_server/idle.test.ts`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `npm test`
Expected: PASS — existing suite (version + presence + vocab parity = 21) plus the 7 new idle tests.

- [ ] **Step 6: Commit**

```bash
git add mcp_server/idle.ts mcp_server/idle.test.ts
git commit -m "feat(idle): curated app lineup + pure avoid-repeat picker"
```

---

## Task 2: `matrix_idle` MCP tool

**Files:**
- Modify: `mcp_server/index.ts` (import, module state, ListTools entry, dispatch case)
- Modify: `CLAUDE.md` (tool mention)

**Interfaces:**
- Consumes: `IDLE_APPS`, `IDLE_BRIGHTNESS`, `pickIdleApp` from `./idle.js`; existing `post()` helper.
- Produces: MCP tool `matrix_idle` (no params).

- [ ] **Step 1: Import the idle module** — at the top of `mcp_server/index.ts`, near the other local imports (e.g. next to the `./presence.js` import):

```ts
import { IDLE_APPS, IDLE_BRIGHTNESS, pickIdleApp } from "./idle.js";
```

- [ ] **Step 2: Add module-level state for avoid-repeat** — near the top-level module constants (e.g. just after the `BOARD_URL` declaration):

```ts
// Remembers the last matrix_idle pick so consecutive idle launches differ.
let lastIdleType: string | null = null;
```

- [ ] **Step 3: Add the tool to ListTools** — in the `tools: [...]` array (e.g. right after the `presence_set` entry):

```ts
    {
      name: "matrix_idle",
      description:
        "Show a random PRE-APPROVED 'something cool' on the board — use when you're idle or bored and want to put an ambient display up unprompted. Picks randomly from a curated lineup (fire, dance floor, fireworks, clock, frostbite, matrix rain), avoids repeating the last pick, and sets a gentle ambient brightness (5). No parameters.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
```

- [ ] **Step 4: Add the dispatch case** — in the `switch (name)` block (e.g. after the `presence_set` case):

```ts
      case "matrix_idle": {
        if (IDLE_APPS.length === 0) return { content: [{ type: "text", text: "No idle apps configured." }] };
        const app = pickIdleApp(IDLE_APPS, lastIdleType);
        lastIdleType = app.type;

        const br = await post("/api/brightness", { level: IDLE_BRIGHTNESS });
        const r = await post("/api/display/animation", { type: app.type, ...app.params });
        if (!r.ok) return { content: [{ type: "text", text: `Error ${r.status}: ${r.body}` }] };

        const brNote = br.ok ? "" : ` (brightness set failed: ${br.status})`;
        return { content: [{ type: "text", text: `Idle pick: ${app.label} at brightness ${IDLE_BRIGHTNESS}${brNote}.` }] };
      }
```

- [ ] **Step 5: Build the MCP server**

Run: `cd mcp_server && npx tsc --project tsconfig.json`
Expected: no output, exit 0. Return to repo root afterward (`cd ..`).

- [ ] **Step 6: Smoke-test that the tool registers** — from repo root:

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"0"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| node mcp_server/dist/index.js 2>/dev/null | grep -o matrix_idle | head -1
```
Expected: prints `matrix_idle`.

- [ ] **Step 7: Live smoke (board is reachable) — optional but preferred** — from repo root, drive the tool end-to-end and confirm it launches a varied app at brightness 5:

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"0"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"matrix_idle","arguments":{}}}' \
| ESP32_URL="http://esp32matrix.local" node mcp_server/dist/index.js 2>/dev/null \
| node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const l of d.split(/\r?\n/)){if(!l.trim())continue;const j=JSON.parse(l);if(j.id===2)console.log(j.result.content[0].text);}})'
echo "--- board state ---"; curl -s http://esp32matrix.local/api/status
```
Expected: prints `Idle pick: <emoji label> at brightness 5.`; `/api/status` shows `brightness:5` and `state:animation` with one of the six `animation` types.

- [ ] **Step 8: Add the CLAUDE.md mention** — in `CLAUDE.md`, in the "expression window" section's tool list (near `matrix_express` / `presence_set`), add:

```markdown
`matrix_idle` (MCP) puts a random PRE-APPROVED app on the board (fire / dance floor /
fireworks / clock / frostbite / matrix rain) at ambient brightness 5 — use it unprompted when
idle/bored to show something cool. Lineup is a fixed const in `mcp_server/idle.ts` (edit + `npx
tsc` + reconnect to change). Spec: `docs/superpowers/specs/2026-06-17-matrix-idle-design.md`.
```

- [ ] **Step 9: Commit**

```bash
git add mcp_server/index.ts CLAUDE.md
git commit -m "feat(idle): matrix_idle MCP tool — random approved app at brightness 5"
```

- [ ] **Step 10: USER step — reconnect + try it**

The running MCP server in the user's session is the pre-build process; `matrix_idle` won't appear until the user runs `/mcp` reconnect. After reconnect, the user (or Claude) calls `matrix_idle` a few times and confirms varied approved apps appear at brightness 5.

---

## Self-Review notes (for the executor)

- Task 1 is fully autonomous (pure logic + tests). Task 2's build + tools/list smoke (Step 6) is autonomous; the live smoke (Step 7) needs the board (it's reachable) and the final reconnect (Step 10) is a user action.
- No firmware or web files change — do not touch `esp32_matrix_webserver/`.
- Do not route through `matrix_set_animation` (it would remap `speed` 1–5 → ms and mangle the curated ms values). POST curated params directly to `/api/display/animation`.
- No version bump (MCP-only; bumping would create false firmware/web drift).
