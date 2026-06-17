# Emoji feature-preservation — design

**Date:** 2026-06-15
**Status:** approved (Approach 1), pending spec review
**Scope:** web-only change to `esp32_matrix_webserver/data/emoji.html` (downscale + color
pipeline). No firmware change. Ships via a **LittleFS Data Upload**.

## Problem

Downscaling an emoji to 8×8 reads well for **silhouette** emoji (hearts, strawberry, food
— one dominant hue, solid shape) but collapses **feature-on-a-field** emoji (faces) into a
uniform muddy blob. The smiley's eyes and mouth vanish; you can't tell it's a face.

## Root cause (confirmed in current code)

A face is a big flat bright field (yellow) whose meaning lives in **small dark interior
features** (eyes, mouth). The pipeline destroys those features in two compounding ways:

1. **Box-average downscale** (`renderEmoji`, ~line 300) blends a block that straddles the
   yellow field and a dark eye into brown. The existing inverse-luminance weighting helps a
   little but isn't decisive.
2. **The vibrance value-lift** (`punchColors`, line 260: `v = v + (1-v)*k*0.45`) then
   *brightens* dark cells. Helpful for genuinely muddy dark regions that should be a vivid
   color, but it actively erases the dark eye/mouth cells, collapsing contrast against the
   field. At high vibrance (e.g. 83) it's pronounced.

Silhouette emoji are unaffected because they have no interior features to preserve.

## Approach 1 — targeted two-fix

Surgical fixes to the two functions that fight each other. Keeps every emoji that already
reads; adds no new UI controls (the Vibrance slider stays).

### Fix A — feature-snap in the downscale (`renderEmoji`)

1. **Establish a bright baseline `fieldL`** once over the whole render: a high percentile
   (~75th) of the luminance of opaque pixels. For a face this is the yellow field; for a
   uniformly-colored emoji it's just that color.
2. **Classify pixels:** a pixel is an **ink/feature** pixel if its luminance
   `< fieldL * FEATURE_RATIO` — i.e. distinctly darker than the field.
3. **Per 8×8 cell:**
   - Compute `inkFrac` = fraction of the cell's opaque pixels that are ink.
   - If `inkFrac >= FEATURE_SNAP`: output the **average of the ink pixels only** (the
     feature's own dark color), snapping eye/mouth cells crisp and dark.
   - Else: output the average of the **non-ink (field) pixels only**, keeping the field
     color clean instead of dragging it toward brown.
   - Empty cell (too few opaque px, existing `MIN_OPAQUE` rule) stays `#000000`.

This sharpens the boundary: a mostly-yellow block with a sliver of eye stays clean yellow;
a mostly-eye block snaps dark. Emoji with no ink pixels (solid hearts) behave exactly as
before. Replaces the current inverse-luminance weighting (feature-snap supersedes it).

### Fix B — contrast-gate the value-lift (`punchColors`)

Restructure to compute a luminance grid first, then per cell:
- `localMeanL` = mean luminance of present 8-neighbors.
- If `cellL < localMeanL * LOCAL_DARK_RATIO` → the cell is a **local dark feature**: skip
  the value-lift and deepen slightly (`v *= FEATURE_DEEPEN`) to crisp it.
- Else → uniform region: apply the existing value-lift.

Saturation punch is unchanged (including the achromatic guard that stops white turning
pink). This guarantees vibrance can't undo Fix A's dark features.

### Tunables (named constants near the top of the script)

| Const | Start | Meaning |
|---|---|---|
| `FEATURE_RATIO` | 0.50 | pixel is ink if `L < fieldL * this` |
| `FEATURE_SNAP` | 0.30 | cell snaps to ink if `inkFrac ≥ this` |
| `LOCAL_DARK_RATIO` | 0.70 | cell is a feature if darker than `this ×` neighbor mean |
| `FEATURE_DEEPEN` | 0.85 | how much to deepen a detected feature cell |

All four are tuned live against the preview; these are starting values.

## Success criteria

- **Faces read at a glance:** 😊 / 😀 / 😎 show two distinct dark eye cells + a mouth, and
  a human identifies them as a face on the panel (silhouette test).
- **No regression:** ❤️ 🧡 🍓 🍕 ⭐ look the same or better.
- **Mixed bright+dark:** 💀 (white skull, dark sockets) reads better, not worse.
- **Fully automatic** for any emoji in the list; no new sliders.

## Out of scope

- Curated 8×8 sprites for stubborn emoji (the "curate later" fallback — only if specific
  faces still fail after this).
- Animated emoji, new emoji in the list, firmware/board changes.

## Verification loop

Web-only → **LittleFS Data Upload**, then browser refresh (no firmware flash). Test set,
eyeballed in the live preview + a couple pushed to the board:
- Faces: 😊 😀 😎 😢
- Silhouette regression: ❤️ 🍓 🍕
- Mixed: 💀  · Simple: ⭐

Iterate the four tunables against the preview until the faces read without regressing the
silhouette set.
