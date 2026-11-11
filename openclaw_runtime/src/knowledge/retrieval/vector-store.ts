import { randomUUID } from "node:crypto";
import type { Selectable } from "kysely";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../../infra/kysely-sync.js";
import { isSourceRefV2 } from "../../runtime-core/knowledge-owner-read.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from "../../state/openclaw-state-db.js";
import type { DB } from "../../state/openclaw-state-db.generated.js";
import { validateEmbeddingVector, type EmbeddingSpaceV1 } from "./embedding-space.js";
import type {
  VectorBackendId,
  VectorGenerationV1,
  VectorHit,
  VectorProjectionV1,
  VectorSearchV1,
} from "./vector-contracts.js";

type Tables = Pick<
  DB,
  | "knowledge_vector_namespaces"
  | "knowledge_vector_generations"
  | "knowledge_vector_rows"
  | "knowledge_index_sources"
  | "knowledge_index_generations"
  | "knowledge_index_chunks"
>;
type GenerationRow = Selectable<Tables["knowledge_vector_generations"]>;

function generation(row: GenerationRow): VectorGenerationV1 {
  return {
    schema: "VectorGeneration/v1",
    generationId: row.generation_id,
    namespaceId: row.namespace_id,
    workspaceId: row.workspace_id,
    spaceId: row.space_id,
    backend: row.backend as VectorBackendId,
    intentSequence: row.intent_sequence,
    state: row.state as VectorGenerationV1["state"],
    rowCount: row.row_count,
  };
}

function required(value: string) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512)
    throw new Error("Invalid vector projection identifier");
  return value;
}

export function validateVectorRow(
  row: VectorProjectionV1,
  target: VectorGenerationV1,
  space: EmbeddingSpaceV1,
): number[] {
  if (
    row.schema !== "VectorProjection/v1" ||
    !isSourceRefV2(row.source) ||
    !row.source.locator ||
    row.namespaceId !== target.namespaceId ||
    row.source.namespaceId !== target.namespaceId ||
    row.generationId !== target.generationId ||
    row.workspaceId !== target.workspaceId ||
    row.spaceId !== target.spaceId ||
    space.spaceId !== target.spaceId ||
    !/^sha256:[a-f0-9]{64}$/.test(row.chunkDigest)
  )
    throw new Error("Vector row scope or generation mismatch");
  [row.id, row.chunkId, row.sourceGeneration].forEach(required);
  return validateEmbeddingVector(space, row.vector);
}

/** Shared SQLite is the single activation authority for both portable and native backends. */
export class VectorStore {
  private searchCache?: {
    key: string;
    revision: number;
    rows: Array<{ id: string; values: Float32Array; magnitude: number }>;
  };

  constructor(readonly database?: OpenClawStateDatabaseOptions) {}

  begin(
    namespaceId: string,
    workspaceId: string,
    space: EmbeddingSpaceV1,
    backend: VectorBackendId,
  ): VectorGenerationV1 {
    [namespaceId, workspaceId, space.spaceId].forEach(required);
    if (!["sqlite-flat", "lancedb-ann"].includes(backend))
      throw new Error("Invalid vector backend");
    return runOpenClawStateWriteTransaction((db) => {
      const sql = getNodeSqliteKysely<Tables>(db.db);
      const previous = executeSqliteQueryTakeFirstSync(
        db.db,
        sql
          .selectFrom("knowledge_vector_namespaces")
          .selectAll()
          .where("namespace_id", "=", namespaceId),
      );
      const sequence = (previous?.intent_sequence ?? 0) + 1;
      const now = Date.now();
      executeSqliteQuerySync(
        db.db,
        sql
          .insertInto("knowledge_vector_namespaces")
          .values({
            namespace_id: namespaceId,
            workspace_id: workspaceId,
            intent_sequence: sequence,
            desired_backend: backend,
            desired_space_id: space.spaceId,
            active_generation_id: previous?.active_generation_id ?? null,
            updated_at: now,
          })
          .onConflict((oc) =>
            oc.column("namespace_id").doUpdateSet({
              workspace_id: workspaceId,
              intent_sequence: sequence,
              desired_backend: backend,
              desired_space_id: space.spaceId,
              updated_at: now,
            }),
          ),
      );
      executeSqliteQuerySync(
        db.db,
        sql
          .updateTable("knowledge_vector_generations")
          .set({ state: "failed" })
          .where("namespace_id", "=", namespaceId)
          .where("state", "=", "building"),
      );
      const row: GenerationRow = {
        generation_id: randomUUID(),
        namespace_id: namespaceId,
        workspace_id: workspaceId,
        space_id: space.spaceId,
        backend,
        intent_sequence: sequence,
        state: "building",
        row_count: 0,
        vector_revision: 0,
        created_at: now,
      };
      executeSqliteQuerySync(db.db, sql.insertInto("knowledge_vector_generations").values(row));
      return generation(row);
    }, this.database);
  }

  active(
    namespaceId: string,
    workspaceId: string,
    spaceId: string,
  ): VectorGenerationV1 | undefined {
    const db = openOpenClawStateDatabase(this.database),
      sql = getNodeSqliteKysely<Tables>(db.db);
    const row = executeSqliteQueryTakeFirstSync(
      db.db,
      sql
        .selectFrom("knowledge_vector_generations as g")
        .innerJoin("knowledge_vector_namespaces as n", "n.active_generation_id", "g.generation_id")
        .selectAll("g")
        .where("n.namespace_id", "=", namespaceId)
        .where("n.workspace_id", "=", workspaceId)
        .where("g.workspace_id", "=", workspaceId)
        .where("g.namespace_id", "=", namespaceId)
        .where("n.desired_space_id", "=", spaceId)
        .where("g.space_id", "=", spaceId)
        .where("g.state", "=", "active"),
    );
    return row ? generation(row) : undefined;
  }

  generations(namespaceId: string): VectorGenerationV1[] {
    const db = openOpenClawStateDatabase(this.database),
      sql = getNodeSqliteKysely<Tables>(db.db);
    return executeSqliteQuerySync(
      db.db,
      sql
        .selectFrom("knowledge_vector_generations")
        .selectAll()
        .where("namespace_id", "=", namespaceId)
        .orderBy("created_at"),
    ).rows.map(generation);
  }

  publish(target: VectorGenerationV1, expectedRows: number): boolean {
    if (!Number.isSafeInteger(expectedRows) || expectedRows < 0)
      throw new Error("Invalid expected vector count");
    return runOpenClawStateWriteTransaction((db) => {
      const sql = getNodeSqliteKysely<Tables>(db.db);
      const row = executeSqliteQueryTakeFirstSync(
        db.db,
        sql
          .selectFrom("knowledge_vector_generations")
          .selectAll()
          .where("generation_id", "=", target.generationId),
      );
      const owner = executeSqliteQueryTakeFirstSync(
        db.db,
        sql
          .selectFrom("knowledge_vector_namespaces")
          .selectAll()
          .where("namespace_id", "=", target.namespaceId),
      );
      if (
        !row ||
        !owner ||
        row.state !== "building" ||
        row.row_count !== expectedRows ||
        row.namespace_id !== target.namespaceId ||
        row.backend !== target.backend ||
        owner.intent_sequence !== target.intentSequence ||
        row.intent_sequence !== target.intentSequence ||
        row.workspace_id !== target.workspaceId ||
        owner.workspace_id !== target.workspaceId ||
        row.space_id !== target.spaceId ||
        owner.desired_space_id !== target.spaceId ||
        owner.desired_backend !== target.backend
      )
        return false;
      executeSqliteQuerySync(
        db.db,
        sql
          .updateTable("knowledge_vector_generations")
          .set({ state: "retired" })
          .where("namespace_id", "=", target.namespaceId)
          .where("state", "=", "active"),
      );
      executeSqliteQuerySync(
        db.db,
        sql
          .updateTable("knowledge_vector_generations")
          .set({ state: "active" })
          .where("generation_id", "=", target.generationId),
      );
      executeSqliteQuerySync(
        db.db,
        sql
          .updateTable("knowledge_vector_namespaces")
          .set({ active_generation_id: target.generationId, updated_at: Date.now() })
          .where("namespace_id", "=", target.namespaceId),
      );
      return true;
    }, this.database);
  }

  write(target: VectorGenerationV1, space: EmbeddingSpaceV1, rows: VectorProjectionV1[]) {
    if (rows.length > 512) throw new Error("Vector write batch exceeds 512 rows");
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new Error("Duplicate vector row identities");
    const normalized = rows.map((row) => ({ row, vector: validateVectorRow(row, target, space) }));
    runOpenClawStateWriteTransaction((db) => {
      const sql = getNodeSqliteKysely<Tables>(db.db);
      const current = executeSqliteQueryTakeFirstSync(
        db.db,
        sql
          .selectFrom("knowledge_vector_generations")
          .selectAll()
          .where("generation_id", "=", target.generationId),
      );
      if (
        !current ||
        !["building", "active"].includes(current.state) ||
        current.space_id !== space.spaceId ||
        current.workspace_id !== target.workspaceId ||
        current.namespace_id !== target.namespaceId ||
        current.backend !== target.backend
      )
        throw new Error("Vector generation is not writable");
      for (const { row, vector } of normalized) {
        const bytes = Buffer.allocUnsafe(vector.length * 4);
        vector.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
        const existing = executeSqliteQueryTakeFirstSync(
          db.db,
          sql
            .selectFrom("knowledge_vector_rows")
            .selectAll()
            .where("generation_id", "=", target.generationId)
            .where("id", "=", row.id),
        );
        if (
          existing &&
          (existing.chunk_id !== row.chunkId ||
            existing.chunk_digest !== row.chunkDigest ||
            existing.source_generation !== row.sourceGeneration ||
            existing.source_ref_json !== JSON.stringify(row.source) ||
            !Buffer.from(existing.vector).equals(bytes))
        ) {
          throw new Error("Vector row identity is already bound to different content");
        }
        executeSqliteQuerySync(
          db.db,
          sql
            .insertInto("knowledge_vector_rows")
            .values({
              id: row.id,
              generation_id: row.generationId,
              namespace_id: row.namespaceId,
              workspace_id: row.workspaceId,
              space_id: row.spaceId,
              chunk_id: row.chunkId,
              chunk_digest: row.chunkDigest,
              source_generation: row.sourceGeneration,
              source_ref_json: JSON.stringify(row.source),
              dimensions: vector.length,
              vector: bytes,
            })
            .onConflict((oc) => oc.columns(["generation_id", "id"]).doNothing()),
        );
      }
      const count = executeSqliteQueryTakeFirstSync(
        db.db,
        sql
          .selectFrom("knowledge_vector_rows")
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .where("generation_id", "=", target.generationId),
      );
      executeSqliteQuerySync(
        db.db,
        sql
          .updateTable("knowledge_vector_generations")
          .set({
            row_count: Number(count?.count ?? 0),
            vector_revision: current.vector_revision + 1,
          })
          .where("generation_id", "=", target.generationId),
      );
    }, this.database);
  }

  rows(target: VectorGenerationV1, offset = 0, limit = 512) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 512
    )
      throw new Error("Invalid vector page");
    const db = openOpenClawStateDatabase(this.database),
      sql = getNodeSqliteKysely<Tables>(db.db);
    return executeSqliteQuerySync(
      db.db,
      sql
        .selectFrom("knowledge_vector_rows")
        .selectAll()
        .where("generation_id", "=", target.generationId)
        .where("namespace_id", "=", target.namespaceId)
        .where("workspace_id", "=", target.workspaceId)
        .where("space_id", "=", target.spaceId)
        .orderBy("id")
        .offset(offset)
        .limit(limit),
    ).rows;
  }

  ids(target: VectorGenerationV1): string[] {
    const db = openOpenClawStateDatabase(this.database),
      sql = getNodeSqliteKysely<Tables>(db.db);
    return executeSqliteQuerySync(
      db.db,
      sql
        .selectFrom("knowledge_vector_rows")
        .select("id")
        .where("generation_id", "=", target.generationId)
        .where("namespace_id", "=", target.namespaceId)
        .where("workspace_id", "=", target.workspaceId)
        .where("space_id", "=", target.spaceId),
    ).rows.map((row) => row.id);
  }

  /** Filter against the current chunk/source projection before either backend scores vectors. */
  eligibleIds(target: VectorGenerationV1): string[] {
    const db = openOpenClawStateDatabase(this.database),
      sql = getNodeSqliteKysely<Tables>(db.db);
    return executeSqliteQuerySync(
      db.db,
      sql
        .selectFrom("knowledge_vector_rows as v")
        .innerJoin("knowledge_index_chunks as c", (join) =>
          join
            .onRef("c.chunk_id", "=", "v.chunk_id")
            .onRef("c.generation_id", "=", "v.source_generation")
            .onRef("c.chunk_digest", "=", "v.chunk_digest"),
        )
        .innerJoin("knowledge_index_sources as s", "s.source_key", "c.source_key")
        .select("v.id")
        .where("v.generation_id", "=", target.generationId)
        .where("v.namespace_id", "=", target.namespaceId)
        .where("v.workspace_id", "=", target.workspaceId)
        .where("v.space_id", "=", target.spaceId)
        .where("s.eligible", "=", 1)
        .whereRef("s.active_generation_id", "=", "c.generation_id"),
    ).rows.map((row) => row.id);
  }

  lookup(target: VectorGenerationV1, ids: string[]): VectorProjectionV1[] {
    if (ids.length > 100) throw new Error("Vector lookup exceeds100 rows");
    if (!ids.length) return [];
    const db = openOpenClawStateDatabase(this.database),
      sql = getNodeSqliteKysely<Tables>(db.db);
    return executeSqliteQuerySync(
      db.db,
      sql
        .selectFrom("knowledge_vector_rows")
        .selectAll()
        .where("generation_id", "=", target.generationId)
        .where("namespace_id", "=", target.namespaceId)
        .where("workspace_id", "=", target.workspaceId)
        .where("space_id", "=", target.spaceId)
        .where("id", "in", ids),
    ).rows.map((row) => ({
      schema: "VectorProjection/v1",
      id: row.id,
      generationId: row.generation_id,
      namespaceId: row.namespace_id,
      workspaceId: row.workspace_id,
      spaceId: row.space_id,
      chunkId: row.chunk_id,
      chunkDigest: row.chunk_digest,
      sourceGeneration: row.source_generation,
      source: JSON.parse(row.source_ref_json),
      vector: [],
    }));
  }

  recover(namespaceId: string) {
    const db = openOpenClawStateDatabase(this.database),
      sql = getNodeSqliteKysely<Tables>(db.db);
    executeSqliteQuerySync(
      db.db,
      sql
        .updateTable("knowledge_vector_generations")
        .set({ state: "failed" })
        .where("namespace_id", "=", namespaceId)
        .where("state", "=", "building"),
    );
  }

  deleteRows(target: VectorGenerationV1, ids: string[]) {
    if (ids.length > 512) throw new Error("Vector deletion batch exceeds512 rows");
    if (!ids.length) return;
    runOpenClawStateWriteTransaction((db) => {
      const sql = getNodeSqliteKysely<Tables>(db.db);
      executeSqliteQuerySync(
        db.db,
        sql
          .deleteFrom("knowledge_vector_rows")
          .where("generation_id", "=", target.generationId)
          .where("namespace_id", "=", target.namespaceId)
          .where("workspace_id", "=", target.workspaceId)
          .where("id", "in", ids),
      );
      const count = executeSqliteQueryTakeFirstSync(
        db.db,
        sql
          .selectFrom("knowledge_vector_rows")
          .select((eb) => eb.fn.countAll<number>().as("count"))
          .where("generation_id", "=", target.generationId),
      );
      executeSqliteQuerySync(
        db.db,
        sql
          .updateTable("knowledge_vector_generations")
          .set((eb) => ({
            row_count: Number(count?.count ?? 0),
            vector_revision: eb("vector_revision", "+", 1),
          }))
          .where("generation_id", "=", target.generationId),
      );
    }, this.database);
  }

  fail(target: VectorGenerationV1) {
    const db = openOpenClawStateDatabase(this.database),
      sql = getNodeSqliteKysely<Tables>(db.db);
    executeSqliteQuerySync(
      db.db,
      sql
        .updateTable("knowledge_vector_generations")
        .set({ state: "failed" })
        .where("generation_id", "=", target.generationId)
        .where("state", "in", ["building", "active"]),
    );
  }

  remove(target: VectorGenerationV1) {
    runOpenClawStateWriteTransaction((db) => {
      const sql = getNodeSqliteKysely<Tables>(db.db);
      const owner = executeSqliteQueryTakeFirstSync(
        db.db,
        sql
          .selectFrom("knowledge_vector_namespaces")
          .select("active_generation_id")
          .where("namespace_id", "=", target.namespaceId),
      );
      const current = executeSqliteQueryTakeFirstSync(
        db.db,
        sql
          .selectFrom("knowledge_vector_generations")
          .selectAll()
          .where("generation_id", "=", target.generationId),
      );
      if (
        current &&
        (current.namespace_id !== target.namespaceId ||
          current.workspace_id !== target.workspaceId ||
          current.space_id !== target.spaceId)
      )
        throw new Error("Vector removal scope mismatch");
      if (owner?.active_generation_id === target.generationId)
        throw new Error("Cannot remove an active vector generation");
      executeSqliteQuerySync(
        db.db,
        sql.deleteFrom("knowledge_vector_rows").where("generation_id", "=", target.generationId),
      );
      executeSqliteQuerySync(
        db.db,
        sql
          .deleteFrom("knowledge_vector_generations")
          .where("generation_id", "=", target.generationId),
      );
    }, this.database);
  }

  exactSearch(query: VectorSearchV1): VectorHit[] {
    const vector = validateEmbeddingVector(query.space, query.vector);
    const queryMagnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      query.eligibleIds.length > 100_000
    )
      throw new Error("Invalid vector query limits");
    query.signal?.throwIfAborted();
    if (!query.eligibleIds.length) return [];
    const db = openOpenClawStateDatabase(this.database),
      sql = getNodeSqliteKysely<Tables>(db.db);
    const current = executeSqliteQueryTakeFirstSync(
      db.db,
      sql
        .selectFrom("knowledge_vector_generations")
        .select("vector_revision")
        .where("generation_id", "=", query.generationId)
        .where("namespace_id", "=", query.namespaceId)
        .where("workspace_id", "=", query.workspaceId)
        .where("space_id", "=", query.space.spaceId),
    );
    if (!current) return [];
    const key = JSON.stringify([
      query.generationId,
      query.namespaceId,
      query.workspaceId,
      query.space.spaceId,
      vector.length,
    ]);
    // Vector mutations advance this revision in the same SQLite transaction.
    // Cache only vector bytes/norms; every query supplies fresh owner eligibility.
    if (this.searchCache?.key !== key || this.searchCache.revision !== current.vector_revision) {
      const rows = executeSqliteQuerySync(
        db.db,
        sql
          .selectFrom("knowledge_vector_rows")
          .select(["id", "dimensions", "vector"])
          .where("generation_id", "=", query.generationId)
          .where("namespace_id", "=", query.namespaceId)
          .where("workspace_id", "=", query.workspaceId)
          .where("space_id", "=", query.space.spaceId),
      ).rows.map((row) => {
        if (row.dimensions !== vector.length || row.vector.byteLength !== vector.length * 4)
          throw new Error("Portable vector space is corrupt");
        const bytes = Buffer.from(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength);
        const values = new Float32Array(vector.length);
        let magnitude = 0;
        for (let index = 0; index < vector.length; index++) {
          const value = bytes.readFloatLE(index * 4);
          if (!Number.isFinite(value)) throw new Error("Portable vector is corrupt");
          values[index] = value;
          magnitude += value * value;
        }
        if (magnitude === 0) throw new Error("Portable vector has zero magnitude");
        return { id: row.id, values, magnitude: Math.sqrt(magnitude) };
      });
      this.searchCache = { key, revision: current.vector_revision, rows };
    }
    const eligible = new Set(query.eligibleIds),
      hits: VectorHit[] = [];
    for (const row of this.searchCache.rows) {
      query.signal?.throwIfAborted();
      if (!eligible.has(row.id)) continue;
      let dot = 0;
      for (let index = 0; index < vector.length; index++) dot += row.values[index] * vector[index];
      const distance = 1 - dot / (row.magnitude * queryMagnitude);
      if (hits.length < query.limit || distance <= hits[hits.length - 1].distance) {
        hits.push({ id: row.id, distance });
        hits.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
        if (hits.length > query.limit) hits.pop();
      }
    }
    return hits;
  }
}
