import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESENCE_VOCAB } from "./presence-vocab.js";
import { PRESENCE_VOCAB as BOARD_VOCAB } from "../esp32_matrix_webserver/data/presence-vocab.js";

test("shared presence vocab matches the board's copy (no drift)", () => {
  assert.deepEqual(Object.keys(PRESENCE_VOCAB).sort(), Object.keys(BOARD_VOCAB).sort());
  for (const k of Object.keys(BOARD_VOCAB)) {
    assert.deepEqual(PRESENCE_VOCAB[k], BOARD_VOCAB[k], `intent ${k} differs from the board copy`);
  }
});
