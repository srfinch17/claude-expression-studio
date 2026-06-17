# matrix_idle — Random Approved Display — Design Spec

**Date:** 2026-06-17
**Status:** Approved (brainstorming) → ready for implementation plan
**Author:** Claude + user

## Problem / intent

Claude should be able to put **something cool, pre-approved** on the board when it's idle or
bored — without the user asking, and without risk of showing something half-baked. A single
MCP tool that picks a random app from a curated, owner-approved lineup and launches it.

## Decisions (from brainstorming)

1. **Tool name:** `matrix_idle` (MCP tool, no arguments).
2. **Curated, per-app configs:** each approved app launches with a specific param set (an
   "approved look"), not bare defaults.
3. **Fixed list in code** (not a runtime-editable JSON file). The lineup lives as a typed
   const in the MCP server; editing it requires a `tsc` rebuild + reconnect (standing MCP rule).
4. **Starter configs** are the sensible values below; the user tunes them later by editing the
   const.
5. **Scope: tool only.** The existing bored/idle Claude Code hook is unchanged; wiring it to
   call `matrix_idle` automatically is explicitly out of scope for now.

## The approved lineup (6 apps)

Real animation `type`s + params taken from each app's control page. `speed` is firmware
ms-per-frame, POSTed straight to `/api/display/animation` (no 1–5 remap), so curated values
land exactly. ("matrix" = the `matrix_rain` type.)

| app | type | params (starter — user tunes) |
|---|---|---|
| 🔥 fire | `fire` | `{ speed: 50, intensity: 70 }` |
| 🪩 dance floor | `dancefloor` | `{ palette: 0, hold: 6 }` |
| 🎆 fireworks | `fireworks` | `{ color1: "#ff0050", color2: "#00e0ff", color3: "#ffd000" }` |
| 🕐 clock | `clock` | `{ color1: "#00ff88", color2: "#0088ff", color3: "#ff4040" }` |
| ❄️ frostbite | `frostbite` | `{ color: "#66ccff", sparkle: 5, mist: 4 }` |
| 🟩 matrix | `matrix_rain` | `{ theme: "classic", speed: 60 }` |

(Param names are verified against the control pages: fire = speed/theme/intensity/tendrils/
sparks; dancefloor = palette/hold; fireworks = color1/2/3; clock = color1/2/3/tz; frostbite =
color/sparkle/mist; matrix_rain = theme/speed. Starters use a safe subset; the rest fall to
firmware defaults.)

## Architecture

Three small units, all in `mcp_server/`:

### 1. `mcp_server/idle.ts` — the lineup + the pure picker
- `export interface IdleApp { type: string; label: string; params: Record<string, unknown>; }`
- `export const IDLE_APPS: IdleApp[]` — the fixed curated list above.
- `export function pickIdleApp(apps: IdleApp[], lastType: string | null): IdleApp` — returns a
  random member; when `apps.length >= 2` it never returns the app whose `type === lastType`
  (re-roll/filter so consecutive picks differ). Pure and deterministic-testable via an
  injectable RNG: `pickIdleApp(apps, lastType, rng = Math.random)`.

Keeping the list + picker in their own module makes the picker unit-testable without the MCP
SDK or the board, and isolates the one thing the user edits (the list).

### 2. `mcp_server/index.ts` — the `matrix_idle` tool
- Import `IDLE_APPS`, `pickIdleApp` from `./idle.js`.
- Module-level `let lastIdleType: string | null = null;` to enforce avoid-immediate-repeat
  across calls within a server session.
- ListTools entry `matrix_idle` (no params), with a description telling Claude to use it when
  idle/bored to show a pre-approved "something cool."
- Dispatch case: `const app = pickIdleApp(IDLE_APPS, lastIdleType); lastIdleType = app.type;`
  then `POST /api/display/animation` with `{ type: app.type, ...app.params }` (reuse the
  existing `post()` helper). Report `Idle pick: ${app.label}` on success, or the HTTP error.

### 3. `mcp_server/idle.test.ts` — unit tests (Node built-in runner, type-stripping)

## Data flow

```
Claude (judgment: "I'm idle, show something cool")
  └─ matrix_idle  → pickIdleApp(IDLE_APPS, lastIdleType)   [avoids repeating last]
       └─ POST /api/display/animation { type, ...params }  → board launches the app
  (lastIdleType updated so the next call differs)
```

## Error handling

- **Board unreachable / HTTP error:** the `post()` helper's result is checked; the tool
  returns `Error ${status}: ${body}` (or the fetch-timeout catch in the dispatch's try/catch,
  same as every other tool). It does not throw.
- **`IDLE_APPS` empty:** guard in the dispatch — if the list is empty, return a clear message
  ("no idle apps configured") rather than calling the picker. (With a fixed in-code list this
  is effectively unreachable, but the guard keeps the tool honest if someone empties it.)
- **Unknown `type`** (a typo in the list): the board returns an error from
  `/api/display/animation`, surfaced verbatim.

## Testing

- `pickIdleApp` returns a member of the list (every result is `IDLE_APPS`-contained).
- With `length >= 2`, never returns `lastType`: drive it with a stubbed `rng` that would
  otherwise select the last app, assert it picks a different one; also loop many random rolls
  asserting `result.type !== lastType` every time.
- `length === 1`: returns the sole app even if it equals `lastType` (no infinite loop).
- `IDLE_APPS` sanity: non-empty; every entry has `type`, `label`, and a `params` object; all
  `type`s are among the firmware's known animation types (fire, dancefloor, fireworks, clock,
  frostbite, matrix_rain).
- **Smoke (manual / no board needed):** `tools/list` includes `matrix_idle`; a focused
  smoke that the dispatch builds a `{type,...params}` body. Live board verification is a user
  step (call `matrix_idle` a few times, confirm varied approved apps appear).

## Out of scope (YAGNI)

- Runtime-editable JSON / hot-reload of the lineup (fixed in code by decision).
- Auto-firing from the idle/bored hook (decision: tool only).
- Randomizing params within ranges; weighting; time-of-day logic.
- Persisting `lastIdleType` across server restarts (in-memory is enough).
- Restoring prior display afterward (the pick becomes the current display, by design).
