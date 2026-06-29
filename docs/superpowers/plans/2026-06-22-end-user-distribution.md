# End-User Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project installable by a non-developer — one merged firmware binary (app + web UI) flashed via browser or a script, plus a double-click `.mcpb` Claude Desktop extension — and reset the version to tell the truth (`1.1.0` → `0.12.0`; first installable build becomes the real `1.0.0`).

**Architecture:** The MCP server loses its only native dependency (`@napi-rs/canvas`, used solely by the now-removed emoji feature) so it packs into a tiny cross-platform `.mcpb`. A maintainer-run `scripts/build-release.mjs` builds a LittleFS image from `data/`, merges it with the Arduino-exported app/bootloader/partitions into one factory `.bin`, and emits an ESP Web Tools manifest. A static `install/` page offers both a browser flasher and an offline `flash` script over that one binary. The canonical `VERSION` gains a fourth stamped artifact (the `.mcpb` manifest).

**Tech Stack:** TypeScript MCP server (`@modelcontextprotocol/sdk` only), Node ESM build scripts (`node --test`), Arduino ESP32 core 3.3.8 toolchain (`esptool` 5.2.0, `mklittlefs` 4.0.2), ESP Web Tools 10, `@anthropic-ai/mcpb`.

## Global Constraints

- **Zero native deps in the MCP server.** After this work the only runtime dependency is `@modelcontextprotocol/sdk`. No `@napi-rs/canvas`, no other native binary.
- **Board URL is hardcoded** — `http://esp32matrix.local`. `BOARD_URL` already defaults to it (`index.ts:125`); no env, no config screen, no user-config manifest fields.
- **Four stamped artifacts** from the canonical `/VERSION`: `esp32_matrix_webserver/version.h`, `esp32_matrix_webserver/data/version.json`, `mcp_server/package.json`, and the new `mcp_server/manifest.json`. `npm run check` must report zero drift on the local artifacts.
- **ESP32-S3, Huge APP partition map** (verbatim from `huge_app.csv`): app @ `0x10000` size `0x300000`; LittleFS (spiffs) @ `0x310000` size `0xE0000`; bootloader @ `0x0`; partition table @ `0x8000`; `boot_app0` @ `0xe000`. Offsets are read from the CSV at build time, never hardcoded in logic.
- **`.mcpb` manifest** uses `manifest_version: "0.3"`, `server.type: "node"`, `server.entry_point: "dist/index.js"`, `server.mcp_config.args: ["${__dirname}/dist/index.js"]` (`${__dirname}` = the extension's install dir at runtime).
- **ESP Web Tools manifest**: `builds[].chipFamily: "ESP32-S3"`, single part `{ path: "<merged>.bin", offset: 0 }`.
- **Privacy:** never use the maintainer's real name in code/docs — refer to "the user".
- **Version floor for `1.0.0`:** the major bump happens only after the end-to-end hardware pass in Task 11; this plan lands at `0.12.0`.

---

## File Structure

| Path | Responsibility | Action |
|---|---|---|
| `mcp_server/index.ts` | Remove emoji tool + canvas + color helpers | Modify |
| `mcp_server/package.json` | Drop `@napi-rs/canvas` dep | Modify |
| `esp32_matrix_webserver/data/emoji.html` | Emoji control page | Delete |
| `esp32_matrix_webserver/data/index.html` | Drop Emoji card; collapse Time cards | Modify |
| `esp32_matrix_webserver/data/time.html` | New Time sub-hub | Create |
| `esp32_matrix_webserver/data/{timer,clock,calendar}.html` | Repoint breadcrumb parent | Modify |
| `esp32_matrix_webserver/data/{backnav.js,ledsim.js}` | Scrub emoji refs | Modify |
| `mcp_server/manifest.json` | `.mcpb` bundle manifest (stamped) | Create |
| `mcp_server/.mcpbignore` | Keep TS sources/tests out of the bundle | Create |
| `scripts/version-stamp.js` | Also stamp `manifest.json` | Modify |
| `scripts/version-check.js` | Also check the bundle manifest | Modify |
| `scripts/version.test.js` | Cover manifest stamping/checking | Modify |
| `VERSION` | `1.1.0` → `0.12.0` | Modify |
| `scripts/build-release.mjs` | Merged `.bin` + ESP Web Tools manifest + copy `.mcpb` | Create |
| `scripts/build-release.test.js` | Unit-test toolchain discovery | Create |
| `package.json` (root) | `build:mcpb` + `build:release` scripts | Modify |
| `install/index.html` | Browser + manual flasher + `.mcpb` link | Create |
| `install/flash.bat`, `install/flash.sh` | Offline flash scripts | Create |
| `.gitignore` | Ignore `release/` | Modify |
| `README.md`, `CLAUDE.md` | Install section + dev/build flow + emoji removal | Modify |

---

## Task 1: Strip emoji + native canvas from the MCP server

**Files:**
- Modify: `mcp_server/index.ts` (remove import line 25; the color/emoji helper block ≈201–320; the `matrix_show_emoji` tool object ≈634–670; the `case "matrix_show_emoji"` handler ≈895–920)
- Modify: `mcp_server/package.json` (remove the `@napi-rs/canvas` dependency)

**Interfaces:**
- Produces: a `mcp_server/dist/index.js` whose `node_modules` contains no native binary; tool list no longer includes `matrix_show_emoji`.
- Consumes: nothing.

> The grep in planning confirmed `parseHex, toHex, luma, hsv2rgb, punch, normalize, FEATURE_RATIO, FEATURE_SNAP, emojiToMatrix` are referenced **only** by the emoji pipeline — they delete as one block. `sleep` (the line immediately after) stays.

- [ ] **Step 1: Remove the canvas import**

In `mcp_server/index.ts` delete line 25:
```ts
import { createCanvas } from "@napi-rs/canvas";
```

- [ ] **Step 2: Remove the emoji + color helper block**

Delete the contiguous block from the comment line containing `These MUST stay in sync with data/emoji.html` down to **and including** the closing `}` of `function emojiToMatrix(...)` (the `}` on the line immediately before `const sleep =`). That removes: `FEATURE_RATIO`, `FEATURE_SNAP`, `parseHex`, `toHex`, `luma`, `hsv2rgb`, `punch`, `normalize`, `emojiToMatrix`. Do **not** remove `const sleep = ...`.

- [ ] **Step 3: Remove the tool definition**

In the `ListToolsRequestSchema` handler's `tools` array, delete the entire object literal that begins:
```ts
    {
      name: "matrix_show_emoji",
```
through its matching closing `},` (ends just before the next tool object).

- [ ] **Step 4: Remove the call handler**

Delete the entire `case "matrix_show_emoji": { ... }` block in the `CallToolRequestSchema` switch, including its trailing `return { ... }`.

- [ ] **Step 5: Drop the dependency**

In `mcp_server/package.json` remove the line:
```json
    "@napi-rs/canvas": "^0.1.67",
```
Leave `"@modelcontextprotocol/sdk": "^1.11.0"` as the sole dependency.

- [ ] **Step 6: Reinstall to prune the native module**

Run: `cd mcp_server && npm install`
Expected: completes; `mcp_server/node_modules/@napi-rs` is gone.

- [ ] **Step 7: Typecheck**

Run: `cd mcp_server && npx tsc --project tsconfig.json`
Expected: no output (clean build), `dist/index.js` regenerated.

- [ ] **Step 8: Run the test suite**

Run (repo root): `npm test`
Expected: all existing tests PASS (no test referenced the emoji path).

- [ ] **Step 9: Verify nothing emoji/canvas remains**

Run: `grep -rIn "napi-rs\|createCanvas\|emojiToMatrix\|show_emoji" mcp_server/index.ts mcp_server/package.json`
Expected: no matches.

- [ ] **Step 10: Commit**

```bash
git add mcp_server/index.ts mcp_server/package.json mcp_server/package-lock.json
git commit -m "refactor(mcp): remove emoji tool and the @napi-rs/canvas native dep"
```

---

## Task 2: Remove emoji from the web UI

**Files:**
- Delete: `esp32_matrix_webserver/data/emoji.html`
- Modify: `esp32_matrix_webserver/data/index.html` (remove the Emoji `.card`)
- Modify: `esp32_matrix_webserver/data/backnav.js`, `esp32_matrix_webserver/data/ledsim.js` (scrub `emoji` references)

**Interfaces:**
- Produces: a control panel with no emoji entry point. No firmware change (emoji rendered MCP-side via `/api/display/matrix`).

- [ ] **Step 1: Delete the page**

```bash
git rm esp32_matrix_webserver/data/emoji.html
```

- [ ] **Step 2: Remove the Emoji card from the index**

In `esp32_matrix_webserver/data/index.html` delete the whole anchor block:
```html
    <a href="/emoji.html" class="card">
      <span class="icon">😊</span>
      <div class="name">Emoji</div>
      <div class="desc">Display any emoji on the matrix in full color</div>
    </a>
```

- [ ] **Step 3: Find the emoji references in the shared JS**

Run: `grep -n "emoji" esp32_matrix_webserver/data/backnav.js esp32_matrix_webserver/data/ledsim.js`
Inspect each hit. In `backnav.js` an emoji entry usually appears in a title/parent map; in `ledsim.js` it may be an opt-in page list. Remove the emoji-specific entries only.

- [ ] **Step 4: Apply the removals**

Edit `backnav.js` and `ledsim.js` to delete the `emoji`/`emoji.html` entries identified in Step 3, leaving surrounding entries intact (mind trailing commas in object/array literals).

- [ ] **Step 5: Verify no dangling references**

Run: `grep -rIn "emoji" esp32_matrix_webserver/data/`
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add esp32_matrix_webserver/data/
git commit -m "feat(ui): remove the emoji page and all references to it"
```

---

## Task 3: Time hub (Timer / Clock / Calendar under one card)

**Files:**
- Create: `esp32_matrix_webserver/data/time.html`
- Modify: `esp32_matrix_webserver/data/index.html` (replace 3 cards with 1 Time card)
- Modify: `esp32_matrix_webserver/data/timer.html`, `clock.html`, `calendar.html` (breadcrumb parent → `/time.html`)

**Interfaces:**
- Consumes: the shared design system (`app.css`, `header.js`, `bright.js`, `backnav.js`) exactly as `animations.html` does.
- Produces: `/time.html` hub linking the three time apps; `/index.html` shows a single **Time** card.

- [ ] **Step 1: Read the hub pattern to clone**

Run: `sed -n '1,60p' esp32_matrix_webserver/data/animations.html`
Note the exact `<head>` (favicon + `app.css`), the `backnav.js` breadcrumb attributes, the `.apps`/`.card` structure, and the `header.js`/`bright.js` script tags.

- [ ] **Step 2: Create `time.html`**

Create `esp32_matrix_webserver/data/time.html` mirroring `animations.html`'s shell, with breadcrumb `data-parent="/index.html"` `data-label="Time"` and exactly three cards:
```html
    <a href="/timer.html" class="card">
      <span class="icon">🕐</span>
      <div class="name">Timer</div>
      <div class="desc">Countdown: gradient fill, snowfall, or digit display</div>
    </a>
    <a href="/clock.html" class="card">
      <span class="icon">🕰️</span>
      <div class="name">Clock</div>
      <div class="desc">Current time via NTP, 12-hour format</div>
    </a>
    <a href="/calendar.html" class="card">
      <span class="icon">📅</span>
      <div class="name">Calendar</div>
      <div class="desc">Today's date — scrolling, big day, month grid, or clock-style</div>
    </a>
```
Use `animations.html`'s `<title>` pattern (e.g. `ESP32 Matrix — Time`) and its breadcrumb markup verbatim, only changing the label/parent and the cards.

- [ ] **Step 3: Collapse the three index cards into one Time card**

In `esp32_matrix_webserver/data/index.html` replace the three consecutive `<a href="/timer.html">`, `<a href="/clock.html">`, `<a href="/calendar.html">` card blocks with a single:
```html
    <a href="/time.html" class="card">
      <span class="icon">🕰️</span>
      <div class="name">Time</div>
      <div class="desc">Clock, countdown timer, and calendar</div>
    </a>
```
(Place it where the Timer card was, preserving overall card order.)

- [ ] **Step 4: Repoint the leaf breadcrumbs**

In each of `timer.html`, `clock.html`, `calendar.html`, find the `backnav.js` breadcrumb element and change its parent from the index to the hub:
```
data-parent="/time.html" data-label="Time"
```
Run first to locate: `grep -n "data-parent" esp32_matrix_webserver/data/timer.html esp32_matrix_webserver/data/clock.html esp32_matrix_webserver/data/calendar.html`

- [ ] **Step 5: Verify wiring**

Run: `grep -n "time.html\|data-parent" esp32_matrix_webserver/data/index.html esp32_matrix_webserver/data/time.html esp32_matrix_webserver/data/timer.html esp32_matrix_webserver/data/clock.html esp32_matrix_webserver/data/calendar.html`
Expected: index links `/time.html`; `time.html` parent `/index.html`; the three leaves parent `/time.html`.

- [ ] **Step 6: Commit**

```bash
git add esp32_matrix_webserver/data/
git commit -m "feat(ui): group Timer/Clock/Calendar under a Time hub"
```

---

## Task 4: Create the `.mcpb` bundle manifest

**Files:**
- Create: `mcp_server/manifest.json`
- Create: `mcp_server/.mcpbignore`

**Interfaces:**
- Produces: `mcp_server/manifest.json` with a `version` field (stamped in Task 6) that `version-stamp.js`/`version-check.js` will read in Task 5.

- [ ] **Step 1: Write the manifest**

Create `mcp_server/manifest.json` (version matches current `VERSION` = `1.1.0` for now; Task 6 re-stamps it):
```json
{
  "manifest_version": "0.3",
  "name": "esp32-matrix",
  "display_name": "ESP32-S3 Matrix",
  "version": "1.1.0",
  "description": "Control a Waveshare ESP32-S3 8x8 LED matrix from Claude — animations, text, clock, weather, and Claude's ambient expression display. Talks to the board at http://esp32matrix.local on your local network.",
  "author": { "name": "the user" },
  "server": {
    "type": "node",
    "entry_point": "dist/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/index.js"],
      "env": {}
    }
  }
}
```

- [ ] **Step 2: Write `.mcpbignore`**

Create `mcp_server/.mcpbignore` so the bundle ships only the compiled server + runtime assets (the `.ts` sources and tests are not needed at runtime; `expressions/` and `wait-weights.json` ARE read at runtime and must stay):
```
*.ts
*.test.ts
tsconfig.json
.env
mcp_launch.cmd
```

- [ ] **Step 3: Sanity-check JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('mcp_server/manifest.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add mcp_server/manifest.json mcp_server/.mcpbignore
git commit -m "feat(mcp): add .mcpb bundle manifest + ignore list"
```

---

## Task 5: Teach the version tooling about the bundle manifest (TDD)

**Files:**
- Modify: `scripts/version-stamp.js` (stamp `manifest.json`)
- Modify: `scripts/version-check.js` (report the bundle manifest version)
- Modify: `scripts/version.test.js` (fixtures cover manifest)

**Interfaces:**
- Consumes: `mcp_server/manifest.json` from Task 4.
- Produces: `stamp()` writes `manifest.json.version`; `checkVersions()` adds a row `{ artifact: "mcp-bundle", reported, status }`.

- [ ] **Step 1: Extend the fixture to include a manifest**

In `scripts/version.test.js`, in `fixtureRoot()`, after writing `mcp_server/package.json`, also write a manifest:
```js
  await writeFile(
    path.join(root, "mcp_server", "manifest.json"),
    JSON.stringify({ manifest_version: "0.3", name: "esp32-matrix", version: "0.0.0", server: { type: "node", entry_point: "dist/index.js" } }, null, 2) + "\n",
  );
```

- [ ] **Step 2: Write the failing stamp assertion**

In the `"stamp writes the version into all three artifacts"` test (rename its title to `"... into all four artifacts"`), append:
```js
  const manifest = JSON.parse(await readFile(path.join(root, "mcp_server", "manifest.json"), "utf8"));
  assert.equal(manifest.version, "0.3.0");
  assert.equal(manifest.name, "esp32-matrix", "stamp preserves other manifest fields");
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test scripts/version.test.js`
Expected: FAIL — `manifest.version` is still `0.0.0` (stamp doesn't touch it yet).

- [ ] **Step 4: Implement manifest stamping**

In `scripts/version-stamp.js` `stamp()`, after the package.json block (before `return version;`):
```js
  // 4. MCP bundle manifest (.mcpb) — read/modify/write to preserve other fields
  const manifestPath = path.join(root, "mcp_server", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = version;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
```
Also update the CLI `console.log` line to mention `manifest.json`.

- [ ] **Step 5: Run it to verify the stamp test passes**

Run: `node --test scripts/version.test.js`
Expected: the stamp test PASSES.

- [ ] **Step 6: Write the failing check assertion**

In `scripts/version.test.js`, in `"checkVersions reports match when board agrees"`, change the expected map to include the bundle:
```js
  assert.deepEqual(byArtifact, { firmware: "match", web: "match", mcp: "match", "mcp-bundle": "match" });
```

- [ ] **Step 7: Run it to verify it fails**

Run: `node --test scripts/version.test.js`
Expected: FAIL — no `mcp-bundle` row exists yet.

- [ ] **Step 8: Implement the check row**

In `scripts/version-check.js` `checkVersions()`, after the `mcpVersion` read block, add a parallel read + row:
```js
  let bundleVersion = "unknown";
  try {
    const m = JSON.parse(await readFile(path.join(root, "mcp_server", "manifest.json"), "utf8"));
    bundleVersion = m.version ?? "unknown";
  } catch { /* leave as unknown */ }
```
Then add to the initial `rows` array (after the `mcp` row):
```js
  rows.push({ artifact: "mcp-bundle", reported: bundleVersion, status: compareArtifact(bundleVersion, expected) });
```

- [ ] **Step 9: Run the full version test file**

Run: `node --test scripts/version.test.js`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/version-stamp.js scripts/version-check.js scripts/version.test.js
git commit -m "feat(versioning): stamp + drift-check the .mcpb manifest as a 4th artifact"
```

---

## Task 6: Reset the version to 0.12.0 and stamp all four artifacts

**Files:**
- Modify: `VERSION`
- (Generated) `esp32_matrix_webserver/version.h`, `esp32_matrix_webserver/data/version.json`, `mcp_server/package.json`, `mcp_server/manifest.json`

**Interfaces:**
- Consumes: the stamping from Task 5.
- Produces: every artifact self-reports `0.12.0`.

- [ ] **Step 1: Rewrite the canonical version**

Set the contents of `VERSION` to exactly:
```
0.12.0
```

- [ ] **Step 2: Stamp every artifact**

Run: `npm run stamp`
Expected: log mentions `version.h`, `data/version.json`, `mcp_server/package.json`, `manifest.json`, all at `0.12.0`.

- [ ] **Step 3: Verify the stamp landed everywhere**

Run:
```bash
grep -h "0.12.0" esp32_matrix_webserver/version.h esp32_matrix_webserver/data/version.json mcp_server/package.json mcp_server/manifest.json
```
Expected: four matching lines.

- [ ] **Step 4: Confirm zero drift on local artifacts**

Run: `node scripts/version-check.js http://127.0.0.1:1`
Expected: `mcp` and `mcp-bundle` rows show `✓`; firmware/web show `✗ unreachable` (no board in this session) — that's fine, the local artifacts are what matter here.

- [ ] **Step 5: Commit**

```bash
git add VERSION esp32_matrix_webserver/version.h esp32_matrix_webserver/data/version.json mcp_server/package.json mcp_server/manifest.json
git commit -m "chore: reset version 1.1.0 -> 0.12.0 (premature 1.0; real 1.0.0 = installable)"
```

---

## Task 7: `build:mcpb` — produce the Claude Desktop extension

**Files:**
- Modify: `package.json` (root) — add `build:mcpb`
- Modify: `.gitignore` — ignore `release/`

**Interfaces:**
- Consumes: Task 1's canvas-free server, Task 4's manifest.
- Produces: `release/esp32-matrix.mcpb`.

- [ ] **Step 1: Confirm the packer's argument syntax**

Run: `npx @anthropic-ai/mcpb pack --help`
Note the exact input-dir / output-file argument order (the README documents `mcpb pack` but not the path args). Use what `--help` prints in the next step.

- [ ] **Step 2: Add the build script**

In root `package.json` `scripts`, add (adjust the `pack` args to match Step 1; this is the documented default form — input dir then output file):
```json
    "build:mcpb": "cd mcp_server && npx tsc --project tsconfig.json && cd .. && node -e \"require('fs').mkdirSync('release',{recursive:true})\" && npx @anthropic-ai/mcpb pack mcp_server release/esp32-matrix.mcpb"
```

- [ ] **Step 3: Ignore the build output**

Append to `.gitignore`:
```
# Release build output (merged firmware, manifest, .mcpb) — produced by scripts/build-release.mjs
release/
```

- [ ] **Step 4: Build the bundle**

Run: `npm run build:mcpb`
Expected: `release/esp32-matrix.mcpb` is created.

- [ ] **Step 5: Verify the bundle is canvas-free and runnable**

Run:
```bash
node -e "const z=require('fs').readFileSync('release/esp32-matrix.mcpb'); console.log('size', z.length)"
unzip -l release/esp32-matrix.mcpb | grep -i "napi\|canvas" || echo "no native canvas in bundle ✓"
unzip -l release/esp32-matrix.mcpb | grep -E "dist/index.js|manifest.json" 
```
Expected: prints a size; `no native canvas in bundle ✓`; lists `dist/index.js` and `manifest.json`.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore
git commit -m "feat: build:mcpb packs the server into a Claude Desktop extension"
```

---

## Task 8: `build-release.mjs` — merged firmware binary + flasher manifest

**Files:**
- Create: `scripts/build-release.mjs`
- Create: `scripts/build-release.test.js`
- Modify: `package.json` (root) — add `build:release`

**Interfaces:**
- Consumes: Arduino "Export Compiled Binary" output under `esp32_matrix_webserver/build/**/`, the ESP32 core toolchain under `Arduino15/packages/esp32`, Task 7's `.mcpb`.
- Produces: `release/esp32matrix-<version>-merged.bin`, `release/manifest.json` (ESP Web Tools), and a copied `release/esp32-matrix.mcpb`.
- Exposes (for tests): `export function pickHighestVersionPath(paths: string[]): string` — given several version-stamped paths, returns the one with the greatest dotted-number segment.

> **This is the riskiest task** (external binaries). The pure unit (`pickHighestVersionPath`) is TDD'd; the merge orchestration is verified on hardware in Task 11. Write the pure function first.

- [ ] **Step 1: Write the failing test for version selection**

Create `scripts/build-release.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickHighestVersionPath } from "./build-release.mjs";

test("pickHighestVersionPath prefers the highest dotted-number segment", () => {
  const paths = [
    "/p/esp32/tools/esptool_py/4.5.1/esptool.exe",
    "/p/esp32/tools/esptool_py/5.2.0/esptool.exe",
  ];
  assert.equal(pickHighestVersionPath(paths), "/p/esp32/tools/esptool_py/5.2.0/esptool.exe");
});

test("pickHighestVersionPath returns the sole path unchanged", () => {
  assert.equal(pickHighestVersionPath(["/only/3.0.0/mklittlefs.exe"]), "/only/3.0.0/mklittlefs.exe");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/build-release.test.js`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement the script skeleton + the pure function**

Create `scripts/build-release.mjs`:
```js
// Build a single flashable factory image for end users.
//
//   node scripts/build-release.mjs
//
// Reads the maintainer's Arduino "Export Compiled Binary" output + the ESP32
// core toolchain, builds a LittleFS image from data/, merges everything into
// release/esp32matrix-<version>-merged.bin, and writes the ESP Web Tools
// manifest. Offsets come from huge_app.csv, never hardcoded.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { glob } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(REPO_ROOT, "esp32_matrix_webserver", "data");
const BUILD_DIR = path.join(REPO_ROOT, "esp32_matrix_webserver", "build");
const RELEASE_DIR = path.join(REPO_ROOT, "release");
const PKG_ESP32 = path.join(os.homedir(), "AppData", "Local", "Arduino15", "packages", "esp32");

/** Pick the path whose version-stamped directory sorts highest numerically. */
export function pickHighestVersionPath(paths) {
  const key = (p) => (p.match(/(\d+(?:\.\d+)+)/g)?.pop() ?? "0")
    .split(".").map(Number);
  return [...paths].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      if ((kb[i] ?? 0) !== (ka[i] ?? 0)) return (kb[i] ?? 0) - (ka[i] ?? 0);
    }
    return 0;
  })[0];
}

async function globOne(root, pattern) {
  const hits = [];
  for await (const f of glob(pattern, { cwd: root })) hits.push(path.join(root, f));
  if (!hits.length) throw new Error(`Not found under ${root}: ${pattern}`);
  return pickHighestVersionPath(hits);
}
```

- [ ] **Step 4: Run the test to verify the pure function passes**

Run: `node --test scripts/build-release.test.js`
Expected: both tests PASS.

- [ ] **Step 5: Implement the build steps (locate toolchain → littlefs → merge → manifest)**

Append the orchestration to `scripts/build-release.mjs`:
```js
function readSpiffs(csv) {
  // huge_app.csv: "spiffs, data, spiffs, 0x310000,0xE0000,"
  const line = csv.split("\n").find((l) => /^\s*spiffs\s*,/.test(l));
  if (!line) throw new Error("no spiffs row in partition CSV");
  const cols = line.split(",").map((s) => s.trim());
  return { offset: cols[3], size: cols[4] };
}

async function main() {
  const version = (await readFile(path.join(REPO_ROOT, "VERSION"), "utf8")).trim();
  await mkdir(RELEASE_DIR, { recursive: true });

  // 1. Locate the maintainer's exported app artifacts.
  const app = await globOne(BUILD_DIR, "**/*.ino.bin");
  const bootloader = await globOne(BUILD_DIR, "**/*.ino.bootloader.bin");
  const partitions = await globOne(BUILD_DIR, "**/*.ino.partitions.bin");

  // 2. Locate the core toolchain (env override wins).
  const toolsRoot = process.env.ESP32_TOOLS_DIR || PKG_ESP32;
  const esptool = await globOne(toolsRoot, "tools/esptool_py/**/esptool.exe");
  const mklittlefs = await globOne(toolsRoot, "tools/mklittlefs/**/mklittlefs.exe");
  const bootApp0 = await globOne(toolsRoot, "hardware/esp32/**/tools/partitions/boot_app0.bin");
  const csvPath = await globOne(toolsRoot, "hardware/esp32/**/tools/partitions/huge_app.csv");
  const { offset: fsOffset, size: fsSize } = readSpiffs(await readFile(csvPath, "utf8"));

  // 3. Build the LittleFS image from data/ at the partition's exact size.
  const fsBin = path.join(RELEASE_DIR, "littlefs.bin");
  execFileSync(mklittlefs, ["-c", DATA_DIR, "-p", "256", "-b", "4096", "-s", fsSize, fsBin], { stdio: "inherit" });

  // 4. Merge into one factory image.
  const merged = path.join(RELEASE_DIR, `esp32matrix-${version}-merged.bin`);
  execFileSync(esptool, [
    "--chip", "esp32s3", "merge_bin", "-o", merged,
    "--flash_mode", "dio", "--flash_freq", "80m", "--flash_size", "4MB",
    "0x0", bootloader, "0x8000", partitions, "0xe000", bootApp0,
    "0x10000", app, fsOffset, fsBin,
  ], { stdio: "inherit" });

  // 5. ESP Web Tools manifest.
  await writeFile(path.join(RELEASE_DIR, "manifest.json"), JSON.stringify({
    name: "ESP32-S3 Matrix",
    version,
    new_install_prompt_erase: true,
    builds: [{ chipFamily: "ESP32-S3", parts: [{ path: path.basename(merged), offset: 0 }] }],
  }, null, 2) + "\n", "utf8");

  // 6. Copy the .mcpb if build:mcpb already produced it.
  const mcpb = path.join(RELEASE_DIR, "esp32-matrix.mcpb");
  if (!existsSync(mcpb)) console.warn("note: release/esp32-matrix.mcpb missing — run `npm run build:mcpb` too");

  console.log(`\nRelease ready in release/:\n  ${path.basename(merged)}\n  manifest.json\n  esp32-matrix.mcpb (if built)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("build-release failed:", e.message); process.exit(1); });
}
```

> **Execution note:** `esptool` 5.x may prefer hyphenated flags (`--flash-mode`) — if `merge_bin` errors on an argument, run `<esptool> merge_bin --help` and adjust the flag spellings. `${name}.ino.partitions.bin` is only emitted by **Export Compiled Binary**, so the maintainer must do that export first (covered in Task 11).

- [ ] **Step 6: Add the `build:release` script**

In root `package.json` `scripts` add:
```json
    "build:release": "node scripts/build-release.mjs"
```

- [ ] **Step 7: Verify graceful failure without an export present**

Run: `npm run build:release`
Expected (no export yet): exits non-zero with a clear `Not found under …/build: **/*.ino.bin` message — proving discovery + error handling work. (The full merge is exercised on hardware in Task 11.)

- [ ] **Step 8: Commit**

```bash
git add scripts/build-release.mjs scripts/build-release.test.js package.json
git commit -m "feat: build-release.mjs merges firmware+web into one flashable .bin"
```

---

## Task 9: Install page + offline flash scripts

**Files:**
- Create: `install/index.html`, `install/flash.bat`, `install/flash.sh`

**Interfaces:**
- Consumes: `release/manifest.json` + the merged `.bin` (browser path); the bundled `esptool` (script path).
- Produces: both install front-doors.

- [ ] **Step 1: Write the install page**

Create `install/index.html` — the browser flasher points at the manifest that ships next to it on Pages; it also explains the offline path and links the `.mcpb`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Install — ESP32-S3 Matrix</title>
  <script type="module" src="https://unpkg.com/esp-web-tools@10/dist/web/install-button.js?module"></script>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.55; }
    h2 { margin-top: 2rem; } code { background: #eee; padding: 0 .3em; border-radius: 3px; }
    .note { color: #555; font-size: .9rem; }
  </style>
</head>
<body>
  <h1>ESP32-S3 Matrix — Install</h1>
  <p>The board and your computer must be on the <strong>same local network</strong>. After flashing, the board is reachable at <code>http://esp32matrix.local</code>.</p>

  <h2>1. Flash the firmware (one click — Chrome/Edge)</h2>
  <p>Plug the board into USB, then:</p>
  <esp-web-install-button manifest="manifest.json"></esp-web-install-button>
  <p class="note">No button? Your browser lacks Web Serial — use the offline method below.</p>

  <h2>1b. Flash the firmware (offline / other browsers)</h2>
  <p>Download the release, plug in the board, and run <code>flash.bat</code> (Windows) or <code>flash.sh</code> (macOS/Linux).</p>

  <h2>2. Add it to Claude Desktop</h2>
  <p>Download <a href="esp32-matrix.mcpb">esp32-matrix.mcpb</a> and double-click it — Claude Desktop installs the extension. No configuration needed.</p>
</body>
</html>
```

- [ ] **Step 2: Write the Windows flash script**

Create `install/flash.bat` (expects a bundled `esptool.exe` and the merged `.bin` beside it; `build-release` copies them into `release/` for distribution):
```bat
@echo off
setlocal
for %%f in ("%~dp0esp32matrix-*-merged.bin") do set "MERGED=%%f"
if not defined MERGED ( echo Merged .bin not found next to this script. & pause & exit /b 1 )
echo Flashing %MERGED% ...
"%~dp0esptool.exe" --chip esp32s3 --baud 921600 write_flash 0x0 "%MERGED%"
echo.
echo Done. The board will reboot. Find it at http://esp32matrix.local
pause
```

- [ ] **Step 3: Write the macOS/Linux flash script**

Create `install/flash.sh`:
```sh
#!/usr/bin/env sh
# Requires esptool: `pip install esptool` (or `pipx install esptool`).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
MERGED="$(ls "$DIR"/esp32matrix-*-merged.bin 2>/dev/null | head -n1)"
[ -n "$MERGED" ] || { echo "Merged .bin not found next to this script."; exit 1; }
echo "Flashing $MERGED ..."
python3 -m esptool --chip esp32s3 --baud 921600 write_flash 0x0 "$MERGED"
echo "Done. Find the board at http://esp32matrix.local"
```

- [ ] **Step 4: Verify the page parses and references the right files**

Run: `grep -n "manifest.json\|esp-web-install-button\|esp32-matrix.mcpb" install/index.html`
Expected: the install button references `manifest.json`; the `.mcpb` link is present.

- [ ] **Step 5: Commit**

```bash
git add install/
git commit -m "feat: install page (browser flasher) + offline flash scripts"
```

---

## Task 10: Documentation — install section + dev/build flow

**Files:**
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Produces: end-user-facing install docs + maintainer build/release docs.

- [ ] **Step 1: Read the current README top + CLAUDE.md app inventory**

Run: `sed -n '1,40p' README.md` and `grep -n "emoji\|LittleFS Data Upload\|Two.*separate steps\|data/\*.html" CLAUDE.md`

- [ ] **Step 2: Add the README Install section**

At the top of `README.md` (after the title/intro, before the Arduino setup), insert an **Install (end users)** section: (1) open the install page → one-click flash (Chrome/Edge) or download the release + run `flash.bat`/`flash.sh`; (2) double-click `esp32-matrix.mcpb` for Claude Desktop; note the same-network requirement and `http://esp32matrix.local`. Retitle the existing Arduino instructions **"Developing / building from source."**

- [ ] **Step 3: Update CLAUDE.md**

In `CLAUDE.md`: (a) remove `emoji` from any app/file inventory and the `data/*.html` list; (b) in the firmware-layout / dev-loop area note that **end-user installs flash a single merged binary** (`scripts/build-release.mjs`) so there is no separate LittleFS step for them — the two-step upload remains only the *developer* loop; (c) document `npm run build:mcpb` and `npm run build:release`; (d) note the version reset to `0.12.0` and that the **first installable release is the real `1.0.0`**.

- [ ] **Step 4: Verify no emoji references survive in docs we own**

Run: `grep -n "emoji" README.md CLAUDE.md`
Expected: no matches (or only historical mentions you intentionally keep — prefer none).

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: end-user install section + build/release flow; drop emoji"
```

---

## Task 11: End-to-end hardware verification + crown 1.0.0 (maintainer)

**Files:**
- Modify: `VERSION` (→ `1.0.0`) + stamped artifacts, only after the pass below.

**Interfaces:**
- Consumes: everything above.

> This task needs the board and the Arduino IDE; the agent cannot perform it. It is the gate for the major bump.

- [ ] **Step 1: Export the compiled binary**

In the Arduino IDE: open `esp32_matrix_webserver`, select the Waveshare ESP32-S3-Matrix board with the documented settings, then **Sketch → Export Compiled Binary**. Confirm `esp32_matrix_webserver/build/**/esp32_matrix_webserver.ino.bin` (+ `.bootloader.bin`, `.partitions.bin`) exist.

- [ ] **Step 2: Build the release artifacts**

Run: `npm run build:mcpb && npm run build:release`
Expected: `release/esp32matrix-0.12.0-merged.bin`, `release/manifest.json`, `release/esp32-matrix.mcpb`.

- [ ] **Step 3: Flash a freshly-erased board via the offline script**

Copy the found `esptool.exe` into `release/` (so `flash.bat` is self-contained), fully erase, then run `release/flash.bat`. Confirm it flashes at `0x0` with no separate LittleFS step.

- [ ] **Step 4: Verify the board came up fully provisioned**

Join WiFi via the captive portal, browse `http://esp32matrix.local`. Confirm: the web UI loads (served from the baked-in LittleFS), there is **no Emoji card**, the **Time** card opens the Timer/Clock/Calendar hub, and breadcrumbs thread back through `/time.html`.

- [ ] **Step 5: Install the Claude Desktop extension**

Double-click `release/esp32-matrix.mcpb` into Claude Desktop. Confirm the tools load (Settings → Developer) and that `matrix_status` / an animation command drive the board — with no JSON editing and no Node install.

- [ ] **Step 6: Crown 1.0.0**

Only after Steps 1–5 pass: set `VERSION` to `1.0.0`, run `npm run stamp`, re-run `npm run build:mcpb && npm run build:release`, reflash, and confirm `npm run check` (against the live board) reports all four artifacts `✓` at `1.0.0`.

```bash
git add VERSION esp32_matrix_webserver/version.h esp32_matrix_webserver/data/version.json mcp_server/package.json mcp_server/manifest.json
git commit -m "chore: bump v1.0.0 — first build any user can install"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** §1 version reset → Tasks 6/11; §2 merged binary → Task 8; §3 build-release → Task 8; §4 install front-doors → Tasks 9 (+ Pages deferred per spec); §5 `.mcpb`/native-dep → Tasks 1,4,7; §6a emoji removal → Tasks 1,2; §6b Time hub → Task 3; §7 docs → Task 10; §8 layout/`.gitignore` → Tasks 7,8; §9 verification → Task 11.
- **Type/name consistency:** `pickHighestVersionPath` defined and consumed in Task 8; the `mcp-bundle` artifact row name matches between `version-check.js` and the test in Task 5; `stamp()` signature unchanged (still `(version, root)`).
- **No placeholders:** every code step carries real content; the two genuinely external unknowns (mcpb `pack` arg order, esptool 5.x flag spelling) are pinned with a `--help` verification step rather than a guess.
