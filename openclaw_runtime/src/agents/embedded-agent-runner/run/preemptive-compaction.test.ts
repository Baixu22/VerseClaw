import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../../runtime/index.js";
import { shouldPreemptivelyCompactBeforePrompt } from "./preemptive-compaction.js";

describe("shouldPreemptivelyCompactBeforePrompt", () => {
  it("does not compact an empty session when bootstrap pressure consumes the budget", () => {
    const result = shouldPreemptivelyCompactBeforePrompt({
      messages: [],
      systemPrompt: "bootstrap context ".repeat(2_000),
      prompt: "first user message",
      contextTokenBudget: 16_000,
      reserveTokens: 16_384,
    });

    expect(result.route).toBe("fits");
    expect(result.shouldCompact).toBe(false);
    expect(result.overflowTokens).toBeGreaterThan(0);
  });

  it("still compacts a non-empty conversation under the same pressure", () => {
    const messages = [
      {
        role: "user",
        content: "existing conversation",
      },
    ] as AgentMessage[];

    const result = shouldPreemptivelyCompactBeforePrompt({
      messages,
      prompt: "next message",
      contextTokenBudget: 16_000,
      reserveTokens: 16_384,
      llmBoundaryTokenPressure: {
        estimatedPromptTokens: 9_000,
        source: "test",
      },
    });

    expect(result.route).toBe("compact_only");
    expect(result.shouldCompact).toBe(true);
    expect(result.overflowTokens).toBeGreaterThan(0);
  });
});
