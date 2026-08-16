/**
 * Anthropic GA 1M context-window coverage for the 2026 model family.
 *
 * Sonnet 5 and Fable 5 ship 1M context windows. The prefix table must keep up
 * with the Anthropic catalog or auto-compaction under-budgets these models.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { applyDiscoveredContextWindows } from "./context.js";
import { MODEL_CONTEXT_TOKEN_CACHE } from "./context-cache.js";

function resetCache() {
  MODEL_CONTEXT_TOKEN_CACHE.clear();
}

describe("Anthropic GA 1M context-window prefixes", () => {
  beforeEach(() => {
    resetCache();
  });

  it("applies the 1M window to claude-sonnet-5", () => {
    applyDiscoveredContextWindows({
      cache: MODEL_CONTEXT_TOKEN_CACHE,
      models: [{ id: "claude-sonnet-5", provider: "anthropic", contextWindow: 200_000 }],
    });
    expect(MODEL_CONTEXT_TOKEN_CACHE.get("claude-sonnet-5")).toBe(1_048_576);
  });

  it("applies the 1M window to claude-fable-5", () => {
    applyDiscoveredContextWindows({
      cache: MODEL_CONTEXT_TOKEN_CACHE,
      models: [{ id: "claude-fable-5", provider: "anthropic", contextWindow: 200_000 }],
    });
    expect(MODEL_CONTEXT_TOKEN_CACHE.get("claude-fable-5")).toBe(1_048_576);
  });

  it("leaves non-1M Anthropic models on their discovered window", () => {
    applyDiscoveredContextWindows({
      cache: MODEL_CONTEXT_TOKEN_CACHE,
      models: [{ id: "claude-haiku-4-5", provider: "anthropic", contextWindow: 200_000 }],
    });
    expect(MODEL_CONTEXT_TOKEN_CACHE.get("claude-haiku-4-5")).toBe(200_000);
  });
});
