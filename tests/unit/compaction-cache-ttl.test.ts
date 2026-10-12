import { describe, expect, it, vi } from "vitest";

vi.mock("../../openclaw_runtime/src/plugins/provider-runtime.js", () => ({
  resolveProviderCacheTtlEligibility: () => undefined,
}));
import type { OpenClawConfig } from "../../openclaw_runtime/src/config/types.openclaw.js";
import { resolveCompactionCacheTtlDeferral } from "../../openclaw_runtime/src/agents/embedded-agent-runner/compaction-cache-ttl.js";
import {
  CACHE_TTL_DEFERRED_COMPACTION_REASON,
  classifyCompactionReason,
} from "../../openclaw_runtime/src/agents/embedded-agent-runner/compact-reasons.js";

const NOW = 1_800_000_000_000;

function buildConfig(options?: {
  enabled?: boolean;
  mode?: "off" | "cache-ttl";
  ttl?: string;
}): OpenClawConfig {
  return {
    agents: {
      defaults: {
        contextPruning: {
          mode: options?.mode ?? "cache-ttl",
          ttl: options?.ttl ?? "60s",
        },
        compaction: {
          deferWhileCacheHot: options?.enabled ?? true,
        },
      },
    },
  } as OpenClawConfig;
}

function buildSessionManager(lastCacheTouchAt: number, provider = "anthropic") {
  return {
    getEntries: () => [
      {
        type: "custom",
        customType: "openclaw.cache-ttl",
        data: {
          timestamp: lastCacheTouchAt,
          provider,
          modelId: "claude-sonnet-4",
        },
      },
    ],
  };
}

function evaluate(options?: {
  enabled?: boolean;
  mode?: "off" | "cache-ttl";
  ttl?: string;
  trigger?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string;
  lastCacheTouchAt?: number;
}) {
  return resolveCompactionCacheTtlDeferral({
    config: buildConfig(options),
    sessionManager: buildSessionManager(
      options?.lastCacheTouchAt ?? NOW - 10_000,
      options?.provider ?? "anthropic",
    ),
    provider: options?.provider ?? "anthropic",
    modelId: options?.modelId ?? "claude-sonnet-4",
    modelApi: options?.modelApi,
    trigger: options?.trigger ?? "budget",
    now: NOW,
  });
}

describe("resolveCompactionCacheTtlDeferral", () => {
  it("defers a budget compaction while the prompt cache is hot", () => {
    expect(evaluate()).toEqual({
      reason: CACHE_TTL_DEFERRED_COMPACTION_REASON,
      ageMs: 10_000,
      ttlMs: 60_000,
    });
  });

  it("does not defer once the configured TTL has elapsed", () => {
    expect(evaluate({ lastCacheTouchAt: NOW - 60_000 })).toBeNull();
  });

  it("does not defer when the opt-in is disabled", () => {
    expect(evaluate({ enabled: false })).toBeNull();
  });

  it("does not defer when context pruning has no active cache-TTL policy", () => {
    expect(evaluate({ mode: "off" })).toBeNull();
  });

  it("does not defer for a non-eligible provider", () => {
    expect(
      evaluate({
        provider: "openai",
        modelId: "gpt-5",
        modelApi: "openai-responses",
      }),
    ).toBeNull();
  });

  it.each(["manual", "overflow", "timeout_recovery"])(
    "does not defer the urgent %s trigger",
    (trigger) => {
      expect(evaluate({ trigger })).toBeNull();
    },
  );

  it("classifies the deferral as a successful skip reason", () => {
    expect(classifyCompactionReason(CACHE_TTL_DEFERRED_COMPACTION_REASON)).toBe(
      "cache_ttl_deferred",
    );
  });
});
