// Default-off SQLite persistence proof for sanitized Runtime Memory records.
import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { Insertable } from "kysely";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { runSqliteImmediateTransactionWithRetrySync } from "../infra/sqlite-transaction.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  openOpenClawStateDatabase,
  type OpenClawStateDatabase,
  type OpenClawStateDatabaseOptions,
} from "../state/openclaw-state-db.js";
import {
  DEFAULT_RUNTIME_MEMORY_TYPE,
  isRuntimeMemoryEpisodeRecord,
  isRuntimeMemoryInvalidationProposal,
  isRuntimeMemoryRelationType,
  isRuntimeMemoryTemporalFact,
  isRuntimeMemoryTemporalFactCandidate,
  rejectRawRuntimeMemoryInput,
  resolveRuntimeMemoryFeatureFlags,
  sanitizeRuntimeMemoryEpisodeRecord,
  sanitizeRuntimeMemoryInvalidationProposal,
  sanitizeRuntimeMemoryTemporalFact,
  sanitizeRuntimeMemoryTemporalFactCandidate,
  type RuntimeMemoryEpisodeRecord,
  type RuntimeMemoryFactRelation,
  type RuntimeMemoryInputRejection,
  type RuntimeMemoryInvalidationProposal,
  type RuntimeMemoryQueryableFact,
  type RuntimeMemoryTemporalFact,
  type RuntimeMemoryTemporalFactCandidate,
  type RuntimeMemoryType,
} from "./memory-context.js";
import {
  RuntimeMemoryStore,
  RUNTIME_MEMORY_STORE_DEFAULT_MAX_EPISODES,
  RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS,
  RUNTIME_MEMORY_STORE_DEFAULT_MAX_INVALIDATIONS,
  type RuntimeMemoryReadonly,
  type RuntimeMemoryStoreOptions,
} from "./memory-store.js";

/**
 * Persistence-layer default max facts. Higher than the in-memory store default
 * (512) so `trimRows` acts as a safety net rather than a competing eviction
 * layer. The in-memory store handles real eviction at 512 with importance policy.
 */
const RUNTIME_MEMORY_PERSISTENCE_DEFAULT_MAX_FACTS = 5000;

export const RUNTIME_MEMORY_PERSISTENCE_OWNER =
  "openclaw_runtime.runtime-core.memory-persistence";
export const RUNTIME_MEMORY_PERSISTENCE_SCHEMA_VERSION = 1;
export const RUNTIME_MEMORY_PERSISTENCE_META_KEY = "runtime-memory";

const logger = createSubsystemLogger("runtime-memory");

export type RuntimeMemoryPersistenceOpenDatabase = (
  options?: OpenClawStateDatabaseOptions,
) => OpenClawStateDatabase;

export type RuntimeMemoryPersistenceOptions = RuntimeMemoryStoreOptions & {
  config?: unknown;
  database?: OpenClawStateDatabaseOptions;
  now?: () => number;
  openDatabase?: RuntimeMemoryPersistenceOpenDatabase;
};

export type RuntimeMemoryPersistenceRejectionReason =
  | RuntimeMemoryInputRejection["reason"]
  | "invalid_episode"
  | "invalid_fact"
  | "invalid_invalidation";

export type RuntimeMemoryPersistenceWriteResult<T> =
  | {
      status: "skipped";
      reason: "flag_disabled";
      persisted: false;
    }
  | {
      status: "rejected";
      reason: RuntimeMemoryPersistenceRejectionReason;
      message: string;
      persisted: false;
    }
  | {
      status: "persisted";
      stored: boolean;
      duplicate: boolean;
      persisted: true;
      value: RuntimeMemoryReadonly<T>;
    };

export type RuntimeMemoryPersistenceMigrationResult =
  | {
      status: "skipped";
      reason: "flag_disabled";
      migrated: false;
    }
  | {
      status: "migrated";
      migrated: true;
      owner: typeof RUNTIME_MEMORY_PERSISTENCE_OWNER;
      schemaVersion: typeof RUNTIME_MEMORY_PERSISTENCE_SCHEMA_VERSION;
    };

export type RuntimeMemoryPersistenceLoadResult =
  | {
      status: "skipped";
      reason: "flag_disabled";
      store: RuntimeMemoryStore;
    }
  | {
      status: "loaded";
      store: RuntimeMemoryStore;
      stats: {
        episodes: number;
        facts: number;
        invalidations: number;
      };
    };

export type RuntimeMemorySanitizedEpisodeInspectionOptions = {
  config?: unknown;
  database?: OpenClawStateDatabaseOptions;
  limit?: number;
  maxEpisodes?: number;
  now?: () => number;
  openReadOnlyDatabase?: RuntimeMemoryInspectionOpenReadOnlyDatabase;
  db?: DatabaseSync;
};

export type RuntimeMemoryInspectionOpenReadOnlyDatabase = (
  path: string,
) => DatabaseSync;

export type RuntimeMemorySanitizedEpisodeInspectionDiagnostic = {
  code:
    | "flag_disabled"
    | "database_path_required"
    | "database_missing"
    | "table_missing"
    | "invalid_json"
    | "inspection_failed";
  message: string;
};

export type RuntimeMemorySanitizedEpisodeInspectionSummary = {
  episodeId: string;
  taskId: string;
  kind: string;
  reference_time: number;
  boundedSummary: string;
  sourceRefs: ReadonlyArray<Record<string, unknown>>;
  evidenceRefs: ReadonlyArray<Record<string, unknown>>;
  redactionStatus: string;
  metadata?: Record<string, unknown>;
};

export type RuntimeMemorySanitizedEpisodeInspectionStats = {
  episodeCount: number;
  returned: number;
  limit: number;
  truncated: boolean;
  inspectedAt: number;
};

export type RuntimeMemorySanitizedEpisodeInspectionResult =
  | {
      status: "skipped";
      reason:
        | "flag_disabled"
        | "database_path_required"
        | "database_missing"
        | "table_missing";
      episodes: [];
      stats: RuntimeMemorySanitizedEpisodeInspectionStats;
      diagnostics: RuntimeMemorySanitizedEpisodeInspectionDiagnostic[];
    }
  | {
      status: "loaded";
      episodes: RuntimeMemorySanitizedEpisodeInspectionSummary[];
      stats: RuntimeMemorySanitizedEpisodeInspectionStats;
      diagnostics: RuntimeMemorySanitizedEpisodeInspectionDiagnostic[];
    }
  | {
      status: "error";
      reason: "inspection_failed";
      episodes: [];
      stats: RuntimeMemorySanitizedEpisodeInspectionStats;
      diagnostics: RuntimeMemorySanitizedEpisodeInspectionDiagnostic[];
    };

type RuntimeMemoryMetaRow = {
  meta_key: string;
  owner: string;
  schema_version: number;
  created_at: number;
  updated_at: number;
};

type RuntimeMemoryEpisodeRow = {
  episode_id: string;
  task_id: string;
  kind: string;
  reference_time: number;
  idempotency_key: string;
  bounded_summary: string;
  source_refs_json: string;
  evidence_refs_json: string;
  metadata_json: string | null;
  redaction_status: string;
  record_json: string;
  schema_version: number;
  created_at: number;
  updated_at: number;
};

type RuntimeMemoryEpisodeIdempotencyKeyRow = {
  idempotency_key: string;
  episode_id: string;
  created_at: number;
};

type RuntimeMemoryFactRow = {
  fact_id: string;
  record_kind: "candidate" | "fact";
  task_id: string | null;
  subject: string;
  predicate: string;
  object_summary: string;
  confidence: number;
  source: string;
  verification_status: string;
  memory_type: string;
  valid_at: number;
  invalid_at: number | null;
  expired_at: number | null;
  reference_time: number;
  source_episode_refs_json: string;
  evidence_refs_json: string;
  metadata_json: string | null;
  proposed_at: number | null;
  accepted_at: number | null;
  promotion_json: string | null;
  record_json: string;
  schema_version: number;
  created_at: number;
  updated_at: number;
};

type RuntimeMemoryInvalidationRow = {
  invalidation_id: string;
  fact_id: string;
  reason: string;
  invalid_at: number;
  reference_time: number;
  proposed_by: string;
  verification_status: string;
  source_episode_refs_json: string;
  evidence_refs_json: string;
  replacement_fact_id: string | null;
  metadata_json: string | null;
  record_json: string;
  schema_version: number;
  created_at: number;
  updated_at: number;
};

type RuntimeMemoryPersistenceDatabase = {
  runtime_memory_meta: RuntimeMemoryMetaRow;
  runtime_memory_episodes: RuntimeMemoryEpisodeRow;
  runtime_memory_episode_idempotency_keys: RuntimeMemoryEpisodeIdempotencyKeyRow;
  runtime_memory_facts: RuntimeMemoryFactRow;
  runtime_memory_invalidations: RuntimeMemoryInvalidationRow;
};

type RuntimeMemoryInspectionEpisodeRow = Pick<
  RuntimeMemoryEpisodeRow,
  | "episode_id"
  | "task_id"
  | "kind"
  | "reference_time"
  | "bounded_summary"
  | "source_refs_json"
  | "evidence_refs_json"
  | "metadata_json"
  | "redaction_status"
>;

type RuntimeMemoryPersistenceDatabaseHandle = {
  db: DatabaseSync;
};

type SanitizedPersistenceInput<T> =
  | { accepted: true; value: T }
  | {
      accepted: false;
      reason: RuntimeMemoryPersistenceRejectionReason;
      message: string;
    };

const RUNTIME_MEMORY_PERSISTENCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runtime_memory_meta (
  meta_key TEXT NOT NULL PRIMARY KEY,
  owner TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_memory_episodes (
  episode_id TEXT NOT NULL PRIMARY KEY,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  reference_time INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  bounded_summary TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  metadata_json TEXT,
  redaction_status TEXT NOT NULL,
  record_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_memory_episode_idempotency_keys (
  idempotency_key TEXT NOT NULL PRIMARY KEY,
  episode_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (episode_id) REFERENCES runtime_memory_episodes(episode_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runtime_memory_episodes_task_time
  ON runtime_memory_episodes(task_id, reference_time DESC, episode_id);

CREATE INDEX IF NOT EXISTS idx_runtime_memory_episodes_created
  ON runtime_memory_episodes(created_at ASC, episode_id);

CREATE TABLE IF NOT EXISTS runtime_memory_facts (
  fact_id TEXT NOT NULL PRIMARY KEY,
  record_kind TEXT NOT NULL,
  task_id TEXT,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_summary TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  memory_type TEXT NOT NULL DEFAULT 'semantic',
  valid_at INTEGER NOT NULL,
  invalid_at INTEGER,
  expired_at INTEGER,
  reference_time INTEGER NOT NULL,
  source_episode_refs_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  metadata_json TEXT,
  proposed_at INTEGER,
  accepted_at INTEGER,
  promotion_json TEXT,
  record_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_memory_facts_current
  ON runtime_memory_facts(subject, predicate, verification_status, valid_at DESC, fact_id);

CREATE INDEX IF NOT EXISTS idx_runtime_memory_facts_task_time
  ON runtime_memory_facts(task_id, reference_time DESC, fact_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_runtime_memory_facts_created
  ON runtime_memory_facts(created_at ASC, fact_id);

CREATE TABLE IF NOT EXISTS runtime_memory_invalidations (
  invalidation_id TEXT NOT NULL PRIMARY KEY,
  fact_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  invalid_at INTEGER NOT NULL,
  reference_time INTEGER NOT NULL,
  proposed_by TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  source_episode_refs_json TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  replacement_fact_id TEXT,
  metadata_json TEXT,
  record_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_memory_invalidations_fact
  ON runtime_memory_invalidations(fact_id, invalid_at ASC, invalidation_id);

CREATE INDEX IF NOT EXISTS idx_runtime_memory_invalidations_created
  ON runtime_memory_invalidations(created_at ASC, invalidation_id);

CREATE TABLE IF NOT EXISTS runtime_memory_fact_relations (
  relation_id TEXT NOT NULL PRIMARY KEY,
  source_fact_id TEXT NOT NULL,
  target_fact_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (source_fact_id) REFERENCES runtime_memory_facts(fact_id) ON DELETE CASCADE,
  FOREIGN KEY (target_fact_id) REFERENCES runtime_memory_facts(fact_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runtime_memory_relations_source
  ON runtime_memory_fact_relations(source_fact_id, relation_type);

CREATE INDEX IF NOT EXISTS idx_runtime_memory_relations_target
  ON runtime_memory_fact_relations(target_fact_id, relation_type);

CREATE TABLE IF NOT EXISTS runtime_memory_embeddings (
  fact_id TEXT NOT NULL PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL,
  embedding BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (fact_id) REFERENCES runtime_memory_facts(fact_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runtime_memory_embeddings_provider
  ON runtime_memory_embeddings(provider_id, model);
`;

export function createRuntimeMemoryPersistenceStore(
  options: RuntimeMemoryPersistenceOptions = {},
): RuntimeMemoryPersistenceStore {
  return new RuntimeMemoryPersistenceStore(options);
}

export function inspectRuntimeMemorySanitizedEpisodes(
  options: RuntimeMemorySanitizedEpisodeInspectionOptions,
): RuntimeMemorySanitizedEpisodeInspectionResult {
  const limit = normalizeBound(
    options.limit ?? options.maxEpisodes,
    RUNTIME_MEMORY_STORE_DEFAULT_MAX_EPISODES,
  );
  const inspectedAt = options.now?.() ?? Date.now();
  const skippedStats = (): RuntimeMemorySanitizedEpisodeInspectionStats => ({
    episodeCount: 0,
    returned: 0,
    limit,
    truncated: false,
    inspectedAt,
  });

  const databasePath = options.database?.path;
  logger.debug("episode_inspection_start", { databasePath, limit });

  if (!resolveRuntimeMemoryFeatureFlags(options.config).persist) {
    return skippedInspectionResult("flag_disabled", skippedStats());
  }

  if (!databasePath) {
    return skippedInspectionResult("database_path_required", skippedStats());
  }
  if (!existsSync(databasePath)) {
    return skippedInspectionResult("database_missing", skippedStats());
  }

  const openReadOnlyDatabase = options.openReadOnlyDatabase ??
    openRuntimeMemoryInspectionDatabase;
  const externalDb = options.db;
  let db: DatabaseSync | undefined;
  let dbOwnedExternally = false;
  try {
    if (externalDb) {
      db = externalDb;
      dbOwnedExternally = true;
    } else {
      db = openReadOnlyDatabase(databasePath);
    }
    if (!runtimeMemoryInspectionTableExists(db, "runtime_memory_episodes")) {
      logger.warn("episode_inspection_table_missing", { databasePath });
      return skippedInspectionResult("table_missing", skippedStats());
    }

    const episodeCount = countRuntimeMemoryInspectionEpisodes(db);
    const rows = readRuntimeMemoryInspectionEpisodeRows(db, limit + 1);
    const diagnostics: RuntimeMemorySanitizedEpisodeInspectionDiagnostic[] = [];
    const episodes = rows.slice(0, limit).map((row) =>
      inspectionSummaryFromRow(row, diagnostics)
    );
    const stats: RuntimeMemorySanitizedEpisodeInspectionStats = {
      episodeCount,
      returned: episodes.length,
      limit,
      truncated: episodeCount > limit || rows.length > limit,
      inspectedAt,
    };

    logger.debug("episode_inspection_complete", {
      databasePath,
      episodeCount,
      returned: episodes.length,
      truncated: stats.truncated,
    });

    return {
      status: "loaded",
      episodes,
      stats,
      diagnostics,
    };
  } catch (error) {
    logger.error("episode_inspection_failed", {
      databasePath,
      error: String(error),
    });
    return {
      status: "error",
      reason: "inspection_failed",
      episodes: [],
      stats: skippedStats(),
      diagnostics: [
        {
          code: "inspection_failed",
          message: "Runtime Memory readonly episode inspection failed.",
        },
      ],
    };
  } finally {
    if (db && !dbOwnedExternally) {
      clearNodeSqliteKyselyCacheForDatabase(db);
      if (db.isOpen) {
        db.close();
      }
    }
  }
}

export class RuntimeMemoryPersistenceStore {
  readonly #config: unknown;
  readonly #databaseOptions?: OpenClawStateDatabaseOptions;
  readonly #now: () => number;
  readonly #openDatabase: RuntimeMemoryPersistenceOpenDatabase;
  readonly #storeOptions: RuntimeMemoryStoreOptions;
  readonly #persistenceMaxFacts: number;

  constructor(options: RuntimeMemoryPersistenceOptions = {}) {
    this.#config = options.config;
    this.#databaseOptions = options.database;
    this.#now = options.now ?? Date.now;
    this.#openDatabase = options.openDatabase ?? openOpenClawStateDatabase;
    this.#persistenceMaxFacts = normalizeBound(
      options.maxFacts,
      RUNTIME_MEMORY_PERSISTENCE_DEFAULT_MAX_FACTS,
    );
    this.#storeOptions = {
      maxEpisodes: normalizeBound(
        options.maxEpisodes,
        RUNTIME_MEMORY_STORE_DEFAULT_MAX_EPISODES,
      ),
      maxFacts: normalizeBound(
        options.maxFacts,
        RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS,
      ),
      maxInvalidations: normalizeBound(
        options.maxInvalidations,
        RUNTIME_MEMORY_STORE_DEFAULT_MAX_INVALIDATIONS,
      ),
      evictionPolicy: options.evictionPolicy,
    };
  }

  migrate(): RuntimeMemoryPersistenceMigrationResult {
    if (!this.persistEnabled()) {
      return disabledMigrationResult();
    }

    this.withWriteTransaction(({ db }) => {
      ensureRuntimeMemoryPersistenceSchema(db, this.#now());
    });
    return {
      status: "migrated",
      migrated: true,
      owner: RUNTIME_MEMORY_PERSISTENCE_OWNER,
      schemaVersion: RUNTIME_MEMORY_PERSISTENCE_SCHEMA_VERSION,
    };
  }

  appendEpisode(
    episode: RuntimeMemoryEpisodeRecord,
  ): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryEpisodeRecord> {
    if (!this.persistEnabled()) {
      return disabledWriteResult();
    }

    const sanitized = sanitizeEpisodeForPersistence(episode);
    if (!sanitized.accepted) {
      return rejectedWriteResult(sanitized);
    }

    return this.withWriteTransaction(({ db }) =>
      persistEpisode(db, sanitized.value, this.#now(), this.#storeOptions),
    );
  }

  appendFact(
    fact: RuntimeMemoryTemporalFact | RuntimeMemoryTemporalFactCandidate,
  ): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryQueryableFact> {
    if (!this.persistEnabled()) {
      return disabledWriteResult();
    }

    const sanitized = sanitizeFactForPersistence(fact);
    if (!sanitized.accepted) {
      return rejectedWriteResult(sanitized);
    }

    return this.withWriteTransaction(({ db }) =>
      persistFact(
        db,
        sanitized.value,
        this.#now(),
        { ...this.#storeOptions, maxFacts: this.#persistenceMaxFacts },
      ),
    );
  }

  invalidateFact(
    proposal: RuntimeMemoryInvalidationProposal,
  ): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryInvalidationProposal> {
    if (!this.persistEnabled()) {
      return disabledWriteResult();
    }

    const sanitized = sanitizeInvalidationForPersistence(proposal);
    if (!sanitized.accepted) {
      return rejectedWriteResult(sanitized);
    }

    return this.withWriteTransaction(({ db }) =>
      persistInvalidation(db, sanitized.value, this.#now(), this.#storeOptions),
    );
  }

  persistRelation(
    relation: Omit<RuntimeMemoryFactRelation, "relationId" | "createdAt">,
  ): void {
    if (!this.persistEnabled()) return;
    if (!isRuntimeMemoryRelationType(relation.relationType)) return;
    this.withWriteTransaction(({ db }) => {
      persistRelationRow(db, relation, this.#now());
    });
  }

  replaceEmbedding(params: {
    factId: string;
    providerId: string;
    model: string;
    dimension: number;
    embedding: Float32Array;
  }): void {
    if (!this.persistEnabled()) return;
    this.withWriteTransaction(({ db }) => {
      replaceEmbeddingRow(db, { ...params, now: this.#now() });
    });
  }

  getEmbedding(
    factId: string,
    providerId: string,
    model: string,
  ): Float32Array | null {
    if (!this.persistEnabled()) return null;
    return this.withWriteTransaction(({ db }) =>
      readEmbedding(db, factId, providerId, model),
    );
  }

  deleteEmbedding(factId: string): void {
    if (!this.persistEnabled()) return;
    this.withWriteTransaction(({ db }) => {
      deleteEmbeddingRow(db, factId);
    });
  }

  loadStore(): RuntimeMemoryPersistenceLoadResult {
    const store = new RuntimeMemoryStore(this.#storeOptions);
    if (!this.persistEnabled()) {
      return {
        status: "skipped",
        reason: "flag_disabled",
        store,
      };
    }

    return this.withWriteTransaction(({ db }) => {
      for (const episode of readEpisodes(db)) {
        store.appendEpisode(episode);
      }
      for (const fact of readFacts(db)) {
        store.appendFact(fact);
      }
      for (const invalidation of readInvalidations(db)) {
        store.invalidateFact(invalidation);
      }
      for (const relation of readRelations(db)) {
        store.appendRelation({
          sourceFactId: relation.sourceFactId,
          targetFactId: relation.targetFactId,
          relationType: relation.relationType,
          confidence: relation.confidence,
          metadata: relation.metadata,
        });
      }
      return {
        status: "loaded",
        store,
        stats: {
          episodes: store.stats().episodes,
          facts: store.stats().facts,
          invalidations: store.stats().invalidations,
        },
      };
    });
  }

  private persistEnabled(): boolean {
    return resolveRuntimeMemoryFeatureFlags(this.#config).persist;
  }

  private withWriteTransaction<T>(
    operation: (database: RuntimeMemoryPersistenceDatabaseHandle) => T,
  ): T {
    const database = this.#openDatabase(this.#databaseOptions);
    return runSqliteImmediateTransactionWithRetrySync(database.db, () => {
      ensureRuntimeMemoryPersistenceSchema(database.db, this.#now());
      return operation(database);
    });
  }
}

function ensureRuntimeMemoryPersistenceSchema(db: DatabaseSync, now: number): void {
  db.exec(RUNTIME_MEMORY_PERSISTENCE_SCHEMA_SQL);
  ensureRuntimeMemoryFactsMemoryTypeColumn(db);
  const stateDb = getRuntimeMemoryPersistenceKysely(db);
  executeSqliteQuerySync(
    db,
    stateDb
      .insertInto("runtime_memory_meta")
      .values({
        meta_key: RUNTIME_MEMORY_PERSISTENCE_META_KEY,
        owner: RUNTIME_MEMORY_PERSISTENCE_OWNER,
        schema_version: RUNTIME_MEMORY_PERSISTENCE_SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
      })
      .onConflict((conflict) =>
        conflict.column("meta_key").doUpdateSet({
          owner: RUNTIME_MEMORY_PERSISTENCE_OWNER,
          schema_version: RUNTIME_MEMORY_PERSISTENCE_SCHEMA_VERSION,
          updated_at: now,
        }),
      ),
  );
}

/**
 * Additive migration: ensure `runtime_memory_facts.memory_type` exists on
 * databases created before Phase 4.1. `CREATE TABLE IF NOT EXISTS` does not
 * add columns to an existing table, so we ALTER TABLE for legacy databases.
 * The column is NOT NULL with DEFAULT 'semantic', matching the fresh-schema
 * definition. Backfill is automatic via the DEFAULT clause.
 */
function ensureRuntimeMemoryFactsMemoryTypeColumn(db: DatabaseSync): void {
  const tableExistsRow = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("runtime_memory_facts") as { ok?: unknown } | undefined;
  if (tableExistsRow?.ok !== 1) {
    return;
  }
  const columns = db.prepare("PRAGMA table_info(runtime_memory_facts)").all() as Array<{
    name?: unknown;
  }>;
  const hasColumn = columns.some((row) => row.name === "memory_type");
  if (hasColumn) {
    return;
  }
  db.exec(
    "ALTER TABLE runtime_memory_facts ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'semantic';",
  );
}

function persistEpisode(
  db: DatabaseSync,
  episode: RuntimeMemoryEpisodeRecord,
  now: number,
  options: RuntimeMemoryStoreOptions,
): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryEpisodeRecord> {
  const existing = findExistingEpisode(db, episode);
  if (existing) {
    const merged = mergeEpisodeEvidence(existing.record, episode);
    updateEpisodeRow(db, existing.episode_id, merged, now);
    insertEpisodeIdempotencyKey(db, episode.idempotencyKey, existing.episode_id, now);
    return persistedWriteResult({
      stored: false,
      duplicate: true,
      value: merged,
    });
  }

  insertEpisodeRow(db, episode, now);
  insertEpisodeIdempotencyKey(db, episode.idempotencyKey, episode.episodeId, now);
  trimRows(db, "runtime_memory_episodes", "episode_id", options.maxEpisodes);
  return persistedWriteResult({
    stored: true,
    duplicate: false,
    value: episode,
  });
}

function persistFact(
  db: DatabaseSync,
  fact: RuntimeMemoryQueryableFact,
  now: number,
  options: RuntimeMemoryStoreOptions,
): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryQueryableFact> {
  const existing = findExistingFact(db, fact.factId);
  if (existing) {
    return persistedWriteResult({
      stored: false,
      duplicate: true,
      value: existing,
    });
  }

  executeSqliteQuerySync(
    db,
    getRuntimeMemoryPersistenceKysely(db)
      .insertInto("runtime_memory_facts")
      .values(factToRow(fact, now)),
  );
  trimRows(db, "runtime_memory_facts", "fact_id", options.maxFacts);
  return persistedWriteResult({
    stored: true,
    duplicate: false,
    value: fact,
  });
}

function persistInvalidation(
  db: DatabaseSync,
  invalidation: RuntimeMemoryInvalidationProposal,
  now: number,
  options: RuntimeMemoryStoreOptions,
): RuntimeMemoryPersistenceWriteResult<RuntimeMemoryInvalidationProposal> {
  const existing = findExistingInvalidation(db, invalidation.invalidationId);
  if (existing) {
    return persistedWriteResult({
      stored: false,
      duplicate: true,
      value: existing,
    });
  }

  executeSqliteQuerySync(
    db,
    getRuntimeMemoryPersistenceKysely(db)
      .insertInto("runtime_memory_invalidations")
      .values(invalidationToRow(invalidation, now)),
  );
  trimRows(
    db,
    "runtime_memory_invalidations",
    "invalidation_id",
    options.maxInvalidations,
  );
  return persistedWriteResult({
    stored: true,
    duplicate: false,
    value: invalidation,
  });
}

function findExistingEpisode(
  db: DatabaseSync,
  episode: RuntimeMemoryEpisodeRecord,
): { episode_id: string; record: RuntimeMemoryEpisodeRecord } | undefined {
  const stateDb = getRuntimeMemoryPersistenceKysely(db);
  const byIdempotencyKey = executeSqliteQueryTakeFirstSync(
    db,
    stateDb
      .selectFrom("runtime_memory_episode_idempotency_keys")
      .innerJoin(
        "runtime_memory_episodes",
        "runtime_memory_episodes.episode_id",
        "runtime_memory_episode_idempotency_keys.episode_id",
      )
      .select([
        "runtime_memory_episodes.episode_id",
        "runtime_memory_episodes.record_json",
      ])
      .where(
        "runtime_memory_episode_idempotency_keys.idempotency_key",
        "=",
        episode.idempotencyKey,
      ),
  );
  const row = byIdempotencyKey ??
    executeSqliteQueryTakeFirstSync(
      db,
      stateDb
        .selectFrom("runtime_memory_episodes")
        .select(["episode_id", "record_json"])
        .where("episode_id", "=", episode.episodeId),
    );
  if (!row) {
    return undefined;
  }
  const parsed = parseRuntimeMemoryEpisode(row.record_json);
  return parsed ? { episode_id: row.episode_id, record: parsed } : undefined;
}

function findExistingFact(
  db: DatabaseSync,
  factId: string,
): RuntimeMemoryQueryableFact | undefined {
  const row = executeSqliteQueryTakeFirstSync(
    db,
    getRuntimeMemoryPersistenceKysely(db)
      .selectFrom("runtime_memory_facts")
      .select("record_json")
      .where("fact_id", "=", factId),
  );
  return row ? parseRuntimeMemoryFact(row.record_json) : undefined;
}

function findExistingInvalidation(
  db: DatabaseSync,
  invalidationId: string,
): RuntimeMemoryInvalidationProposal | undefined {
  const row = executeSqliteQueryTakeFirstSync(
    db,
    getRuntimeMemoryPersistenceKysely(db)
      .selectFrom("runtime_memory_invalidations")
      .select("record_json")
      .where("invalidation_id", "=", invalidationId),
  );
  return row ? parseRuntimeMemoryInvalidation(row.record_json) : undefined;
}

function insertEpisodeRow(
  db: DatabaseSync,
  episode: RuntimeMemoryEpisodeRecord,
  now: number,
): void {
  executeSqliteQuerySync(
    db,
    getRuntimeMemoryPersistenceKysely(db)
      .insertInto("runtime_memory_episodes")
      .values(episodeToRow(episode, now)),
  );
}

function updateEpisodeRow(
  db: DatabaseSync,
  episodeId: string,
  episode: RuntimeMemoryEpisodeRecord,
  now: number,
): void {
  executeSqliteQuerySync(
    db,
    getRuntimeMemoryPersistenceKysely(db)
      .updateTable("runtime_memory_episodes")
      .set({
        source_refs_json: JSON.stringify(episode.sourceRefs),
        evidence_refs_json: JSON.stringify(episode.evidenceRefs),
        metadata_json: jsonOrNull(episode.metadata),
        record_json: JSON.stringify(episode),
        updated_at: now,
      })
      .where("episode_id", "=", episodeId),
  );
}

function insertEpisodeIdempotencyKey(
  db: DatabaseSync,
  idempotencyKey: string,
  episodeId: string,
  now: number,
): void {
  executeSqliteQuerySync(
    db,
    getRuntimeMemoryPersistenceKysely(db)
      .insertInto("runtime_memory_episode_idempotency_keys")
      .values({
        idempotency_key: idempotencyKey,
        episode_id: episodeId,
        created_at: now,
      })
      .onConflict((conflict) => conflict.column("idempotency_key").doNothing()),
  );
}

function readEpisodes(db: DatabaseSync): RuntimeMemoryEpisodeRecord[] {
  const rows = executeSqliteQuerySync(
    db,
    getRuntimeMemoryPersistenceKysely(db)
      .selectFrom("runtime_memory_episodes")
      .select("record_json")
      .orderBy("created_at", "asc")
      .orderBy("episode_id", "asc"),
  ).rows;
  return rows.flatMap((row) => {
    const parsed = parseRuntimeMemoryEpisode(row.record_json);
    return parsed ? [parsed] : [];
  });
}

function readFacts(db: DatabaseSync): RuntimeMemoryQueryableFact[] {
  const rows = executeSqliteQuerySync(
    db,
    getRuntimeMemoryPersistenceKysely(db)
      .selectFrom("runtime_memory_facts")
      .select("record_json")
      .orderBy("created_at", "asc")
      .orderBy("fact_id", "asc"),
  ).rows;
  return rows.flatMap((row) => {
    const parsed = parseRuntimeMemoryFact(row.record_json);
    return parsed ? [parsed] : [];
  });
}

function readInvalidations(db: DatabaseSync): RuntimeMemoryInvalidationProposal[] {
  const rows = executeSqliteQuerySync(
    db,
    getRuntimeMemoryPersistenceKysely(db)
      .selectFrom("runtime_memory_invalidations")
      .select("record_json")
      .orderBy("created_at", "asc")
      .orderBy("invalidation_id", "asc"),
  ).rows;
  return rows.flatMap((row) => {
    const parsed = parseRuntimeMemoryInvalidation(row.record_json);
    return parsed ? [parsed] : [];
  });
}

function relationTableExists(db: DatabaseSync): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("runtime_memory_fact_relations") as { ok?: unknown } | undefined;
  return row?.ok === 1;
}

function readRelations(db: DatabaseSync): RuntimeMemoryFactRelation[] {
  if (!relationTableExists(db)) return [];
  const rows = db
    .prepare(
      `SELECT relation_id, source_fact_id, target_fact_id, relation_type,
              confidence, metadata_json, created_at
       FROM runtime_memory_fact_relations
       ORDER BY created_at ASC, relation_id ASC`,
    )
    .all() as Array<{
    relation_id: string;
    source_fact_id: string;
    target_fact_id: string;
    relation_type: string;
    confidence: number;
    metadata_json: string | null;
    created_at: number;
  }>;
  return rows.flatMap((row) => {
    if (!isRuntimeMemoryRelationType(row.relation_type)) return [];
    let metadata: RuntimeMemoryFactRelation["metadata"];
    if (row.metadata_json) {
      try {
        metadata = JSON.parse(row.metadata_json) as RuntimeMemoryFactRelation["metadata"];
      } catch {
        metadata = undefined;
      }
    }
    return [{
      relationId: row.relation_id,
      sourceFactId: row.source_fact_id,
      targetFactId: row.target_fact_id,
      relationType: row.relation_type,
      confidence: row.confidence,
      metadata,
      createdAt: row.created_at,
    }];
  });
}

function persistRelationRow(
  db: DatabaseSync,
  relation: Omit<RuntimeMemoryFactRelation, "relationId" | "createdAt">,
  now: number,
): void {
  const relationId = `${relation.sourceFactId}:${relation.targetFactId}:${relation.relationType}`;
  const metadataJson = relation.metadata
    ? JSON.stringify(relation.metadata)
    : null;
  db.prepare(
    `INSERT INTO runtime_memory_fact_relations
       (relation_id, source_fact_id, target_fact_id, relation_type, confidence, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(relation_id) DO UPDATE SET
       confidence = excluded.confidence,
       metadata_json = excluded.metadata_json`,
  ).run(
    relationId,
    relation.sourceFactId,
    relation.targetFactId,
    relation.relationType,
    relation.confidence,
    metadataJson,
    now,
  );
}

function embeddingsTableExists(db: DatabaseSync): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("runtime_memory_embeddings") as { ok?: unknown } | undefined;
  return row?.ok === 1;
}

function readEmbedding(
  db: DatabaseSync,
  factId: string,
  providerId: string,
  model: string,
): Float32Array | null {
  if (!embeddingsTableExists(db)) return null;
  const row = db
    .prepare(
      `SELECT embedding, dimension FROM runtime_memory_embeddings
       WHERE fact_id = ? AND provider_id = ? AND model = ?`,
    )
    .get(factId, providerId, model) as
    | { embedding: Buffer; dimension: number }
    | undefined;
  if (!row) return null;
  return new Float32Array(
    row.embedding.buffer,
    row.embedding.byteOffset,
    row.embedding.byteLength / 4,
  );
}

function replaceEmbeddingRow(
  db: DatabaseSync,
  params: {
    factId: string;
    providerId: string;
    model: string;
    dimension: number;
    embedding: Float32Array;
    now: number;
  },
): void {
  const buffer = Buffer.from(
    params.embedding.buffer,
    params.embedding.byteOffset,
    params.embedding.byteLength,
  );
  db.prepare(
    `INSERT INTO runtime_memory_embeddings
       (fact_id, provider_id, model, dimension, embedding, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(fact_id) DO UPDATE SET
       provider_id = excluded.provider_id,
       model = excluded.model,
       dimension = excluded.dimension,
       embedding = excluded.embedding,
       updated_at = excluded.updated_at`,
  ).run(
    params.factId,
    params.providerId,
    params.model,
    params.dimension,
    buffer,
    params.now,
    params.now,
  );
}

function deleteEmbeddingRow(db: DatabaseSync, factId: string): void {
  if (!embeddingsTableExists(db)) return;
  db.prepare("DELETE FROM runtime_memory_embeddings WHERE fact_id = ?").run(
    factId,
  );
}

function openRuntimeMemoryInspectionDatabase(pathname: string): DatabaseSync {
  const sqlite = requireNodeSqlite();
  return new sqlite.DatabaseSync(pathname, { readOnly: true });
}

function runtimeMemoryInspectionTableExists(
  db: DatabaseSync,
  tableName: "runtime_memory_episodes",
): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { ok?: unknown } | undefined;
  return row?.ok === 1;
}

function countRuntimeMemoryInspectionEpisodes(db: DatabaseSync): number {
  const row = executeSqliteQueryTakeFirstSync(
    db,
    getRuntimeMemoryPersistenceKysely(db)
      .selectFrom("runtime_memory_episodes")
      .select((eb) => eb.fn.countAll<number>().as("count")),
  ) as { count?: unknown } | undefined;
  return Number(row?.count ?? 0);
}

function readRuntimeMemoryInspectionEpisodeRows(
  db: DatabaseSync,
  limit: number,
): RuntimeMemoryInspectionEpisodeRow[] {
  return executeSqliteQuerySync(
    db,
    getRuntimeMemoryPersistenceKysely(db)
      .selectFrom("runtime_memory_episodes")
      .select([
        "episode_id",
        "task_id",
        "kind",
        "reference_time",
        "bounded_summary",
        "source_refs_json",
        "evidence_refs_json",
        "metadata_json",
        "redaction_status",
      ])
      .orderBy("created_at", "asc")
      .orderBy("episode_id", "asc")
      .limit(limit),
  ).rows;
}

function inspectionSummaryFromRow(
  row: RuntimeMemoryInspectionEpisodeRow,
  diagnostics: RuntimeMemorySanitizedEpisodeInspectionDiagnostic[],
): RuntimeMemorySanitizedEpisodeInspectionSummary {
  const metadata = inspectionObjectFromJson(row.metadata_json, diagnostics);
  return {
    episodeId: sanitizeInspectionString(row.episode_id),
    taskId: sanitizeInspectionString(row.task_id),
    kind: sanitizeInspectionString(row.kind),
    reference_time: Number(row.reference_time),
    boundedSummary: sanitizeInspectionString(row.bounded_summary),
    sourceRefs: inspectionRefsFromJson(row.source_refs_json, diagnostics),
    evidenceRefs: inspectionRefsFromJson(row.evidence_refs_json, diagnostics),
    redactionStatus: sanitizeInspectionString(row.redaction_status),
    ...(metadata ? { metadata } : {}),
  };
}

function inspectionRefsFromJson(
  raw: string,
  diagnostics: RuntimeMemorySanitizedEpisodeInspectionDiagnostic[],
): ReadonlyArray<Record<string, unknown>> {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) {
    diagnostics.push(invalidInspectionJsonDiagnostic());
    return [];
  }
  return parsed
    .slice(0, 32)
    .map((item) => sanitizeInspectionValue(item))
    .filter(isInspectionRecord);
}

function inspectionObjectFromJson(
  raw: string | null,
  diagnostics: RuntimeMemorySanitizedEpisodeInspectionDiagnostic[],
): Record<string, unknown> | undefined {
  if (raw === null) {
    return undefined;
  }
  const sanitized = sanitizeInspectionValue(parseJson(raw));
  if (!isInspectionRecord(sanitized)) {
    diagnostics.push(invalidInspectionJsonDiagnostic());
    return undefined;
  }
  return sanitized;
}

function sanitizeInspectionValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeInspectionString(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 32).map(sanitizeInspectionValue);
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 64)) {
    const safeKey = sanitizeInspectionString(key);
    if (safeKey === "[redacted]") {
      continue;
    }
    const safeValue = sanitizeInspectionValue(child);
    if (safeValue !== undefined) {
      output[safeKey] = safeValue;
    }
  }
  return output;
}

function sanitizeInspectionString(value: string): string {
  const raw = rejectRawRuntimeMemoryInput(value);
  if (raw) {
    return "[redacted]";
  }
  return value.length > 512 ? `${value.slice(0, 512)}...` : value;
}

function isInspectionRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidInspectionJsonDiagnostic():
  RuntimeMemorySanitizedEpisodeInspectionDiagnostic {
  logger.warn("episode_inspection_invalid_json");
  return {
    code: "invalid_json",
    message: "Runtime Memory readonly episode inspection skipped malformed JSON.",
  };
}

function skippedInspectionResult(
  reason: Extract<
    RuntimeMemorySanitizedEpisodeInspectionResult,
    { status: "skipped" }
  >["reason"],
  stats: RuntimeMemorySanitizedEpisodeInspectionStats,
): Extract<RuntimeMemorySanitizedEpisodeInspectionResult, { status: "skipped" }> {
  return {
    status: "skipped",
    reason,
    episodes: [],
    stats,
    diagnostics: [
      {
        code: reason,
        message: skippedInspectionMessage(reason),
      },
    ],
  };
}

function skippedInspectionMessage(
  reason: Extract<
    RuntimeMemorySanitizedEpisodeInspectionResult,
    { status: "skipped" }
  >["reason"],
): string {
  if (reason === "flag_disabled") {
    return "Runtime Memory readonly episode inspection requires runtime.memory.persist.";
  }
  if (reason === "database_path_required") {
    return "Runtime Memory readonly episode inspection requires an explicit database path.";
  }
  if (reason === "database_missing") {
    return "Runtime Memory readonly episode inspection skipped a missing database.";
  }
  return "Runtime Memory readonly episode inspection skipped because the episodes table is missing.";
}

function episodeToRow(
  episode: RuntimeMemoryEpisodeRecord,
  now: number,
): Insertable<RuntimeMemoryEpisodeRow> {
  return {
    episode_id: episode.episodeId,
    task_id: episode.taskId,
    kind: episode.kind,
    reference_time: episode.reference_time,
    idempotency_key: episode.idempotencyKey,
    bounded_summary: episode.boundedSummary,
    source_refs_json: JSON.stringify(episode.sourceRefs),
    evidence_refs_json: JSON.stringify(episode.evidenceRefs),
    metadata_json: jsonOrNull(episode.metadata),
    redaction_status: episode.redactionStatus,
    record_json: JSON.stringify(episode),
    schema_version: RUNTIME_MEMORY_PERSISTENCE_SCHEMA_VERSION,
    created_at: now,
    updated_at: now,
  };
}

function factToRow(
  fact: RuntimeMemoryQueryableFact,
  now: number,
): Insertable<RuntimeMemoryFactRow> {
  const durable = isRuntimeMemoryTemporalFact(fact);
  const memoryType: RuntimeMemoryType =
    fact.memoryType ?? DEFAULT_RUNTIME_MEMORY_TYPE;
  return {
    fact_id: fact.factId,
    record_kind: durable ? "fact" : "candidate",
    task_id: fact.taskId ?? null,
    subject: fact.subject,
    predicate: fact.predicate,
    object_summary: fact.objectSummary,
    confidence: fact.confidence,
    source: fact.source,
    verification_status: fact.verificationStatus,
    memory_type: memoryType,
    valid_at: fact.valid_at,
    invalid_at: fact.invalid_at ?? null,
    expired_at: fact.expired_at ?? null,
    reference_time: fact.reference_time,
    source_episode_refs_json: JSON.stringify(fact.sourceEpisodeRefs),
    evidence_refs_json: JSON.stringify(fact.evidenceRefs),
    metadata_json: jsonOrNull(fact.metadata),
    proposed_at: durable ? null : fact.proposedAt,
    accepted_at: durable ? fact.acceptedAt : null,
    promotion_json: durable ? JSON.stringify(fact.promotion) : null,
    record_json: JSON.stringify({ ...fact, memoryType }),
    schema_version: RUNTIME_MEMORY_PERSISTENCE_SCHEMA_VERSION,
    created_at: now,
    updated_at: now,
  };
}

function invalidationToRow(
  invalidation: RuntimeMemoryInvalidationProposal,
  now: number,
): Insertable<RuntimeMemoryInvalidationRow> {
  return {
    invalidation_id: invalidation.invalidationId,
    fact_id: invalidation.factId,
    reason: invalidation.reason,
    invalid_at: invalidation.invalid_at,
    reference_time: invalidation.reference_time,
    proposed_by: invalidation.proposedBy,
    verification_status: invalidation.verificationStatus,
    source_episode_refs_json: JSON.stringify(invalidation.sourceEpisodeRefs),
    evidence_refs_json: JSON.stringify(invalidation.evidenceRefs),
    replacement_fact_id: invalidation.replacementFactId ?? null,
    metadata_json: jsonOrNull(invalidation.metadata),
    record_json: JSON.stringify(invalidation),
    schema_version: RUNTIME_MEMORY_PERSISTENCE_SCHEMA_VERSION,
    created_at: now,
    updated_at: now,
  };
}

function sanitizeEpisodeForPersistence(
  episode: RuntimeMemoryEpisodeRecord,
): SanitizedPersistenceInput<RuntimeMemoryEpisodeRecord> {
  if (!isRuntimeMemoryEpisodeRecord(episode)) {
    return makePersistenceRejection("invalid_episode");
  }
  const sanitized = sanitizeRuntimeMemoryEpisodeRecord(episode);
  if (!sanitized.accepted) {
    return sanitized;
  }
  return rejectPersistedRawOutput(sanitized.value);
}

function sanitizeFactForPersistence(
  fact: RuntimeMemoryTemporalFact | RuntimeMemoryTemporalFactCandidate,
): SanitizedPersistenceInput<RuntimeMemoryQueryableFact> {
  if (isRuntimeMemoryTemporalFact(fact)) {
    const sanitized = sanitizeRuntimeMemoryTemporalFact(fact);
    if (!sanitized.accepted) {
      return sanitized;
    }
    return rejectPersistedRawOutput(sanitized.value);
  }
  if (isRuntimeMemoryTemporalFactCandidate(fact)) {
    const sanitized = sanitizeRuntimeMemoryTemporalFactCandidate(fact);
    if (!sanitized.accepted) {
      return sanitized;
    }
    return rejectPersistedRawOutput(sanitized.value);
  }
  return makePersistenceRejection("invalid_fact");
}

function sanitizeInvalidationForPersistence(
  invalidation: RuntimeMemoryInvalidationProposal,
): SanitizedPersistenceInput<RuntimeMemoryInvalidationProposal> {
  if (!isRuntimeMemoryInvalidationProposal(invalidation)) {
    return makePersistenceRejection("invalid_invalidation");
  }
  const sanitized = sanitizeRuntimeMemoryInvalidationProposal(invalidation);
  if (!sanitized.accepted) {
    return sanitized;
  }
  return rejectPersistedRawOutput(sanitized.value);
}

function rejectPersistedRawOutput<T>(value: T): SanitizedPersistenceInput<T> {
  const raw = rejectRawRuntimeMemoryValue(value);
  return raw ?? { accepted: true, value };
}

function rejectRawRuntimeMemoryValue(
  value: unknown,
): RuntimeMemoryInputRejection | undefined {
  if (typeof value === "string") {
    return rejectRawRuntimeMemoryInput(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const rejection = rejectRawRuntimeMemoryValue(item);
      if (rejection) {
        return rejection;
      }
    }
    return undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  for (const child of Object.values(value)) {
    const rejection = rejectRawRuntimeMemoryValue(child);
    if (rejection) {
      return rejection;
    }
  }
  return undefined;
}

function parseRuntimeMemoryEpisode(raw: string): RuntimeMemoryEpisodeRecord | undefined {
  const parsed = parseJson(raw);
  return isRuntimeMemoryEpisodeRecord(parsed) ? parsed : undefined;
}

function parseRuntimeMemoryFact(raw: string): RuntimeMemoryQueryableFact | undefined {
  const parsed = parseJson(raw);
  if (isRuntimeMemoryTemporalFact(parsed)) {
    return parsed;
  }
  if (isRuntimeMemoryTemporalFactCandidate(parsed)) {
    return parsed;
  }
  return undefined;
}

function parseRuntimeMemoryInvalidation(
  raw: string,
): RuntimeMemoryInvalidationProposal | undefined {
  const parsed = parseJson(raw);
  return isRuntimeMemoryInvalidationProposal(parsed) ? parsed : undefined;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function mergeEpisodeEvidence(
  existing: RuntimeMemoryEpisodeRecord,
  incoming: RuntimeMemoryEpisodeRecord,
): RuntimeMemoryEpisodeRecord {
  return {
    ...existing,
    sourceRefs: mergeUnique(existing.sourceRefs, incoming.sourceRefs),
    evidenceRefs: mergeUnique(existing.evidenceRefs, incoming.evidenceRefs),
    ...(existing.metadata || incoming.metadata
      ? {
          metadata: {
            ...(existing.metadata ?? {}),
            ...(incoming.metadata ?? {}),
          },
        }
      : {}),
  };
}

function mergeUnique<T>(left: readonly T[], right: readonly T[]): T[] {
  const seen = new Set(left.map(stableKey));
  const merged = [...left];
  for (const item of right) {
    const key = stableKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return merged.map(cloneMutable);
}

function trimRows(
  db: DatabaseSync,
  tableName: "runtime_memory_episodes" | "runtime_memory_facts" | "runtime_memory_invalidations",
  idColumn: "episode_id" | "fact_id" | "invalidation_id",
  maxRows: number | undefined,
): void {
  const max = normalizeBound(maxRows, fallbackForTable(tableName));
  const stateDb = getRuntimeMemoryPersistenceKysely(db);
  const rows = executeSqliteQuerySync(
    db,
    stateDb
      .selectFrom(tableName)
      .select(idColumn)
      .orderBy("created_at", "asc")
      .orderBy(idColumn, "asc"),
  ).rows as Array<Record<typeof idColumn, string>>;
  const deleteIds = rows.slice(0, Math.max(0, rows.length - max)).map((row) => row[idColumn]);
  if (deleteIds.length === 0) {
    return;
  }
  executeSqliteQuerySync(
    db,
    stateDb.deleteFrom(tableName).where(idColumn, "in", deleteIds),
  );
}

function fallbackForTable(
  tableName: "runtime_memory_episodes" | "runtime_memory_facts" | "runtime_memory_invalidations",
): number {
  if (tableName === "runtime_memory_episodes") {
    return RUNTIME_MEMORY_STORE_DEFAULT_MAX_EPISODES;
  }
  if (tableName === "runtime_memory_facts") {
    return RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS;
  }
  return RUNTIME_MEMORY_STORE_DEFAULT_MAX_INVALIDATIONS;
}

function getRuntimeMemoryPersistenceKysely(db: DatabaseSync) {
  return getNodeSqliteKysely<RuntimeMemoryPersistenceDatabase>(db);
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function normalizeBound(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? value
    : fallback;
}

function persistedWriteResult<T>(params: {
  stored: boolean;
  duplicate: boolean;
  value: T;
}): RuntimeMemoryPersistenceWriteResult<T> {
  return {
    status: "persisted",
    persisted: true,
    stored: params.stored,
    duplicate: params.duplicate,
    value: readonlyClone(params.value),
  };
}

function rejectedWriteResult<T>(
  rejection: Exclude<SanitizedPersistenceInput<T>, { accepted: true }>,
): RuntimeMemoryPersistenceWriteResult<T> {
  return {
    status: "rejected",
    persisted: false,
    reason: rejection.reason,
    message: rejection.message,
  };
}

function disabledWriteResult<T>(): RuntimeMemoryPersistenceWriteResult<T> {
  return {
    status: "skipped",
    reason: "flag_disabled",
    persisted: false,
  };
}

function disabledMigrationResult(): RuntimeMemoryPersistenceMigrationResult {
  return {
    status: "skipped",
    reason: "flag_disabled",
    migrated: false,
  };
}

function makePersistenceRejection(
  reason: RuntimeMemoryPersistenceRejectionReason,
): SanitizedPersistenceInput<never> {
  return {
    accepted: false,
    reason,
    message: `Runtime memory persistence input rejected: ${reason}.`,
  };
}

function readonlyClone<T>(value: T): RuntimeMemoryReadonly<T> {
  return deepFreeze(cloneMutable(value));
}

function cloneMutable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): RuntimeMemoryReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value as RuntimeMemoryReadonly<T>;
}

function stableKey(value: unknown): string {
  return JSON.stringify(value);
}
