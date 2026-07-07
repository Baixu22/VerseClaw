// @vitest-environment node
// P1-2: Entity Resolution + Alias Table — dedicated unit tests.
//
// Verifies that the Hindsight/Mem0-inspired entity resolver correctly:
// - Normalizes entity surface forms (case, whitespace, possessives)
// - Computes Jaro-Winkler similarity with prefix bonus
// - Applies substring boost for nickname detection
// - Merges entities above the resolution threshold
// - Chooses canonical forms deterministically (longest, then alphabetical)
import { describe, expect, it } from "vitest";
import {
  AliasTable,
  buildEntityResolver,
  cooccurrenceScore,
  computeResolutionScore,
  jaroWinklerSimilarity,
  nameSimilarity,
  normalizeEntityName,
  temporalScore,
  type EntityOccurrence,
  type EntityResolverOptions,
} from "./entity-resolution";

const DEFAULT_OPTS: Required<EntityResolverOptions> = {
  mergeThreshold: 0.6,
  nameWeight: 0.5,
  cooccurrenceWeight: 0.3,
  temporalWeight: 0.2,
  temporalWindowMs: 90 * 24 * 60 * 60 * 1000,
};

describe("normalizeEntityName", () => {
  it("lowercases and trims", () => {
    expect(normalizeEntityName("  Jonathan  ")).toBe("jonathan");
    expect(normalizeEntityName("JON")).toBe("jon");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeEntityName("Jon   Smith")).toBe("jon smith");
  });

  it("strips possessive suffixes (ASCII and curly)", () => {
    expect(normalizeEntityName("Jon's")).toBe("jon");
    expect(normalizeEntityName("Jon's")).toBe("jon");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeEntityName("   ")).toBe("");
  });
});

describe("jaroWinklerSimilarity", () => {
  it("returns 1 for identical non-empty strings", () => {
    expect(jaroWinklerSimilarity("jon", "jon")).toBe(1);
  });

  it("returns 1 for two empty strings (they are identical)", () => {
    // The implementation checks a === b first, so "" === "" returns 1.
    // This is semantically correct: identical strings have similarity 1.
    expect(jaroWinklerSimilarity("", "")).toBe(1);
  });

  it("returns 0 for no matches", () => {
    expect(jaroWinklerSimilarity("abc", "xyz")).toBe(0);
  });

  it("rewards common prefixes (Winkler bonus)", () => {
    // "jon" vs "jonathan" — strong prefix match should score high
    const score = jaroWinklerSimilarity("jon", "jonathan");
    expect(score).toBeGreaterThan(0.85);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("handles transpositions", () => {
    // "martha" vs "marhta" — classic Jaro example with transpositions
    const score = jaroWinklerSimilarity("martha", "marhta");
    expect(score).toBeGreaterThan(0.9);
  });

  it("is symmetric", () => {
    const a = jaroWinklerSimilarity("jonathan", "jon");
    const b = jaroWinklerSimilarity("jon", "jonathan");
    expect(a).toBeCloseTo(b, 10);
  });
});

describe("nameSimilarity", () => {
  it("returns 1 for identical normalized names", () => {
    expect(nameSimilarity("Jon", "jon")).toBe(1);
    expect(nameSimilarity("JON'S", "jon")).toBe(1);
  });

  it("applies substring boost for nicknames", () => {
    // "jon" ⊂ "jonathan" → JW + 0.15 boost
    const score = nameSimilarity("jon", "jonathan");
    const jw = jaroWinklerSimilarity("jon", "jonathan");
    expect(score).toBeCloseTo(Math.min(1, jw + 0.15), 10);
    expect(score).toBeGreaterThan(0.9);
  });

  it("does not apply substring boost for very short strings (<3 chars)", () => {
    // "jo" ⊂ "jonathan" but "jo" is only 2 chars → no boost
    const score = nameSimilarity("jo", "jonathan");
    const jw = jaroWinklerSimilarity("jo", "jonathan");
    expect(score).toBeCloseTo(jw, 10);
  });

  it("returns 0 for empty strings", () => {
    expect(nameSimilarity("", "jon")).toBe(0);
    expect(nameSimilarity("jon", "")).toBe(0);
  });

  it("scores low for unrelated names", () => {
    expect(nameSimilarity("jon", "sarah")).toBeLessThan(0.5);
  });
});

describe("cooccurrenceScore", () => {
  it("returns 0 when no shared facts", () => {
    const factIds = new Map<string, Set<string>>([
      ["jon", new Set(["f1", "f2"])],
      ["sarah", new Set(["f3", "f4"])],
    ]);
    expect(cooccurrenceScore("jon", "sarah", factIds)).toBe(0);
  });

  it("saturates at 3+ shared facts", () => {
    const factIds = new Map<string, Set<string>>([
      ["jon", new Set(["f1", "f2", "f3", "f4"])],
      ["jonathan", new Set(["f1", "f2", "f3", "f4"])],
    ]);
    // 4 shared → 0.1 + 4×0.3 = 1.3 → capped at 1.0
    expect(cooccurrenceScore("jon", "jonathan", factIds)).toBe(1);
  });

  it("scores linearly for 1-2 shared facts", () => {
    const factIds1 = new Map<string, Set<string>>([
      ["a", new Set(["f1"])],
      ["b", new Set(["f1"])],
    ]);
    expect(cooccurrenceScore("a", "b", factIds1)).toBeCloseTo(0.4, 10);

    const factIds2 = new Map<string, Set<string>>([
      ["a", new Set(["f1", "f2"])],
      ["b", new Set(["f1", "f2"])],
    ]);
    expect(cooccurrenceScore("a", "b", factIds2)).toBeCloseTo(0.7, 10);
  });
});

describe("temporalScore", () => {
  const now = 1_700_000_000_000;
  const window = 90 * 24 * 60 * 60 * 1000;

  it("returns 0 when no session dates available", () => {
    const occ = new Map<string, EntityOccurrence[]>([
      ["a", [{ entity: "a", factId: "f1" }]], // no sessionDate
      ["b", [{ entity: "b", factId: "f2" }]],
    ]);
    expect(temporalScore("a", "b", occ, window)).toBe(0);
  });

  it("returns 1 for same timestamp", () => {
    const occ = new Map<string, EntityOccurrence[]>([
      ["a", [{ entity: "a", factId: "f1", sessionDate: now }]],
      ["b", [{ entity: "b", factId: "f2", sessionDate: now }]],
    ]);
    expect(temporalScore("a", "b", occ, window)).toBe(1);
  });

  it("returns 0 when distance >= window", () => {
    const occ = new Map<string, EntityOccurrence[]>([
      ["a", [{ entity: "a", factId: "f1", sessionDate: now }]],
      ["b", [{ entity: "b", factId: "f2", sessionDate: now + window }]],
    ]);
    expect(temporalScore("a", "b", occ, window)).toBe(0);
  });

  it("decays linearly within the window", () => {
    const halfWindow = window / 2;
    const occ = new Map<string, EntityOccurrence[]>([
      ["a", [{ entity: "a", factId: "f1", sessionDate: now }]],
      ["b", [{ entity: "b", factId: "f2", sessionDate: now + halfWindow }]],
    ]);
    expect(temporalScore("a", "b", occ, window)).toBeCloseTo(0.5, 5);
  });
});

describe("computeResolutionScore", () => {
  it("computes weighted sum of components", () => {
    const factIds = new Map<string, Set<string>>([
      ["jon", new Set(["f1", "f2"])],
      ["jonathan", new Set(["f1", "f2"])],
    ]);
    const now = 1_700_000_000_000;
    const occ = new Map<string, EntityOccurrence[]>([
      ["jon", [{ entity: "jon", factId: "f1", sessionDate: now }]],
      ["jonathan", [{ entity: "jonathan", factId: "f1", sessionDate: now }]],
    ]);

    const result = computeResolutionScore("jon", "jonathan", factIds, occ, DEFAULT_OPTS);
    // name ≈ 1.0 (JW + substring boost), cooccurrence = 0.7 (2 shared), temporal = 1.0
    expect(result.name).toBeGreaterThan(0.9);
    expect(result.cooccurrence).toBeCloseTo(0.7, 5);
    expect(result.temporal).toBe(1);
    // total = 0.5×1 + 0.3×0.7 + 0.2×1 = 0.91
    expect(result.total).toBeCloseTo(0.5 * result.name + 0.3 * 0.7 + 0.2 * 1, 5);
    expect(result.total).toBeGreaterThan(0.6); // above merge threshold
  });
});

describe("AliasTable", () => {
  it("resolves unknown entities to themselves", () => {
    const table = new AliasTable();
    expect(table.resolve("Jon")).toBe("Jon");
    expect(table.entries()).toHaveLength(0);
  });

  it("merges nickname → full name when score exceeds threshold", () => {
    const now = 1_700_000_000_000;
    const occurrences: EntityOccurrence[] = [
      // "jonathan" appears 3 times (more frequent → canonical)
      { entity: "Jonathan", factId: "f1", sessionDate: now },
      { entity: "Jonathan", factId: "f2", sessionDate: now },
      { entity: "Jonathan", factId: "f3", sessionDate: now },
      // "jon" appears once, shares fact f1, same time
      { entity: "Jon", factId: "f1", sessionDate: now },
    ];
    const table = new AliasTable();
    table.buildFromOccurrences(occurrences);

    // "jon" should merge into the "jonathan" cluster (canonical = most frequent)
    expect(table.resolve("Jon")).toBe("jonathan");
    expect(table.resolve("Jonathan")).toBe("jonathan");

    const entries = table.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0].canonical).toBe("jonathan");
    expect(entries[0].aliases).toContain("jon");
    expect(entries[0].confidence).toBeGreaterThan(0.6);
  });

  it("keeps unrelated entities separate", () => {
    const now = 1_700_000_000_000;
    const occurrences: EntityOccurrence[] = [
      { entity: "Jon", factId: "f1", sessionDate: now },
      { entity: "Sarah", factId: "f2", sessionDate: now },
      { entity: "Jon", factId: "f3", sessionDate: now },
      { entity: "Sarah", factId: "f4", sessionDate: now },
    ];
    const table = new AliasTable();
    table.buildFromOccurrences(occurrences);

    expect(table.entries()).toHaveLength(2);
    expect(table.resolve("Jon")).toBe("jon");
    expect(table.resolve("Sarah")).toBe("sarah");
  });

  it("respects custom merge threshold", () => {
    const now = 1_700_000_000_000;
    // With high threshold (0.95), even similar names shouldn't merge
    const occurrences: EntityOccurrence[] = [
      { entity: "Jonathan", factId: "f1", sessionDate: now },
      { entity: "Jonathan", factId: "f2", sessionDate: now },
      { entity: "Jon", factId: "f1", sessionDate: now },
    ];
    const table = new AliasTable({ mergeThreshold: 0.95 });
    table.buildFromOccurrences(occurrences);

    // "jon" should NOT merge (score ~0.91 < 0.95)
    expect(table.resolve("Jon")).toBe("jon");
    expect(table.resolve("Jonathan")).toBe("jonathan");
    expect(table.entries()).toHaveLength(2);
  });

  it("is idempotent: resolve returns same result on repeated calls", () => {
    const now = 1_700_000_000_000;
    const occurrences: EntityOccurrence[] = [
      { entity: "Jonathan", factId: "f1", sessionDate: now },
      { entity: "Jonathan", factId: "f2", sessionDate: now },
      { entity: "Jon", factId: "f1", sessionDate: now },
    ];
    const table = new AliasTable();
    table.buildFromOccurrences(occurrences);

    const first = table.resolve("Jon");
    const second = table.resolve("Jon");
    expect(first).toBe(second);
  });

  it("chooseCanonical prefers longest form, breaks ties alphabetically", () => {
    expect(AliasTable.chooseCanonical(["jon", "jonathan"])).toBe("jonathan");
    expect(AliasTable.chooseCanonical(["jonathan", "jon"])).toBe("jonathan");
    expect(AliasTable.chooseCanonical(["abc", "xyz"])).toBe("abc"); // same length → alphabetical
    expect(AliasTable.chooseCanonical([])).toBe("");
  });
});

describe("buildEntityResolver", () => {
  it("returns a resolver function that maps aliases to canonicals", () => {
    const now = 1_700_000_000_000;
    const occurrences: EntityOccurrence[] = [
      { entity: "Jonathan", factId: "f1", sessionDate: now },
      { entity: "Jonathan", factId: "f2", sessionDate: now },
      { entity: "Jon", factId: "f1", sessionDate: now },
    ];
    const resolve = buildEntityResolver(occurrences);
    expect(typeof resolve).toBe("function");
    expect(resolve("Jon")).toBe("jonathan");
    expect(resolve("Jonathan")).toBe("jonathan");
    // Unknown entity returns itself
    expect(resolve("Sarah")).toBe("Sarah");
  });
});
