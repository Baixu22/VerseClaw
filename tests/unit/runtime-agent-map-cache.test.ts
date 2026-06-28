import { describe, expect, it } from "vitest";
import {
  buildBudgetedAgentMapResult,
  createAgentMapCache,
  extractAgentMapTagsFromSources,
  rankAgentMapTags,
  type AgentMapRankedTag,
} from "../../openclaw_runtime/src/runtime-core";
import {
  buildAgentMapFixtureRequest,
  readAgentMapFixtureFiles,
} from "../fixtures/agent-map/fixture-loader";

describe("AgentMap readonly cache", () => {
  it("keeps identical cached inputs deterministic", async () => {
    const cache = createAgentMapCache();
    const files = readAgentMapFixtureFiles();
    const request = buildAgentMapFixtureRequest({
      refreshPolicy: "auto",
      tokenBudget: 760,
      mentionedSymbols: ["sendMessage"],
    });

    const first = await buildBudgetedAgentMapResult({
      request,
      files,
      contextLines: 0,
      cache,
    });
    const second = await buildBudgetedAgentMapResult({
      request,
      files,
      contextLines: 0,
      cache,
    });

    expect(second).toEqual(first);
    expect(cache.stats()).toMatchObject({
      readonly: true,
      discardable: true,
      entryCount: files.length,
      hitCount: files.length,
      missCount: files.length,
      keyKind: "path+language+content-hash",
    });
  });

  it("invalidates when the same path receives different content", async () => {
    const cache = createAgentMapCache({ maxEntries: 1 });
    const file = "src/example.ts";
    const first = await extractAgentMapTagsFromSources({
      cache,
      files: [{
        file,
        content: "export function alpha() {\n  return 1;\n}\n",
      }],
    });
    const second = await extractAgentMapTagsFromSources({
      cache,
      files: [{
        file,
        content: "export function beta() {\n  return 2;\n}\n",
      }],
    });

    expect(definitionNames(first)).toContain("alpha");
    expect(definitionNames(first)).not.toContain("beta");
    expect(definitionNames(second)).toContain("beta");
    expect(definitionNames(second)).not.toContain("alpha");
    expect(cache.stats()).toMatchObject({
      entryCount: 1,
      hitCount: 0,
      missCount: 2,
      maxEntries: 1,
    });
  });

  it("does not change ranking results after cached extraction hits", async () => {
    const files = readAgentMapFixtureFiles();
    const request = buildAgentMapFixtureRequest({
      refreshPolicy: "auto",
      mentionedSymbols: ["SettingsPanel"],
      promptPresentFiles: [],
    });
    const uncachedTags = await extractAgentMapTagsFromSources({ files });
    const cache = createAgentMapCache();

    await extractAgentMapTagsFromSources({ cache, files });
    const cachedTags = await extractAgentMapTagsFromSources({ cache, files });

    expect(rankSignature(rankAgentMapTags({ request, tags: cachedTags })))
      .toEqual(rankSignature(rankAgentMapTags({ request, tags: uncachedTags })));
    expect(cache.stats().hitCount).toBe(files.length);
  });
});

function definitionNames(tags: Awaited<ReturnType<typeof extractAgentMapTagsFromSources>>): string[] {
  return tags.filter((tag) => tag.kind === "definition").map((tag) => tag.name);
}

function rankSignature(rankedTags: AgentMapRankedTag[]): Array<{
  rank: number;
  score: number;
  tagId: string;
  name: string;
  reasons: Array<{ kind: string; scoreDelta: number }>;
}> {
  return rankedTags.map((rankedTag) => ({
    rank: rankedTag.rank,
    score: rankedTag.score,
    tagId: rankedTag.tag.tagId,
    name: rankedTag.tag.name,
    reasons: rankedTag.reasons.map((reason) => ({
      kind: reason.kind,
      scoreDelta: reason.scoreDelta,
    })),
  }));
}
