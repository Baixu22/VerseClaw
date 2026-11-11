import path from "node:path";
import { statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Connection, Table } from "@lancedb/lancedb";
import {
  VectorStore,
  createPortableVectorSearch,
  validateVectorRow,
  validateEmbeddingVector,
  waitForRetrievalOperation,
  type VectorProjectionBackend,
  type VectorGenerationV1,
  type VectorProjectionV1,
  type EmbeddingSpaceV1,
  type IndexBackendCapabilitiesV1,
} from "openclaw/plugin-sdk/knowledge-retrieval";

export function createPortableVectorBackend(database?: { path?: string }): VectorProjectionBackend {
  const store = new VectorStore(database);
  const worker = createPortableVectorSearch(store.database);
  return {
    id: "sqlite-flat",
    capability: async () => ({
      schema: "IndexBackendCapabilities/v1",
      backend: "sqlite-flat",
      available: true,
      platform: process.platform,
      arch: process.arch,
      maxReferenceRows: 20_000,
      prefilter: true,
      includesUnindexedRows: true,
    }),
    hasGeneration: async (generation, expectedIds) =>
      expectedIds.size === generation.rowCount &&
      store
        .generations(generation.namespaceId)
        .some(
          (row) =>
            row.generationId === generation.generationId &&
            row.workspaceId === generation.workspaceId &&
            row.spaceId === generation.spaceId &&
            row.backend === generation.backend &&
            row.rowCount === generation.rowCount,
        ) &&
      store.ids(generation).every((id) => expectedIds.has(id)),
    write: async (generation, space, rows, signal) => {
      signal?.throwIfAborted();
      store.write(generation, space, rows);
    },
    search: (query) => worker.search(query),
    optimize: async (_generation, signal) => {
      signal?.throwIfAborted();
    },
    deleteRows: async (generation, ids) => {
      store.deleteRows(generation, ids);
    },
    remove: async (generation) => {
      store.remove(generation);
    },
    close: () => worker.close(),
  };
}

function pathExists(file: string) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function quoted(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
function tableName(generation: VectorGenerationV1) {
  return `v_${generation.generationId.replaceAll("-", "")}`;
}

const filename = fileURLToPath(import.meta.url);
const dist = filename.replaceAll(path.sep, "/").lastIndexOf("/dist/");
const pluginRoot =
  dist >= 0
    ? path.join(filename.slice(0, dist), "extensions/memory-wiki")
    : fileURLToPath(new URL("../../", import.meta.url));
function loadNative(): typeof import("@lancedb/lancedb") {
  let cursor = pluginRoot;
  while (true) {
    const candidate = path.join(cursor, "node_modules/@lancedb/lancedb/package.json");
    if (pathExists(candidate)) return createRequire(candidate)("@lancedb/lancedb");
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  // Keep Node's normal error semantics when no packaged owner copy exists.
  return createRequire(path.join(pluginRoot, "package.json"))("@lancedb/lancedb");
}

/** Library-only ANN adapter; importing this module never registers memory hooks. */
export function createLanceVectorBackend(directory: string): VectorProjectionBackend {
  let connection: Connection | undefined;
  let capability: Promise<IndexBackendCapabilitiesV1> | undefined;
  const tables = new Map<string, Table>();
  let serial: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(run: () => Promise<T>) => {
    const next = serial.then(run);
    serial = next.catch(() => undefined);
    return next;
  };
  const connect = async () => {
    if (!connection) {
      const native = loadNative();
      connection = await native.connect(path.resolve(directory));
    }
    return connection;
  };
  const table = async (generation: VectorGenerationV1) => {
    let current = tables.get(generation.generationId);
    if (!current) {
      current = await (await connect()).openTable(tableName(generation));
      tables.set(generation.generationId, current);
    }
    return current;
  };
  const adapter: VectorProjectionBackend = {
    id: "lancedb-ann",
    capability: () => {
      capability ??= enqueue(async () => {
        const base = {
          schema: "IndexBackendCapabilities/v1" as const,
          backend: "lancedb-ann" as const,
          platform: process.platform,
          arch: process.arch,
          maxReferenceRows: 100_000,
          prefilter: true as const,
          includesUnindexedRows: true as const,
        };
        let stage = "module loading";
        try {
          const db = await connect();
          stage = "local write/read";
          const name = `v_${randomUUID().replaceAll("-", "")}`;
          let probe: Table | undefined;
          try {
            // Import/connect alone succeed even when native Windows paths cannot
            // persist a dataset. Probe once per activation at the real index root.
            probe = await db.createTable(name, [{ id: "capability", vector: [1, 0] }]);
            const rows = await probe.vectorSearch([1, 0]).limit(1).toArray({ timeoutMs: 30_000 });
            if (rows[0]?.id !== "capability") throw new Error("Native readback failed");
          } finally {
            probe?.close();
            if ((await db.tableNames()).includes(name)) await db.dropTable(name);
          }
          return { ...base, available: true };
        } catch {
          return {
            ...base,
            available: false,
            reason: `Native LanceDB ${stage} capability unavailable`,
          };
        }
      });
      return capability;
    },
    hasGeneration: (generation, expectedIds) =>
      enqueue(async () => {
        try {
          if (expectedIds.size !== generation.rowCount) return false;
          if (!(await (await connect()).tableNames()).includes(tableName(generation)))
            return generation.rowCount === 0;
          const current = await table(generation);
          if ((await current.countRows()) !== generation.rowCount) return false;
          const scope = `namespace_id = ${quoted(generation.namespaceId)} AND workspace_id = ${quoted(generation.workspaceId)} AND space_id = ${quoted(generation.spaceId)} AND generation_id = ${quoted(generation.generationId)}`;
          if ((await current.countRows(scope)) !== generation.rowCount) return false;
          if (generation.rowCount > 0) {
            const rows = await current
              .query()
              .select(["id"])
              .limit(generation.rowCount)
              .toArray({ timeoutMs: 30_000 });
            if (rows.length !== generation.rowCount) return false;
            const ids = new Set(rows.map((row) => row.id));
            if (ids.size !== generation.rowCount || rows.some((row) => !expectedIds.has(row.id)))
              return false;
          }
          return true;
        } catch {
          tables.get(generation.generationId)?.close();
          tables.delete(generation.generationId);
          return false;
        }
      }),
    write: (
      generation: VectorGenerationV1,
      space: EmbeddingSpaceV1,
      rows: VectorProjectionV1[],
      signal,
    ) =>
      enqueue(async () => {
        signal?.throwIfAborted();
        if (!rows.length) return;
        const data = rows.map((row) => ({
          id: row.id,
          namespace_id: row.namespaceId,
          workspace_id: row.workspaceId,
          space_id: row.spaceId,
          generation_id: row.generationId,
          chunk_id: row.chunkId,
          source_generation: row.sourceGeneration,
          chunk_digest: row.chunkDigest,
          vector: validateVectorRow(row, generation, space),
        }));
        const db = await connect(),
          name = tableName(generation);
        signal?.throwIfAborted();
        if (!(await db.tableNames()).includes(name)) {
          const created = await db.createTable(name, data);
          tables.set(generation.generationId, created);
        } else
          await (
            await table(generation)
          )
            .mergeInsert("id")
            .whenMatchedUpdateAll()
            .whenNotMatchedInsertAll()
            .execute(data, { timeoutMs: 120_000 });
        signal?.throwIfAborted();
      }),
    search: (query) => {
      const signal = query.signal
        ? AbortSignal.any([query.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000);
      return waitForRetrievalOperation(
        enqueue(async () => {
          signal.throwIfAborted();
          if (!query.eligibleIds.length) return [];
          if (query.eligibleIds.length > 100_000 || query.limit < 1 || query.limit > 100)
            throw new Error("Invalid ANN query bounds");
          const target: VectorGenerationV1 = {
            schema: "VectorGeneration/v1",
            generationId: query.generationId,
            namespaceId: query.namespaceId,
            workspaceId: query.workspaceId,
            spaceId: query.space.spaceId,
            backend: "lancedb-ann",
            intentSequence: 1,
            state: "active",
            rowCount: 0,
          };
          const current = await table(target);
          // Default LanceDB prefilter applies before scoring and default search
          // includes newly appended unindexed rows. fastSearch/postfilter are intentionally absent.
          const predicate = `namespace_id = ${quoted(query.namespaceId)} AND workspace_id = ${quoted(query.workspaceId)} AND space_id = ${quoted(query.space.spaceId)} AND generation_id = ${quoted(query.generationId)} AND id IN (${query.eligibleIds.map(quoted).join(",")})`;
          let search = current
            .vectorSearch(validateEmbeddingVector(query.space, query.vector))
            .distanceType("cosine")
            .where(predicate)
            .limit(query.limit);
          search =
            query.exact || (await current.countRows()) < 64
              ? search.bypassVectorIndex()
              : search.nprobes(32).ef(300).refineFactor(4);
          const rows = await search.select(["id", "_distance"]).toArray({ timeoutMs: 30_000 });
          signal.throwIfAborted();
          return rows
            .map((row) => {
              if (
                typeof row.id !== "string" ||
                typeof row._distance !== "number" ||
                !Number.isFinite(row._distance)
              )
                throw new Error("ANN result is invalid");
              return { id: row.id, distance: row._distance };
            })
            .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
        }),
        signal,
      );
    },
    optimize: (generation, signal) =>
      enqueue(async () => {
        signal?.throwIfAborted();
        if (!(await (await connect()).tableNames()).includes(tableName(generation))) {
          if (generation.rowCount === 0) return;
          throw new Error("ANN generation table is missing");
        }
        const current = await table(generation),
          native = loadNative();
        const rowCount = await current.countRows();
        if (rowCount !== generation.rowCount) throw new Error("ANN generation row count is stale");
        if (rowCount < 64) return;
        await current.createIndex("vector", {
          config: native.Index.hnswSq({
            distanceType: "cosine",
            numPartitions: 1,
            m: 32,
            efConstruction: 300,
          }),
          replace: true,
        });
        signal?.throwIfAborted();
        await current.optimize({ cleanupOlderThan: new Date(), deleteUnverified: false });
      }),
    remove: (generation) =>
      enqueue(async () => {
        const db = await connect(),
          name = tableName(generation);
        tables.get(generation.generationId)?.close();
        tables.delete(generation.generationId);
        if ((await db.tableNames()).includes(name)) await db.dropTable(name);
      }),
    deleteRows: (generation, ids) =>
      enqueue(async () => {
        if (ids.length > 512) throw new Error("ANN deletion batch exceeds512 rows");
        if (!ids.length || !(await (await connect()).tableNames()).includes(tableName(generation)))
          return;
        await (
          await table(generation)
        ).delete(
          `namespace_id = ${quoted(generation.namespaceId)} AND workspace_id = ${quoted(generation.workspaceId)} AND space_id = ${quoted(generation.spaceId)} AND generation_id = ${quoted(generation.generationId)} AND id IN (${ids.map(quoted).join(",")})`,
        );
      }),
    close: () =>
      enqueue(async () => {
        for (const current of tables.values()) current.close();
        tables.clear();
        connection?.close();
        connection = undefined;
        capability = undefined;
      }),
  };
  return adapter;
}
