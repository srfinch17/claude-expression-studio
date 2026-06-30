#!/usr/bin/env python3
"""Generate the four animated-logo wait expressions for the ESP32-S3 8x8 matrix:
wait-logo-breathe / chase / boot / ripple.

All four animate the board's quincunx LOGO, five 2x2 blocks:
  TL green, TR amber, center cyan, BL amber, BR green
(the same motif as the favicon / header.js logo).

Design notes (see emoting-on-8x8 skill + docs/LED_BRIGHTNESS.md):
- At low global brightness FastLED's (channel x (bri+1))>>8 kills weak channels, so
  full-sat colors shift hue (amber->red, green loses blue, cyan loses red). To keep
  the center reading as CYAN we bump it to #44eeff (red 0x44=68, above the bri-5
  floor of ~43). For the same reason the dimmest in-frame level used here is ~0.45,
  never near-zero, so a "dim" block stays a recognizable color instead of vanishing.
- Output is the saved-expression format (Expression interface): text-art rows using
  per-(color,level) chars + a colors map. Frames stay <= 24 (firmware MAX) and the
  logo is sparse (<= 20 lit px/frame), so the payload is featherweight. Re-run after
  tuning; it overwrites the JSON in place.
"""
import json
import math
import os
import string

# ---- logo geometry: five 2x2 blocks, each a base RGB color -------------------
GREEN = (0x00, 0xff, 0x88)
AMBER = (0xff, 0xb0, 0x00)
CYAN  = (0x44, 0xee, 0xff)   # bumped from #22ddff so red survives the bri-5 floor

TL = [(0, 0), (1, 0), (0, 1), (1, 1)]
TR = [(6, 0), (7, 0), (6, 1), (7, 1)]
BL = [(0, 6), (1, 6), (0, 7), (1, 7)]
BR = [(6, 6), (7, 6), (6, 7), (7, 7)]
CT = [(3, 3), (4, 3), (3, 4), (4, 4)]

BLOCKS = {            # name -> (pixel list, base color)
    "TL": (TL, GREEN),
    "TR": (TR, AMBER),
    "BR": (BR, GREEN),
    "BL": (BL, AMBER),
    "CT": (CT, CYAN),
}
CORNERS_CW = ["TL", "TR", "BR", "BL"]   # clockwise corner order


def scale(rgb, f):
    """Scale an (r,g,b) toward black by factor f in [0,1], rounding per channel."""
    return tuple(max(0, min(255, round(c * f))) for c in rgb)


def hexstr(rgb):
    return "#%02x%02x%02x" % rgb


def blank():
    """8x8 grid of None (off)."""
    return [[None for _ in range(8)] for _ in range(8)]


def paint(grid, block_name, f):
    """Light a named block at brightness factor f (skipped if f<=0)."""
    if f <= 0:
        return
    pixels, base = BLOCKS[block_name]
    rgb = scale(base, f)
    for (x, y) in pixels:
        grid[y][x] = rgb


def to_art(frames_rgb):
    """Convert a list of 8x8 RGB-or-None grids into (art_frames, colors map).
    Assigns a stable char per unique hex; '.' is off."""
    palette = {}                       # hex -> char
    pool = iter(string.ascii_uppercase + string.ascii_lowercase + string.digits)
    art_frames = []
    for grid in frames_rgb:
        rows = []
        for y in range(8):
            row = ""
            for x in range(8):
                rgb = grid[y][x]
                if rgb is None:
                    row += "."
                    continue
                h = hexstr(rgb)
                if h not in palette:
                    palette[h] = next(pool)
                row += palette[h]
            rows.append(row)
        art_frames.append(rows)
    colors = {ch: h for h, ch in palette.items()}
    return art_frames, colors


# ---- the four animations -----------------------------------------------------
def breathe():
    """All 5 blocks fade together 0.5<->1.0, sinusoidal, looping. 16 frames."""
    N = 16
    grids = []
    for i in range(N):
        f = 0.5 + 0.5 * (0.5 - 0.5 * math.cos(2 * math.pi * i / N))  # 0.5..1.0
        g = blank()
        for name in BLOCKS:
            paint(g, name, f)
        grids.append(g)
    return grids, 90


def chase():
    """All blocks at a 0.5 baseline; a full-bright highlight steps the corners
    clockwise (2 frames each); the center pulses 0.5<->1.0. 8 frames."""
    N = 8
    grids = []
    for i in range(N):
        active = CORNERS_CW[(i // 2) % 4]
        cf = 0.5 + 0.5 * (0.5 - 0.5 * math.cos(2 * math.pi * i / N))  # center pulse
        g = blank()
        for name in CORNERS_CW:
            paint(g, name, 1.0 if name == active else 0.5)
        paint(g, "CT", cf)
        grids.append(g)
    return grids, 120


def boot():
    """From blank, light blocks one-by-one clockwise (TL,TR,BR,BL,center) at full,
    hold the full logo, then loop back to blank. 8 frames."""
    order = ["TL", "TR", "BR", "BL", "CT"]
    grids = []
    grids.append(blank())                         # f0: blank
    lit = []
    for name in order:                            # f1..f5: accumulate
        lit.append(name)
        g = blank()
        for n in lit:
            paint(g, n, 1.0)
        grids.append(g)
    # f6,f7: hold the full logo
    full = blank()
    for n in order:
        paint(full, n, 1.0)
    grids.append([r[:] for r in full])
    grids.append([r[:] for r in full])
    return grids, 110


def ripple():
    """Sonar from the core: center lights, then dims as corners light and fade
    outward, then all off; loops. 7 frames."""
    # (center_factor, corner_factor) per frame
    steps = [
        (1.0, 0.0),
        (0.7, 0.35),
        (0.4, 0.7),
        (0.0, 1.0),
        (0.0, 0.55),
        (0.0, 0.25),
        (0.0, 0.0),
    ]
    grids = []
    for (cf, kf) in steps:
        g = blank()
        paint(g, "CT", cf)
        for name in CORNERS_CW:
            paint(g, name, kf)
        grids.append(g)
    return grids, 110


SPECS = {
    "wait-logo-breathe": (
        breathe,
        "Animated board logo (quincunx of 5 dots) breathing, all five blocks fade "
        "in and out together, a calm heartbeat. A wait/working spinner; auto-joins "
        "the random 'wait' pool via its wait- name.",
    ),
    "wait-logo-chase": (
        chase,
        "Animated board logo, a bright highlight chases clockwise around the four "
        "corners while the cyan center pulses, reading as 'computing'. A wait spinner; "
        "auto-joins the random 'wait' pool via its wait- name.",
    ),
    "wait-logo-boot": (
        boot,
        "Animated board logo powering up, blocks light one by one clockwise then the "
        "full logo holds before restarting. A wait spinner; auto-joins the random "
        "'wait' pool via its wait- name.",
    ),
    "wait-logo-ripple": (
        ripple,
        "Animated board logo as sonar, the cyan core pulses and ripples outward to "
        "the corners, then fades. A wait spinner; auto-joins the random 'wait' pool "
        "via its wait- name.",
    ),
}


def main():
    out_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "mcp_server", "expressions")
    )
    for name, (fn, desc) in SPECS.items():
        grids, frame_ms = fn()
        art, colors = to_art(grids)
        expr = {
            "description": desc,
            "frames": art,
            "colors": colors,
            "frame_ms": frame_ms,
            "loop": 0,
        }
        path = os.path.join(out_dir, name + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(expr, f, indent=2)
            f.write("\n")
        print(f"wrote {path}  ({len(art)} frames, {len(colors)} colors)")


if __name__ == "__main__":
    main()
