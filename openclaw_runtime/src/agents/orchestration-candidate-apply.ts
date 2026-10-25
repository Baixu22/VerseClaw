/**
 * Candidate-first host apply.
 *
 * Workers produce proposals, the host materializes one disposable candidate,
 * verifies that exact candidate, obtains a current host permit, then rechecks
 * every identity immediately before the existing journaled apply path writes
 * back to the base workspace.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ApplyPatchJournalOptions } from './apply-patch-types.js';
import { applyPatchProposalsSerial, type PatchFlowApplyResult, type PatchProposal } from './patch-flow.js';

const GIT_TIMEOUT_MS = 20_000;

export type PatchCandidateManifest = {
  schema: 'clawx.versegit.patch-candidate/v1';
  candidateId: string;
  baseOid: string;
  candidateCommitOid: string;
  candidateTreeOid: string;
  candidateInputDigest: string;
  proposalsDigest: string;
  workerIds: string[];
  changedFiles: string[];
  targetDigests: Record<string, string | null>;
  candidateRootRole: 'host-disposable-candidate';
};

export type PatchCandidateMaterialization =
  | {
      status: 'frozen';
      manifest: PatchCandidateManifest;
      candidateRoot: string;
      proposalResults: PatchFlowApplyResult[];
    }
  | {
      status: 'failed';
      reason: string;
      issues: string[];
      proposalResults: PatchFlowApplyResult[];
    };

export type CandidateApplyRepositoryState = {
  baseHeadOid: string;
  baseRefsDigest: string;
  baseStatusDigest: string;
  baseTargetDigests: Record<string, string | null>;
  candidatePresent: boolean;
  candidateTreeOid: string;
  candidateInputDigest: string;
  candidateTargetDigests: Record<string, string | null>;
};

export type CandidateApplyAuthorityState = {
  ownerId: string;
  epoch: number;
  authorizationId: string;
  grantId: string | null;
  grantStatus: 'active' | 'revoked' | 'expired' | 'missing';
  grantEpoch: string;
  revocationEpoch: string;
  receiptDigest: string;
  receiptStatus: 'accepted' | 'rejected';
};

export type CandidateApplyVerification = {
  status: 'passed' | 'failed';
  candidateId: string;
  baseOid: string;
  candidateTreeOid: string;
  candidateInputDigest: string;
  receiptDigest: string;
  planDigest: string;
  checkId: string;
  ownerId: string;
  epoch: number;
  authorizationId: string;
  issues: string[];
};

export type CandidateApplyPermit = {
  allowed: boolean;
  permitId: string | null;
  reason: string | null;
  candidateId: string;
  candidateTreeOid: string;
  candidateInputDigest: string;
  receiptDigest: string;
  ownerId: string;
  epoch: number;
  authorizationId: string;
  grantId: string | null;
  expectedSnapshotDigest: string;
};

export type CandidateApplyHost = {
  verifyCandidate(input: {
    candidate: PatchCandidateManifest;
    candidateRoot: string;
    proposals: readonly PatchProposal[];
    repository: CandidateApplyRepositoryState;
  }): Promise<CandidateApplyVerification>;
  authorizeCandidate(input: {
    verification: CandidateApplyVerification;
    candidate: PatchCandidateManifest;
    repository: CandidateApplyRepositoryState;
    authority: CandidateApplyAuthorityState;
  }): Promise<CandidateApplyPermit>;
  readAuthorityState(input: {
    candidate: PatchCandidateManifest;
    repository: CandidateApplyRepositoryState;
  }): Promise<CandidateApplyAuthorityState>;
};

export type CandidateApplyTraceKind =
  | 'candidate-frozen'
  | 'verification-start'
  | 'verification-passed'
  | 'verification-failed'
  | 'permit-granted'
  | 'permit-denied'
  | 'preflight-checked'
  | 'preflight-rejected'
  | 'first-write-started'
  | 'write-completed'
  | 'post-apply-verified'
  | 'candidate-cleaned'
  | 'cleanup-failed';

export type CandidateApplyTraceEvent = {
  seq: number;
  at: number;
  kind: CandidateApplyTraceKind;
  details: Record<string, unknown>;
};

export type CandidateApplyDecision = {
  allowed: boolean;
  reason: string | null;
  issues: string[];
  verifiedSnapshotDigest: string | null;
  finalSnapshotDigest: string | null;
};

export type CandidateFirstApplyOutcome = {
  status: 'applied' | 'partial' | 'verification-failed' | 'preflight-rejected' | 'apply-failed' | 'unknown';
  reason: string | null;
  candidate: PatchCandidateManifest | null;
  verification: CandidateApplyVerification | null;
  permit: CandidateApplyPermit | null;
  decision: CandidateApplyDecision;
  proposalResults: PatchFlowApplyResult[];
  trace: CandidateApplyTraceEvent[];
  cleanup: { ok: boolean; issues: string[] };
};

export type CandidateApplyRepositorySnapshot = {
  repository: CandidateApplyRepositoryState;
  authority: CandidateApplyAuthorityState;
  capturedAt: number;
};

export type CandidateFirstApplyOptions = {
  workspaceDir: string;
  candidate: PatchCandidateManifest;
  candidateRoot: string;
  proposals: readonly PatchProposal[];
  host: CandidateApplyHost;
  journal: ApplyPatchJournalOptions;
  now?: () => number;
  applyProposals?: typeof applyPatchProposalsSerial;
};
function hardenedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Codex Agent',
    GIT_AUTHOR_EMAIL: 'agent@example.invalid',
    GIT_COMMITTER_NAME: 'Codex Agent',
    GIT_COMMITTER_EMAIL: 'agent@example.invalid',
    ...extra,
  };
}
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    env: hardenedEnv(),
  }).trim();
}
function sha(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  }
  return value;
}
function digest(value: unknown): string {
  return sha(JSON.stringify(stable(value)));
}
function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}
function trackedInputs(root: string): Array<{ path: string; sha256: string; bytes: number }> {
  return git(root, ['ls-files', '-z'])
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .sort()
    .map((path) => {
      const bytes = readFileSync(join(root, ...path.split('/')));
      return { path, sha256: sha(bytes), bytes: bytes.byteLength };
    });
}
function fileDigest(root: string, path: string): string | null {
  const absolute = join(root, ...path.split('/'));
  return existsSync(absolute) ? sha(readFileSync(absolute)) : null;
}
function refsDigest(root: string): string {
  return sha(git(root, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads']));
}
function statusDigest(root: string): string {
  return sha(git(root, ['status', '--porcelain=v1', '--untracked-files=all']));
}
function changedFilesFrom(root: string, baseOid: string): string[] {
  const tracked = git(root, ['diff', '--name-only', baseOid, '--']).split(/\r?\n/u).filter(Boolean);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']).split(/\r?\n/u).filter(Boolean);
  return [...new Set([...tracked, ...untracked].map(normalizePath))].sort();
}
function removeCandidateWorktreeSync(baseRoot: string, candidateRoot: string): void {
  if (!existsSync(candidateRoot)) return;
  try {
    git(baseRoot, ['worktree', 'remove', '--force', candidateRoot]);
    return;
  } catch {
    try { rmSync(candidateRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); } catch { /* best effort after timeout */ }
    try { git(baseRoot, ['worktree', 'prune']); } catch { /* best effort */ }
  }
}

export async function materializePatchCandidate(input: {
  workspaceDir: string;
  proposals: readonly PatchProposal[];
  expectedBaseOid?: string;
  candidateId?: string;
  applyProposals?: typeof applyPatchProposalsSerial;
}): Promise<PatchCandidateMaterialization> {
  if (input.proposals.length === 0) return { status: 'failed', reason: 'no-proposals', issues: [], proposalResults: [] };
  const workspaceDir = resolve(input.workspaceDir);
  const baseOid = git(workspaceDir, ['rev-parse', 'HEAD']);
  if (input.expectedBaseOid && baseOid !== input.expectedBaseOid) {
    return { status: 'failed', reason: 'base-drift', issues: [input.expectedBaseOid, baseOid], proposalResults: [] };
  }
  const baseStatus = git(workspaceDir, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (baseStatus.length > 0) {
    return { status: 'failed', reason: 'base-worktree-dirty', issues: baseStatus.split(/\r?\n/u), proposalResults: [] };
  }
  const proposalsDigest = digest(input.proposals.map((proposal) => ({
    workerId: proposal.workerId,
    patchText: proposal.patchText,
    writeSet: proposal.writeSet ?? [],
  })));
  const candidateId = input.candidateId ?? `vgpatch_${sha(JSON.stringify({ baseOid, proposalsDigest })).slice(0, 24)}`;
  const candidateRoot = join(workspaceDir, '.openclaw', 'candidates', candidateId);
  if (existsSync(candidateRoot)) {
    return { status: 'failed', reason: 'candidate-path-exists', issues: [candidateId], proposalResults: [] };
  }
  mkdirSync(dirname(candidateRoot), { recursive: true });
  try {
    git(workspaceDir, ['worktree', 'add', '--detach', candidateRoot, baseOid]);
  } catch (error) {
    return { status: 'failed', reason: 'candidate-materialize-failed', issues: [String((error as Error).message ?? error)], proposalResults: [] };
  }
  try {
    const proposalResults = await (input.applyProposals ?? applyPatchProposalsSerial)({
      cwd: candidateRoot,
      proposals: [...input.proposals],
    });
    if (!proposalResults.every((result) => result.ok)) {
      removeCandidateWorktreeSync(workspaceDir, candidateRoot);
      return {
        status: 'failed',
        reason: 'proposal-apply-failed',
        issues: proposalResults.flatMap((result) => result.error ? [`${result.workerId}:${result.error}`] : []),
        proposalResults,
      };
    }
    git(candidateRoot, ['add', '-A']);
    const candidateTreeOid = git(candidateRoot, ['write-tree']);
    const candidateCommitOid = git(workspaceDir, [
      'commit-tree',
      candidateTreeOid,
      '-p',
      baseOid,
      '-m',
      `verified candidate ${candidateId}`,
    ]);
    git(candidateRoot, ['reset', '--hard', candidateCommitOid]);
    const changedFiles = changedFilesFrom(candidateRoot, baseOid);
    const targetDigests: Record<string, string | null> = Object.fromEntries(
      changedFiles.map((file) => [file, fileDigest(candidateRoot, file)]),
    );
    const inputs = trackedInputs(candidateRoot);
    const manifest: PatchCandidateManifest = {
      schema: 'clawx.versegit.patch-candidate/v1',
      candidateId,
      baseOid,
      candidateCommitOid,
      candidateTreeOid,
      candidateInputDigest: digest(inputs),
      proposalsDigest,
      workerIds: input.proposals.map((proposal) => proposal.workerId),
      changedFiles,
      targetDigests,
      candidateRootRole: 'host-disposable-candidate',
    };
    return { status: 'frozen', manifest, candidateRoot, proposalResults };
  } catch (error) {
    removeCandidateWorktreeSync(workspaceDir, candidateRoot);
    return {
      status: 'failed',
      reason: 'candidate-freeze-failed',
      issues: [String((error as Error).message ?? error)],
      proposalResults: [],
    };
  }
}

export async function readCandidateApplyRepositoryState(input: {
  workspaceDir: string;
  candidateRoot: string;
  candidate: PatchCandidateManifest;
}): Promise<CandidateApplyRepositoryState> {
  const baseTargetDigests: Record<string, string | null> = {};
  const candidateTargetDigests: Record<string, string | null> = {};
  for (const path of input.candidate.changedFiles) {
    baseTargetDigests[path] = fileDigest(input.workspaceDir, path);
    candidateTargetDigests[path] = fileDigest(input.candidateRoot, path);
  }
  const candidatePresent = existsSync(input.candidateRoot) && existsSync(join(input.candidateRoot, '.git'));
  return {
    baseHeadOid: git(input.workspaceDir, ['rev-parse', 'HEAD']),
    baseRefsDigest: refsDigest(input.workspaceDir),
    baseStatusDigest: statusDigest(input.workspaceDir),
    baseTargetDigests,
    candidatePresent,
    candidateTreeOid: candidatePresent ? git(input.candidateRoot, ['rev-parse', 'HEAD^{tree}']) : '',
    candidateInputDigest: candidatePresent ? digest(trackedInputs(input.candidateRoot)) : '',
    candidateTargetDigests,
  };
}
export function candidateApplySnapshotDigest(input: {
  repository: CandidateApplyRepositoryState;
  authority: CandidateApplyAuthorityState;
}): string {
  return digest(input);
}

function sameIdentity(
  verification: CandidateApplyVerification,
  candidate: PatchCandidateManifest,
  permit: CandidateApplyPermit,
): boolean {
  return verification.candidateId === candidate.candidateId
    && verification.baseOid === candidate.baseOid
    && verification.candidateTreeOid === candidate.candidateTreeOid
    && verification.candidateInputDigest === candidate.candidateInputDigest
    && permit.candidateId === candidate.candidateId
    && permit.candidateTreeOid === candidate.candidateTreeOid
    && permit.candidateInputDigest === candidate.candidateInputDigest
    && permit.receiptDigest === verification.receiptDigest
    && permit.ownerId === verification.ownerId
    && permit.epoch === verification.epoch
    && permit.authorizationId === verification.authorizationId;
}

export function evaluateCandidateApplyPreflight(input: {
  candidate: PatchCandidateManifest;
  beforeVerification: CandidateApplyRepositoryState;
  afterVerification: CandidateApplyRepositoryState;
  verification: CandidateApplyVerification;
  permit: CandidateApplyPermit;
  authority: CandidateApplyAuthorityState;
  finalRepository: CandidateApplyRepositoryState;
}): CandidateApplyDecision {
  const issues: string[] = [];
  const add = (condition: boolean, issue: string) => { if (!condition) issues.push(issue); };
  const beforeDigest = digest(input.beforeVerification);
  const finalDigest = digest(input.finalRepository);
  add(input.verification.status === 'passed', 'verification-not-passed');
  add(input.verification.issues.length === 0, 'verification-issues-present');
  add(input.permit.allowed === true && Boolean(input.permit.permitId), input.permit.reason ?? 'host-permit-missing');
  add(sameIdentity(input.verification, input.candidate, input.permit), 'permit-verification-identity-mismatch');
  add(input.authority.ownerId === input.verification.ownerId, 'authority-owner-mismatch');
  add(input.authority.epoch === input.verification.epoch, 'authority-epoch-mismatch');
  add(input.authority.authorizationId === input.verification.authorizationId, 'authorization-id-mismatch');
  add(input.authority.receiptDigest === input.verification.receiptDigest, 'receipt-digest-mismatch');
  add(input.authority.receiptStatus === 'accepted', 'receipt-not-accepted');
  add(input.authority.grantStatus === 'active', input.authority.grantStatus === 'revoked' ? 'grant-revoked' : 'grant-not-active');
  add(input.authority.grantId === input.permit.grantId, 'grant-id-mismatch');
  add(digest(input.beforeVerification) === digest(input.afterVerification), 'base-or-candidate-changed-during-verification');
  add(beforeDigest === finalDigest, 'state-changed-before-first-write');
  add(input.finalRepository.baseHeadOid === input.candidate.baseOid, 'base-head-drift');
  add(input.finalRepository.baseStatusDigest === sha(''), 'base-worktree-not-clean');
  add(input.finalRepository.candidatePresent === true, 'candidate-missing');
  add(input.finalRepository.candidateTreeOid === input.candidate.candidateTreeOid, 'candidate-tree-drift');
  add(input.finalRepository.candidateInputDigest === input.candidate.candidateInputDigest, 'candidate-input-drift');
  add(JSON.stringify(input.finalRepository.candidateTargetDigests) === JSON.stringify(input.candidate.targetDigests), 'candidate-target-drift');
  add(input.permit.expectedSnapshotDigest === candidateApplySnapshotDigest({
    repository: input.afterVerification,
    authority: input.authority,
  }), 'permit-snapshot-digest-mismatch');
  const reason = issues[0] ?? null;
  return {
    allowed: issues.length === 0,
    reason,
    issues: [...new Set(issues)],
    verifiedSnapshotDigest: candidateApplySnapshotDigest({ repository: input.afterVerification, authority: input.authority }),
    finalSnapshotDigest: candidateApplySnapshotDigest({ repository: input.finalRepository, authority: input.authority }),
  };
}

export async function cleanupPatchCandidate(input: {
  workspaceDir: string;
  candidateRoot: string;
}): Promise<{ ok: boolean; issues: string[] }> {
  const issues: string[] = [];
  for (let attempt = 0; attempt < 120 && existsSync(input.candidateRoot); attempt += 1) {
    try {
      rmSync(input.candidateRoot, { recursive: true, force: true, maxRetries: 1, retryDelay: 100 });
    } catch (error) {
      if (attempt === 119) issues.push(String((error as Error)?.message ?? error));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
  }
  try { git(input.workspaceDir, ['worktree', 'prune']); } catch { /* best effort */ }
  if (existsSync(input.candidateRoot)) issues.push('candidate-worktree-survived-cleanup');
  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

function transition(
  trace: CandidateApplyTraceEvent[],
  now: () => number,
  kind: CandidateApplyTraceKind,
  details: Record<string, unknown> = {},
): void {
  trace.push({ seq: trace.length + 1, at: now(), kind, details });
}

function blockedDecision(reason: string): CandidateApplyDecision {
  return { allowed: false, reason, issues: [reason], verifiedSnapshotDigest: null, finalSnapshotDigest: null };
}

export async function applyCandidateAfterVerification(
  input: CandidateFirstApplyOptions,
): Promise<CandidateFirstApplyOutcome> {
  const now = input.now ?? Date.now;
  const trace: CandidateApplyTraceEvent[] = [];
  transition(trace, now, 'candidate-frozen', {
    candidateId: input.candidate.candidateId,
    baseOid: input.candidate.baseOid,
    candidateTreeOid: input.candidate.candidateTreeOid,
    candidateInputDigest: input.candidate.candidateInputDigest,
  });
  const cleanup = async () => {
    const result = await cleanupPatchCandidate({ workspaceDir: input.workspaceDir, candidateRoot: input.candidateRoot });
    transition(trace, now, result.ok ? 'candidate-cleaned' : 'cleanup-failed', result);
    return result;
  };

  let beforeVerification: CandidateApplyRepositoryState;
  try {
    beforeVerification = await readCandidateApplyRepositoryState(input);
  } catch (error) {
    return {
      status: 'unknown', reason: `repository-snapshot-failed:${String((error as Error)?.message ?? error)}`,
      candidate: input.candidate, verification: null, permit: null, decision: blockedDecision('repository-snapshot-failed'),
      proposalResults: [], trace, cleanup: await cleanup(),
    };
  }
  transition(trace, now, 'verification-start', { candidateId: input.candidate.candidateId });
  let verification: CandidateApplyVerification;
  try {
    verification = await input.host.verifyCandidate({
      candidate: input.candidate,
      candidateRoot: input.candidateRoot,
      proposals: input.proposals,
      repository: beforeVerification,
    });
  } catch (error) {
    const reason = `verification-error:${String((error as Error)?.message ?? error)}`;
    return {
      status: 'verification-failed', reason, candidate: input.candidate, verification: null, permit: null,
      decision: blockedDecision(reason), proposalResults: [], trace, cleanup: await cleanup(),
    };
  }
  transition(trace, now, verification.status === 'passed' ? 'verification-passed' : 'verification-failed', {
    receiptDigest: verification.receiptDigest,
    planDigest: verification.planDigest,
    issues: verification.issues,
  });
  if (verification.status !== 'passed') {
    return {
      status: 'verification-failed', reason: verification.issues[0] ?? 'verification-failed',
      candidate: input.candidate, verification, permit: null, decision: blockedDecision('verification-failed'),
      proposalResults: [], trace, cleanup: await cleanup(),
    };
  }

  let afterVerification: CandidateApplyRepositoryState;
  let authority: CandidateApplyAuthorityState;
  try {
    afterVerification = await readCandidateApplyRepositoryState(input);
    authority = await input.host.readAuthorityState({ candidate: input.candidate, repository: afterVerification });
  } catch (error) {
    const reason = `authority-snapshot-failed:${String((error as Error)?.message ?? error)}`;
    return {
      status: 'preflight-rejected', reason, candidate: input.candidate, verification, permit: null,
      decision: blockedDecision(reason), proposalResults: [], trace, cleanup: await cleanup(),
    };
  }
  let permit: CandidateApplyPermit;
  try {
    permit = await input.host.authorizeCandidate({
      verification,
      candidate: input.candidate,
      repository: afterVerification,
      authority,
    });
  } catch (error) {
    const reason = `permit-error:${String((error as Error)?.message ?? error)}`;
    return {
      status: 'preflight-rejected', reason, candidate: input.candidate, verification, permit: null,
      decision: blockedDecision(reason), proposalResults: [], trace, cleanup: await cleanup(),
    };
  }
  transition(trace, now, permit.allowed ? 'permit-granted' : 'permit-denied', {
    permitId: permit.permitId,
    reason: permit.reason,
    expectedSnapshotDigest: permit.expectedSnapshotDigest,
  });
  let finalRepository: CandidateApplyRepositoryState;
  let finalAuthority: CandidateApplyAuthorityState;
  try {
    finalRepository = await readCandidateApplyRepositoryState(input);
    finalAuthority = await input.host.readAuthorityState({ candidate: input.candidate, repository: finalRepository });
  } catch (error) {
    const reason = `final-preflight-snapshot-failed:${String((error as Error)?.message ?? error)}`;
    return {
      status: 'preflight-rejected', reason, candidate: input.candidate, verification, permit,
      decision: blockedDecision(reason), proposalResults: [], trace, cleanup: await cleanup(),
    };
  }
  const decision = evaluateCandidateApplyPreflight({
    candidate: input.candidate,
    beforeVerification,
    afterVerification,
    verification,
    permit,
    authority: finalAuthority,
    finalRepository,
  });
  transition(trace, now, decision.allowed ? 'preflight-checked' : 'preflight-rejected', decision);
  if (!decision.allowed) {
    return {
      status: 'preflight-rejected', reason: decision.reason, candidate: input.candidate,
      verification, permit, decision, proposalResults: [], trace, cleanup: await cleanup(),
    };
  }
  void authority;

  const apply = input.applyProposals ?? applyPatchProposalsSerial;
  transition(trace, now, 'first-write-started', {
    journalSessionId: input.journal.sessionId,
    journalRequestId: input.journal.requestId,
    proposalCount: input.proposals.length,
  });
  let results: PatchFlowApplyResult[];
  try {
    results = await apply({
      cwd: input.workspaceDir,
      proposals: [...input.proposals],
      journal: input.journal,
    });
  } catch (error) {
    return {
      status: 'unknown', reason: `apply-delivery-unknown:${String((error as Error)?.message ?? error)}`,
      candidate: input.candidate, verification, permit, decision, proposalResults: [], trace, cleanup: await cleanup(),
    };
  }
  transition(trace, now, 'write-completed', {
    resultCount: results.length,
    okCount: results.filter((result) => result.ok).length,
    journalBatchIds: results.flatMap((result) => result.journal?.batchId ? [result.journal.batchId] : []),
  });
  const allOk = results.length === input.proposals.length && results.every((result) => result.ok);
  if (!allOk) {
    return {
      status: results.some((result) => result.ok) ? 'partial' : 'apply-failed',
      reason: 'journaled apply did not complete every proposal',
      candidate: input.candidate, verification, permit, decision, proposalResults: results, trace,
      cleanup: await cleanup(),
    };
  }
  const postRepository = await readCandidateApplyRepositoryState(input);
  const postMatchesCandidate = JSON.stringify(postRepository.baseTargetDigests) === JSON.stringify(input.candidate.targetDigests);
  transition(trace, now, postMatchesCandidate ? 'post-apply-verified' : 'preflight-rejected', {
    changedFiles: input.candidate.changedFiles,
    targetDigests: postRepository.baseTargetDigests,
  });
  return {
    status: postMatchesCandidate ? 'applied' : 'apply-failed',
    reason: postMatchesCandidate ? null : 'post-apply-target-digest-mismatch',
    candidate: input.candidate,
    verification,
    permit,
    decision,
    proposalResults: results,
    trace,
    cleanup: await cleanup(),
  };
}