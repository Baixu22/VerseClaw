import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PatchProposal } from '../../openclaw_runtime/src/agents/patch-flow';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';
import {
  applyCandidateAfterVerification,
  candidateApplySnapshotDigest,
  materializePatchCandidate,
  type CandidateApplyAuthorityState,
  type CandidateApplyHost,
  type CandidateApplyPermit,
  type CandidateApplyRepositoryState,
  type CandidateApplyVerification,
} from '../../openclaw_runtime/src/agents/orchestration-candidate-apply';
import { applyDeferredPatchFlow } from '../../openclaw_runtime/src/agents/orchestration-patch-flow';
import {
  __resetWriteJournals,
  listJournalSnapshotFiles,
  undoLastWrites,
} from '../../openclaw_runtime/src/agents/tools/write-journal';

const roots: string[] = [];
const fence = String.fromCharCode(96).repeat(3);
const RECEIPT_DIGEST = 'a'.repeat(64);
const PLAN_DIGEST = 'b'.repeat(64);

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'versegit-e3-apply-'));
  roots.push(root);
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'agent@example.invalid']);
  git(root, ['config', 'user.name', 'Agent']);
  writeFileSync(join(root, '.gitignore'), '.openclaw/\n.ae/\n', 'utf8');
  writeFileSync(join(root, 'a.txt'), 'one\n', 'utf8');
  writeFileSync(join(root, 'b.txt'), 'two\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  return root;
}
function patchFor(path: string, from: string, to: string): string {
  return ['*** Begin Patch', '*** Update File: ' + path, '@@', '-' + from, '+' + to, '*** End Patch'].join('\n');
}
function worker(runId: string, path: string, from: string, to: string): SubagentRunRecord {
  const patch = patchFor(path, from, to);
  return {
    runId,
    childSessionKey: 'agent:main:' + runId,
    requesterSessionKey: 'agent:main:main',
    requesterDisplayKey: 'agent:main:main',
    task: 'candidate apply ' + runId,
    cleanup: 'delete',
    createdAt: 1,
    endedAt: 2,
    outcome: { status: 'ok' },
    completion: { required: true, resultText: fence + 'apply_patch\n' + patch + '\n' + fence },
    orchestration: {
      orchestrationRunId: 'orch-e3',
      roleName: 'implementer',
      isVerifier: false,
      phase: 'worker',
      leadRole: 'lead',
      originalTask: 'apply two verified changes',
      patchFlowExecution: true,
      patchFlowWriteSet: [path],
    },
  } as SubagentRunRecord;
}
function proposals(): PatchProposal[] {
  return [
    { workerId: 'run-a', patchText: patchFor('a.txt', 'one', 'ONE'), writeSet: ['a.txt'] },
    { workerId: 'run-b', patchText: patchFor('b.txt', 'two', 'TWO'), writeSet: ['b.txt'] },
  ];
}
function authority(): CandidateApplyAuthorityState {
  return {
    ownerId: 'owner-e3',
    epoch: 4,
    authorizationId: 'auth-e3',
    grantId: 'grant-e3',
    grantStatus: 'active',
    grantEpoch: 'grant-4',
    revocationEpoch: 'revocation-4',
    receiptDigest: RECEIPT_DIGEST,
    receiptStatus: 'accepted',
  };
}
function verificationFor(candidate: { candidateId: string; baseOid: string; candidateTreeOid: string; candidateInputDigest: string }, status: 'passed' | 'failed' = 'passed'): CandidateApplyVerification {
  return {
    status,
    candidateId: candidate.candidateId,
    baseOid: candidate.baseOid,
    candidateTreeOid: candidate.candidateTreeOid,
    candidateInputDigest: candidate.candidateInputDigest,
    receiptDigest: RECEIPT_DIGEST,
    planDigest: PLAN_DIGEST,
    checkId: 'candidate-required-tests',
    ownerId: 'owner-e3',
    epoch: 4,
    authorizationId: 'auth-e3',
    issues: status === 'passed' ? [] : ['combined-verification-failed'],
  };
}
function permitFor(input: {
  verification: CandidateApplyVerification;
  repository: CandidateApplyRepositoryState;
  authority: CandidateApplyAuthorityState;
  allowed?: boolean;
}): CandidateApplyPermit {
  return {
    allowed: input.allowed ?? true,
    permitId: input.allowed === false ? null : 'permit-e3',
    reason: input.allowed === false ? 'host-denied' : null,
    candidateId: input.verification.candidateId,
    candidateTreeOid: input.verification.candidateTreeOid,
    candidateInputDigest: input.verification.candidateInputDigest,
    receiptDigest: input.verification.receiptDigest,
    ownerId: input.verification.ownerId,
    epoch: input.verification.epoch,
    authorizationId: input.verification.authorizationId,
    grantId: input.authority.grantId,
    expectedSnapshotDigest: candidateApplySnapshotDigest({ repository: input.repository, authority: input.authority }),
  };
}
type HostControl = {
  authority?: CandidateApplyAuthorityState;
  verificationStatus?: 'passed' | 'failed';
  permitAllowed?: boolean;
  mutateBeforePermit?: (input: { candidateRoot: string; workspaceDir: string }) => void;
  verifyCalls?: number;
  authorizeCalls?: number;
};
function makeHost(control: HostControl = {}, workspaceDir: string): CandidateApplyHost {
  control.authority = control.authority ?? authority();
  control.verifyCalls = 0;
  control.authorizeCalls = 0;
  let candidateRoot = '';
  return {
    async verifyCandidate({ candidate, candidateRoot: root }) {
      control.verifyCalls = (control.verifyCalls ?? 0) + 1;
      candidateRoot = root;
      return verificationFor(candidate, control.verificationStatus ?? 'passed');
    },
    async authorizeCandidate({ verification, repository }) {
      control.authorizeCalls = (control.authorizeCalls ?? 0) + 1;
      const permit = permitFor({ verification, repository, authority: control.authority!, allowed: control.permitAllowed });
      control.mutateBeforePermit?.({ candidateRoot, workspaceDir });
      return permit;
    },
    async readAuthorityState() {
      return { ...control.authority! };
    },
  } as CandidateApplyHost;
}
function state(root: string) {
  return {
    head: git(root, ['rev-parse', 'HEAD']),
    refs: git(root, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']),
    status: git(root, ['status', '--porcelain=v1', '--untracked-files=all']),
  };
}
afterEach(() => {
  __resetWriteJournals();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

describe('candidate-first host apply', () => {
  it('keeps the base and refs untouched when two valid proposals fail combined verification', async () => {
    const root = makeRepo();
    const before = state(root);
    const host = makeHost({ verificationStatus: 'failed' }, root);
    const outcome = await applyDeferredPatchFlow({
      workers: [worker('run-a', 'a.txt', 'one', 'ONE'), worker('run-b', 'b.txt', 'two', 'TWO')],
      workspaceDir: root,
      candidateApply: {
        host,
        journal: { workspaceRoot: root, sessionId: 'session-e3', requestId: 'batch-e3', enabled: true },
      },
    });
    expect(outcome.status).toBe('verification-failed');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('one\n');
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('two\n');
    expect(state(root)).toEqual(before);
    expect(outcome.trace?.some((event) => event.kind === 'first-write-started')).toBe(false);
    expect(outcome.cleanup?.ok).toBe(true);
  });

  it('writes only after verification and preserves a recoverable journal record', async () => {
    const root = makeRepo();
    const host = makeHost({}, root);
    const outcome = await applyDeferredPatchFlow({
      workers: [worker('run-a', 'a.txt', 'one', 'ONE'), worker('run-b', 'b.txt', 'two', 'TWO')],
      workspaceDir: root,
      candidateApply: {
        host,
        journal: { workspaceRoot: root, sessionId: 'session-e3', requestId: 'batch-e3', enabled: true },
      },
    });
    expect(outcome.status).toBe('applied');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('ONE\n');
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('TWO\n');
    expect(outcome.results.every((result) => result.ok)).toBe(true);
    expect(outcome.results.some((result) => result.journal?.batchId)).toBe(true);
    const kinds = outcome.trace?.map((event) => event.kind) ?? [];
    expect(kinds.indexOf('verification-start')).toBeLessThan(kinds.indexOf('first-write-started'));
    expect(kinds.indexOf('first-write-started')).toBeLessThan(kinds.indexOf('post-apply-verified'));
    const journalSteps = outcome.results.reduce((sum, result) => sum + (result.journal?.snapshotIds.length ?? 0), 0);
    expect(journalSteps).toBeGreaterThanOrEqual(2);
    const journalSnapshotFiles = listJournalSnapshotFiles(root, 'session-e3');
    expect(journalSnapshotFiles.length).toBeGreaterThanOrEqual(2);
    const undone = await undoLastWrites({ workspaceRoot: root, sessionId: 'session-e3', steps: journalSteps, workspaceOnly: true });
    expect(undone.errors).toEqual([]);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('one\n');
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('two\n');
  });

  it.each([
      { id: 'target-uncommitted', reason: 'state-changed-before-first-write', mutate: (root: string) => writeFileSync(join(root, 'a.txt'), 'user-edit\n', 'utf8') },
      { id: 'candidate-drift', reason: 'state-changed-before-first-write', mutate: (root: string, candidateRoot: string) => writeFileSync(join(candidateRoot, 'a.txt'), 'candidate-edit\n', 'utf8') },
      { id: 'base-head', reason: 'state-changed-before-first-write', mutate: (root: string) => { writeFileSync(join(root, 'base.txt'), 'drift\n', 'utf8'); git(root, ['add', 'base.txt']); git(root, ['commit', '-m', 'drift']); } },
      { id: 'epoch', reason: 'authority-epoch-mismatch', mutate: (_root: string, _candidateRoot: string, control: HostControl) => { control.authority = { ...control.authority!, epoch: 5 }; } },
      { id: 'revoked', reason: 'grant-revoked', mutate: (_root: string, _candidateRoot: string, control: HostControl) => { control.authority = { ...control.authority!, grantStatus: 'revoked' }; } },
    ] as const)('rejects $id drift before the first write', async (entry) => {
      const root = makeRepo();
      const control: HostControl = {};
      const host = makeHost(control, root);
      control.mutateBeforePermit = ({ candidateRoot }) => entry.mutate(root, candidateRoot, control);
      const outcome = await applyDeferredPatchFlow({
        workers: [worker('run-a', 'a.txt', 'one', 'ONE'), worker('run-b', 'b.txt', 'two', 'TWO')],
        workspaceDir: root,
        candidateApply: {
          host,
          journal: { workspaceRoot: root, sessionId: 'session-e3', requestId: 'batch-e3', enabled: true },
        },
      });
      expect(outcome.status, entry.id).toBe('blocked');
      expect(outcome.decision?.issues, entry.id).toContain(entry.reason);
      expect(outcome.results, entry.id).toEqual([]);
      expect(outcome.trace?.some((event) => event.kind === 'first-write-started'), entry.id).toBe(false);
      expect(readFileSync(join(root, 'b.txt'), 'utf8'), entry.id).toBe('two\n');
      if (entry.id === 'target-uncommitted') expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('user-edit\n');
      else expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('one\n');
  });

  it('does not retry an unknown apply delivery', async () => {
    const root = makeRepo();
    const materialized = await materializePatchCandidate({ workspaceDir: root, proposals: proposals() });
    expect(materialized.status).toBe('frozen');
    if (materialized.status !== 'frozen') return;
    let applies = 0;
    const outcome = await applyCandidateAfterVerification({
      workspaceDir: root,
      candidate: materialized.manifest,
      candidateRoot: materialized.candidateRoot,
      proposals: proposals(),
      host: makeHost({}, root),
      journal: { workspaceRoot: root, sessionId: 'session-e3', requestId: 'batch-e3', enabled: true },
      applyProposals: async () => {
        applies += 1;
        throw new Error('delivery unknown');
      },
    });
    expect(outcome.status).toBe('unknown');
    expect(applies).toBe(1);
    expect(outcome.trace?.filter((event) => event.kind === 'first-write-started')).toHaveLength(1);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('one\n');
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('two\n');
  });

  it('keeps the legacy direct patch-flow path available when no candidate host is configured', async () => {
    const root = makeRepo();
    const outcome = await applyDeferredPatchFlow({
      workers: [worker('run-a', 'a.txt', 'one', 'ONE')],
      workspaceDir: root,
    });
    expect(outcome.status).toBe('applied');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('ONE\n');
  });
});
