// @vitest-environment node
// Phase 2.2: Background consolidation unit tests.
// Validates the three consolidation operations:
//   1. Prune: low-importance + stale facts invalidated with "expired"
//   2. Merge: near-duplicate same-subject facts merged (lower confidence absorbed)
//   3. Strengthen: high-usage facts identified for importance boost

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONSOLIDATION_CONFIG,
  runConsolidation,
  type ConsolidationConfig,
} from "../../openclaw_runtime/src/runtime-core/memory-background-consolidation";
import { RuntimeMemoryStore } from "../../openclaw_runtime/src/runtime-core/memory-store";
import type { RuntimeMemoryTemporalFact } from "../../openclaw_runtime/src/runtime-core/memory-context";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeFact(
  id: string,
  subject: string,
  predicate: string,
  objectSummary: string,
  overrides: Partial<RuntimeMemoryTemporalFact> = {},
): RuntimeMemoryTemporalFact {
  return {
    schemaVersion: 1,
    factId: id,
    subject,
    predicate,
    objectSummary,
    confidence: 0.7,
    source: "tool_result",
    verificationStatus: "verified",
    valid_at: 100,
    reference_time: 100,
    sourceEpisodeRefs: [
      {
        episodeId: `episode_${id}`,
        taskId: "task_1",
        kind: "tool_result",
        idempotencyKey: `task_1:tool_result:${id}`,
        reference_time: 100,
      },
    ],
    evidenceRefs: [{ type: "tool", ref: `tool_call_${id}` }],
    acceptedAt: 100,
    promotion: {
      promotedBy: "verifier",
      evidenceRefs: [{ type: "test", ref: `test_${id}` }],
    },
    ...overrides,
  };
}

describe("Phase 2.2: Background consolidation", () => {
  // === Prune tests ===

  describe("prune", () => {
    it("invalidates low-importance facts that are stale", () => {
      const now = 100000 + 20 * DAY_MS;
      let clock = 100000;
      const store = new RuntimeMemoryStore({ now: () => clock });

      // Low importance: confidence 0.0 + verified(0.1) + other(0) + evidence(0.05) = 0.15 < 0.2
      const stale = makeFact("stale1", "UserPref", "lang", "old setting", {
        confidence: 0.0,
        source: "other",
        acceptedAt: 100000,
        valid_at: 100000,
      });
      store.appendFact(stale);

      // High importance (confidence 0.9, verified, tool_result, evidence → high score)
      const important = makeFact("imp1", "UserPref", "theme", "dark mode", {
        confidence: 0.9,
        acceptedAt: 100000,
        valid_at: 100000,
      });
      store.appendFact(important);

      // Advance time past stale threshold (14 days)
      clock = now;
      const result = runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, now);

      expect(result.prunedFactIds).toContain("stale1");
      expect(result.prunedFactIds).not.toContain("imp1");
    });

    it("does not prune low-importance facts that were recently accessed", () => {
      const now = 100000 + 20 * DAY_MS;
      let clock = 100000;
      const store = new RuntimeMemoryStore({ now: () => clock });

      const lowImportance = makeFact("recent1", "UserPref", "lang", "old setting", {
        confidence: 0.0,
        source: "other",
        acceptedAt: 100000,
        valid_at: 100000,
      });
      store.appendFact(lowImportance);

      // Access it recently (well within 14-day stale window)
      clock = now - 1 * DAY_MS;
      store.recordFactAccess("recent1");

      clock = now;
      const result = runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, now);

      expect(result.prunedFactIds).not.toContain("recent1");
    });

    it("does not prune high-importance facts even when stale", () => {
      const now = 100000 + 30 * DAY_MS;
      const store = new RuntimeMemoryStore({ now: () => 100000 });

      const highImportance = makeFact("hi1", "UserPref", "theme", "dark mode", {
        confidence: 0.95,
        acceptedAt: 100000,
        valid_at: 100000,
        evidenceRefs: [{ type: "file", ref: "test.ts" }],
      });
      store.appendFact(highImportance);

      const result = runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, now);

      expect(result.prunedFactIds).not.toContain("hi1");
    });
  });

  // === Merge tests ===

  describe("merge", () => {
    it("merges near-duplicate same-subject facts, keeping higher confidence", () => {
      const now = 100000;
      const store = new RuntimeMemoryStore({ now: () => now });

      const lowConf = makeFact(
        "merge_low",
        "UserPref",
        "theme",
        "user prefers dark mode for the editor",
        { confidence: 0.5, acceptedAt: now, valid_at: now },
      );
      const highConf = makeFact(
        "merge_high",
        "UserPref",
        "theme_pref",
        "user prefers dark mode for the editor",
        { confidence: 0.9, acceptedAt: now, valid_at: now },
      );
      store.appendFact(lowConf);
      store.appendFact(highConf);

      const config: ConsolidationConfig = {
        ...DEFAULT_CONSOLIDATION_CONFIG,
        mergeSimilarityThreshold: 0.88,
      };
      const result = runConsolidation(store, config, now);

      expect(result.mergedPairs).toHaveLength(1);
      const pair = result.mergedPairs[0];
      expect(pair.survivorId).toBe("merge_high");
      expect(pair.absorbedId).toBe("merge_low");
      expect(pair.similarity).toBeGreaterThanOrEqual(0.88);
    });

    it("does not merge facts with different subjects", () => {
      const now = 100000;
      const store = new RuntimeMemoryStore({ now: () => now });

      const factA = makeFact(
        "a1",
        "UserPref",
        "theme",
        "user prefers dark mode for the editor",
        { confidence: 0.5, acceptedAt: now, valid_at: now },
      );
      const factB = makeFact(
        "b1",
        "ProjectConfig",
        "theme",
        "user prefers dark mode for the editor",
        { confidence: 0.9, acceptedAt: now, valid_at: now },
      );
      store.appendFact(factA);
      store.appendFact(factB);

      const result = runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, now);

      expect(result.mergedPairs).toHaveLength(0);
    });

    it("does not merge facts with low similarity", () => {
      const now = 100000;
      const store = new RuntimeMemoryStore({ now: () => now });

      const factA = makeFact(
        "diff_a",
        "UserPref",
        "theme",
        "dark mode editor preference",
        { confidence: 0.5, acceptedAt: now, valid_at: now },
      );
      const factB = makeFact(
        "diff_b",
        "UserPref",
        "language",
        "typescript backend development",
        { confidence: 0.9, acceptedAt: now, valid_at: now },
      );
      store.appendFact(factA);
      store.appendFact(factB);

      const result = runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, now);

      expect(result.mergedPairs).toHaveLength(0);
    });
  });

  // === Strengthen tests ===

  describe("strengthen", () => {
    it("identifies high-usage facts above P75", () => {
      const now = 100000;
      const store = new RuntimeMemoryStore({ now: () => now });

      // Create 8 facts with varying usage
      for (let i = 0; i < 8; i++) {
        const fact = makeFact(`u${i}`, "UserPref", `pref${i}`, `value ${i}`, {
          confidence: 0.8,
          acceptedAt: now,
          valid_at: now,
        });
        store.appendFact(fact);
      }

      // Access facts 0-5 with varying counts
      // u0: 1, u1: 2, u2: 3, u3: 4, u4: 5, u5: 6, u6: 0, u7: 0
      for (let count = 1; count <= 6; count++) {
        for (let j = 0; j < count; j++) {
          store.recordFactAccess(`u${count - 1}`);
        }
      }

      const result = runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, now);

      // P75 of [0, 0, 1, 2, 3, 4, 5, 6] at index 6 = 5
      // Facts with count > 5: u5 (count=6)
      expect(result.strengthenedFactIds).toContain("u5");
      expect(result.strengthenedFactIds).not.toContain("u6");
      expect(result.strengthenedFactIds).not.toContain("u0");
    });

    it("returns empty strengthen list when no facts have usage", () => {
      const now = 100000;
      const store = new RuntimeMemoryStore({ now: () => now });

      store.appendFact(
        makeFact("n1", "UserPref", "theme", "dark", {
          confidence: 0.8,
          acceptedAt: now,
          valid_at: now,
        }),
      );

      const result = runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, now);

      expect(result.strengthenedFactIds).toHaveLength(0);
    });
  });

  // === Batch size tests ===

  describe("batch size", () => {
    it("only processes up to batchSize facts", () => {
      const now = 100000 + 30 * DAY_MS;
      const store = new RuntimeMemoryStore({ now: () => 100000 });

      // Create 10 low-importance stale facts
      for (let i = 0; i < 10; i++) {
        store.appendFact(
          makeFact(`batch${i}`, "UserPref", `pref${i}`, `low value ${i}`, {
            confidence: 0.0,
            source: "other",
            acceptedAt: 100000,
            valid_at: 100000,
          }),
        );
      }

      const config: ConsolidationConfig = {
        ...DEFAULT_CONSOLIDATION_CONFIG,
        batchSize: 5,
      };
      const result = runConsolidation(store, config, now);

      // Only 5 facts processed (the first 5 in the batch)
      expect(result.prunedFactIds).toHaveLength(5);
    });
  });

  // === Edge cases ===

  describe("edge cases", () => {
    it("returns empty result for empty store", () => {
      const store = new RuntimeMemoryStore();
      const result = runConsolidation(store);

      expect(result.prunedFactIds).toHaveLength(0);
      expect(result.mergedPairs).toHaveLength(0);
      expect(result.strengthenedFactIds).toHaveLength(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("does not re-process facts that were already merged", () => {
      const now = 100000;
      const store = new RuntimeMemoryStore({ now: () => now });

      // Three similar facts: A (conf 0.3), B (conf 0.5), C (conf 0.9)
      store.appendFact(
        makeFact("m_a", "UserPref", "theme", "user prefers dark mode for the editor", {
          confidence: 0.3, acceptedAt: now, valid_at: now,
        }),
      );
      store.appendFact(
        makeFact("m_b", "UserPref", "theme_pref", "user prefers dark mode for the editor", {
          confidence: 0.5, acceptedAt: now, valid_at: now,
        }),
      );
      store.appendFact(
        makeFact("m_c", "UserPref", "preference", "user prefers dark mode for the editor", {
          confidence: 0.9, acceptedAt: now, valid_at: now,
        }),
      );

      const result = runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, now);

      // m_c should be the ultimate survivor (highest confidence), m_a and m_b absorbed.
      // m_b is a temporary survivor when paired with m_a, then absorbed by m_c.
      expect(result.mergedPairs).toHaveLength(2);
      const absorbedIds = result.mergedPairs.map((p) => p.absorbedId);
      expect(absorbedIds).toContain("m_a");
      expect(absorbedIds).toContain("m_b");
      expect(absorbedIds).not.toContain("m_c");
    });
  });

  // === Integration: 200-fact mixed scenario ===

  describe("200-fact mixed scenario", () => {
    it("prunes, merges, and strengthens correctly at scale", () => {
      const now = 500000 + 20 * DAY_MS;
      let clock = 500000;
      const store = new RuntimeMemoryStore({
        now: () => clock,
        maxFacts: 1000,
      });

      // 50 low-importance stale facts (should be pruned)
      for (let i = 0; i < 50; i++) {
        store.appendFact(
          makeFact(`low_${i}`, "StaleData", `field${i}`, `stale value ${i}`, {
            confidence: 0.0,
            source: "other",
            acceptedAt: 500000,
            valid_at: 500000,
          }),
        );
      }

      // 100 normal facts with unique subjects (no merge expected)
      for (let i = 0; i < 100; i++) {
        store.appendFact(
          makeFact(`norm_${i}`, `NormalSubject${i}`, `pred${i}`, `normal value ${i}`, {
            confidence: 0.7,
            acceptedAt: 500000,
            valid_at: 500000,
          }),
        );
      }

      // 20 pairs of near-duplicate facts (should be merged)
      for (let i = 0; i < 20; i++) {
        const subject = `DupSubject${i}`;
        store.appendFact(
          makeFact(`dup_low_${i}`, subject, `pred`, `duplicate content for testing merge ${i}`, {
            confidence: 0.4,
            acceptedAt: 500000,
            valid_at: 500000,
          }),
        );
        store.appendFact(
          makeFact(`dup_high_${i}`, subject, `pred_alt`, `duplicate content for testing merge ${i}`, {
            confidence: 0.85,
            acceptedAt: 500000,
            valid_at: 500000,
          }),
        );
      }

      // 10 high-usage facts (should be strengthened)
      for (let i = 0; i < 10; i++) {
        store.appendFact(
          makeFact(`hot_${i}`, "HotData", `field${i}`, `hot value ${i}`, {
            confidence: 0.8,
            acceptedAt: 500000,
            valid_at: 500000,
          }),
        );
        // Access each hot fact 10 times
        for (let j = 0; j < 10; j++) {
          store.recordFactAccess(`hot_${i}`);
        }
      }

      clock = now;
      const result = runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, now);

      // 50 low-importance stale facts should be pruned
      expect(result.prunedFactIds.length).toBe(50);
      for (let i = 0; i < 50; i++) {
        expect(result.prunedFactIds).toContain(`low_${i}`);
      }

      // 20 duplicate pairs should be merged (low confidence absorbed by high)
      expect(result.mergedPairs.length).toBe(20);
      for (let i = 0; i < 20; i++) {
        const pair = result.mergedPairs.find((p) => p.absorbedId === `dup_low_${i}`);
        expect(pair).toBeDefined();
        expect(pair!.survivorId).toBe(`dup_high_${i}`);
      }

      // Hot facts should be in strengthen list
      for (let i = 0; i < 10; i++) {
        expect(result.strengthenedFactIds).toContain(`hot_${i}`);
      }
    });
  });
});
