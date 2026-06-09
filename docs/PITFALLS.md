# Pitfalls & Gotchas — ESP32-S3 Matrix

Running log of hardware/firmware traps we've hit (or that bite newcomers to this
board). Append a dated entry whenever a non-obvious problem costs us time. Read
this before debugging anything weird. Newest entries at the top.

Entry template:
```
## YYYY-MM-DD — <short title>
**Symptom:** what we saw.
**Cause:** the real reason.
**Fix / rule:** what to do (and what to never do again).
```

---

## Standing gotchas (board-level, always true)

### Color order is RGB, not GRB
`COLOR_ORDER` is `RGB` in this firmware, so `CRGB(r, g, b)` maps straight to the
panel. Most WS2812B code assumes GRB — if you copy an animation from elsewhere
and red/green look swapped, this is why. Don't "fix" it by swapping channels in
one animation; the whole firmware is consistent on RGB.

### LittleFS upload is a separate step from flashing
Editing `data/*.html` and uploading the sketch does **nothing** to the web UI.
Web files only land on the board via **Tools → ESP32 LittleFS Data Upload**, and
that tool must be installed separately from the LittleFS *library*. If the UI
looks stale after a change, you flashed firmware but forgot the data upload.

### Brightness vs. current draw
Default brightness is 40/255. At full brightness all 64 LEDs white can pull
~3-4 A — more than some USB ports supply, causing brownout/reboot or color
glitches. If the board resets under bright patterns, suspect power before code.

### mDNS (`esp32matrix.local`) is flaky from spawned processes
The browser usually resolves `.local` fine, but Node/MCP spawned by Claude Code
on Windows often can't. Use the board's raw IP in MCP config.

### Matrix is row-major, not serpentine
`XY(x,y) = y*8 + x`. If a ported effect looks zig-zagged every other row, it
assumed serpentine wiring — this panel isn't.
