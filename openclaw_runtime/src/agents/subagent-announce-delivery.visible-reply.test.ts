import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deliverSubagentAnnouncement,
  testing as deliveryTesting,
} from "./subagent-announce-delivery.js";
import type { AgentInternalEvent } from "./internal-events.js";

const mocks = vi.hoisted(() => ({
  dispatchGatewayMethodInProcess: vi.fn(),
  getRuntimeConfig: vi.fn(),
  queueEmbeddedAgentMessageWithOutcome: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("./subagent-announce-delivery.runtime.js", () => ({
  getRuntimeConfig: mocks.getRuntimeConfig,
  loadSessionStore: () => ({}),
  resolveAgentIdFromSessionKey: () => "main",
  resolveStorePath: () => "sessions.json",
  callGateway: vi.fn(),
  dispatchGatewayMethodInProcess: mocks.dispatchGatewayMethodInProcess,
  resolveQueueSettings: () => ({ mode: "followup" }),
  resolveExternalBestEffortDeliveryTarget: (params: {
    channel?: string;
    to?: string;
    accountId?: string;
    threadId?: string;
  }) => ({
    deliver: Boolean(params.channel && params.to),
    channel: params.channel,
    to: params.to,
    accountId: params.accountId,
    threadId: params.threadId,
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

const subagentCompletionEvent: AgentInternalEvent = {
  type: "task_completion",
  source: "subagent",
  childSessionKey: "agent:main:subagent:child",
  childSessionId: "child-session-id",
  announceType: "subagent task",
  taskLabel: "Reviewer",
  status: "ok",
  statusLabel: "completed; ready for parent review",
  result: "(no output)",
  replyInstruction: "Reply to the user with the child result.",
};

function buildParams(overrides?: {
  internalEvents?: AgentInternalEvent[];
  requesterIsSubagent?: boolean;
  expectsCompletionMessage?: boolean;
  sourceTool?: string;
}) {
  return {
    requesterSessionKey: "agent:main:main",
    targetRequesterSessionKey: "agent:main:main",
    announceId: "announce-1",
    triggerMessage: "Child completion",
    steerMessage: "Child completion",
    internalEvents: overrides?.internalEvents ?? [subagentCompletionEvent],
    requesterSessionOrigin: undefined,
    requesterOrigin: undefined,
    completionDirectOrigin: undefined,
    directOrigin: undefined,
    sourceSessionKey: "agent:main:subagent:child",
    sourceChannel: "internal",
    sourceTool: overrides?.sourceTool ?? "subagent_announce",
    requesterIsSubagent: overrides?.requesterIsSubagent ?? true,
    expectsCompletionMessage: overrides?.expectsCompletionMessage ?? true,
    directIdempotencyKey: "direct-key-1",
  };
}

describe("subagent completion delivery with tool-only announce turns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeConfig.mockReturnValue({});
    mocks.queueEmbeddedAgentMessageWithOutcome.mockReturnValue({
      queued: false,
      reason: "no_active_run",
    });
    deliveryTesting.setDepsForTest({
      getRuntimeConfig: mocks.getRuntimeConfig,
      getRequesterSessionActivity: () => ({ isActive: false }),
      isRequesterSessionAbandoned: () => false,
      queueEmbeddedAgentMessageWithOutcome: mocks.queueEmbeddedAgentMessageWithOutcome,
      sendMessage: mocks.sendMessage,
      dispatchGatewayMethodInProcess: mocks.dispatchGatewayMethodInProcess,
    });
  });

  it("treats a tool-only announce turn as delivered when the completion internal event was injected (issue #29)", async () => {
    // The requester announce run finishes without visible output.
    mocks.dispatchGatewayMethodInProcess.mockResolvedValue({ result: {} });

    const result = await deliverSubagentAnnouncement(buildParams());

    expect(result.delivered).toBe(true);
    expect(result.path).toBe("direct");
    expect(mocks.dispatchGatewayMethodInProcess).toHaveBeenCalledTimes(1);
  });

  it("still fails with visible_reply_missing when no completion internal event was injected", async () => {
    mocks.dispatchGatewayMethodInProcess.mockResolvedValue({ result: {} });

    const result = await deliverSubagentAnnouncement(buildParams({ internalEvents: [] }));

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("visible_reply_missing");
  });

  it("still fails with visible_reply_missing when the injected completion event is not subagent-scoped", async () => {
    mocks.dispatchGatewayMethodInProcess.mockResolvedValue({ result: {} });

    const result = await deliverSubagentAnnouncement(
      buildParams({
        internalEvents: [{ ...subagentCompletionEvent, source: "cron" }],
      }),
    );

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("visible_reply_missing");
  });

  it("keeps reporting a missing visible reply for non-subagent announce sources", async () => {
    mocks.dispatchGatewayMethodInProcess.mockResolvedValue({ result: {} });

    // A source that is not subagent_announce (e.g. a cron or image job) must
    // not be treated as an internal subagent handoff.
    const result = await deliverSubagentAnnouncement(
      buildParams({ sourceTool: "image_generate" }),
    );

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("visible_reply_missing");
  });
});
