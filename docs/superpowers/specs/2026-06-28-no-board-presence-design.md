# No-Board Presence — Design

**Date:** 2026-06-28
**Status:** approved (the named follow-up from `2026-06-28-presence-lifecycle-design.md` "Out of scope")
**Branch:** `feat/expression-studio`

## Problem

The presence-lifecycle increment made the Claude Code hooks `POST /api/presence` per
moment (working/done/idle/question/alert) so the presence card tracks Claude's lifecycle.
But the hook posts to the **board** (`BOARD_URL`) only, and the engine's `GET /api/presence`
just **proxies the board** (503 when no board). So a user with **no hardware** still sees
nothing on the presence card — the lifecycle never reaches a renderer they can see.

This is the explicit follow-up named in the lifecycle spec's "Out of scope": *"Covering it
means the engine grows a presence STORE (POST sets it; the `/api/presence` proxy falls back
to it when the board is unreachable) + the hook mirrors there."*

## Approved behavior

1. **Engine gains an in-memory presence store.**
   - `POST /api/presence` (localhost-only relay, like `POST /api/render`): parse the
     PresenceMessage body, stamp `ts` (epoch **seconds**, matching the board) if absent,
     save it as the engine's last-known presence. Return `204`. Best-effort/lenient — a
     non-JSON body is a `400` no-op, never a throw.
   - `GET /api/presence`:
     - **Board source-of-truth when reachable:** if `boardUrl` is set, try the board; on a
       2xx, return the **board's** body (board wins — unchanged behavior).
     - **Fallback to the store:** if the board is unreachable / not configured, return the
       **stored** presence (200) instead of `503`.
     - **Honest "no source":** only when the board is unreachable *and* nothing has been
       stored do we return `503 {reachable:false}` — so the card's honest "no presence
       source" messaging still works.

2. **The hook mirrors presence to the engine.**
   - `matrix_signal.py post_presence()` additionally best-effort POSTs the same body to
     `{_engine_url()}/api/presence` (reuse the existing `_engine_url()` resolver that
     `broadcast_engine()` already uses). With no board, the presence reaches the engine
     store; with a board, both get it and the board still wins on `GET`.
   - `matrix_idle.py` inherits this automatically (it calls `ms.post_presence("idle")`).
   - Fail-silent, never blocks a hook/turn. The board POST stays primary; engine mirror is
     a side-channel exactly like `broadcast_engine`.

## Why this layer / decisions

- **Board stays source-of-truth.** The store is a *fallback*, not an override — so a
  connected board (with its NTP-stamped `ts` and the rich `presence_set` messages) is never
  shadowed by a stale engine copy. Decision: prefer board on every `GET`, even if the store
  is newer; the with-board user already had a working path and we don't regress it.
- **Engine stamps `ts` in epoch seconds.** The card's `formatAge` (shared/presence-card.js)
  expects unix-seconds; the board stamps `time(nullptr)`. The store mirrors that so the
  no-board card's "Ns/Nm ago" age is correct. If a POST already carries `ts` (e.g. a future
  rich relay), we keep it.
- **Localhost-only, like `/api/render`.** The engine binds `127.0.0.1`; POST is a trusted
  local relay. No auth, no size ceiling beyond Node's defaults (bodies are tiny intent JSON).
- **No persistence.** In-memory only (RAM), matching the board's own volatile store and the
  KISS posture of the lifecycle spec. Engine restart = empty store until the next hook fires.

## Out of scope (unchanged from the lifecycle spec)

- Rich headline/detail on auto-presence (kept intent-only; the card's vocab label carries
  the word).
- Persisting the store across engine restarts.
- The board's own presence behavior (untouched — no firmware change, no reflash).

## Testing (TDD, must discriminate — fail before the change)

**`mcp_server/engine-server.test.ts`** (extends the existing presence proxy tests):
- `POST /api/presence` stores a message → `GET /api/presence` (no board configured) returns
  it (200) with a stamped `ts`. *Discriminates:* today GET returns 503 with no board.
- **Board preferred over the store:** with a reachable fake board AND a prior POST to the
  store, `GET` returns the **board's** message, not the stored one. *Discriminates:* proves
  the fallback didn't shadow the board.
- **Fallback when the board is down:** with `boardUrl` pointing at an unreachable port AND a
  prior POST, `GET` returns the **stored** message (200), not 503. *Discriminates:* today
  that's a 503.
- **Honest no-source:** unreachable board AND nothing stored → still `503 {reachable:false}`.
- `POST /api/presence` with a non-JSON body → `400`, and a subsequent `GET` is unaffected.
- (Keep) the existing "proxies the board" and "503 when unreachable + empty" tests.

**`claude-hooks/test_presence_lifecycle.py`** (the hook engine-mirror):
- `post_presence` also POSTs to the engine: monkeypatch `urllib.request.urlopen` to capture
  the URLs hit → asserts both `{BOARD_URL}/api/presence` and `{engine}/api/presence` are
  posted, with the same intent body. *Discriminates:* fails today (engine never hit).
- `post_presence` stays fail-silent when **either** target raises (already covered for the
  board; extend so an engine-only failure also doesn't raise).

## Deployment / verification

- Engine (TS) → `npm test` runs `tsc` (rebuilds `dist`); `npm run build:mcpb` repacks the
  bundle. **The user's already-running engine won't pick up the new routes until they
  restart it** — call this out explicitly.
- Redeploy the changed hook script to `~/.claude/hooks/` (installer deploy step / copy).
- Live-verify **no-board path**: start a *throwaway* engine on a spare port pointed at an
  unreachable `boardUrl` (e.g. `http://127.0.0.1:9`); POST a presence; confirm `GET` returns
  it and the engine-served card shows it. **Do NOT touch the user's real engine on 8787.**
- Live-verify **with-board path** against the real setup: board-backed `GET` still wins.
