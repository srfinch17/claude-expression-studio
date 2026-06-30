// shared/wire.js, char-art expression → the board's /api/display/frames wire format.
// Each frame is 64 cells (row-major) × "RRGGBB"; an off cell ('.', unknown, or
// unmapped char) is "000000". Mirrors matrix_signal.py art_to_hex + the MCP's
// expressionToWire so all senders agree on the bytes.

export function artToHex(rows, colors) {
  let out = "";
  for (let y = 0; y < 8; y++) {
    const row = rows[y] || "";
    for (let x = 0; x < 8; x++) {
      const ch = row[x];
      const hex = ch && ch !== "." && colors[ch] ? colors[ch].replace("#", "") : "000000";
      out += hex.toLowerCase();
    }
  }
  return out;
}

export function expressionToWire(json) {
  const colors = json.colors || {};
  return {
    frames: (json.frames || []).map((rows) => artToHex(rows, colors)),
    frame_ms: json.frame_ms || 150,
    loop: json.loop ?? 0,
  };
}
