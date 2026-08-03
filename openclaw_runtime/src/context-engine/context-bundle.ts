// RC-03 model-call-scoped immutable ContextBundle. One bundle per model call;
// tool results create the next bundle without synchronously rerunning Mem.
// Sealed once; after sealing only registered non-semantic transport transforms
// may touch the wire body.
import { createHash } from 'node:crypto';

import type { ContextCandidate } from './context-candidate.js';
import type { CompilePlan } from './compile-plan.js';

export const CONTEXT_BUNDLE_SCHEMA = 'ContextBundle/v1' as const;

export type ContextBundle = {
  schema: typeof CONTEXT_BUNDLE_SCHEMA;
  bundleId: string;
  plan: CompilePlan;
  /** System prompt after semantic producers ran (before seal). */
  systemPrompt?: string;
  /** Messages after semantic producers ran (before seal). */
  messages: ReadonlyArray<unknown>;
  /** Registered pre-seal producers that applied in this bundle. */
  appliedProducerIds: string[];
  /** Selected candidate refs (applied, budget-charged). */
  selectedRefs: string[];
  /** Omitted candidate refs (dropped/truncated/skipped under budget or kill). */
  omittedRefs: string[];
  /** Budget summary (chars requested/applied). */
  budgetSummary: string;
  /** Policy digest that produced this bundle. */
  policyDigest: string;
  /** Immutable content digest of the sealed bundle. */
  bundleDigest: string;
  sealed: boolean;
  createdAt: number;
};

export function contextBundleDigest(bundle: Omit<ContextBundle, 'bundleDigest'>): string {
  return createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
}

export function createContextBundle(input: {
  plan: CompilePlan;
  systemPrompt?: string;
  messages: ReadonlyArray<unknown>;
  appliedProducerIds?: string[];
  selectedRefs?: string[];
  omittedRefs?: string[];
  budgetSummary?: string;
  createdAt?: number;
}): ContextBundle {
  const bundle: Omit<ContextBundle, 'bundleDigest'> = {
    schema: CONTEXT_BUNDLE_SCHEMA,
    bundleId: `bundle_${input.plan.planId.replace(/^plan_/, '')}`,
    plan: input.plan,
    systemPrompt: input.systemPrompt,
    messages: Object.freeze([...input.messages]),
    appliedProducerIds: input.appliedProducerIds ?? [],
    selectedRefs: input.selectedRefs ?? [],
    omittedRefs: input.omittedRefs ?? [],
    budgetSummary: input.budgetSummary ?? '{}',
    policyDigest: input.plan.policyDigest,
    sealed: false,
    createdAt: input.createdAt ?? Date.now(),
  };
  return { ...bundle, bundleDigest: contextBundleDigest(bundle) };
}

/**
 * Seal the bundle: freeze the content digest. After this call the semantic
 * content (systemPrompt/messages) must not change; only registered non-semantic
 * transport transforms may run.
 */
export function sealContextBundle(bundle: ContextBundle): ContextBundle {
  if (bundle.sealed) return bundle;
  const next: ContextBundle = { ...bundle, sealed: true };
  return { ...next, bundleDigest: contextBundleDigest(next) };
}

/** Project candidate refs into selected/omitted based on the projection lineage. */
export function projectCandidateRefs(
  candidates: readonly ContextCandidate[],
  applied: (candidate: ContextCandidate) => boolean,
): { selectedRefs: string[]; omittedRefs: string[] } {
  const selectedRefs: string[] = [];
  const omittedRefs: string[] = [];
  for (const candidate of candidates) {
    if (applied(candidate)) {
      selectedRefs.push(candidate.candidateId);
    } else {
      omittedRefs.push(candidate.candidateId);
    }
  }
  return { selectedRefs, omittedRefs };
}
