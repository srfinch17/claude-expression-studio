import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleData } from "./presence-samples.js";

test("sampleData returns the right PresenceData per kind", () => {
  assert.equal(sampleData("none"), undefined);
  assert.equal(sampleData("progress").progress, 0.62);
  const v = sampleData("values");
  assert.ok(Array.isArray(v.values) && v.values.length >= 1 && v.values.length <= 3);
  const s = sampleData("series");
  assert.ok(Array.isArray(s.series) && s.series.length >= 1 && s.series.length <= 32);
});
