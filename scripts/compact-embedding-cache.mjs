#!/usr/bin/env node
// Compact the embedding cache JSONL file by deduplicating entries.
// Reads line-by-line (streaming) to avoid OOM on the 3+ GB cache file.
//
// Usage: node scripts/compact-embedding-cache.mjs <cachePath>

import { createReadStream, createWriteStream, renameSync, existsSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, dirname } from "node:path";

async function compactCache(cachePath) {
  if (!existsSync(cachePath)) {
    console.error(`Cache file not found: ${cachePath}`);
    process.exit(1);
  }

  const tempPath = cachePath + ".compact.tmp";
  const seenKeys = new Set();
  let header = null;
  let totalLines = 0;
  let keptLines = 0;
  let droppedDuplicates = 0;

  const inputStream = createReadStream(cachePath, { encoding: "utf-8", highWaterMark: 1024 * 1024 });
  const outputStream = createWriteStream(tempPath, { encoding: "utf-8" });
  const rl = createInterface({ input: inputStream, crlfDelay: Infinity });

  for await (const line of rl) {
    totalLines++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (!header) {
        // First line is header
        header = parsed;
        outputStream.write(trimmed + "\n");
        continue;
      }
      if (parsed.k && Array.isArray(parsed.d)) {
        if (seenKeys.has(parsed.k)) {
          droppedDuplicates++;
          continue;
        }
        seenKeys.add(parsed.k);
        outputStream.write(trimmed + "\n");
        keptLines++;
      }
    } catch {
      // Skip malformed lines
    }
  }

  await new Promise((resolve) => outputStream.end(resolve));
  inputStream.destroy();

  // Replace original with compacted
  renameSync(tempPath, cachePath);

  console.log(`Compacted embedding cache:`);
  console.log(`  Total lines: ${totalLines}`);
  console.log(`  Kept entries: ${keptLines}`);
  console.log(`  Dropped duplicates: ${droppedDuplicates}`);
  console.log(`  Output: ${cachePath}`);
}

const cachePath = process.argv[2] || join(process.cwd(), "artifacts", "runtime-memory-eval", "embedding-cache.json");
compactCache(cachePath).catch((err) => {
  console.error("Failed to compact cache:", err);
  process.exit(1);
});
