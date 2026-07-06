// @vitest-environment node
// Module C: Importance-aware eviction unit tests.
// Validates that the "importance" eviction policy preserves high-confidence,
// well-evidenced facts when capacity is exceeded (vs FIFO which blindly drops
// the oldest), and that the default "fifo" policy is unchanged.

import { describe, expect, it } from "vitest";
import { RuntimeMemoryStore } from "../../openclaw_runtime/src/runtime-core/memory-store";
import {
  buildRuntimeMemoryTemporalFactFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  type RuntimeMemoryTemporalFact,
  type RuntimeMemoryTemporalFactCandidate,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

// Use the official fixture builders which produce sanitized, valid facts with
// non-empty sourceEpisodeRefs and evidenceRefs. The store's type guard
// (nonEmptyArrayEvery) rejects facts with empty arrays, so hand-rolled fixtures
// with sourceEpisodeRefs: [] / evidenceRefs: [] are silently dropped.
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

function makeCandidate(
  id: string,
  overrides: Partial<RuntimeMemoryTemporalFactCandidate> = {},
): RuntimeMemoryTemporalFactCandidate {
  return buildRuntimeMemoryTemporalFactCandidateFixture({
    factId: id,
    subject: "UserPref",
    predicate: "setting",
    objectSummary: `setting ${id}`,
    confidence: 0.3,
    source: "tool_result",
    verificationStatus: "candidate",
    valid_at: 100,
    reference_time: 100,
    ...overrides,
  });
}

describe("Module C: Importance-aware eviction", () => {
  it("FIFO policy evicts oldest fact — backward compatible", () => {
    // FIFO policy. Inserting 4 facts into maxFacts=3 should drop
    // the first-inserted one.
    const store = new RuntimeMemoryStore({ maxFacts: 3, now: () => 200, evictionPolicy: "fifo" });
    store.appendFact(makeVerifiedFact("f1"));
    store.appendFact(makeVerifiedFact("f2"));
    store.appendFact(makeVerifiedFact("f3"));
    store.appendFact(makeVerifiedFact("f4"));

    expect(store.getFactById("f1")).toBeUndefined();
    expect(store.getFactById("f4")).toBeDefined();
    expect(store.stats().facts).toBe(3);
  });

  it("importance policy preserves high-confidence fact over low-confidence candidates", () => {
    // maxFacts=5, importance policy. Insert one high-confidence, well-evidenced,
    // human-approved fact FIRST (oldest), then several low-confidence candidates.
    // On overflow, the candidates (lowest scores) must be evicted; the
    // high-value old fact must survive — which FIFO would have dropped.
    const store = new RuntimeMemoryStore({
      maxFacts: 5,
      evictionPolicy: "importance",
      now: () => 200,
    });

    const highValue = makeVerifiedFact("high-1", {
      confidence: 0.95,
      verificationStatus: "human_approved",
      source: "human_confirmation",
    });
    store.appendFact(highValue);

    for (let i = 1; i <= 5; i++) {
      store.appendFact(makeCandidate(`low-${i}`, { confidence: 0.3 }));
    }

    // 6 facts inserted, maxFacts=5 → importance eviction triggers.
    // targetSize = floor(5*0.85) = 4, evict 6-4 = 2 lowest.
    expect(store.stats().facts).toBe(4);

    // The high-value fact must survive.
    expect(store.getFactById("high-1")).toBeDefined();
    // Exactly 2 of the 5 low-confidence candidates were evicted.
    const survivingLow = [1, 2, 3, 4, 5].filter((i) =>
      store.getFactById(`low-${i}`) !== undefined,
    );
    expect(survivingLow).toHaveLength(3);
  });

  it("importance policy batch-evicts ~15% to avoid boundary churn", () => {
    // maxFacts=10, importance. Insert 12 equal facts. targetSize=floor(10*0.85)=8.
    // Batch eviction triggers INCREMENTALLY on each overflow, not once at the
    // end: after the 11th append (11 > 10), evict 11-8=3 → 8 facts. After the
    // 12th append (9 ≤ 10), no eviction → 9 facts. Compare to FIFO which would
    // evict 1-at-a-time: 11→10, then 11→10, final 10. Importance yields fewer
    // facts (9 < 10) because each overflow evicts a batch, not a single fact.
    const store = new RuntimeMemoryStore({
      maxFacts: 10,
      evictionPolicy: "importance",
      now: () => 200,
    });
    for (let i = 0; i < 12; i++) {
      store.appendFact(
        makeVerifiedFact(`f-${i}`, {
          confidence: 0.6,
          subject: `Subject${i % 3}`,
          predicate: `pred${i % 3}`,
          objectSummary: `detail ${i}`,
        }),
      );
    }
    // 12 inserted, maxFacts=10, importance batch eviction → 9 facts.
    // (FIFO would leave 10; importance leaves fewer due to batch eviction.)
    expect(store.stats().facts).toBe(9);
    expect(store.stats().facts).toBeLessThan(10);
  });

  it("importance policy: when all facts are equal, eviction still respects capacity", () => {
    // Edge case: all facts identical scoring. Batch eviction triggers
    // incrementally: 5th append → evict 2 → 3 facts; 6th → 4 facts (≤4, no
    // eviction); 7th → evict 2 → 3; ... alternating between 3 and 4. After 10
    // appends, the final count is 4 (at capacity, no overflow).
    // Key invariant: store never exceeds maxFacts.
    const store = new RuntimeMemoryStore({
      maxFacts: 4,
      evictionPolicy: "importance",
      now: () => 200,
    });
    for (let i = 0; i < 10; i++) {
      store.appendFact(makeVerifiedFact(`f-${i}`));
    }
    expect(store.stats().facts).toBeLessThanOrEqual(4);
    expect(store.stats().facts).toBe(4); // at capacity after even # of overflows
  });
});
