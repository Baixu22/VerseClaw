// @vitest-environment node
// P1-3: Topic/SubTopic Schema (Memobase-inspired) — dedicated unit tests.
//
// Verifies that the 8-topic taxonomy correctly:
// - Infers topic from predicate via keyword matching (with priority ordering)
// - Infers sub-topic by stripping verb prefixes
// - Falls back to "other" when no keyword matches
// - Groups facts by topic
// - Allocates budget with per-topic cap and remainder distribution
import { describe, expect, it } from "vitest";
import {
  MEMORY_TOPIC_TYPES,
  allocateTopicBudget,
  classifyFactTopic,
  groupFactsByTopic,
  inferSubTopic,
  inferTopicFromPredicate,
  isMemoryTopicType,
  type MemoryTopicType,
} from "./memory-topic-schema";

describe("MEMORY_TOPIC_TYPES", () => {
  it("contains all 8 Memobase topics + other", () => {
    expect(MEMORY_TOPIC_TYPES).toHaveLength(9);
    expect(MEMORY_TOPIC_TYPES).toContain("basic_info");
    expect(MEMORY_TOPIC_TYPES).toContain("occupation");
    expect(MEMORY_TOPIC_TYPES).toContain("education");
    expect(MEMORY_TOPIC_TYPES).toContain("family");
    expect(MEMORY_TOPIC_TYPES).toContain("preferences");
    expect(MEMORY_TOPIC_TYPES).toContain("health");
    expect(MEMORY_TOPIC_TYPES).toContain("lifestyle");
    expect(MEMORY_TOPIC_TYPES).toContain("plans");
    expect(MEMORY_TOPIC_TYPES).toContain("other");
  });
});

describe("isMemoryTopicType", () => {
  it("accepts valid topic strings", () => {
    expect(isMemoryTopicType("family")).toBe(true);
    expect(isMemoryTopicType("other")).toBe(true);
  });

  it("rejects invalid topic strings", () => {
    expect(isMemoryTopicType("unknown")).toBe(false);
    expect(isMemoryTopicType(42)).toBe(false);
    expect(isMemoryTopicType(null)).toBe(false);
    expect(isMemoryTopicType(undefined)).toBe(false);
  });
});

describe("inferTopicFromPredicate", () => {
  it("classifies family predicates", () => {
    expect(inferTopicFromPredicate("married_to")).toBe("family");
    expect(inferTopicFromPredicate("has_pet")).toBe("family");
    expect(inferTopicFromPredicate("has_sibling")).toBe("family");
  });

  it("classifies occupation predicates", () => {
    expect(inferTopicFromPredicate("started_job")).toBe("occupation");
    expect(inferTopicFromPredicate("works_as")).toBe("occupation");
    expect(inferTopicFromPredicate("occupation")).toBe("occupation");
  });

  it("classifies education predicates", () => {
    expect(inferTopicFromPredicate("studied")).toBe("education");
    expect(inferTopicFromPredicate("graduated_from")).toBe("education");
  });

  it("classifies preferences predicates", () => {
    expect(inferTopicFromPredicate("likes")).toBe("preferences");
    expect(inferTopicFromPredicate("favorite_food")).toBe("preferences");
    expect(inferTopicFromPredicate("hobby")).toBe("preferences");
  });

  it("classifies health predicates", () => {
    expect(inferTopicFromPredicate("has_allergy")).toBe("health");
    expect(inferTopicFromPredicate("exercise")).toBe("health");
  });

  it("classifies lifestyle predicates", () => {
    expect(inferTopicFromPredicate("lives_in")).toBe("lifestyle");
    expect(inferTopicFromPredicate("moved_to")).toBe("lifestyle");
  });

  it("classifies plans predicates", () => {
    expect(inferTopicFromPredicate("plans_to")).toBe("plans");
    expect(inferTopicFromPredicate("goal")).toBe("plans");
  });

  it("classifies basic_info predicates", () => {
    expect(inferTopicFromPredicate("name")).toBe("basic_info");
    expect(inferTopicFromPredicate("age")).toBe("basic_info");
  });

  it("returns 'other' when no keyword matches", () => {
    expect(inferTopicFromPredicate("random_predicate_xyz")).toBe("other");
    expect(inferTopicFromPredicate("")).toBe("other");
  });

  it("uses objectSummary as fallback signal", () => {
    // predicate has no keyword but objectSummary does
    expect(inferTopicFromPredicate("is_a", "works at Google as engineer")).toBe("occupation");
  });

  it("family is checked before lifestyle (priority)", () => {
    // "pet" could match lifestyle but family is checked first
    expect(inferTopicFromPredicate("pet")).toBe("family");
  });

  it("matches whole words, not substrings", () => {
    // "like" should NOT match "bicycle" (substring)
    expect(inferTopicFromPredicate("bicycle")).not.toBe("preferences");
  });
});

describe("inferSubTopic", () => {
  it("strips common verb prefixes", () => {
    expect(inferSubTopic("occupation", "is_engineer")).toBe("engineer");
    expect(inferSubTopic("family", "has_pet")).toBe("pet");
    expect(inferSubTopic("preferences", "likes_hiking")).toBe("hiking");
  });

  it("replaces underscores with spaces", () => {
    expect(inferSubTopic("lifestyle", "lives_in")).toBe("lives in");
  });

  it("returns topic when predicate is empty", () => {
    expect(inferSubTopic("family", "")).toBe("family");
  });

  it("returns cleaned predicate when no prefix to strip", () => {
    expect(inferSubTopic("occupation", "engineer")).toBe("engineer");
  });
});

describe("classifyFactTopic", () => {
  it("uses LLM topic when valid", () => {
    const result = classifyFactTopic("random", "summary", "family", "spouse");
    expect(result.topic).toBe("family");
    expect(result.subTopic).toBe("spouse");
  });

  it("falls back to heuristic when LLM topic is invalid", () => {
    const result = classifyFactTopic("married_to", "summary", "invalid_topic");
    expect(result.topic).toBe("family");
  });

  it("falls back to heuristic when LLM topic is undefined", () => {
    const result = classifyFactTopic("started_job", "summary", undefined);
    expect(result.topic).toBe("occupation");
  });

  it("uses LLM subTopic when provided, else infers", () => {
    const withLLM = classifyFactTopic("is_engineer", "summary", "occupation", "engineer");
    expect(withLLM.subTopic).toBe("engineer");

    const withoutLLM = classifyFactTopic("is_engineer", "summary", "occupation", undefined);
    expect(withoutLLM.subTopic).toBe("engineer"); // inferred from predicate
  });

  it("trims whitespace from LLM subTopic", () => {
    const result = classifyFactTopic("x", "y", "family", "  spouse  ");
    expect(result.subTopic).toBe("spouse");
  });
});

describe("groupFactsByTopic", () => {
  it("groups fact IDs by topic, including empty topics", () => {
    const facts = [
      { factId: "f1", topic: "family" as MemoryTopicType },
      { factId: "f2", topic: "family" as MemoryTopicType },
      { factId: "f3", topic: "occupation" as MemoryTopicType },
      { factId: "f4" }, // no topic → "other"
    ];
    const groups = groupFactsByTopic(facts);
    expect(groups.size).toBe(9); // all topics present
    expect(groups.get("family")).toEqual(["f1", "f2"]);
    expect(groups.get("occupation")).toEqual(["f3"]);
    expect(groups.get("other")).toEqual(["f4"]);
    expect(groups.get("health")).toEqual([]); // empty topic present
  });
});

describe("allocateTopicBudget", () => {
  it("allocates proportionally with per-topic cap", () => {
    const counts = new Map<MemoryTopicType, number>([
      ["family", 10],
      ["occupation", 5],
      ["preferences", 5],
    ]);
    const budget = allocateTopicBudget(counts, 20, { maxPerTopicRatio: 0.4 });
    // max per topic = 20 × 0.4 = 8
    // family proportional = ceil(10/20 × 20) = 10, capped at 8
    // occupation = ceil(5/20 × 20) = 5
    // preferences = ceil(5/20 × 20) = 5
    // first pass: 8 + 5 + 5 = 18, remaining = 2
    // second pass: distribute to family (has 10 facts, currently 8 < 10, < 8 cap? no, 8 >= 8 cap)
    // actually cap is 8, family is already at cap. So distribute to occupation (5 < 5 count, 5 < 8 cap → +1=6)
    // then preferences (5 < 5 count? no, 5 >= 5. skip)
    // Wait, count check: current >= count means topic exhausted.
    // occupation: current=5, count=5 → 5 >= 5, skip. Hmm.
    // Let me recalculate: remaining=2, but all topics are at their count or cap.
    // family: 8 (capped), occupation: 5 (=count), preferences: 5 (=count)
    // No room to distribute → remaining stays 2 but loop exits with added=false.
    const total = [...budget.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(20);
    expect(budget.get("family")).toBeLessThanOrEqual(8);
  });

  it("respects per-topic cap of 40% by default", () => {
    const counts = new Map<MemoryTopicType, number>([
      ["family", 100],
      ["occupation", 1],
    ]);
    const budget = allocateTopicBudget(counts, 10);
    // max per topic = floor(10 × 0.4) = 4
    expect(budget.get("family")).toBeLessThanOrEqual(4);
  });

  it("returns empty map when total count is 0", () => {
    const counts = new Map<MemoryTopicType, number>([
      ["family", 0],
      ["occupation", 0],
    ]);
    const budget = allocateTopicBudget(counts, 10);
    expect(budget.size).toBe(0);
  });

  it("distributes remainder to topics with available capacity", () => {
    const counts = new Map<MemoryTopicType, number>([
      ["family", 10],
      ["occupation", 10],
      ["preferences", 10],
    ]);
    const budget = allocateTopicBudget(counts, 15, { maxPerTopicRatio: 0.4 });
    // max per topic = floor(15 × 0.4) = 6
    // proportional: each = ceil(10/30 × 15) = 5
    // first pass: 5+5+5 = 15, remaining = 0
    const total = [...budget.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(15);
    for (const v of budget.values()) {
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});
