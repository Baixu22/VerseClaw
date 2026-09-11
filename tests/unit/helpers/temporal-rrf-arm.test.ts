// @vitest-environment node
// P2-3: Temporal Independent RRF Arm + 8-Bucket Coverage — dedicated unit tests.
//
// Verifies the Hindsight-inspired temporal RRF arm correctly:
// - Computes exp(-Δt/halfLife) temporal relevance scores
// - Assigns facts to equal-sized timeline buckets
// - Applies bucket coverage bonus to diversify across timeline
// - Produces RRF-formatted HybridSearchHit output
// - Extracts query time from natural-language questions
import { describe, expect, it } from "vitest";
import {
  assignBucket,
  bucketCoverageBonus,
  extractQueryTimeHeuristic,
  temporalRelevanceScore,
  temporalRRFArm,
} from "./temporal-rrf-arm";
import type { RuntimeMemoryQueryableFact } from "../../../openclaw_runtime/src/runtime-core/memory-context";

// Helper: create a minimal fact for testing.
function makeFact(factId: string, validAt: number): RuntimeMemoryQueryableFact {
  return {
    schemaVersion: 1,
    factId,
    subject: "subj",
    predicate: "is",
    objectSummary: `summary ${factId}`,
    confidence: 0.9,
    source: "agent",
    verificationStatus: "verified",
    sourceEpisodeRefs: [],
    evidenceRefs: [],
    proposedAt: 0,
    valid_at: validAt,
    reference_time: 0,
  } as unknown as RuntimeMemoryQueryableFact;
}

describe("temporalRelevanceScore", () => {
  const halfLife = 180 * 24 * 60 * 60 * 1000; // 180 days

  it("returns 1.0 when factTime === queryTime", () => {
    const t = 1_700_000_000_000;
    expect(temporalRelevanceScore(t, t, halfLife)).toBe(1);
  });

  it("returns 0.5 when queryTime is undefined (all-time query)", () => {
    expect(temporalRelevanceScore(12345, undefined, halfLife)).toBe(0.5);
  });

  it("decays exponentially with time distance", () => {
    const t = 1_700_000_000_000;
    const oneHalfLife = temporalRelevanceScore(t + halfLife, t, halfLife);
    expect(oneHalfLife).toBeCloseTo(Math.exp(-1), 5); // ≈ 0.368

    const twoHalfLives = temporalRelevanceScore(t + 2 * halfLife, t, halfLife);
    expect(twoHalfLives).toBeCloseTo(Math.exp(-2), 5); // ≈ 0.135
  });

  it("approaches 0 for very distant times", () => {
    const t = 1_700_000_000_000;
    const distant = temporalRelevanceScore(t + 10 * halfLife, t, halfLife);
    expect(distant).toBeLessThan(0.001);
  });
});

describe("assignBucket", () => {
  const spanStart = 1_000;
  const spanEnd = 10_000;

  it("assigns to bucket 0 at spanStart", () => {
    expect(assignBucket(spanStart, spanStart, spanEnd, 8)).toBe(0);
  });

  it("assigns to last bucket at spanEnd", () => {
    expect(assignBucket(spanEnd, spanStart, spanEnd, 8)).toBe(7);
  });

  it("assigns to middle bucket at midpoint", () => {
    const mid = (spanStart + spanEnd) / 2;
    // midpoint → normalized 0.5 → floor(0.5 × 8) = 4
    expect(assignBucket(mid, spanStart, spanEnd, 8)).toBe(4);
  });

  it("clamps out-of-range values to [spanStart, spanEnd]", () => {
    expect(assignBucket(spanStart - 500, spanStart, spanEnd, 8)).toBe(0);
    expect(assignBucket(spanEnd + 500, spanStart, spanEnd, 8)).toBe(7);
  });

  it("returns 0 when spanEnd <= spanStart (degenerate span)", () => {
    expect(assignBucket(500, 100, 100, 8)).toBe(0);
    expect(assignBucket(500, 200, 100, 8)).toBe(0);
  });
});

describe("bucketCoverageBonus", () => {
  it("returns 1.0 for an empty bucket", () => {
    const counts = [0, 0, 0, 0, 0, 0, 0, 0];
    expect(bucketCoverageBonus(0, counts)).toBe(1);
  });

  it("returns 0.5 for a bucket with 1 selection", () => {
    const counts = [1, 0, 0, 0, 0, 0, 0, 0];
    expect(bucketCoverageBonus(0, counts)).toBeCloseTo(0.5, 5);
  });

  it("returns 1/3 for a bucket with 2 selections", () => {
    const counts = [2, 0, 0, 0, 0, 0, 0, 0];
    expect(bucketCoverageBonus(0, counts)).toBeCloseTo(1 / 3, 5);
  });

  it("handles out-of-range bucket index", () => {
    const counts = [0];
    expect(bucketCoverageBonus(5, counts)).toBe(1); // undefined → 0 count
  });
});

describe("temporalRRFArm", () => {
  const refTime = 1_700_000_000_000;
  const dayMs = 24 * 60 * 60 * 1000;

  it("returns empty array for empty facts", () => {
    expect(temporalRRFArm([], { referenceTime: refTime })).toEqual([]);
  });

  it("returns empty array when no facts have valid_at", () => {
    const facts = [makeFact("f1", NaN)];
    // NaN valid_at gets filtered out → no times → return []
    const result = temporalRRFArm(facts, { referenceTime: refTime });
    expect(result).toEqual([]);
  });

  it("produces RRF-formatted hits with decreasing scores", () => {
    const facts = [
      makeFact("f1", refTime - 10 * dayMs),
      makeFact("f2", refTime - 20 * dayMs),
      makeFact("f3", refTime - 30 * dayMs),
    ];
    const result = temporalRRFArm(facts, {
      referenceTime: refTime,
      queryTime: refTime - 10 * dayMs, // f1 is closest
      topK: 3,
    });
    expect(result).toHaveLength(3);
    // RRF scores should be 1/(60+1), 1/(60+2), 1/(60+3)
    expect(result[0].rrfScore).toBeCloseTo(1 / 61, 10);
    expect(result[1].rrfScore).toBeCloseTo(1 / 62, 10);
    expect(result[2].rrfScore).toBeCloseTo(1 / 63, 10);
    // RRF scores must be sorted descending
    expect(result[0].rrfScore).toBeGreaterThan(result[1].rrfScore);
  });

  it("respects topK limit", () => {
    const facts = Array.from({ length: 50 }, (_, i) =>
      makeFact(`f${i}`, refTime - i * dayMs),
    );
    const result = temporalRRFArm(facts, {
      referenceTime: refTime,
      queryTime: refTime,
      topK: 10,
    });
    expect(result).toHaveLength(10);
  });

  it("diversifies across buckets when queryTime is undefined", () => {
    // 8 facts, each in a different bucket (spanning 8× the timeline)
    const facts = Array.from({ length: 8 }, (_, i) =>
      makeFact(`f${i}`, refTime + i * 30 * dayMs),
    );
    const result = temporalRRFArm(facts, {
      referenceTime: refTime,
      queryTime: undefined, // all-time → coverage dominates
      topK: 8,
      bucketCount: 8,
    });
    expect(result).toHaveLength(8);
    // With all-time query (0.5 relevance for all), coverage bonus drives diversity.
    // Each fact should be in a different bucket, so all 8 are selected.
  });

  it("uses explicit bucketSpan when provided", () => {
    const spanStart = refTime - 100 * dayMs;
    const spanEnd = refTime + 100 * dayMs;
    const facts = [
      makeFact("f1", spanStart),
      makeFact("f2", spanEnd),
    ];
    const result = temporalRRFArm(facts, {
      referenceTime: refTime,
      queryTime: refTime,
      bucketSpan: [spanStart, spanEnd],
      topK: 2,
    });
    expect(result).toHaveLength(2);
  });

  it("sets all rank fields to null and scores to 0 except rrfScore", () => {
    const facts = [makeFact("f1", refTime)];
    const result = temporalRRFArm(facts, {
      referenceTime: refTime,
      queryTime: refTime,
      topK: 1,
    });
    expect(result[0].bm25Rank).toBeNull();
    expect(result[0].vectorRank).toBeNull();
    expect(result[0].entityRank).toBeNull();
    expect(result[0].bm25Score).toBe(0);
    expect(result[0].vectorScore).toBe(0);
    expect(result[0].entityScore).toBe(0);
    expect(result[0].rrfScore).toBeGreaterThan(0);
  });
});

describe("extractQueryTimeHeuristic", () => {
  const refTime = 1_700_000_000_000;

  it("extracts 'recently' / 'currently' / 'now' as referenceTime", () => {
    expect(extractQueryTimeHeuristic("What is Jon doing recently?", refTime)).toBe(refTime);
    expect(extractQueryTimeHeuristic("Where does Jon currently live?", refTime)).toBe(refTime);
    expect(extractQueryTimeHeuristic("What is Jon doing now?", refTime)).toBe(refTime);
  });

  it("extracts 'last week' / 'last month' / 'last year'", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(extractQueryTimeHeuristic("What did Jon do last week?", refTime)).toBe(refTime - week);

    const month = 30 * 24 * 60 * 60 * 1000;
    expect(extractQueryTimeHeuristic("Where was Jon last month?", refTime)).toBe(refTime - month);

    const year = 365 * 24 * 60 * 60 * 1000;
    expect(extractQueryTimeHeuristic("What happened last year?", refTime)).toBe(refTime - year);
  });

  it("extracts 'X years/months/weeks/days ago'", () => {
    const year = 365 * 24 * 60 * 60 * 1000;
    expect(extractQueryTimeHeuristic("Jon moved 2 years ago", refTime)).toBe(refTime - 2 * year);

    const day = 24 * 60 * 60 * 1000;
    expect(extractQueryTimeHeuristic("Jon quit 3 days ago", refTime)).toBe(refTime - 3 * day);
  });

  it("extracts absolute dates (Month DD, YYYY)", () => {
    const result = extractQueryTimeHeuristic("What happened on March 15, 2023?", refTime);
    expect(result).toBe(Date.UTC(2023, 2, 15)); // March = month index 2
  });

  it("extracts absolute dates (Month YYYY)", () => {
    const result = extractQueryTimeHeuristic("What happened in January 2024?", refTime);
    expect(result).toBe(Date.UTC(2024, 0, 1)); // January = month index 0
  });

  it("extracts ISO dates (YYYY-MM-DD)", () => {
    const result = extractQueryTimeHeuristic("What happened on 2023-07-15?", refTime);
    expect(result).toBe(Date.UTC(2023, 6, 15)); // July = month index 6
  });

  it("extracts ISO dates (YYYY-MM)", () => {
    const result = extractQueryTimeHeuristic("What happened in 2023-07?", refTime);
    expect(result).toBe(Date.UTC(2023, 6, 1));
  });

  it("returns undefined when no time constraint found", () => {
    expect(extractQueryTimeHeuristic("What is Jon's job?", refTime)).toBeUndefined();
    expect(extractQueryTimeHeuristic("Does Jon like hiking?", refTime)).toBeUndefined();
  });
});
