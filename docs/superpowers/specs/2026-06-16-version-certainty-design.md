# Version Certainty — Design Spec

**Date:** 2026-06-16
**Status:** Approved (brainstorming) → ready for implementation plan
**Author:** Claude + user

## Problem

The project has three independently-deployed artifacts — **firmware** (flashed via
Arduino IDE), **web files** (`data/`, uploaded to LittleFS), and the **MCP server**
(`mcp_server/dist`, run by node) — and *nothing* reports what version of each is
actually live. The MCP server's `version: "1.0.0"` is hardcoded and never changes, so
it gave a false sense that "the build has a version." The board's `/api/status`
exposes no firmware identifier at all. Result: after a flash + upload, the only way to
answer "are we current?" was guesswork. This spec makes every artifact self-reporting
and gives a one-call way to detect drift.

## Decisions (from brainstorming)

1. **Version model:** a single repo-wide SemVer (one `VERSION` file), stamped into all
   three artifacts, **plus** an automatic firmware build timestamp so a reflash always
   updates a marker even if the human forgets to bump.
2. **Bump trigger:** deliberate manual command (`npm run bump:*`). No git-hook
   auto-bump (would manufacture false drift for board-irrelevant pushes).
3. **Check surface:** both an MCP tool (`matrix_version`) and a node script
   (`npm run check`), sharing one logic module.
4. **Starting version:** `0.1.0`.
5. **Skill is general-purpose and user-scoped** — reusable across the user's other
   repos, with this project as the worked reference example.

## Hard constraint

Firmware is compiled in the **Arduino IDE**, which will not run a git command at build
time. So the firmware version cannot be a live git SHA injected by a build step — it
must be a stamped constant in a header, complemented by the compiler's free
`__DATE__`/`__TIME__` macros for an automatic build timestamp.

## Architecture

### Single source of truth
- `VERSION` (repo root) — contains exactly the SemVer string, e.g. `0.1.0`. Trailing
  newline tolerated; parser trims. Malformed content → tooling fails loud.

### Artifact self-reporting

| Artifact | Self-report mechanism | Field(s) exposed | Updates when |
|---|---|---|---|
| Firmware | `esp32_matrix_webserver/version.h` → `#define FW_VERSION "x.y.z"` (stamped); `__DATE__ " " __TIME__` (automatic) | `fw_version`, `fw_built` | flash |
| Web | `esp32_matrix_webserver/data/version.json` → `{"version":"x.y.z","stamped":"<iso8601>"}` | `web_version` | LittleFS upload |
| MCP | `mcp_server/package.json` `version`, read at runtime | MCP `initialize` `serverInfo.version` | restart / reconnect |

### One-call drift detection (firmware ⇄ web)
At boot, `setup()` reads `/version.json` from LittleFS into a global `webVersion`
(default `"unknown"` if the file is absent — i.e. a pre-versioning upload). `handleStatus()`
then emits `fw_version`, `fw_built`, and `web_version` together, so a single
`GET /api/status` reveals whether the flashed firmware and the uploaded web files are
in sync.

Reading once at boot (not per-request) avoids LittleFS overhead on every status poll;
web assets don't change at runtime so the boot-time snapshot is always accurate.

### MCP runtime version read
`mcp_server/index.ts` stops hardcoding `version: "1.0.0"`. It reads `package.json`
relative to the module (`new URL("../package.json", import.meta.url)`) at startup and
uses that string in the server `initialize` metadata. Because this reads `package.json`
(not a `.ts` constant), a `npm run bump` updates the live MCP version **without** a
`tsc` rebuild — only a server restart/reconnect.

## Components

### 1. `VERSION` file
Plain text, repo root. Canonical.

### 2. Stamp script — `scripts/version-stamp.js` (node, ESM)
Scripts live in repo-root `scripts/`. The only `package.json` is in `mcp_server/`, so
its npm-script entries invoke them by relative path (`node ../scripts/version-stamp.js`),
and the scripts resolve repo paths from their own location (repo root = one level up
from `scripts/`), not from the npm cwd.

Reads `VERSION`, writes the value into:
- `esp32_matrix_webserver/version.h` (regenerated header; includes a
  "GENERATED — do not edit by hand" banner)
- `esp32_matrix_webserver/data/version.json` (with a fresh `stamped` ISO timestamp)
- `mcp_server/package.json` (`version` field, preserving formatting via JSON
  read/modify/write)

Idempotent: running it without a version change reproduces identical files (except the
`version.json` `stamped` timestamp, which always refreshes — that is intentional, it
records when the web bundle was last stamped).

### 3. Bump script — invoked via npm scripts
`mcp_server/package.json` scripts (the repo's only `package.json`, so npm scripts live
there):
- `bump:patch` / `bump:minor` / `bump:major` → compute next SemVer from `VERSION`,
  write `VERSION`, run `version-stamp.js`, then `git add VERSION
  esp32_matrix_webserver/version.h esp32_matrix_webserver/data/version.json
  mcp_server/package.json` and `git commit -m "chore: bump vX.Y.Z"`.
- The bump logic lives in `scripts/version-bump.js` so it is testable independently of
  npm.

### 4. Check logic — `scripts/version-check.js` (shared module)
Exports a function that, given a board base URL, returns a structured report:
- reads repo `VERSION`
- reads `mcp_server/package.json` version
- fetches `<board>/api/status` → `fw_version`, `fw_built`, `web_version`
- compares each artifact to repo `VERSION`, returns `{ artifact, reported, expected,
  status: "match" | "drift" | "unknown" | "unreachable" }[]`

Consumers:
- **`npm run check`** → CLI wrapper that pretty-prints the report (✓ / ⚠) and exits
  non-zero if any artifact is in `drift` (so it can gate CI later if desired).
- **`matrix_version` MCP tool** → calls the same module, returns the report as text for
  Claude to read mid-conversation.

### 5. `matrix_version` MCP tool
New tool in `mcp_server/index.ts`. No arguments. Uses `ESP32_URL` env (already wired)
for the board address. Returns the per-artifact report. Requires `tsc` rebuild +
reconnect to take effect (it's a `.ts` change), per the standing MCP build rule.

### 6. The `versioning` skill (user-scoped, general)
Lives at `~/.claude/skills/versioning/` so it loads in **all** the user's projects.

Skill body teaches the **portable pattern**, not the matrix specifics:
1. Keep one canonical `VERSION` (single source of truth).
2. Enumerate your **deployable artifacts** (things that ship independently).
3. Give each artifact a **self-report channel** (an endpoint field, a served file, a
   runtime-read manifest, a `--version` flag…).
4. Add a **stamp** step that writes `VERSION` into each artifact's source.
5. Add a **check** that probes each artifact's self-report and diffs against `VERSION`,
   reporting per-artifact drift.
6. Bump deliberately; remember each artifact only goes live on **its own** deploy step
   (compile/flash, upload, restart, redeploy) — drift between repo and a deployed
   artifact is expected until that step runs.

Includes an **"Adapting to a new repo"** checklist and a **worked example** section
referencing this ESP32 matrix implementation (the `/api/status` fields, the LittleFS
`version.json`, the node scripts) so a reader can see the abstract pattern made concrete.

Because the skill is user-scoped, its files live under `~/.claude/skills/` and are **not
part of this repo's git** — only the auto-memory pointer and this spec reference it. A
one-line pointer is added to auto-memory so future sessions know the skill exists and
that this repo already implements the pattern.

## Data flow

```
VERSION (0.1.0)
   │  npm run bump:minor  → 0.2.0, then stamp + commit
   ├─► version.h         #define FW_VERSION "0.2.0"   ──(flash)──►  board fw_version
   ├─► data/version.json {"version":"0.2.0",...}        ──(upload)─►  board web_version
   └─► mcp package.json  "version":"0.2.0"              ──(reconnect)► MCP serverInfo

CHECK:  repo VERSION  vs  GET /api/status {fw_version, fw_built, web_version}  +  package.json
        → per-artifact ✓ / ⚠ drift / unknown / unreachable
```

## Error handling

- **Board unreachable** during check → that probe returns `status: "unreachable"`;
  report says "board unreachable — firmware/web unverified"; CLI still prints repo + MCP
  rows and exits non-zero.
- **`version.json` absent** on LittleFS (pre-versioning flash) → firmware reports
  `web_version: "unknown"`; check flags `status: "unknown"` with "pre-versioning upload —
  re-upload LittleFS to start tracking."
- **Malformed `VERSION`** → stamp/bump/check fail loudly with the offending content.
- **`/api/status` missing the new fields** (board on old firmware) → treat as
  `fw_version: "unknown"`, prompting a reflash.

## Testing

- **`version-bump.js`**: unit-test patch/minor/major arithmetic from sample `VERSION`
  strings; assert malformed input throws.
- **`version-stamp.js`**: run against a temp fixture tree, assert `version.h`,
  `version.json`, and `package.json` all contain the expected version.
- **`version-check.js`**: feed mock `/api/status` payloads for match, drift, unknown,
  and unreachable cases; assert the structured report and CLI exit code.
- **Firmware**: hardware-verify `GET /api/status` returns `fw_version`, `fw_built`,
  `web_version` after a stamp + flash + upload (cannot unit-test the `.ino`).
- **MCP**: after `tsc` rebuild + reconnect, `matrix_version` returns a sane report;
  `initialize` reflects the package.json version.

## Documentation

- New short **"Versioning"** section in `CLAUDE.md`: the `VERSION` source, `npm run
  bump:*`, the stamp targets, what `/api/status` now reports, and `npm run check` /
  `matrix_version`. Reinforces that firmware/web only update on flash/upload and MCP on
  rebuild+reconnect.
- Update `mcp_server/` API-surface notes (`/api/status` now includes version fields).

## Out of scope (YAGNI)

- Git-hook auto-bump (explicitly rejected).
- Per-artifact independent SemVers (rejected — single repo version chosen).
- CI enforcement gating on `npm run check` (the script returns a non-zero exit so this
  is *possible* later, but no CI wiring is built now).
- An OTA / self-update path keyed on version (separate future concern).
