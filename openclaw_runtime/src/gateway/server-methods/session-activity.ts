import { listClawGraphRunSnapshots } from "../../agents/clawgraph/runtime.js";
import {
  readRuntimeEffectiveCapabilityObservation,
  resolveCurrentRuntimeGeneration,
} from "../../agents/runtime-effective-capability.js";
import { getLatestMissionForSession } from "../../agents/mission-control/store.js";
import {
  listOrchestrationCompletionBatchesForRequester,
  listSubagentRunsForRequester,
} from "../../agents/subagent-registry.js";
import { listTaskLoopRunsForSession } from "../../agents/task-loop-controller.js";
import {
  countLongTaskQueuedMessages,
  getLatestLongTaskCheckpoint,
} from "../../agents/long-task-control/store.js";
import { buildSessionEffectivePolicy } from "../session-effective-policy.js";
import { loadSessionEntry } from "../session-utils.js";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { collectSessionActivityReadProjection } from "./session-activity-projection.js";
import { readRuntimeSessionResourceInventory } from "../session-resource-inventory.js";
import { projectSessionStage } from "./session-stage-projection.js";
import { readSessionDerivation } from "./session-derivation-projection.js";
import type { GatewayRequestHandlers } from "./types.js";

function readSessionKey(params: Record<string, unknown>): string | null {
  const value = params.sessionKey ?? params.key;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readWorkspaceId(params: Record<string, unknown>): string | null {
  const value = params.workspaceId;
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
  "session.activitySnapshot": async ({ params, respond, context }) => {
    const sessionKey = readSessionKey(params);
    if (!sessionKey) {
      respond(false, undefined, {
        code: "INVALID_REQUEST",
        message: "session.activitySnapshot requires sessionKey",
      });
      return;
    }

    const activeRun = [...context.chatAbortControllers.entries()]
      .filter(
        ([, entry]) =>
          entry.sessionKey === sessionKey &&
          entry.controlUiVisible !== false &&
          entry.projectSessionActive !== false,
      )
      .sort((left, right) => right[1].startedAtMs - left[1].startedAtMs)[0];
    const mission = getLatestMissionForSession(sessionKey);
    const tasks = [
      ...(mission
        ? [
            {
              id: mission.missionId,
              kind: "mission",
              title: mission.objective || `Mission ${mission.missionId}`,
              status: taskStatus(mission.status),
              progress: mission.progress,
              phase: mission.phase,
              updatedAt: mission.updatedAt,
              source: "snapshot",
            },
          ]
        : []),
      ...listTaskLoopRunsForSession(sessionKey)
        .slice(-4)
        .map((loop) => ({
          id: loop.loopRunId,
          kind: "taskLoop",
          title: loop.task || `Task Loop ${loop.loopRunId}`,
          status: taskStatus(loop.status),
          progress:
            loop.maxIterations > 0 ? Math.min(1, loop.iteration / loop.maxIterations) : undefined,
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
    const subagents = listSubagentRunsForRequester(sessionKey)
      .slice(-8)
      .map((run) => ({
        id: run.orchestration?.taskNodeId ?? run.orchestration?.roleInstanceId ?? run.runId,
        role: run.orchestration?.roleName ?? run.label,
        task: run.task,
        summary: run.outcome?.error,
        error: run.outcome?.error,
        childSessionKey: run.childSessionKey || undefined,
        agentId: run.childSessionKey
          ? parseAgentSessionKey(run.childSessionKey)?.agentId
          : undefined,
        status: !run.endedAt
          ? "started"
          : // A yielded run keeps endedAt but clears outcome/endedReason, so it must
            // be matched before the terminal branches or it reads as an error.
            run.pauseReason === "sessions_yield"
            ? "yielded"
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
    const cfg = context.getRuntimeConfig();
    // The activity snapshot exposes the physical generation. A concurrent reset
    // can rewrite the SQLite store inside one freshness-stat window, so this
    // read must bypass the shared object cache rather than return a prior row.
    const loaded = loadSessionEntry(sessionKey, {
      ...(activeRun?.[1].agentId ? { agentId: activeRun[1].agentId } : {}),
      skipCache: true,
    });
    const workspaceId =
      readWorkspaceId(params) ??
      activeRun?.[1].workspaceId?.trim() ??
      loaded.entry?.workspaceDir?.trim() ??
      "unknown";
    const completionBatches = listOrchestrationCompletionBatchesForRequester(
      sessionKey,
      activeRun?.[1].sessionId ?? loaded.entry?.sessionId ?? null,
    );
    const capabilityObservation = readRuntimeEffectiveCapabilityObservation({
      workspaceId,
      sessionKey,
      sessionId: activeRun?.[1].sessionId ?? loaded.entry?.sessionId ?? null,
      runId: activeRun?.[0] ?? null,
      runtimeGeneration: resolveCurrentRuntimeGeneration(),
      nowMs: now,
    });
    const policy = buildSessionEffectivePolicy({
      cfg,
      workspaceId,
      sessionKey,
      agentId: activeRun?.[1].agentId,
      entry: loaded.entry,
      activeRun: activeRun
        ? {
            runId: activeRun[0],
            sessionId: activeRun[1].sessionId,
            startedAtMs: activeRun[1].startedAtMs,
          }
        : null,
      capabilityObservation,
      queuedCount: queueCount,
      nowMs: now,
    });
    const expectedSessionId = activeRun?.[1].sessionId ?? loaded.entry?.sessionId ?? null;
    const resourceAgentId = activeRun?.[1].agentId ?? parseAgentSessionKey(sessionKey)?.agentId;
    const agentWorkspaceDir = resourceAgentId
      ? resolveAgentWorkspaceDir(cfg, resourceAgentId)
      : null;
    const resources = await readRuntimeSessionResourceInventory({
      sessionKey,
      agentId: resourceAgentId,
      expectedSessionId,
      workspaceId,
      rootPath: loaded.entry?.workspaceDir ?? loaded.entry?.spawnedWorkspaceDir ?? null,
      agentWorkspaceDir,
    });

    // Read-only stage projection (TF-0641). Every input below is a fact the
    // gateway already loaded; this adds no read path, no write path, and no
    // decision. Transcript activity is taken from the entry's own counters so
    // the projection does not open the transcript.
    const stageHasActivity =
      typeof loaded.entry?.totalTokens === "number" && loaded.entry.totalTokens > 0
        ? true
        : typeof loaded.entry?.lastInteractionAt === "number" && loaded.entry.lastInteractionAt > 0
          ? true
          : false;
    const stage = projectSessionStage({
      sessionKey,
      entry: loaded.entry
        ? {
            sessionId: loaded.entry.sessionId ?? null,
            forkedFromParent: loaded.entry.forkedFromParent ?? null,
            forkedFromLeafId: loaded.entry.forkedFromLeafId ?? null,
            forkedFromTimestamp: loaded.entry.forkedFromTimestamp ?? null,
            parentSessionKey: loaded.entry.parentSessionKey ?? null,
            spawnedBy: loaded.entry.spawnedBy ?? null,
            usageFamilyKey: loaded.entry.usageFamilyKey ?? null,
            usageFamilySessionIds: loaded.entry.usageFamilySessionIds ?? null,
            compactionCount: loaded.entry.compactionCount ?? null,
            compactionCheckpoints: loaded.entry.compactionCheckpoints ?? null,
            sessionStartedAt: loaded.entry.sessionStartedAt ?? null,
          }
        : null,
      hasTranscriptActivity: stageHasActivity,
      lastTranscriptActivityAt:
        typeof loaded.entry?.lastInteractionAt === "number" && loaded.entry.lastInteractionAt > 0
          ? loaded.entry.lastInteractionAt
          : null,
    });

    // Read-only derivation lineage (TF-0643). Only the store the gateway
    // already loaded is consulted; there is no receipt table and no write path.
    // A read failure must not fail the snapshot.
    let derivation;
    try {
      derivation = readSessionDerivation({ cfg, sessionKey });
    } catch {
      derivation = undefined;
    }

    respond(
      true,
      {
        snapshot: {
          session: {
            sessionKey,
            sessionId: expectedSessionId,
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
          completionBatches,
          goals: readProjection.goals,
          processes: readProjection.processes,
          lineage: readProjection.lineage,
          stage,
          derivation,
          policy,
          resources,
          // The goal-wake owner read can fail and degrade to empty arrays; the
          // read state travels with the snapshot so Main cannot report a failed
          // owner read as a session with no background activity (#121).
          ownerRead: readProjection.ownerRead,
          continuity: {
            queueCount,
            checkpoint: Boolean(checkpoint),
            blockedReason:
              mission?.status === "blocked"
                ? (mission.blockedReason ?? mission.lastReason ?? null)
                : null,
          },
          availability: {
            tasks: true,
            subagents: true,
            continuity: true,
          },
          capturedAt: now,
        },
      },
      undefined,
    );
  },
};
