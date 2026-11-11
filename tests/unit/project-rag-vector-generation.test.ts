// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VectorStore } from "../../openclaw_runtime/src/knowledge/retrieval/vector-store";
import { createEmbeddingSpace } from "../../openclaw_runtime/src/knowledge/retrieval/embedding-space";
import { digestOwnerReadContent } from "../../openclaw_runtime/src/runtime-core/knowledge-owner-read";
import { closeOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { ProjectionStore } from "../../openclaw_runtime/src/knowledge/retrieval/projection-store";
import {
  lexicalProjectionProfile,
  lexicalProjectionProfileDigest,
} from "../../openclaw_runtime/src/knowledge/retrieval/index-profile";
import { knowledgeChunkId } from "../../openclaw_runtime/src/knowledge/retrieval/citation";
import type {
  VectorGenerationV1,
  VectorProjectionV1,
} from "../../openclaw_runtime/src/knowledge/retrieval/vector-contracts";

let root: string;
afterEach(() => {
  closeOpenClawStateDatabase();
  if (root) rmSync(root, { recursive: true, force: true });
});
const space = (revision = "r1") =>
  createEmbeddingSpace({
    providerRef: "agent-fixture",
    model: "fixture",
    modelRevision: revision,
    dimensions: 3,
    maxInputTokens: 32,
    tokenizerId: "fixture",
    tokenizerDigest: digestOwnerReadContent("fixture"),
    inputFormat: { id: "fixture", query: "{text}", document: "{text}" },
    normalization: "l2",
  });
function fixture() {
  root = mkdtempSync(path.join(tmpdir(), "rag-vector-generation-"));
  return new VectorStore({ path: path.join(root, "state.sqlite") });
}
function row(generation: VectorGenerationV1, id: string, vector: number[]): VectorProjectionV1 {
  return {
    schema: "VectorProjection/v1",
    id,
    generationId: generation.generationId,
    namespaceId: generation.namespaceId,
    workspaceId: generation.workspaceId,
    spaceId: generation.spaceId,
    chunkId: "chunk-" + id,
    chunkDigest: digestOwnerReadContent(id),
    sourceGeneration: "source-generation",
    vector,
    source: {
      schema: "SourceRef/v2",
      authorityId: "memory-wiki",
      domain: "wiki",
      namespaceId: generation.namespaceId,
      subjectId: id,
      revision: "r1",
      sourceDigest: digestOwnerReadContent(id),
      policyEpoch: "agent-fixture-policy",
      locator: {
        coordinateSpace: "raw-source-utf8-v1",
        startByte: 0,
        endByteExclusive: id.length,
        startLine: 1,
        endLine: 1,
      },
    },
  };
}

describe("shared SQLite vector generation activation", () => {
  it("quarantines the old active generation when a different workspace takes the namespace", () => {
    const store = fixture(),
      s = space();
    const previous = store.begin("ns", "first", s, "sqlite-flat");
    store.write(previous, s, [row(previous, "one", [1, 0, 0])]);
    store.publish(previous, 1);
    const next = store.begin("ns", "next", s, "sqlite-flat");
    expect(store.active("ns", "first", s.spaceId)).toBeUndefined();
    expect(store.active("ns", "next", s.spaceId)).toBeUndefined();
    store.publish(next, 0);
    expect(store.active("ns", "next", s.spaceId)?.workspaceId).toBe("next");
  });

  it("fences competing builds and activates one backend per namespace", () => {
    const store = fixture(),
      s = space();
    const first = store.begin("ns", "workspace", s, "sqlite-flat");
    store.write(first, s, [row(first, "one", [1, 0, 0])]);
    const second = store.begin("ns", "workspace", s, "lancedb-ann");
    store.write(second, s, [row(second, "one", [1, 0, 0])]);
    expect(store.publish(first, 1)).toBe(false);
    expect(store.publish(second, 2)).toBe(false);
    expect(store.publish(second, 1)).toBe(true);
    expect(store.active("ns", "workspace", s.spaceId)?.generationId).toBe(second.generationId);
    expect(store.generations("ns").filter((g) => g.state === "active")).toHaveLength(1);
    expect(() => store.remove(second)).toThrow("active");
    store.remove(first);
  });

  it("rejects model replacement reuse and leaves interrupted builds recoverable", () => {
    const store = fixture(),
      s1 = space(),
      s2 = space("r2");
    const first = store.begin("ns", "workspace", s1, "sqlite-flat");
    store.write(first, s1, [row(first, "one", [1, 0, 0])]);
    store.publish(first, 1);
    const replacing = store.begin("ns", "workspace", s2, "lancedb-ann");
    expect(store.active("ns", "workspace", s1.spaceId)).toBeUndefined();
    expect(store.active("ns", "workspace", s2.spaceId)).toBeUndefined();
    expect(() => store.write(replacing, s1, [row(replacing, "one", [1, 0, 0])])).toThrow(
      "mismatch",
    );
    store.recover("ns");
    expect(
      store.generations("ns").find((g) => g.generationId === replacing.generationId)?.state,
    ).toBe("failed");
    expect(store.publish(replacing, 0)).toBe(false);
  });

  it("prefilters exact distance and keeps workspace, space and generation boundaries", () => {
    const store = fixture(),
      s = space();
    const g = store.begin("ns", "workspace", s, "sqlite-flat");
    store.write(g, s, [row(g, "closest", [1, 0, 0]), row(g, "permitted", [0, 1, 0])]);
    store.publish(g, 2);
    const query = {
      namespaceId: "ns",
      workspaceId: "workspace",
      generationId: g.generationId,
      space: s,
      vector: [1, 0, 0],
      limit: 1,
      eligibleIds: ["permitted"],
    };
    expect(store.exactSearch(query)).toEqual([{ id: "permitted", distance: 1 }]);
    expect(store.exactSearch({ ...query, workspaceId: "another" })).toEqual([]);
    expect(store.exactSearch({ ...query, space: space("r2") })).toEqual([]);
    expect(store.exactSearch({ ...query, generationId: "old" })).toEqual([]);
  });

  it("removes vector eligibility immediately when the shared source owner revokes a generation", () => {
    const store = fixture(),
      s = space();
    const projection = new ProjectionStore({ database: store.database });
    const target = store.begin("ns", "workspace", s, "sqlite-flat");
    const vector = row(target, "one", [1, 0, 0]);
    const quote = "one";
    const source = {
      ...vector.source,
      sourceDigest: digestOwnerReadContent(quote),
      locator: {
        coordinateSpace: "raw-source-utf8-v1" as const,
        startByte: 0,
        endByteExclusive: 3,
        startLine: 1,
        endLine: 1,
      },
    };
    projection.observe({
      source,
      eventId: "initial",
      profileDigest: lexicalProjectionProfileDigest,
      eligible: true,
      deadlineAt: Date.now() + 60_000,
    });
    const job = projection.claim({
      namespaceId: "ns",
      leaseOwner: "agent-fixture",
      leaseMs: 30_000,
    })!;
    const chunkId = knowledgeChunkId(source, lexicalProjectionProfile);
    const generation = projection.publish(job, [
      {
        schema: "KnowledgeChunk/v2",
        chunkId,
        chunkDigest: digestOwnerReadContent(quote),
        ordinal: 0,
        parentId: source.subjectId,
        sectionId: "fixture",
        headingPath: [],
        kind: "paragraph",
        source,
        quote,
        retrievalText: quote,
        searchTokens: [quote],
        tokenCount: 3,
        chunker: lexicalProjectionProfile,
      },
    ])!;
    store.write(target, s, [
      {
        ...vector,
        source,
        chunkId,
        chunkDigest: digestOwnerReadContent(quote),
        sourceGeneration: generation.generationId,
      },
    ]);
    store.publish(target, 1);
    expect(store.eligibleIds(target)).toEqual(["one"]);
    projection.observe({
      source,
      eventId: "revoked",
      profileDigest: lexicalProjectionProfileDigest,
      eligible: false,
      deadlineAt: Date.now() + 60_000,
    });
    expect(store.eligibleIds(target)).toEqual([]);
    expect(store.rows(target)).toHaveLength(1);
    expect(
      store.exactSearch({
        namespaceId: "ns",
        workspaceId: "workspace",
        generationId: target.generationId,
        space: s,
        vector: [1, 0, 0],
        limit: 1,
        eligibleIds: store.eligibleIds(target),
      }),
    ).toEqual([]);
  });
});
