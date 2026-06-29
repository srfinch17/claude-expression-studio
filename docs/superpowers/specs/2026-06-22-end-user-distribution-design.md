# End-User Distribution — Installable Firmware + MCP (the real 1.0.0)

**Status:** approved design (2026-06-22)
**Supersedes the premature 1.0.0:** the project shipped a "1.0.0" / "1.1.0" that
**no non-developer could actually install** — the MCP server required hand-editing
`claude_desktop_config.json` with absolute paths + a Node install, and the firmware
required the full Arduino IDE dance (4 libraries, ~8 board settings, *two* separate
upload steps). This design makes the project genuinely installable by a human who is
not a developer, and reframes the version number to tell the truth about that.

## Goals

1. **End user flashes firmware without dev tools** — no Arduino IDE, no libraries, no
   board-settings, no separate LittleFS upload. One artifact, one action.
2. **End user installs the MCP server without editing JSON** — a double-click
   Claude Desktop extension (`.mcpb`).
3. **One URL = full setup** — flash the board *and* grab the Claude Desktop extension
   from a single page.
4. **The version number tells the truth** — `1.0.0` = "any human can install this."

## Non-goals (explicitly deferred)

- **Multi-board registry / Presence Fabric v2** — still a v2 problem (parked).
- **Hosting/signing a code-signed installer** — `.mcpb` + web-flasher is enough;
  no notarization/codesign work.
- **Replacing the developer loop** — the maintainer still builds the `.bin` in the
  Arduino IDE (Claude cannot compile/flash). This design wraps *distribution* around
  that, it does not automate compilation.

---

## 1. Version strategy

- One-time **backward** rewrite of the canonical `/VERSION`: `1.1.0` → **`0.12.0`**
  (active development, not-yet-shippable). Continues the pre-1.0 `0.x` line past the
  old `0.9.0`.
- The **first build a non-developer can install** is crowned **`1.0.0`**.
- Mechanics: `npm run bump:*` only ratchets upward, so this is a manual `VERSION`
  edit followed by `npm run stamp` (re-stamps firmware `version.h`, web
  `data/version.json`, and `mcp_server/package.json`). `npm run check` /
  `matrix_version` must report **zero drift** afterward.
- The new `mcp_server/manifest.json` (see §5) becomes a **fourth** stamped artifact;
  `version-stamp.js` must learn to write its `version` field too.

---

## 2. The merged binary (the artifact everything consumes)

A single factory image — `esp32matrix-<version>-merged.bin` — containing **all** flash
regions so a flash-at-`0x0` fully provisions the board, including the web UI:

| Region | Source | Offset (ESP32-S3, Huge APP) |
|---|---|---|
| Bootloader | Arduino build output (`*.ino.bootloader.bin`) | `0x0` |
| Partition table | Arduino build output (`*.ino.partitions.bin`) | `0x8000` |
| `boot_app0` | ESP32 core (`boot_app0.bin`) | `0xe000` |
| Application | Arduino build output (`*.ino.bin`) | `0x10000` |
| LittleFS (web UI) | built from `data/` via `mklittlefs` | SPIFFS offset from the partition CSV (`huge_app.csv`) |

> **Offset discipline:** the SPIFFS/LittleFS offset and size are **read from the
> partition CSV / `esptool` image info**, never hardcoded in my head, because the
> Huge-APP layout is the single source of truth and getting the LittleFS offset wrong
> silently corrupts the web UI. The build script derives offsets, it does not assume
> them.

This kills the **two-step upload** (Sketch upload + LittleFS upload) that trips up
even developers — there is exactly one file to flash.

---

## 3. `scripts/build-release.mjs` (maintainer-run, because Claude can't compile)

The maintainer does the Arduino bits they already do — **Sketch → Export Compiled
Binary** (produces the bootloader/partitions/app `.bin`s in the sketch `build/`
folder) — then runs `node scripts/build-release.mjs`, which:

1. **Locates toolchain** — finds the ESP32 Arduino core's bundled `mklittlefs` and
   `esptool` (they ship with the installed platform). Fallback: `esptool` via
   `pip`/`python -m esptool`. Hard-fails with a clear message if neither is found.
2. **Builds the LittleFS image** from `esp32_matrix_webserver/data/` at the size
   declared by the partition CSV.
3. **Merges** bootloader + partitions + `boot_app0` + app + LittleFS via
   `esptool --chip esp32s3 merge_bin` into
   `release/esp32matrix-<version>-merged.bin`.
4. **Emits the ESP Web Tools manifest** (`release/manifest.json`) referencing that
   merged `.bin` at `0x0`, stamped with `<version>` from `/VERSION`.
5. **Copies the built `.mcpb`** (from §5) into `release/`.
6. Prints a checklist of what to upload to the GitHub Release / Pages.

Output: a self-contained `release/` folder = merged firmware + manifest + flash
scripts + `.mcpb`.

> **⚠ Primary implementation risk = toolchain discovery.** `mklittlefs`/`esptool`
> live in version-stamped paths under the user's Arduino15 packages dir. The script
> must search robustly (glob the packages dir, honor an env override
> `ESP32_TOOLS_DIR`, fall back to `pip esptool`) and fail loud, not silent. This is
> the part to harden + test first during implementation.

---

## 4. Two install front-doors, one page

A single static **`install/index.html`** (publishable to GitHub Pages, or opened
locally from the release folder):

- **Browser flasher (primary)** — ESP Web Tools `<esp-web-install-button>` pointed at
  `manifest.json`. End user: plug in board → Connect → Install (~30s). No tools, no
  terminal. Chrome/Edge (WebSerial).
- **Manual flasher (fallback)** — download the merged `.bin` + a double-click
  `flash.bat` (Windows) / `flash.sh` (macOS/Linux) that invokes a **bundled standalone
  `esptool`**. Covers Firefox, locked-down machines, and offline installs. No Python
  required by the end user (standalone `esptool` binaries bundled per-OS).
- **Claude Desktop extension** — the same page links the `.mcpb` download with a
  one-line "double-click to install into Claude Desktop."

So one URL provisions **both** halves: firmware + Claude integration.

### Deployment is phased (repo is public)
The install page is **built and committed in this pass** so both methods exist in the
repo. But the **shippable path for the first `1.0.0` release is the offline `flash`
script + merged `.bin`** (zero hosting, works today). Turning on **GitHub Pages** to
make the browser one-click link live is a deferred, trivial follow-up — the page
already exists, so it's just enabling the Pages setting and pointing it at the
`install/` folder. No code changes needed when that day comes. The repo being public
means Pages will be free when enabled.

---

## 5. MCP distribution → `.mcpb`

The Model Context Protocol **Bundle** (`.mcpb`, formerly `.dxt`): a zip of the server
+ its `node_modules`; Claude Desktop ships its own Node runtime, so the end user needs
**no Node install and edits no JSON** — they double-click the `.mcpb`.

- **Remove the only native dependency.** `@napi-rs/canvas` (native binary, used solely
  by the emoji rasterizer at `index.ts:275`) is deleted along with `emojiToMatrix` and
  the `matrix_show_emoji` tool (see §6). Remaining runtime dep:
  `@modelcontextprotocol/sdk` only → a **tiny, fully cross-platform** bundle (no
  per-OS packing).
- **`mcp_server/manifest.json`** — the bundle manifest: name, version (stamped),
  entry point `dist/index.js`, `node` runtime, no user-config fields (board URL is
  fixed).
- **Board URL stays hardcoded** — `BOARD_URL` already defaults to
  `http://esp32matrix.local` with no env required, so the bundle "just works" with no
  config screen.
- **Build script** — `npm run build:mcpb` = `tsc` → `npx @anthropic-ai/mcpb pack` →
  `esp32-matrix.mcpb`. Folded into `build-release.mjs`'s output copy.
- **Versioning** — `version-stamp.js` stamps `manifest.json`'s `version`; the bundle
  joins firmware/web/package.json as a self-reporting artifact (no drift).
- **The dev loop is unaffected** — the maintainer's Claude Code keeps using the
  existing `.mcp.json` → `mcp_launch.cmd` → `dist/index.js`. The `.mcpb` is purely the
  *end-user* delivery of the same compiled server.

---

## 6. Batched UI changes (ride-along, low-risk, no firmware change)

Requested alongside this work; included here so the spec is complete.

### 6a. Remove emoji entirely
- Delete `data/emoji.html`.
- Remove the **Emoji** card from `data/index.html`.
- Remove the `matrix_show_emoji` tool, `emojiToMatrix`, the `@napi-rs/canvas` import,
  and any now-orphaned emoji-only helpers (`FEATURE_RATIO`/`FEATURE_SNAP`/`punch`/
  `luma`/`normalize`/`emojiToMatrix` — keep any that are still referenced elsewhere)
  from `mcp_server/index.ts`.
- Scrub `emoji` references in `data/backnav.js` and `data/ledsim.js`.
- No firmware change — emoji was rendered MCP-side and pushed via the generic
  `/api/display/matrix`.
- Rationale: emoji never read well at 8×8 anyway, and dropping it removes the lone
  native dep blocking a clean `.mcpb`. (Custom imagery is still available via the
  Sketch page.)

### 6b. Time hub
- Replace the three separate **Timer / Clock / Calendar** cards on `data/index.html`
  with **one "Time" card** → new `data/time.html` sub-hub.
- `time.html` is cloned from the established hub pattern (`animations.html`): shared
  `app.css` + `header.js`/`bright.js`, breadcrumb via `backnav.js`
  (`data-parent="/index.html"`, `data-label="Time"`), and three `.card` link-outs to
  `timer.html` / `clock.html` / `calendar.html`.
- The three leaf pages get their breadcrumb `data-parent` repointed to
  `/time.html` so back-nav threads correctly through the new hub.

---

## 7. Documentation

- **`README.md`** — a new top-of-file **Install** section: (1) flash via the install
  page (browser or script), (2) double-click the `.mcpb` for Claude Desktop. The
  existing Arduino dev-setup instructions move *below* it, retitled "Developing /
  building from source."
- **`CLAUDE.md`** — update the firmware-layout note (single merged binary; the
  two-step upload is now a release concern), document `build-release.mjs` +
  `build:mcpb`, record the version reset, and remove emoji from the app inventory.
- Both the install page and the README state the fixed mDNS address
  (`http://esp32matrix.local`) and the one prerequisite end users still have: the
  board and their computer on the **same local network**.

---

## 8. Repo / release layout

```
/VERSION                       0.12.0 (→ 1.0.0 at first installable release)
scripts/build-release.mjs      merged .bin + manifest + .mcpb → release/
scripts/version-stamp.js       now also stamps mcp_server/manifest.json
install/index.html             ESP Web Tools + manual-flash + .mcpb page (→ Pages)
install/flash.bat              bundled-esptool double-click (Windows)
install/flash.sh               bundled-esptool double-click (macOS/Linux)
mcp_server/manifest.json       .mcpb manifest (stamped)
release/                       build output (gitignored) — what gets attached to a Release
  esp32matrix-<v>-merged.bin
  manifest.json
  esp32-matrix.mcpb
```

`release/` is gitignored (build output). The install page + scripts are committed.

---

## 9. Verification (how we know it actually works)

Because Claude can't flash, verification is **shared**:

- **Claude-side (pre-flight, no hardware):** `npm run check` reports zero drift across
  all four artifacts; `tsc` builds clean with `@napi-rs/canvas` removed; `npm run
  build:mcpb` produces a `.mcpb` that unzips to a canvas-free `node_modules`; the
  install page loads ESP Web Tools and references a manifest that points at a real
  merged `.bin`; `data/` has no dangling `emoji`/Timer/Clock/Calendar links (grep).
- **Maintainer-side (hardware):** run `build-release.mjs`; flash the merged `.bin` onto
  a **freshly-erased** board via the **offline `flash` script** (the browser one-click
  path is verified separately once GitHub Pages is enabled); confirm WiFi captive portal →
  join → `http://esp32matrix.local` serves the (emoji-free, Time-hub) web UI **with no
  separate LittleFS upload**; double-click the `.mcpb` into Claude Desktop and confirm
  the tools load and drive the board.
- The `1.0.0` crown is applied **only after** that end-to-end hardware pass succeeds.
