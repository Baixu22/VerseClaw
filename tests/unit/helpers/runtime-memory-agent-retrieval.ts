// Agent Multi-Round Retrieval — Hindsight alignment for multi_hop.
//
// Implements 3 Hindsight-aligned mechanisms:
// 1. Multi-round agent retrieval (maxRounds=5, LLM decides search vs answer)
// 2. Semantic kNN graph expansion (precomputed top-5 neighbors, sim >= 0.7)
// 3. 3-signal additive fusion: tanh(entity_count * 0.5) + semantic_sim + causal_weight
//
// The agent sees accumulated evidence and decides whether to search more with
// a NEW query (targeting the missing piece) or answer. This mirrors Hindsight's
// Reflect Agent "keep searching" behavior.

import { callDeepSeek, hasDeepSeekKey } from "./runtime-memory-real-llm-client";

// === Types ===

export interface AgentRetrievalFact {
  factId: string;
  objectSummary: string;
  subject: string;
  confidence?: number;
}

export interface AgentRetrievalRound {
  query: string;
  retrievedFactIds: string[];
  reasoning: string;
}

export interface AgentRetrievalResult {
  facts: AgentRetrievalFact[];
  rounds: AgentRetrievalRound[];
  converged: boolean;
  llmCalls: number;
}

/** Semantic kNN graph: factId -> sorted neighbors (most similar first). */
export type SemanticKnnGraph = Map<string, Array<{ factId: string; similarity: number }>>;

/** Entity relation map: factId -> related factIds (via shared entities). */
export type EntityRelationMap = Map<string, string[]>;

/** Causal relation map: factId -> causally related factIds. */
export type CausalRelationMap = Map<string, Array<{ factId: string; weight: number }>>;

export interface AgentRetrievalExpansionMaps {
  semanticKnn?: SemanticKnnGraph;
  entityRelations?: EntityRelationMap;
  causalRelations?: CausalRelationMap;
  factsById?: Map<string, AgentRetrievalFact>;
}

export interface AgentRetrievalOptions {
  maxRounds?: number;
  maxFacts?: number;
  maxFactsPerRound?: number;
  category?: string;
  expansionMaps?: AgentRetrievalExpansionMaps;
}

export type RetrieveFn = (
  query: string,
  topK: number,
) => Promise<AgentRetrievalFact[]>;

// === 3-signal expansion ===
//
// After each retrieval round, expand the results using 3 signals
// (aligned with Hindsight's link_expansion_retrieval.py):
// - Entity: shared entities between seed facts and candidates
// - Semantic: precomputed kNN graph (top-5, sim >= 0.7)
// - Causal: causal relation links
//
// Score = tanh(entity_count * 0.5) + max(semantic_sim) + max(causal_weight)
// Facts hit by multiple signals accumulate higher scores (convergent evidence).

function expandWith3Signals(
  seedFacts: AgentRetrievalFact[],
  expansionMaps: AgentRetrievalExpansionMaps,
  maxExpansion: number = 10,
): Map<string, { fact: AgentRetrievalFact; score: number }> {
  const { semanticKnn, entityRelations, causalRelations, factsById } = expansionMaps;
  const expanded = new Map<string, { fact: AgentRetrievalFact; score: number }>();
  const seedIds = new Set(seedFacts.map((f) => f.factId));

  // Add seed facts with base score.
  for (const f of seedFacts) {
    expanded.set(f.factId, { fact: f, score: 1.0 });
  }

  // Signal 1: Semantic kNN expansion.
  if (semanticKnn && factsById) {
    for (const seed of seedFacts) {
      const neighbors = semanticKnn.get(seed.factId);
      if (!neighbors) continue;
      for (const n of neighbors) {
        if (seedIds.has(n.factId)) continue;
        const fact = factsById.get(n.factId);
        if (!fact) continue;
        const existing = expanded.get(n.factId);
        if (existing) {
          existing.score += n.similarity;
        } else {
          expanded.set(n.factId, { fact, score: n.similarity });
        }
      }
    }
  }

  // Signal 2: Entity relation expansion.
  if (entityRelations && factsById) {
    const entityCounts = new Map<string, number>();
    for (const seed of seedFacts) {
      const related = entityRelations.get(seed.factId);
      if (!related) continue;
      for (const rId of related) {
        if (seedIds.has(rId)) continue;
        entityCounts.set(rId, (entityCounts.get(rId) ?? 0) + 1);
      }
    }
    for (const [rId, count] of entityCounts) {
      const fact = factsById.get(rId);
      if (!fact) continue;
      const entityScore = Math.tanh(count * 0.5);
      const existing = expanded.get(rId);
      if (existing) {
        existing.score += entityScore;
      } else {
        expanded.set(rId, { fact, score: entityScore });
      }
    }
  }

  // Signal 3: Causal relation expansion.
  if (causalRelations && factsById) {
    for (const seed of seedFacts) {
      const causal = causalRelations.get(seed.factId);
      if (!causal) continue;
      for (const c of causal) {
        if (seedIds.has(c.factId)) continue;
        const fact = factsById.get(c.factId);
        if (!fact) continue;
        const existing = expanded.get(c.factId);
        if (existing) {
          existing.score += c.weight;
        } else {
          expanded.set(c.factId, { fact, score: c.weight });
        }
      }
    }
  }

  // Sort by score and cap.
  const sorted = Array.from(expanded.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxExpansion);

  const result = new Map<string, { fact: AgentRetrievalFact; score: number }>();
  for (const item of sorted) {
    result.set(item.fact.factId, item);
  }
  return result;
}

// === Build semantic kNN graph from fact embeddings ===

export function buildSemanticKnnGraph(
  embeddings: Map<string, Float32Array>,
  topK: number = 5,
  threshold: number = 0.7,
): SemanticKnnGraph {
  const graph: SemanticKnnGraph = new Map();
  const entries = Array.from(embeddings.entries());

  for (let i = 0; i < entries.length; i++) {
    const [idA, embA] = entries[i];
    const neighbors: Array<{ factId: string; similarity: number }> = [];

    for (let j = 0; j < entries.length; j++) {
      if (i === j) continue;
      const [idB, embB] = entries[j];
      const sim = cosineSimilarity(embA, embB);
      if (sim >= threshold) {
        neighbors.push({ factId: idB, similarity: sim });
      }
    }

    neighbors.sort((a, b) => b.similarity - a.similarity);
    graph.set(idA, neighbors.slice(0, topK));
  }

  return graph;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// === Agent decision prompt ===

const AGENT_SYSTEM_PROMPT =
  "You are a memory retrieval agent for a multi-hop question. Your job is to decide whether the evidence collected so far is sufficient to answer the question, or if you need to search for more information.\n\n" +
  "Rules:\n" +
  "1. If the evidence DIRECTLY answers the question (names the specific entity, date, or relationship asked for), output {\"action\":\"answer\"}.\n" +
  "2. If the evidence is insufficient — missing a key entity, only partially answers, or you need to connect facts from different topics — output {\"action\":\"search\",\"query\":\"<new search query>\",\"reasoning\":\"<why you need this>\"}.\n" +
  "3. The search query should target the MISSING piece of information, not repeat the original question. Identify what entity/topic/fact you still need.\n" +
  "4. After 3 searches, only search again if the evidence is clearly insufficient. Prefer to answer with partial evidence rather than search endlessly.\n\n" +
  "Output format: JSON only, no markdown. {\"action\":\"answer\"} or {\"action\":\"search\",\"query\":\"...\",\"reasoning\":\"...\"}";

// === Main agent retrieval loop ===

export async function runAgentRetrieval(
  question: string,
  retrieve: RetrieveFn,
  options: AgentRetrievalOptions = {},
): Promise<AgentRetrievalResult> {
  const maxRounds = options.maxRounds ?? 5;
  const maxFacts = options.maxFacts ?? 15;
  const maxFactsPerRound = options.maxFactsPerRound ?? 10;
  const expansionMaps = options.expansionMaps;

  const rounds: AgentRetrievalRound[] = [];
  const accumulatedFacts = new Map<string, AgentRetrievalFact>();
  const accumulatedScores = new Map<string, number>();
  let llmCalls = 0;
  let converged = false;

  // Helper: retrieve + 3-signal expand.
  const retrieveAndExpand = async (
    query: string,
    topK: number,
  ): Promise<AgentRetrievalFact[]> => {
    const rawFacts = await retrieve(query, topK);
    if (!expansionMaps || !expansionMaps.factsById) return rawFacts;

    // 3-signal expansion on top of raw retrieval results.
    const expanded = expandWith3Signals(rawFacts, expansionMaps, maxFactsPerRound);
    return Array.from(expanded.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, maxFactsPerRound)
      .map((x) => x.fact);
  };

  // Round 1: Always search with the original question (forced).
  const initialFacts = await retrieveAndExpand(question, maxFactsPerRound);
  for (let i = 0; i < initialFacts.length; i++) {
    const f = initialFacts[i];
    const score = 1 / (i + 1);
    if (!accumulatedFacts.has(f.factId)) {
      accumulatedFacts.set(f.factId, f);
      accumulatedScores.set(f.factId, score);
    } else {
      accumulatedScores.set(f.factId, (accumulatedScores.get(f.factId) ?? 0) + score);
    }
  }
  rounds.push({
    query: question,
    retrievedFactIds: initialFacts.map((f) => f.factId),
    reasoning: "Initial retrieval with original question.",
  });

  // Subsequent rounds: LLM decides whether to search more or answer.
  for (let round = 1; round < maxRounds; round++) {
    if (!hasDeepSeekKey()) break;

    const evidenceList = Array.from(accumulatedFacts.values())
      .slice(0, 15)
      .map((f, i) => `[${i + 1}] ${f.subject}: ${f.objectSummary}`)
      .join("\n");

    const userPrompt =
      `Question: ${question}\n\n` +
      `Evidence collected so far (${accumulatedFacts.size} facts):\n${evidenceList}\n\n` +
      `Decide: is this sufficient to answer the question, or do you need to search for a specific missing piece?`;

    let agentResponse: { action: string; query?: string; reasoning?: string };
    try {
      const response = await callDeepSeek(AGENT_SYSTEM_PROMPT, userPrompt, {
        temperature: 0,
        maxTokens: 200,
      });
      llmCalls++;

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        converged = true;
        break;
      }
      agentResponse = JSON.parse(jsonMatch[0]);
    } catch {
      converged = true;
      break;
    }

    if (agentResponse.action === "answer" || !agentResponse.query) {
      converged = true;
      break;
    }

    const newQuery = agentResponse.query.slice(0, 200);
    const newFacts = await retrieveAndExpand(newQuery, maxFactsPerRound);

    let newCount = 0;
    for (let i = 0; i < newFacts.length; i++) {
      const f = newFacts[i];
      const score = 1 / (i + 1);
      if (!accumulatedFacts.has(f.factId)) {
        accumulatedFacts.set(f.factId, f);
        accumulatedScores.set(f.factId, score);
        newCount++;
      } else {
        accumulatedScores.set(f.factId, (accumulatedScores.get(f.factId) ?? 0) + score);
      }
    }

    rounds.push({
      query: newQuery,
      retrievedFactIds: newFacts.map((f) => f.factId),
      reasoning: agentResponse.reasoning ?? "",
    });

    if (newCount === 0) {
      converged = true;
      break;
    }
  }

  const sortedFacts = Array.from(accumulatedFacts.values())
    .map((f) => ({ fact: f, score: accumulatedScores.get(f.factId) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFacts)
    .map((x) => x.fact);

  return {
    facts: sortedFacts,
    rounds,
    converged,
    llmCalls,
  };
}
