// RC-03 attempt-scoped CompilePlan. One stable plan per provider attempt; a
// policy-only change within the same provider attempt increments planRevision;
// a provider capability change or fallback creates a new attempt
// (attemptIndex += 1, planRevision/modelCallIndex/wireAttemptIndex reset).
// Explicit attempt/model-call/wire-attempt identity per RC-02 hard constraint 3.
import { createHash, randomUUID } from 'node:crypto';

export const COMPILE_PLAN_SCHEMA = 'CompilePlan/v1' as const;

export type CompilePlanCallIndex = {
  attemptIndex: number;
  planRevision: number;
  modelCallIndex: number;
  wireAttemptIndex: number;
};

export type CompilePlanProducerRef = {
  /** Registered pre-seal semantic producer id (e.g. "compass-ssp", "cvk-message-replacement"). */
  producerId: string;
  /** Producer version that was active when the plan compiled. */
  producerVersion: string;
  /** Whether the producer actually contributed to this plan. */
  applied: boolean;
};

export type CompilePlan = {
  schema: typeof COMPILE_PLAN_SCHEMA;
  planId: string;
  sessionKey?: string;
  runId?: string;
  traceId?: string;
  providerId?: string;
  adapterId?: string;
  /** Policy digest that produced this plan (selection/budget policy). */
  policyDigest: string;
  /** Registered semantic producers that ran before seal. */
  preSealProducers: CompilePlanProducerRef[];
  /** Registered non-semantic transport transforms allowed after seal. */
  postSealTransformIds: string[];
  callIndex: CompilePlanCallIndex;
  /** Stable content digest of the plan (plan + producers + indexes). */
  planDigest: string;
  createdAt: number;
};

export function compilePlanDigest(plan: Omit<CompilePlan, 'planDigest'>): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

export function createCompilePlan(input: {
  sessionKey?: string;
  runId?: string;
  traceId?: string;
  providerId?: string;
  adapterId?: string;
  policyDigest: string;
  callIndex: CompilePlanCallIndex;
  preSealProducers?: CompilePlanProducerRef[];
  postSealTransformIds?: string[];
  createdAt?: number;
}): CompilePlan {
  const plan: Omit<CompilePlan, 'planDigest'> = {
    schema: COMPILE_PLAN_SCHEMA,
    planId: `plan_${randomUUID()}`,
    sessionKey: input.sessionKey,
    runId: input.runId,
    traceId: input.traceId,
    providerId: input.providerId,
    adapterId: input.adapterId,
    policyDigest: input.policyDigest,
    preSealProducers: input.preSealProducers ?? [],
    postSealTransformIds: input.postSealTransformIds ?? [],
    callIndex: input.callIndex,
    createdAt: input.createdAt ?? Date.now(),
  };
  return { ...plan, planDigest: compilePlanDigest(plan) };
}

/**
 * Advance the plan for the next model call inside the same attempt. Only the
 * modelCallIndex moves; planRevision/attemptIndex stay. A new plan object is
 * returned (immutability).
 */
export function nextModelCall(plan: CompilePlan): CompilePlan {
  return {
    ...plan,
    planId: `plan_${randomUUID()}`,
    callIndex: {
      ...plan.callIndex,
      modelCallIndex: plan.callIndex.modelCallIndex + 1,
    },
  };
}

/**
 * Advance the plan after a policy-only change within the same provider attempt:
 * planRevision increments, other indexes stay.
 */
export function nextPlanRevision(plan: CompilePlan): CompilePlan {
  return {
    ...plan,
    planId: `plan_${randomUUID()}`,
    callIndex: {
      ...plan.callIndex,
      planRevision: plan.callIndex.planRevision + 1,
    },
  };
}

/**
 * Create a fresh attempt plan after provider fallback or a provider capability
 * change: attemptIndex += 1, planRevision/modelCallIndex/wireAttemptIndex reset.
 */
export function nextAttempt(plan: CompilePlan, input: Partial<CompilePlan> = {}): CompilePlan {
  return createCompilePlan({
    sessionKey: input.sessionKey ?? plan.sessionKey,
    runId: input.runId ?? plan.runId,
    traceId: input.traceId ?? plan.traceId,
    providerId: input.providerId ?? plan.providerId,
    adapterId: input.adapterId ?? plan.adapterId,
    policyDigest: input.policyDigest ?? plan.policyDigest,
    preSealProducers: input.preSealProducers ?? plan.preSealProducers,
    postSealTransformIds: input.postSealTransformIds ?? plan.postSealTransformIds,
    callIndex: {
      attemptIndex: plan.callIndex.attemptIndex + 1,
      planRevision: 0,
      modelCallIndex: 0,
      wireAttemptIndex: 0,
    },
  });
}
