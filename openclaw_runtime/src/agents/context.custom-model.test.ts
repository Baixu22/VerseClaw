/**
 * Regression tests for custom-model context-window resolution (issue #15).
 *
 * A custom model registered without an explicit contextWindow should pick up
 * the window from the model catalog when available, and an explicit
 * config-supplied window must always win. This keeps auto-compaction working
 * on long sessions for custom models.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyConfiguredContextWindows,
  applyDiscoveredContextWindows,
} from "./context.js";
import { MODEL_CONTEXT_TOKEN_CACHE } from "./context-cache.js";

function resetCache() {
  MODEL_CONTEXT_TOKEN_CACHE.clear();
}

describe("custom model context-window resolution (issue #15)", () => {
  beforeEach(() => {
    resetCache();
  });

  it("fills the window from discovered catalog metadata when config omits it", () => {
    applyDiscoveredContextWindows({
      cache: MODEL_CONTEXT_TOKEN_CACHE,
      models: [
        {
          id: "custom-provider/custom-model",
          provider: "custom-provider",
          contextWindow: 131_072,
        },
      ],
    });

    expect(MODEL_CONTEXT_TOKEN_CACHE.get("custom-provider/custom-model")).toBe(131_072);
  });

  it("lets an explicit config contextWindow override the discovered catalog value", () => {
    applyDiscoveredContextWindows({
      cache: MODEL_CONTEXT_TOKEN_CACHE,
      models: [
        { id: "my-model", provider: "deepseek", contextWindow: 131_072 },
      ],
    });
    applyConfiguredContextWindows({
      cache: MODEL_CONTEXT_TOKEN_CACHE,
      modelsConfig: {
        providers: {
          deepseek: {
            models: [{ id: "my-model", contextWindow: 262_144 }],
          },
        },
      },
    });

    expect(MODEL_CONTEXT_TOKEN_CACHE.get("my-model")).toBe(262_144);
  });

  it("prefers the most conservative discovered window for an unconfigured model", () => {
    applyDiscoveredContextWindows({
      cache: MODEL_CONTEXT_TOKEN_CACHE,
      models: [
        { id: "multi", provider: "p1", contextWindow: 262_144 },
        { id: "multi", provider: "p2", contextWindow: 131_072 },
      ],
    });

    expect(MODEL_CONTEXT_TOKEN_CACHE.get("multi")).toBe(131_072);
  });
});
