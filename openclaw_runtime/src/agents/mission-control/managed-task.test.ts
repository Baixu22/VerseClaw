// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({
  entry: undefined as { sessionId?: string; workspaceDir?: string; spawnedWorkspaceDir?: string } | undefined,
}));

vi.mock("../../config/sessions/store.js", () => ({
  getSessionEntry: () => sessionState.entry,
}));

import { TaskSystemStore } from "../../../../shared/task-system/store.js";
import { resolveTaskDomain } from "../../../../shared/task-system/identity.js";
import type { TaskLoopRunResult } from "../task-loop-controller.js";
import { runTaskLoop } from "../task-loop-controller.js";
import type { ObservedOrchestrationRunRequest } from "../orchestrator-run-observed.js";
import type { MissionControllerDeps } from "./controller.js";
import {
  createMission,
  pauseMission,
  resumeMission,
  tickMission,
} from "./controller.js";
import { bindMissionManagedTask } from "./managed-task.js";
import type {
  MissionManagedTaskReference,
  MissionReviewerResult,
  MissionRunRecord,
} from "./types.js";
import { createMissionLoopTool } from "../tools/mission-loop-tool.js";
import { missionControlHandlers } from "../../gateway/server-methods/mission-control-methods.js";
import { closeOpenClawStateDatabaseForTest } from "../../state/openclaw-state-db.js";

const roots: string[] = [];
const stores: TaskSystemStore[] = [];
const previousState = process.env.OPENCLAW_STATE_DIR;
const previousBridge = process.env.CLAWX_TASK_SCOPE_BRIDGE;

afterEach(() => {
  for (const store of stores.splice(0).toReversed()) store.close();
  closeOpenClawStateDatabaseForTest();
  for (const root of roots.splice(0).toReversed()) rmSync(root, { recursive: true, force: true });
  sessionState.entry = undefined;
  if (previousState === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = previousState;
  if (previousBridge === undefined) delete process.env.CLAWX_TASK_SCOPE_BRIDGE;
  else process.env.CLAWX_TASK_SCOPE_BRIDGE = previousBridge;
});

function taskLoopResult(
  workspaceDir: string | undefined,
  managedTask: MissionManagedTaskReference | undefined,
): TaskLoopRunResult {
  return {
    loopRunId: "loop-managed",
    sessionKey: "agent:main:managed",
    workspaceId: "workspace-managed",
    ...(workspaceDir ? { workspaceDir } : {}),
    ...(managedTask ? { managedTask } : {}),
    task: "managed task",
    status: "complete",
    phase: "complete",
    iteration: 1,
    maxIterations: 3,
    maxRepairIterations: 2,
    orchestrationRunIds: ["orch-managed"],
    evidenceRefs: [{ type: "trace", ref: "orch-managed", summary: "worker evidence" }],
    subagentEvidence: [],
    roleQualitySummary: { good: 0, needsAttention: 0, poorAttempt: 0, roles: [] },
    risks: [],
    remaining: [],
    nextActions: [],
    finalSummary: "Worker finished; TaskSystemStore acceptance remains pending.",
    traceId: "trace-managed",
    createdAt: 1,
    updatedAt: 2,
    iterations: [],
  };
}

function reviewerComplete(): MissionReviewerResult {
  return {
    decision: "complete",
    confidence: 0.9,
    reason: "Worker evidence is complete.",
    missingEvidence: [],
    verificationGaps: [],
    risks: [],
    memoryCandidates: [],
    checkpointSummary: "worker complete",
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mission-managed-task-"));
  const state = join(root, "state");
  roots.push(root);
  process.env.OPENCLAW_STATE_DIR = state;
  const artifact = "accepted artifact";
  writeFileSync(join(root, "artifact.txt"), artifact);
  const sha256 = createHash("sha256").update(artifact).digest("hex");
  const store = new TaskSystemStore(resolveTaskDomain(root));
  stores.push(store);
  const task = store.create(
    {
      objective: "Owner contract objective",
      target: "artifact.txt",
      constraints: ["Keep the original owner"],
      acceptance: [
        {
          id: "artifact",
          description: "Owner accepts the artifact",
          verification: { kind: "file-sha256", path: "artifact.txt", sha256 },
        },
      ],
    },
    "create",
  ).task;
  const claim = store.claim(
    task.contract.taskNodeId,
    "agent:main:managed",
    "generation-managed",
    "claim",
  ).claim!;
  const runtime = {
    workspaceRoot: root,
    sessionKey: claim.sessionKey,
    sessionGeneration: claim.generation,
    required: true,
  };
  sessionState.entry = {
    sessionId: claim.generation,
    workspaceDir: root,
  };
  const bound = bindMissionManagedTask(runtime)!;
  return { root, store, task, claim, runtime, bound, sha256 };
}

function missionDeps(runtime: {
  workspaceRoot: string;
  sessionKey: string;
  sessionGeneration: string;
  required?: boolean;
}) {
  const records = new Map<string, MissionRunRecord>();
  let sequence = 0;
  let now = 1_000;
  const requests: Array<{ task: string; workspaceDir?: string; taskNodeId?: string }> = [];
  const deps: MissionControllerDeps = {
    idFactory: (prefix) => prefix + "-" + (++sequence),
    now: () => now++,
    managedTask: runtime,
    saveMission: (record) => {
      records.set(record.missionId, structuredClone(record));
      return record;
    },
    getMission: (missionId) => records.get(missionId),
    getLatestMissionForSession: (sessionKey) =>
      [...records.values()].findLast((record) => record.sessionKey === sessionKey),
    recordEvent: vi.fn(),
    runTaskLoop: (async (request) => {
      requests.push({
        task: request.task,
        workspaceDir: request.workspaceDir,
        taskNodeId: request.managedTask?.taskNodeId,
      });
      return taskLoopResult(request.workspaceDir, request.managedTask);
    }) as MissionControllerDeps["runTaskLoop"],
    reviewer: async () => reviewerComplete(),
    storeTrace: vi.fn() as never,
    proposeMemory: vi.fn() as never,
    createKnowledgeInboxItem: vi.fn(),
    lifecycle: vi.fn(),
  };
  return { deps, records, requests };
}

describe("managed Mission task authority", () => {
  it("uses the TaskContract owner for model tool runs and does not complete without acceptance", async () => {
    const f = fixture();
    const { deps, records, requests } = missionDeps(f.runtime);
    const tool = createMissionLoopTool({
      agentSessionKey: f.claim.sessionKey,
      deps,
      managedTask: {
        workspaceRoot: f.runtime.workspaceRoot,
        sessionGeneration: f.runtime.sessionGeneration,
        required: true,
      },
    });

    const result = await tool.execute("mission-tool", {
      action: "run",
      objective: "Model-supplied objective",
      acceptance: ["Model-supplied acceptance"],
    });
    const details = result.details as MissionRunRecord & {
      resultPolicy: { completion: string };
    };
    expect(details.objective).toBe("Owner contract objective");
    expect(details.acceptance).toEqual(["artifact: Owner accepts the artifact"]);
    expect(details.status).toBe("sleeping");
    expect(details.metadata?.managedTaskAcceptancePending).toBe(true);
    expect(details.resultPolicy.completion).toBe("mission_reviewer");
    expect(f.store.get(f.task.contract.taskNodeId).contract.state).toBe("doing");
    expect(requests[0]).toMatchObject({
      workspaceDir: f.bound.reference.worktree,
      taskNodeId: f.task.contract.taskNodeId,
    });
    expect(requests[0]?.task).toContain("Owner contract objective");
    expect(requests[0]?.task).toContain("Target: artifact.txt");

    f.store.submit(f.claim, "candidate");
    f.store.verifyFile(f.claim, "artifact", "artifact.txt", f.sha256, "candidate");
    f.store.accept(f.claim, "candidate");
    const completedResult = await tool.execute("mission-tick", {
      action: "tick",
      missionId: details.missionId,
      reason: "manual",
    });
    const completed = completedResult.details as MissionRunRecord & {
      resultPolicy: { completion: string };
    };
    expect(completed.status).toBe("complete");
    expect(completed.resultPolicy.completion).toBe("task_owner_accepted");
    expect(completed.metadata?.managedTaskAcceptance).toMatchObject({
      taskNodeId: f.task.contract.taskNodeId,
      revision: f.task.contract.revision,
    });
    expect(records.get(details.missionId)?.status).toBe("complete");
  });

  it("rejects a reset generation before resume or tick and never substitutes another task", async () => {
    const f = fixture();
    const { deps } = missionDeps(f.runtime);
    const mission = createMission(
      {
        objective: "ignored",
        sessionKey: f.claim.sessionKey,
        managedTask: f.runtime,
      },
      {},
      deps,
    );
    pauseMission(mission.missionId, deps);
    const stale = { ...f.runtime, sessionGeneration: "generation-reset" };
    expect(() => resumeMission(mission.missionId, { ...deps, managedTask: stale })).toThrow(
      "MISSION_MANAGED_TASK_SESSION_STALE",
    );
    const runTaskLoop = vi.fn();
    await expect(
      tickMission(
        { missionId: mission.missionId, reason: "manual" },
        {},
        { ...deps, managedTask: stale, runTaskLoop: runTaskLoop as never },
      ),
    ).rejects.toThrow("MISSION_MANAGED_TASK_SESSION_STALE");
    expect(runTaskLoop).not.toHaveBeenCalled();
  });

  it("fails closed when an explicitly managed Mission has no active claim", () => {
    const f = fixture();
    f.store.control(f.claim, "release");
    const { deps } = missionDeps(f.runtime);
    expect(() =>
      createMission(
        {
          objective: "ignored",
          sessionKey: f.claim.sessionKey,
          managedTask: f.runtime,
        },
        {},
        deps,
      ),
    ).toThrow("MISSION_MANAGED_TASK_BINDING_MISSING");
  });

  it("fails closed in managed bridge mode when session workspace provenance is missing", async () => {
    process.env.CLAWX_TASK_SCOPE_BRIDGE = "1";
    const f = fixture();
    sessionState.entry = { sessionId: f.claim.generation };
    const responds: Array<{ ok: boolean; error: unknown }> = [];
    await missionControlHandlers["mission.create"]!({
      params: { objective: "managed", sessionKey: f.claim.sessionKey },
      respond: (ok: boolean, _payload?: unknown, error?: unknown) => responds.push({ ok, error }),
      context: {
        getRuntimeConfig: () => ({}),
        broadcast: vi.fn(),
        logGateway: { info: vi.fn(), warn: vi.fn() },
      },
      client: null,
    } as never);
    expect(responds[0]?.ok).toBe(false);
    expect(String((responds[0]?.error as { message?: string })?.message)).toContain(
      "MISSION_MANAGED_TASK_SESSION_CONTEXT_MISSING",
    );
  });

  it("does not execute a legacy Mission after managed bridge mode is enabled", async () => {
    const f = fixture();
    delete process.env.CLAWX_TASK_SCOPE_BRIDGE;
    const { deps } = missionDeps(f.runtime);
    const mission = createMission(
      { objective: "legacy", sessionKey: f.claim.sessionKey },
      {},
      { ...deps, managedTask: undefined },
    );
    process.env.CLAWX_TASK_SCOPE_BRIDGE = "1";
    await expect(
      tickMission(
        { missionId: mission.missionId, reason: "manual" },
        {},
        { ...deps, managedTask: f.runtime },
      ),
    ).rejects.toThrow("MISSION_MANAGED_TASK_REFERENCE_REQUIRED");
  });

  it("passes the actual workspace and pinned reference through task_loop role context", async () => {
    const f = fixture();
    let capturedWorkspace: string | undefined;
    const result = await runTaskLoop(
      {
        task: "run managed work",
        sessionKey: f.claim.sessionKey,
        workspaceId: "workspace-managed",
        workspaceDir: f.bound.reference.worktree,
        managedTask: f.bound.reference,
      },
      {},
      {
        idFactory: (prefix) => prefix + "-managed",
        ensureTaskLedgerRoot: () => "ledger-managed",
        runObserved: (async (_request: ObservedOrchestrationRunRequest, ctx: { workspaceDir?: string }) => {
          capturedWorkspace = ctx.workspaceDir;
          return {
            plan: { workers: [], mode: "lead-workers", leadRole: "planner", reasons: [], templateId: "quick-development" },
            outcomes: [],
            spawnedRunIds: [],
            expectedWorkerRunIds: [],
            pendingVerifier: false,
            failures: [],
          };
        }) as never,
        selfCheck: (async () => ({
          decision: "complete",
          confidence: 0.9,
          missingEvidence: [],
          verificationGaps: [],
          risks: [],
          validationState: { status: "passed", checks: ["targeted"], evidenceRefs: [] },
          contextSummary: "done",
        })) as never,
        getSubagentRun: () => null,
        recordCheckpoint: vi.fn() as never,
        storeTrace: vi.fn() as never,
      },
    );
    expect(capturedWorkspace).toBe(f.bound.reference.worktree);
    expect(result.workspaceDir).toBe(f.bound.reference.worktree);
    expect(result.managedTask?.taskNodeId).toBe(f.task.contract.taskNodeId);
  });

  it("routes Gateway managed bridge creation through required session owner", async () => {
    process.env.CLAWX_TASK_SCOPE_BRIDGE = "1";
    const f = fixture();
    const responds: Array<{ ok: boolean; payload: unknown; error: unknown }> = [];
    const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
      responds.push({ ok, payload, error });
    };
    const context = {
      getRuntimeConfig: () => ({}),
      broadcast: vi.fn(),
      logGateway: { info: vi.fn(), warn: vi.fn() },
    };
    await missionControlHandlers["mission.create"]!({
      params: {
        objective: "Gateway model objective",
        sessionKey: f.claim.sessionKey,
      },
      respond,
      context,
      client: null,
    } as never);
    expect(responds[0]?.ok).toBe(true);
    const mission = (responds[0]?.payload as { mission: MissionRunRecord }).mission;
    expect(mission.objective).toBe("Owner contract objective");
    expect(mission.metadata?.managedTask).toMatchObject({
      taskNodeId: f.task.contract.taskNodeId,
      generation: f.claim.generation,
    });

    sessionState.entry = {
      sessionId: "generation-reset",
      workspaceDir: f.root,
    };
    await missionControlHandlers["mission.tick"]!({
      params: { missionId: mission.missionId, reason: "manual" },
      respond,
      context,
      client: null,
    } as never);
    expect(responds[1]?.ok).toBe(false);
    expect(String((responds[1]?.error as { message?: string })?.message)).toContain(
      "MISSION_MANAGED_TASK_SESSION_STALE",
    );
  });
});
