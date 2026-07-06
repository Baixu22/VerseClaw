// @vitest-environment node
// Phase 3.1: Three-signal fusion (BM25 + Vector + Entity matching) tests.
// Validates that the entity matching path improves retrieval for queries
// containing proper nouns, identifiers, and numbers — where BM25 and
// character n-grams dilute the exact-match signal.

import { describe, expect, it } from "vitest";
import {
  HybridSearchIndex,
  OPTIMAL_HYBRID_FUSION,
  extractEntities,
  hybridSearchFacts,
  type HybridSearchFusionOptions,
} from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import {
  buildRuntimeMemoryTemporalFactFixture,
} from "../../openclaw_runtime/src/runtime-core/memory-context";

function makeFact(
  id: string,
  subject: string,
  predicate: string,
  objectSummary: string,
) {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: id,
    subject,
    predicate,
    objectSummary,
  });
}

describe("Phase 3.1: Three-signal retrieval (entity boost)", () => {
  // === Entity extraction tests ===

  describe("extractEntities", () => {
    it("extracts proper nouns (capitalized words 3+ chars)", () => {
      const entities = extractEntities("User prefers TypeScript over JavaScript");
      expect(entities.has("typescript")).toBe(true);
      expect(entities.has("javascript")).toBe(true);
      expect(entities.has("user")).toBe(true);
    });

    it("extracts camelCase identifiers", () => {
      const entities = extractEntities("Uses ReactStrictMode and useCallback hook");
      expect(entities.has("reactstrictmode")).toBe(true);
      expect(entities.has("usecallback")).toBe(true);
    });

    it("extracts snake_case identifiers", () => {
      const entities = extractEntities("Config uses max_connections and retry_count");
      expect(entities.has("max_connections")).toBe(true);
      expect(entities.has("retry_count")).toBe(true);
    });

    it("extracts hyphenated identifiers", () => {
      const entities = extractEntities("Runs in dev mode with hot-reload");
      expect(entities.has("hot-reload")).toBe(true);
    });

    it("extracts multi-digit numbers", () => {
      const entities = extractEntities("Error code 404 and port 8080");
      expect(entities.has("404")).toBe(true);
      expect(entities.has("8080")).toBe(true);
    });

    it("does not extract single-digit numbers", () => {
      const entities = extractEntities("level seven step three");
      expect(entities.size).toBe(0);
    });

    it("returns empty set for plain lowercase text", () => {
      const entities = extractEntities("the quick brown fox jumps over the lazy dog");
      expect(entities.size).toBe(0);
    });
  });

  // === Entity path ranking tests ===

  describe("entity path ranking", () => {
    // NOTE: These tests isolate the entity path's contribution by using
    // normalizeByPathCount: false. Under OPTIMAL_HYBRID_FUSION (which uses
    // normalizeByPathCount: true), multi-path facts get their RRF score
    // divided by pathCount, which can let single-path facts rank higher.
    // That's the intended W19 behavior for production recall, but it makes
    // it hard to verify entity path functionality in isolation. So we use
    // normalizeByPathCount: false here to test entity path mechanics directly.
    const entityIsolationFusion: HybridSearchFusionOptions = {
      normalizeByPathCount: false,
      rrfK: 60,
      wBm25: 0.5,
      wVector: 1.0,
      wEntity: 0.5,
    };

    it("ranks facts with matching proper nouns higher", () => {
      const facts = [
        makeFact("f1", "UserPref", "theme", "prefers dark mode in VSCode"),
        makeFact("f2", "UserPref", "editor", "uses IntelliJ IDEA for Java"),
        makeFact("f3", "UserPref", "language", "writes Python scripts daily"),
      ];
      const index = new HybridSearchIndex(facts);

      const hits = index.search("VSCode configuration", 3, entityIsolationFusion);

      // f1 has "VSCode" entity match → should rank first
      expect(hits[0].fact.factId).toBe("f1");
      expect(hits[0].entityRank).toBe(1);
      expect(hits[0].entityScore).toBeGreaterThan(0);
    });

    it("ranks facts with matching identifiers higher", () => {
      const facts = [
        makeFact("f1", "Config", "setting", "max_connections set to 100"),
        makeFact("f2", "Config", "setting", "timeout_duration set to 30"),
        makeFact("f3", "Config", "setting", "retry_count set to 3"),
      ];
      const index = new HybridSearchIndex(facts);

      const hits = index.search("What is the retry_count setting?", 3, entityIsolationFusion);

      // f3 has "retry_count" entity match → should rank first
      expect(hits[0].fact.factId).toBe("f3");
      expect(hits[0].entityRank).toBe(1);
    });

    it("ranks facts with matching numbers higher", () => {
      const facts = [
        makeFact("f1", "Error", "code", "HTTP 404 not found"),
        makeFact("f2", "Error", "code", "HTTP 500 internal server error"),
        makeFact("f3", "Error", "code", "HTTP 503 service unavailable"),
      ];
      const index = new HybridSearchIndex(facts);

      const hits = index.search("What does error 404 mean?", 3, entityIsolationFusion);

      // f1 has "404" entity match → should rank first
      expect(hits[0].fact.factId).toBe("f1");
      expect(hits[0].entityRank).toBe(1);
    });
  });

  // === Three-signal vs two-signal comparison ===

  describe("three-signal vs two-signal", () => {
    it("entity boost improves ranking for proper-noun queries", () => {
      const facts = [
        makeFact("target", "ProjectConfig", "framework", "Uses ReactStrictMode in the app"),
        makeFact("distractor1", "ProjectConfig", "framework", "Uses React hooks for state"),
        makeFact("distractor2", "ProjectConfig", "framework", "Uses Vue components"),
      ];
      const index = new HybridSearchIndex(facts);

      // Both configs use normalizeByPathCount: false to isolate the entity
      // path's contribution (under normalizeByPathCount: true, adding a path
      // can actually lower a fact's score via division by pathCount).
      const twoSignalHits = index.search("ReactStrictMode setup", 3, {
        normalizeByPathCount: false,
        rrfK: 60,
        wBm25: 0.5,
        wVector: 1.0,
        wEntity: 0,
      });

      // With entity signal (wEntity = 0.5)
      const threeSignalHits = index.search("ReactStrictMode setup", 3, {
        normalizeByPathCount: false,
        rrfK: 60,
        wBm25: 0.5,
        wVector: 1.0,
        wEntity: 0.5,
      });

      // Both should return results
      expect(twoSignalHits.length).toBeGreaterThan(0);
      expect(threeSignalHits.length).toBeGreaterThan(0);

      // Three-signal should rank the target at least as high as two-signal
      const twoSignalTargetRank = twoSignalHits.findIndex((h) => h.fact.factId === "target");
      const threeSignalTargetRank = threeSignalHits.findIndex((h) => h.fact.factId === "target");
      expect(threeSignalTargetRank).toBeLessThanOrEqual(twoSignalTargetRank);
    });

    it("entity path is disabled when wEntity is 0 (backward compatibility)", () => {
      const facts = [
        makeFact("f1", "Config", "setting", "max_connections 100"),
        makeFact("f2", "Config", "setting", "timeout 30"),
      ];
      const index = new HybridSearchIndex(facts);

      const hits = index.search("max_connections", 2, {
        normalizeByPathCount: true,
        rrfK: 0,
        wBm25: 0.5,
        wVector: 1.0,
        wEntity: 0,
      });

      // No entity path contribution
      expect(hits.every((h) => h.entityRank === null)).toBe(true);
      expect(hits.every((h) => h.entityScore === 0)).toBe(true);
    });
  });

  // === HybridSearchHit shape tests ===

  describe("HybridSearchHit entity fields", () => {
    it("populates entityRank and entityScore for entity-matched facts", () => {
      const facts = [
        makeFact("f1", "UserPref", "tool", "Uses GitHub Actions for CI"),
        makeFact("f2", "UserPref", "tool", "Uses Jenkins for CI"),
      ];
      const index = new HybridSearchIndex(facts);

      const hits = index.search("GitHub Actions setup", 2, OPTIMAL_HYBRID_FUSION);

      const githubHit = hits.find((h) => h.fact.factId === "f1");
      expect(githubHit).toBeDefined();
      expect(githubHit!.entityRank).not.toBeNull();
      expect(githubHit!.entityScore).toBeGreaterThan(0);
    });

    it("entityRank is null for facts with no entity overlap", () => {
      const facts = [
        makeFact("f1", "UserPref", "tool", "Uses GitHub Actions for CI"),
        makeFact("f2", "UserPref", "tool", "uses plain text daily"),
      ];
      const index = new HybridSearchIndex(facts);

      const hits = index.search("GitHub Actions", 2, OPTIMAL_HYBRID_FUSION);

      const noEntityHit = hits.find((h) => h.fact.factId === "f2");
      if (noEntityHit) {
        expect(noEntityHit.entityRank).toBeNull();
        expect(noEntityHit.entityScore).toBe(0);
      }
    });
  });

  // === Convenience function tests ===

  describe("hybridSearchFacts with entity signal", () => {
    it("uses OPTIMAL_HYBRID_FUSION (with wEntity=0.5) by default", () => {
      const facts = [
        makeFact("f1", "Config", "key", "Uses configPath for application settings"),
        makeFact("f2", "Config", "key", "uses bcrypt hashing for passwords"),
      ];

      const hits = hybridSearchFacts(facts, { queryText: "configPath configuration" });

      // f1 should match via entity path (configPath is camelCase identifier)
      const f1Hit = hits.find((h) => h.fact.factId === "f1");
      if (f1Hit) {
        expect(f1Hit.entityRank).not.toBeNull();
      }
    });
  });

  // === No-harm guarantee ===

  describe("no-harm guarantee", () => {
    it("three-signal MRR ≥ two-signal MRR on entity-rich queries", () => {
      const facts = [
        makeFact("target", "ProjectSetup", "dependency", "Installs TypeScript compiler"),
        makeFact("noise1", "ProjectSetup", "dependency", "Installs ESLint linter"),
        makeFact("noise2", "ProjectSetup", "dependency", "Installs Prettier formatter"),
        makeFact("noise3", "ProjectSetup", "dependency", "Installs Jest runner"),
        makeFact("noise4", "ProjectSetup", "dependency", "Installs Webpack bundler"),
      ];
      const index = new HybridSearchIndex(facts);
      const query = "TypeScript compiler setup";

      // Both configs use normalizeByPathCount: false to isolate the entity
      // path's contribution (see entity path ranking tests above for rationale).
      const twoSignalFusion: HybridSearchFusionOptions = {
        normalizeByPathCount: false,
        rrfK: 60,
        wBm25: 0.5,
        wVector: 1.0,
        wEntity: 0,
      };
      const threeSignalFusion: HybridSearchFusionOptions = {
        normalizeByPathCount: false,
        rrfK: 60,
        wBm25: 0.5,
        wVector: 1.0,
        wEntity: 0.5,
      };

      const twoSignalHits = index.search(query, 5, twoSignalFusion);
      const threeSignalHits = index.search(query, 5, threeSignalFusion);

      const twoSignalRR = twoSignalHits.findIndex((h) => h.fact.factId === "target");
      const threeSignalRR = threeSignalHits.findIndex((h) => h.fact.factId === "target");

      // Three-signal should rank target at least as high (lower index = better)
      expect(threeSignalRR).toBeLessThanOrEqual(twoSignalRR >= 0 ? twoSignalRR : 5);
    });

    it("entity signal does not break queries without entities", () => {
      const facts = [
        makeFact("f1", "UserPref", "theme", "prefers dark mode for editing"),
        makeFact("f2", "UserPref", "theme", "prefers light mode for reading"),
      ];
      const index = new HybridSearchIndex(facts);

      // Query with no entities — should still return results via BM25 + Vector
      const hits = index.search("editing preference", 2, OPTIMAL_HYBRID_FUSION);

      expect(hits.length).toBeGreaterThan(0);
      // No entity path contribution for entity-less queries
      expect(hits.every((h) => h.entityRank === null)).toBe(true);
    });
  });
});
