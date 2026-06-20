# Logo Identity — Header Card + Animated Wait Pool — Design Spec

**Date:** 2026-06-20
**Status:** Approved for planning
**Author:** the user + Claude (brainstorm)

## Summary

Promote the index favicon (a 5-dot quincunx that reads as a mini LED panel) into
the board's **logo**, and put that logo to work in two places:

- **A. A shared header card** (`header.js`, `data-auto`) injected at the top of
  every board control page — replacing the green text title on the index — so the
  whole web UI carries one consistent identity.
- **B. Four animated-logo wait variants** (`wait-logo-breathe`, `wait-logo-chase`,
  `wait-logo-boot`, `wait-logo-ripple`), built as saved frame-expressions that
  auto-join the busy/wait pool.

Web + expression-data only. No firmware change. No MCP code change (the wait pool
discovers `wait-*` expressions by convention at runtime).

## Motivation

The favicon (added in PR #14) is a strong little mark and the user loves it. Right
now it lives only in the browser tab; the index still leads with plain green text
(`<h1>ESP32-S3 Matrix</h1>`) and the sub-pages have no shared identity at all.
Promoting the mark to a logo and giving every page a consistent header card makes
the UI feel like one product — important because this project is meant to ship to
end users. Separately, the logo is a natural thing to animate on the actual 8×8,
giving the busy/wait indicator more variety (the user's top-priority "expression
window" direction).

## The logo motif (canonical)

A **quincunx** — the "5"-on-a-die / X pattern — on a dark rounded tile:

| Position | Color |
|---|---|
| top-left | green `#00ff88` |
| top-right | amber `#ffb000` |
| center | cyan `#22ddff` |
| bottom-left | amber `#ffb000` |
| bottom-right | green `#00ff88` |

This matches the existing favicon exactly (decoded from the index data-URI). It is
the single source of the brand's geometry; both the header logo and the 8×8
animations render this same five-dot arrangement.

---

## Workstream A — Logo & header card (web-only)

### A1. The logo SVG (richer sibling of the favicon)

The 16px favicon is deliberately sparse. The **header logo** is a richer version of
the same motif, authored for ~44px:

- A dark rounded tile (`#0d0d0d`, rounded corners) sized to render crisp at ~44px.
- The **5 quincunx dots** in the palette above.
- A **faint ghosted dot-grid** behind the lit dots (very low-opacity dots filling a
  loose grid) to evoke an unlit LED panel — present but subtle, must not compete
  with the 5 lit dots.
- **Dead static.** No CSS animation on the header logo (user decision). The logo is
  identity, not motion.

The logo SVG is authored **inline inside `header.js`** as a markup string (no extra
LittleFS asset to upload, same spirit as the inline-SVG favicon). The favicon in
`index.html` is **left unchanged** (it's tuned for 16px).

### A2. `header.js` — the shared, drop-in header component

Mirrors the established `bright.js` pattern (`<script src="x.js" data-auto>` →
self-mounting component). One file, included once per page:

- Included on each page via `<script src="header.js" data-auto></script>`.
- On load it **injects its own `<style>`** (so no page needs new CSS) **and prepends
  a header card** as the first child of the page's `.wrap` container. If `.wrap` is
  absent, fall back to prepending to `<body>`.
- The header card:
  - A bordered card matching the existing card chrome (`background:#161616`,
    `border:1px solid #2a2a2a`, `border-radius:12px`) so it sits in the UI's visual
    language.
  - Left: the **logo SVG** at ~44px, wrapped in `<a href="/">` so it doubles as a
    home button.
  - Right: the **name** "ESP32-S3 Matrix" (in the green accent `#00ff88`, ~1.5rem)
    over a muted **subtitle** "Web control panel".
  - Responsive: logo + text in a row; wraps gracefully on narrow screens.
- The script is **idempotent** — if a header card already exists it does not inject
  a second one.

### A3. Per-page wiring

- Add `<script src="header.js" data-auto></script>` to all **21 board control
  pages** (see Touch list). The script tag goes near the other shared-asset script
  tags (e.g. alongside `bright.js` where present), or before `</body>`.
- **`index.html` only:** remove the now-redundant green `<header><h1>…</h1>
  <p class="subtitle">…</p></header>` block — the injected card carries the name.
  (The injected card replaces it.)
- **Sub-pages:** keep their existing `← Home` `.back` link and their own colored
  page-title `<h1>`. The injected logo card sits **above** them. Rationale: the logo
  is product identity; the per-page back-link + title remain the page's local
  navigation/wayfinding. (So a sub-page reads: `[logo card]` → `← Home` →
  `Fire` h1 → controls.)
- **Excluded:** `presence-card.html` — that is the separate **desktop** presence
  card with its own visual design, not a board control page. It does not get the
  header.

### A4. Deploy (workstream A)

**LittleFS upload only.** No firmware flash, no MCP reconnect. New file
`data/header.js`; edited `data/*.html` (21 pages, all gain the script tag; index
additionally loses its old header block).

---

## Workstream B — Four animated-logo wait variants

### B1. Tier — saved frame-expressions (zero firmware, zero rebuild)

All four are built as **saved frame-expressions**, exactly like `wait-claude`:
authored live with `matrix_animate`, then `save_as: "wait-logo-<name>"`. Because the
wait pool discovers `wait-*` expressions by convention at runtime
(`mcp_server/wait.ts` + `claude-hooks/matrix_signal.py`), each one **auto-joins the
pool the instant it is saved** — no MCP code change, no rebuild, no reconnect, no
firmware. The save writes a JSON file under the MCP server's `expressions/`
directory (e.g. `expressions/wait-logo-breathe.json`), the same place
`wait-rainbow.json` etc. live.

The logo is only 5 sparse blocks, so every frame lights ≤20 pixels — featherweight,
well clear of the heavy-24-frame heap bug (see `bug_frames_heap_crash` memory). Each
expression is ≤24 frames.

### B2. Canonical 8×8 logo geometry (shared by all four)

All four animate the **same** five **2×2 blocks** on the 8×8 (chunky, balanced,
clearly the logo):

| Block | Pixels (x,y) | Color |
|---|---|---|
| top-left | (0,0)(1,0)(0,1)(1,1) | green `#00ff88` |
| top-right | (6,0)(7,0)(6,1)(7,1) | amber `#ffb000` |
| center | (3,3)(4,3)(3,4)(4,4) | cyan `#22ddff` |
| bottom-left | (0,6)(1,6)(0,7)(1,7) | amber `#ffb000` |
| bottom-right | (6,6)(7,6)(6,7)(7,7) | green `#00ff88` |

(`XY(x,y)=y*8+x`, row-major, origin top-left — the board's convention.)

### B3. The four behaviors

- **`wait-logo-breathe` (calm).** All 5 blocks fade together from dim → full → dim,
  in their logo colors, looping. A steady heartbeat. ~14–18 frames.
- **`wait-logo-chase` (lively).** All 5 blocks sit at a dim baseline; a **brightness
  highlight travels the four corners clockwise** (TL→TR→BR→BL→…), one corner bright
  per step, while the **cyan center gently pulses**. Reads as "computing." ~12–16
  frames.
- **`wait-logo-boot` (techy).** Starting from blank, blocks light **one-by-one
  clockwise** (TL→TR→BR→BL→center), **hold the full logo** a beat, then clear and
  restart — a power-up sequence. ~12–16 frames.
- **`wait-logo-ripple` (sonar).** The cyan **center lights bright**, then dims as the
  **four corners light and fade outward** — an expanding pulse radiating from the
  core, looping. ~12–16 frames.

### B4. Brightness & verification

- Authored/verified at the **ambient brightness-5 floor** (the wait/idle indicator
  brightness), which double-scales with any per-frame dimming — dim baseline colors
  must keep their weakest channel above the visibility threshold or they vanish at
  bri 5 (see `feedback_led_brightness_formula` / the brightness-5 floor note).
- Each must pass the **silhouette test** on the real panel (a human sees "the logo,
  animating") before it's called done.
- Verify pixels via `GET /api/display/framebuffer` (pre-global-scaling) **and** the
  user's eyes at bri 5.
- **Restore board brightness + prior display after testing** (don't leave it bright
  or stuck on a test frame — see `feedback_restore_board_after_testing`).

### B5. Weighting (`mcp_server/wait-weights.json`)

The pool grows from 5 → 9 entries. Keep **`wait-claude` the dominant single
favorite**: give each logo variant a **modest weight of 10**, leaving the favorite
clearly on top.

Current: `{ wait-claude:40, wait-rainbow:30, wait-orbit:20, claudesweep:20,
working:10 }`.
After (additive — existing weights untouched):
`{ wait-claude:40, wait-rainbow:30, wait-orbit:20, claudesweep:20, working:10,
wait-logo-breathe:10, wait-logo-chase:10, wait-logo-boot:10, wait-logo-ripple:10 }`.

This keeps `wait-claude` (40) the single largest entry; the four logo variants are
10 each (≈6% apiece). Pure runtime-read file — retune anytime with no rebuild.

### B6. Deploy (workstream B)

The four `expressions/wait-logo-*.json` files are created on the host by `save_as`
during live authoring; `wait-weights.json` is hand-edited. The wait pool reads both
at runtime, so **no rebuild and no reconnect are required** for the animations to
join. (A `/mcp` reconnect is harmless but unnecessary.)

---

## Versioning

Real user-visible feature → bump **minor: 0.7.0 → 0.8.0** (`npm run bump:minor`),
stamping `data/version.json` (web) and `mcp_server/package.json` (MCP). **No firmware
artifact changes**, so `version.h` is re-stamped but the firmware need not be
reflashed for this feature (its `fw_version` only goes live on the next flash — note
this so `matrix_version` drift is understood, not chased). Redeploy the web bundle
(LittleFS) to make `web_version` live.

## Non-Goals

- No firmware changes (no new `anim_*.ino`, no API changes). The animations are
  data, not code.
- No MCP code changes (pool auto-discovery + runtime weights cover both the MCP path
  and the prompt hook).
- The header logo does **not** animate in the browser (dead-static, by decision).
- `presence-card.html` (desktop card) is untouched.
- No change to the favicon itself.
- No change to the wait-pool picking logic, the idle screensaver, or settings.

## Touch list

**Workstream A (web):**
- `data/header.js` — **new**: inline logo SVG + injected `<style>` + header-card
  injector (`data-auto`, idempotent, prepends to `.wrap`).
- `data/index.html` — add the `header.js` script tag; **remove** the old green
  `<header>` block.
- These 20 sub-pages — add the `header.js` script tag only: `animations.html`,
  `system.html`, `settings.html`, `claudesweep.html`, `fire.html`, `liquid.html`,
  `matrix_rain.html`, `snow.html`, `sketch.html`, `emoji.html`, `text.html`,
  `weather.html`, `weather2.html`, `timer.html`, `clock.html`, `calendar.html`,
  `sound.html`, `grid_test.html`, `temp.html`, `imu.html`.
- **Not touched:** `presence-card.html`.

**Workstream B (expression data + weights):**
- `expressions/wait-logo-breathe.json` — **new** (via `save_as`).
- `expressions/wait-logo-chase.json` — **new** (via `save_as`).
- `expressions/wait-logo-boot.json` — **new** (via `save_as`).
- `expressions/wait-logo-ripple.json` — **new** (via `save_as`).
- `mcp_server/wait-weights.json` — add the four entries at weight 10.

**Versioning:**
- `VERSION`, `data/version.json`, `mcp_server/package.json`, `version.h` — stamped by
  `npm run bump:minor`.

## Testing / Verification

- **Header (user, after LittleFS upload):** every control page shows the identical
  logo header card at the top; the index no longer shows the old green text title;
  the logo links home; sub-pages still show their `← Home` + page title beneath the
  card; nothing overlaps or breaks layout on desktop or narrow widths;
  `presence-card.html` is unchanged.
- **Header (controller, HTTP):** each page serves HTTP 200 and references
  `header.js`; `header.js` serves 200.
- **Animations (controller + user):** each `wait-logo-*` plays correctly (framebuffer
  check) and reads as the animated logo at brightness 5 (user's eyes); each is in the
  pool (`matrix_express("wait")` can land on it; force by name to verify); weights
  applied. Restore board state after.
- **Drift:** `matrix_version` reflects 0.8.0 for web + MCP; firmware shows the older
  build until next flash (expected — call it out, don't chase it).

## Open / deferred

- Whether to later extend the header card to `presence-card.html` too (default: no —
  different surface).
- Whether the favicon should eventually be regenerated from the same source as the
  logo SVG (default: no — favicon stays hand-tuned for 16px).
