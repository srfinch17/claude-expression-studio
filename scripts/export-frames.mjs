// scripts/export-frames.mjs, bake the whole animation library into .cfr files
// (indexed-color binary frames, spec: docs/frames-file-format.md) so a future
// firmware "frames player" can loop the library standalone from LittleFS.
//
// Sources (reused machinery, no new renderer):
//   frame expressions: buildGalleryData() merges bored + canned + saved (de-duped)
//   generative sims:   shared/firmware-sims.js factories, stepped headlessly
//
// Pure parts (encode/decode, palette build, loop capture) are exported for tests;
// main() wires the real repo paths.
//
// Run: node scripts/export-frames.mjs [--out frames-out] [--report docs/frames-export-sizes.md]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveExpression } from "../shared/expressions.js";
import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";
import { buildGalleryData, loadCanned } from "./build-gallery-data.mjs";

export const MAGIC = "CFRM";
export const VERSION = 1;
export const HEADER_BYTES = 12;
export const MAX_COLORS = 256; // 1-byte indices; measured: only 3 of 15 sims exceed this

// ---- pixel plumbing: lit-pixel lists -> full 64-int RGB frames (0xRRGGBB) ----

const clamp8 = (v) => Math.max(0, Math.min(255, v | 0));

// pixels: [{x,y,r,g,b}] (the shared frame() / resolveFrame() convention).
// Returns a 64-entry row-major array (y*8+x, origin top-left), unlit = 0 (black).
export function litToRGB(pixels) {
  const f = new Array(64).fill(0);
  for (const p of pixels) {
    if (p.x < 0 || p.x > 7 || p.y < 0 || p.y > 7) continue;
    f[p.y * 8 + p.x] = (clamp8(p.r) << 16) | (clamp8(p.g) << 8) | clamp8(p.b);
  }
  return f;
}

// A saved/canned/bored expression json ({frames: charRows[], colors, ...}) -> RGB frames.
export function expressionFrames(json) {
  return resolveExpression(json).frames.map(litToRGB);
}

// ---- loop capture for generative sims ----

// Step a sim and hunt for an exact repeat (seamless loop). A frame first seen at i0
// re-occurring at i is a CANDIDATE period; frames[i0..i) is one clean cycle (skipping
// any cold-start warm-up before i0). A candidate only counts if the repetition holds
// for the WHOLE remaining capture: a short lookahead gets fooled by hold-still
// stretches (dancefloor between re-randomizes) and dark gaps (fireworks' empty sky).
// Tail candidates with under `verify` frames of lookahead are skipped as unconfirmable.
// No confirmed repeat inside maxMs = RNG-driven: keep a fallbackMs window, long
// enough that the loop seam is not jarring.
export function captureSimFrames(sim, { maxMs = 8000, fallbackMs = 6000, verify = 8 } = {}) {
  const n = Math.ceil(maxMs / sim.frame_ms) + verify;
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(litToRGB(sim.frame()));
  const keys = frames.map((f) => f.join(","));
  const seen = new Map();
  for (let i = 0; i < keys.length; i++) {
    const i0 = seen.get(keys[i]);
    if (i0 === undefined) { seen.set(keys[i], i); continue; }
    if (keys.length - i - 1 < verify) continue;
    let ok = true;
    for (let m = 1; i + m < keys.length; m++) {
      if (keys[i0 + m] !== keys[i + m]) { ok = false; break; }
    }
    if (ok) return { frames: frames.slice(i0, i), seamless: true, skipped: i0 };
  }
  return { frames: frames.slice(0, Math.ceil(fallbackMs / sim.frame_ms)), seamless: false, skipped: 0 };
}

// ---- palette build + indexing ----

// Distinct colors by frequency (ties: lower RGB value first, deterministic).
// If the anim uses more than maxColors, keep the most frequent; the rest map to
// their nearest kept color at index time.
// ponytail: frequency-greedy + nearest-neighbor quantization; only 3 sims need it
// on an 8x8. Upgrade to median-cut if gradient banding shows on hardware.
export function buildPalette(frames, maxColors = MAX_COLORS) {
  const freq = new Map();
  for (const f of frames) for (const c of f) freq.set(c, (freq.get(c) || 0) + 1);
  const sorted = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([c]) => c);
  return { palette: sorted.slice(0, maxColors), distinct: sorted.length };
}

function nearestIndex(c, palette) {
  const r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = r - (p >> 16 & 255), dg = g - (p >> 8 & 255), db = b - (p & 255);
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// RGB frames -> per-frame Uint8Array(64) of palette indices.
export function indexFrames(frames, palette) {
  const lookup = new Map(palette.map((c, i) => [c, i]));
  return frames.map((f) => {
    const out = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      let idx = lookup.get(f[i]);
      if (idx === undefined) { idx = nearestIndex(f[i], palette); lookup.set(f[i], idx); }
      out[i] = idx;
    }
    return out;
  });
}

// ---- binary encode / decode (decode = the reference parser for the firmware half) ----

// Layout (little-endian), see docs/frames-file-format.md:
//   0..3   magic "CFRM"      4     version u8 = 1     5      loop u8 (0 = forever)
//   6..7   frame_count u16   8..9  frame_ms u16       10..11 palette_size u16
//   then palette_size * 3 bytes RGB, then frame_count * 64 palette indices (row-major).
export function encodeCfr({ frames, frame_ms, loop = 0, maxColors = MAX_COLORS }) {
  if (!frames.length) throw new Error("no frames");
  if (frames.length > 65535) throw new Error("too many frames");
  if (frames.some((f) => f.length !== 64)) throw new Error("frames must be 64 pixels");
  if (!(frame_ms >= 1 && frame_ms <= 65535)) throw new Error(`bad frame_ms ${frame_ms}`);
  const { palette, distinct } = buildPalette(frames, maxColors);
  const indexed = indexFrames(frames, palette);
  const buf = Buffer.alloc(HEADER_BYTES + palette.length * 3 + frames.length * 64);
  buf.write(MAGIC, 0, "ascii");
  buf.writeUInt8(VERSION, 4);
  buf.writeUInt8(Math.min(loop, 255), 5);
  buf.writeUInt16LE(frames.length, 6);
  buf.writeUInt16LE(frame_ms, 8);
  buf.writeUInt16LE(palette.length, 10);
  let o = HEADER_BYTES;
  for (const c of palette) { buf[o++] = c >> 16 & 255; buf[o++] = c >> 8 & 255; buf[o++] = c & 255; }
  for (const f of indexed) { buf.set(f, o); o += 64; }
  return { buf, palette, distinct, quantized: distinct > palette.length };
}

export function decodeCfr(buf) {
  if (buf.toString("ascii", 0, 4) !== MAGIC) throw new Error("bad magic");
  const version = buf.readUInt8(4);
  if (version !== VERSION) throw new Error(`unsupported version ${version}`);
  const loop = buf.readUInt8(5);
  const frameCount = buf.readUInt16LE(6);
  const frame_ms = buf.readUInt16LE(8);
  const paletteSize = buf.readUInt16LE(10);
  const expected = HEADER_BYTES + paletteSize * 3 + frameCount * 64;
  if (buf.length !== expected) throw new Error(`bad length ${buf.length}, expected ${expected}`);
  let o = HEADER_BYTES;
  const palette = [];
  for (let i = 0; i < paletteSize; i++) { palette.push((buf[o] << 16) | (buf[o + 1] << 8) | buf[o + 2]); o += 3; }
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const idx = [...buf.subarray(o, o + 64)];
    if (idx.some((v) => v >= paletteSize)) throw new Error(`frame ${i} index out of palette range`);
    frames.push(idx);
    o += 64;
  }
  return { version, loop, frame_ms, palette, frames, framesRGB: frames.map((f) => f.map((i) => palette[i])) };
}

// ---- CLI ----

// Deterministic RNG for the export run so RNG sims (and the committed size report)
// are reproducible across runs. Swapped in only here, never in the pure functions.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function markdownReport(index) {
  const lines = [
    "# Frames export, size report",
    "",
    "Generated by `node scripts/export-frames.mjs --report docs/frames-export-sizes.md`.",
    "Format spec: [frames-file-format.md](frames-file-format.md). Output files are",
    "gitignored (`frames-out/`); this table is the committed record of what a full",
    "library bake measures. Sim captures use a fixed RNG seed, so re-running reproduces",
    "these numbers.",
    "",
    "| animation | source | frames | frame_ms | palette | distinct | quantized | bytes | loop |",
    "|---|---|---:|---:|---:|---:|---|---:|---|",
  ];
  for (const a of index.animations) {
    lines.push(`| ${a.name} | ${a.source} | ${a.frames} | ${a.frame_ms} | ${a.palette_size} | ${a.distinct_colors} | ${a.quantized ? "yes" : ""} | ${a.bytes} | ${a.loop_note} |`);
  }
  const kb = (index.totalBytes / 1024).toFixed(1);
  lines.push("", `**Total: ${index.animations.length} animations, ${index.totalBytes} bytes (${kb} KB).** Budget: well under 500 KB.`, "");
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const argVal = (flag) => { const i = args.indexOf(flag); return i > -1 ? args[i + 1] : null; };
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = argVal("--out") || join(root, "frames-out");
  const reportPath = argVal("--report");

  const canned = await loadCanned(join(root, "mcp_server/dist/expressions.js"))
    .catch((e) => { throw new Error(`canned module missing (run: cd mcp_server && npx tsc): ${e.message}`); });
  const gallery = buildGalleryData({
    canned,
    savedDir: join(root, "mcp_server/expressions"),
    manifestPath: join(root, "shared/manifest.json"),
    boredDir: join(root, "claude-hooks/bored_animations"),
    approvedPath: join(root, "studio/approved.json"),
  });

  Math.random = mulberry32(0xC0FFEE); // reproducible RNG-sim captures for this process

  const entries = [];
  for (const e of gallery.expressions) {
    entries.push({
      name: e.name, source: e.source, frame_ms: e.frame_ms, loop: e.loop,
      frames: expressionFrames(e), loop_note: e.loop === 0 ? "authored loop" : `authored, play x${e.loop}`,
    });
  }
  for (const [name, make] of Object.entries(FIRMWARE_SIMS)) {
    const sim = make({});
    const cap = captureSimFrames(sim);
    entries.push({
      name, source: "sim", frame_ms: sim.frame_ms, loop: 0, frames: cap.frames,
      loop_note: cap.seamless
        ? `seamless, period ${cap.frames.length}${cap.skipped ? ` (skipped ${cap.skipped} warm-up)` : ""}`
        : `window ${(cap.frames.length * sim.frame_ms / 1000).toFixed(1)}s (RNG, no exact period)`,
    });
  }

  mkdirSync(outDir, { recursive: true });
  const seenNames = new Set();
  const animations = [];
  let totalBytes = 0;
  for (const e of entries) {
    if (!/^[a-z0-9_-]+$/i.test(e.name)) throw new Error(`unsafe name "${e.name}"`);
    if (seenNames.has(e.name)) throw new Error(`duplicate name "${e.name}"`);
    seenNames.add(e.name);
    const { buf, palette, distinct, quantized } = encodeCfr(e);
    const file = `${e.name}.cfr`;
    writeFileSync(join(outDir, file), buf);
    totalBytes += buf.length;
    animations.push({
      name: e.name, source: e.source, file, frames: e.frames.length, frame_ms: e.frame_ms,
      loop: e.loop, palette_size: palette.length, distinct_colors: distinct,
      quantized, bytes: buf.length, loop_note: e.loop_note,
    });
  }
  animations.sort((a, b) => a.name.localeCompare(b.name));

  const index = {
    format: { magic: MAGIC, version: VERSION, spec: "docs/frames-file-format.md" },
    totalBytes,
    animations,
  };
  writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2));
  if (reportPath) writeFileSync(join(root, reportPath), markdownReport(index));

  const quantizedNames = animations.filter((a) => a.quantized).map((a) => a.name);
  console.log(`exported ${animations.length} animations -> ${outDir} (${(totalBytes / 1024).toFixed(1)} KB total)`);
  console.log(`quantized (over ${MAX_COLORS} distinct colors): ${quantizedNames.join(", ") || "none"}`);
  if (reportPath) console.log(`report -> ${reportPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
