#!/usr/bin/env node
// Issue #90: verify the curated zero-call deprecated export list.
//
// The runtime has thousands of dynamic imports, so a generic "unused export"
// scan is not authoritative. This guard uses an explicit, reviewed list:
//  - removed entries must not reappear as exported declarations;
//  - deprecated-public entries may remain, but must not gain call sites.
import fs from "node:fs";
import path from "node:path";
import { DEPRECATED_ZERO_CALL_ENTRIES } from "./lib/deprecated-zero-call-usage.mjs";

const repoRoot = process.cwd();
const SOURCE_ROOTS = ["src", "extensions", "packages"];
const SOURCE_FILE_RE = /\.(?:ts|tsx|mts|cts)$/u;
const SKIP_PATH_RE =
  /(?:^|\/)(?:node_modules|dist|build|coverage|\.turbo|protocol-generated)(?:\/|$)|(?:\.test|\.spec|\.e2e|\.generated)\.tsx?$/u;

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    const relativePath = path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
    if (SKIP_PATH_RE.test(relativePath)) continue;
    if (entry.isDirectory()) walk(filePath, files);
    else if (SOURCE_FILE_RE.test(entry.name)) files.push(filePath);
  }
  return files;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasExportedDeclaration(source, symbol) {
  const name = escapeRegExp(symbol);
  return new RegExp(
    `\\bexport\\s+(?:declare\\s+)?(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${name}\\b`,
    "u",
  ).test(source);
}

function callSiteCount(symbol, definingFile) {
  const pattern = new RegExp(`\\b${escapeRegExp(symbol)}\\b`, "gu");
  let count = 0;
  for (const sourceRoot of SOURCE_ROOTS) {
  for (const filePath of walk(path.join(repoRoot, sourceRoot))) {
    const relativePath = path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
    if (relativePath === definingFile) continue;
    const source = fs.readFileSync(filePath, "utf8");
    count += [...source.matchAll(pattern)].length;
  }
  }
  return count;
}

const violations = [];
for (const entry of DEPRECATED_ZERO_CALL_ENTRIES) {
  const filePath = path.join(repoRoot, entry.file);
  const source = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (entry.status === "removed") {
    if (source && hasExportedDeclaration(source, entry.symbol)) {
      violations.push(
        `removed-zero-call: ${entry.file}: ${entry.symbol} reappeared as an exported declaration`,
      );
    }
    continue;
  }
  if (!source || !hasExportedDeclaration(source, entry.symbol)) {
    violations.push(
      `deprecated-public: ${entry.file}: ${entry.symbol} is missing; remove the curated entry with its deprecation-cycle decision`,
    );
    continue;
  }
  const callSites = callSiteCount(entry.symbol, entry.file);
  if (callSites > 0) {
    violations.push(
      `deprecated-public: ${entry.file}: ${entry.symbol} has ${callSites} call-site reference(s); public removal must be scheduled instead of silently used`,
    );
  }
}

if (violations.length > 0) {
  console.error("Deprecated zero-call guard failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log(
  `deprecated zero-call guard passed (${DEPRECATED_ZERO_CALL_ENTRIES.length} curated entries)`,
);