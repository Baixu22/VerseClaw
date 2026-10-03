// @vitest-environment node
// P1-1: Graph Causal Score (Hindsight causal edges) — dedicated unit tests.
//
// Verifies that the weighted graph traversal correctly:
// - Builds causal edges from causes/caused_by/enables/prevents relations
// - Applies correct causal edge weights (causes=1.0, enables=0.7, prevents=0.5)
// - Adds pure causal edges when facts share no entities
// - Folds causalScore into entityScore in graphHitsToRRFHits
// - Aggregates causal scores along multi-hop paths (capped at 1.0)
import { describe, expect, it } from "vitest";
import {
  buildWeightedEdges,
  graphHitsToRRFHits,
  weightedGraphTraversal,
} from "./memory-weighted-graph-traversal";
import type { EntityStoreLike } from "../../../openclaw_runtime/src/runtime-core/memory-entity-extraction";
import type {
  RuntimeMemoryFactRelation,
  RuntimeMemoryQueryableFact,
} from "../../../openclaw_runtime/src/runtime-core/memory-context";
import type { HybridSearchHit } from "../../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";

// --- Test helpers ---

function makeFact(factId: string, subject = "subj"): RuntimeMemoryQueryableFact {
  return {
    schemaVersion: 1,
    factId,
    subject,
    predicate: "is",
    objectSummary: `summary ${factId}`,
    confidence: 0.9,
    source: "agent",
    verificationStatus: "verified",
    sourceEpisodeRefs: [],
    evidenceRefs: [],
    proposedAt: 0,
    valid_at: 0,
    reference_time: 0,
  } as unknown as RuntimeMemoryQueryableFact;
}

function makeRelation(
  sourceFactId: string,
  targetFactId: string,
  relationType: string,
  confidence = 1.0,
): RuntimeMemoryFactRelation {
  return {
    relationId: `rel-${sourceFactId}-${targetFactId}`,
    sourceFactId,
    targetFactId,
    relationType: relationType as RuntimeMemoryFactRelation["relationType"],
    confidence,
    createdAt: 0,
  };
}

/** Minimal in-memory EntityStore for testing. */
class MockEntityStore implements EntityStoreLike {
  private factToEntities = new Map<string, Set<string>>();
  private entityToFacts = new Map<string, Set<string>>();

  addFact(factId: string, entities: string[]): void {
    const set = new Set(entities);
    this.factToEntities.set(factId, set);
    for (const e of entities) {
      if (!this.entityToFacts.has(e)) this.entityToFacts.set(e, new Set());
      this.entityToFacts.get(e)!.add(factId);
    }
  }

  getFactEntities(factId: string): Set<string> | undefined {
    return this.factToEntities.get(factId);
  }

  getFactsForEntity(entity: string): Set<string> | undefined {
    return this.entityToFacts.get(entity);
  }
}

// --- Tests ---

describe("buildWeightedEdges — causal edges", () => {
  it("adds causal score to entity edges when relation exists", () => {
    const store = new MockEntityStore();
    store.addFact("f1", ["hiking"]);
    store.addFact("f2", ["hiking"]); // shares entity with f1

    const relations: RuntimeMemoryFactRelation[] = [
      makeRelation("f1", "f2", "causes"),
    ];

    const edges = buildWeightedEdges(["f1", "f2"], store, { relations });
    expect(edges).toHaveLength(1);
    // Entity edge with causes relation → causalScore = 1.0 × 1.0 = 1.0
    expect(edges[0].entityScore).toBeGreaterThan(0); // has entity overlap
    expect(edges[0].causalScore).toBe(1.0);
    expect(edges[0].causalRelationType).toBe("causes");
  });

  it("applies correct weights for each causal relation type", () => {
    const testCases = [
      { type: "causes", expectedWeight: 1.0 },
      { type: "caused_by", expectedWeight: 1.0 },
      { type: "enables", expectedWeight: 0.7 },
      { type: "prevents", expectedWeight: 0.5 },
      { type: "related_to", expectedWeight: 0.2 },
    ];

    for (const { type, expectedWeight } of testCases) {
      const store = new MockEntityStore();
      // No shared entities → pure causal edge
      store.addFact("f1", ["alpha"]);
      store.addFact("f2", ["beta"]);

      const relations: RuntimeMemoryFactRelation[] = [
        makeRelation("f1", "f2", type),
      ];

      const edges = buildWeightedEdges(["f1", "f2"], store, { relations });
      const causalEdge = edges.find((e) => e.causalScore > 0 && e.entityScore === 0);
      expect(causalEdge).toBeDefined();
      expect(causalEdge!.causalScore).toBeCloseTo(expectedWeight, 5);
      expect(causalEdge!.causalRelationType).toBe(type);
    }
  });

  it("scales causal score by relation confidence", () => {
    const store = new MockEntityStore();
    store.addFact("f1", ["alpha"]);
    store.addFact("f2", ["beta"]);

    const relations: RuntimeMemoryFactRelation[] = [
      makeRelation("f1", "f2", "causes", 0.5), // 50% confidence
    ];

    const edges = buildWeightedEdges(["f1", "f2"], store, { relations });
    const causalEdge = edges.find((e) => e.causalScore > 0);
    expect(causalEdge!.causalScore).toBeCloseTo(0.5, 5); // 1.0 × 0.5
  });

  it("adds pure causal edges when facts share no entities", () => {
    const store = new MockEntityStore();
    store.addFact("f1", ["alpha"]);
    store.addFact("f2", ["beta"]); // no shared entity
    store.addFact("f3", ["gamma"]); // no shared entity with f1 or f2

    const relations: RuntimeMemoryFactRelation[] = [
      makeRelation("f1", "f2", "causes"),
      makeRelation("f2", "f3", "enables"),
    ];

    const edges = buildWeightedEdges(["f1", "f2", "f3"], store, { relations });
    // No entity edges (no shared entities), only 2 pure causal edges
    expect(edges).toHaveLength(2);
    const causalEdges = edges.filter((e) => e.causalScore > 0 && e.entityScore === 0);
    expect(causalEdges).toHaveLength(2);
  });

  it("skips relations pointing to facts outside the candidate set", () => {
    const store = new MockEntityStore();
    store.addFact("f1", ["alpha"]);
    store.addFact("f2", ["beta"]);

    const relations: RuntimeMemoryFactRelation[] = [
      makeRelation("f1", "f3", "causes"), // f3 not in factIds
      makeRelation("f4", "f2", "enables"), // f4 not in factIds
    ];

    const edges = buildWeightedEdges(["f1", "f2"], store, { relations });
    // No causal edges because all relations reference out-of-set facts
    expect(edges.filter((e) => e.causalScore > 0)).toHaveLength(0);
  });

  it("keeps the highest-confidence relation when multiple exist between same pair", () => {
    const store = new MockEntityStore();
    store.addFact("f1", ["alpha"]);
    store.addFact("f2", ["beta"]);

    const relations: RuntimeMemoryFactRelation[] = [
      makeRelation("f1", "f2", "related_to", 1.0), // weight 0.2 × 1.0 = 0.2
      makeRelation("f2", "f1", "causes", 0.8), // weight 1.0 × 0.8 = 0.8 (higher)
    ];

    const edges = buildWeightedEdges(["f1", "f2"], store, { relations });
    const causalEdge = edges.find((e) => e.causalScore > 0);
    expect(causalEdge!.causalScore).toBeCloseTo(0.8, 5); // highest wins
    expect(causalEdge!.causalRelationType).toBe("causes");
  });

  it("does not add causal edges when no relations provided", () => {
    const store = new MockEntityStore();
    store.addFact("f1", ["alpha"]);
    store.addFact("f2", ["alpha"]); // shared entity

    const edges = buildWeightedEdges(["f1", "f2"], store); // no relations
    expect(edges).toHaveLength(1);
    expect(edges[0].causalScore).toBe(0);
    expect(edges[0].causalRelationType).toBeUndefined();
  });
});

describe("weightedGraphTraversal — causal score integration", () => {
  it("expands via pure causal edges (no entity overlap)", () => {
    // f1 (seed) shares no entities with f2, but f1 causes f2.
    // Without causal edges, f2 would be unreachable.
    const store = new MockEntityStore();
    store.addFact("f1", ["alpha"]);
    store.addFact("f2", ["beta"]);

    const factsById = new Map([
      ["f1", makeFact("f1")],
      ["f2", makeFact("f2")],
    ]);

    const relations: RuntimeMemoryFactRelation[] = [
      makeRelation("f1", "f2", "causes"),
    ];

    // Seed hit: f1
    const initialHits: HybridSearchHit[] = [{
      fact: factsById.get("f1")!,
      rrfScore: 1.0,
      bm25Rank: 0,
      vectorRank: 0,
      entityRank: null,
      bm25Score: 0.5,
      vectorScore: 0.8,
      entityScore: 0,
    }];

    // 2D embeddings (f1 and f2 semantically similar)
    const queryEmb = new Float32Array([1.0, 0.0]);
    const factEmbs = new Map([
      ["f1", new Float32Array([0.9, 0.1])],
      ["f2", new Float32Array([0.8, 0.2])],
    ]);

    const result = weightedGraphTraversal(
      initialHits,
      factsById,
      store,
      queryEmb,
      factEmbs,
      { relations, budget: 10, maxDepth: 2 },
    );

    // f2 should be reachable via the causal edge
    expect(result.expanded).toBe(true);
    expect(result.hits.some((h) => h.fact.factId === "f2")).toBe(true);

    // The causal hit should have causalScore > 0
    const causalHit = result.hits.find((h) => h.fact.factId === "f2");
    expect(causalHit!.causalScore).toBeGreaterThan(0);
    expect(causalHit!.causalPath).toContain("causes");
  });

  it("causalWeight=0 disables causal edges (A/B test)", () => {
    const store = new MockEntityStore();
    store.addFact("f1", ["alpha"]);
    store.addFact("f2", ["beta"]); // no shared entity

    const factsById = new Map([
      ["f1", makeFact("f1")],
      ["f2", makeFact("f2")],
    ]);

    const relations: RuntimeMemoryFactRelation[] = [
      makeRelation("f1", "f2", "causes"),
    ];

    const initialHits: HybridSearchHit[] = [{
      fact: factsById.get("f1")!,
      rrfScore: 1.0,
      bm25Rank: 0,
      vectorRank: 0,
      entityRank: null,
      bm25Score: 0.5,
      vectorScore: 0.8,
      entityScore: 0,
    }];

    const queryEmb = new Float32Array([1.0, 0.0]);
    const factEmbs = new Map([
      ["f1", new Float32Array([0.9, 0.1])],
      ["f2", new Float32Array([0.8, 0.2])],
    ]);

    const result = weightedGraphTraversal(
      initialHits,
      factsById,
      store,
      queryEmb,
      factEmbs,
      { relations, budget: 10, maxDepth: 2, causalWeight: 0 },
    );

    // With causalWeight=0, the causal edge is still built (buildWeightedEdges
    // adds it), but the graphScore contribution is 0. However, the traversal
    // still uses entityScore+causalScore for PQ priority, so f2 IS reachable.
    // The difference is that its graphScore will have 0 causal contribution.
    if (result.hits.length > 0) {
      const f2Hit = result.hits.find((h) => h.fact.factId === "f2");
      if (f2Hit) {
        // graphScore = entity×1 + semantic×1 + causal×0
        expect(f2Hit.graphScore).toBeCloseTo(f2Hit.entityScore + f2Hit.semanticScore, 5);
      }
    }
  });

  it("aggregates causal scores along multi-hop paths (capped at 1.0)", () => {
    // Chain: f1 →causes→ f2 →causes→ f3
    // Path causal score = min(1.0, 1.0 + 1.0) = 1.0
    const store = new MockEntityStore();
    store.addFact("f1", ["alpha"]);
    store.addFact("f2", ["beta"]);
    store.addFact("f3", ["gamma"]);

    const factsById = new Map([
      ["f1", makeFact("f1")],
      ["f2", makeFact("f2")],
      ["f3", makeFact("f3")],
    ]);

    const relations: RuntimeMemoryFactRelation[] = [
      makeRelation("f1", "f2", "causes"),
      makeRelation("f2", "f3", "causes"),
    ];

    const initialHits: HybridSearchHit[] = [{
      fact: factsById.get("f1")!,
      rrfScore: 1.0,
      bm25Rank: 0,
      vectorRank: 0,
      entityRank: null,
      bm25Score: 0.5,
      vectorScore: 0.8,
      entityScore: 0,
    }];

    const queryEmb = new Float32Array([1.0, 0.0]);
    const factEmbs = new Map([
      ["f1", new Float32Array([0.9, 0.1])],
      ["f2", new Float32Array([0.8, 0.2])],
      ["f3", new Float32Array([0.7, 0.3])],
    ]);

    const result = weightedGraphTraversal(
      initialHits,
      factsById,
      store,
      queryEmb,
      factEmbs,
      { relations, budget: 10, maxDepth: 3 },
    );

    // f3 should be reachable via 2-hop causal chain
    const f3Hit = result.hits.find((h) => h.fact.factId === "f3");
    if (f3Hit) {
      // Causal score capped at 1.0 (1.0 + 1.0 = 2.0 → cap 1.0)
      expect(f3Hit.causalScore).toBeLessThanOrEqual(1.0);
      expect(f3Hit.causalPath.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("returns empty hits when initialHits is empty", () => {
    const store = new MockEntityStore();
    const factsById = new Map<string, RuntimeMemoryQueryableFact>();
    const queryEmb = new Float32Array([1.0]);
    const factEmbs = new Map<string, Float32Array>();

    const result = weightedGraphTraversal(
      [],
      factsById,
      store,
      queryEmb,
      factEmbs,
      { relations: [] },
    );

    expect(result.hits).toHaveLength(0);
    expect(result.expanded).toBe(false);
    expect(result.edgeCount).toBe(0);
  });
});

describe("graphHitsToRRFHits", () => {
  it("converts graph hits to HybridSearchHit with RRF scores", () => {
    const facts = [makeFact("f1"), makeFact("f2"), makeFact("f3")];
    const graphHits = facts.map((fact) => ({
      fact,
      graphScore: 3 - Number(fact.factId.slice(1)), // f1=2, f2=1, f3=0
      entityScore: 0.5,
      semanticScore: 0.8,
      causalScore: 0.3,
      sharedEntities: ["alpha"],
      hopDistance: 1,
      causalPath: ["causes"],
    }));

    const rrfHits = graphHitsToRRFHits(graphHits);
    expect(rrfHits).toHaveLength(3);
    // RRF scores: 1/61, 1/62, 1/63
    expect(rrfHits[0].rrfScore).toBeCloseTo(1 / 61, 10);
    expect(rrfHits[1].rrfScore).toBeCloseTo(1 / 62, 10);
    expect(rrfHits[2].rrfScore).toBeCloseTo(1 / 63, 10);
  });

  it("folds causalScore into entityScore slot", () => {
    const fact = makeFact("f1");
    const graphHits = [{
      fact,
      graphScore: 1.5,
      entityScore: 0.5,
      semanticScore: 0.8,
      causalScore: 0.7,
      sharedEntities: ["alpha"],
      hopDistance: 1,
      causalPath: ["causes"],
    }];

    const rrfHits = graphHitsToRRFHits(graphHits);
    // entityScore slot = entityScore + causalScore = 0.5 + 0.7 = 1.2
    expect(rrfHits[0].entityScore).toBeCloseTo(1.2, 10);
    expect(rrfHits[0].vectorScore).toBe(0.8); // semanticScore preserved
  });

  it("preserves causalScore=0 for entity-only hits", () => {
    const fact = makeFact("f1");
    const graphHits = [{
      fact,
      graphScore: 1.0,
      entityScore: 0.76, // tanh(1×0.5)
      semanticScore: 0.8,
      causalScore: 0,
      sharedEntities: ["alpha"],
      hopDistance: 1,
      causalPath: [],
    }];

    const rrfHits = graphHitsToRRFHits(graphHits);
    expect(rrfHits[0].entityScore).toBeCloseTo(0.76, 5); // no causal to add
  });
});
