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
import { FileVerseShellReceiptAuthority, stableJson } from '../../electron/services/versegit-receipt-evidence';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const candidateInputDigest = 'a'.repeat(64);
const candidateManifest = { schemaVersion: 2, inputDigest: candidateInputDigest, inputFiles: [{ path: 'verify.cjs', sha256: candidateInputDigest }] };
const candidateId = sha(stableJson(candidateManifest));
const processKey = sha('process-live');

function fixture(receiptId = 'receipt-live', argv: string[] = ['node', 'verify.cjs', candidateInputDigest]) {
  const created = createVerificationPlan({
    runId: 'run-live', candidateId, candidateInputDigest,
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
    data: { exit_code: 0, timed_out: false, stdout: { text: '{"ok":true}' }, stderr: { text: '' } },
    meta: { elapsed_ms: 1, profile: 'generic', token_estimate: 4, capabilities_used: ['shell.exec'] },
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
    processKey,
    authority: { writer: 'verseshell', trusted_source: 'clawx-host-process-artifact-authority' },
    origin: 'verseshell', realVerseshell: true,
    observationId, observationDigest: observationRef.observationDigest,
    planFileDigest: planDigest, inputManifestDigest: inputDigest,
  };
}

function cleanCleanup() {
  return {
    status: 'clean', processesDeleted: true, managerProcessSurvivors: 0,
    worktreeSurvivors: 0, tempRootRemoved: true, hostWorktreesDeleted: 0,
    worktreesDeleted: 3, deletionErrors: [], processSurvivors: 0, survivorPids: [],
    processInventory: {
      baselinePids: [],
      duringPids: [1234],
      afterPids: [],
      newProcessPids: [1234],
      managedPids: [1234],
      managedAfterShutdown: [],
      survivorPids: [],
      ownedPidChecks: [{ ok: true, pid: 1234, exists: false }],
    },
  };
}

function installEvidence(root: string, overrides: { manifest?: Record<string, unknown>; cleanup?: Record<string, unknown> } = {}) {
  const { plan, observation, receiptId } = fixture();
  const authority = new FileVerseShellReceiptAuthority(root);
  authority.reset();
  const planRef = authority.recordPlan(plan);
  const inputRef = authority.recordCandidateInput(plan.candidateId, overrides.manifest ?? candidateManifest);
  const observationRef = authority.recordObservation({
    observation, stdout: '{"ok":true}', stderr: '',
    processKeyDigest: processKey, processPid: 1234, managerKeyDigest: sha('manager-live'),
    binding: bindingFor(plan),
  });
  authority.recordCleanup(overrides.cleanup ?? cleanCleanup());
  const receipt = receiptFor(plan, receiptId, observation.id, observationRef, planRef.digest, inputRef.digest);
  authority.recordReceipt(receipt);
  return { authority, plan, observation, receipt };
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
      const installed = installEvidence(root);
      const bridge = new VerseGitReceiptBridge(installed.authority);
      bridge.registerPlan(installed.plan);
      expect(bridge.receive(installed.plan.runId, installed.receipt).status).toBe('accepted');
      const verdict = bridge.verdict(installed.plan.runId);
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
      const inputRef = authority.recordCandidateInput(original.plan.candidateId, candidateManifest);
      const observationRef = authority.recordObservation({
        observation: original.observation, stdout: '{"ok":true}', stderr: '',
        processKeyDigest: processKey, processPid: 1234, managerKeyDigest: sha('manager-live'),
        binding: bindingFor(original.plan),
      });
      authority.recordCleanup(cleanCleanup());
      const altered = fixture('receipt-altered', ['node', 'different-verifier.cjs', candidateInputDigest]);
      const alteredPlanRef = authority.recordPlan(altered.plan);
      const alteredReceipt = receiptFor(altered.plan, 'receipt-altered', original.observation.id, observationRef, alteredPlanRef.digest, inputRef.digest);
      authority.recordReceipt(alteredReceipt);
      const bridge = new VerseGitReceiptBridge(authority);
      bridge.registerPlan(altered.plan);
      const result = bridge.receive(altered.plan.runId, alteredReceipt);
      expect(result.status).toBe('rejected_by_policy');
      expect(result.reason).toBe('host_evidence_authority_rejected');
      expect(result.issues.join(' ')).toContain('observation planDigest differs from plan');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an input manifest whose digest or candidate identity differs from the plan', () => {
    const root = mkdtempSync(join(process.platform === 'win32' ? 'D:/tmp' : process.env.TMPDIR ?? '/tmp', 'vg-receipt-input-swap-'));
    try {
      const installed = installEvidence(root, { manifest: { ...candidateManifest, inputDigest: 'b'.repeat(64) } });
      const checked = installed.authority.verifyReceipt({ plan: installed.plan, receipt: installed.receipt });
      expect(checked.ok).toBe(false);
      expect(checked.issues).toEqual(expect.arrayContaining([
        'candidate input digest differs from plan',
        'candidate input manifest does not reproduce candidateId',
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a clean summary that hides an owned survivor in nested process inventory', () => {
    const root = mkdtempSync(join(process.platform === 'win32' ? 'D:/tmp' : process.env.TMPDIR ?? '/tmp', 'vg-receipt-survivor-'));
    try {
      const cleanup = cleanCleanup();
      cleanup.processInventory.managedPids.push(99999);
      cleanup.processInventory.duringPids.push(99999);
      cleanup.processInventory.newProcessPids.push(99999);
      cleanup.processInventory.ownedPidChecks.push({ ok: true, pid: 99999, exists: true });
      cleanup.processInventory.survivorPids.push(99999);
      const installed = installEvidence(root, { cleanup });
      const checked = installed.authority.verifyReceipt({ plan: installed.plan, receipt: installed.receipt });
      expect(checked.ok).toBe(false);
      expect(checked.issues).toEqual(expect.arrayContaining([
        'nested cleanup retained process survivors',
        'owned PID checks retained a survivor',
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });


  it('rejects a clean cleanup record with contradictory worktree, temp-root or deletion facts', () => {
    const root = mkdtempSync(join(process.platform === 'win32' ? 'D:/tmp' : process.env.TMPDIR ?? '/tmp', 'vg-receipt-cleanup-'));
    try {
      const cleanup = cleanCleanup();
      cleanup.worktreeSurvivors = 1;
      cleanup.tempRootRemoved = false;
      cleanup.deletionErrors = ['worktree remove failed'];
      const installed = installEvidence(root, { cleanup });
      const checked = installed.authority.verifyReceipt({ plan: installed.plan, receipt: installed.receipt });
      expect(checked.ok).toBe(false);
      expect(checked.issues).toEqual(expect.arrayContaining([
        'cleanup retained worktrees',
        'cleanup retained the temporary root',
        'cleanup retained deletion errors',
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });



  it('rejects owned PID checks whose identities do not match the managed PID set', () => {
    const root = mkdtempSync(join(process.platform === 'win32' ? 'D:/tmp' : process.env.TMPDIR ?? '/tmp', 'vg-receipt-pid-identity-'));
    try {
      const cleanup = cleanCleanup();
      cleanup.processInventory.ownedPidChecks[0].pid = 999999;
      const installed = installEvidence(root, { cleanup });
      const checked = installed.authority.verifyReceipt({ plan: installed.plan, receipt: installed.receipt });
      expect(checked.ok).toBe(false);
      expect(checked.issues).toContain('owned PID exit-check identities differ from managed PIDs');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });



  it('rejects duplicate managed and owned PID identities', () => {
    const root = mkdtempSync(join(process.platform === 'win32' ? 'D:/tmp' : process.env.TMPDIR ?? '/tmp', 'vg-receipt-pid-duplicate-'));
    try {
      const cleanup = cleanCleanup();
      cleanup.processInventory.managedPids.push(1234);
      cleanup.processInventory.duringPids.push(1234);
      cleanup.processInventory.newProcessPids.push(1234);
      cleanup.processInventory.ownedPidChecks.push({ ok: true, pid: 1234, exists: false });
      const installed = installEvidence(root, { cleanup });
      const checked = installed.authority.verifyReceipt({ plan: installed.plan, receipt: installed.receipt });
      expect(checked.ok).toBe(false);
      expect(checked.issues).toContain('owned cleanup PID vector contains duplicates');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });



  it('rejects a consistent PID inventory that does not contain the receipt observation PID', () => {
    const root = mkdtempSync(join(process.platform === 'win32' ? 'D:/tmp' : process.env.TMPDIR ?? '/tmp', 'vg-receipt-pid-crossbind-'));
    try {
      const cleanup = cleanCleanup();
      cleanup.processInventory.baselinePids = [];
      cleanup.processInventory.duringPids = [99999];
      cleanup.processInventory.newProcessPids = [99999];
      cleanup.processInventory.managedPids = [99999];
      cleanup.processInventory.afterPids = [];
      cleanup.processInventory.ownedPidChecks = [{ ok: true, pid: 99999, exists: false }];
      const installed = installEvidence(root, { cleanup });
      const checked = installed.authority.verifyReceipt({ plan: installed.plan, receipt: installed.receipt });
      expect(checked.ok).toBe(false);
      expect(checked.issues).toContain('cleanup managed PIDs do not contain the receipt observation PID');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

});
