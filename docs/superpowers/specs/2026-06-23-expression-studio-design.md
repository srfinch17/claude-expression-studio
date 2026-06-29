# Expression Studio — Platform Design

**Status:** v1 spec (Gallery + Desk Sim). Later rings (Workshop, Console, Hook
Factory) are decomposed below and each gets its own spec when we reach it.

**Date:** 2026-06-23

---

## 1. Vision

Give Claude a tunable, *visible* expression system — and make the whole pipeline
something a person can see, create for, and configure from a browser, **without
touching the board**. The 8×8 LED matrix is the first renderer of that system,
not the only one; the architecture is built so other displays can plug in later
(presence-fabric vision, parked but seam-respected here).

The studio exposes a pipeline that already exists in this repo but is currently
invisible plumbing:

```
   expression  →  pool / category  →  hook event  →  board
   (the frames)   (which rotation)    (when it fires)  (or any renderer)
```

Three concentric rings sit on that pipeline:

- **Gallery + Workshop** — *see and make* (browse the full library; create your
  own, starting from the packaged ones).
- **Console** — *tune* (enable/disable per category; set weights so Claude favors
  some over others — a GUI over `wait-weights.json`, generalized to every pool).
- **Hook Factory** — *wire* (show every Claude Code hook event, let the user
  assign which animation fires for each — a GUI over the `~/.claude/settings.json`
  hooks block, including hook events not currently mapped to anything).

### Why this matters (the reframe)

What began as "fun" turned out to have real **utility**: an ambient awareness
device for working alongside an AI. The `alert`/`ask` states — the silent
shoulder-tap when Claude needs input, the "still grinding, go get coffee" signal
— are the actual value. **The awareness is the product; the fun is the delight
layer.** The pitch leads with utility.

It is also a strong **portfolio / showcase** artifact: a real-time creative tool
with a custom canvas renderer, an unusual domain (giving an AI an emotional
output channel), and a hardware story — and the in-browser desk simulation lets
anyone experience it with zero hardware and zero install.

---

## 2. Platform architecture (decisions that bind every ring)

These were settled during brainstorming and apply to all rings, not just v1.

### 2.1 Two surfaces, one shared core

- **`site/`** — the public **landing page** (marketing/narrative). Hero, pitch,
  install, a *taste* playground, and an **"Open Studio →"** call to action. Job:
  convince and convert. Stays stable and polished.
- **`studio/`** — the **tool** (cockpit). Gallery now; Workshop / Console / Hook
  Factory later. Job: see, make, tune, wire. Churns fast.
- **`shared/`** — the **render core**: the bloom engine + expression-resolve +
  firmware-animation simulations. **Both surfaces import it; neither owns a
  private copy.** This is the keystone — today the bloom renderer is copy-pasted
  (inlined in `site/index.html` and again in a scratch harness), which is the
  same drift trap that bites `dist` vs `.ts` and the live hook copies. One core
  ends that.

### 2.2 The browser constraint → progressive enhancement

A browser can do HTTP freely but **cannot read/write local files**. That single
fact splits behavior cleanly:

- **Public (GitHub Pages, no install):** view the gallery, design an expression
  and **download** its JSON, and **tune the board directly** over HTTP
  (`esp32matrix.local` — brightness, idle apps, etc.). No backend needed.
- **Local ("Open Studio" running):** the *same app*, but a small local helper
  gives it hands — read/write `expressions/*.json`, `wait-weights.json`, the
  `bored_animations/` folder, and the `~/.claude/settings.json` hooks block.
  This is the full control panel.

Casual users never need the helper (admire + design+download + board-tune all
work install-free). Power-user capability (writing config, rewiring hooks) is
**opt-in**. Easy is preserved.

### 2.3 The local helper: bundled Node studio server

- **Language: TypeScript on Node** — the same runtime the MCP server already uses
  and that Claude Desktop already provides. No new runtime = no new install. It
  ships as **another compiled entry point in the existing `mcp_server/` package**
  ("Open Studio" = `node dist/studio.js`, starts a local HTTP server, opens the
  browser). It can `import` existing MCP code (the `wait.ts` picker, expression
  types, the board client) — one source of truth.
- **Dependency-light constraint:** built-in `http`/`fs`, **no native modules**.
  We just dropped `@napi-rs/canvas` to keep the `.mcpb` clean and cross-platform;
  the studio server must not reintroduce native deps.
- The Python hooks (`matrix_signal.py`, `matrix_idle.py`) **stay Python** — tiny
  fire-and-forget scripts, the right tool for that job. The studio server edits
  *their config* (JSON files / a folder), which needs no Python.

> **v1 does not need the studio server at all** (the Gallery is view-only). The
> server arrives in v2 (Workshop), when we first need to *write* a file.

### 2.4 Device-agnostic seam (designed-for, not built)

The shared core models rendering as **frames → a render target**, with a single
implementation today: the 8×8 bloom canvas. We keep that boundary clean so a
second renderer (a larger matrix, an RGB strip, an on-screen widget, another
person's board) can be added later — but we **do not build the abstraction until
a second renderer earns it** (per the display-emote north-star discipline). One
clean class now; generalize when there is a real second target.

---

## 3. Roadmap (decomposition)

Each ring is its own spec → plan → build. Each ships something real alone.

| Ver | Ring | Delivers | Needs server? |
|---|---|---|---|
| **v1** | **Gallery + Desk Sim** | The "wow": whole library, live bloom, desk companion. **This spec.** | No (static) |
| v2 | Workshop | Create/edit frames; save-to-disk locally / download on Pages. | Yes (write files) |
| v3 | Console | On/off + weights per category (generalized `wait-weights.json`). | Yes |
| v4 | Hook Factory | Full hook map; assign animations to events; write the hooks block. | Yes |

---

## 4. v1 scope — Gallery + Desk Sim

The first thing we fully build. **View-only, fully static, zero backend** — the
fastest path to a stunning, honest demo. Foundation: extract the shared core.

### 4.1 In scope

1. **Shared render core (`shared/`)** — extract the bloom `Panel`/renderer,
   expression-resolve (char-art → pixels), and the per-frame glow-bleed from the
   existing `site/index.html` and the scratch harness into one ES-module core
   that both surfaces import. Structured as `frames → render target`, one canvas
   impl. No bundler in v1 — native ES modules.
2. **Studio Gallery screen (`studio/`)** — the entire current library, animated
   with real bloom, **grouped by the rotation that owns it** (orphans flagged,
   wait pool, ask, bored), plus the ported firmware animations. Reads the real
   expression data (see 4.4). This productionizes the scratch harness.
3. **Desk Sim component** — the floating "on your desk" companion (live mascot
   panel, the signature element). A first-class shared component used as the
   landing's hero/companion **and** as the studio's live preview.
4. **`site/` refactor** — replace the inlined renderer with imports from
   `shared/`; keep the taste-playground; add the **"Open Studio →"** CTA.
5. **Firmware-animation simulations** — port to JS generators **in the shared
   core** (copy, never modify firmware). **All eight:** the Claude-status pair
   **`claudesweep`** (CRT/radar border sweep + resident mascot) and the
   **`working` snake**, plus the full screensaver suite **`fire`, `matrix_rain`,
   `fireworks`, `frostbite`, `snow`, `dancefloor`**. Each is a faithful
   `(t) → pixels` generator validated by eye against the board. These prove the
   renderer does generative content, not just baked frames, and make the Gallery
   dazzle. Each port is a discrete task in the plan; source of truth is the
   matching `esp32_matrix_webserver/anim_*.ino` (read-only — never modified).

### 4.2 Explicitly deferred (NOT in v1)

- The Node **studio server** and **any file writing** → v2.
- **Workshop / Console / Hook Factory** → v2/v3/v4.
- Any change to firmware, MCP tools, or Python hooks. v1 is web-only.

### 4.3 Components (files)

```
shared/
  render.js        # bloom Panel/renderer: frames→canvas, halo+hot-core, glow bleed
  expressions.js   # char-art → pixel resolve; load/normalize an expression JSON
  firmware-sims.js # JS generators: claudesweep, working-snake (ported, not moved)
  catalog.js       # the rotation map (which expression belongs to which pool) +
                   # orphan flags — the audit result, data-driven
site/
  index.html       # landing — refactored to import ../shared/*, + "Open Studio" CTA
studio/
  index.html       # the Gallery screen — imports ../shared/*
  gallery.js       # builds the grouped grid, wires panels to the render loop
(build/data)
  scripts/build-gallery-data.mjs # copies/condenses expressions into a static
                   # manifest the Gallery can fetch on Pages (see 4.4)
```

Delete the scratch `site/_preview-library.html` once the real Gallery exists.

### 4.4 Data flow

- The canonical expressions live in `mcp_server/expressions/*.json`. On Pages
  there is no access to that folder, so a small build step copies them (or emits
  a single manifest `studio/expressions.json`) into the published studio assets.
  The Gallery fetches that manifest. Locally the same fetch works.
- The **rotation/orphan mapping** (`catalog.js`) is data: each expression name →
  its owning pool (wait / ask / bored / firmware) or `orphan`. Generated from the
  real wiring where possible (wait = `wait-*` + weights file; bored =
  `bored_animations/` listing; ask = `ask-*`) so it stays honest, with a checked
  fallback list.
- Firmware sims are pure functions `(t) → pixels`, driven by the same render
  loop as frame expressions.

### 4.5 Rendering (the engine, ported verbatim)

The bloom look is the product's signature and must not regress: substrate +
unlit dots; lit pixels drawn additively (`'lighter'`) as a radial halo + a hot
core (channel +90 clamp); per-frame average lit color pushed to a CSS `--glow`
var so the panel's light bleeds onto the page. Respects
`prefers-reduced-motion` (static resting frame, no loop). This is lifted
unchanged from `site/index.html` into `shared/render.js`.

### 4.6 Error handling

- A malformed/missing expression JSON renders an in-cell error chip and is
  skipped — never crashes the grid (the scratch harness already does this).
- A firmware sim that throws is caught per-panel; the cell shows an error chip.
- Missing manifest → the Gallery shows a clear empty-state with the fetch path,
  not a blank page.

### 4.7 Testing

- **Pure logic is unit-tested** (Node, no DOM): `expressions.js` char-art→pixel
  resolve (known art → known pixel set); `catalog.js` mapping (every
  `mcp_server/expressions/*.json` resolves to exactly one group; the orphan set
  equals `{claude-idle, idea}` given current wiring — a regression guard that
  fails loudly when an expression is added without being wired).
- **Render code is smoke-tested** via Playwright: load `studio/index.html`,
  assert zero console errors, assert N canvases present and non-blank (sample a
  lit pixel), screenshot for visual diff.
- The firmware sims get a frame-shape test (returns pixels in-bounds for a
  sweep of `t`); exact visual fidelity is validated by eye against the board.

---

## 5. Success criteria (v1 "done")

1. Opening `studio/index.html` shows **every** current expression animating with
   the real bloom, grouped by rotation, orphans visibly flagged — fully static,
   no server.
2. All eight firmware animations (`claudesweep`, `working` snake, `fire`,
   `matrix_rain`, `fireworks`, `frostbite`, `snow`, `dancefloor`) animate in the
   browser as faithful simulations.
3. The **desk companion** is a polished, shared component present on both
   surfaces.
4. `site/` and `studio/` both import **one** render core — grep shows no second
   copy of the bloom code.
5. The orphan regression test passes and would fail if a new expression were
   added without wiring.
6. Nothing in `esp32_matrix_webserver/`, `mcp_server/` tools, or `claude-hooks/`
   changed (web-only).

---

## 6. Out of scope / non-goals (v1)

- No authoring, saving, weighting, or hook-wiring (later rings).
- No firmware/MCP/hook changes.
- No bundler/framework — native ES modules and plain Node tooling.
- No second renderer implementation (seam only).

---

## 7. Risks

- **Render drift** if the core isn't truly shared → mitigated by success
  criterion #4 (single-copy grep) and importing, not copying.
- **Pages data availability** — the Gallery needs expression data deployed;
  handled by the manifest build step (4.4).
- **Firmware-sim fidelity** — a JS port can diverge from the C++ original;
  accepted as *simulation*, validated by eye, scoped to 2 anims in v1.

---

## 8. Resolved scope decisions

**Firmware-animation ports in v1 (resolved 2026-06-23):** **all eight** ported —
`claudesweep` + `working` snake + the screensaver suite (`fire`, `matrix_rain`,
`fireworks`, `frostbite`, `snow`, `dancefloor`). The user chose the dazzling-
Gallery option; each port is a discrete plan task validated by eye.
