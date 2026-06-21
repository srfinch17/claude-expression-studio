# Awaiting-Input Display — Design Spec

**Date:** 2026-06-21
**Status:** Approved for planning
**Author:** the user + Claude (brainstorm)

## Summary

Give Claude a **dedicated, automatic** way to show on the 8×8 that it is **waiting
for the user's input** — distinct from "busy" (wait spinner) and "passively idle"
(screensaver). Three context-specific animations fire from Claude Code hooks the
moment Claude blocks on the user:

| Trigger (hook + matcher) | Meaning | Animation |
|---|---|---|
| `PreToolUse` matcher `AskUserQuestion` | Claude posed a questionnaire | **`ask-question`** — bobbing/pulsing "?" with a shine sweep |
| `PreToolUse` matcher `ExitPlanMode` | Claude presented a plan for approval | **`ask-confirm`** — empty box, checkmark draws in |
| `Notification` matcher `permission_prompt` | Claude needs permission to run a tool | **`ask-attention`** — amber bell ringing |
| `PostToolUse` matcher `AskUserQuestion\|ExitPlanMode` | the user answered | `wait` (flip to busy) |

Hook/expression-data only — **no firmware, no MCP server code**. The three `ask-*`
expressions are saved frame-expressions (auto-discovered, like the `wait-logo-*`
set), fired BY NAME directly by the hook.

## Motivation

Today the board has `alert` (a blinking exclamation = "INPUT NEEDED"), but **nothing
fires it automatically** — Claude must remember to call it via MCP when blocked,
which is unreliable and rarely happens. Meanwhile the two wired hooks cover the other
two states well: `UserPromptSubmit → wait` (Claude busy) and `Stop → done → arm idle`
(Claude passively idle). The missing state is the **explicit** "Claude is actively
waiting on YOU right now" — when it pops a questionnaire, presents a plan, or needs
permission. This feature fills that gap with automatic, context-specific signals so
the user can glance at the board and know Claude needs them (and what kind of input).

## Hook reference (verified against code.claude.com/docs/en/hooks, 2026-06-21)

- **`PreToolUse`** runs before a tool executes and **matches by tool name** (exact,
  `A|B` pipe list, or regex). Built-in interactive tools `AskUserQuestion` /
  `ExitPlanMode` are tool names, so `"matcher": "AskUserQuestion"` etc. is the
  mechanism. ⚠ The docs do not *explicitly* confirm these two built-ins surface to
  `PreToolUse`; **the implementation's first gate is to verify they fire** (log test),
  with a fallback (see Risks).
- **`PostToolUse`** runs after a tool succeeds, same tool-name matcher → used to clear
  the ask animation the instant the user answers.
- **`Notification`** fires when Claude Code sends a notification and **matches by
  notification type**. Documented types include `permission_prompt` (permission dialog
  appears) and `idle_prompt` (waiting for user input / idle). We use
  **`permission_prompt`** only (see Risks re: `idle_prompt`).

These require a recent Claude Code (the project's existing snippet only used
`UserPromptSubmit` + `Stop`). **Verifying the user's Claude Code supports these events
+ matchers is part of the implementation gate.**

## Workstream A — three `ask-*` saved frame-expressions

Built live with `matrix_animate` + `save_as` (zero firmware, auto-discovered), stored
in `mcp_server/expressions/`. Each **loops forever (`loop:0`)** so it holds while the
user decides. Authored/verified at the brightness the board is set to, mindful of the
bri-5 channel floor (weak channels die below ~43; use channel-distinct / bumped colors
like cyan `#44eeff` — see the led-brightness-formula memory).

1. **`ask-question`** — a bold **"?"** that bobs up/down and pulses, with a **shine
   sweep** across it (a "depth/alive" cue; a literal 3D rotation does NOT read on 8×8,
   so this is the legible interpretation, user-approved). Dot blinks. Color cyan/white
   (`#44eeff`). ~12–16 frames.
2. **`ask-confirm`** — an **empty box outline** appears, then a **checkmark draws in**
   stroke-by-stroke (down-stroke then up-stroke), holds, gentle pulse, loops. Dim box
   (gray/white), green check (`#00ff88`). ~12–16 frames. (Reads cleanly on 8×8.)
3. **`ask-attention`** — an **amber bell that rings** (wiggles left/right with small
   motion ticks), the "ping, your attention" for a permission prompt. Amber
   (`#ffb000`). Distinct from the crude `alert` blink. ~10–16 frames.

Each must pass the **silhouette test** on the panel (a human reads "question" / "confirm
this" / "needs you" at a glance) before it's done. Verify pixels via
`GET /api/display/framebuffer` AND the user's eyes. **Restore board state after testing.**

## Workstream B — hook wiring

### B1. `matrix_signal.py` — route saved-expression names
The script currently routes `wait` → weighted pool and a few canned names
(`working/done/alert`) → `send_named`. **Generalize:** any signal argument that is not
a known canned/wait name falls through to **`send_saved(name)`** (it already exists —
loads `mcp_server/expressions/<name>.json` and POSTs its frames). So
`matrix_signal.py ask-question` plays the saved `ask-question` expression. This is a
general improvement: ANY saved expression becomes hook-fireable by name. The `ask-*`
posts disarm the idle screensaver (default `idle=False`), correct since Claude is
actively engaging. (Mind the **live-copy-sync** gotcha: edit BOTH
`claude-hooks/matrix_signal.py` AND its installed `~/.claude/hooks/` twin.)

### B2. `settings.hooks.snippet.json` — add the new hook entries
Add to the documented snippet (the canonical install reference):
- `PreToolUse` `[{matcher:"AskUserQuestion", → matrix_signal.py ask-question}]`
- `PreToolUse` `[{matcher:"ExitPlanMode",    → matrix_signal.py ask-confirm}]`
- `PostToolUse` `[{matcher:"AskUserQuestion|ExitPlanMode", → matrix_signal.py wait}]`
- `Notification` `[{matcher:"permission_prompt", → matrix_signal.py ask-attention}]`

Keep the existing `UserPromptSubmit → wait` and `Stop → done` entries. Update the
snippet `_comment` to document the new triggers. (The user merges this into their real
`~/.claude/settings.json` and restarts Claude Code — hooks load at session start.)

### B3. Clear-on-answer
`PostToolUse(AskUserQuestion|ExitPlanMode) → wait` flips the board from the ask
animation to the busy spinner the instant the user answers, so it never *looks* like
it's still waiting on the user while Claude is actually processing the answer. (The
permission case clears naturally: once granted, the tool runs and subsequent
activity/`UserPromptSubmit` replaces the bell.)

## Risks / verification gates (resolve early in implementation)

1. **PreToolUse on built-in interactive tools** — verify `AskUserQuestion` /
   `ExitPlanMode` actually fire `PreToolUse` (a logging hook + a real questionnaire). If
   they do NOT, fall back: use `Notification` `idle_prompt` (or the dedicated
   `Elicitation` event for MCP-driven input) for the question case, and document the
   degraded mapping. This is the single biggest unknown — gate the build on it.
2. **`idle_prompt` turn-end spam** — `idle_prompt` may fire at EVERY turn-end (Claude
   goes idle), which would ring `ask-attention` constantly and collide with
   `Stop → done → idle-screensaver`. We therefore wire `ask-attention` to
   `permission_prompt` ONLY. `idle_prompt` is DEFERRED — if later wanted, first confirm
   its fire cadence so it doesn't fight the done/idle flow.
3. **Claude Code version** — confirm the user's Claude Code supports `Notification`
   typed matchers + `PreToolUse` on these tools. If older, the wired subset that works
   still degrades gracefully (unmatched hooks simply never fire).
4. **Hook latency** — the hook shells out to `matrix_signal.py` (best-effort POST with
   a short timeout). It must be fire-and-forget and fail fast when the board is
   unreachable, so it never delays the questionnaire/plan UI. (The script already posts
   with timeouts; keep it.)

## Non-Goals

- No firmware changes; no MCP server (TS) code changes. Animations are data; routing is
  in the Python hook.
- Not replacing `alert` — it stays available for deliberate MCP use.
- Not wiring `idle_prompt`, `Elicitation`, `PermissionDenied`, or other events in v1
  (deferred; revisit if wanted).
- No new board settings / no settings toggle (enable/disable = add/remove the hook
  lines; YAGNI).
- The `ask-*` expressions do NOT join the wait pool (different semantics; no `wait-`
  prefix).

## Touch list

**Workstream A (expression data):**
- `mcp_server/expressions/ask-question.json` — **new** (via `save_as`).
- `mcp_server/expressions/ask-confirm.json` — **new** (via `save_as`).
- `mcp_server/expressions/ask-attention.json` — **new** (via `save_as`).
- `scripts/gen-ask-icons.py` — **new** generator (the established pattern), if the
  designs are geometric enough to script; else author purely via `matrix_animate`.

**Workstream B (hooks):**
- `claude-hooks/matrix_signal.py` — route unknown names → `send_saved`; **AND** its
  installed twin `~/.claude/hooks/matrix_signal.py` (live-copy sync).
- `claude-hooks/settings.hooks.snippet.json` — add the 4 new hook entries + update
  `_comment`.

**Versioning:**
- `VERSION`, `data/version.json`, `mcp_server/package.json`, `version.h` — `npm run
  bump:minor` (0.8.0 → 0.9.0). No firmware artifact change (fw drift expected until next
  flash). MCP redeploy = `/mcp` reconnect.

## Testing / Verification

- **Animations (controller + user):** each `ask-*` validates through `expressionToWire`,
  plays via `matrix_signal.py ask-<x>` and via `matrix_express`, and reads correctly at
  the board's brightness (framebuffer + user's eyes). Restore board after.
- **Hooks (user, the real test):** install the updated snippet, restart Claude Code,
  then: (a) Claude asks a question (`AskUserQuestion`) → board shows `ask-question`;
  answer it → flips to `wait`. (b) Claude presents a plan (`ExitPlanMode`) → `ask-confirm`;
  approve → `wait`. (c) a permission prompt → `ask-attention`. The natural live test: the
  next time Claude pops a questionnaire (e.g. during the NEXT feature's brainstorm), the
  question animation should appear.
- **Gate first:** the logging-hook verification (Risk 1) before building the animations,
  so we know the AskUserQuestion trigger is real.
- **Drift:** `matrix_version` shows MCP 0.9.0; firmware/web older until next deploy.

## Open / deferred

- `idle_prompt` as a softer "Claude's been idle a while" signal — needs cadence
  verification first (Risk 2).
- `Elicitation` / `ElicitationResult` for MCP-tool input prompts (a fourth context).
- A possible `ask-*` *family with variety* (like the wait pool) if the user wants the
  question/confirm visuals to vary — v1 is one fixed animation per trigger.
