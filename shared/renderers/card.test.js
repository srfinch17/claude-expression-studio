import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCardRenderer } from "./card.js";

function fakeCard() {
  const glyph = { textContent: "" };
  const text = { textContent: "" };
  const el = { style: { borderColor: "" }, querySelector: (s) => (s === ".glyph" ? glyph : text) };
  return { el, glyph, text };
}

test("card renderer id is card", () => {
  assert.equal(makeCardRenderer({ el: fakeCard().el }).id, "card");
});

test("render writes glyph, text, and color to the element", () => {
  const c = fakeCard();
  makeCardRenderer({ el: c.el }).render({ glyph: "OK", text: "Done", color: "#00c83c" });
  assert.equal(c.glyph.textContent, "OK");
  assert.equal(c.text.textContent, "Done");
  assert.equal(c.el.style.borderColor, "#00c83c");
});

test("render tolerates a partial value (missing fields left blank, never throws)", () => {
  const c = fakeCard();
  makeCardRenderer({ el: c.el }).render({ glyph: "!" });
  assert.equal(c.glyph.textContent, "!");
  assert.equal(c.text.textContent, "");
});

test("render ignores a non-object value (e.g. a stray animation name)", () => {
  const c = fakeCard();
  makeCardRenderer({ el: c.el }).render("not-a-card-value");
  assert.equal(c.glyph.textContent, "");
});
