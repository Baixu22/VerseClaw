// Stage 2 DCS compiler: ContextRef -> CompilationSnapshot -> PromptPlan.
//
// DCS is stateless. It owns deterministic admission/resolve/pack decisions
// over digest-only refs, returns immutable normalized artifacts, and keeps only
// an in-memory discardable registry. Durable recovery is done by
// stage2-dcs-evidence.ts through the existing ReceiptStore.
import { createHash } from 'node:crypto';

import {
  COMPILATION_SNAPSHOT_SCHEMA,
  PROMPT_PLAN_SCHEMA,
  normalizeCompilationSnapshot,
  normalizePromptPlan,
  type CompilationSnapshot,
  type ContextRef,
  type ContextRefKind,
  type PromptPlan,
  type RegisteredTransform,
  type TurnIdentity,
} from '../../../shared/types/context-control-plane/artifacts.js';
import { canonicalJsonValue } from '../agents/approval-ledger.js';

export const STAGE2_DCS_FLAG = 'contextControlPlane.stage2Dcs';
export const STAGE2_DCS_ENV = 'OPENCLAW_STAGE2_DCS';
export const STAGE2_DCS_RULE_ID = 'stage2-dcs:v1:deterministic-observational';
export const STAGE2_DCS_POLICY_DIGEST = `sha256:${createHash('sha256')
  .update('stage2-dcs-observational-policy:v1')
  .digest('hex')}`;

export type Stage2DcsFailureReason =
  | 'missing-user-intent'
  | 'empty-context-refs'
  | 'task-ledger-revision-conflict'
  | 'transform-graph-empty'
  | 'user-intent-over-budget'
  | 'budget-invalid'
  | 'invalid-snapshot'
  | 'invalid-plan';

export type Stage2DcsCompileInput = {
  refs: readonly ContextRef[];
  identity: TurnIdentity;
  taskLedgerRevision: string;
  catalogEpoch: string;
  policyEpoch: string;
  policyDigest: string;
  modelProfile: CompilationSnapshot['modelProfile'];
  transformGraph: readonly RegisteredTransform[];
  budget: CompilationSnapshot['budget'];
  /** Factual char-size hints supplied by owner adapters; never selection policy. */
  unitEstimates?: Readonly<Record<string, number>>;
  /** Deterministic compile observation time. DCS never injects wall-clock time. */
  observedAt: string;
};

export type Stage2DcsCompileResult =
  | { ok: true; snapshot: CompilationSnapshot; plan: PromptPlan }
  | { ok: false; reason: Stage2DcsFailureReason; message: string };

type PendingDecision = {
  ref: ContextRef;
  units: number;
};

const KIND_PRECEDENCE: Record<ContextRefKind, number> = {
  user_intent: 0,
  task_ledger: 1,
  tool_result: 2,
};

type SnapshotDigestInput = Omit<CompilationSnapshot, 'snapshotDigest'>;
type PlanDigestInput = Omit<PromptPlan, 'planDigest'>;

const compilationRegistry = new Map<
  string,
  { snapshot: CompilationSnapshot; plan: PromptPlan }
>();

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Deterministic UUID-shaped id from canonical content. Equal input -> equal id. */
function stableUuid(prefix: 'snap' | 'plan', seed: string): string {
  const hash = createHash('sha1').update(seed).digest('hex');
  return `${prefix}_${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Feature flag: default off. Only an explicit config slice or env override
 * enables Stage 2; malformed values fail closed to off.
 */
export function resolveStage2DcsState(
  cfg?: unknown,
  env: NodeJS.ProcessEnv = process.env,
): { enabled: boolean } {
  let enabled = false;
  try {
    const raw = env[STAGE2_DCS_ENV]?.trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') enabled = true;
    if (!enabled && cfg && typeof cfg === 'object') {
      const record = cfg as Record<string, unknown>;
      const runtime = isRecord(record.runtime) ? record.runtime : undefined;
      const ccp = isRecord(runtime?.contextControlPlane) ? runtime.contextControlPlane : undefined;
      if (ccp?.stage2Dcs === true) enabled = true;
    }
  } catch {
    enabled = false;
  }
  return { enabled };
}

function compileFailure(reason: Stage2DcsFailureReason, message: string): Stage2DcsCompileResult {
  return { ok: false, reason, message };
}

function actorAllows(ref: ContextRef, identity: TurnIdentity): boolean {
  return (
    ref.acl.allowedActors.includes(`session:${identity.sessionKey}`) ||
    ref.acl.allowedActors.includes(`run:${identity.runId}`)
  );
}

function sortRefs(refs: readonly ContextRef[]): ContextRef[] {
  return [...refs].toSorted((left, right) => {
    const precedence = KIND_PRECEDENCE[left.kind] - KIND_PRECEDENCE[right.kind];
    if (precedence !== 0) return precedence;
    return left.refId < right.refId ? -1 : left.refId > right.refId ? 1 : 0;
  });
}

function deduplicateRefs(
  refs: readonly ContextRef[],
  policyDigest: string,
): {
  unique: ContextRef[];
  omitted: PromptPlan['omitted'];
} {
  const seen = new Set<string>();
  const unique: ContextRef[] = [];
  const omitted: PromptPlan['omitted'] = [];
  for (const ref of sortRefs(refs)) {
    if (seen.has(ref.refId)) {
      omitted.push({
        refId: ref.refId,
        reason: 'duplicate',
        policyDigest,
      });
      continue;
    }
    seen.add(ref.refId);
    unique.push(ref);
  }
  return { unique, omitted };
}

function decidePendingRefs(
  unique: readonly ContextRef[],
  identity: TurnIdentity,
  policyDigest: string,
): { pending: PendingDecision[]; omitted: PromptPlan['omitted'] } {
  const pending: PendingDecision[] = [];
  const omitted: PromptPlan['omitted'] = [];
  for (const ref of unique) {
    if (ref.lifecycle !== 'active') {
      omitted.push({ refId: ref.refId, reason: 'stale', policyDigest });
      continue;
    }
    if (!actorAllows(ref, identity)) {
      omitted.push({
        refId: ref.refId,
        reason: 'policy-denied',
        policyDigest,
      });
      continue;
    }
    pending.push({ ref, units: 1 });
  }
  return { pending, omitted };
}

function normalizeUnitEstimates(
  input: Stage2DcsCompileInput,
  pending: readonly PendingDecision[],
): { decisions: PendingDecision[] } | { reason: Stage2DcsFailureReason; message: string } {
  const estimates = input.unitEstimates ?? {};
  const decisions: PendingDecision[] = [];
  for (const decision of pending) {
    const estimate = estimates[decision.ref.refId];
    const units = estimate ?? 1;
    if (!Number.isSafeInteger(units) || units < 0) {
      return { reason: 'budget-invalid', message: `invalid unit estimate for ${decision.ref.refId}` };
    }
    decisions.push({ ...decision, units });
  }
  return { decisions };
}

function projectKind(kind: ContextRefKind): PromptPlan['selected'][number]['projection'] {
  switch (kind) {
    case 'user_intent':
      return 'verbatim';
    case 'task_ledger':
    case 'tool_result':
      return 'index_only';
  }
}

function buildSnapshotDigestInput(
  input: Stage2DcsCompileInput,
  refs: readonly ContextRef[],
  snapshotId: string,
  createdAt: string,
  transformGraph: readonly RegisteredTransform[],
): SnapshotDigestInput {
  return {
    schema: COMPILATION_SNAPSHOT_SCHEMA,
    snapshotId,
    identity: input.identity,
    contextRefs: [...refs]
      .map((ref) => ({
        refId: ref.refId,
        kind: ref.kind,
        revision: ref.revision,
        contentDigest: ref.contentDigest,
      }))
      .toSorted((left, right) => left.refId.localeCompare(right.refId)),
    taskLedgerRevision: input.taskLedgerRevision,
    catalogEpoch: input.catalogEpoch,
    policyEpoch: input.policyEpoch,
    policyDigest: input.policyDigest,
    modelProfile: input.modelProfile,
    transformGraph: [...transformGraph].toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
    budget: input.budget,
    createdAt,
  };
}

function snapshotForInput(
  input: Stage2DcsCompileInput,
  refs: readonly ContextRef[],
  transformGraph: readonly RegisteredTransform[],
  createdAt: string,
): CompilationSnapshot {
  const seed = sha256Text(
    canonicalJsonValue({
      schema: COMPILATION_SNAPSHOT_SCHEMA,
      identity: input.identity,
      contextRefs: refs.map((ref) => ({
       
        refId: ref.refId,
        kind: ref.kind,
        revision: ref.revision,
        contentDigest: ref.contentDigest,
      })),
      taskLedgerRevision: input.taskLedgerRevision,
      catalogEpoch: input.catalogEpoch,
      policyEpoch: input.policyEpoch,
      policyDigest: input.policyDigest,
      modelProfile: input.modelProfile,
      transformGraph,
      budget: input.budget,
      createdAt,
    }),
  );
  const snapshotId = stableUuid('snap', seed);
  const digestInput = buildSnapshotDigestInput(
    input,
    refs,
    snapshotId,
    createdAt,
    transformGraph,
  );
  const snapshotDigest = `sha256:${sha256Text(canonicalJsonValue(digestInput))}`;
  return normalizeCompilationSnapshot({ ...digestInput, snapshotDigest });
}

function buildPlanDigestInput(
  snapshot: CompilationSnapshot,
  selected: PromptPlan['selected'],
  omitted: PromptPlan['omitted'],
  order: string[],
  requested: number,
  applied: number,
  planId: string,
): PlanDigestInput {
  return {
    schema: PROMPT_PLAN_SCHEMA,
    planId,
    snapshotId: snapshot.snapshotId,
    identity: snapshot.identity,
    selected,
    omitted,
    order,
    budget: {
      unit: snapshot.budget.unit,
      requested,
      applied,
      outputReserve: snapshot.budget.outputReserve,
    },
    why: {
      policyDigest: snapshot.policyDigest,
      policyEpoch: snapshot.policyEpoch,
      ruleId: STAGE2_DCS_RULE_ID,
    },
    sealed: true,
    createdAt: snapshot.createdAt,
  };
}

function planForSnapshot(
  snapshot: CompilationSnapshot,
  selected: PromptPlan['selected'],
  omitted: PromptPlan['omitted'],
  requested: number,
  applied: number,
): PromptPlan {
  const order = selected.map((entry) => entry.refId);
  const seed = sha256Text(
    canonicalJsonValue({
      schema: PROMPT_PLAN_SCHEMA,
      snapshotId: snapshot.snapshotId,
      identity: snapshot.identity,
      selected,
      omitted,
      order,
      budget: {
        unit: snapshot.budget.unit,
        requested,
        applied,
        outputReserve: snapshot.budget.outputReserve,
      },
      why: {
        policyDigest: snapshot.policyDigest,
        policyEpoch: snapshot.policyEpoch,
        ruleId: STAGE2_DCS_RULE_ID,
      },
      sealed: true,
      createdAt: snapshot.createdAt,
    }),
  );
  const planId = stableUuid('plan', seed);
  const digestInput = buildPlanDigestInput(
    snapshot,
    selected,
    omitted,
    order,
    requested,
    applied,
    planId,
  );
  const planDigest = `sha256:${sha256Text(canonicalJsonValue(digestInput))}`;
  return normalizePromptPlan({ ...digestInput, planDigest });
}

/**
 * Compile the frozen ContextRef set into an immutable snapshot and a sealed
 * plan. All decisions are deterministic and documented; no producer may call
 * this with pre-selected refs.
 */
export function compileStage2Dcs(input: Stage2DcsCompileInput): Stage2DcsCompileResult {
  if (input.refs.length === 0) {
    return compileFailure('empty-context-refs', 'at least one ContextRef is required');
  }
  if (input.budget.outputReserve > input.budget.limit) {
    return compileFailure('budget-invalid', 'outputReserve must not exceed budget.limit');
  }
  const { unique, omitted: duplicateOmitted } = deduplicateRefs(input.refs, input.policyDigest);
  if (!unique.some((ref) => ref.kind === 'user_intent' && ref.lifecycle === 'active')) {
    return compileFailure('missing-user-intent', 'golden path requires an active user_intent ref');
  }
  const taskLedgerRef = unique.find((ref) => ref.kind === 'task_ledger');
  if (taskLedgerRef && taskLedgerRef.revision !== input.taskLedgerRevision) {
    return compileFailure(
      'task-ledger-revision-conflict',
      `task ledger revision ${taskLedgerRef.revision} does not match snapshot revision ${input.taskLedgerRevision}`,
    );
  }
  if (input.transformGraph.length === 0) {
    return compileFailure('transform-graph-empty', 'snapshot requires a non-empty transform graph');
  }

  const decided = decidePendingRefs(unique, input.identity, input.policyDigest);
  const estimates = normalizeUnitEstimates(input, decided.pending);
  if ('reason' in estimates) {
    return compileFailure(estimates.reason, estimates.message);
  }
  if (!estimates.decisions.some((decision) => decision.ref.kind === 'user_intent')) {
    return compileFailure('missing-user-intent', 'user intent was omitted before admission');
  }

  const selected: PromptPlan['selected'] = [];
  const omitted: PromptPlan['omitted'] = [...duplicateOmitted, ...decided.omitted];
  const availableUnits = Math.max(0, input.budget.limit - input.budget.outputReserve);
  let applied = 0;
  for (const decision of estimates.decisions) {
    const nextApplied = applied + decision.units;
    if (nextApplied > availableUnits) {
      if (decision.ref.kind === 'user_intent') {
        return compileFailure(
          'user-intent-over-budget',
          `user intent needs ${decision.units} units but only ${availableUnits - applied} remain`,
        );
      }
      omitted.push({
        refId: decision.ref.refId,
        reason: 'budget-drop',
        policyDigest: input.policyDigest,
      });
      continue;
    }
    applied = nextApplied;
    selected.push({
      refId: decision.ref.refId,
      order: selected.length,
      projection: projectKind(decision.ref.kind),
      basis: decision.ref.kind,
      budgetUnits: decision.units,
    });
  }
  if (selected.length === 0) {
    return compileFailure('missing-user-intent', 'no admitted ref survived DCS admission');
  }

  const requested = estimates.decisions.reduce((total, decision) => total + decision.units, 0);
  const snapshot = snapshotForInput(input, unique, input.transformGraph, input.observedAt);
  const plan = planForSnapshot(snapshot, selected, omitted, requested, applied);
  if (plan.sealed !== true) {
    return compileFailure('invalid-plan', 'PromptPlan must be sealed');
  }
  compilationRegistry.set(snapshot.snapshotId, { snapshot, plan });
  return { ok: true, snapshot, plan };
}

export function getStage2Compilation(
  snapshotId: string,
): { snapshot: CompilationSnapshot; plan: PromptPlan } | undefined {
  const entry = compilationRegistry.get(snapshotId);
  return entry ? structuredClone(entry) : undefined;
}

export function getStage2PromptPlan(planId: string): PromptPlan | undefined {
  for (const entry of compilationRegistry.values()) {
    if (entry.plan.planId === planId) return structuredClone(entry.plan);
  }
  return undefined;
}

export function resetStage2DcsRegistryForTests(): void {
  compilationRegistry.clear();
}
