// settings.ts, pure helpers for the MCP settings tools. The board validates and
// clamps; these just shape a partial patch (drop unknown keys, coerce types) so
// Claude's free-form args become a clean POST body.

export const KNOWN_SETTING_KEYS = [
  "idle_enabled", "idle_apps", "idle_after_secs", "idle_rotate_secs",
  "idle_brightness", "idle_random", "default_brightness", "boot_animation", "timezone",
  "calibration_correction",
  "mqtt_enabled", "mqtt_host", "mqtt_port", "mqtt_every_secs",
] as const;

const NUMERIC = new Set(["idle_after_secs", "idle_rotate_secs", "idle_brightness", "default_brightness", "mqtt_port", "mqtt_every_secs"]);
const BOOLEAN = new Set(["idle_enabled", "idle_random", "calibration_correction", "mqtt_enabled"]);

export function parseIdleApps(csv: string): string[] {
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

export function serializeIdleApps(list: string[]): string {
  return list.map((s) => s.trim()).filter(Boolean).join(",");
}

export function normalizeSettingsPatch(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KNOWN_SETTING_KEYS) {
    if (!(key in input) || input[key] === undefined || input[key] === null) continue;
    let v = input[key];
    if (NUMERIC.has(key)) v = Number(v);
    else if (BOOLEAN.has(key)) v = v === true || v === "true";
    else v = String(v);
    out[key] = v;
  }
  return out;
}
