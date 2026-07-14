// On-demand materialization closure (SPEC §3 / Task 3 — original to this rebuild, no
// ragcode counterpart): query touches paths → hash-compare against the FactStore →
// fresh hits are reused, misses and stale entries are re-analyzed by the cheapest
// capable producer within a per-query parse budget → results are memoized back into
// the store → everything over budget is declared, never silently dropped.
// This module is the only sanctioned Producer→FactStore bridge; Views must go through
// the store ("缺失→触发 Producer→记忆化" closure), never call producers directly.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { CodeChunk, CodeFile } from "../fact-types.js";
import { analyzeFileWithRegistry } from "../producers/analyzers/registry.js";
import { projectIdForRoot, sha256 } from "../producers/hash.js";
import { languageForPath, ripgrepSearch } from "../producers/ripgrep-producer.js";
import { factStoreIgnoreReason, normalizeFactPath } from "./ignore.js";
import type { FactProducer, FactStore } from "./store.js";

/** Per-query parse budget (§3 guardrail): over budget ⇒ declared, not parsed. */
export const DEFAULT_MAX_PARSE_PER_QUERY = 12;
/** Files larger than this are skipped, mirroring agent-map's maxFileBytes guardrail. */
export const DEFAULT_MAX_MATERIALIZE_FILE_BYTES = 256 * 1024;

export interface MaterializeBudget {
  maxParsePerQuery?: number;
  maxFileBytes?: number;
}

export interface EnsureFactsInput {
  /** Repo-relative candidate paths the query touches (deduped, order preserved). */
  paths: string[];
  budget?: MaterializeBudget;
  nowMs?: number;
}

export interface EnsureFactsTimings {
  /** Wall time spent on freshness checks (hash reads + store lookups). */
  checkMs: number;
  /** Wall time spent parsing + writing facts. */
  parseMs: number;
  totalMs: number;
  parseMsByPath: Record<string, number>;
}

export interface EnsureFactsResult {
  /** Hit and hash-fresh: served from the store, zero parsing. */
  fresh: string[];
  /** Parsed (miss or stale) and memoized into the store this call. */
  parsed: string[];
  /** Over the parse budget: declared for the caller's missingEvidence. */
  deferred: string[];
  /** Ready-to-emit missingEvidence lines for the deferred paths (§3 honest-gap contract). */
  missingEvidence: string[];
  skipped: Array<{ path: string; reason: string }>;
  failed: Array<{ path: string; error: string }>;
  timings: EnsureFactsTimings;
}

export interface Materializer {
  readonly repoRoot: string;
  readonly projectId: string;
  ensureFacts(input: EnsureFactsInput): EnsureFactsResult;
  /**
   * T0 grep fallback (§3 degradation chain): runs ripgrep over the repo, memoizes the
   * text hits as chunks (producer=ripgrep, produced_hash empty ⇒ structurally stale by
   * definition) for files the store has never analyzed, and returns the hit chunks.
   */
  ensureTextFacts(pattern: string, options?: EnsureTextFactsOptions): Promise<EnsureTextFactsResult>;
  /** parse-on-touch hook: agent Read/Grep tools report each file they actually read. */
  onFileTouched(relPath: string): void;
  /** Drains the touch queue through ensureFacts under the same budget rules. */
  flushTouched(budget?: MaterializeBudget): EnsureFactsResult;
  pendingTouchedCount(): number;
}

export interface EnsureTextFactsOptions {
  maxMatches?: number;
  timeoutMs?: number;
}

export interface EnsureTextFactsResult {
  chunks: CodeChunk[];
  /** Files whose text chunks were memoized into the store this call (previously unknown files). */
  backfilled: string[];
  truncated: boolean;
  error?: string;
}

export interface CreateMaterializerOptions {
  budget?: MaterializeBudget;
  /** Test seam: override how file content is read. */
  readFile?: (absolutePath: string) => { content: string; sizeBytes: number; modifiedAtMs: number };
}

export function createMaterializer(
  store: FactStore,
  repoRoot: string,
  options: CreateMaterializerOptions = {},
): Materializer {
  const resolvedRoot = path.resolve(repoRoot);
  const projectId = projectIdForRoot(resolvedRoot);
  const readFile = options.readFile ?? defaultReadFile;
  const touched = new Set<string>();

  const ensureFacts = (input: EnsureFactsInput): EnsureFactsResult => {
    const startedAt = performance.now();
    const maxParse = input.budget?.maxParsePerQuery ?? options.budget?.maxParsePerQuery ?? DEFAULT_MAX_PARSE_PER_QUERY;
    const maxFileBytes = input.budget?.maxFileBytes ?? options.budget?.maxFileBytes ?? DEFAULT_MAX_MATERIALIZE_FILE_BYTES;

    const fresh: string[] = [];
    const parsed: string[] = [];
    const deferred: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    const failed: Array<{ path: string; error: string }> = [];
    const parseMsByPath: Record<string, number> = {};
    const parseQueue: Array<{ relPath: string; content: string; sizeBytes: number; modifiedAtMs: number; contentHash: string }> = [];

    const checkStart = performance.now();
    const seen = new Set<string>();
    for (const rawPath of input.paths) {
      const relPath = normalizeFactPath(rawPath);
      if (!relPath || seen.has(relPath)) continue;
      seen.add(relPath);

      const ignoreReason = factStoreIgnoreReason(relPath);
      if (ignoreReason) {
        skipped.push({ path: relPath, reason: ignoreReason });
        continue;
      }

      let current: { content: string; sizeBytes: number; modifiedAtMs: number };
      try {
        current = readFile(path.join(resolvedRoot, relPath));
      } catch (error) {
        failed.push({ path: relPath, error: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (current.sizeBytes > maxFileBytes) {
        skipped.push({ path: relPath, reason: `max_file_bytes_exceeded:${current.sizeBytes}` });
        continue;
      }

      const contentHash = sha256(current.content);
      const record = store.getFileRecord(resolvedRoot, relPath);
      if (record && record.provenance.producedHash === contentHash) {
        fresh.push(relPath);
        continue;
      }
      parseQueue.push({ relPath, ...current, contentHash });
    }
    const checkMs = performance.now() - checkStart;

    const parseStart = performance.now();
    let parseAttempts = 0;
    for (const entry of parseQueue) {
      if (parseAttempts >= maxParse) {
        deferred.push(entry.relPath);
        continue;
      }
      parseAttempts += 1;
      const fileStart = performance.now();
      try {
        const language = languageForPath(entry.relPath);
        const file: CodeFile = {
          projectId,
          path: entry.relPath,
          absolutePath: path.join(resolvedRoot, entry.relPath),
          language,
          sizeBytes: entry.sizeBytes,
          contentHash: entry.contentHash,
          modifiedAtMs: entry.modifiedAtMs,
        };
        const analysis = analyzeFileWithRegistry({ repoRoot: resolvedRoot, file, content: entry.content });
        const result = store.upsertFileFacts({
          repoRoot: resolvedRoot,
          file,
          producer: producerForLanguage(language),
          symbols: analysis.symbols,
          edges: analysis.edges,
          chunks: analysis.chunks,
          nowMs: input.nowMs,
        });
        if (result.stored) {
          parsed.push(entry.relPath);
          parseMsByPath[entry.relPath] = performance.now() - fileStart;
        } else {
          skipped.push({ path: entry.relPath, reason: result.reason });
        }
      } catch (error) {
        failed.push({ path: entry.relPath, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const parseMs = performance.now() - parseStart;

    const touchedPaths = [...fresh, ...parsed];
    if (touchedPaths.length > 0) {
      store.recordTouch(resolvedRoot, touchedPaths, input.nowMs);
    }

    return {
      fresh,
      parsed,
      deferred,
      missingEvidence: deferred.map(
        (relPath) => `parse_budget_exhausted (maxParsePerQuery=${maxParse}): ${relPath} not yet analyzed`,
      ),
      skipped,
      failed,
      timings: {
        checkMs,
        parseMs,
        totalMs: performance.now() - startedAt,
        parseMsByPath,
      },
    };
  };

  return {
    repoRoot: resolvedRoot,
    projectId,
    ensureFacts,
    async ensureTextFacts(pattern: string, textOptions: EnsureTextFactsOptions = {}): Promise<EnsureTextFactsResult> {
      const result = await ripgrepSearch(pattern, resolvedRoot, {
        projectId,
        maxMatches: textOptions.maxMatches ?? 60,
        timeoutMs: textOptions.timeoutMs,
      });
      const chunks = result.chunks.filter((chunk) => !factStoreIgnoreReason(chunk.filePath));
      const chunksByFile = new Map<string, CodeChunk[]>();
      for (const chunk of chunks) {
        const list = chunksByFile.get(chunk.filePath) ?? [];
        list.push(chunk);
        chunksByFile.set(chunk.filePath, list);
      }
      const backfilled: string[] = [];
      for (const [relPath, fileChunks] of chunksByFile) {
        // Only memoize files the store knows nothing about — never clobber
        // structural facts with text-only ones.
        if (store.getFileRecord(resolvedRoot, relPath)) continue;
        const upsert = store.upsertFileFacts({
          repoRoot: resolvedRoot,
          file: {
            projectId,
            path: relPath,
            absolutePath: path.join(resolvedRoot, relPath),
            language: languageForPath(relPath),
            sizeBytes: 0,
            // Unknown content hash: produced_hash stays empty, so the freshness
            // gate reports these facts stale until a structural producer runs.
            contentHash: "",
            modifiedAtMs: 0,
          },
          producer: "ripgrep",
          symbols: [],
          edges: [],
          chunks: fileChunks,
        });
        if (upsert.stored) backfilled.push(relPath);
      }
      return { chunks, backfilled, truncated: result.truncated, ...(result.error ? { error: result.error } : {}) };
    },
    onFileTouched(relPath: string): void {
      const normalized = normalizeFactPath(relPath);
      if (normalized) touched.add(normalized);
    },
    flushTouched(budget?: MaterializeBudget): EnsureFactsResult {
      const paths = [...touched];
      touched.clear();
      return ensureFacts({ paths, budget });
    },
    pendingTouchedCount(): number {
      return touched.size;
    },
  };
}

function producerForLanguage(language: CodeFile["language"]): FactProducer {
  if (language === "typescript" || language === "javascript") return "ts-compiler";
  if (language === "python" || language === "go" || language === "rust" || language === "java") {
    return "treesitter";
  }
  return "fallback";
}

function defaultReadFile(absolutePath: string): { content: string; sizeBytes: number; modifiedAtMs: number } {
  const stats = statSync(absolutePath);
  return {
    content: readFileSync(absolutePath, "utf8"),
    sizeBytes: stats.size,
    modifiedAtMs: stats.mtimeMs,
  };
}
