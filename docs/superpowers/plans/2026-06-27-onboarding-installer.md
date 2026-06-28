# Onboarding Installer — Implementation Plan

> **For agentic workers:** execute task-by-task with TDD. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `npm run setup` wires the Claude Code hooks + MCP server into the user's global
config (no board required), replacing the manual README steps and removing the hardcoded
maintainer path in the hook scripts.

**Architecture:** A pure, unit-tested core (`scripts/setup-lib.mjs`) holds the JSON-merge /
substitution / registration logic; a thin CLI (`scripts/setup.mjs`) does IO + orchestration.
The two hook scripts gain a config-file fallback so the installer can point them at the repo.

**Tech Stack:** Node ESM (matches repo scripts), Python stdlib (hooks), `node --test`.

## Global Constraints

- No new runtime dependencies (Node built-ins only; Python stdlib only).
- Never use the maintainer's real name or a machine-specific absolute path in any output.
- Every write to a user config file is preceded by a timestamped backup; a file we cannot
  parse is never overwritten (abort instead).
- Idempotent: re-running install replaces only our own entries, preserving all others.
- Cross-platform: Windows uses the `cmd.exe` wrapper; posix launches node directly.

---

### Task 1: Pure core — `scripts/setup-lib.mjs` + tests

**Files:**
- Create: `scripts/setup-lib.mjs`
- Test: `scripts/setup-lib.test.js`

**Produces** (consumed by Task 3):
- `detectPython(candidates, exists) -> string` (throws if none resolve)
- `hooksBlock(pythonCmd, signalScriptPath) -> { UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop }`
- `mergeHooks(settingsObj, ourHooks) -> settingsObj'` (idempotent; matches our entries by a
  command substring `matrix_signal.py`)
- `removeHooks(settingsObj) -> settingsObj'`
- `mcpRegistration({ platform, repoDir, nodePath, launchCmdPath, boardUrl }) -> regObj`
- `mergeMcp(claudeJsonObj, regObj) -> obj'` / `removeMcp(claudeJsonObj) -> obj'`
- `launchCmdContents(nodePath, distIndexPath) -> string`
- `MOMENTS` — the ordered list of the 6 harness moments, single source for `hooksBlock`.

**Test cases (write first, must fail before implementation):**
- `detectPython` returns first resolving candidate; throws when none resolve.
- `hooksBlock` emits all 6 moments with the script path + python substituted, `PreToolUse`
  has the two matchers (AskUserQuestion, ExitPlanMode), `PostToolUse` likewise,
  `Notification` matcher `permission_prompt`.
- `mergeHooks` into an object that already has an unrelated `Stop` hook keeps the unrelated
  one AND adds ours; a second `mergeHooks` does not duplicate (count stable) — idempotent.
- `mergeHooks` then `removeHooks` returns the original unrelated content (round-trip safety).
- `mcpRegistration` win32 → `{ type:"stdio", command:"cmd.exe", args:["/c", launchCmdPath], env:{ MATRIX_MCP_DIR } }`; linux/darwin → `{ command:nodePath, args:[distIndexPath], env:{...} }`; `ESP32_URL` present iff `boardUrl` truthy.
- `mergeMcp` preserves an existing unrelated server (e.g. `playwright`) and replaces a prior
  `esp32-matrix`; `removeMcp` drops only ours.
- `launchCmdContents` contains the node path and dist path, `@echo off`.

**Implementation notes:** `hooksBlock` builds from `MOMENTS` (no copy of the snippet's literal
strings) so it cannot drift. Merge functions are pure (clone, don't mutate input).

- [ ] Write `setup-lib.test.js` with the cases above
- [ ] Run it → all fail (module missing)
- [ ] Implement `setup-lib.mjs`
- [ ] Run → all pass
- [ ] Commit

---

### Task 2: Hook scripts read config — remove the hardcoded path

**Files:**
- Modify: `claude-hooks/matrix_signal.py` (the `MCP_DIR` / `BOARD_URL` defaults)
- Modify: `claude-hooks/matrix_idle.py` (same pattern if it resolves either)
- Test: `claude-hooks/test_setup_config.py` (new, stdlib `unittest`)

**Change:** replace the `BOARD_URL = os.environ.get("ESP32_URL", …)` line and the
`MCP_DIR = os.environ.get("MATRIX_MCP_DIR", r"C:\Users\…")` literal with a `_load_config()`
helper resolving each value: env var → `~/.claude/hooks/matrix_config.json` → neutral default
(`http://esp32matrix.local` for board; for `mcp_dir`, `""` — env/config required, no crash).

**Test cases:**
- With `MATRIX_MCP_DIR` set in env → that value wins (config ignored).
- With env unset + a temp `matrix_config.json` containing `mcp_dir`/`board_url` → those values.
- With both unset → board default `http://esp32matrix.local`, `mcp_dir` empty (no exception).
- No `C:\Users` literal remains in the source (assert by reading the file).

- [ ] Write `test_setup_config.py` → fails
- [ ] Add `_load_config()` + rewire the two module-level defaults
- [ ] Run `python -m unittest` in `claude-hooks/` → passes; also run existing
      `test_manifest_resolver.py` to confirm no regression
- [ ] Commit

---

### Task 3: CLI — `scripts/setup.mjs` (install / dry-run / uninstall)

**Files:**
- Create: `scripts/setup.mjs`
- Test: `scripts/setup.test.js` (drives the CLI against a temp HOME + temp repo, asserts
  dry-run writes nothing and prints both merged blocks; install then uninstall round-trips)

**Behavior:** as the spec's "Install flow" — resolve paths, ensure `dist/index.js` (build if
missing), `detectPython`, deploy hook assets + write `matrix_config.json`, regenerate
`mcp_launch.cmd` on win32, back-up + merge-write both config files, print summary. `--dry-run`
is read-only and prints the merged JSON for both files. `--uninstall` reverses (backups +
remove our entries + delete deployed scripts).

**Test cases:**
- `--dry-run` against a temp HOME: exits 0, the temp config files are unchanged/absent,
  stdout contains `"esp32-matrix"` and `matrix_signal.py`.
- install (temp HOME) then assert: `~/.claude/hooks/matrix_signal.py` exists,
  `matrix_config.json` has the repo `mcp_dir`, `settings.json` has our hooks,
  `.claude.json` has `mcpServers.esp32-matrix`, a `.bak-*` exists for each pre-existing file.
- `--uninstall` then assert our entries gone and the deployed scripts removed.
- malformed existing `settings.json` → exits non-zero, file untouched.

**Notes:** inject HOME via an env override (`MATRIX_FAKE_HOME` honored only under test, or pass
`--home` — pick the test-only env). Use `process.execPath` for the node path. Skip the real
build in the test by pre-creating a dummy `dist/index.js` in the temp repo.

- [ ] Write `setup.test.js` → fails
- [ ] Implement `setup.mjs`
- [ ] Run → passes
- [ ] Commit

---

### Task 4: Wire-up + docs

**Files:**
- Modify: root `package.json` (add `"setup": "node scripts/setup.mjs"`)
- Modify: `README.md` (Install → add the Claude Code `npm run setup` path)
- Modify: `claude-hooks/README.md` (reframe manual steps as "what setup does")
- Modify: `CLAUDE.md` (note the installer as the Claude Code onboarding path)

- [ ] Add the npm script; `npm run setup --dry-run` prints cleanly
- [ ] Update the three docs
- [ ] `npm test` green
- [ ] Commit

---

## Final review

After Task 4, dispatch one fresh code-reviewer subagent (most-capable model) over the whole
branch diff for this feature — focus: safety of the global-config edits (backup/abort/idempotent
round-trip), cross-platform correctness, and that no machine-specific path or name leaks.
