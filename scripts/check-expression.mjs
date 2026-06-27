// scripts/check-expression.mjs — pure validator for a frame-expression payload, shared by the
// engine's PUT /api/expression write surface (trust boundary) and optionally the editor UI
// (pre-save UX). Mirrors check-manifest.mjs: a pure validateExpression(name, expr) -> string[].

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function validateExpression(name, expr) {
  const errors = [];
  if (typeof name !== "string" || !NAME_RE.test(name)) errors.push(`invalid name: ${name}`);
  if (!expr || typeof expr !== "object") { errors.push("expr must be an object"); return errors; }

  const { frames, colors, frame_ms, loop } = expr;
  if (!Array.isArray(frames) || frames.length === 0) {
    errors.push("frames must be a non-empty array");
  } else {
    frames.forEach((f, i) => {
      if (!Array.isArray(f) || f.length !== 8) { errors.push(`frame ${i}: must be 8 rows`); return; }
      f.forEach((row, r) => {
        if (typeof row !== "string" || row.length !== 8) errors.push(`frame ${i} row ${r}: must be 8 chars`);
      });
    });
  }

  const cols = (colors && typeof colors === "object") ? colors : {};
  for (const [k, v] of Object.entries(cols)) {
    if (typeof v !== "string" || !HEX_RE.test(v)) errors.push(`color '${k}': invalid hex`);
  }

  if (Array.isArray(frames)) {
    const used = new Set();
    for (const f of frames) if (Array.isArray(f)) for (const row of f) {
      if (typeof row === "string") for (const ch of row) if (ch !== ".") used.add(ch);
    }
    for (const ch of used) if (!(ch in cols)) errors.push(`char '${ch}' has no color`);
  }

  if (!Number.isInteger(frame_ms) || frame_ms <= 0) errors.push("frame_ms must be a positive integer");
  if (!Number.isInteger(loop) || loop < 0) errors.push("loop must be an integer >= 0");
  return errors;
}
