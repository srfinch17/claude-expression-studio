// Pure expression resolution, char-art frames → flat lit-pixel arrays.
// No DOM. Shared by the canvas renderer, the gallery, and Node tests.

export function hexRGB(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// rows: array of 8 strings (8 chars each). colors: {char: "#rrggbb"}.
// '.' = off. A char with no color entry is skipped (treated as off).
export function resolveFrame(rows, colors) {
  const px = [];
  for (let y = 0; y < 8; y++) {
    const row = rows[y] || "";
    for (let x = 0; x < 8; x++) {
      const ch = row[x];
      if (!ch || ch === ".") continue;
      const c = colors[ch];
      if (!c) continue;
      const [r, g, b] = hexRGB(c);
      px.push({ x, y, r, g, b });
    }
  }
  return px;
}

export function resolveExpression(json) {
  const colors = json.colors || {};
  return {
    frame_ms: json.frame_ms || 150,
    loop: json.loop ?? 0,
    description: json.description || "",
    frames: (json.frames || []).map((rows) => resolveFrame(rows, colors)),
  };
}
