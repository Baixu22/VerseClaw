// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildUserProfile,
  selectProfileDimensions,
} from "../../openclaw_runtime/src/runtime-core/memory-user-profile";
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

describe("buildUserProfile", () => {
  it("classifies occupation facts correctly", () => {
    const facts = [
      makeFact("Alice", "occupation", "works as a software engineer at Google"),
      makeFact("Bob", "occupation", "is a registered nurse"),
    ];
    const profile = buildUserProfile(facts, "test");
    expect(profile.dimensions.occupation).toHaveLength(2);
    expect(profile.dimensions.occupation[0].subject).toBe("Alice");
    expect(profile.dimensions.occupation[1].subject).toBe("Bob");
  });

  it("classifies preferences facts correctly", () => {
    const facts = [
      makeFact("Alice", "preference", "likes gardening and hiking"),
      makeFact("Bob", "preference", "enjoys playing chess in his free time"),
    ];
    const profile = buildUserProfile(facts, "test");
    expect(profile.dimensions.preferences).toHaveLength(2);
  });

  it("classifies relationship facts correctly", () => {
    const facts = [
      makeFact("Alice", "relationship", "is married to Bob"),
      makeFact("Charlie", "relationship", "has a sister named Diana"),
    ];
    const profile = buildUserProfile(facts, "test");
    expect(profile.dimensions.relationships).toHaveLength(2);
  });

  it("classifies location facts correctly", () => {
    const facts = [
      makeFact("Alice", "location", "lives in Brooklyn, New York"),
      makeFact("Bob", "location", "is from Toronto, Canada"),
    ];
    const profile = buildUserProfile(facts, "test");
    expect(profile.dimensions.locations).toHaveLength(2);
  });

  it("classifies timeline facts (all facts with valid_at)", () => {
    const facts = [
      makeFact("Alice", "event", "moved to New York", Date.UTC(2023, 0, 1)),
      makeFact("Alice", "event", "started a new job", Date.UTC(2023, 5, 1)),
      makeFact("Alice", "event", "got married", Date.UTC(2023, 11, 1)),
    ];
    const profile = buildUserProfile(facts, "test");
    expect(profile.dimensions.timeline).toHaveLength(3);
    // Should be sorted chronologically (oldest first)
    expect(profile.dimensions.timeline[0].valid_at).toBe(Date.UTC(2023, 0, 1));
    expect(profile.dimensions.timeline[2].valid_at).toBe(Date.UTC(2023, 11, 1));
  });

  it("handles facts that match multiple dimensions", () => {
    const facts = [
      makeFact("Alice", "event", "moved to Brooklyn for her new job as a teacher"),
    ];
    const profile = buildUserProfile(facts, "test");
    // This fact should appear in occupation, locations, and timeline
    expect(profile.dimensions.occupation.length).toBeGreaterThanOrEqual(1);
    expect(profile.dimensions.locations.length).toBeGreaterThanOrEqual(1);
    expect(profile.dimensions.timeline.length).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates facts by objectSummary within a dimension", () => {
    const facts = [
      makeFact("Alice", "occupation", "works as a nurse"),
      makeFact("Alice", "occupation", "works as a nurse"), // duplicate
    ];
    const profile = buildUserProfile(facts, "test");
    expect(profile.dimensions.occupation).toHaveLength(1);
  });

  it("returns empty profile for empty facts", () => {
    const profile = buildUserProfile([], "test");
    expect(profile.dimensions.occupation).toHaveLength(0);
    expect(profile.dimensions.preferences).toHaveLength(0);
    expect(profile.dimensions.relationships).toHaveLength(0);
    expect(profile.dimensions.locations).toHaveLength(0);
    expect(profile.dimensions.timeline).toHaveLength(0);
  });

  it("sets userId and lastUpdated correctly", () => {
    const profile = buildUserProfile([], "user123");
    expect(profile.userId).toBe("user123");
    expect(profile.lastUpdated).toBeGreaterThan(0);
  });
});

describe("selectProfileDimensions", () => {
  const facts: RuntimeMemoryQueryableFact[] = [
    makeFact("Alice", "occupation", "works as a software engineer"),
    makeFact("Alice", "preference", "likes hiking and photography"),
    makeFact("Alice", "relationship", "is married to Bob"),
    makeFact("Alice", "location", "lives in San Francisco"),
    makeFact("Alice", "event", "graduated in 2020", Date.UTC(2020, 5, 1)),
  ];
  const profile = buildUserProfile(facts, "alice");

  it("returns occupation dimensions for job question", () => {
    const dims = selectProfileDimensions("What is Alice's job?", profile);
    expect(dims.some((d) => d.category === "occupation")).toBe(true);
  });

  it("returns relationship dimensions for family question", () => {
    const dims = selectProfileDimensions("Who is Alice's husband?", profile);
    expect(dims.some((d) => d.category === "relationships")).toBe(true);
  });

  it("returns location dimensions for where question", () => {
    const dims = selectProfileDimensions("Where does Alice live?", profile);
    expect(dims.some((d) => d.category === "locations")).toBe(true);
  });

  it("returns preference dimensions for hobby question", () => {
    const dims = selectProfileDimensions("What are Alice's hobbies?", profile);
    expect(dims.some((d) => d.category === "preferences")).toBe(true);
  });

  it("returns timeline dimensions for when question", () => {
    const dims = selectProfileDimensions("When did Alice graduate?", profile);
    expect(dims.some((d) => d.category === "timeline")).toBe(true);
  });

  it("returns broad summary for unmatched question", () => {
    const dims = selectProfileDimensions("Tell me about Alice", profile);
    // Should return a broad summary from multiple dimensions
    expect(dims.length).toBeGreaterThan(0);
  });

  it("returns empty array for unmatched question with empty profile", () => {
    const emptyProfile = buildUserProfile([], "empty");
    const dims = selectProfileDimensions("What is Alice's job?", emptyProfile);
    // With empty profile, no dimensions to return — but selectProfileDimensions
    // returns broad summary which is also empty
    expect(dims).toHaveLength(0);
  });

  it("returns multiple dimensions for broad question", () => {
    const dims = selectProfileDimensions(
      "What can you tell me about Alice's life, family, and career?",
      profile,
    );
    // Should match occupation, relationships, and possibly others
    const categories = new Set(dims.map((d) => d.category));
    expect(categories.size).toBeGreaterThan(1);
  });
});
