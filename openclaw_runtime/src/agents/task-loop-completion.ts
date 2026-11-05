import { resolve } from 'node:path';
import type { OpenClawConfig } from '../config/types.openclaw.js';
import { parseAgentSessionKey } from '../routing/session-key.js';
import { resolveAgentWorkspaceDir } from './agent-scope-config.js';
import { resolveSessionWorkspaceDir } from './spawned-context.js';
import type { SubagentRunRecord } from './subagent-registry.types.js';
import type { TaskLoopRunRecord } from './task-loop-controller.js';
import type { TaskLoopSelfCheckResult } from './task-loop-self-check.js';
import { taskLedgerDigest } from '../../../shared/task-ledger-journal.js';
import { readTaskExecutionCandidate } from '../../../shared/task-ledger-candidate.js';
import { normalizeAutonomySessionScope, type AutonomySessionScope } from '../../../shared/types/identity-scope.js';
import { normalizeScopedTaskReference } from '../../../shared/types/task-ledger-reference.js';
import { normalizeTaskCompletionCheckPlans, taskCompletionCandidateMatches } from '../../../shared/task-ledger-completion.js';
import type { TaskLedgerCompletionCheckpoint } from '../../../shared/types/task-ledger.js';
import type { OrchestrationRunResult } from './orchestrator-run-observed.js';
import { getRuntimeConfigSnapshot } from '../config/runtime-snapshot.js';
import { resolveStructuredVerificationVerdict } from './orchestration-verifier-report.js';
import { trackTaskLoopCompletionWorkspace } from './task-loop-completion-fence.js';

export function taskLoopReviewerPassed(run: SubagentRunRecord): boolean {
  return resolveStructuredVerificationVerdict({ orchestrationVerdict: run.orchestration?.verificationVerdict, outcomeStatus: run.outcome?.status,
    resultText: run.completion?.resultText ?? run.completion?.fallbackResultText ?? undefined }).verdict === 'pass';
}

export type TaskLoopCompletionContext = {
  scope: AutonomySessionScope;
  workspaceRoot: string;
  executionWorkdir: string;
  acceptance: string[];
  verificationChecks: TaskLedgerCompletionCheckpoint['verificationChecks'];
};

/** Only completion-enabled loops await the existing child owners before reading their evidence. */
export async function awaitTaskLoopCompletionChildren(result: OrchestrationRunResult, input: {
  sessionKey: string; sessionGeneration: string; orchestrationRunId: string; cancelled: () => boolean;
}): Promise<OrchestrationRunResult> {
  const { getSubagentRunByRunId } = await import('./subagent-registry-runtime.js');
  const { makeTaskLedgerEntry } = await import('./orchestration-protocol.js');
  // Each child lifecycle owner enforces its own deadline. A shared wait timer
  // would cut short a verifier that starts only after its workers finish.
  while (!input.cancelled()) {
    const workers = result.expectedWorkerRunIds.map(id => getSubagentRunByRunId(id));
    if (!workers.length || workers.some(run => !run || run.requesterSessionKey !== input.sessionKey || run.requesterSessionId !== input.sessionGeneration)) return result;
    if (workers.some(run => run!.endedAt && run!.outcome?.status !== 'ok')) return result;
    if (workers.some(run => run!.endedAt && run!.completion?.capturedAt && !run!.completion?.resultText?.trim())) return result;
    if (workers.some(run => !run!.endedAt || !run!.completion?.resultText?.trim())) {
      await new Promise(resolve => setTimeout(resolve, 200));
      continue;
    }
    if (!result.pendingVerifier || workers.some(run => run!.outcome?.status !== 'ok' || run!.orchestration?.verifierSkippedReason)) return result;
    const verifierIds = [...new Set(workers.map(run => run!.orchestration?.verifierStartedRunId).filter((id): id is string => Boolean(id && !id.startsWith('__'))))];
    if (verifierIds.length > 1) return result;
    const verifier = verifierIds.length === 1 ? getSubagentRunByRunId(verifierIds[0]) : null;
    if (verifier && (verifier.requesterSessionKey !== input.sessionKey || verifier.requesterSessionId !== input.sessionGeneration
      || verifier.orchestration?.orchestrationRunId !== input.orchestrationRunId || !verifier.orchestration.isVerifier)) return result;
    if (!verifier || !verifier.endedAt || (verifier.outcome?.status === 'ok' && !verifier.completion?.capturedAt && !verifier.completion?.resultText?.trim())) {
      await new Promise(resolve => setTimeout(resolve, 200));
      continue;
    }
    const orchestration = verifier.orchestration;
    if (!orchestration) return result;
    return { ...result, pendingVerifier: false, outcomes: [...result.outcomes, {
      roleName: orchestration.roleName, task: verifier.task, isVerifier: true,
      ledger: orchestration.ledger ?? makeTaskLedgerEntry({ orchestrationRunId: input.orchestrationRunId,
        roleName: orchestration.roleName, task: verifier.task, index: workers.length, phase: 'verifier', requiredCapabilities: [] }),
      spawn: { status: 'accepted', result: { status: 'accepted', runId: verifier.runId, childSessionKey: verifier.childSessionKey } },
    }] };
  }
  return result;
}

/** Pin the physical session before workers run; never adopt a replacement at completion. */
export async function readTaskLoopCompletionContext(input: {
  workspaceId?: string | null; sessionKey: string; agentId?: string; acceptance?: string[]; verificationChecks?: unknown;
}, cfg: OpenClawConfig): Promise<TaskLoopCompletionContext | null> {
  if (!input.workspaceId?.trim()) return null;
  const { resolveGatewaySessionStoreTargetWithStore, resolveFreshestSessionStoreMatchFromStoreKeys } = await import('../gateway/session-utils.js');
  const target = resolveGatewaySessionStoreTargetWithStore({ cfg, key: input.sessionKey, agentId: input.agentId });
  const entry = resolveFreshestSessionStoreMatchFromStoreKeys(target.store, target.storeKeys)?.entry;
  if (!entry?.sessionId || target.canonicalKey !== input.sessionKey) return null;
  trackTaskLoopCompletionWorkspace(input.workspaceId);
  const scope = { workspaceId: input.workspaceId, projectId: input.workspaceId, sessionKey: target.canonicalKey, sessionGeneration: entry.sessionId } as AutonomySessionScope;
  const acceptance = [...new Set((input.acceptance ?? []).map(item => item.trim()).filter(Boolean))];
  const workspaceRoot = resolve(resolveSessionWorkspaceDir({ spawnedWorkspaceDir: entry.spawnedWorkspaceDir,
    persistedWorkspaceDir: entry.workspaceDir }) || resolveAgentWorkspaceDir(cfg, target.agentId));
  return { scope: normalizeAutonomySessionScope(scope, scope),
    workspaceRoot, executionWorkdir: resolve(workspaceRoot, entry.spawnedCwd?.trim() || '.'),
    acceptance, verificationChecks: normalizeTaskCompletionCheckPlans(input.verificationChecks, acceptance) };
}

/** Records provenance only. TaskLoop keeps its gate; Ledger still has to admit real check receipts. */
export async function captureTaskLoopCompletionCheckpoint(input: {
  record: TaskLoopRunRecord; checkpointId: string; cfg: OpenClawConfig; selfCheck?: TaskLoopSelfCheckResult;
  subagents: readonly SubagentRunRecord[]; now: number;
}): Promise<TaskLedgerCompletionCheckpoint | null> {
  const { record, subagents, now } = input;
  const context = record.completionContext;
  if (!context || !record.taskLedgerRootId || !context.acceptance.length) return null;
  const current = await readTaskLoopCompletionContext({ workspaceId: record.workspaceId, sessionKey: record.sessionKey }, input.cfg);
  if (!current || current.workspaceRoot !== context.workspaceRoot || current.executionWorkdir !== context.executionWorkdir) return null;
  normalizeAutonomySessionScope(context.scope, current.scope);
  const owned = subagents.filter(run => run.requesterSessionKey === record.sessionKey
    && run.requesterSessionId === context.scope.sessionGeneration && run.endedAt && run.outcome?.status === 'ok'
    && run.orchestration?.orchestrationRunId === record.orchestrationRunIds.at(-1));
  const workerRunIds = [...new Set(owned.filter(run => run.orchestration?.phase === 'worker' && !run.orchestration.isVerifier).map(run => run.runId))].sort();
  const verifiers = owned.filter(run => run.orchestration?.phase === 'verifier' && run.orchestration.isVerifier
    && taskLoopReviewerPassed(run)
    && !workerRunIds.includes(run.runId) && workerRunIds.length > 0
    && run.orchestration.expectedWorkerRunIds?.length === workerRunIds.length
    && workerRunIds.every(id => run.orchestration?.expectedWorkerRunIds?.includes(id)));
  // Ambiguous/missing verifier identity is unavailable evidence, never an inferred pass.
  if (verifiers.length !== 1) return null;
  const verifier = verifiers[0];
  const reviewSource = verifier.orchestration?.completionReview;
  if (reviewSource?.state !== 'pinned' || !verifier.workspaceDir
    || resolve(reviewSource.workspaceRoot) !== resolve(verifier.workspaceDir)
    || !Number.isFinite(reviewSource.capturedAt) || reviewSource.capturedAt > now) return null;
  const reviewerContext = await readTaskLoopCompletionContext({ workspaceId: record.workspaceId, sessionKey: verifier.childSessionKey }, input.cfg);
  if (!reviewerContext || reviewerContext.workspaceRoot !== resolve(reviewSource.workspaceRoot)
    || reviewerContext.executionWorkdir !== resolve(reviewSource.executionWorkdir ?? reviewSource.workspaceRoot)) return null;
  const candidate = readTaskExecutionCandidate(context.workspaceRoot, context.executionWorkdir, taskLedgerDigest(input.cfg));
  if (!taskCompletionCandidateMatches(reviewSource.candidate, candidate)) return null;
  const agentId = parseAgentSessionKey(verifier.childSessionKey)?.agentId;
  if (!agentId) return null;
  const proof: Omit<TaskLedgerCompletionCheckpoint, 'ownerRevision'> = {
    owner: 'task-loop', checkpointId: input.checkpointId, loopRunId: record.loopRunId,
    taskRef: normalizeScopedTaskReference({ owner: 'task-ledger', taskNodeId: record.taskLedgerRootId, scope: context.scope }, context.scope) as TaskLedgerCompletionCheckpoint['taskRef'],
    status: record.status, evidenceGate: record.evidenceGate?.status ?? 'unavailable',
    selfCheckDecision: input.selfCheck?.decision === 'complete' ? 'complete'
      : input.selfCheck?.decision === 'repair' ? 'repair' : input.selfCheck?.decision === 'blocked' ? 'blocked' : 'unavailable',
    candidate, reviewSource,
    acceptanceSha256: taskLedgerDigest(context.acceptance),
    taskInputSha256: taskLedgerDigest({ title: record.task, description: '' }),
    requiredCheckIds: context.acceptance.map(item => 'acceptance:' + taskLedgerDigest(item)), workerRunIds,
    verificationChecks: context.verificationChecks, executionWorkdir: context.executionWorkdir,
    verifierRunId: verifier.runId, reviewer: { agentId, runId: verifier.runId, sessionKey: verifier.childSessionKey },
    capturedAt: now, expiresAt: now + 60 * 60_000,
  };
  return { ...proof, ownerRevision: taskLedgerDigest(proof) };
}

/** Read the existing SQLite owner record; no in-memory run or claimant facts are required. */
export async function readTaskLoopCompletionEvidence(input: {
  workspaceId: string; sessionKey: string; checkpointId: string;
}, cfg: OpenClawConfig) {
  const currentCfg = getRuntimeConfigSnapshot() ?? cfg;
  const current = await readTaskLoopCompletionContext(input, currentCfg);
  if (!current) throw new Error('Task completion session owner is unavailable');
  const { getLongTaskCheckpointById } = await import('./long-task-control/store.js');
  const row = getLongTaskCheckpointById(input.checkpointId);
  let checkpoint: TaskLedgerCompletionCheckpoint | null = null;
  if (row?.workspaceId === input.workspaceId && row.sessionKey === input.sessionKey) {
    const value = row.checkpoint.metadata?.taskCompletion as TaskLedgerCompletionCheckpoint | undefined;
    if (value) {
      const { ownerRevision, ...facts } = value;
      normalizeAutonomySessionScope(value.taskRef.scope, current.scope);
      if (value.owner === 'task-loop' && ownerRevision === taskLedgerDigest(facts)
        && value.reviewSource?.state === 'pinned' && taskCompletionCandidateMatches(value.reviewSource.candidate, value.candidate)
        && resolve(value.executionWorkdir ?? value.reviewSource.workspaceRoot) === current.executionWorkdir
        && value.checkpointId === row.id && value.loopRunId === row.runId && value.taskRef.taskNodeId === row.taskLedgerRootId
        && value.status === row.status && value.status === row.checkpoint.metadata?.status
        && value.evidenceGate === (row.checkpoint.metadata?.evidenceGate as { status?: string } | undefined)?.status
        && value.selfCheckDecision === row.checkpoint.metadata?.selfCheckDecision) checkpoint = value;
    }
  }
  return { scope: current.scope, workspaceRoot: current.workspaceRoot, executionWorkdir: current.executionWorkdir,
    configSha256: taskLedgerDigest(currentCfg), checkpoint };
}
