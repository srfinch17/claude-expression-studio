#!/usr/bin/env python3
"""Generate the awaiting-input + completion expressions for the ESP32-S3 8x8 matrix:
ask-question / ask-attention (awaiting input) plus task-complete (a completion glyph,
formerly ask-confirm, the '?' now covers plan-approval too, so ExitPlanMode fires
ask-question). Fired by the Claude Code hooks (see the awaiting-input spec).

Design notes (emoting-on-8x8 + docs/LED_BRIGHTNESS.md):
- These play at the board's CURRENT brightness, which is often the bri-5 ambient
  floor, where FastLED's (channel x (bri+1))>>8 kills any channel below ~43. So:
  - the confirm BOX uses a bright gray #b8b8b8 (184 -> survives) not a dim gray that
    would vanish at bri 5;
  - the question mark uses cyan #44eeff (red 0x44=68, survives) like the wait-logo set;
  - the attention BELL is amber #ffb000, note its green channel (176) lands near the
    floor at bri 5, so amber reads more orange/red there; the bell SHAPE carries the
    meaning. Flagged for live tuning with the user's eyes.
- loop:0 so each HOLDS until a later display command replaces it (Claude waiting).
Output is the saved-expression format; re-run to overwrite the JSON in place.
"""
import json
import math
import os
import string

WHITE = (0xff, 0xff, 0xff)
CYAN  = (0x44, 0xee, 0xff)   # bri-5-safe cyan (matches wait-logo center)
GREEN = (0x00, 0xff, 0x88)
AMBER = (0xff, 0xb0, 0x00)
BOXGRAY = (0xb8, 0xb8, 0xb8)  # bright enough to survive the bri-5 floor


def scale(rgb, f):
    return tuple(max(0, min(255, round(c * f))) for c in rgb)


def hexstr(rgb):
    return "#%02x%02x%02x" % rgb


def blank():
    return [[None for _ in range(8)] for _ in range(8)]


def put(grid, x, y, rgb):
    if 0 <= x < 8 and 0 <= y < 8:
        grid[y][x] = rgb


def to_art(frames_rgb):
    palette, art = {}, []
    pool = iter(string.ascii_uppercase + string.ascii_lowercase + string.digits)
    for grid in frames_rgb:
        rows = []
        for y in range(8):
            row = ""
            for x in range(8):
                rgb = grid[y][x]
                if rgb is None:
                    row += "."
                else:
                    h = hexstr(rgb)
                    if h not in palette:
                        palette[h] = next(pool)
                    row += palette[h]
            rows.append(row)
        art.append(rows)
    return art, {ch: h for h, ch in palette.items()}


# ---- ask-question: a "?" that pulses, with a white shine sweeping its stroke ----
# Glyph pixels in stroke order (top-left of the curve, around, down to the dot).
Q_STROKE = [(1, 1), (2, 0), (3, 0), (4, 0), (5, 1), (5, 2), (4, 3), (3, 4), (3, 5), (3, 7)]


def ask_question():
    N = len(Q_STROKE)  # one frame per stroke pixel => single clean sweep, no backtrack
    grids = []
    for i in range(N):
        pulse = 0.6 + 0.4 * (0.5 - 0.5 * math.cos(2 * math.pi * i / N))  # 0.6..1.0
        shine_idx = i % len(Q_STROKE)
        g = blank()
        for k, (x, y) in enumerate(Q_STROKE):
            if k == shine_idx:
                put(g, x, y, WHITE)                 # the moving glint
            else:
                put(g, x, y, scale(CYAN, pulse))
        grids.append(g)
    return grids, 110


# ---- task-complete: a box, then a green check draws in stroke-by-stroke, holds -----
# (Formerly ask-confirm; promoted to a completion glyph. The '?' covers plan-approval.)
def box_pixels():
    px = []
    for x in range(1, 7):
        px.append((x, 1)); px.append((x, 6))
    for y in range(2, 6):
        px.append((1, y)); px.append((6, y))
    return px


CHECK_STROKE = [(2, 4), (3, 5), (4, 4), (5, 3), (6, 2)]  # low point then up-right


def task_complete():
    grids = []
    box = box_pixels()
    # f0: box only; f1..f5: reveal the check one pixel at a time
    for n in range(0, len(CHECK_STROKE) + 1):
        g = blank()
        for (x, y) in box:
            put(g, x, y, BOXGRAY)
        for (x, y) in CHECK_STROKE[:n]:
            put(g, x, y, GREEN)
        grids.append(g)
    # hold the full check with a gentle throb, then loop back to the bare box
    for f in (1.0, 0.7):
        g = blank()
        for (x, y) in box:
            put(g, x, y, BOXGRAY)
        for (x, y) in CHECK_STROKE:
            put(g, x, y, scale(GREEN, f))
        grids.append(g)
    return grids, 120


# ---- ask-attention: a fixed bell, clapper swings, side ticks flash (ringing) -----
BELL = [(3, 0),
        (2, 1), (3, 1), (4, 1),
        (2, 2), (3, 2), (4, 2),
        (1, 3), (2, 3), (3, 3), (4, 3), (5, 3),
        (1, 4), (2, 4), (3, 4), (4, 4), (5, 4),
        (0, 5), (1, 5), (2, 5), (3, 5), (4, 5), (5, 5), (6, 5)]
CLAPPER_SWING = [3, 4, 3, 2, 3, 4, 3, 2]
TICK_L, TICK_R = (0, 3), (6, 3)


def ask_attention():
    grids = []
    for i, cx in enumerate(CLAPPER_SWING):
        g = blank()
        for (x, y) in BELL:
            put(g, x, y, AMBER)
        put(g, cx, 6, AMBER)                 # swinging clapper
        if cx == 4:
            put(g, TICK_R[0], TICK_R[1], WHITE)   # ring tick on the swing side
        elif cx == 2:
            put(g, TICK_L[0], TICK_L[1], WHITE)
        grids.append(g)
    return grids, 95


SPECS = {
    "ask-question": (ask_question,
        "Awaiting input, a pulsing cyan '?' with a white shine sweeping its stroke. "
        "Fired when Claude poses a questionnaire and is waiting for the user's answer. "
        "Holds (loop 0) until replaced."),
    "task-complete": (task_complete,
        "Task complete, an empty box with a green checkmark drawing itself in, then "
        "holding. A completion/done glyph (formerly ask-confirm; the '?' now covers "
        "plan-approval). Currently unwired, assign to an event in the Studio."),
    "ask-attention": (ask_attention,
        "Awaiting input, an amber bell ringing (clapper swings, side ticks flash). "
        "Fired when Claude needs the user's permission. Holds (loop 0) until replaced."),
}


def main():
    out_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "mcp_server", "expressions"))
    for name, (fn, desc) in SPECS.items():
        grids, frame_ms = fn()
        art, colors = to_art(grids)
        # sanity: every frame is 8 rows x 8 chars (matches the firmware/parser contract)
        assert len(art) <= 24, f"{name}: too many frames"
        for f in art:
            assert len(f) == 8 and all(len(r) == 8 for r in f), f"{name}: frame not 8x8"
        expr = {"description": desc, "frames": art, "colors": colors,
                "frame_ms": frame_ms, "loop": 0}
        path = os.path.join(out_dir, name + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(expr, f, indent=2)
            f.write("\n")
        print(f"wrote {path}  ({len(art)} frames, {len(colors)} colors)")


if __name__ == "__main__":
    main()
