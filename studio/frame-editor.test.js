import { test } from "node:test";
import assert from "node:assert/strict";
import { blankFrame, paintCell, addFrame, duplicateFrame, deleteFrame, moveFrame,
         addColor, setColor, removeColor, setFrameMs, setLoop, setDescription } from "./frame-editor.js";

function fresh() {
  return {
    description: "d",
    frames: [
      ["........","........","........","........","........","........","........","........"],
      ["AAAAAAAA","........","........","........","........","........","........","........"],
    ],
    colors: { A: "#ff0000" }, frame_ms: 150, loop: 0,
  };
}

test("blankFrame is 8 rows of 8 dots", () => {
  assert.deepEqual(blankFrame(), Array(8).fill("........"));
});

test("paintCell sets one cell and does not mutate input", () => {
  const e0 = fresh(); const snap = JSON.stringify(e0);
  const e = paintCell(e0, 0, 3, 1, "A");
  assert.equal(e.frames[0][1], "...A....");
  assert.equal(JSON.stringify(e0), snap);
});

test("paintCell out of bounds is a no-op copy", () => {
  const e = paintCell(fresh(), 0, 9, 0, "A");
  assert.equal(e.frames[0][0], "........");
});

test("addFrame inserts blank; copyFromIdx copies", () => {
  assert.equal(addFrame(fresh(), 1).frames.length, 3);
  assert.deepEqual(addFrame(fresh(), 2).frames[2], Array(8).fill("........"));
  assert.equal(addFrame(fresh(), 0, 1).frames[0][0], "AAAAAAAA");
});

test("duplicateFrame copies a frame after it", () => {
  const e = duplicateFrame(fresh(), 1);
  assert.equal(e.frames.length, 3);
  assert.equal(e.frames[2][0], "AAAAAAAA");
});

test("deleteFrame removes; never below 1 frame", () => {
  assert.equal(deleteFrame(fresh(), 0).frames.length, 1);
  const one = { ...fresh(), frames: [blankFrame()] };
  assert.equal(deleteFrame(one, 0).frames.length, 1); // guard
});

test("moveFrame reorders", () => {
  const e = moveFrame(fresh(), 0, 1);
  assert.equal(e.frames[0][0], "AAAAAAAA");
});

test("addColor assigns the next free char", () => {
  const { expr, char } = addColor(fresh(), "#00ff00");
  assert.equal(char, "B");                 // A is taken
  assert.equal(expr.colors.B, "#00ff00");
});

test("setColor recolors an existing char; unknown is a no-op", () => {
  assert.equal(setColor(fresh(), "A", "#0000ff").colors.A, "#0000ff");
  assert.equal(setColor(fresh(), "Z", "#0000ff").colors.Z, undefined);
});

test("removeColor drops the char and blanks cells using it", () => {
  const e = removeColor(fresh(), "A");
  assert.equal("A" in e.colors, false);
  assert.equal(e.frames[1][0], "........");
});

test("meta setters", () => {
  assert.equal(setFrameMs(fresh(), 80).frame_ms, 80);
  assert.equal(setLoop(fresh(), 3).loop, 3);
  assert.equal(setDescription(fresh(), "hi").description, "hi");
});
