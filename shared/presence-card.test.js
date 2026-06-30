import { test } from "node:test";
import assert from "node:assert/strict";
import { vocabFor, dataBlock, sparklinePoints, motionClass, formatAge } from "./presence-card.js";
import { PRESENCE_VOCAB, GENERIC } from "./presence-vocab.js";

test("vocabFor returns the entry, GENERIC on miss", () => {
  assert.equal(vocabFor(PRESENCE_VOCAB, "working"), PRESENCE_VOCAB.working);
  assert.equal(vocabFor(PRESENCE_VOCAB, "nope"), GENERIC);
});

test("dataBlock classifies each PresenceData shape", () => {
  assert.deepEqual(dataBlock(null), { kind: "none" });
  assert.deepEqual(dataBlock({}), { kind: "none" });
  assert.deepEqual(dataBlock({ progress: 0.5 }), { kind: "progress", pct: 50 });
  assert.deepEqual(dataBlock({ progress: 2 }), { kind: "progress", pct: 100 }); // clamped
  assert.deepEqual(dataBlock({ progress: -1 }), { kind: "progress", pct: 0 });  // clamped
  const vb = dataBlock({ values: [{ value: 7 }] });
  assert.equal(vb.kind, "values"); assert.equal(vb.values.length, 1);
  const sb = dataBlock({ series: [1, 2, 3], label: "x", unit: "k" });
  assert.equal(sb.kind, "series"); assert.deepEqual(sb.series, [1, 2, 3]);
  assert.equal(sb.label, "x"); assert.equal(sb.unit, "k");
});

test("sparklinePoints yields one point per sample inside the box", () => {
  const pts = sparklinePoints([1, 2, 3, 4], 300, 50).split(" ");
  assert.equal(pts.length, 4);
  for (const p of pts) {
    const [x, y] = p.split(",").map(Number);
    assert.ok(x >= 0 && x <= 300, `x in box: ${x}`);
    assert.ok(y >= 0 && y <= 50, `y in box: ${y}`);
  }
});

test("motionClass composes motion + urgency, urgency defaults ambient", () => {
  assert.equal(motionClass({ motion: "pulse" }, "notice"), "m-pulse u-notice");
  assert.equal(motionClass({ motion: "pulse" }), "m-pulse u-ambient");
  assert.equal(motionClass({}, undefined), "m-none u-ambient");
});

test("formatAge: dash / seconds / minutes", () => {
  assert.equal(formatAge(0, Date.now()), ", ");
  assert.equal(formatAge(1000, 1000 * 1000 + 12_000), "12s ago");
  assert.equal(formatAge(1000, 1000 * 1000 + 125_000), "2m ago");
});
