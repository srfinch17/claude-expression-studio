# Claude Code → LED matrix hooks

Make the ESP32-S3 LED matrix react to Claude Code automatically, including a
"bored Claude" mode where the board goofs off with random animations when it's
been left idle.

- **On every prompt you submit** → the board shows the `working` animation.
- **When Claude finishes a turn** (the checkmark) → it shows `done`, then arms a
  watcher. If you don't come back, the board starts playing **random fun
  animations** (a bored-Claude idle show) until you return, or until an idle cap,
  when it settles on a sleepy face.

No MCP server is involved in the reactions: the hooks run a standalone Python
script that POSTs animation frames straight to the board's HTTP endpoint, so it
works even when the MCP server isn't running. If the board is unreachable the
scripts fail silently, a turn is never blocked or broken.

## What's in here

| File | Role |
|------|------|
| `matrix_signal.py` | Fires a named expression (`working`/`done`/`alert`/`sleep`/`party`). On `done` it stamps an activity token and spawns the idle watcher. Called by the hooks. |
| `matrix_idle.py` | The "bored" watcher. Waits, and if still idle plays a random animation from `bored_animations/`. Exits the moment you come back. |
| `bored_animations/*.json` | The idle rotation, one animation per file. **This folder is the whole content model: add/remove/edit files to change what the board does when bored.** |
| `settings.hooks.snippet.json` | The `hooks` block to merge into `~/.claude/settings.json`. |

## Setup on a new machine ("customer's Claude")

> **The supported path is `npm run setup` from the repo root**, it does every step
> below for you (deploys these scripts to `~/.claude/hooks/`, writes a `matrix_config.json`
> pointing at the repo, and merges the hooks + MCP server into your global config, with
> backups and idempotent re-runs). A board is optional. The manual steps below are the
> under-the-hood reference for what the installer does. See the repo README's
> "Install for Claude Code" section.

1. **Have a reachable board** running the firmware in this repo, exposing
   `POST /api/display/frames`, at a known URL. Default is `http://esp32matrix.local`.
2. **Copy this folder's contents into `~/.claude/hooks/`**, both `.py` scripts
   and the `bored_animations/` folder. (`matrix_idle.py` imports `matrix_signal.py`,
   so keep them side by side.)
3. **Wire the hooks:** merge the `hooks` block from `settings.hooks.snippet.json`
   into `~/.claude/settings.json`. Fix the absolute path to the scripts, and use
   `python` or `python3` to match your system. (Uses only the Python stdlib, no
   pip installs.)
4. **Point the scripts at the repo:** the hooks resolve `mcp_dir` (for the manifest +
   expressions) and `board_url` from, in order: environment vars (`MATRIX_MCP_DIR` /
   `ESP32_URL`), then `~/.claude/hooks/matrix_config.json`, then defaults. Either set
   `MATRIX_MCP_DIR=<repo>/mcp_server` in your environment, or drop a
   `matrix_config.json` next to the scripts: `{"mcp_dir": "<repo>/mcp_server",
   "board_url": null}`. If your board isn't at `esp32matrix.local`, also set `ESP32_URL`
   (or `board_url`). **`npm run setup` writes this config file for you.**
5. **Restart Claude Code.** Hooks are read at session start, so registering them
   (and any later edit to the `hooks` block) only takes effect next session.

That's it, submit a prompt and the board should react.

## Turning it on and off at will

A kill switch silences everything (working/done **and** the bored show) instantly,
no restart, hooks stay registered:

```bash
touch ~/.claude/hooks/.matrix_off    # silence the board now
rm    ~/.claude/hooks/.matrix_off    # re-enable
```

To remove the feature entirely, delete the `hooks` block from `settings.json`
(takes effect next session).

## Adding / modifying bored animations  ← the easy part

The rotation is just the `bored_animations/` folder. Each file is one animation in
the exact format `matrix_animate save_as` produces:

```json
{
  "description": "what it is",
  "frames": [ ["8 chars","x8 rows", "...", "...", "...", "...", "...", "..."], "...more frames..." ],
  "colors": { "W": "#ffffff", "B": "#2060ff" },
  "frame_ms": 150,
  "loop": 0
}
```

- **Add:** drop a `.json` file in `bored_animations/`. (If you designed it with
  `matrix_animate save_as`, copy the file it wrote to
  `mcp_server/expressions/<name>.json` into here.)
- **Remove:** delete or move its `.json`.
- **Edit:** change the `frames` / `colors` / `frame_ms` in its file.

Picked up automatically on the watcher's next goof, no restart. Design new
animations live with `matrix_animate` first (see the `emoting-on-8x8` guidance);
64 pixels at low brightness is unforgiving, so iterate on the real panel.

Format notes: each frame is 8 strings of exactly 8 characters; `.` = off, every
other character must appear in `colors`. `loop`: `0` = animate/hold until the next
goof replaces it; `N` = play N passes then hold the last frame. Keep frames light
and sparse, heavy 24-frame full-panel animations can spike the board's heap.

## Tuning the boredom

Set these env vars (seconds) to taste; they're also handy for testing without
waiting minutes:

| Env var | Default | Meaning |
|---------|---------|---------|
| `MATRIX_IDLE_FIRST_MIN` / `_FIRST_MAX` | 75 / 120 | first wait after the checkmark before the first goof |
| `MATRIX_IDLE_MIN` / `_MAX` | 45 / 90 | random gap between goofs while idle |
| `MATRIX_IDLE_CAP` | 600 | stop goofing after this much continuous idle, settle on a sleepy face |
| `MATRIX_IDLE_POOL_DIR` | `./bored_animations` | folder of animation JSONs to use |
| `ESP32_URL` | `http://esp32matrix.local` | board base URL |

## How it knows you're "still idle" (the mechanism)

Claude Code hooks have no idle-timer event, so idleness is inferred with an
**activity token**. `matrix_signal.py` writes a fresh token to `.matrix_activity`
on every `working`/`done`. When `done` fires it spawns `matrix_idle.py` *detached*
(so the turn returns instantly) and hands it the current token. The watcher loops:
sleep a randomized interval, then compare the file's token to its own, 
**unchanged** means still idle (play a random animation), **changed** means you
came back or a newer checkmark spawned a newer watcher (exit silently). Only the
newest watcher ever fires, so there's no overlap.

## Known limits

- Single activity-token file → assumes one Claude Code session at a time. Two
  concurrent sessions would share the token (fine for single-user use).
- The bored show needs the board reachable to be *seen*, but a missing/offline
  board never breaks anything, the POSTs just no-op.
