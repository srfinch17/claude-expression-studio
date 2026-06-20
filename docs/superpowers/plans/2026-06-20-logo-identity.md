# Logo Identity — Header Card + Animated Wait Pool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the favicon's quincunx mark into a board logo — a shared header card on every control page — and add four animated-logo wait variants to the busy/wait pool.

**Architecture:** Workstream A is a single drop-in component (`data/header.js`, `data-auto`, mirrors `bright.js`) that injects an identical header card atop each page's `.wrap`; pages just gain one script tag, and the index sheds its old green text title. Workstream B adds four `wait-logo-*` saved frame-expressions (authored live via the matrix MCP, auto-joining the pool by `wait-` convention) plus four weight entries — pure data, no firmware or MCP code change.

**Tech Stack:** Static HTML/JS served from LittleFS; FastLED 8×8 frame-expressions (JSON played via `/api/display/frames`); MCP server (TypeScript, `node:test`); `npm run bump:minor` versioning.

## Global Constraints

- **Privacy:** never use the maintainer's real name anywhere — refer to "the user". (repo is distributable)
- **Logo motif (canonical):** quincunx of 5 dots — TL green `#00ff88`, TR amber `#ffb000`, center cyan `#22ddff`, BL amber `#ffb000`, BR green `#00ff88`. Identical to the existing favicon.
- **Header logo is DEAD-STATIC** — no CSS animation on it (user decision).
- **`header.js` mirrors the `bright.js` pattern**: IIFE, `data-auto` self-mount, injects its own `<style>` once, idempotent (never injects a second card).
- **Excluded from the header:** `data/presence-card.html` (separate desktop surface) and the favicon itself (unchanged).
- **Wait variants are saved frame-expressions** named `wait-logo-breathe|chase|boot|ripple` — zero firmware, zero rebuild, zero reconnect; they auto-join the pool via the `wait-` prefix (`mcp_server/wait.ts` `WAIT_PREFIX`).
- **`wait-claude` stays the dominant single favorite** — each logo variant gets weight **8** in `mcp_server/wait-weights.json` (additive; existing weights untouched; `wait-claude` stays 40, clearly above the 4-logo family's combined 32). The file is **nested** `{"_comment":…, "weights":{…}}` — the four keys go inside `weights` (the runtime reads `raw.weights`).
- **8×8 conventions:** `XY(x,y)=y*8+x`, row-major, origin top-left; `COLOR_ORDER` is RGB. Wait/idle indicators render at the **brightness-5 ambient floor** — dim baselines must keep their weakest channel above the visibility threshold or they vanish at bri 5.
- **Version:** bump **minor 0.7.0 → 0.8.0** at the end (`npm run bump:minor`). Web + MCP redeploy; firmware not reflashed (its `fw_version` goes live next flash — expected drift, don't chase).
- **No unit-test harness exists for `data/*.html|*.js`** (neither do `bright.js`/`ledsim.js`) — those assets are verified by `node --check` (syntax) + HTTP-serve + the user's eyes, consistent with the codebase. Only the MCP/config logic is `node:test`-tested.
- **Restore board brightness + prior display after any hardware testing** (don't leave it bright or stuck on a test frame).

---

## File Structure

| File | Responsibility | New/Modified |
|---|---|---|
| `esp32_matrix_webserver/data/header.js` | The shared logo header-card component (inline logo SVG + injected CSS + `data-auto` injector) | **New** |
| `esp32_matrix_webserver/data/index.html` | Drop old green `<header>` block; add `header.js` script tag | Modified |
| `esp32_matrix_webserver/data/<20 sub-pages>.html` | Add `header.js` script tag (one line each) | Modified |
| `mcp_server/wait-weights.json` | Add four `wait-logo-*` entries at weight 8 (inside the nested `weights` object) | Modified |
| `mcp_server/wait.test.ts` | Add a guard test for the shipped weights file | Modified |
| `mcp_server/expressions/wait-logo-{breathe,chase,boot,ripple}.json` | The four animated-logo wait expressions | **New** (via `save_as`) |
| `VERSION`, `data/version.json`, `mcp_server/package.json`, `version.h` | Version stamp 0.8.0 | Modified (by `npm run bump:minor`) |

---

## Task 1: The `header.js` component

**Files:**
- Create: `esp32_matrix_webserver/data/header.js`

**Interfaces:**
- Produces: a global `MatrixHeader.mount()` and a `data-auto` self-mount. On mount it prepends one `<a class="mh-card" href="/">…</a>` as the first child of `.wrap` (fallback `<body>`). Idempotent: a no-op if a `.mh-card` already exists.

- [ ] **Step 1: Write the component file**

Create `esp32_matrix_webserver/data/header.js` with exactly this content:

```js
/* ============================================================
 * header.js — shared board-identity header card (logo + name)
 * ------------------------------------------------------------
 * Drop-in, mirrors bright.js: include once per page as
 *   <script src="header.js" data-auto></script>
 * On load it injects its own <style> and PREPENDS an identical
 * logo header card as the first child of the page's .wrap
 * (fallback <body>). Idempotent — never injects a second card.
 * The logo is the quincunx mark (same motif/palette as the
 * favicon), rendered DEAD-STATIC. Served from LittleFS — no
 * firmware change, no build step.
 * ============================================================ */
(function (global) {
  'use strict';

  // Quincunx logo: 5 lit dots over a faint ghosted panel grid, on a dark
  // rounded tile. ~44px. Palette matches the favicon exactly.
  var LOGO_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 44' width='44' height='44'>" +
      "<rect width='44' height='44' rx='9' fill='#0d0d0d'/>" +
      // faint unlit panel texture: 4x4 grid of tiny dots, offset from the lit
      // quincunx positions (8/18/28/38, not 12/22/32) so it reads as panel
      // backing rather than tracing the logo.
      "<g fill='#ffffff' opacity='0.05'>" +
        "<circle cx='8' cy='8' r='1.4'/><circle cx='18' cy='8' r='1.4'/><circle cx='28' cy='8' r='1.4'/><circle cx='38' cy='8' r='1.4'/>" +
        "<circle cx='8' cy='18' r='1.4'/><circle cx='18' cy='18' r='1.4'/><circle cx='28' cy='18' r='1.4'/><circle cx='38' cy='18' r='1.4'/>" +
        "<circle cx='8' cy='28' r='1.4'/><circle cx='18' cy='28' r='1.4'/><circle cx='28' cy='28' r='1.4'/><circle cx='38' cy='28' r='1.4'/>" +
        "<circle cx='8' cy='38' r='1.4'/><circle cx='18' cy='38' r='1.4'/><circle cx='28' cy='38' r='1.4'/><circle cx='38' cy='38' r='1.4'/>" +
      "</g>" +
      // 5 lit quincunx dots
      "<circle cx='12' cy='12' r='4' fill='#00ff88'/>" +
      "<circle cx='32' cy='12' r='4' fill='#ffb000'/>" +
      "<circle cx='22' cy='22' r='4' fill='#22ddff'/>" +
      "<circle cx='12' cy='32' r='4' fill='#ffb000'/>" +
      "<circle cx='32' cy='32' r='4' fill='#00ff88'/>" +
    "</svg>";

  var CSS =
    '.mh-card{display:flex;align-items:center;gap:14px;background:#161616;border:1px solid #2a2a2a;' +
      'border-radius:12px;padding:14px 18px;margin-bottom:20px;text-decoration:none;transition:border-color .15s}' +
    '.mh-card:hover{border-color:#444}' +
    '.mh-logo{flex:0 0 auto;line-height:0}' +
    '.mh-logo svg{display:block;width:44px;height:44px}' +
    '.mh-text{display:flex;flex-direction:column;gap:2px}' +
    '.mh-name{font-size:1.5rem;font-weight:600;color:#00ff88;letter-spacing:-0.02em;line-height:1.1}' +
    '.mh-sub{font-size:.82rem;color:#666}' +
    '@media (max-width:380px){.mh-name{font-size:1.25rem}}';

  function injectStyleOnce() {
    if (document.getElementById('mh-style')) return;
    var s = document.createElement('style');
    s.id = 'mh-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function markup() {
    return '<a class="mh-card" href="/" aria-label="Home">' +
             '<span class="mh-logo">' + LOGO_SVG + '</span>' +
             '<span class="mh-text">' +
               '<span class="mh-name">ESP32-S3 Matrix</span>' +
               '<span class="mh-sub">Web control panel</span>' +
             '</span>' +
           '</a>';
  }

  function mount() {
    if (document.querySelector('.mh-card')) return; // idempotent
    injectStyleOnce();
    var host = document.querySelector('.wrap') || document.body;
    var tmp = document.createElement('div');
    tmp.innerHTML = markup();
    host.insertBefore(tmp.firstChild, host.firstChild);
  }

  global.MatrixHeader = { mount: mount };

  var cs = document.currentScript;
  if (cs && cs.hasAttribute('data-auto')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }
})(window);
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check esp32_matrix_webserver/data/header.js`
Expected: no output, exit 0 (syntax valid). (`node --check` only parses — it never executes the browser `window`/`document` references, so this is safe.)

- [ ] **Step 3: Commit**

```bash
git add esp32_matrix_webserver/data/header.js
git commit -m "feat(web): add shared logo header-card component (header.js)"
```

---

## Task 2: Wire `header.js` into `index.html` (and drop the old title)

**Files:**
- Modify: `esp32_matrix_webserver/data/index.html`

**Interfaces:**
- Consumes: `header.js` from Task 1 (the injected `.mh-card` replaces the removed `<header>`).

- [ ] **Step 1: Remove the old green title block**

In `esp32_matrix_webserver/data/index.html`, delete the header block inside `.wrap` (currently lines ~39–42):

```html
    <header>
      <h1>ESP32-S3 Matrix</h1>
      <p class="subtitle">Web control panel — served directly from the board</p>
    </header>
```

Delete those four lines entirely. (Leave the unused `header{…}`/`h1{…}` CSS rules in `<style>` — harmless, minimal diff.) The injected `.mh-card` now leads the page.

- [ ] **Step 2: Add the script tag**

In `esp32_matrix_webserver/data/index.html`, immediately before `</body>` (after the existing `<script src="bright.js"></script>` / inline script block, ~line 142), add:

```html
  <script src="header.js" data-auto></script>
```

- [ ] **Step 3: Verify the edit**

Run: `grep -c 'header.js' esp32_matrix_webserver/data/index.html` → Expected: `1`
Run: `grep -c 'served directly from the board' esp32_matrix_webserver/data/index.html` → Expected: `0`
(That phrase is unique to the removed subtitle — a reliable "old title is gone" check, unlike grepping `<header>` which also hits the `header{…}` CSS rule.)

- [ ] **Step 4: Commit**

```bash
git add esp32_matrix_webserver/data/index.html
git commit -m "feat(web): use logo header card on index, drop green text title"
```

---

## Task 3: Wire `header.js` into the 20 sub-pages

**Files:**
- Modify (add one script tag each): `animations.html`, `system.html`, `settings.html`, `claudesweep.html`, `fire.html`, `liquid.html`, `matrix_rain.html`, `snow.html`, `sketch.html`, `emoji.html`, `text.html`, `weather.html`, `weather2.html`, `timer.html`, `clock.html`, `calendar.html`, `sound.html`, `grid_test.html`, `temp.html`, `imu.html` (all under `esp32_matrix_webserver/data/`).
- **Do NOT touch** `presence-card.html` or `index.html`.

**Interfaces:**
- Consumes: `header.js` from Task 1. On each sub-page the injected `.mh-card` lands above the existing `<a class="back">← Home</a>`.

- [ ] **Step 1: Insert the script tag before `</body>` on each of the 20 pages**

For each file listed above, add this line immediately before its closing `</body>` tag:

```html
  <script src="header.js" data-auto></script>
```

Use this bash loop (Git Bash) to do all 20 idempotently — it inserts the tag only if the file doesn't already reference `header.js`:

```bash
cd esp32_matrix_webserver/data
for f in animations.html system.html settings.html claudesweep.html fire.html \
         liquid.html matrix_rain.html snow.html sketch.html emoji.html text.html \
         weather.html weather2.html timer.html clock.html calendar.html sound.html \
         grid_test.html temp.html imu.html; do
  if ! grep -q 'header.js' "$f"; then
    # insert before the last </body>
    perl -0pi -e 's{(\s*</body>)}{\n  <script src="header.js" data-auto></script>$1}' "$f"
  fi
done
cd ../..
```

- [ ] **Step 2: Verify all 20 now reference it (and the two exclusions do not)**

```bash
cd esp32_matrix_webserver/data
grep -lc 'header.js' animations.html system.html settings.html claudesweep.html fire.html \
  liquid.html matrix_rain.html snow.html sketch.html emoji.html text.html weather.html \
  weather2.html timer.html clock.html calendar.html sound.html grid_test.html temp.html imu.html | wc -l
# Expected: 20
grep -L 'header.js' presence-card.html   # Expected: presence-card.html (it must NOT have it)
cd ../..
```

Expected: first command prints `20`; second prints `presence-card.html`.

- [ ] **Step 3: Spot-check one page's tag placement**

Run: `grep -n 'header.js\|</body>' esp32_matrix_webserver/data/fire.html`
Expected: the `header.js` script line appears immediately before `</body>`.

- [ ] **Step 4: Commit**

```bash
git add esp32_matrix_webserver/data/*.html
git commit -m "feat(web): include logo header card on all 20 sub-pages"
```

---

## Task 4: Add the four logo weights (guarded by a test)

**Files:**
- Modify: `mcp_server/wait-weights.json`
- Modify (add test): `mcp_server/wait.test.ts`

**Interfaces:**
- Consumes: nothing new — `buildWaitPool`/`pickWait` (in `wait.ts`) already accept arbitrary names + weights; the four `wait-logo-*` names join the pool by prefix once their expression files exist (Task 5), and these weights tune them.
- Produces: `wait-weights.json` with the four entries at 10; a `node:test` guard asserting the shipped file's shape.

- [ ] **Step 1: Write the failing guard test**

First, **add these three imports at the TOP of `mcp_server/wait.test.ts`**, immediately after the existing `import { test }` / `import assert` lines (ES `import`s must be at module top level — do NOT place them lower in the file). Do **not** re-import `test` or `assert` (already imported):

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
```

Then **append this test at the END** of `mcp_server/wait.test.ts`. Note the file is **nested** — parse `.weights` (matching `loadWaitWeights` in `index.ts`, which reads `raw.weights`); reading the top-level object would make every key `undefined`:

```ts
test("shipped wait-weights.json keeps wait-claude dominant over the logo family, variants at 8", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(join(here, "wait-weights.json"), "utf8")) as { weights: Record<string, number> };
  const weights = raw.weights;
  assert.ok(weights && typeof weights === "object", "wait-weights.json must have a nested 'weights' object");
  const family = ["wait-logo-breathe", "wait-logo-chase", "wait-logo-boot", "wait-logo-ripple"];
  for (const name of family) {
    assert.equal(weights[name], 8, `${name} should be weighted 8`);
  }
  // wait-claude is the single largest entry AND outweighs the whole logo family.
  const max = Math.max(...Object.values(weights));
  assert.equal(weights["wait-claude"], max);
  const familyTotal = family.reduce((s, n) => s + weights[n], 0);
  assert.ok(weights["wait-claude"] >= familyTotal, "wait-claude (40) must stay >= the logo family total (32)");
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `cd mcp_server && npx tsx --test wait.test.ts`
Expected: FAIL — the four `wait-logo-*` keys are absent (`undefined !== 10`).

- [ ] **Step 3: Add the four entries to `wait-weights.json`**

The file is **nested**: `{ "_comment": "...", "weights": { ... } }`. **Keep the existing `_comment` string and all five existing weights**, and add the four `wait-logo-*` keys **inside the `weights` object** at weight **8**. The resulting `weights` object reads:

```json
  "weights": {
    "wait-claude": 40,
    "wait-rainbow": 30,
    "wait-orbit": 20,
    "claudesweep": 20,
    "working": 10,
    "wait-logo-breathe": 8,
    "wait-logo-chase": 8,
    "wait-logo-boot": 8,
    "wait-logo-ripple": 8
  }
```

Do NOT flatten the file (drop the `_comment`/`weights` envelope) — `loadWaitWeights()` reads `raw.weights`, so a flattened file silently disables ALL weighting (every entry falls back to 1). Append a short note to `_comment` that the four logo variants are 8 each.

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `cd mcp_server && npx tsx --test wait.test.ts`
Expected: PASS — all tests green (the new guard + the existing pool/pick tests).

- [ ] **Step 5: Commit**

```bash
git add mcp_server/wait-weights.json mcp_server/wait.test.ts
git commit -m "feat(mcp): weight the four wait-logo variants at 10 (wait-claude stays dominant)"
```

---

## Task 5: Author & save the four `wait-logo-*` expressions (live, hardware)

> **This task is performed live against the board via the matrix MCP tools by the
> controller (not a delegated subagent, not TDD) — frame-expressions can't be
> unit-tested; they're authored and verified on hardware.** The detail below is the
> reproducible spec for the live authoring.

**Files:**
- Create (via `matrix_animate` `save_as`): `mcp_server/expressions/wait-logo-breathe.json`, `mcp_server/expressions/wait-logo-chase.json`, `mcp_server/expressions/wait-logo-boot.json`, `mcp_server/expressions/wait-logo-ripple.json`. (`save_as` writes to `EXPR_DIR = mcp_server/expressions/` — alongside `wait-claude.json` — NOT a repo-root `expressions/`.)

**Canonical 8×8 geometry (shared by all four)** — five 2×2 blocks:

| Block | Pixels (x,y) | Color |
|---|---|---|
| TL | (0,0)(1,0)(0,1)(1,1) | green `#00ff88` |
| TR | (6,0)(7,0)(6,1)(7,1) | amber `#ffb000` |
| center | (3,3)(4,3)(3,4)(4,4) | cyan `#22ddff` |
| BL | (0,6)(1,6)(0,7)(1,7) | amber `#ffb000` |
| BR | (6,6)(7,6)(6,7)(7,7) | green `#00ff88` |

> **Brightness-floor warning (author for it, don't be surprised by it).** At low
> global brightness the FastLED scale `(channel×(bri+1))>>8` kills weak channels, so
> full-sat logo colors shift hue: at bri 5, amber `#ffb000` → ~pure red (its green
> 176 scales to 4), green `#00ff88` → pure green (blue 136→3), cyan `#22ddff` → loses
> red (34→0), reading green-blue. Wait expressions play at the board's CURRENT
> brightness (often higher than 5), but to stay legible at the low end: (a) keep any
> in-frame "dim" phase no lower than ~50% so secondary channels survive; (b) if the
> cyan center reads wrong at low bri, nudge it brighter (e.g. `#44eeff`). Verify each
> at the brightness the board is actually set to, not just on the framebuffer (which
> is pre-global-scaling and will look fine while the panel reads dark).

- [ ] **Step 1: Author `wait-logo-breathe`** — all 5 blocks fade dim→full→dim in unison, ~14–18 frames, looping. Keep the dim baseline's weakest channel above the bri-5 visibility floor. Design live with `matrix_animate`; verify with `GET /api/display/framebuffer`; `save_as: "wait-logo-breathe"`.

- [ ] **Step 2: Author `wait-logo-chase`** — all 5 blocks at a dim baseline; a brightness highlight travels the four corners clockwise (TL→TR→BR→BL→…), one bright per step, while the cyan center gently pulses. ~12–16 frames. `save_as: "wait-logo-chase"`.

- [ ] **Step 3: Author `wait-logo-boot`** — from blank, blocks light one-by-one clockwise (TL→TR→BR→BL→center), hold the full logo a beat, then clear and restart. ~12–16 frames. `save_as: "wait-logo-boot"`.

- [ ] **Step 4: Author `wait-logo-ripple`** — cyan center lights bright, then dims as the four corners light and fade outward (expanding sonar pulse from the core), looping. ~12–16 frames. `save_as: "wait-logo-ripple"`.

- [ ] **Step 5: Verify pool membership** — confirm each name is discoverable: `matrix_list_expressions` shows the four `wait-logo-*`; forcing each by name (`matrix_express("wait-logo-breathe")` …) plays it. Framebuffer-check each reads as the logo. **Restore board brightness + prior display afterward.**

- [ ] **Step 6: Commit the expression files**

```bash
git add mcp_server/expressions/wait-logo-breathe.json mcp_server/expressions/wait-logo-chase.json mcp_server/expressions/wait-logo-boot.json mcp_server/expressions/wait-logo-ripple.json
git commit -m "feat(express): four animated-logo wait variants (breathe/chase/boot/ripple)"
```

---

## Task 6: Version bump 0.8.0

**Files:**
- Modify (by tool): `VERSION`, `esp32_matrix_webserver/data/version.json`, `mcp_server/package.json`, `esp32_matrix_webserver/version.h`.

- [ ] **Step 1: Bump**

Run: `npm run bump:minor`
Expected: rewrites `VERSION` to `0.8.0`, stamps the three artifacts, creates a `chore: bump v0.8.0` commit. (Do NOT hand-edit `version.h` / `version.json`.)

- [ ] **Step 2: Verify the stamp**

Run: `npm run check`
Expected: repo `VERSION` is `0.8.0`; web + MCP report `0.8.0`. Firmware may show the older build (it isn't reflashed for this feature) — expected, note it.

---

## Task 7: Deploy & verification handoff (hardware — the user)

> These steps require the physical board and the user's eyes; they are the
> hardware half of the dev loop, not code.

- [ ] **Step 1: Deploy the web bundle** — the user runs **LittleFS Data Upload** (web files changed: `header.js` + all pages). No firmware flash needed.
- [ ] **Step 2: Header visual check** — every control page shows the logo header card at the top; the index no longer shows the old green text title; the logo links home; sub-pages still show `← Home` + their page title beneath the card; nothing overlaps on desktop or narrow widths; `presence-card.html` is unchanged.
- [ ] **Step 3: Animation check** — the four `wait-logo-*` read as the animated logo at brightness 5 (user's eyes); each appears in the wait rotation; `wait-claude` still clearly dominates.
- [ ] **Step 4: Drift check** — `matrix_version` shows web + MCP at 0.8.0; firmware older until next flash (expected).

---

## Self-Review

**Spec coverage:**
- Logo motif / favicon parity → Task 1 (`LOGO_SVG`), Global Constraints. ✓
- Richer 44px logo + ghost grid, dead-static → Task 1. ✓
- `header.js` `data-auto`, own `<style>`, idempotent, prepend `.wrap` → Task 1. ✓
- Index drops green title + gains tag → Task 2. ✓
- 20 sub-pages gain tag; `presence-card.html` + favicon excluded → Task 3, constraints. ✓
- Four `wait-logo-*` saved expressions, geometry + behaviors → Task 5. ✓
- Weights 8 each (nested `weights` object), `wait-claude` dominant over the family → Task 4. ✓
- Version 0.8.0 (web+MCP; firmware drift expected) → Task 6. ✓
- Deploy = LittleFS only; hardware verification → Task 7. ✓

**Placeholder scan:** none — all code/commands are concrete.

**Type/name consistency:** `.mh-card`/`.mh-logo`/`.mh-name`/`.mh-sub`/`mh-style` consistent across Task 1; `header.js` filename consistent across Tasks 1–3; `wait-logo-{breathe,chase,boot,ripple}` consistent across Tasks 4–5. ✓

**Note on tasks 5 & 7:** intentionally not TDD — frame-expression authoring and hardware deploy have no unit harness (matches the codebase; `bright.js`/animations aren't unit-tested either). Task 4 is the one genuinely unit-testable unit and is TDD'd.
