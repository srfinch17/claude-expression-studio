// shared/firmware-names.js
// Single source of truth for FIRMWARE animation type names — the names launched via
// POST /api/display/animation (the firmware renders them) rather than pushed as
// frame-expressions via POST /api/display/frames. The manifest engines use this to
// pick the wire path for a resolved animation name.
// MIRRORED as a literal set in claude-hooks/matrix_signal.py (FIRMWARE_NAMES); keep
// the two in sync. (Source list = the matrix_set_animation enum in mcp_server/index.ts.)
export const FIRMWARE_NAMES = new Set([
  "fire", "rainbow", "breathe", "wave", "solid", "liquid", "imu", "chiptemp",
  "weather", "timer_fill", "timer_snow", "timer_text", "clock", "matrix_rain",
  "snow", "dancefloor", "spiral", "starfield", "fireworks", "fireworks2",
  "comet", "sun", "frostbite", "calendar", "sound", "claudesweep",
]);

export function isFirmwareName(name) {
  return FIRMWARE_NAMES.has(name);
}
