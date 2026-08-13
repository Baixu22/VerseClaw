#!/usr/bin/env node
// Validates that every literal file path referenced by the Vitest path
// manifests and shard config files resolves to a real file on disk.
//
// Guards against the "manifest references a deleted test/source file" rot:
// when a path manifest or config lists a file that no longer exists, the
// shard silently runs fewer tests than intended (or none at all under
// passWithNoTests). Fail-fast so a stale reference turns CI red.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITEST_DIR = path.join(repoRoot, "test", "vitest");

const GLOB_CHARS = ["*", "?", "[", "]", "{", "}"];
const EXT_RE = /\.(?:ts|tsx|mjs|cjs|js|json)$/u;
const REPO_PREFIXES = ["src/", "test/", "packages/", "extensions/", "ui/", "apps/"];

function normalize(value) {
  return value.replaceAll("\\", "/");
}

function isLiteralRepoPath(value) {
  if (GLOB_CHARS.some((c) => value.includes(c))) return false;
  if (value.includes("node_modules") || value.startsWith("http")) return false;
  if (!EXT_RE.test(value)) return false;
  return REPO_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function existsOnDisk(repoRelative) {
  return fs.existsSync(path.join(repoRoot, ...repoRelative.split("/")));
}

// Extract string literals that look like repo-relative file paths.
function literalPathsFromSource(source) {
  const out = new Set();
  const re = /["'`]([^"'`\r\n]+)["'`]/gu;
  let m;
  while ((m = re.exec(source))) {
    const value = normalize(m[1]);
    if (isLiteralRepoPath(value)) out.add(value);
  }
  return [...out];
}

// Walk an exported value and collect literal file paths from any arrays
// (nested one level for {source,test} map entries).
function collectFromValue(value, out) {
  if (typeof value === "string") {
    if (isLiteralRepoPath(normalize(value))) out.add(normalize(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFromValue(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const key of ["test", "source", "config", "name", "file"]) {
      if (typeof value[key] === "string") {
        const v = normalize(value[key]);
        if (isLiteralRepoPath(v)) out.add(v);
      }
    }
  }
}

async function collectDangling() {
  const dangling = new Map(); // file -> sorted paths
  const files = fs
    .readdirSync(VITEST_DIR)
    .filter((name) => name.endsWith(".mjs") || name.endsWith(".ts"))
    .sort();

  for (const name of files) {
    const abs = path.join(VITEST_DIR, name);
    const rel = normalize(path.relative(repoRoot, abs));
    let src;
    try {
      src = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }

    const refs = new Set();
    if (name.endsWith(".mjs")) {
      // Prefer the real exported arrays for .mjs path manifests.
      let mod;
      try {
        mod = await import(pathToFileURL(abs).href);
      } catch {
        mod = null;
      }
      if (mod) {
        for (const value of Object.values(mod)) {
          if (Array.isArray(value)) collectFromValue(value, refs);
        }
      }
      // Also scan raw source for literal string paths (covers inline lists
      // that are not exported).
      for (const p of literalPathsFromSource(src)) refs.add(p);
    } else {
      for (const p of literalPathsFromSource(src)) refs.add(p);
    }

    const missing = [...refs].filter((p) => !existsOnDisk(p)).sort();
    if (missing.length > 0) dangling.set(rel, missing);
  }

  return dangling;
}

const dangling = await collectDangling();
const total = [...dangling.values()].reduce((sum, paths) => sum + paths.length, 0);

if (total === 0) {
  console.log("vitest manifest paths: OK (no dangling references)");
  process.exit(0);
}

console.error(`vitest manifest paths: ${total} dangling reference(s) across ${dangling.size} file(s):`);
for (const [file, paths] of dangling) {
  console.error(`\n${file} (${paths.length}):`);
  for (const p of paths) console.error(`  - ${p}`);
}
process.exit(1);
