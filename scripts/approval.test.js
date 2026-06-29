import { test } from "node:test";
import assert from "node:assert/strict";
import { setApproval } from "./approval.mjs";

test("adds a name (no duplicate), removes a name, idempotently", () => {
  assert.deepEqual(setApproval({ approved: [] }, "x", true), { approved: ["x"] });
  assert.deepEqual(setApproval({ approved: ["x"] }, "x", true), { approved: ["x"] });   // no dup
  assert.deepEqual(setApproval({ approved: ["x", "y"] }, "x", false), { approved: ["y"] });
  assert.deepEqual(setApproval({ approved: ["y"] }, "x", false), { approved: ["y"] });   // remove absent = no-op
});

test("tolerates a missing/non-array approved field", () => {
  assert.deepEqual(setApproval({}, "x", true), { approved: ["x"] });
  assert.deepEqual(setApproval({ approved: "nope" }, "x", true), { approved: ["x"] });
});

test("does not mutate the input object", () => {
  const input = { approved: ["a"] }; const snap = JSON.stringify(input);
  setApproval(input, "b", true);
  assert.equal(JSON.stringify(input), snap);
});
