import type { DatabaseSync } from "node:sqlite";
import type { Insertable, Selectable } from "kysely";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { extractEntities as extractRuntimeEntities } from "../runtime-core/memory-hybrid-retrieval.js";
import { isRuntimeTaskStatus } from "../runtime-core/types.js";
import type { DB as OpenClawStateKyselyDatabase } from "../state/openclaw-state-db.generated.js";
import type {
  BlockAdmissionContext,
  BlockEntityQuery,
  BlockQuery,
  BlockStoreApi,
  BlockStoreStats,
  BlockType,
  BlockWriteResult,
  ContextBlock,
  EntityExtractionStatus,
  HandoffPack,
  SourceSystem,
} from "./block.js";

type ContextBlockTable = OpenClawStateKyselyDatabase["context_blocks"];
type ContextBlockDatabase = Pick<
  OpenClawStateKyselyDatabase,
  "block_entity_map" | "context_blocks"
>;
type ContextBlockRow = Selectable<ContextBlockTable>;
type ContextBlockInsert = Insertable<ContextBlockTable>;

type CountRow = { count: number };
type StatusCountRow = { entity_extraction_status: string | null; count: number };

export type BlockStoreOptions = {
  now?: () => Date;
  extractEntities?: (text: string) => Iterable<string>;
};

type AdmissionDecision =
  | { accepted: true; retentionConfidence: number | null }
  | { accepted: false; reason: string };

export class BlockStore implements BlockStoreApi {
  readonly #db: DatabaseSync;
  readonly #kysely: ReturnType<typeof getNodeSqliteKysely<ContextBlockDatabase>>;
  readonly #now: () => Date;
  readonly #extractEntities: (text: string) => Iterable<string>;
  #authorizationRejections = 0;
  #admissionRejections = 0;
  readonly #admissionRejectionsBySource = new Map<SourceSystem, number>();

  constructor(db: DatabaseSync, options: BlockStoreOptions = {}) {
    this.#db = db;
    this.#kysely = getNodeSqliteKysely<ContextBlockDatabase>(db);
    this.#now = options.now ?? (() => new Date());
    this.#extractEntities = options.extractEntities ?? extractRuntimeEntities;
  }

  async upsert(
    block: ContextBlock,
    admission?: BlockAdmissionContext,
  ): Promise<BlockWriteResult> {
    const decision = evaluateAdmission(block, admission);
    if (!decision.accepted) {
      this.#recordAdmissionRejection(block.source_system);
      return { accepted: false, reason: decision.reason };
    }

    const extraction = this.#extractBlockEntities(block);
    const now = this.#now().getTime();
    const createdAt = block.created_at?.getTime() ?? now;
    const validAt = block.valid_at.getTime();
    const invalidAt = block.invalid_at?.getTime() ?? null;
    const row: ContextBlockInsert = {
      block_id: block.block_id,
      block_type: block.block_type,
      source_system: block.source_system,
      session_id: block.session_id ?? null,
      summary: block.summary,
      full_content: block.full_content ?? null,
      presence_json: JSON.stringify(block.presence),
      mutability: block.mutability,
      role_scope: block.role_scope ? JSON.stringify(block.role_scope) : null,
      entities_json: JSON.stringify(extraction.entities),
      entity_extraction_status: extraction.status,
      compression_depth: block.compression_depth,
      fallback_mode: block.fallback_mode ?? null,
      retention_confidence: decision.retentionConfidence,
      valid_at: validAt,
      invalid_at: invalidAt,
      created_at: createdAt,
    };

    runSqliteImmediateTransactionSync(this.#db, () => {
      executeSqliteQuerySync(
        this.#db,
        this.#kysely
          .insertInto("context_blocks")
          .values(row)
          .onConflict((conflict) =>
            conflict.column("block_id").doUpdateSet({
              block_type: (eb) => eb.ref("excluded.block_type"),
              source_system: (eb) => eb.ref("excluded.source_system"),
              session_id: (eb) => eb.ref("excluded.session_id"),
              summary: (eb) => eb.ref("excluded.summary"),
              full_content: (eb) => eb.ref("excluded.full_content"),
              presence_json: (eb) => eb.ref("excluded.presence_json"),
              mutability: (eb) => eb.ref("excluded.mutability"),
              role_scope: (eb) => eb.ref("excluded.role_scope"),
              entities_json: (eb) => eb.ref("excluded.entities_json"),
              entity_extraction_status: (eb) => eb.ref("excluded.entity_extraction_status"),
              compression_depth: (eb) => eb.ref("excluded.compression_depth"),
              fallback_mode: (eb) => eb.ref("excluded.fallback_mode"),
              retention_confidence: (eb) => eb.ref("excluded.retention_confidence"),
              valid_at: (eb) => eb.ref("excluded.valid_at"),
              invalid_at: (eb) => eb.ref("excluded.invalid_at"),
            }),
          ),
      );

      executeSqliteQuerySync(
        this.#db,
        this.#kysely.deleteFrom("block_entity_map").where("block_id", "=", block.block_id),
      );
      for (const entity of extraction.entities) {
        executeSqliteQuerySync(
          this.#db,
          this.#kysely
            .insertInto("block_entity_map")
            .values({ block_id: block.block_id, entity })
            .onConflict((conflict) => conflict.columns(["block_id", "entity"]).doNothing()),
        );
      }

      if ((invalidAt === null || invalidAt > now) && block.block_type === "experience") {
        this.#enforceCapacity(block.session_id, "experience", 3, now);
      }
      if ((invalidAt === null || invalidAt > now) && block.block_type === "environment") {
        this.#enforceCapacity(block.session_id, "environment", 2, now);
      }
    });

    return { accepted: true };
  }

  async query(params: BlockQuery): Promise<ContextBlock[]> {
    return this.#query(params);
  }

  async queryByEntity(params: BlockEntityQuery): Promise<ContextBlock[]> {
    const entities = normalizeEntities(params.entities);
    if (entities.length === 0) {
      return [];
    }
    return this.#query(params, entities);
  }

  async invalidate(block_id: string): Promise<void> {
    const now = this.#now().getTime();
    executeSqliteQuerySync(
      this.#db,
      this.#kysely
        .updateTable("context_blocks")
        .set({ invalid_at: now })
        .where("block_id", "=", block_id)
        .where((eb) => eb.or([eb("invalid_at", "is", null), eb("invalid_at", ">", now)])),
    );
  }

  async stats(source_system?: SourceSystem): Promise<BlockStoreStats> {
    const now = this.#now().getTime();
    let totalQuery = this.#kysely
      .selectFrom("context_blocks")
      .select(({ fn }) => fn.countAll<number>().as("count"));
    let validQuery = this.#kysely
      .selectFrom("context_blocks")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("valid_at", "<=", now)
      .where((eb) => eb.or([eb("invalid_at", "is", null), eb("invalid_at", ">", now)]));
    let statusQuery = this.#kysely
      .selectFrom("context_blocks")
      .select([
        "entity_extraction_status",
        ({ fn }) => fn.countAll<number>().as("count"),
      ])
      .groupBy("entity_extraction_status");
    if (source_system) {
      totalQuery = totalQuery.where("source_system", "=", source_system);
      validQuery = validQuery.where("source_system", "=", source_system);
      statusQuery = statusQuery.where("source_system", "=", source_system);
    }
    const totalRow = executeSqliteQueryTakeFirstSync(this.#db, totalQuery) as CountRow;
    const validRow = executeSqliteQueryTakeFirstSync(this.#db, validQuery) as CountRow;
    const statusRows = executeSqliteQuerySync(this.#db, statusQuery).rows as StatusCountRow[];
    const statusCounts: Record<EntityExtractionStatus, number> = {
      pending: 0,
      failed: 0,
      empty: 0,
      success: 0,
    };
    for (const row of statusRows) {
      if (isEntityExtractionStatus(row.entity_extraction_status)) {
        statusCounts[row.entity_extraction_status] = Number(row.count);
      }
    }

    return {
      ...(source_system ? { source_system } : {}),
      total_blocks: Number(totalRow.count),
      valid_blocks: Number(validRow.count),
      entity_extraction_status: statusCounts,
      admission_rejections: source_system
        ? (this.#admissionRejectionsBySource.get(source_system) ?? 0)
        : this.#admissionRejections,
      authorization_rejections: this.#authorizationRejections,
    };
  }

  #recordAdmissionRejection(sourceSystem: SourceSystem): void {
    this.#admissionRejections += 1;
    this.#admissionRejectionsBySource.set(
      sourceSystem,
      (this.#admissionRejectionsBySource.get(sourceSystem) ?? 0) + 1,
    );
  }

  #extractBlockEntities(block: ContextBlock): {
    entities: string[];
    status: EntityExtractionStatus;
  } {
    const entities = new Set(normalizeEntities(block.entities));
    try {
      const extracted = this.#extractEntities(
        [block.summary, block.full_content].filter(Boolean).join("\n"),
      );
      for (const entity of extracted) {
        const normalized = normalizeEntity(entity);
        if (normalized) {
          entities.add(normalized);
        }
      }
      return {
        entities: [...entities].toSorted((left, right) => left.localeCompare(right)),
        status: entities.size > 0 ? "success" : "empty",
      };
    } catch {
      return {
        entities: [...entities].toSorted((left, right) => left.localeCompare(right)),
        status: "failed",
      };
    }
  }

  #enforceCapacity(
    sessionId: string | undefined,
    blockType: "experience" | "environment",
    limit: number,
    now: number,
  ): void {
    let select = this.#kysely
      .selectFrom("context_blocks")
      .select("block_id")
      .where("block_type", "=", blockType)
      .where((eb) => eb.or([eb("invalid_at", "is", null), eb("invalid_at", ">", now)]));
    select =
      sessionId === undefined
        ? select.where("session_id", "is", null)
        : select.where("session_id", "=", sessionId);
    select =
      blockType === "experience"
        ? select
            .orderBy("retention_confidence", "asc")
            .orderBy("valid_at", "asc")
            .orderBy("block_id", "asc")
        : select.orderBy("valid_at", "asc").orderBy("block_id", "asc");
    const rows = executeSqliteQuerySync(this.#db, select).rows;
    const overflow = Math.max(0, rows.length - limit);
    for (const row of rows.slice(0, overflow)) {
      executeSqliteQuerySync(
        this.#db,
        this.#kysely
          .updateTable("context_blocks")
          .set({ invalid_at: now })
          .where("block_id", "=", row.block_id)
          .where((eb) => eb.or([eb("invalid_at", "is", null), eb("invalid_at", ">", now)])),
      );
    }
  }

  #query(params: BlockQuery, entities?: string[]): ContextBlock[] {
    const targetSessionId = params.session_id ?? params.requester_session_id;
    const validAt = params.valid_at ?? this.#now();
    if (
      targetSessionId !== params.requester_session_id &&
      !this.#canReadDirectParent(params.requester_session_id, targetSessionId, validAt)
    ) {
      this.#authorizationRejections += 1;
      return [];
    }

    const validAtMs = validAt.getTime();
    let select = this.#kysely
      .selectFrom("context_blocks as cb")
      .selectAll("cb")
      .where("cb.valid_at", "<=", validAtMs)
      .where((eb) =>
        eb.or([eb("cb.invalid_at", "is", null), eb("cb.invalid_at", ">", validAtMs)]),
      );
    select = params.include_global
      ? select.where((eb) =>
          eb.or([eb("cb.session_id", "=", targetSessionId), eb("cb.session_id", "is", null)]),
        )
      : select.where("cb.session_id", "=", targetSessionId);
    if (params.block_types?.length) {
      select = select.where("cb.block_type", "in", params.block_types);
    }
    if (params.source_systems?.length) {
      select = select.where("cb.source_system", "in", params.source_systems);
    }
    if (entities?.length) {
      select = select.where((eb) =>
        eb.exists(
          eb
            .selectFrom("block_entity_map as bem")
            .select("bem.block_id")
            .whereRef("bem.block_id", "=", "cb.block_id")
            .where("bem.entity", "in", entities),
        ),
      );
    }
    const rows = executeSqliteQuerySync(
      this.#db,
      select.orderBy("cb.valid_at", "desc").orderBy("cb.block_id", "asc"),
    ).rows as ContextBlockRow[];
    const blocks = rows.map(contextBlockFromRow).filter((block) => {
      if (!params.role_scope || !block.role_scope) {
        return matchesPresenceFilter(block, params.presence_filter);
      }
      return (
        block.role_scope.includes(params.role_scope) &&
        matchesPresenceFilter(block, params.presence_filter)
      );
    });
    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(0, Math.floor(params.limit))
        : undefined;
    return limit === undefined ? blocks : blocks.slice(0, limit);
  }

  #canReadDirectParent(
    requesterSessionId: string,
    targetSessionId: string,
    validAt: Date,
  ): boolean {
    const validAtMs = validAt.getTime();
    const rows = executeSqliteQuerySync(
      this.#db,
      this.#kysely
        .selectFrom("context_blocks")
        .select("full_content")
        .where("session_id", "=", requesterSessionId)
        .where("block_type", "=", "task_state")
        .where("valid_at", "<=", validAtMs)
        .where((eb) =>
          eb.or([eb("invalid_at", "is", null), eb("invalid_at", ">", validAtMs)]),
        )
        .orderBy("valid_at", "desc")
        .orderBy("block_id", "asc"),
    ).rows;
    return rows.some((row) => {
      const handoff = parseHandoffPack(row.full_content);
      return handoff?.parent_session_id === targetSessionId;
    });
  }
}

function evaluateAdmission(
  block: ContextBlock,
  admission?: BlockAdmissionContext,
): AdmissionDecision {
  if (!block.block_id.trim()) {
    return reject("block_id_required");
  }
  if (!Number.isFinite(block.valid_at.getTime())) {
    return reject("valid_at_invalid");
  }
  if (block.invalid_at && !Number.isFinite(block.invalid_at.getTime())) {
    return reject("invalid_at_invalid");
  }
  if (block.created_at && !Number.isFinite(block.created_at.getTime())) {
    return reject("created_at_invalid");
  }
  if (block.compression_depth !== 0 && block.compression_depth !== 1) {
    return reject("compression_depth_invalid");
  }
  if (block.block_type === "notes") {
    if (block.mutability !== "agent_writable") {
      return reject("notes_requires_agent_writable");
    }
    if (admission?.write_origin !== "context_write") {
      return reject("notes_requires_context_write");
    }
  } else if (block.mutability !== "system_managed") {
    return reject("non_notes_requires_system_managed");
  }

  if (block.block_type === "working_memory") {
    if (admission?.significance !== "high" && admission?.significance !== "medium") {
      return reject("working_memory_significance_rejected");
    }
  }

  if (block.block_type === "experience") {
    if (admission?.confirmed !== true) {
      return reject("experience_requires_confirmation");
    }
    const confidence = admission?.confidence;
    if (!isUnitInterval(confidence)) {
      return reject("experience_confidence_invalid");
    }
    return { accepted: true, retentionConfidence: confidence };
  }

  if (block.block_type === "knowledge" && block.source_system === "compass") {
    const verificationStatus = admission?.verification_status?.trim().toLowerCase();
    if (!verificationStatus || verificationStatus === "unverified") {
      return reject("compass_knowledge_unverified");
    }
    const confidence = admission?.confidence;
    if (!isUnitInterval(confidence) || confidence < 0.6) {
      return reject("compass_knowledge_confidence_low");
    }
    const audnState = admission?.audn_state?.trim().toUpperCase();
    if (!audnState || audnState === "SUPERSEDED") {
      return reject("compass_knowledge_audn_rejected");
    }
  }

  if (block.block_type === "environment") {
    if (!admission?.hint_entities?.some(looksLikeFilePath)) {
      return reject("environment_requires_file_path_hint");
    }
  }

  return { accepted: true, retentionConfidence: null };
}

function reject(reason: string): AdmissionDecision {
  return { accepted: false, reason };
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function looksLikeFilePath(value: string): boolean {
  const normalized = value.trim();
  return (
    /^[a-zA-Z]:[\\/]/.test(normalized) ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.includes("/") ||
    normalized.includes("\\")
  );
}

function normalizeEntity(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeEntities(values: Iterable<unknown>): string[] {
  const entities = new Set<string>();
  for (const value of values) {
    const normalized = normalizeEntity(value);
    if (normalized) {
      entities.add(normalized);
    }
  }
  return [...entities];
}

function contextBlockFromRow(row: ContextBlockRow): ContextBlock {
  if (!row.block_id) {
    throw new Error("context_blocks.block_id must be non-empty");
  }
  return {
    block_id: row.block_id,
    block_type: row.block_type as BlockType,
    source_system: row.source_system as SourceSystem,
    ...(row.session_id === null ? {} : { session_id: row.session_id }),
    presence: parseBlockPresence(row.presence_json),
    entities: parseStringArray(row.entities_json),
    valid_at: new Date(Number(row.valid_at)),
    ...(row.invalid_at === null ? {} : { invalid_at: new Date(Number(row.invalid_at)) }),
    created_at: new Date(Number(row.created_at)),
    ...(row.role_scope === null ? {} : { role_scope: parseStringArray(row.role_scope) }),
    mutability: row.mutability as ContextBlock["mutability"],
    summary: row.summary,
    ...(row.full_content === null ? {} : { full_content: row.full_content }),
    compression_depth: row.compression_depth as 0 | 1,
    entity_extraction_status: isEntityExtractionStatus(row.entity_extraction_status)
      ? row.entity_extraction_status
      : "pending",
    ...(row.fallback_mode === "vector_only" ? { fallback_mode: "vector_only" as const } : {}),
  };
}

function matchesPresenceFilter(
  block: ContextBlock,
  presenceFilter: BlockQuery["presence_filter"],
): boolean {
  if (presenceFilter === "always_on") {
    return block.presence.always_on;
  }
  if (presenceFilter === "on_demand") {
    return block.presence.on_demand !== undefined;
  }
  if (presenceFilter === "background") {
    return block.presence.background === true;
  }
  return true;
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseBlockPresence(value: string): ContextBlock["presence"] {
  const parsed = parseObject(value);
  const onDemand =
    parsed.on_demand &&
    typeof parsed.on_demand === "object" &&
    !Array.isArray(parsed.on_demand)
      ? parsed.on_demand as Record<string, unknown>
      : undefined;
  return {
    always_on: parsed.always_on === true,
    ...(typeof parsed.token_budget === "number" && Number.isFinite(parsed.token_budget)
      ? { token_budget: parsed.token_budget }
      : {}),
    ...(typeof parsed.priority === "number" && Number.isFinite(parsed.priority)
      ? { priority: parsed.priority }
      : {}),
    ...(onDemand &&
    typeof onDemand.expand_tool === "string" &&
    typeof onDemand.auto_register === "boolean"
      ? {
          on_demand: {
            expand_tool: onDemand.expand_tool,
            auto_register: onDemand.auto_register,
          },
        }
      : {}),
    ...(typeof parsed.background === "boolean" ? { background: parsed.background } : {}),
  };
}

function parseStringArray(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function isEntityExtractionStatus(value: unknown): value is EntityExtractionStatus {
  return value === "pending" || value === "failed" || value === "empty" || value === "success";
}

export function parseHandoffPack(value: string | null): HandoffPack | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as Partial<HandoffPack>;
    const requiredKeys = [
      "objective",
      "current_phase",
      "recent_actions",
      "parent_session_id",
    ] as const;
    const optionalKeys = new Set(["writeSet", "worktreeId", "worktreeRoot", "isolation"]);
    const allowedKeys = new Set<string>([...requiredKeys, ...optionalKeys]);
    const keys = Object.keys(parsed);
    if (
      keys.some((key) => !allowedKeys.has(key)) ||
      requiredKeys.some((key) => !keys.includes(key)) ||
      typeof parsed.objective !== "string" ||
      parsed.objective.length > 2_000 ||
      !isRuntimeTaskStatus(parsed.current_phase) ||
      !Array.isArray(parsed.recent_actions) ||
      typeof parsed.parent_session_id !== "string" ||
      !parsed.parent_session_id.trim()
    ) {
      return undefined;
    }
    const recentActions = parsed.recent_actions;
    if (
      recentActions.length > 5 ||
      !recentActions.every(
        (action) =>
          action &&
          typeof action === "object" &&
          typeof action.tool === "string" &&
          typeof action.result_summary === "string" &&
          action.result_summary.length <= 100 &&
          (action.significance === "high" || action.significance === "medium"),
      )
    ) {
      return undefined;
    }
    // C4 optional coordinates (absent = shared / no writeSet constraint)
    if (parsed.writeSet !== undefined) {
      if (
        !Array.isArray(parsed.writeSet) ||
        !parsed.writeSet.every((p) => typeof p === "string" && p.trim().length > 0 && p.length <= 512)
      ) {
        return undefined;
      }
    }
    if (parsed.worktreeId !== undefined) {
      if (typeof parsed.worktreeId !== "string" || !parsed.worktreeId.trim() || parsed.worktreeId.length > 200) {
        return undefined;
      }
    }
    if (parsed.worktreeRoot !== undefined) {
      if (typeof parsed.worktreeRoot !== "string" || !parsed.worktreeRoot.trim() || parsed.worktreeRoot.length > 1024) {
        return undefined;
      }
    }
    if (parsed.isolation !== undefined && parsed.isolation !== "shared" && parsed.isolation !== "worktree") {
      return undefined;
    }
    return parsed as HandoffPack;
  } catch {
    return undefined;
  }
}
