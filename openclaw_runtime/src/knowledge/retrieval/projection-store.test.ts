import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  digestOwnerReadContent,
  type RawSourceLocator,
  type ReadAdmissionContextV1,
  type SourceRefV2,
} from "../../runtime-core/knowledge-owner-read.js";
import {
  closeOpenClawStateDatabase,
  openOpenClawStateDatabase,
} from "../../state/openclaw-state-db.js";
import { knowledgeChunkId } from "./citation.js";
import type { KnowledgeChunkV2 } from "./contracts.js";
import { lexicalProjectionProfile, lexicalProjectionProfileDigest } from "./index-profile.js";
import { ProjectionStore } from "./projection-store.js";
import type { ProjectionSourceIntent } from "./projection-contracts.js";

let root: string | undefined;
afterEach(() => {
  closeOpenClawStateDatabase();
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function fixture(startAt = 1_000) {
  root = mkdtempSync(path.join(os.tmpdir(), "projection-store-"));
  const clock = { now: startAt };
  const store = new ProjectionStore({
    database: { path: path.join(root, "openclaw.sqlite") },
    now: () => clock.now,
  });
  const locator: RawSourceLocator = {
    coordinateSpace: "raw-source-utf8-v1",
    startByte: 0,
    endByteExclusive: Buffer.byteLength("alpha\n配置", "utf8"),
    startLine: 1,
    endLine: 2,
  };
  const source: SourceRefV2 & { locator: RawSourceLocator } = {
    schema: "SourceRef/v2",
    domain: "wiki",
    authorityId: "wiki",
    namespaceId: "ns-1",
    subjectId: "page-1",
    revision: "r1",
    sourceDigest: digestOwnerReadContent("alpha\n配置"),
    policyEpoch: "p1",
    locator,
  };
  const intent = (overrides: Partial<ProjectionSourceIntent> = {}): ProjectionSourceIntent => ({
    source,
    profileDigest: lexicalProjectionProfileDigest,
    eligible: true,
    eventId: "event-1",
    reason: "publish",
    deadlineAt: startAt + 60_000,
    ...overrides,
  });
  const context: ReadAdmissionContextV1 = {
    schema: "ReadAdmissionContext/v1",
    contextId: "ctx",
    principalId: "owner",
    sessionId: "session",
    workspaceId: "workspace",
    ownerNamespaces: ["ns-1"],
    policyDigest: "policy",
    purpose: "knowledge-read",
    egressProviderRefs: [],
    expiresAt: new Date(startAt + 120_000).toISOString(),
  };
  const chunk: KnowledgeChunkV2 = {
    schema: "KnowledgeChunk/v2",
    chunkId: knowledgeChunkId(source, lexicalProjectionProfile),
    parentId: "page-1",
    sectionId: "section-1",
    ordinal: 0,
    kind: "paragraph",
    headingPath: ["Page"],
    source,
    quote: "alpha\n配置",
    chunkDigest: digestOwnerReadContent("alpha\n配置"),
    retrievalText: "page\nalpha 配置",
    searchTokens: ["page", "alpha", "配置"],
    tokenCount: 3,
    chunker: lexicalProjectionProfile,
  };
  return { store, clock, source, intent, context, chunk };
}

describe("ProjectionStore real SQLite lifecycle", () => {
  it("publishes chunks and FTS atomically, then searches the active generation", () => {
    const f = fixture();
    const observed = f.store.observe(f.intent());
    expect(observed.source.eligible).toBe(false);
    const job = f.store.claim({ namespaceId: "ns-1", leaseOwner: "worker", leaseMs: 30_000 });
    expect(job).toBeDefined();
    const generation = f.store.publish(job!, [f.chunk]);
    expect(generation?.state).toBe("active");
    expect(f.store.sources("ns-1")[0]).toMatchObject({
      eligible: true,
      desiredEligible: true,
      activeGeneration: generation?.generationId,
    });
    const result = f.store.search({
      namespaceId: "ns-1",
      query: "配置",
      limit: 10,
      context: f.context,
    });
    expect(result.status).toBe("available");
    expect(result.candidates[0]?.chunk.chunkId).toBe(f.chunk.chunkId);
  });

  it("revokes readability on invalidate and does not resurrect an old event", () => {
    const f = fixture();
    f.store.observe(f.intent());
    const job = f.store.claim({ namespaceId: "ns-1", leaseOwner: "worker", leaseMs: 30_000 })!;
    f.store.publish(job, [f.chunk]);
    const invalidated = f.store.observe(
      f.intent({
        eventId: "event-2",
        eligible: false,
        reason: "revoked",
        deadlineAt: f.clock.now + 60_000,
      }),
    );
    expect(invalidated.source).toMatchObject({
      eligible: false,
      desiredEligible: false,
      activeGeneration: null,
    });
    const replay = f.store.observe(f.intent());
    expect(replay.source.eligible).toBe(false);
    expect(
      f.store.search({ namespaceId: "ns-1", query: "配置", limit: 10, context: f.context })
        .candidates,
    ).toEqual([]);
  });

  it("keeps repeated semantic polls idempotent without growing the event ledger", () => {
    const f = fixture();
    const first = f.store.observe(f.intent());
    const second = f.store.observe(f.intent({ eventId: "event-2" }));
    expect(second.source.intentSequence).toBe(first.source.intentSequence);
    const db = openOpenClawStateDatabase({ path: path.join(root!, "openclaw.sqlite") }).db;
    expect(db.prepare("SELECT count(*) AS count FROM knowledge_index_events").get()).toEqual({
      count: 1,
    });
  });

  it("recovers expired pending deadlines and expired leases through one CAS claim", () => {
    const f = fixture();
    f.store.observe(f.intent({ deadlineAt: f.clock.now + 100 }));
    expect(f.store.claim({ namespaceId: "ns-1", leaseOwner: "first", leaseMs: 20 })).toBeDefined();
    expect(
      f.store.claim({ namespaceId: "ns-1", leaseOwner: "second", leaseMs: 20 }),
    ).toBeUndefined();
    f.clock.now += 30;
    expect(f.store.recover("ns-1")).toBe(1);
    const reclaimed = f.store.claim({ namespaceId: "ns-1", leaseOwner: "second", leaseMs: 20 });
    expect(reclaimed?.attempt).toBe(2);
    expect(reclaimed?.leaseOwner).not.toContain("first");
    f.clock.now += 100;
    expect(f.store.recover("ns-1")).toBe(1);
    expect(f.store.jobs("ns-1")[0]?.state).toBe("failed");
  });

  it("rejects a locator whose byte and line spans do not match the quote", () => {
    const f = fixture();
    f.store.observe(f.intent());
    const job = f.store.claim({ namespaceId: "ns-1", leaseOwner: "worker", leaseMs: 30_000 })!;
    const bad: KnowledgeChunkV2 = {
      ...f.chunk,
      source: { ...f.chunk.source, locator: { ...f.chunk.source.locator, endByteExclusive: 2 } },
    };
    expect(() => f.store.publish(job, [bad])).toThrow(/byte locator|without gaps|cover/);
  });

  it("keeps the subject row stable when its byte locator changes during a stop", () => {
    const f = fixture();
    const first = f.store.observe(f.intent());
    const job = f.store.claim({ namespaceId: "ns-1", leaseOwner: "worker", leaseMs: 30_000 })!;
    f.store.publish(job, [f.chunk]);
    const text = "alpha updated\n配置\nnew paragraph";
    const changed = {
      ...f.source,
      revision: "r2",
      sourceDigest: digestOwnerReadContent(text),
      locator: { ...f.source.locator, endByteExclusive: Buffer.byteLength(text), endLine: 3 },
    };
    const next = f.store.observe(f.intent({ source: changed, eventId: "changed-after-stop" }));
    expect(next.source.sourceKey).toBe(first.source.sourceKey);
    expect(f.store.sources("ns-1")).toHaveLength(1);
    expect(next.source).toMatchObject({ eligible: false, activeGeneration: null });
    expect(next.source.intentSequence).toBe(first.source.intentSequence + 1);
    expect(
      f.store
        .generations(first.source.sourceKey)
        .every((generation) => generation.state === "retired"),
    ).toBe(true);
  });

  it("fences a recovered lease across independent store instances", () => {
    const f = fixture();
    f.store.observe(f.intent());
    const old = f.store.claim({ namespaceId: "ns-1", leaseOwner: "old", leaseMs: 10 })!;
    const other = new ProjectionStore({
      database: { path: path.join(root!, "openclaw.sqlite") },
      now: () => f.clock.now,
    });
    expect(other.claim({ namespaceId: "ns-1", leaseOwner: "other", leaseMs: 10 })).toBeUndefined();
    f.clock.now += 11;
    other.recover("ns-1");
    const current = other.claim({ namespaceId: "ns-1", leaseOwner: "other", leaseMs: 100 })!;
    expect(f.store.publish(old, [f.chunk])).toBeUndefined();
    f.store.fail(old, "late old failure", 0);
    expect(other.jobs("ns-1")[0]?.state).toBe("leased");
    expect(other.publish(current, [f.chunk])?.state).toBe("active");
  });

  it("rolls back a whole generation when FTS insertion fails and leaves shared state readable", () => {
    const f = fixture();
    f.store.observe(f.intent());
    f.store.search({ namespaceId: "ns-1", query: "配置", limit: 10, context: f.context });
    const db = openOpenClawStateDatabase({ path: path.join(root!, "openclaw.sqlite") }).db;
    db.exec("DROP TABLE knowledge_index_chunks_fts");
    const job = f.store.claim({ namespaceId: "ns-1", leaseOwner: "worker", leaseMs: 30_000 })!;
    expect(() => f.store.publish(job, [f.chunk])).toThrow();
    expect(f.store.generations(job.sourceKey)).toHaveLength(0);
    expect(f.store.sources("ns-1")[0]?.eligible).toBe(false);
    expect(db.prepare("SELECT count(*) AS count FROM knowledge_index_chunks").get()).toEqual({
      count: 0,
    });
    closeOpenClawStateDatabase();
    expect(() =>
      openOpenClawStateDatabase({ path: path.join(root!, "openclaw.sqlite") }),
    ).not.toThrow();
  });

  it("keeps terminal budgets closed until an explicit rebuild and expires unclaimed jobs", () => {
    const f = fixture();
    f.store.observe(f.intent());
    for (let attempt = 0; attempt < 3; attempt++) {
      const job = f.store.claim({ namespaceId: "ns-1", leaseOwner: "worker", leaseMs: 10 })!;
      f.store.fail(job, "measured build failure", 0);
    }
    expect(f.store.jobs("ns-1")[0]?.state).toBe("failed");
    f.store.observe(f.intent({ eventId: "same-semantics" }));
    expect(
      f.store.claim({ namespaceId: "ns-1", leaseOwner: "worker", leaseMs: 10 }),
    ).toBeUndefined();
    f.store.observe(
      f.intent({ eventId: "explicit-rebuild", force: true, deadlineAt: f.clock.now + 1 }),
    );
    f.clock.now += 2;
    f.store.recover("ns-1");
    expect(f.store.jobs("ns-1").every((job) => job.state === "failed")).toBe(true);
  });

  it("supersedes an in-flight build and cleanup never changes the invalidation tombstone", () => {
    const f = fixture();
    const observed = f.store.observe(f.intent());
    const job = f.store.claim({ namespaceId: "ns-1", leaseOwner: "worker", leaseMs: 30_000 })!;
    f.store.observe(
      f.intent({ eventId: "deny-in-flight", eligible: false, reason: "policy_changed" }),
    );
    expect(f.store.publish(job, [f.chunk])).toBeUndefined();
    f.store.observe(f.intent({ eventId: "readmit" }));
    const fresh = f.store.claim({ namespaceId: "ns-1", leaseOwner: "new", leaseMs: 30_000 })!;
    const generation = f.store.publish(fresh, [f.chunk])!;
    expect(f.store.cleanup(observed.source.sourceKey)).toBe(0);
    expect(f.store.sources("ns-1")[0]?.activeGeneration).toBe(generation.generationId);
    f.store.observe(f.intent({ eventId: "deleted", eligible: false, reason: "deleted" }));
    expect(f.store.cleanup(observed.source.sourceKey)).toBe(1);
    expect(f.store.sources("ns-1")[0]).toMatchObject({
      eligible: false,
      desiredEligible: false,
      reason: "deleted",
    });
    expect(f.store.observe(f.intent()).source.eligible).toBe(false);
  });

  it("publishes more chunks than one SQLite parameter batch atomically", () => {
    const f = fixture();
    const total = 1100,
      quote = "alpha\n",
      text = quote.repeat(total);
    const source = {
      ...f.source,
      sourceDigest: digestOwnerReadContent(text),
      locator: { ...f.source.locator, endByteExclusive: Buffer.byteLength(text), endLine: total },
    };
    f.store.observe(f.intent({ source }));
    const job = f.store.claim({ namespaceId: "ns-1", leaseOwner: "worker", leaseMs: 30_000 })!;
    const chunks = Array.from({ length: total }, (_, ordinal) => {
      const ref = {
        ...source,
        locator: {
          ...source.locator,
          startByte: ordinal * quote.length,
          endByteExclusive: (ordinal + 1) * quote.length,
          startLine: ordinal + 1,
          endLine: ordinal + 1,
        },
      };
      return {
        ...f.chunk,
        ordinal,
        source: ref,
        quote,
        chunkDigest: digestOwnerReadContent(quote),
        retrievalText: quote,
        tokenCount: quote.length,
        chunkId: knowledgeChunkId(ref, lexicalProjectionProfile),
      };
    });
    expect(f.store.publish(job, chunks)).toMatchObject({ state: "active", chunkCount: total });
    expect(
      f.store.search({ namespaceId: "ns-1", query: "alpha", limit: 100, context: f.context })
        .candidates,
    ).toHaveLength(100);
  });

  it("never relabels recreated empty FTS as complete and recovers on explicit rebuild", () => {
    const f = fixture();
    f.store.observe(f.intent());
    f.store.publish(
      f.store.claim({ namespaceId: "ns-1", leaseOwner: "worker", leaseMs: 30_000 })!,
      [f.chunk],
    );
    const db = openOpenClawStateDatabase({ path: path.join(root!, "openclaw.sqlite") }).db;
    db.exec("DROP TABLE knowledge_index_chunks_fts");
    const restarted = new ProjectionStore({
      database: { path: path.join(root!, "openclaw.sqlite") },
      now: () => f.clock.now,
    });
    expect(
      restarted.search({ namespaceId: "ns-1", query: "配置", limit: 10, context: f.context }),
    ).toMatchObject({ status: "unavailable", candidates: [] });
    restarted.observe(f.intent({ eventId: "rebuild-after-fts-loss", force: true }));
    restarted.publish(
      restarted.claim({ namespaceId: "ns-1", leaseOwner: "new", leaseMs: 30_000 })!,
      [f.chunk],
    );
    expect(
      restarted.search({ namespaceId: "ns-1", query: "配置", limit: 10, context: f.context })
        .candidates,
    ).toHaveLength(1);
  });

  it("returns unavailable when the FTS table has an invalid format", () => {
    const f = fixture();
    const db = openOpenClawStateDatabase({ path: path.join(root!, "openclaw.sqlite") }).db;
    db.exec("CREATE TABLE knowledge_index_chunks_fts (chunk_id TEXT)");
    expect(
      f.store.search({ namespaceId: "ns-1", query: "配置", limit: 10, context: f.context }),
    ).toMatchObject({
      status: "unavailable",
      candidates: [],
    });
    expect(() =>
      f.store.search({ namespaceId: "ns-1", query: "配置", limit: 101, context: f.context }),
    ).toThrow(/limit/);
  });
});
