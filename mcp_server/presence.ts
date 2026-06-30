// Presence Protocol, the device-agnostic semantic message + its validator.
// This is the canonical IR definition; the MCP presence_set tool and (later)
// other renderers normalize through here. Pure + dependency-free so it unit-tests
// with the Node built-in runner (no board, no build step).

export type Urgency = "ambient" | "notice" | "urgent";

export interface Readout { value: number; unit?: string; label?: string; }

export type PresenceData =
  | { progress: number }                                   // 0..1 bar
  | { values: Readout[] }                                  // 1..3 readouts
  | { series: number[]; label?: string; unit?: string };   // <=32-point sparkline

export interface PresenceMessage {
  intent: string;
  headline?: string;
  detail?: string;
  data?: PresenceData;
  urgency: Urgency;
}

export const INTENTS = [
  "working", "thinking", "done", "ok", "celebrate",
  "alert", "error", "question", "info", "idle",
] as const;

const URGENCIES: Urgency[] = ["ambient", "notice", "urgent"];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeData(d: unknown): PresenceData | undefined {
  if (d == null) return undefined;
  if (!isObj(d)) throw new Error("data must be an object");
  const present = ["progress", "values", "series"].filter((k) => k in d);
  if (present.length === 0) return undefined;
  if (present.length > 1) throw new Error(`data must have exactly one of progress/values/series (got ${present.join("+")})`);

  if ("progress" in d) {
    const p = Number((d as Record<string, unknown>).progress);
    if (!Number.isFinite(p)) throw new Error("data.progress must be a number");
    return { progress: Math.max(0, Math.min(1, p)) };
  }
  if ("values" in d) {
    const arr = (d as Record<string, unknown>).values;
    if (!Array.isArray(arr) || arr.length < 1 || arr.length > 3)
      throw new Error("data.values must be an array of 1-3 readouts");
    const values: Readout[] = arr.map((r, i) => {
      if (!isObj(r)) throw new Error(`data.values[${i}] must be an object`);
      if (!Number.isFinite(Number(r.value))) throw new Error(`data.values[${i}].value must be a number`);
      const out: Readout = { value: Number(r.value) };
      if (r.unit != null) out.unit = String(r.unit);
      if (r.label != null) out.label = String(r.label);
      return out;
    });
    return { values };
  }
  const s = (d as Record<string, unknown>).series;
  if (!Array.isArray(s) || s.length < 1 || s.length > 32)
    throw new Error("data.series must be an array of 1-32 numbers");
  const series = s.map((n, i) => {
    const v = Number(n);
    if (!Number.isFinite(v)) throw new Error(`data.series[${i}] must be a number`);
    return v;
  });
  const out: { series: number[]; label?: string; unit?: string } = { series };
  const dd = d as Record<string, unknown>;
  if (dd.label != null) out.label = String(dd.label);
  if (dd.unit != null) out.unit = String(dd.unit);
  return out;
}

export function normalizePresence(input: unknown): PresenceMessage {
  if (!isObj(input)) throw new Error("presence message must be an object");
  const intent = input.intent;
  if (typeof intent !== "string" || intent.trim() === "")
    throw new Error("intent (non-empty string) is required");

  const msg: PresenceMessage = { intent: intent.trim(), urgency: "ambient" };
  if (input.headline != null) msg.headline = String(input.headline);
  if (input.detail != null) msg.detail = String(input.detail);

  if (input.urgency != null) {
    const u = String(input.urgency);
    if (!URGENCIES.includes(u as Urgency)) throw new Error(`urgency must be one of ${URGENCIES.join(", ")}`);
    msg.urgency = u as Urgency;
  }

  const data = normalizeData(input.data);
  if (data) msg.data = data;
  return msg; // ts intentionally omitted, the board stamps it
}
