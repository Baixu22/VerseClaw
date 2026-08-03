// RC-05 minimal Operator governance slice. Ties the automated primary path:
// Cron ingress -> run identity -> DCS receipts -> desktop Inbox -> durable
// approval (RC-04) -> one bounded file/message effect -> EffectReceipt ->
// process restart -> recovery -> delivery projection. Duplicate effect count is
// zero, a denial produces zero effect, and restart preserves pending/completed
// truth from RC-04. The channel-conformance fixture proves the same contract
// without a real external account.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { ApprovalLedger } from './approval-ledger.js';
import { EffectReceiptStore } from './effect-receipt.js';
import type { RuntimeReceiptRuntimeMode } from './receipt-store.js';

export const OPERATOR_SLICE_SCHEMA_VERSION = '1';
export const OPERATOR_SLICE_FLAG = 'rc05.operatorSlice';

export type OperatorSliceOptions = {
  /** Feature flag; default-off. Kill switch restores the legacy path. */
  enabled?: boolean;
  database?: { env?: NodeJS.ProcessEnv; path?: string };
  /** Bounded effect root dir for the file effect. */
  effectRootDir?: string;
  runtimeMode?: RuntimeReceiptRuntimeMode;
};

export type OperatorSliceIdentity = {
  sessionKey: string;
  runId: string;
  traceId?: string;
  cronJobId?: string;
  inboxItemId?: string;
};

export type OperatorEffect =
  | { kind: 'file'; path: string; content: string }
  | { kind: 'message'; text: string };

export type OperatorSliceRunResult =
  | { ok: true; effectReceiptId: string; approvalId: string; state: string }
  | { ok: false; reason: 'denied' | 'not-approved' | 'unknown' | 'duplicate' | 'error'; approvalId?: string; message?: string };

/**
 * Run one Operator slice turn: reserve approval, require operator approval,
 * apply exactly one bounded effect, record an EffectReceipt, and project the
 * delivery. All writes are durable and idempotent; a denial produces zero
 * effect; an unknown outcome stops in needs_reconciliation.
 */
export function runOperatorSlice(input: {
  identity: OperatorSliceIdentity;
  effect: OperatorEffect;
  requestJson: Record<string, unknown>;
  approvalDecision: 'approved' | 'denied';
  resolvedBy?: string;
  options: OperatorSliceOptions;
}): OperatorSliceRunResult {
  if (input.options.enabled !== true) {
    return { ok: false, reason: 'error', message: 'operator slice flag is off' };
  }
  const database = input.options.database ?? {};
  const ledger = new ApprovalLedger(database);
  const effects = new EffectReceiptStore(database);
  const idempotencyKey = `op:${input.identity.runId}:${input.identity.sessionKey}`;

  // 1. Reserve the intent -> approval_pending in the durable ledger.
  const reserved = ledger.reserve({
    idempotencyKey,
    request: input.requestJson,
    expiresAtMs: Date.now() + 60_000,
    requestedByClientId: 'cron-ingress',
  });
  if (!reserved.ok) {
    return { ok: false, reason: 'error', message: 'approval reserve failed' };
  }
  const approvalId = reserved.row.approval_id;

  // Duplicate detection: if the same idempotency key already reached a terminal
  // state (reconciled/needs_reconciliation), a repeated turn is a duplicate and
  // must not re-apply any effect.
  if (reserved.row.state === 'reconciled' || reserved.row.state === 'needs_reconciliation') {
    return { ok: false, reason: 'duplicate', approvalId };
  }

  // 2. Resolve the approval.
  const resolved = ledger.resolve({
    approvalId,
    decision: input.approvalDecision,
    resolvedBy: input.resolvedBy,
  });
  if (!resolved.ok) {
    // A failed resolve after the duplicate guard means the approval left
    // approval_pending (state-conflict) — treat as duplicate/not-reapplyable.
    return { ok: false, reason: 'duplicate', approvalId };
  }
  if (resolved.row.state === 'denied') {
    return { ok: false, reason: 'denied', approvalId };
  }

  // 3. Mark execution started.
  const started = ledger.markExecutionStarted(approvalId);
  if (!started.ok) {
    return { ok: false, reason: 'not-approved', approvalId };
  }

  // 4. Apply exactly one bounded effect (file or message), then record the
  //    EffectReceipt. Duplicate application is prevented by the idempotency key.
  let outcome: 'applied' | 'unknown' = 'applied';
  let journalRef: string | undefined;
  try {
    if (input.effect.kind === 'file') {
      journalRef = applyBoundedFileEffect(input.effect, input.options.effectRootDir);
    } else {
      journalRef = applyMessageEffect(input.effect.text, input.identity);
    }
  } catch {
    outcome = 'unknown';
  }

  const effectResult = effects.record({
    idempotencyKey: `efx:${idempotencyKey}`,
    approvalId,
    proposal: input.requestJson,
    approvalDecision: input.approvalDecision,
    domainExecutor: 'operator-slice',
    outcome,
    journalRef,
    recoverability: outcome === 'applied' ? 'none-needed' : 'reconcile-from-journal',
  });
  if (!effectResult.ok) {
    return { ok: false, reason: 'duplicate', approvalId };
  }

  // 5. Record the effect outcome in the ledger (unknown -> needs_reconciliation).
  const outcomeRecorded = ledger.recordEffectOutcome({
    approvalId,
    outcome,
    effectReceiptId: effectResult.effectReceiptId,
    domainJournalRef: journalRef,
  });

  if (outcome === 'applied') {
    return {
      ok: true,
      effectReceiptId: effectResult.effectReceiptId,
      approvalId,
      state: outcomeRecorded.ok ? outcomeRecorded.row.state : 'unknown',
    };
  }
  return { ok: false, reason: 'unknown', approvalId };
}

/**
 * Recovery after restart: load the pending approval from the durable ledger and
 * re-attach the delivery projection. Pending/completed truth survives restart.
 */
export function recoverOperatorSlice(input: {
  identity: OperatorSliceIdentity;
  options: OperatorSliceOptions;
}): { approval?: string; state?: string; recovery: 'recovered' | 'none' } {
  const database = input.options.database ?? {};
  const ledger = new ApprovalLedger(database);
  const key = `op:${input.identity.runId}:${input.identity.sessionKey}`;
  const row = ledger.getByIdempotencyKey(key);
  if (!row) {
    return { recovery: 'none' };
  }
  return { approval: row.approval_id, state: row.state, recovery: 'recovered' };
}

/** Project the delivery lineage (context/effect/recovery) for the UI. */
export function projectOperatorLineage(input: {
  identity: OperatorSliceIdentity;
  options: OperatorSliceOptions;
}): {
  contextReceipt?: string;
  effectReceipt?: string;
  approval?: string;
  recovery: string;
  lineage: string[];
} {
  const database = input.options.database ?? {};
  const effects = new EffectReceiptStore(database);
  const lineage: string[] = [];
  const recovery = recoverOperatorSlice(input);
  lineage.push(`context:${input.identity.sessionKey}`);
  if (recovery.approval) lineage.push(`approval:${recovery.approval}:${recovery.state}`);
  const rows = recovery.approval ? effects.listByApproval(recovery.approval) : [];
  const effectRow = rows[0];
  if (effectRow) {
    lineage.push(`effect:${effectRow.effect_receipt_id}:${effectRow.outcome}`);
    lineage.push(`recovery:${effectRow.recoverability}`);
  }
  return {
    effectReceipt: effectRow?.effect_receipt_id,
    approval: recovery.approval,
    recovery: recovery.recovery,
    lineage,
  };
}

function applyBoundedFileEffect(effect: { path: string; content: string }, rootDir?: string): string {
  const root = rootDir ?? process.cwd();
  const target = join(root, effect.path);
  // Bounded: only write inside the effect root.
  if (!target.startsWith(`${root}${sep}`) && target !== root) {
    throw new Error(`effect path escapes bounded root: ${effect.path}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  appendFileSync(target, `${effect.content}\n`, 'utf8');
  return `journal:file:${effect.path}`;
}

function applyMessageEffect(text: string, identity: OperatorSliceIdentity): string {
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 12);
  return `journal:message:${identity.sessionKey}:${digest}`;
}
