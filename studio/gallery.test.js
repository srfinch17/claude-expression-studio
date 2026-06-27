import { test } from "node:test";
import assert from "node:assert/strict";
import { showEditAffordances } from "./gallery.js";

test("edit affordances require a saved expression AND a live engine", () => {
  assert.equal(showEditAffordances(true, true), true);
  assert.equal(showEditAffordances(true, false), false); // no engine -> read-only
  assert.equal(showEditAffordances(false, true), false); // not a saved expression
  assert.equal(showEditAffordances(false, false), false);
});
