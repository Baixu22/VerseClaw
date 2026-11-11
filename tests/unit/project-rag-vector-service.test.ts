// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryWikiVectorService,
  createLanceVectorBackend,
  resolveMemoryWikiConfig,
  memoryWikiNamespaceId,
} from "../../openclaw_runtime/extensions/memory-wiki/runtime-api";
import { createPluginStateKeyedStoreForTests } from "../../openclaw_runtime/src/plugin-sdk/plugin-state-test-runtime";
import { createEmbeddingSpace } from "../../openclaw_runtime/src/knowledge/retrieval/embedding-space";
import { digestOwnerReadContent } from "../../openclaw_runtime/src/runtime-core/knowledge-owner-read";
import { closeOpenClawStateDatabase } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { ProjectionStore } from "../../openclaw_runtime/src/knowledge/retrieval/projection-store";
import { VectorStore } from "../../openclaw_runtime/src/knowledge/retrieval/vector-store";
import {
  lexicalProjectionProfile,
  lexicalProjectionProfileDigest,
} from "../../openclaw_runtime/src/knowledge/retrieval/index-profile";
import { knowledgeChunkId } from "../../openclaw_runtime/src/knowledge/retrieval/citation";

let root: string;
let service: ReturnType<typeof createMemoryWikiVectorService> | undefined;
afterEach(async () => {
  await service?.stop();
  service = undefined;
  closeOpenClawStateDatabase();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(enable: () => Promise<void> = async () => {}) {
  root = mkdtempSync(path.join(tmpdir(), "rag-vector-service-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", path.join(root, "state"));
  const space = createEmbeddingSpace({
    providerRef: "agent-fixture",
    model: "fixture",
    modelRevision: "r1",
    dimensions: 3,
    maxInputTokens: 64,
    tokenizerId: "fixture",
    tokenizerDigest: digestOwnerReadContent("fixture"),
    inputFormat: { id: "fixture", query: "{text}", document: "{text}" },
    normalization: "l2",
  });
  const identity = {
    workspaceId: "fixture-workspace",
    workspaceDir: root,
    agentSessionKey: "agent:main:vector-fixture",
    sessionId: "physical-fixture",
    egressProviderRefs: [],
  };
  const embedding: Parameters<typeof createMemoryWikiVectorService>[0]["embedding"] = {
    status: () => ({
      mode: "local",
      status: "ready",
      credentialEpoch: 1,
      capability: {
        schema: "ProviderCapabilitySnapshot/v1",
        providerRef: space.providerRef,
        transport: "local",
        credentialEpoch: 1,
        observedAt: new Date().toISOString(),
        status: "ready",
        space,
      },
    }),
    embed: async (_identity, input) => ({
      vectors: [[1, 0, 0]],
      job: {
        schema: "EmbeddingJob/v1",
        jobId: "fixture",
        spaceId: space.spaceId,
        credentialEpoch: 1,
        state: "complete",
        inputKind: input.kind,
        inputCount: 1,
        cacheHits: 0,
      },
    }),
  };
  const config = resolveMemoryWikiConfig({
    vault: { path: path.join(root, "vault") },
    search: { backend: "local", corpus: "wiki" },
  });
  service = createMemoryWikiVectorService({
    config,
    embedding,
    projection: {
      enable: async () => {
        await enable();
        return {
          status: "ready",
          lastError: null,
          sources: [],
          jobs: [],
          activeWorker: false,
          workerThreadIds: [],
        };
      },
      idle: async () => ({
        status: "ready",
        lastError: null,
        sources: [],
        jobs: [],
        activeWorker: false,
        workerThreadIds: [],
      }),
    },
    openKeyedStore: <T>(options: Parameters<typeof createPluginStateKeyedStoreForTests<T>>[1]) =>
      createPluginStateKeyedStoreForTests<T>("memory-wiki", options),
  });
  return { service, identity, embedding, config };
}

function seedSource(
  config: ReturnType<typeof resolveMemoryWikiConfig>,
  eventId = "fixture",
  force = false,
  changes: { revision?: string; sourceDigest?: string; quote?: string } = {},
) {
  const projection = new ProjectionStore();
  const quote = changes.quote ?? "one";
  const source = {
    schema: "SourceRef/v2" as const,
    authorityId: "memory-wiki",
    domain: "wiki" as const,
    namespaceId: memoryWikiNamespaceId(config),
    subjectId: "fixture",
    revision: changes.revision ?? "1",
    sourceDigest: changes.sourceDigest ?? digestOwnerReadContent(quote),
    policyEpoch: "fixture",
    locator: {
      coordinateSpace: "raw-source-utf8-v1" as const,
      startByte: 0,
      endByteExclusive: Buffer.byteLength(quote),
      startLine: 1,
      endLine: 1,
    },
  };
  projection.observe({
    source,
    eventId,
    profileDigest: lexicalProjectionProfileDigest,
    eligible: true,
    force,
    deadlineAt: Date.now() + 60_000,
  });
  const job = projection.claim({
    namespaceId: source.namespaceId,
    leaseOwner: "fixture",
    leaseMs: 30_000,
  })!;
  projection.publish(job, [
    {
      schema: "KnowledgeChunk/v2",
      chunkId: knowledgeChunkId(source, lexicalProjectionProfile),
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
  ]);
  return source;
}

describe("vector activation ownership", () => {
  it("repairs a native generation whose IDs changed without changing its row count", async () => {
    const { service, identity, embedding, config } = fixture();
    seedSource(config);
    const embed = embedding.embed;
    let documentCalls = 0;
    embedding.embed = async (...args) => {
      if (args[1].kind === "document") documentCalls++;
      return embed(...args);
    };
    await service.enable(identity, "lancedb-ann");
    await service.idle(identity);
    const store = new VectorStore();
    const previous = (await service.status(identity)).generation!;
    expect(previous.backend).toBe("lancedb-ann");
    const ids = store.ids(previous);
    const original = store.lookup(previous, ids)[0];
    const status = embedding.status(identity);
    if (status.capability?.status !== "ready") throw new Error("Fixture embedding is unavailable");
    await service.stop();
    const native = createLanceVectorBackend(path.join(root, "state", "ann"));
    try {
      await native.deleteRows(previous, ids);
      await native.write(previous, status.capability.space, [
        { ...original, id: "replaced-id", vector: [1, 0, 0] },
      ]);
      expect(await native.hasGeneration(previous, new Set(ids))).toBe(false);
    } finally {
      await native.close();
    }
    await service.start();
    await service.idle(identity);
    const repaired = (await service.status(identity)).generation!;
    expect(repaired.generationId).not.toBe(previous.generationId);
    expect(store.ids(repaired)).toEqual(ids);
    expect(documentCalls).toBe(1);
    try {
      expect(await native.hasGeneration(repaired, new Set(ids))).toBe(true);
    } finally {
      await native.close();
    }
  });

  it("does not reuse an old source generation after identical content is revoked and restored", async () => {
    const { service, identity, embedding, config } = fixture();
    const source = seedSource(config);
    const embed = embedding.embed;
    let documentCalls = 0;
    embedding.embed = async (...args) => {
      if (args[1].kind === "document") documentCalls++;
      return embed(...args);
    };
    await service.enable(identity, "sqlite-flat");
    await service.idle(identity);
    const store = new VectorStore();
    const generation = (await service.status(identity)).generation!;
    const previous = store.rows(generation)[0];
    new ProjectionStore().observe({
      source,
      eventId: "revoke",
      profileDigest: lexicalProjectionProfileDigest,
      eligible: false,
      deadlineAt: Date.now() + 60_000,
    });
    seedSource(config, "restore");
    await service.idle(identity);
    const current = store.rows(generation)[0];
    expect(current.chunk_id).toBe(previous.chunk_id);
    expect(current.chunk_digest).toBe(previous.chunk_digest);
    expect(current.source_generation).not.toBe(previous.source_generation);
    expect(current.id).not.toBe(previous.id);
    expect(documentCalls).toBe(2);
  });

  it("does not reuse vector rows whose current source identity changed", async () => {
    const { service, identity, embedding, config } = fixture();
    seedSource(config);
    const embed = embedding.embed;
    let documentCalls = 0;
    embedding.embed = async (...args) => {
      if (args[1].kind === "document") documentCalls++;
      return embed(...args);
    };
    await service.enable(identity, "sqlite-flat");
    await service.idle(identity);
    const store = new VectorStore();
    const generation = (await service.status(identity)).generation!;
    const previous = store.rows(generation)[0];
    seedSource(config, "changed-source", false, {
      revision: "2",
      sourceDigest: digestOwnerReadContent("changed-source"),
      quote: "changed-source",
    });
    await service.idle(identity);
    const current = store.rows((await service.status(identity)).generation!)[0];
    expect(current.source_generation).not.toBe(previous.source_generation);
    expect(documentCalls).toBe(2);
  });

  it("returns maintenance intent without waiting for the active build", async () => {
    const { service, identity, embedding, config } = fixture();
    seedSource(config);
    const entered = deferred(),
      release = deferred();
    const embed = embedding.embed;
    embedding.embed = async (...args) => {
      if (args[1].kind === "document") {
        entered.resolve();
        await release.promise;
      }
      return embed(...args);
    };
    await service.enable(identity, "sqlite-flat");
    await entered.promise;
    try {
      await expect(
        Promise.race([
          service.rebuild(identity).then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
        ]),
      ).resolves.toBe(true);
    } finally {
      release.resolve();
    }
    await service.idle(identity);
    expect((await service.status(identity)).status).toBe("ready");
  });

  it("retains a rebuild requested during embedding and drains queued maintenance", async () => {
    const { service, identity, embedding, config } = fixture();
    seedSource(config);
    const entered = deferred(),
      release = deferred();
    const embed = embedding.embed;
    let calls = 0;
    embedding.embed = async (...args) => {
      if (args[1].kind === "document" && calls++ === 0) {
        entered.resolve();
        await release.promise;
      }
      return embed(...args);
    };
    await service.enable(identity, "sqlite-flat");
    await entered.promise;
    await service.rebuild(identity);
    await service.optimize(identity);
    release.resolve();
    await service.idle(identity);
    const status = await service.status(identity);
    expect(status.generation?.intentSequence).toBe(2);
    expect(status.indexing).toBe(false);
    expect(calls).toBe(1);
  });

  it("allows a new workspace/session to configure its own index without exposing the prior generation", async () => {
    const { service, identity } = fixture();
    await service.enable(identity, "sqlite-flat");
    await service.idle(identity);
    const next = {
      ...identity,
      workspaceId: "next-workspace",
      agentSessionKey: "agent:main:next",
      sessionId: "physical-next",
    };
    expect(await service.status(next)).toMatchObject({ status: "disabled", generation: null });
    await service.enable(next, "sqlite-flat");
    await service.idle(next);
    expect((await service.status(next)).generation?.workspaceId).toBe(next.workspaceId);
    await expect(service.search(identity, "old scope")).rejects.toThrow("scope changed");
  });

  it("drains an enabling activation before a concurrent disable and leaves no polling timer", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const entered = deferred(),
      release = deferred();
    const { service, identity } = fixture(async () => {
      entered.resolve();
      await release.promise;
    });
    const enabling = service.enable(identity, "sqlite-flat");
    await entered.promise;
    const disabling = service.disable(identity);
    try {
      expect(
        await Promise.race([
          disabling.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500)),
        ]),
      ).toBe(true);
    } finally {
      release.resolve();
    }
    await Promise.all([enabling, disabling]);
    expect((await service.status(identity)).status).toBe("disabled");
    closeOpenClawStateDatabase();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a late query result after disable and re-enable of the same vector generation", async () => {
    const { service, identity, embedding } = fixture();
    await service.enable(identity, "sqlite-flat");
    await service.idle(identity);
    const entered = deferred(),
      release = deferred();
    const embed = embedding.embed;
    embedding.embed = async (...args) => {
      entered.resolve();
      await release.promise;
      return embed(...args);
    };
    const query = service.search(identity, "delayed query");
    const rejected = expect(query).rejects.toThrow("Vector index stopped");
    await entered.promise;
    await service.disable(identity);
    await service.enable(identity, "sqlite-flat");
    await service.idle(identity);
    release.resolve();
    await rejected;
    expect((await service.status(identity)).status).toBe("ready");
  });
});
