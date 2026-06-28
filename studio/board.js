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

// Decode a framebuffer poll (GET /api/display/framebuffer -> { px: ["RRGGBB"×64] },
// row-major i = y*8+x, raw pre-brightness) into a single Panel Frame (lit pixels only).
export function framesFromPx(px) {
  if (!Array.isArray(px) || px.length < 64) return [];
  const out = [];
  for (let i = 0; i < 64; i++) {
    const hex = String(px[i] || "000000");
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    if (r || g || b) out.push({ x: i % 8, y: (i / 8) | 0, r, g, b });
  }
  return out;
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

// When the board is reachable, its framebuffer poll is the source of truth (it already
// reflects SSE-driven renders, since those also hit the board) — so SSE events are
// ignored. Only when the board is offline does the SSE stream become the display.
export function mirrorGate(boardOnline) { return !boardOnline; }

// Build the renderable library from gallery-data + firmware sim names, and the
// curated ambient playlist. Item = { name, kind: "firmware"|"expression", entry }.
// entry is the gallery expression object (with frames/colors) or null for firmware.
export function buildPlaylists(galleryData, firmwareKeys, showcaseNames) {
  const byName = new Map();
  for (const name of firmwareKeys || []) {
    if (!byName.has(name)) byName.set(name, { name, kind: "firmware", entry: null });
  }
  for (const e of (galleryData && galleryData.expressions) || []) {
    if (!byName.has(e.name)) byName.set(e.name, { name: e.name, kind: "expression", entry: e });
  }
  const all = [...byName.values()];
  const ambient = [];
  for (const name of showcaseNames || []) {
    const it = byName.get(name);
    if (it) ambient.push(it);
  }
  return { ambient, all };
}

// Wire the SSE fallback so it only draws while offline. `state` is a shared object the
// poll loop (in board.html) flips: state.online = true on a good framebuffer poll.
export function connectMirror({ panel, webSim, source, state }) {
  source.onmessage = (m) => {
    if (!mirrorGate(state.online)) return;          // board online → framebuffer owns the panel
    try { applyEvent(JSON.parse(m.data), { panel, webSim }); } catch { /* ignore malformed */ }
  };
  return source;
}

// How long (ms) a live SSE-driven expression latches before decaying to ambient.
export const DECAY_MS = 25000;

// The precedence state machine. A reachable board (mirror) is ground truth and never
// decays; a live Claude session latches the face for DECAY_MS after the last intent;
// a visitor pin holds otherwise; ambient is the resting floor.
export function arbitrate({ mirrorOk, lastSseAt, now, pinned }) {
  if (mirrorOk) return "mirror";
  if (lastSseAt != null && now - lastSseAt < DECAY_MS) return "live";
  if (pinned) return "pin";
  return "ambient";
}

// Hysteresis for the mirror: the board's framebuffer endpoint is heavy and a single poll often
// fails (503) or lags. Without a grace window, one miss instantly drops `mirrorOk` and a latched
// LIVE render (e.g. a wait spinner) flashes through before the next good poll restores the mirror.
// Treat the mirror as still valid for MIRROR_GRACE_MS after the last GOOD poll, so transient
// hiccups hold the last frame instead of surrendering the panel. lastMirrorAt = 0 means never.
export const MIRROR_GRACE_MS = 1500;
export function mirrorOkAt(lastMirrorAt, now) {
  return lastMirrorAt > 0 && now - lastMirrorAt < MIRROR_GRACE_MS;
}

// Pick the next ambient index, never repeating the current one (unless there's only
// one item). Uniform over the other length-1 slots; rng is injectable for tests.
export function nextIndex(cur, length, rng = Math.random) {
  if (length <= 1) return 0;
  let n = Math.floor(rng() * (length - 1));
  if (n >= cur) n++; // skip the current slot
  return n;
}

// Does this HTTP status come from our engine routes? 200 = board live, 503 = engine
// up but board unreachable. Anything else (e.g. 404 from a static host) means no
// engine — the page runs as a pure local showcase (no mirror poll, no SSE).
export function isEngineResponse(status) {
  return status === 200 || status === 503;
}
