// Disk-cached embedding provider wrapper.
//
// Wraps any RuntimeEmbeddingProvider with a persistent on-disk cache.
// Cache key: sha256(provider.id + ":" + text). Stored as JSONL (one entry per line)
// for incremental appends — no full rewrite per batch (the previous all-in-one
// JSON approach reached 202MB and caused OOM during write).
//
// Second run with the same texts hits the cache and skips API calls entirely.
//
// Usage:
//   const base = createSiliconFlowEmbeddingProvider();
//   const cached = wrapWithDiskCache(base, cachePath);
//
// Env:
//   DISABLE_EMBEDDING_CACHE=1  → bypass cache (always call underlying provider)
//   EMBEDDING_CACHE_VERBOSE=1  → log hit/miss stats

import { appendFileSync, existsSync, mkdirSync, statSync, createReadStream, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import type { RuntimeEmbeddingProvider } from "../../../openclaw_runtime/src/runtime-core/memory-embedding-provider.js";

type CacheEntry = {
  k: string; // sha256 hex key
  d: number[]; // embedding dimensions
};

const CACHE_VERSION = "2.0-jsonl-embedding-disk-cache";

const stats = {
  hits: 0,
  misses: 0,
  apiCalls: 0,
  apiBatchSize: 0,
};

function hashKey(providerId: string, text: string): string {
  return createHash("sha256")
    .update(`${providerId}\u0000${text}`)
    .digest("hex");
}

/**
 * Load cache entries from JSONL file (one CacheEntry per line).
 * The header line stores version + providerId for invalidation.
 *
 * Format:
 *   {"version":"2.0-...","providerId":"siliconflow-...","embeddingDim":4096}
 *   {"k":"abc...","d":[0.1,0.2,...]}
 *   {"k":"def...","d":[0.3,0.4,...]}
 *
 * Streaming implementation: reads line-by-line via readline to avoid OOM
 * on large cache files (1.7+ GB). The previous readFileSync+split approach
 * loaded the entire file into a single string + array, causing V8 heap
 * pressure that silently failed (caught error → empty entries → 0% hit rate).
 */
async function loadCacheEntries(cachePath: string, providerId: string): Promise<{ entries: Map<string, number[]>; embeddingDim: number }> {
  const entries = new Map<string, number[]>();
  if (!existsSync(cachePath)) {
    return { entries, embeddingDim: 0 };
  }
  let stat;
  try {
    stat = statSync(cachePath);
  } catch {
    return { entries, embeddingDim: 0 };
  }
  if (stat.size === 0) return { entries, embeddingDim: 0 };

  let embeddingDim = 0;
  let firstLineParsed = false;
  const inputStream = createReadStream(cachePath, { encoding: "utf-8", highWaterMark: 1024 * 1024 });
  const rl = createInterface({ input: inputStream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { version?: string; providerId?: string; embeddingDim?: number; k?: string; d?: number[] };
        if (!firstLineParsed) {
          // First line is header.
          if (parsed.version !== CACHE_VERSION || parsed.providerId !== providerId) {
            // Version/provider mismatch: ignore all entries.
            inputStream.destroy();
            return { entries, embeddingDim: 0 };
          }
          embeddingDim = parsed.embeddingDim ?? 0;
          firstLineParsed = true;
          continue;
        }
        if (parsed.k && Array.isArray(parsed.d)) {
          entries.set(parsed.k, parsed.d);
          if (embeddingDim === 0) embeddingDim = parsed.d.length;
        }
      } catch {
        // Skip malformed lines.
      }
    }
  } catch {
    // On any read error, return whatever entries were loaded so far.
  } finally {
    inputStream.destroy();
  }
  return { entries, embeddingDim };
}

function writeCacheHeader(cachePath: string, providerId: string, embeddingDim: number): void {
  const dir = dirname(cachePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const header = JSON.stringify({ version: CACHE_VERSION, providerId, embeddingDim }) + "\n";
  // Truncate existing file by overwriting with header.
  writeFileSync(cachePath, header);
}

function appendCacheEntry(cachePath: string, entry: CacheEntry): void {
  appendFileSync(cachePath, JSON.stringify(entry) + "\n");
}

/**
 * Wrap a RuntimeEmbeddingProvider with a disk cache.
 * - Hits: return cached embedding, no API call
 * - Misses: call underlying provider, append result to JSONL file
 * - No full-rewrite: JSONL allows O(1) appends without loading the whole file
 *
 * The cache loads asynchronously (streaming) on the first embedQuery/embedBatch
 * call. Subsequent calls reuse the in-memory Map. This avoids blocking the
 * event loop and avoids OOM from readFileSync on large cache files.
 */
export function wrapWithDiskCache(
  base: RuntimeEmbeddingProvider,
  cachePath: string,
  options: { verbose?: boolean } = {},
): RuntimeEmbeddingProvider {
  const disabled = process.env.DISABLE_EMBEDDING_CACHE === "1";
  const verbose = options.verbose ?? process.env.EMBEDDING_CACHE_VERBOSE === "1";

  let entriesPromise: Promise<Map<string, number[]>> | null = disabled
    ? null
    : null; // lazy init on first call
  let headerWritten = disabled ? false : existsSync(cachePath);

  const ensureEntries = async (): Promise<Map<string, number[]>> => {
    if (disabled) return new Map();
    if (entriesPromise) return entriesPromise;
    entriesPromise = loadCacheEntries(cachePath, base.id).then((r) => r.entries);
    return entriesPromise;
  };

  const ensureHeader = (): void => {
    if (headerWritten) return;
    const dir = dirname(cachePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeCacheHeader(cachePath, base.id, base.dimension);
    headerWritten = true;
  };

  return {
    id: base.id,
    dimension: base.dimension,
    embedQuery: async (text: string) => {
      if (disabled) return base.embedQuery(text);
      const cache = await ensureEntries();
      const key = hashKey(base.id, text);
      const hit = cache.get(key);
      if (hit && hit.length === base.dimension) {
        stats.hits += 1;
        return hit;
      }
      stats.misses += 1;
      const result = await base.embedQuery(text);
      if (result && result.length === base.dimension) {
        cache.set(key, result);
        ensureHeader();
        appendCacheEntry(cachePath, { k: key, d: result });
      }
      return result;
    },
    embedBatch: async (texts: string[]) => {
      if (disabled) return base.embedBatch(texts);
      const cache = await ensureEntries();
      const results: (number[] | null)[] = new Array(texts.length).fill(null);
      const missIndices: number[] = [];
      const missTexts: string[] = [];
      const missKeys: string[] = [];

      for (let i = 0; i < texts.length; i += 1) {
        const text = texts[i];
        const key = hashKey(base.id, text);
        const hit = cache.get(key);
        if (hit && hit.length === base.dimension) {
          stats.hits += 1;
          results[i] = hit;
        } else {
          stats.misses += 1;
          missIndices.push(i);
          missTexts.push(text);
          missKeys.push(key);
        }
      }

      if (verbose) {
        console.log(
          `[EmbedCache] batch n=${texts.length} hits=${results.filter((r) => r !== null).length} misses=${missTexts.length} (cumulative hits=${stats.hits} misses=${stats.misses})`,
        );
      }

      if (missTexts.length === 0) {
        return results.map((r) => r ?? []);
      }

      stats.apiCalls += 1;
      stats.apiBatchSize += missTexts.length;
      const fresh = await base.embedBatch(missTexts);
      // Append entries incrementally — no full rewrite.
      ensureHeader();
      const appendBuffer: string[] = [];
      for (let j = 0; j < fresh.length; j += 1) {
        const idx = missIndices[j];
        const emb = fresh[j];
        results[idx] = emb;
        if (emb && emb.length === base.dimension) {
          cache.set(missKeys[j], emb);
          appendBuffer.push(JSON.stringify({ k: missKeys[j], d: emb }));
        }
      }
      // Single append per batch — minimizes fs syscalls.
      if (appendBuffer.length > 0) {
        appendFileSync(cachePath, appendBuffer.join("\n") + "\n");
      }
      return results.map((r) => r ?? []);
    },
  } as RuntimeEmbeddingProvider;
}

export function getEmbeddingCacheStats(): { hits: number; misses: number; apiCalls: number; apiBatchSize: number; cacheSize: number } {
  return { ...stats, cacheSize: 0 };
}

export function resetEmbeddingCacheStats(): void {
  stats.hits = 0;
  stats.misses = 0;
  stats.apiCalls = 0;
  stats.apiBatchSize = 0;
}
