/**
 * Anthropic Vertex catalog coverage for the Sonnet 5 / Fable 5 rows.
 */
import { describe, expect, it } from "vitest";
import { buildAnthropicVertexProvider } from "./provider-catalog.js";

describe("Anthropic Vertex model catalog", () => {
  it("lists claude-sonnet-5 with the published $2/$10 pricing", () => {
    const provider = buildAnthropicVertexProvider({ env: {} });
    const model = provider.models.find((entry) => entry.id === "claude-sonnet-5");
    expect(model).toBeDefined();
    expect(model?.reasoning).toBe(true);
    expect(model?.cost).toEqual({ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 });
    expect(model?.contextWindow).toBe(1_000_000);
  });

  it("lists claude-fable-5 with the published $10/$50 pricing", () => {
    const provider = buildAnthropicVertexProvider({ env: {} });
    const model = provider.models.find((entry) => entry.id === "claude-fable-5");
    expect(model).toBeDefined();
    expect(model?.reasoning).toBe(true);
    expect(model?.cost).toEqual({ input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 });
    expect(model?.contextWindow).toBe(1_000_000);
  });
});
