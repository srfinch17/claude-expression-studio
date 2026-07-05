#!/usr/bin/env node
// check-tool-docs.mjs: make "docs follow code" mechanical for the MCP tool surface.
//
// The docs-follow-code HARD RULE (CLAUDE.md "How we work"): a new/changed user-facing
// capability is not done until the docs describing it are updated in the SAME change.
// The pin feature (matrix_pin/matrix_unpin) shipped in PR #10 but its docs lagged until
// PR #21, because nothing forced the question "did the docs get updated?" at commit time.
//
// This guard forces that question for the one slice that mechanizes cleanly: the set of
// registered MCP tools. Every tool declared in mcp_server/index.ts must be classified
// here as either:
//   true  = a headline, user-facing capability the docs must NAME. The guard asserts the
//           tool name appears in at least one doc surface (README, CLAUDE.md, or the site).
//   false = a utility/diagnostic/board-control tool that is not individually documented
//           (it is covered by the README's illustrative "..." list). No doc assertion,
//           but you consciously chose "false" rather than forgetting the tool exists.
//
// So: adding a tool fails the build until you classify it; classifying it `true` fails the
// build until it is documented; renaming/removing a tool fails until this map is updated
// (which also flags docs that may now reference a dead tool). The README stays free to use
// an illustrative list: the assertion is "named somewhere in the docs", not "in the README".
//
// When this check fails on a NEW tool, that is the reminder to honor the docs-follow-code
// rule for it, at the moment it is cheapest to do so.
//
// Run: node scripts/check-tool-docs.mjs   (also part of `npm run check`)

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS_SRC = "mcp_server/index.ts";
const DOC_SURFACES = ["README.md", "CLAUDE.md", "site/index.html"];

// The classification map: every registered tool -> must-be-documented?
//   true  = headline capability; the docs must name it (asserted below).
//   false = utility/diagnostic; covered by the illustrative list, not named individually.
// Adding a tool to index.ts without adding it here (or vice versa) fails the check.
const TOOL_DOCS = {
  // Headline, user-facing capabilities. Keep these named in the docs.
  matrix_express: true,
  presence_set: true,
  matrix_idle: true,
  matrix_pin: true,
  matrix_unpin: true,
  matrix_studio: true,
  matrix_mini: true,
  // Utility / diagnostic / board-control. Covered by the README's illustrative list.
  matrix_status: false,
  matrix_clear: false,
  matrix_version: false,
  matrix_set_brightness: false,
  matrix_show_text: false,
  matrix_set_animation: false,
  matrix_animate: false,
  matrix_list_expressions: false,
  matrix_get_temperature: false,
  matrix_get_weather_data: false,
  matrix_get_accelerometer: false,
  matrix_get_settings: false,
  matrix_set_settings: false,
};

// --- extract the registered tool names from the ListTools handler region ---
// Anchor on the handler REGISTRATIONS, not the bare schema names (which also co-occur in
// the import line, giving an empty region).
const src = readFileSync(path.join(REPO_ROOT, TOOLS_SRC), "utf8");
const startIdx = src.indexOf("setRequestHandler(ListToolsRequestSchema");
const endIdx = src.indexOf("setRequestHandler(CallToolRequestSchema");
if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  console.error(
    `tool-docs check FAILED: could not locate the ListTools..CallTools region in ${TOOLS_SRC}.\n` +
    `    The handler shape changed; update the region markers in scripts/check-tool-docs.mjs.`
  );
  process.exit(1);
}
const region = src.slice(startIdx, endIdx);
const codeTools = [...region.matchAll(/\bname:\s*"([^"]+)"/g)].map((m) => m[1]);
const codeSet = new Set(codeTools);

if (codeTools.length === 0) {
  console.error(`tool-docs check FAILED: parsed 0 tool names from ${TOOLS_SRC} (parser likely broke).`);
  process.exit(1);
}

// --- load doc surfaces once ---
const docs = DOC_SURFACES.map((rel) => ({ rel, text: readFileSync(path.join(REPO_ROOT, rel), "utf8") }));
const namedIn = (tool) => docs.filter((d) => d.text.includes(tool)).map((d) => d.rel);

const errors = [];

// 1. every registered tool must be classified here
for (const tool of codeSet) {
  if (!(tool in TOOL_DOCS)) {
    errors.push(
      `New tool "${tool}" is registered in ${TOOLS_SRC} but not classified in scripts/check-tool-docs.mjs.\n` +
      `    Add it to TOOL_DOCS: true if the docs must name it (then document it per the docs-follow-code rule), false if it is a utility tool.`
    );
  }
}

// 2. every classified tool must still be a registered tool
for (const tool of Object.keys(TOOL_DOCS)) {
  if (!codeSet.has(tool)) {
    errors.push(
      `Tool "${tool}" is classified in scripts/check-tool-docs.mjs but is no longer registered in ${TOOLS_SRC}.\n` +
      `    Remove it from TOOL_DOCS, and confirm no doc still references the removed/renamed tool.`
    );
  }
}

// 3. every tool marked as documented must be named in at least one doc surface
for (const [tool, mustDoc] of Object.entries(TOOL_DOCS)) {
  if (!mustDoc || !codeSet.has(tool)) continue;
  if (namedIn(tool).length === 0) {
    errors.push(
      `Tool "${tool}" is marked as documented but is named in none of: ${DOC_SURFACES.join(", ")}.\n` +
      `    Document it (docs follow code, same change) or set it to false in TOOL_DOCS if it is a utility tool.`
    );
  }
}

if (errors.length) {
  console.error(`tool-docs check FAILED: ${errors.length} problem(s) found.\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const documented = Object.values(TOOL_DOCS).filter(Boolean).length;
console.log(
  `tool-docs check OK (${codeSet.size} tools: ${documented} documented + named in docs, ${codeSet.size - documented} utility).`
);
