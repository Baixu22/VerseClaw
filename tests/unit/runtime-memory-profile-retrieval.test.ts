// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  openDomainRetrieval,
  buildProfileContextString,
} from "../../openclaw_runtime/src/runtime-core/memory-profile-retrieval";
import { buildUserProfile } from "../../openclaw_runtime/src/runtime-core/memory-user-profile";
import { HybridSearchIndex } from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import type { RuntimeMemoryQueryableFact } from "../../openclaw_runtime/src/runtime-core/memory-context";

function makeFact(
  subject: string,
  predicate: string,
  objectSummary: string,
  validAt: number = Date.UTC(2023, 0, 1),
): RuntimeMemoryQueryableFact {
  return {
    schemaVersion: 1,
    factId: `${subject}_${predicate}_${Math.random().toString(36).slice(2, 8)}`,
    taskId: "test",
    subject,
    predicate,
    objectSummary,
    confidence: 0.9,
    source: "agent",
    verificationStatus: "verified",
    sourceEpisodeRefs: [],
    evidenceRefs: [],
    proposedAt: validAt,
    acceptedAt: validAt,
    promotion: { promotedBy: "verifier", evidenceRefs: [] },
    valid_at: validAt,
    reference_time: validAt,
  } as RuntimeMemoryQueryableFact;
}

describe("openDomainRetrieval", () => {
  const facts: RuntimeMemoryQueryableFact[] = [
    makeFact("Alice", "occupation", "works as a senior software engineer at Google"),
    makeFact("Alice", "preference", "likes hiking and photography on weekends"),
    makeFact("Alice", "relationship", "is married to Bob who is a doctor"),
    makeFact("Alice", "location", "lives in San Francisco, California"),
    makeFact("Alice", "event", "graduated from Stanford in 2020", Date.UTC(2020, 5, 1)),
  ];

  const profile = buildUserProfile(facts, "alice");
  const index = new HybridSearchIndex(facts);
  // Use a dummy embedding (zeros) — search will fall back to BM25 only
  const dummyEmbedding = new Float32Array(0);

  it("returns profile dimensions for occupation question", () => {
    const result = openDomainRetrieval(
      "What is Alice's job?",
      profile,
      index,
      dummyEmbedding,
      { topK: 5 },
    );
    expect(result.profileDimensions.some((d) => d.category === "occupation")).toBe(true);
  });

  it("returns profile dimensions for relationship question", () => {
    const result = openDomainRetrieval(
      "Who is Alice's husband?",
      profile,
      index,
      dummyEmbedding,
      { topK: 5 },
    );
    expect(result.profileDimensions.some((d) => d.category === "relationships")).toBe(true);
  });

  it("returns detail facts from hybrid search", () => {
    const result = openDomainRetrieval(
      "What does Alice do for a living?",
      profile,
      index,
      dummyEmbedding,
      { topK: 3 },
    );
    expect(result.detailFacts.length).toBeGreaterThan(0);
    expect(result.detailFacts.length).toBeLessThanOrEqual(3);
  });

  it("returns empty profile dimensions for unmatched question with empty profile", () => {
    const emptyProfile = buildUserProfile([], "empty");
    const result = openDomainRetrieval(
      "What is Alice's job?",
      emptyProfile,
      index,
      dummyEmbedding,
      { topK: 5 },
    );
    // With empty profile, selectProfileDimensions returns broad summary which is empty
    expect(result.profileDimensions).toHaveLength(0);
  });

  it("respects topK option", () => {
    const result = openDomainRetrieval(
      "Tell me about Alice",
      profile,
      index,
      dummyEmbedding,
      { topK: 2 },
    );
    expect(result.detailFacts.length).toBeLessThanOrEqual(2);
  });

  it("filters by referenceTime when provided", () => {
    const futureTime = Date.UTC(2019, 0, 1); // before all facts
    const result = openDomainRetrieval(
      "Tell me about Alice",
      profile,
      index,
      dummyEmbedding,
      { topK: 5, referenceTime: futureTime },
    );
    // All facts have valid_at >= 2020, so they should be filtered out
    // (except the 2020 graduation fact which has valid_at = 2020-06-01 > 2019-01-01)
    expect(result.detailFacts.length).toBe(0);
  });
});

describe("buildProfileContextString", () => {
  it("returns empty array for empty dimensions", () => {
    const result = buildProfileContextString([]);
    expect(result).toHaveLength(0);
  });

  it("groups dimensions by category", () => {
    const dims = [
      {
        category: "occupation" as const,
        subject: "Alice",
        value: "works as an engineer",
        valid_at: Date.UTC(2023, 0, 1),
        sourceFactIds: ["f1"],
      },
      {
        category: "occupation" as const,
        subject: "Alice",
        value: "previously worked as a teacher",
        valid_at: Date.UTC(2020, 0, 1),
        sourceFactIds: ["f2"],
      },
      {
        category: "relationships" as const,
        subject: "Alice",
        value: "is married to Bob",
        valid_at: Date.UTC(2023, 0, 1),
        sourceFactIds: ["f3"],
      },
    ];
    const result = buildProfileContextString(dims);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toContain("Profile Summary");
    // Should contain both categories
    const joined = result.join("\n");
    expect(joined).toContain("occupation");
    expect(joined).toContain("relationships");
  });
});
