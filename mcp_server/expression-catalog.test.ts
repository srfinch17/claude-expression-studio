import { test } from "node:test";
import assert from "node:assert/strict";
import { reservedSaveError, formatCatalog } from "./expression-catalog.ts";
import { isFirmwareName } from "../shared/firmware-names.js";

test("reservedSaveError refuses a name that is a firmware mode", () => {
  const msg = reservedSaveError("fireworks2", isFirmwareName);
  assert.ok(msg && msg.includes("fireworks2"), `expected a message naming fireworks2, got ${msg}`);
});

test("reservedSaveError allows a kebab studio name that is not firmware", () => {
  assert.equal(reservedSaveError("fireworks-3", isFirmwareName), null);
  assert.equal(reservedSaveError("campfire", isFirmwareName), null);
});

test("formatCatalog lists firmware-native, canned, and saved sections", () => {
  const out = formatCatalog({
    firmwareNames: ["fire", "fireworks", "fireworks2"],
    canned: [{ name: "smiley", description: "a smile" }],
    saved: [{ name: "fireworks-3", description: "a burst" }],
  });
  assert.match(out, /Firmware-native/i);
  assert.match(out, /matrix_set_animation/); // tells the caller HOW to play them
  assert.ok(out.includes("fireworks2"), "firmware names listed");
  assert.ok(out.includes("smiley") && out.includes("a smile"), "canned listed with description");
  assert.ok(out.includes("fireworks-3"), "saved listed");
});

test("formatCatalog handles an empty saved library", () => {
  const out = formatCatalog({
    firmwareNames: ["fire"],
    canned: [{ name: "smiley", description: "a smile" }],
    saved: [],
  });
  assert.match(out, /none yet/i);
});
