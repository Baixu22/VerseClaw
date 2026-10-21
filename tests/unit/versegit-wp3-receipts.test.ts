import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  VG_RECEIPT_SCHEMA,
  VerseGitReceiptBridge,
  createVerificationPlan,
  planDigest,
} from '../../electron/services/versegit-receipt-bridge';

const planInput = {
  runId: 'run-wp3', candidateId: 'candidate-wp3', checkId: 'check-wp3', owner: 'owner-wp3', epoch: 2, authorizationId: 'auth-wp3',
  commands: [{ argv: ['node', '--version'], cwd: 'repo-relative', env: { CI: '1' }, effect: 'read' as const, retry: 'never' as const, expectedArtifacts: ['stdout'] }],
  requiredScope: 'full' as const,
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function receipt(plan: ReturnType<typeof createVerificationPlan>['plan'], id = 'receipt-1') {
  if (!plan) throw new Error('plan missing');
  const command = plan.commands[0];
  return {
    schema: VG_RECEIPT_SCHEMA, receiptId: id, planId: plan.runId, planDigest: plan.planDigest,
    candidateId: plan.candidateId, checkId: plan.checkId, ownerId: plan.owner, epoch: plan.epoch, authorizationId: plan.authorizationId,
    argvDigest: hash(command.argv), cwdDigest: hash(command.cwd), envDigest: hash(command.env), executionInputDigest: hash({ argv: command.argv, cwd: command.cwd, env: command.env }),
    requiredScope: 'full', artifactDigests: ['a'.repeat(64)], cleanupStatus: 'clean', status: 'exited', exitCode: 0, signal: null,
    durationMs: 1, stdoutDigest: 'b'.repeat(64), stderrDigest: 'c'.repeat(64), processKey: 'p-1',
    authority: { writer: 'verseshell', trusted_source: 'clawx-host-process-artifact-authority' }, origin: 'host-fixture', realVerseshell: false,
  };
}

describe('WP3 VerseShell receipt bridge', () => {
  it('creates a digest-bound full-scope plan', () => {
    const created = createVerificationPlan(planInput);
    expect(created.issues).toEqual([]);
    expect(created.plan?.planDigest).toBe(planDigest(created.plan!));
    expect(created.plan?.requiredScope).toBe('full');
  });

  it('binds a structural receipt without claiming live execution', () => {
    const created = createVerificationPlan(planInput);
    const bridge = new VerseGitReceiptBridge();
    expect(bridge.registerPlan(created.plan!).status).toBe('accepted');
    expect(bridge.receive(created.plan!.runId, receipt(created.plan)).status).toBe('accepted');
    const verdict = bridge.verdict(created.plan!.runId);
    expect(verdict.status).toBe('partial');
    expect(verdict.reasons).toContain('unmeasured');
    expect(verdict.realVerseshellExecution).toBe(false);
    expect(verdict.dimensions.execution).toBe('unmeasured');
    expect(verdict.hostVerdict).toBe('unchanged');
    expect(verdict.singleGreenLight).toBe(false);
  });

  it('rejects caller self-report, wrong candidate, stale epoch, missing artifact and duplicate receipts', () => {
    const created = createVerificationPlan(planInput);
    const bridge = new VerseGitReceiptBridge();
    bridge.registerPlan(created.plan!);
    const base = receipt(created.plan);
    expect(bridge.receive(created.plan!.runId, { ...base, receiptId: 'caller', authority: { writer: 'caller', trusted_source: 'caller' } }).status).toBe('rejected_by_policy');
    expect(bridge.receive(created.plan!.runId, { ...base, receiptId: 'candidate', candidateId: 'wrong' }).status).toBe('rejected_by_policy');
    expect(bridge.receive(created.plan!.runId, { ...base, receiptId: 'epoch', epoch: 1 }).status).toBe('rejected_by_policy');
    expect(bridge.receive(created.plan!.runId, { ...base, receiptId: 'artifact', artifactDigests: [] }).status).toBe('rejected_by_policy');
    expect(bridge.receive(created.plan!.runId, base).status).toBe('accepted');
    expect(bridge.receive(created.plan!.runId, base).status).toBe('duplicate');
  });
});