import type { TaskLedgerNodeKind, TaskLedgerNodeStatus } from './types/task-ledger.js';
import type { AutonomySessionScope } from './types/identity-scope.js';
import { normalizeScopedTaskReference } from './types/task-ledger-reference.js';
import type { TaskLedgerCompletionClaim, TaskLedgerCompletionCandidate, TaskLedgerCompletionCheckpoint, TaskLedgerCompletionCheckReceipt } from './types/task-ledger.js';
import { taskLedgerDigest } from './task-ledger-journal.js';

/** Only intake may propose programs; verification later takes record references only. */
export function normalizeTaskCompletionCheckPlans(value: unknown, acceptance: readonly string[]): TaskLedgerCompletionCheckpoint['verificationChecks'] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.length || value.length > 64 || !acceptance.length) throw new TypeError('Verification checks require a bounded acceptance checklist');
  const plans = value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['acceptanceIndex', 'command'].includes(key))) throw new TypeError('Verification programs accept only acceptanceIndex and command');
    const input = item as Record<string, unknown>;
    if (!Number.isSafeInteger(input.acceptanceIndex) || Number(input.acceptanceIndex) < 0 || Number(input.acceptanceIndex) >= acceptance.length
      || typeof input.command !== 'string' || !input.command.trim() || input.command.length > 20000) throw new TypeError('Verification requires an existing acceptance criterion and a bounded command');
    return { checkId: 'acceptance:' + taskLedgerDigest(acceptance[Number(input.acceptanceIndex)]), command: input.command };
  });
  if (plans.length !== acceptance.length || new Set(plans.map(plan => plan.checkId)).size !== plans.length) throw new TypeError('Verification programs must cover the frozen acceptance checklist exactly once');
  return plans;
}

/** Runtime termination is a fact to review, not independent task acceptance. */
export function projectTaskLoopTaskStatus(status?: string): TaskLedgerNodeStatus {
  if (status === 'complete') return 'review';
  if (status === 'blocked' || status === 'error') return 'blocked';
  return 'doing';
}

/** Execution progress is distinct from the Ledger's independent acceptance. */
export function projectTaskLoopTaskProgress(status?: string, progress?: number): number | undefined {
  return progress ?? (status === 'complete' || projectTaskLoopTaskStatus(status) === 'blocked' ? 100 : undefined);
}

/** Applies to new automatic business tasks, not manual facts or turn checks. */
export function automaticBusinessTaskRequiresClaim(kind: TaskLedgerNodeKind): boolean {
  return kind === 'task' || kind === 'goal' || kind === 'milestone';
}

/**
 * Mission Control and ClawGraph project their own runtime lifecycle into the
 * Ledger. Their terminal status is that runtime owner's fact, not an automatic
 * business task awaiting independent acceptance, so the completion-claim fence
 * must not rewrite it into review.
 */
export function isRuntimeLifecycleProjection(metadata: Record<string, unknown> | undefined, nodeId?: string): boolean {
  const owner = metadata?.runtimeLifecycle;
  if (owner === 'mission-control' || owner === 'clawgraph') return true;
  // Older internal recorder journals use these owner-qualified node IDs.
  return Boolean(nodeId && (
    typeof metadata?.missionId === 'string' && nodeId.startsWith(`mission:${metadata.missionId}:`)
    || typeof metadata?.runId === 'string' && nodeId.startsWith(`clawgraph:${metadata.runId}:`)
  ));
}

/** Boundary parsing only. The referenced owner records still have to be read. */
export function normalizeTaskLedgerCompletionClaim(value: unknown, currentScope: AutonomySessionScope): TaskLedgerCompletionClaim {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Completion claim must be an object');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['operationId', 'expectedRevision', 'taskRef', 'checkpointId', 'verificationRunIds'].includes(key))) {
    throw new TypeError('Completion claims may only reference owner records; caller verdicts and identities are forbidden');
  }
  const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
  if (!text(input.operationId) || (input.operationId as string).length > 200 || !text(input.checkpointId) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0
    || !Array.isArray(input.verificationRunIds) || !input.verificationRunIds.length || input.verificationRunIds.length > 64
    || !input.verificationRunIds.every(text) || new Set(input.verificationRunIds).size !== input.verificationRunIds.length) {
    throw new TypeError('Completion claim requires a stable operation, revision, checkpoint and distinct verification references');
  }
  const taskRef = normalizeScopedTaskReference(input.taskRef, currentScope);
  if (taskRef.owner !== 'task-ledger') throw new TypeError('Task Forest completion authority is not owned by this Ledger operation');
  return { operationId: input.operationId as string, expectedRevision: input.expectedRevision as number,
    taskRef: taskRef as TaskLedgerCompletionClaim['taskRef'], checkpointId: input.checkpointId as string,
    verificationRunIds: [...input.verificationRunIds] as string[] };
}

/** Reused provenance comparison; it creates no verdict, authorization or owner record. */
export function taskCompletionCandidateMatches(verified: TaskLedgerCompletionCandidate, current: TaskLedgerCompletionCandidate): boolean {
  const hashes = ['inputSha256', 'configSha256', 'dirtyDiffSha256'] as const;
  return Boolean(verified.source?.trim()) && verified.source === current.source
    && hashes.every(field => /^[a-f0-9]{64}$/u.test(verified[field]) && verified[field] === current[field]);
}

/**
 * Task Ledger's consumption boundary for records read by existing owners.
 * It returns diagnostic gaps, never creates a verdict, runs a verifier or writes
 * a task. The Main adapter must resolve all records itself before calling this.
 */
export function taskLedgerCompletionReferenceGaps(input: {
  claim: TaskLedgerCompletionClaim;
  currentScope: AutonomySessionScope;
  currentCandidate: TaskLedgerCompletionCandidate;
  checkpoint: TaskLedgerCompletionCheckpoint | null;
  checks: readonly TaskLedgerCompletionCheckReceipt[];
  now: number;
}): string[] {
  const gaps: string[] = [];
  const checkpoint = input.checkpoint;
  const hash = (value: string) => /^[a-f0-9]{64}$/u.test(value);
  const fresh = (item: { capturedAt: number; expiresAt: number }) => Number.isFinite(item.capturedAt) && Number.isFinite(item.expiresAt)
    && item.capturedAt <= input.now && input.now < item.expiresAt && item.expiresAt > item.capturedAt;
  const sameTask = (ref: TaskLedgerCompletionClaim['taskRef']) => {
    try {
      const current = normalizeScopedTaskReference(ref, input.currentScope);
      return current.owner === 'task-ledger' && current.taskNodeId === input.claim.taskRef.taskNodeId;
    } catch { return false; }
  };
  if (!sameTask(input.claim.taskRef)) gaps.push('claim-task-scope-mismatch');
  if (!checkpoint) return [...gaps, 'task-loop-owner-unavailable'];
  if (checkpoint.owner !== 'task-loop' || checkpoint.checkpointId !== input.claim.checkpointId || !hash(checkpoint.ownerRevision)
    || !checkpoint.loopRunId.trim() || !sameTask(checkpoint.taskRef)) gaps.push('checkpoint-owner-task-mismatch');
  if (checkpoint.status !== 'complete' || checkpoint.evidenceGate !== 'pass' || checkpoint.selfCheckDecision !== 'complete') gaps.push('task-loop-not-verified-complete');
  if (!fresh(checkpoint)) gaps.push('checkpoint-stale');
  if (!taskCompletionCandidateMatches(checkpoint.candidate, input.currentCandidate)) gaps.push('checkpoint-candidate-mismatch');
  if (checkpoint.reviewSource?.state !== 'pinned' || !checkpoint.reviewSource.workspaceRoot.trim()
    || !Number.isFinite(checkpoint.reviewSource.capturedAt) || checkpoint.reviewSource.capturedAt > checkpoint.capturedAt
    || !taskCompletionCandidateMatches(checkpoint.reviewSource.candidate, checkpoint.candidate)) gaps.push('reviewer-candidate-missing-or-mismatch');
  if (!hash(checkpoint.acceptanceSha256) || !hash(checkpoint.taskInputSha256) || !checkpoint.requiredCheckIds.length
    || checkpoint.requiredCheckIds.some(id => !id.trim()) || new Set(checkpoint.requiredCheckIds).size !== checkpoint.requiredCheckIds.length) gaps.push('acceptance-checklist-missing');
  if (!checkpoint.verifierRunId.trim() || !checkpoint.workerRunIds.length || checkpoint.workerRunIds.includes(checkpoint.verifierRunId)
    || checkpoint.reviewer.runId !== checkpoint.verifierRunId || !checkpoint.reviewer.agentId.trim() || !checkpoint.reviewer.sessionKey.trim()
    || new Set(checkpoint.workerRunIds).size !== checkpoint.workerRunIds.length) gaps.push('independent-reviewer-missing');
  if (input.checks.length !== input.claim.verificationRunIds.length || new Set(input.checks.map(check => check.verificationRunId)).size !== input.checks.length) gaps.push('verification-reference-set-mismatch');
  for (const check of input.checks) {
    if (!['verseshell-host-receipt', 'task-loop-exec-effect'].includes(check.owner) || !input.claim.verificationRunIds.includes(check.verificationRunId)
      || !hash(check.ownerRevision) || !check.receiptId.trim() || !sameTask(check.taskRef)
      || check.checkpointId !== checkpoint.checkpointId || check.checkpointRevision !== checkpoint.ownerRevision) gaps.push('check-owner-revision-task-mismatch');
    if (!taskCompletionCandidateMatches(check.candidate, input.currentCandidate) || check.acceptanceSha256 !== checkpoint.acceptanceSha256) gaps.push('check-candidate-or-acceptance-mismatch');
    if (!checkpoint.requiredCheckIds.includes(check.checkId) || check.status !== 'verified' || check.exitCode !== 0) gaps.push('check-not-verified');
    if (!fresh(check) || check.capturedAt < checkpoint.capturedAt) gaps.push('check-stale');
    if (check.reviewer.runId !== checkpoint.verifierRunId || checkpoint.workerRunIds.includes(check.reviewer.runId)
      || check.reviewer.agentId !== checkpoint.reviewer.agentId || check.reviewer.sessionKey !== checkpoint.reviewer.sessionKey
      || !check.reviewer.agentId.trim() || !check.reviewer.sessionKey.trim()) gaps.push('reviewer-owner-mismatch');
    const artifactOwner = check.owner === 'task-loop-exec-effect' ? 'context-archive' : 'verseshell-host-receipt';
    if (!check.artifactRefs.length || check.artifactRefs.some(ref => ref.owner !== artifactOwner || !ref.ref.trim() || !hash(ref.sha256) || !ref.verified
      || (artifactOwner === 'context-archive' && !ref.path))) gaps.push('artifact-missing-or-unverified');
  }
  if (checkpoint.requiredCheckIds.some(id => !input.checks.some(check => check.checkId === id))
    || new Set(input.checks.map(check => check.checkId)).size !== input.checks.length) gaps.push('required-check-coverage-missing');
  return [...new Set(gaps)];
}
