import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  VerseGitReceiptBridge,
  createVerificationPlan,
  executionInputDigest,
  type VerseShellReceipt,
} from '../../electron/services/versegit-receipt-bridge';
import { FileVerseShellReceiptAuthority } from '../../electron/services/versegit-receipt-evidence';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const candidateInputDigest = 'a'.repeat(64);

function fixture(receiptId = 'receipt-live') {
  const created = createVerificationPlan({
    runId: 'run-live', candidateId: 'candidate-live', candidateInputDigest,
    checkId: 'check-live', owner: 'owner-live', epoch: 1, authorizationId: 'auth-live',
    commands: [{
      argv: ['node', 'verify.cjs', candidateInputDigest], cwd: '.', env: {},
      effect: 'read', retry: 'never', expectedArtifacts: ['stdout', 'stderr'],
    }],
    requiredScope: 'full',
  });
  if (!created.plan) throw new Error(created.issues.join('; '));
  const observation = {
    schema: 'verseshell.observation/v1' as const,
    id: 'observation-live',
    op: 'exec.run',
    ok: true,
    status: 'ok' as const,
    data: {
      exit_code: 0,
      timed_out: false,
      stdout: { text: '{"ok":true}' },
      stderr: { text: '' },
    },
    meta: {
      elapsed_ms: 1,
      profile: 'generic',
      token_estimate: 4,
      capabilities_used: ['shell.exec'],
    },
  };
  return { plan: created.plan, observation, receiptId };
}

describe('host-authoritative VerseShell receipts', () => {
  it('rejects a live claim without a host-retained evidence authority', () => {
    const { plan } = fixture();
    const command = plan.commands[0];
    const bridge = new VerseGitReceiptBridge();
    bridge.registerPlan(plan);
    const receipt = {
      schema: 'clawx.verseshell.execution-receipt/v2', receiptId: 'receipt-memory',
      planId: plan.runId, planDigest: plan.planDigest, candidateId: plan.candidateId,
      checkId: plan.checkId, ownerId: plan.owner, epoch: plan.epoch, authorizationId: plan.authorizationId,
      argvDigest: sha(JSON.stringify(command.argv)), cwdDigest: sha(JSON.stringify(command.cwd)),
      envDigest: sha(JSON.stringify(command.env)), executionInputDigest: executionInputDigest(plan),
      requiredScope: 'full' as const,
      artifactDigests: ['b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)],
      cleanupStatus: 'clean' as const, status: 'exited' as const, exitCode: 0, signal: null, durationMs: 1,
      stdoutDigest: 'c'.repeat(64), stderrDigest: 'b'.repeat(64), processKey: 'p'.repeat(64),
      authority: { writer: 'verseshell' as const, trusted_source: 'clawx-host-process-artifact-authority' as const },
      origin: 'verseshell' as const, realVerseshell: true,
      observationId: 'observation-live', observationDigest: 'd'.repeat(64),
      planFileDigest: 'e'.repeat(64), inputManifestDigest: 'f'.repeat(64),
    };
    expect(bridge.receive(plan.runId, receipt).reason).toBe('host_evidence_authority_missing');
    expect(bridge.verdict(plan.runId).realVerseshellExecution).toBe(false);
  });

  it('promotes a live receipt only after re-reading recorded plan, observation and artifacts', () => {
    const root = mkdtempSync(join(process.platform === 'win32' ? 'D:/tmp' : process.env.TMPDIR ?? '/tmp', 'vg-receipt-authority-'));
    try {
      const { plan, observation, receiptId } = fixture();
      const authority = new FileVerseShellReceiptAuthority(root);
      authority.reset();
      const planRef = authority.recordPlan(plan);
      const inputRef = authority.recordCandidateInput(plan.candidateId, { inputDigest: candidateInputDigest });
      const stdout = '{"ok":true}';
      const stderr = '';
      const observationRef = authority.recordObservation({
        observation, stdout, stderr,
        processKeyDigest: sha('process-live'), processPid: 1234, managerKeyDigest: sha('manager-live'),
      });
      authority.recordCleanup({ status: 'clean', survivorPids: [] });
      const command = plan.commands[0];
      const receipt: VerseShellReceipt = {
        schema: 'clawx.verseshell.execution-receipt/v2', receiptId,
        planId: plan.runId, planDigest: plan.planDigest, candidateId: plan.candidateId,
        checkId: plan.checkId, ownerId: plan.owner, epoch: plan.epoch, authorizationId: plan.authorizationId,
        argvDigest: sha(JSON.stringify(command.argv)), cwdDigest: sha(JSON.stringify(command.cwd)),
        envDigest: sha(JSON.stringify(command.env)), executionInputDigest: executionInputDigest(plan),
        requiredScope: 'full',
        artifactDigests: [...new Set([
          observationRef.observationDigest, observationRef.stdoutDigest, observationRef.stderrDigest,
          planRef.digest, inputRef.digest,
        ])].sort(),
        cleanupStatus: 'clean', status: 'exited', exitCode: 0, signal: null, durationMs: 1,
        stdoutDigest: observationRef.stdoutDigest, stderrDigest: observationRef.stderrDigest,
        processKey: sha('process-live'),
        authority: { writer: 'verseshell', trusted_source: 'clawx-host-process-artifact-authority' },
        origin: 'verseshell', realVerseshell: true,
        observationId: observation.id, observationDigest: observationRef.observationDigest,
        planFileDigest: planRef.digest, inputManifestDigest: inputRef.digest,
      };
      authority.recordReceipt(receipt);
      const bridge = new VerseGitReceiptBridge(authority);
      bridge.registerPlan(plan);
      expect(bridge.receive(plan.runId, receipt).status).toBe('accepted');
      const verdict = bridge.verdict(plan.runId);
      expect(verdict.status).toBe('observed');
      expect(verdict.realVerseshellExecution).toBe(true);
      expect(verdict.hostVerdict).toBe('unchanged');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
