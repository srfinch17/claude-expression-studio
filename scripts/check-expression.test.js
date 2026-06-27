import { test } from "node:test";
import assert from "node:assert/strict";
import { validateExpression } from "./check-expression.mjs";

const ROWS8 = ["........","....A...","........","........","........","........","........","........"];
function good() { return { frames: [ROWS8], colors: { A: "#ff0000" }, frame_ms: 150, loop: 0, description: "ok" }; }

test("a well-formed expression validates", () => {
  assert.deepEqual(validateExpression("goldfish", good()), []);
});

test("rejects a bad name", () => {
  assert.ok(validateExpression("Bad Name", good()).some((e) => /name/i.test(e)));
});

test("rejects wrong frame dimensions", () => {
  const e = good(); e.frames = [["x"]]; // not 8 rows
  assert.ok(validateExpression("g", e).some((m) => /8 rows|8 chars/.test(m)));
});

test("rejects a used char with no color entry", () => {
  const e = good(); e.colors = {}; // 'A' used but undefined
  assert.ok(validateExpression("g", e).some((m) => /char 'A'/.test(m)));
});

test("rejects an invalid hex and bad frame_ms/loop", () => {
  const e = good(); e.colors = { A: "red" }; e.frame_ms = 0; e.loop = -1;
  const errs = validateExpression("g", e);
  assert.ok(errs.some((m) => /hex/.test(m)));
  assert.ok(errs.some((m) => /frame_ms/.test(m)));
  assert.ok(errs.some((m) => /loop/.test(m)));
});
