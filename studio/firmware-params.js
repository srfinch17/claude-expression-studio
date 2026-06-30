// studio/firmware-params.js, hand-authored param schema for the editor's typed widgets.
// These params are consumed by the ESP32 firmware (the esp32-8x8 renderer forwards a pool
// entry's params to POST /api/display/animation), so names/ranges mirror api_handlers.ino,
// NOT the JS sims. Firmwares/params NOT listed here fall back to the editor's raw-JSON box.
// type: number {min,max,step,default} | enum {options,default} | color {default} | bool {default}.

export const FIRMWARE_PARAMS = {
  fire: {
    intensity: { type: "number", min: 1, max: 10, step: 1, default: 6 },
    palette:   { type: "enum", options: ["classic", "blue", "green", "purple"], default: "classic" },
    sparks:    { type: "number", min: 0, max: 10, step: 1, default: 0 },
    tendrils:  { type: "number", min: 0, max: 10, step: 1, default: 0 },
    speed:     { type: "number", min: 10, max: 10000, step: 1, default: 66 },
  },
  matrix_rain: {
    theme: { type: "enum", options: ["classic", "blue", "red", "purple"], default: "classic" },
    speed: { type: "number", min: 10, max: 10000, step: 1, default: 66 },
  },
  frostbite: {
    color:   { type: "color", default: "#66ccff" },
    sparkle: { type: "number", min: 0, max: 10, step: 1, default: 5 },
    mist:    { type: "number", min: 0, max: 10, step: 1, default: 4 },
  },
  fireworks: {
    color1: { type: "color", default: "#ff0050" },
    color2: { type: "color", default: "#00e0ff" },
    color3: { type: "color", default: "#ffd000" },
  },
  snow: {
    speed:    { type: "number", min: 10, max: 10000, step: 1, default: 110 },
    confetti: { type: "bool", default: false },
    color:    { type: "color", default: "#dce6ff" },
  },
  dancefloor: {
    palette: { type: "number", min: 0, max: 7, step: 1, default: 0 },
    hold:    { type: "number", min: 1, max: 30, step: 1, default: 6 },
  },
  clock: {
    color1: { type: "color", default: "#00ff88" },
    color2: { type: "color", default: "#0088ff" },
    color3: { type: "color", default: "#ff4040" },
  },
  claudesweep: {
    color: { type: "color", default: "#ff5008" },
  },
};
