/**
 * DCS W1: TaskLoop production producer for task_phase_change.
 *
 * Focused unit surface for emitTaskLoopTaskPhaseChange behavior via the
 * exported test helper. Removing the production emit() call would leave
 * this helper unused / unasserted by package.json gate path; the helper
 * re-exports the same function used by emit().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTaskStatus } from "../runtime-core/types.js";

type PhaseHookParams = {
  event: {
    sessionId: string;
    taskId: string;
    fromStatus: RuntimeTaskStatus;
    toStatus: RuntimeTaskStatus;
  };
  ctx: { sessionId: string; runId: string };
};

const phaseHookMock = vi.fn(async (_params: PhaseHookParams) => undefined);

vi.mock("./harness/lifecycle-hook-helpers.js", () => ({
  runAgentHarnessTaskPhaseChangeHook: (params: PhaseHookParams) => phaseHookMock(params),
}));

// Import after mock so the controller binds the mocked hook.
const {
  __testOnly_emitTaskLoopTaskPhaseChange,
  __testOnly_clearTaskLoopPhaseStatus,
} = await import("./task-loop-controller.js");

beforeEach(() => {
  phaseHookMock.mockClear();
  phaseHookMock.mockResolvedValue(undefined);
  __testOnly_clearTaskLoopPhaseStatus();
});

afterEach(() => {
  phaseHookMock.mockReset();
  __testOnly_clearTaskLoopPhaseStatus();
});

function makeRecord(overrides?: Partial<{ loopRunId: string; sessionKey: string; phase: string; status: string }>) {
  return {
    loopRunId: overrides?.loopRunId ?? "loop_1",
    sessionKey: overrides?.sessionKey ?? "agent:alpha:main",
    phase: overrides?.phase ?? "intake",
    status: overrides?.status ?? "running",
  };
}

function makeEvent(record: ReturnType<typeof makeRecord>, phase: string, status: string) {
  return {
    loopRunId: record.loopRunId,
    sessionKey: record.sessionKey,
    phase,
    status,
    iteration: 1,
    progress: 10,
    ts: Date.now(),
  };
}

describe("DCS W1 TaskLoop task_phase_change producer", () => {
  it("calls runAgentHarnessTaskPhaseChangeHook once per true runtime status transition", async () => {
    const record = makeRecord();

    __testOnly_emitTaskLoopTaskPhaseChange(record as never, makeEvent(record, "intake", "running") as never);
    __testOnly_emitTaskLoopTaskPhaseChange(record as never, makeEvent(record, "plan", "running") as never);
    __testOnly_emitTaskLoopTaskPhaseChange(record as never, makeEvent(record, "execute", "running") as never);
    // Duplicate same runtime status (execute/running => running) must not re-fire.
    __testOnly_emitTaskLoopTaskPhaseChange(record as never, makeEvent(record, "execute", "running") as never);
    __testOnly_emitTaskLoopTaskPhaseChange(record as never, makeEvent(record, "complete", "complete") as never);

    // Allow microtasks for void promise dispatch.
    await Promise.resolve();
    await Promise.resolve();

    expect(phaseHookMock).toHaveBeenCalled();
    const transitions = phaseHookMock.mock.calls.map((call) => call[0] as PhaseHookParams);

    for (const params of transitions) {
      expect(params.event.sessionId).toBe("agent:alpha:main");
      expect(params.event.taskId).toBe("loop_1");
      expect(params.ctx.sessionId).toBe("agent:alpha:main");
      expect(params.ctx.runId).toBe("loop_1");
      expect(params.event.fromStatus).not.toBe(params.event.toStatus);
    }

    // intake/running => created seeds without synthetic fire when created.
    // plan => planning, execute => running, complete => completed.
    const pairs = transitions.map((t) => `${t.event.fromStatus}->${t.event.toStatus}`);
    expect(pairs).toEqual([
      "created->planning",
      "planning->running",
      "running->completed",
    ]);
  });

  it("does not throw when the phase hook rejects", async () => {
    phaseHookMock.mockRejectedValueOnce(new Error("hook boom"));
    const record = makeRecord();
    expect(() => {
      __testOnly_emitTaskLoopTaskPhaseChange(
        record as never,
        makeEvent(record, "plan", "running") as never,
      );
    }).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(phaseHookMock).toHaveBeenCalled();
  });
});
