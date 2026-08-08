import { createSubsystemLogger } from "../logging/subsystem.js";
import type { RuntimeMemoryHydrationShadowFactProjection } from "./memory-read-hydration-shadow.js";

export type { RuntimeMemoryHydrationShadowFactProjection };

const logger = createSubsystemLogger("runtime-memory");

export type RuntimeMemoryHydrationConsumerQuery = {
  taskId: string;
  subject: string;
  predicate: string;
  referenceTime: number;
  tokenBudget?: number;
  limit?: number;
};

export type RuntimeMemoryHydrationConsumerRejectionReason =
  | "record_kind_not_fact"
  | "verification_status_not_verified"
  | "future_valid_at"
  | "invalidated_at_reference_time"
  | "expired_at_reference_time"
  | "task_mismatch"
  | "subject_mismatch"
  | "predicate_mismatch"
  | "prompt_injection_sentinel"
  | "raw_leak_sentinel"
  | "conflicting_fact"
  | "token_budget_exceeded"
  | "limit_exceeded";

export type RuntimeMemoryHydrationConsumerRejectedFact = {
  fact: RuntimeMemoryHydrationShadowFactProjection;
  reason: RuntimeMemoryHydrationConsumerRejectionReason;
};

export type RuntimeMemoryHydrationConsumerMetrics = {
  totalFacts: number;
  acceptedFacts: number;
  rejectedFacts: number;
  tokenBudget: number;
  estimatedTokens: number;
  rejectionCounts: Record<RuntimeMemoryHydrationConsumerRejectionReason, number>;
};

export type RuntimeMemoryHydrationConsumerResult = {
  acceptedFacts: RuntimeMemoryHydrationShadowFactProjection[];
  rejectedFacts: RuntimeMemoryHydrationConsumerRejectedFact[];
  metrics: RuntimeMemoryHydrationConsumerMetrics;
};

export type RuntimeMemoryHydrationConsumerSentinels = {
  promptInjection?: RegExp;
  rawLeak?: RegExp;
};

export type RuntimeMemoryHydrationConsumerOptions = {
  sentinels?: RuntimeMemoryHydrationConsumerSentinels;
};

const DEFAULT_TOKEN_BUDGET = 256;
const DEFAULT_LIMIT = 8;
const TOKEN_CHAR_WIDTH = 4;

export const DEFAULT_PROMPT_INJECTION_SENTINEL =
  /\b(ignore|disregard|override|bypass|disable|forget)\b[\s\S]{0,80}\b(instructions?|rules?|policy|guardrails?|system prompt|developer prompt)\b|\b(system|developer)\s+prompt\b[\s\S]{0,80}\b(ignore|override|bypass)\b|\byou are now\b[\s\S]{0,80}\b(system|developer|admin)\b/iu;

export const DEFAULT_RAW_LEAK_SENTINEL =
  /\b(record_json|raw\s+(chat|transcript|trace|prompt)|conversation log|\.jsonl|traceparent|tracestate|baggage|full payload|payload\s*[:=]|tool\s*args|toolArgs|full tool args|tool\s*output|toolOutput|stdout|stderr|process\.env|environment variables?|secret|api[-_ ]?key|authorization|password|bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]{8,})\b/iu;

export function consumeRuntimeMemoryHydrationFacts(
  facts: readonly RuntimeMemoryHydrationShadowFactProjection[],
  query: RuntimeMemoryHydrationConsumerQuery,
  options?: RuntimeMemoryHydrationConsumerOptions,
): RuntimeMemoryHydrationConsumerResult {
  const sentinels = resolveSentinels(options);
  const rejectedFacts: RuntimeMemoryHydrationConsumerRejectedFact[] = [];
  const baseAccepted: RuntimeMemoryHydrationShadowFactProjection[] = [];

  for (const fact of facts) {
    const reason = rejectionReasonBeforeConflict(fact, query, sentinels);
    if (reason) {
      rejectedFacts.push({ fact, reason });
      continue;
    }
    baseAccepted.push(fact);
  }

  const conflictWinners = new Set(
    selectConflictWinners(baseAccepted).map((fact) => fact.factId),
  );
  const acceptedBeforeBudget: RuntimeMemoryHydrationShadowFactProjection[] = [];
  for (const fact of rankFacts(baseAccepted)) {
    if (!conflictWinners.has(fact.factId)) {
      rejectedFacts.push({ fact, reason: "conflicting_fact" });
      continue;
    }
    acceptedBeforeBudget.push(fact);
  }

  const acceptedFacts: RuntimeMemoryHydrationShadowFactProjection[] = [];
  const tokenBudget = normalizeNonNegativeInteger(
    query.tokenBudget,
    DEFAULT_TOKEN_BUDGET,
  );
  const limit = normalizeNonNegativeInteger(query.limit, DEFAULT_LIMIT);
  let estimatedTokens = 0;

  for (const fact of acceptedBeforeBudget) {
    if (acceptedFacts.length >= limit) {
      rejectedFacts.push({ fact, reason: "limit_exceeded" });
      continue;
    }
    const factTokens = estimateFactTokens(fact);
    if (estimatedTokens + factTokens > tokenBudget) {
      rejectedFacts.push({ fact, reason: "token_budget_exceeded" });
      continue;
    }
    acceptedFacts.push(fact);
    estimatedTokens += factTokens;
  }

  return {
    acceptedFacts,
    rejectedFacts,
    metrics: {
      totalFacts: facts.length,
      acceptedFacts: acceptedFacts.length,
      rejectedFacts: rejectedFacts.length,
      tokenBudget,
      estimatedTokens,
      rejectionCounts: countRejections(rejectedFacts),
    },
  };
}

function rejectionReasonBeforeConflict(
  fact: RuntimeMemoryHydrationShadowFactProjection,
  query: RuntimeMemoryHydrationConsumerQuery,
  sentinels: ResolvedSentinels,
): RuntimeMemoryHydrationConsumerRejectionReason | undefined {
  if (fact.recordKind !== "fact") {
    return "record_kind_not_fact";
  }
  if (fact.verificationStatus !== "verified") {
    return "verification_status_not_verified";
  }
  if (fact.valid_at > query.referenceTime) {
    return "future_valid_at";
  }
  if (fact.invalid_at !== undefined && fact.invalid_at <= query.referenceTime) {
    return "invalidated_at_reference_time";
  }
  if (fact.expired_at !== undefined && fact.expired_at <= query.referenceTime) {
    return "expired_at_reference_time";
  }
  if (fact.taskId !== query.taskId) {
    return "task_mismatch";
  }
  if (fact.subject !== query.subject) {
    return "subject_mismatch";
  }
  if (fact.predicate !== query.predicate) {
    return "predicate_mismatch";
  }
  if (hasPromptInjectionSentinel(fact, sentinels)) {
    logger.warn("consumer_prompt_injection_detected", { factId: fact.factId });
    return "prompt_injection_sentinel";
  }
  if (hasRawLeakSentinel(fact, sentinels)) {
    logger.warn("consumer_raw_leak_detected", { factId: fact.factId });
    return "raw_leak_sentinel";
  }
  return undefined;
}

function selectConflictWinners(
  facts: readonly RuntimeMemoryHydrationShadowFactProjection[],
): RuntimeMemoryHydrationShadowFactProjection[] {
  const winners = new Map<string, RuntimeMemoryHydrationShadowFactProjection>();
  for (const fact of facts) {
    const key = `${fact.taskId ?? ""}\u0000${fact.subject}\u0000${fact.predicate}`;
    const current = winners.get(key);
    if (!current || compareFactRank(fact, current) < 0) {
      winners.set(key, fact);
    }
  }
  return [...winners.values()];
}

function rankFacts(
  facts: readonly RuntimeMemoryHydrationShadowFactProjection[],
): RuntimeMemoryHydrationShadowFactProjection[] {
  return [...facts].sort(compareFactRank);
}

function compareFactRank(
  left: RuntimeMemoryHydrationShadowFactProjection,
  right: RuntimeMemoryHydrationShadowFactProjection,
): number {
  const confidence = right.confidence - left.confidence;
  if (confidence !== 0) {
    return confidence;
  }
  const validAt = right.valid_at - left.valid_at;
  if (validAt !== 0) {
    return validAt;
  }
  const referenceTime = right.reference_time - left.reference_time;
  if (referenceTime !== 0) {
    return referenceTime;
  }
  return left.factId.localeCompare(right.factId);
}

function hasPromptInjectionSentinel(
  fact: RuntimeMemoryHydrationShadowFactProjection,
  sentinels: ResolvedSentinels,
): boolean {
  return sentinels.promptInjection.test(projectionText(fact));
}

function hasRawLeakSentinel(
  fact: RuntimeMemoryHydrationShadowFactProjection,
  sentinels: ResolvedSentinels,
): boolean {
  return sentinels.rawLeak.test(projectionText(fact));
}

type ResolvedSentinels = {
  promptInjection: RegExp;
  rawLeak: RegExp;
};

function resolveSentinels(
  options?: RuntimeMemoryHydrationConsumerOptions,
): ResolvedSentinels {
  const promptInjection = options?.sentinels?.promptInjection ?? DEFAULT_PROMPT_INJECTION_SENTINEL;
  const rawLeak = options?.sentinels?.rawLeak ?? DEFAULT_RAW_LEAK_SENTINEL;
  return { promptInjection, rawLeak };
}

function projectionText(fact: RuntimeMemoryHydrationShadowFactProjection): string {
  return [
    fact.factId,
    fact.taskId ?? "",
    fact.subject,
    fact.predicate,
    fact.objectSummary,
    fact.source,
    fact.verificationStatus,
    JSON.stringify(fact.sourceEpisodeRefs),
    JSON.stringify(fact.evidenceRefs),
    JSON.stringify(fact.metadata ?? {}),
  ].join("\n");
}

function estimateFactTokens(
  fact: RuntimeMemoryHydrationShadowFactProjection,
): number {
  return Math.ceil(formatFactForBudget(fact).length / TOKEN_CHAR_WIDTH);
}

function formatFactForBudget(
  fact: RuntimeMemoryHydrationShadowFactProjection,
): string {
  return [
    fact.subject,
    fact.predicate,
    fact.objectSummary,
    `valid_at=${fact.valid_at}`,
    `reference_time=${fact.reference_time}`,
  ].join(" | ");
}

function countRejections(
  rejectedFacts: readonly RuntimeMemoryHydrationConsumerRejectedFact[],
): Record<RuntimeMemoryHydrationConsumerRejectionReason, number> {
  const counts = emptyRejectionCounts();
  for (const rejected of rejectedFacts) {
    counts[rejected.reason] += 1;
  }
  return counts;
}

function emptyRejectionCounts(): Record<
  RuntimeMemoryHydrationConsumerRejectionReason,
  number
> {
  return {
    record_kind_not_fact: 0,
    verification_status_not_verified: 0,
    future_valid_at: 0,
    invalidated_at_reference_time: 0,
    expired_at_reference_time: 0,
    task_mismatch: 0,
    subject_mismatch: 0,
    predicate_mismatch: 0,
    prompt_injection_sentinel: 0,
    raw_leak_sentinel: 0,
    conflicting_fact: 0,
    token_budget_exceeded: 0,
    limit_exceeded: 0,
  };
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isInteger(value) && value !== undefined && value >= 0
    ? value
    : fallback;
}
