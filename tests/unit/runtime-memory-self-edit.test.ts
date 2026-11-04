// @vitest-environment node
// Phase 4.4: Self-editing memory interface tests. Validates the four
// self-edit tools (memory_recall, memory_update, memory_forget,
// memory_strengthen) that allow an agent to actively manage its own memory.

import { describe, expect, it } from "vitest";
import {
  executeMemorySelfEditTool,
  getMemorySelfEditTool,
  MEMORY_SELF_EDIT_TOOLS,
  type MemorySelfEditToolContext,
} from "../../openclaw_runtime/src/runtime-core/memory-self-edit-tools";
import { RuntimeMemoryStore } from "../../openclaw_runtime/src/runtime-core/memory-store";
import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core";

function makeFact(
  id: string,
  overrides: Partial<RuntimeMemoryTemporalFact> = {},
): RuntimeMemoryTemporalFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: id,
    subject: `Subject_${id}`,
    predicate: "value",
    objectSummary: `Fact ${id} summary.`,
    confidence: 0.7,
    source: "tool_result",
    verificationStatus: "verified",
    valid_at: 100,
    reference_time: 100,
    acceptedAt: 100,
    ...overrides,
  });
}

function makeContext(store: RuntimeMemoryStore, now = 1000): MemorySelfEditToolContext {
  return { store, now };
}

describe("Phase 4.4: Self-editing memory interface", () => {
  describe("tool registry", () => {
    it("exports exactly 5 tools", () => {
      expect(MEMORY_SELF_EDIT_TOOLS).toHaveLength(5);
      const names = MEMORY_SELF_EDIT_TOOLS.map((t) => t.name);
      expect(names).toEqual([
        "memory_recall",
        "memory_update",
        "memory_forget",
        "memory_strengthen",
        "memory_find_related",
      ]);
    });

    it("each tool has name, description, parameters, and execute", () => {
      for (const tool of MEMORY_SELF_EDIT_TOOLS) {
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(tool.description.length).toBeGreaterThan(0);
        expect(typeof tool.parameters).toBe("object");
        expect(typeof tool.execute).toBe("function");
      }
    });

    it("getMemorySelfEditTool returns tool by name", () => {
      expect(getMemorySelfEditTool("memory_recall")?.name).toBe("memory_recall");
      expect(getMemorySelfEditTool("memory_update")?.name).toBe("memory_update");
      expect(getMemorySelfEditTool("memory_forget")?.name).toBe("memory_forget");
      expect(getMemorySelfEditTool("memory_strengthen")?.name).toBe("memory_strengthen");
    });

    it("getMemorySelfEditTool returns undefined for unknown name", () => {
      // @ts-expect-error — intentionally invalid name
      expect(getMemorySelfEditTool("memory_unknown")).toBeUndefined();
    });
  });

  describe("memory_recall", () => {
    it("returns matching facts from the store", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      store.appendFact(makeFact("f1", { subject: "UserPref" }));
      store.appendFact(makeFact("f2", { subject: "UserPref" }));
      store.appendFact(makeFact("f3", { subject: "OtherPref" }));

      const result = await executeMemorySelfEditTool(
        "memory_recall",
        { subject: "UserPref" },
        makeContext(store),
      );

      expect(result.ok).toBe(true);
      expect(result.tool).toBe("memory_recall");
      const data = result.data as Array<{ factId: string }>;
      expect(data).toHaveLength(2);
      expect(data.map((f) => f.factId)).toEqual(["f1", "f2"]);
    });

    it("returns all facts when no filter is provided", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      store.appendFact(makeFact("f1"));
      store.appendFact(makeFact("f2"));

      const result = await executeMemorySelfEditTool(
        "memory_recall",
        {},
        makeContext(store),
      );

      expect(result.ok).toBe(true);
      const data = result.data as Array<{ factId: string }>;
      expect(data).toHaveLength(2);
    });

    it("respects limit argument", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      for (let i = 0; i < 5; i++) {
        store.appendFact(makeFact(`f${i}`));
      }

      const result = await executeMemorySelfEditTool(
        "memory_recall",
        { limit: 2 },
        makeContext(store),
      );

      expect(result.ok).toBe(true);
      const data = result.data as Array<{ factId: string }>;
      expect(data).toHaveLength(2);
    });
  });

  describe("memory_update", () => {
    it("supersedes an existing fact with new information", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      store.appendFact(makeFact("old_fact", {
        subject: "OldSubject",
        objectSummary: "Old summary.",
        confidence: 0.5,
      }));

      const result = await executeMemorySelfEditTool(
        "memory_update",
        {
          factId: "old_fact",
          subject: "NewSubject",
          objectSummary: "New summary.",
          confidence: 0.9,
        },
        makeContext(store, 2000),
      );

      expect(result.ok).toBe(true);
      expect(result.tool).toBe("memory_update");
      const data = result.data as { oldFactId: string; newFactId: string };
      expect(data.oldFactId).toBe("old_fact");
      expect(data.newFactId).toContain("old_fact_superseded_");

      // The new fact exists in the store.
      const newFact = store.getFactById(data.newFactId);
      expect(newFact).toBeDefined();
      expect(newFact?.subject).toBe("NewSubject");
      expect(newFact?.objectSummary).toBe("New summary.");
      expect(newFact?.confidence).toBe(0.9);
      expect(newFact?.verificationStatus).toBe("agent_approved");

      // The old fact is invalidated (check via invalidation proposals).
      const invalidations = store.listInvalidations();
      const oldInvalidation = invalidations.find((inv) => inv.factId === "old_fact");
      expect(oldInvalidation).toBeDefined();
      expect(oldInvalidation?.reason).toBe("superseded");
      expect(oldInvalidation?.replacementFactId).toBe(data.newFactId);
      expect(oldInvalidation?.invalid_at).toBe(2000);
    });

    it("preserves memoryType from the old fact", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      store.appendFact(makeFact("proc_fact", {
        memoryType: "procedural",
      }));

      const result = await executeMemorySelfEditTool(
        "memory_update",
        { factId: "proc_fact", objectSummary: "Updated procedural." },
        makeContext(store, 2000),
      );

      expect(result.ok).toBe(true);
      const data = result.data as { newFactId: string };
      const newFact = store.getFactById(data.newFactId);
      expect(newFact?.memoryType).toBe("procedural");
    });

    it("fails when factId is missing", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      const result = await executeMemorySelfEditTool(
        "memory_update",
        {},
        makeContext(store),
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain("factId");
    });

    it("fails when fact is not found", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      const result = await executeMemorySelfEditTool(
        "memory_update",
        { factId: "nonexistent" },
        makeContext(store),
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain("not found");
    });
  });

  describe("memory_forget", () => {
    it("invalidates a fact with reason 'retracted' by default", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      store.appendFact(makeFact("forget_me"));

      const result = await executeMemorySelfEditTool(
        "memory_forget",
        { factId: "forget_me" },
        makeContext(store, 2000),
      );

      expect(result.ok).toBe(true);
      expect(result.tool).toBe("memory_forget");
      const data = result.data as { factId: string; reason: string };
      expect(data.factId).toBe("forget_me");
      expect(data.reason).toBe("retracted");

      // The fact is invalidated (check via invalidation proposals).
      const invalidations = store.listInvalidations();
      const inv = invalidations.find((i) => i.factId === "forget_me");
      expect(inv).toBeDefined();
      expect(inv?.reason).toBe("retracted");
      expect(inv?.invalid_at).toBe(2000);
    });

    it("rejects an agent claiming 'human_rejected' as reason", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      store.appendFact(makeFact("reject_me"));

      const result = await executeMemorySelfEditTool(
        "memory_forget",
        { factId: "reject_me", reason: "human_rejected" },
        makeContext(store, 2000),
      );

      expect(result.ok).toBe(false);
      expect(store.listInvalidations()).toEqual([]);
    });

    it("fails when fact is not found", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      const result = await executeMemorySelfEditTool(
        "memory_forget",
        { factId: "nonexistent" },
        makeContext(store),
      );
      expect(result.ok).toBe(false);
    });

    it("fails when factId is missing", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      const result = await executeMemorySelfEditTool(
        "memory_forget",
        {},
        makeContext(store),
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain("factId");
    });
  });

  describe("memory_strengthen", () => {
    it("increments usage count for the fact", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      store.appendFact(makeFact("strengthen_me"));

      // Before strengthening, usage count is 0.
      const beforeStats = store.getUsageStats();
      const beforeStat = beforeStats.find((s) => s.factId === "strengthen_me");
      expect(beforeStat?.count).toBe(0);

      const result = await executeMemorySelfEditTool(
        "memory_strengthen",
        { factId: "strengthen_me" },
        makeContext(store),
      );

      expect(result.ok).toBe(true);
      expect(result.tool).toBe("memory_strengthen");
      const data = result.data as { factId: string; usageCount: number };
      expect(data.factId).toBe("strengthen_me");
      expect(data.usageCount).toBe(1);

      // After strengthening, usage count is 1.
      const afterStats = store.getUsageStats();
      const afterStat = afterStats.find((s) => s.factId === "strengthen_me");
      expect(afterStat?.count).toBe(1);
    });

    it("can be called multiple times to further strengthen", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      store.appendFact(makeFact("multi"));

      for (let i = 1; i <= 3; i++) {
        const result = await executeMemorySelfEditTool(
          "memory_strengthen",
          { factId: "multi" },
          makeContext(store),
        );
        expect(result.ok).toBe(true);
        const data = result.data as { usageCount: number };
        expect(data.usageCount).toBe(i);
      }
    });

    it("fails when fact is not found", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      const result = await executeMemorySelfEditTool(
        "memory_strengthen",
        { factId: "nonexistent" },
        makeContext(store),
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("fails when factId is missing", async () => {
      const store = new RuntimeMemoryStore({ now: () => 1000 });
      const result = await executeMemorySelfEditTool(
        "memory_strengthen",
        {},
        makeContext(store),
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain("factId");
    });
  });

  describe("executeMemorySelfEditTool dispatch", () => {
    it("returns error for unknown tool name", async () => {
      const store = new RuntimeMemoryStore();
      // @ts-expect-error — intentionally invalid name
      const result = await executeMemorySelfEditTool("memory_unknown", {}, makeContext(store));
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Unknown tool");
    });
  });
});
