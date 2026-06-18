#!/usr/bin/env python3
"""Generate wait-rainbow.json — a spinning rainbow color-wheel wait animation
(old-Mac "spinning pinwheel" vibe) for the ESP32-S3 8x8 matrix.

Design notes (see emoting-on-8x8 skill):
- At board brightness ~5 a true rainbow collapses (red/orange/yellow merge). So we
  use 6 CHANNEL-DISTINCT hues — each lights a different R/G/B combination — which is
  the most separable palette at low brightness. The spinning motion carries the
  "wait spinner" read even where adjacent hues blur.
- The disc has 6 SECTORS but each is a DIFFERENT color, so the pattern only maps
  onto itself after a FULL 360deg turn (color breaks the 6-fold shape symmetry).
  The loop must therefore sweep the whole circle. 24 frames (the firmware max) x
  15deg = a continuous full revolution; at the rim that's <1px travel per frame, so
  it still reads smooth, and the ~30px disc keeps the payload light enough.

Output is the saved-expression format (Expression interface): text-art rows using
color chars + a colors map. Re-run after tuning; it overwrites the JSON in place.
"""
import json
import math
import os

# 6 channel-distinct hues (R / R+G / G / G+B / B / R+B) — maximally separable at bri 5.
PALETTE = {
    "R": "#ff0000",  # red      (R)
    "Y": "#ffff00",  # yellow   (R+G)
    "G": "#00ff00",  # green    (G)
    "C": "#00ffff",  # cyan     (G+B)
    "B": "#0040ff",  # blue     (B)
    "M": "#ff00ff",  # magenta  (R+B)
}
SECTORS = list(PALETTE.keys())          # 6 sectors, 60deg each
CENTER = 3.5                            # 8x8 has no integer center
RADIUS = 3.7                            # disc radius -> round filled blob, corners off
N_FRAMES = 24                          # firmware MAX_PLAY_FRAMES; one full revolution
STEP_DEG = 360.0 / N_FRAMES            # 15deg per frame -> continuous, seamless full spin


def frame(rot_deg: float) -> list[str]:
    rows = []
    for y in range(8):
        row = ""
        for x in range(8):
            dx, dy = x - CENTER, y - CENTER
            if math.hypot(dx, dy) > RADIUS:
                row += "."
                continue
            # atan2 -> [0,360); subtract rotation so the wheel spins one direction.
            ang = (math.degrees(math.atan2(dy, dx)) - rot_deg) % 360.0
            row += SECTORS[int(ang // 60.0) % 6]
        rows.append(row)
    return rows


def main() -> None:
    expr = {
        "description": (
            "Spinning rainbow color wheel (old-Mac pinwheel) — a wait/working "
            "spinner. Auto-joins the random 'wait' pool via its wait- name."
        ),
        "frames": [frame(i * STEP_DEG) for i in range(N_FRAMES)],
        "colors": PALETTE,
        "frame_ms": 90,
        "loop": 0,
    }
    out = os.path.join(os.path.dirname(__file__), "..", "mcp_server", "expressions", "wait-rainbow.json")
    out = os.path.abspath(out)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(expr, f, indent=2)
        f.write("\n")
    # Echo frame 0 so we can eyeball the silhouette without the board.
    print(f"wrote {out}\nframe 0:")
    for r in expr["frames"][0]:
        print("  " + r)


if __name__ == "__main__":
    main()
