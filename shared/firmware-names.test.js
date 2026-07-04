import { test } from "node:test";
import assert from "node:assert/strict";
import { FIRMWARE_NAMES, isFirmwareName } from "./firmware-names.js";

test("firmware names include every idle + working pool member", () => {
  for (const n of ["fire", "dancefloor", "fireworks", "clock", "frostbite", "matrix_rain", "snow", "claudesweep"])
    assert.ok(isFirmwareName(n), `${n} is a firmware animation`);
});

test("frame-expression names are NOT firmware", () => {
  for (const n of ["wait-claude", "working", "ask-question", "done", "skull", "wait-logo-boot"])
    assert.equal(isFirmwareName(n), false, `${n} is not firmware`);
});

test("FIRMWARE_NAMES is a Set covering the matrix_set_animation enum", () => {
  assert.ok(FIRMWARE_NAMES instanceof Set);
  assert.ok(FIRMWARE_NAMES.has("starfield") && FIRMWARE_NAMES.has("timer_text"));
});

test("FIRMWARE_NAMES size is exactly 25, drift guard for Python mirror", () => {
  assert.equal(FIRMWARE_NAMES.size, 25);
});
