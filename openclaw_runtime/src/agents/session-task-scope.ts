import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  SessionTaskEffectAdmission,
  SessionTaskEffectRequest,
  SessionTaskRequesterReference,
} from "../../../shared/session-task-scope.js";
import type { OpenClawConfig } from "../config/types.js";
import { requiresSessionTaskScope } from "./tool-mutation.js";

// These are in-flight tool effects, not cached activity or task completion facts.
const effectsByRun = new Map<string, number>();
const claimsByRun = new Map<string, string>();
const closingRuns = new Set<string>();
const effectRequests = new Map<string, Readonly<SessionTaskEffectRequest>>();

export function getSessionTaskEffectRequest(
  requestId: string,
): Readonly<SessionTaskEffectRequest> | undefined {
  return effectRequests.get(requestId);
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
export function clearSessionTaskScopeRun(runId: string): void {
  if (sessionTaskEffectsInFlight(runId)) closingRuns.add(runId);
  else claimsByRun.delete(runId);
}

export function sessionTaskEffectsInFlight(runId: string): number {
  return effectsByRun.get(runId) ?? 0;
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
  execute: () => Promise<T>,
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
    ...(claimsByRun.has(runId) ? { expectedClaimId: claimsByRun.get(runId) } : {}),
  };
  effectRequests.set(request.requestId, Object.freeze({ ...request }));
  try {
    const { callGateway } = await import("../gateway/call.js");
    const admission = await callGateway<SessionTaskEffectAdmission>({
      config: context?.config,
      method: "taskScope.admit",
      params: request,
      timeoutMs: 20_000,
      signal,
    });
    signal?.throwIfAborted();
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
    claimsByRun.set(runId, claim.id);
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
      execute,
    );
  } finally {
    effectRequests.delete(request.requestId);
    const remaining = sessionTaskEffectsInFlight(runId) - 1;
    if (remaining > 0) effectsByRun.set(runId, remaining);
    else {
      effectsByRun.delete(runId);
      if (closingRuns.delete(runId)) claimsByRun.delete(runId);
    }
  }
}
