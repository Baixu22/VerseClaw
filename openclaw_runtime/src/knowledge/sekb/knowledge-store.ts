import type { Selectable } from "kysely";
import {
  executeSqliteQuerySync,
  getNodeSqliteKysely,
} from "../../infra/kysely-sync.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabase,
  type OpenClawStateDatabaseOptions,
} from "../../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../../state/openclaw-state-db.generated.js";
import {
  approxTokenCount,
  buildPrincipleFullContent,
  normalizeTags,
  SEKB_L1_TOKEN_BUDGET,
  type DistillationRejection,
  type DistillationSuggestion,
  type IndexEntry,
  type JsonObject,
  type Principle,
  type PrincipleCriticality,
  type PrincipleQuery,
  type PrincipleStatus,
  type Trajectory,
  type TrajectoryCost,
  type TrajectoryOutcome,
  type TrajectoryQuery,
  type TrajectoryStep,
  type SekbBatchDistillationEvent,
  type SekbBatchDistillationFallbackReason,
} from "./types.js";
import { sanitizeTrajectoryForPersistence } from "./trajectory-redaction.js";

type SekbDatabase = Pick<
  OpenClawStateKyselyDatabase,
  | "sekb_distillation_rejections"
  | "sekb_batch_distillation_events"
  | "sekb_error_signature_cache"
  | "sekb_principles"
  | "sekb_trajectories"
>;

type SekbTrajectoryRow = Selectable<OpenClawStateKyselyDatabase["sekb_trajectories"]>;
type SekbPrincipleRow = Selectable<OpenClawStateKyselyDatabase["sekb_principles"]>;
type SekbRejectionRow = Selectable<OpenClawStateKyselyDatabase["sekb_distillation_rejections"]>;
type SekbBatchDistillationEventRow = Selectable<
  OpenClawStateKyselyDatabase["sekb_batch_distillation_events"]
>;
type SekbErrorSignatureCacheRow = Selectable<
  OpenClawStateKyselyDatabase["sekb_error_signature_cache"]
>;

export type KnowledgeStoreOptions = {
  database?: OpenClawStateDatabaseOptions;
  openDatabase?: (options?: OpenClawStateDatabaseOptions) => OpenClawStateDatabase;
  now?: () => Date;
};

/** Runtime SQLite store for SEKB L3 trajectories, L2 principles, and the derived L1 index. */
export class KnowledgeStore {
  readonly #database?: OpenClawStateDatabaseOptions;
  readonly #openDatabase: (options?: OpenClawStateDatabaseOptions) => OpenClawStateDatabase;
  readonly #now: () => Date;

  constructor(options: KnowledgeStoreOptions = {}) {
    this.#database = options.database;
    this.#openDatabase = options.openDatabase ?? openOpenClawStateDatabase;
    this.#now = options.now ?? (() => new Date());
  }

  save_trajectory(trajectory: Trajectory): void {
    const row = rowFromTrajectory(trajectory, this.#now().getTime());
    runOpenClawStateWriteTransaction((database) => {
      const query = getNodeSqliteKysely<SekbDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        query
          .insertInto("sekb_trajectories")
          .values(row)
          .onConflict((conflict) =>
            conflict.column("trajectory_id").doUpdateSet({
              created_at: (eb) => eb.ref("excluded.created_at"),
              task_intent: (eb) => eb.ref("excluded.task_intent"),
              task_type: (eb) => eb.ref("excluded.task_type"),
              context_fingerprint_json: (eb) => eb.ref("excluded.context_fingerprint_json"),
              steps_json: (eb) => eb.ref("excluded.steps_json"),
              outcome: (eb) => eb.ref("excluded.outcome"),
              error_signature: (eb) => eb.ref("excluded.error_signature"),
              cost_json: (eb) => eb.ref("excluded.cost_json"),
              distilled: (eb) => eb.ref("excluded.distilled"),
              distilled_into_json: (eb) => eb.ref("excluded.distilled_into_json"),
              expires_at: (eb) => eb.ref("excluded.expires_at"),
              metadata_json: (eb) => eb.ref("excluded.metadata_json"),
              updated_at_ms: (eb) => eb.ref("excluded.updated_at_ms"),
            }),
          ),
      );
    }, this.#database);
  }

  update_trajectory(id: string, updates: Partial<Trajectory>): void {
    const existing = this.get_trajectory(id);
    this.save_trajectory({ ...existing, ...updates });
  }

  get_trajectory(id: string): Trajectory {
    const trajectory = this.find_trajectory(id);
    if (!trajectory) {
      throw new Error(`SEKB trajectory not found: ${id}`);
    }
    return trajectory;
  }

  /** Returns null when the trajectory id is missing; does not throw. */
  find_trajectory(id: string): Trajectory | null {
    const { db, query } = this.#stateDb();
    const row = executeSqliteQuerySync(
      db,
      query.selectFrom("sekb_trajectories").selectAll().where("trajectory_id", "=", id).limit(1),
    ).rows[0] as SekbTrajectoryRow | undefined;
    return row ? trajectoryFromRow(row) : null;
  }

  /**
   * Count trajectories matching an exact error signature without loading full rows.
   * Used by shadow recurrence scoring; no schema change required.
   */
  count_trajectories_by_error_signature(error_signature: string): number {
    const signature = error_signature.trim();
    if (!signature) {
      return 0;
    }
    const { db, query } = this.#stateDb();
    const row = executeSqliteQuerySync(
      db,
      query
        .selectFrom("sekb_trajectories")
        .select((eb) => eb.fn.countAll<number | bigint>().as("count"))
        .where("error_signature", "=", signature),
    ).rows[0] as { count?: number | bigint | string } | undefined;
    const count = row?.count;
    if (typeof count === "bigint") {
      return Number(count);
    }
    if (typeof count === "number" && Number.isFinite(count)) {
      return count;
    }
    if (typeof count === "string" && count.trim()) {
      const parsed = Number(count);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  query_trajectories(filters: TrajectoryQuery = {}): Trajectory[] {
    const { db, query } = this.#stateDb();
    let select = query.selectFrom("sekb_trajectories").selectAll();
    if (filters.task_type) {
      select = select.where("task_type", "=", filters.task_type);
    }
    if (filters.outcome) {
      select = select.where("outcome", "=", filters.outcome);
    }
    if (filters.distilled !== undefined && filters.distilled !== null) {
      select = select.where("distilled", "=", filters.distilled ? 1 : 0);
    }
    const tags = normalizeTags(filters.context_tags);
    return (executeSqliteQuerySync(
      db,
      select.orderBy("created_at", "desc").orderBy("trajectory_id", "asc"),
    ).rows as SekbTrajectoryRow[])
      .map(trajectoryFromRow)
      .filter((trajectory) =>
        tags.length === 0 || tags.some((tag) => trajectory.context_fingerprint.includes(tag))
      );
  }

  save_principle(principle: Principle): string {
    const normalized = normalizePrinciple(principle, this.#now());
    const row = rowFromPrinciple(normalized);
    runOpenClawStateWriteTransaction((database) => {
      const query = getNodeSqliteKysely<SekbDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        query
          .insertInto("sekb_principles")
          .values(row)
          .onConflict((conflict) =>
            conflict.column("principle_id").doUpdateSet({
              created_at: (eb) => eb.ref("excluded.created_at"),
              updated_at: (eb) => eb.ref("excluded.updated_at"),
              title: (eb) => eb.ref("excluded.title"),
              condition: (eb) => eb.ref("excluded.condition"),
              action: (eb) => eb.ref("excluded.action"),
              reason: (eb) => eb.ref("excluded.reason"),
              full_content: (eb) => eb.ref("excluded.full_content"),
              task_types_json: (eb) => eb.ref("excluded.task_types_json"),
              context_tags_json: (eb) => eb.ref("excluded.context_tags_json"),
              embedding_json: (eb) => eb.ref("excluded.embedding_json"),
              source_trajectories_json: (eb) => eb.ref("excluded.source_trajectories_json"),
              created_by: (eb) => eb.ref("excluded.created_by"),
              status: (eb) => eb.ref("excluded.status"),
              retrieval_count: (eb) => eb.ref("excluded.retrieval_count"),
              adoption_count: (eb) => eb.ref("excluded.adoption_count"),
              post_adoption_success: (eb) => eb.ref("excluded.post_adoption_success"),
              criticality: (eb) => eb.ref("excluded.criticality"),
              pinned: (eb) => eb.ref("excluded.pinned"),
              metadata_json: (eb) => eb.ref("excluded.metadata_json"),
            }),
          ),
      );
    }, this.#database);
    return normalized.principle_id;
  }

  update_principle(id: string, updates: Partial<Principle>): void {
    const existing = this.get_principle(id);
    this.save_principle({ ...existing, ...updates, updated_at: updates.updated_at ?? isoNow(this.#now) });
  }

  get_principle(id: string): Principle {
    const { db, query } = this.#stateDb();
    const row = executeSqliteQuerySync(
      db,
      query.selectFrom("sekb_principles").selectAll().where("principle_id", "=", id).limit(1),
    ).rows[0] as SekbPrincipleRow | undefined;
    if (!row) {
      throw new Error(`SEKB principle not found: ${id}`);
    }
    return principleFromRow(row);
  }

  query_principles(filters: PrincipleQuery = {}): Principle[] {
    const { db, query } = this.#stateDb();
    let select = query.selectFrom("sekb_principles").selectAll();
    if (filters.status) {
      select = select.where("status", "=", filters.status);
    }
    const taskTypes = normalizeTags(filters.task_types ?? undefined);
    return (executeSqliteQuerySync(
      db,
      select.orderBy("updated_at", "desc").orderBy("principle_id", "asc"),
    ).rows as SekbPrincipleRow[])
      .map(principleFromRow)
      .filter((principle) =>
        taskTypes.length === 0 || taskTypes.some((taskType) => principle.task_types.includes(taskType))
      );
  }

  archive_principle(id: string): void {
    this.update_principle(id, { status: "archived" });
  }

  /** Hard-delete a principle row (P3-004 session cascade). */
  delete_principle(id: string): void {
    runOpenClawStateWriteTransaction((database) => {
      const query = getNodeSqliteKysely<SekbDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        query.deleteFrom("sekb_principles").where("principle_id", "=", id),
      );
    }, this.#database);
  }

  /** Hard-delete a trajectory row (P3-004 session cascade / TTL). */
  delete_trajectory(id: string): void {
    runOpenClawStateWriteTransaction((database) => {
      const query = getNodeSqliteKysely<SekbDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        query.deleteFrom("sekb_trajectories").where("trajectory_id", "=", id),
      );
    }, this.#database);
  }

  /** Purge trajectories whose expires_at is in the past (P3-004 TTL). */
  purge_expired_trajectories(now = this.#now()): string[] {
    const expired = this.query_trajectories({}).filter((trajectory) => {
      if (!trajectory.expires_at) return false;
      const exp = Date.parse(trajectory.expires_at);
      return Number.isFinite(exp) && exp <= now.getTime();
    });
    const deleted: string[] = [];
    for (const trajectory of expired) {
      this.delete_trajectory(trajectory.trajectory_id);
      deleted.push(trajectory.trajectory_id);
    }
    return deleted;
  }

  rebuild_index(): string {
    const active = this.query_principles({ status: "active" }).toSorted(compareIndexPrinciples);
    const header = `【知识库索引】共 ${active.length} 条原则（仅展示 active 状态）`;
    const footer = "如需获取某条原则的完整内容，使用 retrieve_principle(id) 工具。";
    const lines = [header];
    for (const principle of active) {
      const entry = indexEntryFromPrinciple(principle);
      const candidate = [...lines, formatIndexEntry(entry), footer].join("\n");
      if (approxTokenCount(candidate) > SEKB_L1_TOKEN_BUDGET) {
        continue;
      }
      lines.push(formatIndexEntry(entry));
    }
    const index = [...lines, footer].join("\n");
    return approxTokenCount(index) <= SEKB_L1_TOKEN_BUDGET ? index : `${header}\n${footer}`;
  }

  get_index(): string {
    return this.rebuild_index();
  }

  increment_retrieval_count(principle_id: string): void {
    const principle = this.get_principle(principle_id);
    this.update_principle(principle_id, {
      retrieval_count: principle.retrieval_count + 1,
    });
  }

  record_adoption(principle_id: string, task_succeeded: boolean): void {
    const principle = this.get_principle(principle_id);
    this.update_principle(principle_id, {
      adoption_count: principle.adoption_count + 1,
      post_adoption_success: principle.post_adoption_success + (task_succeeded ? 1 : 0),
    });
  }

  read_error_signature_cache(raw_error_hash: string): string | null {
    const { db, query } = this.#stateDb();
    const row = executeSqliteQuerySync(
      db,
      query
        .selectFrom("sekb_error_signature_cache")
        .selectAll()
        .where("raw_error_hash", "=", raw_error_hash)
        .limit(1),
    ).rows[0] as SekbErrorSignatureCacheRow | undefined;
    return row?.error_signature ?? null;
  }

  write_error_signature_cache(input: {
    raw_error_hash: string;
    raw_error_sample: string;
    error_signature: string;
  }): void {
    const now = isoNow(this.#now);
    runOpenClawStateWriteTransaction((database) => {
      const query = getNodeSqliteKysely<SekbDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        query
          .insertInto("sekb_error_signature_cache")
          .values({
            raw_error_hash: input.raw_error_hash,
            raw_error_sample: input.raw_error_sample.slice(0, 1_000),
            error_signature: input.error_signature,
            created_at: now,
            updated_at: now,
          })
          .onConflict((conflict) =>
            conflict.column("raw_error_hash").doUpdateSet({
              raw_error_sample: (eb) => eb.ref("excluded.raw_error_sample"),
              error_signature: (eb) => eb.ref("excluded.error_signature"),
              updated_at: (eb) => eb.ref("excluded.updated_at"),
            }),
          ),
      );
    }, this.#database);
  }

  save_distillation_rejection(rejection: DistillationRejection): void {
    runOpenClawStateWriteTransaction((database) => {
      const query = getNodeSqliteKysely<SekbDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        query.insertInto("sekb_distillation_rejections").values({
          rejection_id: rejection.rejection_id,
          created_at: rejection.created_at,
          suggestion_json: JSON.stringify(rejection.suggestion),
          reason: rejection.reason,
        }),
      );
    }, this.#database);
  }

  list_distillation_rejections(): DistillationRejection[] {
    const { db, query } = this.#stateDb();
    return (executeSqliteQuerySync(
      db,
      query
        .selectFrom("sekb_distillation_rejections")
        .selectAll()
        .orderBy("created_at", "desc")
        .orderBy("rejection_id", "asc"),
    ).rows as SekbRejectionRow[]).map((row) => ({
      rejection_id: row.rejection_id,
      created_at: row.created_at,
      suggestion: parseJsonObject(row.suggestion_json),
      reason: row.reason,
    }));
  }

  /** Stores aggregate evidence only; callers must never pass model input or output. */
  save_batch_distillation_event(event: SekbBatchDistillationEvent): void {
    runOpenClawStateWriteTransaction((database) => {
      const query = getNodeSqliteKysely<SekbDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        query.insertInto("sekb_batch_distillation_events").values(rowFromBatchDistillationEvent(event)),
      );
    }, this.#database);
  }

  list_batch_distillation_events(): SekbBatchDistillationEvent[] {
    const { db, query } = this.#stateDb();
    return (executeSqliteQuerySync(
      db,
      query
        .selectFrom("sekb_batch_distillation_events")
        .selectAll()
        .orderBy("created_at", "desc")
        .orderBy("batch_id", "asc"),
    ).rows as SekbBatchDistillationEventRow[]).map(batchDistillationEventFromRow);
  }

  record_batch_distillation_confirmation(batchId: string, editDistance: number | null): void {
    this.#updateBatchDistillationEvent(batchId, (event) => ({
      confirmation_count: event.confirmation_count + 1,
      edit_distance_sum: editDistance === null ? event.edit_distance_sum : event.edit_distance_sum + editDistance,
      edit_distance_count: editDistance === null ? event.edit_distance_count : event.edit_distance_count + 1,
    }));
  }

  record_batch_distillation_rejection(batchId: string): void {
    this.#updateBatchDistillationEvent(batchId, (event) => ({
      rejection_count: event.rejection_count + 1,
    }));
  }

  #updateBatchDistillationEvent(
    batchId: string,
    updates: (event: SekbBatchDistillationEvent) => Partial<SekbBatchDistillationEvent>,
  ): void {
    runOpenClawStateWriteTransaction((database) => {
      const query = getNodeSqliteKysely<SekbDatabase>(database.db);
      const row = executeSqliteQuerySync(
        database.db,
        query
          .selectFrom("sekb_batch_distillation_events")
          .selectAll()
          .where("batch_id", "=", batchId)
          .limit(1),
      ).rows[0] as SekbBatchDistillationEventRow | undefined;
      if (!row) return;
      const event = batchDistillationEventFromRow(row);
      const next = { ...event, ...updates(event) };
      executeSqliteQuerySync(
        database.db,
        query
          .updateTable("sekb_batch_distillation_events")
          .set({
            confirmation_count: next.confirmation_count,
            rejection_count: next.rejection_count,
            edit_distance_sum: next.edit_distance_sum,
            edit_distance_count: next.edit_distance_count,
          })
          .where("batch_id", "=", batchId),
      );
    }, this.#database);
  }

  #stateDb(): {
    db: OpenClawStateDatabase["db"];
    query: ReturnType<typeof getNodeSqliteKysely<SekbDatabase>>;
  } {
    const stateDb = this.#openDatabase(this.#database);
    return {
      db: stateDb.db,
      query: getNodeSqliteKysely<SekbDatabase>(stateDb.db),
    };
  }
}

function rowFromTrajectory(trajectory: Trajectory, updatedAtMs: number): SekbTrajectoryRow {
  const safe = sanitizeTrajectoryForPersistence(trajectory);
  return {
    trajectory_id: safe.trajectory_id,
    created_at: safe.created_at,
    task_intent: safe.task_intent,
    task_type: normalizeTaskType(safe.task_type),
    context_fingerprint_json: JSON.stringify(normalizeTags(safe.context_fingerprint)),
    steps_json: JSON.stringify(safe.steps),
    outcome: safe.outcome,
    error_signature: safe.error_signature,
    cost_json: JSON.stringify(safe.cost),
    distilled: safe.distilled ? 1 : 0,
    distilled_into_json: JSON.stringify(safe.distilled_into),
    expires_at: safe.expires_at,
    metadata_json: JSON.stringify(safe.metadata),
    updated_at_ms: updatedAtMs,
  };
}

function rowFromBatchDistillationEvent(event: SekbBatchDistillationEvent) {
  return {
    batch_id: event.batch_id,
    created_at: event.created_at,
    status: event.status,
    fallback_reason: event.fallback_reason,
    attempts: event.attempts,
    suggestion_count: event.suggestion_count,
    duplicate_suggestion_count: event.duplicate_suggestion_count,
    attributed_suggestion_count: event.attributed_suggestion_count,
    attribution_total: event.attribution_total,
    input_tokens: event.input_tokens,
    output_tokens: event.output_tokens,
    total_cost_usd: event.total_cost_usd,
    trace_id: event.trace_id,
    confirmation_count: event.confirmation_count,
    rejection_count: event.rejection_count,
    edit_distance_sum: event.edit_distance_sum,
    edit_distance_count: event.edit_distance_count,
  };
}

function batchDistillationEventFromRow(row: SekbBatchDistillationEventRow): SekbBatchDistillationEvent {
  return {
    batch_id: row.batch_id,
    created_at: row.created_at,
    status: row.status === "assisted" ? "assisted" : "fallback",
    fallback_reason: normalizeBatchFallbackReason(row.fallback_reason),
    attempts: normalizeNonnegativeInteger(row.attempts),
    suggestion_count: normalizeNonnegativeInteger(row.suggestion_count),
    duplicate_suggestion_count: normalizeNonnegativeInteger(row.duplicate_suggestion_count),
    attributed_suggestion_count: normalizeNonnegativeInteger(row.attributed_suggestion_count),
    attribution_total: normalizeNonnegativeInteger(row.attribution_total),
    input_tokens: normalizeNullableMetric(row.input_tokens),
    output_tokens: normalizeNullableMetric(row.output_tokens),
    total_cost_usd: normalizeNullableMetric(row.total_cost_usd),
    trace_id: row.trace_id,
    confirmation_count: normalizeNonnegativeInteger(row.confirmation_count),
    rejection_count: normalizeNonnegativeInteger(row.rejection_count),
    edit_distance_sum: normalizeNonnegativeNumber(row.edit_distance_sum),
    edit_distance_count: normalizeNonnegativeInteger(row.edit_distance_count),
  };
}

function trajectoryFromRow(row: SekbTrajectoryRow): Trajectory {
  return {
    trajectory_id: row.trajectory_id,
    created_at: row.created_at,
    task_intent: row.task_intent,
    task_type: row.task_type,
    context_fingerprint: parseStringArray(row.context_fingerprint_json),
    steps: parseSteps(row.steps_json),
    outcome: normalizeOutcome(row.outcome),
    error_signature: row.error_signature,
    cost: parseCost(row.cost_json),
    distilled: row.distilled === 1,
    distilled_into: parseStringArray(row.distilled_into_json),
    expires_at: row.expires_at,
    metadata: parseJsonObject(row.metadata_json),
  };
}

function rowFromPrinciple(principle: Principle): SekbPrincipleRow {
  return {
    principle_id: principle.principle_id,
    created_at: principle.created_at,
    updated_at: principle.updated_at,
    title: principle.title,
    condition: principle.condition,
    action: principle.action,
    reason: principle.reason,
    full_content: principle.full_content,
    task_types_json: JSON.stringify(normalizeTags(principle.task_types)),
    context_tags_json: JSON.stringify(normalizeTags(principle.context_tags)),
    embedding_json: principle.embedding ? JSON.stringify(principle.embedding) : null,
    source_trajectories_json: JSON.stringify(principle.source_trajectories),
    created_by: principle.created_by,
    status: principle.status,
    retrieval_count: principle.retrieval_count,
    adoption_count: principle.adoption_count,
    post_adoption_success: principle.post_adoption_success,
    criticality: principle.criticality,
    pinned: principle.pinned ? 1 : 0,
    metadata_json: JSON.stringify(principle.metadata),
  };
}

function principleFromRow(row: SekbPrincipleRow): Principle {
  return {
    principle_id: row.principle_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    title: row.title,
    condition: row.condition,
    action: row.action,
    reason: row.reason,
    full_content: row.full_content,
    task_types: parseStringArray(row.task_types_json),
    context_tags: parseStringArray(row.context_tags_json),
    embedding: row.embedding_json ? parseNumberArray(row.embedding_json) : null,
    source_trajectories: parseStringArray(row.source_trajectories_json),
    created_by: row.created_by === "agent" || row.created_by === "distiller" ? row.created_by : "human",
    status: normalizePrincipleStatus(row.status),
    retrieval_count: normalizeNumber(row.retrieval_count),
    adoption_count: normalizeNumber(row.adoption_count),
    post_adoption_success: normalizeNumber(row.post_adoption_success),
    criticality: normalizeCriticality(row.criticality),
    pinned: row.pinned === 1,
    metadata: parseJsonObject(row.metadata_json),
  };
}

function normalizePrinciple(principle: Principle, now: Date): Principle {
  const condition = principle.condition.trim();
  const action = principle.action.trim();
  const reason = principle.reason.trim();
  return {
    ...principle,
    created_at: principle.created_at || now.toISOString(),
    updated_at: principle.updated_at || now.toISOString(),
    title: principle.title.trim(),
    condition,
    action,
    reason,
    full_content: principle.full_content.trim() || buildPrincipleFullContent({ condition, action, reason }),
    task_types: normalizeTags(principle.task_types),
    context_tags: normalizeTags(principle.context_tags),
    source_trajectories: [...new Set(principle.source_trajectories)].toSorted(),
    status: normalizePrincipleStatus(principle.status),
    criticality: normalizeCriticality(principle.criticality),
    retrieval_count: Math.max(0, Math.trunc(principle.retrieval_count)),
    adoption_count: Math.max(0, Math.trunc(principle.adoption_count)),
    post_adoption_success: Math.max(0, Math.trunc(principle.post_adoption_success)),
  };
}

function indexEntryFromPrinciple(principle: Principle): IndexEntry {
  return {
    principle_id: principle.principle_id,
    title: clampText(principle.title, 80),
    trigger_tags: normalizeTags([...principle.task_types, ...principle.context_tags]),
    one_liner: clampText(principle.condition, 120),
    status: principle.status,
  };
}

function formatIndexEntry(entry: IndexEntry): string {
  return `${entry.principle_id.slice(0, 8)} | ${entry.title} | ${entry.one_liner}`;
}

function compareIndexPrinciples(left: Principle, right: Principle): number {
  return Number(right.pinned) - Number(left.pinned) ||
    criticalityRank(right.criticality) - criticalityRank(left.criticality) ||
    right.updated_at.localeCompare(left.updated_at) ||
    left.title.localeCompare(right.title);
}

function criticalityRank(value: PrincipleCriticality): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[value];
}

function normalizeTaskType(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOutcome(value: string): TrajectoryOutcome {
  return value === "success" || value === "partial" || value === "failure" ? value : "partial";
}

function normalizePrincipleStatus(value: string): PrincipleStatus {
  return value === "staging" || value === "demoted" || value === "archived" ? value : "active";
}

function normalizeCriticality(value: string): PrincipleCriticality {
  return value === "low" || value === "high" || value === "critical" ? value : "medium";
}

function parseStringArray(value: string): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function parseNumberArray(value: string): number[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function parseSteps(value: string): TrajectoryStep[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    return typeof record.action === "string" && typeof record.timestamp === "string"
      ? [{
        action: record.action,
        input: record.input,
        output: record.output,
        timestamp: record.timestamp,
      }]
      : [];
  });
}

function parseCost(value: string): TrajectoryCost {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { tokens: 0, duration_seconds: 0, retries: 0 };
  }
  const record = parsed as Record<string, unknown>;
  return {
    tokens: normalizeNumber(record.tokens),
    duration_seconds: normalizeNumber(record.duration_seconds),
    retries: normalizeNumber(record.retries),
  };
}

function parseJsonObject(value: string): JsonObject {
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as JsonObject
    : {};
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeNonnegativeInteger(value: unknown): number {
  return Math.max(0, Math.trunc(normalizeNumber(value)));
}

function normalizeNonnegativeNumber(value: unknown): number {
  return Math.max(0, normalizeNumber(value));
}

function normalizeNullableMetric(value: unknown): number | null {
  return value === null || value === undefined ? null : normalizeNonnegativeNumber(value);
}

function normalizeBatchFallbackReason(value: unknown): SekbBatchDistillationFallbackReason | null {
  return value === "provider_unavailable"
    || value === "timeout"
    || value === "invalid_json"
    || value === "schema_invalid"
    || value === "limit_exceeded"
    || value === "no_eligible_trajectories"
    ? value
    : null;
}

function isoNow(now: () => Date): string {
  return now().toISOString();
}

function clampText(value: string, maxLength: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, Math.max(0, maxLength - 3))}...`;
}

export type { DistillationSuggestion };
