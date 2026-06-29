import { test } from "node:test";
import assert from "node:assert/strict";
import { INTENTS } from "./presence.ts";
import { PRESENCE_VOCAB } from "../esp32_matrix_webserver/data/presence-vocab.js";

test("every intent has a card vocab entry with the required fields", () => {
  for (const i of INTENTS) {
    const v = PRESENCE_VOCAB[i];
    assert.ok(v, `missing vocab entry for intent "${i}"`);
    for (const k of ["label", "glyph", "color", "motion"]) {
      assert.equal(typeof v[k], "string", `vocab "${i}".${k} must be a string`);
    }
  }
});
