import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePresence, cannedFor, INTENTS } from "./presence.ts";

test("minimal message defaults urgency to ambient and trims intent", () => {
  assert.deepEqual(normalizePresence({ intent: " working " }), { intent: "working", urgency: "ambient" });
});

test("missing or empty intent throws", () => {
  assert.throws(() => normalizePresence({}), /intent/);
  assert.throws(() => normalizePresence({ intent: "   " }), /intent/);
  assert.throws(() => normalizePresence("nope"), /object/);
});

test("unknown intent is accepted (forward-compat)", () => {
  assert.equal(normalizePresence({ intent: "teleporting" }).intent, "teleporting");
});

test("headline/detail coerced to string; client ts stripped", () => {
  const m = normalizePresence({ intent: "done", headline: "built", detail: 42, ts: 999 });
  assert.equal(m.headline, "built");
  assert.equal(m.detail, "42");
  assert.ok(!("ts" in m));
});

test("urgency validated", () => {
  assert.equal(normalizePresence({ intent: "alert", urgency: "urgent" }).urgency, "urgent");
  assert.throws(() => normalizePresence({ intent: "alert", urgency: "loud" }), /urgency/);
});

test("data.progress clamps to 0..1", () => {
  assert.deepEqual(normalizePresence({ intent: "working", data: { progress: 1.5 } }).data, { progress: 1 });
  assert.deepEqual(normalizePresence({ intent: "working", data: { progress: -3 } }).data, { progress: 0 });
});

test("data.values accepts 1..3 readouts, rejects 0 or 4 or non-number", () => {
  const m = normalizePresence({ intent: "info", data: { values: [{ value: 22, unit: "C", label: "chip" }] } });
  assert.deepEqual(m.data, { values: [{ value: 22, unit: "C", label: "chip" }] });
  assert.throws(() => normalizePresence({ intent: "info", data: { values: [] } }), /1-3/);
  assert.throws(() => normalizePresence({ intent: "info", data: { values: [1,2,3,4].map((v)=>({value:v})) } }), /1-3/);
  assert.throws(() => normalizePresence({ intent: "info", data: { values: [{ unit: "C" }] } }), /value/);
});

test("data.values rejects a non-object element with a clear message", () => {
  assert.throws(() => normalizePresence({ intent: "info", data: { values: [5] } }), /must be an object/);
});

test("data.series accepts 1..32 numbers, rejects 33 or non-number", () => {
  assert.deepEqual(normalizePresence({ intent: "info", data: { series: [1,2,3] } }).data, { series: [1,2,3] });
  assert.throws(() => normalizePresence({ intent: "info", data: { series: Array(33).fill(0) } }), /1-32/);
  assert.throws(() => normalizePresence({ intent: "info", data: { series: ["x"] } }), /number/);
});

test("data with two cases is rejected", () => {
  assert.throws(() => normalizePresence({ intent: "info", data: { progress: 0.5, series: [1] } }), /exactly one/);
});

test("cannedFor maps known intents and falls back to smiley", () => {
  assert.equal(cannedFor("error"), "cross");
  assert.equal(cannedFor("ok"), "ok"); // remapped check→ok (the OK glyph) after check was retired
  assert.equal(cannedFor("done"), "smiley"); // retired glyph → falls back until rehomed
  assert.equal(cannedFor("question"), "smiley"); // retired glyph → falls back until rehomed
  assert.equal(cannedFor("teleporting"), "smiley");
});

test("INTENTS has the 10 canonical names", () => {
  assert.equal(INTENTS.length, 10);
  assert.ok(INTENTS.includes("working"));
});
