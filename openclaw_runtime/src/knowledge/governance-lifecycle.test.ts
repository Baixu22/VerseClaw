import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../state/openclaw-state-db.js";
import { createMemoryWikiGovernedAdapter, createRoleMemoryKnowledgeStoreGovernedAdapter, createSekbKnowledgeStoreGovernedAdapter, type GovernedMutation } from "./governance-adapters.js";
import { GovernanceLifecycleCoordinator } from "./governance-lifecycle.js";
import { GovernanceStore, type GovernanceProposalRecord } from "./governance-store.js";
import { closeMemoryStore, getMemoryCard, setMemoryStorePath, storeMemoryCard } from "../memory/memory-store.js";
import { DistillationTool } from "./sekb/distillation-tool.js";
import { KnowledgeStore } from "./sekb/knowledge-store.js";
import { TrajectoryCapture } from "./sekb/trajectory-capture.js";

const tempRoots: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createStore(): GovernanceStore {
  const root = mkdtempSync(join(tmpdir(), "clawx-ks06-"));
  tempRoots.push(root);
  return new GovernanceStore({ database: { path: join(root, "state.sqlite") } });
}

function proposal(id: string, overrides: Partial<GovernanceProposalRecord> = {}): GovernanceProposalRecord {
  return {
    id,
    operation: "create",
    status: "proposed",
    reason: "governance lifecycle",
    sources: [],
    requiresUserConfirmation: true,
    revision: 1,
    contentDigest: `digest-${id}`,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

const ALL_OPERATIONS = ["create", "update", "merge", "archive", "revoke", "delete", "restore"] as const;

describe("KS-06 GovernanceStore proposal lifecycle", () => {
  it("transitions all seven operations from proposed to approved to committed with audit events", () => {
    const store = createStore();
    for (const operation of ALL_OPERATIONS) {
      const id = `proposal-${operation}`;
      store.saveProposal(proposal(id, { operation, contentDigest: `digest-${operation}` }));
      const approved = store.transitionProposal({
        proposalId: id,
        fromStatuses: ["proposed", "reviewing"],
        toStatus: "approved",
        expectedRevision: 1,
        expectedDigest: `digest-${operation}`,
        actorId: "user",
      });
      expect(approved.status).toBe("approved");
      expect(approved.revision).toBe(2);
      expect(approved.reviewedDigest).toBe(`digest-${operation}`);

      const committed = store.transitionProposal({
        proposalId: id,
        fromStatuses: ["approved"],
        toStatus: "committed",
        expectedRevision: 2,
      });
      expect(committed.status).toBe("committed");
      expect(committed.appliedAt).toBeTruthy();
    }
    expect(store.listProposals({ status: "committed" })).toHaveLength(ALL_OPERATIONS.length);
  });

  it("rejects stale revision and stale digest transitions", () => {
    const store = createStore();
    store.saveProposal(proposal("proposal-stale", { contentDigest: "digest-current", revision: 4 }));
    expect(() => store.transitionProposal({
      proposalId: "proposal-stale",
      fromStatuses: ["proposed"],
      toStatus: "approved",
      expectedRevision: 3,
    })).toThrow(/stale_revision/);
    expect(() => store.transitionProposal({
      proposalId: "proposal-stale",
      fromStatuses: ["proposed"],
      toStatus: "approved",
      expectedRevision: 4,
      expectedDigest: "digest-old",
    })).toThrow(/stale_digest/);
    expect(store.getProposal("proposal-stale")?.status).toBe("proposed");
  });

  it("rejects transitions from an unexpected status", () => {
    const store = createStore();
    store.saveProposal(proposal("proposal-status"));
    expect(() => store.transitionProposal({
      proposalId: "proposal-status",
      fromStatuses: ["approved"],
      toStatus: "committed",
    })).toThrow(/has status proposed/);
  });
});

describe("KS-06 governance lifecycle coordinator", () => {
  const mutation: GovernedMutation = {
    proposalId: "proposal-coordinator",
    operation: "archive",
    subjectId: "wiki-page-1",
    expectedRevision: "rev-1",
    contentDigest: "digest-1",
    idempotencyKey: "idem-1",
    sourceRefs: ["source:1"],
  };

  it("prepare -> commit returns an EffectReceipt-shaped result on adapter success", async () => {
    const adapter = createMemoryWikiGovernedAdapter({
      prepare: async () => ({ adapter: "memory-wiki", prepared: true }),
      commit: async () => ({ success: true }),
    });
    const coordinator = new GovernanceLifecycleCoordinator(() => adapter);
    const prepared = await coordinator.prepare("memory-wiki", mutation);
    expect(prepared.plan).toEqual({ adapter: "memory-wiki", prepared: true });
    const result = await coordinator.commit("memory-wiki", mutation, prepared.plan, new Date("2026-08-18T00:00:00.000Z"));
    expect(result.success).toBe(true);
    expect(result.receipt).toMatchObject({
      schema: "governance-lifecycle-receipt.v1",
      idempotencyKey: "idem-1",
      owner: "memory-wiki",
      operation: "archive",
      subjectId: "wiki-page-1",
      subjectRevision: "rev-1",
      contentDigest: "digest-1",
      status: "committed",
    });
  });

  it("returns duplicate success without calling adapter.commit for the same idempotency key and digest", async () => {
    const commit = vi.fn(async () => ({ success: true }));
    const adapter = createMemoryWikiGovernedAdapter({ commit });
    const coordinator = new GovernanceLifecycleCoordinator(() => adapter);

    const first = await coordinator.commit("memory-wiki", mutation, {});
    const second = await coordinator.commit("memory-wiki", mutation, {});

    expect(first.success).toBe(true);
    expect(second).toMatchObject({ success: true, duplicate: true, receipt: first.receipt });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("rejects a reused idempotency key when the content digest changes", async () => {
    const commit = vi.fn(async () => ({ success: true }));
    const adapter = createMemoryWikiGovernedAdapter({ commit });
    const coordinator = new GovernanceLifecycleCoordinator(() => adapter);

    await coordinator.commit("memory-wiki", mutation, {});
    const result = await coordinator.commit("memory-wiki", { ...mutation, contentDigest: "digest-2" }, {});

    expect(result).toMatchObject({
      success: false,
      conflict: { code: "idempotency_conflict" },
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("returns an explicit conflict when adapter commit fails", async () => {
    const adapter = createMemoryWikiGovernedAdapter({
      prepare: async () => ({ prepared: true }),
      commit: async () => ({ success: false, conflict: { code: "stale_revision", reason: "expected rev-1, actual rev-2" } }),
    });
    const coordinator = new GovernanceLifecycleCoordinator(() => adapter);
    const prepared = await coordinator.prepare("memory-wiki", mutation);
    const result = await coordinator.commit("memory-wiki", mutation, prepared.plan);
    expect(result.success).toBe(false);
    expect(result.receipt).toBeUndefined();
    expect(result.conflict).toMatchObject({ code: "stale_revision", reason: "expected rev-1, actual rev-2" });
  });

  it("returns adapter_missing when owner has no registered adapter", async () => {
    const coordinator = new GovernanceLifecycleCoordinator(() => undefined);
    const result = await coordinator.commit("memory-wiki", mutation, {});
    expect(result.success).toBe(false);
    expect(result.conflict?.code).toBe("adapter_missing");
  });

  it("compensates a committed receipt through the adapter", async () => {
    const adapter = createMemoryWikiGovernedAdapter({
      compensate: async (receipt) => ({ status: "compensated", receipt }),
    });
    const coordinator = new GovernanceLifecycleCoordinator(() => adapter);
    const result = await coordinator.commit("memory-wiki", mutation, {});
    expect(result.success).toBe(true);
    const compensation = await coordinator.compensate("memory-wiki", result.receipt!);
    expect(compensation.status).toBe("compensated");
  });

  it("returns partial when compensation throws", async () => {
    const adapter = createMemoryWikiGovernedAdapter({
      compensate: async () => { throw new Error("wiki.apply rollback failed"); },
    });
    const coordinator = new GovernanceLifecycleCoordinator(() => adapter);
    const result = await coordinator.commit("memory-wiki", mutation, {});
    const compensation = await coordinator.compensate("memory-wiki", result.receipt!);
    expect(compensation.status).toBe("partial");
    expect(compensation.reason).toContain("wiki.apply rollback failed");
  });
});

describe("KS-06 real SEKB governed adapter", () => {
  function createSekbStore(): KnowledgeStore {
    const root = mkdtempSync(join(tmpdir(), "clawx-ks06-sekb-"));
    tempRoots.push(root);
    return new KnowledgeStore({ database: { path: join(root, "state.sqlite") } });
  }

  function seedPrinciple(store: KnowledgeStore): string {
    const capture = new TrajectoryCapture({ store });
    const trajectoryId = capture.start_trajectory("connect PostgreSQL", "config/db", ["postgresql"]);
    capture.log_step(trajectoryId, "tool.call", { tool: "psql" }, { error: "connection refused" });
    capture.finish_trajectory(trajectoryId, "failure", "Connection refused");
    return new DistillationTool({ store }).confirm_and_save({
      cluster_summary: "PostgreSQL connection refused failures",
      source_trajectory_ids: [trajectoryId],
      suggested_principle: {
        title: "Check PG access",
        condition: "When PostgreSQL reports Connection refused",
        action: "Check pg_hba.conf and firewall rules",
        reason: "Most connection refusals are environment or configuration issues",
        task_types: ["config/db"],
        context_tags: ["postgresql"],
        criticality: "high",
      },
      confidence: 0.8,
    });
  }

  it("runs archive -> restore -> update -> revoke -> delete with real SQLite principles", async () => {
    const store = createSekbStore();
    const principleId = seedPrinciple(store);
    const adapter = createSekbKnowledgeStoreGovernedAdapter({ store });
    const coordinator = new GovernanceLifecycleCoordinator(() => adapter);
    const mutation = (overrides: Partial<GovernedMutation>): GovernedMutation => ({
      proposalId: "proposal-sekb-lifecycle",
      operation: "archive",
      subjectId: principleId,
      contentDigest: "digest-sekb",
      idempotencyKey: `idem-${overrides.operation ?? "archive"}`,
      sourceRefs: [],
      ...overrides,
    });

    const archivePlan = await coordinator.prepare("sekb", mutation({ operation: "archive" }));
    const archived = await coordinator.commit("sekb", mutation({ operation: "archive" }), archivePlan.plan);
    expect(archived.success).toBe(true);
    expect(store.get_principle(principleId).status).toBe("archived");

    const restorePlan = await coordinator.prepare("sekb", mutation({ operation: "restore" }));
    const restored = await coordinator.commit("sekb", mutation({ operation: "restore" }), restorePlan.plan);
    expect(restored.success).toBe(true);
    expect(store.get_principle(principleId).status).toBe("active");

    const updatePlan = await coordinator.prepare("sekb", mutation({ operation: "update", payload: { title: "Check PG access (updated)" } }));
    const updated = await coordinator.commit("sekb", mutation({ operation: "update", payload: { title: "Check PG access (updated)" } }), updatePlan.plan);
    expect(updated.success).toBe(true);
    expect(store.get_principle(principleId).title).toBe("Check PG access (updated)");

    const revokePlan = await coordinator.prepare("sekb", mutation({ operation: "revoke" }));
    const revoked = await coordinator.commit("sekb", mutation({ operation: "revoke" }), revokePlan.plan);
    expect(revoked.success).toBe(true);
    expect(store.get_principle(principleId).status).toBe("archived");
    expect(store.get_principle(principleId).metadata.sekbRevoked).toBe(true);

    const deletePlan = await coordinator.prepare("sekb", mutation({ operation: "delete" }));
    const deleted = await coordinator.commit("sekb", mutation({ operation: "delete" }), deletePlan.plan);
    expect(deleted.success).toBe(true);
    expect(() => store.get_principle(principleId)).toThrow(/not found/);
    const compensation = await coordinator.compensate("sekb", deleted.receipt!);
    expect(compensation.status).toBe("unrecoverable");
  });

  it("rejects stale revision and merge includes source refs", async () => {
    const store = createSekbStore();
    const principleId = seedPrinciple(store);
    const adapter = createSekbKnowledgeStoreGovernedAdapter({ store });
    const coordinator = new GovernanceLifecycleCoordinator(() => adapter);
    const base: GovernedMutation = {
      proposalId: "proposal-sekb-stale",
      operation: "archive",
      subjectId: principleId,
      contentDigest: "digest-sekb",
      idempotencyKey: "idem-stale",
      sourceRefs: [],
    };

    await expect(coordinator.prepare("sekb", {
      ...base,
      expectedRevision: "2020-01-01T00:00:00.000Z",
    })).rejects.toThrow(/stale_revision/);

    const mergeMutation: GovernedMutation = {
      ...base,
      operation: "merge",
      sourceRefs: ["trajectory:merged"],
    };
    const mergePlan = await coordinator.prepare("sekb", mergeMutation);
    const merged = await coordinator.commit("sekb", mergeMutation, mergePlan.plan);
    expect(merged.success).toBe(true);
    expect(store.get_principle(principleId).source_trajectories).toContain("trajectory:merged");
    expect(store.get_principle(principleId).metadata.mergedFrom).toEqual(["trajectory:merged"]);
  });
});

describe("KS-06 real Role Memory governed adapter", () => {
  afterEach(() => {
    closeMemoryStore();
  });

  function seedCard(path: string, id = "memory-card-1"): void {
    setMemoryStorePath(path);
    storeMemoryCard({
      id,
      type: "preference",
      scope: "role",
      scopeKey: null,
      roleTags: ["architect"],
      content: "Keep the Task Ledger projection durable.",
      evidence: [],
      evidenceRefs: [],
      confidence: 0.8,
      importance: 0.7,
      lastAccessedAt: "2026-08-18T00:00:00.000Z",
      createdAt: "2026-08-18T00:00:00.000Z",
      accessCount: 0,
      version: 1,
      status: "active",
      sensitivity: "normal",
      durability: "long_term",
      source: "user",
      expiresAt: null,
    });
  }

  it("runs update -> archive -> restore -> revoke -> delete with real role-memory.sqlite", async () => {
    const root = mkdtempSync(join(tmpdir(), "clawx-ks06-role-memory-"));
    tempRoots.push(root);
    const dbPath = join(root, "role-memory.sqlite");
    seedCard(dbPath);
    const adapter = createRoleMemoryKnowledgeStoreGovernedAdapter({ storePath: dbPath });
    const coordinator = new GovernanceLifecycleCoordinator(() => adapter);
    const mutation = (overrides: Partial<GovernedMutation>): GovernedMutation => ({
      proposalId: "proposal-role-memory-lifecycle",
      operation: "update",
      subjectId: "memory-card-1",
      contentDigest: "digest-role-memory",
      idempotencyKey: `idem-role-${overrides.operation ?? "update"}`,
      sourceRefs: [],
      ...overrides,
    });

    const updatePlan = await coordinator.prepare("memory-slot", mutation({
      operation: "update",
      expectedRevision: "1",
      payload: { content: "Keep the Task Ledger projection durable (updated)." },
    }));
    const updated = await coordinator.commit("memory-slot", mutation({
      operation: "update",
      payload: { content: "Keep the Task Ledger projection durable (updated)." },
    }), updatePlan.plan);
    expect(updated.success).toBe(true);
    expect(getMemoryCard("memory-card-1")?.content).toBe("Keep the Task Ledger projection durable (updated).");

    const archivePlan = await coordinator.prepare("memory-slot", mutation({ operation: "archive", expectedRevision: "2" }));
    const archived = await coordinator.commit("memory-slot", mutation({ operation: "archive" }), archivePlan.plan);
    expect(archived.success).toBe(true);
    expect(getMemoryCard("memory-card-1")?.status).toBe("archived");

    const restorePlan = await coordinator.prepare("memory-slot", mutation({ operation: "restore" }));
    const restored = await coordinator.commit("memory-slot", mutation({ operation: "restore" }), restorePlan.plan);
    expect(restored.success).toBe(true);
    expect(getMemoryCard("memory-card-1")?.status).toBe("active");

    const revokePlan = await coordinator.prepare("memory-slot", mutation({ operation: "revoke" }));
    const revoked = await coordinator.commit("memory-slot", mutation({ operation: "revoke" }), revokePlan.plan);
    expect(revoked.success).toBe(true);
    expect(getMemoryCard("memory-card-1")?.status).toBe("tombstone");

    const deletePlan = await coordinator.prepare("memory-slot", mutation({ operation: "delete" }));
    const deleted = await coordinator.commit("memory-slot", mutation({ operation: "delete" }), deletePlan.plan);
    expect(deleted.success).toBe(true);
    const compensation = await coordinator.compensate("memory-slot", deleted.receipt!);
    expect(compensation.status).toBe("unrecoverable");
  });

  it("rejects stale revision against the real memory card", async () => {
    const root = mkdtempSync(join(tmpdir(), "clawx-ks06-role-memory-stale-"));
    tempRoots.push(root);
    const dbPath = join(root, "role-memory.sqlite");
    seedCard(dbPath);
    const adapter = createRoleMemoryKnowledgeStoreGovernedAdapter({ storePath: dbPath });
    const coordinator = new GovernanceLifecycleCoordinator(() => adapter);
    await expect(coordinator.prepare("memory-slot", {
      proposalId: "proposal-role-memory-stale",
      operation: "archive",
      subjectId: "memory-card-1",
      expectedRevision: "99",
      contentDigest: "digest",
      idempotencyKey: "idem-stale",
      sourceRefs: [],
    })).rejects.toThrow(/stale_revision/);
  });
});
