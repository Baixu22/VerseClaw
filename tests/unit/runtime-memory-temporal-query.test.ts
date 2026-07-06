// @vitest-environment node
// Phase 3.2: Temporal query operator tests.
// Validates the three temporal modes (filter / boost / strict) inspired by
// Zep's bi-temporal model:
//   - filter: exclude future + invalidated + expired facts (default behavior)
//   - boost: filter + recency boost (up to +10%) for facts near referenceTime
//   - strict: only return facts valid AT referenceTime (valid_at ≤ t < invalid_at)

import { describe, expect, it } from "vitest";
import { hybridSearchFacts } from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import {
  buildRuntimeMemoryTemporalFactFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1000 * DAY_MS; // 1000 days in ms — a fixed reference point

function makeFact(
  id: string,
  subject: string,
  predicate: string,
  objectSummary: string,
  overrides: {
    valid_at?: number;
    invalid_at?: number;
    expired_at?: number;
    confidence?: number;
  } = {},
) {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: id,
    subject,
    predicate,
    objectSummary,
    ...overrides,
  });
}

describe("Phase 3.2: Temporal query operator", () => {
  // === filter mode (default) ===

  describe("filter mode (default)", () => {
    it("excludes facts with valid_at > referenceTime (future facts)", () => {
      const facts = [
        makeFact("past", "UserPref", "theme", "prefers dark mode", {
          valid_at: NOW - 10 * DAY_MS,
        }),
        makeFact("future", "UserPref", "theme", "prefers light mode", {
          valid_at: NOW + 10 * DAY_MS,
        }),
      ];

      const hits = hybridSearchFacts(facts, {
        queryText: "theme preference",
        referenceTime: NOW,
      });

      const hitIds = hits.map((h) => h.fact.factId);
      expect(hitIds).toContain("past");
      expect(hitIds).not.toContain("future");
    });

    it("excludes invalidated facts (invalid_at <= referenceTime)", () => {
      const facts = [
        makeFact("valid", "UserPref", "theme", "prefers dark mode", {
          valid_at: NOW - 20 * DAY_MS,
        }),
        makeFact("invalidated", "UserPref", "theme", "prefers light mode", {
          valid_at: NOW - 30 * DAY_MS,
          invalid_at: NOW - 10 * DAY_MS,
        }),
      ];

      const hits = hybridSearchFacts(facts, {
        queryText: "theme preference",
        referenceTime: NOW,
      });

      const hitIds = hits.map((h) => h.fact.factId);
      expect(hitIds).toContain("valid");
      expect(hitIds).not.toContain("invalidated");
    });

    it("excludes expired facts (expired_at <= referenceTime)", () => {
      const facts = [
        makeFact("active", "UserPref", "theme", "prefers dark mode", {
          valid_at: NOW - 20 * DAY_MS,
        }),
        makeFact("expired", "UserPref", "theme", "prefers light mode", {
          valid_at: NOW - 30 * DAY_MS,
          expired_at: NOW - 10 * DAY_MS,
        }),
      ];

      const hits = hybridSearchFacts(facts, {
        queryText: "theme preference",
        referenceTime: NOW,
      });

      const hitIds = hits.map((h) => h.fact.factId);
      expect(hitIds).toContain("active");
      expect(hitIds).not.toContain("expired");
    });

    it("does not filter when referenceTime is undefined", () => {
      const facts = [
        makeFact("f1", "UserPref", "theme", "prefers dark mode", {
          valid_at: 100,
        }),
        makeFact("f2", "UserPref", "theme", "prefers light mode", {
          valid_at: 9999999999999,
        }),
      ];

      const hits = hybridSearchFacts(facts, {
        queryText: "theme preference",
      });

      expect(hits.length).toBeGreaterThan(0);
    });
  });

  // === boost mode ===

  describe("boost mode", () => {
    it("boosts facts closer to referenceTime in ranking", () => {
      // Two facts with similar text but different valid_at
      // The one closer to referenceTime should rank higher due to boost
      const refTime = NOW;
      const facts = [
        makeFact("recent", "UserPref", "theme", "user prefers dark theme", {
          valid_at: refTime - 1 * DAY_MS,
          confidence: 0.5,
        }),
        makeFact("old", "UserPref", "theme", "user prefers dark theme", {
          valid_at: refTime - 200 * DAY_MS,
          confidence: 0.5,
        }),
      ];

      const filterHits = hybridSearchFacts(facts, {
        queryText: "dark theme",
        referenceTime: refTime,
        temporalMode: "filter",
      });

      const boostHits = hybridSearchFacts(facts, {
        queryText: "dark theme",
        referenceTime: refTime,
        temporalMode: "boost",
      });

      // Both should return both facts
      expect(filterHits.length).toBe(2);
      expect(boostHits.length).toBe(2);

      // In boost mode, the recent fact should get a higher score
      const boostRecent = boostHits.find((h) => h.fact.factId === "recent");
      const boostOld = boostHits.find((h) => h.fact.factId === "old");
      expect(boostRecent).toBeDefined();
      expect(boostOld).toBeDefined();
      expect(boostRecent!.rrfScore).toBeGreaterThan(boostOld!.rrfScore);
    });

    it("boost mode still filters out future and invalidated facts", () => {
      const facts = [
        makeFact("valid", "UserPref", "theme", "prefers dark mode", {
          valid_at: NOW - 10 * DAY_MS,
        }),
        makeFact("future", "UserPref", "theme", "prefers light mode", {
          valid_at: NOW + 10 * DAY_MS,
        }),
        makeFact("invalidated", "UserPref", "theme", "prefers high contrast", {
          valid_at: NOW - 30 * DAY_MS,
          invalid_at: NOW - 10 * DAY_MS,
        }),
      ];

      const hits = hybridSearchFacts(facts, {
        queryText: "theme preference",
        referenceTime: NOW,
        temporalMode: "boost",
      });

      const hitIds = hits.map((h) => h.fact.factId);
      expect(hitIds).toContain("valid");
      expect(hitIds).not.toContain("future");
      expect(hitIds).not.toContain("invalidated");
    });

    it("boost is at most 10% of base RRF score", () => {
      const facts = [
        makeFact("f1", "UserPref", "theme", "prefers dark mode", {
          valid_at: NOW - 1 * DAY_MS,
        }),
      ];

      const filterHits = hybridSearchFacts(facts, {
        queryText: "dark mode",
        referenceTime: NOW,
        temporalMode: "filter",
      });

      const boostHits = hybridSearchFacts(facts, {
        queryText: "dark mode",
        referenceTime: NOW,
        temporalMode: "boost",
      });

      expect(filterHits.length).toBe(1);
      expect(boostHits.length).toBe(1);

      const baseScore = filterHits[0].rrfScore;
      const boostedScore = boostHits[0].rrfScore;
      const maxBoost = baseScore * 1.1;

      expect(boostedScore).toBeGreaterThan(baseScore);
      expect(boostedScore).toBeLessThanOrEqual(maxBoost + 1e-9);
    });
  });

  // === strict mode ===

  describe("strict mode", () => {
    it("returns only facts valid AT referenceTime (what did we know at time X?)", () => {
      const refTime = NOW;
      const facts = [
        // Valid at refTime: valid_at <= refTime, no invalid_at
        makeFact("active", "UserPref", "theme", "prefers dark mode", {
          valid_at: refTime - 20 * DAY_MS,
        }),
        // Valid at refTime: valid_at <= refTime, invalid_at > refTime
        makeFact("later_invalid", "UserPref", "editor", "uses vim", {
          valid_at: refTime - 30 * DAY_MS,
          invalid_at: refTime + 10 * DAY_MS,
        }),
        // Invalid at refTime: invalid_at <= refTime
        makeFact("was_invalid", "UserPref", "lang", "uses Python", {
          valid_at: refTime - 50 * DAY_MS,
          invalid_at: refTime - 10 * DAY_MS,
        }),
        // Future fact: valid_at > refTime
        makeFact("future", "UserPref", "theme", "prefers light mode", {
          valid_at: refTime + 10 * DAY_MS,
        }),
      ];

      const hits = hybridSearchFacts(facts, {
        queryText: "user preferences",
        referenceTime: refTime,
        temporalMode: "strict",
      });

      const hitIds = hits.map((h) => h.fact.factId);
      expect(hitIds).toContain("active");
      expect(hitIds).toContain("later_invalid");
      expect(hitIds).not.toContain("was_invalid");
      expect(hitIds).not.toContain("future");
    });

    it("strict mode does NOT exclude expired facts (only checks invalid_at)", () => {
      const refTime = NOW;
      const facts = [
        // Expired but not invalidated — strict mode includes it
        makeFact("expired_only", "UserPref", "theme", "prefers dark mode", {
          valid_at: refTime - 30 * DAY_MS,
          expired_at: refTime - 10 * DAY_MS,
        }),
        // Invalidated — strict mode excludes it
        makeFact("invalidated", "UserPref", "theme", "prefers light mode", {
          valid_at: refTime - 30 * DAY_MS,
          invalid_at: refTime - 10 * DAY_MS,
        }),
      ];

      const filterHits = hybridSearchFacts(facts, {
        queryText: "theme preference",
        referenceTime: refTime,
        temporalMode: "filter",
      });

      const strictHits = hybridSearchFacts(facts, {
        queryText: "theme preference",
        referenceTime: refTime,
        temporalMode: "strict",
      });

      const filterIds = filterHits.map((h) => h.fact.factId);
      const strictIds = strictHits.map((h) => h.fact.factId);

      // filter mode excludes expired facts
      expect(filterIds).not.toContain("expired_only");
      // strict mode includes expired facts (only checks invalid_at)
      expect(strictIds).toContain("expired_only");
      // both modes exclude invalidated facts
      expect(filterIds).not.toContain("invalidated");
      expect(strictIds).not.toContain("invalidated");
    });
  });

  // === No-harm: boost mode should not regress filter mode ===

  describe("no-harm", () => {
    it("boost mode returns same fact set as filter mode (only reorders)", () => {
      const facts = [
        makeFact("f1", "UserPref", "theme", "prefers dark mode", {
          valid_at: NOW - 5 * DAY_MS,
        }),
        makeFact("f2", "UserPref", "editor", "uses vim", {
          valid_at: NOW - 30 * DAY_MS,
        }),
        makeFact("f3", "UserPref", "lang", "uses TypeScript", {
          valid_at: NOW - 100 * DAY_MS,
        }),
      ];

      const filterHits = hybridSearchFacts(facts, {
        queryText: "user preferences",
        referenceTime: NOW,
        temporalMode: "filter",
      });

      const boostHits = hybridSearchFacts(facts, {
        queryText: "user preferences",
        referenceTime: NOW,
        temporalMode: "boost",
      });

      const filterIds = new Set(filterHits.map((h) => h.fact.factId));
      const boostIds = new Set(boostHits.map((h) => h.fact.factId));

      expect(boostIds.size).toBe(filterIds.size);
      for (const id of filterIds) {
        expect(boostIds.has(id)).toBe(true);
      }
    });
  });

  // === candidateThreshold (Phase 1.4) ===

  describe("candidateThreshold", () => {
    it("includes high-confidence candidates when threshold is set", () => {
      const facts = [
        makeFact("verified", "UserPref", "theme", "prefers dark mode", {
          valid_at: NOW - 10 * DAY_MS,
        }),
        buildRuntimeMemoryTemporalFactCandidateFixture({
          factId: "high_conf_candidate",
          subject: "UserPref",
          predicate: "theme",
          objectSummary: "prefers solarized theme",
          confidence: 0.8,
          valid_at: NOW - 5 * DAY_MS,
        }),
        buildRuntimeMemoryTemporalFactCandidateFixture({
          factId: "low_conf_candidate",
          subject: "UserPref",
          predicate: "theme",
          objectSummary: "prefers random colors",
          confidence: 0.3,
          valid_at: NOW - 5 * DAY_MS,
        }),
      ];

      const hits = hybridSearchFacts(facts, {
        queryText: "theme preference",
        referenceTime: NOW,
        candidateThreshold: 0.7,
      });

      const hitIds = hits.map((h) => h.fact.factId);
      expect(hitIds).toContain("verified");
      expect(hitIds).toContain("high_conf_candidate");
      expect(hitIds).not.toContain("low_conf_candidate");
    });

    it("excludes all candidates when threshold not set", () => {
      const facts = [
        makeFact("verified", "UserPref", "theme", "prefers dark mode", {
          valid_at: NOW - 10 * DAY_MS,
        }),
        buildRuntimeMemoryTemporalFactCandidateFixture({
          factId: "high_conf_candidate",
          subject: "UserPref",
          predicate: "theme",
          objectSummary: "prefers solarized theme",
          confidence: 0.9,
          valid_at: NOW - 5 * DAY_MS,
        }),
      ];

      const hits = hybridSearchFacts(facts, {
        queryText: "theme preference",
        referenceTime: NOW,
      });

      const hitIds = hits.map((h) => h.fact.factId);
      expect(hitIds).toContain("verified");
      expect(hitIds).not.toContain("high_conf_candidate");
    });

    it("includeCandidates overrides candidateThreshold", () => {
      const facts = [
        makeFact("verified", "UserPref", "theme", "prefers dark mode", {
          valid_at: NOW - 10 * DAY_MS,
        }),
        buildRuntimeMemoryTemporalFactCandidateFixture({
          factId: "low_conf_candidate",
          subject: "UserPref",
          predicate: "theme",
          objectSummary: "prefers random colors",
          confidence: 0.1,
          valid_at: NOW - 5 * DAY_MS,
        }),
      ];

      const hits = hybridSearchFacts(facts, {
        queryText: "theme preference",
        referenceTime: NOW,
        includeCandidates: true,
        candidateThreshold: 0.7,
      });

      const hitIds = hits.map((h) => h.fact.factId);
      expect(hitIds).toContain("verified");
      expect(hitIds).toContain("low_conf_candidate");
    });
  });
});
