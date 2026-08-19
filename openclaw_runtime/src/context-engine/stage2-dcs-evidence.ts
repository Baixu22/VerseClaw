// Stage 2 digest-only snapshot/plan evidence over the existing append-only
// ReceiptStore. No new table or payload-bearing storage: each compile writes
// two kind=context rows whose idempotency keys are derived from the artifact
// digests, and selected refs encode the frozen input versions.
import { createHash } from 'node:crypto';

import type { CompilationSnapshot, PromptPlan } from '../../../shared/types/context-control-plane/artifacts.js';
import {
  ReceiptStore,
  type PutReceiptResult,
  type RuntimeReceiptRow,
} from '../agents/receipt-store.js';
import type { OpenClawStateDatabaseOptions } from '../state/openclaw-state-db.js';
import { canonicalJsonValue } from '../agents/approval-ledger.js';

export const STAGE2_SNAPSHOT_EVIDENCE_SCHEMA = 'CompilationSnapshotEvidence/v1' as const;
export const STAGE2_PLAN_EVIDENCE_SCHEMA = 'PromptPlanEvidence/v1' as const;

export type Stage2DcsEvidencePersistResult = {
  snapshotReceipt: PutReceiptResult | null;
  planReceipt: PutReceiptResult | null;
  failed: boolean;
  reason?: 'snapshot-receipt-write-failed' | 'plan-receipt-write-failed';
};

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function plainDigest(digest: string): string {
  return digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : digest;
}

function transformGraphDigest(snapshot: CompilationSnapshot): string {
  return `sha256:${sha256Text(canonicalJsonValue(snapshot.transformGraph))}`;
}

export function buildStage2SnapshotEvidenceRefs(
  snapshot: CompilationSnapshot,
  plan: PromptPlan,
): string[] {
  return [
    `ref:compilation-snapshot:snapshot-id:${snapshot.snapshotId}`,
    `ref:compilation-snapshot:snapshot-digest:${snapshot.snapshotDigest}`,
    `ref:compilation-snapshot:task-ledger:${snapshot.taskLedgerRevision}`,
    `ref:compilation-snapshot:catalog-epoch:${snapshot.catalogEpoch}`,
    `ref:compilation-snapshot:policy-epoch:${snapshot.policyEpoch}`,
    `ref:compilation-snapshot:policy-digest:${snapshot.policyDigest}`,
    `ref:compilation-snapshot:model-profile:${snapshot.modelProfile.providerId}:${snapshot.modelProfile.modelId}:${snapshot.modelProfile.adapterId}`,
    `ref:compilation-snapshot:transform-graph:${transformGraphDigest(snapshot)}`,
    `ref:prompt-plan:plan-digest:${plan.planDigest}`,
    ...snapshot.contextRefs.map(
      (ref) => `ref:compilation-snapshot:context-ref:${ref.refId}:${ref.revision}`,
    ),
  ];
}

export function buildStage2PlanEvidenceRefs(
  plan: PromptPlan,
): { selected: string[]; omitted: string[] } {
  return {
    selected: [
      `ref:prompt-plan:plan-digest:${plan.planDigest}`,
      ...plan.selected.map((entry) => `ref:context:${entry.refId}`),
    ],
    omitted: plan.omitted.map((entry) => `ref:context:${entry.refId}`),
  };
}

/**
 * Persist recoverable digest-only evidence. Correlation is snapshotDigest, so
 * a caller can query the exact two-row compile evidence without knowing
 * volatile ids.
 */
export function persistStage2DcsEvidence(input: {
  snapshot: CompilationSnapshot;
  plan: PromptPlan;
  database?: OpenClawStateDatabaseOptions;
  providerId?: string;
  adapterId?: string;
}): Stage2DcsEvidencePersistResult {
  const store = new ReceiptStore(input.database ?? {});
  const correlationDigest = plainDigest(input.snapshot.snapshotDigest);
  const identity = {
    runtimeMode: 'source' as const,
    providerId: input.providerId ?? input.snapshot.modelProfile.providerId,
    adapterId: input.adapterId ?? input.snapshot.modelProfile.adapterId,
    sessionKey: input.snapshot.identity.sessionKey,
    runId: input.snapshot.identity.runId,
  };
  const callIndex = {
    attemptIndex: input.snapshot.identity.attemptIndex,
    modelCallIndex: input.snapshot.identity.modelCallIndex,
    wireAttemptIndex: 0,
  };
  const budget = input.plan.budget.unit === 'chars'
    ? {
        unit: 'chars' as const,
        charsRequested: input.plan.budget.requested,
        charsApplied: input.plan.budget.applied,
      }
    : {
        unit: 'tokens' as const,
        inputLimit: input.plan.budget.requested,
        outputLimit: input.plan.budget.outputReserve,
      };

  let snapshotReceipt: PutReceiptResult;
  let planReceipt: PutReceiptResult;
  try {
    snapshotReceipt = store.put({
      idempotencyKey: `ctx:v2:snapshot:${correlationDigest}`,
      kind: 'context',
      version: '1',
      identity,
      callIndex,
      content: {
        logicalDigest: correlationDigest,
        correlationDigest,
        selected: buildStage2SnapshotEvidenceRefs(input.snapshot, input.plan),
        budget,
        policyDigest: plainDigest(input.snapshot.policyDigest),
      },
    });
  } catch {
    return { snapshotReceipt: null, planReceipt: null, failed: true, reason: 'snapshot-receipt-write-failed' };
  }
  const planRefs = buildStage2PlanEvidenceRefs(input.plan);
  try {
    planReceipt = store.put({
      idempotencyKey: `ctx:v2:plan:${plainDigest(input.plan.planDigest)}`,
      kind: 'context',
      version: '1',
      identity,
      callIndex,
      content: {
        logicalDigest: plainDigest(input.plan.planDigest),
        correlationDigest,
        selected: planRefs.selected,
        omitted: planRefs.omitted,
        budget,
        policyDigest: plainDigest(input.plan.why.policyDigest),
      },
    });
  } catch {
    return { snapshotReceipt, planReceipt: null, failed: true, reason: 'plan-receipt-write-failed' };
  }
  const reason: Stage2DcsEvidencePersistResult['reason'] = !snapshotReceipt.ok
    ? 'snapshot-receipt-write-failed'
    : !planReceipt.ok
      ? 'plan-receipt-write-failed'
      : undefined;
  return {
    snapshotReceipt,
    planReceipt,
    failed: reason !== undefined,
    ...(reason ? { reason } : {}),
  };
}

export type Stage2EnvelopeEvidencePersistResult = {
  receipt: PutReceiptResult | null;
  ok: boolean;
};

/**
 * Append the post-fetch RequestEnvelope digest into the same snapshot
 * correlation. This closes the DCS snapshot -> PromptPlan -> RequestEnvelope
 * evidence chain without adding a table or storing any request content.
 */
export function persistStage2EnvelopeEvidence(input: {
  snapshot: CompilationSnapshot;
  plan: PromptPlan;
  envelopeDigest: string;
  database?: OpenClawStateDatabaseOptions;
}): Stage2EnvelopeEvidencePersistResult {
  const store = new ReceiptStore(input.database ?? {});
  const snapshotDigest = plainDigest(input.snapshot.snapshotDigest);
  const envelopeDigest = plainDigest(input.envelopeDigest);
  const budget = input.plan.budget.unit === 'chars'
    ? {
        unit: 'chars' as const,
        charsRequested: input.plan.budget.requested,
        charsApplied: input.plan.budget.applied,
      }
    : {
        unit: 'tokens' as const,
        inputLimit: input.plan.budget.requested,
        outputLimit: input.plan.budget.outputReserve,
      };
  try {
    const receipt = store.put({
      idempotencyKey: `ctx:v2:envelope:${snapshotDigest}:${envelopeDigest}`,
      kind: 'context',
      version: '1',
      identity: {
        runtimeMode: 'source',
        providerId: input.snapshot.modelProfile.providerId,
        adapterId: input.snapshot.modelProfile.adapterId,
        sessionKey: input.snapshot.identity.sessionKey,
        runId: input.snapshot.identity.runId,
      },
      callIndex: {
        attemptIndex: input.snapshot.identity.attemptIndex,
        modelCallIndex: input.snapshot.identity.modelCallIndex,
        wireAttemptIndex: 0,
      },
      content: {
        logicalDigest: envelopeDigest,
        correlationDigest: snapshotDigest,
        selected: [
          `ref:request-envelope:${envelopeDigest}`,
          `ref:prompt-plan:plan-digest:${input.plan.planDigest}`,
          `ref:compilation-snapshot:snapshot-digest:${input.snapshot.snapshotDigest}`,
        ],
        budget,
        policyDigest: plainDigest(input.snapshot.policyDigest),
      },
    });
    return { receipt, ok: receipt.ok };
  } catch {
    return { receipt: null, ok: false };
  }
}

/** Public query path: both compile-evidence rows for one snapshot digest. */
export function queryStage2DcsEvidence(
  database: OpenClawStateDatabaseOptions | undefined,
  snapshotDigest: string,
): RuntimeReceiptRow[] {
  const store = new ReceiptStore(database ?? {});
  return store.list({
    kind: 'context',
    correlationDigest: plainDigest(snapshotDigest),
    limit: 16,
  });
}
