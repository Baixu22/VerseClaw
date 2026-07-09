// @vitest-environment node
// L11-FULL: LoCoMo Full Benchmark — 500-question stratified sample.
//
// Uses the REAL LoCoMo dataset (10 conversations × ~5882 turns × 1986 QAs).
// Stratified sampling: multi_hop(96 all) + temporal(150) + single_hop(127) + open_domain(127) = 500.
// Adversarial category excluded (industry standard).
//
// Pipeline per question:
//   1. Qwen3-Embedding-8B retrieves top-5 facts (hybrid BM25 + Vector RRF)
//   2. DeepSeek generates answer from retrieved context
//   3. DeepSeek acts as LLM-as-Judge (J Score = accuracy)
//
// Requires: RUNTIME_MEMORY_REAL_LLM=1, DEEPSEEK_API_KEY, SILICONFLOW_API_KEY

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isRuntimeMemoryAcceptedVerificationStatus,
  type RuntimeMemoryQueryableFact,
} from "../../openclaw_runtime/src/runtime-core/memory-context";
import { type EvidenceRef } from "../../openclaw_runtime/src/runtime-core/evidence";
import {
  buildHybridSearchIndex,
  OPTIMAL_HYBRID_FUSION,
  type HybridSearchIndex,
} from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";
import { callDeepSeek, hasDeepSeekKey } from "./helpers/runtime-memory-real-llm-client";
import {
  createSiliconFlowEmbeddingProvider,
  hasSiliconFlowKey,
} from "./helpers/siliconflow-embedding-provider";
import {
  wrapWithDiskCache,
  getEmbeddingCacheStats,
} from "./helpers/embedding-disk-cache";
import {
  extractSessionDates,
} from "./helpers/locomo-date-parser";
import {
  extractFactsWithBufferedFlush,
  type BufferedExtractionTurn,
} from "./helpers/buffered-extraction";
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  parseExtractionResponse,
  type ExtractedFact as BaseExtractedFact,
} from "../../openclaw_runtime/src/runtime-core/memory-extraction-prompt";
import {
  detectQueryTemporalMode,
  isMultiHopQuestion,
} from "../../openclaw_runtime/src/runtime-core/memory-temporal-detector";
import {
  EpisodicMemory,
  formatEpisodicBlock,
  type IngestTurn,
} from "./helpers/episodic-memory";
import {
  extractQueryTimeConstraint,
} from "./helpers/query-time-extractor";
import {
  applyRerank,
  type JustifierCandidate,
} from "./helpers/justifier-rerank";
import {
  rerankWithCrossEncoder,
} from "./helpers/cross-encoder-rerank";
import {
  DEV_SLICE_CACHE_VERSION,
  DEV_SLICE_SAMPLE_SEED,
  DEV_SLICE_SAMPLE_SIZES,
  buildStratifiedDevSlice,
  isDevSliceCacheValid,
  type DevSliceCache,
} from "./helpers/runtime-memory-dev-slice";
import { computeContextRecall } from "./helpers/runtime-memory-context-recall";
import {
  aggregateErrorTaxonomy,
  classifyErrorTaxonomy,
  type ErrorTaxonomyResult,
} from "./helpers/runtime-memory-error-taxonomy";
import {
  buildCategoryAwareDualTrackPrompt,
  extractFinalAnswer,
  stripEvidenceInsufficientSignal,
} from "./helpers/runtime-memory-generation-scaffolds";
import {
  FROZEN_JUDGE_CONFIG,
  buildFrozenJudgePrompt,
  parseFrozenJudgeVerdict,
} from "./helpers/runtime-memory-judge-freeze";
import { JudgeResultCache } from "./helpers/judge-result-cache";
import { SelfAskCache } from "./helpers/self-ask-cache";
import {
  SessionSummaryIndex,
  type SessionSummaryTurn,
} from "./helpers/runtime-memory-session-summary-index";
import {
  EscalationBudget,
  summarizeEscalationStats,
  type EscalationLevel,
  type EscalationResult,
} from "./helpers/runtime-memory-escalation-ladder";
import {
  decomposeSequentialQuestion,
  runSequentialSelfAsk,
} from "./helpers/runtime-memory-sequential-self-ask";
import {
  ReflectBudget,
  runReflectAgent,
  type ReflectResult,
} from "./helpers/runtime-memory-reflect-agent";
import {
  rerankHybridHits,
  applyFinalBoost,
  hasSiliconFlowRerankKey,
} from "./helpers/runtime-memory-cross-encoder-reranker";
import {
  computeContextCompletenessDeterministic,
  aggregateCompleteness,
} from "./helpers/runtime-memory-context-completeness";
import {
  buildEntityRelationMap,
} from "../../openclaw_runtime/src/runtime-core/memory-entity-extraction";
import {
  chainedRetrievalExpand,
} from "../../openclaw_runtime/src/runtime-core/memory-chained-retrieval";
import { EntityStore } from "./helpers/memory-entity-store";
import {
  weightedGraphTraversal,
  graphHitsToRRFHits,
  mergeWithGraphRRF,
} from "./helpers/memory-weighted-graph-traversal";
import {
  consolidateObservations,
  applyObservationsToFacts,
  OBSERVATION_CACHE_VERSION,
  type ObservationFact,
  type ObservationInputFact,
} from "./helpers/memory-observation-consolidation";
import { assertLocomoStageReportShape } from "./helpers/runtime-memory-locomo-report-schema";
import {
  classifyQuery,
  type QueryType,
} from "./helpers/query-classifier";
import {
  rewriteQueryForRetrieval,
} from "./helpers/retrieval-feedback-loop";
import type { CompletenessLevel } from "./helpers/runtime-memory-context-completeness";
import {
  mergeSelfAskIntoMainHits,
  selfAskDecomposeAndMerge,
} from "./helpers/self-ask-merge";
import {
  compareJudgeResults,
  judgeWithUnifiedPrompt,
  UNIFIED_JUDGE_CONFIG,
  type JudgeCategory,
  type JudgeResult,
} from "./helpers/unified-judge";
import {
  runAgentRetrieval,
  buildSemanticKnnGraph,
  type AgentRetrievalFact,
  type AgentRetrievalExpansionMaps,
} from "./helpers/runtime-memory-agent-retrieval";

// === Types ===

type LocomoTurn = {
  speaker: string;
  dia_id: string;
  text: string;
  sessionDate: number;
  sessionId: string;
  sessionIndex: number;
};
type LocomoSession = LocomoTurn[];
type LocomoConversationRaw = {
  speaker_a: string;
  speaker_b: string;
  [sessionKey: string]: LocomoSession | string;
};
type LocomoQA = {
  question: string;
  answer: string | number;
  evidence: string[];
  category: number;
};
type LocomoSample = {
  sample_id: string;
  conversation: LocomoConversationRaw;
  qa: LocomoQA[];
};
type LocomoQaItem = {
  qa: LocomoQA;
  conversationId: string;
  category: string;
  qaIndex: number;
};

// Category mapping (verified from dataset)
const CATEGORY_MAP: Record<number, string> = {
  1: "single_hop",
  2: "temporal",
  3: "multi_hop",
  4: "open_domain",
  5: "adversarial",
};

// Stratified sample sizes (total = 500)
const SAMPLE_SIZES: Record<string, number> = {
  multi_hop: 96, // all
  temporal: 150,
  single_hop: 127,
  open_domain: 127,
};

// P0-G: Fixed seed for reproducible stratified sampling.
// Eliminates ±3-5% variance across runs caused by Math.random().
// Mulberry32 PRNG (high quality, fast) + Fisher-Yates shuffle (unbiased)
// replaces the biased sort(() => Math.random() - 0.5) pattern.
const SAMPLE_SEED = 42;

function createSeededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const RAW_DATA_PATH = join(
  process.cwd(),
  "tests",
  "fixtures",
  "locomo",
  "locomo10_raw.json",
);

function loadRawData(): LocomoSample[] {
  return JSON.parse(readFileSync(RAW_DATA_PATH, "utf-8")) as LocomoSample[];
}

function collectNonAdversarialQAs(rawData: readonly LocomoSample[]): LocomoQaItem[] {
  const allQAs: LocomoQaItem[] = [];
  for (const sample of rawData) {
    for (const [qaIndex, qa] of sample.qa.entries()) {
      const category = CATEGORY_MAP[qa.category];
      if (category !== "adversarial") {
        allQAs.push({ qa, conversationId: sample.sample_id, category, qaIndex });
      }
    }
  }
  return allQAs;
}

function extractTurns(conversation: LocomoConversationRaw): LocomoTurn[] {
  // Parse session dates from session_N_date_time keys
  const sessionDates = extractSessionDates(conversation as Record<string, unknown>);
  const sessionDateByIndex = new Map<number, number>();
  for (const s of sessionDates) {
    sessionDateByIndex.set(s.sessionIndex, s.date);
  }
  // Fallback: if no dates parsed, use ascending day offsets from epoch
  const hasDates = sessionDateByIndex.size > 0;

  const turns: LocomoTurn[] = [];
  const sessionKeys = Object.keys(conversation)
    .filter((k) => /^session_\d+$/.test(k))
    .sort((a, b) => {
      const na = parseInt(a.split("_")[1], 10);
      const nb = parseInt(b.split("_")[1], 10);
      return na - nb;
    });
  for (const sk of sessionKeys) {
    const sessionIndex = parseInt(sk.split("_")[1], 10);
    const session = conversation[sk] as LocomoSession;
    // Get this session's date, or fall back to a synthetic day offset
    const sessionDate = hasDates
      ? (sessionDateByIndex.get(sessionIndex) ?? Date.UTC(2023, 0, 1) + sessionIndex * 30 * 24 * 60 * 60 * 1000)
      : Date.UTC(2023, 0, 1) + sessionIndex * 30 * 24 * 60 * 60 * 1000;
    if (Array.isArray(session)) {
      for (const turn of session) {
        if (turn && turn.text && turn.text.trim().length > 0) {
          turns.push({ ...turn, sessionDate, sessionId: sk, sessionIndex });
        }
      }
    }
  }
  return turns;
}

// === AUDN Write Curation Layer (DeepSeek-based fact extraction) ===
// Consolidates raw dialogue turns into structured atomic facts.
// This simulates the system's actual write path: dialogue → curated facts.

// P3-B: Cache moved out of tests/fixtures (avoid polluting the source repo)
// to artifacts/runtime-memory-eval/. Incremental save: after EACH conversation
// is extracted, the partial cache is flushed to disk so an interrupted run can
// resume without re-extracting already-completed conversations.
// P0-B-OPT: v3 cache path for buffered+consolidated facts (multi-attribute).
// Old v2 cache (legacy extraction) is preserved for A/B comparison.
// S0-2: v4 cache path — extraction prompt now emits entities[] and the
// consolidation unions them. Old v3 cache has no entities field, so we bump
// the filename to force a fresh extraction (mem-status §5 S0-2).
// S0-2-rollback (方案 A): v5 cache path — extraction prompt reverted to
// baseline (no entities[] directive) to isolate whether the prompt change
// caused the -6.67pp regression. S0-1/S0-3 code (schema fields + ceScore)
// remain active. Old v4 cache used the entities prompt, so we bump again.
// P0 #2 (2026-07-05): Bumped again for ADDITIVE-only extraction.
// BUFFERED_EXTRACTION_PROMPT_VERSION → buffered-v4-2026-07-05-additive-p0.
// New prompt emits linkedFactIds + Exhaustive Extraction + Memory Linking
// + Temporal Anchoring. Old v5 cache has no linkedFactIds and suffers from
// first-topic-dominance bias, so it must not be reused.
const FACTS_CACHE_PATH = join(
  process.cwd(),
  "artifacts",
  "runtime-memory-eval",
  "extracted-facts-cache-v6-additive-p0.json",
);
const DEV_SLICE_CACHE_PATH = join(
  process.cwd(),
  "artifacts",
  "runtime-memory-eval",
  "dev-slice-cache.json",
);
const SESSION_SUMMARY_CACHE_PATH = join(
  process.cwd(),
  "artifacts",
  "runtime-memory-eval",
  "session-summary-cache.json",
);
// Item 3: Observation consolidation cache (cross-session merged facts).
// Stores observations per conversation so we don't re-run LLM on every run.
const OBSERVATION_CACHE_PATH = join(
  process.cwd(),
  "artifacts",
  "runtime-memory-eval",
  "observations-cache.json",
);

type ObservationCache = {
  version: string;
  conversations: Record<string, ObservationFact[]>;
};

type RetrievalCache = {
  queryEmbedding: number[];
  semanticFactIds: string[];
  semanticFacts: Array<{
    factId: string;
    subject: string;
    predicate: string;
    objectSummary: string;
    validAt: number;
  }>;
  hybridHits: Array<{
    factId: string;
    rrfScore: number;
    bm25Rank: number | null;
    vectorRank: number | null;
    entityRank: number | null;
    bm25Score: number;
    vectorScore: number;
    entityScore: number;
  }>;
  episodicHits: Array<{
    sentenceId: string;
    turnId: string;
    sessionId: string;
    rrfScore: number;
  }>;
  episodicContext: string;
  profileContext: string[];
  assembledContext: string;
};

type DevSliceCachedQuestion = {
  questionId: string;
  category: string;
  conversationId: string;
  question: string;
  groundTruth: string;
  goldEvidence: string[];
  retrievalCache: RetrievalCache;
};

type CachedSessionSummary = {
  conversationId: string;
  sessionId: string;
  sessionDate: number;
  summary: string;
  embedding: number[];
  rawText: string;
};

type SessionSummaryCache = {
  version: "10.0-session-summary-index";
  embeddingProvider: string;
  conversations: Record<string, CachedSessionSummary[]>;
};

const deepSeekUsage = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

const extractionTelemetry = {
  factsCachePath: FACTS_CACHE_PATH,
  cachedConversations: 0,
  freshConversations: 0,
  totalChunks: 0,
  parseFailures: 0,
  conversations: [] as Array<{
    conversationId: string;
    totalChunks: number;
    parseFailures: number;
    parseSuccessRate: number;
    extractedFacts: number;
    uniqueFacts: number;
  }>,
};

function resetExtractionTelemetry(): void {
  extractionTelemetry.cachedConversations = 0;
  extractionTelemetry.freshConversations = 0;
  extractionTelemetry.totalChunks = 0;
  extractionTelemetry.parseFailures = 0;
  extractionTelemetry.conversations = [];
}

function summarizeExtractionTelemetry(): {
  factsCachePath: string;
  cachedConversations: number;
  freshConversations: number;
  totalChunks: number;
  parseFailures: number;
  parseSuccessRate: number;
  conversations: typeof extractionTelemetry.conversations;
} {
  const parseSuccessRate =
    extractionTelemetry.totalChunks > 0
      ? 1 - extractionTelemetry.parseFailures / extractionTelemetry.totalChunks
      : 1;
  return {
    factsCachePath: extractionTelemetry.factsCachePath,
    cachedConversations: extractionTelemetry.cachedConversations,
    freshConversations: extractionTelemetry.freshConversations,
    totalChunks: extractionTelemetry.totalChunks,
    parseFailures: extractionTelemetry.parseFailures,
    parseSuccessRate,
    conversations: extractionTelemetry.conversations,
  };
}

function recordDeepSeekUsage(response: {
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}): void {
  if (!response.usage) return;
  deepSeekUsage.calls += 1;
  deepSeekUsage.promptTokens += response.usage.prompt_tokens;
  deepSeekUsage.completionTokens += response.usage.completion_tokens;
  deepSeekUsage.totalTokens += response.usage.total_tokens;
}

async function callTrackedDeepSeek(
  system: string,
  user: string,
  options?: { temperature?: number; maxTokens?: number; model?: string },
): Promise<{ content: string }> {
  const response = await callDeepSeek(system, user, options);
  recordDeepSeekUsage(response);
  return response;
}

function estimateDeepSeekCostUsd(): number {
  // DeepSeek chat list prices vary with cache hits. This estimate is deliberately
  // conservative and report-only; exact billing remains provider-side.
  const inputPerMillion = 0.27;
  const outputPerMillion = 1.1;
  return (
    (deepSeekUsage.promptTokens / 1_000_000) * inputPerMillion +
    (deepSeekUsage.completionTokens / 1_000_000) * outputPerMillion
  );
}

type ExtractedFact = BaseExtractedFact & {
  sessionDate?: number;
  // Item 2: propagate evidenceRefs/proofCount from buffered extraction.
  // Raw pre-consolidation fact IDs (string form). Converted to EvidenceRef[]
  // at fact construction time so applyFinalBoost can consume proof_count.
  evidenceRefs?: string[];
  proofCount?: number;
  // S0-1: LLM-extracted entity list. When present (S0-2), EntityStore reads
  // this field directly instead of re-running regex extraction. Eliminates
  // the Extraction→EntityStore duplicated-work coupling break.
  // Source: Hindsight ProcessedFact.entities[] / Mem0 entity_store.
  entities?: string[];
  // S0-1: raw fact IDs merged into this consolidated fact. Enables provenance
  // tracing and EntityStore reverse lookup. Source: Hindsight source_memory_ids.
  sourceMemoryIds?: string[];
  // P0 #3 (Zep invalid_at 四元组): set by consolidation when a fact is
  // contradicted by a newer fact in the same session. Propagated to
  // RuntimeMemoryQueryableFact.invalid_at by makeFactFromExtracted so
  // applyFinalBoost can penalize (-20%) and isRuntimeMemoryFactValidAt
  // can filter it in strict mode.
  invalid_at_hint?: number;
};

// Item 2: convert raw fact ID strings to EvidenceRef objects.
// Uses type "memory" since these references point to other memory facts.
function toEvidenceRefs(ids: string[] | undefined): EvidenceRef[] {
  if (!ids || ids.length === 0) return [];
  return ids.slice(0, 5).map((ref) => ({ type: "memory", ref }));
}

function makeFactFromExtracted(
  ef: ExtractedFact,
  conversationId: string,
  idx: number,
): RuntimeMemoryQueryableFact {
  const sessionDate = ef.sessionDate ?? Date.UTC(2023, 0, 1);
  const evidenceRefs = toEvidenceRefs(ef.evidenceRefs);
  // S0-1: propagate entities/proofCount/sourceMemoryIds from buffered
  // extraction so downstream components (EntityStore, applyFinalBoost) can
  // read these fields directly without re-extraction. Eliminates the
  // Consolidation→Schema coupling break (mem-status §3 断裂点 8).
  const entities = Array.isArray(ef.entities)
    ? ef.entities
        .map((e) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
        .filter((e) => e.length > 0)
    : undefined;
  const proofCount =
    typeof ef.proofCount === "number" && ef.proofCount > 0
      ? ef.proofCount
      : undefined;
  const sourceMemoryIds = Array.isArray(ef.sourceMemoryIds)
    ? ef.sourceMemoryIds.filter((id) => typeof id === "string" && id.length > 0)
    : undefined;
  // P0 #3 (Zep invalid_at 四元组): promote invalid_at_hint to invalid_at
  // so applyFinalBoost (-20%) and isRuntimeMemoryFactValidAt can act on it.
  const invalidAt =
    typeof ef.invalid_at_hint === "number" && ef.invalid_at_hint > 0
      ? ef.invalid_at_hint
      : undefined;
  // P0 #2 (Mem0 ADDITIVE fact graph): carry linkedFactIds forward via
  // metadata so retrieval can boost linked facts (P1/P2 work). Source:
  // mem0-main/mem0/configs/prompts.py ADDITIVE_EXTRACTION_PROMPT.
  const linkedFactIds = Array.isArray(ef.linkedFactIds)
    ? ef.linkedFactIds.filter((id) => typeof id === "string" && id.length > 0)
    : undefined;
  const extractionMetadata: Record<string, unknown> = {};
  if (linkedFactIds && linkedFactIds.length > 0) {
    extractionMetadata.linkedFactIds = linkedFactIds;
  }
  return {
    schemaVersion: 1,
    factId: `${conversationId}_fact_${idx}`,
    taskId: conversationId,
    subject: (ef.subject || "unknown").slice(0, 256),
    predicate: (ef.predicate || "is").slice(0, 256),
    objectSummary: (ef.objectSummary || "").slice(0, 512),
    confidence: 0.9,
    source: "agent",
    verificationStatus: "verified",
    sourceEpisodeRefs: [],
    // Item 2: propagate evidenceRefs/proofCount from buffered extraction
    // so applyFinalBoost (ce_norm * recency * temporal * proof_count) works.
    evidenceRefs,
    proposedAt: sessionDate,
    acceptedAt: sessionDate,
    promotion: { promotedBy: "verifier", evidenceRefs },
    valid_at: sessionDate,
    reference_time: sessionDate,
    // S0-1: schema field flowback. Fields are only set when the source
    // extraction produced them, so cached/legacy facts stay clean.
    ...(entities && entities.length > 0 ? { entities } : {}),
    ...(proofCount !== undefined ? { proofCount } : {}),
    ...(sourceMemoryIds && sourceMemoryIds.length > 0
      ? { sourceMemoryIds }
      : {}),
    // P0 #3: invalid_at from consolidation contradiction detection.
    ...(invalidAt !== undefined ? { invalid_at: invalidAt } : {}),
    // P0 #2: linkedFactIds via metadata for retrieval-time fact-graph boost.
    ...(Object.keys(extractionMetadata).length > 0
      ? { metadata: extractionMetadata }
      : {}),
  } as unknown as RuntimeMemoryQueryableFact;
}

// Item 2: Post-load enrichment for facts loaded from cache (which don't have
// evidenceRefs from consolidation). Groups facts by subject within each
// conversation and links same-subject facts as mutual evidence. This makes
// applyFinalBoost (ce_norm * recency * temporal * proof_count) effective even
// for cached facts. Caps at 5 evidenceRefs per fact (matching the boost cap).
function enrichEvidenceRefs(
  factsByConversation: Map<string, RuntimeMemoryQueryableFact[]>,
): void {
  for (const facts of factsByConversation.values()) {
    // Group fact IDs by subject.
    const bySubject = new Map<string, string[]>();
    for (const f of facts) {
      const arr = bySubject.get(f.subject) ?? [];
      arr.push(f.factId);
      bySubject.set(f.subject, arr);
    }
    for (const f of facts) {
      // Skip facts that already have evidenceRefs from consolidation.
      if (f.evidenceRefs && f.evidenceRefs.length > 0) continue;
      const sameSubject = bySubject.get(f.subject) ?? [];
      // Link to up to 5 other facts with the same subject (exclude self).
      const refs = sameSubject
        .filter((id) => id !== f.factId)
        .slice(0, 5);
      if (refs.length > 0) {
        f.evidenceRefs = toEvidenceRefs(refs);
      }
    }
  }
}

// Item 3: Convert an ObservationFact (cross-session merged) into a
// RuntimeMemoryQueryableFact for retrieval. Observations carry
// source_memory_ids → evidenceRefs and proof_count for applyFinalBoost.
function makeFactFromObservation(
  obs: ObservationFact,
  conversationId: string,
  idx: number,
): RuntimeMemoryQueryableFact {
  const sessionDate = obs.sessionDate ?? Date.UTC(2023, 0, 1);
  const evidenceRefs = toEvidenceRefs(obs.sourceMemoryIds);
  // S0-1: propagate proofCount/sourceMemoryIds/entities from observation
  // consolidation so applyFinalBoost and EntityStore can read them directly.
  // proofCount defaults to sourceMemoryIds.length when not explicitly set.
  const proofCount =
    typeof obs.proofCount === "number" && obs.proofCount > 0
      ? obs.proofCount
      : obs.sourceMemoryIds.length > 0
        ? obs.sourceMemoryIds.length
        : undefined;
  const sourceMemoryIds =
    obs.sourceMemoryIds.length > 0 ? obs.sourceMemoryIds : undefined;
  const entities = Array.isArray(obs.entities)
    ? obs.entities
        .map((e) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
        .filter((e) => e.length > 0)
    : undefined;
  // P0 #1 (Hindsight evidence-grounded belief): carry trend/evidence/reason
  // forward via metadata so retrieval/generator can surface them. Source:
  // hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/observations.py
  // - trend: STABLE/STRENGTHENING/WEAKENING/NEW/STALE — describes how the
  //   belief evolved across sessions; useful as a retrieval signal.
  // - evidence: 1-3 verbatim quotes from source facts supporting the belief.
  // - reason: one-sentence LLM explanation of why facts were merged.
  const observationMetadata: Record<string, unknown> = {};
  if (obs.trend !== undefined) observationMetadata.trend = obs.trend;
  if (Array.isArray(obs.evidence) && obs.evidence.length > 0) {
    observationMetadata.evidence = obs.evidence;
  }
  if (typeof obs.reason === "string" && obs.reason.length > 0) {
    observationMetadata.reason = obs.reason;
  }
  return {
    schemaVersion: 1,
    factId: `${conversationId}_obs_${idx}`,
    taskId: conversationId,
    subject: (obs.subject || "unknown").slice(0, 256),
    predicate: (obs.predicate || "observation").slice(0, 256),
    objectSummary: (obs.objectSummary || "").slice(0, 512),
    confidence: 0.95,
    source: "agent",
    verificationStatus: "verified",
    sourceEpisodeRefs: [],
    evidenceRefs,
    proposedAt: sessionDate,
    acceptedAt: sessionDate,
    promotion: { promotedBy: "verifier", evidenceRefs },
    valid_at: sessionDate,
    reference_time: sessionDate,
    // S0-1: schema field flowback (mem-status §3 断裂点 8).
    ...(proofCount !== undefined ? { proofCount } : {}),
    ...(sourceMemoryIds ? { sourceMemoryIds } : {}),
    ...(entities && entities.length > 0 ? { entities } : {}),
    ...(Object.keys(observationMetadata).length > 0
      ? { metadata: observationMetadata }
      : {}),
  } as unknown as RuntimeMemoryQueryableFact;
}

// Item 3: Load observation cache. Returns null if missing or version mismatch.
function loadObservationCache(
  expectedConvIds: readonly string[],
): Map<string, ObservationFact[]> | null {
  try {
    const raw = readFileSync(OBSERVATION_CACHE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as ObservationCache;
    if (parsed.version !== OBSERVATION_CACHE_VERSION) return null;
    // Check coverage: all expected conversations must be present.
    for (const convId of expectedConvIds) {
      if (!parsed.conversations[convId]) return null;
    }
    const result = new Map<string, ObservationFact[]>();
    for (const convId of expectedConvIds) {
      const obs = parsed.conversations[convId];
      if (!Array.isArray(obs)) return null;
      result.set(convId, obs);
    }
    return result;
  } catch {
    return null;
  }
}

// Item 3: Save observation cache.
function saveObservationCache(
  observationsByConversation: Map<string, ObservationFact[]>,
): void {
  try {
    const cache: ObservationCache = {
      version: OBSERVATION_CACHE_VERSION,
      conversations: {},
    };
    for (const [convId, obs] of observationsByConversation) {
      cache.conversations[convId] = obs;
    }
    writeFileSync(OBSERVATION_CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
    console.log(
      `[LoCoMo-Full] Observation cache saved: ${observationsByConversation.size} conversations → ${OBSERVATION_CACHE_PATH}`,
    );
  } catch (err) {
    console.log(
      `[LoCoMo-Full] Failed to save observation cache: ${(err as Error).message}`,
    );
  }
}

function makeFactFromCachedSemantic(
  fact: RetrievalCache["semanticFacts"][number],
  conversationId: string,
): RuntimeMemoryQueryableFact {
  return {
    schemaVersion: 1,
    factId: fact.factId,
    taskId: conversationId,
    subject: fact.subject,
    predicate: fact.predicate,
    objectSummary: fact.objectSummary,
    confidence: 0.9,
    source: "agent",
    verificationStatus: "verified",
    sourceEpisodeRefs: [],
    evidenceRefs: [],
    proposedAt: fact.validAt,
    acceptedAt: fact.validAt,
    promotion: { promotedBy: "verifier", evidenceRefs: [] },
    valid_at: fact.validAt,
    reference_time: fact.validAt,
  } as unknown as RuntimeMemoryQueryableFact;
}

async function extractFactsFromConversation(
  turns: LocomoTurn[],
  conversationId: string,
  callLLM: (
    system: string,
    user: string,
    options?: { temperature?: number; maxTokens?: number },
  ) => Promise<{ content: string }>,
): Promise<RuntimeMemoryQueryableFact[]> {
  const CHUNK_SIZE = 30; // P3-B: reduced from 100 → 30 to increase fact density per turn
  const MAX_PARSE_RETRIES = 1;
  const allExtracted: ExtractedFact[] = [];
  const parseFailures: Array<{ conversationId: string; chunkNum: number; totalChunks: number }> = [];
  const seenEntities = new Set<string>();
  const totalChunksForConversation = Math.ceil(turns.length / CHUNK_SIZE);

  for (let i = 0; i < turns.length; i += CHUNK_SIZE) {
    const chunk = turns.slice(i, i + CHUNK_SIZE);
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = totalChunksForConversation;

    // Compute majority sessionDate in this chunk (handles cross-session chunks)
    const dateCounts = new Map<number, number>();
    for (const t of chunk) {
      dateCounts.set(t.sessionDate, (dateCounts.get(t.sessionDate) ?? 0) + 1);
    }
    let chunkSessionDate = chunk[0].sessionDate;
    let maxDateCount = 0;
    for (const [date, count] of dateCounts) {
      if (count > maxDateCount) {
        maxDateCount = count;
        chunkSessionDate = date;
      }
    }

    const dialogue = chunk
      .map((t) => `${t.speaker}: ${t.text}`)
      .join("\n");

    const entityHint =
      seenEntities.size > 0
        ? `\nPreviously mentioned entities: ${[...seenEntities].slice(0, 80).join(", ")}. Use this list to resolve pronouns and aliases across chunks.`
        : "";
    const system = buildExtractionSystemPrompt({ sessionDate: chunkSessionDate }) + entityHint;
    let user = buildExtractionUserPrompt(dialogue, {
      conversationId,
      chunkNum,
      totalChunks,
      sessionDate: chunkSessionDate,
    });

    let facts: ExtractedFact[] = [];
    for (let parseAttempt = 0; parseAttempt <= MAX_PARSE_RETRIES; parseAttempt += 1) {
      try {
        const response = await callLLM(system, user, {
          temperature: 0,
          maxTokens: 4096,
        });
        facts = parseExtractionResponse(response.content) as ExtractedFact[];
        if (facts.length > 0 || parseAttempt === MAX_PARSE_RETRIES) break;
        console.log(
          `[Extraction] ${conversationId} chunk ${chunkNum}/${totalChunks}: empty parse on attempt ${parseAttempt + 1}, retrying with stricter JSON prompt`,
        );
        user = `Please respond with ONLY a JSON array. No markdown, no preamble.\n\n${user}`;
      } catch (err) {
        console.log(
          `[Extraction] ${conversationId} chunk ${chunkNum}/${totalChunks} parse attempt ${parseAttempt + 1} failed: ${(err as Error).message}`,
        );
        if (parseAttempt === MAX_PARSE_RETRIES) break;
      }
    }

    if (facts.length > 0) {
      for (const f of facts) {
        f.sessionDate = chunkSessionDate;
        if (f.subject) seenEntities.add(f.subject);
      }
      allExtracted.push(...facts);
      console.log(
        `[LoCoMo-Full] ${conversationId} chunk ${chunkNum}/${totalChunks}: extracted ${facts.length} facts`,
      );
    } else {
      parseFailures.push({ conversationId, chunkNum, totalChunks });
      console.log(
        `[LoCoMo-Full] ${conversationId} chunk ${chunkNum}/${totalChunks}: no JSON found after retry`,
      );
    }

    // Small delay between extraction calls
    if (i + CHUNK_SIZE < turns.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const parseSuccessRate =
    totalChunksForConversation > 0
      ? 1 - parseFailures.length / totalChunksForConversation
      : 1;
  extractionTelemetry.totalChunks += totalChunksForConversation;
  extractionTelemetry.parseFailures += parseFailures.length;
  if (parseSuccessRate < 0.95) {
    console.log(
      `[Extraction] WARNING: ${conversationId} parse success rate ${(parseSuccessRate * 100).toFixed(1)}% < 95%`,
    );
  }

  // Deduplicate by objectSummary (case-insensitive)
  const seen = new Set<string>();
  const unique: ExtractedFact[] = [];
  for (const f of allExtracted) {
    const key = (f.objectSummary || "").toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(f);
    }
  }

  console.log(
    `[LoCoMo-Full] ${conversationId}: ${allExtracted.length} extracted → ${unique.length} unique facts`,
  );

  extractionTelemetry.conversations.push({
    conversationId,
    totalChunks: totalChunksForConversation,
    parseFailures: parseFailures.length,
    parseSuccessRate,
    extractedFacts: allExtracted.length,
    uniqueFacts: unique.length,
  });

  return unique.map((ef, idx) => makeFactFromExtracted(ef, conversationId, idx));
}

async function loadOrExtractFacts(
  rawData: LocomoSample[],
  callLLM: (
    system: string,
    user: string,
    options?: { temperature?: number; maxTokens?: number },
  ) => Promise<{ content: string }>,
): Promise<Map<string, RuntimeMemoryQueryableFact[]>> {
  resetExtractionTelemetry();
  // P3-B: Incremental cache. Load whatever partial cache exists (may contain
  // only some conversations from a previous interrupted run), skip conversations
  // already cached, extract the rest, and flush after EACH conversation so an
  // interrupted run can resume without re-extracting completed work.
  let cacheData: Record<string, ExtractedFact[]> = {};
  try {
    cacheData = JSON.parse(
      readFileSync(FACTS_CACHE_PATH, "utf-8"),
    ) as Record<string, ExtractedFact[]>;
    console.log(
      `[LoCoMo-Full] Loaded partial cache with ${Object.keys(cacheData).length}/${rawData.length} conversations from ${FACTS_CACHE_PATH}`,
    );
  } catch {
    console.log("[LoCoMo-Full] No facts cache found. Extracting with DeepSeek...");
  }

  const factsByConversation = new Map<string, RuntimeMemoryQueryableFact[]>();
  let totalFacts = 0;

  // Ensure cache directory exists before any incremental write
  try {
    mkdirSync(dirname(FACTS_CACHE_PATH), { recursive: true });
  } catch (err) {
    console.log(`[LoCoMo-Full] Failed to create cache dir: ${(err as Error).message}`);
  }

  for (const sample of rawData) {
    const convId = sample.sample_id;

    // Skip if already cached (from a previous completed run)
    if (cacheData[convId]) {
      const facts = cacheData[convId].map((ef, idx) =>
        makeFactFromExtracted(ef, convId, idx),
      );
      factsByConversation.set(convId, facts);
      totalFacts += facts.length;
      extractionTelemetry.cachedConversations += 1;
      console.log(
        `[LoCoMo-Full] ${convId}: using cached ${facts.length} facts (skipped extraction)`,
      );
      continue;
    }

    // Extract fresh.
    // P0-B-OPT: Use buffer+flush + consolidation (Memobase-inspired) when enabled.
    // This produces multi-attribute facts and merges near-duplicates, reducing
    // the 2403-fact fragmentation problem (69% unique predicates, no consolidation).
    const turns = extractTurns(sample.conversation);
    const useBufferedExtraction = process.env.DISABLE_BUFFERED_EXTRACTION !== "1";
    console.log(
      `[LoCoMo-Full] Extracting facts for ${convId} (${turns.length} turns, ${useBufferedExtraction ? "buffered+consolidation" : "legacy"})...`,
    );

    let facts: RuntimeMemoryQueryableFact[];
    if (useBufferedExtraction) {
      const bufferedTurns: BufferedExtractionTurn[] = turns.map((t, idx) => ({
        speaker: t.speaker,
        text: t.text,
        sessionDate: t.sessionDate,
        sessionId: t.sessionId,
        turnIndex: idx,
      }));
      const result = await extractFactsWithBufferedFlush(
        bufferedTurns,
        convId,
        callLLM,
        {
          chunkSize: 5,
          enableConsolidation: process.env.DISABLE_CONSOLIDATION !== "1",
          onProgress: (event) => {
            if (event.phase === "extract") {
              console.log(
                `[LoCoMo-Full] ${convId} extract chunk ${event.chunk}/${event.totalChunks}: ${event.facts ?? 0} facts`,
              );
            } else if (event.phase === "consolidate") {
              console.log(
                `[LoCoMo-Full] ${convId} consolidated: ${event.facts} facts`,
              );
            }
          },
        },
      );
      console.log(
        `[LoCoMo-Full] ${convId} extraction: raw=${result.totalRaw} consolidated=${result.totalConsolidated} (before=${result.consolidationStats.factsBeforeConsolidation} after=${result.consolidationStats.factsAfterConsolidation})`,
      );
      facts = result.facts.map((f, idx) => {
        const ef: ExtractedFact = {
          subject: f.subject,
          predicate: f.predicate,
          objectSummary: f.objectSummary,
          sessionDate: f.sessionDate,
          // Item 2: propagate evidenceRefs/proofCount from consolidation.
          evidenceRefs: f.evidenceRefs,
          proofCount: f.proofCount,
        };
        return makeFactFromExtracted(ef, convId, idx);
      });
    } else {
      facts = await extractFactsFromConversation(turns, convId, callLLM);
    }
    extractionTelemetry.freshConversations += 1;
    factsByConversation.set(convId, facts);
    cacheData[convId] = facts.map((f) => ({
      subject: f.subject,
      predicate: f.predicate,
      objectSummary: f.objectSummary,
      sessionDate: f.valid_at,
    }));
    totalFacts += facts.length;

    // P3-B: Incremental save after EACH conversation so an interrupted run
    // (OOM, crash, manual stop) can resume without re-extracting completed work.
    try {
      writeFileSync(FACTS_CACHE_PATH, JSON.stringify(cacheData, null, 2), "utf-8");
      console.log(
        `[LoCoMo-Full] Incremental cache saved: ${Object.keys(cacheData).length}/${rawData.length} conversations, ${totalFacts} total facts → ${FACTS_CACHE_PATH}`,
      );
    } catch (err) {
      console.log(`[LoCoMo-Full] Failed to save incremental cache: ${(err as Error).message}`);
    }
  }

  // Item 2: enrich cached facts (which lack evidenceRefs) so applyFinalBoost
  // works. Fresh facts from buffered extraction already have evidenceRefs.
  enrichEvidenceRefs(factsByConversation);

  return factsByConversation;
}

function stratifiedSample<TItem extends LocomoQaItem>(
  allQAs: readonly TItem[],
): TItem[] {
  const byCategory: Record<string, TItem[]> = {};
  for (const item of allQAs) {
    const cat = CATEGORY_MAP[item.qa.category];
    if (cat === "adversarial") continue; // exclude
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(item);
  }

  const sampled: TItem[] = [];
  const sampleRng = createSeededRandom(SAMPLE_SEED);
  for (const [cat, items] of Object.entries(byCategory)) {
    const shuffled = seededShuffle(items, sampleRng);
    const take = Math.min(SAMPLE_SIZES[cat] ?? 0, shuffled.length);
    for (let i = 0; i < take; i++) {
      sampled.push({ ...shuffled[i], category: cat });
    }
    console.log(`[LoCoMo-Full] ${cat}: ${take}/${items.length} sampled`);
  }
  return sampled;
}

function makeQuestionId(conversationId: string, qaIndex: number): string {
  return `${conversationId}_q${qaIndex}`;
}

function loadDevSliceCache(): DevSliceCache<DevSliceCachedQuestion> | null {
  try {
    const parsed = JSON.parse(
      readFileSync(DEV_SLICE_CACHE_PATH, "utf-8"),
    ) as DevSliceCache<DevSliceCachedQuestion>;
    if (!isDevSliceCacheValid(parsed)) return null;
    if (
      !parsed.questions.every(
        (question) =>
          Array.isArray(question.retrievalCache?.semanticFacts) &&
          Array.isArray(question.retrievalCache?.hybridHits) &&
          question.retrievalCache.hybridHits.every(
            (hit) =>
              typeof hit.bm25Score === "number" &&
              typeof hit.vectorScore === "number" &&
              typeof hit.entityScore === "number",
          ) &&
          Array.isArray(question.retrievalCache?.episodicHits),
      )
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeDevSliceCache(questions: readonly DevSliceCachedQuestion[]): void {
  const cache: DevSliceCache<DevSliceCachedQuestion> = {
    version: DEV_SLICE_CACHE_VERSION,
    sampleSeed: DEV_SLICE_SAMPLE_SEED,
    sampleSizes: DEV_SLICE_SAMPLE_SIZES,
    questions: [...questions],
  };
  mkdirSync(dirname(DEV_SLICE_CACHE_PATH), { recursive: true });
  writeFileSync(DEV_SLICE_CACHE_PATH, JSON.stringify(cache, null, 2) + "\n", "utf-8");
}

function loadSessionSummaryCache(): SessionSummaryCache {
  try {
    const parsed = JSON.parse(
      readFileSync(SESSION_SUMMARY_CACHE_PATH, "utf-8"),
    ) as SessionSummaryCache;
    if (
      parsed.version === "10.0-session-summary-index" &&
      parsed.embeddingProvider === "siliconflow-qwen3-embed-8b" &&
      parsed.conversations &&
      typeof parsed.conversations === "object"
    ) {
      return parsed;
    }
  } catch {
    // Missing cache is expected on the first Stage 2 run.
  }
  return {
    version: "10.0-session-summary-index",
    embeddingProvider: "siliconflow-qwen3-embed-8b",
    conversations: {},
  };
}

function writeSessionSummaryCache(cache: SessionSummaryCache): void {
  mkdirSync(dirname(SESSION_SUMMARY_CACHE_PATH), { recursive: true });
  writeFileSync(
    SESSION_SUMMARY_CACHE_PATH,
    JSON.stringify(cache, null, 2) + "\n",
    "utf-8",
  );
}

function devSliceCacheCoversSample(
  cache: DevSliceCache<DevSliceCachedQuestion> | null,
  sampled: readonly LocomoQaItem[],
): boolean {
  if (cache === null) return false;
  const cachedByQuestionId = new Set(cache.questions.map((question) => question.questionId));
  return sampled.every((item) =>
    cachedByQuestionId.has(makeQuestionId(item.conversationId, item.qaIndex)),
  );
}

function sessionSummaryCacheCoversConversations(
  cache: SessionSummaryCache,
  rawData: readonly LocomoSample[],
): boolean {
  return rawData.every((sample) => {
    const summaries = cache.conversations[sample.sample_id];
    return Array.isArray(summaries) && summaries.length > 0;
  });
}

function assembleGeneratorContext(
  episodicContext: string,
  retrievedFacts: readonly RuntimeMemoryQueryableFact[],
  profileContext?: readonly string[],
): string {
  void profileContext;
  const parts: string[] = [];
  if (episodicContext.trim().length > 0) {
    parts.push(`[EPISODIC MEMORY]\n${episodicContext}`);
  }
  if (retrievedFacts.length > 0) {
    parts.push(
      `[SEMANTIC MEMORY]\n${retrievedFacts
        .slice(0, 10)
        .map((fact, index) => {
          const date = new Date(fact.valid_at).toISOString().slice(0, 10);
          return `[${index + 1}] [said on ${date}] ${fact.subject} ${fact.predicate}: ${fact.objectSummary}`;
        })
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

// S1-3: dedupe facts by factId, preserving first occurrence (original facts
// take priority over re-retrieved facts).
function dedupeFactsById(
  facts: readonly RuntimeMemoryQueryableFact[],
): RuntimeMemoryQueryableFact[] {
  const seen = new Set<string>();
  const result: RuntimeMemoryQueryableFact[] = [];
  for (const f of facts) {
    if (seen.has(f.factId)) continue;
    seen.add(f.factId);
    result.push(f);
  }
  return result;
}

function computeLegacyRecall(
  groundTruth: string,
  retrievedFacts: readonly RuntimeMemoryQueryableFact[],
): number {
  const answerWords = groundTruth
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3);
  const retrievedText = retrievedFacts
    .map((fact) => fact.objectSummary.toLowerCase())
    .join(" ");
  return answerWords.length > 0
    ? answerWords.filter((word) => retrievedText.includes(word)).length /
        answerWords.length
    : 0;
}

function formatFullConversationText(turns: readonly LocomoTurn[]): string {
  return turns
    .map((turn) => {
      const date = new Date(turn.sessionDate).toISOString().slice(0, 10);
      return `[said on ${date}] ${turn.speaker}: ${turn.text}`;
    })
    .join("\n");
}

// P0-A: LLM query rewriting — rewrite questions into declarative statements
// to align the query embedding with fact embeddings (which are declarative).
//
// Root cause being addressed: questions ("When did Alice start her job?") and
// facts ("Alice started working at the hospital in March 2023") live in
// different semantic regions of the embedding space (interrogative vs
// declarative, different vocabulary). This causes low Recall@5 because the
// cosine similarity between query and fact embeddings is too low to surface
// the relevant facts.
//
// Approach: use DeepSeek to rewrite the question into 3 declarative phrases
// that a person who knew the answer might write. Each rewrite + the original
// question is embedded and retrieved separately; results are merged with
// standard RRF (k=60). This is the MultiQueryRetriever pattern (LangChain).
async function rewriteQuery(question: string): Promise<string[]> {
  const system =
    "You rewrite questions into declarative statements that match the semantic form of factual memories. " +
    "Given a question, produce 3 different declarative statements that a person who knew the answer might write. " +
    "Each statement should be a partial sentence or noun phrase that the answer would complete. " +
    "Use the same entities (names, places, objects) as the question. " +
    "Do NOT answer the question — only produce statements that would match the fact containing the answer. " +
    "Return ONLY the 3 statements, one per line. No numbering, no preamble, no quotes.";

  const user = `Question: ${question}\n\n3 declarative rewrites:`;

  const response = await callTrackedDeepSeek(system, user, {
    temperature: 0,
    maxTokens: 128,
  });

  return response.content
    .split("\n")
    .map((s) => s.replace(/^\d+[\.\)]\s*/, "").replace(/^["'`]|["'`]$/g, "").trim())
    .filter((s) => s.length > 0 && s.length < 500)
    .slice(0, 3);
}

async function generateAnswer(
  question: string,
  retrievedFacts: RuntimeMemoryQueryableFact[],
  profileContext?: string[],
): Promise<string> {
  void profileContext;
  const context = retrievedFacts
    .slice(0, 10)
    .map(
      (f, i) => `[${i + 1}] ${f.subject} ${f.predicate}: ${f.objectSummary}`,
    )
    .join("\n");

  const system =
    "You are a helpful assistant answering questions about conversations between two people. " +
    "Use the provided memory facts to answer the question. " +
    "If the facts contain relevant information, synthesize a concise, factual answer. " +
    "If multiple facts are relevant, combine them to form a complete answer. " +
    "Only say 'I don't know' if the facts contain absolutely no relevant information. " +
    "Answer in a direct, factual style. Prefer specific details over general statements.";

  const user = `Memory facts:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;

  const response = await callTrackedDeepSeek(system, user, {
    temperature: 0,
    maxTokens: 256,
  });
  return response.content.trim();
}

// P0 Phase 5: Dual-track answer generation using buildDualTrackPrompt from
// episodic-memory.ts. Episodic memory (raw conversation snippets) is placed
// first; semantic facts act as a structured summary.
async function generateDualTrackAnswer(
  question: string,
  category: string,
  episodicContext: string,
  retrievedFacts: RuntimeMemoryQueryableFact[],
  profileContext?: string[],
  options: {
    allowInternalAbstention?: boolean;
    reasoningHints?: readonly string[];
  } = {},
): Promise<string> {
  const { system, user } = buildCategoryAwareDualTrackPrompt(
    question,
    category,
    episodicContext,
    retrievedFacts,
    profileContext,
    options,
  );
  // Stage 3.2 (2026-07-04): maxTokens kept at 384 for multi_hop — the
  // simplified prompt (brief reasoning + "Final answer:") fits in 384.
  // The previous 512 was for the verbose "Hop N -> sub-answer" format
  // which truncated before reaching "Final answer:".
  const maxTokens =
    category === "temporal" || category === "multi_hop" ? 384 : 256;
  const response = await callTrackedDeepSeek(system, user, {
    temperature: 0,
    maxTokens,
  });
  return response.content.trim();
}

// P0-OPT: Judge result cache — survives test restart.
// If a question + predictedAnswer + groundTruth + promptVersion is identical,
// return the cached verdict without an LLM call. Saves ~80% of judge time
// when a 150-question run fails at Q120.
let judgeCache: JudgeResultCache | null = null;
const JUDGE_CACHE_PATH = join(
  process.cwd(),
  "artifacts",
  "runtime-memory-eval",
  "judge-result-cache.json",
);

function getJudgeCache(): JudgeResultCache {
  if (judgeCache === null) {
    judgeCache = new JudgeResultCache(
      JUDGE_CACHE_PATH,
      FROZEN_JUDGE_CONFIG.promptVersion,
      FROZEN_JUDGE_CONFIG.model,
    );
  }
  return judgeCache;
}

// Stage 5.7: Self-ask cache — stabilizes multi_hop variance by caching
// decomposition + hop answers. Same question always returns same hop answers.
let selfAskCache: SelfAskCache | null = null;
const SELFASK_CACHE_PATH = join(
  process.cwd(),
  "artifacts",
  "runtime-memory-eval",
  "self-ask-cache.json",
);

function getSelfAskCache(): SelfAskCache {
  if (selfAskCache === null) {
    selfAskCache = new SelfAskCache(SELFASK_CACHE_PATH);
  }
  return selfAskCache;
}

// Helper: run self-ask with cache. Returns cached hop answers if available,
// otherwise runs self-ask and caches the result.
async function runSelfAskWithCache(
  question: string,
  runSelfAsk: () => Promise<{ hopAnswers: string[]; subQuestions: string[]; used: boolean }>,
): Promise<{ hopAnswers: string[]; used: boolean }> {
  const cache = getSelfAskCache();
  const cached = cache.get(question);
  if (cached) {
    return { hopAnswers: cached.hopAnswers, used: true };
  }
  const result = await runSelfAsk();
  if (result.used && result.hopAnswers.length > 0) {
    cache.set(question, result.hopAnswers, result.subQuestions);
  }
  return { hopAnswers: result.hopAnswers, used: result.used };
}

let judgeCacheHits = 0;
let judgeCacheMisses = 0;

async function judgeAnswer(
  question: string,
  groundTruth: string | number,
  predictedAnswer: string,
): Promise<number> {
  const cache = getJudgeCache();
  const cached = cache.get(question, groundTruth, predictedAnswer);
  if (cached !== undefined) {
    judgeCacheHits += 1;
    return cached;
  }
  judgeCacheMisses += 1;
  const { system, user } = buildFrozenJudgePrompt(question, groundTruth, predictedAnswer);
  const response = await callTrackedDeepSeek(system, user, {
    temperature: 0,
    maxTokens: 8,
    model: FROZEN_JUDGE_CONFIG.model,
  });
  const score = parseFrozenJudgeVerdict(response.content);
  cache.set(question, groundTruth, predictedAnswer, score);
  return score;
}

afterEach(() => {});

function isFullEvalRequested(): boolean {
  return process.env.FULL_EVAL === "1" || process.argv.includes("--full");
}

// P0-OPT: Smoke mode — run only a few questions per category.
// ~5min instead of 34min. Use for fast iteration during development.
// Usage: SMOKE=1 pnpm exec vitest run ...
// Override per-category sample size with SMOKE_SAMPLE_PER_CATEGORY=N
// (default 5 → 20 total; set to 2-3 for a ~10-question quick smoke).
function isSmokeRequested(): boolean {
  return process.env.SMOKE === "1" || process.argv.includes("--smoke");
}

const SMOKE_PER_CATEGORY = (() => {
  const raw = process.env.SMOKE_SAMPLE_PER_CATEGORY;
  if (!raw) return 5;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
})();

const SMOKE_SAMPLE_SIZES: Record<string, number> = {
  single_hop: SMOKE_PER_CATEGORY,
  temporal: SMOKE_PER_CATEGORY,
  multi_hop: SMOKE_PER_CATEGORY,
  open_domain: SMOKE_PER_CATEGORY,
};

function canRunWithoutSiliconFlow(): boolean {
  if (isFullEvalRequested()) return false;
  const rawData = loadRawData();
  const sampled = buildStratifiedDevSlice(collectNonAdversarialQAs(rawData));
  return (
    devSliceCacheCoversSample(loadDevSliceCache(), sampled) &&
    sessionSummaryCacheCoversConversations(loadSessionSummaryCache(), rawData)
  );
}

describe.skipIf(
  !hasDeepSeekKey() || (!hasSiliconFlowKey() && !canRunWithoutSiliconFlow()),
)(
  "L11-FULL: LoCoMo 500-question benchmark with real embedding + LLM judge",
  () => {
    it(
      "runs 500-question stratified LoCoMo benchmark",
      async () => {
        const rawData = loadRawData();
        console.log(`[LoCoMo-Full] Loaded ${rawData.length} conversations`);


        // Collect all QAs
        const allQAs = collectNonAdversarialQAs(rawData);
        console.log(
          `[LoCoMo-Full] Total QAs: ${allQAs.length} (including adversarial)`,
        );

        const fullEval = isFullEvalRequested();
        const smoke = isSmokeRequested();
        const cachedDevSlice = fullEval || smoke ? null : loadDevSliceCache();
        const cachedByQuestionId = new Map(
          cachedDevSlice?.questions.map((question) => [question.questionId, question]) ?? [],
        );
        const sampled = fullEval
          ? stratifiedSample(allQAs)
          : smoke
            ? buildStratifiedDevSlice(allQAs, {
                sampleSizes: SMOKE_SAMPLE_SIZES,
                seed: 42, // fixed seed so smoke is reproducible across runs
              })
            : buildStratifiedDevSlice(allQAs);
        const cachedCoversSample =
          !fullEval && !smoke && devSliceCacheCoversSample(cachedDevSlice, sampled);
        const needsRetrieval = fullEval || smoke || !cachedCoversSample;
        // Stage 4 (2026-07-04): Reflect Agent needs index access for
        // agentic re-retrieval. When ENABLE_REFLECT_AGENT=1, force-load
        // facts and build indexes EVEN IF dev-slice cache covers the sample
        // (initial retrieval still uses cache for speed; only re-retrieval
        // hits the freshly built index).
        const needsReflectIndex = process.env.ENABLE_REFLECT_AGENT === "1";
        const needsFacts = needsRetrieval || needsReflectIndex;
        console.log(
          `[LoCoMo-Full] Sampled: ${sampled.length} questions (${fullEval ? "full" : smoke ? "smoke (20q)" : cachedCoversSample ? "dev-slice cached retrieval" : "dev-slice building retrieval cache"})${needsReflectIndex ? " + reflect-agent index" : ""}`,
        );
        const devSliceCacheWrites: DevSliceCachedQuestion[] = cachedDevSlice?.questions ?? [];
        const sessionSummaryCache = loadSessionSummaryCache();
        const needsSessionSummaryBuild =
          !sessionSummaryCacheCoversConversations(sessionSummaryCache, rawData);
        const needsEmbeddingProvider = needsFacts || needsSessionSummaryBuild;

        const factsByConversation = needsFacts
          ? await loadOrExtractFacts(rawData, callTrackedDeepSeek)
          : new Map<string, RuntimeMemoryQueryableFact[]>();

        let totalFactsCount = 0;
        if (needsRetrieval) {
          for (const [convId, facts] of factsByConversation) {
            totalFactsCount += facts.length;
            console.log(
              `[LoCoMo-Full] Conv ${convId}: ${facts.length} curated facts`,
            );
          }
          console.log(`[LoCoMo-Full] Total curated facts: ${totalFactsCount}`);
        } else {
          console.log(
            "[LoCoMo-Full] Dev-slice cache includes semantic fact payloads; fact extraction skipped",
          );
        }

        // === Item 3: Background Observation Consolidation (cross-session merge) ===
        // Hindsight §3.1-3.4: after retain, background consolidation merges
        // facts across sessions into higher-level observations. Observations
        // carry source_memory_ids and proof_count for applyFinalBoost.
        // DISABLE_OBSERVATION_CONSOLIDATION=1 skips this step (A/B comparison).
        if (
          needsFacts &&
          process.env.DISABLE_OBSERVATION_CONSOLIDATION !== "1"
        ) {
          const expectedConvIds = rawData.map((s) => s.sample_id);
          let observationsByConversation = loadObservationCache(expectedConvIds);
          if (observationsByConversation !== null) {
            console.log(
              `[LoCoMo-Full] Item 3: Loaded observation cache (${observationsByConversation.size} conversations)`,
            );
          } else {
            console.log(
              "[LoCoMo-Full] Item 3: Generating observations (cross-session consolidation)...",
            );
            // Convert facts to ObservationInputFact format.
            const inputByConv = new Map<string, ObservationInputFact[]>();
            for (const [convId, facts] of factsByConversation) {
              inputByConv.set(
                convId,
                facts.map((f) => ({
                  factId: f.factId,
                  subject: f.subject,
                  predicate: f.predicate,
                  objectSummary: f.objectSummary,
                  sessionDate: f.valid_at,
                })),
              );
            }
            observationsByConversation = await consolidateObservations(
              inputByConv,
              callTrackedDeepSeek,
              {
                onProgress: (event) => {
                  console.log(
                    `[LoCoMo-Full] Item 3: ${event.conversationId} subject "${event.subject}": ` +
                      `${event.factsBefore} facts → ${event.observationsAfter} observations`,
                  );
                },
              },
            );
            saveObservationCache(observationsByConversation);
          }

          // Apply observations: replace merged facts with observations.
          let totalObservations = 0;
          let totalMerged = 0;
          for (const [convId, facts] of factsByConversation) {
            const observations = observationsByConversation.get(convId) ?? [];
            if (observations.length === 0) continue;
            // Count how many original facts will be replaced.
            const mergedIds = new Set<string>();
            for (const obs of observations) {
              for (const id of obs.sourceMemoryIds) mergedIds.add(id);
            }
            totalMerged += mergedIds.size;
            totalObservations += observations.length;
            // Build new facts list: unmerged originals + observations.
            const unmerged = facts.filter((f) => !mergedIds.has(f.factId));
            const obsFacts = observations.map((obs, idx) =>
              makeFactFromObservation(obs, convId, idx),
            );
            factsByConversation.set(convId, [...unmerged, ...obsFacts]);
          }

          const newTotal = Array.from(factsByConversation.values()).reduce(
            (sum, facts) => sum + facts.length,
            0,
          );
          console.log(
            `[LoCoMo-Full] Item 3: ${totalMerged} original facts merged into ` +
              `${totalObservations} observations. New total: ${newTotal} facts ` +
              `(was ${totalFactsCount}, Δ${newTotal - totalFactsCount})`,
          );
        } else if (process.env.DISABLE_OBSERVATION_CONSOLIDATION === "1") {
          console.log(
            "[LoCoMo-Full] Item 3: Observation consolidation SKIPPED (DISABLE_OBSERVATION_CONSOLIDATION=1)",
          );
        }

        // Create embedding provider.
        // P0-OPT: wrap base provider with a disk cache so the second run
        // skips ALL embedding API calls (2403 facts + ~13000 sentences = 0 API calls).
        // First run populates the cache (~5min); subsequent runs hit disk (<5s).
        // Stage 4: When SILICONFLOW_API_KEY is not set, provider is null and
        // reflect agent runs in degraded mode (critique + regeneration only,
        // no re-retrieval). This allows testing reflect agent logic without
        // the embedding API.
        const rawEmbeddingProvider =
          needsEmbeddingProvider && hasSiliconFlowKey()
            ? createSiliconFlowEmbeddingProvider()
            : null;
        const embeddingCachePath = join(
          process.cwd(),
          "artifacts",
          "runtime-memory-eval",
          "embedding-cache.json",
        );
        const embeddingProvider =
          rawEmbeddingProvider !== null
            ? wrapWithDiskCache(rawEmbeddingProvider, embeddingCachePath)
            : null;
        if (embeddingProvider) {
          console.log(
            `[LoCoMo-Full] Embedding: Qwen3-Embedding-8B (SiliconFlow, disk-cached), dim=${embeddingProvider.dimension}`,
          );
        } else {
          console.log(
            "[LoCoMo-Full] Dev-slice and session-summary caches cover the run; skipping embedding provider and index prebuild",
          );
        }

        // Retry helper (used for both pre-build and per-question API calls)
        const withRetry = async <T>(fn: () => Promise<T>, retries = 5): Promise<T> => {
          for (let attempt = 0; attempt < retries; attempt++) {
            try {
              return await fn();
            } catch (err) {
              if (attempt === retries - 1) throw err;
              const backoff = Math.min(
                2000 * Math.pow(2, attempt) + Math.random() * 500,
                30000,
              );
              console.log(`[LoCoMo-Full] Retry ${attempt + 1}/${retries} after ${Math.round(backoff)}ms: ${(err as Error).message.slice(0, 120)}`);
              await new Promise((r) => setTimeout(r, backoff));
            }
          }
          throw new Error("unreachable");
        };

        // Pre-build hybrid search index per conversation (embeds all facts ONCE)
        const indexByConversation = new Map<string, HybridSearchIndex>();
        if (needsFacts && embeddingProvider) {
          for (const [convId, facts] of factsByConversation) {
            console.log(
              `[LoCoMo-Full] Pre-building index for ${convId} (${facts.length} facts)...`,
            );
            const index = await withRetry(() =>
              buildHybridSearchIndex(facts, embeddingProvider),
            );
            indexByConversation.set(convId, index);
          }
        } else {
          console.log("[LoCoMo-Full] Using dev-slice retrieval cache; semantic index prebuild skipped");
        }
        console.log(
          `[LoCoMo-Full] All ${indexByConversation.size} conversation indexes built`,
        );

        // Pre-build semantic kNN graphs per conversation (Hindsight alignment).
        // Cached once per conversation to avoid O(n²) rebuild on every question.
        const knnGraphByConversation = new Map<string, ReturnType<typeof buildSemanticKnnGraph>>();
        if (process.env.ENABLE_AGENT_RETRIEVAL === "1") {
          for (const [convId, index] of indexByConversation) {
            const factEmbs = index.getFactEmbeddings();
            if (factEmbs.size > 0) {
              const knnGraph = buildSemanticKnnGraph(factEmbs, 5, 0.7);
              knnGraphByConversation.set(convId, knnGraph);
            }
          }
          console.log(
            `[LoCoMo-Full] Built ${knnGraphByConversation.size} semantic kNN graphs`,
          );
        }

        // === Item 4: Build EntityStore for entity-based retrieval boost ===
        // Hindsight §2.4: Map<entityName, Set<factId>> for entity self-join.
        // Applied as post-rerank boost using tanh(sharedCount * 0.5) formula.
        // DISABLE_ENTITY_STORE=1 skips both construction and boost (for A/B
        // comparison and for isolating crashes during index building).
        const entityStoreByConversation = new Map<string, EntityStore>();
        if (process.env.DISABLE_ENTITY_STORE !== "1") {
          for (const [convId, facts] of factsByConversation) {
            const store = EntityStore.fromFacts(
              facts.map((f) => ({
                factId: f.factId,
                subject: f.subject,
                predicate: f.predicate,
                objectSummary: f.objectSummary,
                // S0-2: pass through LLM-extracted entities[] so EntityStore
                // reads the field directly instead of re-running regex.
                ...(Array.isArray((f as { entities?: string[] }).entities) &&
                (f as { entities?: string[] }).entities!.length > 0
                  ? {
                      entities: (f as { entities?: string[] }).entities!,
                    }
                  : {}),
              })),
            );
            entityStoreByConversation.set(convId, store);
          }
          if (entityStoreByConversation.size > 0) {
            const firstStore = entityStoreByConversation.values().next().value!;
            const cov = firstStore.getCoverage();
            console.log(
              `[LoCoMo-Full] Item 4: EntityStore built for ${entityStoreByConversation.size} conversations ` +
                `(sample conv coverage: ${cov.factsWithEntities}/${cov.totalFacts} = ${(cov.coverage * 100).toFixed(1)}%, ` +
                `${cov.uniqueEntities} unique entities)`,
            );
          }
        } else {
          console.log("[LoCoMo-Full] Item 4: EntityStore SKIPPED (DISABLE_ENTITY_STORE=1)");
        }

        // === Phase 5 (P0): Pre-build Episodic Memory index per conversation ===
        // Track A of the dual-track architecture: raw conversation sentences
        // indexed at sentence granularity. This complements the semantic track
        // (Track B, extracted facts) by preserving ground-truth phrasing that
        // was lost during LLM fact extraction (~53% information loss).
        // See: tests/unit/helpers/episodic-memory.ts
        const episodicByConversation = new Map<string, EpisodicMemory>();
        const fullConversationTextByConversation = new Map<string, string>();
        const sessionSummaryByConversation = new Map<string, SessionSummaryIndex>();
        for (const sample of rawData) {
          const convId = sample.sample_id;
          const turns = extractTurns(sample.conversation);
          fullConversationTextByConversation.set(convId, formatFullConversationText(turns));

          // P1-SOTA: DISABLE_EPISODIC_MEMORY=1 skips slow episodic indexing
          // (SiliconFlow embedding API calls for ~1300 sentences × 10 convs)
          // when verifying cross-encoder + chained retrieval integration.
          // The episodic memory path is skipped if env var is set.
          const disableEpisodic =
            process.env.DISABLE_EPISODIC_MEMORY === "1" ||
            process.env.DISABLE_EPISODIC === "1";
          if (needsRetrieval && embeddingProvider && !disableEpisodic) {
            // Convert LocomoTurn[] to IngestTurn[] with stable IDs
            const ingestTurns: IngestTurn[] = turns.map((t, idx) => ({
              turn_id: `${convId}_t${idx}`,
              session_id: t.sessionId,
              speaker: t.speaker,
              text: t.text,
              timestamp: t.sessionDate,
              turn_index: idx,
            }));
            const episodic = new EpisodicMemory();
            await withRetry(() => episodic.ingestTurns(ingestTurns, embeddingProvider));
            episodicByConversation.set(convId, episodic);
            console.log(
              `[LoCoMo-Full] Episodic index for ${convId}: ${episodic.size} sentences from ${turns.length} turns`,
            );
          } else if (disableEpisodic) {
            console.log(
              `[LoCoMo-Full] Episodic index for ${convId}: SKIPPED (DISABLE_EPISODIC_MEMORY=1)`,
            );
          }

          const sessionIndex = new SessionSummaryIndex();
          const cachedSessionSummaries = sessionSummaryCache?.conversations[convId];
          if (cachedSessionSummaries && cachedSessionSummaries.length > 0) {
            for (const record of cachedSessionSummaries) {
              sessionIndex.addSummary({
                conversationId: record.conversationId,
                sessionId: record.sessionId,
                sessionDate: record.sessionDate,
                summary: record.summary,
                embedding: new Float32Array(record.embedding),
                rawText: record.rawText,
              });
            }
            sessionSummaryByConversation.set(convId, sessionIndex);
            console.log(
              `[LoCoMo-Full] Session summary index for ${convId}: ${sessionIndex.size} cached sessions`,
            );
            continue;
          }

          if (!needsSessionSummaryBuild || !embeddingProvider) continue;

          const sessionTurns: SessionSummaryTurn[] = turns.map((t, idx) => ({
            conversationId: convId,
            sessionId: t.sessionId,
            sessionDate: t.sessionDate,
            speaker: t.speaker,
            text: t.text,
            turnIndex: idx,
          }));
          await withRetry(() =>
            sessionIndex.buildFromTurns(
              convId,
              sessionTurns,
              embeddingProvider,
              callTrackedDeepSeek,
            ),
          );
          sessionSummaryByConversation.set(convId, sessionIndex);
          if (sessionSummaryCache) {
            sessionSummaryCache.conversations[convId] = sessionIndex.records.map((record) => ({
              conversationId: record.conversationId,
              sessionId: record.sessionId,
              sessionDate: record.sessionDate,
              summary: record.summary,
              embedding: Array.from(record.embedding),
              rawText: record.rawText,
            }));
            writeSessionSummaryCache(sessionSummaryCache);
          }
          console.log(
            `[LoCoMo-Full] Session summary index for ${convId}: ${sessionIndex.size} sessions`,
          );
        }
        console.log(
          `[LoCoMo-Full] Built ${episodicByConversation.size} episodic indexes`,
        );

        // Compute per-conversation referenceTime (latest valid_at) for temporal filtering
        const referenceTimeByConversation = new Map<string, number>();
        const factsByIdByConversation = new Map<string, Map<string, RuntimeMemoryQueryableFact>>();
        for (const [convId, facts] of factsByConversation) {
          const maxValidAt = facts.reduce(
            (max, f) => Math.max(max, f.valid_at),
            0,
          );
          referenceTimeByConversation.set(convId, maxValidAt);
          const factsById = new Map<string, RuntimeMemoryQueryableFact>();
          for (const f of facts) factsById.set(f.factId, f);
          factsByIdByConversation.set(convId, factsById);
        }

        // Run benchmark
        const byCategory: Record<
          string,
          { correct: number; total: number; recallSum: number; contextRecallSum: number }
        > = {};
        let totalCorrect = 0;
        let totalRecall = 0;
        let totalContextRecall = 0;
        const escalationBudget = new EscalationBudget(sampled.length, 0.25);
        const fullConversationBudget = new EscalationBudget(sampled.length, 0.15);
        // Stage 4: Reflect Agent budget — controls re-retrieval rate (expensive).
        // Critique always runs (cheap); re-retrieval is capped at 30%.
        const reflectEnabled = process.env.ENABLE_REFLECT_AGENT === "1";
        const reflectBudget = new ReflectBudget(sampled.length, 0.3);
        let reflectUsedCount = 0;
        let reflectReRetrieveCount = 0;
        let reflectRegenerateCount = 0;
        let reflectSkippedCount = 0;
        let reflectRevertedCount = 0;
        const reflectResults: ReflectResult[] = [];
        const escalationResults: EscalationResult[] = [];
        const taxonomyResults: ErrorTaxonomyResult[] = [];
        // Phase 1: Query Classifier stats — tracks classification distribution
        // and category×type alignment for diagnosing routing accuracy.
        const queryClassifierStats: {
          byType: Record<QueryType, number>;
          byCategory: Record<string, Record<QueryType, number>>;
          llmCalls: number;
          heuristicFallback: number;
          subQuestionsDecomposed: number;
        } = {
          byType: { temporal: 0, multi_hop: 0, open_domain: 0, single_hop: 0 },
          byCategory: {},
          llmCalls: 0,
          heuristicFallback: 0,
          subQuestionsDecomposed: 0,
        };
        // Phase 2: Feedback Loop stats — tracks whether the feedback loop
        // WOULD trigger (initial completeness != COMPLETE) and what the
        // rewritten query would be. Conservative diagnostic-only integration:
        // does NOT replace the actual retrieval result. The stats tell us
        // how often feedback would fire and on which categories, so we can
        // decide whether to activate it in a follow-up.
        const feedbackLoopStats: {
          initialByLevel: Record<CompletenessLevel, number>;
          byCategory: Record<string, Record<CompletenessLevel, number>>;
          wouldTrigger: number;
          totalMissingEvidence: number;
          rewritesGenerated: number;
          rewriteSamples: Array<{
            questionId: string;
            category: string;
            queryType: QueryType;
            original: string;
            rewritten: string;
            missingCount: number;
          }>;
        } = {
          initialByLevel: { COMPLETE: 0, PARTIAL: 0, INSUFFICIENT: 0 },
          byCategory: {},
          wouldTrigger: 0,
          totalMissingEvidence: 0,
          rewritesGenerated: 0,
          rewriteSamples: [],
        };
        // Phase 3: Self-ask Merge stats — tracks how often the new
        // selfAskDecomposeAndMerge path runs, how many sub-questions it
        // processes, and how many new facts it adds vs. how many existing
        // facts it boosts. Conservative diagnostic-only integration: does
        // NOT replace the existing sequential-self-ask path. The stats tell
        // us whether Phase 3 adds value beyond S1-2's inline RRF merge.
        const selfAskMergeStats: {
          triggered: number;
          byCategory: Record<string, number>;
          totalSubQuestions: number;
          totalMergedArmHits: number;
          totalBoostedExisting: number;
          totalNewCandidates: number;
          armWeight: number;
          samples: Array<{
            questionId: string;
            category: string;
            subQuestionCount: number;
            mergedArmHitCount: number;
            boostedExisting: number;
            newCandidates: number;
          }>;
        } = {
          triggered: 0,
          byCategory: {},
          totalSubQuestions: 0,
          totalMergedArmHits: 0,
          totalBoostedExisting: 0,
          totalNewCandidates: 0,
          armWeight: 0.8,
          samples: [],
        };
        // Phase 4: Unified Judge stats — runs the new unified judge IN
        // PARALLEL with the existing frozen judge (judgeAnswer). Compares
        // verdicts to measure agreement rate and detect drift. Conservative
        // diagnostic-only integration: does NOT replace judgeScore used in
        // error taxonomy / report metrics. The stats tell us whether the
        // new prompt + voting produces consistent results, paving the way
        // for activation in a follow-up.
        const unifiedJudgeStats: {
          total: number;
          byCategory: Record<string, { correct: number; wrong: number }>;
          agreementWithFrozen: number;
          unifiedMoreGenerous: number;
          unifiedMoreStrict: number;
          samples: Array<{
            questionId: string;
            category: string;
            frozenVerdict: number;
            unifiedVerdict: "CORRECT" | "WRONG";
            confidence: number;
            voteBreakdown?: { correct: number; wrong: number };
          }>;
          unifiedResults: JudgeResult[];
          frozenResults: { score: number }[];
        } = {
          total: 0,
          byCategory: {},
          agreementWithFrozen: 0,
          unifiedMoreGenerous: 0,
          unifiedMoreStrict: 0,
          samples: [],
          unifiedResults: [],
          frozenResults: [],
        };
        const results: Array<{
          questionId: string;
          category: string;
          conversationId: string;
          question: string;
          goldEvidence: string[];
          recall5: number;
          contextRecall: number;
          judgeScore: number;
          escalationLevel: number;
          predictedAnswer: string;
          groundTruth: string;
          assembledContext: string;
        }> = [];

        // Process questions in parallel batches for speed.
        const BATCH_SIZE = 3;

        const processQuestion = async (
          item: LocomoQaItem,
          qIdx: number,
        ): Promise<{
          questionId: string;
          category: string;
          conversationId: string;
          question: string;
          goldEvidence: string[];
          recall5: number;
          contextRecall: number;
          judgeScore: number;
          escalationLevel: number;
          predictedAnswer: string;
          groundTruth: string;
          assembledContext: string;
        }> => {
          const { qa, conversationId, category } = item;
          const answerStr = String(qa.answer);
          const questionId = makeQuestionId(conversationId, item.qaIndex);
          const cachedQuestion = cachedByQuestionId.get(questionId);

          // Phase 1: Query Classifier — classify query type and build QueryPlan.
          // LLM-first with heuristic fallback. For multi_hop, pre-computes
          // sub-questions so the self-ask path can skip redundant decomposition.
          const convRefTime = referenceTimeByConversation.get(conversationId);
          const queryPlan = await classifyQuery(qa.question, {
            referenceTime: convRefTime,
          });
          queryClassifierStats.byType[queryPlan.type] += 1;
          if (!queryClassifierStats.byCategory[category]) {
            queryClassifierStats.byCategory[category] = {
              temporal: 0, multi_hop: 0, open_domain: 0, single_hop: 0,
            };
          }
          queryClassifierStats.byCategory[category][queryPlan.type] += 1;
          if (queryPlan.subQuestions && queryPlan.subQuestions.length > 0) {
            queryClassifierStats.subQuestionsDecomposed += 1;
          }
          // Phase 1: If classifyQuery already decomposed sub-questions (multi_hop
          // via LLM), reuse them to skip the redundant decomposition call inside
          // runSequentialSelfAsk. Falls back to on-demand decomposition otherwise.
          const decomposeForSelfAsk = queryPlan.subQuestions && queryPlan.subQuestions.length > 0
            ? async (_question: string) => ({
                original: qa.question,
                subQuestions: queryPlan.subQuestions!,
              })
            : (question: string) => decomposeSequentialQuestion(question, callTrackedDeepSeek);

          try {
            if (cachedQuestion) {
              const factsById = factsByIdByConversation.get(conversationId);
              let retrievedFacts =
                cachedQuestion.retrievalCache.semanticFacts?.length > 0
                  ? cachedQuestion.retrievalCache.semanticFacts.map((fact) =>
                      makeFactFromCachedSemantic(fact, conversationId),
                    )
                  : cachedQuestion.retrievalCache.semanticFactIds
                      .map((factId) => factsById?.get(factId))
                      .filter((fact): fact is RuntimeMemoryQueryableFact => Boolean(fact));
              const cachedAssembledContext = assembleGeneratorContext(
                cachedQuestion.retrievalCache.episodicContext,
                retrievedFacts,
                undefined,
              );
              // Stage 5.2d (2026-07-04): Self-ask decomposition for multi_hop
              // in cached path. Decomposes the question into sub-questions,
              // answers each using cached facts, and passes hop answers as
              // reasoningHints. Addresses 7/14 multi_hop retrieved_not_used
              // errors (generator has facts but can't connect the hops).
              let cachedSelfAskHopAnswers: string[] = [];
              if (
                category === "multi_hop" &&
                (process.env.P3_MULTIHOP ?? "sequential-self-ask") ===
                  "sequential-self-ask"
              ) {
                try {
                  // Stage 5.7: check self-ask cache first to stabilize variance
                  const cached = getSelfAskCache().get(qa.question);
                  if (cached) {
                    cachedSelfAskHopAnswers = cached.hopAnswers;
                  } else {
                    const cachedFactContext = retrievedFacts
                      .map((f) => `${f.subject} ${f.predicate}: ${f.objectSummary}`)
                      .join("; ");
                    const cachedEpisodic =
                      cachedQuestion.retrievalCache.episodicContext || "";
                    const subContext =
                      cachedFactContext.length > 0
                        ? `${cachedFactContext}\n\n${cachedEpisodic}`.trim()
                        : cachedEpisodic;
                    let subQuestions: string[] = [];
                    const selfAsk = await runSequentialSelfAsk({
                      question: qa.question,
                      decompose: decomposeForSelfAsk,
                      answerSubQuestion: async (subQuestion) => {
                        subQuestions.push(subQuestion);
                        const response = await callTrackedDeepSeek(
                          "Answer the question with a single concise value (entity name, date, or short phrase). " +
                            "Never say 'I don't know' or 'not determinable'. If uncertain, give your best guess. " +
                            "No preamble, no explanation — just the value.",
                          `Question: ${subQuestion}\nContext: ${subContext}`,
                          { temperature: 0, maxTokens: 50 },
                        );
                        return { answer: response.content.trim(), evidence: [] };
                      },
                      retrieve: async () => [],
                      maxHits: 0,
                    });
                    if (selfAsk.used && selfAsk.hopAnswers.length > 0) {
                      cachedSelfAskHopAnswers = selfAsk.hopAnswers;
                      getSelfAskCache().set(
                        qa.question,
                        selfAsk.hopAnswers,
                        subQuestions,
                      );
                    }
                  }
                } catch {
                  // Self-ask failed — continue without hop answers
                }
              }
              let rawAnswer = await withRetry(() =>
                generateDualTrackAnswer(
                  qa.question,
                  category,
                  cachedQuestion.retrievalCache.episodicContext,
                  retrievedFacts,
                  undefined,
                  {
                    allowInternalAbstention: true,
                    reasoningHints: cachedSelfAskHopAnswers,
                  },
                ),
              );
              let strippedAnswer = stripEvidenceInsufficientSignal(rawAnswer);
              let escalationLevel: EscalationLevel = 0;
              let finalAssembledContext = cachedAssembledContext;
              // S1-3: compute referenceTime/temporalMode for reflect re-retrieval.
              const convReferenceTime =
                referenceTimeByConversation.get(conversationId);
              const queryTimeConstraint = extractQueryTimeConstraint(
                qa.question,
                convReferenceTime,
              );
              const referenceTime =
                queryTimeConstraint.referenceTime ?? convReferenceTime;
              const temporalMode = detectQueryTemporalMode(qa.question);
              const escalationAttempts = [
                { level: 0 as EscalationLevel, context: cachedAssembledContext, rawAnswer },
              ];

              if (strippedAnswer.insufficient && escalationBudget.tryUse()) {
                const sessionIndex = sessionSummaryByConversation.get(conversationId);
                const sessionHits = sessionIndex
                  ? await sessionIndex.search(
                      qa.question,
                      new Float32Array(cachedQuestion.retrievalCache.queryEmbedding),
                      2,
                    )
                  : [];
                const sessionContext = sessionHits.map((hit) => hit.rawText).join("\n\n");
                const level1Episodic = `${sessionContext}\n\n${cachedQuestion.retrievalCache.episodicContext}`.trim();
                rawAnswer = await withRetry(() =>
                  generateDualTrackAnswer(
                    qa.question,
                    category,
                    level1Episodic,
                    retrievedFacts,
                    undefined,
                    {
                      allowInternalAbstention: true,
                      reasoningHints: cachedSelfAskHopAnswers,
                    },
                  ),
                );
                strippedAnswer = stripEvidenceInsufficientSignal(rawAnswer);
                escalationLevel = 1;
                finalAssembledContext = assembleGeneratorContext(
                  level1Episodic,
                  retrievedFacts,
                  undefined,
                );
                escalationAttempts.push({
                  level: 1,
                  context: finalAssembledContext,
                  rawAnswer,
                });
              }

              if (strippedAnswer.insufficient && fullConversationBudget.tryUse()) {
                const fullConversation =
                  fullConversationTextByConversation.get(conversationId) ?? "";
                rawAnswer = await withRetry(() =>
                  generateDualTrackAnswer(
                    qa.question,
                    category,
                    fullConversation,
                    [],
                    undefined,
                    { allowInternalAbstention: false },
                  ),
                );
                strippedAnswer = stripEvidenceInsufficientSignal(rawAnswer);
                escalationLevel = 2;
                finalAssembledContext = fullConversation;
                escalationAttempts.push({
                  level: 2,
                  context: fullConversation,
                  rawAnswer,
                });
              }

              // Stage 4: Reflect Agent — critique + re-retrieve + regenerate.
              // Runs after escalation ladder completes. The critique is cheap
              // (1 LLM call) and always runs when reflectEnabled. Re-retrieval
              // only triggers when critique says "missing" and index is available.
              //
              // S1-3 (2026-07-04): reflect re-retrieval now goes through the
              // FULL pipeline (cross-encoder rerank + entity boost + final
              // boost), not just searchWithEmbedding. Re-retrieved facts are
              // captured and written back to retrievedFacts + finalAssembledContext
              // so the judge can see them. Closes 断裂点 6 (mem-status §3).
              let reflectFinalAnswer = strippedAnswer.answer;
              let reflectRetrievedFacts: RuntimeMemoryQueryableFact[] = [];
              if (reflectEnabled) {
                const indexForReflect = indexByConversation.get(conversationId);
                const embeddingProviderForReflect = embeddingProvider;
                const entityStoreForReflect =
                  process.env.DISABLE_ENTITY_STORE !== "1"
                    ? entityStoreByConversation.get(conversationId)
                    : undefined;
                const reflectResult = await runReflectAgent({
                  question: qa.question,
                  category,
                  initialAnswer: strippedAnswer.answer,
                  context: finalAssembledContext,
                  callLLM: callTrackedDeepSeek,
                  retrieve: indexForReflect && embeddingProviderForReflect
                    ? async (query: string) => {
                        const emb = await withRetry(() =>
                          embeddingProviderForReflect.embedQuery(query),
                        );
                        // S1-3: Full pipeline — RRF top-50 → cross-encoder →
                        // entity boost → final boost → top-15.
                        const rawHits = indexForReflect.searchWithEmbedding(
                          query,
                          new Float32Array(emb),
                          50,
                          OPTIMAL_HYBRID_FUSION,
                        );
                        // Temporal filter (same as main pipeline).
                        const filtered = rawHits.filter((hit) => {
                          if (
                            referenceTime !== undefined &&
                            hit.fact.valid_at > referenceTime
                          ) {
                            return false;
                          }
                          if (
                            temporalMode === "strict" &&
                            referenceTime !== undefined
                          ) {
                            if (
                              hit.fact.invalid_at !== undefined &&
                              hit.fact.invalid_at <= referenceTime
                            ) {
                              return false;
                            }
                          }
                          // P0 #3 (Zep temporal 四元组): expired_at 硬过滤
                          // 即使 non-strict mode 也过滤业务过期 fact。
                          // Source: zep-main/legacy/src/lib/graphiti/service_ce.go ExpiredAt
                          if (
                            referenceTime !== undefined &&
                            hit.fact.expired_at !== undefined &&
                            hit.fact.expired_at <= referenceTime
                          ) {
                            return false;
                          }
                          return true;
                        });
                        // Cross-encoder rerank.
                        let reranked = filtered;
                        const useCE =
                          hasSiliconFlowRerankKey() &&
                          process.env.DISABLE_CROSS_ENCODER !== "1";
                        if (useCE && reranked.length > 10) {
                          try {
                            reranked = await withRetry(() =>
                              rerankHybridHits(query, reranked, 30),
                            );
                          } catch {
                            // Graceful degradation.
                          }
                        }
                        // Entity boost.
                        if (entityStoreForReflect) {
                          const qEnts =
                            entityStoreForReflect.extractEntities(query);
                          if (qEnts.size > 0) {
                            reranked = entityStoreForReflect.applyEntityBoost(
                              reranked,
                              qEnts,
                              0.2,
                            );
                            reranked.sort(
                              (a, b) =>
                                (b.ceScore ?? b.rrfScore) -
                                (a.ceScore ?? a.rrfScore),
                            );
                          }
                        }
                        // Final boost (Hindsight ce_norm * recency * temporal * proof_count).
                        const boosted = applyFinalBoost(
                          reranked,
                          referenceTime,
                        );
                        const topReflectK = 15;
                        const finalHits = boosted.slice(0, topReflectK);
                        const facts = finalHits.map((h) => h.fact);
                        // S1-3: capture for write-back.
                        reflectRetrievedFacts = facts;
                        return facts;
                      }
                    : undefined,
                  regenerateWithContext: async (expandedContext: string) => {
                    // S1-3: pass reflectRetrievedFacts as retrievedFacts so
                    // the generator sees both original + re-retrieved facts.
                    const mergedFacts =
                      reflectRetrievedFacts.length > 0
                        ? dedupeFactsById([
                            ...retrievedFacts,
                            ...reflectRetrievedFacts,
                          ])
                        : retrievedFacts;
                    const regen = await withRetry(() =>
                      generateDualTrackAnswer(
                        qa.question,
                        category,
                        expandedContext,
                        mergedFacts,
                        undefined,
                        {},
                      ),
                    );
                    return regen;
                  },
                  budget: reflectBudget,
                  extractFinalAnswer,
                });
                if (reflectResult.used) {
                  reflectUsedCount += 1;
                  if (reflectResult.reRetrieved) {
                    reflectReRetrieveCount += 1;
                    // S1-3: write back re-retrieved facts so the judge and
                    // context recall can see them.
                    if (reflectRetrievedFacts.length > 0) {
                      const existingIds = new Set(
                        retrievedFacts.map((f) => f.factId),
                      );
                      const newFacts = reflectRetrievedFacts.filter(
                        (f) => !existingIds.has(f.factId),
                      );
                      if (newFacts.length > 0) {
                        retrievedFacts = [...retrievedFacts, ...newFacts];
                        // Re-assemble context with new facts.
                        finalAssembledContext = assembleGeneratorContext(
                          finalAssembledContext.includes("[EPISODIC MEMORY]")
                            ? finalAssembledContext
                            : "",
                          retrievedFacts,
                          undefined,
                        );
                      }
                    }
                  } else {
                    reflectRegenerateCount += 1;
                  }
                  reflectFinalAnswer = reflectResult.finalAnswer;
                } else if (reflectResult.skipped) {
                  reflectSkippedCount += 1;
                } else if (reflectResult.reverted) {
                  reflectRevertedCount += 1;
                }
                reflectResults.push(reflectResult);
              }

              const predictedAnswer = extractFinalAnswer(reflectFinalAnswer);
              escalationResults.push({
                answer: predictedAnswer,
                rawAnswer,
                escalationLevel,
                attempts: escalationAttempts,
              });
              const judgeScore = await withRetry(() =>
                judgeAnswer(qa.question, answerStr, predictedAnswer),
              );
              // Phase 4: Unified Judge diagnostic — run unified judge in
              // parallel with frozen judge. Conservative diagnostic-only:
              // does NOT replace judgeScore used in error taxonomy / report.
              try {
                const judgeCategory: JudgeCategory = (category as JudgeCategory) ?? "single_hop";
                const unifiedResult = await judgeWithUnifiedPrompt(
                  qa.question,
                  answerStr,
                  predictedAnswer,
                  judgeCategory,
                );
                unifiedJudgeStats.total += 1;
                if (!unifiedJudgeStats.byCategory[category]) {
                  unifiedJudgeStats.byCategory[category] = { correct: 0, wrong: 0 };
                }
                if (unifiedResult.verdict === "CORRECT") {
                  unifiedJudgeStats.byCategory[category].correct += 1;
                } else {
                  unifiedJudgeStats.byCategory[category].wrong += 1;
                }
                unifiedJudgeStats.unifiedResults.push(unifiedResult);
                unifiedJudgeStats.frozenResults.push({ score: judgeScore });
                if (unifiedJudgeStats.samples.length < 20) {
                  unifiedJudgeStats.samples.push({
                    questionId,
                    category,
                    frozenVerdict: judgeScore,
                    unifiedVerdict: unifiedResult.verdict,
                    confidence: unifiedResult.confidence,
                    ...(unifiedResult.voteBreakdown ? { voteBreakdown: unifiedResult.voteBreakdown } : {}),
                  });
                }
              } catch {
                // Phase 4 diagnostic failed — does not affect main pipeline
              }
              const recall5 = computeLegacyRecall(answerStr, retrievedFacts);
              const contextRecall = computeContextRecall(
                finalAssembledContext,
                qa.evidence ?? [],
              );
              if (judgeScore === 0) {
                const taxonomy = await classifyErrorTaxonomy(
                  {
                    question: qa.question,
                    assembledContext: finalAssembledContext,
                    predictedAnswer,
                    groundTruth: answerStr,
                    judgeScore,
                  },
                  callTrackedDeepSeek,
                );
                if (taxonomy) {
                  taxonomyResults.push({
                    category,
                    ...taxonomy,
                    question: qa.question,
                    assembledContext: finalAssembledContext,
                    predictedAnswer,
                    groundTruth: answerStr,
                    judgeScore,
                  });
                }
              }
              // Phase 2: Feedback Loop diagnostic — compute initial completeness
              // and (if INSUFFICIENT/PARTIAL) generate a rewritten query for
              // stats. Does NOT replace the actual retrieval result.
              {
                const goldEv = qa.evidence ?? [];
                const initial = computeContextCompletenessDeterministic(
                  finalAssembledContext,
                  goldEv,
                );
                feedbackLoopStats.initialByLevel[initial.level] += 1;
                if (!feedbackLoopStats.byCategory[category]) {
                  feedbackLoopStats.byCategory[category] = {
                    COMPLETE: 0, PARTIAL: 0, INSUFFICIENT: 0,
                  };
                }
                feedbackLoopStats.byCategory[category][initial.level] += 1;
                if (initial.level !== "COMPLETE") {
                  feedbackLoopStats.wouldTrigger += 1;
                  feedbackLoopStats.totalMissingEvidence += initial.missingEvidence.length;
                  try {
                    const rewritten = await rewriteQueryForRetrieval(
                      qa.question,
                      initial.missingEvidence,
                      queryPlan,
                    );
                    feedbackLoopStats.rewritesGenerated += 1;
                    if (feedbackLoopStats.rewriteSamples.length < 20) {
                      feedbackLoopStats.rewriteSamples.push({
                        questionId,
                        category,
                        queryType: queryPlan.type,
                        original: qa.question,
                        rewritten,
                        missingCount: initial.missingEvidence.length,
                      });
                    }
                  } catch {
                    // rewrite failed — still count as would-trigger
                  }
                }
              }
              return {
                questionId,
                category,
                conversationId,
                question: qa.question,
                goldEvidence: qa.evidence ?? [],
                recall5,
                contextRecall,
                judgeScore,
                escalationLevel,
                predictedAnswer,
                groundTruth: answerStr,
                assembledContext: finalAssembledContext,
              };
            }

            if (!embeddingProvider) {
              throw new Error(
                "SILICONFLOW_API_KEY is required when dev-slice retrieval cache is missing or FULL_EVAL=1",
              );
            }

            // 1. Retrieve with pre-built index + post-filter (temporal + candidate)
            const index = indexByConversation.get(conversationId);
            // P2-3: Use query-level time constraint when available.
            // The conversation-level referenceTime (max valid_at) is too coarse:
            // it can't distinguish "what did Alice do five years ago?" from
            // "what is Alice doing now?". extractQueryTimeConstraint parses
            // absolute dates ("on 15 March 2023"), relative offsets ("5 years
            // ago"), and present-tense keywords ("recently", "now") from the
            // question text, using conversation max time as the anchor.
            const convReferenceTime = referenceTimeByConversation.get(conversationId);
            const queryTimeConstraint = extractQueryTimeConstraint(
              qa.question,
              convReferenceTime,
            );
            const referenceTime =
              queryTimeConstraint.referenceTime ?? convReferenceTime;
            const temporalMode = detectQueryTemporalMode(qa.question);

            // Stage 1/2 constraint: UserProfile read-time augmentation stays disabled.
            // Two earlier profile-as-context variants regressed; profile-as-answer-source
            // routing is explicitly deferred to Stage 3.
            let profileContext: string[] | undefined;

            // Phase 4 (disproven): Multi-query LLM rewriting was tested in two variants
            // (sum RRF k=60, max RRF k=1 w=5) and BOTH regressed vs single-query baseline
            // (J: 45.2% → 38.6% / 39.8%). The hypothesis that question-statement semantic
            // mismatch is the root cause of low Recall@5 is DISPROVEN — rewrites add noise
            // that dilutes top-10 regardless of merge strategy. Reverted to single-query.
            // See rewriteQuery() above (retained for reference, not called by default).
            const queryEmbArr = await withRetry(() =>
              embeddingProvider.embedQuery(qa.question),
            );

            const rawHits = index
              ? index.searchWithEmbedding(
                  qa.question,
                  new Float32Array(queryEmbArr),
                  300, // Item 1: RRF top-300 → cross-encoder (Hindsight-aligned, was 30)
                  OPTIMAL_HYBRID_FUSION,
                )
              : [];

            // Post-filter: temporal (exclude future facts) + candidate threshold
            const filteredHits = rawHits.filter((hit) => {
              const fact = hit.fact;
              if (referenceTime !== undefined && fact.valid_at > referenceTime) {
                return false;
              }
              // strict mode: exclude facts invalidated before referenceTime
              if (temporalMode === "strict" && referenceTime !== undefined) {
                if (fact.invalid_at !== undefined && fact.invalid_at <= referenceTime) {
                  return false;
                }
              }
              // P0 #3 (Zep temporal 四元组): expired_at 硬过滤（non-strict mode 也过滤）
              if (
                referenceTime !== undefined &&
                fact.expired_at !== undefined &&
                fact.expired_at <= referenceTime
              ) {
                return false;
              }
              if (!isRuntimeMemoryAcceptedVerificationStatus(fact.verificationStatus)) {
                if (!(typeof fact.confidence === "number" && fact.confidence >= 0.7)) {
                  return false;
                }
              }
              return true;
            });

            // Item 6: Temporal as conditional independent RRF arm (Hindsight §2.5).
            // When query has a time constraint, add a temporal RRF arm: facts
            // within the time window get an extra RRF score contribution based
            // on their vector (semantic) rank within the temporal subset.
            // This replaces the previous +10% temporal boost with a stronger,
            // more principled RRF signal. Window: ±90d for absolute, ±365d for relative.
            if (queryTimeConstraint.mode !== "unknown" && referenceTime !== undefined) {
              const windowMs =
                queryTimeConstraint.mode === "absolute"
                  ? 90 * 24 * 60 * 60 * 1000
                  : 365 * 24 * 60 * 60 * 1000;
              const windowStart = referenceTime - windowMs;
              const windowEnd = referenceTime + windowMs;
              const temporalRrfK = 60; // same k as other RRF arms
              const temporalHits = filteredHits
                .filter((hit) => {
                  const va = hit.fact.valid_at;
                  return va >= windowStart && va <= windowEnd;
                })
                .sort((a, b) => b.vectorScore - a.vectorScore);
              for (let i = 0; i < temporalHits.length; i += 1) {
                temporalHits[i].rrfScore += 1 / (temporalRrfK + i + 1);
              }
              filteredHits.sort((a, b) => b.rrfScore - a.rrfScore);
            }

            // === Stage 3 (SOTA-aligned): Cross-encoder rerank + chained retrieval ===
            // P0-C: cross-encoder rerank (bge-reranker-v2-m3 via SiliconFlow API)
            // P0-D: chainedRetrievalExpand (graph BFS, already implemented, now wired)
            // P1-C: final boost (ce_norm * recency * temporal * proof_count)
            // Item 1: widen rerank candidate pool to top-300 → cross-encoder top-50
            // (Hindsight §2.3: reranker_max_candidates=300). Previously top-30 → top-15,
            // which capped Recall@5 at the source.
            let rerankedHits = filteredHits.slice(0, 300);
            const useCrossEncoderRerank =
              hasSiliconFlowRerankKey() &&
              process.env.DISABLE_CROSS_ENCODER !== "1";
            if (useCrossEncoderRerank && rerankedHits.length > 10) {
              try {
                rerankedHits = await withRetry(() =>
                  rerankHybridHits(qa.question, rerankedHits, 50),
                );
              } catch {
                // Graceful degradation: keep RRF order on rerank failure.
              }
            }

            // === Item 4: EntityStore boost (Hindsight §2.4) ===
            // After cross-encoder rerank, boost facts that share entities with
            // the query. Uses tanh(sharedCount * 0.5) * 0.2 weight (max +20%).
            // This catches exact entity matches (proper nouns, multi-word names,
            // numbers) that BM25/Vector dilute across partial matches.
            if (process.env.DISABLE_ENTITY_STORE !== "1") {
              const entityStore = entityStoreByConversation.get(conversationId);
              if (entityStore) {
                const queryEntities = entityStore.extractEntities(qa.question);
                if (queryEntities.size > 0) {
                  rerankedHits = entityStore.applyEntityBoost(
                    rerankedHits,
                    queryEntities,
                    0.2,
                  );
                  // Re-sort after entity boost
                  rerankedHits.sort((a, b) => b.rrfScore - a.rrfScore);
                }
              }
            }

            // P0-D / Item 5 v2: Hindsight-style weighted graph traversal.
            //
            // Status (2026-07-04): ROLLED BACK after 2 tuning attempts.
            // - v1 (minEntityScore=0.46, budget=30): J 70%→65%, open_domain 60%→40%
            // - v2 (minEntityScore=0.76, budget=15): J 70%→65%, multi_hop 40%→20%
            //
            // Root cause: graph traversal adds Recall@5 (+2.5pp) but the new
            // facts push correct answers out of top-K in the merged RRF scoring.
            // The issue is not edge quality but RRF merge dynamics: graph hits
            // get 1/(60+rank) which is comparable to initial hits' RRF scores,
            // so they displace rather than supplement.
            //
            // The weighted-graph-traversal.ts module is KEPT as infrastructure
            // (it's correct and tested), but disabled by default. To re-enable:
            // unset DISABLE_WEIGHTED_GRAPH or set a lower budget.
            //
            // Falling back to original chainedRetrievalExpand (depth=2/1, cap=5).
            let expandedHits = rerankedHits;
            const useWeightedGraph =
              process.env.DISABLE_WEIGHTED_GRAPH !== "1" &&
              process.env.ENABLE_WEIGHTED_GRAPH === "1";
            if (useWeightedGraph && rerankedHits.length > 0) {
              const entityStoreForExpansion =
                process.env.DISABLE_ENTITY_STORE !== "1"
                  ? entityStoreByConversation.get(conversationId)
                  : undefined;
              const factsForExpansion = factsByConversation.get(conversationId) ?? [];
              const factsByIdMap = new Map(
                factsForExpansion.map((f) => [f.factId, f] as const),
              );
              if (entityStoreForExpansion && index) {
                const factEmbeddings = index.getFactEmbeddings();
                if (factEmbeddings.size > 0) {
                  const graphResult = weightedGraphTraversal(
                    rerankedHits,
                    factsByIdMap,
                    entityStoreForExpansion,
                    new Float32Array(queryEmbArr),
                    factEmbeddings,
                    {
                      budget: 15,
                      maxDepth: isMultiHopQuestion(qa.question) ? 3 : 2,
                      minEntityScore: 0.76,
                      entityWeight: 1.0,
                      semanticWeight: 1.0,
                    },
                  );
                  if (graphResult.expanded && graphResult.hits.length > 0) {
                    const graphRRFHits = graphHitsToRRFHits(graphResult.hits);
                    expandedHits = mergeWithGraphRRF(rerankedHits, graphRRFHits);
                  }
                }
              }
            } else if (
              process.env.DISABLE_CHAINED_RETRIEVAL !== "1" &&
              rerankedHits.length > 0
            ) {
              // Original simple BFS (depth=2/1, cap=5) — kept as fallback.
              const factsForExpansion = factsByConversation.get(conversationId) ?? [];
              const entityStoreForExpansion =
                process.env.DISABLE_ENTITY_STORE !== "1"
                  ? entityStoreByConversation.get(conversationId)
                  : undefined;
              const relationMap = buildEntityRelationMap(
                factsForExpansion.map((f) => ({
                  factId: f.factId,
                  subject: f.subject,
                  objectSummary: f.objectSummary,
                })),
                entityStoreForExpansion
                  ? { entityStore: entityStoreForExpansion }
                  : undefined,
              );
              const factsByIdMap = new Map(
                factsForExpansion.map((f) => [f.factId, f] as const),
              );
              const expansionDepth = isMultiHopQuestion(qa.question) ? 2 : 1;
              const expansion = chainedRetrievalExpand(
                rerankedHits,
                relationMap,
                factsByIdMap,
                { maxDepth: expansionDepth, maxExpansion: 5 },
              );
              expandedHits = expansion.hits;
            }

            // P1-C: Final boost (Hindsight ce_norm * recency * temporal * proof_count)
            const finalBoostedHits = applyFinalBoost(expandedHits, referenceTime);
            // Stage 5.2 (2026-07-04): multi_hop gets top-15 to address
            // not_retrieved errors. Other categories keep top-10.
            const topK = category === "multi_hop" ? 15 : 10;
            const hybridHits = finalBoostedHits.slice(0, topK);

            let finalHits = hybridHits;
            // Stage 3.3 (2026-07-04): Capture hop answers from self-ask to
            // pass as reasoningHints to the generator. This closes the gap
            // where self-ask computed hop1 answer but discarded it.
            let selfAskHopAnswers: string[] = [];
            const stage2MultihopMode = process.env.P3_MULTIHOP ?? "sequential-self-ask";
            if (
              isMultiHopQuestion(qa.question) &&
              stage2MultihopMode === "sequential-self-ask"
            ) {
              try {
                const selfAsk = await runSequentialSelfAsk({
                  question: qa.question,
                  decompose: decomposeForSelfAsk,
                  answerSubQuestion: async (subQuestion) => {
                    const sqEmbArr = await withRetry(() =>
                      embeddingProvider.embedQuery(subQuestion),
                    );
                    const sqHits = index
                      ? index.searchWithEmbedding(
                          subQuestion,
                          new Float32Array(sqEmbArr),
                          5,
                          OPTIMAL_HYBRID_FUSION,
                        )
                      : [];
                    // Stage 3.3: Strengthened sub-question answerer — forbid
                    // abstention and require a concrete value, so the hop1
                    // answer can be substituted into hop2 as a usable entity.
                    const response = await callTrackedDeepSeek(
                      "Answer the question with a single concise value (entity name, date, or short phrase). " +
                        "Never say 'I don't know' or 'not determinable'. If uncertain, give your best guess. " +
                        "No preamble, no explanation — just the value.",
                      `Question: ${subQuestion}\nContext: ${sqHits
                        .map((hit) => hit.fact.objectSummary)
                        .join("; ")}`,
                      { temperature: 0, maxTokens: 50 },
                    );
                    return { answer: response.content.trim(), evidence: sqHits };
                  },
                  retrieve: async (query) => {
                    const sqEmbArr = await withRetry(() =>
                      embeddingProvider.embedQuery(query),
                    );
                    return index
                      ? index.searchWithEmbedding(
                          query,
                          new Float32Array(sqEmbArr),
                          10,
                          OPTIMAL_HYBRID_FUSION,
                        )
                      : [];
                  },
                  maxHits: 10,
                });
                if (selfAsk.used && selfAsk.finalContext.length > 0) {
                  // S1-2 (2026-07-04): Merge self-ask retrieval as an extra
                  // RRF arm into finalHits (instead of discarding it). Self-ask
                  // hits get RRF score 1/(60+rank) as a 4th arm; main pipeline
                  // hits keep their existing scores. Facts found by BOTH get
                  // boosted; self-ask-only facts get a chance to enter top-K
                  // but won't dominate (lower weight than main pipeline).
                  // Hop answers are still passed as reasoningHints.
                  selfAskHopAnswers = selfAsk.hopAnswers;
                  const selfAskRrfK = 60;
                  const selfAskWeight = 0.5; // half weight: self-ask is semantic-only
                  const existingById = new Map(
                    finalHits.map((h) => [h.fact.factId, h] as const),
                  );
                  // Boost existing hits that also appear in self-ask results.
                  for (let i = 0; i < selfAsk.finalContext.length; i++) {
                    const saHit = selfAsk.finalContext[i];
                    const existing = existingById.get(saHit.fact.factId);
                    if (existing) {
                      existing.rrfScore +=
                        selfAskWeight * (1 / (selfAskRrfK + i + 1));
                    }
                  }
                  // Add self-ask-only hits (not in finalHits) as new candidates.
                  const newHits: typeof finalHits = [];
                  for (let i = 0; i < selfAsk.finalContext.length; i++) {
                    const saHit = selfAsk.finalContext[i];
                    if (!existingById.has(saHit.fact.factId)) {
                      newHits.push({
                        ...saHit,
                        rrfScore:
                          selfAskWeight * (1 / (selfAskRrfK + i + 1)),
                      });
                    }
                  }
                  if (newHits.length > 0) {
                    finalHits = [...finalHits, ...newHits];
                  }
                  // Re-sort by score after merge.
                  finalHits.sort(
                    (a, b) =>
                      (b.ceScore ?? b.rrfScore) - (a.ceScore ?? a.rrfScore),
                  );
                }
              } catch (err) {
                console.log(
                  `[LoCoMo-Full] Sequential self-ask failed, using fragment hits: ${(err as Error).message.slice(0, 80)}`,
                );
              }
            }

            // Phase 3: Self-ask Merge diagnostic — when queryPlan.type is
            // multi_hop, run the new selfAskDecomposeAndMerge path IN
            // PARALLEL with the existing sequential-self-ask path (above).
            // The new path uses precomputed sub-questions from Phase 1 and
            // the modular mergeSelfAskIntoMainHits. This is diagnostic-only:
            // we compute what the merged hits WOULD be, but do NOT replace
            // finalHits. The stats tell us whether Phase 3's modular path
            // produces different/better results than S1-2's inline merge.
            if (queryPlan.type === "multi_hop" && index) {
              try {
                const subQs = queryPlan.subQuestions ?? [qa.question];
                const armWeight = queryPlan.armWeights.selfAsk ?? 0.8;
                const phase3Result = await selfAskDecomposeAndMerge(
                  qa.question,
                  async (subQ) => {
                    const sqEmbArr = await withRetry(() =>
                      embeddingProvider.embedQuery(subQ),
                    );
                    return index
                      ? index.searchWithEmbedding(
                          subQ,
                          new Float32Array(sqEmbArr),
                          10,
                          OPTIMAL_HYBRID_FUSION,
                        )
                      : [];
                  },
                  {
                    precomputedSubQuestions: subQs,
                    armWeight,
                    maxSubQuestions: 3,
                  },
                );

                selfAskMergeStats.triggered += 1;
                selfAskMergeStats.totalSubQuestions += phase3Result.subQuestions.length;
                selfAskMergeStats.totalMergedArmHits += phase3Result.mergedArmHits.length;
                if (!selfAskMergeStats.byCategory[category]) {
                  selfAskMergeStats.byCategory[category] = 0;
                }
                selfAskMergeStats.byCategory[category] += 1;

                // Compute what mergeSelfAskIntoMainHits WOULD do (diagnostic).
                // 实际调用 mergeSelfAskIntoMainHits 验证函数可用性并收集准确统计。
                const mergedHits = mergeSelfAskIntoMainHits(
                  finalHits,
                  phase3Result.mergedArmHits,
                  armWeight,
                );
                const existingIds = new Set(finalHits.map((h) => h.fact.factId));
                const newCandidates = mergedHits.filter(
                  (h) => !existingIds.has(h.fact.factId),
                ).length;
                const boostedExisting = mergedHits.length - newCandidates - finalHits.length;
                selfAskMergeStats.totalBoostedExisting += Math.max(0, boostedExisting);
                selfAskMergeStats.totalNewCandidates += newCandidates;

                if (selfAskMergeStats.samples.length < 20) {
                  selfAskMergeStats.samples.push({
                    questionId,
                    category,
                    subQuestionCount: phase3Result.subQuestions.length,
                    mergedArmHitCount: phase3Result.mergedArmHits.length,
                    boostedExisting,
                    newCandidates,
                  });
                }
              } catch {
                // Phase 3 diagnostic failed — does not affect main pipeline
              }
            }

            // === Phase 7 (P3-A): LLM rerank — Cross-Encoder (pair-wise batch)
            //     Controlled by P3_RERANKER env var: "cross-encoder" (default)
            //     or "none". List-wise Justifier variants are closed because
            //     they measured ~0pp and are explicitly out of scope for Stage 1/2.
            //
            // P3-A Cross-Encoder: scores each fact INDEPENDENTLY in batches of
            // 5, giving each fact the model's full attention (no inter-candidate
            // comparison bias). More precise than list-wise Justifier.
            // Falls back to original RRF order on parse failure or LLM error.
            // Skipped when ≤ 5 candidates (no benefit from reranking small lists).
            const rerankerChoice =
              process.env.P3_RERANKER === "none" ? "none" : "cross-encoder";
            if (rerankerChoice !== "none" && finalHits.length > 5) {
              const candidates: JustifierCandidate[] = finalHits.map((h) => ({
                factId: h.fact.factId,
                subject: h.fact.subject,
                predicate: h.fact.predicate,
                objectSummary: h.fact.objectSummary,
                rrfScore: h.rrfScore,
              }));
              try {
                const rerankResult = await withRetry(() =>
                  rerankWithCrossEncoder(qa.question, candidates, {
                    callLLM: callTrackedDeepSeek,
                  }),
                );
                if (!rerankResult.skipped) {
                  const rerankedCandidates = applyRerank(candidates, rerankResult);
                  const rerankedFactIds = new Set(rerankedCandidates.map((c) => c.factId));
                  // Map back to HybridSearchHit[], preserving any hits not in
                  // the candidate list (shouldn't happen but be safe).
                  const hitById = new Map(finalHits.map((h) => [h.fact.factId, h]));
                  const newOrder: typeof finalHits = [];
                  for (const c of rerankedCandidates) {
                    const hit = hitById.get(c.factId);
                    if (hit) newOrder.push(hit);
                  }
                  // Append any hits that weren't in candidates (defensive)
                  for (const h of finalHits) {
                    if (!rerankedFactIds.has(h.fact.factId)) {
                      newOrder.push(h);
                    }
                  }
                  finalHits = newOrder;
                }
              } catch (err) {
                // Reranker failed entirely — keep original RRF order
                console.log(
                  `[LoCoMo-Full] ${rerankerChoice} rerank failed for Q${item.qa.question.slice(0, 40)}: ${(err as Error).message.slice(0, 80)}`,
                );
              }
            }

            let retrievedFacts = finalHits.map((h) => h.fact);

            // === Agent Multi-Round Retrieval (Hindsight alignment, 2026-07-07) ===
            // Final round: maxRounds=5, 3-signal expansion (semantic kNN + entity + causal),
            // and broadened trigger (all non-temporal questions, not just classified multi_hop).
            // This bypasses the 53% classifier misclassification rate — instead of relying
            // on a pre-classification that misses 51/96 multi_hop questions, the agent itself
            // decides whether multi-round retrieval is needed based on evidence sufficiency.
            //
            // Hindsight alignment:
            // - maxRounds=5 (Hindsight uses 10, but we trade depth for cost)
            // - 3-signal additive fusion: tanh(entity*0.5) + semantic_sim + causal_weight
            // - Semantic kNN graph precomputed from fact embeddings (top-5, sim >= 0.7)
            // - Causal relations extracted from fact relation fields
            const agentTrigger =
              process.env.ENABLE_AGENT_RETRIEVAL === "1" &&
              index &&
              category !== "temporal";
            if (agentTrigger) {
              try {
                const existingFactIds = new Set(retrievedFacts.map((f) => f.factId));
                const convFacts = factsByConversation.get(conversationId) ?? [];
                const factsByIdMap = new Map(
                  convFacts.map((f) => [f.factId, f] as const),
                );

                // Use cached semantic kNN graph (built once per conversation).
                const semanticKnn = knnGraphByConversation.get(conversationId);

                // Build causal relation map from fact relations.
                const causalRelations = new Map<string, Array<{ factId: string; weight: number }>>();
                for (const f of convFacts) {
                  const relations = (f as Record<string, unknown>).relations as
                    | Array<{ targetFactId: string; relationType: string; confidence?: number }>
                    | undefined;
                  if (relations && relations.length > 0) {
                    const causal = relations
                      .filter((r) =>
                        ["causes", "caused_by", "enables", "prevents"].includes(r.relationType),
                      )
                      .map((r) => ({
                        factId: r.targetFactId,
                        weight: r.confidence ?? 1.0,
                      }));
                    if (causal.length > 0) {
                      causalRelations.set(f.factId, causal);
                    }
                  }
                }

                // Build entity relation map (already exists as buildEntityRelationMap).
                const entityRelations = buildEntityRelationMap(convFacts);

                // AgentRetrievalFact map for expansion lookups.
                const agentFactsById = new Map<string, AgentRetrievalFact>();
                for (const f of convFacts) {
                  agentFactsById.set(f.factId, {
                    factId: f.factId,
                    objectSummary: f.objectSummary,
                    subject: f.subject,
                    confidence: f.confidence,
                  });
                }

                const expansionMaps: AgentRetrievalExpansionMaps = {
                  semanticKnn,
                  entityRelations,
                  causalRelations,
                  factsById: agentFactsById,
                };

                const agentResult = await runAgentRetrieval(
                  qa.question,
                  async (query, topK) => {
                    const sqEmbArr = await withRetry(() =>
                      embeddingProvider.embedQuery(query),
                    );
                    const sqHits = index.searchWithEmbedding(
                      query,
                      new Float32Array(sqEmbArr),
                      topK,
                      OPTIMAL_HYBRID_FUSION,
                    );
                    return sqHits.map((hit) => ({
                      factId: hit.fact.factId,
                      objectSummary: hit.fact.objectSummary,
                      subject: hit.fact.subject,
                      confidence: hit.fact.confidence,
                    }));
                  },
                  {
                    maxRounds: 5,
                    maxFacts: 15,
                    maxFactsPerRound: 10,
                    category,
                    expansionMaps,
                  },
                );
                // Merge agent-discovered facts into retrievedFacts.
                for (const agentFact of agentResult.facts) {
                  if (!existingFactIds.has(agentFact.factId)) {
                    const fullFact = factsByIdMap.get(agentFact.factId);
                    if (fullFact) {
                      retrievedFacts.push(fullFact);
                      existingFactIds.add(agentFact.factId);
                    }
                  }
                }
              } catch (err) {
                console.log(
                  `[LoCoMo-Full] Agent retrieval failed: ${(err as Error).message.slice(0, 80)}`,
                );
              }
            }

            // === Phase 5 (P0): Episodic Track search ===
            // Run episodic search in parallel conceptually with the semantic
            // retrieval above. We reuse the same query embedding (Qwen3-Embedding-8B)
            // for both tracks to save an API call — both indices use the same
            // embedding space, so the query vector is shared.
            //
            // Episodic track retrieves raw conversation sentences and expands
            // ±CONTEXT_WINDOW sentences for context. This is the "ground-truth
            // preserving" path that recovers the ~53% information lost during
            // LLM fact extraction.
            const episodic = episodicByConversation.get(conversationId);
            let episodicContext = "";
            let cachedEpisodicHits: RetrievalCache["episodicHits"] = [];
            if (episodic && episodic.size > 0) {
              // P2-4: Pass query time constraint as maxTimestamp to avoid
              // retrieving sentences said AFTER the queried time point.
              // For "five years ago" → maxTimestamp = anchor - 5y, so we
              // only see sentences up to that point. This is the "time as
              // independent retrieval path" mechanism.
              const episodicTimeFilter =
                queryTimeConstraint.referenceTime !== undefined
                  ? { maxTimestamp: queryTimeConstraint.referenceTime }
                  : undefined;
              // Stage 5.4: episodic topK=25 (was 15) to address not_retrieved
              // errors — wider episodic recall for multi_hop and single_hop.
              const episodicHits = await episodic.search(
                qa.question,
                new Float32Array(queryEmbArr),
                25,
                episodicTimeFilter,
              );
              cachedEpisodicHits = episodicHits.map((hit) => ({
                sentenceId: hit.sentence.sentence_id,
                turnId: hit.sentence.turn_id,
                sessionId: hit.sentence.session_id,
                rrfScore: hit.rrfScore,
              }));
              if (episodicHits.length > 0) {
                const clusters = episodic.contextualize(episodicHits);
                episodicContext = formatEpisodicBlock(clusters);
              }
            }

            const assembledContext = assembleGeneratorContext(
              episodicContext,
              retrievedFacts,
              profileContext,
            );

            let rawAnswer = await withRetry(() =>
              generateDualTrackAnswer(
                qa.question,
                category,
                episodicContext,
                retrievedFacts,
                profileContext,
                {
                  allowInternalAbstention: true,
                  reasoningHints: selfAskHopAnswers,
                },
              ),
            );
            let strippedAnswer = stripEvidenceInsufficientSignal(rawAnswer);
            let escalationLevel: EscalationLevel = 0;
            let finalAssembledContext = assembledContext;
            const escalationAttempts = [
              { level: 0 as EscalationLevel, context: assembledContext, rawAnswer },
            ];

            if (strippedAnswer.insufficient && escalationBudget.tryUse()) {
              const sessionIndex = sessionSummaryByConversation.get(conversationId);
              const sessionHits = sessionIndex
                ? await sessionIndex.search(
                    qa.question,
                    new Float32Array(queryEmbArr),
                    2,
                  )
                : [];
              const sessionContext = sessionHits.map((hit) => hit.rawText).join("\n\n");
              const level1Episodic = `${sessionContext}\n\n${episodicContext}`.trim();
              rawAnswer = await withRetry(() =>
                generateDualTrackAnswer(
                  qa.question,
                  category,
                  level1Episodic,
                  retrievedFacts,
                  profileContext,
                  { allowInternalAbstention: true },
                ),
              );
              strippedAnswer = stripEvidenceInsufficientSignal(rawAnswer);
              escalationLevel = 1;
              finalAssembledContext = assembleGeneratorContext(
                level1Episodic,
                retrievedFacts,
                profileContext,
              );
              escalationAttempts.push({
                level: 1,
                context: finalAssembledContext,
                rawAnswer,
              });
            }

            if (strippedAnswer.insufficient && fullConversationBudget.tryUse()) {
              const fullConversation =
                fullConversationTextByConversation.get(conversationId) ?? "";
              rawAnswer = await withRetry(() =>
                generateDualTrackAnswer(
                  qa.question,
                  category,
                  fullConversation,
                  [],
                  undefined,
                  { allowInternalAbstention: false },
                ),
              );
              strippedAnswer = stripEvidenceInsufficientSignal(rawAnswer);
              escalationLevel = 2;
              finalAssembledContext = fullConversation;
              escalationAttempts.push({
                level: 2,
                context: fullConversation,
                rawAnswer,
              });
            }

            // Stage 4: Reflect Agent — critique + re-retrieve + regenerate.
            // Same integration as dev-slice path; index is always available
            // in full-500 mode (needsRetrieval=true builds all indexes).
            let reflectFinalAnswer = strippedAnswer.answer;
            if (reflectEnabled) {
              const indexForReflect = indexByConversation.get(conversationId);
              const embeddingProviderForReflect = embeddingProvider;
              const reflectResult = await runReflectAgent({
                question: qa.question,
                category,
                initialAnswer: strippedAnswer.answer,
                context: finalAssembledContext,
                callLLM: callTrackedDeepSeek,
                retrieve: indexForReflect && embeddingProviderForReflect
                  ? async (query: string) => {
                      const emb = await withRetry(() =>
                        embeddingProviderForReflect.embedQuery(query),
                      );
                      const hits = indexForReflect.searchWithEmbedding(
                        query,
                        new Float32Array(emb),
                        10,
                        OPTIMAL_HYBRID_FUSION,
                      );
                      return hits.map((h) => h.fact);
                    }
                  : undefined,
                regenerateWithContext: async (expandedContext: string) => {
                  const regen = await withRetry(() =>
                    generateDualTrackAnswer(
                      qa.question,
                      category,
                      expandedContext,
                      retrievedFacts,
                      profileContext,
                      {},
                    ),
                  );
                  return regen;
                },
                budget: reflectBudget,
                extractFinalAnswer,
              });
              if (reflectResult.used) {
                reflectUsedCount += 1;
                if (reflectResult.reRetrieved) {
                  reflectReRetrieveCount += 1;
                } else {
                  reflectRegenerateCount += 1;
                }
                reflectFinalAnswer = reflectResult.finalAnswer;
              } else if (reflectResult.skipped) {
                reflectSkippedCount += 1;
              } else if (reflectResult.reverted) {
                reflectRevertedCount += 1;
              }
              reflectResults.push(reflectResult);
            }

            const predictedAnswer = extractFinalAnswer(reflectFinalAnswer);
            escalationResults.push({
              answer: predictedAnswer,
              rawAnswer,
              escalationLevel,
              attempts: escalationAttempts,
            });

            // 3. LLM-as-Judge
            const judgeScore = await withRetry(() =>
              judgeAnswer(qa.question, answerStr, predictedAnswer),
            );

            // Phase 4: Unified Judge diagnostic (fresh path)
            try {
              const judgeCategory: JudgeCategory = (category as JudgeCategory) ?? "single_hop";
              const unifiedResult = await judgeWithUnifiedPrompt(
                qa.question,
                answerStr,
                predictedAnswer,
                judgeCategory,
              );
              unifiedJudgeStats.total += 1;
              if (!unifiedJudgeStats.byCategory[category]) {
                unifiedJudgeStats.byCategory[category] = { correct: 0, wrong: 0 };
              }
              if (unifiedResult.verdict === "CORRECT") {
                unifiedJudgeStats.byCategory[category].correct += 1;
              } else {
                unifiedJudgeStats.byCategory[category].wrong += 1;
              }
              unifiedJudgeStats.unifiedResults.push(unifiedResult);
              unifiedJudgeStats.frozenResults.push({ score: judgeScore });
              if (unifiedJudgeStats.samples.length < 20) {
                unifiedJudgeStats.samples.push({
                  questionId,
                  category,
                  frozenVerdict: judgeScore,
                  unifiedVerdict: unifiedResult.verdict,
                  confidence: unifiedResult.confidence,
                  ...(unifiedResult.voteBreakdown ? { voteBreakdown: unifiedResult.voteBreakdown } : {}),
                });
              }
            } catch {
              // Phase 4 diagnostic failed — does not affect main pipeline
            }

            const recall5 = computeLegacyRecall(answerStr, retrievedFacts);
            const contextRecall = computeContextRecall(
              finalAssembledContext,
              qa.evidence ?? [],
            );

            if (judgeScore === 0) {
              const taxonomy = await classifyErrorTaxonomy(
                {
                  question: qa.question,
                  assembledContext: finalAssembledContext,
                  predictedAnswer,
                  groundTruth: answerStr,
                  judgeScore,
                },
                callTrackedDeepSeek,
              );
              if (taxonomy) {
                taxonomyResults.push({
                  category,
                  ...taxonomy,
                  question: qa.question,
                  assembledContext: finalAssembledContext,
                  predictedAnswer,
                  groundTruth: answerStr,
                  judgeScore,
                });
              }
            }

            if (!fullEval && !cachedQuestion) {
              devSliceCacheWrites.push({
                questionId,
                category,
                conversationId,
                question: qa.question,
                groundTruth: answerStr,
                goldEvidence: qa.evidence ?? [],
                retrievalCache: {
                  queryEmbedding: Array.from(queryEmbArr),
                  semanticFactIds: retrievedFacts.map((fact) => fact.factId),
                  semanticFacts: retrievedFacts.map((fact) => ({
                    factId: fact.factId,
                    subject: fact.subject,
                    predicate: fact.predicate,
                    objectSummary: fact.objectSummary,
                    validAt: fact.valid_at,
                  })),
                  hybridHits: finalHits.map((hit) => ({
                    factId: hit.fact.factId,
                    rrfScore: hit.rrfScore,
                    bm25Rank: hit.bm25Rank,
                    vectorRank: hit.vectorRank,
                    entityRank: hit.entityRank,
                    bm25Score: hit.bm25Score,
                    vectorScore: hit.vectorScore,
                    entityScore: hit.entityScore,
                  })),
                  episodicHits: cachedEpisodicHits,
                  episodicContext,
                  profileContext: profileContext ?? [],
                  assembledContext,
                },
              });
            }

            // Phase 2: Feedback Loop diagnostic — compute initial completeness
            // and (if INSUFFICIENT/PARTIAL) generate a rewritten query for
            // stats. Does NOT replace the actual retrieval result.
            {
              const goldEv = qa.evidence ?? [];
              const initial = computeContextCompletenessDeterministic(
                finalAssembledContext,
                goldEv,
              );
              feedbackLoopStats.initialByLevel[initial.level] += 1;
              if (!feedbackLoopStats.byCategory[category]) {
                feedbackLoopStats.byCategory[category] = {
                  COMPLETE: 0, PARTIAL: 0, INSUFFICIENT: 0,
                };
              }
              feedbackLoopStats.byCategory[category][initial.level] += 1;
              if (initial.level !== "COMPLETE") {
                feedbackLoopStats.wouldTrigger += 1;
                feedbackLoopStats.totalMissingEvidence += initial.missingEvidence.length;
                try {
                  const rewritten = await rewriteQueryForRetrieval(
                    qa.question,
                    initial.missingEvidence,
                    queryPlan,
                  );
                  feedbackLoopStats.rewritesGenerated += 1;
                  if (feedbackLoopStats.rewriteSamples.length < 20) {
                    feedbackLoopStats.rewriteSamples.push({
                      questionId,
                      category,
                      queryType: queryPlan.type,
                      original: qa.question,
                      rewritten,
                      missingCount: initial.missingEvidence.length,
                    });
                  }
                } catch {
                  // rewrite failed — still count as would-trigger
                }
              }
            }
            return {
              questionId,
              category,
              conversationId,
              question: qa.question,
              goldEvidence: qa.evidence ?? [],
              recall5,
              contextRecall,
              judgeScore,
              escalationLevel,
              predictedAnswer,
              groundTruth: answerStr,
              assembledContext: finalAssembledContext,
            };
          } catch (err) {
            console.log(`[LoCoMo-Full] Q${qIdx} failed after retries: ${(err as Error).message}`);
            return {
              questionId,
              category,
              conversationId,
              question: qa.question,
              goldEvidence: qa.evidence ?? [],
              recall5: 0,
              contextRecall: 0,
              judgeScore: 0,
              escalationLevel: 0,
              predictedAnswer: "[ERROR]",
              groundTruth: answerStr,
              assembledContext: "",
            };
          }
        };

        for (let i = 0; i < sampled.length; i += BATCH_SIZE) {
          const batch = sampled.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map((item, bIdx) => processQuestion(item, i + bIdx)),
          );

          for (const r of batchResults) {
            totalCorrect += r.judgeScore;
            totalRecall += r.recall5;
            totalContextRecall += r.contextRecall;
            if (!byCategory[r.category]) {
              byCategory[r.category] = {
                correct: 0,
                total: 0,
                recallSum: 0,
                contextRecallSum: 0,
              };
            }
            byCategory[r.category].correct += r.judgeScore;
            byCategory[r.category].total += 1;
            byCategory[r.category].recallSum += r.recall5;
            byCategory[r.category].contextRecallSum += r.contextRecall;
            results.push(r);
          }

          const completed = i + batch.length;
          if (completed % 10 === 0 || completed === sampled.length || completed < 10) {
            const runningJ = ((totalCorrect / completed) * 100).toFixed(1);
            console.log(
              `[LoCoMo-Full] Progress: ${completed}/${sampled.length} | J=${runningJ}% | ` +
                `Recall@5=${((totalRecall / completed) * 100).toFixed(1)}% | ` +
                `ContextRecall=${((totalContextRecall / completed) * 100).toFixed(1)}%`,
            );
          }

          // Small delay between batches to avoid network pressure
          await new Promise((r) => setTimeout(r, 500));
        }

        // Compute final metrics
        const totalQuestions = sampled.length;
        const overallJ = totalCorrect / totalQuestions;
        const overallRecall = totalRecall / totalQuestions;
        const overallContextRecall = totalContextRecall / totalQuestions;

        const categoryMetrics: Record<
          string,
          { j_score: number; recall_at_5: number; context_recall: number; count: number }
        > = {};
        for (const [cat, m] of Object.entries(byCategory)) {
          categoryMetrics[cat] = {
            j_score: m.correct / m.total,
            recall_at_5: m.recallSum / m.total,
            context_recall: m.contextRecallSum / m.total,
            count: m.total,
          };
        }

        // P0-OPT: don't write dev-slice cache in smoke mode (only 20q) or full mode.
        if (!fullEval && !smoke && !cachedDevSlice) {
          writeDevSliceCache(devSliceCacheWrites);
          console.log(
            `[LoCoMo-Full] Dev-slice retrieval cache written: ${devSliceCacheWrites.length} questions -> ${DEV_SLICE_CACHE_PATH}`,
          );
        }

        const escalationStats = summarizeEscalationStats(
          escalationResults,
          escalationBudget,
          fullConversationBudget,
        );
        const errorTaxonomy = aggregateErrorTaxonomy(taxonomyResults);
        const costEstimateUsd = estimateDeepSeekCostUsd();
        const projectedFullRunCostEstimateUsd =
          totalQuestions > 0 ? costEstimateUsd * (500 / totalQuestions) : costEstimateUsd;

        // Build report
        const report = {
          dataset: "locomo",
          version: fullEval
            ? "10.0-stage2-adaptive-retrieval"
            : "10.0-stage2-adaptive-retrieval-dev-slice",
          totalQuestions,
          retrievalModeStage2:
            "Stage 2 adaptive retrieval: dual-track episodic+semantic fragments, session-summary retrieval for top-2 whole-session escalation, full-conversation fallback, and sequential self-ask for multi-hop. Default dev-slice mode uses cached retrieval when artifacts/runtime-memory-eval/dev-slice-cache.json is valid; FULL_EVAL=1 or --full runs the full sample.",
          retrievalMode:
            "Stage 2 adaptive retrieval: dual-track episodic+semantic fragments, session-summary retrieval for top-2 whole-session escalation, full-conversation fallback, and sequential self-ask for multi-hop. Qwen3-Embedding-8B (SiliconFlow). Default dev-slice mode uses cached retrieval when artifacts/runtime-memory-eval/dev-slice-cache.json is valid; FULL_EVAL=1 or --full runs the full sample.",
          judgeModel: `${FROZEN_JUDGE_CONFIG.model} (${FROZEN_JUDGE_CONFIG.promptVersion})`,
          judgeConfig: FROZEN_JUDGE_CONFIG,
          metric: "J Score (frozen LLM-as-Judge accuracy) with context-recall as primary steering metric",
          adversarialExcluded: true,
          sampleSizes: fullEval ? SAMPLE_SIZES : DEV_SLICE_SAMPLE_SIZES,
          sampleSeed: fullEval ? SAMPLE_SEED : DEV_SLICE_SAMPLE_SEED,
          metrics: {
            overall: {
              j_score: overallJ,
              recall_at_5: overallRecall,
              context_recall: overallContextRecall,
              escalation_rate: escalationStats.escalationRate,
              full_conversation_rate: escalationStats.fullConversationRate,
              cost_per_run_estimate_usd: costEstimateUsd,
              projected_full_run_cost_estimate_usd: projectedFullRunCostEstimateUsd,
            },
            byCategory: categoryMetrics,
          },
          errorTaxonomy,
          escalation: escalationStats,
          queryClassifier: queryClassifierStats,
          feedbackLoop: feedbackLoopStats,
          selfAskMerge: selfAskMergeStats,
          unifiedJudge: {
            ...unifiedJudgeStats,
            comparison: compareJudgeResults(
              unifiedJudgeStats.unifiedResults,
              unifiedJudgeStats.frozenResults,
            ),
            config: {
              promptVersion: UNIFIED_JUDGE_CONFIG.promptVersion,
              votingEnabled: UNIFIED_JUDGE_CONFIG.votingEnabled,
              voteCount: UNIFIED_JUDGE_CONFIG.voteCount,
              voteAgreementThreshold: UNIFIED_JUDGE_CONFIG.voteAgreementThreshold,
            },
          },
          reflectAgent: {
            enabled: reflectEnabled,
            reflectUsedCount,
            reflectReRetrieveCount,
            reflectRegenerateCount,
            reflectSkippedCount,
            reflectRevertedCount,
            reflectBudget: reflectBudget.stats,
          },
          extraction: summarizeExtractionTelemetry(),
          cost: {
            deepSeekUsage,
            estimateUsd: costEstimateUsd,
            projectedFullRunEstimateUsd: projectedFullRunCostEstimateUsd,
          },
          completeness: (() => {
            const completenessResults = results.map((r) => {
              const cr = computeContextCompletenessDeterministic(
                r.assembledContext,
                r.goldEvidence,
              );
              return { level: cr.level, category: r.category };
            });
            return aggregateCompleteness(completenessResults);
          })(),
          comparison: {
            // From Hindsight paper Table 4 (arXiv:2512.12818)
            Backboard: { j_score: 0.9 },
            Hindsight_Gemini3: { j_score: 0.8961 },
            Hindsight_OSS120B: { j_score: 0.8567 },
            Hindsight_OSS20B: { j_score: 0.8318 },
            Memobase: { j_score: 0.7578 },
            Zep: { j_score: 0.7514 },
            Mem0_Graph: { j_score: 0.6844 },
            Mem0: { j_score: 0.6688 },
            LangMem: { j_score: 0.581 },
            OpenAI_no_memory: { j_score: 0.529 },
            ours: { j_score: overallJ },
          },
          sampleResults: [
            ...results.filter((result) => result.category === "single_hop").slice(0, 5),
            ...results.filter((result) => result.category === "temporal").slice(0, 5),
            ...results.filter((result) => result.category === "multi_hop").slice(0, 5),
            ...results.filter((result) => result.category === "open_domain").slice(0, 5),
          ],
          judgeSanityCandidates: results
            .filter((result) => result.judgeScore === 0)
            .slice(0, 50)
            .map((result) => ({
              questionId: result.questionId,
              category: result.category,
              conversationId: result.conversationId,
              question: result.question,
              groundTruth: result.groundTruth,
              predictedAnswer: result.predictedAnswer,
              judgeScore: result.judgeScore,
            })),
          generatedAt: new Date().toISOString(),
        };
        assertLocomoStageReportShape(report);

        // Write report
        const artifactDir = join(
          process.cwd(),
          "artifacts",
          "runtime-memory-eval",
        );
        try {
          mkdirSync(artifactDir, { recursive: true });
          writeFileSync(
            join(artifactDir, "locomo-full-500-report.json"),
            JSON.stringify(report, null, 2) + "\n",
            "utf-8",
          );
        } catch {
          // ignore write errors
        }

        // P0-OPT: flush judge cache and report hit rate.
        const cache = getJudgeCache();
        cache.flush();
        // Stage 5.7: flush self-ask cache
        getSelfAskCache().flush();
        const judgeTotal = judgeCacheHits + judgeCacheMisses;
        const judgeHitRate = judgeTotal > 0 ? (judgeCacheHits / judgeTotal) * 100 : 0;
        const embedStats = getEmbeddingCacheStats();
        const embedTotal = embedStats.hits + embedStats.misses;
        const embedHitRate = embedTotal > 0 ? (embedStats.hits / embedTotal) * 100 : 0;

        // Print summary
        console.log("\n[LoCoMo-Full] ===== FINAL RESULTS =====");
        console.log(`[LoCoMo-Full] Total questions: ${totalQuestions}`);
        console.log(
          `[LoCoMo-Full] Overall J Score: ${(overallJ * 100).toFixed(2)}%`,
        );
        console.log(
          `[LoCoMo-Full] Overall Recall@5: ${(overallRecall * 100).toFixed(2)}%`,
        );
        console.log(
          `[LoCoMo-Full] Overall ContextRecall: ${(overallContextRecall * 100).toFixed(2)}%`,
        );
        console.log(
          `[LoCoMo-Full] Escalation rate: ${(escalationStats.escalationRate * 100).toFixed(2)}%`,
        );
        console.log(
          `[LoCoMo-Full] Full conversation rate: ${(escalationStats.fullConversationRate * 100).toFixed(2)}% ` +
            `(cap=${escalationStats.maxFullConversationEscalations}/${totalQuestions}, capped=${escalationStats.fullConversationCapped})`,
        );
        if (reflectEnabled) {
          console.log(
            `[LoCoMo-Full] Reflect Agent: used=${reflectUsedCount}/${totalQuestions} ` +
              `(reRetrieve=${reflectReRetrieveCount}, regenerate=${reflectRegenerateCount}, ` +
              `skipped=${reflectSkippedCount}, reverted=${reflectRevertedCount}, ` +
              `budget=${reflectBudget.stats.reRetrieveUsed}/${reflectBudget.stats.maxReRetrieve})`,
          );
        }
        console.log(
          `[LoCoMo-Full] Estimated DeepSeek cost: $${costEstimateUsd.toFixed(4)} ` +
            `(projected full run: $${projectedFullRunCostEstimateUsd.toFixed(4)})`,
        );
        console.log(
          `[LoCoMo-Full] Judge cache: ${judgeCacheHits}/${judgeTotal} hits (${judgeHitRate.toFixed(1)}%), ` +
            `${cache.size} entries on disk`,
        );
        const selfAskStats = getSelfAskCache().stats;
        console.log(
          `[LoCoMo-Full] Self-ask cache: ${selfAskStats.hits}/${selfAskStats.total} hits (${(selfAskStats.hitRate * 100).toFixed(1)}%), ` +
            `${getSelfAskCache().size} entries on disk`,
        );
        console.log(
          `[LoCoMo-Full] Embedding cache: ${embedStats.hits}/${embedTotal} hits (${embedHitRate.toFixed(1)}%), ` +
            `${embedStats.apiCalls} API calls (${embedStats.apiBatchSize} embeddings)`,
        );
        console.log("[LoCoMo-Full] By category:");
        for (const [cat, m] of Object.entries(categoryMetrics)) {
          console.log(
            `  ${cat}: J=${(m.j_score * 100).toFixed(2)}% (n=${m.count})`,
          );
        }
        // Completeness breakdown (Zep-aligned diagnostic)
        if (report.completeness) {
          const c = report.completeness.overall;
          const total = c.COMPLETE + c.PARTIAL + c.INSUFFICIENT;
          if (total > 0) {
            console.log("[LoCoMo-Full] Context completeness:");
            console.log(
              `  COMPLETE: ${c.COMPLETE} (${((c.COMPLETE / total) * 100).toFixed(1)}%)`,
            );
            console.log(
              `  PARTIAL: ${c.PARTIAL} (${((c.PARTIAL / total) * 100).toFixed(1)}%)`,
            );
            console.log(
              `  INSUFFICIENT: ${c.INSUFFICIENT} (${((c.INSUFFICIENT / total) * 100).toFixed(1)}%)`,
            );
            for (const [cat, cc] of Object.entries(report.completeness.byCategory)) {
              const catTotal = cc.COMPLETE + cc.PARTIAL + cc.INSUFFICIENT;
              if (catTotal > 0) {
                console.log(
                  `  ${cat}: INSUFFICIENT=${((cc.INSUFFICIENT / catTotal) * 100).toFixed(1)}% (n=${catTotal})`,
                );
              }
            }
          }
        }
        console.log("[LoCoMo-Full] Comparison (J Score):");
        for (const [sys, score] of Object.entries(report.comparison)) {
          const pct = (score.j_score * 100).toFixed(2);
          const marker = sys === "ours" ? " <---" : "";
          console.log(`  ${sys}: ${pct}%${marker}`);
        }
        // Phase 2: Feedback Loop diagnostic summary
        {
          const fb = feedbackLoopStats;
          const total = fb.initialByLevel.COMPLETE + fb.initialByLevel.PARTIAL + fb.initialByLevel.INSUFFICIENT;
          if (total > 0) {
            console.log("[LoCoMo-Full] Phase 2 Feedback Loop (diagnostic):");
            console.log(
              `  Would trigger: ${fb.wouldTrigger}/${total} (${((fb.wouldTrigger / total) * 100).toFixed(1)}%)`,
            );
            console.log(
              `  Rewrites generated: ${fb.rewritesGenerated}, total missing evidence: ${fb.totalMissingEvidence}`,
            );
            console.log(
              `  Initial: COMPLETE=${fb.initialByLevel.COMPLETE} PARTIAL=${fb.initialByLevel.PARTIAL} INSUFFICIENT=${fb.initialByLevel.INSUFFICIENT}`,
            );
            for (const [cat, cc] of Object.entries(fb.byCategory)) {
              const catTotal = cc.COMPLETE + cc.PARTIAL + cc.INSUFFICIENT;
              if (catTotal > 0) {
                console.log(
                  `  ${cat}: trigger=${((1 - cc.COMPLETE / catTotal) * 100).toFixed(1)}% (n=${catTotal})`,
                );
              }
            }
            if (fb.rewriteSamples.length > 0) {
              console.log("  Rewrite samples (first 3):");
              for (const sample of fb.rewriteSamples.slice(0, 3)) {
                console.log(
                  `    [${sample.category}/${sample.queryType}] ${sample.original.slice(0, 60)} → ${sample.rewritten.slice(0, 60)}`,
                );
              }
            }
          }
        }
        // Phase 3: Self-ask Merge diagnostic summary
        {
          const sa = selfAskMergeStats;
          if (sa.triggered > 0) {
            console.log("[LoCoMo-Full] Phase 3 Self-ask Merge (diagnostic):");
            console.log(`  Triggered: ${sa.triggered} (multi_hop queries)`);
            console.log(
              `  Total sub-questions: ${sa.totalSubQuestions}, merged arm hits: ${sa.totalMergedArmHits}`,
            );
            console.log(
              `  Boosted existing: ${sa.totalBoostedExisting}, new candidates: ${sa.totalNewCandidates}`,
            );
            console.log(`  armWeight: ${sa.armWeight}`);
            for (const [cat, count] of Object.entries(sa.byCategory)) {
              console.log(`  ${cat}: triggered=${count}`);
            }
            if (sa.samples.length > 0) {
              console.log("  Samples (first 3):");
              for (const sample of sa.samples.slice(0, 3)) {
                console.log(
                  `    [${sample.category}] subQs=${sample.subQuestionCount} armHits=${sample.mergedArmHitCount} boosted=${sample.boostedExisting} new=${sample.newCandidates}`,
                );
              }
            }
          }
        }
        // Phase 4: Unified Judge diagnostic summary
        {
          const uj = unifiedJudgeStats;
          if (uj.total > 0) {
            const cmp = compareJudgeResults(uj.unifiedResults, uj.frozenResults);
            console.log("[LoCoMo-Full] Phase 4 Unified Judge (diagnostic):");
            console.log(`  Total judged: ${uj.total}`);
            console.log(
              `  Agreement with frozen: ${(cmp.agreementRate * 100).toFixed(1)}% (${uj.total - cmp.unifiedMoreGenerous - cmp.unifiedMoreStrict}/${uj.total})`,
            );
            console.log(
              `  Unified more generous: ${cmp.unifiedMoreGenerous}, more strict: ${cmp.unifiedMoreStrict}`,
            );
            console.log(
              `  Voting: ${UNIFIED_JUDGE_CONFIG.votingEnabled ? `enabled (${UNIFIED_JUDGE_CONFIG.voteCount} votes, ≥${UNIFIED_JUDGE_CONFIG.voteAgreementThreshold})` : "disabled"}`,
            );
            for (const [cat, cc] of Object.entries(uj.byCategory)) {
              const catTotal = cc.correct + cc.wrong;
              if (catTotal > 0) {
                console.log(
                  `  ${cat}: unified CORRECT=${cc.correct}/${catTotal} (${((cc.correct / catTotal) * 100).toFixed(1)}%)`,
                );
              }
            }
            if (uj.samples.length > 0) {
              console.log("  Disagreement samples (first 3):");
              const disagreements = uj.samples.filter(
                (s) => (s.frozenVerdict === 1) !== (s.unifiedVerdict === "CORRECT"),
              );
              for (const sample of disagreements.slice(0, 3)) {
                console.log(
                  `    [${sample.category}] frozen=${sample.frozenVerdict === 1 ? "CORRECT" : "WRONG"} unified=${sample.unifiedVerdict} conf=${sample.confidence.toFixed(2)}`,
                );
              }
            }
          }
        }

        expect(totalQuestions).toBeGreaterThan(0);
        expect(overallJ).toBeGreaterThan(0);
      },
      129_600_000, // 36h timeout for v4-flash reasoning model (extraction ~10h + gen/judge ~25h)
    );
  },
);
