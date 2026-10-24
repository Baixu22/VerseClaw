import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("memory host API facade", () => {
  it("forwards list calls to memory.list with payload", async () => {
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({ success: true, cards: [] }),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const payload = { roleName: "architect", status: "all" as const, limit: 10 };
    const result = await api.list(payload);

    expect(gatewayManager.rpc).toHaveBeenCalledWith("memory.list", payload, 15_000);
    expect(result).toEqual({ success: true, cards: [] });
  });

  it("returns error when gateway manager is unavailable", async () => {
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: null });

    const result = await api.list({ roleName: "architect" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Gateway manager unavailable");
  });

  it("returns error when RPC throws", async () => {
    const gatewayManager = {
      rpc: vi.fn().mockRejectedValue(new Error("gateway timeout")),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const result = await api.list({ roleName: "architect" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Error: gateway timeout");
  });

  it("search aliases to memory.list with query payload", async () => {
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({ success: true, cards: [] }),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const payload = { query: "migration plan", roleName: "architect", topK: 5 };
    await api.search(payload);

    expect(gatewayManager.rpc).toHaveBeenCalledWith("memory.list", payload, 15_000);
  });

  it("forwards detail calls to memory.detail", async () => {
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({ success: true, card: { id: "card-1" } }),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const result = await api.detail({ id: "card-1" });

    expect(gatewayManager.rpc).toHaveBeenCalledWith("memory.detail", { id: "card-1" }, 15_000);
    expect(result.success).toBe(true);
  });

  it("wraps propose payload as { proposal: payload } for approval-gated RPC", async () => {
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({ success: true, decision: { accepted: true } }),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const proposal = {
      type: "constraint" as const,
      scope: "role" as const,
      roleTags: ["architect"],
      content: "Architects must review schema changes.",
      confidence: 0.9,
      importance: 0.8,
      source: "user",
      evidenceRefs: [{ type: "manual" as const, ref: "test" }],
    };
    await api.propose(proposal as never);

    expect(gatewayManager.rpc).toHaveBeenCalledWith(
      "memory.propose",
      { proposal },
      15_000,
    );
  });

  it("wraps preview payload for the existing read-only memory preview RPC", async () => {
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        success: true,
        preview: {
          operation: "create",
          proposal: {},
          normalized: {},
          decision: { action: "needs_review", accepted: false },
          conflicts: [],
          evidence: {},
          wouldWrite: false,
        },
      }),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });
    const proposal = {
      type: "procedure" as const,
      scope: "role" as const,
      content: "Verify each finding.",
    };

    const result = await api.previewProposal(proposal);

    expect(gatewayManager.rpc).toHaveBeenCalledWith(
      "memory.previewProposal",
      { proposal },
      15_000,
    );
    expect(result).toMatchObject({
      success: true,
      preview: { wouldWrite: false },
    });
  });

  it("forwards update calls to memory.update", async () => {
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({ success: true }),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const payload = { id: "card-1", patch: { content: "updated content" } };
    await api.update(payload as never);

    expect(gatewayManager.rpc).toHaveBeenCalledWith("memory.update", payload, 15_000);
  });

  it("forwards health calls to memory.health with empty object", async () => {
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        success: true,
        health: { ok: true, checkedAt: "2026-01-01", checks: [] },
      }),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const result = await api.health();

    expect(gatewayManager.rpc).toHaveBeenCalledWith("memory.health", {}, 15_000);
    expect(result.success).toBe(true);
    // Flattened: health fields at top level, not nested under .health
    expect(result.ok).toBe(true);
    expect(result.checkedAt).toBe("2026-01-01");
    expect(result.checks).toEqual([]);
  });

  it("forwards explainInjection calls to memory.explainInjection", async () => {
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({ success: true, injections: [] }),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const payload = { sessionKey: "agent:main:main", limit: 5 };
    await api.explainInjection(payload);

    expect(gatewayManager.rpc).toHaveBeenCalledWith("memory.explainInjection", payload, 15_000);
  });

  it("wraps bare success objects (no success field) as HostSuccess", async () => {
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({ cards: [{ id: "bare-card" }] }),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const result = await api.list({ roleName: "architect" });

    expect(result.success).toBe(true);
    expect(result.cards).toEqual([{ id: "bare-card" }]);
  });

  it("returns a canonical product boundary with memory.surface data", async () => {
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue({
        success: true,
        schemaVersion: "MemorySurface/v1",
        generatedAt: "2026-10-23T00:00:00.000Z",
        accepted: [],
        candidates: [],
        status: {
          roleMemory: {
            owner: "role-memory-card-governance", enabled: true, readGate: "open", writeGate: "open",
            candidateCapture: true, candidatePersistence: true, modelRetrieval: true,
          },
          runtimeMemory: {
            owner: "runtime-memory-store", enabled: false, readGate: "closed", writeGate: "closed",
            candidateCapture: false, candidatePersistence: false, modelRetrieval: false,
            persist: false, provider: false, injectionPilotEnabled: true, injectionProviders: ["role-memory"],
          },
          legacySources: [],
        },
        model: {
          acceptedOnly: true,
          acceptedKeys: [],
          candidateKeysExcluded: [],
          candidateBoundary: "Candidates are not model-visible.",
        },
        counts: { accepted: 0, candidates: 0, modelVisible: 0 },
      }),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const result = await api.surface({ limit: 25 });

    expect(gatewayManager.rpc).toHaveBeenCalledWith("memory.surface", { limit: 25 }, 15_000);
    expect(result.success).toBe(true);
    expect(result.model.productDescription).toContain("one reviewable product concept");
    expect(result.model.approvalBoundary).toContain("Candidates and derived signals");
  });

  it("dispatches role and runtime candidate approval only to their owning RPCs", async () => {
    const gatewayManager = {
      rpc: vi.fn()
        .mockResolvedValueOnce({ success: true, accepted: true, card: { id: "card-2" } })
        .mockResolvedValueOnce({ success: true, confirmed: true, factId: "fact-2", message: "persisted" }),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const role = await api.approveCandidate({ source: "role-memory-card", id: "proposal-1" });
    const runtime = await api.approveCandidate({ source: "runtime-fact", id: "fact-1" });

    expect(gatewayManager.rpc).toHaveBeenNthCalledWith(1, "memory.review", { id: "proposal-1", action: "approve" }, 15_000);
    expect(gatewayManager.rpc).toHaveBeenNthCalledWith(2, "memory.proposeFacts.confirm", {
      factId: "fact-1",
      approvedBy: "agent:clawx-memory-surface",
    }, 15_000);
    expect(role).toMatchObject({ success: true, approved: true, acceptedId: "card-2" });
    expect(runtime).toMatchObject({ success: true, approved: true, acceptedId: "fact-2" });
  });

  it("forwards delete and creates Remember this as an ordinary proposal", async () => {
    const gatewayManager = {
      rpc: vi.fn()
        .mockResolvedValueOnce({ success: true, deleted: true, source: "role-memory-card", id: "card-1", state: "tombstone" })
        .mockResolvedValueOnce({ success: true, accepted: false, action: "needs_review", reason: "duplicate", proposal: { id: "proposal-2" } }),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const deleted = await api.delete({ source: "role-memory-card", id: "card-1", reason: "test" });
    const remembered = await api.remember({
      content: "  Use pnpm.  ",
      scope: "workspace",
      scopeKey: "D:/repo",
      roleTags: ["architect"],
      sensitivity: "normal",
    });

    expect(gatewayManager.rpc).toHaveBeenNthCalledWith(1, "memory.delete", {
      source: "role-memory-card", id: "card-1", reason: "test",
    }, 15_000);
    expect(gatewayManager.rpc).toHaveBeenNthCalledWith(2, "memory.propose", {
      proposal: expect.objectContaining({
        type: "fact",
        scope: "workspace",
        scopeKey: "D:/repo",
        roleTags: ["architect"],
        content: "Use pnpm.",
        source: "user",
        confidence: 0.9,
        importance: 0.7,
        evidenceRefs: [{ type: "manual", ref: "memory-surface:explicit-remember" }],
      }),
    }, 15_000);
    expect(deleted).toMatchObject({ success: true, deleted: true, state: "tombstone" });
    expect(remembered).toMatchObject({ success: true, accepted: false, reviewRequired: true, proposalId: "proposal-2" });
  });

  it("exports a redacted, hashed disk snapshot through memory.surface", async () => {
    const exportDir = mkdtempSync(join(tmpdir(), "clawx-memory-export-"));
    try {
      const snapshot = {
        success: true,
        schemaVersion: "MemorySurface/v1",
        generatedAt: "2026-10-23T00:00:00.000Z",
        accepted: [{
          key: "role-memory-card:secret-1", id: "secret-1", source: "role-memory-card", state: "accepted",
          stateLabel: "active", content: "must not leave disk export", scope: "workspace", scopeKey: null,
          roleTags: [], sourceLabel: "user", createdAt: "2026-10-23T00:00:00.000Z", updatedAt: null,
          sensitivity: "secret", confidence: 0.9, importance: 0.9, evidenceCount: 0, provenance: [],
          injectable: false, retrievable: false, modelVisible: false, deletable: true,
        }],
        candidates: [],
        status: {
          roleMemory: { owner: "role-memory-card-governance", enabled: true, readGate: "open", writeGate: "open", candidateCapture: true, candidatePersistence: true, modelRetrieval: true },
          runtimeMemory: { owner: "runtime-memory-store", enabled: false, readGate: "closed", writeGate: "closed", candidateCapture: false, candidatePersistence: false, modelRetrieval: false, persist: false, provider: false, injectionPilotEnabled: true, injectionProviders: ["role-memory"] },
          legacySources: [],
        },
        model: {
          acceptedOnly: true, acceptedKeys: [], candidateKeysExcluded: [], candidateBoundary: "Only accepted memory enters prompts.",
          productDescription: "Memory", approvalBoundary: "Accepted only.",
        },
        counts: { accepted: 1, candidates: 0, modelVisible: 0 },
      };
      const gatewayManager = { rpc: vi.fn().mockResolvedValue(snapshot) };
      const { createMemoryApi } = await import("@electron/services/memory-api");
      const api = createMemoryApi({ gatewayManager: gatewayManager as never, exportDir });

      const result = await api.export({ format: "json" });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const content = readFileSync(result.path, "utf8");
      const exported = JSON.parse(content) as {
        snapshot: { success?: boolean; model: { productDescription: string; approvalBoundary: string } };
      };
      expect(content).not.toContain("must not leave disk export");
      expect(content).toContain("[redacted]");
      expect(exported.snapshot.success).toBeUndefined();
      expect(exported.snapshot.model.productDescription).toContain("one reviewable product concept");
      expect(exported.snapshot.model.approvalBoundary).toContain("Candidates and derived signals");
      expect(result.counts).toEqual({ accepted: 1, candidates: 0, redacted: 1 });
      expect(result.sha256).toBe(createHash("sha256").update(content).digest("hex"));
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
    }
  });
});
