import { describe, expect, it } from "vitest";
import {
  AGENT_MAP_RANKING_REASON_KINDS,
  AGENT_MAP_RESULT_STATUSES,
  buildAgentMapEvidenceFixture,
  buildAgentMapRankedTagFixture,
  buildAgentMapRankingReasonFixture,
  buildAgentMapRequestFixture,
  buildAgentMapResultFixture,
  buildAgentMapTagFixture,
  isAgentMapEvidence,
  isAgentMapRankedTag,
  isAgentMapRankingReason,
  isAgentMapRequest,
  isAgentMapResult,
  isAgentMapTag,
} from "../../openclaw_runtime/src/runtime-core";

describe("AgentMap readonly contracts", () => {
  it("defines explainable result and ranking vocabularies", () => {
    expect(AGENT_MAP_RESULT_STATUSES).toEqual([
      "success",
      "empty",
      "budget_exhausted",
      "error",
    ]);
    expect(AGENT_MAP_RANKING_REASON_KINDS).toEqual([
      "fromActiveFileReference",
      "mentionedByUser",
      "mentionedFile",
      "pathComponentMatch",
      "uniqueDefinition",
      "promptPresentFile",
      "budgetFit",
      "stableTieBreak",
    ]);
  });

  it("validates AgentMap request, tag, ranking reason, evidence, and result fixtures", () => {
    const request = buildAgentMapRequestFixture({
      activeFiles: ["src/components/chat/Composer.tsx"],
      candidateFiles: ["src/lib/host-api.ts", "src/stores/chat.ts"],
      mentionedFiles: ["src/lib/host-api.ts"],
      mentionedSymbols: ["sendMessage"],
      promptPresentFiles: ["src/components/chat/Composer.tsx"],
      tokenBudget: 256,
      refreshPolicy: "force",
      metadata: { fixture: true },
    });
    const tag = buildAgentMapTagFixture({
      metadata: { extractedBy: "fixture-symbol-source" },
    });
    const reason = buildAgentMapRankingReasonFixture({
      kind: "fromActiveFileReference",
      scoreDelta: 30,
      metadata: { activeFile: "src/components/chat/Composer.tsx" },
    });
    const evidence = buildAgentMapEvidenceFixture({
      reasonKinds: [reason.kind],
      tagIds: [tag.tagId],
    });
    const rankedTag = buildAgentMapRankedTagFixture({
      tag,
      reasons: [reason],
      evidenceRefs: tag.evidenceRefs,
    });
    const result = buildAgentMapResultFixture({
      tokenBudget: request.tokenBudget,
      tokenEstimate: 56,
      includedSymbols: [rankedTag],
      evidence: [evidence],
    });

    expect(isAgentMapRequest(request)).toBe(true);
    expect(isAgentMapTag(tag)).toBe(true);
    expect(isAgentMapRankingReason(reason)).toBe(true);
    expect(isAgentMapEvidence(evidence)).toBe(true);
    expect(isAgentMapRankedTag(rankedTag)).toBe(true);
    expect(isAgentMapResult(result)).toBe(true);
    expect(result).toMatchObject({
      schemaVersion: 1,
      readonly: true,
      status: "success",
      tokenBudget: 256,
      tokenEstimate: 56,
    });
  });

  it("marks prompt-present files as excluded without making AgentMap authoritative", () => {
    const result = buildAgentMapResultFixture();

    expect(isAgentMapResult(result)).toBe(true);
    expect(result.readonly).toBe(true);
    expect(result.excludedFiles).toContainEqual(
      expect.objectContaining({
        file: "src/components/chat/Composer.tsx",
        included: false,
        reason: "promptPresentFile",
      }),
    );
    expect(result.includedSymbols[0]?.reasons.map((reason) => reason.kind)).toContain(
      "mentionedByUser",
    );
  });

  it("rejects malformed readonly contract values", () => {
    const request = buildAgentMapRequestFixture();
    const tag = buildAgentMapTagFixture();
    const reason = buildAgentMapRankingReasonFixture();
    const evidence = buildAgentMapEvidenceFixture();
    const result = buildAgentMapResultFixture();
    const includedFile = result.includedFiles[0];

    if (!includedFile) {
      throw new Error("AgentMap fixture must include an included file.");
    }
    expect(isAgentMapRequest({ ...request, tokenBudget: -1 })).toBe(false);
    expect(isAgentMapRequest({ ...request, activeFiles: [""] })).toBe(false);
    expect(isAgentMapTag({ ...tag, namePath: [] })).toBe(false);
    expect(isAgentMapTag({
      ...tag,
      range: { ...tag.range, endLine: tag.range.startLine - 1 },
    })).toBe(false);
    expect(isAgentMapRankingReason({ ...reason, kind: "pageRank" })).toBe(false);
    expect(isAgentMapEvidence({
      ...evidence,
      evidenceRefs: [{ type: "file", ref: "" }],
    })).toBe(false);
    expect(isAgentMapResult({ ...result, readonly: false })).toBe(false);
    expect(isAgentMapResult({
      ...result,
      tokenEstimate: result.tokenBudget + 1,
    })).toBe(false);
    expect(isAgentMapResult({
      ...result,
      includedFiles: [{ ...includedFile, included: false }],
    })).toBe(false);
  });
});
