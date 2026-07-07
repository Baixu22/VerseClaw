// @vitest-environment node
// P2-1: Mental Model Delta Refresh (Hindsight-inspired) — dedicated unit tests.
//
// Verifies the deterministic delta computation correctly:
// - Creates empty models
// - Derives canonical facet keys from predicates
// - Detects ADD / UPDATE / NO_CHANGE / CONTRADICT operations
// - Applies deltas as pure functions (no mutation)
// - Renders compact text for the generator
// - Detects contradictions via negation patterns
import { describe, expect, it } from "vitest";
import {
  applyMentalModelDelta,
  computeMentalModelDelta,
  createMentalModel,
  deriveFacetKey,
  renderMentalModel,
} from "./mental-model";

describe("createMentalModel", () => {
  it("creates an empty model for a subject", () => {
    const model = createMentalModel("Jon");
    expect(model.subject).toBe("Jon");
    expect(model.facets.size).toBe(0);
    expect(model.lastRefreshed).toBe(0);
  });
});

describe("deriveFacetKey", () => {
  it("maps occupation predicates to canonical facet", () => {
    expect(deriveFacetKey("started_job")).toBe("occupation");
    expect(deriveFacetKey("has_job")).toBe("occupation");
    expect(deriveFacetKey("works_as")).toBe("occupation");
    expect(deriveFacetKey("occupation")).toBe("occupation");
  });

  it("maps education predicates", () => {
    expect(deriveFacetKey("studied")).toBe("education.major");
    expect(deriveFacetKey("graduated_from")).toBe("education.school");
  });

  it("maps family predicates", () => {
    expect(deriveFacetKey("married_to")).toBe("family.spouse");
    expect(deriveFacetKey("has_child")).toBe("family.children");
    expect(deriveFacetKey("has_pet")).toBe("family.pets");
  });

  it("maps preference predicates", () => {
    expect(deriveFacetKey("likes")).toBe("preferences.like");
    expect(deriveFacetKey("dislikes")).toBe("preferences.dislike");
    expect(deriveFacetKey("hobby")).toBe("preferences.hobby");
  });

  it("maps lifestyle predicates", () => {
    expect(deriveFacetKey("lives_in")).toBe("lifestyle.location");
    expect(deriveFacetKey("moved_to")).toBe("lifestyle.location");
  });

  it("passes through unknown predicates as-is", () => {
    expect(deriveFacetKey("random_unknown_predicate")).toBe("random_unknown_predicate");
  });

  it("lowercases and trims input", () => {
    expect(deriveFacetKey("  STARTED_JOB  ")).toBe("occupation");
  });
});

describe("computeMentalModelDelta", () => {
  const refTime = 1_700_000_000_000;

  it("emits ADD for new facets", () => {
    const model = createMentalModel("Jon");
    const delta = computeMentalModelDelta(model, [
      { factId: "f1", predicate: "started_job", objectSummary: "software engineer", sessionDate: refTime },
    ], refTime);

    expect(delta.stats.added).toBe(1);
    expect(delta.stats.updated).toBe(0);
    expect(delta.stats.unchanged).toBe(0);
    expect(delta.stats.contradicted).toBe(0);
    expect(delta.facets).toHaveLength(1);
    expect(delta.facets[0].operation).toBe("ADD");
    expect(delta.facets[0].key).toBe("occupation");
    expect(delta.facets[0].newValue).toBe("software engineer");
  });

  it("emits NO_CHANGE for identical values", () => {
    const model = createMentalModel("Jon");
    // First fact establishes the facet
    const d1 = computeMentalModelDelta(model, [
      { factId: "f1", predicate: "started_job", objectSummary: "software engineer at Google" },
    ], refTime);
    const updated = applyMentalModelDelta(model, d1);

    // Second fact with similar value → NO_CHANGE
    const d2 = computeMentalModelDelta(updated, [
      { factId: "f2", predicate: "started_job", objectSummary: "software engineer at Google" },
    ], refTime);

    expect(d2.stats.unchanged).toBe(1);
    expect(d2.facets[0].operation).toBe("NO_CHANGE");
  });

  it("emits UPDATE for different but non-contradicting values", () => {
    const model = createMentalModel("Jon");
    const d1 = computeMentalModelDelta(model, [
      { factId: "f1", predicate: "started_job", objectSummary: "software engineer at Google" },
    ], refTime);
    const updated = applyMentalModelDelta(model, d1);

    // Different value, not a contradiction → UPDATE
    const d2 = computeMentalModelDelta(updated, [
      { factId: "f2", predicate: "started_job", objectSummary: "senior developer at Microsoft" },
    ], refTime);

    expect(d2.stats.updated).toBe(1);
    expect(d2.facets[0].operation).toBe("UPDATE");
    expect(d2.facets[0].oldValue).toBe("software engineer at Google");
    expect(d2.facets[0].newValue).toBe("senior developer at Microsoft");
  });

  it("emits CONTRADICT for negated values", () => {
    const model = createMentalModel("Jon");
    const d1 = computeMentalModelDelta(model, [
      { factId: "f1", predicate: "likes", objectSummary: "Jon likes hiking" },
    ], refTime);
    const updated = applyMentalModelDelta(model, d1);

    // Negated value → CONTRADICT
    // Jaccard similarity must be > 0.3 for contradiction detection.
    // "Jon likes hiking" vs "Jon does not like hiking":
    //   intersection = {jon, hiking} = 2, union = {jon, likes, hiking, does, not, like} = 6
    //   similarity = 2/6 = 0.33 > 0.3 ✓
    const d2 = computeMentalModelDelta(updated, [
      { factId: "f2", predicate: "likes", objectSummary: "Jon does not like hiking" },
    ], refTime);

    expect(d2.stats.contradicted).toBe(1);
    expect(d2.facets[0].operation).toBe("CONTRADICT");
  });

  it("detects 'no longer' as contradiction", () => {
    const model = createMentalModel("Jon");
    const d1 = computeMentalModelDelta(model, [
      { factId: "f1", predicate: "lives_in", objectSummary: "Jon lives in New York" },
    ], refTime);
    const updated = applyMentalModelDelta(model, d1);

    // "Jon lives in New York" vs "Jon no longer lives in New York":
    //   intersection = {jon, lives, in, new, york} = 5
    //   union = {jon, lives, in, new, york, no, longer} = 7
    //   similarity = 5/7 ≈ 0.71 > 0.3 ✓
    const d2 = computeMentalModelDelta(updated, [
      { factId: "f2", predicate: "lives_in", objectSummary: "Jon no longer lives in New York" },
    ], refTime);

    expect(d2.stats.contradicted).toBe(1);
  });

  it("handles multiple facts in one delta", () => {
    const model = createMentalModel("Jon");
    const delta = computeMentalModelDelta(model, [
      { factId: "f1", predicate: "started_job", objectSummary: "engineer at Google" },
      { factId: "f2", predicate: "married_to", objectSummary: "married to Sarah" },
      { factId: "f3", predicate: "hobby", objectSummary: "loves hiking" },
    ], refTime);

    expect(delta.stats.added).toBe(3);
    expect(delta.facets).toHaveLength(3);
    expect(delta.facets.map((f) => f.key).sort()).toEqual(["family.spouse", "occupation", "preferences.hobby"]);
  });
});

describe("applyMentalModelDelta", () => {
  const refTime = 1_700_000_000_000;

  it("is a pure function — does not mutate the input model", () => {
    const model = createMentalModel("Jon");
    const originalSize = model.facets.size;
    const delta = computeMentalModelDelta(model, [
      { factId: "f1", predicate: "started_job", objectSummary: "engineer" },
    ], refTime);

    const result = applyMentalModelDelta(model, delta);
    expect(model.facets.size).toBe(originalSize); // input unchanged
    expect(result.facets.size).toBe(1); // result has new facet
    expect(result).not.toBe(model); // new object
  });

  it("ADD creates a new facet with proofCount 1", () => {
    const model = createMentalModel("Jon");
    const delta = computeMentalModelDelta(model, [
      { factId: "f1", predicate: "started_job", objectSummary: "engineer", sessionDate: refTime },
    ], refTime);
    const result = applyMentalModelDelta(model, delta);

    const facet = result.facets.get("occupation");
    expect(facet).toBeDefined();
    expect(facet!.value).toBe("engineer");
    expect(facet!.proofCount).toBe(1);
    expect(facet!.sourceFactIds).toContain("f1");
    expect(facet!.trend).toBe("NEW");
  });

  it("NO_CHANGE increments proofCount", () => {
    const model = createMentalModel("Jon");
    const d1 = computeMentalModelDelta(model, [
      { factId: "f1", predicate: "started_job", objectSummary: "engineer at Google" },
    ], refTime);
    const m1 = applyMentalModelDelta(model, d1);

    const d2 = computeMentalModelDelta(m1, [
      { factId: "f2", predicate: "started_job", objectSummary: "engineer at Google" },
    ], refTime);
    const m2 = applyMentalModelDelta(m1, d2);

    const facet = m2.facets.get("occupation");
    expect(facet!.proofCount).toBe(2);
  });

  it("UPDATE replaces value and keeps history in sourceFactIds", () => {
    const model = createMentalModel("Jon");
    const d1 = computeMentalModelDelta(model, [
      { factId: "f1", predicate: "started_job", objectSummary: "engineer at Google" },
    ], refTime);
    const m1 = applyMentalModelDelta(model, d1);

    const d2 = computeMentalModelDelta(m1, [
      { factId: "f2", predicate: "started_job", objectSummary: "senior developer at Microsoft" },
    ], refTime);
    const m2 = applyMentalModelDelta(m1, d2);

    const facet = m2.facets.get("occupation");
    expect(facet!.value).toBe("senior developer at Microsoft");
    expect(facet!.sourceFactIds).toContain("f1");
    expect(facet!.sourceFactIds).toContain("f2");
    expect(facet!.trend).toBe("STRENGTHENING");
  });
});

describe("renderMentalModel", () => {
  it("renders a compact text block with facets sorted by proofCount", () => {
    const model = createMentalModel("Jon");
    const refTime = 1_700_000_000_000;
    const d = computeMentalModelDelta(model, [
      { factId: "f1", predicate: "started_job", objectSummary: "engineer at Google", sessionDate: refTime },
      { factId: "f2", predicate: "married_to", objectSummary: "married to Sarah", sessionDate: refTime },
    ], refTime);
    const updated = applyMentalModelDelta(model, d);

    const text = renderMentalModel(updated);
    expect(text).toContain("## Mental Model: Jon");
    expect(text).toContain("occupation:");
    expect(text).toContain("family.spouse:");
    expect(text).toContain("engineer at Google");
    expect(text).toContain("married to Sarah");
    expect(text).toContain("proof: 1");
  });

  it("renders empty model with just the header", () => {
    const model = createMentalModel("Empty");
    const text = renderMentalModel(model);
    expect(text).toBe("## Mental Model: Empty");
  });
});
