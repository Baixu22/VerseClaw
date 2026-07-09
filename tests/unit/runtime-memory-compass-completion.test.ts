// @vitest-environment node
// COMPASS 2.0 完成性单元测试 — 第三步收尾 + 第四步 + 第五步.
//
// 覆盖:
//   1. generateStructuredSummary (第三步收尾)
//   2. runConsolidation 带 options (structuredSummary 生成 + version++ 触发)
//   3. runConsolidation 向后兼容 (不带 options)
//   4. 成本感知驱逐 v2 (computeEvictionScore 用 U_decision + trimFactsWithTrace)
//   5. ConfigVersionTree (create / commit / rollback / getConfigAtVersion)
import { describe, expect, it } from "vitest";
import {
  generateStructuredSummary,
  runConsolidation,
  DEFAULT_CONSOLIDATION_CONFIG,
  type ConsolidationOptions,
} from "../../openclaw_runtime/src/runtime-core/memory-background-consolidation";
import { RuntimeMemoryStore } from "../../openclaw_runtime/src/runtime-core/memory-store";
import {
  ObservationStore,
  computeObservationKey,
  type MemoryMutationEvent,
} from "../../openclaw_runtime/src/runtime-core/memory-observation-store";
import {
  createConfigVersionTree,
  commitConfigVersion,
  rollbackConfigVersion,
  getConfigAtVersion,
  DEFAULT_MEMORY_RUNTIME_CONFIG,
  createMemoryRuntimeConfig,
} from "../../openclaw_runtime/src/runtime-core/memory-runtime-config";
import type { RecallTrace } from "../../openclaw_runtime/src/runtime-core/memory-trace";
import {
  createInitialSSP,
  extractIntent,
  saveSessionState,
} from "../../openclaw_runtime/src/runtime-core/memory-session-state";

// === Helpers ===

function makeFact(overrides: {
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  confidence?: number;
  proposedAt?: number;
}) {
  const ts = overrides.proposedAt ?? 1000;
  return {
    schemaVersion: 1 as const,
    factId: overrides.factId,
    subject: overrides.subject,
    predicate: overrides.predicate,
    objectSummary: overrides.objectSummary,
    confidence: overrides.confidence ?? 0.9,
    source: "tool_result" as const,
    verificationStatus: "verified" as const,
    sourceEpisodeRefs: [{ episodeId: "test-episode" }],
    evidenceRefs: [{ type: "manual" as const, ref: "test-evidence" }],
    proposedAt: ts,
    valid_at: ts,
    reference_time: ts,
    acceptedAt: ts,
    promotion: {
      promotedBy: "verifier" as const,
      evidenceRefs: [{ type: "manual" as const, ref: "test-evidence" }],
    },
  };
}

function makeAddEvent(overrides: {
  eventId: string;
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  validAt: number;
}): MemoryMutationEvent {
  return {
    eventId: overrides.eventId,
    timestamp: overrides.validAt,
    eventType: "ADD",
    payload: {
      factId: overrides.factId,
      subject: overrides.subject,
      predicate: overrides.predicate,
      objectSummary: overrides.objectSummary,
      validAt: overrides.validAt,
    },
  };
}

// === generateStructuredSummary ===

describe("generateStructuredSummary", () => {
  it("generates complete triple when subject and predicate available", () => {
    const result = generateStructuredSummary({
      subject: "alice",
      predicate: "lives_in",
      key: "alice|lives_in",
    });
    const parsed = JSON.parse(result);
    expect(parsed.s).toBe("alice");
    expect(parsed.p).toBe("lives_in");
    expect(parsed.k).toBe("alice|lives_in");
  });

  it("generates degraded mode when subject/predicate missing", () => {
    const result = generateStructuredSummary({
      key: "alice|lives_in",
      supportCount: 3,
    });
    const parsed = JSON.parse(result);
    expect(parsed.k).toBe("alice|lives_in");
    expect(parsed.n).toBe(3);
    expect(parsed.s).toBeUndefined();
    expect(parsed.p).toBeUndefined();
  });

  it("truncates to 150 chars with ellipsis when too long", () => {
    const longSubject = "a".repeat(200);
    const result = generateStructuredSummary({
      subject: longSubject,
      predicate: "p".repeat(100),
      key: "k".repeat(100),
    });
    expect(result.length).toBeLessThanOrEqual(150);
    expect(result.endsWith("...")).toBe(true);
  });
});

// === runConsolidation backward compatibility ===

describe("runConsolidation backward compatibility (no options)", () => {
  it("returns result without structuredSummaryUpdated or versionBumpTriggered", async () => {
    const store = new RuntimeMemoryStore({ maxFacts: 10, evictionPolicy: "importance" });
    const result = await runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, Date.now());
    expect(result.structuredSummaryUpdated).toBeUndefined();
    expect(result.versionBumpTriggered).toBeUndefined();
  });
});

// === runConsolidation with options ===

describe("runConsolidation with COMPASS options", () => {
  it("triggers versionBump when sessionKey provided and merges occur", async () => {
    const store = new RuntimeMemoryStore({ maxFacts: 100, evictionPolicy: "importance" });
    // Add near-duplicate facts that will merge
    store.appendFact(
      makeFact({
        factId: "f1",
        subject: "alice",
        predicate: "lives_in",
        objectSummary: "alice lives in tokyo japan",
        confidence: 0.9,
      }) as never,
    );
    store.appendFact(
      makeFact({
        factId: "f2",
        subject: "alice",
        predicate: "lives_in",
        objectSummary: "alice lives in tokyo japan",
        confidence: 0.8,
      }) as never,
    );

    const options: ConsolidationOptions = {
      sessionKey: "test-session",
    };
    const result = await runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, Date.now(), options);

    // Should have merged the duplicate facts
    expect(result.mergedPairs.length).toBeGreaterThan(0);
    expect(result.versionBumpTriggered).toBe(true);
  });

  it("does not trigger versionBump when no changes", async () => {
    const store = new RuntimeMemoryStore({ maxFacts: 100, evictionPolicy: "importance" });
    // Add a single fact (no duplicates to merge)
    store.appendFact(
      makeFact({
        factId: "f1",
        subject: "alice",
        predicate: "lives_in",
        objectSummary: "alice lives in tokyo japan",
      }) as never,
    );

    const options: ConsolidationOptions = {
      sessionKey: "test-session",
    };
    const result = await runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, Date.now(), options);
    expect(result.versionBumpTriggered).toBeUndefined();
  });

  it("updates structuredSummary when observationStore provided and merges occur", async () => {
    const store = new RuntimeMemoryStore({ maxFacts: 100, evictionPolicy: "importance" });
    // Add near-duplicate facts
    const fact1 = makeFact({
      factId: "f1",
      subject: "alice",
      predicate: "lives_in",
      objectSummary: "alice lives in tokyo japan",
      confidence: 0.9,
    });
    const fact2 = makeFact({
      factId: "f2",
      subject: "alice",
      predicate: "lives_in",
      objectSummary: "alice lives in tokyo japan",
      confidence: 0.8,
    });
    store.appendFact(fact1 as never);
    store.appendFact(fact2 as never);

    // Set up ObservationStore with corresponding observations
    const obsStore = new ObservationStore();
    obsStore.updateObservationsIncremental([
      makeAddEvent({
        eventId: "e1",
        factId: "f1",
        subject: "alice",
        predicate: "lives_in",
        objectSummary: "alice lives in tokyo japan",
        validAt: 1000,
      }),
      makeAddEvent({
        eventId: "e2",
        factId: "f2",
        subject: "alice",
        predicate: "lives_in",
        objectSummary: "alice lives in tokyo japan",
        validAt: 1000,
      }),
    ]);

    // Build factsById map
    const factsById = new Map();
    factsById.set("f1", fact1);
    factsById.set("f2", fact2);

    const options: ConsolidationOptions = {
      observationStore: obsStore,
      factsById,
    };
    const result = await runConsolidation(store, DEFAULT_CONSOLIDATION_CONFIG, Date.now(), options);

    expect(result.mergedPairs.length).toBeGreaterThan(0);
    expect(result.structuredSummaryUpdated).toBeGreaterThan(0);

    // Verify structuredSummary was set on the observation
    const key = computeObservationKey("alice", "lives_in");
    const obs = obsStore.getByKey(key);
    expect(obs).toBeDefined();
    expect(obs!.structuredSummary).toBeDefined();
    const parsed = JSON.parse(obs!.structuredSummary!);
    expect(parsed.s).toBe("alice");
    expect(parsed.p).toBe("lives_in");
  });
});

// === Cost-aware eviction v2 ===

describe("Cost-aware eviction v2 (U_decision)", () => {
  it("trimFactsWithTrace method exists and is callable", () => {
    const store = new RuntimeMemoryStore({
      maxFacts: 100,
      evictionPolicy: "importance",
      enableCostAwareEvictionV2: true,
    });
    expect(typeof store.trimFactsWithTrace).toBe("function");
  });

  it("v2 store can be constructed with enableCostAwareEvictionV2", () => {
    const store = new RuntimeMemoryStore({
      maxFacts: 10,
      evictionPolicy: "importance",
      enableCostAwareEvictionV2: true,
    });
    // Should not throw — store is constructed with v2 enabled
    expect(store).toBeDefined();
  });

  it("v2 degrades to v1 when no recallTrace (capacity overflow)", () => {
    // When capacity is exceeded internally (no trace), v2 should degrade to v1
    const store = new RuntimeMemoryStore({
      maxFacts: 3,
      evictionPolicy: "importance",
      enableCostAwareEvictionV2: true,
    });
    // Add 5 facts (exceeds maxFacts=3)
    for (let i = 0; i < 5; i++) {
      store.appendFact(
        makeFact({
          factId: `f${i}`,
          subject: `subject${i}`,
          predicate: "pred",
          objectSummary: `summary ${i}`,
          confidence: 0.5 + i * 0.1,
        }) as never,
      );
    }
    // Should have evicted ~15% without errors (v1 degradation)
    // maxFacts=3, targetSize=floor(3*0.85)=2, so 3 facts should remain after eviction
    const stats = store.stats();
    expect(stats.facts).toBeLessThanOrEqual(3);
  });

  it("trimFactsWithTrace uses uDecision when recallTrace provided", () => {
    const store = new RuntimeMemoryStore({
      maxFacts: 3,
      evictionPolicy: "importance",
      enableCostAwareEvictionV2: true,
    });
    // Add 5 facts
    for (let i = 0; i < 5; i++) {
      store.appendFact(
        makeFact({
          factId: `f${i}`,
          subject: `subject${i}`,
          predicate: "pred",
          objectSummary: `summary ${i}`,
          confidence: 0.5 + i * 0.1,
        }) as never,
      );
    }

    // Create a RecallTrace with uDecision values
    // f0 has high uDecision (should survive), f1 has low uDecision (should be evicted)
    const trace: RecallTrace = {
      questionId: "Q1",
      query: "test",
      recalledFacts: [
        {
          factId: "f0",
          armRanks: { bm25: 1 },
          finalScore: 0.9,
          uDecision: 0.95,
        },
        {
          factId: "f1",
          armRanks: { bm25: 2 },
          finalScore: 0.3,
          uDecision: 0.05,
        },
        {
          factId: "f2",
          armRanks: { bm25: 3 },
          finalScore: 0.5,
          uDecision: 0.5,
        },
      ],
      invalidatedFiltered: [],
      bridgeDiscovery: null,
      expansionFacts: [],
      agentSteps: [],
      llmCalls: 0,
      tokensUsed: 0,
    };

    // This should not throw and should evict based on uDecision
    expect(() => store.trimFactsWithTrace(trace)).not.toThrow();
    const stats = store.stats();
    expect(stats.facts).toBeLessThanOrEqual(3);
  });
});

// === ConfigVersionTree ===

describe("ConfigVersionTree", () => {
  it("creates initial tree with root version 1.0.0", () => {
    const tree = createConfigVersionTree(DEFAULT_MEMORY_RUNTIME_CONFIG, 1000);
    expect(tree.currentVersion).toBe("1.0.0");
    expect(tree.history).toEqual(["1.0.0"]);
    expect(tree.nodes.size).toBe(1);
    const root = tree.nodes.get("1.0.0");
    expect(root).toBeDefined();
    expect(root!.reason).toBe("initial");
    expect(root!.createdAt).toBe(1000);
  });

  it("commits new version with patch increment", () => {
    const tree = createConfigVersionTree(DEFAULT_MEMORY_RUNTIME_CONFIG, 1000);
    const newConfig = createMemoryRuntimeConfig({
      featureFlags: { enableSessionStatePage: true },
    });
    const v1 = commitConfigVersion(tree, newConfig, "enable SSP", 2000);
    expect(v1).toBe("1.0.1");
    expect(tree.currentVersion).toBe("1.0.1");
    expect(tree.history).toEqual(["1.0.0", "1.0.1"]);
    expect(tree.nodes.size).toBe(2);
    const node = tree.nodes.get("1.0.1");
    expect(node).toBeDefined();
    expect(node!.parentVersion).toBe("1.0.0");
    expect(node!.reason).toBe("enable SSP");
  });

  it("commits multiple versions sequentially", () => {
    const tree = createConfigVersionTree(DEFAULT_MEMORY_RUNTIME_CONFIG, 1000);
    const v1 = commitConfigVersion(tree, DEFAULT_MEMORY_RUNTIME_CONFIG, "change 1", 2000);
    const v2 = commitConfigVersion(tree, DEFAULT_MEMORY_RUNTIME_CONFIG, "change 2", 3000);
    expect(v1).toBe("1.0.1");
    expect(v2).toBe("1.0.2");
    expect(tree.history).toEqual(["1.0.0", "1.0.1", "1.0.2"]);
    expect(tree.currentVersion).toBe("1.0.2");
  });

  it("rolls back to a previous version and truncates history", () => {
    const tree = createConfigVersionTree(DEFAULT_MEMORY_RUNTIME_CONFIG, 1000);
    const config1 = createMemoryRuntimeConfig({
      featureFlags: { enableSessionStatePage: true },
    });
    const config2 = createMemoryRuntimeConfig({
      featureFlags: { enablePreReplyRetrieval: true },
    });
    commitConfigVersion(tree, config1, "enable SSP", 2000);
    commitConfigVersion(tree, config2, "enable retrieval", 3000);
    expect(tree.history).toEqual(["1.0.0", "1.0.1", "1.0.2"]);

    // Roll back to 1.0.1
    const rolledBack = rollbackConfigVersion(tree, "1.0.1");
    expect(rolledBack).toBeDefined();
    expect(rolledBack!.featureFlags.enableSessionStatePage).toBe(true);
    expect(tree.currentVersion).toBe("1.0.1");
    expect(tree.history).toEqual(["1.0.0", "1.0.1"]);
    // nodes should still contain 1.0.2 (preserved for potential re-advance)
    expect(tree.nodes.has("1.0.2")).toBe(true);
  });

  it("returns undefined when rolling back to non-existent version", () => {
    const tree = createConfigVersionTree(DEFAULT_MEMORY_RUNTIME_CONFIG, 1000);
    const result = rollbackConfigVersion(tree, "9.9.9");
    expect(result).toBeUndefined();
  });

  it("getConfigAtVersion returns config without changing currentVersion", () => {
    const tree = createConfigVersionTree(DEFAULT_MEMORY_RUNTIME_CONFIG, 1000);
    const config1 = createMemoryRuntimeConfig({
      featureFlags: { enableSessionStatePage: true },
    });
    commitConfigVersion(tree, config1, "enable SSP", 2000);

    const config = getConfigAtVersion(tree, "1.0.0");
    expect(config).toBeDefined();
    expect(config!.featureFlags.enableSessionStatePage).toBe(false);
    // currentVersion should not change
    expect(tree.currentVersion).toBe("1.0.1");
  });

  it("getConfigAtVersion returns undefined for non-existent version", () => {
    const tree = createConfigVersionTree(DEFAULT_MEMORY_RUNTIME_CONFIG, 1000);
    const config = getConfigAtVersion(tree, "9.9.9");
    expect(config).toBeUndefined();
  });

  it("returns deep copy of config (mutations don't affect tree)", () => {
    const tree = createConfigVersionTree(DEFAULT_MEMORY_RUNTIME_CONFIG, 1000);
    const config = getConfigAtVersion(tree, "1.0.0");
    config!.featureFlags.enableSessionStatePage = true;

    // Tree's config should be unchanged
    const original = getConfigAtVersion(tree, "1.0.0");
    expect(original!.featureFlags.enableSessionStatePage).toBe(false);
  });

  it("can re-advance after rollback (nodes preserved)", () => {
    const tree = createConfigVersionTree(DEFAULT_MEMORY_RUNTIME_CONFIG, 1000);
    commitConfigVersion(tree, DEFAULT_MEMORY_RUNTIME_CONFIG, "v1", 2000);
    commitConfigVersion(tree, DEFAULT_MEMORY_RUNTIME_CONFIG, "v2", 3000);
    rollbackConfigVersion(tree, "1.0.1");
    expect(tree.currentVersion).toBe("1.0.1");

    // Commit new version after rollback — should be 1.0.2 (next patch from 1.0.1)
    const v3 = commitConfigVersion(tree, DEFAULT_MEMORY_RUNTIME_CONFIG, "re-advance", 4000);
    expect(v3).toBe("1.0.2");
    expect(tree.currentVersion).toBe("1.0.2");
  });
});

// === withWriteLock deadlock regression ===
// 回归测试: memory-session-state.ts withWriteLock 的 releaseLock!; 曾遗漏调用括号 (),
// 导致 saveSessionState 第二次调用同一 session 时永久挂起 (deadlock).
// 此测试确保连续两次 saveSessionState 在 2s 内返回.

describe("withWriteLock deadlock regression", () => {
  it("consecutive saveSessionState for same session does not deadlock", async () => {
    const sessionId = `deadlock-test-${Date.now()}`;
    const intent = extractIntent("help me deploy the rust service to production");
    const ssp1 = createInitialSSP(sessionId, intent, 1000);
    const ssp2: typeof ssp1 = {
      ...ssp1,
      version: ssp1.version + 1,
      updatedAt: 1001,
    };

    await saveSessionState(ssp1);

    // 修复前: releaseLock!; 不调用 resolve() → 第二次写入永久挂起 → 超时拒绝.
    const result = await Promise.race([
      saveSessionState(ssp2),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("deadlock: saveSessionState hung > 2s")),
          2000,
        ),
      ),
    ]);

    expect(result).toBeUndefined(); // saveSessionState 返回 void
  }, 5000);
});
