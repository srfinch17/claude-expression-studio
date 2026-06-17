# Presence Protocol v0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a semantic `PresenceMessage` layer to the matrix and one richer renderer (a board-served desktop card), so Claude emits *intent + payload* once and it renders on both the 8×8 LEDs and the card.

**Architecture:** A pure TS validator (`presence.ts`) defines the IR. A new MCP `presence_set` tool normalizes a message, POSTs it to the board's new `/api/presence` store, and renders the intent to the 8×8 via the existing canned-expression frame path. A board-served `presence-card.html` polls `/api/presence` and renders rich. The board is a dumb semantic store in v0 (LEDs still driven by MCP frames).

**Tech Stack:** TypeScript (MCP server, Node16 modules, runs from compiled `dist/`), Arduino C++ (ESP32, ArduinoJson v7), vanilla ESM JS + HTML/canvas (card), Node built-in test runner.

## Global Constraints

- **Firmware cannot be compiled/flashed by the agent.** Firmware tasks (Task 2) end with a **hardware-verify checkpoint the USER performs** (flash, then run the given `curl` commands). Do not claim firmware works without the user's pasted result.
- **ArduinoJson v7** API only: `JsonDocument` (never `StaticJsonDocument`), `.is<T>()`, `serializeJson`/`deserializeJson`.
- **MCP runs from compiled `dist/index.js`.** After any `.ts` edit: `cd mcp_server && npx tsc --project tsconfig.json`, then the user runs `/mcp` reconnect. Tools/version changes are NOT live until rebuild + reconnect.
- **MCP imports use `.js` extensions** (Node16 resolution); test files run via `node --test` and import `.ts` directly (Node 26 type-stripping).
- **Board web pages** are served from LittleFS (`esp32_matrix_webserver/data/`); changes require **LittleFS upload** (separate from sketch upload). Reuse the `document.hidden` poll-guard pattern from `data/calendar.html` (single-client board).
- **Firmware globals:** the main sketch `esp32_matrix_webserver.ino` is concatenated first, so a global declared there is visible to `api_handlers.ino`.
- **Versioning:** this feature bumps to **0.2.0** (Task 6). After deploy, `matrix_version` must read firmware/web/MCP all `0.2.0 ✓`.
- **Intent vocabulary (10):** `working, thinking, done, ok, celebrate, alert, error, question, info, idle`. Unknown intents are ACCEPTED and render generic (never hard-fail on intent).

---

## File Structure

- **Create** `mcp_server/presence.ts` — IR types, `INTENTS`, `normalizePresence()`, `cannedFor()`.
- **Create** `mcp_server/presence.test.ts` — validator unit tests.
- **Modify** `mcp_server/index.ts` — import presence helpers; add `presence_set` tool (list + dispatch).
- **Modify** `package.json` (root) — broaden the `test` glob to include `mcp_server/**/*.test.ts`.
- **Modify** `esp32_matrix_webserver/esp32_matrix_webserver.ino` — `presenceJson` global + two route registrations.
- **Modify** `esp32_matrix_webserver/api_handlers.ino` — `handlePresenceGet()` / `handlePresencePost()`.
- **Create** `esp32_matrix_webserver/data/presence-vocab.js` — intent→appearance table (ESM).
- **Create** `mcp_server/presence-vocab.test.ts` — parity test (every intent has a vocab entry + canned mapping).
- **Create** `esp32_matrix_webserver/data/presence-card.html` — the desktop ambient card.
- **Modify** `CLAUDE.md` — `/api/presence` in the API surface + a short Presence note.
- **Modify** `ClaudeGlobalMem/ideas/ideas.md` — status exploring → in progress.

---

## Task 1: Presence IR + validator (`presence.ts`)

**Files:**
- Create: `mcp_server/presence.ts`
- Test: `mcp_server/presence.test.ts`
- Modify: `package.json` (root, `scripts.test`)

**Interfaces:**
- Produces:
  - `INTENTS: readonly string[]` — the 10 canonical intents.
  - `normalizePresence(input: unknown): PresenceMessage` — validates + normalizes; throws `Error` on invalid. Strips client-sent `ts`. Defaults `urgency` to `"ambient"`. Clamps `progress` to `[0,1]`. Accepts unknown intents.
  - `cannedFor(intent: string): string` — maps a presence intent to an existing canned expression name (`CANNED` key); unknown → `"smiley"`.
  - Types `PresenceMessage`, `PresenceData`, `Readout`, `Urgency`.

- [ ] **Step 1: Write the failing test** — create `mcp_server/presence.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePresence, cannedFor, INTENTS } from "./presence.ts";

test("minimal message defaults urgency to ambient and trims intent", () => {
  assert.deepEqual(normalizePresence({ intent: " working " }), { intent: "working", urgency: "ambient" });
});

test("missing or empty intent throws", () => {
  assert.throws(() => normalizePresence({}), /intent/);
  assert.throws(() => normalizePresence({ intent: "   " }), /intent/);
  assert.throws(() => normalizePresence("nope"), /object/);
});

test("unknown intent is accepted (forward-compat)", () => {
  assert.equal(normalizePresence({ intent: "teleporting" }).intent, "teleporting");
});

test("headline/detail coerced to string; client ts stripped", () => {
  const m = normalizePresence({ intent: "done", headline: "built", detail: 42, ts: 999 });
  assert.equal(m.headline, "built");
  assert.equal(m.detail, "42");
  assert.ok(!("ts" in m));
});

test("urgency validated", () => {
  assert.equal(normalizePresence({ intent: "alert", urgency: "urgent" }).urgency, "urgent");
  assert.throws(() => normalizePresence({ intent: "alert", urgency: "loud" }), /urgency/);
});

test("data.progress clamps to 0..1", () => {
  assert.deepEqual(normalizePresence({ intent: "working", data: { progress: 1.5 } }).data, { progress: 1 });
  assert.deepEqual(normalizePresence({ intent: "working", data: { progress: -3 } }).data, { progress: 0 });
});

test("data.values accepts 1..3 readouts, rejects 0 or 4 or non-number", () => {
  const m = normalizePresence({ intent: "info", data: { values: [{ value: 22, unit: "C", label: "chip" }] } });
  assert.deepEqual(m.data, { values: [{ value: 22, unit: "C", label: "chip" }] });
  assert.throws(() => normalizePresence({ intent: "info", data: { values: [] } }), /1-3/);
  assert.throws(() => normalizePresence({ intent: "info", data: { values: [1,2,3,4].map((v)=>({value:v})) } }), /1-3/);
  assert.throws(() => normalizePresence({ intent: "info", data: { values: [{ unit: "C" }] } }), /value/);
});

test("data.series accepts 1..32 numbers, rejects 33 or non-number", () => {
  assert.deepEqual(normalizePresence({ intent: "info", data: { series: [1,2,3] } }).data, { series: [1,2,3] });
  assert.throws(() => normalizePresence({ intent: "info", data: { series: Array(33).fill(0) } }), /1-32/);
  assert.throws(() => normalizePresence({ intent: "info", data: { series: ["x"] } }), /number/);
});

test("data with two cases is rejected", () => {
  assert.throws(() => normalizePresence({ intent: "info", data: { progress: 0.5, series: [1] } }), /exactly one/);
});

test("cannedFor maps known intents and falls back to smiley", () => {
  assert.equal(cannedFor("done"), "done");
  assert.equal(cannedFor("error"), "cross");
  assert.equal(cannedFor("teleporting"), "smiley");
});

test("INTENTS has the 10 canonical names", () => {
  assert.equal(INTENTS.length, 10);
  assert.ok(INTENTS.includes("working"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test mcp_server/presence.test.ts`
Expected: FAIL — cannot find module `./presence.ts`.

- [ ] **Step 3: Write the implementation** — create `mcp_server/presence.ts`:

```ts
// Presence Protocol — the device-agnostic semantic message + its validator.
// This is the canonical IR definition; the MCP presence_set tool and (later)
// other renderers normalize through here. Pure + dependency-free so it unit-tests
// with the Node built-in runner (no board, no build step).

export type Urgency = "ambient" | "notice" | "urgent";

export interface Readout { value: number; unit?: string; label?: string; }

export type PresenceData =
  | { progress: number }                                   // 0..1 bar
  | { values: Readout[] }                                  // 1..3 readouts
  | { series: number[]; label?: string; unit?: string };   // <=32-point sparkline

export interface PresenceMessage {
  intent: string;
  headline?: string;
  detail?: string;
  data?: PresenceData;
  urgency: Urgency;
}

export const INTENTS = [
  "working", "thinking", "done", "ok", "celebrate",
  "alert", "error", "question", "info", "idle",
] as const;

// Map a presence intent to an existing canned expression name (see CANNED in
// expressions.ts) so the 8x8 renders via the proven frame path.
const INTENT_TO_CANNED: Record<string, string> = {
  working: "working", thinking: "working", done: "done", ok: "check",
  celebrate: "party", alert: "alert", error: "cross", question: "question",
  info: "smiley", idle: "sleep",
};

export function cannedFor(intent: string): string {
  return INTENT_TO_CANNED[intent] ?? "smiley";
}

const URGENCIES: Urgency[] = ["ambient", "notice", "urgent"];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeData(d: unknown): PresenceData | undefined {
  if (d == null) return undefined;
  if (!isObj(d)) throw new Error("data must be an object");
  const present = ["progress", "values", "series"].filter((k) => k in d);
  if (present.length === 0) return undefined;
  if (present.length > 1) throw new Error(`data must have exactly one of progress/values/series (got ${present.join("+")})`);

  if ("progress" in d) {
    const p = Number((d as Record<string, unknown>).progress);
    if (!Number.isFinite(p)) throw new Error("data.progress must be a number");
    return { progress: Math.max(0, Math.min(1, p)) };
  }
  if ("values" in d) {
    const arr = (d as Record<string, unknown>).values;
    if (!Array.isArray(arr) || arr.length < 1 || arr.length > 3)
      throw new Error("data.values must be an array of 1-3 readouts");
    const values: Readout[] = arr.map((r, i) => {
      if (!isObj(r) || !Number.isFinite(Number(r.value)))
        throw new Error(`data.values[${i}].value must be a number`);
      const out: Readout = { value: Number(r.value) };
      if (r.unit != null) out.unit = String(r.unit);
      if (r.label != null) out.label = String(r.label);
      return out;
    });
    return { values };
  }
  const s = (d as Record<string, unknown>).series;
  if (!Array.isArray(s) || s.length < 1 || s.length > 32)
    throw new Error("data.series must be an array of 1-32 numbers");
  const series = s.map((n, i) => {
    const v = Number(n);
    if (!Number.isFinite(v)) throw new Error(`data.series[${i}] must be a number`);
    return v;
  });
  const out: { series: number[]; label?: string; unit?: string } = { series };
  const dd = d as Record<string, unknown>;
  if (dd.label != null) out.label = String(dd.label);
  if (dd.unit != null) out.unit = String(dd.unit);
  return out;
}

export function normalizePresence(input: unknown): PresenceMessage {
  if (!isObj(input)) throw new Error("presence message must be an object");
  const intent = input.intent;
  if (typeof intent !== "string" || intent.trim() === "")
    throw new Error("intent (non-empty string) is required");

  const msg: PresenceMessage = { intent: intent.trim(), urgency: "ambient" };
  if (input.headline != null) msg.headline = String(input.headline);
  if (input.detail != null) msg.detail = String(input.detail);

  if (input.urgency != null) {
    const u = String(input.urgency);
    if (!URGENCIES.includes(u as Urgency)) throw new Error(`urgency must be one of ${URGENCIES.join(", ")}`);
    msg.urgency = u as Urgency;
  }

  const data = normalizeData(input.data);
  if (data) msg.data = data;
  return msg; // ts intentionally omitted — the board stamps it
}
```

- [ ] **Step 4: Broaden the root test glob** — in `package.json`, change the `test` script:

```json
    "test": "node --test \"scripts/**/*.test.js\" \"mcp_server/**/*.test.ts\""
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test mcp_server/presence.test.ts`
Expected: PASS — all assertions green (11 tests).

- [ ] **Step 6: Run the full suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS — scripts/ version tests (7) + presence tests (11).

- [ ] **Step 7: Commit**

```bash
git add mcp_server/presence.ts mcp_server/presence.test.ts package.json
git commit -m "feat(presence): PresenceMessage IR + validator"
```

---

## Task 2: Board `/api/presence` endpoint (firmware)

**Files:**
- Modify: `esp32_matrix_webserver/esp32_matrix_webserver.ino` (global + 2 routes)
- Modify: `esp32_matrix_webserver/api_handlers.ino` (2 handlers)

**Interfaces:**
- Produces: `GET /api/presence` → current PresenceMessage JSON (or `{"intent":"idle"}` default); `POST /api/presence` (body = normalized PresenceMessage) → stores it in RAM, stamps integer `ts` (epoch seconds), returns `{"status":"ok"}`; malformed/empty-intent body → 400.
- Consumes: existing `sendJson(int, String)` and `escapeJson(String)` helpers; ArduinoJson v7.

- [ ] **Step 1: Add the presence global** — in `esp32_matrix_webserver/esp32_matrix_webserver.ino`, next to the other String globals near the top (e.g. just after the `String webVersion = "unknown";` line added by the versioning feature):

```cpp
// Presence Protocol: the last semantic status the board was told to show. Stored
// as already-normalized JSON (the MCP server validates before POSTing). Served
// verbatim at GET /api/presence for any renderer (the desktop card). RAM only —
// resets to idle on reboot. The LEDs are still driven by the MCP frame path in v0.
String presenceJson = "{\"intent\":\"idle\"}";
```

- [ ] **Step 2: Add the two handlers** — in `esp32_matrix_webserver/api_handlers.ino`, after `handleStatus()` (end of that function):

```cpp
// GET /api/presence — current semantic status, served verbatim.
void handlePresenceGet() {
  sendJson(200, presenceJson);
}

// POST /api/presence — replace the stored status. Body is a normalized
// PresenceMessage (validated by the MCP server); the board does a minimal
// defensive check (intent present) and stamps ts with its NTP clock.
void handlePresencePost() {
  JsonDocument doc;
  if (deserializeJson(doc, server.arg("plain")) != DeserializationError::Ok) {
    sendJson(400, "{\"error\":\"Invalid JSON\"}");
    return;
  }
  if (!doc["intent"].is<const char*>() || String((const char*)doc["intent"]).length() == 0) {
    sendJson(400, "{\"error\":\"intent (non-empty string) required\"}");
    return;
  }
  doc["ts"] = (uint32_t)time(nullptr);   // epoch seconds; card formats to local
  presenceJson = "";
  serializeJson(doc, presenceJson);
  sendJson(200, "{\"status\":\"ok\"}");
}
```

- [ ] **Step 3: Register the routes** — in `esp32_matrix_webserver.ino`, alongside the other `server.on(...)` lines (next to `"/api/status"`):

```cpp
  server.on("/api/presence",              HTTP_GET,  handlePresenceGet);
  server.on("/api/presence",              HTTP_POST, handlePresencePost);
```

- [ ] **Step 4: USER hardware checkpoint — flash + verify round-trip**

Ask the user to **Sketch → Upload**, then run (PowerShell or bash):

```bash
curl -s http://esp32matrix.local/api/presence
# Expected (fresh boot): {"intent":"idle"}

curl -s -X POST http://esp32matrix.local/api/presence \
  -H "Content-Type: application/json" \
  -d '{"intent":"working","headline":"hi","urgency":"notice"}'
# Expected: {"status":"ok"}

curl -s http://esp32matrix.local/api/presence
# Expected: {"intent":"working","headline":"hi","urgency":"notice","ts":<number>}

curl -s -X POST http://esp32matrix.local/api/presence -H "Content-Type: application/json" -d '{}'
# Expected: HTTP 400 {"error":"intent (non-empty string) required"}
```

Do not proceed until the user confirms the round-trip and the `ts` number appears.

- [ ] **Step 5: Commit**

```bash
git add esp32_matrix_webserver/esp32_matrix_webserver.ino esp32_matrix_webserver/api_handlers.ino
git commit -m "feat(presence): board /api/presence store + serve"
```

---

## Task 3: MCP `presence_set` tool

**Files:**
- Modify: `mcp_server/index.ts` (import, ListTools entry, dispatch case)

**Interfaces:**
- Consumes: `normalizePresence`, `cannedFor` from `./presence.js`; existing `post()`, `CANNED`, `expressionToWire`, `loadSavedExpression`.
- Produces: MCP tool `presence_set` (params: `intent` required; `headline`, `detail`, `data`, `urgency` optional).

- [ ] **Step 1: Import the presence helpers** — at the top of `mcp_server/index.ts`, near the `expressions.js` import:

```ts
import { normalizePresence, cannedFor } from "./presence.js";
```

- [ ] **Step 2: Add the tool to ListTools** — in the `tools: [...]` array (e.g. right after the `matrix_express` entry):

```ts
    {
      name: "presence_set",
      description:
        "Set Claude's ambient PRESENCE — a semantic status rendered on every connected output (the 8x8 LEDs and the desktop presence card) from one call. Prefer this over matrix_express for status/mood: it carries intent + optional headline/detail/data + urgency. intent vocab: working, thinking, done, ok, celebrate, alert, error, question, info, idle (others accepted, render generic).",
      inputSchema: {
        type: "object",
        properties: {
          intent: { type: "string", description: "Required. One of: working, thinking, done, ok, celebrate, alert, error, question, info, idle." },
          headline: { type: "string", description: "Short status line, ~<=24 chars (e.g. 'building...')." },
          detail: { type: "string", description: "One line of extra context (e.g. 'running tests')." },
          data: { type: "object", description: "Optional readout: {progress:0..1} OR {values:[{value,unit?,label?}] (1-3)} OR {series:[numbers] (<=32), label?, unit?}." },
          urgency: { type: "string", enum: ["ambient", "notice", "urgent"], description: "Attention level; default ambient." },
        },
        required: ["intent"],
      },
    },
```

- [ ] **Step 3: Add the dispatch case** — in the `switch (name)` block (e.g. after the `matrix_express` case):

```ts
      case "presence_set": {
        let msg;
        try {
          msg = normalizePresence(args);
        } catch (e) {
          return { content: [{ type: "text", text: `Invalid presence: ${(e as Error).message}` }] };
        }

        // Publish the semantic message for the card.
        const pr = await post("/api/presence", msg);
        const cardNote = pr.ok ? "card updated" : `card POST error ${pr.status}`;

        // Render the intent on the 8x8 via the existing canned-expression path.
        const canned = cannedFor(msg.intent);
        const expr = CANNED[canned] ?? (await loadSavedExpression(canned));
        let ledNote = `no 8x8 glyph for "${canned}"`;
        if (expr) {
          const lr = await post("/api/display/frames", expressionToWire(expr));
          ledNote = lr.ok ? `8x8 → ${canned}` : `8x8 error ${lr.status}`;
        }

        return { content: [{ type: "text", text: `Presence "${msg.intent}" set (${cardNote}; ${ledNote}).` }] };
      }
```

- [ ] **Step 4: Build the MCP server**

Run: `cd mcp_server && npx tsc --project tsconfig.json`
Expected: no output, exit 0 (clean build). Return to repo root afterward.

- [ ] **Step 5: Smoke-test end-to-end** (board must have Task 2 flashed). From repo root:

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"0"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"presence_set","arguments":{"intent":"working","headline":"building","data":{"progress":0.5}}}}' \
| ESP32_URL="http://esp32matrix.local" node mcp_server/dist/index.js 2>/dev/null \
| node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const l of d.split(/\r?\n/)){if(!l.trim())continue;const j=JSON.parse(l);if(j.id===2)console.log(j.result.content[0].text);}})'
# Expected: Presence "working" set (card updated; 8x8 → working).

curl -s http://esp32matrix.local/api/presence
# Expected (key order may vary): {"intent":"working","urgency":"ambient","headline":"building","data":{"progress":0.5},"ts":<number>}
```

- [ ] **Step 6: Commit**

```bash
git add mcp_server/index.ts
git commit -m "feat(presence): presence_set MCP tool drives card + 8x8 from one intent"
```

---

## Task 4: Card vocabulary table + parity test

**Files:**
- Create: `esp32_matrix_webserver/data/presence-vocab.js`
- Test: `mcp_server/presence-vocab.test.ts`

**Interfaces:**
- Produces: `PRESENCE_VOCAB: Record<string, { label, glyph, color, motion }>` (ESM export) — consumed by the card (Task 5) and the parity test.
- Consumes: `INTENTS`, `cannedFor` from `./presence.ts`.

- [ ] **Step 1: Write the failing parity test** — create `mcp_server/presence-vocab.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { INTENTS, cannedFor } from "./presence.ts";
import { PRESENCE_VOCAB } from "../esp32_matrix_webserver/data/presence-vocab.js";

test("every intent has a card vocab entry with the required fields", () => {
  for (const i of INTENTS) {
    const v = PRESENCE_VOCAB[i];
    assert.ok(v, `missing vocab entry for intent "${i}"`);
    for (const k of ["label", "glyph", "color", "motion"]) {
      assert.equal(typeof v[k], "string", `vocab "${i}".${k} must be a string`);
    }
  }
});

test("every intent maps to a canned 8x8 expression name", () => {
  for (const i of INTENTS) assert.equal(typeof cannedFor(i), "string");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test mcp_server/presence-vocab.test.ts`
Expected: FAIL — cannot find module `presence-vocab.js`.

- [ ] **Step 3: Write the vocab table** — create `esp32_matrix_webserver/data/presence-vocab.js`:

```js
// presence-vocab.js — the desktop card's intent → appearance table.
// ESM so the browser (presence-card.html) and the node parity test both import it.
// Keys MUST stay in sync with INTENTS in mcp_server/presence.ts (parity test enforces).
// glyph = a single character drawn large; color = CSS hex; motion = CSS animation key.
export const PRESENCE_VOCAB = {
  working:   { label: "Working",   glyph: "◐", color: "#e0a020", motion: "pulse" },   // ◐
  thinking:  { label: "Thinking",  glyph: "…", color: "#3a78d0", motion: "shimmer" }, // …
  done:      { label: "Done",      glyph: "✓", color: "#33c06a", motion: "settle" },  // ✓
  ok:        { label: "OK",        glyph: "✓", color: "#33c06a", motion: "none" },    // ✓
  celebrate: { label: "Celebrate", glyph: "✦", color: "#d24bd2", motion: "burst" },   // ✦
  alert:     { label: "Needs you", glyph: "!",      color: "#e0a020", motion: "blink" },
  error:     { label: "Error",     glyph: "✗", color: "#e0473c", motion: "blink" },   // ✗
  question:  { label: "Question",  glyph: "?",      color: "#3a78d0", motion: "pulse" },
  info:      { label: "Info",      glyph: "i",      color: "#7a8aa0", motion: "none" },
  idle:      { label: "Idle",      glyph: "z",      color: "#46506a", motion: "breathe" },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test mcp_server/presence-vocab.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add esp32_matrix_webserver/data/presence-vocab.js mcp_server/presence-vocab.test.ts
git commit -m "feat(presence): card vocabulary table + intent/vocab parity test"
```

---

## Task 5: Desktop ambient card (`presence-card.html`)

**Files:**
- Create: `esp32_matrix_webserver/data/presence-card.html`

**Interfaces:**
- Consumes: `GET /api/presence` (Task 2); `PRESENCE_VOCAB` from `./presence-vocab.js` (Task 4).

- [ ] **Step 1: Write the card** — create `esp32_matrix_webserver/data/presence-card.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Claude — Presence</title>
<style>
  :root { --accent: #46506a; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0c0e14; color: #e8ecf4;
    font: 16px/1.4 ui-sans-serif, system-ui, sans-serif; -webkit-user-select: none; }
  #card { height: 100%; display: grid; grid-template-rows: auto 1fr auto;
    gap: 10px; padding: 18px 20px;
    background: radial-gradient(120% 90% at 30% 0%, color-mix(in srgb, var(--accent) 28%, #0c0e14), #0c0e14); }
  #top { display: flex; align-items: center; gap: 14px; }
  #glyph { font-size: 52px; line-height: 1; color: var(--accent);
    text-shadow: 0 0 18px color-mix(in srgb, var(--accent) 60%, transparent); }
  #headline { font-size: 22px; font-weight: 650; }
  #label { font-size: 12px; letter-spacing: .12em; text-transform: uppercase;
    color: color-mix(in srgb, var(--accent) 70%, #e8ecf4); }
  #detail { color: #aeb6c8; font-size: 15px; }
  #data { display: flex; flex-direction: column; gap: 8px; justify-content: center; }
  .bar { height: 14px; border-radius: 7px; background: #1c2030; overflow: hidden; }
  .bar > i { display: block; height: 100%; background: var(--accent);
    border-radius: 7px; transition: width .4s ease; }
  .readouts { display: flex; gap: 18px; flex-wrap: wrap; }
  .readout { display: flex; flex-direction: column; }
  .readout .v { font-size: 28px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .readout .l { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #8b94a8; }
  #spark { width: 100%; height: 56px; display: block; }
  #foot { display: flex; justify-content: space-between; font-size: 11px; color: #6b7488; }
  /* motion */
  @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.55} }
  @keyframes shimmer{ 0%,100%{opacity:.7} 50%{opacity:1} }
  @keyframes blink  { 0%,49%{opacity:1} 50%,100%{opacity:.2} }
  @keyframes breathe{ 0%,100%{opacity:.45} 50%{opacity:.75} }
  @keyframes burst  { 0%{transform:scale(1)} 30%{transform:scale(1.18)} 100%{transform:scale(1)} }
  @keyframes settle { 0%{transform:scale(1.18)} 100%{transform:scale(1)} }
  .m-pulse   #glyph { animation: pulse 1.4s ease-in-out infinite; }
  .m-shimmer #glyph { animation: shimmer 2s ease-in-out infinite; }
  .m-blink   #glyph { animation: blink .7s steps(1) infinite; }
  .m-breathe #glyph { animation: breathe 3.5s ease-in-out infinite; }
  .m-burst   #glyph { animation: burst .8s ease-out; }
  .m-settle  #glyph { animation: settle .5s ease-out; }
  /* urgency escalates: notice = slow pulse on whole card, urgent = blink */
  .u-notice #card { animation: pulse 2.4s ease-in-out infinite; }
  .u-urgent #card { animation: blink 1s steps(1) infinite; }
</style>
</head>
<body>
  <div id="card">
    <div id="top">
      <div id="glyph">z</div>
      <div>
        <div id="label">Idle</div>
        <div id="headline"></div>
      </div>
    </div>
    <div id="data"></div>
    <div>
      <div id="detail"></div>
      <div id="foot"><span id="intent">idle</span><span id="age">—</span></div>
    </div>
  </div>

<script type="module">
import { PRESENCE_VOCAB } from "./presence-vocab.js";

const GENERIC = { label: "Status", glyph: "○", color: "#7a8aa0", motion: "none" };
const $ = (id) => document.getElementById(id);
let lastTs = 0;

function renderData(data) {
  const box = $("data");
  box.innerHTML = "";
  if (!data) return;
  if ("progress" in data) {
    const pct = Math.round(Math.max(0, Math.min(1, data.progress)) * 100);
    box.innerHTML = `<div class="bar"><i style="width:${pct}%"></i></div>
      <div class="readout"><span class="v">${pct}%</span></div>`;
  } else if ("values" in data) {
    const row = document.createElement("div");
    row.className = "readouts";
    for (const r of data.values) {
      const el = document.createElement("div");
      el.className = "readout";
      el.innerHTML = `<span class="v">${r.value}${r.unit ? `<small>${r.unit}</small>` : ""}</span>` +
        (r.label ? `<span class="l">${r.label}</span>` : "");
      row.appendChild(el);
    }
    box.appendChild(row);
  } else if ("series" in data) {
    box.appendChild(sparkline(data.series, data.label, data.unit));
  }
}

function sparkline(series, label, unit) {
  const w = 320, h = 56, n = series.length;
  const min = Math.min(...series), max = Math.max(...series), span = (max - min) || 1;
  const pts = series.map((v, i) =>
    `${(i / Math.max(1, n - 1)) * w},${h - ((v - min) / span) * (h - 6) - 3}`).join(" ");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "spark"; svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.innerHTML = `<polyline fill="none" stroke="currentColor" stroke-width="2"
     stroke-linejoin="round" stroke-linecap="round" points="${pts}" />`;
  const wrap = document.createElement("div");
  if (label || unit) {
    const cap = document.createElement("div");
    cap.className = "readout"; cap.style.marginBottom = "4px";
    cap.innerHTML = `<span class="l">${label ?? ""} ${unit ? `(${unit})` : ""}</span>`;
    wrap.appendChild(cap);
  }
  wrap.appendChild(svg);
  return wrap;
}

function render(m) {
  const v = PRESENCE_VOCAB[m.intent] ?? GENERIC;
  document.documentElement.style.setProperty("--accent", v.color);
  $("glyph").textContent = v.glyph;
  $("label").textContent = v.label;
  $("headline").textContent = m.headline ?? "";
  $("detail").textContent = m.detail ?? "";
  $("intent").textContent = m.intent;
  document.body.className =
    `m-${v.motion} u-${m.urgency ?? "ambient"}`;
  renderData(m.data);
  lastTs = Number(m.ts) || 0;
}

async function poll() {
  if (document.hidden) return;   // single-client board: don't poll when unseen
  try {
    const r = await fetch("/api/presence", { cache: "no-store" });
    if (r.ok) render(await r.json());
  } catch { /* board momentarily unreachable — keep last render */ }
}

function tickAge() {
  if (!lastTs) { $("age").textContent = "—"; return; }
  const s = Math.max(0, Math.floor(Date.now() / 1000) - lastTs);
  $("age").textContent = s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

poll();
setInterval(poll, 1500);
setInterval(tickAge, 1000);
</script>
</body>
</html>
```

- [ ] **Step 2: USER checkpoint — upload + visually verify**

Ask the user to **LittleFS upload** the `data/` folder, then open `http://esp32matrix.local/presence-card.html` (ideally a small always-on-top window / second monitor). Then drive each state via the MCP `presence_set` tool (or curl) and confirm distinct, legible rendering:

```bash
# progress
curl -s -X POST http://esp32matrix.local/api/presence -H "Content-Type: application/json" -d '{"intent":"working","headline":"building...","detail":"running tests","data":{"progress":0.73},"urgency":"ambient"}'
# multiple readouts
curl -s -X POST http://esp32matrix.local/api/presence -H "Content-Type: application/json" -d '{"intent":"info","headline":"sensors","data":{"values":[{"value":22,"unit":"C","label":"chip"},{"value":41,"unit":"%","label":"hum"}]}}'
# sparkline
curl -s -X POST http://esp32matrix.local/api/presence -H "Content-Type: application/json" -d '{"intent":"thinking","headline":"load","data":{"series":[3,5,4,8,12,9,14,11],"unit":"%"}}'
# urgent error (whole-card blink)
curl -s -X POST http://esp32matrix.local/api/presence -H "Content-Type: application/json" -d '{"intent":"error","headline":"build failed","urgency":"urgent"}'
```

Confirm: glyph + color change per intent; progress bar, two readouts, and sparkline each render; `urgent` blinks the card; the "Xs ago" footer updates; minimizing the window stops polling (check the board still responds).

- [ ] **Step 3: Commit**

```bash
git add esp32_matrix_webserver/data/presence-card.html
git commit -m "feat(presence): desktop ambient card renderer"
```

---

## Task 6: Docs + version bump 0.2.0 + deploy verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `ClaudeGlobalMem/ideas/ideas.md`
- Modify (via bump): `VERSION`, `version.h`, `data/version.json`, `mcp_server/package.json`

- [ ] **Step 1: Update the API surface in `CLAUDE.md`** — add under the API block, after the `/api/status` line:

```
GET  /api/presence          # current PresenceMessage (semantic status for any renderer)
POST /api/presence          { intent, headline?, detail?, data?, urgency? }  # board stamps ts
```

- [ ] **Step 2: Add a Presence note to `CLAUDE.md`** — after the "expression window" section:

```markdown
## Presence (semantic status — the protocol-in-embryo)

`presence_set` (MCP) emits a **PresenceMessage** — `intent` (working/thinking/done/ok/
celebrate/alert/error/question/info/idle) + optional `headline`/`detail`/`data`
(progress | 1–3 readouts | sparkline) + `urgency`. One call renders on BOTH the 8×8
(canned glyph via the frame path) and the **desktop card** (`/presence-card.html`, polls
`/api/presence`). The board stores the last message at `/api/presence` (RAM). This is the
first slice of the "presence protocol" — one semantic message, many renderers. v0 = card is
the rich renderer; 8×8 stays glyph-only (board-native LED data rendering is v0.5). Spec:
`docs/superpowers/specs/2026-06-17-presence-protocol-v0-design.md`.
```

- [ ] **Step 3: Update the idea log** — in `ClaudeGlobalMem/ideas/ideas.md`, change the presence-protocol status line from `· exploring` to `· in progress (v0 built 2026-06-17)`.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — version (7) + presence (11) + vocab parity (2).

- [ ] **Step 5: Bump the version to 0.2.0**

Run: `npm run bump:minor`
Expected: `Bumped 0.1.0 → 0.2.0`, stamps written, commit `chore: bump v0.2.0` created.

- [ ] **Step 6: Build the MCP server (picks up new package.json version) and commit docs**

```bash
cd mcp_server && npx tsc --project tsconfig.json && cd ..
git add CLAUDE.md
git commit -m "docs(presence): API surface + CLAUDE.md presence note"
```
(`ClaudeGlobalMem/ideas/ideas.md` lives OUTSIDE this repo — it was already edited in place in Step 3; do NOT `git add` it here, that would abort the commit.)

- [ ] **Step 7: USER checkpoint — deploy all three + verify clean**

Ask the user to: **Sketch → Upload** (firmware, picks up version.h 0.2.0), **LittleFS upload** (web, picks up version.json + card + vocab), and **/mcp reconnect** (MCP picks up 0.2.0 + presence_set). Then verify:

```
matrix_version   →  expect firmware 0.2.0 ✓ / web 0.2.0 ✓ / mcp 0.2.0 ✓
```

Then a final live check: call `presence_set` with `{"intent":"done","headline":"presence v0 shipped"}` and confirm the 8×8 shows the check glyph AND the card shows the done state.

---

## Self-Review notes (for the executor)

- The card task (Task 5) has **no automated test** (DOM rendering) — its verification is the user's visual checkpoint. Every other task has an automated test or a concrete hardware round-trip.
- Tasks 2 and 5 require the user (flash / upload). Don't mark them complete on code-write alone — wait for the pasted confirmation.
- `presence_set` and `/api/presence` both validate `intent`; the MCP-side `normalizePresence` is the canonical validator, the board does a minimal defensive check only.
