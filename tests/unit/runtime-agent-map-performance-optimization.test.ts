import { describe, expect, it } from "vitest";
import {
  buildAgentMapRequestFixture,
  buildBudgetedAgentMapResult,
  createAgentMapCache,
  extractAgentMapTagsFromSources,
  rankAgentMapTags,
  renderAgentMapRankedTags,
  type AgentMapRankedTag,
  type AgentMapRequest,
  type AgentMapSourceFile,
} from "../../openclaw_runtime/src/runtime-core/agent-map";

describe("AgentMap internal performance optimization", () => {
  it("keeps ranking deterministic and exact mentioned symbols first", async () => {
    const files = buildSyntheticAgentMapFiles(40);
    const request = buildSyntheticAgentMapRequest(files, {
      activeFiles: [],
      mentionedSymbols: ["MentionedSyntheticTarget7"],
      tokenBudget: 1_000,
    });
    const tags = await extractAgentMapTagsFromSources({ files, refreshPolicy: "force" });

    const first = rankAgentMapTags({ request, tags });
    const second = rankAgentMapTags({ request, tags });

    expect(rankSignature(second)).toEqual(rankSignature(first));
    expect(first[0]?.tag.name).toBe("MentionedSyntheticTarget7");
    expect(first[0]?.reasons.map((reason) => reason.kind)).toContain("mentionedByUser");
    expect(first.every((rankedTag) =>
      rankedTag.reasons.some((reason) => reason.kind === "stableTieBreak") &&
      rankedTag.evidenceRefs.length >= rankedTag.tag.evidenceRefs.length
    )).toBe(true);
  });

  it("keeps ASCII reference-name coverage, tagId, and order stable", async () => {
    const tags = await extractAgentMapTagsFromSources({
      files: [{
        file: "src/reference-names.ts",
        content: [
          "const $allowed = 1;",
          "const _allowed2 = $allowed + alpha123 + Ωmega + React;",
          "function alpha123() {",
          "  return _allowed2;",
          "}",
          "const café = alpha123();",
        ].join("\n"),
      }],
      refreshPolicy: "force",
    });
    const references = tags
      .filter((tag) => tag.kind === "reference")
      .map((tag) => ({
        name: tag.name,
        tagId: tag.tagId,
        snippet: tag.snippet,
      }));

    expect(references).toEqual([
      {
        name: "$allowed",
        tagId: "tag:src/reference-names.ts:2:18:$allowed:reference:0",
        snippet: "const _allowed2 = $allowed + alpha123 + Ωmega + React;",
      },
      {
        name: "alpha123",
        tagId: "tag:src/reference-names.ts:2:29:alpha123:reference:1",
        snippet: "const _allowed2 = $allowed + alpha123 + Ωmega + React;",
      },
      {
        name: "_allowed2",
        tagId: "tag:src/reference-names.ts:4:9:_allowed2:reference:2",
        snippet: "return _allowed2;",
      },
      {
        name: "alpha123",
        tagId: "tag:src/reference-names.ts:6:13:alpha123:reference:3",
        snippet: "const café = alpha123();",
      },
    ]);
  });

  it("fits complete symbol blocks within budget and matches full-ranking render semantics", async () => {
    const files = buildSyntheticAgentMapFiles(120);
    const request = buildSyntheticAgentMapRequest(files, {
      activeFiles: [],
      tokenBudget: 512,
    });
    const result = await buildBudgetedAgentMapResult({
      request,
      files,
      contextLines: 0,
    });
    const tags = await extractAgentMapTagsFromSources({ files, refreshPolicy: "force" });
    const fullRanked = rankAgentMapTags({ request, tags })
      .filter((rankedTag) => !request.promptPresentFiles.includes(rankedTag.tag.file));
    const baseline = fitBaselineByCompleteSymbolBlocks({
      rankedTags: fullRanked,
      files,
      tokenBudget: request.tokenBudget,
    });

    expect(result.tokenEstimate).toBeLessThanOrEqual(result.tokenBudget);
    expect(result.content).toBe(baseline.content);
    expect(rankSignature(result.includedSymbols)).toEqual(rankSignature(baseline.renderedSymbols));
    expect(result.includedSymbols.length).toBeGreaterThan(0);
    expect(result.content.match(/^@@ symbol /gm)?.length).toBe(result.includedSymbols.length);
    expect(result.content.match(/^@@ end /gm)?.length).toBe(result.includedSymbols.length);
  });

  it("keeps bounded build ranking aligned when prompt-present definitions dominate the top window", async () => {
    const files = buildPromptPresentHeavyAgentMapFiles();
    const request = buildAgentMapRequestFixture({
      activeFiles: [],
      candidateFiles: files.map((file) => file.file),
      mentionedFiles: [],
      mentionedSymbols: [],
      promptPresentFiles: ["src/aaa/prompt-present.ts"],
      tokenBudget: 512,
      refreshPolicy: "force",
    });
    const result = await buildBudgetedAgentMapResult({
      request,
      files,
      contextLines: 0,
    });
    const tags = await extractAgentMapTagsFromSources({ files, refreshPolicy: "force" });
    const fullRanked = rankAgentMapTags({ request, tags })
      .filter((rankedTag) => !request.promptPresentFiles.includes(rankedTag.tag.file));
    const baseline = fitBaselineByCompleteSymbolBlocks({
      rankedTags: fullRanked,
      files,
      tokenBudget: request.tokenBudget,
    });

    expect(result.tokenEstimate).toBeLessThanOrEqual(result.tokenBudget);
    expect(result.content).toBe(baseline.content);
    expect(rankSignature(result.includedSymbols)).toEqual(rankSignature(baseline.renderedSymbols));
    expect(result.includedSymbols.length).toBeGreaterThan(0);
    expect(result.includedSymbols.every((symbol) =>
      symbol.tag.file === "src/zzz/eligible.ts"
    )).toBe(true);
  });

  it("keeps generated paths filtered by default", async () => {
    const result = await buildBudgetedAgentMapResult({
      request: buildSyntheticAgentMapRequest([
        {
          file: "src/generated/schema.generated.ts",
          content: "export function GeneratedSymbol() { return true; }\n",
        },
        {
          file: "src/live/real.ts",
          content: "export function RealSymbol() { return true; }\n",
        },
      ], {
        activeFiles: ["src/live/real.ts"],
        candidateFiles: ["src/generated/schema.generated.ts", "src/live/real.ts"],
        mentionedSymbols: ["GeneratedSymbol", "RealSymbol"],
      }),
      files: [
        {
          file: "src/generated/schema.generated.ts",
          content: "export function GeneratedSymbol() { return true; }\n",
        },
        {
          file: "src/live/real.ts",
          content: "export function RealSymbol() { return true; }\n",
        },
      ],
      contextLines: 0,
    });

    expect(result.includedSymbols.map((symbol) => symbol.tag.name)).toContain("RealSymbol");
    expect(JSON.stringify(result)).not.toContain("GeneratedSymbol");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "generated_file",
      file: "src/generated/schema.generated.ts",
    }));
  });

  it("keeps cache hit and miss accounting readonly and discardable", async () => {
    const files = buildSyntheticAgentMapFiles(12);
    const cache = createAgentMapCache({ maxEntries: 20 });
    const request = buildSyntheticAgentMapRequest(files, { tokenBudget: 512 });

    await buildBudgetedAgentMapResult({ request, files, contextLines: 0, cache });
    await buildBudgetedAgentMapResult({ request, files, contextLines: 0, cache });

    expect(cache.stats()).toMatchObject({
      readonly: true,
      discardable: true,
      entryCount: files.length,
      hitCount: files.length,
      missCount: files.length,
      keyKind: "path+language+content-hash",
    });
  });

  it("keeps cache lifecycle bounded and clearable to prevent retained derived state", async () => {
    const files = buildSyntheticAgentMapFiles(12);
    const cache = createAgentMapCache({ maxEntries: 20 });

    await extractAgentMapTagsFromSources({ files, cache, refreshPolicy: "auto" });
    await extractAgentMapTagsFromSources({ files, cache, refreshPolicy: "auto" });

    expect(cache.stats()).toMatchObject({
      readonly: true,
      discardable: true,
      entryCount: files.length,
      hitCount: files.length,
      missCount: files.length,
      maxEntries: 20,
      keyKind: "path+language+content-hash",
      contentHashAlgorithm: "fnv1a-32",
    });

    cache.clear();

    expect(cache.stats()).toMatchObject({
      readonly: true,
      discardable: true,
      entryCount: 0,
      hitCount: 0,
      missCount: 0,
      maxEntries: 20,
    });

    await extractAgentMapTagsFromSources({ files, cache, refreshPolicy: "auto" });

    expect(cache.stats()).toMatchObject({
      entryCount: files.length,
      hitCount: 0,
      missCount: files.length,
    });
  });

  it("keeps cache entries bounded under corpus growth", async () => {
    const files = buildSyntheticAgentMapFiles(18);
    const cache = createAgentMapCache({ maxEntries: 5 });

    await extractAgentMapTagsFromSources({ files, cache, refreshPolicy: "auto" });

    expect(cache.stats()).toMatchObject({
      readonly: true,
      discardable: true,
      entryCount: 5,
      missCount: files.length,
      maxEntries: 5,
    });
  });

  it("keeps cached tag arrays structurally isolated from caller mutation", async () => {
    const files = buildSyntheticAgentMapFiles(4);
    const cache = createAgentMapCache({ maxEntries: 8 });
    const first = await extractAgentMapTagsFromSources({ files, cache, refreshPolicy: "auto" });

    first.splice(0, first.length);

    const second = await extractAgentMapTagsFromSources({ files, cache, refreshPolicy: "auto" });

    expect(first).toHaveLength(0);
    expect(second.length).toBeGreaterThan(0);
    expect(cache.stats()).toMatchObject({
      entryCount: files.length,
      hitCount: files.length,
      missCount: files.length,
    });
  });

  it("uses robust benchmark statistics so outliers cannot masquerade as wins", () => {
    const summary = summarizeBenchmarkSamples([8, 12, 10, 9, 50, 11, 10]);

    expect(summary).toEqual({
      sampleCount: 7,
      min: 8,
      median: 10,
      p75: 12,
      max: 50,
      iqr: 3,
    });
  });
});

function buildSyntheticAgentMapFiles(count: number): AgentMapSourceFile[] {
  return Array.from({ length: count }, (_, index) => {
    const file = `src/features/feature-${String(index).padStart(4, "0")}/Widget${index}.ts`;
    const previousIndex = Math.max(0, index - 1);
    const previous = `SyntheticSymbol${previousIndex}`;
    const content = [
      `export type SyntheticType${index} = { id: string; value: number };`,
      `export interface SyntheticInterface${index} { run(input: SyntheticType${index}): string; }`,
      `export const SyntheticValue${index} = ${index};`,
      `export function SyntheticSymbol${index}(input: SyntheticType${index}): string {`,
      `  const local = "${previous}";`,
      "  return local + input.id;",
      "}",
      `export function MentionedSyntheticTarget${index}(input: SyntheticType${index}): string {`,
      `  return SyntheticSymbol${index}(input);`,
      "}",
    ].join("\n");
    return { file, content };
  });
}

function buildPromptPresentHeavyAgentMapFiles(): AgentMapSourceFile[] {
  return [
    {
      file: "src/aaa/prompt-present.ts",
      content: Array.from(
        { length: 80 },
        (_, index) => `export function SameScore${String(index).padStart(3, "0")}() { return ${index}; }`,
      ).join("\n"),
    },
    {
      file: "src/zzz/eligible.ts",
      content: Array.from(
        { length: 8 },
        (_, index) => `export function SameScore${String(index + 900).padStart(3, "0")}() { return ${index}; }`,
      ).join("\n"),
    },
  ];
}

function buildSyntheticAgentMapRequest(
  files: AgentMapSourceFile[],
  overrides: Partial<AgentMapRequest> = {},
): AgentMapRequest {
  return buildAgentMapRequestFixture({
    activeFiles: [files[0]?.file ?? "src/features/feature-0000/Widget0.ts"],
    candidateFiles: files.map((file) => file.file),
    mentionedFiles: [files[Math.min(files.length - 1, 5)]?.file ?? ""],
    mentionedSymbols: ["MentionedSyntheticTarget7"],
    promptPresentFiles: [files[0]?.file ?? "src/features/feature-0000/Widget0.ts"],
    tokenBudget: 1_000,
    refreshPolicy: "auto",
    ...overrides,
  });
}

function fitBaselineByCompleteSymbolBlocks(input: {
  rankedTags: AgentMapRankedTag[];
  files: AgentMapSourceFile[];
  tokenBudget: number;
}): ReturnType<typeof renderAgentMapRankedTags> {
  let best = renderAgentMapRankedTags({
    rankedTags: [],
    files: input.files,
    tokenBudget: input.tokenBudget,
    contextLines: 0,
    maxSymbols: 0,
  });
  for (let count = 1; count <= input.rankedTags.length; count += 1) {
    const rendered = renderAgentMapRankedTags({
      rankedTags: input.rankedTags,
      files: input.files,
      tokenBudget: input.tokenBudget,
      contextLines: 0,
      maxSymbols: count,
    });
    if (rendered.tokenEstimate > input.tokenBudget) {
      break;
    }
    best = rendered;
  }
  return best;
}

function rankSignature(rankedTags: AgentMapRankedTag[]): Array<{
  rank: number;
  score: number;
  tagId: string;
  name: string;
  referenceCount: unknown;
  promptPresent: unknown;
  evidenceRefs: string[];
  reasons: Array<{ kind: string; scoreDelta: number }>;
}> {
  return rankedTags.map((rankedTag) => ({
    rank: rankedTag.rank,
    score: rankedTag.score,
    tagId: rankedTag.tag.tagId,
    name: rankedTag.tag.name,
    referenceCount: rankedTag.metadata?.referenceCount,
    promptPresent: rankedTag.metadata?.promptPresent,
    evidenceRefs: rankedTag.evidenceRefs.map((ref) =>
      `${ref.type}:${ref.ref}:${ref.label ?? ""}`
    ),
    reasons: rankedTag.reasons.map((reason) => ({
      kind: reason.kind,
      scoreDelta: reason.scoreDelta,
    })),
  }));
}

function summarizeBenchmarkSamples(samples: number[]): {
  sampleCount: number;
  min: number;
  median: number;
  p75: number;
  max: number;
  iqr: number;
} {
  if (samples.length === 0) {
    throw new Error("Benchmark summary requires at least one sample.");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  return {
    sampleCount: sorted.length,
    min: sorted[0] ?? 0,
    median: percentile(sorted, 0.5),
    p75: q3,
    max: sorted[sorted.length - 1] ?? 0,
    iqr: q3 - q1,
  };
}

function percentile(sortedSamples: number[], fraction: number): number {
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(sortedSamples.length * fraction) - 1),
  );
  return sortedSamples[index] ?? 0;
}
