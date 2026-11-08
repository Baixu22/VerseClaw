import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  GATEWAY_CLIENT_CAPS,
  hasGatewayClientCap,
} from "../../../packages/gateway-protocol/src/client-info.js";
import {
  parseSessionTaskEffectRequest,
  type SessionTaskEffectRequest,
  type SessionTaskEffectAdmission,
} from "../../../../shared/session-task-scope.js";
import {
  getSessionTaskEffectRequest,
  sessionTaskEffectsInFlight,
} from "../../agents/session-task-scope.js";
import {
  isEmbeddedRunAbandoned,
  isEmbeddedAgentExecutionActive,
} from "../../agents/embedded-agent-runner/runs.js";
import { listRunningSessions } from "../../agents/bash-process-registry.js";
import { managedProcessReservations } from "../../agents/verseshell/managed-process-reservation.js";
import { getProcessSupervisor } from "../../process/supervisor/index.js";
import { getAgentRunContext } from "../../infra/agent-events.js";
import { replyRunRegistry } from "../../auto-reply/reply/reply-run-registry.js";
import { loadSessionEntry } from "../session-utils.js";
import type { GatewayClient, GatewayRequestContext, GatewayRequestHandlers } from "./types.js";

type Pending = {
  request: SessionTaskEffectRequest;
  connId: string;
  resolve: (admission: SessionTaskEffectAdmission) => void;
  reject: (error: Error) => void;
};
const pending = new Map<string, Pending>();

function isBridge(client: GatewayClient | null | undefined): boolean {
  return hasGatewayClientCap(client?.connect?.caps, GATEWAY_CLIENT_CAPS.SESSION_TASK_SCOPE_BRIDGE);
}

function internalRunIsLive(runId: string, sessionKey: string, generation: string): boolean {
  const registered = getAgentRunContext(runId);
  const owner = registered?.memoryFlushOwner;
  return (
    isEmbeddedAgentExecutionActive({ runId, sessionKey, sessionId: generation }) ||
    Boolean(
      owner &&
      owner === replyRunRegistry.get(sessionKey) &&
      owner.phase === "memory_flushing" &&
      !owner.abortSignal.aborted &&
      owner.sessionId === generation &&
      registered?.sessionKey === sessionKey &&
      registered.sessionId === generation,
    )
  );
}

function scheduledRunOwner(runId: string, sessionKey: string, generation: string) {
  const registered = getAgentRunContext(runId);
  return registered?.sessionKey === sessionKey &&
    registered.sessionId === generation &&
    isEmbeddedAgentExecutionActive({ runId, sessionKey, sessionId: generation })
    ? registered.cronTaskScope
    : undefined;
}

function assertLiveRun(context: GatewayRequestContext, request: SessionTaskEffectRequest): void {
  const active = context.chatAbortControllers.get(request.runId);
  const registered = getAgentRunContext(request.runId);
  const { entry, canonicalKey } = loadSessionEntry(request.sessionKey);
  const scheduled = scheduledRunOwner(request.runId, request.sessionKey, request.sessionGeneration);
  const effect = getSessionTaskEffectRequest(request.requestId);
  const issuedHere =
    effect &&
    (Object.keys(request) as Array<keyof SessionTaskEffectRequest>).every(
      (key) => effect[key] === request[key],
    ) &&
    effect.projectWorkspaceDir === request.projectWorkspaceDir &&
    effect.expectedClaimId === request.expectedClaimId;
  const activeMatches = active
    ? !active.controller.signal.aborted &&
      active.sessionKey === request.sessionKey &&
      (registered?.sessionId ?? active.sessionId) === request.sessionGeneration
    : internalRunIsLive(request.runId, request.sessionKey, request.sessionGeneration);
  if (
    !issuedHere ||
    !activeMatches ||
    (!scheduled &&
      (canonicalKey !== request.sessionKey || entry?.sessionId !== request.sessionGeneration)) ||
    sessionTaskEffectsInFlight(request.runId) < 1
  ) {
    throw new Error("TASK_SCOPE_RUN_STALE");
  }
}

export const sessionTaskScopeHandlers: GatewayRequestHandlers = {
  "taskScope.runState": async ({ params, client, context, respond }) => {
    if (!isBridge(client)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "TASK_SCOPE_BACKEND_REQUIRED"),
      );
      return;
    }
    const runId = typeof params.runId === "string" ? params.runId : "";
    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : "";
    const sessionGeneration =
      typeof params.sessionGeneration === "string" ? params.sessionGeneration : "";
    const processScope = params.processScope === undefined ? "run" : params.processScope;
    if (!runId || !sessionKey || !sessionGeneration
      || (processScope !== "run" && processScope !== "session")) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "TASK_SCOPE_REQUEST_INVALID"),
      );
      return;
    }
    const active = context.chatAbortControllers.get(runId);
    const registered = getAgentRunContext(runId);
    const { entry, canonicalKey } = loadSessionEntry(sessionKey);
    const scheduled = scheduledRunOwner(runId, sessionKey, sessionGeneration);
    const inFlightEffects = sessionTaskEffectsInFlight(runId);
    const abandoned = isEmbeddedRunAbandoned({ sessionId: sessionGeneration, sessionKey });
    const { getSubagentRunByRunId, getLatestSubagentRunByChildSessionKey } =
      await import("../../agents/subagent-registry.js");
    const worker =
      getSubagentRunByRunId(runId) ?? getLatestSubagentRunByChildSessionKey(sessionKey);
    const parent = worker?.requesterSessionKey
      ? loadSessionEntry(worker.requesterSessionKey)
      : null;
    const delegation =
      worker?.childSessionKey === sessionKey &&
      worker.requesterSessionId &&
      parent?.entry?.sessionId === worker.requesterSessionId &&
      entry?.spawnedBy === worker.requesterSessionKey
        ? {
            parentSessionKey: worker.requesterSessionKey,
            parentGeneration: worker.requesterSessionId,
            workspaceDir: worker.workspaceDir ?? null,
            taskReference: worker.requesterTaskReference ?? null,
          }
        : null;
    const runningProcesses = listRunningSessions().filter(
      (process) =>
        (process.lifecycleCanonicalSessionKey ?? process.sessionKey) === sessionKey &&
        (processScope === "session" || !process.lifecycleExpectedSessionId ||
          process.lifecycleExpectedSessionId === sessionGeneration),
    );
    const supervisedProcesses = getProcessSupervisor()
      .snapshotRunsForSession(sessionKey)
      .filter(
        (run) =>
          run.state !== "exited" &&
          (processScope === "session" || !run.lifecycleExpectedSessionId || run.lifecycleExpectedSessionId === sessionGeneration),
      );
    const durableProcessReservations = managedProcessReservations();
    const hasCompleteReservationIdentity = (reservation: typeof durableProcessReservations[number]) =>
      typeof reservation.sessionKey === "string" && Boolean(reservation.sessionKey.trim())
      && typeof reservation.sessionGeneration === "string" && Boolean(reservation.sessionGeneration.trim())
      && typeof reservation.runId === "string" && Boolean(reservation.runId.trim());
    const matchingProcessReservations = durableProcessReservations.filter((reservation) =>
      hasCompleteReservationIdentity(reservation)
      && reservation.sessionKey === sessionKey
      && (processScope === "session"
        ? true
        : reservation.sessionGeneration === sessionGeneration && reservation.runId === runId),
    );
    // Identity-less and partially migrated rows cannot be attributed from the owner string.
    // They conservatively hold every run until the process owner settles or reconciles them.
    const unknownIdentityProcessReservations = durableProcessReservations.filter(
      (reservation) => !hasCompleteReservationIdentity(reservation),
    );
    const inFlightProcesses = new Set([
      ...runningProcesses.map((process) => process.id),
      ...supervisedProcesses.map((run) => run.runId),
      ...matchingProcessReservations.map((reservation) => `managed:${reservation.id}`),
      ...unknownIdentityProcessReservations.map((reservation) => `managed:${reservation.id}`),
    ]).size;
    const internalActive = internalRunIsLive(runId, sessionKey, sessionGeneration);
    respond(true, {
      runId,
      sessionKey,
      sessionGeneration,
      processScope,
      currentGeneration: scheduled ? sessionGeneration : (entry?.sessionId ?? null),
      workspaceId: scheduled?.coordinator?.workspaceId ?? active?.workspaceId ?? null,
      scheduled,
      active: Boolean(
        (active
          ? !active.controller.signal.aborted &&
            active.sessionKey === sessionKey &&
            (registered?.sessionId ?? active.sessionId) === sessionGeneration
          : internalActive) &&
        (scheduled || (canonicalKey === sessionKey && entry?.sessionId === sessionGeneration)),
      ),
      quiescent:
        !active &&
        !internalActive &&
        inFlightEffects === 0 &&
        inFlightProcesses === 0 &&
        !abandoned,
      inFlightEffects,
      inFlightProcesses,
      managedProcessReservations: {
        matching: matchingProcessReservations.length,
        unknownIdentity: unknownIdentityProcessReservations.length,
      },
      delegation,
    });
  },
  "taskScope.admit": async ({ params, client, context, respond }) => {
    let request: SessionTaskEffectRequest;
    try {
      request = parseSessionTaskEffectRequest(params);
      assertLiveRun(context, request);
      if (pending.has(request.requestId)) throw new Error("TASK_SCOPE_DUPLICATE_REQUEST");
      const connections = Array.from(
        context.getApprovalClientConnIds?.({
          excludeConnId: client?.connId,
          filter: isBridge,
        }) ?? [],
      );
      if (connections.length !== 1) throw new Error("TASK_SCOPE_BRIDGE_UNAVAILABLE");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = new Promise<SessionTaskEffectAdmission>((resolve, reject) => {
          pending.set(request.requestId, { request, connId: connections[0], resolve, reject });
          timer = setTimeout(() => reject(new Error("TASK_SCOPE_BRIDGE_TIMEOUT")), 15_000);
        });
        context.broadcastToConnIds("taskScope.admit.request", request, new Set(connections), {
          dropIfSlow: false,
        });
        const admission = await result;
        assertLiveRun(context, request);
        respond(true, admission);
      } finally {
        if (timer) clearTimeout(timer);
        pending.delete(request.requestId);
      }
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },
  "taskScope.admit.result": ({ params, client, respond }) => {
    const entry = pending.get(typeof params.requestId === "string" ? params.requestId : "");
    if (
      !entry ||
      !isBridge(client) ||
      entry.connId !== client?.connId ||
      params.sessionKey !== entry.request.sessionKey ||
      params.sessionGeneration !== entry.request.sessionGeneration ||
      params.runId !== entry.request.runId
    ) {
      respond(true, { ignored: true });
      return;
    }
    if (params.error) entry.reject(new Error(String(params.error)));
    else {
      const admission = params.admission as SessionTaskEffectAdmission | undefined;
      const claim = admission?.claim;
      if (
        admission?.status !== "granted" ||
        !claim?.id ||
        !claim.run?.scope?.workspaceId ||
        claim.run.runId !== entry.request.runId ||
        claim.run.scope.sessionKey !== entry.request.sessionKey ||
        claim.sessionGeneration !== entry.request.sessionGeneration ||
        (entry.request.expectedClaimId && claim.id !== entry.request.expectedClaimId)
      ) {
        entry.reject(new Error("TASK_SCOPE_ADMISSION_MISMATCH"));
      } else entry.resolve(admission);
    }
    pending.delete(entry.request.requestId);
    respond(true, { ignored: false });
  },
};
