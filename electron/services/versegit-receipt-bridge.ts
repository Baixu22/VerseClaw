/**
 * WP3 VerseShell receipt bridge.
 *
 * The bridge owns only plan/receipt interpretation. It never executes a process,
 * never accepts a caller-authored receipt and never turns a structural fixture into
 * a live verification claim.
 */
import { createHash } from 'node:crypto';
export const VG_COMMAND_PLAN_SCHEMA = 'clawx.versegit.command-plan/v1' as const;

export const VG_RECEIPT_SCHEMA = 'clawx.verseshell.execution-receipt/v2';
export const VG_VERDICT_SCHEMA = 'clawx.versegit.receipt-verdict/v1';
export const VG_RECEIPT_REQUIRED_BINDINGS = [
  'planId', 'planDigest', 'candidateId', 'checkId', 'ownerId', 'epoch', 'authorizationId',
  'argvDigest', 'cwdDigest', 'envDigest', 'executionInputDigest', 'requiredScope',
  'artifactDigests', 'cleanupStatus',
] as const;

export type VerificationPlan = {
  schema: typeof VG_COMMAND_PLAN_SCHEMA;
  runId: string;
  candidateId: string;
  checkId: string;
  owner: string;
  epoch: number;
  authorizationId: string;
  commands: Array<{
    argv: string[];
    cwd: string;
    env: Record<string, string>;
    effect: 'none' | 'read' | 'write' | 'process' | 'network' | 'execute';
    retry: 'never' | 'once';
    expectedArtifacts: string[];
  }>;
  requiredScope: 'full' | 'selected';
  planDigest?: string;
};

export type VerseShellReceipt = {
  schema: typeof VG_RECEIPT_SCHEMA;
  receiptId: string;
  planId: string;
  planDigest: string;
  candidateId: string;
  checkId: string;
  ownerId: string;
  epoch: number;
  authorizationId: string;
  argvDigest: string;
  cwdDigest: string;
  envDigest: string;
  executionInputDigest: string;
  requiredScope: 'full' | 'selected';
  artifactDigests: string[];
  cleanupStatus: 'clean' | 'recovery_required' | 'failed';
  status: 'exited' | 'timed-out' | 'cancelled' | 'lost';
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdoutDigest: string;
  stderrDigest: string;
  processKey: string;
  authority: { writer: 'verseshell'; trusted_source: 'clawx-host-process-artifact-authority' };
  origin: 'verseshell' | 'host-fixture';
  realVerseshell: boolean;
};

export type ReceiptResult = {
  status: 'accepted' | 'duplicate' | 'rejected_by_policy';
  reason: string;
  issues: string[];
  hostVerdict: 'unchanged';
};

export type VerdictFacts = {
  schema: typeof VG_VERDICT_SCHEMA;
  planId: string | null;
  receiptId: string | null;
  status: 'observed' | 'partial' | 'unavailable' | 'rejected_by_policy';
  reasons: string[];
  dimensions: {
    candidate: string;
    execution: string;
    evidence: string;
    freshness: string;
    risk: string;
    trial: string;
  };
  evidenceGrade: 'direct-receipt' | 'normalized-event' | 'none';
  realVerseshellExecution: boolean;
  hostVerdict: 'unchanged';
  singleGreenLight: false;
  issues: string[];
};

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function isDigest(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value); }
function nonEmpty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }

export function planDigest(plan: VerificationPlan): string { return digest({ ...plan, planDigest: undefined }); }

export function createVerificationPlan(input: Omit<VerificationPlan, 'schema' | 'planDigest'>): { plan: VerificationPlan | null; issues: string[] } {
  const plan: VerificationPlan = { schema: VG_COMMAND_PLAN_SCHEMA, ...input };
  const issues: string[] = [];
  if (!nonEmpty(plan.runId) || !nonEmpty(plan.candidateId) || !nonEmpty(plan.checkId) || !nonEmpty(plan.owner)) issues.push('plan identity fields are invalid');
  if (!Number.isInteger(plan.epoch) || plan.epoch < 1 || !nonEmpty(plan.authorizationId)) issues.push('plan authorization fields are invalid');
  if (!['full', 'selected'].includes(plan.requiredScope)) issues.push('plan requiredScope is invalid');
  if (!Array.isArray(plan.commands) || plan.commands.length === 0) issues.push('plan commands must be non-empty');
  for (const command of plan.commands ?? []) {
    if (!Array.isArray(command.argv) || command.argv.length === 0 || command.argv.some((arg) => typeof arg !== 'string')) issues.push('plan command argv is invalid');
    if (!['none', 'read', 'write', 'process', 'network', 'execute'].includes(command.effect)) issues.push('plan command effect is invalid');
    if (!['never', 'once'].includes(command.retry)) issues.push('plan command retry is invalid');
    if (!nonEmpty(command.cwd)) issues.push('plan command cwd is invalid');
  }
  if (issues.length > 0) return { plan: null, issues };
  plan.planDigest = planDigest(plan);
  return { plan, issues: [] };
}

export function validateReceipt(plan: VerificationPlan, receipt: unknown): ReceiptResult {
  const issues: string[] = [];
  if (!isRecord(receipt)) return { status: 'rejected_by_policy', reason: 'invalid_receipt', issues: ['receipt must be an object'], hostVerdict: 'unchanged' };
  const value = receipt as Record<string, unknown>;
  if (value.schema !== VG_RECEIPT_SCHEMA) issues.push('receipt schema mismatch');
  for (const field of VG_RECEIPT_REQUIRED_BINDINGS) if (value[field] === undefined) issues.push(`receipt missing ${field}`);
  if (!value.authority || !isRecord(value.authority)
    || value.authority.writer !== 'verseshell'
    || value.authority.trusted_source !== 'clawx-host-process-artifact-authority') issues.push('receipt authority is not VerseShell host-owned');
  if (value.planId !== plan.runId) issues.push('receipt planId mismatch');
  if (value.planDigest !== plan.planDigest) issues.push('receipt planDigest mismatch');
  if (value.candidateId !== plan.candidateId) issues.push('receipt candidateId mismatch');
  if (value.checkId !== plan.checkId) issues.push('receipt checkId mismatch');
  if (value.ownerId !== plan.owner) issues.push('receipt ownerId mismatch');
  if (value.epoch !== plan.epoch) issues.push('receipt epoch mismatch');
  if (value.authorizationId !== plan.authorizationId) issues.push('receipt authorizationId mismatch');
  if (value.requiredScope !== 'full') issues.push('receipt scope is not full');
  if (value.selected_scope === 'full') issues.push('receipt may not self-claim selected scope as full');
  if (!Array.isArray(value.artifactDigests) || value.artifactDigests.length === 0 || !value.artifactDigests.every(isDigest)) issues.push('receipt artifact digests are missing or invalid');
  if (value.cleanupStatus !== 'clean') issues.push('receipt cleanup is not clean');
  if (!['exited', 'timed-out', 'cancelled', 'lost'].includes(String(value.status))) issues.push('receipt status is invalid');
  const command = plan.commands[0];
  if (value.argvDigest !== digest(command?.argv)) issues.push('receipt argv digest mismatch');
  if (value.cwdDigest !== digest(command?.cwd)) issues.push('receipt cwd digest mismatch');
  if (value.envDigest !== digest(command?.env)) issues.push('receipt env digest mismatch');
  if (value.executionInputDigest !== digest({ argv: command?.argv, cwd: command?.cwd, env: command?.env })) issues.push('receipt execution input digest mismatch');
  if (issues.length > 0) return { status: 'rejected_by_policy', reason: issues[0] ?? 'receipt_rejected', issues, hostVerdict: 'unchanged' };
  return { status: 'accepted', reason: 'receipt_bound', issues: [], hostVerdict: 'unchanged' };
}

export class VerseGitReceiptBridge {
  private readonly plans = new Map<string, VerificationPlan>();
  private readonly receipts = new Map<string, { receipt: VerseShellReceipt; result: ReceiptResult }>();

  registerPlan(plan: VerificationPlan): ReceiptResult {
    if (!plan.planDigest || planDigest(plan) !== plan.planDigest) return { status: 'rejected_by_policy', reason: 'plan_digest_invalid', issues: ['plan digest is not reproducible'], hostVerdict: 'unchanged' };
    if (this.plans.has(plan.runId)) return { status: 'duplicate', reason: 'duplicate_plan', issues: ['plan already registered'], hostVerdict: 'unchanged' };
    this.plans.set(plan.runId, plan);
    return { status: 'accepted', reason: 'plan_registered', issues: [], hostVerdict: 'unchanged' };
  }

  receive(planId: string, receipt: unknown): ReceiptResult {
    const plan = this.plans.get(planId);
    if (!plan) return { status: 'rejected_by_policy', reason: 'unknown_plan', issues: ['receipt references an unknown plan'], hostVerdict: 'unchanged' };
    if (!isRecord(receipt) || !nonEmpty(receipt.receiptId)) return { status: 'rejected_by_policy', reason: 'invalid_receipt_id', issues: ['receipt id missing'], hostVerdict: 'unchanged' };
    if (this.receipts.has(receipt.receiptId as string)) return { status: 'duplicate', reason: 'duplicate_receipt', issues: ['receipt id was already consumed'], hostVerdict: 'unchanged' };
    const result = validateReceipt(plan, receipt);
    if (result.status === 'accepted') this.receipts.set(receipt.receiptId as string, { receipt: receipt as VerseShellReceipt, result });
    return result;
  }

  verdict(planId: string): VerdictFacts {
    const plan = this.plans.get(planId);
    const accepted = [...this.receipts.values()].find((entry) => entry.receipt.planId === planId);
    if (!plan || !accepted) {
      return {
        schema: VG_VERDICT_SCHEMA, planId: plan?.runId ?? null, receiptId: null, status: 'partial', reasons: ['unmeasured'],
        dimensions: { candidate: 'unknown', execution: 'unmeasured', evidence: 'missing', freshness: 'unknown', risk: 'unknown', trial: 'not_run' },
        evidenceGrade: 'none', realVerseshellExecution: false, hostVerdict: 'unchanged', singleGreenLight: false,
        issues: ['no host-authoritative receipt'],
      };
    }
    const receipt = accepted.receipt;
    const success = receipt.status === 'exited' && receipt.exitCode === 0 && receipt.realVerseshell;
    return {
      schema: VG_VERDICT_SCHEMA, planId, receiptId: receipt.receiptId,
      status: receipt.realVerseshell ? 'observed' : 'partial',
      reasons: receipt.realVerseshell ? [] : ['unmeasured'],
      dimensions: {
        candidate: 'observed', execution: success ? 'verified' : receipt.realVerseshell ? 'failed' : 'unmeasured',
        evidence: 'receipt-bound', freshness: `epoch:${receipt.epoch}`, risk: 'unknown', trial: 'not_run',
      },
      evidenceGrade: receipt.realVerseshell ? 'direct-receipt' : 'normalized-event',
      realVerseshellExecution: receipt.realVerseshell, hostVerdict: 'unchanged', singleGreenLight: false,
      issues: receipt.realVerseshell ? [] : ['structural receipt fixture; no live VerseShell authority claimed'],
    };
  }
}