# Presence Lifecycle — Design

**Date:** 2026-06-28
**Status:** approved (design confirmed by the user — "greenlight, full lifecycle")
**Branch:** `feat/expression-studio`

## Problem

`/api/presence` (the board's semantic-status store, mirrored by the desktop/web presence
card) is **only ever written by an explicit `presence_set` MCP call.** The Claude Code
lifecycle hooks drive the LED *display* (working spinner, done glyph, idle screensaver) but
never touch `/api/presence`. So presence sits on the last deliberate message indefinitely
and goes stale — the user saw an 11h-old "done" while the board ran the idle screensaver
clock, which reads as broken. The presence channel should continuously reflect Claude's
lifecycle the same way the display does.

## Approved behavior

Make the **host-side Claude Code hooks also maintain `/api/presence`**, so presence tracks
Claude's lifecycle. No firmware change, no reflash (the board's `POST /api/presence` is a
pure store — verified: `api_handlers.ino handlePresencePost()` saves the message + stamps
`ts`, does NOT render LEDs or disarm the screensaver).

| Hook moment | Presence intent |
|---|---|
| `hook:UserPromptSubmit` | `working` |
| `hook:PostToolUse:AskUserQuestion` / `hook:PostToolUse:ExitPlanMode` | `working` (resumed after answering) |
| `hook:PreToolUse:AskUserQuestion` / `hook:PreToolUse:ExitPlanMode` | `question` (blocked on the user) |
| `hook:Notification:permission_prompt` | `alert` |
| `hook:Stop` | `done` |
| idle watcher (`matrix_idle.py`) confirms idle / settles sleepy | `idle` ← the headline fix |

Core of the approved ask = `working` / `done` / `idle`; `question` / `alert` are the natural
completion (the awaiting-input states), trivial to include, and all five intents already
exist in `PRESENCE_VOCAB` (the card renders them).

## Why this layer

- The board owns `/api/presence`; the hooks own the lifecycle. Posting from the hooks makes
  presence track **both** transitions: idle-enter (idle watcher) AND resume (`UserPromptSubmit`
  → working). A firmware-only "set idle on screensaver" would not know about resume.
- Host-side = no reflash; the hooks the user just installed are the driver.
- The presence card mirrors `/api/presence` (the engine proxies the board), so it updates live.

## Accepted trade-off (explicitly confirmed)

Auto-driving presence means a generic lifecycle intent can overwrite a **rich** presence
Claude set deliberately (progress bar / sparkline / `celebrate`). Accepted: presence is an
ambient lifecycle mirror by default; Claude's explicit `presence_set` wins while it's the
most recent write, and re-asserts when it matters. No "don't-clobber" guard (would need a
GET round-trip for marginal benefit). KISS.

## Out of scope (named follow-ups, not built here)

- **No-board presence.** The hook posts to the board (`BOARD_URL`); with no board that POST
  fails silently, so a hardware-less user's card won't show lifecycle presence. Covering it
  means the engine grows a presence STORE (POST sets it; the `/api/presence` proxy falls back
  to it when the board is unreachable) + the hook mirrors there. Deferred — the user's case is
  a connected board; this increment fully solves that.
- Awaiting-input richer mapping, headlines/detail on auto-presence (kept intent-only — the
  card's vocab label carries the word; clean + ambient).

## Component design

All in `claude-hooks/` (Python stdlib only), with synced live copies redeployed to
`~/.claude/hooks/` so it takes effect (hooks load per-invocation — no Claude Code restart).

### `matrix_signal.py`

- `presence_body(intent, **fields) -> dict` — **pure**, unit-tested: `{"intent": intent, **fields}`
  (drops `None`/empty values). The board stamps `ts`.
- `post_presence(intent, **fields)` — best-effort `POST {BOARD_URL}/api/presence`, short
  timeout, fail-silent (mirrors `post_brightness`). Never blocks/raises.
- `MOMENT_PRESENCE: dict[str, str]` — the moment→intent map above (single source).
- `main()`: after `render_moment(moment)`, if `moment in MOMENT_PRESENCE`,
  `post_presence(MOMENT_PRESENCE[moment])`. Ordering: render the glyph first (display), then
  stamp presence (semantic) — presence failure never affects the display.

### `matrix_idle.py`

- When the watcher confirms idle (its first goof) and when it settles on the sleepy face,
  call `ms.post_presence("idle")` (it already imports `matrix_signal as ms`). Re-stamping on
  each idle action is harmless (keeps the "idle since" age fresh); at minimum post on idle-enter.

## Testing

`claude-hooks/test_presence_lifecycle.py` (`unittest`, stdlib):
- `presence_body` shape: intent set; extra fields included; `None`/empty dropped; no `ts`
  (board stamps it).
- `MOMENT_PRESENCE` maps every wired moment to a real `PRESENCE_VOCAB` intent
  (working/done/idle/question/alert) — guards against a typo'd intent the card can't render.
  (Load the vocab intents from `shared/presence-vocab.js`? It's JS — instead assert against the
  known set; keep it a literal in the test with a comment pointing at the vocab.)
- `main()` dispatch: monkeypatch `render_moment`, `post_presence`, token/arm/spawn to no-ops;
  run `main()` for `hook:UserPromptSubmit` → records `post_presence("working")`; for
  `hook:Stop` → `"done"`; for an unmapped moment → no `post_presence`. (Discriminating: fails
  if the wiring is dropped.)
- `post_presence` fail-silent: monkeypatch `urllib.request.urlopen` to raise → does not raise.
- Existing `test_manifest_resolver.py` / `test_setup_config.py` still pass.

## Deployment / verification

1. Redeploy the two changed scripts to `~/.claude/hooks/` (the installer's deploy step, or copy).
2. Live-verify on the connected board via `curl`/browser (not a subagent): fire each moment,
   confirm `/api/presence` reflects the intent and the presence card updates; confirm the LED
   display is unaffected by the presence POST. Restore the board afterward.
