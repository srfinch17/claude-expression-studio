// mcp_server/engine.ts, the bridge from the shared Trigger Manifest resolver to the
// board's HTTP API. The resolver (shared/resolver.js) is the single brain; this module
// only decides HOW to render a resolved pick and WHERE to load the manifest/resolver from.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface Resolved {
  intent: string;
  value: unknown;
  params?: Record<string, unknown>;
  label?: string;
  brightness?: number;
}

export type RenderPlan =
  | { kind: "animation"; type: string; params: Record<string, unknown>; brightness?: number }
  | { kind: "frames"; name: string; brightness?: number }
  | { kind: "noop" };

// PURE: firmware names go to /api/display/animation (transient); everything else is a
// frame-expression name for /api/display/frames. brightness rides along when present.
export function decideRender(resolved: Resolved | null, isFirmware: (n: string) => boolean): RenderPlan {
  if (!resolved || typeof resolved.value !== "string") return { kind: "noop" };
  const name = resolved.value;
  const bri = resolved.brightness != null ? { brightness: resolved.brightness } : {};
  if (isFirmware(name)) return { kind: "animation", type: name, params: resolved.params ?? {}, ...bri };
  return { kind: "frames", name, ...bri };
}

// Locate the shared engine assets: prefer the live repo source (always fresh in dev),
// fall back to the in-bundle copy (the packed .mcpb has no ../shared, see Task 9).
export function engineDir(mcpDir: string): string {
  const repo = path.join(mcpDir, "..", "shared");
  if (existsSync(path.join(repo, "manifest.json"))) return repo;
  return path.join(mcpDir, "shared-runtime");
}

// Load the manifest (JSON) + the resolver and firmware-name helpers (dynamic import of a
// computed file URL, typed `any`, so no .d.ts is needed for the plain-JS shared modules).
export async function loadEngine(mcpDir: string) {
  const dir = engineDir(mcpDir);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
  const { resolve } = await import(pathToFileURL(path.join(dir, "resolver.js")).href);
  const { isFirmwareName, FIRMWARE_NAMES } = await import(pathToFileURL(path.join(dir, "firmware-names.js")).href);
  return {
    manifest,
    resolve,
    isFirmwareName: isFirmwareName as (n: string) => boolean,
    // Sorted list of the firmware-native mode names, for the unified catalog.
    firmwareNames: [...(FIRMWARE_NAMES as Set<string>)].sort() as string[],
  };
}
