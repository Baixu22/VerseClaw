import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  VerseGitReceiptBridge,
  createVerificationPlan,
  executionInputDigest,
  type VerificationPlan,
  type VerseShellReceipt,
} from '../../electron/services/versegit-receipt-bridge';
import { FileVerseShellReceiptAuthority } from '../../electron/services/versegit-receipt-evidence';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const candidateInputDigest = 'a'.repeat(64);

function fixture(receiptId = 'receipt-live', argv: string[] = ['node', 'verify.cjs', candidateInputDigest]) {
  const created = createVerificationPlan({
    runId: 'run-live', candidateId: 'candidate-live', candidateInputDigest,
    checkId: 'check-live', owner: 'owner-live', epoch: 1, authorizationId: 'auth-live',
    commands: [{
      argv, cwd: '.', env: {},
      effect: 'read', retry: 'never', expectedArtifacts: ['stdout', 'stderr'],
    }],
    requiredScope: 'full',
  });
  if (!created.plan) throw new Error(created.issues.join('; '));
  const observation = {
    schema: 'verseshell.observation/v1' as const,
    id: `observation-${receiptId}`,
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

function bindingFor(plan: VerificationPlan) {
  const command = plan.commands[0];
  return {
    planId: plan.runId,
    planDigest: String(plan.planDigest),
    candidateId: plan.candidateId,
    checkId: plan.checkId,
    argvDigest: sha(JSON.stringify(command.argv)),
    cwdDigest: sha(JSON.stringify(command.cwd)),
    envDigest: sha(JSON.stringify(command.env)),
    executionInputDigest: executionInputDigest(plan),
  };
}

function receiptFor(
  plan: VerificationPlan,
  receiptId: string,
  observationId: string,
  observationRef: { observationDigest: string; stdoutDigest: string; stderrDigest: string },
  planDigest: string,
  inputDigest: string,
): VerseShellReceipt {
  const binding = bindingFor(plan);
  return {
    schema: 'clawx.verseshell.execution-receipt/v2', receiptId,
    planId: plan.runId, planDigest: String(plan.planDigest), candidateId: plan.candidateId,
    checkId: plan.checkId, ownerId: plan.owner, epoch: plan.epoch, authorizationId: plan.authorizationId,
    argvDigest: binding.argvDigest, cwdDigest: binding.cwdDigest, envDigest: binding.envDigest,
    executionInputDigest: binding.executionInputDigest,
    requiredScope: 'full',
    artifactDigests: [...new Set([
      observationRef.observationDigest, observationRef.stdoutDigest, observationRef.stderrDigest,
      planDigest, inputDigest,
    ])].sort(),
    cleanupStatus: 'clean', status: 'exited', exitCode: 0, signal: null, durationMs: 1,
    stdoutDigest: observationRef.stdoutDigest, stderrDigest: observationRef.stderrDigest,
    processKey: sha('process-live'),
    authority: { writer: 'verseshell', trusted_source: 'clawx-host-process-artifact-authority' },
    origin: 'verseshell', realVerseshell: true,
    observationId, observationDigest: observationRef.observationDigest,
    planFileDigest: planDigest, inputManifestDigest: inputDigest,
  };
}

describe('host-authoritative VerseShell receipts', () => {
  it('rejects a live claim without a host-retained evidence authority', () => {
    const { plan, observation, receiptId } = fixture();
    const bridge = new VerseGitReceiptBridge();
    bridge.registerPlan(plan);
    const receipt = receiptFor(plan, receiptId, observation.id, {
      observationDigest: 'd'.repeat(64), stdoutDigest: 'c'.repeat(64), stderrDigest: 'b'.repeat(64),
    }, 'e'.repeat(64), 'f'.repeat(64));
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
      const observationRef = authority.recordObservation({
        observation, stdout: '{"ok":true}', stderr: '',
        processKeyDigest: sha('process-live'), processPid: 1234, managerKeyDigest: sha('manager-live'),
        binding: bindingFor(plan),
      });
      authority.recordCleanup({ status: 'clean', survivorPids: [] });
      const receipt = receiptFor(plan, receiptId, observation.id, observationRef, planRef.digest, inputRef.digest);
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

  it('rejects a re-sealed verifier plan that reuses an observation from another command', () => {
    const root = mkdtempSync(join(process.platform === 'win32' ? 'D:/tmp' : process.env.TMPDIR ?? '/tmp', 'vg-receipt-plan-swap-'));
    try {
      const original = fixture('receipt-original');
      const authority = new FileVerseShellReceiptAuthority(root);
      authority.reset();
      authority.recordPlan(original.plan);
      const inputRef = authority.recordCandidateInput(original.plan.candidateId, { inputDigest: candidateInputDigest });
      const observationRef = authority.recordObservation({
        observation: original.observation, stdout: '{"ok":true}', stderr: '',
        processKeyDigest: sha('process-live'), processPid: 1234, managerKeyDigest: sha('manager-live'),
        binding: bindingFor(original.plan),
      });
      authority.recordCleanup({ status: 'clean', survivorPids: [] });

      const altered = fixture('receipt-altered', ['node', 'different-verifier.cjs', candidateInputDigest]);
      const alteredPlanRef = authority.recordPlan(altered.plan);
      const alteredReceipt = receiptFor(
        altered.plan, 'receipt-altered', original.observation.id, observationRef,
        alteredPlanRef.digest, inputRef.digest,
      );
      authority.recordReceipt(alteredReceipt);
      const bridge = new VerseGitReceiptBridge(authority);
      bridge.registerPlan(altered.plan);
      const result = bridge.receive(altered.plan.runId, alteredReceipt);
      expect(result.status).toBe('rejected_by_policy');
      expect(result.reason).toBe('host_evidence_authority_rejected');
      expect(result.issues.join(' ')).toContain('observation planDigest differs from plan');
      expect(bridge.verdict(altered.plan.runId).realVerseshellExecution).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
