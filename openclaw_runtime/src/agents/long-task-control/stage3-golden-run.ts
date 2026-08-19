// Stage 3 real-evidence runner. Explicit-invoke only and default off. It reuses
// the accepted Stage 2 real DeepSeek -> write -> grant/Tool Guard/EffectReceipt
// chain, then appends real Stage 3 proposal/accept events to the same long-task
// ledger and records redacted evidence. The API key is read from the caller or
// process env and is never persisted or logged.
import {
  runStage2GoldenCodingTurn,
  STAGE2_GOLDEN_MODEL_REF,
  type Stage2GoldenRunOptions,
} from "../stage2-golden-run.js";
import {
  createTaskLedgerWorkingContextDecision,
  createTaskLedgerWorkingContextProposal,
  STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
} from "../../../../shared/task-ledger-working-context.js";
import {
  appendStage3WorkingContextEvents,
  resolveStage3WorkingContextState,
} from "./stage3-working-context.js";
import {
  readLongTaskLedgerRevision,
  stableLongTaskLedgerRootId,
} from "./task-ledger.js";

export type Stage3GoldenRunOptions = Stage2GoldenRunOptions & {
  /** Explicit Stage 3 opt-in; defaults to env flag, which defaults off. */
  stage3WorkingContext?: boolean;
};

export type Stage3GoldenRunResult =
  | {
      ok: true;
      model: string;
      taskLedgerRootId: string;
      proposalId: string;
      revisionBefore?: { eventCount: number; revision: string; contentDigest: string };
      revisionAfter?: { eventCount: number; revision: string; contentDigest: string };
      stage2: {
        toolCallId: string;
        approvalId: string;
        effectReceiptId: string;
        journalRef?: string;
        envelopeDigest?: string;
        envelopeRef?: string;
        wireReceiptId?: string;
        wireDigest?: string;
        preSnapshotDigest: string;
        prePlanDigest: string;
        postSnapshotDigest: string;
        postPlanDigest: string;
        postContextRefKinds: string[];
      };
    }
  | {
      ok: false;
      reason:
        | 'stage3-flag-off'
        | 'api-key-missing'
        | 'invalid-workspace-path'
        | 'stage2-golden-run-failed'
        | 'task-ledger-unavailable'
        | 'stage3-event-build-failed'
        | 'stage3-revision-missing';
      message?: string;
    };

function ledgerEnv(stateDir?: string): NodeJS.ProcessEnv {
  return stateDir?.trim()
    ? { ...process.env, OPENCLAW_STATE_DIR: stateDir.trim() }
    : process.env;
}

export async function runStage3GoldenCodingTurn(
  options: Stage3GoldenRunOptions,
): Promise<Stage3GoldenRunResult> {
  const enabled = options.stage3WorkingContext
    ?? resolveStage3WorkingContextState().enabled;
  if (!enabled) {
    return { ok: false, reason: 'stage3-flag-off' };
  }
  if (!(options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '').trim()) {
    return { ok: false, reason: 'api-key-missing' };
  }

  const stage2 = await runStage2GoldenCodingTurn({
    ...options,
    stage2Dcs: true,
  });
  if (!stage2.ok) {
    if (stage2.reason === 'api-key-missing') return { ok: false, reason: 'api-key-missing' };
    if (stage2.reason === 'invalid-workspace-path') {
      return { ok: false, reason: 'invalid-workspace-path' };
    }
    return {
      ok: false,
      reason: 'stage2-golden-run-failed',
      message: `${stage2.reason}: ${stage2.message ?? ''}`,
    };
  }

  const taskLedgerRootId = stableLongTaskLedgerRootId({
    workspaceId: options.taskLedgerWorkspaceId,
    sessionKey: options.sessionKey,
    runId: options.runId,
    source: 'task_loop',
  });
  const env = ledgerEnv(options.taskLedgerStateDir);
  const before = readLongTaskLedgerRevision({
    workspaceId: options.taskLedgerWorkspaceId,
    taskLedgerRootId,
    env,
  });
  if (!before) {
    return { ok: false, reason: 'task-ledger-unavailable' };
  }

  const createdAt = new Date().toISOString();
  const proposalId = `wc-stage3-real:${options.runId}`.slice(0, 128);
  const proposal = createTaskLedgerWorkingContextProposal({
    proposalId,
    field: 'Objective',
    value: 'Stage 3 real golden coding turn Working Context objective',
    version: 1,
    actor: 'assistant',
    taskId: taskLedgerRootId,
    sessionId: options.sessionKey,
    evidenceRefs: [{
      type: 'tool',
      ref: stage2.journalRef ?? `run:${options.runId}`,
      label: 'Stage 3 real write evidence',
    }],
    createdAt,
  });
  if (!proposal.ok) {
    return { ok: false, reason: 'stage3-event-build-failed', message: proposal.reason };
  }
  const accept = createTaskLedgerWorkingContextDecision({
    proposalId,
    field: 'Objective',
    version: 1,
    decision: 'accepted',
    actor: 'system',
    taskId: taskLedgerRootId,
    sessionId: options.sessionKey,
    policyDigest: STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
    createdAt,
  });
  if (!accept.ok) {
    return { ok: false, reason: 'stage3-event-build-failed', message: accept.reason };
  }

  appendStage3WorkingContextEvents({
    workspaceId: options.taskLedgerWorkspaceId,
    events: [proposal.event, accept.event],
    env,
    enabled: true,
  });

  const after = readLongTaskLedgerRevision({
    workspaceId: options.taskLedgerWorkspaceId,
    taskLedgerRootId,
    env,
  });
  if (!after || after.eventCount !== before.eventCount + 2) {
    return { ok: false, reason: 'stage3-revision-missing' };
  }

  return {
    ok: true,
    model: STAGE2_GOLDEN_MODEL_REF,
    taskLedgerRootId,
    proposalId,
    revisionBefore: before,
    revisionAfter: after,
    stage2: {
      toolCallId: stage2.toolCallId,
      approvalId: stage2.approvalId,
      effectReceiptId: stage2.effectReceiptId,
      ...(stage2.journalRef ? { journalRef: stage2.journalRef } : {}),
      ...(stage2.envelopeDigest ? { envelopeDigest: stage2.envelopeDigest } : {}),
      ...(stage2.envelopeRef ? { envelopeRef: stage2.envelopeRef } : {}),
      ...(stage2.wireReceiptId ? { wireReceiptId: stage2.wireReceiptId } : {}),
      ...(stage2.wireDigest ? { wireDigest: stage2.wireDigest } : {}),
      preSnapshotDigest: stage2.preSnapshotDigest,
      prePlanDigest: stage2.prePlanDigest,
      postSnapshotDigest: stage2.postSnapshotDigest,
      postPlanDigest: stage2.postPlanDigest,
      postContextRefKinds: stage2.postContextRefKinds,
    },
  };
}
