// shared/renderers/esp32.js — the LED board renderer. render(name, meta) either fires a
// firmware animation (transient, with optional meta.params forwarded) or loads the named
// frame-expression, converts it to the board wire format, and POSTs the frames. When
// meta.brightness is provided, setBrightness is called first (ambient idle dimming, etc.).
// All I/O (load + HTTP + brightness) is injected so this is pure dispatch logic and
// unit-testable with fakes.
import { expressionToWire } from "../wire.js";

export function makeEsp32Renderer({ loadExpression, postFrames, postAnimation, setBrightness, isFirmware }) {
  return {
    id: "esp32-8x8",
    async render(name, meta = {}) {
      if (typeof name !== "string") return;          // defensive: only animation names here
      if (meta && meta.brightness != null && typeof setBrightness === "function") {
        await setBrightness(meta.brightness);        // ambient idle dimming, etc.
      }
      if (isFirmware(name)) { await postAnimation(name, meta ? meta.params : undefined); return; }
      const json = loadExpression(name);
      if (!json) return;                              // missing expression -> no-op (never throw)
      await postFrames(expressionToWire(json));
    },
  };
}
