// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPortableVectorBackend,
  createLanceVectorBackend,
} from "../../openclaw_runtime/extensions/memory-wiki/runtime-api";
import { VectorStore } from "../../openclaw_runtime/src/knowledge/retrieval/vector-store";
import { createEmbeddingSpace } from "../../openclaw_runtime/src/knowledge/retrieval/embedding-space";
import { digestOwnerReadContent } from "../../openclaw_runtime/src/runtime-core/knowledge-owner-read";
import { closeOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";
import type {
  VectorGenerationV1,
  VectorProjectionV1,
  VectorProjectionBackend,
} from "../../openclaw_runtime/src/knowledge/retrieval/vector-contracts";

let root: string;
const opened: VectorProjectionBackend[] = [];
afterEach(async () => {
  for (const backend of opened.splice(0)) await backend.close();
  closeOpenClawStateDatabase();
  if (root) rmSync(root, { recursive: true, force: true });
});
const space = createEmbeddingSpace({
  providerRef: "agent-vector-fixture",
  model: "fixture",
  modelRevision: "r1",
  dimensions: 8,
  maxInputTokens: 64,
  tokenizerId: "fixture",
  tokenizerDigest: digestOwnerReadContent("fixture"),
  inputFormat: { id: "fixture", query: "{text}", document: "{text}" },
  normalization: "l2",
});
function rows(target: VectorGenerationV1): VectorProjectionV1[] {
  return Array.from({ length: 64 }, (_, index) => ({
    schema: "VectorProjection/v1",
    id: `row-${String(index).padStart(3, "0")}`,
    generationId: target.generationId,
    namespaceId: target.namespaceId,
    workspaceId: target.workspaceId,
    spaceId: target.spaceId,
    chunkId: "chunk-" + index,
    chunkDigest: digestOwnerReadContent(String(index)),
    sourceGeneration: "agent-fixture-source",
    vector: Array.from({ length: 8 }, (_, n) => (n === index % 8 ? 1 : (index + 1) * 0.001)),
    source: {
      schema: "SourceRef/v2",
      domain: "wiki",
      authorityId: "memory-wiki",
      namespaceId: target.namespaceId,
      subjectId: "source-" + index,
      revision: "1",
      sourceDigest: digestOwnerReadContent(String(index)),
      policyEpoch: "fixture",
      locator: {
        coordinateSpace: "raw-source-utf8-v1",
        startByte: 0,
        endByteExclusive: 1,
        startLine: 1,
        endLine: 1,
      },
    },
  }));
}

describe("real portable and LanceDB library adapters", () => {
  it.skipIf(process.platform !== "win32")(
    "reports native write capability unavailable for an overlong Windows index root",
    async () => {
      root = mkdtempSync(path.join(tmpdir(), "rag-vector-long-path-"));
      const backend = createLanceVectorBackend(
        path.join(root, "a".repeat(60), "b".repeat(60), "c".repeat(60)),
      );
      opened.push(backend);
      expect(await backend.capability()).toMatchObject({
        available: false,
        reason: "Native LanceDB local write/read capability unavailable",
      });
    },
  );

  it.each(["sqlite-flat", "lancedb-ann"] as const)(
    "enforces filters and appended-row coverage through %s",
    async (id) => {
      root = mkdtempSync(path.join(tmpdir(), "rag-vector-adapter-"));
      const database = { path: path.join(root, "state.sqlite") },
        store = new VectorStore(database);
      const backend =
        id === "sqlite-flat"
          ? createPortableVectorBackend(database)
          : createLanceVectorBackend(path.join(root, "lance"));
      opened.push(backend);
      expect((await backend.capability()).available).toBe(true);
      const target = store.begin("fixture-ns", "fixture-workspace", space, id),
        data = rows(target);
      if (id === "lancedb-ann") store.write(target, space, data);
      await backend.write(target, space, data);
      expect(store.publish(target, data.length)).toBe(true);
      const input = {
        namespaceId: target.namespaceId,
        workspaceId: target.workspaceId,
        generationId: target.generationId,
        space,
        vector: data[0].vector,
        limit: 3,
        eligibleIds: data.map((row) => row.id),
        exact: true,
      };
      const first = await backend.search(input);
      const expectedIds = new Set(data.map((row) => row.id));
      const published = { ...target, rowCount: data.length };
      expect(await backend.hasGeneration(published, expectedIds)).toBe(true);
      expect(first[0].id).toBe(data[0].id);
      await backend.deleteRows({ ...target, workspaceId: "other" }, [data[0].id]);
      expect((await backend.search(input))[0].id).toBe(data[0].id);
      expect(await backend.hasGeneration({ ...published, workspaceId: "other" }, expectedIds)).toBe(
        false,
      );
      const filtered = await backend.search({ ...input, eligibleIds: [data[1].id] });
      expect(filtered.map((row) => row.id)).toEqual([data[1].id]);
      expect(await backend.search({ ...input, workspaceId: "other" })).toEqual([]);
      expect(await backend.search({ ...input, namespaceId: "other" })).toEqual([]);
      expect(await backend.search({ ...input, eligibleIds: [] })).toEqual([]);
      await backend.optimize(published);
      const appended = { ...data[0], id: "appended-exact", chunkId: "appended-chunk" };
      await backend.deleteRows(target, [data[0].id]);
      await backend.write(target, space, [appended]);
      expect(await backend.hasGeneration(published, expectedIds)).toBe(false);
      await backend.deleteRows(target, [appended.id]);
      await backend.write(target, space, [data[0]]);
      expect(await backend.hasGeneration(published, expectedIds)).toBe(true);
      if (id === "lancedb-ann") store.write(target, space, [appended]);
      await backend.write(target, space, [appended]);
      const newest = await backend.search({ ...input, eligibleIds: [appended.id], exact: false });
      expect(newest.map((row) => row.id)).toEqual([appended.id]);
      await backend.write(target, space, [appended]);
      expect(
        (await backend.search({ ...input, eligibleIds: [appended.id], exact: true })).map(
          (row) => row.id,
        ),
      ).toEqual([appended.id]);
      await backend.deleteRows(target, [appended.id]);
      if (id === "lancedb-ann") store.deleteRows(target, [appended.id]);
      expect(await backend.search({ ...input, eligibleIds: [appended.id] })).toEqual([]);
      if (id === "lancedb-ann") {
        expect(
          await backend.hasGeneration({ ...target, rowCount: data.length + 1 }, expectedIds),
        ).toBe(false);
        await backend.write(target, space, data);
        expect(
          await backend.hasGeneration({ ...target, rowCount: data.length + 1 }, expectedIds),
        ).toBe(false);
        await backend.remove(target);
        expect(
          await backend.hasGeneration({ ...target, rowCount: data.length + 1 }, expectedIds),
        ).toBe(false);
      }
      const replacement = store.begin(target.namespaceId, target.workspaceId, space, id);
      store.publish(replacement, 0);
      await backend.remove(target);
      await expect(backend.deleteRows(target, [data[0].id])).resolves.toBeUndefined();
      if (id === "lancedb-ann") {
        await backend.write(target, space, data);
        const current = store.active(target.namespaceId, target.workspaceId, space.spaceId)!;
        await backend.optimize(current);
      }
    },
    30_000,
  );

  it("refreshes a warm worker after a separate owner changes rows without changing the count", async () => {
    root = mkdtempSync(path.join(tmpdir(), "rag-vector-cache-"));
    const database = { path: path.join(root, "state.sqlite") },
      store = new VectorStore(database);
    const backend = createPortableVectorBackend(database);
    opened.push(backend);
    const target = store.begin("fixture-ns", "fixture-workspace", space, "sqlite-flat");
    const data = rows(target);
    store.write(target, space, data);
    store.publish(target, data.length);
    const input = {
      namespaceId: target.namespaceId,
      workspaceId: target.workspaceId,
      generationId: target.generationId,
      space,
      vector: data[0].vector,
      limit: 1,
      eligibleIds: [data[0].id],
    };
    expect((await backend.search(input))[0].id).toBe(data[0].id);
    const owner = new VectorStore(database);
    owner.deleteRows(target, [data[0].id]);
    const appended = { ...data[0], id: "replacement", chunkId: "replacement-chunk" };
    owner.write(target, space, [appended]);
    expect(owner.active(target.namespaceId, target.workspaceId, space.spaceId)?.rowCount).toBe(
      data.length,
    );
    expect(await backend.search(input)).toEqual([]);
    expect((await backend.search({ ...input, eligibleIds: [appended.id] }))[0].id).toBe(
      appended.id,
    );
    expect(await backend.search({ ...input, eligibleIds: [] })).toEqual([]);
  });

  it("cancels worker startup, releases the worker on close, and can reopen", async () => {
    root = mkdtempSync(path.join(tmpdir(), "rag-vector-worker-"));
    const database = { path: path.join(root, "state.sqlite") },
      store = new VectorStore(database);
    const backend = createPortableVectorBackend(database);
    opened.push(backend);
    const target = store.begin("fixture-ns", "fixture-workspace", space, "sqlite-flat");
    const data = rows(target);
    store.write(target, space, data);
    store.publish(target, data.length);
    const input = {
      namespaceId: target.namespaceId,
      workspaceId: target.workspaceId,
      generationId: target.generationId,
      space,
      vector: data[0].vector,
      limit: 1,
      eligibleIds: [data[0].id],
    };
    const controller = new AbortController();
    const cancelled = expect(
      backend.search({ ...input, signal: controller.signal }),
    ).rejects.toThrow("cancelled");
    controller.abort();
    await cancelled;
    expect((await backend.search(input))[0].id).toBe(data[0].id);
    const closed = expect(backend.search(input)).rejects.toThrow("closed");
    await backend.close();
    await closed;
    expect((await backend.search(input))[0].id).toBe(data[0].id);
  });
});
