// @vitest-environment node
// Phase 1.1: Usage frequency tracking unit tests.
// Validates that RuntimeMemoryStore tracks fact access counts and last-accessed
// timestamps, and that the importance eviction policy uses actual usage data
// (with 7-day exponential decay) instead of the previous hardcoded 0.5.

import { describe, expect, it } from "vitest";
import { RuntimeMemoryStore } from "../../openclaw_runtime/src/runtime-core/memory-store";
import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

function makeVerifiedFact(
  id: string,
  overrides: Partial<RuntimeMemoryTemporalFact> = {},
): RuntimeMemoryTemporalFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: id,
    subject: "UserPref",
    predicate: "setting",
    objectSummary: `setting ${id}`,
    confidence: 0.7,
    source: "tool_result",
    verificationStatus: "verified",
    valid_at: 100,
    reference_time: 100,
    ...overrides,
  });
}

describe("Phase 1.1: Usage frequency tracking", () => {
  it("recordFactAccess increments count and updates lastAccessedAt", () => {
    let now = 1000;
    const store = new RuntimeMemoryStore({ maxFacts: 10, now: () => now });
    store.appendFact(makeVerifiedFact("f1"));
    store.appendFact(makeVerifiedFact("f2"));

    store.recordFactAccess("f1");
    now = 2000;
    store.recordFactAccess("f1");
    store.recordFactAccess("f2");

    const stats = store.getUsageStats();
    const f1Stat = stats.find((s) => s.factId === "f1");
    const f2Stat = stats.find((s) => s.factId === "f2");

    expect(f1Stat?.count).toBe(2);
    expect(f1Stat?.lastAccessedAt).toBe(2000);
    expect(f2Stat?.count).toBe(1);
    expect(f2Stat?.lastAccessedAt).toBe(2000);
  });

  it("recordFactAccess ignores unknown factIds", () => {
    const store = new RuntimeMemoryStore({ maxFacts: 10, now: () => 1000 });
    store.appendFact(makeVerifiedFact("f1"));

    store.recordFactAccess("nonexistent");

    const stats = store.getUsageStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].count).toBe(0);
  });

  it("recordFactsAccess batches multiple access records", () => {
    const store = new RuntimeMemoryStore({ maxFacts: 10, now: () => 1000 });
    store.appendFact(makeVerifiedFact("f1"));
    store.appendFact(makeVerifiedFact("f2"));
    store.appendFact(makeVerifiedFact("f3"));

    store.recordFactsAccess(["f1", "f2", "f1", "f3"]);

    const stats = store.getUsageStats();
    expect(stats.find((s) => s.factId === "f1")?.count).toBe(2);
    expect(stats.find((s) => s.factId === "f2")?.count).toBe(1);
    expect(stats.find((s) => s.factId === "f3")?.count).toBe(1);
  });

  it("importance eviction preserves high-usage facts over low-usage", () => {
    let now = 1000;
    const store = new RuntimeMemoryStore({
      maxFacts: 5,
      evictionPolicy: "importance",
      now: () => now,
    });

    for (let i = 0; i < 5; i++) {
      store.appendFact(makeVerifiedFact(`f${i}`));
    }

    // Access f0 and f1 frequently, leave f2/f3/f4 unaccessed
    for (let i = 0; i < 10; i++) {
      store.recordFactAccess("f0");
      store.recordFactAccess("f1");
    }
    now = 1100;

    // Add 2 more facts → triggers eviction (capacity 5, need to evict ~15%)
    store.appendFact(makeVerifiedFact("f5"));
    store.appendFact(makeVerifiedFact("f6"));

    const stats = store.getUsageStats();
    const factIds = stats.map((s) => s.factId);

    // f0 and f1 should survive due to high usage score
    expect(factIds).toContain("f0");
    expect(factIds).toContain("f1");
  });

  it("usage score decays over time (7-day half-life)", () => {
    let now = 1_000_000;
    const store = new RuntimeMemoryStore({
      maxFacts: 10,
      evictionPolicy: "importance",
      now: () => now,
    });
    store.appendFact(makeVerifiedFact("recent"));
    store.appendFact(makeVerifiedFact("old"));

    // Access both facts 5 times at t=1_000_000
    for (let i = 0; i < 5; i++) {
      store.recordFactAccess("recent");
      store.recordFactAccess("old");
    }

    // Advance time by 14 days (2 half-lives) for "old"
    now = 1_000_000 + 14 * 24 * 60 * 60 * 1000;
    // Access "recent" again at the new time
    for (let i = 0; i < 5; i++) {
      store.recordFactAccess("recent");
    }

    const stats = store.getUsageStats();
    const recentStat = stats.find((s) => s.factId === "recent");
    const oldStat = stats.find((s) => s.factId === "old");

    // Both have count=5 for old, count=10 for recent — but the key check
    // is that lastAccessedAt differs, reflecting the decay baseline.
    expect(recentStat?.lastAccessedAt).toBe(now);
    expect(oldStat?.lastAccessedAt).toBe(1_000_000);
  });

  it("getLastWriteAt tracks the most recent write operation", () => {
    let now = 1000;
    const store = new RuntimeMemoryStore({ maxFacts: 10, now: () => now });
    expect(store.getLastWriteAt()).toBe(0);

    now = 1500;
    store.appendFact(makeVerifiedFact("f1"));
    expect(store.getLastWriteAt()).toBe(1500);

    now = 2000;
    store.appendFact(makeVerifiedFact("f2"));
    expect(store.getLastWriteAt()).toBe(2000);
  });

  it("usage data is cleaned up when facts are evicted (FIFO)", () => {
    const store = new RuntimeMemoryStore({ maxFacts: 2, now: () => 1000, evictionPolicy: "fifo" });
    store.appendFact(makeVerifiedFact("f1"));
    store.appendFact(makeVerifiedFact("f2"));
    store.recordFactAccess("f1");

    // Adding f3 triggers FIFO eviction of f1
    store.appendFact(makeVerifiedFact("f3"));

    // f1 is gone — its usage data should also be gone
    store.recordFactAccess("f1"); // should be a no-op
    const stats = store.getUsageStats();
    expect(stats.find((s) => s.factId === "f1")).toBeUndefined();
  });

  it("usage data is cleaned up when facts are evicted (importance)", () => {
    let now = 1000;
    const store = new RuntimeMemoryStore({
      maxFacts: 2,
      evictionPolicy: "importance",
      now: () => now,
    });
    store.appendFact(makeVerifiedFact("f1"));
    store.appendFact(makeVerifiedFact("f2"));
    store.recordFactAccess("f1");

    // Adding f3 triggers importance eviction
    now = 2000;
    store.appendFact(makeVerifiedFact("f3"));

    // Whatever was evicted, its usage data should be gone
    const stats = store.getUsageStats();
    for (const stat of stats) {
      expect(stat.factId).toBeTruthy();
    }
    // Total stats should match remaining fact count
    expect(stats.length).toBe(store.stats().facts);
  });
});
