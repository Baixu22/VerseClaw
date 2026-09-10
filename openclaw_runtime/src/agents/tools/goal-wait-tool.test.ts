import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  armGoalWaitProcess: vi.fn(),
  getGoalWaitTask: vi.fn(),
}));

vi.mock("../goal-wake-controller.js", () => ({
  goalWakeController: {
    armGoalWaitProcess: mocks.armGoalWaitProcess,
    getGoalWaitTask: mocks.getGoalWaitTask,
  },
}));

vi.mock("../../sessions/session-admission-registry.js", () => ({
  acquireSessionAdmissionPermit: () => () => {},
}));

import { createGoalWaitTool } from "./goal-wait-tool.js";

beforeEach(() => {
  mocks.armGoalWaitProcess.mockReset();
  mocks.getGoalWaitTask.mockReset();
});

describe("goal_wait tool (Phase 3)", () => {
  it("binds mission/session/tick from context and never accepts a model missionId", async () => {
    const onYield = vi.fn(async () => {});
    const tool = createGoalWaitTool({
      agentSessionKey: "agent:main:main",
      sessionId: "session-1",
      agentId: "main",
      context: {
        missionId: "mission-bound",
        sessionKey: "agent:main:main",
        agentId: "main",
        tickId: "tick-bound",
        expectedRevision: 2,
      },
      onYield,
    });
    mocks.getGoalWaitTask.mockReturnValue({
      task_id: "task-process-1",
      runtime: "process",
      owner_key: "agent:main:main",
      parent_flow_id: null,
      status: "queued",
    });
    mocks.armGoalWaitProcess.mockResolvedValue({
      ok: true,
      taskId: "task-process-1",
      flowId: "flow-1",
      missionRevision: 3,
      flowRevision: 0,
      turnBarrier: "pending",
      taskStatus: "queued",
      flowStatus: "waiting",
      terminalLevelCheck: "queued",
    });

    const result = await tool.execute(
      "call-1",
      { waitFor: [{ kind: "process", taskId: "task-process-1" }], timeoutMs: 500 },
    );

    expect(mocks.armGoalWaitProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: "mission-bound",
        sessionKey: "agent:main:main",
        agentId: "main",
        expectedRevision: 2,
        activeTickId: "tick-bound",
        taskId: "task-process-1",
        timeoutMs: 500,
      }),
      undefined,
    );
    expect(onYield).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).toContain("task-process-1");
  });

  it("rejects non-process dependencies and tasks from another session", async () => {
    const tool = createGoalWaitTool({
      agentSessionKey: "agent:main:main",
      sessionId: "session-1",
      context: {
        missionId: "mission-bound",
        sessionKey: "agent:main:main",
        expectedRevision: 1,
      },
      onYield: async () => {},
    });
    await expect(
      tool.execute("call-1", { waitFor: [{ kind: "timer", taskId: "x" }] }),
    ).rejects.toThrow(/only supports waitFor\[0\].kind="process"/);

    mocks.getGoalWaitTask.mockReturnValue({
      task_id: "task-other",
      runtime: "process",
      owner_key: "agent:other:main",
      status: "queued",
    });
    await expect(
      tool.execute("call-1", { taskId: "task-other" }),
    ).rejects.toThrow(/belongs to another session/);
  });

  it("returns a clear error without session context or yield support", async () => {
    const noSession = createGoalWaitTool();
    const result = await noSession.execute("call-1", { taskId: "task-1" });
    expect(JSON.stringify(result)).toContain("No session context");

    const noYield = createGoalWaitTool({ sessionId: "session-1" });
    const result2 = await noYield.execute("call-1", { taskId: "task-1" });
    expect(JSON.stringify(result2)).toContain("Yield not supported");
  });
});
