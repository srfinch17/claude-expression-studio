// matrix_idle — curated lineup of pre-approved apps + a pure picker.
// Claude calls the matrix_idle MCP tool when idle/bored to show "something cool".
// Edit IDLE_APPS (or any app's params) to change the lineup or tune a look —
// the list is fixed in code, so changes need `npx tsc` + an /mcp reconnect.

export interface IdleApp {
  type: string;                     // firmware animation type
  label: string;                    // human label used in the tool's reply
  params: Record<string, unknown>;  // launch params POSTed to /api/display/animation
}

// Ambient brightness every idle launch applies, so a pick never blasts at full.
export const IDLE_BRIGHTNESS = 5;

// Sensible starter params (real keys from each app's control page) — tune later.
// "matrix" = the matrix_rain type. speed is firmware ms-per-frame.
export const IDLE_APPS: IdleApp[] = [
  { type: "fire",        label: "🔥 fire",        params: { speed: 50, intensity: 70 } },
  { type: "dancefloor",  label: "🪩 dance floor", params: { palette: 0, hold: 6 } },
  { type: "fireworks",   label: "🎆 fireworks",   params: { color1: "#ff0050", color2: "#00e0ff", color3: "#ffd000" } },
  { type: "clock",       label: "🕐 clock",       params: { color1: "#00ff88", color2: "#0088ff", color3: "#ff4040" } },
  { type: "frostbite",   label: "❄️ frostbite",   params: { color: "#66ccff", sparkle: 5, mist: 4 } },
  { type: "matrix_rain", label: "🟩 matrix",      params: { theme: "classic", speed: 60 } },
];

// Pick a random app, avoiding an immediate repeat of lastType when there are
// >=2 apps. rng is injectable so tests are deterministic.
export function pickIdleApp(
  apps: IdleApp[],
  lastType: string | null,
  rng: () => number = Math.random,
): IdleApp {
  if (apps.length === 0) throw new Error("IDLE_APPS is empty");
  const filtered = apps.length >= 2 ? apps.filter((a) => a.type !== lastType) : apps;
  const pool = filtered.length > 0 ? filtered : apps; // safety if all share lastType
  return pool[Math.floor(rng() * pool.length)];
}
