# Awaiting-Input Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude automatically show a context-specific "waiting for your input" animation on the 8×8 (question / confirm-plan / needs-permission) via Claude Code hooks.

**Architecture:** Three `ask-*` saved frame-expressions (zero firmware, auto-discovered like `wait-logo-*`) fired BY NAME directly from new Claude Code hook entries. `matrix_signal.py` is generalized so any saved expression name is hook-fireable. No firmware, no MCP TypeScript code.

**Tech Stack:** Python hook (`matrix_signal.py`) + JSON hook config; FastLED 8×8 frame-expressions (JSON via `/api/display/frames`); `npm run bump:minor`.

---

## ⚠ Revision 2 — post 2-critic gate (2026-06-21)

The adversarial review (both critics, convergent) found the plan **built on unverified
Claude Code hook event-ordering**. Restructured to **gate-first**:

**The unknowns the probe must resolve (BLOCKING the hook wiring):**
1. Does `PreToolUse` fire for the built-ins `AskUserQuestion` / `ExitPlanMode`?
2. When does `PostToolUse` fire for them — when the prompt is *shown*, or when the user
   *answers*? (The "flip to `wait`" only works if it's on answer.)
3. **Does `Stop` fire while a question/plan is pending?** If yes, `Stop → done → arm-idle`
   would clobber the ask animation — a feature-killer. Needs a mitigation (e.g. a flag
   file written on `PreToolUse(ask)` that the `Stop` hook checks and skips `done`).
4. After a permission grant, what restores `wait`? (Else the bell holds while Claude works.)

→ **Run `claude-hooks/hook_probe.py` (Task 0) FIRST.** It logs every event + tool + timing.
The log answers all four; the hook wiring + clear-logic are designed from real data.

**Build status on branch `feat/awaiting-input`:**
- ✅ **Task 1 DONE** — `matrix_signal.py` routes any saved name → `send_saved` (twin synced).
- ✅ **Task 2 DONE** — the three `ask-*` animations (generated, validated, played live at bri 5).
- ✅ **Task 0 DONE** — the probe (`hook_probe.py` + `settings.probe.snippet.json`) is built.
- ⛔ **BLOCKED on probe data:** Task 3 (hook wiring), the clear-on-answer logic, the
  `Stop`-collision mitigation, Task 4 (version bump), and the PR. Do NOT wire until the
  probe confirms the ordering.

**Fixes folded in from the review:**
- `idle_prompt` is NOT a fallback (it may fire every turn-end → bell spam). The probe,
  not a guess, decides the question-trigger path.
- `ask-confirm` box bumped to `#b8b8b8` so it survives the bri-5 floor (a dim gray vanished).
- `ask-attention` amber bell green-channel is near the bri-5 floor → reads orange/red; the
  bell SHAPE carries it; flagged for the user's eyes.
- Capture brightness + animation BEFORE board testing, restore after (done in Task 2).
- Snippet install note: if the user already has `PreToolUse`/`PostToolUse` arrays, APPEND
  to them — don't replace.
- `send_saved` docstring/comment generalized (no longer "wait-only").

---

## Global Constraints

- **Privacy:** never use the maintainer's real name anywhere — "the user". (distributable repo)
- **Three new animations**, NOT in the wait pool (no `wait-` prefix): `ask-question`, `ask-confirm`, `ask-attention`. Saved frame-expressions in `mcp_server/expressions/`, `loop:0` (hold until replaced).
- **Hook→signal mapping (exact):** `PreToolUse:AskUserQuestion → ask-question`; `PreToolUse:ExitPlanMode → ask-confirm`; `Notification:permission_prompt → ask-attention`; `PostToolUse:AskUserQuestion|ExitPlanMode → wait`. Keep existing `UserPromptSubmit→wait`, `Stop→done`.
- **`idle_prompt` is DELIBERATELY NOT wired** (may fire every turn-end → bell spam + collides with `Stop→done→idle`). Deferred.
- **Live-copy sync:** edit BOTH `claude-hooks/matrix_signal.py` AND its installed twin `~/.claude/hooks/matrix_signal.py` (they drift otherwise — see the hook-live-copy-sync memory).
- **bri-5 floor:** weak channels die below ~43 (`(channel×(bri+1))>>8 ≥ 1`; min ≈ ceil(256/(bri+1))). Use channel-distinct / bumped colors (cyan `#44eeff`, green `#00ff88`, amber `#ffb000`). Verify on the panel.
- **8×8:** `XY(x,y)=y*8+x`, row-major, origin top-left; `COLOR_ORDER` RGB; frames are 8 rows × 8 chars, `.`=off, other chars → `#rrggbb` in a `colors` map; 1–24 frames.
- **Hooks must be fire-and-forget** with a short timeout (never delay the questionnaire/plan UI). `matrix_signal.py` already POSTs best-effort with timeouts — keep it.
- **Version:** bump minor **0.8.0 → 0.9.0** at the end. MCP redeploy = `/mcp` reconnect; firmware/web unchanged (drift expected).
- **No unit harness for `data/*` or the Python hook** (consistent with the codebase) — animations verified by `expressionToWire` + framebuffer + eyes; the routing change verified by direct `python matrix_signal.py <name>` invocation.

## File Structure

| File | Responsibility | New/Modified |
|---|---|---|
| `scripts/gen-ask-icons.py` | Generator for the three `ask-*` expressions (base glyph + per-frame motion) | **New** |
| `mcp_server/expressions/ask-question.json` | Bobbing/pulsing "?" + shine | **New** (generated) |
| `mcp_server/expressions/ask-confirm.json` | Box outline → checkmark draws in | **New** (generated) |
| `mcp_server/expressions/ask-attention.json` | Amber bell ringing | **New** (generated) |
| `claude-hooks/matrix_signal.py` (+ `~/.claude/hooks/` twin) | Route any saved-expression name → `send_saved` | Modified |
| `claude-hooks/settings.hooks.snippet.json` | Add 4 hook entries + update `_comment` | Modified |
| `VERSION`, `data/version.json`, `mcp_server/package.json`, `version.h` | Stamp 0.9.0 | Modified (by tool) |

---

## Task 1: `matrix_signal.py` — fire any saved expression by name

**Files:**
- Modify: `claude-hooks/matrix_signal.py` (the `main()` dispatch, ~lines 291-294)
- Mirror: `~/.claude/hooks/matrix_signal.py` (installed twin)

**Interfaces:**
- Consumes: existing `send_named(name)`, `send_saved(name)` (loads `mcp_server/expressions/<name>.json` and POSTs frames; best-effort, returns bool), `EXPR` (canned dict).
- Produces: `matrix_signal.py <saved-name>` plays that saved expression. Canned names still route to `send_named`; `wait` still routes to `send_wait`.

- [ ] **Step 1: Change the dispatch in `main()`**

In `claude-hooks/matrix_signal.py`, replace this block (currently ~lines 291-294):

```python
    if name == "wait":
        send_wait()       # weighted-random pick from the wait pool (the hook path)
    else:
        send_named(name)  # a specific expression by name (working forces the snake)
```

with:

```python
    if name == "wait":
        send_wait()       # weighted-random pick from the wait pool (the hook path)
    elif name in EXPR:
        send_named(name)  # a specific CANNED expression by name (working forces the snake)
    else:
        send_saved(name)  # a SAVED expression by name (ask-question/ask-confirm/ask-attention,
                          # or any wait-*/idle expression). Best-effort: no-op if the file is
                          # missing or the board is offline — never block a turn.
```

(Rationale: `send_named` silently no-ops for names not in the canned `EXPR` dict, so the
`ask-*` saved expressions need the `send_saved` fallback. `ask-*` names don't stamp the
activity token and don't arm idle — they keep the existing non-wait/non-done behavior,
which is correct: Claude is actively waiting on the user, so the board should hold the
ask animation, not drift to the screensaver.)

- [ ] **Step 2: Verify the canned path still works (regression)**

Run (board reachable): `python claude-hooks/matrix_signal.py alert`
Expected: the board plays the canned `alert` (blinking exclamation). Confirms `name in EXPR` still routes canned names to `send_named`.

- [ ] **Step 3: Mirror the change into the installed twin**

Apply the identical Step-1 edit to `~/.claude/hooks/matrix_signal.py` (the live copy the real hooks execute). Verify both files match:

```bash
diff "claude-hooks/matrix_signal.py" "$HOME/.claude/hooks/matrix_signal.py" && echo "IN SYNC"
```
Expected: no diff output, then `IN SYNC`.

- [ ] **Step 4: Commit** (commit the repo copy; the `~/.claude` twin is outside the repo)

```bash
git add claude-hooks/matrix_signal.py
git commit -m "feat(hooks): route any saved-expression name to send_saved (enables ask-*)"
```

---

## Task 2: Generate the three `ask-*` expressions

> Authored live against the board (hardware, not TDD — frame-expressions have no unit
> harness). A generator gives a reproducible first version; tune live + framebuffer-verify.

**Files:**
- Create: `scripts/gen-ask-icons.py`
- Create (it writes): `mcp_server/expressions/ask-{question,confirm,attention}.json`

**Interfaces:**
- Produces: three saved expressions named `ask-question`, `ask-confirm`, `ask-attention`, each `loop:0`, 8 rows × 8 chars per frame, ≤24 frames, validated by `expressionToWire`.

- [ ] **Step 1: Write `scripts/gen-ask-icons.py`**

Model it on `scripts/gen-wait-logo.py` (same output format: `{description, frames:[8×"8-char rows"], colors, frame_ms, loop}`; a `to_art()` helper that assigns a char per unique hex). Define a base 8×8 glyph per icon and apply per-frame motion:

- **`ask-question`** — a bold `?` glyph (top curve + stem + dot, ~6 rows tall, centered). Per frame: **bob** the whole glyph ±1 row on a slow sine, **pulse** brightness 0.6↔1.0, and sweep a single **brighter "shine" pixel** across the curve. Color cyan `#44eeff`. ~14 frames, `frame_ms` ~110.
- **`ask-confirm`** — frame 0: a dim 6×6 **box outline** (gray `#888888`). Then **reveal a green checkmark** stroke-by-stroke over ~5 frames (short down-stroke to the low point, then the long up-stroke), hold the full check ~3 frames with a gentle pulse, loop. Box stays dim throughout; check green `#00ff88`. ~12 frames, `frame_ms` ~120.
- **`ask-attention`** — a **bell** glyph (rounded dome ~4 wide + a 1px clapper below) that **wiggles** left/right ±1 col over the cycle with small **motion ticks** (1-2 faint pixels off the rim at the wiggle extremes) to read as "ringing". Amber `#ffb000`. ~12 frames, `frame_ms` ~90.

Keep each glyph sparse and silhouette-first; pick colors whose needed channels clear the bri-5 floor.

- [ ] **Step 2: Run the generator**

Run: `python scripts/gen-ask-icons.py`
Expected: prints `wrote …/ask-question.json`, `…/ask-confirm.json`, `…/ask-attention.json` with frame/color counts.

- [ ] **Step 3: Validate all three through the real board path**

Create `mcp_server/_validate_ask.mts`:

```ts
import { readFileSync } from "node:fs";
import { expressionToWire, type Expression } from "./expressions.ts";
for (const name of ["ask-question","ask-confirm","ask-attention"]) {
  const e = JSON.parse(readFileSync(`expressions/${name}.json`,"utf8")) as Expression;
  const w = expressionToWire(e);
  console.log(`${name}: OK frames=${w.frames.length} frame_ms=${w.frame_ms} loop=${w.loop}`);
}
```

Run: `cd mcp_server && npx tsx _validate_ask.mts && rm -f _validate_ask.mts`
Expected: three `OK` lines, `loop=0` each. (Delete the temp file after.)

- [ ] **Step 4: Eyeball silhouettes (no board needed)**

Run a small Python dump of a representative frame of each (mirror the `gen-wait-logo` eyeball step), confirming the `?`, the box+check, and the bell read as recognizable shapes.

- [ ] **Step 5: Play each on the board + framebuffer-check**

With the board reachable, capture its current state first (`matrix_status`), then for each:
`python claude-hooks/matrix_signal.py ask-question` (then `ask-confirm`, `ask-attention`),
reading `GET /api/display/framebuffer` to confirm lit pixels match the design at the board's
brightness. **Restore the board's prior animation + brightness afterward.**

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-ask-icons.py mcp_server/expressions/ask-question.json mcp_server/expressions/ask-confirm.json mcp_server/expressions/ask-attention.json
git commit -m "feat(express): ask-question/ask-confirm/ask-attention awaiting-input animations"
```

---

## Task 3: Add the hook entries to the snippet

**Files:**
- Modify: `claude-hooks/settings.hooks.snippet.json`

**Interfaces:**
- Consumes: `matrix_signal.py` saved-name routing (Task 1) + the three expressions (Task 2).
- Produces: the canonical install snippet documents all six hook wirings.

- [ ] **Step 1: Add the four new hook blocks**

Add to the `hooks` object in `claude-hooks/settings.hooks.snippet.json` (keep the existing `UserPromptSubmit` and `Stop` blocks; use the same `python "…matrix_signal.py" <signal>` command shape with the `YOU` placeholder path):

```json
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [ { "type": "command", "command": "python \"C:\\Users\\YOU\\.claude\\hooks\\matrix_signal.py\" ask-question" } ]
      },
      {
        "matcher": "ExitPlanMode",
        "hooks": [ { "type": "command", "command": "python \"C:\\Users\\YOU\\.claude\\hooks\\matrix_signal.py\" ask-confirm" } ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "AskUserQuestion|ExitPlanMode",
        "hooks": [ { "type": "command", "command": "python \"C:\\Users\\YOU\\.claude\\hooks\\matrix_signal.py\" wait" } ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [ { "type": "command", "command": "python \"C:\\Users\\YOU\\.claude\\hooks\\matrix_signal.py\" ask-attention" } ]
      }
    ]
```

- [ ] **Step 2: Update the `_comment`**

Extend the snippet's `_comment` to document the new triggers: PreToolUse(AskUserQuestion)→ask-question, PreToolUse(ExitPlanMode)→ask-confirm, Notification(permission_prompt)→ask-attention, PostToolUse(AskUserQuestion|ExitPlanMode)→wait (flips to busy when answered); note `idle_prompt` is intentionally NOT wired (turn-end spam risk).

- [ ] **Step 3: Validate JSON**

Run: `python -c "import json;json.load(open('claude-hooks/settings.hooks.snippet.json'));print('valid json')"`
Expected: `valid json`.

- [ ] **Step 4: Commit**

```bash
git add claude-hooks/settings.hooks.snippet.json
git commit -m "feat(hooks): wire awaiting-input triggers (AskUserQuestion/ExitPlanMode/permission)"
```

---

## Task 4: Version bump 0.9.0

**Files:**
- Modify (by tool): `VERSION`, `esp32_matrix_webserver/data/version.json`, `mcp_server/package.json`, `esp32_matrix_webserver/version.h`.

- [ ] **Step 1: Bump**

Run: `npm run bump:minor`
Expected: rewrites `VERSION` to `0.9.0`, stamps the three artifacts, commits `chore: bump v0.9.0`.

- [ ] **Step 2: Check**

Run: `npm run check`
Expected: repo `VERSION` 0.9.0; MCP 0.9.0 ✓ after `/mcp` reconnect; firmware/web older (no fw/web change this feature — expected drift, don't chase).

---

## Task 5: Deploy & verification handoff (the user — host/hardware)

> Requires the user's Claude Code session (install hooks + restart) and the physical
> board. This is the host/hardware half of the loop, not code.

- [ ] **Step 1: Install** — the user merges the updated `settings.hooks.snippet.json` blocks into their real `~/.claude/settings.json` (fixing the `YOU` path), confirms the `~/.claude/hooks/matrix_signal.py` twin matches the repo (Task 1 Step 3), and **restarts Claude Code** (hooks load at session start). `/mcp` reconnect so MCP reports 0.9.0.
- [ ] **Step 2: GATE — confirm `PreToolUse` fires for the built-ins.** With the board on, have Claude pop a questionnaire (`AskUserQuestion`) → board should show **`ask-question`**; answer → flips to **`wait`**. Have Claude present a plan (`ExitPlanMode`) → **`ask-confirm`** → approve → **`wait`**. If `PreToolUse` does NOT fire for these built-ins (board stays unchanged), apply the spec's **fallback** (wire `Notification:idle_prompt` and/or the `Elicitation` event for the question case) and re-test.
- [ ] **Step 3: Permission** — trigger a tool that needs permission → board shows **`ask-attention`** (bell).
- [ ] **Step 4: bri-5 read** — confirm each `ask-*` is legible at the board's normal brightness (user's eyes). Note any color/shape tweaks for a quick generator re-run.
- [ ] **Step 5: Drift** — `matrix_version` shows MCP 0.9.0; firmware/web older until next deploy (expected).

---

## Self-Review

**Spec coverage:**
- 3 ask-* expressions + designs → Task 2. ✓
- Not in wait pool / `loop:0` → Global Constraints + Task 2. ✓
- `matrix_signal.py` saved-name routing → Task 1. ✓
- 4 hook entries + mapping → Task 3 + Global Constraints. ✓
- `idle_prompt` excluded → Global Constraints + Task 3 Step 2. ✓
- Live-copy twin sync → Task 1 Step 3. ✓
- PreToolUse-on-builtins gate + fallback → Task 5 Step 2. ✓
- Version 0.9.0 → Task 4. ✓
- bri-5 floor / channel-distinct colors → Global Constraints + Task 2. ✓
- Fire-and-forget hook latency → Global Constraints (no code change needed; already best-effort). ✓

**Placeholder scan:** none — all code/commands concrete. (Task 2's glyph art is authored by the generator per the per-icon spec; the generator is modeled on the committed `gen-wait-logo.py`.)

**Type/name consistency:** `ask-question` / `ask-confirm` / `ask-attention` consistent across Tasks 1–3 + 5; `send_saved` / `send_named` / `EXPR` match the real `matrix_signal.py`; signal `wait` reused for the clear path. ✓

**Note on Tasks 2 & 5:** intentionally not TDD — frame-expression authoring and the hook-fires test have no unit harness (matches the codebase). Task 1's routing is verified by direct invocation (Step 2). The only genuinely host-dependent unknown (PreToolUse on built-ins) is gated in Task 5 Step 2 with a documented fallback.
