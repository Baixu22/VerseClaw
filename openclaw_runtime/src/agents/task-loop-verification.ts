// Consumes TaskLoop's existing checkpoint and exec/effect/archive owners. No task
// verdict or new state store: the Ledger still admits the completion claim.
import { randomUUID, createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { taskLedgerDigest } from '../../../shared/task-ledger-journal.js';
import { readTaskExecutionCandidate } from '../../../shared/task-ledger-candidate.js';
import { taskCompletionCandidateMatches } from '../../../shared/task-ledger-completion.js';
import type { TaskLedgerCompletionCheckReceipt, TaskLedgerCompletionCheckpoint } from '../../../shared/types/task-ledger.js';
import type { OpenClawConfig } from '../config/types.openclaw.js';
import type { ArchiveHandle } from '../../../shared/types/context-item.js';
import {
  createContextArchiveHandleForPayloadSync, createContextItemId, verifyContextArchiveHandle, resolveContextArchiveFilePath,
} from '../context-engine/registry/context-item-registry.js';
import { recordLongTaskCheckpoint, getLongTaskCheckpointById } from './long-task-control/store.js';
import { EffectReceiptStore, effectProposalDigest } from './effect-receipt.js';
import { readTaskLoopCompletionEvidence, taskLoopReviewerPassed } from './task-loop-completion.js';
import type { ExecToolDefaults } from './bash-tools.exec-types.js';
import { parseAgentSessionKey } from '../routing/session-key.js';
import { getRuntimeConfigSnapshot } from '../config/runtime-snapshot.js';
import type { SandboxContext } from './sandbox/types.js';
import { SANDBOX_AGENT_WORKSPACE_MOUNT } from './sandbox/constants.js';
import { resolveExecDefaults } from './exec-defaults.js';
import { INTERNAL_MESSAGE_CHANNEL } from '../utils/message-channel-constants.js';
import { loadSessionStore } from '../config/sessions/store.js';
import { resolveSessionWorkspaceDir } from './spawned-context.js';
import { resolveAgentWorkspaceDir } from './agent-scope-config.js';
import { resolve } from 'node:path';
import { deliveryContextFromSession } from '../utils/delivery-context.shared.js';
import { sessionAdmissionRegistry } from '../sessions/session-admission-registry.js';

const SHA = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const CHECK_OWNER = 'task-loop-exec-effect' as const;
const checkRecordId = (runId: string) => 'task-loop-check:' + taskLedgerDigest(runId);
const canonicalCheckPath = (path: string) => {
  const real = realpathSync(path);
  return process.platform === 'win32' ? real.toLowerCase() : real;
};

/** Keep the existing mount/policy; a bootstrap copy is not the checked source.
 * Docker's ro project mount is /agent, while its default /workspace is a copy.
 */
export function taskLoopVerificationSandbox(sandbox: SandboxContext | null, root: string): SandboxContext | null {
  if (!sandbox?.enabled) return sandbox;
  const canonical = (path: string) => {
    const real = realpathSync(path);
    return process.platform === 'win32' ? real.toLowerCase() : real;
  };
  if (sandbox.backendId !== 'docker' || sandbox.workspaceAccess === 'none'
    || canonical(sandbox.agentWorkspaceDir) !== canonical(root)) {
    throw new Error('Sandbox does not expose the exact local candidate through a governed project mount');
  }
  if (sandbox.workspaceAccess === 'rw') {
    if (canonical(sandbox.workspaceDir) !== canonical(root)) throw new Error('Sandbox workspace is a different candidate');
    return sandbox;
  }
  // No new mount or permission is introduced; this is the existing readonly
  // project mount. Shell tools use this mapping instead of the bootstrap copy.
  // This selects the command's default cwd, not a new filesystem boundary:
  // absolute paths/dependencies retain existing exec policy and reviewer
  // coverage responsibilities, just as native verification commands do.
  return { ...sandbox, workspaceDir: sandbox.agentWorkspaceDir, containerWorkdir: SANDBOX_AGENT_WORKSPACE_MOUNT };
}
type CheckRun = {
  schema: 'TaskLoopCheckExecution/v1';
  runId: string;
  token: string;
  checkpointId: string;
  checkpointRevision: string;
  checkId: string;
  commandSha256: string;
  executionWorkdir: string;
  candidate: TaskLedgerCompletionCheckpoint['candidate'];
  taskRef: TaskLedgerCompletionCheckpoint['taskRef'];
  reviewer: TaskLedgerCompletionCheckpoint['reviewer'];
  capturedAt: number;
  expiresAt: number;
  state: 'reserved' | 'completed' | 'unavailable';
  effectReceiptId?: string;
  archive?: ArchiveHandle;
  outcome?: 'completed' | 'failed';
  exitCode?: number | null;
};
const proposalFor = (run: CheckRun) => ({ owner: CHECK_OWNER, runId: run.runId, checkpointId: run.checkpointId,
  checkpointRevision: run.checkpointRevision, checkId: run.checkId, commandSha256: run.commandSha256, executionWorkdir: run.executionWorkdir,
  candidate: run.candidate, taskRef: run.taskRef, reviewer: run.reviewer });

/** Recompute from existing SQLite + artifact bytes. This never executes a check. */
export async function readTaskLoopVerificationReceipt(runId: string, checkpoint: TaskLedgerCompletionCheckpoint): Promise<TaskLedgerCompletionCheckReceipt | null> {
  try {
    const row = getLongTaskCheckpointById(checkRecordId(runId));
    const run = row?.checkpoint.metadata?.taskVerification as CheckRun | undefined;
    const revision = row?.checkpoint.metadata?.taskVerificationRevision;
    if (!run || run.schema !== 'TaskLoopCheckExecution/v1' || run.state !== 'completed' || revision !== taskLedgerDigest(run)
      || run.runId !== runId || run.checkpointId !== checkpoint.checkpointId || run.checkpointRevision !== checkpoint.ownerRevision
      || row?.sessionKey !== checkpoint.taskRef.scope.sessionKey || row.workspaceId !== checkpoint.taskRef.scope.workspaceId
      || row.taskLedgerRootId !== checkpoint.taskRef.taskNodeId || !run.effectReceiptId || !run.archive
      || taskLedgerDigest(run.taskRef) !== taskLedgerDigest(checkpoint.taskRef) || taskLedgerDigest(run.reviewer) !== taskLedgerDigest(checkpoint.reviewer)
      || !taskCompletionCandidateMatches(run.candidate, checkpoint.candidate)) return null;
    const plan = checkpoint.verificationChecks.find(item => item.checkId === run.checkId);
    if (!plan || run.commandSha256 !== SHA(plan.command) || !run.executionWorkdir
      || run.executionWorkdir !== canonicalCheckPath(checkpoint.executionWorkdir ?? checkpoint.reviewSource!.workspaceRoot)) return null;
    const effect = new EffectReceiptStore().getById(run.effectReceiptId);
    const archive = await verifyContextArchiveHandle(run.archive);
    if (!archive.ok || !effect || effect.domain_executor !== 'exec' || effect.outcome !== 'applied'
      || effect.proposal_digest !== effectProposalDigest(proposalFor(run)) || effect.artifact_ref !== run.archive.uri
      || effect.journal_ref !== row.id || effect.approval_decision !== 'approved') return null;
    const output = archive.payload as { schema?: string; exitCode?: number | null; outcome?: string; commandSha256?: string; executionWorkdir?: string; runId?: string; rawOutput?: ArchiveHandle };
    if (output.schema !== 'TaskLoopCheckOutput/v1' || output.runId !== runId || output.commandSha256 !== run.commandSha256
      || output.executionWorkdir !== run.executionWorkdir || output.exitCode !== run.exitCode || output.outcome !== run.outcome) return null;
    const file = resolveContextArchiveFilePath(run.archive);
    if (!file) return null;
    const artifactRefs: TaskLedgerCompletionCheckReceipt['artifactRefs'] = [
      { owner: 'context-archive', ref: run.archive.uri, path: pathToFileURL(file).href, sha256: archive.fileSha256, verified: true },
    ];
    if (output.rawOutput) {
      const raw = await verifyContextArchiveHandle(output.rawOutput);
      const rawFile = resolveContextArchiveFilePath(output.rawOutput);
      if (!raw.ok || !rawFile) return null;
      artifactRefs.push({ owner: 'context-archive', ref: output.rawOutput.uri,
        path: pathToFileURL(rawFile).href, sha256: raw.fileSha256, verified: true });
    }
    return { owner: CHECK_OWNER, receiptId: run.effectReceiptId, ownerRevision: taskLedgerDigest({ run, effect }),
      verificationRunId: runId, checkpointId: run.checkpointId, checkpointRevision: run.checkpointRevision,
      taskRef: run.taskRef, candidate: run.candidate, acceptanceSha256: checkpoint.acceptanceSha256, checkId: run.checkId,
      reviewer: run.reviewer, status: run.outcome === 'completed' && run.exitCode === 0 ? 'verified' : 'failed', exitCode: run.exitCode ?? null,
      artifactRefs,
      capturedAt: run.capturedAt, expiresAt: run.expiresAt };
  } catch { return null; }
}

/** Run only a frozen program, through exec's real policy and resource owners. */
export async function runTaskLoopVerificationCheck(input: {
  workspaceId: string; sessionKey: string; checkpointId: string; checkId: string; verificationRunId: string;
}, cfg: OpenClawConfig, signal?: AbortSignal) {
  cfg = getRuntimeConfigSnapshot() ?? cfg;
  if (!input.verificationRunId.trim() || input.verificationRunId.length > 200) throw new Error('A persistent verification run ID is required');
  const facts = await readTaskLoopCompletionEvidence(input, cfg);
  const checkpoint = facts.checkpoint;
  if (!checkpoint || checkpoint.status !== 'complete' || checkpoint.evidenceGate !== 'pass' || checkpoint.selfCheckDecision !== 'complete'
    || checkpoint.expiresAt <= Date.now()) throw new Error('TaskLoop completion checkpoint is unavailable or not ready for independent verification');
  const plan = checkpoint.verificationChecks.find(item => item.checkId === input.checkId);
  if (!plan || checkpoint.verificationChecks.length !== checkpoint.requiredCheckIds.length) throw new Error('The full verification program was not frozen at task intake');
  const current = readTaskExecutionCandidate(facts.workspaceRoot, facts.executionWorkdir, facts.configSha256);
  if (!taskCompletionCandidateMatches(checkpoint.candidate, current)) throw new Error('Candidate changed before verification');
  const { getSubagentRunByRunId } = await import('./subagent-registry-runtime.js');
  const reviewer = getSubagentRunByRunId(checkpoint.reviewer.runId);
  if (!reviewer || !reviewer.orchestration?.isVerifier || reviewer.orchestration.phase !== 'verifier'
    || reviewer.requesterSessionKey !== input.sessionKey || reviewer.requesterSessionId !== checkpoint.taskRef.scope.sessionGeneration
    || reviewer.childSessionKey !== checkpoint.reviewer.sessionKey || reviewer.outcome?.status !== 'ok' || !reviewer.endedAt
    || !taskLoopReviewerPassed(reviewer)) throw new Error('Independent reviewer owner is unavailable');
  const token = randomUUID(), recordId = checkRecordId(input.verificationRunId);
  const run: CheckRun = { schema: 'TaskLoopCheckExecution/v1', token, runId: input.verificationRunId,
    checkpointId: checkpoint.checkpointId, checkpointRevision: checkpoint.ownerRevision, checkId: input.checkId,
    commandSha256: SHA(plan.command), executionWorkdir: canonicalCheckPath(facts.executionWorkdir),
    candidate: checkpoint.candidate, taskRef: checkpoint.taskRef, reviewer: checkpoint.reviewer,
    capturedAt: Date.now(), expiresAt: checkpoint.expiresAt, state: 'reserved' };
  const write = (insertOnly: boolean) => recordLongTaskCheckpoint({
    id: recordId, idempotencyKey: recordId, insertOnly, workspaceId: input.workspaceId, sessionKey: input.sessionKey,
    taskLedgerRootId: checkpoint.taskRef.taskNodeId, runId: input.verificationRunId, trigger: 'guide', status: run.state,
    metadata: { taskVerification: run, taskVerificationRevision: taskLedgerDigest(run) },
  });
  const reservation = write(true).checkpoint.metadata?.taskVerification as CheckRun | undefined;
  if (reservation?.token !== token) {
    if (reservation?.checkpointRevision !== checkpoint.ownerRevision || reservation.checkId !== plan.checkId || reservation.commandSha256 !== run.commandSha256) throw new Error('Verification run ID was used for another intent');
    return { receipt: await readTaskLoopVerificationReceipt(input.verificationRunId, checkpoint), replayed: true,
      state: reservation.state, reason: reservation.state === 'reserved' ? 'Existing execution has no terminal receipt; use a new run ID after owner reconciliation' : undefined };
  }
  try {
    const { createOpenClawCodingTools } = await import('./agent-tools.js');
    const { resolveSandboxContext } = await import('./sandbox.js');
    // Reviewer attestation and host execution are separate facts. The controller
    // runs the fixed program with its own current policy, never copied child rights.
    const executorAgentId = parseAgentSessionKey(input.sessionKey)?.agentId;
    if (!executorAgentId) throw new Error('TaskLoop executor agent owner is unavailable');
    const sandbox = taskLoopVerificationSandbox(await resolveSandboxContext({ config: cfg, sessionKey: input.sessionKey, workspaceDir: facts.workspaceRoot }), facts.workspaceRoot);
    const { resolveGatewaySessionStoreTargetWithStore, resolveFreshestSessionStoreMatchFromStoreKeys, resolveSessionModelRef } = await import('../gateway/session-utils.js');
    const target = resolveGatewaySessionStoreTargetWithStore({ cfg, key: input.sessionKey, agentId: executorAgentId });
    const sessionEntry = resolveFreshestSessionStoreMatchFromStoreKeys(target.store, target.storeKeys)?.entry;
    if (sessionEntry?.sessionId !== checkpoint.taskRef.scope.sessionGeneration) throw new Error('Verification session owner changed');
    const execPolicy = resolveExecDefaults({ cfg, sessionEntry, agentId: executorAgentId,
      sessionKey: input.sessionKey, sandboxAvailable: sandbox?.enabled === true });
    if (execPolicy.effectiveHost === 'node') throw new Error('Remote verification has no bound candidate and process outcome owner');
    const model = resolveSessionModelRef(cfg, sessionEntry, executorAgentId);
    const accountId = deliveryContextFromSession(sessionEntry)?.accountId ?? sessionEntry.origin?.accountId;
    const policyChannel = deliveryContextFromSession(sessionEntry)?.channel ?? sessionEntry.origin?.provider ?? INTERNAL_MESSAGE_CHANNEL;
    const sessionPolicy = (entry: typeof sessionEntry) => taskLedgerDigest({
      exec: resolveExecDefaults({ cfg, sessionEntry: entry, agentId: executorAgentId, sessionKey: input.sessionKey, sandboxAvailable: sandbox?.enabled === true }),
      model: resolveSessionModelRef(cfg, entry, executorAgentId),
      accountId: deliveryContextFromSession(entry)?.accountId ?? entry?.origin?.accountId,
      policyChannel: deliveryContextFromSession(entry)?.channel ?? entry?.origin?.provider ?? INTERNAL_MESSAGE_CHANNEL,
      inheritedToolAllow: entry?.inheritedToolAllow, inheritedToolDeny: entry?.inheritedToolDeny,
      subagentRole: entry?.subagentRole, subagentControlScope: entry?.subagentControlScope,
      origin: entry?.origin, route: entry?.route,
      groupId: entry?.groupId, groupChannel: entry?.groupChannel, groupSpace: entry?.space,
    });
    const policyRevision = sessionPolicy(sessionEntry);
    let observation: Parameters<NonNullable<ExecToolDefaults['onProcessCompleted']>>[0] | undefined;
    const execution = createOpenClawCodingTools({ config: cfg, sandbox, agentId: executorAgentId, workspaceDir: facts.workspaceRoot,
      modelProvider: model.provider, modelId: model.model,
      agentAccountId: accountId,
      groupId: sessionEntry.groupId, groupChannel: sessionEntry.groupChannel, groupSpace: sessionEntry.space,
      senderId: sessionEntry.origin?.senderId ?? sessionEntry.origin?.nativeDirectUserId,
      senderName: sessionEntry.origin?.senderName, senderUsername: sessionEntry.origin?.senderUsername,
      senderE164: sessionEntry.origin?.senderE164,
      // Existing approval owner waits inline and resumes through the same
      // foreground observer; no detached execution loses its task receipt.
      messageProvider: policyChannel,
      sessionKey: input.sessionKey, sessionId: checkpoint.taskRef.scope.sessionGeneration, runId: input.verificationRunId,
      exec: { host: execPolicy.host, mode: execPolicy.mode, security: execPolicy.security, ask: execPolicy.ask, node: execPolicy.node,
        messageProvider: INTERNAL_MESSAGE_CHANNEL,
        onProcessStarting: ({ command, workdir, host }) => {
          signal?.throwIfAborted();
          if (host === 'node') throw new Error('Remote verification has no bound candidate and process outcome owner');
          if (command !== plan.command || !workdir || canonicalCheckPath(workdir) !== run.executionWorkdir) {
            throw new Error('Tool hooks changed the frozen verification command or working directory');
          }
          const currentStore = loadSessionStore(target.storePath, { skipCache: true, runMaintenance: false });
          const currentSession = resolveFreshestSessionStoreMatchFromStoreKeys(currentStore, target.storeKeys)?.entry;
          const config = getRuntimeConfigSnapshot() ?? cfg;
          const workspaceRoot = resolve(resolveSessionWorkspaceDir({ spawnedWorkspaceDir: currentSession?.spawnedWorkspaceDir,
            persistedWorkspaceDir: currentSession?.workspaceDir }) || resolveAgentWorkspaceDir(config, executorAgentId));
          const executionWorkdir = resolve(workspaceRoot, currentSession?.spawnedCwd?.trim() || '.');
          if (currentSession?.sessionId !== checkpoint.taskRef.scope.sessionGeneration
            || sessionAdmissionRegistry.isFenced({ agentId: executorAgentId, canonicalSessionKey: input.sessionKey, expectedSessionId: checkpoint.taskRef.scope.sessionGeneration })
            || sessionPolicy(currentSession) !== policyRevision || taskLedgerDigest(config) !== facts.configSha256) {
            throw new Error('Verification session execution policy or generation changed before execution');
          }
          const currentCheckpoint = getLongTaskCheckpointById(checkpoint.checkpointId)?.checkpoint.metadata?.taskCompletion as TaskLedgerCompletionCheckpoint | undefined;
          if (currentCheckpoint?.ownerRevision !== checkpoint.ownerRevision
            || canonicalCheckPath(executionWorkdir) !== run.executionWorkdir
            || !taskCompletionCandidateMatches(checkpoint.candidate, readTaskExecutionCandidate(workspaceRoot, executionWorkdir, facts.configSha256))) {
            throw new Error('Verification session, checkpoint or candidate changed before execution');
          }
          signal?.throwIfAborted();
        },
        allowBackground: false, notifyOnExit: false, onProcessCompleted: result => { observation = result; } },
      toolConstructionPlan: { includeBaseCodingTools: false, includeShellTools: true, includeOpenClawTools: false, includeChannelTools: false, includePluginTools: false },
    }).find(tool => tool.name === 'exec');
    if (!execution) throw new Error('Existing controller tool policy does not admit exec');
    await execution.execute(input.verificationRunId, { command: plan.command, workdir: facts.executionWorkdir, background: false, wait: 'session' }, signal);
    if (!observation) throw new Error('Exec policy did not produce an actual terminal process outcome');
    const { session, outcome, permissionEffect } = observation;
    if (session.command !== plan.command || !session.cwd || canonicalCheckPath(session.cwd) !== run.executionWorkdir) {
      throw new Error('Observed process does not match the frozen verification command and working directory');
    }
    if (session.lifecycleOwner !== 'native' && session.lifecycleOwner !== 'verseshell' && session.lifecycleOwner !== 'sandbox') throw new Error('Verification requires an owned process and retained output');
    if (session.lifecycleOwner === 'sandbox' && !sandbox?.enabled) throw new Error('Sandbox process has no current mount owner');
    if (!session.pid || !session.exited || session.rawOutputCapture?.truncated || session.rawOutputCapture?.diagnostics.length
      || session.truncated && !outcome.archiveHandle) throw new Error('Verification process or full output capture is incomplete');
    const after = await readTaskLoopCompletionEvidence(input, cfg);
    if (after.checkpoint?.ownerRevision !== checkpoint.ownerRevision || !taskCompletionCandidateMatches(checkpoint.candidate, readTaskExecutionCandidate(facts.workspaceRoot, facts.executionWorkdir, after.configSha256))
      || realpathSync(after.workspaceRoot) !== realpathSync(facts.workspaceRoot)) throw new Error('Candidate or checkpoint changed during verification');
    const archive = createContextArchiveHandleForPayloadSync({
      sessionId: checkpoint.taskRef.scope.sessionGeneration, itemId: createContextItemId(checkpoint.taskRef.scope.sessionGeneration, 'observation', 'task-check-' + taskLedgerDigest(input.verificationRunId)),
      payload: { schema: 'TaskLoopCheckOutput/v1', runId: run.runId, commandSha256: SHA(session.command),
        executionWorkdir: canonicalCheckPath(session.cwd), pid: session.pid,
        lifecycleOwner: session.lifecycleOwner, ...(session.lifecycleOwner === 'sandbox' && sandbox ? { sandbox: {
          backendId: sandbox.backendId, runtimeId: sandbox.runtimeId, workspaceAccess: sandbox.workspaceAccess, containerWorkdir: sandbox.containerWorkdir,
        } } : {}), executor: { agentId: executorAgentId, sessionKey: input.sessionKey, sessionGeneration: checkpoint.taskRef.scope.sessionGeneration,
          modelProvider: model.provider, modelId: model.model },
        outcome: outcome.status, exitCode: outcome.exitCode, timedOut: outcome.timedOut,
        durationMs: outcome.durationMs, output: outcome.aggregated, ...(outcome.archiveHandle ? { rawOutput: outcome.archiveHandle } : {}) },
      source: { type: 'tool_call', sessionId: checkpoint.taskRef.scope.sessionGeneration, label: 'task-verification-exec' },
    });
    const effect = new EffectReceiptStore().record({ idempotencyKey: recordId, proposal: proposalFor(run), approvalId: permissionEffect.decisionRef,
      approvalDecision: 'approved', domainExecutor: 'exec', outcome: 'applied', artifactRef: archive.uri, journalRef: recordId, recoverability: 'read-existing-checkpoint-and-context-archive' });
    if (!effect.ok) throw new Error('Existing effect owner rejected the verification correlation');
    Object.assign(run, { state: 'completed', effectReceiptId: effect.effectReceiptId, archive, outcome: outcome.status, exitCode: outcome.exitCode });
    write(false);
    return { receipt: await readTaskLoopVerificationReceipt(input.verificationRunId, checkpoint), replayed: false, state: run.state };
  } catch (error) {
    run.state = 'unavailable'; write(false);
    return { receipt: null, replayed: false, state: run.state, reason: error instanceof Error ? error.message : String(error) };
  }
}
