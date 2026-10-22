import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVerseGitCompletionStore } from '../../electron/services/versegit-lifecycle';
import { recordDeferredPatchFlowCompletion } from '../../openclaw_runtime/src/agents/orchestration-patch-flow';
import {
  VG_COMPLETION_CONTRACT_VERSION,
  VG_LEGACY_COMPLETION_SCHEMA,
  type VerseGitCompletionIdentity,
} from '../../shared/types/versegit';

const roots: string[] = [];
const tempRoot = process.platform === 'win32' ? 'D:/tmp' : tmpdir();
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function makeRoot(): string {
  const root = mkdtempSync(join(tempRoot, 'versegit-f1-store-'));
  roots.push(root);
  return root;
}
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}
function makeGitRepo(): { root: string; treeOid: string } {
  const root = makeRoot();
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'agent@example.invalid']);
  git(root, ['config', 'user.name', 'Agent']);
  writeFileSync(join(root, 'a.txt'), 'verified\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'verified candidate']);
  return { root, treeOid: git(root, ['rev-parse', 'HEAD^{tree}']) };
}
function identity(input: Partial<VerseGitCompletionIdentity> = {}): VerseGitCompletionIdentity {
  const repo = input.candidateTreeOid ? null : makeGitRepo();
  return {
    ownerId: 'owner-f1',
    epoch: 7,
    authorizationId: 'auth-f1',
    sessionId: 'session-f1',
    runId: 'run-f1',
    candidateId: 'vgc_f1',
    candidateTreeOid: repo?.treeOid ?? input.candidateTreeOid!,
    candidateInputDigest: sha('candidate-input'),
    receiptDigest: sha('receipt'),
    effectId: 'effect-f1',
    ...input,
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
});

describe('persistent host completion lifecycle', () => {
  it('maps applied, not-applied and unknown without claiming provider landed', () => {
    const store = createVerseGitCompletionStore(makeRoot());
    const applied = store.record({ identity: identity({ sessionId: 's-applied' }), hostOutcome: 'applied', idempotencyKey: 'k-applied', actor: 'codex' });
    const notApplied = store.record({ identity: identity({ sessionId: 's-not-applied' }), hostOutcome: 'not_applied', idempotencyKey: 'k-not', actor: 'codex' });
    const unknown = store.record({ identity: identity({ sessionId: 's-unknown' }), hostOutcome: 'unknown', idempotencyKey: 'k-unknown', actor: 'codex' });
    expect(applied.fact).toMatchObject({ providerProjection: 'host-completed', activeSessionRisk: false, recoveryRequired: false, providerLanded: false });
    expect(notApplied.fact).toMatchObject({ providerProjection: 'abandoned', activeSessionRisk: false, recoveryRequired: false, providerLanded: false });
    expect(unknown.fact).toMatchObject({ providerProjection: 'abandoned', activeSessionRisk: false, recoveryRequired: true, providerLanded: false });
    expect(store.contract()).toMatchObject({
      schema: VG_COMPLETION_CONTRACT_VERSION,
      providerSemantics: { providerLanded: false, sessionEndedMeans: 'abandoned/non-landed' },
    });
  });

  it('survives restart, duplicate completion and late epoch without a second landing', () => {
    const root = makeRoot();
    const repo = makeGitRepo();
    const id = identity({ candidateTreeOid: repo.treeOid });
    const first = createVerseGitCompletionStore(root);
    const recorded = first.record({ identity: id, hostOutcome: 'applied', idempotencyKey: 'completion-1', actor: 'codex', recordedAt: '2026-10-22T00:00:00.000Z' });
    expect(recorded.status).toBe('recorded');
    const restarted = createVerseGitCompletionStore(root);
    expect(restarted.read(id.sessionId)?.current.factId).toBe(recorded.fact?.factId);
    expect(restarted.record({ identity: id, hostOutcome: 'applied', idempotencyKey: 'completion-1', actor: 'codex' })).toMatchObject({ status: 'duplicate', reason: 'duplicate_completion' });
    expect(restarted.read(id.sessionId)?.revision).toBe(1);
    expect(restarted.record({ identity: { ...id, epoch: 6 }, hostOutcome: 'not_applied', idempotencyKey: 'completion-old', actor: 'codex' })).toMatchObject({ status: 'rejected', reason: 'late_epoch' });
    expect(restarted.record({ identity: { ...id, epoch: 8 }, hostOutcome: 'not_applied', idempotencyKey: 'completion-2', actor: 'codex' })).toMatchObject({ status: 'rejected', reason: 'completion_terminal' });
  });

  it('requires explicit recovery for unknown and never turns unknown into implicit success', () => {
    const root = makeRoot();
    const store = createVerseGitCompletionStore(root);
    const id = identity({ sessionId: 'session-recovery' });
    const unknown = store.record({ identity: id, hostOutcome: 'unknown', idempotencyKey: 'unknown-1', actor: 'codex' });
    expect(unknown.fact?.recoveryRequired).toBe(true);
    expect(store.record({ identity: { ...id, epoch: 8 }, hostOutcome: 'applied', idempotencyKey: 'recovery-implicit', actor: 'codex' })).toMatchObject({ status: 'rejected', reason: 'recovery_required' });
    const recovered = store.record({
      identity: { ...id, epoch: 8 },
      hostOutcome: 'applied',
      idempotencyKey: 'recovery-explicit',
      actor: 'codex',
      recoveryOf: unknown.fact!.factId,
      reason: 'host re-observed the journaled effect',
    });
    expect(recovered.status).toBe('recorded');
    expect(recovered.fact).toMatchObject({ hostOutcome: 'applied', providerProjection: 'host-completed', providerLanded: false, recoveryOf: unknown.fact!.factId });
    expect(store.read(id.sessionId)?.history).toHaveLength(1);
  });

  it('excludes completed and unknown sessions from active risk projection', () => {
    const store = createVerseGitCompletionStore(makeRoot());
    store.record({ identity: identity({ sessionId: 'applied' }), hostOutcome: 'applied', idempotencyKey: 'a', actor: 'codex' });
    store.record({ identity: identity({ sessionId: 'failed' }), hostOutcome: 'not_applied', idempotencyKey: 'f', actor: 'codex' });
    store.record({ identity: identity({ sessionId: 'unknown' }), hostOutcome: 'unknown', idempotencyKey: 'u', actor: 'codex' });
    expect(store.activeRiskSessions(['active', 'applied', 'failed', 'unknown'])).toEqual(['active']);
  });

  it('reads legacy sessions and refuses to promote success without exact candidate/effect identity', () => {
    const root = makeRoot();
    const store = createVerseGitCompletionStore(root);
    store.writeLegacyRecord({ schema: VG_LEGACY_COMPLETION_SCHEMA, sessionId: 'legacy-success', outcome: 'success', recordedAt: '2026-01-01T00:00:00.000Z' });
    store.writeLegacyRecord({ schema: VG_LEGACY_COMPLETION_SCHEMA, sessionId: 'legacy-cancel', outcome: 'cancelled', recordedAt: '2026-01-01T00:00:00.000Z' });
    expect(store.readLegacy('legacy-success')).toMatchObject({ hostOutcome: 'unknown', legacyUnbound: true, recoveryRequired: true, providerProjection: 'abandoned', providerLanded: false });
    expect(store.readLegacy('legacy-cancel')).toMatchObject({ hostOutcome: 'not_applied', legacyUnbound: false, recoveryRequired: false, providerProjection: 'abandoned' });
  });


  it('is called by the production patch-flow completion seam', () => {
    const store = createVerseGitCompletionStore(makeRoot());
    const candidate = {
      schema: 'clawx.versegit.patch-candidate/v1' as const,
      candidateId: 'vgpatch-production',
      baseOid: 'a'.repeat(40),
      candidateCommitOid: 'b'.repeat(40),
      candidateTreeOid: 'c'.repeat(40),
      candidateInputDigest: sha('production-input'),
      proposalsDigest: sha('proposals'),
      workerIds: ['w1', 'w2'],
      changedFiles: ['a.txt'],
      targetDigests: { 'a.txt': sha('verified') },
      candidateRootRole: 'host-disposable-candidate' as const,
    };
    const outcome = {
      status: 'applied' as const,
      proposalCount: 1,
      results: [],
      appliedAt: 1,
      candidate,
      verification: {
        status: 'passed' as const,
        candidateId: candidate.candidateId,
        baseOid: candidate.baseOid,
        candidateTreeOid: candidate.candidateTreeOid,
        candidateInputDigest: candidate.candidateInputDigest,
        receiptDigest: sha('production-receipt'),
        planDigest: sha('production-plan'),
        checkId: 'production-check',
        ownerId: 'owner-production',
        epoch: 9,
        authorizationId: 'auth-production',
        issues: [],
      },
    };
    const first = recordDeferredPatchFlowCompletion({ outcome, sink: store, sessionId: 'production-session', runId: 'production-run', actor: 'codex' });
    const duplicate = recordDeferredPatchFlowCompletion({ outcome, sink: store, sessionId: 'production-session', runId: 'production-run', actor: 'codex' });
    expect(first).toMatchObject({ status: 'recorded', fact: { hostOutcome: 'applied', providerProjection: 'host-completed', providerLanded: false } });
    expect(duplicate).toMatchObject({ status: 'duplicate', reason: 'duplicate_completion' });
  });
  it('rejects unsupported persisted schema versions', () => {
    const root = makeRoot();
    const store = createVerseGitCompletionStore(root);
    const id = identity({ sessionId: 'schema-drift' });
    store.record({ identity: id, hostOutcome: 'applied', idempotencyKey: 'schema', actor: 'codex' });
    const record = store.read(id.sessionId)!;
    const file = join(root, 'sessions', readdirSync(join(root, 'sessions'))[0]!);
    writeFileSync(file, JSON.stringify({ ...record, schema: 'clawx.versegit.completion-store/v999' }), 'utf8');
    expect(() => store.read(id.sessionId)).toThrow('completion_store_schema_unsupported');
  });
});
