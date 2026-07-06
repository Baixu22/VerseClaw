// @vitest-environment node
// Phase 4.3: Type-aware retrieval slots. Validates that the memory context
// provider allocates dedicated retrieval quotas per memory type (semantic 4,
// episodic 2, procedural 2), applies type-appropriate sort orders, and
// redistributes unused slots so capacity is never wasted.

import { describe, expect, it } from "vitest";
import {
  createRuntimeMemoryProviderResult,
} from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryQueryableFact,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core";

const enabledConfig = {
  runtime: {
    memory: {
      provider: true,
    },
  },
};

function makeFact(
  id: string,
  overrides: Partial<RuntimeMemoryTemporalFact> = {},
): RuntimeMemoryTemporalFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: id,
    subject: "TestSubject",
    predicate: "has",
    objectSummary: `Fact ${id} summary.`,
    confidence: 0.7,
    source: "tool_result",
    verificationStatus: "verified",
    valid_at: 100,
    reference_time: 100,
    acceptedAt: 100,
    sourceEpisodeRefs: [
      {
        episodeId: "episode_test",
        taskId: "task_test",
        kind: "verifier_summary",
        idempotencyKey: "task_test:verifier:summary",
        reference_time: 10,
      },
    ],
    evidenceRefs: [
      { type: "test", ref: "tests/unit/runtime-memory-type-aware-retrieval.test.ts" },
    ],
    ...overrides,
  });
}

function getFactIds(result: { contextItems: Array<{ metadata?: { factId?: string } }> }): string[] {
  return result.contextItems
    .map((item) => item.metadata?.factId)
    .filter((id): id is string => typeof id === "string");
}

describe("Phase 4.3: Type-aware retrieval slots", () => {
  it("allocates slots per type: semantic 4, episodic 2, procedural 2", async () => {
    // 6 semantic + 4 episodic + 3 procedural = 13 facts.
    // With limit=8, slot minimums fill exactly: 4+2+2=8, no redistribution.
    const facts: RuntimeMemoryQueryableFact[] = [];
    for (let i = 0; i < 6; i++) {
      facts.push(makeFact(`sem_${i}`, { memoryType: "semantic" }));
    }
    for (let i = 0; i < 4; i++) {
      facts.push(makeFact(`epis_${i}`, { memoryType: "episodic" }));
    }
    for (let i = 0; i < 3; i++) {
      facts.push(makeFact(`proc_${i}`, { memoryType: "procedural" }));
    }

    const result = await createRuntimeMemoryProviderResult(
      { facts, config: enabledConfig },
      { tokenBudget: 8192, metadata: { limit: 8 } },
    );

    const ids = getFactIds(result);
    const semCount = ids.filter((id) => id.startsWith("sem_")).length;
    const episCount = ids.filter((id) => id.startsWith("epis_")).length;
    const procCount = ids.filter((id) => id.startsWith("proc_")).length;

    expect(semCount).toBe(4);
    expect(episCount).toBe(2);
    expect(procCount).toBe(2);
    expect(ids).toHaveLength(8);
  });

  it("redistributes unused slots to types with more facts", async () => {
    // 8 semantic + 0 episodic + 0 procedural.
    // Semantic slot is 4, episodic 2 + procedural 2 = 4 unused slots.
    // Redistribution gives semantic 4 + 4 = 8 (all semantic facts returned).
    const facts: RuntimeMemoryQueryableFact[] = [];
    for (let i = 0; i < 8; i++) {
      facts.push(makeFact(`sem_${i}`, { memoryType: "semantic" }));
    }

    const result = await createRuntimeMemoryProviderResult(
      { facts, config: enabledConfig },
      { tokenBudget: 8192 },
    );

    const ids = getFactIds(result);
    expect(ids).toHaveLength(8);
    expect(ids.every((id) => id.startsWith("sem_"))).toBe(true);
  });

  it("sorts episodic facts by recency (valid_at descending) first", async () => {
    // 3 episodic facts with different valid_at. With limit=2, only the 2
    // most recent survive (episodic slot limit is 2, sorted by valid_at desc).
    const facts: RuntimeMemoryQueryableFact[] = [
      makeFact("epis_old", { memoryType: "episodic", valid_at: 10 }),
      makeFact("epis_mid", { memoryType: "episodic", valid_at: 50 }),
      makeFact("epis_new", { memoryType: "episodic", valid_at: 200 }),
    ];

    const result = await createRuntimeMemoryProviderResult(
      { facts, config: enabledConfig },
      { tokenBudget: 8192, metadata: { limit: 2 } },
    );

    const ids = getFactIds(result);
    // Only 2 episodic facts fit (slot limit 2). The newest 2 survive.
    expect(ids).toHaveLength(2);
    expect(ids).toContain("epis_new");
    expect(ids).toContain("epis_mid");
    expect(ids).not.toContain("epis_old");
  });

  it("places procedural facts first in merge order (highest priority)", async () => {
    // Procedural facts should appear before semantic and episodic in the
    // result, since SLOT_PRIORITY_ORDER = [procedural, semantic, episodic].
    const facts: RuntimeMemoryQueryableFact[] = [
      makeFact("sem_0", { memoryType: "semantic" }),
      makeFact("epis_0", { memoryType: "episodic" }),
      makeFact("proc_0", { memoryType: "procedural" }),
    ];

    const result = await createRuntimeMemoryProviderResult(
      { facts, config: enabledConfig },
      { tokenBudget: 8192 },
    );

    const ids = getFactIds(result);
    expect(ids[0]).toBe("proc_0");
    expect(ids[1]).toBe("sem_0");
    expect(ids[2]).toBe("epis_0");
  });

  it("defaults facts without memoryType to semantic (backward compatible)", async () => {
    // 6 facts without memoryType → all treated as semantic.
    // Semantic slot is 4, plus 4 redistributed (from unused episodic/procedural
    // slots) = 8 total capacity. All 6 fit.
    const facts: RuntimeMemoryQueryableFact[] = [];
    for (let i = 0; i < 6; i++) {
      facts.push(makeFact(`default_${i}`));
    }

    const result = await createRuntimeMemoryProviderResult(
      { facts, config: enabledConfig },
      { tokenBudget: 8192 },
    );

    const ids = getFactIds(result);
    expect(ids).toHaveLength(6);
  });

  it("respects overall query limit even with redistribution", async () => {
    // 10 semantic facts, query.limit = 5.
    // Semantic slot 4 + redistributed 4 = 8 capacity, but overall limit is 5.
    const facts: RuntimeMemoryQueryableFact[] = [];
    for (let i = 0; i < 10; i++) {
      facts.push(makeFact(`sem_${i}`, { memoryType: "semantic" }));
    }

    const result = await createRuntimeMemoryProviderResult(
      { facts, config: enabledConfig },
      {
        tokenBudget: 8192,
        metadata: { limit: 5 },
      },
    );

    const ids = getFactIds(result);
    expect(ids.length).toBeLessThanOrEqual(5);
  });

  it("returns empty when no facts match", async () => {
    const result = await createRuntimeMemoryProviderResult(
      { facts: [], config: enabledConfig },
      { tokenBudget: 8192 },
    );

    expect(result.contextItems).toHaveLength(0);
    expect(result.summary.items).toHaveLength(0);
  });

  it("handles single-type overload: all procedural", async () => {
    // 5 procedural facts, slot limit 2 + 4 redistributed = 6 capacity.
    // All 5 fit.
    const facts: RuntimeMemoryQueryableFact[] = [];
    for (let i = 0; i < 5; i++) {
      facts.push(makeFact(`proc_${i}`, { memoryType: "procedural" }));
    }

    const result = await createRuntimeMemoryProviderResult(
      { facts, config: enabledConfig },
      { tokenBudget: 8192 },
    );

    const ids = getFactIds(result);
    expect(ids).toHaveLength(5);
    expect(ids.every((id) => id.startsWith("proc_"))).toBe(true);
  });
});
