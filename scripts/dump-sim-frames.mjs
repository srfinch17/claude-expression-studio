// scripts/dump-sim-frames.mjs, step a firmware sim N frames into the board wire
// format ({frames:["<384 hex>"], frame_ms, raw:true}) so render-contact-sheet.py can
// render a generative (continuous-color) sim board-free for the animator/critic loop.
import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const hex2 = (n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, "0");

// Step a sim N frames → { frames: ["<384 hex row-major>"], frame_ms, raw:true }.
export function dumpSim(name, frames = 12, opts = {}) {
  const make = FIRMWARE_SIMS[name];
  if (!make) throw new Error(`unknown sim "${name}", known: ${Object.keys(FIRMWARE_SIMS).join(", ")}`);
  const sim = make(opts);
  const out = [];
  for (let n = 0; n < frames; n++) {
    const cells = new Array(64).fill("000000");
    for (const p of sim.frame()) {
      if (p.x < 0 || p.x > 7 || p.y < 0 || p.y > 7) continue;
      cells[p.y * 8 + p.x] = hex2(p.r) + hex2(p.g) + hex2(p.b);
    }
    out.push(cells.join(""));
  }
  return { frames: out, frame_ms: sim.frame_ms, raw: true };
}

// CLI: node scripts/dump-sim-frames.mjs <name> [frames] [-o out.json]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , name, framesArg] = process.argv;
  const oIdx = process.argv.indexOf("-o");
  const out = oIdx > -1 ? process.argv[oIdx + 1] : `${name}.frames.json`;
  const data = dumpSim(name, framesArg ? Number(framesArg) : 12);
  writeFileSync(out, JSON.stringify(data));
  console.log(`wrote ${out} (${data.frames.length} frames @ ${data.frame_ms}ms)`);
}
