import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  SessionTaskEffectAdmission,
  SessionTaskEffectRequest,
  SessionTaskRequesterReference,
  SessionTaskWriterClaim,
} from "../../../shared/session-task-scope.js";
import type { OpenClawConfig } from "../config/types.js";
import { requiresSessionTaskScope } from "./tool-mutation.js";

// These are in-flight tool effects, not cached activity or task completion facts.
const effectsByRun = new Map<string, number>();
const claimsByRun = new Map<string, SessionTaskWriterClaim>();
const closingRuns = new Set<string>();
type InFlightEffect = {
  request: Readonly<SessionTaskEffectRequest>;
  run: SessionTaskEffectAdmission['claim']['run'] | null;
};
const effectRequests = new Map<string, InFlightEffect>();
const terminalIdentities = new Map<string, { sessionKey: string; sessionGeneration: string }>();

export function getSessionTaskEffectRequest(
  requestId: string,
): Readonly<SessionTaskEffectRequest> | undefined {
  return effectRequests.get(requestId)?.request;
}
const requesterReferences = new AsyncLocalStorage<SessionTaskRequesterReference>();

export function currentSessionTaskRequesterReference(): SessionTaskRequesterReference | undefined {
  return requesterReferences.getStore();
}

export function withSessionTaskRequesterReference<T>(
  reference: SessionTaskRequesterReference | undefined,
  execute: () => T,
): T {
  return reference ? requesterReferences.run(reference, execute) : execute();
}

/** Called by the run owner on terminal cleanup, never by a cache TTL. */
export function clearSessionTaskScopeRun(runId: string, identity?: { sessionKey: string; sessionGeneration: string }): void {
  if (identity) terminalIdentities.set(runId, identity);
  if (sessionTaskEffectsInFlight(runId)) closingRuns.add(runId);
  else {
    claimsByRun.delete(runId);
    const terminalIdentity = terminalIdentities.get(runId); terminalIdentities.delete(runId);
    void import('./execution-checkout-tools.js').then(owner => owner.finishExecutionCheckoutRun(runId, terminalIdentity))
      .catch(error => console.warn('Checkout terminal reconciliation retained ownership', error));
  }
}

export function sessionTaskEffectsInFlight(runId: string): number {
  return effectsByRun.get(runId) ?? 0;
}

export function sessionTaskOperationsInFlight(runId: string): string[] {
  return [...effectRequests.values()].filter(({ request }) => request.runId === runId)
    .map(({ request }) => request.operationId).filter((id): id is string => Boolean(id));
}

/** Only the original Main admission can qualify an in-flight request's run scope. */
export function readSessionTaskEffectRequests(sessionKey: string, generation: string) {
  return [...effectRequests.values()].filter(({ request }) => request.sessionKey === sessionKey && request.sessionGeneration === generation)
    .map(({ request, run }) => ({ requestId: request.requestId, operationId: request.operationId, toolName: request.toolName,
      run: run ? structuredClone(run) : null }));
}

export async function withSessionTaskScope<T>(
  context:
    | {
        config?: OpenClawConfig;
        sessionKey?: string;
        sessionId?: string;
        runId?: string;
        workspaceDir?: string;
        taskScopeProjectWorkspaceDir?: string;
        cwd?: string;
      }
    | undefined,
  toolName: string,
  args: unknown,
  signal: AbortSignal | undefined,
  execute: (admission?: SessionTaskEffectAdmission) => Promise<T>,
  effect?: { operationId: string; checkoutAccess: 'write' | 'control' }
    & Pick<SessionTaskEffectRequest, 'expectedTaskNodeId' | 'expectedTaskEpoch'>,
): Promise<T> {
  if (process.env.CLAWX_TASK_SCOPE_BRIDGE !== "1" || !requiresSessionTaskScope(toolName, args))
    return execute();
  const sessionKey = context?.sessionKey;
  const sessionGeneration = context?.sessionId;
  const runId = context?.runId;
  const workspaceDir = context?.workspaceDir ?? context?.cwd;
  if (!sessionKey || !sessionGeneration || !runId || !workspaceDir)
    throw new Error("TASK_SCOPE_RUNTIME_OWNER_MISSING");
  signal?.throwIfAborted();
  effectsByRun.set(runId, sessionTaskEffectsInFlight(runId) + 1);
  const previousClaim = claimsByRun.get(runId);
  const admittedTask = previousClaim?.credential;
  const currentRunTask = previousClaim && admittedTask && previousClaim.run.scope.sessionKey === sessionKey
    && previousClaim.sessionGeneration === sessionGeneration
    && effect?.expectedTaskNodeId === admittedTask.taskNodeId
    && effect.expectedTaskEpoch !== undefined && effect.expectedTaskEpoch < admittedTask.epoch;
  const request: SessionTaskEffectRequest = {
    requestId: randomUUID(),
    sessionKey,
    sessionGeneration,
    runId,
    workspaceDir,
    toolName,
    ...(context?.taskScopeProjectWorkspaceDir
      ? { projectWorkspaceDir: context.taskScopeProjectWorkspaceDir }
      : {}),
    ...(previousClaim ? { expectedClaimId: previousClaim.id } : {}),
    ...(previousClaim?.executionRevision !== undefined ? { expectedExecutionRevision: previousClaim.executionRevision } : {}),
    ...(effect ?? {}),
    ...(currentRunTask ? { expectedTaskEpoch: admittedTask.epoch } : {}),
  };
  const effectRequest: InFlightEffect = { request: Object.freeze({ ...request }), run: null };
  effectRequests.set(request.requestId, effectRequest);
  try {
    const { callGateway } = await import("../gateway/call.js");
    const admission = await callGateway<SessionTaskEffectAdmission>({
      config: context?.config,
      method: "taskScope.admit",
      params: request,
      timeoutMs: 20_000,
      signal,
    });
    const claim = admission?.claim;
    if (
      admission?.status !== "granted" ||
      !claim?.id ||
      claim.run.runId !== runId ||
      claim.run.scope.sessionKey !== sessionKey ||
      claim.sessionGeneration !== sessionGeneration
    ) {
      throw new Error("TASK_SCOPE_ADMISSION_MISMATCH");
    }
    if (signal?.aborted) {
      if (admission.checkout?.unused) {
        const { createWorktreeService } = await import('./worktree-service.js');
        createWorktreeService(admission.checkout.baseRoot).releaseUnusedWriter(admission.checkout.credential);
      }
      signal.throwIfAborted();
    }
    claimsByRun.set(runId, { ...claim, executionRevision: claim.executionRevision ?? previousClaim?.executionRevision });
    effectRequest.run = structuredClone(claim.run);
    return await withSessionTaskRequesterReference(
      {
        taskRef: claim.taskNodeId,
        coordinator: {
          workspaceId: claim.run.scope.workspaceId,
          sessionKey,
          sessionGeneration,
          bindingRevision: admission.bindingRevision,
        },
      },
      () => execute(admission),
    );
  } finally {
    effectRequests.delete(request.requestId);
    const remaining = sessionTaskEffectsInFlight(runId) - 1;
    if (remaining > 0) effectsByRun.set(runId, remaining);
    else {
      effectsByRun.delete(runId);
      if (closingRuns.delete(runId)) clearSessionTaskScopeRun(runId);
    }
  }
}
