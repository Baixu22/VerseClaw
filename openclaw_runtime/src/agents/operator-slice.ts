// RC-05 minimal Operator governance slice. Ties the automated primary path:
// Cron ingress -> run identity -> DCS receipts -> desktop Inbox -> durable
// approval (RC-04) -> one bounded file/message effect -> EffectReceipt ->
// process restart -> recovery -> delivery projection. Duplicate effect count is
// zero, a denial produces zero effect, and restart preserves pending/completed
// truth from RC-04. The channel-conformance fixture proves the same contract
// without a real external account.
//
// Governance: a Cron ingress NEVER auto-approves inline. It only creates the
// approval intent (intent_reserved -> approval_pending). Approval comes from a
// real governance decision (explicit policy rule or Inbox operator decision);
// the actor is recorded on the durable ledger row (resolved_by) and the policy
// digest is bound into the EffectReceipt proposal digest (verifiable audit
// trail).
//
// Effect ordering: execution_started is written BEFORE the real domain
// executor runs; applied/not_applied/unknown is written AFTER the executor
// returns its outcome. The ledger is never marked applied/reconciled before a
// channel send.
import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { ApprovalLedger, OPERATOR_INTENT_CLIENT_ID } from './approval-ledger.js';
import { EffectReceiptStore } from './effect-receipt.js';
import { ReceiptStore, type RuntimeReceiptRuntimeMode } from './receipt-store.js';
import { canonicalJsonValue } from './approval-ledger.js';

export const OPERATOR_SLICE_SCHEMA_VERSION = '1';
export const OPERATOR_SLICE_FLAG = 'rc05.operatorSlice';
export const OPERATOR_SLICE_ACTOR = OPERATOR_INTENT_CLIENT_ID;
export const OPERATOR_DEFAULT_POLICY_RULE = 'cron-announce-under-operator-slice';

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

export type OperatorEffectOutcome = {
  outcome: 'applied' | 'not_applied' | 'unknown';
  journalRef?: string;
  error?: string;
};

/** Real domain executor: performs the bounded effect and reports the outcome. */
export type OperatorEffectExecutor = (
  effect: OperatorEffect,
  identity: OperatorSliceIdentity,
) => OperatorEffectOutcome | Promise<OperatorEffectOutcome>;

/** Governance decision: actor + policy digest, never a raw inline flag. */
export type OperatorGovernanceDecision = {
  decision: 'approved' | 'denied';
  actor: string;
  /** SHA-256 of the canonical policy rule that produced the decision. */
  policyDigest: string;
};

export type OperatorSliceRunResult =
  | { ok: true; effectReceiptId: string; approvalId: string; state: string }
  | { ok: false; reason: 'denied' | 'not-approved' | 'governance-mismatch' | 'unknown' | 'duplicate' | 'error'; approvalId?: string; message?: string };

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Real governance policy: an explicit, auditable policy rule. The policyDigest
 * binds the exact rule text + decision so the ledger records which rule
 * produced the approval. A missing rule or a denied decision is never approved.
 */
export function resolveOperatorGovernancePolicy(input: {
  policyRule: string;
  decision: 'approved' | 'denied';
  actor?: string;
}): OperatorGovernanceDecision {
  const rule = input.policyRule.trim();
  if (!rule) {
    return { decision: 'denied', actor: input.actor ?? 'governance-policy', policyDigest: sha256Text('deny:empty-rule') };
  }
  const policyDigest = sha256Text(canonicalJsonValue({ rule, decision: input.decision }));
  return { decision: input.decision, actor: input.actor ?? 'governance-policy', policyDigest };
}

function identityIdempotencyKey(identity: OperatorSliceIdentity): string {
  return `op:${identity.runId}:${identity.sessionKey}`;
}

function openLedger(options: OperatorSliceOptions): ApprovalLedger {
  return new ApprovalLedger(options.database ?? {});
}

function openEffects(options: OperatorSliceOptions): EffectReceiptStore {
  return new EffectReceiptStore(options.database ?? {});
}

/**
 * Step 1 (Cron ingress): reserve the intent -> approval_pending in the durable
 * ledger. This is the ONLY thing a Cron ingress may do; it never resolves.
 * Idempotent under the same identity idempotency key.
 */
export function createOperatorSliceIntent(input: {
  identity: OperatorSliceIdentity;
  requestJson: Record<string, unknown>;
  options: OperatorSliceOptions;
}): { ok: true; approvalId: string; state: string } | { ok: false; reason: 'duplicate' | 'error'; approvalId?: string; message?: string } {
  if (input.options.enabled !== true) {
    return { ok: false, reason: 'error', message: 'operator slice flag is off' };
  }
  const ledger = openLedger(input.options);
  const reserved = ledger.reserve({
    idempotencyKey: identityIdempotencyKey(input.identity),
    request: input.requestJson,
    expiresAtMs: Date.now() + 60_000,
    requestedByClientId: OPERATOR_SLICE_ACTOR,
  });
  if (!reserved.ok) {
    return { ok: false, reason: 'error', message: 'approval reserve failed' };
  }
  if (reserved.row.state === 'reconciled' || reserved.row.state === 'needs_reconciliation') {
    return { ok: false, reason: 'duplicate', approvalId: reserved.row.approval_id };
  }
  return { ok: true, approvalId: reserved.row.approval_id, state: reserved.row.state };
}

/** Governance decision recorded by the desktop Inbox. */
export function inboxGovernanceDecision(input: {
  decision: 'approved' | 'denied';
  actor: string;
}): OperatorGovernanceDecision {
  // The digest binds the Inbox decision rule and is always computed
  // server-side; a client-supplied digest is never trusted.
  const policyDigest = sha256Text(`inbox-operator-decision:v1:${input.decision}`);
  return { decision: input.decision, actor: input.actor, policyDigest };
}

export const OPERATOR_INBOX_TIMEOUT_ACTOR = 'operator-inbox-timeout';

/**
 * Step 2 (Inbox governance): wait for the desktop Inbox to decide a pending
 * intent. The durable ledger is the only channel between the Inbox and the
 * waiting ingress. When the intent expires undecided it is denied as
 * OPERATOR_INBOX_TIMEOUT_ACTOR (zero effect); a concurrent Inbox decision
 * that lands first wins the CAS.
 */
export async function awaitOperatorInboxDecision(input: {
  approvalId: string;
  options: OperatorSliceOptions;
  pollMs?: number;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<{ ok: true; governance: OperatorGovernanceDecision } | { ok: false; reason: 'denied' | 'error'; message?: string }> {
  const ledger = openLedger(input.options);
  const now = input.now ?? Date.now;
  const pollMs = input.pollMs ?? 250;
  for (;;) {
    const row = ledger.getById(input.approvalId);
    if (!row) return { ok: false, reason: 'error', message: 'approval intent not found' };
    if (row.state !== 'approval_pending') {
      if (row.state === 'approved' && row.resolved_by) {
        return { ok: true, governance: inboxGovernanceDecision({ decision: 'approved', actor: row.resolved_by }) };
      }
      return { ok: false, reason: 'denied', message: `inbox decision ${row.state}` };
    }
    if (input.signal?.aborted || row.expires_at_ms <= now()) {
      const expired = ledger.resolve({
        approvalId: input.approvalId,
        decision: 'denied',
        resolvedBy: OPERATOR_INBOX_TIMEOUT_ACTOR,
      });
      if (!expired.ok && expired.row?.state === 'approved') continue;
      return { ok: false, reason: 'denied', message: 'inbox decision timed out' };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
/**
 * Step 2 (governance): resolve the approval from a real governance decision.
 * Denied approvals never start execution and produce zero effect.
 */
export function resolveOperatorSliceApproval(input: {
  approvalId: string;
  governance: OperatorGovernanceDecision;
  options: OperatorSliceOptions;
}): { ok: true; state: string } | { ok: false; reason: 'denied' | 'duplicate' | 'error'; message?: string } {
  const ledger = openLedger(input.options);
  const resolved = ledger.resolve({
    approvalId: input.approvalId,
    decision: input.governance.decision,
    resolvedBy: input.governance.actor,
  });
  if (!resolved.ok) {
    return { ok: false, reason: 'duplicate', message: resolved.reason };
  }
  if (resolved.row.state === 'denied') {
    return { ok: false, reason: 'denied', message: 'governance denied' };
  }
  return { ok: true, state: resolved.row.state };
}

/**
 * Step 3 (execute): write execution_started FIRST, run the real domain
 * executor, then record applied/not_applied/unknown from the executor outcome
 * plus an EffectReceipt. The ledger is never marked applied/reconciled before
 * the executor ran.
 */
export async function executeOperatorSliceEffect(input: {
  identity: OperatorSliceIdentity;
  approvalId: string;
  effect: OperatorEffect;
  governance: OperatorGovernanceDecision;
  executor: OperatorEffectExecutor;
  options: OperatorSliceOptions;
}): Promise<OperatorSliceRunResult> {
  const ledger = openLedger(input.options);
  const effects = openEffects(input.options);
  // Governance binding check: the executor may NOT substitute its own
  // governance identity. The approval must exist, be approved, and carry the
  // exact actor that resolved it (the ledger row is the durable decision
  // record; a mismatched caller is rejected before any effect runs).
  const approvalRow = ledger.getById(input.approvalId);
  if (!approvalRow || approvalRow.state !== 'approved' || approvalRow.decision !== 'approved') {
    return { ok: false, reason: 'not-approved', approvalId: input.approvalId };
  }
  if (approvalRow.resolved_by !== input.governance.actor) {
    return { ok: false, reason: 'governance-mismatch', approvalId: input.approvalId };
  }
  const started = ledger.markExecutionStarted(input.approvalId);
  if (!started.ok) {
    // Exactly one caller wins execution_started: a concurrent second caller
    // (or a replay) is rejected here and never reaches the executor.
    return { ok: false, reason: 'not-approved', approvalId: input.approvalId };
  }

  let outcome: OperatorEffectOutcome;
  try {
    outcome = await input.executor(input.effect, input.identity);
  } catch (err) {
    // The executor failed without a declared outcome: journal recovery only.
    outcome = {
      outcome: 'unknown',
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (outcome.outcome !== 'applied' && outcome.outcome !== 'not_applied' && outcome.outcome !== 'unknown') {
    outcome = { outcome: 'unknown', error: 'executor returned an invalid outcome' };
  }

  const idempotencyKey = identityIdempotencyKey(input.identity);
  const effectResult = effects.record({
    idempotencyKey: `efx:${idempotencyKey}`,
    approvalId: input.approvalId,
    // The proposal binds the governance decision (actor + policyDigest) so the
    // receipt digest is a verifiable audit trail of who approved under which
    // policy rule — the ledger row keeps resolved_by (actor) as the durable
    // decision record.
    proposal: { effect: input.effect, identity: input.identity, governance: input.governance },
    approvalDecision: input.governance.decision,
    domainExecutor: 'operator-slice',
    outcome: outcome.outcome,
    journalRef: outcome.journalRef,
    recoverability: outcome.outcome === 'applied' ? 'none-needed' : 'reconcile-from-journal',
  });
  if (!effectResult.ok) {
    return { ok: false, reason: 'duplicate', approvalId: input.approvalId };
  }

  const outcomeRecorded = ledger.recordEffectOutcome({
    approvalId: input.approvalId,
    outcome: outcome.outcome,
    effectReceiptId: effectResult.effectReceiptId,
    domainJournalRef: outcome.journalRef,
  });

  if (outcome.outcome === 'applied') {
    return {
      ok: true,
      effectReceiptId: effectResult.effectReceiptId,
      approvalId: input.approvalId,
      state: outcomeRecorded.ok ? outcomeRecorded.row.state : 'unknown',
    };
  }
  return { ok: false, reason: outcome.outcome === 'unknown' ? 'unknown' : 'not-approved', approvalId: input.approvalId };
}

const builtinFileExecutor =
  (effectRootDir?: string): OperatorEffectExecutor =>
  (effect, _identity) => {
    if (effect.kind !== 'file') {
      return { outcome: 'not_applied', error: 'builtin executor only handles file effects' };
    }
    try {
      return { outcome: 'applied', journalRef: applyBoundedFileEffect(effect, effectRootDir) };
    } catch (err) {
      return { outcome: 'unknown', error: err instanceof Error ? err.message : String(err) };
    }
  };

/**
 * One-shot compatibility runner (sync, builtin file executor). Production
 * callers use createOperatorSliceIntent + resolveOperatorSliceApproval +
 * executeOperatorSliceEffect with their real executor.
 */
export function runOperatorSlice(input: {
  identity: OperatorSliceIdentity;
  effect: OperatorEffect;
  requestJson: Record<string, unknown>;
  governance: OperatorGovernanceDecision;
  executor?: OperatorEffectExecutor;
  options: OperatorSliceOptions;
}): OperatorSliceRunResult {
  const intent = createOperatorSliceIntent(input);
  if (!intent.ok) {
    return { ok: false, reason: intent.reason, approvalId: intent.approvalId };
  }
  const resolved = resolveOperatorSliceApproval({
    approvalId: intent.approvalId,
    governance: input.governance,
    options: input.options,
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, approvalId: intent.approvalId };
  }
  const executor = input.executor ?? builtinFileExecutor(input.options.effectRootDir);
  if (input.effect.kind === 'message' && input.executor === undefined) {
    // A message effect without a real executor is not applied (no fake send).
    return { ok: false, reason: 'not-approved', approvalId: intent.approvalId, message: 'message effect requires a real executor' };
  }
  // Synchronous executor path only; async executors use executeOperatorSliceEffect.
  const started = openLedger(input.options).markExecutionStarted(intent.approvalId);
  if (!started.ok) {
    return { ok: false, reason: 'not-approved', approvalId: intent.approvalId };
  }
  const outcome = executor(input.effect, input.identity) as OperatorEffectOutcome;
  const effects = openEffects(input.options);
  const idempotencyKey = identityIdempotencyKey(input.identity);
  const effectResult = effects.record({
    idempotencyKey: `efx:${idempotencyKey}`,
    approvalId: intent.approvalId,
    proposal: { effect: input.effect, identity: input.identity, governance: input.governance },
    approvalDecision: input.governance.decision,
    domainExecutor: 'operator-slice',
    outcome: outcome.outcome,
    journalRef: outcome.journalRef,
    recoverability: outcome.outcome === 'applied' ? 'none-needed' : 'reconcile-from-journal',
  });
  if (!effectResult.ok) {
    return { ok: false, reason: 'duplicate', approvalId: intent.approvalId };
  }
  const outcomeRecorded = openLedger(input.options).recordEffectOutcome({
    approvalId: intent.approvalId,
    outcome: outcome.outcome,
    effectReceiptId: effectResult.effectReceiptId,
    domainJournalRef: outcome.journalRef,
  });
  if (outcome.outcome === 'applied') {
    return {
      ok: true,
      effectReceiptId: effectResult.effectReceiptId,
      approvalId: intent.approvalId,
      state: outcomeRecorded.ok ? outcomeRecorded.row.state : 'unknown',
    };
  }
  return { ok: false, reason: outcome.outcome === 'unknown' ? 'unknown' : 'not-approved', approvalId: intent.approvalId };
}

/**
 * Recovery after restart: load the pending approval from the durable ledger and
 * re-attach the delivery projection. Pending/completed truth survives restart.
 */
export function recoverOperatorSlice(input: {
  identity: OperatorSliceIdentity;
  options: OperatorSliceOptions;
}): { approval?: string; state?: string; recovery: 'recovered' | 'none' } {
  const ledger = openLedger(input.options);
  const row = ledger.getByIdempotencyKey(identityIdempotencyKey(input.identity));
  if (!row) {
    return { recovery: 'none' };
  }
  return { approval: row.approval_id, state: row.state, recovery: 'recovered' };
}

/**
 * Project the delivery lineage (context/effect/recovery) for the UI. Context
 * refs come from REAL ContextReceipt rows (runtime_receipts), never fabricated
 * `context:<sessionKey>` refs.
 */
export function projectOperatorLineage(input: {
  identity: OperatorSliceIdentity;
  options: OperatorSliceOptions;
}): {
  contextReceipts: string[];
  effectReceipt?: string;
  approval?: string;
  recovery: string;
  lineage: string[];
} {
  const database = input.options.database ?? {};
  const effects = openEffects(input.options);
  const receipts = new ReceiptStore(database);
  const lineage: string[] = [];
  const recovery = recoverOperatorSlice(input);
  if (recovery.approval) lineage.push(`approval:${recovery.approval}:${recovery.state}`);

  // Real ContextReceipt rows for this run identity (kind=context).
  const contextRows = receipts.list({ runId: input.identity.runId, kind: 'context', limit: 20 });
  const contextReceipts = contextRows.map((row) => row.receipt_id);
  for (const receiptId of contextReceipts) {
    lineage.push(`context:${receiptId}`);
  }

  const rows = recovery.approval ? effects.listByApproval(recovery.approval) : [];
  const effectRow = rows[0];
  if (effectRow) {
    lineage.push(`effect:${effectRow.effect_receipt_id}:${effectRow.outcome}`);
    lineage.push(`recovery:${effectRow.recoverability}`);
  }
  return {
    contextReceipts,
    effectReceipt: effectRow?.effect_receipt_id,
    approval: recovery.approval,
    recovery: recovery.recovery,
    lineage,
  };
}

function applyBoundedFileEffect(effect: { path: string; content: string }, rootDir?: string): string {
  const root = rootDir ?? process.cwd();
  // Security review fix: resolve the real (symlink-free) root and target so a
  // symlink inside the root cannot escape the bounded effect directory.
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    canonicalRoot = resolve(root);
  }
  const target = resolve(canonicalRoot, effect.path);
  if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error(`effect path escapes bounded root: ${effect.path}`);
  }
  // Create the parent chain first, then realpath the REAL parent so a symlinked
  // intermediate directory cannot smuggle the write outside the root (security
  // review residual LOW: realpath of a non-existent leaf is not meaningful).
  mkdirSync(dirname(target), { recursive: true });
  const canonicalDir = realpathSync(dirname(target));
  const canonicalTarget = join(canonicalDir, basename(target));
  if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error(`effect path escapes bounded root via symlink: ${effect.path}`);
  }
  // A pre-existing leaf symlink must not redirect the write outside the root:
  // reject symlink leaves outright (lstat does not follow the link).
  try {
    const leafStat = lstatSync(canonicalTarget);
    if (leafStat.isSymbolicLink()) {
      throw new Error(`effect path is a symlink leaf: ${effect.path}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    // ENOENT: new file, safe to append.
  }
  appendFileSync(canonicalTarget, `${effect.content}\n`, 'utf8');
  return `journal:file:${effect.path}`;
}

function applyMessageEffect(text: string, identity: OperatorSliceIdentity): string {
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 12);
  return `journal:message:${identity.sessionKey}:${digest}`;
}

export { applyBoundedFileEffect, applyMessageEffect };
