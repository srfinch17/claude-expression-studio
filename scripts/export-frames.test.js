import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAGIC, VERSION, HEADER_BYTES, MAX_COLORS, MAX_FRAMES, NAME_RE,
  litToRGB, expressionFrames, captureSimFrames,
  buildPalette, indexFrames, encodeCfr, decodeCfr,
  applyExclusions, encodePack, decodePack,
  PACK_MAGIC, PACK_VERSION, PACK_HEADER_BYTES, PACK_ENTRY_BYTES,
} from "./export-frames.mjs";

const RED = 0xff0000, GREEN = 0x00ff00, BLUE = 0x0000ff;

test("litToRGB places pixels row-major, clamps, drops out-of-bounds", () => {
  const f = litToRGB([
    { x: 0, y: 0, r: 255, g: 0, b: 0 },
    { x: 7, y: 7, r: 0, g: 300, b: -5 },   // clamped to 00ff00
    { x: 8, y: 0, r: 1, g: 1, b: 1 },      // out of bounds, dropped
  ]);
  assert.equal(f.length, 64);
  assert.equal(f[0], RED);
  assert.equal(f[63], GREEN);
  assert.equal(f.filter((c) => c !== 0).length, 2);
});

test("expressionFrames resolves char-art rows via the shared expression resolver", () => {
  const frames = expressionFrames({
    frames: [["R.......", "", "", "", "", "", "", ".......B"]],
    colors: { R: "#ff0000", B: "#0000ff" },
  });
  assert.equal(frames.length, 1);
  assert.equal(frames[0][0], RED);
  assert.equal(frames[0][7 * 8 + 7], BLUE);
});

test("buildPalette orders by frequency and caps at maxColors", () => {
  const frame = new Array(64).fill(BLUE);
  frame[0] = RED; frame[1] = RED; frame[2] = GREEN;
  const { palette, distinct } = buildPalette([frame]);
  assert.deepEqual(palette, [BLUE, RED, GREEN]);
  assert.equal(distinct, 3);
  const capped = buildPalette([frame], 2);
  assert.deepEqual(capped.palette, [BLUE, RED]);
  assert.equal(capped.distinct, 3);
});

test("indexFrames maps palette misses to the nearest kept color", () => {
  const frame = new Array(64).fill(0);
  frame[0] = 0xfe0101; // not in palette, nearest is RED
  const [idx] = indexFrames([frame], [0x000000, RED, BLUE]);
  assert.equal(idx[0], 1);
  assert.equal(idx[1], 0);
});

test("encode/decode round-trips frames exactly when colors fit the palette", () => {
  const f1 = new Array(64).fill(0); f1[0] = RED; f1[9] = GREEN;
  const f2 = new Array(64).fill(BLUE); f2[63] = RED;
  const { buf, quantized } = encodeCfr({ frames: [f1, f2], frame_ms: 120, loop: 3 });
  assert.equal(quantized, false);
  const dec = decodeCfr(buf);
  assert.equal(dec.version, VERSION);
  assert.equal(dec.loop, 3);
  assert.equal(dec.frame_ms, 120);
  assert.deepEqual(dec.framesRGB, [f1, f2]);
  assert.equal(buf.length, HEADER_BYTES + dec.palette.length * 3 + 2 * 64);
});

test("header bytes match the spec layout", () => {
  const frame = new Array(64).fill(0); frame[0] = RED;
  const { buf } = encodeCfr({ frames: [frame], frame_ms: 90, loop: 0 });
  assert.equal(buf.toString("ascii", 0, 4), MAGIC);
  assert.equal(buf.readUInt8(4), VERSION);
  assert.equal(buf.readUInt8(5), 0);            // loop forever
  assert.equal(buf.readUInt16LE(6), 1);         // frame count
  assert.equal(buf.readUInt16LE(8), 90);        // frame_ms
  assert.equal(buf.readUInt16LE(10), 2);        // palette: black + red
});

test("encode quantizes above MAX_COLORS instead of failing", () => {
  // 5 frames x 64 unique colors = 320 distinct, over the 256 cap
  const frames = [];
  for (let n = 0; n < 5; n++) frames.push(Array.from({ length: 64 }, (_, i) => n * 64 + i + 1));
  const { buf, distinct, quantized, palette } = encodeCfr({ frames, frame_ms: 50 });
  assert.equal(distinct, 320);
  assert.equal(quantized, true);
  assert.equal(palette.length, MAX_COLORS);
  const dec = decodeCfr(buf); // every index must still be in palette range
  assert.equal(dec.frames.length, 5);
});

test("decodeCfr rejects bad magic and truncated files", () => {
  const frame = new Array(64).fill(0);
  const { buf } = encodeCfr({ frames: [frame], frame_ms: 100 });
  const bad = Buffer.from(buf); bad.write("NOPE", 0, "ascii");
  assert.throws(() => decodeCfr(bad), /bad magic/);
  assert.throws(() => decodeCfr(buf.subarray(0, buf.length - 1)), /bad length/);
});

test("captureSimFrames finds a seamless period and skips warm-up", () => {
  // Deterministic fake sim: 3 warm-up frames, then a period of 5.
  let n = 0;
  const sim = {
    frame_ms: 50,
    frame() {
      const i = n++;
      const v = i < 3 ? 200 + i : (i - 3) % 5;
      return [{ x: v % 8, y: 0, r: 10 + v, g: 0, b: 0 }];
    },
  };
  const cap = captureSimFrames(sim, { maxMs: 2000 });
  assert.equal(cap.seamless, true);
  assert.equal(cap.skipped, 3);
  assert.equal(cap.frames.length, 5);
});

test("captureSimFrames is not fooled by a hold-still stretch", () => {
  // 12 identical frames, then a non-repeating run: the period-1 candidate must be
  // rejected (this is the dancefloor/fireworks false-positive regression).
  let n = 0;
  const sim = {
    frame_ms: 50,
    frame() {
      const i = n++;
      const v = i < 12 ? 7 : i;
      return [{ x: 0, y: 0, r: ((v * 37) % 251) + 1, g: 1, b: 1 }];
    },
  };
  const cap = captureSimFrames(sim, { maxMs: 2000, fallbackMs: 1000 });
  assert.equal(cap.seamless, false);
  assert.equal(cap.frames.length, 20); // 1000ms / 50ms
});

test("captureSimFrames falls back to a window for non-repeating sims", () => {
  let n = 0;
  const sim = { frame_ms: 100, frame: () => [{ x: 0, y: 0, r: (n++ % 251) + 1, g: n & 255, b: 1 }] };
  const cap = captureSimFrames(sim, { maxMs: 1000, fallbackMs: 600 });
  assert.equal(cap.seamless, false);
  assert.equal(cap.frames.length, 6); // 600ms / 100ms
});

// ---- curation (applyExclusions) ----

const entry = (name, frameCount = 1) => ({ name, frames: new Array(frameCount).fill(0) });

test("applyExclusions drops excluded names from the kept list", () => {
  const entries = [entry("alert"), entry("cross"), entry("ok")];
  const kept = applyExclusions(entries, [{ name: "cross" }, { name: "ok" }]);
  assert.deepEqual(kept.map((e) => e.name), ["alert"]);
});

test("applyExclusions fails when an excluded name is not in the library (typo protection)", () => {
  const entries = [entry("alert")];
  assert.throws(
    () => applyExclusions(entries, [{ name: "crosss" }]),
    /excluded name "crosss" not found/,
  );
});

test("applyExclusions fails on a name outside the strict lowercase guard (no /i)", () => {
  assert.match("alert", NAME_RE);
  assert.doesNotMatch("Alert", NAME_RE); // uppercase must now be rejected
  const entries = [entry("Alert")];
  assert.throws(() => applyExclusions(entries, []), /unsafe or oversize name "Alert"/);
});

test("applyExclusions fails on a name over the 31-char cap", () => {
  const longName = "a".repeat(32);
  assert.doesNotMatch(longName, NAME_RE);
  const entries = [entry(longName)];
  assert.throws(() => applyExclusions(entries, []), /unsafe or oversize name/);
});

test("applyExclusions fails when a bake exceeds the firmware's frame cap", () => {
  const entries = [entry("fire", MAX_FRAMES + 1)];
  assert.throws(
    () => applyExclusions(entries, []),
    new RegExp(`"fire" has ${MAX_FRAMES + 1} frames, over the firmware's ${MAX_FRAMES}-frame cap`),
  );
});

test("applyExclusions accepts exactly the frame cap", () => {
  const entries = [entry("fire", MAX_FRAMES)];
  const kept = applyExclusions(entries, []);
  assert.equal(kept.length, 1);
});

test("applyExclusions fails on a duplicate name", () => {
  const entries = [entry("alert"), entry("alert")];
  assert.throws(() => applyExclusions(entries, []), /duplicate name "alert"/);
});

// ---- .cfrpack v1 encode/decode round-trip ----

function fakeCfr(name, frameCount = 1) {
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const f = new Array(64).fill(0);
    f[0] = (i + 1) * 1000 + name.length; // vary payload bytes per name/frame
    frames.push(f);
  }
  return encodeCfr({ frames, frame_ms: 100 }).buf;
}

test(".cfrpack round-trip: header fields, table sorted by name, offsets ascending in-bounds", () => {
  // Deliberately unsorted input; encodePack must sort.
  const items = [
    { name: "zebra", buf: fakeCfr("zebra", 2) },
    { name: "alert", buf: fakeCfr("alert", 1) },
    { name: "meteor", buf: fakeCfr("meteor", 3) },
  ];
  const pack = encodePack(items);
  assert.equal(pack.toString("ascii", 0, 4), PACK_MAGIC);
  assert.equal(pack.readUInt8(4), PACK_VERSION);
  assert.equal(pack.readUInt8(5), 0); // reserved
  assert.equal(pack.readUInt16LE(6), 3);

  const dec = decodePack(pack);
  assert.equal(dec.count, 3);
  assert.deepEqual(dec.table.map((t) => t.name), ["alert", "meteor", "zebra"]);

  const tableEnd = PACK_HEADER_BYTES + PACK_ENTRY_BYTES * 3;
  let prevEnd = tableEnd;
  for (const t of dec.table) {
    assert.ok(t.offset >= prevEnd, "offsets must be ascending/non-overlapping");
    assert.ok(t.offset + t.length <= pack.length, "payload must be in-bounds");
    prevEnd = t.offset + t.length;
  }

  // each extracted blob byte-equals its original loose .cfr buffer
  for (const it of items) {
    const extracted = dec.extract(it.name);
    assert.ok(Buffer.isBuffer(extracted) || extracted instanceof Uint8Array);
    assert.ok(Buffer.from(extracted).equals(it.buf), `extracted "${it.name}" must byte-equal the loose .cfr`);
    // and it must itself decode as a valid .cfr v1 blob
    assert.doesNotThrow(() => decodeCfr(Buffer.from(extracted)));
  }
  assert.equal(dec.extract("not-in-pack"), null);
});

test(".cfrpack table entry is exactly 40 bytes: 32 name + 4 offset + 4 length", () => {
  assert.equal(PACK_ENTRY_BYTES, 40);
  const pack = encodePack([{ name: "ok", buf: fakeCfr("ok", 1) }]);
  assert.equal(pack.length, PACK_HEADER_BYTES + PACK_ENTRY_BYTES + fakeCfr("ok", 1).length);
});

test("decodePack rejects bad magic, wrong version, and a table that overruns the file", () => {
  const pack = encodePack([{ name: "ok", buf: fakeCfr("ok", 1) }]);
  const badMagic = Buffer.from(pack); badMagic.write("NOPE", 0, "ascii");
  assert.throws(() => decodePack(badMagic), /bad pack magic/);

  const badVersion = Buffer.from(pack); badVersion.writeUInt8(2, 4);
  assert.throws(() => decodePack(badVersion), /unsupported pack version/);

  const truncated = pack.subarray(0, PACK_HEADER_BYTES + 4); // table cut mid-entry
  assert.throws(() => decodePack(truncated), /pack table overruns file/);
});

test("decodePack rejects an out-of-bounds payload and a zero-length entry", () => {
  const pack = encodePack([{ name: "ok", buf: fakeCfr("ok", 1) }]);
  const badOffset = Buffer.from(pack);
  badOffset.writeUInt32LE(pack.length + 10, PACK_HEADER_BYTES + 32); // offset column
  assert.throws(() => decodePack(badOffset), /out of bounds/);

  const zeroLen = Buffer.from(pack);
  zeroLen.writeUInt32LE(0, PACK_HEADER_BYTES + 36); // length column
  assert.throws(() => decodePack(zeroLen), /zero-length payload/);
});
