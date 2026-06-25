// shared/renderers/web-sim.js — the in-browser canvas renderer. render(name) drives a
// shared/render.js Panel: a firmware-sim name plays its JS port via setStepper, a
// frame-expression name is resolved to pixel frames via setFrames. The Panel and the
// data loaders are injected so this dispatch logic is unit-testable with fakes.
//
// firmwareSims shape: { name: () => ({ frame_ms, frame() }) } — each value is a FACTORY
// (matching the real shared/firmware-sims.js FIRMWARE_SIMS export). Call it to get an
// instance before reading frame_ms / frame.
import { resolveExpression } from "../expressions.js";

export function makeWebSimRenderer({ panel, loadExpression, firmwareSims }) {
  return {
    id: "web-sim",
    render(name) {
      if (typeof name !== "string") return;
      const make = firmwareSims && firmwareSims[name];
      if (make) { const sim = make(); panel.setStepper(sim.frame, sim.frame_ms); return; }
      const json = loadExpression(name);
      if (!json) return;                       // unknown -> leave the panel as-is
      const resolved = resolveExpression(json);
      panel.setFrames(resolved.frames, resolved.frame_ms);
    },
  };
}
