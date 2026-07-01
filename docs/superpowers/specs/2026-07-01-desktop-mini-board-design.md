# Desktop mini-board (a draggable board-sized widget)

## The vision (user's words, 2026-07-01)

"A tiny little board-sized web page/frame the user can position right on the desktop
so it mimics the board. The board page right now is massive and doesn't scale well.
Like the little simulator, but in a window on the desktop, preferably a window with a
thin border and no browser chrome. Mini board on the desktop." This was the original
vision for the whole project: an always-present little window of what Claude is doing.

## What to build

A minimal, window-filling **mini board**: just the 8x8 panel (no header, nav, pins, or
about), scaled to fill whatever window holds it, with a thin border and dark
background, that mirrors the same thing `board.html` does. Plus the ways to pop it into
a small desktop window.

## Approach decision: browser app-mode, NOT Electron

The window itself has three plausible implementations:

1. **Electron** gives a truly frameless, always-on-top, draggable window. But it is a
   ~150MB native dependency, needs its own build/packaging per OS, and directly
   violates this repo's stated ethos (no native deps, no bundler, native ES modules).
   Too heavy for the payoff, and not verifiable board-and-eyes-free in one pass.
2. **Browser `--app` mode** (`chrome/msedge --app=<url> --window-size=W,H`) launches a
   URL in a window with no tabs and no address bar, just a thin OS title bar (which
   doubles as the drag handle). Zero new dependencies: it reuses the engine-served page
   and a launch command. `-webkit-app-region: drag` on the page lets you drag the
   window by the board itself.
3. **A `window.open` popup** from `board.html` ("pop out") opens the mini page in a
   small, minimally-chromed browser window you can drag off onto the desktop. Works in
   any browser, no launcher needed.

**Decision: ship 2 + 3 (dependency-free), not 1.** True frameless / always-on-top is a
noted future upgrade (would need Electron or a tiny native shell); the honest MVP that
fits the repo and ships tonight is app-mode + popup. The page is built to look like a
polished widget so app-mode reads as a desktop panel.

## Components

### 1. `studio/mini.html` + `studio/mini.js`

- Full-window square canvas, centered, thin border (`--hair`), dark background, no other
  UI. `-webkit-app-region: drag` so the whole widget drags the window in app-mode.
- Reuses the proven mirror logic verbatim from `studio/board.js` (`framesFromPx`,
  `applyEvent`, `arbitrate`, `mirrorOkAt`, `isEngineResponse`, `framesFromWire`) and the
  shared `Panel` + `FIRMWARE_SIMS` + web-sim renderer. Same detect-engine ->
  mirror (framebuffer poll) / live (SSE `/events`) / ambient precedence as `board.html`,
  trimmed. No pin strip; ambient is the resting floor.
- Reflects state in `document.title` (e.g. "live board", "Claude", "ambient") so the
  app-mode window title is informative without adding on-canvas chrome. A double-click
  toggles a one-line status overlay for debugging.
- `board.html` is NOT refactored (its mirror behavior is hardware-tuned and memory-noted);
  mini.html reuses `board.js`'s pure exports and keeps its own compact wiring. ~50 lines
  of wiring duplication is accepted to avoid regressing the working board page.

### 2. `scripts/mini-lib.mjs` (pure, tested) + `scripts/mini.mjs` (`npm run mini`)

- `mini-lib.mjs`: `findBrowser(platform, env, exists)` -> a Chromium binary path or null
  (win: Chrome/Edge under Program Files + LOCALAPPDATA; mac: Chrome app; linux:
  google-chrome/chromium); `buildAppArgs(url, {width,height,x,y,profileDir})` -> the
  `--app` arg array; `launchMini(opts)` -> detached spawn, or fall back to opening the
  URL in the default browser (start/open/xdg-open) when no Chromium is found.
- `mini.mjs`: resolve the engine URL (`ENGINE_PORT`/default, or the running engine),
  check `/studio/mini.html` is reachable (else tell the user to run `npm run studio`),
  then `launchMini`. Small default window (240x240).

### 3. `board.html` "pop out" control

A small button that `window.open('mini.html', 'mini', 'width=248,height=270,...')` so a
visitor on the Pages/local board page can detach the mini into its own window.

### 4. `matrix_mini` MCP tool

Calls `launchMini` (via `scripts/mini-lib.mjs`) so the user can ask Claude to "put the
mini board on my desktop." Best-effort: returns the mini URL and whether a window was
spawned. The MCP server is a local node process, so a detached child browser is fine.

## Testing / verification

- `mini-lib.test.mjs`: `findBrowser` per platform (injected `exists` + env), `buildAppArgs`
  shape (url, window-size, positioned, isolated profile), fallback selection.
- `mini.html` reuses `board.js` (already unit-tested); no new pure display logic.
- Playwright: load `/studio/mini.html` at 248x248, screenshot -> confirm a rendered board
  fills the window with a thin border and NO header/nav/chrome. With the board live,
  confirm it mirrors the real panel (fire an expression, screenshot, eyeball it).
- Full suite + `npm run check` green.

## Out of scope (future)

Electron/native frameless always-on-top window; multi-window; click-through. Noted, not built.
