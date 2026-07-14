import { describe, expect, it, vi } from "vitest";

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
    await api.propose(proposal);

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
    await api.update(payload);

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

  it("returns error for unexpected gateway response shapes", async () => {
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValue("not-a-record"),
    };
    const { createMemoryApi } = await import("@electron/services/memory-api");
    const api = createMemoryApi({ gatewayManager: gatewayManager as never });

    const result = await api.list({ roleName: "architect" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unexpected gateway response");
  });
});
