// Reusable "on your desk" floating companion component.
// Injects a fixed-corner glowing 8x8 LED panel with a label and optional
// dismiss button. Carries its own CSS (injected once via a <style> element).
// No DOM globals are touched at module load time — all DOM access is deferred
// into mountDeskSim() so the module imports cleanly in Node (e.g. for the
// import-sanity check: node -e "import('./shared/desk-sim.js').then(...)").
//
// Usage:
//   import { mountDeskSim } from "../shared/desk-sim.js";
//   const { el, panel, destroy } = mountDeskSim({
//     expression: { frames, colors, frame_ms },  // raw expression data
//     dismissible: true,                          // show the × button
//   });

import { resolveExpression } from "./expressions.js";
import { Panel } from "./render.js";

// ── CSS (injected once) ────────────────────────────────────────────────────
const CSS = `
.desk-sim {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 50;
  padding: 11px;
  border-radius: 16px;
  background: linear-gradient(160deg, #1a1a20, #0c0c10);
  border: 1px solid #26262f;
  box-shadow: 0 18px 50px -18px rgba(0,0,0,.9);
  transition: opacity .4s, transform .4s;
  cursor: default;
}
.desk-sim::before {
  content: "";
  position: absolute;
  inset: -30%;
  z-index: -1;
  border-radius: 40px;
  background: radial-gradient(closest-side, var(--glow, rgba(255,80,8,.5)), transparent 72%);
  filter: blur(10px);
  opacity: .6;
}
.desk-sim canvas {
  display: block;
  border-radius: 8px;
  background: #060608;
}
.desk-sim .desk-sim-lbl {
  font-family: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
  font-size: .56rem;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: #5d5e6a;
  text-align: center;
  margin-top: 7px;
}
.desk-sim .desk-sim-x {
  position: absolute;
  top: -9px;
  right: -9px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid #2c2c36;
  background: #15151b;
  color: #9a9ba6;
  font-size: .8rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  appearance: none;
  -webkit-appearance: none;
}
.desk-sim .desk-sim-x:hover { color: #ecedf2; }
.desk-sim.desk-sim-hidden {
  opacity: 0;
  transform: translateY(20px) scale(.9);
  pointer-events: none;
}
@media (max-width: 560px) { .desk-sim { display: none; } }
@media (prefers-reduced-motion: reduce) { .desk-sim::before { transition: none; } }
`;

let cssInjected = false;
function injectCSS() {
  if (cssInjected || typeof document === "undefined") return;
  cssInjected = true;
  const s = document.createElement("style");
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ── mountDeskSim ──────────────────────────────────────────────────────────

/**
 * Mount the desk-companion component.
 *
 * @param {object} opts
 * @param {object} opts.expression - Raw expression data: {frames, colors, frame_ms, ...}
 * @param {boolean} [opts.dismissible=false] - Show a dismiss (×) button
 * @returns {{ el: HTMLElement, panel: Panel, destroy(): void }}
 */
export function mountDeskSim({ expression, dismissible = false } = {}) {
  injectCSS();

  const REDUCE =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── Build the DOM ──
  const el = document.createElement("div");
  el.className = "desk-sim";

  if (dismissible) {
    const x = document.createElement("button");
    x.className = "desk-sim-x";
    x.title = "Dismiss";
    x.textContent = "×";
    x.addEventListener("click", () => el.classList.add("desk-sim-hidden"));
    el.appendChild(x);
  }

  // Canvas rendered at 2× resolution, displayed at 80×80 CSS px (same as site companion)
  const cv = document.createElement("canvas");
  cv.width = 160;
  cv.height = 160;
  cv.style.width = "80px";
  cv.style.height = "80px";
  el.appendChild(cv);

  const lbl = document.createElement("div");
  lbl.className = "desk-sim-lbl";
  lbl.textContent = "on your desk";
  el.appendChild(lbl);

  document.body.appendChild(el);

  // ── Resolve expression and wire Panel ──
  const resolved = resolveExpression(expression || { frames: [], colors: {} });
  const panel = new Panel(cv, { device: el });
  panel.setFrames(resolved.frames, resolved.frame_ms);

  // ── Animation loop (own RAF — independent of any page loop) ──
  let rafId = null;

  if (!REDUCE) {
    let last = performance.now();
    const loop = (now) => {
      const dt = now - last;
      last = now;
      panel.tick(dt, now);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  // ── destroy ──
  function destroy() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    el.remove();
  }

  return { el, panel, destroy };
}
