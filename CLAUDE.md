# Claude Expression Studio — Project Brief (read me first)

A **renderer-agnostic Claude presence & expression system**. Claude's state (working /
done / waiting / idle / …) renders as 8×8 animations and a semantic presence card,
on whatever output is connected. A physical ESP32-S3 LED panel is **one optional
renderer** — reached only over HTTP — not a dependency.

> **Privacy:** never use the maintainer's real name in code, comments, or docs —
> this repo is public/distributable; refer to "the user" instead.

> **Hardware lives elsewhere.** The ESP32-S3 firmware + its onboard web UI is the
> separate **`peckworks-esp32s3matrix`** repo. This repo talks to a board ONLY via
> the HTTP contract in [`docs/board-api-contract.md`](docs/board-api-contract.md);
> there is no shared code.

---

## What's here

- **`shared/`** — the one render core (pure JS, unit-tested): `expressions.js`
  (char-art → lit pixels), `render.js` (the bloom `Panel`), `firmware-sims.js`
  (15 JS ports of the board's animations), `manifest.json` (the trigger manifest —
  single source of truth: moment → intent → renderer, with fallback chains +
  weighted pools), `resolver.js`, `presence-card.js`, `catalog.js`, `desk-sim.js`.
- **`studio/`** — the Expression Studio web tool: `index.html` (Gallery),
  `editor.html` (binding/pool/weight editor over the manifest), `frame-editor.html`,
  `board.html` (the local-first virtual board — native render + SSE/framebuffer
  mirror), `presence.html` (the presence card + playground).
- **`mcp_server/`** — the MCP server (Claude tools: `matrix_express`, `presence_set`,
  `matrix_idle`, …) **and the engine** (`engine-server.ts`, `startEngineServer`):
  serves `/studio/` + `/shared/`, the manifest API, `GET/POST /api/presence`
  (board-preferred with an in-memory store fallback), the `/api/framebuffer` board
  proxy, and `/events` SSE (the no-board virtual board). `matrix_studio` prints its URL.
- **`claude-hooks/`** — the Python Claude Code hooks that fire presence/expression
  per lifecycle moment (UserPromptSubmit / Stop / PreToolUse / …) via the shared resolver.
- **`site/`** — the public landing/showcase (Pages-deployable).

## How we work

Claude **can** run and verify the studio locally (engine + Studio + hooks; Playwright
for the web surfaces). When a board IS present, confirm board-facing behavior on
hardware before claiming it works. The board is reached only via the documented HTTP
contract.

## Architecture = RESOLVER-ONLY

The MCP server (TS) and the Python hook EACH resolve a moment/intent via the shared
resolver (one brain, parity-tested across TS↔Python), then render with their own HTTP
I/O. `shared/firmware-names.js` decides firmware-animation vs frame-expression path.

## Install / onboarding

`npm run setup` (`scripts/setup.mjs` + pure `scripts/setup-lib.mjs`) — wires the hooks
into `~/.claude/settings.json` + registers the MCP server in `~/.claude.json` (backed-up,
idempotent), deploys the hooks, writes `~/.claude/hooks/matrix_config.json`.
**Board-OPTIONAL** by default; `--board <url>` opts hardware in. `--dry-run`/`--uninstall`.

## Known cross-repo seams (documented, not automated)

Two values are duplicated in the firmware repo and kept in sync by hand — parity can't
be auto-tested across repos:
- **`shared/firmware-sims.js`** — JS reimplementations of the firmware's `anim_*.ino`.
  Adding a firmware animation and wanting it in the web sim/Gallery means a manual JS
  port here.
- **`shared/presence-vocab.js`** — must match the board's copy
  (`esp32_matrix_webserver/data/presence-vocab.js` in `peckworks-esp32s3matrix`) so the
  presence card and the board agree. The old in-repo parity test was removed at the split.

## Versioning

Canonical `VERSION` stamped into `mcp_server/package.json` + `shared/manifest.json` +
the `.mcpb` manifest. `npm run check` flags drift. (Follow-up: `scripts/version-stamp.js`
still references firmware artifacts — trim to studio-only.)

## Deeper material

`docs/superpowers/specs/` (per-feature design) · `docs/superpowers/plans/` (impl plans).
Build: `npm test`, `npm run check:manifest`, `npm run build:mcpb`, `npm run build:pages`.
