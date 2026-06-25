#!/usr/bin/env python3
"""Render an 8x8 frame-expression JSON into a PNG "contact sheet" so any agent (or
human) can SEE the animation without the board or a browser.

Each frame is drawn as an upscaled 8x8 panel with an additive bloom (mimicking the
real LED glow), laid left-to-right (wrapping), numbered, with a title bar showing
name / frame_ms / loop / frame-count. This is the feedback loop for building and
critiquing 8x8 animations: build frames -> render -> LOOK -> iterate.

Input JSON (the saved-expression format):
  { "frames": [ ["8 chars" x8], ... ],
    "colors": { "A": "#rrggbb", ... },   # '.' = off
    "frame_ms": 120, "loop": 0, "description": "..." }

Usage:
  python render-contact-sheet.py <anim.json> [-o out.png] [--cell 26] [--per-row 8] [--no-glow]

Exits non-zero with a clear message on malformed input (bad frame size, unknown
color char) so a generator can self-check before shipping.
"""
import argparse
import json
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
except ImportError:
    sys.exit("Pillow is required: pip install Pillow")

BG = (10, 10, 13)
GRID = (24, 24, 30)
TEXT = (170, 172, 184)


def hex_rgb(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def load_font(size):
    for name in ("consola.ttf", "DejaVuSansMono.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def validate(frames, colors):
    for fi, fr in enumerate(frames):
        if len(fr) != 8:
            sys.exit(f"frame {fi}: has {len(fr)} rows, expected 8")
        for ri, row in enumerate(fr):
            if len(row) != 8:
                sys.exit(f"frame {fi} row {ri}: '{row}' is {len(row)} chars, expected 8")
            for ch in row:
                if ch != "." and ch not in colors:
                    sys.exit(f"frame {fi} row {ri}: char '{ch}' not in colors {list(colors)}")


def render(data, cell=26, per_row=8, glow=True):
    frames = data["frames"]
    colors = {k: hex_rgb(v) for k, v in data.get("colors", {}).items()}
    validate(frames, colors)

    n = len(frames)
    per_row = max(1, min(per_row, n))
    rows = (n + per_row - 1) // per_row

    panel = cell * 8
    pad = 14           # gap between panels
    label_h = 16       # frame index strip under each panel
    title_h = 34
    margin = 16

    block_w = panel + pad
    block_h = panel + label_h + pad
    W = margin * 2 + per_row * block_w - pad
    H = title_h + margin + rows * block_h - pad + margin

    # sharp layer (pure pixels on black) so we can bloom it, then composite on BG
    sharp = Image.new("RGB", (W, H), (0, 0, 0))
    sd = ImageDraw.Draw(sharp)

    def panel_origin(i):
        r, c = divmod(i, per_row)
        x = margin + c * block_w
        y = title_h + margin + r * block_h
        return x, y

    for i, fr in enumerate(frames):
        ox, oy = panel_origin(i)
        for ry in range(8):
            for rx in range(8):
                ch = fr[ry][rx]
                if ch == ".":
                    continue
                col = colors[ch]
                x0 = ox + rx * cell
                y0 = oy + ry * cell
                sd.rectangle([x0, y0, x0 + cell - 2, y0 + cell - 2], fill=col)

    if glow:
        bloom = sharp.filter(ImageFilter.GaussianBlur(cell * 0.22))
        sharp = ImageChops.add(sharp, bloom)

    out = Image.new("RGB", (W, H), BG)
    out = ImageChops.add(out, sharp)
    d = ImageDraw.Draw(out)

    # subtle panel borders + frame index labels
    fnt = load_font(12)
    for i in range(n):
        ox, oy = panel_origin(i)
        d.rectangle([ox - 1, oy - 1, ox + panel - 1, oy + panel - 1], outline=GRID)
        d.text((ox, oy + panel + 2), f"f{i}", font=fnt, fill=TEXT)

    # title bar
    tfnt = load_font(16)
    name = data.get("_name", "")
    title = (f"{name}   {n} frames · {data.get('frame_ms', '?')}ms · "
             f"loop {data.get('loop', 0)}").strip()
    d.text((margin, 10), title, font=tfnt, fill=(230, 232, 240))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("json", help="path to a frame-expression JSON")
    ap.add_argument("-o", "--out", help="output PNG (default: alongside input)")
    ap.add_argument("--cell", type=int, default=26)
    ap.add_argument("--per-row", type=int, default=8)
    ap.add_argument("--no-glow", action="store_true")
    a = ap.parse_args()

    with open(a.json, "r", encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("_name", os.path.splitext(os.path.basename(a.json))[0])

    out = a.out or (os.path.splitext(a.json)[0] + ".sheet.png")
    img = render(data, cell=a.cell, per_row=a.per_row, glow=not a.no_glow)
    img.save(out)
    print(f"wrote {out}  ({len(data['frames'])} frames, {img.width}x{img.height})")


if __name__ == "__main__":
    main()
