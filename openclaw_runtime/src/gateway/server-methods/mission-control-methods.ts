// Mission Control gateway methods.
//
// Mission Loop is the long-goal runtime primitive above task_loop. These methods
// stay inside the existing Gateway RPC boundary and broadcast lifecycle updates
// for Main/HostEvents to mirror into the desktop UI.
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  cancelMission,
  createMission,
  getLatestMission,
  getMissionRun,
  pauseMission,
  resumeMission,
  runMission,
  tickMission,
  type MissionControllerDeps,
} from "../../agents/mission-control/controller.js";
import type { MissionLifecycleEvent, MissionRunRequest, MissionTickInput } from "../../agents/mission-control/types.js";
import type { OrchestrationLifecycleEvent } from "../../agents/orchestrator-run-observed.js";
import { spawnSubagentDirect } from "../../agents/subagent-spawn.js";
import type { TaskLoopLifecycleEvent } from "../../agents/task-loop-controller.js";
import { formatControlPlaneActor, resolveControlPlaneActor } from "../control-plane-audit.js";
import type { GatewayRequestContext, GatewayRequestHandlers, RespondFn } from "./types.js";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const text = readString(entry);
    return text ? [text] : [];
  });
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const next = Math.floor(value);
  return next > 0 ? next : undefined;
}

function readMissionId(params: Record<string, unknown>): string | undefined {
  return readString(params.missionId ?? params.id);
}

function readTemplateId(params: Record<string, unknown>): string | undefined {
  return readString(params.templateId) ?? readString(params.teamTemplateId);
}

function respondMissingMissionId(respond: RespondFn, method: string): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `${method} requires a "missionId"`));
}

function parseMissionRunRequest(
  params: Record<string, unknown>,
  method: string,
  respond: RespondFn,
): MissionRunRequest | null {
  const missionId = readMissionId(params);
  const objective = readString(params.objective ?? params.task);
  const sessionKey = readString(params.sessionKey);
  if (!objective && (!missionId || method === "mission.create")) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `${method} requires an "objective"`));
    return null;
  }
  if (!sessionKey && (!missionId || method === "mission.create" || Boolean(objective))) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `${method} requires a "sessionKey"`));
    return null;
  }
  return {
    ...(missionId ? { missionId } : {}),
    objective: objective ?? "",
    sessionKey: sessionKey ?? "",
    agentId: readString(params.agentId),
    workspaceId: readString(params.workspaceId),
    acceptance: readStringArray(params.acceptance),
    fileHints: readStringArray(params.fileHints),
    important: readBoolean(params.important) ?? false,
    templateId: readTemplateId(params),
    leadRole: readString(params.leadRole),
    preferredLeadRole: readString(params.preferredLeadRole),
    maxWorkers: readPositiveInteger(params.maxWorkers),
    includeVerifier: readBoolean(params.includeVerifier),
    taskLedgerSummary: readString(params.taskLedgerSummary),
    memorySummary: readString(params.memorySummary),
    openBlockers: readStringArray(params.openBlockers),
    reviewItems: readStringArray(params.reviewItems),
    repairBrief: readString(params.repairBrief),
    enableSchedule: readBoolean(params.enableSchedule),
    maxTicks: readPositiveInteger(params.maxTicks),
    maxRepairTicks: readPositiveInteger(params.maxRepairTicks),
  };
}

function parseTickInput(
  params: Record<string, unknown>,
  method: string,
  respond: RespondFn,
): MissionTickInput | null {
  const missionId = readMissionId(params);
  if (!missionId) {
    respondMissingMissionId(respond, method);
    return null;
  }
  const reason = readString(params.reason);
  return {
    missionId,
    reason:
      reason === "scheduled" ||
      reason === "event" ||
      reason === "approval" ||
      reason === "heartbeat" ||
      reason === "repair"
        ? reason
        : "manual",
    taskLedgerSummary: readString(params.taskLedgerSummary),
    memorySummary: readString(params.memorySummary),
    openBlockers: readStringArray(params.openBlockers),
    reviewItems: readStringArray(params.reviewItems),
    repairBrief: readString(params.repairBrief),
  };
}

function createMissionDeps(params: {
  sessionKey?: string;
  context: GatewayRequestContext;
}): MissionControllerDeps {
  const broadcastMissionLifecycle = (event: MissionLifecycleEvent) => {
    try {
      params.context.broadcast("mission-lifecycle", event, { dropIfSlow: true });
    } catch { /* lifecycle broadcast is best-effort */ }
  };
  const broadcastTaskLoopLifecycle = (event: TaskLoopLifecycleEvent) => {
    try {
      params.context.broadcast("task-loop-lifecycle", event, { dropIfSlow: true });
    } catch { /* lifecycle broadcast is best-effort */ }
  };
  const broadcastSubagentLifecycle = (event: OrchestrationLifecycleEvent) => {
    try {
      params.context.broadcast("subagent-lifecycle", { sessionKey: params.sessionKey, ...event }, { dropIfSlow: true });
    } catch { /* lifecycle broadcast is best-effort */ }
  };
  return {
    lifecycle: broadcastMissionLifecycle,
    taskLoopDeps: {
      spawn: spawnSubagentDirect,
      lifecycle: broadcastTaskLoopLifecycle,
      orchestrationLifecycle: broadcastSubagentLifecycle,
    },
  };
}

export const missionControlHandlers: GatewayRequestHandlers = {
  "mission.create": async ({ params, respond, context, client }) => {
    const request = parseMissionRunRequest(params, "mission.create", respond);
    if (!request) return;
    const cfg = context.getRuntimeConfig();
    const actor = resolveControlPlaneActor(client ?? null);
    try {
      const mission = createMission(request, cfg, createMissionDeps({ sessionKey: request.sessionKey, context }));
      context.logGateway.info(
        `[role-audit] mission.create ${formatControlPlaneActor(actor)} missionId=${mission.missionId} sessionKey=${mission.sessionKey}`,
      );
      respond(true, { mission }, undefined);
    } catch (err) {
      context.logGateway.warn(
        `[role-audit] mission.create FAILED ${formatControlPlaneActor(actor)} error=${err instanceof Error ? err.message : String(err)}`,
      );
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, `mission.create failed: ${err instanceof Error ? err.message : String(err)}`));
    }
  },

  "mission.run": async ({ params, respond, context, client }) => {
    const request = parseMissionRunRequest(params, "mission.run", respond);
    if (!request) return;
    const cfg = context.getRuntimeConfig();
    const actor = resolveControlPlaneActor(client ?? null);
    try {
      const mission = request.objective
        ? await runMission(request, cfg, createMissionDeps({ sessionKey: request.sessionKey, context }))
        : await tickMission({ missionId: request.missionId!, reason: "manual" }, cfg, createMissionDeps({ context }));
      context.logGateway.info(
        `[role-audit] mission.run ${formatControlPlaneActor(actor)} status=${mission.status} missionId=${mission.missionId} sessionKey=${mission.sessionKey}`,
      );
      respond(true, { mission }, undefined);
    } catch (err) {
      context.logGateway.warn(
        `[role-audit] mission.run FAILED ${formatControlPlaneActor(actor)} error=${err instanceof Error ? err.message : String(err)}`,
      );
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, `mission.run failed: ${err instanceof Error ? err.message : String(err)}`));
    }
  },

  "mission.tick": async ({ params, respond, context, client }) => {
    const input = parseTickInput(params, "mission.tick", respond);
    if (!input) return;
    const cfg = context.getRuntimeConfig();
    const actor = resolveControlPlaneActor(client ?? null);
    try {
      const mission = await tickMission(input, cfg, createMissionDeps({ context }));
      context.logGateway.info(
        `[role-audit] mission.tick ${formatControlPlaneActor(actor)} status=${mission.status} missionId=${mission.missionId} tick=${mission.tick}`,
      );
      respond(true, { mission }, undefined);
    } catch (err) {
      context.logGateway.warn(
        `[role-audit] mission.tick FAILED ${formatControlPlaneActor(actor)} error=${err instanceof Error ? err.message : String(err)}`,
      );
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, `mission.tick failed: ${err instanceof Error ? err.message : String(err)}`));
    }
  },

  "mission.status": async ({ params, respond }) => {
    const missionId = readMissionId(params);
    const sessionKey = readString(params.sessionKey);
    if (!missionId && !sessionKey) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, 'mission.status requires "missionId" or "sessionKey"'));
      return;
    }
    const mission = missionId ? getMissionRun(missionId) : getLatestMission(sessionKey!);
    if (!mission) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, missionId ? `unknown mission "${missionId}"` : `no mission for session "${sessionKey}"`));
      return;
    }
    respond(true, { mission }, undefined);
  },

  "mission.pause": async ({ params, respond }) => {
    const missionId = readMissionId(params);
    if (!missionId) {
      respondMissingMissionId(respond, "mission.pause");
      return;
    }
    try {
      respond(true, { mission: pauseMission(missionId) }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)));
    }
  },

  "mission.resume": async ({ params, respond }) => {
    const missionId = readMissionId(params);
    if (!missionId) {
      respondMissingMissionId(respond, "mission.resume");
      return;
    }
    try {
      const mission = resumeMission(missionId);
      // Level-triggered reconciliation: a dependency that finished while the
      // mission was parked produced no continuation at the time, so resume must
      // re-read current row state and continue from it. Never a command replay.
      const { runGoalWakeLevelCheckForMission } = await import(
        "../../agents/goal-wake-dispatch.js"
      );
      const reconciled = await runGoalWakeLevelCheckForMission(missionId);
      respond(true, { mission, reconciled }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)));
    }
  },

  "mission.cancel": async ({ params, respond }) => {
    const missionId = readMissionId(params);
    if (!missionId) {
      respondMissingMissionId(respond, "mission.cancel");
      return;
    }
    try {
      // Mission terminal truth first. This also closes the arm path (arm
      // refuses a non-running mission), so the sweep below cannot race a
      // newly armed wait into existence behind it.
      const mission = cancelMission(missionId);
      const { cancelGoalWakeWaitsForMission } = await import("../../agents/goal-wake-cancel.js");
      const cascade = await cancelGoalWakeWaitsForMission({
        missionId,
        reason: "mission cancelled",
      });
      if (cascade.helperCancelFailures.length > 0) {
        // Rows are terminal, but OS containment is unproven. Fail closed so the
        // operator never reads "cancelled" as "nothing is still running".
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `mission ${missionId} rows are terminal but durable-helper containment is unproven: ${cascade.helperCancelFailures
              .map((failure) => `${failure.runId}: ${failure.reason}`)
              .join("; ")}`,
          ),
        );
        return;
      }
      respond(true, { mission, cascade }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)));
    }
  },
};
