// Maps an expression name to the auto-rotation that owns it (or "orphan").
// Pure + data-driven so it stays honest: feed it the real wait/bored name sets.

export const WAIT_PREFIX = "wait-";
export const ASK_PREFIX = "ask-";

export function classifyExpression(name, ctx) {
  if (name.startsWith(ASK_PREFIX)) return "ask";
  if (name.startsWith(WAIT_PREFIX) || ctx.waitNames.has(name)) return "wait";
  if (ctx.boredNames.has(name)) return "bored";
  return "orphan";
}

export function buildCatalog(names, ctx) {
  const cat = { wait: [], ask: [], bored: [], orphan: [] };
  for (const name of names) cat[classifyExpression(name, ctx)].push(name);
  return cat;
}
