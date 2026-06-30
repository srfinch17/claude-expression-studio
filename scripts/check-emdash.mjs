#!/usr/bin/env node
// check-emdash.mjs — guard against em-dashes (and en-dashes) sneaking into the repo.
//
// The maintainer treats the em-dash (U+2014) as a hard no across every user-facing and
// source surface: README, docs, the site, page copy, code comments, commit/PR text. It
// reads as machine-generated slop on a public repo. This check makes that rule mechanical
// instead of a thing to remember: it scans tracked text files for the literal characters
// AND their JSON/JS \u escapes, and fails CI/`npm run check` with the exact locations.
//
// Run: node scripts/check-emdash.mjs   (also part of `npm run check`)

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Binary / generated files that can legitimately contain these byte sequences, or where a
// hit would be a false positive we can't act on. Matched by extension (lowercased).
const SKIP_EXT = new Set([
  "png", "jpg", "jpeg", "webp", "gif", "ico", "svg", "woff", "woff2", "ttf", "otf",
  "mcpb", "zip", "bin", "pdf", "lock",
]);
// This checker itself names the characters it forbids; don't scan it.
const SKIP_PATH = new Set(["scripts/check-emdash.mjs"]);
// Claude's own working scratch (skill authoring + per-feature design specs/plans) is not part
// of the shipped product; the no-em-dash rule is enforced on everything else. Widen later if wanted.
const SKIP_PREFIX = [".claude/", "docs/superpowers/"];

// U+2014 em-dash, U+2013 en-dash; literal and \u-escaped forms.
const NEEDLES = ["—", "–", "\\u2014", "\\u2013"];

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .map((f) => f.trim())
  .filter(Boolean)
  .filter((f) => !SKIP_PATH.has(f))
  .filter((f) => !SKIP_PREFIX.some((p) => f.startsWith(p)))
  .filter((f) => {
    const ext = f.includes(".") ? f.split(".").pop().toLowerCase() : "";
    return !SKIP_EXT.has(ext);
  });

const hits = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }   // unreadable/binary -> skip
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const n of NEEDLES) {
      if (line.includes(n)) { hits.push({ f, line: i + 1, n, text: line.trim() }); break; }
    }
  });
}

if (hits.length) {
  console.error(`em-dash check FAILED: ${hits.length} occurrence(s) found.\n`);
  for (const h of hits) {
    const label = h.n.startsWith("\\") ? `escaped ${h.n}` : "char";
    console.error(`  ${h.f}:${h.line}  (${label})`);
    console.error(`    ${h.text.length > 120 ? h.text.slice(0, 120) + "…" : h.text}`);
  }
  console.error("\nReplace each with a colon, period, comma, or middot (·). No em-dashes in this repo.");
  process.exit(1);
}

console.log(`em-dash check OK (scanned ${files.length} tracked text files).`);
