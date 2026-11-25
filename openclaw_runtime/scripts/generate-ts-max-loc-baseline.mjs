#!/usr/bin/env node
// Refresh the checked-in 500-line LOC baseline from the current clean source tree.
// The checker continues to reject any new or grown offender after this snapshot.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_LINES = 500;
const SCAN_CONCURRENCY = 64;
const output = path.resolve(process.argv[2] ?? "scripts/ts-max-loc-baseline.json");
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((filePath) => existsSync(filePath))
  .filter((filePath) => filePath.endsWith(".ts") || filePath.endsWith(".tsx"));
const entries = {};
for (let start = 0; start < files.length; start += SCAN_CONCURRENCY) {
  const batch = files.slice(start, start + SCAN_CONCURRENCY);
  const results = await Promise.all(
    batch.map(async (filePath) => [
      filePath,
      (await readFile(filePath, "utf8")).split("\n").length,
    ]),
  );
  for (const [filePath, lines] of results) if (lines > MAX_LINES) entries[filePath] = lines;
}
await writeFile(
  output,
  JSON.stringify(
    {
      version: 1,
      maxLines: MAX_LINES,
      generatedAt: new Date().toISOString().slice(0, 10),
      source: "current clean runtime source tree; 500-line new/growth gate remains active",
      entries: Object.fromEntries(Object.entries(entries).toSorted(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  ) + "\n",
);
console.log(`LOC baseline refreshed: ${Object.keys(entries).length} tracked offenders`);
