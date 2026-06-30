// shared/presence-vocab.js, canonical web copy of the presence card's intent -> appearance
// table (the 10 PresenceMessage intents in mcp_server/presence.ts). Kept content-identical to
// esp32_matrix_webserver/data/presence-vocab.js (the board's copy); the parity test enforces it.
// glyph = a single char drawn large; color = CSS hex; motion = a CSS animation key.
export const PRESENCE_VOCAB = {
  working:   { label: "Working",   glyph: "◐", color: "#e0a020", motion: "pulse" },
  thinking:  { label: "Thinking",  glyph: "…", color: "#3a78d0", motion: "shimmer" },
  done:      { label: "Done",      glyph: "✓", color: "#33c06a", motion: "settle" },
  ok:        { label: "OK",        glyph: "✓", color: "#33c06a", motion: "none" },
  celebrate: { label: "Celebrate", glyph: "✦", color: "#d24bd2", motion: "burst" },
  alert:     { label: "Needs you", glyph: "!", color: "#e0a020", motion: "blink" },
  error:     { label: "Error",     glyph: "✗", color: "#e0473c", motion: "blink" },
  question:  { label: "Question",  glyph: "?", color: "#3a78d0", motion: "pulse" },
  info:      { label: "Info",      glyph: "i", color: "#7a8aa0", motion: "none" },
  idle:      { label: "Idle",      glyph: "z", color: "#46506a", motion: "breathe" },
};

export const GENERIC = { label: "Status", glyph: "○", color: "#7a8aa0", motion: "none" };
