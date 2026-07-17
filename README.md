# Claude Expression Studio

[![Live demo](https://img.shields.io/badge/live_demo-online-ff5008?style=flat-square&logo=github)](https://srfinch17.github.io/claude-expression-studio/)

A **renderer-agnostic presence & expression system for Claude**. Claude's state (working, done, waiting on you, idle) renders as 8×8 LED animations and a semantic presence card, on whatever output is connected. The physical LED panel is **one optional renderer**; everything runs board-free in the browser too.

**Live demo (no install, no hardware):** https://srfinch17.github.io/claude-expression-studio/

## What it is

- **The Studio** (`studio/`): see, edit, and wire Claude's whole animation library. A Gallery, a binding/pool/weight editor over the trigger manifest, a frame painter, a live virtual board, and the presence card.
- **The trigger manifest** (`shared/manifest.json`): one source of truth mapping *moment → intent → renderer*, with fallback chains and weighted pools. The MCP server and the Claude Code hooks both resolve through it (parity-tested TS ↔ Python).
- **The MCP server + engine** (`mcp_server/`): Claude's tools (`matrix_express`, `presence_set`, `matrix_idle`, `matrix_pin`, …) plus a localhost engine that serves the Studio, holds presence, and broadcasts a no-board virtual board over SSE.
- **The Claude Code hooks** (`claude-hooks/`): fire ambient presence/expression per lifecycle moment (prompt submitted, task done, awaiting input, idle).

## How it fits together (one MCP server, board optional)

There is exactly **one** MCP server in this whole system, and it lives here in
`mcp_server/`. It registers under the name **`expression-studio`** and does two jobs in
one process: it exposes Claude's tools over MCP, and it runs a localhost **engine**
(HTTP, port 8787) that serves the Studio web app and the virtual board.

The physical LED panel is just a renderer at the far end of an HTTP contract. It runs
its own firmware (separate repo) but has **no MCP server of its own** and never needs
one; boards don't talk MCP, computers do.

```text
   Claude (Code or Desktop)          Claude Code lifecycle hooks
            |                             (claude-hooks/)
        MCP: stdio                             |
            v                                  |  HTTP: POST presence/express
  +---------------------------+                |
  |  expression-studio MCP    | <--------------+
  |  server + engine          |
  |  (mcp_server/, one        | --serves--> the Studio web app + virtual
  |   process, HTTP :8787)    |             board + mini board (SSE, no
  +---------------------------+             hardware needed)
            |
       HTTP (optional): docs/board-api-contract.md
            v
   physical ESP32-S3 8x8 panel
   (firmware repo: peckworks-esp32s3matrix)
```

So an installer needs exactly one thing: this repo's setup. With no board on the
network, expressions and presence render on the virtual board in the browser. Adding a
physical board later changes nothing structural; the same tools start mirroring to it
over HTTP.

## Install (Claude Code, board optional)

```bash
npm run setup            # wires hooks + registers the MCP server (backed-up, idempotent)
npm run setup -- --board http://esp32matrix.local   # opt a physical board in
npm run setup -- --dry-run        # preview    ·    --uninstall   # reverse
```

Board-optional by default. The board is reached only over HTTP. See
[`docs/board-api-contract.md`](docs/board-api-contract.md).

> Upgrading from an older install? The server used to register as `esp32-matrix`.
> Re-run `npm run setup` and it migrates: the old entry is removed, the new
> `expression-studio` one is written.

## Run the Studio (edit and wire in your browser)

The Studio is a local web app and runs fully **without a board**, no hardware required. Build the engine once, then run it:

```bash
cd mcp_server && npm install && npx tsc && cd ..   # one-time: build the engine
npm run studio                                     # serves the Studio at http://127.0.0.1:8787
```

Then open in your browser:

- **Editor** `http://127.0.0.1:8787/studio/editor.html`, bind and reweight which animation fires on which intent (Save writes back to `shared/manifest.json`).
- **Gallery** `http://127.0.0.1:8787/studio/index.html`, browse and approve the animation library.
- **Frame editor**, opened from the edit links on saved tiles, to paint an 8×8 expression.
- **Board** `http://127.0.0.1:8787/studio/board.html`, a live mirror of the panel (or a no-board virtual one).

With no board connected, the Board page shows a virtual panel of whatever intents fire, so you can build and wire the whole library board-free. To point it at a physical board instead: `ESP32_URL=http://<board-ip> npm run studio`.

**Pin an animation to hold it.** Normally the ambient rotation and the "done" check keep cycling the panel. To park one animation up instead, click it in the Board page's *pin an animation* strip; the rotation holds off until you hit *resume*. Claude can do the same mid-conversation: `matrix_pin` holds whatever is currently on the board (optionally for N seconds) so the lifecycle hooks stop clobbering a loop you asked for, and `matrix_unpin` releases it. Your own `matrix_*` calls always win, and the `.matrix_off` kill switch still overrides a pin.

### Mini board (a little widget on your desktop)

Want a tiny, always-there window of what Claude is doing? The mini board is a
board-sized, chromeless widget you can drag anywhere on your desktop. It mirrors the
live panel when a board is connected, and plays the animation library when none is.
Three ways to open it:

```bash
npm run mini                 # a small chromeless Chrome/Edge window (drag it onto your desktop)
```

- **Pop out** from the Board page: the `⧉ pop out mini board` button opens it as a small window in any browser.
- **Ask Claude** (once installed): "put the mini board on my desktop" runs the `matrix_mini` tool.

Runs board-free too. Double-click the widget to peek at what it is mirroring.

**Installed into Claude Code?** After `npm run setup` you don't need to remember any
of this: just ask Claude (e.g. "open the Expression Studio" or "put a mini board on my
desktop") and it runs the `matrix_studio` / `matrix_mini` tool for you. The MCP server
starts the engine.

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
npm run export:frames    # bake the animation library into .cfr frame files (docs/frames-file-format.md)
python -m http.server 8766   # view-only static preview (no Save; use `npm run studio` to edit)
```

Design specs: `docs/superpowers/specs/` · plans: `docs/superpowers/plans/`.
