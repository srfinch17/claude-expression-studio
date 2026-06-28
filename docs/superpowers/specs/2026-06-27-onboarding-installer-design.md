# Onboarding Installer — Design

**Date:** 2026-06-27
**Status:** approved (design forks confirmed by the user)
**Branch:** `feat/expression-studio`

## Goal

One command — `npm run setup` — that turns a freshly-cloned repo into a working,
ambient Claude-Code companion **without a physical board required**. It wires the
two things a stranger currently has to hand-assemble from README prose:

1. the **Claude Code hooks** (board/panel reacts to your prompts, turns, questions), and
2. the **MCP server** (the `matrix_*` tools **and** the engine that serves the no-board
   web panel + Studio).

It replaces the error-prone manual steps in `claude-hooks/README.md` (copy scripts,
hand-merge a JSON block, fix absolute paths, pick `python` vs `python3`) and fixes a
real distribution bug: `matrix_signal.py` hardcodes the maintainer's absolute repo
path as its `MATRIX_MCP_DIR` default, so the hooks silently target a non-existent
path on anyone else's machine.

## Confirmed design decisions

- **Target harness:** Claude Code (hooks are the ambient differentiator). Claude
  Desktop already installs via double-click `.mcpb`; it is out of scope here.
- **Config footprint:** merge into the user's **global** config (`~/.claude/settings.json`
  for hooks, `~/.claude.json` for the MCP server), each with a **timestamped backup**
  first. The companion is meant to be ambient across all Claude Code work.
- **Board:** **no-board, panel-first** by default. Setup never requires hardware; the
  web panel (`board.html`, served by the engine) mirrors what a board would show.
  `--board <url>` (or `ESP32_URL` in the environment) opts a board in.

## Non-goals (YAGNI)

- No Claude Desktop automation (the `.mcpb` is already turnkey).
- No firmware flashing (that path — `install/flash.*` — already exists and is separate).
- No interactive TUI/menu. Flags + sane defaults + a clear printed summary.
- No package publishing / `npx`-from-registry. The installer runs from the cloned repo.

## What "installed" means (the end state setup produces)

**Files deployed to `~/.claude/hooks/`** (copied from `claude-hooks/`, source stays the
truth — this *is* the live-copy the project already requires, made a real step):
- `matrix_signal.py`, `matrix_idle.py`, `manifest_resolver.py`, `bored_animations/`
- `matrix_config.json` — **new**, written by the installer:
  `{ "mcp_dir": "<repo>/mcp_server", "board_url": "<url-or-null>" }`

**`~/.claude/settings.json`** gains the `hooks` block from
`settings.hooks.snippet.json`, with every `YOU`/path placeholder replaced by the real
`~/.claude/hooks/matrix_signal.py` path and the detected python command.

**`~/.claude.json`** gains `mcpServers.esp32-matrix`, reproducing the proven, per-OS
registration (see below), with `MATRIX_MCP_DIR` + optional `ESP32_URL` in its `env`.

**`<repo>/mcp_server/mcp_launch.cmd`** (Windows only) regenerated with the detected
node path and this repo's `dist/index.js` path.

## Component design

The deliverable is `scripts/setup.mjs` plus a small, **pure**, unit-tested core in
`scripts/setup-lib.mjs`. The CLI is thin glue around pure functions so the risky
logic (JSON merge, placeholder substitution, registration shape) is tested without
touching the real `~/.claude` files.

### `scripts/setup-lib.mjs` (pure, unit-tested)

- `detectPython(candidates, exists)` → `"python" | "python3"`: first candidate that
  resolves on PATH (injectable probe for tests). Throws a clear error if neither.
- `buildHookCommand(pythonCmd, signalScriptPath, moment)` → the exact command string
  for one hook entry (quoting the script path).
- `hooksBlock(pythonCmd, signalScriptPath)` → the full `hooks` object (all 6 moments)
  with real path + python substituted. Derived from the snippet's shape so the two
  cannot drift.
- `mergeHooks(existingSettings, ourHooks)` → new settings object. **Idempotent:**
  removes any prior matrix entries (matched by a command containing `matrix_signal.py`)
  before adding ours, preserving every unrelated hook the user already has.
- `mcpRegistration({ platform, repoDir, nodePath, launchCmdPath, boardUrl })` → the
  `mcpServers.esp32-matrix` value. Windows → `cmd.exe /c <launchCmdPath>`; posix →
  `<nodePath> <repoDir>/mcp_server/dist/index.js`. `env` always carries
  `MATRIX_MCP_DIR`; `ESP32_URL` only when `boardUrl` is set.
- `mergeMcp(existingClaudeJson, registration)` → new `~/.claude.json` object,
  idempotently replacing any prior `esp32-matrix` entry, preserving the rest.
- `removeHooks(existingSettings)` / `removeMcp(existingClaudeJson)` → the uninstall
  inverses (drop only our entries).
- `launchCmdContents(nodePath, distIndexPath)` → the regenerated `mcp_launch.cmd` text.

### `scripts/setup.mjs` (thin CLI / IO orchestration)

Flags: `--board <url>`, `--uninstall`, `--dry-run` (alias `--print`), `--help`.

Install flow:
1. Resolve `repoDir` (from the script location), `homeDir`, the two target config paths.
2. Ensure `mcp_server/dist/index.js` exists; if missing, run the existing build
   (`node scripts/copy-shared-runtime.mjs` + `tsc -p mcp_server`) and log it. Fail
   loudly with a fix hint if the build fails.
3. `detectPython`.
4. Copy hook assets → `~/.claude/hooks/` (create dir if needed). Write `matrix_config.json`.
5. On Windows, regenerate `mcp_server/mcp_launch.cmd`.
6. Read + **back up** (`<file>.bak-<ISO8601>`) + merge + write `~/.claude/settings.json`
   (hooks) and `~/.claude.json` (mcp). Create either file if absent (`{}` base).
7. Print a summary: what changed, the backups, and **next steps** (restart Claude Code;
   the panel/Studio open via the `matrix_studio` tool; `.matrix_off` kill switch;
   re-run with `--board <url>` to attach hardware).

`--dry-run` performs steps 1–5 read-only in memory and prints the exact merged JSON
for both files and the file copies it *would* make — writing nothing.

`--uninstall` removes our hooks + mcp entries (with backups), and deletes the
deployed scripts + `matrix_config.json` from `~/.claude/hooks/` (leaving any
`bored_animations` the user customized? — no: we deployed them, so remove them too;
the source remains in the repo). Leaves unrelated settings untouched.

### Hook-script change (removes the hardcoded path)

`matrix_signal.py` and `matrix_idle.py` gain a tiny `_load_config()` helper resolving
`mcp_dir` and `board_url` in priority order:
1. environment (`MATRIX_MCP_DIR` / `ESP32_URL`) — unchanged, still wins;
2. `~/.claude/hooks/matrix_config.json` (written by the installer);
3. a neutral built-in fallback (`esp32matrix.local` for the board; for `mcp_dir`, the
   directory the script lives in has no repo, so config/env is required — the fallback
   just avoids a crash and the board no-ops).

This deletes the `C:\Users\…` literal default. Source is edited once; the installer
deploys the copies, so there is no separate "edit the live copy" step.

## Cross-platform notes

- All paths via `os.homedir()` / `path.join`; never hardcode separators.
- Windows MCP launch keeps the `cmd.exe` wrapper (spawn is finicky there — documented);
  posix launches node directly.
- Node path detection: `process.execPath` is the node running the installer — reuse it.

## Error handling

- Missing `~/.claude` dir → create it.
- Malformed existing `settings.json` / `.claude.json` → **abort** with the parse error
  and the file path; never overwrite a file we could not parse (its backup-and-replace
  could lose data). Tell the user to fix or move the file.
- Build failure (dist) → abort with the failing command and a manual hint.
- Every write is preceded by a backup; the summary prints backup paths for easy revert.

## Testing

- `scripts/setup-lib.test.js` (`node --test`): every pure function — python detection
  (both/only-one/neither), hooks block shape + substitution, idempotent merge
  (preserves unrelated hooks, replaces our own, round-trips with remove), mcp
  registration per-platform, mcp merge/remove, launch-cmd contents, config shape.
- A merge round-trip test (`merge` then `remove` returns the original unrelated
  content) is the key safety guarantee for touching the user's global files.
- The CLI/IO in `setup.mjs` is covered by a `--dry-run` smoke assertion (runs against a
  temp `HOME`, asserts it writes nothing and prints both merged blocks).
- `npm run test` continues to gate (`check:manifest` + tsc + node --test globs already
  include `scripts/**/*.test.js`).

## Docs

- New `npm run setup` script in root `package.json`.
- README "Install (end users)" gains a **Claude Code** path pointing at `npm run setup`
  (the existing Desktop `.mcpb` path stays).
- `claude-hooks/README.md` manual steps reframed as "what `npm run setup` does for you"
  (kept as the under-the-hood reference).
- CLAUDE.md: note the installer as the supported Claude Code onboarding path.
