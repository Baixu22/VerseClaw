import { describe, expect, it, vi } from "vitest";
import { createDeepSeekSekbBatchDistillationProvider } from "./batch-distillation-deepseek-provider.js";
import type { SekbBatchDistillationModelInput } from "./batch-distillation-assistant.js";

const sampleInput: SekbBatchDistillationModelInput = {
  schema: "sekb-batch-distillation-input.v1",
  trajectories: [{
    trajectory_ref: "t1",
    task_type: "code/task",
    context_tags: ["code"],
    outcome: "failure",
    error_signature: "sig-abc",
    step_counts: { total: 1, tool_calls: 1, tool_results: 0, failed_tool_results: 0 },
    shadow: null,
  }],
  existing_principles: [],
};

describe("createDeepSeekSekbBatchDistillationProvider", () => {
  it("returns undefined without an API key", () => {
    expect(createDeepSeekSekbBatchDistillationProvider({
      apiKey: "",
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })).toBeUndefined();
  });

  it("sends only the redacted projection and never includes secrets from caller memory outside input", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages: Array<{ content: string }>;
      };
      expect(JSON.stringify(body)).not.toContain("sk-live-secret");
      expect(body.messages[1]?.content).toContain("trajectory_ref");
      return {
        ok: true,
        json: async () => ({
          id: "chatcmpl-test",
          choices: [{
            message: {
              content: JSON.stringify({
                schema: "sekb-batch-distillation-output.v1",
                suggestions: [],
              }),
            },
          }],
          usage: { prompt_tokens: 11, completion_tokens: 3 },
        }),
      } as Response;
    });

    const provider = createDeepSeekSekbBatchDistillationProvider({
      apiKey: "sk-live-secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(provider).toBeDefined();
    const response = await provider!.suggest(sampleInput, {
      signal: new AbortController().signal,
      timeoutMs: 30_000,
      traceId: "trace-1",
      attempt: 1,
    });
    expect(response.content).toContain("sekb-batch-distillation-output.v1");
    expect(response.usage?.inputTokens).toBe(11);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
