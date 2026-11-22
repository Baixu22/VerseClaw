// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ summary: vi.fn() }));
vi.mock("../../electron/utils/token-usage", () => ({
  getSessionTokenUsageSummary: mock.summary,
  getRecentTokenUsageHistory: vi.fn(),
  getUsageAggregateSummary: vi.fn(),
}));
vi.mock("../../electron/utils/context-window", () => ({ resolveContextWindow: vi.fn() }));
vi.mock("../../electron/utils/prompt-cache-status", () => ({ assessPromptCacheStatus: vi.fn() }));
vi.mock("../../electron/utils/store", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
import { createUsageApi } from "../../electron/services/usage-api";

describe("live usage scope", () => {
  it("labels session totals and never advertises the requested run as their attribution", async () => {
    mock.summary.mockResolvedValue({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
      estimatedCostUsd: 0.4,
      usageStatus: "available",
    });
    const read = await createUsageApi().live({ sessionKey: "session-a", runId: "only-one-turn" });
    expect(read.usage).toMatchObject({
      scope: "session",
      sessionKey: "session-a",
      runId: null,
      requestedRunId: "only-one-turn",
      totalTokens: 150,
    });
    expect(mock.summary).toHaveBeenCalledWith("session-a");
  });
});
