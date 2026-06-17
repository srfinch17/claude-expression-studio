# Presence Protocol v0 — Design Spec

**Date:** 2026-06-17
**Status:** Approved (brainstorming) → ready for implementation plan
**Author:** Claude + user

## Vision (context, not v0 scope)

Evolve the ESP32 8×8 matrix — Claude's expression channel — into a **resolution-aware
ambient output platform**: Claude emits *semantic intent* (what it wants to convey —
state, data, mood, urgency), and a capability-aware layer renders it appropriately for
whatever output is connected (8×8 LED today; phone card, desktop widget, e-ink badge,
larger panel tomorrow). Decouple WHAT is shown from HOW it's rendered — responsive design
for ambient/generative output.

**Strategic direction (decided):** *personal-first* — prove the abstraction on the user's
own setup before choosing a business model (software/protocol product vs hardware company).
That decision is explicitly deferred until the IR is real and battle-tested on two targets.

## v0 scope (this spec)

Extract a semantic layer out of the matrix and add **exactly one richer renderer** — a
desktop ambient card — to prove the core thesis: *one semantic message, two renderers, the
richer one scaling UP from the 64-pixel floor.* Nothing else.

## Decisions (from brainstorming)

1. **Direction:** personal-first; defer the software-vs-hardware business fork.
2. **First richer renderer:** a desktop ambient card, **served by the board** as another
   `data/*.html` page (no new hosting/push infra), opened always-on-top / on a second monitor.
3. **IR model:** named state + payload (not dimensional). A named `intent` from a small
   vocabulary plus optional text/data, with per-renderer appearance lookup tables.
4. **Board is the presence hub** — it's the always-on HTTP service that already receives the
   intent. In v0 it stores + serves the semantic message; it does **not** natively render
   presence→8×8 (the LEDs keep being driven by the existing frame path).
5. **`data` is rich from the start** — progress / 1–3 readouts / sparkline — but only the
   **card** renders it in v0. Rendering data on the 8×8 (using the existing `fonts.ino`
   3×3/3×5 fonts + column sparklines) is deferred to a focused **v0.5** (see that section).

## The protocol

### PresenceMessage (the device-agnostic semantic unit)
```
PresenceMessage {
  intent:   string     // REQUIRED. vocab: working|done|alert|error|celebrate|
                       //   idle|thinking|ok|info|question
  headline: string?    // short, ~<=24 chars   e.g. "building..."
  detail:   string?    // one context line     e.g. "running tests"
  data:     null
            | { progress: number }                          // 0..1 → bar
            | { values: [{ value, unit?, label? }, ...] }   // 1..3 labeled readouts
            | { series: [number, ...], label?, unit? }      // sparkline, <=32 points
  urgency:  "ambient" | "notice" | "urgent"   // default "ambient"
  ts:       string     // ISO 8601, stamped by the hub on store (not sent by client)
}
```
- `data` is a **closed union** of four cases: `null`, a `progress` fraction, a `values`
  array of 1–3 labeled readouts (a single number is just a one-element `values`), or a
  `series` sparkline. Caps — `values` ≤ 3, `series` ≤ 32 points — keep it legible and the
  payload small; the validator rejects over-cap or mixed-case bodies.
- `intent` is validated against the vocabulary but **unknown values are accepted** and render
  a generic "info" appearance (forward-compat as the vocab grows — never hard-fail on intent).

### Presence vocabulary (the shared appearance knowledge)
A table `intent -> { label, glyph, color, motion }` — the one piece both renderers consult.
- **8×8 renderer** reuses the existing `CANNED` mapping in `mcp_server/expressions.ts`
  (intent name → glyph frames).
- **Card renderer** gets a parallel `presence-vocab.js` (intent → label, glyph id, CSS color,
  motion keyword). The two are kept aligned by sharing the same intent names; the card table
  is the new artifact.

Starter vocabulary (maps onto existing canned glyphs where they exist):

| intent | meaning | 8×8 (canned) | card color / motion |
|---|---|---|---|
| working | long task in progress | working (spinner) | amber / pulse |
| thinking | reasoning | working or smiley | blue / slow shimmer |
| done | finished OK | done (check) | green / settle |
| ok | acknowledged | check | green / static |
| celebrate | milestone | party | multi / burst |
| alert | needs the user | alert (blink) | amber / blink |
| error | failure | cross | red / hard blink |
| question | awaiting answer | question | blue / gentle pulse |
| info | neutral status | smiley/info | slate / static |
| idle | nothing happening | sleep | dim / breathe |

## Components

### 1. Board `/api/presence` (firmware)
- `POST /api/presence` — body = PresenceMessage JSON. Validates required `intent` (string,
  non-empty) and optional fields' types; rejects malformed bodies with 400. Stores the
  message in RAM (a small set of globals or a retained JSON String) and stamps `ts` with the
  board's clock. `urgency` defaults to "ambient" if absent.
- `GET /api/presence` — returns the current stored PresenceMessage as JSON, or a neutral
  default (`{"intent":"idle","ts":...}`) if none has been set since boot.
- No NVS persistence in v0 (RAM only; resets to idle on reboot). Retaining last presence
  across reboots is a deferred nicety.
- Wired in `setup()` alongside the other routes; handler lives in `api_handlers.ino`.

### 2. MCP `presence_set` tool (TypeScript)
New tool in `mcp_server/index.ts`. Claude emits one PresenceMessage. The handler:
1. Validates/normalizes the message (intent required; clamp/coerce optional fields).
2. `POST`s it to the board `/api/presence` (drives the card).
3. Renders `intent`→8×8 via the **existing** expression path (map intent → canned expression
   name, reuse `expressionToWire`/`CANNED` → `/api/display/frames`).
Both renderers thus derive from the same intent in one atomic call — consistent by
construction. `matrix_express` remains as the low-level primitive; `presence_set` is the new
semantic-first entry point. Requires `tsc` rebuild + reconnect (standing MCP rule).

The **canonical IR validator/normalizer is a small pure module on the MCP/TS side**
(`mcp_server/presence.ts` — exports the validator + the intent→canned-name map); it is what
the unit tests target. The board does its own minimal defensive validation (intent present
and a string) but does not duplicate the full schema.

In v0 the **8×8 shows the glyph only** — `headline`, `detail`, and `data` are deliberately
the card's job, not the LEDs'. (Scrolling headline text on the 8×8 is a possible later
enhancement, out of scope here.)

### 3. Desktop ambient card — `data/presence-card.html` (web, served by board)
- Polls `GET /api/presence` every ~1.5s, guarded by `document.hidden` (reuse the calendar.html
  pattern — don't hammer the single-client board when the card isn't visible).
- Renders rich: an upscaled glyph (canvas), the headline (large), detail (small), the full
  `data` field — **progress bar**, **1–3 labeled readouts**, or a **sparkline** (canvas
  line/bar chart) — plus a color wash + motion keyed by `intent` + `urgency` (urgency
  escalates motion: ambient→still, notice→pulse, urgent→blink). Web fonts + canvas make all
  four `data` shapes cheap on the card; this is where the richer data lives in v0.
- Sized/styled for an always-on-top small window or second-monitor placement.
- Pulls appearance from `presence-vocab.js`.

### 4. `presence-vocab.js` (web)
The card's `intent -> { label, glyph, color, motion }` table, served from LittleFS.

## Data flow

```
Claude ─ presence_set(msg) ─┬─► POST /api/presence  (board stores + stamps ts)
                            │                         └─poll 1.5s (hidden-guarded)─► presence-card.html  (rich render)
                            └─► intent→8x8 via existing /api/display/frames path ───► LED matrix          (glyph)

GET /api/presence ← card polls; returns current PresenceMessage (or idle default)
```

The last presence persists on the board (in RAM) after Claude exits, so the card keeps
showing the most recent state until the next `presence_set` or a board reboot.

## Error handling

- **Board unreachable** (presence_set) → tool returns a readable "could not reach board"
  (same pattern as existing tools' fetch-timeout catch).
- **No presence set yet** → `GET` returns the idle default; card shows a neutral idle state.
- **Unknown intent** → accepted; both renderers fall back to a generic "info" appearance.
  Never a hard failure — the vocabulary is expected to grow.
- **Malformed POST body** → board returns 400 with a short JSON error; presence unchanged.
- **8×8 render fails but presence POST succeeds** (or vice-versa) → tool reports partial
  success; the card and LEDs may momentarily disagree until the next call (acceptable in v0).

## Testing

- **IR validator** (unit): target the canonical validator/normalizer in `mcp_server/presence.ts`.
  Valid messages pass; missing/empty intent and wrong-typed fields are rejected/normalized;
  unknown intent is accepted (forward-compat). `data` union: each case (progress / values /
  series) round-trips; over-cap (`values` > 3, `series` > 32) and mixed-case bodies are rejected.
- **presence_set tool** (smoke): with a mock board, asserts it POSTs the normalized JSON to
  `/api/presence` and issues the mapped 8×8 frame call.
- **`/api/presence`** (hardware): POST a message, GET it back, confirm round-trip + `ts` stamp;
  POST malformed → 400.
- **Card** (manual / visual): open `presence-card.html`, drive each intent + each urgency via
  `presence_set`, confirm legible distinct rendering; confirm the `document.hidden` guard stops
  polling when hidden.
- **Consistency** (hardware): one `presence_set` call → 8×8 glyph and card both reflect the
  same intent.

## Documentation

- `CLAUDE.md`: add `/api/presence` to the API surface and a short "Presence" note pointing
  here; mention `presence_set` alongside the expression tools.
- Update the global idea log (`ClaudeGlobalMem/ideas/ideas.md`) status: exploring → in progress.

## Planned next — v0.5: board-native 8×8 presence rendering (NOT in v0)

The IR's `data` model already supports readouts + sparklines; in v0 only the **card** renders
them (the 8×8 stays glyph-only via the existing MCP frame path). v0.5 moves presence rendering
onto the board so the LEDs can show data too — and the firmware **already has the primitives**:
- `fonts.ino`: `FONT_3X3` (+ `FONT_3X3_LIGHT` half-bright mask) and `FONT_3X5`, with static
  draw helpers `drawStr3x3` / `drawStr3x5` / `drawStrCentered3x3` and **two-line stacking**
  (3×3 in rows 0–2 + 3×5 in rows 3–7). Digits in `FONT_3X5` match `MINI_FONT` in
  `clock_timer.ino`. The 5×7 font (`scroll_text.ino`) is the third size.
- A **sparkline** maps `series` → column heights via `setPixel` — nearly free on 8×8.
- `values` (1–2 short numbers) → stacked 3×3 / 3×5 lines.

v0.5 also implies the board consuming `/api/presence` directly to render — the larger
"board renders presence natively" step deliberately deferred so v0 stays small. Capturing the
font inventory here so that follow-on doesn't re-discover it.

## Out of scope (YAGNI — deferred beyond v0.5)

- Dimensional/continuous mood model (named+payload only).
- Data history / time-series beyond a single `series` snapshot.
- Additional renderers (phone/PWA, e-ink, larger panels) and any SDK.
- Publishing the protocol as an open spec.
- NVS persistence / auto-resume of presence across reboots.
- Auth, multi-client, cloud relay, push notifications, presence TTL/auto-idle.
