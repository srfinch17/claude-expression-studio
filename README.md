# Claude Expression Studio

[![Live demo](https://img.shields.io/badge/live_demo-online-ff5008?style=flat-square&logo=github)](https://srfinch17.github.io/claude-expression-studio/)

A **renderer-agnostic presence & expression system for Claude**. Claude's state —
working, done, waiting on you, idle — renders as 8×8 LED animations and a semantic
presence card, on whatever output is connected. The physical LED panel is **one
optional renderer**; everything runs board-free in the browser too.

**Live demo (no install, no hardware):** https://srfinch17.github.io/claude-expression-studio/

## What it is

- **The Studio** (`studio/`) — see, edit, and wire Claude's whole animation library:
  a Gallery, a binding/pool/weight editor over the trigger manifest, a frame painter,
  a live virtual board, and the presence card.
- **The trigger manifest** (`shared/manifest.json`) — one source of truth mapping
  *moment → intent → renderer*, with fallback chains and weighted pools. The MCP server
  and the Claude Code hooks both resolve through it (parity-tested TS ↔ Python).
- **The MCP server + engine** (`mcp_server/`) — Claude's tools (`matrix_express`,
  `presence_set`, `matrix_idle`, …) plus a localhost engine that serves the Studio,
  holds presence, and broadcasts a no-board virtual board over SSE.
- **The Claude Code hooks** (`claude-hooks/`) — fire ambient presence/expression per
  lifecycle moment (prompt submitted, task done, awaiting input, idle).

## Install (Claude Code, board optional)

```bash
npm run setup            # wires hooks + registers the MCP server (backed-up, idempotent)
npm run setup -- --board http://esp32matrix.local   # opt a physical board in
npm run setup -- --dry-run        # preview    ·    --uninstall   # reverse
```

Board-optional by default. The board is reached only over HTTP — see
[`docs/board-api-contract.md`](docs/board-api-contract.md).

## Hardware

The ESP32-S3 firmware + its standalone onboard web UI live in a separate repo:
**[peckworks-esp32s3matrix](https://github.com/srfinch17/peckworks-esp32s3matrix)**
(flash it, set up WiFi via a captive portal, runs with no computer attached).

## Develop

```bash
npm test                 # node --test across shared/ studio/ mcp_server/ scripts/ + manifest check
npm run check:manifest   # validate the trigger manifest
npm run build:pages      # assemble the read-only Pages bundle
npm run build:mcpb       # pack the Claude Desktop extension
python -m http.server 8766   # then open /studio/index.html and /site/index.html
```

Design specs: `docs/superpowers/specs/` · plans: `docs/superpowers/plans/`.
