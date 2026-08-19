import { listClawGraphRunSnapshots } from "../../agents/clawgraph/runtime.js";
import { getLatestMissionForSession } from "../../agents/mission-control/store.js";
import { listSubagentRunsForRequester } from "../../agents/subagent-registry.js";
import { listTaskLoopRunsForSession } from "../../agents/task-loop-controller.js";
import {
  countLongTaskQueuedMessages,
  getLatestLongTaskCheckpoint,
} from "../../agents/long-task-control/store.js";
import { collectSessionActivityReadProjection } from "./session-activity-projection.js";
import type { GatewayRequestHandlers } from "./types.js";

function readSessionKey(params: Record<string, unknown>): string | null {
  const value = params.sessionKey ?? params.key;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function taskStatus(status: string) {
  if (status === "running") return "running";
  if (status === "review") return "review";
  if (status === "blocked") return "blocked";
  if (status === "complete" || status === "completed") return "completed";
  if (status === "failed" || status === "error") return "failed";
  if (status === "aborted" || status === "cancelled") return "aborted";
  return "queued";
}

export const sessionActivityHandlers: GatewayRequestHandlers = {
  "session.activitySnapshot": ({ params, respond, context }) => {
    const sessionKey = readSessionKey(params);
    if (!sessionKey) {
      respond(false, undefined, { code: "INVALID_REQUEST", message: "session.activitySnapshot requires sessionKey" });
      return;
    }

    const activeRun = [...context.chatAbortControllers.entries()]
      .filter(([, entry]) => (
        entry.sessionKey === sessionKey
        && entry.controlUiVisible !== false
        && entry.projectSessionActive !== false
      ))
      .sort((left, right) => right[1].startedAtMs - left[1].startedAtMs)[0];
    const mission = getLatestMissionForSession(sessionKey);
    const tasks = [
      ...(mission ? [{
        id: mission.missionId,
        kind: "mission",
        title: mission.objective || `Mission ${mission.missionId}`,
        status: taskStatus(mission.status),
        progress: mission.progress,
        phase: mission.phase,
        updatedAt: mission.updatedAt,
        source: "snapshot",
      }] : []),
      ...listTaskLoopRunsForSession(sessionKey).slice(-4).map((loop) => ({
        id: loop.loopRunId,
        kind: "taskLoop",
        title: loop.task || `Task Loop ${loop.loopRunId}`,
        status: taskStatus(loop.status),
        progress: loop.maxIterations > 0 ? Math.min(1, loop.iteration / loop.maxIterations) : undefined,
        phase: loop.phase,
        updatedAt: loop.updatedAt,
        source: "snapshot",
      })),
      ...listClawGraphRunSnapshots()
        .filter((run) => run.sessionKey === sessionKey)
        .slice(-4)
        .map((run) => ({
          id: run.runId,
          kind: "clawGraph",
          title: run.title || run.workflowId,
          status: taskStatus(run.status),
          progress: run.progress,
          updatedAt: run.updatedAt,
          source: "snapshot",
        })),
    ];
    const subagents = listSubagentRunsForRequester(sessionKey).slice(-8).map((run) => ({
      id: run.orchestration?.taskNodeId ?? run.orchestration?.roleInstanceId ?? run.runId,
      role: run.orchestration?.roleName ?? run.label,
      task: run.task,
      summary: run.outcome?.error,
      status: !run.endedAt
        ? "started"
        : run.outcome?.status === "ok"
          ? "completed"
          : run.endedReason
            ? "aborted"
            : "error",
      updatedAt: run.endedAt ?? run.startedAt ?? run.createdAt,
      source: "snapshot",
    }));
    const queueCount = countLongTaskQueuedMessages(sessionKey);
    const checkpoint = getLatestLongTaskCheckpoint(sessionKey);
    const readProjection = collectSessionActivityReadProjection(sessionKey, mission);
    const now = Date.now();

    respond(true, {
      snapshot: {
        session: {
          sessionKey,
          runId: activeRun?.[0] ?? null,
          status: activeRun ? "running" : "idle",
          phase: activeRun ? "execute" : undefined,
          startedAt: activeRun?.[1].startedAtMs ?? null,
          endedAt: null,
          error: null,
          updatedAt: activeRun?.[1].startedAtMs ?? now,
        },
        tasks,
        subagents,
        goals: readProjection.goals,
        processes: readProjection.processes,
        lineage: readProjection.lineage,
        continuity: {
          queueCount,
          checkpoint: Boolean(checkpoint),
          blockedReason: mission?.status === "blocked" ? mission.blockedReason ?? mission.lastReason ?? null : null,
        },
        availability: {
          tasks: true,
          subagents: true,
          continuity: true,
        },
        capturedAt: now,
      },
    }, undefined);
  },
};
