/**
 * DCS Stage 2 SEKB harness integration tests.
 *
 * Verifies that terminal-phase task_phase_change events trigger exactly one
 * SEKB trajectory capture, and non-terminal phases do not trigger capture.
 * The existing agent_end lifecycle remains singular and unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginHookTaskPhaseChangeEvent } from "../../plugins/hook-types.js";
import type { ContextBlockSink, ContextBlockWrite } from "../../context-engine/block.js";
import type { TrajectoryCapture } from "./trajectory-capture.js";
import {
  clearTaskStateHandlerConfig,
  runAgentHarnessTaskPhaseChangeHook,
  setTaskStateHandlerConfig,
} from "../../agents/harness/lifecycle-hook-helpers.js";

beforeEach(() => {
  clearTaskStateHandlerConfig();
});

afterEach(() => {
  clearTaskStateHandlerConfig();
});

describe("DCS Stage 2 terminal-phase SEKB trajectory capture", () => {
  it("triggers one trajectory capture on completed phase", async () => {
    const startTrajectory = vi.fn(() => "traj-completed");
    const finishTrajectory = vi.fn();
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    setTaskStateHandlerConfig({
      contextBlockSink: sink,
      trajectoryCapture: makeMockCapture({ startTrajectory, finishTrajectory }),
      objective: "Test task",
    });

    const event: PluginHookTaskPhaseChangeEvent = {
      sessionId: "agent:test:main",
      taskId: "task-1",
      fromStatus: "verifying",
      toStatus: "completed",
      lineage: {
        schema: "runtime-lineage.v1",
        sessionId: "agent:test:main",
        missionId: "mission-1",
        missionTick: 2,
        loopRunId: "task-1",
        traceId: "trace-1",
        taskLedgerRootId: "ledger-1",
      },
    };
    const result = await runAgentHarnessTaskPhaseChangeHook({
      event,
      ctx: { runId: "run-1", sessionId: "agent:test:main" },
    });

    expect(startTrajectory).toHaveBeenCalledOnce();
    expect(startTrajectory).toHaveBeenCalledWith("Test task", "agent/task", ["completed"], {
      runtimeLineage: event.lineage,
      sekbCaptureOrigin: "task_phase_terminal",
      sekbCaptureKey: "task-phase-terminal:agent:test:main:task-1:trace-1",
    });
    expect(finishTrajectory).toHaveBeenCalledOnce();
    expect(finishTrajectory).toHaveBeenCalledWith("traj-completed", "success", null);
    expect(result.trajectory).toEqual({ status: "captured", trajectoryId: "traj-completed" });
    const sinkMock = sink as unknown as {
      mock: { calls: [readonly ContextBlockWrite[]][] };
    };
    const pack = JSON.parse(sinkMock.mock.calls[0]?.[0]?.[0]?.block.full_content ?? "{}") as {
      lineage?: unknown;
    };
    expect(pack.lineage).toEqual(event.lineage);
  });

  it("triggers one trajectory capture on failed phase with error reason", async () => {
    const startTrajectory = vi.fn(() => "traj-failed");
    const finishTrajectory = vi.fn();
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    setTaskStateHandlerConfig({
      contextBlockSink: sink,
      trajectoryCapture: makeMockCapture({ startTrajectory, finishTrajectory }),
      objective: "Failing task",
    });

    const event: PluginHookTaskPhaseChangeEvent = {
      sessionId: "agent:test:main",
      taskId: "task-2",
      fromStatus: "running",
      toStatus: "failed",
    };
    await runAgentHarnessTaskPhaseChangeHook({
      event,
      ctx: { runId: "run-2", sessionId: "agent:test:main" },
    });

    expect(startTrajectory).toHaveBeenCalledOnce();
    expect(finishTrajectory).toHaveBeenCalledOnce();
    expect(finishTrajectory).toHaveBeenCalledWith("traj-failed", "failure", "Task failed");
  });

  it("does not trigger trajectory capture on non-terminal phases", async () => {
    const startTrajectory = vi.fn();
    const finishTrajectory = vi.fn();
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    setTaskStateHandlerConfig({
      contextBlockSink: sink,
      trajectoryCapture: makeMockCapture({ startTrajectory, finishTrajectory }),
    });

    const nonTerminalStatuses = [
      "created",
      "planning",
      "assembling_context",
      "running",
      "waiting_permission",
      "waiting_tool",
      "waiting_external",
      "applying_changes",
      "verifying",
      "blocked",
      "cancelled",
    ] as const;

    for (const toStatus of nonTerminalStatuses) {
      const event: PluginHookTaskPhaseChangeEvent = {
        sessionId: "agent:test:main",
        taskId: `task-${toStatus}`,
        fromStatus: "created",
        toStatus,
      };
      await runAgentHarnessTaskPhaseChangeHook({
        event,
        ctx: { runId: "run-x", sessionId: "agent:test:main" },
      });
    }

    expect(startTrajectory).not.toHaveBeenCalled();
    expect(finishTrajectory).not.toHaveBeenCalled();
  });

  it("does not trigger trajectory capture when no trajectoryCapture is configured", async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    setTaskStateHandlerConfig({
      contextBlockSink: sink,
      // No trajectoryCapture configured
    });

    const event: PluginHookTaskPhaseChangeEvent = {
      sessionId: "agent:test:main",
      taskId: "task-no-traj",
      fromStatus: "running",
      toStatus: "completed",
    };
    // Should not throw
    await expect(
      runAgentHarnessTaskPhaseChangeHook({
        event,
        ctx: { runId: "run-3", sessionId: "agent:test:main" },
      }),
    ).resolves.toMatchObject({
      taskState: { status: "accepted" },
      trajectory: { status: "skipped", reason: "no_trajectory_capture" },
    });
  });

  it("produces task_state Block write through the handler on phase transition", async () => {
    const sink: ContextBlockSink = vi.fn(async () => [{ accepted: true }]);
    setTaskStateHandlerConfig({
      contextBlockSink: sink,
      objective: "Phase write test",
      parentSessionId: "agent:test:main",
    });

    const event: PluginHookTaskPhaseChangeEvent = {
      sessionId: "agent:test:main",
      taskId: "task-write",
      fromStatus: "running",
      toStatus: "verifying",
    };
    await runAgentHarnessTaskPhaseChangeHook({
      event,
      ctx: { runId: "run-4", sessionId: "agent:test:main" },
    });

    expect(sink).toHaveBeenCalledOnce();
    const sinkMock = sink as unknown as {
      mock: { calls: [readonly ContextBlockWrite[]][] };
    };
    const writes = sinkMock.mock.calls[0]?.[0] ?? [];
    expect(writes).toHaveLength(1);
    expect(writes[0]?.block.block_type).toBe("task_state");
    expect(writes[0]?.block.source_system).toBe("task-loop");
    expect(writes[0]?.block.mutability).toBe("system_managed");
  });

  it("waits for a delayed task_state write and exposes rejection evidence", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sink: ContextBlockSink = vi.fn(async () => {
      await gate;
      return [{ accepted: false, reason: "store unavailable" }];
    });
    setTaskStateHandlerConfig({
      contextBlockSink: sink,
      objective: "Durability test",
    });

    const pending = runAgentHarnessTaskPhaseChangeHook({
      event: {
        sessionId: "agent:test:durability",
        taskId: "task-durability",
        fromStatus: "running",
        toStatus: "completed",
      },
      ctx: { runId: "run-durability", sessionId: "agent:test:durability" },
    });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await expect(pending).resolves.toMatchObject({
      taskState: { status: "rejected", reason: "store unavailable" },
      trajectory: { status: "skipped" },
    });
  });

  it("keeps legacy phase captures compatible when lineage is absent", async () => {
    const startTrajectory = vi.fn(() => "traj-legacy");
    const finishTrajectory = vi.fn();
    setTaskStateHandlerConfig({
      trajectoryCapture: makeMockCapture({ startTrajectory, finishTrajectory }),
      objective: "Legacy task",
    });
    const result = await runAgentHarnessTaskPhaseChangeHook({
      event: {
        sessionId: "agent:test:legacy",
        taskId: "task-legacy",
        fromStatus: "running",
        toStatus: "completed",
      },
      ctx: { runId: "run-legacy", sessionId: "agent:test:legacy" },
    });
    expect(startTrajectory).toHaveBeenCalledWith("Legacy task", "agent/task", ["completed"]);
    expect(result.trajectory.trajectoryId).toBe("traj-legacy");
  });
});

function makeMockCapture(overrides: {
  startTrajectory: ReturnType<typeof vi.fn>;
  finishTrajectory: ReturnType<typeof vi.fn>;
}): TrajectoryCapture {
  return {
    start_trajectory: overrides.startTrajectory,
    log_step: vi.fn(),
    finish_trajectory: overrides.finishTrajectory,
    extract_error_signature: vi.fn(() => "sig"),
    get_trajectory: vi.fn(),
    list_trajectories: vi.fn(() => []),
  } as unknown as TrajectoryCapture;
}
