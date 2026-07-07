import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { CircuitBreaker, CircuitBreakerOpenError } from "../infra/circuit-breaker.js";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { LruCache } from "../infra/lru-cache.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ObservabilitySpan } from "../observability/types.js";
import {
  rejectRawRuntimeMemoryInput,
  resolveRuntimeMemoryFeatureFlags,
} from "./memory-context.js";
import {
  inspectRuntimeMemorySanitizedEpisodes,
  type RuntimeMemoryInspectionOpenReadOnlyDatabase,
  type RuntimeMemorySanitizedEpisodeInspectionDiagnostic,
  type RuntimeMemorySanitizedEpisodeInspectionSummary,
} from "./memory-persistence.js";
import { RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS } from "./memory-store.js";

const logger = createSubsystemLogger("runtime-memory");

export type RuntimeMemoryHydrationSpanSink = (span: ObservabilitySpan) => void;

export type RuntimeMemoryHydrationShadowOptions = {
  config?: unknown;
  databasePath?: string;
  readShadow?: boolean;
  limit?: number;
  maxEpisodes?: number;
  maxFacts?: number;
  now?: () => number;
  openReadOnlyDatabase?: RuntimeMemoryInspectionOpenReadOnlyDatabase;
  spanSink?: RuntimeMemoryHydrationSpanSink;
};

export type RuntimeMemoryHydrationShadowDiagnostic = {
  code:
    | "flag_disabled"
    | "read_shadow_disabled"
    | "database_path_required"
    | "database_missing"
    | "table_missing"
    | "invalid_json"
    | "hydration_failed"
    | "circuit_breaker_open";
  message: string;
};

export type RuntimeMemoryHydrationShadowFactProjection = {
  factId: string;
  recordKind: "candidate" | "fact";
  taskId?: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  confidence: number;
  source: string;
  verificationStatus: string;
  valid_at: number;
  invalid_at?: number;
  expired_at?: number;
  reference_time: number;
  sourceEpisodeRefs: ReadonlyArray<Record<string, unknown>>;
  evidenceRefs: ReadonlyArray<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

export type RuntimeMemoryHydrationShadowStats = {
  episodeCount: number;
  factCount: number;
  episodesReturned: number;
  factsReturned: number;
  episodeLimit: number;
  factLimit: number;
  truncated: boolean;
  inspectedAt: number;
};

export type RuntimeMemoryHydrationShadowAuthorityBoundary = {
  diagnosticsOnly: true;
  readonly: true;
  noPromptInjection: true;
  noProviderOrdering: true;
  noRuntimeAuthority: true;
  noDurableFactAuthority: true;
};

export type RuntimeMemoryHydrationShadowResult =
  | {
      status: "skipped";
      reason:
        | "flag_disabled"
        | "read_shadow_disabled"
        | "database_path_required"
        | "database_missing"
        | "table_missing"
        | "circuit_breaker_open";
      episodes: [];
      facts: [];
      stats: RuntimeMemoryHydrationShadowStats;
      diagnostics: RuntimeMemoryHydrationShadowDiagnostic[];
      authority: RuntimeMemoryHydrationShadowAuthorityBoundary;
    }
  | {
      status: "loaded";
      episodes: RuntimeMemorySanitizedEpisodeInspectionSummary[];
      facts: RuntimeMemoryHydrationShadowFactProjection[];
      stats: RuntimeMemoryHydrationShadowStats;
      diagnostics: RuntimeMemoryHydrationShadowDiagnostic[];
      authority: RuntimeMemoryHydrationShadowAuthorityBoundary;
    }
  | {
      status: "error";
      reason: "hydration_failed";
      episodes: [];
      facts: [];
      stats: RuntimeMemoryHydrationShadowStats;
      diagnostics: RuntimeMemoryHydrationShadowDiagnostic[];
      authority: RuntimeMemoryHydrationShadowAuthorityBoundary;
    };

type RuntimeMemoryHydrationShadowDatabase = {
  runtime_memory_facts: RuntimeMemoryHydrationShadowFactRow;
};

type RuntimeMemoryHydrationShadowFactRow = {
  fact_id: string;
  record_kind: "candidate" | "fact";
  task_id: string | null;
  subject: string;
  predicate: string;
  object_summary: string;
  confidence: number;
  source: string;
  verification_status: string;
  valid_at: number;
  invalid_at: number | null;
  expired_at: number | null;
  reference_time: number;
  source_episode_refs_json: string;
  evidence_refs_json: string;
  metadata_json: string | null;
  created_at: number;
};

const AUTHORITY_BOUNDARY: RuntimeMemoryHydrationShadowAuthorityBoundary = {
  diagnosticsOnly: true,
  readonly: true,
  noPromptInjection: true,
  noProviderOrdering: true,
  noRuntimeAuthority: true,
  noDurableFactAuthority: true,
};

const READONLY_DATABASE_CACHE_MAX = 8;
const cachedReadOnlyDatabases = new LruCache<string, DatabaseSync>(
  READONLY_DATABASE_CACHE_MAX,
);

let nextHydrationSpanId = 0;

const hydrationCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeoutMs: 10_000,
  halfOpenMaxCalls: 1,
});

export function resetRuntimeMemoryHydrationCircuitBreakerForTest(): void {
  hydrationCircuitBreaker.reset();
}

export function closeRuntimeMemoryHydrationShadowDatabasesForTest(): void {
  let closedCount = 0;
  for (const db of cachedReadOnlyDatabases.values()) {
    try {
      clearNodeSqliteKyselyCacheForDatabase(db);
      if (db.isOpen) {
        db.close();
      }
      closedCount += 1;
    } catch {
      // Best-effort cleanup during test teardown.
    }
  }
  cachedReadOnlyDatabases.clear();
  logger.debug("hydration_cache_cleared_for_test", { closedCount });
}

export function hydrateRuntimeMemoryShadowContext(
  options: RuntimeMemoryHydrationShadowOptions = {},
): RuntimeMemoryHydrationShadowResult {
  const episodeLimit = normalizeBound(
    options.limit ?? options.maxEpisodes,
    256,
  );
  const factLimit = normalizeBound(options.maxFacts ?? options.limit, RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS);
  const inspectedAt = options.now?.() ?? Date.now();
  const hydrationStartedAt = inspectedAt;

  nextHydrationSpanId += 1;
  const spanId = `runtime-memory-hydrate-${nextHydrationSpanId}`;
  const span: ObservabilitySpan = {
    id: spanId,
    traceId: spanId,
    name: "runtime-memory.hydrate",
    kind: "memory",
    status: "running",
    startedAt: hydrationStartedAt,
    attributes: {
      databasePath: options.databasePath,
      factLimit,
      episodeLimit,
    },
  };

  logger.debug("hydration_start", {
    databasePath: options.databasePath,
    factLimit,
    episodeLimit,
    readShadow: options.readShadow === true,
  });

  const skippedStats = (): RuntimeMemoryHydrationShadowStats => ({
    episodeCount: 0,
    factCount: 0,
    episodesReturned: 0,
    factsReturned: 0,
    episodeLimit,
    factLimit,
    truncated: false,
    inspectedAt,
  });

  if (!resolveRuntimeMemoryFeatureFlags(options.config).persist) {
    return skippedHydrationResult("flag_disabled", skippedStats());
  }
  if (options.readShadow !== true) {
    return skippedHydrationResult("read_shadow_disabled", skippedStats());
  }
  if (!options.databasePath) {
    return skippedHydrationResult("database_path_required", skippedStats());
  }
  if (!existsSync(options.databasePath)) {
    return skippedHydrationResult("database_missing", skippedStats());
  }

  const databasePath = options.databasePath;
  const customOpener = options.openReadOnlyDatabase;
  const useCache = customOpener === undefined;
  let db: DatabaseSync | undefined;
  let dbFromCache = false;
  try {
    const result = hydrationCircuitBreaker.execute<RuntimeMemoryHydrationShadowResult>(() => {
      if (useCache) {
        const cached = cachedReadOnlyDatabases.get(databasePath);
        if (cached && cached.isOpen) {
          db = cached;
          dbFromCache = true;
          logger.debug("hydration_cache_hit", { databasePath });
        } else {
          if (cached) {
            cachedReadOnlyDatabases.delete(databasePath);
          }
          db = openRuntimeMemoryHydrationShadowDatabase(databasePath);
          cachedReadOnlyDatabases.set(databasePath, db);
          dbFromCache = true;
          logger.debug("hydration_cache_miss", { databasePath });
        }
      } else {
        db = customOpener!(databasePath);
      }
      if (
        !runtimeMemoryHydrationTableExists(db, "runtime_memory_episodes") ||
        !runtimeMemoryHydrationTableExists(db, "runtime_memory_facts")
      ) {
        logger.warn("hydration_table_missing", { databasePath });
        return skippedHydrationResult("table_missing", skippedStats());
      }

      const episodeInspection = inspectRuntimeMemorySanitizedEpisodes({
        config: options.config,
        database: { path: databasePath },
        limit: episodeLimit,
        now: () => inspectedAt,
        ...(customOpener ? { openReadOnlyDatabase: customOpener } : {}),
        ...(dbFromCache ? { db } : {}),
      });
      if (episodeInspection.status === "error") {
        throw new Error("Runtime Memory episode inspection failed.");
      }

      const diagnostics = diagnosticsFromEpisodeInspection(
        episodeInspection.diagnostics,
      );
      const factCount = countRuntimeMemoryHydrationFacts(db);
      const factRows = readRuntimeMemoryHydrationFactRows(db, factLimit + 1);
      const facts = factRows
        .slice(0, factLimit)
        .map((row) => factProjectionFromRow(row, diagnostics));
      const stats: RuntimeMemoryHydrationShadowStats = {
        episodeCount: episodeInspection.stats.episodeCount,
        factCount,
        episodesReturned: episodeInspection.episodes.length,
        factsReturned: facts.length,
        episodeLimit,
        factLimit,
        truncated: episodeInspection.stats.truncated ||
          factCount > factLimit ||
          factRows.length > factLimit,
        inspectedAt,
      };

      const hydrationDurationMs = Date.now() - hydrationStartedAt;
      logger.debug("hydration_complete", {
        databasePath,
        factsReturned: facts.length,
        episodeCount: stats.episodeCount,
        durationMs: hydrationDurationMs,
        status: "loaded",
      });

      span.status = "completed";
      span.endedAt = Date.now();
      span.durationMs = hydrationDurationMs;
      span.attributes = {
        ...span.attributes,
        factsReturned: facts.length,
        episodeCount: stats.episodeCount,
        factCount,
        truncated: stats.truncated,
      };
      options.spanSink?.(span);

      return {
        status: "loaded",
        episodes: episodeInspection.episodes,
        facts,
        stats,
        diagnostics,
        authority: AUTHORITY_BOUNDARY,
      };
    });
    return result;
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      logger.warn("hydration_circuit_breaker_open", { databasePath });
      span.status = "error";
      span.endedAt = Date.now();
      span.durationMs = Date.now() - hydrationStartedAt;
      span.error = "circuit_breaker_open";
      options.spanSink?.(span);
      return skippedHydrationResult("circuit_breaker_open", skippedStats());
    }
    logger.error("hydration_failed", {
      databasePath,
      error: String(error),
    });
    span.status = "error";
    span.endedAt = Date.now();
    span.durationMs = Date.now() - hydrationStartedAt;
    span.error = String(error);
    options.spanSink?.(span);
    return errorHydrationResult(skippedStats());
  } finally {
    if (db && !dbFromCache) {
      clearNodeSqliteKyselyCacheForDatabase(db);
      if (db.isOpen) {
        db.close();
      }
    }
  }
}

export const readRuntimeMemoryHydrationShadow =
  hydrateRuntimeMemoryShadowContext;

function openRuntimeMemoryHydrationShadowDatabase(pathname: string): DatabaseSync {
  const sqlite = requireNodeSqlite();
  return new sqlite.DatabaseSync(pathname, { readOnly: true });
}

function runtimeMemoryHydrationTableExists(
  db: DatabaseSync,
  tableName: "runtime_memory_episodes" | "runtime_memory_facts",
): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { ok?: unknown } | undefined;
  return row?.ok === 1;
}

function countRuntimeMemoryHydrationFacts(db: DatabaseSync): number {
  const row = executeSqliteQueryTakeFirstSync(
    db,
    getRuntimeMemoryHydrationKysely(db)
      .selectFrom("runtime_memory_facts")
      .select((eb) => eb.fn.countAll<number>().as("count")),
  ) as { count?: unknown } | undefined;
  return Number(row?.count ?? 0);
}

function readRuntimeMemoryHydrationFactRows(
  db: DatabaseSync,
  limit: number,
): RuntimeMemoryHydrationShadowFactRow[] {
  return executeSqliteQuerySync(
    db,
    getRuntimeMemoryHydrationKysely(db)
      .selectFrom("runtime_memory_facts")
      .select([
        "fact_id",
        "record_kind",
        "task_id",
        "subject",
        "predicate",
        "object_summary",
        "confidence",
        "source",
        "verification_status",
        "valid_at",
        "invalid_at",
        "expired_at",
        "reference_time",
        "source_episode_refs_json",
        "evidence_refs_json",
        "metadata_json",
        "created_at",
      ])
      .orderBy("created_at", "asc")
      .orderBy("fact_id", "asc")
      .limit(limit),
  ).rows;
}

function factProjectionFromRow(
  row: RuntimeMemoryHydrationShadowFactRow,
  diagnostics: RuntimeMemoryHydrationShadowDiagnostic[],
): RuntimeMemoryHydrationShadowFactProjection {
  const sourceEpisodeRefs = refsFromJson(row.source_episode_refs_json, diagnostics);
  const evidenceRefs = refsFromJson(row.evidence_refs_json, diagnostics);
  const metadata = objectFromJson(row.metadata_json, diagnostics);
  return {
    factId: sanitizeHydrationString(row.fact_id),
    recordKind: row.record_kind === "fact" ? "fact" : "candidate",
    ...(row.task_id ? { taskId: sanitizeHydrationString(row.task_id) } : {}),
    subject: sanitizeHydrationString(row.subject),
    predicate: sanitizeHydrationString(row.predicate),
    objectSummary: sanitizeHydrationString(row.object_summary),
    confidence: Number(row.confidence),
    source: sanitizeHydrationString(row.source),
    verificationStatus: sanitizeHydrationString(row.verification_status),
    valid_at: Number(row.valid_at),
    ...(row.invalid_at === null ? {} : { invalid_at: Number(row.invalid_at) }),
    ...(row.expired_at === null ? {} : { expired_at: Number(row.expired_at) }),
    reference_time: Number(row.reference_time),
    sourceEpisodeRefs,
    evidenceRefs,
    ...(metadata ? { metadata } : {}),
  };
}

function refsFromJson(
  raw: string,
  diagnostics: RuntimeMemoryHydrationShadowDiagnostic[],
): ReadonlyArray<Record<string, unknown>> {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) {
    diagnostics.push(invalidHydrationJsonDiagnostic());
    return [];
  }
  return parsed
    .slice(0, 32)
    .map(sanitizeHydrationValue)
    .filter(isHydrationRecord);
}

function objectFromJson(
  raw: string | null,
  diagnostics: RuntimeMemoryHydrationShadowDiagnostic[],
): Record<string, unknown> | undefined {
  if (raw === null) {
    return undefined;
  }
  const sanitized = sanitizeHydrationValue(parseJson(raw));
  if (!isHydrationRecord(sanitized)) {
    diagnostics.push(invalidHydrationJsonDiagnostic());
    return undefined;
  }
  return sanitized;
}

function sanitizeHydrationValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeHydrationString(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 32).map(sanitizeHydrationValue);
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 64)) {
    const safeKey = sanitizeHydrationString(key);
    if (safeKey === "[redacted]") {
      continue;
    }
    const safeValue = sanitizeHydrationValue(child);
    if (safeValue !== undefined) {
      output[safeKey] = safeValue;
    }
  }
  return output;
}

function sanitizeHydrationString(value: string): string {
  const raw = rejectRawRuntimeMemoryInput(value);
  if (raw) {
    return "[redacted]";
  }
  return value.length > 512 ? `${value.slice(0, 512)}...` : value;
}

function diagnosticsFromEpisodeInspection(
  diagnostics: readonly RuntimeMemorySanitizedEpisodeInspectionDiagnostic[],
): RuntimeMemoryHydrationShadowDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code === "inspection_failed"
      ? "hydration_failed"
      : diagnostic.code,
    message: diagnostic.message,
  }));
}

function invalidHydrationJsonDiagnostic():
  RuntimeMemoryHydrationShadowDiagnostic {
  logger.warn("hydration_invalid_json");
  return {
    code: "invalid_json",
    message: "Runtime Memory read hydration shadow skipped malformed JSON.",
  };
}

function skippedHydrationResult(
  reason: Extract<RuntimeMemoryHydrationShadowResult, { status: "skipped" }>["reason"],
  stats: RuntimeMemoryHydrationShadowStats,
): Extract<RuntimeMemoryHydrationShadowResult, { status: "skipped" }> {
  return {
    status: "skipped",
    reason,
    episodes: [],
    facts: [],
    stats,
    diagnostics: [
      {
        code: reason,
        message: skippedHydrationMessage(reason),
      },
    ],
    authority: AUTHORITY_BOUNDARY,
  };
}

function skippedHydrationMessage(
  reason: Extract<RuntimeMemoryHydrationShadowResult, { status: "skipped" }>["reason"],
): string {
  if (reason === "flag_disabled") {
    return "Runtime Memory read hydration shadow requires runtime.memory.persist.";
  }
  if (reason === "read_shadow_disabled") {
    return "Runtime Memory read hydration shadow requires explicit helper readShadow opt-in.";
  }
  if (reason === "database_path_required") {
    return "Runtime Memory read hydration shadow requires an explicit database path.";
  }
  if (reason === "database_missing") {
    return "Runtime Memory read hydration shadow skipped a missing database.";
  }
  if (reason === "circuit_breaker_open") {
    return "Runtime Memory read hydration shadow skipped because the hydration circuit breaker is open.";
  }
  return "Runtime Memory read hydration shadow skipped because Runtime Memory tables are missing.";
}

function errorHydrationResult(
  stats: RuntimeMemoryHydrationShadowStats,
): Extract<RuntimeMemoryHydrationShadowResult, { status: "error" }> {
  return {
    status: "error",
    reason: "hydration_failed",
    episodes: [],
    facts: [],
    stats,
    diagnostics: [
      {
        code: "hydration_failed",
        message: "Runtime Memory readonly read hydration shadow failed.",
      },
    ],
    authority: AUTHORITY_BOUNDARY,
  };
}

function isHydrationRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function getRuntimeMemoryHydrationKysely(db: DatabaseSync) {
  return getNodeSqliteKysely<RuntimeMemoryHydrationShadowDatabase>(db);
}

function normalizeBound(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? value
    : fallback;
}
