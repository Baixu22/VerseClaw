// @vitest-environment node
// Phase 4 ablation/benefit test. Quantifies the positive benefit of the three
// new Phase 4 modules by comparing type-aware behavior (treatment) against the
// pre-Phase-4 baseline (control):
//
// 1. Eviction quality: type-aware eviction (importance policy + per-type weights)
//    preserves more procedural facts under capacity pressure vs uniform FIFO.
// 2. Retrieval diversity: type-aware slots produce context with all 3 memory
//    types represented vs rank-based retrieval which over-represents one type.
// 3. Self-edit effectiveness: memory_strengthen boosts usage signal, improving
//    a fact's survival odds under importance eviction.

import { describe, expect, it } from "vitest";
import {
  RuntimeMemoryStore,
} from "../../openclaw_runtime/src/runtime-core/memory-store";
import {
  buildRuntimeMemoryTemporalFactFixture,
  findRuntimeMemoryFacts,
  type RuntimeMemoryQueryableFact,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core";
import {
  createRuntimeMemoryProviderResult,
} from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import {
  executeMemorySelfEditTool,
  type MemorySelfEditToolContext,
} from "../../openclaw_runtime/src/runtime-core/memory-self-edit-tools";

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
        idempotencyKey: `task_test:verifier:${id}`,
        reference_time: 10,
      },
    ],
    evidenceRefs: [
      { type: "test", ref: "tests/unit/runtime-memory-phase4-ablation-benefit.test.ts" },
    ],
    ...overrides,
  });
}

function countSurvivors(store: RuntimeMemoryStore, prefix: string, count: number): number {
  let survivors = 0;
  for (let i = 0; i < count; i++) {
    if (store.getFactById(`${prefix}${i}`) !== undefined) survivors++;
  }
  return survivors;
}

function getFactIds(result: { contextItems: Array<{ metadata?: { factId?: string } }> }): string[] {
  return result.contextItems
    .map((item) => item.metadata?.factId)
    .filter((id): id is string => typeof id === "string");
}

// ---------------------------------------------------------------------------
// 1. Eviction quality: type-aware vs FIFO
// ---------------------------------------------------------------------------

describe("Phase 4 ablation: eviction quality (type-aware vs FIFO)", () => {
  const now = 8_640_000_000; // 100 days later — recency ≈ 0 for all old facts.

  function buildMixedFacts(): RuntimeMemoryTemporalFact[] {
    const facts: RuntimeMemoryTemporalFact[] = [];
    for (let i = 0; i < 5; i++) {
      facts.push(makeFact(`proc_${i}`, {
        memoryType: "procedural",
        subject: "SharedEviction",
        confidence: 0.7,
      }));
    }
    for (let i = 0; i < 5; i++) {
      facts.push(makeFact(`epis_${i}`, {
        memoryType: "episodic",
        subject: "SharedEviction",
        confidence: 0.7,
      }));
    }
    for (let i = 0; i < 5; i++) {
      facts.push(makeFact(`sem_${i}`, {
        memoryType: "semantic",
        subject: "SharedEviction",
        confidence: 0.7,
      }));
    }
    return facts;
  }

  it("type-aware eviction preserves more procedural facts than FIFO", () => {
    const facts = buildMixedFacts();

    // Control: FIFO eviction (pre-Phase-4 behavior).
    const fifoStore = new RuntimeMemoryStore({
      maxFacts: 10,
      evictionPolicy: "fifo",
      now: () => now,
    });
    for (const fact of facts) fifoStore.appendFact(fact);

    // Treatment: importance eviction with type-aware weights (Phase 4.2).
    const typeAwareStore = new RuntimeMemoryStore({
      maxFacts: 10,
      evictionPolicy: "importance",
      now: () => now,
    });
    for (const fact of facts) typeAwareStore.appendFact(fact);

    const fifoProcSurvivors = countSurvivors(fifoStore, "proc_", 5);
    const typeAwareProcSurvivors = countSurvivors(typeAwareStore, "proc_", 5);

    // FIFO evicts by insertion order — proc_0..4 are inserted first, so they
    // are evicted first. Type-aware eviction preserves all procedural facts.
    expect(typeAwareProcSurvivors).toBeGreaterThan(fifoProcSurvivors);
    expect(typeAwareProcSurvivors).toBe(5);
  });

  it("type-aware eviction preferentially evicts old episodic facts", () => {
    const facts = buildMixedFacts();

    const typeAwareStore = new RuntimeMemoryStore({
      maxFacts: 10,
      evictionPolicy: "importance",
      now: () => now,
    });
    for (const fact of facts) typeAwareStore.appendFact(fact);

    const episSurvivors = countSurvivors(typeAwareStore, "epis_", 5);
    const semSurvivors = countSurvivors(typeAwareStore, "sem_", 5);
    const procSurvivors = countSurvivors(typeAwareStore, "proc_", 5);

    // With recency ≈ 0, episodic has the lowest score (importance weight 0.3).
    expect(episSurvivors).toBeLessThan(semSurvivors);
    expect(episSurvivors).toBeLessThan(procSurvivors);
    expect(procSurvivors).toBeGreaterThan(episSurvivors);
  });

  it("type-aware eviction retention rate exceeds FIFO for procedural type", () => {
    const trials = 5;
    let typeAwareProcTotal = 0;
    let fifoProcTotal = 0;

    for (let trial = 0; trial < trials; trial++) {
      const facts = buildMixedFacts();
      const shuffled = [...facts].sort(() => Math.random() - 0.5);

      const fifoStore = new RuntimeMemoryStore({
        maxFacts: 10,
        evictionPolicy: "fifo",
        now: () => now,
      });
      for (const fact of shuffled) fifoStore.appendFact(fact);

      const typeAwareStore = new RuntimeMemoryStore({
        maxFacts: 10,
        evictionPolicy: "importance",
        now: () => now,
      });
      for (const fact of shuffled) typeAwareStore.appendFact(fact);

      typeAwareProcTotal += countSurvivors(typeAwareStore, "proc_", 5);
      fifoProcTotal += countSurvivors(fifoStore, "proc_", 5);
    }

    expect(typeAwareProcTotal).toBeGreaterThan(fifoProcTotal);
    expect(typeAwareProcTotal).toBe(5 * trials);
  });
});

// ---------------------------------------------------------------------------
// 2. Retrieval diversity: type-aware slots vs uniform rank-based
// ---------------------------------------------------------------------------

describe("Phase 4 ablation: retrieval diversity (type-aware slots vs rank-based)", () => {
  // Build facts where ALL types have identical rank (verified + 1 evidence +
  // 1 source episode = rank 1500). The tiebreaker is valid_at descending.
  // Semantic facts get the highest valid_at, so rank-based retrieval fills
  // all slots with semantic only — type-aware slots guarantee diversity.
  function buildDiverseFacts(): RuntimeMemoryQueryableFact[] {
    const facts: RuntimeMemoryQueryableFact[] = [];

    // 8 semantic facts with highest valid_at (rank tie → valid_at tiebreaker).
    for (let i = 0; i < 8; i++) {
      facts.push(makeFact(`sem_high_${i}`, {
        memoryType: "semantic",
        subject: "DiverseSubject",
        confidence: 0.7,
        verificationStatus: "verified",
        valid_at: 300,
      }));
    }
    // 3 episodic facts with lower valid_at.
    for (let i = 0; i < 3; i++) {
      facts.push(makeFact(`epis_low_${i}`, {
        memoryType: "episodic",
        subject: "DiverseSubject",
        confidence: 0.7,
        verificationStatus: "verified",
        valid_at: 200,
      }));
    }
    // 3 procedural facts with lowest valid_at.
    for (let i = 0; i < 3; i++) {
      facts.push(makeFact(`proc_low_${i}`, {
        memoryType: "procedural",
        subject: "DiverseSubject",
        confidence: 0.7,
        verificationStatus: "verified",
        valid_at: 100,
      }));
    }
    return facts;
  }

  it("type-aware slots produce context with all 3 memory types", async () => {
    const facts = buildDiverseFacts();

    const result = await createRuntimeMemoryProviderResult(
      { facts, config: enabledConfig },
      { tokenBudget: 8192, metadata: { limit: 8 } },
    );
    const ids = getFactIds(result);

    const hasSemantic = ids.some((id) => id.startsWith("sem_"));
    const hasEpisodic = ids.some((id) => id.startsWith("epis_"));
    const hasProcedural = ids.some((id) => id.startsWith("proc_"));

    expect(hasSemantic).toBe(true);
    expect(hasEpisodic).toBe(true);
    expect(hasProcedural).toBe(true);
  });

  it("rank-based retrieval (baseline) over-represents high-valid_at semantic facts", () => {
    const facts = buildDiverseFacts();

    // Control: uniform rank-based retrieval (pre-Phase-4 behavior).
    // All facts have rank 1500 (verified + evidence + source). Tiebreaker is
    // valid_at descending: semantic (300) > episodic (200) > procedural (100).
    const ranked = findRuntimeMemoryFacts(facts, { limit: 8 });

    const semCount = ranked.filter((f) => f.factId.startsWith("sem_")).length;
    const episCount = ranked.filter((f) => f.factId.startsWith("epis_")).length;
    const procCount = ranked.filter((f) => f.factId.startsWith("proc_")).length;

    // Rank-based retrieval fills all 8 slots with semantic facts (highest valid_at).
    expect(semCount).toBe(8);
    expect(episCount).toBe(0);
    expect(procCount).toBe(0);
  });

  it("type-aware slots type diversity exceeds rank-based retrieval", async () => {
    const facts = buildDiverseFacts();

    const typeAwareResult = await createRuntimeMemoryProviderResult(
      { facts, config: enabledConfig },
      { tokenBudget: 8192, metadata: { limit: 8 } },
    );
    const typeAwareIds = getFactIds(typeAwareResult);

    const rankBasedIds = findRuntimeMemoryFacts(facts, { limit: 8 }).map((f) => f.factId);

    function typeDiversity(ids: string[]): number {
      const types = new Set<string>();
      for (const id of ids) {
        if (id.startsWith("sem_")) types.add("semantic");
        if (id.startsWith("epis_")) types.add("episodic");
        if (id.startsWith("proc_")) types.add("procedural");
      }
      return types.size;
    }

    expect(typeDiversity(typeAwareIds)).toBe(3);
    expect(typeDiversity(rankBasedIds)).toBe(1);
    expect(typeDiversity(typeAwareIds)).toBeGreaterThan(typeDiversity(rankBasedIds));
  });

  it("type-aware slots include procedural facts even when they have lowest valid_at", async () => {
    const facts = buildDiverseFacts();

    const result = await createRuntimeMemoryProviderResult(
      { facts, config: enabledConfig },
      { tokenBudget: 8192, metadata: { limit: 8 } },
    );
    const ids = getFactIds(result);

    // Procedural facts have lowest valid_at (ranked last by rank-based) but
    // should still appear because they have a dedicated 2-slot quota.
    const procCount = ids.filter((id) => id.startsWith("proc_")).length;
    expect(procCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Self-edit effectiveness: memory_strengthen improves eviction survival
// ---------------------------------------------------------------------------

describe("Phase 4 ablation: self-edit effectiveness (memory_strengthen)", () => {
  const now = 8_640_000_000; // 100 days later — recency ≈ 0.

  it("strengthened fact survives eviction while unstrengthened control is evicted", () => {
    // Design: 7 high-importance + 1 strengthened + 1 control + 2 low-trigger = 11.
    // maxFacts=10, targetSize=8, evict 3. Bottom 3: trigger1, trigger2, control.
    // Strengthened fact survives because its usage boost raises its score above
    // the control and trigger facts.
    const store = new RuntimeMemoryStore({
      maxFacts: 10,
      evictionPolicy: "importance",
      now: () => now,
    });

    // 7 high-importance facts (guaranteed survivors).
    for (let i = 0; i < 7; i++) {
      store.appendFact(makeFact(`high_${i}`, {
        memoryType: "semantic",
        subject: "SharedStrengthen",
        confidence: 0.95,
        verificationStatus: "human_approved",
        source: "human_confirmation",
      }));
    }

    // 1 low-importance fact to be strengthened.
    store.appendFact(makeFact("low_strengthened", {
      memoryType: "semantic",
      subject: "SharedStrengthen",
      confidence: 0.4,
    }));

    // Strengthen it BEFORE inserting control/trigger (so the usage signal is
    // in place when eviction triggers during later insertions).
    const ctx: MemorySelfEditToolContext = { store, now };
    for (let i = 0; i < 5; i++) {
      executeMemorySelfEditTool("memory_strengthen", { factId: "low_strengthened" }, ctx);
    }

    // 1 low-importance control (NOT strengthened).
    store.appendFact(makeFact("low_control", {
      memoryType: "semantic",
      subject: "SharedStrengthen",
      confidence: 0.4,
    }));

    // 2 very-low-importance trigger facts to absorb eviction slots.
    store.appendFact(makeFact("trigger_1", {
      memoryType: "semantic",
      subject: "SharedStrengthen",
      confidence: 0.1,
    }));
    // Inserting trigger_2 makes 11 > 10, triggering eviction of 3.
    store.appendFact(makeFact("trigger_2", {
      memoryType: "semantic",
      subject: "SharedStrengthen",
      confidence: 0.1,
    }));

    // The strengthened fact should survive; control and triggers should be evicted.
    expect(store.getFactById("low_strengthened")).toBeDefined();
    expect(store.getFactById("low_control")).toBeUndefined();
  });

  it("memory_strengthen increments usage count", async () => {
    const store = new RuntimeMemoryStore({
      maxFacts: 100,
      evictionPolicy: "fifo",
      now: () => now,
    });
    store.appendFact(makeFact("target", {
      memoryType: "procedural",
      subject: "StrengthenCount",
    }));

    const ctx: MemorySelfEditToolContext = { store, now };

    const result1 = await executeMemorySelfEditTool("memory_strengthen", { factId: "target" }, ctx);
    expect(result1.ok).toBe(true);
    expect(result1.data).toMatchObject({ usageCount: 1 });

    const result2 = await executeMemorySelfEditTool("memory_strengthen", { factId: "target" }, ctx);
    expect(result2.ok).toBe(true);
    expect(result2.data).toMatchObject({ usageCount: 2 });

    const result3 = await executeMemorySelfEditTool("memory_strengthen", { factId: "target" }, ctx);
    expect(result3.ok).toBe(true);
    expect(result3.data).toMatchObject({ usageCount: 3 });
  });

  it("strengthened facts have higher survival rate than unstrengthened under capacity pressure", () => {
    // Design: 4 high + 5 strengthened (strengthened BEFORE control insertion) +
    // 5 control = 14. maxFacts=12, targetSize=10. Inserting the 13th fact
    // triggers eviction of 3. At that point, strengthened facts have usage
    // boost → higher scores. Control facts (score 0.52) are evicted first.
    const store = new RuntimeMemoryStore({
      maxFacts: 12,
      evictionPolicy: "importance",
      now: () => now,
    });

    // 4 high-importance facts (guaranteed survivors).
    for (let i = 0; i < 4; i++) {
      store.appendFact(makeFact(`high_${i}`, {
        memoryType: "semantic",
        subject: "SurvivalExperiment",
        confidence: 0.95,
        verificationStatus: "human_approved",
        source: "human_confirmation",
      }));
    }

    // 5 low-importance facts to be strengthened.
    for (let i = 0; i < 5; i++) {
      store.appendFact(makeFact(`low_strengthened_${i}`, {
        memoryType: "semantic",
        subject: "SurvivalExperiment",
        confidence: 0.4,
      }));
    }

    // Strengthen all 5 BEFORE inserting control facts, so the usage signal is
    // in place when eviction triggers during control fact insertion.
    const ctx: MemorySelfEditToolContext = { store, now };
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        executeMemorySelfEditTool(
          "memory_strengthen",
          { factId: `low_strengthened_${i}` },
          ctx,
        );
      }
    }

    // 5 control low-importance facts (NOT strengthened).
    // Inserting the 13th fact (low_control_2) triggers eviction: 13 > 12,
    // targetSize=10, evict 3. The 3 lowest are control facts (score 0.52).
    for (let i = 0; i < 5; i++) {
      store.appendFact(makeFact(`low_control_${i}`, {
        memoryType: "semantic",
        subject: "SurvivalExperiment",
        confidence: 0.4,
      }));
    }

    let strengthenedSurvivors = 0;
    let controlSurvivors = 0;
    for (let i = 0; i < 5; i++) {
      if (store.getFactById(`low_strengthened_${i}`) !== undefined) strengthenedSurvivors++;
      if (store.getFactById(`low_control_${i}`) !== undefined) controlSurvivors++;
    }

    // Strengthened group should have more survivors than control.
    expect(strengthenedSurvivors).toBeGreaterThan(controlSurvivors);
  });
});
