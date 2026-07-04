#!/usr/bin/env node
// check-links.mjs: guard the public showcase against cross-repo link drift.
//
// At the 2026-06-28 repo split the .mcpb + MCP server moved into THIS repo
// (claude-expression-studio) while the board firmware stayed in peckworks-esp32s3matrix.
// The public Pages front door (site/index.html, deployed to the bundle root by
// scripts/build-pages.mjs) kept sending every "GitHub / source / docs" link at the
// firmware repo, so visitors landed on the wrong project and could not find the .mcpb.
//
// This makes the invariant mechanical instead of a thing to remember:
//   1. The showcase must self-link at least once (it represents THIS repo).
//   2. Any link to the firmware repo must say "firmware" in its own anchor text, so a
//      generic "GitHub" / "View source" link can never silently point at the board repo.
// Scoped to site/index.html on purpose: the README's Hardware-section firmware link is
// legitimately un-annotated, and this guard is about the deployed public page.
//
// Run: node scripts/check-links.mjs   (also part of `npm run check`)

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOWCASE = "site/index.html";
const SELF_REPO = "github.com/srfinch17/claude-expression-studio";
// Bare slug so this catches BOTH the firmware GitHub repo (github.com/.../peckworks-esp32s3matrix)
// AND its Pages site (srfinch17.github.io/peckworks-esp32s3matrix) in one rule.
const FIRMWARE_SLUG = "peckworks-esp32s3matrix";

const html = readFileSync(path.join(REPO_ROOT, SHOWCASE), "utf8");
const errors = [];

// 1. must self-link at least once
if (!html.includes(SELF_REPO)) {
  errors.push(`${SHOWCASE} has no link to its own repo (${SELF_REPO}). The showcase represents THIS repo.`);
}

// 2. every firmware-repo anchor must name "firmware" in its visible text
const anchorRe = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
let m;
while ((m = anchorRe.exec(html)) !== null) {
  const [, href, inner] = m;
  if (!href.includes(FIRMWARE_SLUG)) continue;
  const text = inner.replace(/<[^>]*>/g, "").trim();
  if (!/firmware/i.test(text)) {
    const line = html.slice(0, m.index).split("\n").length;
    errors.push(
      `${SHOWCASE}:${line}  links to the board firmware (${FIRMWARE_SLUG}) but its anchor text ("${text}") does not say "firmware".\n` +
      `    Generic project/source links must point at ${SELF_REPO}; only explicit board-firmware links may point at ${FIRMWARE_SLUG}.`
    );
  }
}

if (errors.length) {
  console.error(`link check FAILED: ${errors.length} problem(s) found.\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

console.log(`link check OK (${SHOWCASE}: self-links present, firmware links annotated).`);
