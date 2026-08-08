// RC-03 ContextReceipt/v1 + WireReceipt/v1. Built from the sealed ContextBundle
// and the final wire body, persisted through the RC-01/RC-02-approved ReceiptStore
// (typed append-only runtime_receipts). Hard constraints carry over from RC-02:
// digest/refs/indexes only; content-sensitive idempotency; explicit
// attempt/model-call/wire-attempt identity; observational write failure never
// changes send behavior but must fail the RC-03 acceptance run.
import type {
  ReceiptBudget,
  ReceiptContent,
  ReceiptIdentity,
  PutReceiptInput,
} from '../agents/receipt-store.js';
import type { ContextBundle } from './context-bundle.js';
import type { CompilePlan } from './compile-plan.js';

export const CONTEXT_RECEIPT_SCHEMA = 'ContextReceipt/v1' as const;
export const WIRE_RECEIPT_SCHEMA = 'WireReceipt/v1' as const;

/** RC-02 typed canonical input: parse a JSON budget summary into the typed
 *  ReceiptBudget; anything that does not match the token-budget shape is
 *  omitted instead of being persisted raw. */
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
  if (candidate.unit !== 'tokens') return undefined;
  const inputLimit = candidate.inputLimit;
  const outputLimit = candidate.outputLimit;
  if (typeof inputLimit !== 'number' || !Number.isSafeInteger(inputLimit) || inputLimit < 0) return undefined;
  if (typeof outputLimit !== 'number' || !Number.isSafeInteger(outputLimit) || outputLimit < 0) return undefined;
  return { unit: 'tokens', inputLimit, outputLimit };
}

export function buildContextReceiptInput(input: {
  plan: CompilePlan;
  bundle: ContextBundle;
  identity: ReceiptIdentity;
  correlationDigest: string;
  selectedRefs?: string[];
  omittedRefs?: string[];
  budget?: string;
}): PutReceiptInput {
  const { plan, bundle, identity, correlationDigest, selectedRefs, omittedRefs, budget } = input;
  const content: ReceiptContent = {
    logicalDigest: bundle.bundleDigest,
    correlationDigest,
    selected: selectedRefs ?? bundle.selectedRefs,
    omitted: omittedRefs ?? bundle.omittedRefs,
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
