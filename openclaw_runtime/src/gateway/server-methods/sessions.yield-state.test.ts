/**
 * TF-0082 owner path 6: `sessions.yieldState` read-only surface.
 *
 * Arming stays tool-only; this RPC only reports the state that yield and
 * goal_wait already produced. It fails closed on a generation mismatch, never
 * mutates, and degrades to an empty state when a read model is unavailable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

const yieldMocks = vi.hoisted(() => ({
  resolveRequestedGlobalAgentId: vi.fn(),
  loadSessionEntry: vi.fn(),
  getLatestSubagentRunByChildSessionKey: vi.fn(),
  listSubagentRunsForRequester: vi.fn(),
  readArmedGoalWaitForSession: vi.fn(),
}));

vi.mock("./sessions.shared.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./sessions.shared.js")>();
  return {
    ...original,
    resolveRequestedGlobalAgentId: yieldMocks.resolveRequestedGlobalAgentId,
  };
});

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    loadSessionEntry: yieldMocks.loadSessionEntry,
  };
});

vi.mock("../../agents/subagent-registry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../agents/subagent-registry.js")>();
  return {
    ...original,
    getLatestSubagentRunByChildSessionKey: yieldMocks.getLatestSubagentRunByChildSessionKey,
    listSubagentRunsForRequester: yieldMocks.listSubagentRunsForRequester,
  };
});

vi.mock("../../agents/goal-wake-read.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../agents/goal-wake-read.js")>();
  return {
    ...original,
    readArmedGoalWaitForSession: yieldMocks.readArmedGoalWaitForSession,
  };
});

import { sessionsRunControlHandlers } from "./sessions.run-control.js";

const CANONICAL_KEY = "agent:agent-a:main";

function makeRespond() {
  const calls: Array<{ ok: boolean; payload: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

const context = {
  getRuntimeConfig: () => ({}) as OpenClawConfig,
} as never;

async function invoke(params: Record<string, unknown>) {
  const { calls, respond } = makeRespond();
  await sessionsRunControlHandlers["sessions.yieldState"]!({
    params,
    respond,
    context,
  } as never);
  return calls;
}

describe("sessions.yieldState", () => {
  beforeEach(() => {
    for (const mock of Object.values(yieldMocks)) {
      mock.mockReset();
    }
    yieldMocks.resolveRequestedGlobalAgentId.mockReturnValue({ ok: true, agentId: "agent-a" });
    yieldMocks.loadSessionEntry.mockReturnValue({
      entry: { sessionId: "session-generation-2" },
      canonicalKey: CANONICAL_KEY,
    });
    yieldMocks.getLatestSubagentRunByChildSessionKey.mockReturnValue(null);
    yieldMocks.listSubagentRunsForRequester.mockReturnValue([]);
    yieldMocks.readArmedGoalWaitForSession.mockReturnValue(undefined);
  });

  it("reports a paused parent with its generation pin and pending children", async () => {
    yieldMocks.getLatestSubagentRunByChildSessionKey.mockReturnValue({
      runId: "run-yielded",
      childSessionKey: CANONICAL_KEY,
      requesterSessionKey: "agent:agent-a:parent",
      requesterSessionId: "session-generation-1",
      pauseReason: "sessions_yield",
      wakeOnDescendantSettle: true,
      endedAt: 1_700_000_000_123,
    });
    yieldMocks.listSubagentRunsForRequester.mockReturnValue([
      { runId: "child-running" },
      { runId: "child-paused", endedAt: 1, pauseReason: "sessions_yield" },
      { runId: "child-done", endedAt: 2, outcome: { status: "ok" } },
    ]);

    const calls = await invoke({ key: CANONICAL_KEY });

    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      key: CANONICAL_KEY,
      sessionId: "session-generation-2",
      yield: {
        paused: true,
        runId: "run-yielded",
        parentSessionKey: "agent:agent-a:parent",
        parentSessionId: "session-generation-1",
        wakeOnDescendantSettle: true,
        // The running child and the paused child still owe a continuation;
        // the completed one does not.
        pendingChildren: 2,
        updatedAt: 1_700_000_000_123,
      },
      goalWait: { armed: false },
    });
  });

  it("reports an armed goal wait with its flow, mission, and durable owner epoch", async () => {
    yieldMocks.readArmedGoalWaitForSession.mockReturnValue({
      flowId: "flow-1",
      status: "waiting",
      updatedAt: 1_700_000_000_500,
      taskId: "task-1",
      missionId: "mission-1",
      turnBarrier: "acked",
      runId: "durable-run-1",
      ownerEpoch: "epoch-1",
      timeoutMs: 60_000,
    });

    const calls = await invoke({ key: CANONICAL_KEY });

    expect(calls[0]?.payload).toMatchObject({
      yield: { paused: false, wakeOnDescendantSettle: false, pendingChildren: 0 },
      goalWait: {
        armed: true,
        flowId: "flow-1",
        status: "waiting",
        taskId: "task-1",
        missionId: "mission-1",
        turnBarrier: "acked",
        runId: "durable-run-1",
        ownerEpoch: "epoch-1",
        timeoutMs: 60_000,
      },
    });
  });

  it("fails closed on a generation mismatch without reading any owner", async () => {
    const calls = await invoke({
      key: CANONICAL_KEY,
      expectedSessionId: "session-generation-1",
    });

    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      reason: "generation-mismatch",
      yield: { paused: false, wakeOnDescendantSettle: false, pendingChildren: 0 },
      goalWait: { armed: false },
    });
    expect(yieldMocks.getLatestSubagentRunByChildSessionKey).not.toHaveBeenCalled();
    expect(yieldMocks.listSubagentRunsForRequester).not.toHaveBeenCalled();
    expect(yieldMocks.readArmedGoalWaitForSession).not.toHaveBeenCalled();
  });

  it("reads normally when the pin matches the current generation", async () => {
    const calls = await invoke({
      key: CANONICAL_KEY,
      expectedSessionId: "session-generation-2",
    });

    expect(calls[0]?.payload).not.toMatchObject({ reason: "generation-mismatch" });
    expect(yieldMocks.readArmedGoalWaitForSession).toHaveBeenCalledWith(CANONICAL_KEY);
  });

  it("degrades to an empty state when a read model throws", async () => {
    yieldMocks.getLatestSubagentRunByChildSessionKey.mockImplementation(() => {
      throw new Error("registry unavailable");
    });
    yieldMocks.readArmedGoalWaitForSession.mockImplementation(() => {
      throw new Error("state db unavailable");
    });

    const calls = await invoke({ key: CANONICAL_KEY });

    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      yield: { paused: false, wakeOnDescendantSettle: false, pendingChildren: 0 },
      goalWait: { armed: false },
    });
  });

  it("rejects params that do not validate", async () => {
    const calls = await invoke({});
    expect(calls[0]?.ok).toBe(false);
    expect(yieldMocks.loadSessionEntry).not.toHaveBeenCalled();
  });

  it("reports a null sessionId for a session with no store row", async () => {
    yieldMocks.loadSessionEntry.mockReturnValue({
      entry: undefined,
      canonicalKey: CANONICAL_KEY,
    });

    const calls = await invoke({ key: CANONICAL_KEY });

    expect(calls[0]?.payload).toMatchObject({ ok: true, sessionId: null });
  });
});
