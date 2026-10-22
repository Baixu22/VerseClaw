#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VG_COMPLETION_CONTRACT_VERSION,
  VG_LEGACY_COMPLETION_SCHEMA,
  VG_HOST_COMPLETION_MAPPING,
  type VerseGitCompletionIdentity,
} from '../shared/types/versegit';
import {
  createVerseGitCompletionStore,
} from '../electron/services/versegit-lifecycle';
import { recordDeferredPatchFlowCompletion } from '../openclaw_runtime/src/agents/orchestration-patch-flow';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'harness/specs/fixtures/versegit-product-integration/f1';
const TEMP_ROOT = process.platform === 'win32' ? 'D:/tmp' : process.env.TMPDIR ?? '/tmp';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  return value;
}
function digest(value: unknown): string { return sha(JSON.stringify(stable(value))); }
function sign(document: Record<string, any>): Record<string, any> {
  const copy = { ...document };
  delete copy.digest;
  copy.digest = digest({ ...copy, generated_at: undefined, digest: undefined });
  return copy;
}
function writeJson(name: string, value: unknown): void {
  const path = resolve(ROOT, OUT, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}
function sourceState() {
  return {
    branch: git(ROOT, ['branch', '--show-current']) || 'detached',
    commit: git(ROOT, ['rev-parse', 'HEAD']),
    tree: git(ROOT, ['rev-parse', 'HEAD^{tree}']),
    dirty: git(ROOT, ['status', '--porcelain=v1', '--untracked-files=normal']).length > 0,
  };
}
function makeRepo(): { root: string; treeOid: string; inputDigest: string } {
  const root = mkdtempSync(join(TEMP_ROOT, 'versegit-f1-repo-'));
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'agent@example.invalid']);
  git(root, ['config', 'user.name', 'Agent']);
  writeFileSync(join(root, 'candidate.txt'), 'host verified candidate\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'candidate']);
  return {
    root,
    treeOid: git(root, ['rev-parse', 'HEAD^{tree}']),
    inputDigest: sha('candidate.txt:' + readFileSync(join(root, 'candidate.txt'), 'utf8')),
  };
}
function identity(input: { sessionId: string; treeOid: string; inputDigest: string; epoch?: number; candidateId?: string }): VerseGitCompletionIdentity {
  return {
    ownerId: 'owner-f1',
    epoch: input.epoch ?? 11,
    authorizationId: 'auth-f1',
    sessionId: input.sessionId,
    runId: 'run-f1',
    candidateId: input.candidateId ?? 'vgc_f1_verified',
    candidateTreeOid: input.treeOid,
    candidateInputDigest: input.inputDigest,
    receiptDigest: sha('receipt:' + input.sessionId),
    effectId: 'effect:' + input.sessionId,
  };
}
const source = sourceState();
if (source.dirty) throw new Error('F1 evidence source candidate is dirty');
const repo = makeRepo();
const storeRoot = mkdtempSync(join(TEMP_ROOT, 'versegit-f1-store-'));
const legacyRoot = mkdtempSync(join(TEMP_ROOT, 'versegit-f1-legacy-'));
const stores = [storeRoot, legacyRoot, repo.root];
try {
  const store = createVerseGitCompletionStore(storeRoot);
  const appliedIdentity = identity({ sessionId: 'session-applied', treeOid: repo.treeOid, inputDigest: repo.inputDigest });
  const cancelledIdentity = identity({ sessionId: 'session-cancelled', treeOid: repo.treeOid, inputDigest: repo.inputDigest });
  const unknownIdentity = identity({ sessionId: 'session-unknown', treeOid: repo.treeOid, inputDigest: repo.inputDigest });
  const applied = store.record({ identity: appliedIdentity, hostOutcome: 'applied', idempotencyKey: 'completion-applied', actor: 'codex', recordedAt: '2026-10-22T00:00:00.000Z' });
  const cancelled = store.record({ identity: cancelledIdentity, hostOutcome: 'not_applied', idempotencyKey: 'completion-cancelled', actor: 'codex', reason: 'host cancelled before apply' });
  const unknown = store.record({ identity: unknownIdentity, hostOutcome: 'unknown', idempotencyKey: 'completion-unknown', actor: 'codex', reason: 'delivery outcome not yet confirmed' });
  const restarted = createVerseGitCompletionStore(storeRoot);
  const restartedApplied = restarted.read(appliedIdentity.sessionId)!;
  const duplicate = restarted.record({ identity: appliedIdentity, hostOutcome: 'applied', idempotencyKey: 'completion-applied', actor: 'codex' });
  const lateEpoch = restarted.record({ identity: { ...appliedIdentity, epoch: 10 }, hostOutcome: 'not_applied', idempotencyKey: 'completion-late', actor: 'codex' });
  const terminal = restarted.record({ identity: { ...appliedIdentity, epoch: 12 }, hostOutcome: 'not_applied', idempotencyKey: 'completion-terminal', actor: 'codex' });
  const implicitRecovery = restarted.record({ identity: { ...unknownIdentity, epoch: 12 }, hostOutcome: 'applied', idempotencyKey: 'completion-implicit', actor: 'codex' });
  const explicitRecovery = restarted.record({
    identity: { ...unknownIdentity, epoch: 12 },
    hostOutcome: 'applied',
    idempotencyKey: 'completion-explicit',
    actor: 'codex',
    recoveryOf: unknown.fact!.factId,
    reason: 'host re-read journal and confirmed applied effect',
  });
  restarted.writeLegacyRecord({ schema: VG_LEGACY_COMPLETION_SCHEMA, sessionId: 'legacy-success', outcome: 'success', recordedAt: '2026-01-01T00:00:00.000Z' });
  restarted.writeLegacyRecord({ schema: VG_LEGACY_COMPLETION_SCHEMA, sessionId: 'legacy-cancelled', outcome: 'cancelled', recordedAt: '2026-01-01T00:00:00.000Z' });
  const legacySuccess = restarted.readLegacy('legacy-success');
  const legacyCancelled = restarted.readLegacy('legacy-cancelled');
  const activeRisk = restarted.activeRiskSessions(['active-session', appliedIdentity.sessionId, cancelledIdentity.sessionId, unknownIdentity.sessionId, 'legacy-success']);
  const productionOutcome = {
    status: 'applied' as const,
    proposalCount: 1,
    results: [],
    appliedAt: 1,
    candidate: {
      schema: 'clawx.versegit.patch-candidate/v1' as const,
      candidateId: 'vgpatch-f1-production',
      baseOid: 'a'.repeat(40),
      candidateCommitOid: 'b'.repeat(40),
      candidateTreeOid: repo.treeOid,
      candidateInputDigest: repo.inputDigest,
      proposalsDigest: sha('proposals'),
      workerIds: ['w1'],
      changedFiles: ['candidate.txt'],
      targetDigests: { 'candidate.txt': sha('host verified candidate\n') },
      candidateRootRole: 'host-disposable-candidate' as const,
    },
    verification: {
      status: 'passed' as const,
      candidateId: 'vgpatch-f1-production',
      baseOid: 'a'.repeat(40),
      candidateTreeOid: repo.treeOid,
      candidateInputDigest: repo.inputDigest,
      receiptDigest: sha('production-receipt'),
      planDigest: sha('production-plan'),
      checkId: 'production-check',
      ownerId: 'owner-production',
      epoch: 13,
      authorizationId: 'auth-production',
      issues: [],
    },
  };
  const productionFact = recordDeferredPatchFlowCompletion({
    outcome: productionOutcome,
    sink: restarted,
    sessionId: 'production-session',
    runId: 'production-run',
    actor: 'codex',
  });
  const contractDocument = sign({
    schema: 'clawx.versegit.f1-completion-contract/v1',
    generated_at: new Date().toISOString(),
    task: 'TF-0535',
    driven_by: 'agent',
    actor: 'codex',
    source,
    contract_version: VG_COMPLETION_CONTRACT_VERSION,
    mapping: VG_HOST_COMPLETION_MAPPING,
    provider_semantics: {
      source_refs: [
        'VerseGit/crates/vg-cli/src/main.rs:596',
        'VerseGit/crates/vg-schema/src/events.rs:116',
      ],
      session_ended_means: 'abandoned/non-landed',
      host_completed_source: 'host-owned versioned completion fact',
      provider_landed: false,
      m4_authorized: false,
    },
    boundaries: { default_off: true, live_ready: false, product_approved: false, real_human_evidence: false },
    passed: true,
  });
  const factSummary = (result: ReturnType<typeof store.record>) => result.fact ? {
    fact_id: result.fact.factId,
    idempotency_key: result.fact.idempotencyKey,
    host_outcome: result.fact.hostOutcome,
    provider_projection: result.fact.providerProjection,
    active_session_risk: result.fact.activeSessionRisk,
    recovery_required: result.fact.recoveryRequired,
    provider_landed: result.fact.providerLanded,
    identity: result.fact.identity,
  } : null;
  const persistedDocument = sign({
    schema: 'clawx.versegit.f1-persisted-outcomes/v1',
    generated_at: new Date().toISOString(),
    task: 'TF-0535',
    driven_by: 'agent',
    actor: 'codex',
    source,
    real_git_repo: { candidateTreeOid: repo.treeOid, candidateInputDigest: repo.inputDigest },
    outcomes: {
      applied: factSummary(applied),
      cancelled: factSummary(cancelled),
      unknown: factSummary(unknown),
    },
    duplicate: { status: duplicate.status, reason: duplicate.reason, revision: restartedApplied.revision },
    late_epoch: { status: lateEpoch.status, reason: lateEpoch.reason },
    terminal_completion: { status: terminal.status, reason: terminal.reason },
    legacy: { success: legacySuccess, cancelled: legacyCancelled },
    active_risk_sessions: activeRisk,
    passed: applied.status === 'recorded' && cancelled.status === 'recorded' && unknown.status === 'recorded'
      && duplicate.status === 'duplicate' && lateEpoch.reason === 'late_epoch'
      && terminal.reason === 'completion_terminal' && legacySuccess?.legacyUnbound === true
      && JSON.stringify(activeRisk) === JSON.stringify(['active-session']),
  });
  const restartDocument = sign({
    schema: 'clawx.versegit.f1-restart-lifecycle/v1',
    generated_at: new Date().toISOString(),
    task: 'TF-0535',
    driven_by: 'agent',
    actor: 'codex',
    source,
    persisted_fact_id: applied.fact?.factId,
    restarted_fact_id: restartedApplied.current.factId,
    restart_matched: applied.fact?.factId === restartedApplied.current.factId,
    duplicate_status: duplicate.status,
    implicit_recovery: { status: implicitRecovery.status, reason: implicitRecovery.reason },
    explicit_recovery: factSummary(explicitRecovery),
    production_seam: productionFact.status === 'recorded' ? productionFact.fact : { status: productionFact.status, reason: productionFact.reason },
    provider_projection_after_restart: restarted.projectProviderState(appliedIdentity.sessionId),
    provider_landed: false,
    active_risk_after_restart: restarted.activeSessionRisk(appliedIdentity.sessionId),
    passed: applied.fact?.factId === restartedApplied.current.factId
      && duplicate.status === 'duplicate'
      && implicitRecovery.reason === 'recovery_required'
      && explicitRecovery.status === 'recorded'
      && productionFact.status === 'recorded'
      && restarted.projectProviderState(appliedIdentity.sessionId) === 'host-completed',
  });
  const serialized = JSON.stringify([contractDocument, persistedDocument, restartDocument]);
  if (/[A-Za-z]:[\\/]/u.test(serialized)) throw new Error('F1 evidence contains an absolute host path');
  writeJson('completion-contract.json', contractDocument);
  writeJson('persisted-outcomes.json', persistedDocument);
  writeJson('restart-lifecycle.json', restartDocument);
  console.log(JSON.stringify({ ok: true, applied: applied.fact?.providerProjection, cancelled: cancelled.fact?.providerProjection, unknown: unknown.fact?.providerProjection, activeRisk, duplicate: duplicate.status, production: productionFact.status }));
} finally {
  for (const root of stores) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); } catch {}
  }
}
