/**
 * TF-0082 generation-pin tests for subagent completion delivery.
 *
 * A completion spawned against requester generation N must never steer a
 * requester session that has since been reset/forked to generation M != N.
 * Legacy records without the pin keep the previous liveness-only behavior.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverSubagentAnnouncement,
  testing as deliveryTesting,
} from "./subagent-announce-delivery.js";

const mocks = vi.hoisted(() => ({
  dispatchGatewayMethodInProcess: vi.fn(),
  getRuntimeConfig: vi.fn(),
  queueEmbeddedAgentMessageWithOutcome: vi.fn(),
  sendMessage: vi.fn(),
  currentActivity: { sessionId: undefined as string | undefined, isActive: false },
}));

vi.mock("./subagent-announce-delivery.runtime.js", () => ({
  getRuntimeConfig: mocks.getRuntimeConfig,
  loadSessionStore: () => ({}),
  resolveAgentIdFromSessionKey: () => "main",
  resolveStorePath: () => "sessions.json",
  callGateway: vi.fn(),
  dispatchGatewayMethodInProcess: mocks.dispatchGatewayMethodInProcess,
  resolveQueueSettings: () => ({ mode: "followup" }),
  resolveExternalBestEffortDeliveryTarget: () => ({
    deliver: false,
    channel: undefined,
    to: undefined,
  }),
  sendMessage: mocks.sendMessage,
  createBoundDeliveryRouter: () => ({ resolveDestination: () => ({ mode: "none" }) }),
  resolveConversationIdFromTargets: () => "",
  getGlobalHookRunner: () => ({ hasHooks: () => false }),
  formatEmbeddedAgentQueueFailureSummary: () => undefined,
  isEmbeddedAgentRunActive: () => false,
  isEmbeddedRunAbandoned: () => false,
  queueEmbeddedAgentMessageWithOutcomeAsync: mocks.queueEmbeddedAgentMessageWithOutcome,
  resolveActiveEmbeddedRunSessionId: () => undefined,
}));

function buildParams(overrides?: { expectedRequesterSessionId?: string }) {
  return {
    requesterSessionKey: "agent:main:main",
    targetRequesterSessionKey: "agent:main:main",
    announceId: "announce-gen-pin",
    triggerMessage: "Child completion",
    steerMessage: "Child completion",
    internalEvents: undefined,
    requesterSessionOrigin: undefined,
    requesterOrigin: undefined,
    completionDirectOrigin: undefined,
    directOrigin: undefined,
    sourceSessionKey: "agent:main:subagent:child",
    sourceChannel: "internal",
    sourceTool: "subagent_announce",
    requesterIsSubagent: true,
    expectsCompletionMessage: true,
    directIdempotencyKey: "direct-key-gen-pin",
    expectedRequesterSessionId: overrides?.expectedRequesterSessionId,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRuntimeConfig.mockReturnValue({});
  mocks.dispatchGatewayMethodInProcess.mockResolvedValue({ result: {} });
  mocks.queueEmbeddedAgentMessageWithOutcome.mockReturnValue({
    queued: true,
    deliveredAtMs: Date.now(),
  });
  deliveryTesting.setDepsForTest({
    getRuntimeConfig: mocks.getRuntimeConfig,
    getRequesterSessionActivity: () => ({
      sessionId: mocks.currentActivity.sessionId,
      isActive: mocks.currentActivity.isActive,
    }),
    isRequesterSessionAbandoned: () => false,
    queueEmbeddedAgentMessageWithOutcome: mocks.queueEmbeddedAgentMessageWithOutcome,
    sendMessage: mocks.sendMessage,
    dispatchGatewayMethodInProcess: mocks.dispatchGatewayMethodInProcess,
  });
});

describe("subagent announce generation pin", () => {
  it("never steers a post-reset generation with a completion pinned to the old generation", async () => {
    mocks.currentActivity.sessionId = "session-generation-2";
    mocks.currentActivity.isActive = true;

    const result = await deliverSubagentAnnouncement(
      buildParams({ expectedRequesterSessionId: "session-generation-1" }),
    );

    expect(mocks.queueEmbeddedAgentMessageWithOutcome).not.toHaveBeenCalled();
    expect(mocks.dispatchGatewayMethodInProcess).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ delivered: false, terminal: true, reason: "requester_generation_stale" });
  });

  it("steers when the pinned generation matches the current session", async () => {
    mocks.currentActivity.sessionId = "session-generation-1";
    mocks.currentActivity.isActive = true;

    const result = await deliverSubagentAnnouncement(
      buildParams({ expectedRequesterSessionId: "session-generation-1" }),
    );

    expect(mocks.queueEmbeddedAgentMessageWithOutcome).toHaveBeenCalledWith(
      "session-generation-1",
      "Child completion",
      expect.anything(),
    );
    expect(result.path).toBe("steered");
    expect(result.delivered).toBe(true);
  });

  it("keeps legacy liveness-only behavior for records without a pin", async () => {
    mocks.currentActivity.sessionId = "session-generation-2";
    mocks.currentActivity.isActive = true;

    const result = await deliverSubagentAnnouncement(buildParams());

    expect(mocks.queueEmbeddedAgentMessageWithOutcome).toHaveBeenCalledWith(
      "session-generation-2",
      "Child completion",
      expect.anything(),
    );
    expect(result.path).toBe("steered");
  });

  it("does not steer when no current session generation is resolvable", async () => {
    mocks.currentActivity.sessionId = undefined;
    mocks.currentActivity.isActive = false;

    const result = await deliverSubagentAnnouncement(
      buildParams({ expectedRequesterSessionId: "session-generation-1" }),
    );

    expect(mocks.queueEmbeddedAgentMessageWithOutcome).not.toHaveBeenCalled();
    expect(mocks.dispatchGatewayMethodInProcess).not.toHaveBeenCalled();
    expect(result).toMatchObject({ delivered: false, terminal: true, reason: "requester_generation_stale" });
  });

  it("passes the generation to the Gateway when waking an idle requester", async () => {
    mocks.currentActivity.sessionId = "session-generation-1";
    mocks.currentActivity.isActive = false;
    await deliverSubagentAnnouncement(buildParams({ expectedRequesterSessionId: "session-generation-1" }));
    expect(mocks.dispatchGatewayMethodInProcess).toHaveBeenCalledWith("agent", expect.objectContaining({
        sessionKey: "agent:main:main", sessionId: "session-generation-1", expectedSessionId: "session-generation-1",
    }), expect.anything());
  });

  it("stops fallback and retries when Gateway observes a reset during delivery", async () => {
    mocks.currentActivity.sessionId = "session-generation-1";
    mocks.currentActivity.isActive = false;
    mocks.dispatchGatewayMethodInProcess.mockRejectedValue(new Error("AGENT_SESSION_GENERATION_STALE: reset raced delivery"));
    const result = await deliverSubagentAnnouncement(buildParams({ expectedRequesterSessionId: "session-generation-1" }));
    expect(result).toMatchObject({ delivered: false, terminal: true, reason: "requester_generation_stale" });
    expect(mocks.dispatchGatewayMethodInProcess).toHaveBeenCalledTimes(1);
    expect(mocks.queueEmbeddedAgentMessageWithOutcome).not.toHaveBeenCalled();
  });
});
