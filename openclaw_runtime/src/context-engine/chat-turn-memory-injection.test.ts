import { describe, expect, it, vi } from "vitest";
import { computeMemoryExtraSystemPrompt } from "./chat-turn-memory-injection.js";

describe("computeMemoryExtraSystemPrompt", () => {
  it("preserves the prompt without constructing providers when the session key is unresolved", async () => {
    const providerFactory = vi.fn(() => []);
    const originalPrompt = "Keep the existing system prompt.";

    const result = await computeMemoryExtraSystemPrompt(
      originalPrompt,
      {
        runtime: {
          memory: {
            injectPilot: {
              enabled: true,
              sessions: "all",
            },
          },
        },
      },
      undefined,
      providerFactory,
    );

    expect(result).toBe(originalPrompt);
    expect(providerFactory).not.toHaveBeenCalled();
  });
});
