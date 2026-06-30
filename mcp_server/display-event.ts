// mcp_server/display-event.ts, PURE map from a RenderPlan to the wire DisplayEvent the
// virtual board consumes. The `wire` arg is the expressionToWire() payload index.ts has
// already computed for the board POST (frames path); we just forward it so the virtual
// board renders the exact same frames the hardware does.
import type { RenderPlan } from "./engine.js";
import type { DisplayEvent } from "./sse.js";

export function planToDisplayEvent(plan: RenderPlan, wire?: unknown): DisplayEvent {
  if (plan.kind === "noop") return { kind: "noop" };
  if (plan.kind === "animation") {
    const ev: DisplayEvent = { kind: "animation", type: plan.type, params: plan.params };
    if (plan.brightness != null) ev.brightness = plan.brightness;
    return ev;
  }
  const ev: DisplayEvent = { kind: "frames", name: plan.name, wire };
  if (plan.brightness != null) ev.brightness = plan.brightness;
  return ev;
}
