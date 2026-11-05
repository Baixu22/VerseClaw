// Admission adapter inside the existing Ledger owner, not a verification executor.
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';
import type { TaskLedgerCompletionClaim, TaskLedgerCompletionCheckpoint, TaskLedgerCompletionDecision, TaskLedgerSnapshot, TaskLedgerCompletionCheckReceipt, TaskLedgerCompletionCandidate } from '../../shared/types/task-ledger';
import { normalizeAutonomySessionScope } from '../../shared/types/identity-scope';
import { normalizeTaskLedgerCompletionClaim, taskCompletionCandidateMatches, taskLedgerCompletionReferenceGaps, automaticBusinessTaskRequiresClaim, isRuntimeLifecycleProjection } from '../../shared/task-ledger-completion';
import { readTaskExecutionCandidate, readTaskExecutionCandidateAsync } from '../../shared/task-ledger-candidate';
import { taskCompletionArtifactsMatch, taskCompletionArtifactsMatchSync } from '../../shared/task-ledger-artifact';
import { taskLedgerDigest } from '../../shared/task-ledger-journal';
import { taskLedgerSessionEpochPath, withTaskLedgerJournalLock } from '../../shared/task-ledger-journal-lock';
import { readTaskLedgerAgentOwner, type GatewayOwner } from './task-ledger-actions';
import { getActiveWorkspaceProfile, getWorkspaceRootPathById } from './workspaces-api';
import { readCompletedVerseGitTaskCheck } from './versegit-receipt-evidence';
import { commitTaskLedgerOperation, getTaskLedgerDir, readTaskLedgerEvents, replayCommittedTaskLedgerOperation } from './task-ledger-service';

const denied = (message: string) => Object.assign(new Error(message), { code: 'VALIDATION' });
const canonical = (path: string) => { const real = realpathSync(path); return process.platform === 'win32' ? real.toLowerCase() : real; };

/** Receipt storage stays with the existing host artifact authority, never a claim-supplied root. */
export function taskLedgerVerificationEvidenceRoot(workspaceId: string): string {
  return join(getTaskLedgerDir(workspaceId), 'verification-evidence');
}

async function readReferences(gateway: GatewayOwner, claim: TaskLedgerCompletionClaim, requireActive = true,
  candidates?: Map<string, Promise<TaskLedgerCompletionCandidate>>) {
  const { workspaceId, sessionKey } = claim.taskRef.scope;
  const active = requireActive ? await getActiveWorkspaceProfile() : null;
  if (requireActive && (!active || active.id !== workspaceId || active.activeSessionKey !== sessionKey)) throw denied('Task completion is outside the active workspace/session');
  // Selection constrains new writes, not read-only evidence of another task.
  // Both paths still use a Main-owned root and the actual referenced session.
  const rootPath = requireActive ? active?.rootPath : await getWorkspaceRootPathById(workspaceId);
  if (!rootPath) throw denied('Task completion workspace owner is unavailable');
  const workspace = { id: workspaceId, rootPath, activeSessionKey: sessionKey };
  const facts = await gateway.rpc<{ scope: AutonomySessionScope; workspaceRoot: string; executionWorkdir?: string; configSha256: string; checkpoint: TaskLedgerCompletionCheckpoint | null; checks?: TaskLedgerCompletionCheckReceipt[] }>(
    'task_loop.completionEvidence', { workspaceId: workspace.id, sessionKey: workspace.activeSessionKey, checkpointId: claim.checkpointId, verificationRunIds: claim.verificationRunIds }, 20_000);
  const scope = normalizeAutonomySessionScope(claim.taskRef.scope, facts.scope);
  if (canonical(facts.workspaceRoot) !== canonical(workspace.rootPath)) throw denied('Task checkpoint workspace differs from the current workspace owner');
  const executionWorkdir = facts.executionWorkdir ?? workspace.rootPath;
  const candidateKey = canonical(workspace.rootPath) + ':' + canonical(executionWorkdir) + ':' + facts.configSha256;
  let pending = candidates?.get(candidateKey);
  if (!pending) {
    pending = readTaskExecutionCandidateAsync(workspace.rootPath, executionWorkdir, facts.configSha256);
    candidates?.set(candidateKey, pending);
  }
  const currentCandidate = await pending;
  const checks: TaskLedgerCompletionCheckReceipt[] = [];
  for (const runId of claim.verificationRunIds) {
    // Compatibility read for already task-bound VerseGit owner records only;
    // this module has no host receipt producer. Production automatic checks
    // use TaskLoop's exec/effect owner below; no native VerseGit end-to-end
    // completion support is claimed by the synthetic compatibility fixtures.
    const check = readCompletedVerseGitTaskCheck(runId, taskLedgerVerificationEvidenceRoot(workspace.id))
      ?? facts.checks?.find(item => item.verificationRunId === runId && item.owner === 'task-loop-exec-effect');
    if (check && await taskCompletionArtifactsMatch(check)) checks.push(check);
  }
  const gaps = taskLedgerCompletionReferenceGaps({ claim, currentScope: scope, currentCandidate, checkpoint: facts.checkpoint, checks, now: Date.now() });
  return { workspace, executionWorkdir, scope, currentCandidate, checkpoint: facts.checkpoint, checks, gaps };
}

/** A read model only: historical accepted events stay in the journal when evidence drifts. */
export async function readCurrentTaskLedgerCompletions(gateway: GatewayOwner | undefined, snapshot: TaskLedgerSnapshot): Promise<TaskLedgerSnapshot> {
  // Share one candidate scan within this snapshot only. The next snapshot is
  // fresh even when no Ledger revision changed (source bytes may have changed).
  // Filesystem mtimes alone are not an authoritative source revision: copying
  // or restoring bytes can preserve them. Do not add a stale cross-read cache.
  const candidates = new Map<string, Promise<TaskLedgerCompletionCandidate>>();
  const nodes = await Promise.all(snapshot.nodes.map(async node => {
    const decision = node.completionDecision;
    if (!decision?.accepted || node.status !== 'done') return node;
    let gaps: string[];
    try {
      if (!gateway) throw new Error('runtime owner unavailable');
      const refs = await readReferences(gateway, { operationId: decision.operationId, expectedRevision: 0,
        taskRef: decision.taskRef, checkpointId: decision.checkpointId, verificationRunIds: decision.verificationRunIds }, false, candidates);
      gaps = [...refs.gaps];
      if (refs.checkpoint?.ownerRevision !== decision.checkpointRevision
        || taskLedgerDigest(refs.checks.map(check => check.ownerRevision)) !== taskLedgerDigest(decision.verificationRevisions)
        || !decision.candidate || !taskCompletionCandidateMatches(decision.candidate, refs.currentCandidate)) gaps.push('accepted-owner-revision-changed');
      if (taskLedgerDigest(node.metadata?.acceptance) !== decision.acceptanceSha256) gaps.push('task-acceptance-changed');
      if (taskLedgerDigest({ title: node.title, description: node.description ?? '' }) !== decision.taskInputSha256) gaps.push('task-input-changed');
    } catch {
      return { ...node, status: 'review' as const, completedAt: null, completionReadback: { state: 'unavailable' as const, gaps: ['completion-owner-unavailable'] } };
    }
    return { ...node, ...(gaps.length ? { status: 'review' as const, completedAt: null } : {}),
      completionReadback: { state: gaps.length ? 'invalidated' as const : 'accepted' as const, gaps: [...new Set(gaps)] } };
  }));
  const currentGoal = nodes.filter(node => node.kind === 'goal' && node.status !== 'done' && node.status !== 'dropped')
    .sort((left, right) => {
      const rank = (status: string) => status === 'doing' ? 0 : status === 'review' ? 1 : status === 'blocked' ? 2 : 3;
      return rank(left.status) - rank(right.status) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    })[0];
  return { ...snapshot, nodes, reviewNodeIds: [...new Set([...snapshot.reviewNodeIds, ...nodes.filter(node => node.status === 'review').map(node => node.id)])],
    activeNodeIds: nodes.filter(node => node.status === 'doing').map(node => node.id), currentGoalId: currentGoal?.id ?? null };
}

/** Persistent operation/CAS comes from A2; only refs and the owner decision enter this log. */
export async function submitTaskLedgerCompletionClaim(gateway: GatewayOwner | undefined, input: TaskLedgerCompletionClaim) {
  // Structural parsing precedes even historical lookup. The supplied scope must
  // still be resolved against Main/runtime before any new append.
  let claim: TaskLedgerCompletionClaim;
  try { claim = normalizeTaskLedgerCompletionClaim(input, input?.taskRef?.scope); }
  catch (error) { throw denied(error instanceof Error ? error.message : 'Invalid task completion claim'); }
  const workspaceId = claim.taskRef.scope.workspaceId;
  const prior = await replayCommittedTaskLedgerOperation({ workspaceId, operationId: claim.operationId, expectedRevision: claim.expectedRevision, request: claim });
  if (prior) {
    const decision = (await readTaskLedgerEvents(workspaceId)).events.find(event => prior.receipt.eventIds.includes(event.id))?.payload.completionDecision;
    if (!decision || decision.operationId !== claim.operationId) throw denied('Completion operation does not reference the current task decision');
    return { success: true as const, ...prior, snapshot: await readCurrentTaskLedgerCompletions(gateway, prior.snapshot), operationDecision: decision, decisionScope: 'operation-history' as const };
  }
  if (!gateway) throw denied('Automatic completion requires the existing runtime owner');
  const ack = await gateway.rpc<{ gatewayGeneration: string; childPid: number }>('runtime.flags.ack', {}, 3000);
  const runtimeOwner = { childPid: ack.childPid, connectedAt: gateway.getStatus().connectedAt! };
  const ownerRequest = { scope: claim.taskRef.scope, runtimeGeneration: ack.gatewayGeneration, runtimeOwner };
  const admitted = await readTaskLedgerAgentOwner(gateway, ownerRequest);
  const committed = await withTaskLedgerJournalLock(taskLedgerSessionEpochPath(admitted.storePath), async () => {
    const identity = admitted.identity;
    let refs = await readReferences(gateway, claim);
    let decision: TaskLedgerCompletionDecision;
    const eventId = 'completion-' + taskLedgerDigest({ workspaceId, operationId: claim.operationId });
    const events: import('../../shared/types/task-ledger').TaskLedgerEventInput[] = [];
    const recordDecision = () => {
        decision = { operationId: claim.operationId, accepted: refs.gaps.length === 0, taskRef: claim.taskRef,
          checkpointId: claim.checkpointId, checkpointRevision: refs.checkpoint?.ownerRevision ?? null,
          verificationRunIds: claim.verificationRunIds, verificationRevisions: refs.checks.map(check => check.ownerRevision),
          candidate: refs.currentCandidate, acceptanceSha256: refs.checkpoint?.acceptanceSha256 ?? null,
          taskInputSha256: refs.checkpoint?.taskInputSha256 ?? null,
          gaps: refs.gaps, capturedAt: Date.now(), expiresAt: refs.checkpoint ? Math.min(refs.checkpoint.expiresAt, ...refs.checks.map(check => check.expiresAt)) : null, driven_by: 'agent' };
      events.splice(0, events.length, { id: eventId, type: 'completion_decided', actor: 'assistant', taskId: claim.taskRef.taskNodeId, sessionId: identity.scope.sessionKey,
        payload: { nodeId: claim.taskRef.taskNodeId, completionDecision: decision } });
    };
    recordDecision();
    const result = await commitTaskLedgerOperation({ workspaceId, operationId: claim.operationId, expectedRevision: claim.expectedRevision, request: claim, identity, events,
      validateIdentity: async () => {
        const owner = await readTaskLedgerAgentOwner(gateway, ownerRequest);
        if (owner.storePath !== admitted.storePath || taskLedgerDigest(owner.identity) !== taskLedgerDigest(identity)) throw denied('Completion session owner changed');
        refs = await readReferences(gateway, claim);
        recordDecision();
      },
      validateCurrentOwner: async () => {
        const current = await getActiveWorkspaceProfile();
        const status = gateway.getStatus();
        if (current?.id !== workspaceId || current.activeSessionKey !== identity.scope.sessionKey || status.state !== 'running'
          || status.connectedAt !== runtimeOwner.connectedAt || (typeof status.pid === 'number' && status.pid !== runtimeOwner.childPid)) throw denied('Completion owner changed before append');
        if (canonical(current.rootPath) !== canonical(refs.workspace.rootPath)) throw denied('Completion workspace root changed before append');
        // Runtime config/checkpoint mutations fsync a revision event before
        // changing their owner state under this same journal lock. A2 CAS
        // therefore fences the prefetched RPC facts without an RPC/lock cycle.
        const candidate = readTaskExecutionCandidate(refs.workspace.rootPath, refs.executionWorkdir, refs.currentCandidate.configSha256);
        if (!taskCompletionCandidateMatches(refs.currentCandidate, candidate)) throw denied('Candidate changed during completion admission');
        for (const check of refs.checks) {
          const currentCheck = check.owner === 'task-loop-exec-effect' ? check
            : readCompletedVerseGitTaskCheck(check.verificationRunId, taskLedgerVerificationEvidenceRoot(workspaceId));
          if (!currentCheck || !taskCompletionArtifactsMatchSync(currentCheck) || taskLedgerDigest(currentCheck) !== taskLedgerDigest(check)) throw denied('Verification artifact changed during completion admission');
        }
        // Time can cross an expiry after the RPC and while hashing artifacts.
        // Recompute temporal admission at the final boundary before recording it.
        refs.gaps = taskLedgerCompletionReferenceGaps({ claim, currentScope: refs.scope, currentCandidate: candidate,
          checkpoint: refs.checkpoint, checks: refs.checks, now: Date.now() });
        recordDecision();
      },
      validateState: snapshot => {
        const node = snapshot.nodes.find(node => node.id === claim.taskRef.taskNodeId);
        if (!node || !automaticBusinessTaskRequiresClaim(node.kind) || isRuntimeLifecycleProjection(node.metadata)
          || !node.metadata?.automaticCompletion) throw denied('Completion claim requires an automatic business task');
        if (node.status === 'dropped' || node.status === 'done' && !node.completionDecision?.accepted) throw denied('Completion cannot replace a dropped or manually completed task');
        if (decision.accepted && taskLedgerDigest(node.metadata.acceptance) !== decision.acceptanceSha256) throw denied('Task acceptance checklist differs from the checkpoint owner');
        if (decision.accepted && taskLedgerDigest({ title: node.title, description: node.description ?? '' }) !== decision.taskInputSha256) throw denied('Task input differs from the checkpoint owner');
      },
    });
    const persisted = (await readTaskLedgerEvents(workspaceId)).events.find(event => result.receipt.eventIds.includes(event.id))?.payload.completionDecision;
    if (!persisted) throw denied('Committed completion decision is unavailable');
    return { result, persisted };
  });
  // Admission is durable. Derived owner/source reads must not hold up session
  // reset/delete writers behind the epoch fence after the commit has finished.
  return { success: true as const, ...committed.result,
    snapshot: await readCurrentTaskLedgerCompletions(gateway, committed.result.snapshot),
    operationDecision: committed.persisted, decisionScope: 'operation-history' as const };
}
