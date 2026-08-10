// Test helpers for inbound Slack message preparation. `createInboundSlackTestContext`
// builds a minimal monitor context; tests override the fields they exercise.
import type { SlackMonitorContext } from "../context.js";

export function createInboundSlackTestContext(
  overrides: Partial<SlackMonitorContext> = {},
): SlackMonitorContext {
  const skeleton: SlackMonitorContext = {
    cfg: {} as SlackMonitorContext["cfg"],
    accountId: "slack-test-account",
    botToken: "xoxb-test-token",
    app: undefined as unknown as SlackMonitorContext["app"],
    runtime: {} as SlackMonitorContext["runtime"],
    botUserId: "U00000000",
    teamId: "T00000000",
    apiAppId: "A00000000",
    historyLimit: 100,
    dmHistoryLimit: 100,
    channelHistories: new Map(),
    sessionScope: "main" as SlackMonitorContext["sessionScope"],
    mainKey: "agent:alpha:main",
    dmEnabled: true,
    dmPolicy: "open" as SlackMonitorContext["dmPolicy"],
    allowFrom: [],
    allowNameMatching: false,
  } as unknown as SlackMonitorContext;
  return { ...skeleton, ...overrides } as SlackMonitorContext;
}
