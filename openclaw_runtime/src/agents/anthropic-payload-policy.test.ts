/**
 * Anthropic payload policy server-side compaction coverage.
 */
import { describe, expect, it } from "vitest";
import {
  applyAnthropicPayloadPolicyToParams,
  DEFAULT_ANTHROPIC_SERVER_COMPACT_THRESHOLD,
  resolveAnthropicPayloadPolicy,
} from "./anthropic-payload-policy.js";

function resolveWithCompaction(threshold?: number) {
  return resolveAnthropicPayloadPolicy({
    provider: "anthropic",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    enableCacheControl: false,
    serverCompaction: true,
    compactThreshold: threshold,
  });
}

describe("Anthropic payload policy server compaction", () => {
  it("adds context_management when server compaction is enabled", () => {
    const policy = resolveWithCompaction(150_000);
    const payload: Record<string, unknown> = { model: "claude-sonnet-5" };
    applyAnthropicPayloadPolicyToParams(payload, policy);
    expect(payload.context_management).toEqual([
      { type: "compaction", compact_threshold: 150_000 },
    ]);
  });

  it("uses the default threshold when none is configured", () => {
    const policy = resolveWithCompaction();
    const payload: Record<string, unknown> = {};
    applyAnthropicPayloadPolicyToParams(payload, policy);
    expect(payload.context_management).toEqual([
      { type: "compaction", compact_threshold: DEFAULT_ANTHROPIC_SERVER_COMPACT_THRESHOLD },
    ]);
  });

  it("does not overwrite an existing context_management payload", () => {
    const policy = resolveWithCompaction();
    const existing = [{ type: "compaction", compact_threshold: 123_456 }];
    const payload: Record<string, unknown> = { context_management: existing };
    applyAnthropicPayloadPolicyToParams(payload, policy);
    expect(payload.context_management).toBe(existing);
  });

  it("leaves the payload untouched when compaction is disabled", () => {
    const policy = resolveAnthropicPayloadPolicy({
      provider: "anthropic",
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      enableCacheControl: false,
    });
    const payload: Record<string, unknown> = { model: "claude-sonnet-5" };
    applyAnthropicPayloadPolicyToParams(payload, policy);
    expect(payload.context_management).toBeUndefined();
  });
});
