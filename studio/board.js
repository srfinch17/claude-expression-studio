// studio/board.js — the virtual board's PURE event dispatch (unit-tested) + the browser
// EventSource glue (skipped under node --test). A frames event carries the exact wire the
// hardware got; we decode it to Panel frames. An animation event plays the JS firmware sim
// via the shared web-sim renderer (no-op if that firmware has no JS port).

// Decode expressionToWire() output -> Panel Frame[] (array of {x,y,r,g,b} for lit pixels).
export function framesFromWire(wire) {
  if (!wire || !Array.isArray(wire.frames)) return [];
  return wire.frames.map((row) => {
    const out = [];
    for (let i = 0; i < 64; i++) {
      const hex = row.slice(i * 6, i * 6 + 6);
      const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
      if (r || g || b) out.push({ x: i % 8, y: (i / 8) | 0, r, g, b });
    }
    return out;
  });
}

export function applyEvent(event, { panel, webSim }) {
  if (!event || event.kind === "noop") return;
  if (event.kind === "frames") { panel.setFrames(framesFromWire(event.wire), event.wire?.frame_ms || 150); return; }
  if (event.kind === "animation") { webSim.render(event.type); return; }
}

// --- browser glue (not exercised under node --test; guarded so the import is test-safe) ---
export function connectBoard({ panel, webSim, source }) {
  source.onmessage = (m) => {
    try { applyEvent(JSON.parse(m.data), { panel, webSim }); } catch { /* ignore malformed */ }
  };
  return source;
}
