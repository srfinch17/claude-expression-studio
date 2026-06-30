// studio/presence-samples.js, fixed sample PresenceData for the presence playground's
// data-type selector. Pure; unit-tested. Shapes match mcp_server/presence.ts PresenceData.
export function sampleData(kind) {
  switch (kind) {
    case "progress": return { progress: 0.62 };
    case "values":   return { values: [
      { value: 72, unit: "°F", label: "temp" },
      { value: 41, unit: "%", label: "humidity" },
    ] };
    case "series":   return { series: [3, 5, 4, 8, 6, 9, 7, 11, 10, 13], label: "tokens", unit: "k" };
    default:         return undefined; // "none"
  }
}
