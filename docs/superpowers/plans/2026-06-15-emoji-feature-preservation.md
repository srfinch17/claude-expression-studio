# Emoji Feature-Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make feature-on-a-field emoji (faces) readable on the 8×8 panel without
regressing silhouette emoji (hearts/food), by fixing the downscale and the color punch.

**Architecture:** Two surgical changes to `data/emoji.html`'s in-browser pipeline.
Fix A (downscale) classifies each source pixel as dark "ink" (feature) vs bright "field"
and snaps each 8×8 cell to one or the other instead of box-averaging to mud. Fix B stops
the vibrance value-lift from re-brightening cells that are dark relative to their
neighbours. A lands first; B layers on top.

**Tech Stack:** Vanilla JS in `esp32_matrix_webserver/data/emoji.html` (canvas 2D
downscale + HSV color punch). No firmware. Ships via **LittleFS Data Upload**.

**Verification model:** No automated tests — this project verifies visually on hardware
(`CLAUDE.md` dev loop). Each task ends with a LittleFS upload + browser refresh and a
look at the live preview (which renders exact board output). The user is the eyes.

**Spec:** `docs/superpowers/specs/2026-06-15-emoji-feature-preservation-design.md`

---

## File Structure

- Modify: `esp32_matrix_webserver/data/emoji.html`
  - Add a shared `luma(r,g,b)` helper (used by both fixes).
  - Replace `renderEmoji` (Fix A).
  - Replace `punchColors` (Fix B).
  - Add four named tunable constants near the top of the `<script>`.

No other files change.

---

## Task 1: Fix A — feature-snap downscale

**Files:**
- Modify: `esp32_matrix_webserver/data/emoji.html` (the `<script>` block, ~lines 189-322)

- [ ] **Step 1: Add the tunable constants + `luma` helper**

After the `let vibrance = 60;` line (~line 197), add:

```js
    // ── Feature-preservation tunables (dialed in live against the preview) ──────────
    const FEATURE_RATIO = 0.50;  // a source pixel is "ink" (a feature) if its luminance < fieldL * this
    const FEATURE_SNAP  = 0.30;  // a cell snaps to ink if at least this fraction of its pixels are ink
```

In the color-helpers section (after `toHex`, ~line 208) add:

```js
    function luma(r, g, b) { return r * 0.299 + g * 0.587 + b * 0.114; }
```

- [ ] **Step 2: Replace `renderEmoji` with the feature-snap version**

Replace the entire `renderEmoji` function (the block starting `function renderEmoji(emoji) {`
through its closing `}` and `return matrix;`) with:

```js
    // Renders onto a 192×192 canvas, then downsamples to 8×8 by classifying each source
    // pixel as dark "ink" (a feature: eye/mouth/outline) vs bright "field" and snapping
    // each cell to one or the other — so thin dark features survive instead of averaging
    // into brown mud. See the feature-preservation spec.
    function renderEmoji(emoji) {
      const SIZE  = 192;
      const BLOCK = SIZE / 8;
      const MIN_OPAQUE = (BLOCK * BLOCK * 0.06) | 0;

      canvas.width  = SIZE;
      canvas.height = SIZE;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.font = `${(SIZE * 0.82) | 0}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, SIZE / 2, SIZE / 2);

      const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

      // Pass 1 — bright-field luminance = 75th percentile of opaque pixels. For a face
      // this is the yellow disc; for a solid emoji it's just that color.
      const lumas = [];
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 3] > 50) lumas.push(luma(data[i], data[i+1], data[i+2]));
      if (!lumas.length) return Array.from({ length: 8 }, () => Array(8).fill('#000000'));
      lumas.sort((a, b) => a - b);
      const fieldL = lumas[Math.min(lumas.length - 1, Math.floor(lumas.length * 0.75))];
      const inkThreshold = fieldL * FEATURE_RATIO;

      // Pass 2 — per 8×8 cell, accumulate ink vs field pixels separately, then snap.
      const matrix = [];
      for (let by = 0; by < 8; by++) {
        const row = [];
        for (let bx = 0; bx < 8; bx++) {
          let iR=0,iG=0,iB=0,iN=0;   // ink (feature) accumulators
          let fR=0,fG=0,fB=0,fN=0;   // field accumulators
          for (let py = 0; py < BLOCK; py++) {
            for (let px = 0; px < BLOCK; px++) {
              const ix = bx * BLOCK + px;
              const iy = by * BLOCK + py;
              const i  = (iy * SIZE + ix) * 4;
              if (data[i + 3] <= 50) continue;
              const Lp = luma(data[i], data[i+1], data[i+2]);
              if (Lp < inkThreshold) { iR+=data[i]; iG+=data[i+1]; iB+=data[i+2]; iN++; }
              else                   { fR+=data[i]; fG+=data[i+1]; fB+=data[i+2]; fN++; }
            }
          }
          const opaque = iN + fN;
          if (opaque < MIN_OPAQUE)              row.push('#000000');
          else if (iN / opaque >= FEATURE_SNAP) row.push(toHex(iR/iN, iG/iN, iB/iN)); // snap to feature
          else if (fN)                          row.push(toHex(fR/fN, fG/fN, fB/fN)); // clean field
          else                                  row.push(toHex(iR/iN, iG/iN, iB/iN)); // all-ink cell
        }
        matrix.push(row);
      }
      return matrix;
    }
```

This removes the old inverse-luminance weighting — feature-snap supersedes it.

- [ ] **Step 3: Verify on the live preview**

Have the user: close Serial Monitor → **Ctrl+Shift+P → "Upload LittleFS to Pico/ESP8266/ESP32"**
→ refresh `http://192.168.1.8/emoji.html`.

Expected on the preview, with vibrance still mid (~60):
- 😊 / 😀 / 😎 now show **distinct dark eye cells and a dark mouth** against the yellow
  field (not a uniform blob).
- ❤️ 🍓 🍕 ⭐ look the same as before (no regression).
- 💀 shows darker eye sockets.

If faces read well here, B may be optional — but proceed to Task 2, because high vibrance
will still wash them out (that's exactly what B fixes).

- [ ] **Step 4: Commit**

```bash
git add esp32_matrix_webserver/data/emoji.html
git commit -m "feat(emoji): feature-snap downscale so faces keep eyes/mouth at 8x8"
```

---

## Task 2: Fix B — contrast-gated value-lift

**Files:**
- Modify: `esp32_matrix_webserver/data/emoji.html` (the `punchColors` function, ~lines 250-264)

- [ ] **Step 1: Add the two tunables**

Next to the Task 1 constants (after `FEATURE_SNAP`), add:

```js
    const LOCAL_DARK_RATIO = 0.70;  // a cell is a "feature" if darker than this × its neighbour-mean luminance
    const FEATURE_DEEPEN   = 0.85;  // deepen a detected feature cell's value by this (crisper, no lift)
```

- [ ] **Step 2: Replace `punchColors` with the contrast-gated version**

Replace the entire `punchColors` function with:

```js
    function punchColors(matrix, amount) {
      const k = amount / 100;                       // 0 = none, 1 = full punch
      // Per-cell luminance grid (black cells = 0) so we can judge local contrast.
      const L = matrix.map(row => row.map(hex => {
        const [r,g,b] = parseHex(hex);
        return luma(r, g, b);
      }));
      return matrix.map((row, y) => row.map((hex, x) => {
        const [r,g,b] = parseHex(hex);
        if (r===0 && g===0 && b===0) return '#000000';
        let [h,s,v] = rgb2hsv(r,g,b);
        // Saturation boost, ramped by ORIGINAL saturation so achromatic cells (white/gray)
        // stay achromatic instead of turning pink.
        s = Math.min(1, s + (1 - s) * k * Math.min(1, s / 0.15));

        // Local-contrast gate: if this cell is dark relative to its (non-black) neighbours
        // it's a feature (eye/mouth) — keep it dark. Otherwise lift muddy/dark fill cells.
        let sum = 0, n = 0;
        for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
          if (!dy && !dx) continue;
          const ny=y+dy, nx=x+dx;
          if (ny<0||ny>7||nx<0||nx>7) continue;
          if (L[ny][nx] <= 0) continue;            // ignore black/empty neighbours
          sum += L[ny][nx]; n++;
        }
        const localMean = n ? sum / n : 0;
        if (n && L[y][x] < localMean * LOCAL_DARK_RATIO) v = v * FEATURE_DEEPEN;
        else v = Math.min(1, v + (1 - v) * k * 0.45);

        const [nr,ng,nb] = hsv2rgb(h,s,v);
        return toHex(nr,ng,nb);
      }));
    }
```

`rgb2hsv` returns `v` in 0..1; the `L` grid is in 0..255 — both comparisons are
self-consistent (grid vs grid, v vs v), so no scaling mismatch.

- [ ] **Step 3: Verify on the live preview**

LittleFS upload + refresh again. Expected:
- Drag **Vibrance to 80-100**: faces stay readable — eyes/mouth stay dark and crisp
  instead of washing out (the original bug). Field colors still get bolder.
- Silhouette emoji (❤️ 🍓) still look bold/clean, no regression.

- [ ] **Step 4: Commit**

```bash
git add esp32_matrix_webserver/data/emoji.html
git commit -m "feat(emoji): contrast-gate vibrance value-lift so it can't erase features"
```

---

## Task 3: Live tuning pass

**Files:**
- Modify: `esp32_matrix_webserver/data/emoji.html` (the four tunable constants only)

- [ ] **Step 1: Run the test set and judge**

With both fixes in, walk the test set in the preview AND push 2-3 to the board:
- Faces: 😊 😀 😎 😢   · Silhouette regression: ❤️ 🍓 🍕   · Mixed: 💀   · Simple: ⭐

- [ ] **Step 2: Adjust constants if needed**

Tuning guide (change one at a time, re-upload, re-judge):
- Faces still muddy / features faint → **raise** `FEATURE_RATIO` (0.50 → 0.60) and/or
  **lower** `FEATURE_SNAP` (0.30 → 0.22) so more cells count as features.
- Field eaten / silhouette emoji turning splotchy-dark → **lower** `FEATURE_RATIO` and/or
  **raise** `FEATURE_SNAP`.
- Features visible but not dark enough at high vibrance → **lower** `FEATURE_DEEPEN`
  (0.85 → 0.75) or **raise** `LOCAL_DARK_RATIO` (0.70 → 0.80, catches more feature cells).

- [ ] **Step 3: Commit the tuned values (if changed)**

```bash
git add esp32_matrix_webserver/data/emoji.html
git commit -m "tune(emoji): feature-preservation constants for the panel"
```

- [ ] **Step 4: Flip ROADMAP status**

When faces read and the silhouette set hasn't regressed, note Emoji as hardware-verified
in `docs/ROADMAP.md` (Phase 3) and update the emoji auto-memory.

---

## Self-Review

**Spec coverage:** Fix A → Task 1; Fix B → Task 2; four tunables → defined in Tasks 1-2,
exercised in Task 3; success criteria + test set → Task 3 Step 1. All spec sections covered.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; verification steps
give exact commands/emoji and expected outcomes.

**Type consistency:** `luma(r,g,b)` defined once (Task 1), used in `renderEmoji` and
`punchColors`. `FEATURE_RATIO`/`FEATURE_SNAP` (Task 1) and `LOCAL_DARK_RATIO`/
`FEATURE_DEEPEN` (Task 2) names match their usage. `toHex`/`parseHex`/`rgb2hsv`/`hsv2rgb`
are pre-existing and unchanged.
