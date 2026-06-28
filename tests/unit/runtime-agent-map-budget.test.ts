import { describe, expect, it } from "vitest";
import {
  buildBudgetedAgentMapResult,
  createAgentMapCache,
  isAgentMapResult,
} from "../../openclaw_runtime/src/runtime-core";
import {
  buildAgentMapFixtureRequest,
  readAgentMapFixtureFiles,
} from "../fixtures/agent-map/fixture-loader";

describe("AgentMap budget fit", () => {
  it("shrinks monotonically by selected symbol count as budgets decrease", async () => {
    const files = readAgentMapFixtureFiles();
    const cache = createAgentMapCache();
    const large = await buildBudgetedAgentMapResult({
      request: buildAgentMapFixtureRequest({ refreshPolicy: "auto", tokenBudget: 900 }),
      files,
      contextLines: 0,
      cache,
    });
    const medium = await buildBudgetedAgentMapResult({
      request: buildAgentMapFixtureRequest({ refreshPolicy: "auto", tokenBudget: 520 }),
      files,
      contextLines: 0,
      cache,
    });
    const small = await buildBudgetedAgentMapResult({
      request: buildAgentMapFixtureRequest({ refreshPolicy: "auto", tokenBudget: 320 }),
      files,
      contextLines: 0,
      cache,
    });

    expect(isAgentMapResult(large)).toBe(true);
    expect(isAgentMapResult(medium)).toBe(true);
    expect(isAgentMapResult(small)).toBe(true);
    expect(large.tokenEstimate).toBeLessThanOrEqual(large.tokenBudget);
    expect(medium.tokenEstimate).toBeLessThanOrEqual(medium.tokenBudget);
    expect(small.tokenEstimate).toBeLessThanOrEqual(small.tokenBudget);
    expect(large.includedSymbols.length).toBeGreaterThanOrEqual(medium.includedSymbols.length);
    expect(medium.includedSymbols.length).toBeGreaterThanOrEqual(small.includedSymbols.length);
    expect(large.content.length).toBeGreaterThanOrEqual(medium.content.length);
    expect(medium.content.length).toBeGreaterThanOrEqual(small.content.length);
    expect(cache.stats().hitCount).toBe(files.length * 2);
  });

  it("never truncates in the middle of a rendered symbol block", async () => {
    const cache = createAgentMapCache();
    const result = await buildBudgetedAgentMapResult({
      request: buildAgentMapFixtureRequest({ refreshPolicy: "auto", tokenBudget: 320 }),
      files: readAgentMapFixtureFiles(),
      contextLines: 0,
      cache,
    });
    const blockStarts = result.content.match(/^@@ symbol /gm)?.length ?? 0;
    const blockEnds = result.content.match(/^@@ end /gm)?.length ?? 0;

    expect(result.includedSymbols.length).toBeGreaterThan(0);
    expect(blockStarts).toBe(result.includedSymbols.length);
    expect(blockEnds).toBe(result.includedSymbols.length);
    for (const symbol of result.includedSymbols) {
      expect(result.content).toContain(`@@ end ${symbol.tag.tagId}`);
    }
  });
});
