# Presence Card — Web Surface ("maturing" the presence card)

**Date:** 2026-06-27
**Branch:** `feat/expression-studio` (no merge — part of the larger arc; repo cut is last)
**Status:** design self-approved — the user explicitly delegated all decisions ("make the
decisions yourself based on best practices") and stepped away; proceeding autonomously
through spec → plan → subagent-driven execution.

## Goal

Promote the presence card from a board-coupled page to a **first-class, board-independent
web surface in the Studio family** — engine-served and Pages-deployable, self-demoing
without any hardware, sharing the project's one render core. This is the "presence" half of
the arc's step-3 ("studio + presence mature").

## Why / current state

Today the only presence card is `esp32_matrix_webserver/data/presence-card.html`: rich
(intent glyph + headline + detail + data block + urgency motion + age) but **served from the
board's LittleFS and polling the board's `/api/presence`**. The north star is renderer-
agnostic and web-first — "board-less, the card is a desktop window where Claude emotes." So
the card should live where the Studio lives (web, engine-served, Pages-deployable) and work
with no board present.

`shared/renderers/card.js` is a *different* thing — the minimal manifest renderer plugin
(glyph/text/color). The canonical message IR is `mcp_server/presence.ts`
(`PresenceMessage`: `intent`, `headline?`, `detail?`, `data?` = one of
progress/values/series, `urgency`). The intent→appearance table is
`esp32_matrix_webserver/data/presence-vocab.js` (10 intents).

## Scope & non-goals (YAGNI)

- **Web-only, additive.** No changes to firmware, the board's `data/`, or the engine
  (TypeScript) — so the whole increment is verifiable statically, with no flash/upload/
  rebuild and no hardware (the user is away). The existing board card keeps working untouched.
- **One render core, no third copy.** The board card's inline render logic is extracted into
  a shared module that the new web surface imports (the project's grep-enforced rule). The
  board keeps its own self-contained copy (separate deploy boundary, like the synced
  `presence-vocab.js`); a parity test prevents the vocab drifting.
- **No new presence intents**, no engine presence-proxy, no live websocket. Live mode is a
  best-effort relative poll (below). The engine gaining a real presence endpoint is a
  *future* increment (engine maturity), explicitly out of scope here.

## Architecture

### 1. Shared render core — `shared/presence-card.js` + `shared/presence-vocab.js`

`shared/presence-vocab.js` — canonical web copy of the intent→appearance table (the 10
`PresenceMessage` intents) plus a `GENERIC` fallback, byte-equivalent in content to the
board's `data/presence-vocab.js`.

`shared/presence-card.js` — the web render core, factored into **pure helpers** (node-
unit-tested) and one **DOM render** function (covered by the surface, like `render.js`):

- `vocabFor(vocab, intent) -> entry` — table lookup with `GENERIC` fallback.
- `dataBlock(data) -> { kind: "progress"|"values"|"series"|"none", ... }` — decides which
  data view a `PresenceData` maps to (mirrors the board's `renderData` branching), returning
  a plain model the DOM layer consumes; `none` when `data` is absent/empty.
- `sparklinePoints(series, w, h) -> string` — the SVG polyline `points` for a series
  (min/max-normalized), extracted verbatim from the board's `sparkline`.
- `motionClass(entry, urgency) -> string` — the `m-<motion> u-<urgency>` class string the
  card applies (urgency defaults `ambient`).
- `formatAge(tsSeconds, nowMs) -> string` — `"Ns ago"` / `"Nm ago"` / `"—"`.
- `renderPresenceCard(el, msg, vocab)` — writes glyph/label/headline/detail/intent/data into
  a card element and sets its motion class, using the helpers above. DOM-only; no fetch.

A parity test (`shared/presence-vocab.test.js`, node) imports both the shared vocab and the
board's `data/presence-vocab.js` and asserts identical keys and identical
`{glyph,color,motion,label}` per intent — so the two copies can never silently diverge.

### 2. The surface — `studio/presence.html`

A Studio page (dark theme, IBM Plex, the studio-nav drop-in) with two regions:

- **The card** — the rich presence card markup, rendered via `renderPresenceCard` from the
  shared core. Motion/urgency keyframe CSS lives in the page (presentation), keyed off the
  `motionClass` string.
- **A self-demoing playground** — controls that build a `PresenceMessage` locally and render
  it: the 10 intents (buttons), a data-type selector (none / progress / values / series, each
  with fixed sample data), and an urgency selector (ambient/notice/urgent). This makes the
  surface fully demonstrable with no board and no engine — the portfolio value, and the
  static-Pages experience. (Mirrors the playground pattern in `site/index.html`.)

The page is auto-included in the Pages bundle (`scripts/build-pages.mjs` copies `studio/` +
`shared/` wholesale) and reachable from every Studio page via a new **"Presence"** entry in
`studio/studio-nav.js`.

### 3. Best-effort live mode

A "Live" toggle (default off) polls `/api/presence` (relative, `cache: no-store`, ~1.5s)
and renders the returned message; on any failure (404/unreachable — e.g. served by the engine
or Pages, which don't expose presence) it silently keeps the playground's last render. So the
surface reflects real presence when something on its origin serves it (the board today; a
future presence-proxying engine), and is a self-driven demo otherwise. An age line ticks from
the message `ts` when live. No errors surface to the user.

## Data flow

```
playground controls ──build msg──▶ renderPresenceCard(cardEl, msg, VOCAB)
                                          ▲
live toggle ──poll /api/presence──────────┘  (best-effort; failure ⇒ keep last)
```

## Error handling

- Missing/unknown intent → `GENERIC` appearance (never blank).
- `data` absent or empty → `dataBlock` returns `none`; the data region clears.
- Live poll failure → caught, last render preserved, no visible error (matches the board card).

## Testing

- **Unit (`shared/presence-card.test.js`, node `--test`):** `vocabFor` (hit + `GENERIC`
  fallback); `dataBlock` for each of progress (clamped 0..1) / values / series / none;
  `sparklinePoints` (point count = series length, within the box); `motionClass` (default
  ambient, known motion); `formatAge` (`—` for 0, seconds, minutes).
- **Parity (`shared/presence-vocab.test.js`, node):** shared vocab ≡ board vocab (keys +
  fields).
- **Surface logic (`studio/presence.test.js`, node):** any pure helpers the page factors out
  (e.g. the sample-data builder for the playground data-type selector), exported and asserted
  — following the existing `studio/*.test.js` pattern (pure exports, no DOM).
- **Controller smoke (during execution, throwaway port — never 8787):** serve the Pages
  bundle, load `studio/presence.html`, confirm the card renders, the playground switches
  intents/data/urgency, and live-off degrades cleanly.

## Constraints carried from the project

- Stays on `feat/expression-studio`; **no merge**.
- One render core — the new surface imports `shared/presence-card.js`; no copy-paste of the
  board's render logic.
- Never use the maintainer's real name in any emitted file.
- `pages-dist/` stays gitignored; the surface ships via the existing build-pages copy.
