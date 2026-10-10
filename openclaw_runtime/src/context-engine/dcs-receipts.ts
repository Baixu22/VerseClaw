// RC-03 ContextReceipt/v1 + WireReceipt/v1. Built from the sealed ContextBundle
// and the final wire body, persisted through the RC-01/RC-02-approved ReceiptStore
// (typed append-only runtime_receipts). Hard constraints carry over from RC-02:
// digest/refs/indexes only; content-sensitive idempotency; explicit
// attempt/model-call/wire-attempt identity; observational write failure never
// changes send behavior but must fail the RC-03 acceptance run.
import { createHash } from "node:crypto";
import type {
  ReceiptBudget,
  ReceiptCallIndex,
  ReceiptCandidateDecisions,
  ReceiptContent,
  ReceiptIdentity,
  PutReceiptInput,
} from '../agents/receipt-store.js';
import type { ContextBundle } from './context-bundle.js';
import type { CompilePlan } from './compile-plan.js';

export const CONTEXT_RECEIPT_SCHEMA = 'ContextReceipt/v1' as const;
export const WIRE_RECEIPT_SCHEMA = 'WireReceipt/v1' as const;

/** RC-02 typed canonical input: parse a JSON budget summary into the typed
 *  ReceiptBudget. Two shapes are accepted: the token-budget shape
 *  ({unit:'tokens', inputLimit, outputLimit}) and the DCS character-budget
 *  shape ({unit:'chars', charsRequested, charsApplied}) that the RC-03 seal
 *  hook writes from the real projection lineage. Anything else is omitted
 *  instead of being persisted raw. */
function parseBudgetSummary(value: string | undefined): ReceiptBudget | undefined {
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.unit === 'tokens') {
    const inputLimit = candidate.inputLimit;
    const outputLimit = candidate.outputLimit;
    if (typeof inputLimit !== 'number' || !Number.isSafeInteger(inputLimit) || inputLimit < 0) return undefined;
    if (typeof outputLimit !== 'number' || !Number.isSafeInteger(outputLimit) || outputLimit < 0) return undefined;
    return { unit: 'tokens', inputLimit, outputLimit };
  }
  if (candidate.unit === 'chars') {
    const charsRequested = candidate.charsRequested;
    const charsApplied = candidate.charsApplied;
    if (typeof charsRequested !== 'number' || !Number.isSafeInteger(charsRequested) || charsRequested < 0) return undefined;
    if (typeof charsApplied !== 'number' || !Number.isSafeInteger(charsApplied) || charsApplied < 0) return undefined;
    return { unit: 'chars', charsRequested, charsApplied };
  }
  return undefined;
}

export function buildContextReceiptInput(input: {
  plan: CompilePlan;
  bundle: ContextBundle;
  identity: ReceiptIdentity;
  correlationDigest: string;
  selectedRefs?: string[];
  omittedRefs?: string[];
  candidateDecisions?: ReceiptCandidateDecisions;
  budget?: string;
}): PutReceiptInput {
  const {
    plan,
    bundle,
    identity,
    correlationDigest,
    selectedRefs,
    omittedRefs,
    candidateDecisions,
    budget,
  } = input;
  const content: ReceiptContent = {
    logicalDigest: bundle.bundleDigest,
    correlationDigest,
    selected: selectedRefs ?? bundle.selectedRefs,
    omitted: omittedRefs ?? bundle.omittedRefs,
    ...(candidateDecisions ? { candidateDecisions } : {}),
    budget: parseBudgetSummary(budget) ?? parseBudgetSummary(bundle.budgetSummary),
    policyDigest: plan.policyDigest,
  };
  return {
    idempotencyKey: `ctx:v1:${correlationDigest}`,
    kind: 'context',
    version: '1',
    identity,
    callIndex: {
      attemptIndex: plan.callIndex.attemptIndex,
      modelCallIndex: plan.callIndex.modelCallIndex,
      wireAttemptIndex: plan.callIndex.wireAttemptIndex,
    },
    content,
  };
}

export const MEMORY_INJECTION_RECEIPT_SCHEMA = 'MemoryInjectionReceipt/v1' as const;

/**
 * Sanitized memory-injection receipt (R3-2.1). Captures only selected/omitted
 * fact refs, char counts, and the producer source — never raw fact content.
 * Latency is carried in the idempotency-key correlation, not a new column, to
 * keep the append-only receipt table schema frozen.
 */
export type MemoryInjectionReceiptSummary = {
  /** Injected fact ids (sanitized to ref:memory:* refs). */
  selectedFactIds: string[];
  /** Candidate fact ids that were omitted by budget/ranking. */
  omittedFactIds: string[];
  /** Characters actually injected (budget charsApplied). */
  selectedChars: number;
  /** Characters requested across selected+omitted (budget charsRequested). */
  requestedChars: number;
  /** Producer source tag (e.g. 'compass-pre-reply-retrieval'). */
  source: string;
};

export function buildMemoryInjectionReceiptInput(input: {
  identity: ReceiptIdentity;
  callIndex: ReceiptCallIndex;
  correlationDigest: string;
  summary: MemoryInjectionReceiptSummary;
}): PutReceiptInput {
  const { identity, callIndex, correlationDigest, summary } = input;
  const selected = summary.selectedFactIds.map((id) => `ref:memory:${id}`);
  const omitted = summary.omittedFactIds.map((id) => `ref:memory:${id}`);
  const logicalDigest = createHash("sha256")
    .update(
      JSON.stringify({
        source: summary.source,
        selected: summary.selectedFactIds,
        omitted: summary.omittedFactIds,
        selectedChars: summary.selectedChars,
      }),
    )
    .digest("hex");
  const policyDigest = createHash("sha256")
    .update(`memory-injection:${summary.source}`)
    .digest("hex");
  return {
    idempotencyKey: `memory:v1:${correlationDigest}`,
    kind: 'context',
    version: '1',
    identity,
    callIndex,
    content: {
      logicalDigest,
      correlationDigest,
      selected,
      omitted,
      budget: {
        unit: 'chars',
        charsRequested: summary.requestedChars,
        charsApplied: summary.selectedChars,
      },
      policyDigest,
    },
  };
}

export function buildMemoryInjectionReceiptSummary(input: {
  injectedFactIds: readonly string[];
  candidateFacts: readonly { factId: string }[];
  injectedChars: number;
  source?: string;
}): MemoryInjectionReceiptSummary {
  const selected = new Set(input.injectedFactIds);
  const omitted = input.candidateFacts
    .map((fact) => fact.factId)
    .filter((id) => !selected.has(id));
  return {
    selectedFactIds: [...input.injectedFactIds],
    omittedFactIds: omitted,
    selectedChars: input.injectedChars,
    requestedChars: input.injectedChars,
    source: input.source ?? "compass-pre-reply-retrieval",
  };
}

export function buildWireReceiptInput(input: {
  plan: CompilePlan;
  wireDigest: string;
  logicalDigest?: string;
  identity: ReceiptIdentity;
  correlationDigest: string;
  transformIds?: string[];
}): PutReceiptInput {
  const { plan, wireDigest, logicalDigest, identity, correlationDigest, transformIds } = input;
  return {
    idempotencyKey: `wire:v1:${correlationDigest}:${wireDigest}`,
    kind: 'wire',
    version: '1',
    identity: transformIds?.length ? { ...identity, transformIds } : identity,
    callIndex: {
      attemptIndex: plan.callIndex.attemptIndex,
      modelCallIndex: plan.callIndex.modelCallIndex,
      wireAttemptIndex: plan.callIndex.wireAttemptIndex,
    },
    content: {
      wireDigest,
      logicalDigest,
      correlationDigest,
    },
  };
}
