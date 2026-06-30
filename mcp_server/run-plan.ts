// mcp_server/run-plan.ts, execute a resolved RenderPlan against the board.
//
// The single rule that keeps the virtual board honest: the intent is ALWAYS broadcast to the
// SSE hub (D2, the virtual board mirrors the panel even with no hardware present), and an
// unreachable board is a BRANCH, not a thrown exception. Before this, the broadcast sat after
// a bare `await post(...)`; when the board was unplugged the fetch REJECTED, unwound past the
// broadcast (out to the tool's top-level "could not reach board" catch), and board.html, when
// offline, got no new event, so it froze on its last frame. Dependencies are injected so this
// is unit-testable without booting the MCP server (see run-plan.test.ts).
import type { RenderPlan } from "./engine.js";
import { planToDisplayEvent } from "./display-event.js";
import { CANNED, expressionToWire, type Expression } from "./expressions.js";

export type PostResult = { ok: boolean; status: number; body: string };

export interface PlanRunnerDeps {
  // POST to the board; may REJECT if the board is unreachable (we catch that below).
  post: (path: string, body?: object) => Promise<PostResult>;
  // Load a saved frame-expression by name (CANNED is checked first).
  loadExpression: (name: string) => Promise<Expression | null>;
  // Push the rendered intent to the virtual board. Best-effort; must not throw.
  broadcast: (event: ReturnType<typeof planToDisplayEvent>) => void;
}

export async function executePlan(plan: RenderPlan, deps: PlanRunnerDeps): Promise<string> {
  if (plan.kind === "noop") return "no binding";

  // A post that never throws: an unreachable board becomes { ok:false, status:0 } and flips
  // `unreachable`, so the broadcast below still runs and the tool returns a readable note
  // instead of unwinding to the top-level "could not reach board" catch.
  let unreachable = false;
  const tryPost = async (p: string, body?: object): Promise<PostResult> => {
    try {
      return await deps.post(p, body);
    } catch {
      unreachable = true;
      return { ok: false, status: 0, body: "" };
    }
  };

  if (plan.brightness != null) await tryPost("/api/brightness", { level: plan.brightness });

  if (plan.kind === "animation") {
    const r = await tryPost("/api/display/animation", { type: plan.type, ...plan.params, transient: true });
    deps.broadcast(planToDisplayEvent(plan));
    if (unreachable) return `${plan.type}, board unreachable, shown on virtual board`;
    return r.ok ? `${plan.type} (transient anim)` : `anim error ${r.status}`;
  }

  // frames: CANNED glyph or saved expression → /api/display/frames
  const expr = CANNED[plan.name] ?? (await deps.loadExpression(plan.name));
  if (!expr) return `no glyph for "${plan.name}"`;
  const wire = expressionToWire(expr);
  const r = await tryPost("/api/display/frames", wire);
  deps.broadcast(planToDisplayEvent(plan, wire));
  if (unreachable) return `${plan.name}, board unreachable, shown on virtual board`;
  return r.ok ? plan.name : `frames error ${r.status}`;
}
