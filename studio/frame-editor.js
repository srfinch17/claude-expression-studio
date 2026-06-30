// studio/frame-editor.js, pure ops over a frame-expression { description, frames, colors,
// frame_ms, loop }. Every op returns a NEW expression (deep-cloned) and never mutates its input;
// a frame is always 8 strings of 8 chars. Chars are the palette keys ('.' = off); the UI hides
// them behind color swatches (addColor auto-assigns the next free char).

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const clone = (e) => JSON.parse(JSON.stringify(e));

export function blankFrame() { return Array(8).fill("........"); }

export function paintCell(expr, frameIdx, x, y, char) {
  const e = clone(expr);
  if (!e.frames[frameIdx] || x < 0 || x > 7 || y < 0 || y > 7) return e;
  const row = e.frames[frameIdx][y];
  e.frames[frameIdx][y] = row.slice(0, x) + (char || ".") + row.slice(x + 1);
  return e;
}

export function addFrame(expr, atIdx, copyFromIdx) {
  const e = clone(expr);
  const f = (copyFromIdx != null && e.frames[copyFromIdx]) ? e.frames[copyFromIdx].slice() : blankFrame();
  const i = Math.max(0, Math.min(atIdx, e.frames.length));
  e.frames.splice(i, 0, f);
  return e;
}

export function duplicateFrame(expr, idx) {
  const e = clone(expr);
  if (!e.frames[idx]) return e;
  e.frames.splice(idx + 1, 0, e.frames[idx].slice());
  return e;
}

export function deleteFrame(expr, idx) {
  const e = clone(expr);
  if (e.frames.length <= 1 || !e.frames[idx]) return e;
  e.frames.splice(idx, 1);
  return e;
}

export function moveFrame(expr, from, to) {
  const e = clone(expr);
  if (!e.frames[from] || to < 0 || to >= e.frames.length) return e;
  const [f] = e.frames.splice(from, 1);
  e.frames.splice(to, 0, f);
  return e;
}

export function addColor(expr, hex) {
  const e = clone(expr); e.colors = e.colors || {};
  const used = new Set(Object.keys(e.colors));
  const char = CHARSET.find((c) => !used.has(c)) || null;
  if (char) e.colors[char] = hex;
  return { expr: e, char };
}

export function setColor(expr, char, hex) {
  const e = clone(expr);
  if (e.colors && char in e.colors) e.colors[char] = hex;
  return e;
}

export function removeColor(expr, char) {
  const e = clone(expr);
  if (!e.colors || !(char in e.colors)) return e;
  delete e.colors[char];
  e.frames = e.frames.map((f) => f.map((row) => row.split("").map((ch) => (ch === char ? "." : ch)).join("")));
  return e;
}

export function setFrameMs(expr, ms) { const e = clone(expr); e.frame_ms = ms; return e; }
export function setLoop(expr, n) { const e = clone(expr); e.loop = n; return e; }
export function setDescription(expr, text) { const e = clone(expr); e.description = text; return e; }
