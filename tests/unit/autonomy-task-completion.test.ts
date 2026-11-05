import { describe, expect, it } from 'vitest';
import { normalizeTaskLedgerCompletionClaim, projectTaskLoopTaskStatus, projectTaskLoopTaskProgress, taskCompletionCandidateMatches, taskLedgerCompletionReferenceGaps } from '../../shared/task-ledger-completion';
import { taskCompletionArtifactsMatch } from '../../shared/task-ledger-artifact';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';
import type { TaskLedgerCompletionCheckpoint, TaskLedgerCompletionCheckReceipt } from '../../shared/types/task-ledger';

describe('TF-0672 automatic business task completion boundary', () => {
  it('keeps a finished runtime task pending independent acceptance', () => {
    expect(projectTaskLoopTaskStatus('complete')).toBe('review');
    expect(projectTaskLoopTaskStatus('blocked')).toBe('blocked');
    expect(projectTaskLoopTaskStatus('error')).toBe('blocked');
    expect(projectTaskLoopTaskStatus('running')).toBe('doing');
    expect(projectTaskLoopTaskStatus(undefined)).toBe('doing');
  });

  it('retains execution completion progress while business acceptance stays pending', () => {
    expect(projectTaskLoopTaskProgress('complete')).toBe(100);
    expect(projectTaskLoopTaskProgress('blocked')).toBe(100);
    expect(projectTaskLoopTaskProgress('error')).toBe(100);
    expect(projectTaskLoopTaskProgress('complete', 0)).toBe(0);
    expect(projectTaskLoopTaskProgress('running', 35)).toBe(35);
    expect(projectTaskLoopTaskProgress('running')).toBeUndefined();
    expect(projectTaskLoopTaskStatus('complete')).toBe('review');
  });

  it('does not treat a model completion word, accepted dispatch or zero exit as an acceptance receipt', () => {
    expect(projectTaskLoopTaskStatus('accepted')).not.toBe('done');
    expect(projectTaskLoopTaskStatus('passed')).not.toBe('done');
    expect(projectTaskLoopTaskStatus('exit0')).not.toBe('done');
    expect(projectTaskLoopTaskStatus('done')).not.toBe('done');
  });

  const scope = { workspaceId: 'workspace-a', projectId: 'workspace-a', sessionKey: 'owner-session', sessionGeneration: 'physical-generation-a' } as AutonomySessionScope;
  const claim = { operationId: 'persisted-completion-intent', expectedRevision: 3, checkpointId: 'existing-checkpoint',
    taskRef: { owner: 'task-ledger', taskNodeId: 'owner-task', scope }, verificationRunIds: ['existing-verifier-run'] };

  it('retains only references to existing owners without accepting any completion', () => {
    expect(normalizeTaskLedgerCompletionClaim(claim, scope)).toEqual(claim);
  });

  it.each(['passed', 'verifier', 'reviewer', 'candidate', 'actor', 'decision'])('rejects caller-authored %s authority', field => {
    expect(() => normalizeTaskLedgerCompletionClaim({ ...claim, [field]: 'self-reported' }, scope)).toThrow('caller verdicts');
  });

  it('rejects cross-generation references, Forest authority and ambiguous verification references', () => {
    expect(() => normalizeTaskLedgerCompletionClaim({ ...claim, taskRef: { ...claim.taskRef, scope: { ...scope, sessionGeneration: 'retired-generation' } } }, scope)).toThrow();
    expect(() => normalizeTaskLedgerCompletionClaim({ ...claim, taskRef: { ...claim.taskRef, owner: 'task-forest' } }, scope)).toThrow('Forest completion authority');
    expect(() => normalizeTaskLedgerCompletionClaim({ ...claim, verificationRunIds: ['same-run', 'same-run'] }, scope)).toThrow();
  });

  it('invalidates evidence when source, inputs, configuration or the integrated dirty candidate changes', () => {
    const verified = { source: 'source-candidate-a', inputSha256: 'a'.repeat(64), configSha256: 'b'.repeat(64), dirtyDiffSha256: 'c'.repeat(64) };
    expect(taskCompletionCandidateMatches(verified, { ...verified })).toBe(true);
    for (const field of ['source', 'inputSha256', 'configSha256', 'dirtyDiffSha256'] as const) {
      expect(taskCompletionCandidateMatches(verified, { ...verified, [field]: field === 'source' ? 'merged-candidate-b' : 'd'.repeat(64) })).toBe(false);
    }
    expect(taskCompletionCandidateMatches({ ...verified, inputSha256: '' }, verified)).toBe(false);
  });

  function ownerRecords() {
    const request = normalizeTaskLedgerCompletionClaim(claim, scope);
    const candidate = { source: 'verified-merged-candidate', inputSha256: 'a'.repeat(64), configSha256: 'b'.repeat(64), dirtyDiffSha256: 'c'.repeat(64) };
    const checkpoint: TaskLedgerCompletionCheckpoint = { owner: 'task-loop', checkpointId: claim.checkpointId, ownerRevision: 'd'.repeat(64),
      loopRunId: 'existing-task-loop', taskRef: request.taskRef, status: 'complete', evidenceGate: 'pass', selfCheckDecision: 'complete',
      reviewSource: { state: 'pinned', workspaceRoot: 'fixture-root', candidate, capturedAt: 100 },
      candidate, acceptanceSha256: 'e'.repeat(64), taskInputSha256: 'a'.repeat(64), requiredCheckIds: ['check-negative-controls'], verificationChecks: [], workerRunIds: ['worker-run'], verifierRunId: 'independent-verifier-run',
      reviewer: { agentId: 'actual-verifier-agent', runId: 'independent-verifier-run', sessionKey: 'actual-verifier-session' }, capturedAt: 100, expiresAt: 300 };
    const check: TaskLedgerCompletionCheckReceipt = { owner: 'verseshell-host-receipt', receiptId: 'existing-host-receipt', ownerRevision: 'f'.repeat(64),
      verificationRunId: claim.verificationRunIds[0], checkpointId: checkpoint.checkpointId, checkpointRevision: checkpoint.ownerRevision,
      taskRef: request.taskRef, candidate, acceptanceSha256: checkpoint.acceptanceSha256, checkId: checkpoint.requiredCheckIds[0],
      reviewer: { agentId: 'actual-verifier-agent', runId: checkpoint.verifierRunId, sessionKey: 'actual-verifier-session' },
      status: 'verified', exitCode: 0, capturedAt: 110, expiresAt: 250,
      artifactRefs: [{ owner: 'verseshell-host-receipt', ref: 'actual-host-artifact', sha256: 'a'.repeat(64), verified: true }] };
    return { claim: request, currentScope: scope, currentCandidate: candidate, checkpoint, checks: [check], now: 200 };
  }

  it('finds no reference gaps for matching independent owner records without itself writing done', () => {
    const records = ownerRecords();
    const before = structuredClone(records);
    expect(taskLedgerCompletionReferenceGaps(records)).toEqual([]);
    expect(records).toEqual(before);
  });

  it.each(['repair', 'blocked', 'unavailable'] as const)('rejects complete plus %s evidence from the task owner', evidenceGate => {
    const records = ownerRecords();
    expect(taskLedgerCompletionReferenceGaps({ ...records, checkpoint: { ...records.checkpoint, evidenceGate } })).toContain('task-loop-not-verified-complete');
  });

  it('rejects absent owner data and the old branch candidate after integration', () => {
    const records = ownerRecords();
    expect(taskLedgerCompletionReferenceGaps({ ...records, checkpoint: null })).toContain('task-loop-owner-unavailable');
    expect(taskLedgerCompletionReferenceGaps({ ...records, currentCandidate: { ...records.currentCandidate, source: 'new-integrated-commit' } })).toEqual(expect.arrayContaining(['checkpoint-candidate-mismatch', 'check-candidate-or-acceptance-mismatch']));
  });

  it('rejects evidence for another task, another owner revision or an expired check', () => {
    const records = ownerRecords();
    const wrongTask = { ...records.checks[0], taskRef: { ...records.checks[0].taskRef, taskNodeId: 'different-task' } } as TaskLedgerCompletionCheckReceipt;
    expect(taskLedgerCompletionReferenceGaps({ ...records, checks: [wrongTask] })).toContain('check-owner-revision-task-mismatch');
    expect(taskLedgerCompletionReferenceGaps({ ...records, checks: [{ ...records.checks[0], checkpointRevision: 'c'.repeat(64) }] })).toContain('check-owner-revision-task-mismatch');
    expect(taskLedgerCompletionReferenceGaps({ ...records, now: 251 })).toContain('check-stale');
    expect(taskLedgerCompletionReferenceGaps({ ...records, now: 301 })).toContain('checkpoint-stale');
  });

  it('rejects a forged verifier and a self-check worker posing as independent verification', () => {
    const records = ownerRecords();
    const check = { ...records.checks[0], reviewer: { ...records.checks[0].reviewer, runId: 'worker-run' } };
    expect(taskLedgerCompletionReferenceGaps({ ...records, checks: [check] })).toContain('reviewer-owner-mismatch');
    expect(taskLedgerCompletionReferenceGaps({ ...records, checkpoint: { ...records.checkpoint, verifierRunId: 'worker-run' } })).toContain('independent-reviewer-missing');
  });

  it('requires actual artifact verification in addition to zero exit and a passed status', () => {
    const records = ownerRecords();
    expect(taskLedgerCompletionReferenceGaps({ ...records, checks: [{ ...records.checks[0], artifactRefs: [] }] })).toContain('artifact-missing-or-unverified');
    expect(taskLedgerCompletionReferenceGaps({ ...records, checks: [{ ...records.checks[0], artifactRefs: [{ ...records.checks[0].artifactRefs[0], verified: false }] }] })).toContain('artifact-missing-or-unverified');
    expect(taskLedgerCompletionReferenceGaps({ ...records, checks: [{ ...records.checks[0], status: 'unavailable', exitCode: 0 }] })).toContain('check-not-verified');
    expect(taskLedgerCompletionReferenceGaps({ ...records, checks: [] })).toEqual(expect.arrayContaining(['verification-reference-set-mismatch', 'required-check-coverage-missing']));
  });
  it('hashes real bytes asynchronously and rejects tampering or missing refs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'a3-artifact-'));
    try {
      const file = join(dir, 'archive.bin');
      await writeFile(file, 'proof-bytes');
      const sha256 = createHash('sha256').update('proof-bytes').digest('hex');
      const base = { ...ownerRecords().checks[0], artifactRefs: [
        { owner: 'context-archive' as const, ref: 'archive', path: pathToFileURL(file).href, sha256, verified: true },
      ] };
      expect(await taskCompletionArtifactsMatch(base)).toBe(true);
      await writeFile(file, 'tampered-bytes');
      expect(await taskCompletionArtifactsMatch(base)).toBe(false);
      expect(await taskCompletionArtifactsMatch({ ...base, artifactRefs: [] })).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
