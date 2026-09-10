/**
 * TF-0082 generation guard tests for `sessions.queueDrain`.
 *
 * A drain pinned to a previous session generation must fail closed: nothing
 * is dequeued and no run is seeded; queued messages survive untouched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";

const drainMocks = vi.hoisted(() => ({
  resolveRequestedGlobalAgentId: vi.fn(),
  loadSessionEntry: vi.fn(),
  hasTrackedActiveSessionRun: vi.fn(),
  countLongTaskQueuedMessages: vi.fn(),
  installQueueDrainCallback: vi.fn(),
  drainQueuedUserMessagesForSession: vi.fn(),
}));

vi.mock("./sessions.shared.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./sessions.shared.js")>();
  return {
    ...original,
    resolveRequestedGlobalAgentId: drainMocks.resolveRequestedGlobalAgentId,
  };
});

vi.mock("../session-utils.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../session-utils.js")>();
  return {
    ...original,
    loadSessionEntry: drainMocks.loadSessionEntry,
  };
});

vi.mock("./session-active-runs.js", () => ({
  hasTrackedActiveSessionRun: drainMocks.hasTrackedActiveSessionRun,
}));

vi.mock("../../agents/long-task-control/store.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../agents/long-task-control/store.js")>();
  return {
    ...original,
    countLongTaskQueuedMessages: drainMocks.countLongTaskQueuedMessages,
  };
});

vi.mock("./chat.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./chat.js")>();
  return {
    ...original,
    installQueueDrainCallback: drainMocks.installQueueDrainCallback,
    drainQueuedUserMessagesForSession: drainMocks.drainQueuedUserMessagesForSession,
  };
});

import { sessionsRunControlHandlers } from "./sessions.run-control.js";

function makeRespond() {
  const calls: Array<{ ok: boolean; payload?: unknown; error?: unknown }> = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    calls.push({ ok, payload, error });
  };
  return { calls, respond };
}

const context = {
  getRuntimeConfig: () => ({} as OpenClawConfig),
} as never;

describe("sessions.queueDrain generation guard", () => {
  beforeEach(() => {
    for (const mock of Object.values(drainMocks)) {
      mock.mockReset();
    }
    drainMocks.resolveRequestedGlobalAgentId.mockReturnValue({
      ok: true,
      agentId: "agent-a",
    });
    drainMocks.loadSessionEntry.mockReturnValue({
      entry: { sessionId: "session-generation-2" },
      canonicalKey: "agent:agent-a:main",
    });
    drainMocks.hasTrackedActiveSessionRun.mockReturnValue(false);
    drainMocks.countLongTaskQueuedMessages.mockReturnValue(3);
    drainMocks.drainQueuedUserMessagesForSession.mockResolvedValue({
      drained: true,
      messageCount: 3,
      queueCount: 0,
    });
  });

  it("refuses to drain when expectedSessionId pins an older generation", async () => {
    const { calls, respond } = makeRespond();
    await sessionsRunControlHandlers["sessions.queueDrain"]!({
      params: {
        key: "agent:agent-a:main",
        expectedSessionId: "session-generation-1",
      },
      respond,
      context,
    } as never);

    expect(calls[0]?.ok).toBe(true);
    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      key: "agent:agent-a:main",
      drained: false,
      queueCount: 3,
      reason: "generation-mismatch",
    });
    // Fail-closed: the drain executor and queue wiring were never reached.
    expect(drainMocks.drainQueuedUserMessagesForSession).not.toHaveBeenCalled();
    expect(drainMocks.installQueueDrainCallback).not.toHaveBeenCalled();
  });

  it("drains normally when the pin matches the current generation", async () => {
    const { calls, respond } = makeRespond();
    await sessionsRunControlHandlers["sessions.queueDrain"]!({
      params: {
        key: "agent:agent-a:main",
        expectedSessionId: "session-generation-2",
      },
      respond,
      context,
    } as never);

    expect(calls[0]?.payload).toMatchObject({
      ok: true,
      drained: true,
      messageCount: 3,
    });
    expect(drainMocks.drainQueuedUserMessagesForSession).toHaveBeenCalledWith(
      context,
      "agent:agent-a:main",
      { expectedSessionId: "session-generation-2" },
    );
  });

  it("keeps legacy behavior without an expectedSessionId pin", async () => {
    const { calls, respond } = makeRespond();
    await sessionsRunControlHandlers["sessions.queueDrain"]!({
      params: { key: "agent:agent-a:main" },
      respond,
      context,
    } as never);

    expect(calls[0]?.payload).toMatchObject({ ok: true, drained: true });
    expect(drainMocks.drainQueuedUserMessagesForSession).toHaveBeenCalledWith(
      context,
      "agent:agent-a:main",
      { expectedSessionId: undefined },
    );
  });
});
