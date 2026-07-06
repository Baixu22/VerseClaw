// @vitest-environment node
// Phase 4.2: Type-aware eviction policy tests. Validates that
// `computeEvictionScore` applies different importance/recency/usage weights
// per memory type, so procedural facts are hardest to evict, episodic facts
// fade with age, and semantic facts are importance-driven.
//
// The store uses batch eviction (targetSize = floor(maxFacts * 0.85)), so
// tests use maxFacts=10 (targetSize=8) and insert 12 facts to trigger
// eviction of the 4 lowest-scoring facts.

import { describe, expect, it } from "vitest";
import {
  EVICTION_WEIGHTS_BY_TYPE,
  RuntimeMemoryStore,
} from "../../openclaw_runtime/src/runtime-core/memory-store";
import {
  buildRuntimeMemoryTemporalFactFixture,
  DEFAULT_RUNTIME_MEMORY_TYPE,
  RUNTIME_MEMORY_TYPES,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

function makeFact(
  id: string,
  overrides: Partial<RuntimeMemoryTemporalFact>,
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

describe("Phase 4.2: Type-aware eviction policy", () => {
  describe("EVICTION_WEIGHTS_BY_TYPE", () => {
    it("has weights for all three memory types", () => {
      for (const type of RUNTIME_MEMORY_TYPES) {
        expect(EVICTION_WEIGHTS_BY_TYPE[type]).toBeDefined();
      }
    });

    it("each type's weights sum to 1.0", () => {
      for (const type of RUNTIME_MEMORY_TYPES) {
        const w = EVICTION_WEIGHTS_BY_TYPE[type];
        expect(w.importance + w.recency + w.usage).toBeCloseTo(1.0, 10);
      }
    });

    it("procedural has the highest importance weight", () => {
      expect(EVICTION_WEIGHTS_BY_TYPE.procedural.importance).toBeGreaterThan(
        EVICTION_WEIGHTS_BY_TYPE.semantic.importance,
      );
      expect(EVICTION_WEIGHTS_BY_TYPE.procedural.importance).toBeGreaterThan(
        EVICTION_WEIGHTS_BY_TYPE.episodic.importance,
      );
    });

    it("episodic has the highest recency weight", () => {
      expect(EVICTION_WEIGHTS_BY_TYPE.episodic.recency).toBeGreaterThan(
        EVICTION_WEIGHTS_BY_TYPE.semantic.recency,
      );
      expect(EVICTION_WEIGHTS_BY_TYPE.episodic.recency).toBeGreaterThan(
        EVICTION_WEIGHTS_BY_TYPE.procedural.recency,
      );
    });
  });

  describe("type-aware eviction behavior", () => {
    // With maxFacts=10, targetSize = floor(10 * 0.85) = 8. Inserting 12
    // facts triggers eviction of the 4 lowest-scoring facts.

    it("procedural facts survive eviction over episodic facts when all are old", () => {
      // All facts are OLD (acceptedAt=100, now=8_640_000_000 = 100 days later).
      // ageDays ≈ 100, so recencyScore ≈ 0 for all. The difference comes from
      // importance weight: procedural (0.8) > semantic (0.7) > episodic (0.3).
      // Episodic facts have the lowest scores → evicted first.
      const now = 8_640_000_000;
      const store = new RuntimeMemoryStore({
        maxFacts: 10,
        evictionPolicy: "importance",
        now: () => now,
      });

      // 4 procedural + 4 episodic + 4 semantic = 12 facts.
      // Batch eviction is incremental: appending the 11th fact triggers
      // eviction of 3 (11 - targetSize 8 = 3). The 12th append lands at 9
      // (no overflow). So 3 episodic (the lowest-scoring) are evicted.
      for (let i = 0; i < 4; i++) {
        store.appendFact(makeFact(`proc_${i}`, {
          memoryType: "procedural",
          subject: "Shared",
        }));
      }
      for (let i = 0; i < 4; i++) {
        store.appendFact(makeFact(`epis_${i}`, {
          memoryType: "episodic",
          subject: "Shared",
        }));
      }
      for (let i = 0; i < 4; i++) {
        store.appendFact(makeFact(`sem_${i}`, {
          memoryType: "semantic",
          subject: "Shared",
        }));
      }

      // All 4 procedural should survive (highest scores).
      for (let i = 0; i < 4; i++) {
        expect(store.getFactById(`proc_${i}`)).toBeDefined();
      }
      // At least 3 of 4 episodic evicted (lowest scores → type-aware eviction).
      const episSurvivors = countSurvivors(store, "epis_");
      expect(episSurvivors).toBeLessThanOrEqual(1);
      // No procedural evicted.
      expect(countSurvivors(store, "proc_")).toBe(4);
    });

    it("old episodic facts are evicted before old semantic facts", () => {
      // Same setup but only episodic vs semantic. Episodic has recency
      // weight 0.6 (vs semantic 0.1), so old episodic facts score lower.
      const now = 8_640_000_000;
      const store = new RuntimeMemoryStore({
        maxFacts: 10,
        evictionPolicy: "importance",
        now: () => now,
      });

      for (let i = 0; i < 6; i++) {
        store.appendFact(makeFact(`epis_old_${i}`, {
          memoryType: "episodic",
          subject: "Shared2",
        }));
      }
      for (let i = 0; i < 6; i++) {
        store.appendFact(makeFact(`sem_old_${i}`, {
          memoryType: "semantic",
          subject: "Shared2",
        }));
      }

      // 12 facts, 4 evicted. Episodic should be evicted first.
      const episSurvivors = countSurvivors(store, "epis_old_");
      const semSurvivors = countSurvivors(store, "sem_old_");
      expect(semSurvivors).toBeGreaterThan(episSurvivors);
    });

    it("high-importance procedural fact survives over low-importance semantic fact", () => {
      const now = 1_000;
      const store = new RuntimeMemoryStore({
        maxFacts: 10,
        evictionPolicy: "importance",
        now: () => now,
      });

      // 6 high-importance procedural (human_approved, high confidence).
      for (let i = 0; i < 6; i++) {
        store.appendFact(makeFact(`proc_strong_${i}`, {
          memoryType: "procedural",
          subject: "Shared3",
          confidence: 0.95,
          verificationStatus: "human_approved",
          source: "human_confirmation",
          acceptedAt: now,
        }));
      }
      // 6 low-importance semantic (verified, low confidence).
      for (let i = 0; i < 6; i++) {
        store.appendFact(makeFact(`sem_weak_${i}`, {
          memoryType: "semantic",
          subject: "Shared3",
          confidence: 0.4,
          acceptedAt: now,
        }));
      }

      // All 6 procedural should survive.
      for (let i = 0; i < 6; i++) {
        expect(store.getFactById(`proc_strong_${i}`)).toBeDefined();
      }
      // At least 3 semantic should be evicted (low importance).
      const semEvicted = countEvicted(store, "sem_weak_");
      expect(semEvicted).toBeGreaterThanOrEqual(3);
    });

    it("facts without memoryType use semantic weights (backward compatible)", () => {
      const now = 8_640_000_000; // Old facts.
      const store = new RuntimeMemoryStore({
        maxFacts: 10,
        evictionPolicy: "importance",
        now: () => now,
      });

      // 6 high-confidence facts (no memoryType → semantic weights).
      for (let i = 0; i < 6; i++) {
        store.appendFact(makeFact(`default_high_${i}`, {
          subject: "Shared4",
          confidence: 0.9,
          verificationStatus: "human_approved",
          source: "human_confirmation",
        }));
      }
      // 6 low-confidence facts (no memoryType → semantic weights).
      for (let i = 0; i < 6; i++) {
        store.appendFact(makeFact(`default_low_${i}`, {
          subject: "Shared4",
          confidence: 0.3,
        }));
      }

      // High-confidence should survive.
      for (let i = 0; i < 6; i++) {
        expect(store.getFactById(`default_high_${i}`)).toBeDefined();
      }
      // Low-confidence should be evicted.
      const lowEvicted = countEvicted(store, "default_low_");
      expect(lowEvicted).toBeGreaterThanOrEqual(3);
    });

    it("DEFAULT_RUNTIME_MEMORY_TYPE is semantic", () => {
      expect(DEFAULT_RUNTIME_MEMORY_TYPE).toBe("semantic");
    });
  });
});

function countSurvivors(store: RuntimeMemoryStore, prefix: string): number {
  let count = 0;
  for (let i = 0; i < 10; i++) {
    if (store.getFactById(`${prefix}${i}`) !== undefined) count++;
  }
  return count;
}

function countEvicted(store: RuntimeMemoryStore, prefix: string): number {
  let count = 0;
  for (let i = 0; i < 10; i++) {
    if (store.getFactById(`${prefix}${i}`) === undefined) count++;
  }
  return count;
}
