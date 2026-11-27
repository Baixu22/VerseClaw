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
import type { GatewayRequestContext } from "./types.js";
import { existsSync } from "node:fs";
import { normalizeAutonomySessionScope } from "../../../../shared/types/identity-scope.js";
import { createSessionActivityReadSnapshot, fenceSessionActivityRead, parseSessionActivityReadQuery,
  type SessionActivityReadQuery } from "../../../../shared/types/session-activity.js";
import { readSessionActivityRun, readSessionActivityTaskReferences, sessionActivityOwnerScope } from './session-activity-read-model.js';

async function readScopedActivity(query: SessionActivityReadQuery, context: GatewayRequestContext) {
  const snapshot = createSessionActivityReadSnapshot(query.scope);
  const sources = snapshot.readModel.sources;
  const fail = (state: 'unavailable' | 'stale' | 'unknown', reason: Parameters<typeof fenceSessionActivityRead>[2]) =>
    fenceSessionActivityRead(snapshot, state, reason);
  let loaded: ReturnType<typeof loadSessionEntry>;
  try { loaded = loadSessionEntry(query.scope.sessionKey, { skipCache: true, readOnly: true }); }
  catch { return fail('unavailable', 'owner-unavailable'); }
  const entry = loaded.entry;
  if (!entry) return fail('unavailable', 'owner-missing');
  if (loaded.canonicalKey !== query.scope.sessionKey || loaded.legacyKey) return fail('unavailable', 'scope-mismatch');
  if (!entry.workspaceId || !entry.sessionId) return fail('unknown', 'owner-missing');
  const ownerScope = sessionActivityOwnerScope(query.scope.sessionKey, entry)!;
  if (entry.sessionId !== query.scope.sessionGeneration) return fail('stale', 'generation-changed');
  try { normalizeAutonomySessionScope(query.scope, ownerScope); }
  catch { return fail('unavailable', 'scope-mismatch'); }
  const agentId = parseAgentSessionKey(loaded.canonicalKey)?.agentId;
  if (!agentId) return fail('unknown', 'owner-missing');
  sources.session = { owner: 'sessions', state: 'ready', readAt: Date.now(), value: {
    scope: ownerScope, agentId, parentSessionKey: entry.parentSessionKey ?? null, spawnedBy: entry.spawnedBy ?? null,
  } };
  snapshot.session.sessionId = entry.sessionId;
  const run = await readSessionActivityRun(ownerScope, entry, context);
  sources.run = run.source;
  if (run.source.state === 'unavailable' && run.source.reason === 'scope-mismatch') return fail('unavailable', 'scope-mismatch');
  snapshot.session.runId = run.source.value?.runId ?? null;
  snapshot.session.status = snapshot.session.runId ? 'running' : 'idle';
  snapshot.session.startedAt = run.startedAt;
  const root = entry.workspaceDir ?? entry.spawnedWorkspaceDir;
  let assertExecutionCurrent: (() => void) | undefined;
  if (root) {
    try {
      const [{ createExecutionTaskAccess }, { TaskSystemStore }] = await Promise.all([
        import('../../agents/execution-task-authority.js'), import('../../../../shared/task-system/store.js'),
      ]);
      const access = createExecutionTaskAccess(root, query.expectedExecution, true);
      assertExecutionCurrent = access.assertCurrent;
      sources.execution = { owner: 'execution-domain', state: 'ready', readAt: Date.now(), value: structuredClone(access.basis) };
      if (!existsSync(access.domain.database)) sources.tasks = { owner: 'TaskSystem', state: 'unavailable', readAt: Date.now(), value: null, reason: 'owner-missing' };
      else {
        const store = new TaskSystemStore(access.domain, undefined, access, true);
        try {
          const { task, references } = readSessionActivityTaskReferences(store, ownerScope);
          sources.tasks = { owner: 'TaskSystem', state: references.length ? 'ready' : 'empty', value: references, readAt: Date.now() };
          snapshot.tasks = references.map(ref => ({ id: ref.taskNodeId, kind: 'taskLedger', title: ref.objective,
            status: taskStatus(ref.state === 'doing' ? 'running' : ref.state === 'done' ? 'completed' : ref.state),
            source: 'task-ledger', updatedAt: task!.contract.updatedAt }));
          snapshot.availability.tasks = true;
        } finally { store.close(); }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'TASK_GENERATION_STALE') {
        sources.tasks = { owner: 'TaskSystem', state: 'stale', readAt: Date.now(), value: null, reason: 'generation-changed' };
      } else if (/TASK_AUTHORITY_|execution_.*(?:stale|replaced|missing)/i.test(message))
        return fail('stale', 'execution-changed');
      else {
        if (query.expectedExecution && sources.execution.state !== 'ready') return fail('stale', 'execution-changed');
        if (sources.execution.state !== 'ready') sources.execution = { owner: 'execution-domain', state: 'unavailable', value: null, readAt: Date.now(), reason: 'owner-unavailable' };
        sources.tasks = { owner: 'TaskSystem', state: 'unavailable', value: null, readAt: Date.now(), reason: 'owner-unavailable' };
      }
    }
  } else {
    if (query.expectedExecution) return fail('stale', 'execution-changed');
    sources.execution = { owner: 'execution-domain', state: 'unknown', readAt: Date.now(), value: null, reason: 'owner-missing' };
    sources.tasks = { owner: 'TaskSystem', state: 'unavailable', readAt: Date.now(), value: null, reason: 'owner-missing' };
  }
  // Re-read after asynchronous owner access: a reset must discard the entire old join.
  try {
    const after = loadSessionEntry(ownerScope.sessionKey, { skipCache: true, readOnly: true });
    if (after.canonicalKey !== loaded.canonicalKey || after.legacyKey || after.entry?.sessionId !== entry.sessionId
      || after.entry?.workspaceId !== entry.workspaceId || (after.entry?.workspaceDir ?? after.entry?.spawnedWorkspaceDir) !== root)
      return fail('stale', 'generation-changed');
    assertExecutionCurrent?.();
  } catch { return fail('stale', 'execution-changed'); }
  snapshot.capturedAt = Date.now();
  return snapshot;
}

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
  "session.activitySnapshot": async ({ params, respond, context, client }) => {
    if (params.materialsBatch !== undefined) {
      try {
        if (Object.keys(params).length !== 1) throw new TypeError('One material batch query required');
        const { readSessionCollaborationMaterialBatch } = await import('./session-collaboration-material.js');
        respond(true, { materials: await readSessionCollaborationMaterialBatch(params.materialsBatch, context) }, undefined);
      } catch { respond(false, undefined, { code: 'INVALID_REQUEST', message: 'Invalid material batch query' }); }
      return;
    }
    if (params.materials !== undefined) {
      try {
        if (Object.keys(params).length !== 1) throw new TypeError('One material query required');
        const { readSessionCollaborationMaterials } = await import('./session-collaboration-material.js');
        respond(true, { materials: await readSessionCollaborationMaterials(params.materials, context) }, undefined);
      } catch { respond(false, undefined, { code: 'INVALID_REQUEST', message: 'Invalid collaboration material query' }); }
      return;
    }
    if (params.taskContext !== undefined) {
      try {
        if (Object.keys(params).length !== 1) throw new TypeError('One context query required');
        const { readSessionCollaborationTaskContext } = await import('./session-collaboration-context.js');
        respond(true, { taskContext: await readSessionCollaborationTaskContext(params.taskContext, context) }, undefined);
      } catch { respond(false, undefined, { code: 'INVALID_REQUEST', message: 'Invalid collaboration context query' }); }
      return;
    }
    if (params.messages !== undefined) {
      try {
        if (Object.keys(params).length !== 1) throw new TypeError('One message query required');
        const { readSessionCollaborationMessages } = await import('./session-collaboration-message.js');
        respond(true, { messages: await readSessionCollaborationMessages(params.messages, context) }, undefined);
      } catch { respond(false, undefined, { code: 'INVALID_REQUEST', message: 'Invalid collaboration message query' }); }
      return;
    }
    if (params.watch !== undefined || params.cancelWatch !== undefined) {
      try {
        if (Object.keys(params).length !== 1) throw new TypeError('One watch operation required');
        const owner = client?.connect.device?.id ?? client?.connect.client.id ?? 'embedded';
        const { watchSessionCollaboration, cancelSessionCollaborationWatch } = await import('./session-collaboration-watch.js');
        respond(true, params.cancelWatch !== undefined ? cancelSessionCollaborationWatch(params.cancelWatch, context, owner)
          : { watch: await watchSessionCollaboration(params.watch, context, owner) }, undefined);
      } catch { respond(false, undefined, { code: 'INVALID_REQUEST', message: 'Invalid collaboration watch' }); }
      return;
    }
    if (params.query !== undefined) {
      try {
        const { readSessionCollaborationQuery } = await import('./session-collaboration-query.js');
        respond(true, { page: await readSessionCollaborationQuery(params.query, context) }, undefined);
      }
      catch { respond(false, undefined, { code: 'INVALID_REQUEST', message: 'Invalid collaboration query' }); }
      return;
    }
    if (params.scope !== undefined) {
      let query: SessionActivityReadQuery;
      try { query = parseSessionActivityReadQuery(params); }
      catch { respond(false, undefined, { code: 'INVALID_REQUEST', message: 'Invalid session activity read scope' }); return; }
      respond(true, { snapshot: await readScopedActivity(query, context) }, undefined);
      return;
    }
    const sessionKey = readSessionKey(params);
    if (!sessionKey) {
      respond(false, undefined, {
        code: "INVALID_REQUEST",
        message: "session.activitySnapshot requires sessionKey",
      });
      return;
    }

    const visibleRuns = [...context.chatAbortControllers.entries()]
      .filter(
        ([, entry]) =>
          entry.sessionKey === sessionKey &&
          entry.controlUiVisible !== false &&
          entry.projectSessionActive !== false,
      )
      .sort((left, right) => right[1].startedAtMs - left[1].startedAtMs);
    const latestRun = visibleRuns[0];
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
      ...(latestRun?.[1].agentId ? { agentId: latestRun[1].agentId } : {}),
      skipCache: true,
    });
    const currentSessionId = loaded.entry?.sessionId ?? latestRun?.[1].sessionId ?? null;
    // Reset can precede old-run cleanup. Only a run captured in this generation
    // may supply the current run identity or effective capability scope.
    const activeRun = visibleRuns.find(([, run]) => run.sessionId === currentSessionId);
    const workspaceId =
      readWorkspaceId(params) ??
      activeRun?.[1].workspaceId?.trim() ??
      loaded.entry?.workspaceDir?.trim() ??
      "unknown";
    const completionBatches = listOrchestrationCompletionBatchesForRequester(
      sessionKey,
      currentSessionId,
    );
    const capabilityObservation = readRuntimeEffectiveCapabilityObservation({
      workspaceId,
      sessionKey,
      sessionId: currentSessionId,
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
    const expectedSessionId = currentSessionId;
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
