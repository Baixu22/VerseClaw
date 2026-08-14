import { createHash } from "node:crypto";
import type {
  PutReceiptInput,
  PutReceiptResult,
  ReceiptIdentity,
} from "../agents/receipt-store.js";

/**
 * KE-P1-2: shadow retrieval broker (v1). Records would_retrieve candidates
 * into a shadow_context receipt + retrieved_at events. Zero model-input
 * injection: this module has no injection surface — its output is receipts
 * and events only, so the provider-visible prompt bytes are untouched.
 *
 * Flag-gated, default off. When off => zero retrieval, zero receipt, zero write.
 */

export const KE_RETRIEVAL_SHADOW_SCHEMA = "KeRetrievalShadow/v1" as const;

export type KeBrokerSignalName =
  | "lexical"
  | "tags"
  | "error_signature"
  | "temporal"
  | "quality";

export type KeBrokerSignal = {
  name: KeBrokerSignalName;
  /** Normalized 0..1 signal score. */
  score: number;
  /** Anchor to the real evidence source that produced this signal. */
  sourceRef: string;
};

export type KeRetrievalCandidate = {
  envelopeId: string;
  /** Canonical content digest (sha256:...). */
  contentVersion: string;
  /** Searchable text (title/condition/action/reason/full content). */
  text: string;
  tags: string[];
  errorSignature?: string;
  /** Captured-at timestamp (ms) for the temporal signal. */
  capturedAt?: number;
  quality: { criticality: "low" | "medium" | "high" | "critical"; pinned: boolean };
};

export type KeWouldRetrieve = {
  envelopeId: string;
  contentVersion: string;
  /** 1-based rank within the candidate set. */
  rank: number;
  /** Weighted, frozen signal score, normalized 0..1. */
  calibratedScore: number;
  /** How well the candidate packs into the context budget (0..1). */
  packingScore: number;
  /** Bounded explanation payload (no raw body). */
  explanation: string;
  signals: KeBrokerSignal[];
  /** Shadow never presents; always false. */
  selectedForPresentation: false;
};

export type KeRetrievedAtEvent = {
  schemaVersion: 1;
  attributionId: string;
  envelopeId: string;
  authority: { family: string; id: string; contentVersion: string };
  taskId: string;
  runId?: string;
  sessionKey?: string;
  traceId?: string;
  configDigest: string;
  taskType: string;
  arm: "shadow";
  evidenceRefs: string[];
  queryDigest: string;
  rank: number;
  score: number;
  retrievalReason: string;
  candidateSetDigest: string;
  selectedForPresentation: false;
};

export type KeRetrievalShadowContext = {
  taskId: string;
  taskType: string;
  runId?: string;
  sessionKey?: string;
  traceId?: string;
  configDigest: string;
  /** Query error signature, when the retrieval is error-driven. */
  errorSignature?: string;
  /** Context tags carried into the retrieval query. */
  contextTags: string[];
  /** Token budget the candidate must pack into (for packingScore). */
  tokenBudget?: number;
  /** Frozen signal weights. KE-P3-2 owns weight learning; these are frozen. */
  weights?: Partial<Record<KeBrokerSignalName, number>>;
  now?: number;
};

export type KeRetrievalShadowResult = {
  enabled: boolean;
  disabledReason?: "flag_disabled";
  wouldRetrieve: KeWouldRetrieve[];
  retrievedAtEvents: KeRetrievedAtEvent[];
  /** shadow_context receipt covering every would_retrieve candidate (refs only). */
  receipt: PutReceiptInput | null;
};

const DEFAULT_WEIGHTS: Record<KeBrokerSignalName, number> = {
  lexical: 0.4,
  tags: 0.2,
  error_signature: 0.15,
  temporal: 0.1,
  quality: 0.15,
};

const CRITICALITY_SCORE: Record<KeRetrievalCandidate["quality"]["criticality"], number> = {
  low: 0,
  medium: 0.25,
  high: 0.5,
  critical: 0.75,
};

const TEMPORAL_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runtimeConfigFrom(value: unknown): Record<string, unknown> | undefined {
  const record = isRecord(value) ? value : undefined;
  return (isRecord(record?.runtime) ? record.runtime : record) ?? undefined;
}

/** Flag read: runtime.coding.sekb.retrievalShadow (shadow-only, default off). */
export function resolveKeRetrievalShadowEnabled(config: unknown): boolean {
  const runtime = runtimeConfigFrom(config);
  const sekb = isRecord(runtime?.coding) && isRecord(runtime.coding?.sekb) ? runtime.coding.sekb : undefined;
  return isRecord(sekb) && sekb.retrievalShadow === true;
}

/** Normalized lexical (token-overlap) signal. */
function lexicalSignal(query: string, candidate: KeRetrievalCandidate): number {
  const queryTokens = tokens(query);
  if (queryTokens.size === 0) return 0;
  const haystack = tokens(candidate.text);
  let matched = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) matched += token.length > 4 ? 2 : 1;
  }
  return clamp01(matched / (queryTokens.size * 2));
}

function tagsSignal(contextTags: string[], candidate: KeRetrievalCandidate): number {
  const queryTags = new Set(contextTags.map((t) => t.trim().toLowerCase()).filter(Boolean));
  if (queryTags.size === 0) return 0;
  const candidateTags = new Set(candidate.tags.map((t) => t.trim().toLowerCase()));
  let matched = 0;
  for (const tag of queryTags) if (candidateTags.has(tag)) matched += 1;
  return clamp01(matched / queryTags.size);
}

function errorSignal(errorSignature: string | undefined, candidate: KeRetrievalCandidate): number {
  if (!errorSignature || !candidate.errorSignature) return 0;
  const a = errorSignature.trim().toLowerCase();
  const b = candidate.errorSignature.trim().toLowerCase();
  return a === b || a.startsWith(b) || b.startsWith(a) ? 1 : 0;
}

function temporalSignal(capturedAt: number | undefined, now: number): number {
  if (capturedAt === undefined || !Number.isFinite(capturedAt)) return 0;
  const age = Math.max(0, now - capturedAt);
  return clamp01(Math.exp(-age / TEMPORAL_HALF_LIFE_MS));
}

function qualitySignal(candidate: KeRetrievalCandidate): number {
  const criticality = CRITICALITY_SCORE[candidate.quality.criticality] ?? 0;
  const pinned = candidate.quality.pinned ? 0.25 : 0;
  return clamp01(criticality + pinned);
}

function estimatedTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function packingScore(candidate: KeRetrievalCandidate, tokenBudget: number | undefined): number {
  if (tokenBudget === undefined || tokenBudget <= 0) return 1;
  return clamp01(1 - estimatedTokens(candidate.text) / tokenBudget);
}

/** Build the five broker signals, each anchored to its evidence source. */
export function buildKeBrokerSignals(
  query: string,
  candidate: KeRetrievalCandidate,
  context: KeRetrievalShadowContext,
  now: number,
): KeBrokerSignal[] {
  return [
    { name: "lexical", score: lexicalSignal(query, candidate), sourceRef: "ke-broker:lexical:token-overlap" },
    { name: "tags", score: tagsSignal(context.contextTags, candidate), sourceRef: "ke-broker:tags:context-tags" },
    { name: "error_signature", score: errorSignal(context.errorSignature, candidate), sourceRef: "ke-broker:error_signature:match" },
    { name: "temporal", score: temporalSignal(candidate.capturedAt, now), sourceRef: "ke-broker:temporal:capturedAt" },
    { name: "quality", score: qualitySignal(candidate), sourceRef: "ke-broker:quality:criticality+pinned" },
  ];
}

function calibratedScore(
  signals: KeBrokerSignal[],
  weights: Partial<Record<KeBrokerSignalName, number>>,
): number {
  let total = 0;
  for (const signal of signals) {
    total += (weights[signal.name] ?? DEFAULT_WEIGHTS[signal.name]) * signal.score;
  }
  return clamp01(total);
}

function explanation(signals: KeBrokerSignal[]): string {
  return signals
    .map((signal) => `${signal.name}=${signal.score.toFixed(2)}`)
    .join(" ");
}

/** Rank candidates into would_retrieve records (frozen weights, no injection). */
export function rankKeCandidates(
  query: string,
  candidates: readonly KeRetrievalCandidate[],
  context: KeRetrievalShadowContext,
  topK = 3,
): KeWouldRetrieve[] {
  const now = context.now ?? Date.now();
  const weights = { ...DEFAULT_WEIGHTS, ...context.weights };
  const ranked = candidates
    .map((candidate) => {
      const signals = buildKeBrokerSignals(query, candidate, context, now);
      return {
        candidate,
        signals,
        calibrated: calibratedScore(signals, weights),
        packing: packingScore(candidate, context.tokenBudget),
      };
    })
    .filter((item) => item.calibrated > 0 || item.packing > 0)
    .toSorted((left, right) => right.calibrated - left.calibrated || right.packing - left.packing)
    .slice(0, Math.max(0, Math.trunc(topK)));

  return ranked.map((item, index) => ({
    envelopeId: item.candidate.envelopeId,
    contentVersion: item.candidate.contentVersion,
    rank: index + 1,
    calibratedScore: item.calibrated,
    packingScore: item.packing,
    explanation: explanation(item.signals),
    signals: item.signals,
    selectedForPresentation: false,
  }));
}

function queryDigestFor(query: string): string {
  return `sha256:${sha256Hex(query)}`;
}

/** Build the KE-P0-3 retrieved_at event for one would_retrieve candidate. */
export function buildKeRetrievedAtEvent(
  candidate: KeWouldRetrieve,
  context: KeRetrievalShadowContext,
  query: string,
): KeRetrievedAtEvent {
  return {
    schemaVersion: 1,
    attributionId: `ke-retrieved:${candidate.envelopeId}:${candidate.rank}`,
    envelopeId: candidate.envelopeId,
    authority: { family: "sekb", id: candidate.envelopeId, contentVersion: candidate.contentVersion },
    taskId: context.taskId,
    ...(context.runId !== undefined ? { runId: context.runId } : {}),
    ...(context.sessionKey !== undefined ? { sessionKey: context.sessionKey } : {}),
    ...(context.traceId !== undefined ? { traceId: context.traceId } : {}),
    configDigest: context.configDigest,
    taskType: context.taskType,
    arm: "shadow",
    evidenceRefs: candidate.signals.map((signal) => signal.sourceRef),
    queryDigest: queryDigestFor(query),
    rank: candidate.rank,
    score: candidate.calibratedScore,
    retrievalReason: candidate.explanation,
    candidateSetDigest: queryDigestFor(query),
    selectedForPresentation: false,
  };
}

/** Build the shadow_context receipt covering every would_retrieve candidate. */
export function buildKeRetrievalShadowReceipt(
  wouldRetrieve: readonly KeWouldRetrieve[],
  context: KeRetrievalShadowContext,
  query: string,
): PutReceiptInput | null {
  if (wouldRetrieve.length === 0) return null;
  // ReceiptStore.assertDigest requires a bare 64-hex sha256 (no "sha256:" prefix).
  const bareQueryDigest = sha256Hex(query);
  const identity: ReceiptIdentity = {
    ...(context.runId !== undefined ? { runId: context.runId } : {}),
    ...(context.sessionKey !== undefined ? { sessionKey: context.sessionKey } : {}),
    ...(context.traceId !== undefined ? { traceId: context.traceId } : {}),
    // shadow_context requires provider/adapter identity; the retrieval broker
    // is the producer here (not a model provider).
    providerId: "ke-retrieval",
    adapterId: "ke-retrieval-broker",
    runtimeMode: "source",
  };
  return {
    idempotencyKey: `ke-retrieval-shadow:${context.taskId}:${bareQueryDigest}`,
    kind: "shadow_context",
    version: "0",
    identity,
    callIndex: { attemptIndex: 0, modelCallIndex: 0, wireAttemptIndex: 0 },
    content: {
      logicalDigest: bareQueryDigest,
      correlationDigest: bareQueryDigest,
      selected: wouldRetrieve.map((candidate) => `ref:context:${candidate.envelopeId}:${candidate.rank}`),
      omitted: [],
      ...(context.tokenBudget !== undefined && context.tokenBudget > 0
        ? { budget: { unit: "tokens" as const, inputLimit: context.tokenBudget, outputLimit: 0 } }
        : {}),
    },
    createdAt: context.now ?? Date.now(),
  };
}

/** Flag-gated shadow retrieval entry. Off => zero retrieval, zero receipt, zero write. */
export function runKeRetrievalShadow(
  config: unknown,
  query: string,
  candidates: readonly KeRetrievalCandidate[],
  context: KeRetrievalShadowContext,
  topK = 3,
): KeRetrievalShadowResult {
  if (!resolveKeRetrievalShadowEnabled(config)) {
    return {
      enabled: false,
      disabledReason: "flag_disabled",
      wouldRetrieve: [],
      retrievedAtEvents: [],
      receipt: null,
    };
  }
  const wouldRetrieve = rankKeCandidates(query, candidates, context, topK);
  const retrievedAtEvents = wouldRetrieve.map((candidate) =>
    buildKeRetrievedAtEvent(candidate, context, query),
  );
  const receipt = buildKeRetrievalShadowReceipt(wouldRetrieve, context, query);
  return { enabled: true, wouldRetrieve, retrievedAtEvents, receipt };
}

/** A narrow put-writer (e.g. ReceiptStore.put) that persists the shadow receipt. */
export type KeReceiptWriter = {
  put: (input: PutReceiptInput) => PutReceiptResult;
};

/**
 * Persist the shadow_context receipt through the caller's receipt writer.
 * Returns null when the shadow produced no receipt (zero behavior). The receipt
 * carries digest/refs only — no raw candidate body.
 */
export function persistKeRetrievalShadowReceipt(
  result: KeRetrievalShadowResult,
  writer: KeReceiptWriter,
): PutReceiptResult | null {
  if (!result.receipt) return null;
  return writer.put(result.receipt);
}
