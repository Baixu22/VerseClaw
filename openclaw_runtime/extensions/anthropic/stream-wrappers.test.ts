/**
 * Anthropic server-side compaction stream wrapper coverage.
 */
import { describe, expect, it } from "vitest";
import { createAssistantMessageEventStream } from "openclaw/plugin-sdk/llm";
import type { StreamFn } from "openclaw/plugin-sdk/agent-core";
import {
  createAnthropicServerCompactionWrapper,
  resolveAnthropicServerCompaction,
  resolveAnthropicServerCompactionThreshold,
} from "./stream-wrappers.js";

describe("Anthropic server compaction stream wrappers", () => {
  it("defaults server compaction on for the official Anthropic provider", () => {
    expect(resolveAnthropicServerCompaction("anthropic", undefined)).toBe(true);
    expect(resolveAnthropicServerCompaction("claude-cli", undefined)).toBe(false);
    expect(
      resolveAnthropicServerCompaction("claude-cli", { anthropicServerCompaction: true }),
    ).toBe(true);
    expect(
      resolveAnthropicServerCompaction("anthropic", { anthropicServerCompaction: false }),
    ).toBe(false);
  });

  it("resolves the configured threshold with a conservative default", () => {
    expect(resolveAnthropicServerCompactionThreshold(undefined)).toBe(200_000);
    expect(resolveAnthropicServerCompactionThreshold({ anthropicCompactThreshold: 123_456 })).toBe(
      123_456,
    );
    expect(
      resolveAnthropicServerCompactionThreshold({ anthropicCompactThreshold: "175000" }),
    ).toBe(175_000);
    expect(resolveAnthropicServerCompactionThreshold({ anthropicCompactThreshold: -5 })).toBe(
      200_000,
    );
  });

  it("patches the payload and merges the compaction beta header", async () => {
    let capturedOptions: Parameters<StreamFn>[2] | undefined;
    const wrapper = createAnthropicServerCompactionWrapper(
      (_model, _context, options) => {
        capturedOptions = options;
        const stream = createAssistantMessageEventStream();
        stream.end();
        return stream;
      },
      150_000,
    );

    await wrapper(
      { id: "claude-sonnet-5", provider: "anthropic" } as never,
      { messages: [] } as never,
      { apiKey: "fixture-key" } as never,
    );

    expect(capturedOptions).toBeDefined();
    const headers = (capturedOptions as { headers?: Record<string, string> }).headers ?? {};
    const betaKey = Object.keys(headers).find((key) => key.toLowerCase() === "anthropic-beta");
    expect(betaKey).toBeDefined();
    expect(headers[betaKey!]).toContain("compact-2026-01-12");

    const payload: Record<string, unknown> = { model: "claude-sonnet-5" };
    void capturedOptions?.onPayload?.(payload, {} as never);
    expect(payload.context_management).toEqual([
      { type: "compaction", compact_threshold: 150_000 },
    ]);
  });
});
