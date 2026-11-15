import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import type { Selectable } from "kysely";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../../infra/kysely-sync.js";
import {
  digestOwnerReadContent,
  type RawSourceLocator,
  type ReadAdmissionContextV1,
  type SourceDomain,
  type SourceRefV2,
} from "../../runtime-core/knowledge-owner-read.js";
import { cjkBigrams } from "../../runtime-core/memory-tokenization.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabase,
  type OpenClawStateDatabaseOptions,
} from "../../state/openclaw-state-db.js";
import type { DB as OpenClawStateKyselyDatabase } from "../../state/openclaw-state-db.generated.js";
import { knowledgeChunkId } from "./citation.js";
import type { KnowledgeChunkV2 } from "./contracts.js";
import type {
  ProjectionGeneration,
  ProjectionIndexJob,
  ProjectionSearchInput,
  ProjectionSearchResult,
  ProjectionSourceIntent,
  ProjectionSourceState,
} from "./projection-contracts.js";

type ProjectionDatabase = Pick<
  OpenClawStateKyselyDatabase,
  | "knowledge_index_chunks"
  | "knowledge_index_events"
  | "knowledge_index_generations"
  | "knowledge_index_jobs"
  | "knowledge_index_sources"
>;
type SourceRow = Selectable<ProjectionDatabase["knowledge_index_sources"]>;
type JobRow = Selectable<ProjectionDatabase["knowledge_index_jobs"]>;
type GenerationRow = Selectable<ProjectionDatabase["knowledge_index_generations"]>;
type ChunkRow = Selectable<ProjectionDatabase["knowledge_index_chunks"]>;

type SourceColumns = {
  source_schema: string;
  domain: string;
  authority_id: string;
  namespace_id: string;
  subject_id: string;
  source_revision: string;
  source_digest: string;
  policy_epoch: string;
  locator_coordinate_space: string | null;
  locator_start_byte: number | null;
  locator_end_byte_exclusive: number | null;
  locator_start_line: number | null;
  locator_end_line: number | null;
};

const SOURCE_DOMAINS = new Set<SourceDomain>([
  "wiki",
  "native-memory",
  "role-memory",
  "experience",
  "code",
  "task",
]);

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`projection ${field} is required`);
  }
  return value;
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`projection ${field} must be an integer >= ${minimum}`);
  }
  return Number(value);
}

function validateLocator(locator: RawSourceLocator): void {
  if (locator.coordinateSpace !== "raw-source-utf8-v1") {
    throw new Error("projection source locator coordinate space is invalid");
  }
  const startByte = integer(locator.startByte, "locator.startByte");
  const endByte = integer(locator.endByteExclusive, "locator.endByteExclusive");
  const startLine = integer(locator.startLine, "locator.startLine", 1);
  const endLine = integer(locator.endLine, "locator.endLine", 1);
  if (endByte <= startByte || endLine < startLine) {
    throw new Error("projection source locator range is invalid");
  }
}

function validateSource(source: SourceRefV2): void {
  if (!source || source.schema !== "SourceRef/v2" || !SOURCE_DOMAINS.has(source.domain)) {
    throw new Error("projection source is invalid");
  }
  for (const field of [
    "authorityId",
    "namespaceId",
    "subjectId",
    "revision",
    "sourceDigest",
    "policyEpoch",
  ] as const) {
    requiredString(source[field], `source.${field}`);
  }
  if (source.locator) {
    validateLocator(source.locator);
  }
}

function validateIntent(intent: ProjectionSourceIntent): void {
  validateSource(intent.source);
  requiredString(intent.profileDigest, "profileDigest");
  requiredString(intent.eventId, "eventId");
  integer(intent.deadlineAt, "deadlineAt");
  if (intent.reason !== undefined && typeof intent.reason !== "string") {
    throw new Error("projection reason must be a string");
  }
  if (intent.force !== undefined && typeof intent.force !== "boolean") {
    throw new Error("projection force must be boolean");
  }
}

function sourceKeyFor(source: SourceRefV2): string {
  return `source:${digestOwnerReadContent(
    JSON.stringify([
      "ProjectionSourceKey/v1",
      source.schema,
      source.domain,
      source.authorityId,
      source.namespaceId,
      source.subjectId,
    ]),
  )}`;
}

function sourceColumns(source: SourceRefV2): SourceColumns {
  return {
    source_schema: source.schema,
    domain: source.domain,
    authority_id: source.authorityId,
    namespace_id: source.namespaceId,
    subject_id: source.subjectId,
    source_revision: source.revision,
    source_digest: source.sourceDigest,
    policy_epoch: source.policyEpoch,
    locator_coordinate_space: source.locator?.coordinateSpace ?? null,
    locator_start_byte: source.locator?.startByte ?? null,
    locator_end_byte_exclusive: source.locator?.endByteExclusive ?? null,
    locator_start_line: source.locator?.startLine ?? null,
    locator_end_line: source.locator?.endLine ?? null,
  };
}

function sourceFromColumns(row: SourceColumns): SourceRefV2 {
  const source: SourceRefV2 = {
    schema: "SourceRef/v2",
    domain: row.domain as SourceDomain,
    authorityId: row.authority_id,
    namespaceId: row.namespace_id,
    subjectId: row.subject_id,
    revision: row.source_revision,
    sourceDigest: row.source_digest,
    policyEpoch: row.policy_epoch,
  };
  if (
    row.locator_coordinate_space !== null &&
    row.locator_start_byte !== null &&
    row.locator_end_byte_exclusive !== null &&
    row.locator_start_line !== null &&
    row.locator_end_line !== null
  ) {
    source.locator = {
      coordinateSpace: "raw-source-utf8-v1",
      startByte: row.locator_start_byte,
      endByteExclusive: row.locator_end_byte_exclusive,
      startLine: row.locator_start_line,
      endLine: row.locator_end_line,
    };
  }
  return source;
}

function sameLocator(left?: RawSourceLocator, right?: RawSourceLocator): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.coordinateSpace === right.coordinateSpace &&
    left.startByte === right.startByte &&
    left.endByteExclusive === right.endByteExclusive &&
    left.startLine === right.startLine &&
    left.endLine === right.endLine
  );
}

function sameSource(left: SourceRefV2, right: SourceRefV2): boolean {
  return (
    left.schema === right.schema &&
    left.domain === right.domain &&
    left.authorityId === right.authorityId &&
    left.namespaceId === right.namespaceId &&
    left.subjectId === right.subjectId &&
    left.revision === right.revision &&
    left.sourceDigest === right.sourceDigest &&
    left.policyEpoch === right.policyEpoch &&
    sameLocator(left.locator, right.locator)
  );
}

function sameSourcePin(left: SourceRefV2, right: SourceRefV2): boolean {
  return (
    left.domain === right.domain &&
    left.authorityId === right.authorityId &&
    left.namespaceId === right.namespaceId &&
    left.subjectId === right.subjectId &&
    left.revision === right.revision &&
    left.sourceDigest === right.sourceDigest &&
    left.policyEpoch === right.policyEpoch
  );
}

function sourceState(row: SourceRow): ProjectionSourceState {
  return {
    sourceKey: row.source_key,
    source: sourceFromColumns(row),
    profileDigest: row.profile_digest,
    intentSequence: row.intent_sequence,
    eligible: row.eligible === 1,
    desiredEligible: row.desired_eligible === 1,
    activeGeneration: row.active_generation_id,
    reason: row.reason,
  };
}

function jobFromRow(row: JobRow): ProjectionIndexJob {
  return {
    schema: "IndexJob/v1",
    jobId: row.job_id,
    sourceKey: row.source_key,
    source: sourceFromColumns(row),
    profileDigest: row.profile_digest,
    intentSequence: row.intent_sequence,
    state: row.state as ProjectionIndexJob["state"],
    attempt: row.attempt,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    deadlineAt: row.deadline_at,
    nextAttemptAt: row.next_attempt_at,
    error: row.error,
  };
}

function generationFromRow(row: GenerationRow): ProjectionGeneration {
  return {
    schema: "ProjectionGeneration/v1",
    generationId: row.generation_id,
    sourceKey: row.source_key,
    intentSequence: row.intent_sequence,
    state: row.state as ProjectionGeneration["state"],
    chunkCount: row.chunk_count,
  };
}

function chunkFromRow(row: ChunkRow): KnowledgeChunkV2 {
  const source: KnowledgeChunkV2["source"] = {
    ...sourceFromColumns(row),
    locator: {
      coordinateSpace: "raw-source-utf8-v1",
      startByte: row.locator_start_byte,
      endByteExclusive: row.locator_end_byte_exclusive,
      startLine: row.locator_start_line,
      endLine: row.locator_end_line,
    },
  };
  return {
    schema: "KnowledgeChunk/v2",
    chunkId: row.chunk_id,
    parentId: row.parent_id,
    sectionId: row.section_id,
    ordinal: row.ordinal,
    kind: row.kind as KnowledgeChunkV2["kind"],
    headingPath: JSON.parse(row.heading_path_json) as string[],
    source,
    quote: row.quote,
    chunkDigest: row.chunk_digest,
    retrievalText: row.retrieval_text,
    searchTokens: JSON.parse(row.search_tokens_json) as string[],
    tokenCount: row.token_count,
    chunker: {
      schema: "ChunkerProfile/v1",
      version: row.chunker_version,
      targetTokens: row.chunker_target_tokens,
      maxTokens: row.chunker_max_tokens,
      maxChars: row.chunker_max_chars,
      overlap: 0,
      tokenizerId: row.chunker_tokenizer_id,
      tokenizerDigest: row.chunker_tokenizer_digest,
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validatePublishChunks(job: ProjectionIndexJob, chunks: KnowledgeChunkV2[]): void {
  if (chunks.length === 0) {
    throw new Error("projection publish requires non-empty chunks");
  }
  const target = job.source.locator;
  if (!target) {
    throw new Error("projection job source locator is required for publication");
  }
  validateLocator(target);
  const chunkIds = new Set<string>();
  let byteCursor = target.startByte;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    if (chunk.schema !== "KnowledgeChunk/v2" || chunk.ordinal !== index) {
      throw new Error("projection chunk ordinal is not contiguous");
    }
    if (!sameSourcePin(job.source, chunk.source)) {
      throw new Error("projection chunk source pin does not match job");
    }
    const locator = chunk.source.locator;
    validateLocator(locator);
    if (locator.coordinateSpace !== target.coordinateSpace) {
      throw new Error("projection chunk source coordinate space does not match job");
    }
    if (locator.startByte !== byteCursor) {
      throw new Error("projection chunks do not cover the source without gaps");
    }
    if (Buffer.byteLength(chunk.quote, "utf8") !== locator.endByteExclusive - locator.startByte) {
      throw new Error("projection chunk quote does not match its byte locator");
    }
    const lineBreaks = (chunk.quote.slice(0, -1).match(/\n/gu) ?? []).length;
    if (locator.endLine !== locator.startLine + lineBreaks) {
      throw new Error("projection chunk quote does not match its line locator");
    }
    const next = chunks[index + 1];
    if (next && next.source.locator.startLine !== locator.endLine + 1) {
      throw new Error("projection chunks do not cover adjacent source lines");
    }
    byteCursor = locator.endByteExclusive;
    if (knowledgeChunkId(chunk.source, chunk.chunker) !== chunk.chunkId) {
      throw new Error("projection chunk identity does not match its source and profile");
    }
    if (digestOwnerReadContent(chunk.quote) !== chunk.chunkDigest) {
      throw new Error("projection chunk digest does not match quote");
    }
    if (digestOwnerReadContent(JSON.stringify(chunk.chunker)) !== job.profileDigest) {
      throw new Error("projection chunk profile does not match job");
    }
    if (chunkIds.has(chunk.chunkId)) {
      throw new Error("projection chunks contain duplicate identities");
    }
    chunkIds.add(chunk.chunkId);
  }
  const first = chunks[0]!.source.locator;
  const last = chunks.at(-1)!.source.locator;
  if (
    byteCursor !== target.endByteExclusive ||
    first.startLine !== target.startLine ||
    last.endLine !== target.endLine
  ) {
    throw new Error("projection chunks do not completely cover the job source locator");
  }
}

function validSearchContext(
  context: ReadAdmissionContextV1,
  namespaceId: string,
  now: number,
): boolean {
  if (
    context?.schema !== "ReadAdmissionContext/v1" ||
    context.purpose !== "knowledge-read" ||
    !Array.isArray(context.ownerNamespaces) ||
    context.ownerNamespaces.length > 128 ||
    !context.ownerNamespaces.includes(namespaceId)
  ) {
    return false;
  }
  const expiresAt = Date.parse(context.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function ftsMatchExpression(query: string): string {
  const normalized = query.normalize("NFKC").toLowerCase();
  const terms = new Set<string>();
  for (const match of normalized.matchAll(/[\p{L}\p{N}_]+(?:[._/:+-][\p{L}\p{N}_]+)*/gu)) {
    terms.add(match[0]);
  }
  for (const gram of cjkBigrams(normalized)) {
    terms.add(gram);
  }
  for (const run of normalized.match(/[\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu) ?? []) {
    for (let index = 0; index + 2 <= run.length; index += 1) {
      terms.add(run.slice(index, index + 2));
    }
  }
  // ponytail: cap simple quoted terms; add a parser only if retrieval quality needs it.
  return [...terms]
    .slice(0, 32)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");
}

/** Shared SQLite owner for durable source projection lifecycle and lexical publication. */
export class ProjectionStore {
  readonly #database?: OpenClawStateDatabaseOptions;
  readonly #now: () => number;
  #ftsState: "unknown" | "ready" | "unavailable" = "unknown";
  #ftsUnavailableReason: string | null = null;

  constructor(
    options: {
      database?: OpenClawStateDatabaseOptions;
      now?: () => number;
    } = {},
  ) {
    this.#database = options.database;
    this.#now = options.now ?? Date.now;
  }

  #time(): number {
    const value = this.#now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("projection clock returned an invalid timestamp");
    }
    return value;
  }

  #ensureFts(database: OpenClawStateDatabase): void {
    if (this.#ftsState === "ready") {
      return;
    }
    try {
      // ponytail: one FTS table for all namespaces; split shards only after measured contention.
      database.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_index_chunks_fts USING fts5(
          generation_id UNINDEXED,
          chunk_id UNINDEXED,
          source_key UNINDEXED,
          namespace_id UNINDEXED,
          retrieval_text,
          search_tokens
        );
      `);
      this.#ftsState = "ready";
      this.#ftsUnavailableReason = null;
    } catch (error) {
      this.#ftsState = "unavailable";
      this.#ftsUnavailableReason = errorMessage(error);
      throw error;
    }
  }

  #markFtsFailure(error: unknown): void {
    this.#ftsState = "unavailable";
    this.#ftsUnavailableReason = errorMessage(error);
  }

  observe(intent: ProjectionSourceIntent): {
    source: ProjectionSourceState;
    job?: ProjectionIndexJob;
  } {
    validateIntent(intent);
    const now = this.#time();
    const sourceKey = sourceKeyFor(intent.source);
    return runOpenClawStateWriteTransaction((database) => {
      const kysely = getNodeSqliteKysely<ProjectionDatabase>(database.db);
      const priorEvent = executeSqliteQueryTakeFirstSync(
        database.db,
        kysely
          .selectFrom("knowledge_index_events")
          .selectAll()
          .where("event_id", "=", intent.eventId),
      );
      if (priorEvent) {
        if (
          priorEvent.source_key !== sourceKey ||
          priorEvent.source_revision !== intent.source.revision ||
          priorEvent.source_digest !== intent.source.sourceDigest ||
          priorEvent.policy_epoch !== intent.source.policyEpoch ||
          priorEvent.profile_digest !== intent.profileDigest ||
          priorEvent.desired_eligible !== (intent.eligible ? 1 : 0)
        ) {
          throw new Error("projection event id is already bound to a different source intent");
        }
        const current = executeSqliteQueryTakeFirstSync(
          database.db,
          kysely
            .selectFrom("knowledge_index_sources")
            .selectAll()
            .where("source_key", "=", sourceKey),
        );
        if (!current) {
          throw new Error("projection event references a missing source");
        }
        return { source: sourceState(current) };
      }

      const existing = executeSqliteQueryTakeFirstSync(
        database.db,
        kysely
          .selectFrom("knowledge_index_sources")
          .selectAll()
          .where("source_key", "=", sourceKey),
      );
      const desiredEligible = intent.eligible ? 1 : 0;
      const reason = intent.reason ?? null;
      const sameIntent = existing
        ? sameSource(sourceFromColumns(existing), intent.source) &&
          existing.profile_digest === intent.profileDigest &&
          existing.desired_eligible === desiredEligible &&
          existing.reason === reason
        : false;

      let refresh = intent.force === true;
      let carriedAttempts = 0;
      if (existing && sameIntent && !refresh) {
        const currentJob = executeSqliteQueryTakeFirstSync(
          database.db,
          kysely
            .selectFrom("knowledge_index_jobs")
            .selectAll()
            .where("source_key", "=", sourceKey)
            .where("intent_sequence", "=", existing.intent_sequence)
            .orderBy("updated_at", "desc")
            .limit(1),
        );
        const interrupted =
          currentJob?.error === "Projection worker cancelled" ||
          currentJob?.error === "Projection worker deadline exceeded";
        const expired =
          currentJob &&
          currentJob.deadline_at <= now &&
          ((currentJob.state === "pending" && currentJob.error === null) ||
            currentJob.error === "projection deadline exceeded" ||
            currentJob.error === "projection deadline or attempt budget exhausted");
        // Execution recovery renews interrupted work after a fresh owner observation.
        // Passive scans keep completed data and failure history at the same intent.
        refresh =
          intent.refreshInterrupted === true &&
          intent.eligible &&
          existing.eligible === 0 &&
          (currentJob?.attempt ?? 3) < 3 &&
          Boolean(interrupted || expired);
        if (!refresh)
          return {
            source: sourceState(existing),
            ...(currentJob ? { job: jobFromRow(currentJob) } : {}),
          };
        carriedAttempts = currentJob?.attempt ?? 0;
      }

      // A changed owner range needs a new projection even when the full-file
      // digest and revision stay fixed; active chunks belong to the prior range.
      const sourceChanged = !existing || !sameSource(sourceFromColumns(existing), intent.source);
      const profileChanged = !existing || existing.profile_digest !== intent.profileDigest;
      const desiredChanged = !existing || existing.desired_eligible !== desiredEligible;
      const advancesIntent = sourceChanged || profileChanged || desiredChanged || refresh;
      const intentSequence = advancesIntent
        ? (existing?.intent_sequence ?? 0) + 1
        : existing!.intent_sequence;

      let nextSource: SourceRow;
      if (!existing) {
        const values = {
          source_key: sourceKey,
          ...sourceColumns(intent.source),
          profile_digest: intent.profileDigest,
          intent_sequence: intentSequence,
          eligible: 0,
          desired_eligible: desiredEligible,
          active_generation_id: null,
          reason,
          created_at: now,
          updated_at: now,
        };
        nextSource = executeSqliteQuerySync(
          database.db,
          kysely.insertInto("knowledge_index_sources").values(values).returningAll(),
        ).rows[0]!;
      } else {
        if (advancesIntent) {
          executeSqliteQuerySync(
            database.db,
            kysely
              .updateTable("knowledge_index_jobs")
              .set({
                state: "superseded",
                lease_owner: null,
                lease_expires_at: null,
                updated_at: now,
              })
              .where("source_key", "=", sourceKey)
              .where("state", "in", ["pending", "leased"]),
          );
          executeSqliteQuerySync(
            database.db,
            kysely
              .updateTable("knowledge_index_generations")
              .set({ state: "retired", retired_at: now })
              .where("source_key", "=", sourceKey)
              .where("state", "=", "active"),
          );
        }
        nextSource = executeSqliteQuerySync(
          database.db,
          kysely
            .updateTable("knowledge_index_sources")
            .set({
              ...sourceColumns(intent.source),
              profile_digest: intent.profileDigest,
              intent_sequence: intentSequence,
              eligible: advancesIntent ? 0 : existing.eligible,
              desired_eligible: desiredEligible,
              active_generation_id: advancesIntent ? null : existing.active_generation_id,
              reason,
              updated_at: now,
            })
            .where("source_key", "=", sourceKey)
            .returningAll(),
        ).rows[0]!;
      }

      let job: ProjectionIndexJob | undefined;
      if (advancesIntent && desiredEligible === 1) {
        const deadlineExceeded = intent.deadlineAt <= now;
        const jobId = randomUUID();
        const row = executeSqliteQuerySync(
          database.db,
          kysely
            .insertInto("knowledge_index_jobs")
            .values({
              job_id: jobId,
              source_key: sourceKey,
              ...sourceColumns(intent.source),
              profile_digest: intent.profileDigest,
              intent_sequence: intentSequence,
              state: deadlineExceeded ? "failed" : "pending",
              attempt: carriedAttempts,
              lease_owner: null,
              lease_expires_at: null,
              deadline_at: intent.deadlineAt,
              next_attempt_at: now,
              error: deadlineExceeded ? "projection deadline exceeded" : null,
              created_at: now,
              updated_at: now,
            })
            .returningAll(),
        ).rows[0]!;
        job = jobFromRow(row);
      }

      executeSqliteQuerySync(
        database.db,
        kysely.insertInto("knowledge_index_events").values({
          event_id: intent.eventId,
          source_key: sourceKey,
          source_revision: intent.source.revision,
          source_digest: intent.source.sourceDigest,
          policy_epoch: intent.source.policyEpoch,
          profile_digest: intent.profileDigest,
          desired_eligible: desiredEligible,
          reason,
          intent_sequence: intentSequence,
          observed_at: now,
        }),
      );
      return { source: sourceState(nextSource), ...(job ? { job } : {}) };
    }, this.#database);
  }

  sources(namespaceId: string): ProjectionSourceState[] {
    requiredString(namespaceId, "namespaceId");
    const database = openOpenClawStateDatabase(this.#database);
    const kysely = getNodeSqliteKysely<ProjectionDatabase>(database.db);
    return executeSqliteQuerySync(
      database.db,
      kysely
        .selectFrom("knowledge_index_sources")
        .selectAll()
        .where("namespace_id", "=", namespaceId)
        .orderBy("subject_id", "asc")
        .orderBy("source_key", "asc"),
    ).rows.map(sourceState);
  }

  jobs(namespaceId: string): ProjectionIndexJob[] {
    requiredString(namespaceId, "namespaceId");
    const database = openOpenClawStateDatabase(this.#database);
    const kysely = getNodeSqliteKysely<ProjectionDatabase>(database.db);
    return executeSqliteQuerySync(
      database.db,
      kysely
        .selectFrom("knowledge_index_jobs")
        .selectAll()
        .where("namespace_id", "=", namespaceId)
        .orderBy("created_at", "asc")
        .orderBy("job_id", "asc"),
    ).rows.map(jobFromRow);
  }

  generations(sourceKey: string): ProjectionGeneration[] {
    requiredString(sourceKey, "sourceKey");
    const database = openOpenClawStateDatabase(this.#database);
    const kysely = getNodeSqliteKysely<ProjectionDatabase>(database.db);
    return executeSqliteQuerySync(
      database.db,
      kysely
        .selectFrom("knowledge_index_generations")
        .selectAll()
        .where("source_key", "=", sourceKey)
        .orderBy("intent_sequence", "desc")
        .orderBy("created_at", "desc"),
    ).rows.map(generationFromRow);
  }

  recover(namespaceId: string): number {
    requiredString(namespaceId, "namespaceId");
    const now = this.#time();
    return runOpenClawStateWriteTransaction((database) => {
      const kysely = getNodeSqliteKysely<ProjectionDatabase>(database.db);
      const expiredPending = executeSqliteQuerySync(
        database.db,
        kysely
          .updateTable("knowledge_index_jobs")
          .set({
            state: "failed",
            lease_owner: null,
            lease_expires_at: null,
            error: "projection deadline exceeded",
            updated_at: now,
          })
          .where("namespace_id", "=", namespaceId)
          .where("state", "=", "pending")
          .where("deadline_at", "<=", now),
      );
      let recovered = Number(expiredPending.numAffectedRows ?? 0n);
      const expiredLeases = executeSqliteQuerySync(
        database.db,
        kysely
          .selectFrom("knowledge_index_jobs")
          .selectAll()
          .where("namespace_id", "=", namespaceId)
          .where("state", "=", "leased")
          .where("lease_expires_at", "<=", now),
      ).rows;
      for (const row of expiredLeases) {
        const exhausted = row.attempt >= 3 || row.deadline_at <= now;
        const result = executeSqliteQuerySync(
          database.db,
          kysely
            .updateTable("knowledge_index_jobs")
            .set({
              state: exhausted ? "failed" : "pending",
              lease_owner: null,
              lease_expires_at: null,
              next_attempt_at: now,
              error: exhausted ? "projection deadline or attempt budget exhausted" : null,
              updated_at: now,
            })
            .where("job_id", "=", row.job_id)
            .where("state", "=", "leased")
            .where("lease_owner", "=", row.lease_owner!),
        );
        recovered += Number(result.numAffectedRows ?? 0n);
      }
      return recovered;
    }, this.#database);
  }
  claim(input: {
    namespaceId: string;
    leaseOwner: string;
    leaseMs: number;
  }): ProjectionIndexJob | undefined {
    requiredString(input.namespaceId, "namespaceId");
    requiredString(input.leaseOwner, "leaseOwner");
    const leaseMs = integer(input.leaseMs, "leaseMs", 1);
    const now = this.#time();
    return runOpenClawStateWriteTransaction((database) => {
      const kysely = getNodeSqliteKysely<ProjectionDatabase>(database.db);
      const candidate = executeSqliteQueryTakeFirstSync(
        database.db,
        kysely
          .selectFrom("knowledge_index_jobs")
          .selectAll()
          .where("namespace_id", "=", input.namespaceId)
          .where("state", "=", "pending")
          .where("next_attempt_at", "<=", now)
          .where("deadline_at", ">", now)
          .where("attempt", "<", 3)
          .orderBy("next_attempt_at", "asc")
          .orderBy("job_id", "asc")
          .limit(1),
      );
      if (!candidate) {
        return undefined;
      }
      const claimToken = `${input.leaseOwner}:${randomUUID()}`;
      const claimed = executeSqliteQueryTakeFirstSync(
        database.db,
        kysely
          .updateTable("knowledge_index_jobs")
          .set({
            state: "leased",
            attempt: candidate.attempt + 1,
            lease_owner: claimToken,
            lease_expires_at: Math.min(candidate.deadline_at, now + leaseMs),
            error: null,
            updated_at: now,
          })
          .where("job_id", "=", candidate.job_id)
          .where("state", "=", "pending")
          .where("attempt", "=", candidate.attempt)
          .where("next_attempt_at", "<=", now)
          .where("deadline_at", ">", now)
          .returningAll(),
      );
      return claimed ? jobFromRow(claimed) : undefined;
    }, this.#database);
  }
  publish(job: ProjectionIndexJob, chunks: KnowledgeChunkV2[]): ProjectionGeneration | undefined {
    return this.#writeGeneration(job, chunks, true);
  }

  stage(job: ProjectionIndexJob, chunks: KnowledgeChunkV2[]): ProjectionGeneration | undefined {
    return this.#writeGeneration(job, chunks, false);
  }

  activate(
    job: ProjectionIndexJob,
    generationId: string,
    maxStorageBytes?: number,
  ): ProjectionGeneration | undefined {
    if (job.schema !== "IndexJob/v1" || sourceKeyFor(job.source) !== job.sourceKey)
      throw new Error("projection job identity is invalid");
    requiredString(generationId, "generationId");
    if (maxStorageBytes !== undefined) integer(maxStorageBytes, "maxStorageBytes", 1);
    return runOpenClawStateWriteTransaction(
      (database) => this.#activatePrepared(database, job, generationId, maxStorageBytes),
      this.#database,
    );
  }

  #writeGeneration(
    job: ProjectionIndexJob,
    chunks: KnowledgeChunkV2[],
    activate: boolean,
  ): ProjectionGeneration | undefined {
    if (job.schema !== "IndexJob/v1" || sourceKeyFor(job.source) !== job.sourceKey) {
      throw new Error("projection job identity is invalid");
    }
    validatePublishChunks(job, chunks);
    const database = openOpenClawStateDatabase(this.#database);
    this.#ensureFts(database);
    const values = chunks.map((chunk) => ({
      generation_id: "",
      source_key: job.sourceKey,
      chunk_id: chunk.chunkId,
      chunk_digest: chunk.chunkDigest,
      ordinal: chunk.ordinal,
      parent_id: chunk.parentId,
      section_id: chunk.sectionId,
      kind: chunk.kind,
      heading_path_json: JSON.stringify(chunk.headingPath),
      ...sourceColumns(chunk.source),
      locator_coordinate_space: chunk.source.locator.coordinateSpace,
      locator_start_byte: chunk.source.locator.startByte,
      locator_end_byte_exclusive: chunk.source.locator.endByteExclusive,
      locator_start_line: chunk.source.locator.startLine,
      locator_end_line: chunk.source.locator.endLine,
      quote: chunk.quote,
      retrieval_text: chunk.retrievalText,
      search_tokens_json: JSON.stringify(chunk.searchTokens),
      token_count: chunk.tokenCount,
      chunker_schema: chunk.chunker.schema,
      chunker_version: chunk.chunker.version,
      chunker_target_tokens: chunk.chunker.targetTokens,
      chunker_max_tokens: chunk.chunker.maxTokens,
      chunker_max_chars: chunk.chunker.maxChars,
      chunker_overlap: chunk.chunker.overlap,
      chunker_tokenizer_id: chunk.chunker.tokenizerId,
      chunker_tokenizer_digest: chunk.chunker.tokenizerDigest,
    }));

    return runOpenClawStateWriteTransaction((transactionDatabase) => {
      const kysely = getNodeSqliteKysely<ProjectionDatabase>(transactionDatabase.db);
      const now = this.#time();
      const currentJob = executeSqliteQueryTakeFirstSync(
        transactionDatabase.db,
        kysely
          .selectFrom("knowledge_index_jobs")
          .selectAll()
          .where("job_id", "=", job.jobId)
          .where("source_key", "=", job.sourceKey)
          .where("intent_sequence", "=", job.intentSequence),
      );
      if (
        !currentJob ||
        currentJob.state !== "leased" ||
        currentJob.lease_owner !== job.leaseOwner ||
        currentJob.lease_expires_at === null ||
        currentJob.lease_expires_at <= now ||
        currentJob.deadline_at <= now ||
        currentJob.profile_digest !== job.profileDigest
      ) {
        return undefined;
      }
      const currentSource = executeSqliteQueryTakeFirstSync(
        transactionDatabase.db,
        kysely
          .selectFrom("knowledge_index_sources")
          .selectAll()
          .where("source_key", "=", job.sourceKey),
      );
      if (
        !currentSource ||
        currentSource.intent_sequence !== job.intentSequence ||
        currentSource.profile_digest !== job.profileDigest ||
        currentSource.desired_eligible !== 1 ||
        !sameSource(sourceFromColumns(currentSource), job.source)
      ) {
        return undefined;
      }

      const generationId = randomUUID();
      executeSqliteQuerySync(
        transactionDatabase.db,
        kysely.insertInto("knowledge_index_generations").values({
          generation_id: generationId,
          source_key: job.sourceKey,
          intent_sequence: job.intentSequence,
          profile_digest: job.profileDigest,
          state: "building",
          chunk_count: chunks.length,
          created_at: now,
          published_at: null,
          retired_at: null,
        }),
      );
      for (let offset = 0; offset < values.length; offset += 200) {
        executeSqliteQuerySync(
          transactionDatabase.db,
          kysely.insertInto("knowledge_index_chunks").values(
            values.slice(offset, offset + 200).map((row) => ({
              ...row,
              generation_id: generationId,
            })),
          ),
        );
      }
      const insertFts = transactionDatabase.db.prepare(`
        INSERT INTO knowledge_index_chunks_fts (
          generation_id, chunk_id, source_key, namespace_id, retrieval_text, search_tokens
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const chunk of chunks) {
        insertFts.run(
          generationId,
          chunk.chunkId,
          job.sourceKey,
          chunk.source.namespaceId,
          chunk.retrievalText,
          chunk.searchTokens.join(" "),
        );
      }

      if (!activate)
        return {
          schema: "ProjectionGeneration/v1",
          generationId,
          sourceKey: job.sourceKey,
          intentSequence: job.intentSequence,
          state: "building",
          chunkCount: chunks.length,
        };
      return this.#activatePrepared(transactionDatabase, job, generationId);
    }, this.#database);
  }
  #activatePrepared(
    transactionDatabase: OpenClawStateDatabase,
    job: ProjectionIndexJob,
    generationId: string,
    maxStorageBytes?: number,
  ): ProjectionGeneration {
    const kysely = getNodeSqliteKysely<ProjectionDatabase>(transactionDatabase.db);
    const activationNow = this.#time();
    const finalJob = executeSqliteQueryTakeFirstSync(
      transactionDatabase.db,
      kysely
        .selectFrom("knowledge_index_jobs")
        .selectAll()
        .where("job_id", "=", job.jobId)
        .where("source_key", "=", job.sourceKey)
        .where("intent_sequence", "=", job.intentSequence),
    );
    const finalSource = executeSqliteQueryTakeFirstSync(
      transactionDatabase.db,
      kysely
        .selectFrom("knowledge_index_sources")
        .selectAll()
        .where("source_key", "=", job.sourceKey),
    );
    if (
      !finalJob ||
      finalJob.state !== "leased" ||
      finalJob.lease_owner !== job.leaseOwner ||
      finalJob.lease_expires_at === null ||
      finalJob.lease_expires_at <= activationNow ||
      finalJob.deadline_at <= activationNow ||
      finalJob.profile_digest !== job.profileDigest ||
      !finalSource ||
      finalSource.intent_sequence !== job.intentSequence ||
      finalSource.profile_digest !== job.profileDigest ||
      finalSource.desired_eligible !== 1 ||
      !sameSource(sourceFromColumns(finalSource), job.source)
    ) {
      throw new Error("projection publication lost its lease, deadline, or source fence");
    }
    executeSqliteQuerySync(
      transactionDatabase.db,
      kysely
        .updateTable("knowledge_index_generations")
        .set({ state: "retired", retired_at: activationNow })
        .where("source_key", "=", job.sourceKey)
        .where("state", "=", "active"),
    );
    const activated = executeSqliteQuerySync(
      transactionDatabase.db,
      kysely
        .updateTable("knowledge_index_generations")
        .set({ state: "active", published_at: activationNow })
        .where("generation_id", "=", generationId)
        .where("source_key", "=", job.sourceKey)
        .where("intent_sequence", "=", job.intentSequence)
        .where("profile_digest", "=", job.profileDigest)
        .where("state", "=", "building")
        .returningAll(),
    ).rows[0];
    if (!activated) {
      throw new Error("projection generation activation CAS failed");
    }
    const sourceUpdate = executeSqliteQuerySync(
      transactionDatabase.db,
      kysely
        .updateTable("knowledge_index_sources")
        .set({ eligible: 1, active_generation_id: generationId, updated_at: activationNow })
        .where("source_key", "=", job.sourceKey)
        .where("intent_sequence", "=", job.intentSequence)
        .where("profile_digest", "=", job.profileDigest)
        .where("desired_eligible", "=", 1),
    );
    const jobUpdate = executeSqliteQuerySync(
      transactionDatabase.db,
      kysely
        .updateTable("knowledge_index_jobs")
        .set({
          state: "complete",
          lease_owner: null,
          lease_expires_at: null,
          error: null,
          updated_at: activationNow,
        })
        .where("job_id", "=", job.jobId)
        .where("state", "=", "leased")
        .where("lease_owner", "=", job.leaseOwner),
    );
    if (
      Number(sourceUpdate.numAffectedRows ?? 0n) !== 1 ||
      Number(jobUpdate.numAffectedRows ?? 0n) !== 1
    ) {
      throw new Error("projection activation fence changed during publication");
    }
    if (maxStorageBytes !== undefined)
      this.#assertStorageBudget(transactionDatabase, maxStorageBytes);
    return generationFromRow(activated);
  }

  #assertStorageBudget(database: OpenClawStateDatabase, maximum: number): void {
    const fileSize = (file: string) => {
      try {
        return statSync(file).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
        throw error;
      }
    };
    const dbBytes = fileSize(database.path);
    const bytes = dbBytes + fileSize(database.path + "-wal") + fileSize(database.path + "-shm");
    const pageSize = Number(database.db.prepare("PRAGMA page_size").get()?.page_size);
    const logicalBytes =
      Number(database.db.prepare("PRAGMA page_count").get()?.page_count) * pageSize;
    // Chunk/FTS staging has committed before the owner grants activation. Reserve
    // every page of the metadata tables and indexes touched by this transaction;
    // WAL commit/checkpoint and SHM growth must also fit before visibility changes.
    const metadataBytes = Number(
      database.db
        .prepare(`
      SELECT COALESCE(sum(pgsize), 0) AS bytes FROM dbstat
      WHERE name IN (SELECT name FROM sqlite_schema WHERE tbl_name IN (
        'knowledge_index_sources', 'knowledge_index_generations', 'knowledge_index_jobs'
      ))
    `)
        .get()?.bytes,
    );
    const reserve =
      metadataBytes + Math.ceil(metadataBytes / pageSize) * 24 + pageSize * 2 + 32768 + 32;
    if (
      ![bytes, pageSize, logicalBytes, metadataBytes, reserve].every(Number.isSafeInteger) ||
      pageSize <= 0
    )
      throw new Error("index-storage-budget-accounting-unavailable");
    if (bytes + Math.max(0, logicalBytes - dbBytes) + reserve > maximum)
      throw new Error("index-storage-budget-exceeded");
  }

  fail(job: ProjectionIndexJob, reason: string, retryDelayMs: number): void {
    if (typeof reason !== "string") {
      throw new Error("projection failure reason must be a string");
    }
    const delay = Math.max(0, Number.isFinite(retryDelayMs) ? Math.floor(retryDelayMs) : 0);
    const now = this.#time();
    runOpenClawStateWriteTransaction((database) => {
      const kysely = getNodeSqliteKysely<ProjectionDatabase>(database.db);
      const current = executeSqliteQueryTakeFirstSync(
        database.db,
        kysely
          .selectFrom("knowledge_index_jobs")
          .selectAll()
          .where("job_id", "=", job.jobId)
          .where("source_key", "=", job.sourceKey)
          .where("intent_sequence", "=", job.intentSequence)
          .where("state", "=", "leased")
          .where("lease_owner", "=", job.leaseOwner),
      );
      if (!current) {
        return;
      }
      const nextAttemptAt = Math.min(current.deadline_at, now + delay);
      // Pausing releases this claim; earlier genuine failures remain spent.
      const attempt =
        reason === "Projection worker cancelled"
          ? Math.max(0, current.attempt - 1)
          : current.attempt;
      const exhausted =
        attempt >= 3 || current.deadline_at <= now || nextAttemptAt >= current.deadline_at;
      executeSqliteQuerySync(
        database.db,
        kysely
          .updateTable("knowledge_index_jobs")
          .set({
            state: exhausted ? "failed" : "pending",
            attempt,
            lease_owner: null,
            lease_expires_at: null,
            next_attempt_at: nextAttemptAt,
            error: reason,
            updated_at: now,
          })
          .where("job_id", "=", current.job_id)
          .where("state", "=", "leased")
          .where("lease_owner", "=", current.lease_owner!),
      );
    }, this.#database);
  }

  search(input: ProjectionSearchInput): ProjectionSearchResult {
    const namespaceId = requiredString(input.namespaceId, "namespaceId");
    if (namespaceId.length > 256) throw new Error("projection namespaceId exceeds 256 characters");
    const limit = integer(input.limit, "limit", 1);
    if (limit > 100) throw new Error("projection search limit exceeds 100");
    if (typeof input.query !== "string")
      throw new Error("projection search query must be a string");
    if ([...input.query].length > 4_000)
      throw new Error("projection search query exceeds 4000 characters");
    const now = this.#time();
    if (!validSearchContext(input.context, namespaceId, now)) {
      return { status: "unavailable", reason: "admission-context-rejected", candidates: [] };
    }
    if (!input.query.trim()) return { status: "available", candidates: [] };
    const expression = ftsMatchExpression(input.query);
    if (!expression) return { status: "available", candidates: [] };

    try {
      const database = openOpenClawStateDatabase(this.#database);
      this.#ensureFts(database);
      const kysely = getNodeSqliteKysely<ProjectionDatabase>(database.db);
      const expected = executeSqliteQueryTakeFirstSync(
        database.db,
        kysely
          .selectFrom("knowledge_index_generations as g")
          .innerJoin("knowledge_index_sources as s", "s.active_generation_id", "g.generation_id")
          .select((eb) => eb.fn.sum<number>("g.chunk_count").as("count"))
          .where("s.namespace_id", "=", namespaceId)
          .where("s.eligible", "=", 1)
          .where("g.state", "=", "active"),
      );
      // A recreated FTS table must remain unavailable until its active
      // generation coverage has been restored by an explicit rebuild.
      const indexed = database.db
        .prepare(`SELECT count(*) AS count FROM knowledge_index_chunks_fts AS f
        JOIN knowledge_index_sources AS s ON s.source_key = f.source_key
        WHERE s.namespace_id = ? AND f.namespace_id = ? AND s.eligible = 1
          AND s.active_generation_id = f.generation_id`)
        .get(namespaceId, namespaceId) as { count: number };
      if (Number(expected?.count ?? 0) !== indexed.count)
        throw new Error("active-generation-fts-coverage-mismatch; rebuild required");
      const rows = database.db
        .prepare(`
        SELECT
          knowledge_index_chunks_fts.chunk_id AS chunk_id,
          knowledge_index_chunks_fts.generation_id AS generation_id,
          bm25(knowledge_index_chunks_fts) AS lexical_rank
        FROM knowledge_index_chunks_fts
        JOIN knowledge_index_sources AS sources
          ON sources.source_key = knowledge_index_chunks_fts.source_key
        JOIN knowledge_index_generations AS generations
          ON generations.generation_id = knowledge_index_chunks_fts.generation_id
        WHERE knowledge_index_chunks_fts MATCH ?
          AND knowledge_index_chunks_fts.namespace_id = ?
          AND sources.namespace_id = ?
          AND sources.eligible = 1
          AND sources.active_generation_id = knowledge_index_chunks_fts.generation_id
          AND generations.source_key = sources.source_key
          AND generations.state = 'active'
        ORDER BY lexical_rank ASC, knowledge_index_chunks_fts.chunk_id ASC
        LIMIT ?
      `)
        .all(expression, namespaceId, namespaceId, limit) as Array<{
        chunk_id: string;
        generation_id: string;
        lexical_rank: number;
      }>;
      const candidates: ProjectionSearchResult["candidates"] = [];
      for (const row of rows) {
        const chunkRow = executeSqliteQueryTakeFirstSync(
          database.db,
          kysely
            .selectFrom("knowledge_index_chunks")
            .selectAll()
            .where("generation_id", "=", row.generation_id)
            .where("chunk_id", "=", row.chunk_id),
        );
        if (!chunkRow) throw new Error("projection FTS references a missing chunk");
        candidates.push({
          generationId: row.generation_id,
          chunk: chunkFromRow(chunkRow),
          lexicalRank: row.lexical_rank,
        });
      }
      return { status: "available", candidates };
    } catch (error) {
      this.#markFtsFailure(error);
      return {
        status: "unavailable",
        reason: this.#ftsUnavailableReason ?? "fts-unavailable",
        candidates: [],
      };
    }
  }
  currentChunks(
    namespaceId: string,
    offset = 0,
    limit = 512,
  ): Array<{ generationId: string; chunk: KnowledgeChunkV2 }> {
    requiredString(namespaceId, "namespaceId");
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 512
    )
      throw new Error("Invalid projection chunk page");
    const database = openOpenClawStateDatabase(this.#database),
      sql = getNodeSqliteKysely<ProjectionDatabase>(database.db);
    return executeSqliteQuerySync(
      database.db,
      sql
        .selectFrom("knowledge_index_chunks as c")
        .innerJoin("knowledge_index_sources as s", "s.source_key", "c.source_key")
        .selectAll("c")
        .where("s.namespace_id", "=", namespaceId)
        .where("s.eligible", "=", 1)
        .whereRef("s.active_generation_id", "=", "c.generation_id")
        .orderBy("c.chunk_id")
        .offset(offset)
        .limit(limit),
    ).rows.map((row) => ({ generationId: row.generation_id, chunk: chunkFromRow(row) }));
  }

  cleanup(sourceKey: string): number {
    requiredString(sourceKey, "sourceKey");
    const database = openOpenClawStateDatabase(this.#database);
    let ftsAvailable = true;
    try {
      this.#ensureFts(database);
    } catch {
      ftsAvailable = false;
    }
    return runOpenClawStateWriteTransaction((transactionDatabase) => {
      const kysely = getNodeSqliteKysely<ProjectionDatabase>(transactionDatabase.db);
      const source = executeSqliteQueryTakeFirstSync(
        transactionDatabase.db,
        kysely
          .selectFrom("knowledge_index_sources")
          .select("active_generation_id")
          .where("source_key", "=", sourceKey),
      );
      const keep = source?.active_generation_id ?? null;
      const generations = executeSqliteQuerySync(
        transactionDatabase.db,
        kysely
          .selectFrom("knowledge_index_generations")
          .select("generation_id")
          .where("source_key", "=", sourceKey),
      )
        .rows.map((row) => row.generation_id)
        .filter((id) => id !== keep);
      if (generations.length === 0) {
        return 0;
      }
      if (ftsAvailable) {
        try {
          if (keep) {
            transactionDatabase.db
              .prepare(
                "DELETE FROM knowledge_index_chunks_fts WHERE source_key = ? AND generation_id <> ?",
              )
              .run(sourceKey, keep);
          } else {
            transactionDatabase.db
              .prepare("DELETE FROM knowledge_index_chunks_fts WHERE source_key = ?")
              .run(sourceKey);
          }
        } catch (error) {
          this.#markFtsFailure(error);
        }
      }
      const chunkDeletes = executeSqliteQuerySync(
        transactionDatabase.db,
        kysely.deleteFrom("knowledge_index_chunks").where("generation_id", "in", generations),
      );
      executeSqliteQuerySync(
        transactionDatabase.db,
        kysely.deleteFrom("knowledge_index_generations").where("generation_id", "in", generations),
      );
      return Number(chunkDeletes.numAffectedRows ?? 0n);
    }, this.#database);
  }
}
