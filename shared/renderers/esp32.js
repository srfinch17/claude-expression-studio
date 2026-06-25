// shared/renderers/esp32.js — the LED board renderer. render(name) either fires a
// firmware animation (transient) or loads the named frame-expression, converts it to
// the board wire format, and POSTs the frames. All I/O (load + HTTP) is injected so
// this is pure dispatch logic and unit-testable with fakes.
import { expressionToWire } from "../wire.js";

export function makeEsp32Renderer({ loadExpression, postFrames, postAnimation, isFirmware }) {
  return {
    id: "esp32-8x8",
    async render(name) {
      if (typeof name !== "string") return;          // defensive: only animation names here
      if (isFirmware(name)) { await postAnimation(name); return; }
      const json = loadExpression(name);
      if (!json) return;                              // missing expression -> no-op (never throw)
      await postFrames(expressionToWire(json));
    },
  };
}
