import { describe, expect, it, beforeEach } from "vitest";
import {
  beginPromptCacheObservation,
  completePromptCacheObservation,
  readAggregatedPromptCacheHitRate,
  readPromptCacheHitRate,
  recordPromptCacheHitRateSample,
  resetPromptCacheHitRateForTest,
  resetPromptCacheObservabilityForTest,
} from "../../openclaw_runtime/src/agents/embedded-agent-runner/prompt-cache-observability";

const baseParams = {
  provider: "anthropic",
  modelId: "claude-sonnet-4",
  cacheRetention: "long" as const,
  streamStrategy: "streaming",
  systemPrompt: "you are a helpful agent",
  toolNames: ["read_file", "write_file"],
};

describe("prompt cache hit-rate metric", () => {
  beforeEach(() => {
    resetPromptCacheObservabilityForTest();
    resetPromptCacheHitRateForTest();
  });

  it("has no window before the first usable sample", () => {
    expect(readPromptCacheHitRate({ sessionId: "s1" })).toBeNull();
    expect(readAggregatedPromptCacheHitRate().hitRate).toBeNull();
  });

  it("counts cache-served prompt tokens and reports a hit rate", () => {
    const first = recordPromptCacheHitRateSample({
      sessionId: "s1",
      usage: { input: 100, cacheRead: 900 },
    });
    expect(first?.observations).toBe(1);
    expect(first?.cacheReadTokens).toBe(900);
    // input is the uncached remainder; prompt budget is input + cacheRead.
    expect(first?.totalPromptTokens).toBe(1000);
    expect(first?.hitRate).toBeCloseTo(0.9, 6);

    // Second turn: input 100 uncached + 300 cache-served = 400 prompt tokens.
    const second = recordPromptCacheHitRateSample({
      sessionId: "s1",
      usage: { input: 100, cacheRead: 300 },
    });
    expect(second?.observations).toBe(2);
    expect(second?.cacheReadTokens).toBe(1200);
    expect(second?.totalPromptTokens).toBe(1000 + 400);
    expect(second?.hitRate).toBeCloseTo(1200 / 1400, 6);
  });

  it("treats cache-served tokens as the whole prompt when input is absent", () => {
    const sample = recordPromptCacheHitRateSample({
      sessionId: "s2",
      usage: { cacheRead: 500 },
    });
    expect(sample?.totalPromptTokens).toBe(500);
    expect(sample?.hitRate).toBe(1);
  });

  it("ignores samples without a usable cacheRead instead of guessing", () => {
    expect(recordPromptCacheHitRateSample({ sessionId: "s3", usage: { input: 50 } })).toBeNull();
    expect(recordPromptCacheHitRateSample({ sessionId: "s3", usage: { cacheRead: Number.NaN } })).toBeNull();
    expect(recordPromptCacheHitRateSample({ sessionId: "s3", usage: { cacheRead: -5 } })).toBeNull();
    expect(readPromptCacheHitRate({ sessionId: "s3" })).toBeNull();
  });

  it("keys windows the same way break attribution does", () => {
    // A promptCacheKey must win over sessionKey/sessionId, exactly as
    // buildTrackerKey does for attribution, so metric and attribution agree.
    recordPromptCacheHitRateSample({
      sessionId: "s4",
      sessionKey: "session-key",
      promptCacheKey: "shared-cache-key",
      usage: { input: 10, cacheRead: 90 },
    });
    const byKey = readPromptCacheHitRate({ sessionId: "other", promptCacheKey: "shared-cache-key" });
    expect(byKey?.observations).toBe(1);
  });

  it("reads provider and model from the attribution tracker when available", () => {
    beginPromptCacheObservation({ ...baseParams, sessionId: "s5" });
    const sample = recordPromptCacheHitRateSample({
      sessionId: "s5",
      usage: { input: 0, cacheRead: 400 },
    });
    expect(sample?.provider).toBe("anthropic");
    expect(sample?.modelId).toBe("claude-sonnet-4");
  });

  it("counts attributed breaks alongside the rate", () => {
    // Turn 1 establishes a warm cacheRead baseline.
    beginPromptCacheObservation({ ...baseParams, sessionId: "s6" });
    completePromptCacheObservation({ sessionId: "s6", usage: { cacheRead: 10_000 } });
    recordPromptCacheHitRateSample({ sessionId: "s6", usage: { input: 0, cacheRead: 10_000 } });

    // Turn 2 changes the prompt prefix and drops cacheRead past the stability
    // ratio (0.95) and the 1000-token floor, which is what attribution flags.
    beginPromptCacheObservation({
      ...baseParams,
      sessionId: "s6",
      systemPrompt: "you are a DIFFERENT agent",
    });
    const broke = completePromptCacheObservation({
      sessionId: "s6",
      usage: { cacheRead: 10 },
    });
    expect(broke).not.toBeNull();
    expect(broke?.previousCacheRead).toBe(10_000);
    expect(broke?.cacheRead).toBe(10);

    const window = recordPromptCacheHitRateSample({
      sessionId: "s6",
      usage: { input: 0, cacheRead: 10 },
      broke: true,
    });
    expect(window?.breaks).toBe(1);
    expect(window?.observations).toBe(2);
  });

  it("aggregates across distinct keys", () => {
    recordPromptCacheHitRateSample({ sessionId: "a", usage: { input: 0, cacheRead: 100 } });
    recordPromptCacheHitRateSample({ sessionId: "b", usage: { input: 100, cacheRead: 100 } });
    const agg = readAggregatedPromptCacheHitRate();
    expect(agg.observations).toBe(2);
    expect(agg.cacheReadTokens).toBe(200);
    expect(agg.totalPromptTokens).toBe(300);
    expect(agg.hitRate).toBeCloseTo(200 / 300, 6);
  });

  it("stays bounded: clamping caps absurd token counts", () => {
    const sample = recordPromptCacheHitRateSample({
      sessionId: "s7",
      usage: { input: 0, cacheRead: Number.MAX_SAFE_INTEGER },
    });
    expect(sample?.cacheReadTokens).toBeLessThanOrEqual(1_000_000_000);
  });

  it("is accounting only: the reset used by attribution clears it too", () => {
    recordPromptCacheHitRateSample({ sessionId: "s8", usage: { input: 0, cacheRead: 10 } });
    expect(readAggregatedPromptCacheHitRate().observations).toBe(1);
    // resetPromptCacheObservabilityForTest must clear both, otherwise tests
    // would leak metric state across attribution-only resets.
    resetPromptCacheObservabilityForTest();
    expect(readAggregatedPromptCacheHitRate().observations).toBe(0);
  });
});
