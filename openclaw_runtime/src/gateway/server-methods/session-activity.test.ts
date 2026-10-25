import { beforeEach, describe, expect, it, vi } from "vitest";

const collectSessionActivityReadProjection = vi.hoisted(() => vi.fn());
const getLatestMissionForSession = vi.hoisted(() => vi.fn());
const listSubagentRunsForRequester = vi.hoisted(() => vi.fn());
const listTaskLoopRunsForSession = vi.hoisted(() => vi.fn());
const listClawGraphRunSnapshots = vi.hoisted(() => vi.fn());
const countLongTaskQueuedMessages = vi.hoisted(() => vi.fn());
const getLatestLongTaskCheckpoint = vi.hoisted(() => vi.fn());
const loadSessionEntry = vi.hoisted(() => vi.fn());
const readRuntimeEffectiveCapabilityObservation = vi.hoisted(() => vi.fn());
const resolveCurrentRuntimeGeneration = vi.hoisted(() => vi.fn());

vi.mock("./session-activity-projection.js", () => ({
  collectSessionActivityReadProjection,
}));
vi.mock("../../agents/mission-control/store.js", () => ({
  getLatestMissionForSession,
}));
vi.mock("../../agents/subagent-registry.js", () => ({
  listSubagentRunsForRequester,
}));
vi.mock("../../agents/task-loop-controller.js", () => ({
  listTaskLoopRunsForSession,
}));
vi.mock("../../agents/clawgraph/runtime.js", () => ({
  listClawGraphRunSnapshots,
}));
vi.mock("../../agents/long-task-control/store.js", () => ({
  countLongTaskQueuedMessages,
  getLatestLongTaskCheckpoint,
}));
vi.mock("../session-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../session-utils.js")>()),
  loadSessionEntry,
}));
vi.mock("../../agents/runtime-effective-capability.js", () => ({
  readRuntimeEffectiveCapabilityObservation,
  resolveCurrentRuntimeGeneration,
}));

import { sessionActivityHandlers } from "./session-activity.js";

function callHandler(params: Record<string, unknown>, chatAbortControllers = new Map()) {
  const respond = vi.fn();
  const handler = sessionActivityHandlers["session.activitySnapshot"];
  handler({
    params,
    respond,
    context: {
      chatAbortControllers,
      getRuntimeConfig: () => ({}),
    },
  } as never);
  return respond;
}

beforeEach(() => {
  vi.clearAllMocks();
  getLatestMissionForSession.mockReturnValue(undefined);
  listSubagentRunsForRequester.mockReturnValue([]);
  listTaskLoopRunsForSession.mockReturnValue([]);
  listClawGraphRunSnapshots.mockReturnValue([]);
  countLongTaskQueuedMessages.mockReturnValue(0);
  getLatestLongTaskCheckpoint.mockReturnValue(undefined);
  loadSessionEntry.mockReturnValue({
    entry: {
      sessionId: "session-1",
      updatedAt: Date.now(),
      modelProvider: "openai",
      model: "gpt-5.4",
      agentRuntimeOverride: "codex",
    },
    canonicalKey: "agent:main:main",
  });
  readRuntimeEffectiveCapabilityObservation.mockReturnValue({
    state: "missing",
    reason: "no-current-run-capability-profile",
    observation: null,
  });
  resolveCurrentRuntimeGeneration.mockReturnValue("gateway-1");
  collectSessionActivityReadProjection.mockReturnValue({
    goals: [],
    processes: [],
    lineage: [],
    ownerRead: "known",
  });
});

describe("session activity handler", () => {
  it("rejects a missing session key without reading the projection", () => {
    const respond = callHandler({});

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    expect(collectSessionActivityReadProjection).not.toHaveBeenCalled();
  });

  it("attaches goal, process, and lineage arrays to the activity snapshot", () => {
    const now = Date.now();
    collectSessionActivityReadProjection.mockReturnValue({
      goals: [{ id: "mission-1", kind: "mission", label: "Mission mission-1", status: "running", updatedAt: now }],
      processes: [{ id: "task-1", kind: "goalOwned", label: "Process task-1", status: "running", updatedAt: now }],
      lineage: [{ id: "sub-1", kind: "child", sessionKey: "agent:main:child", role: "explorer", status: "started", updatedAt: now }],
      ownerRead: "known",
    });

    const respond = callHandler({ sessionKey: "agent:main:main" });
    const [ok, result] = respond.mock.calls[0];

    expect(ok).toBe(true);
    expect(result.snapshot.goals).toHaveLength(1);
    expect(result.snapshot.processes).toHaveLength(1);
    expect(result.snapshot.lineage).toHaveLength(1);
    expect(result.snapshot.ownerRead).toBe("known");
    expect(result.snapshot.tasks).toEqual([]);
    expect(result.snapshot.subagents).toEqual([]);
    expect(collectSessionActivityReadProjection).toHaveBeenCalledWith("agent:main:main", undefined);
  });

  it("forwards a failed goal-wake owner read as ownerRead: unknown", () => {
    collectSessionActivityReadProjection.mockReturnValue({
      goals: [],
      processes: [],
      lineage: [],
      ownerRead: "unknown",
    });

    const respond = callHandler({ sessionKey: "agent:main:main" });
    const [ok, result] = respond.mock.calls[0];

    expect(ok).toBe(true);
    // The empty arrays must not travel as a successful read of nothing.
    expect(result.snapshot.ownerRead).toBe("unknown");
  });

  it("keeps the existing mission/task/subagent projection shape and idle session default", () => {
    const mission = {
      missionId: "mission-1",
      sessionKey: "agent:main:main",
      objective: "mission objective",
      status: "running",
      phase: "execute",
      progress: 0.5,
      updatedAt: 20,
      blockedReason: undefined,
      lastReason: undefined,
    };
    getLatestMissionForSession.mockReturnValue(mission);
    listTaskLoopRunsForSession.mockReturnValue([{
      loopRunId: "loop-1",
      task: "loop task",
      status: "running",
      iteration: 2,
      maxIterations: 4,
      phase: "verify",
      updatedAt: 20,
    }]);
    listSubagentRunsForRequester.mockReturnValue([{
      runId: "sub-1",
      taskNodeId: "node-1",
      roleName: "explorer",
      label: "explorer",
      task: "scout",
      endedAt: undefined,
      outcome: { status: "ok" },
      startedAt: 10,
      createdAt: 9,
      orchestration: { taskNodeId: "node-1", roleName: "explorer" },
    }]);

    const chatAbortControllers = new Map([[
      "run-1",
      {
        sessionKey: "agent:main:main",
        controlUiVisible: true,
        projectSessionActive: true,
        startedAtMs: 15,
      },
    ]]);
    const respond = callHandler({ sessionKey: "agent:main:main" }, chatAbortControllers);
    const [ok, result] = respond.mock.calls[0];

    expect(ok).toBe(true);
    expect(result.snapshot.session).toMatchObject({
      sessionKey: "agent:main:main",
      runId: "run-1",
      status: "running",
      startedAt: 15,
    });
    expect(result.snapshot.tasks).toEqual([
      expect.objectContaining({ id: "mission-1", kind: "mission", status: "running", progress: 0.5 }),
      expect.objectContaining({ id: "loop-1", kind: "taskLoop", status: "running", progress: 0.5 }),
    ]);
    expect(result.snapshot.subagents).toEqual([
      expect.objectContaining({ id: "node-1", role: "explorer", status: "started" }),
    ]);
  });

  it("keeps blocked continuity fields from the existing read model", () => {
    getLatestMissionForSession.mockReturnValue({
      missionId: "mission-blocked",
      sessionKey: "agent:main:main",
      objective: "blocked mission",
      status: "blocked",
      phase: "execute",
      progress: 0.1,
      updatedAt: 30,
      blockedReason: "needs review",
      lastReason: undefined,
    });
    countLongTaskQueuedMessages.mockReturnValue(2);
    getLatestLongTaskCheckpoint.mockReturnValue({ id: "checkpoint-1" });

    const respond = callHandler({ sessionKey: "agent:main:main" });
    const [ok, result] = respond.mock.calls[0];

    expect(ok).toBe(true);
    expect(result.snapshot.continuity).toEqual({
      queueCount: 2,
      checkpoint: true,
      blockedReason: "needs review",
    });
    expect(result.snapshot.availability).toEqual({ tasks: true, subagents: true, continuity: true });
  });
});
