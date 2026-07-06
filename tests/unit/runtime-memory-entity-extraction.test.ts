// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  extractEntityTriplets,
  findFactsWithSharedEntities,
  buildEntityRelationMap,
  getRelatedFactIds,
} from "../../openclaw_runtime/src/runtime-core/memory-entity-extraction";

describe("memory-entity-extraction", () => {
  describe("extractEntityTriplets", () => {
    it("extracts proper nouns as entities", () => {
      const triplets = extractEntityTriplets("Alice", "works at City Hospital");
      const entities = triplets.map((t) => t.entity);
      expect(entities).toContain("alice");
      expect(entities).toContain("city");
      expect(entities).toContain("hospital");
    });

    it("extracts numbers as entities", () => {
      const triplets = extractEntityTriplets("Bob", "was born in 1990");
      const entities = triplets.map((t) => t.entity);
      expect(entities).toContain("bob");
      expect(entities).toContain("1990");
    });

    it("returns empty array for text with no entities", () => {
      const triplets = extractEntityTriplets("a", "is a thing");
      expect(triplets).toHaveLength(0);
    });
  });

  describe("findFactsWithSharedEntities", () => {
    it("finds facts sharing a proper noun", () => {
      const newFact = {
        factId: "f1",
        subject: "Alice",
        objectSummary: "works as a nurse at City Hospital",
      };
      const existing = [
        {
          factId: "f2",
          subject: "City Hospital",
          objectSummary: "is located in downtown",
        },
      ];
      const relations = findFactsWithSharedEntities(newFact, existing);
      expect(relations).toHaveLength(1);
      expect(relations[0].sourceFactId).toBe("f1");
      expect(relations[0].targetFactId).toBe("f2");
      expect(relations[0].sharedEntities).toContain("city");
      expect(relations[0].sharedEntities).toContain("hospital");
    });

    it("returns empty array when no shared entities", () => {
      const newFact = {
        factId: "f1",
        subject: "Alice",
        objectSummary: "likes cats",
      };
      const existing = [
        {
          factId: "f2",
          subject: "Bob",
          objectSummary: "works downtown",
        },
      ];
      const relations = findFactsWithSharedEntities(newFact, existing);
      expect(relations).toHaveLength(0);
    });

    it("skips self-matching", () => {
      const fact = {
        factId: "f1",
        subject: "Alice",
        objectSummary: "works as a nurse",
      };
      const relations = findFactsWithSharedEntities(fact, [fact]);
      expect(relations).toHaveLength(0);
    });

    it("increases confidence with more shared entities", () => {
      const newFact = {
        factId: "f1",
        subject: "Alice",
        objectSummary: "met Caroline at the support group in London",
      };
      const existing = [
        {
          factId: "f2",
          subject: "Caroline",
          objectSummary: "lives in London and attends the support group",
        },
      ];
      const relations = findFactsWithSharedEntities(newFact, existing);
      expect(relations).toHaveLength(1);
      expect(relations[0].sharedEntities.length).toBeGreaterThanOrEqual(2);
      expect(relations[0].confidence).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("buildEntityRelationMap", () => {
    it("builds bidirectional relation map", () => {
      const facts = [
        { factId: "f1", subject: "Alice", objectSummary: "works with Bob" },
        { factId: "f2", subject: "Bob", objectSummary: "is Alice's colleague" },
        { factId: "f3", subject: "Charlie", objectSummary: "lives far away" },
      ];
      const map = buildEntityRelationMap(facts);
      expect(map.get("f1")).toContain("f2");
      expect(map.get("f2")).toContain("f1");
      expect(map.get("f3") ?? []).toHaveLength(0);
    });

    it("handles empty input", () => {
      const map = buildEntityRelationMap([]);
      expect(map.size).toBe(0);
    });

    it("handles single fact", () => {
      const map = buildEntityRelationMap([
        { factId: "f1", subject: "Alice", objectSummary: "is here" },
      ]);
      expect(map.get("f1") ?? []).toHaveLength(0);
    });
  });

  describe("getRelatedFactIds", () => {
    it("returns direct neighbors at depth 1", () => {
      const relationMap = new Map<string, string[]>([
        ["f1", ["f2", "f3"]],
        ["f2", ["f1"]],
        ["f3", ["f1"]],
      ]);
      const related = getRelatedFactIds("f1", relationMap, 1);
      expect(related.sort()).toEqual(["f2", "f3"]);
    });

    it("traverses multi-hop at depth 2", () => {
      const relationMap = new Map<string, string[]>([
        ["f1", ["f2"]],
        ["f2", ["f1", "f3"]],
        ["f3", ["f2"]],
      ]);
      const related = getRelatedFactIds("f1", relationMap, 2);
      expect(related).toContain("f2");
      expect(related).toContain("f3");
    });

    it("returns empty for isolated fact", () => {
      const relationMap = new Map<string, string[]>([
        ["f1", []],
      ]);
      const related = getRelatedFactIds("f1", relationMap, 1);
      expect(related).toHaveLength(0);
    });
  });
});
