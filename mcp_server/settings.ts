// settings.ts, pure helpers for the MCP settings tools. The board validates and
// clamps; these just shape a partial patch (coerce types, refuse garbage) so
// Claude's free-form args become a clean POST body. Anything not applied is
// NAMED in `ignored` so the tool reply can say so instead of silently dropping.

export const KNOWN_SETTING_KEYS = [
  "idle_enabled", "idle_apps", "idle_after_secs", "idle_rotate_secs",
  "idle_brightness", "idle_random", "default_brightness", "boot_animation", "timezone",
  "calibration_correction",
  "mqtt_enabled", "mqtt_host", "mqtt_port", "mqtt_every_secs",
] as const;

export const NUMERIC_KEYS = new Set<string>(["idle_after_secs", "idle_rotate_secs", "idle_brightness", "default_brightness", "mqtt_port", "mqtt_every_secs"]);
export const BOOLEAN_KEYS = new Set<string>(["idle_enabled", "idle_random", "calibration_correction", "mqtt_enabled"]);

// Accept the spellings a model plausibly sends; refuse the rest rather than
// guess. "yes" coerced to false would INVERT intent, worse than dropping.
const TRUE_SPELLINGS = new Set<unknown>([true, "true", 1, "1"]);
const FALSE_SPELLINGS = new Set<unknown>([false, "false", 0, "0"]);

export function parseIdleApps(csv: string): string[] {
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

export function serializeIdleApps(list: string[]): string {
  return list.map((s) => s.trim()).filter(Boolean).join(",");
}

export function normalizeSettingsPatch(input: Record<string, unknown>): { patch: Record<string, unknown>; ignored: string[] } {
  const patch: Record<string, unknown> = {};
  const ignored: string[] = [];
  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined || raw === null) continue;
    if (!(KNOWN_SETTING_KEYS as readonly string[]).includes(key)) {
      ignored.push(`${key} (unknown setting)`);
    } else if (NUMERIC_KEYS.has(key)) {
      // Number("") is 0, which the board would clamp into a real value; treat
      // blank input as garbage, not zero.
      const n = typeof raw === "string" && raw.trim() === "" ? NaN : Number(raw);
      if (Number.isFinite(n)) patch[key] = n;
      else ignored.push(`${key} (not a number)`);
    } else if (BOOLEAN_KEYS.has(key)) {
      if (TRUE_SPELLINGS.has(raw)) patch[key] = true;
      else if (FALSE_SPELLINGS.has(raw)) patch[key] = false;
      else ignored.push(`${key} (not a boolean)`);
    } else {
      patch[key] = String(raw);
    }
  }
  return { patch, ignored };
}
