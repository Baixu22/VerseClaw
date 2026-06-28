import { describe, expect, it } from "vitest";
import {
  buildBudgetedAgentMapResult,
  extractAgentMapTagsFromSources,
  rankAgentMapTags,
  type AgentMapRankedTag,
  type AgentMapRankingReasonKind,
} from "../../openclaw_runtime/src/runtime-core";
import {
  buildClawxLikeAgentMapFixtureRequest,
  readClawxLikeAgentMapFixtureFiles,
} from "../fixtures/agent-map/fixture-loader";

function requireRankedTag(
  ranked: AgentMapRankedTag[],
  name: string,
): AgentMapRankedTag {
  const tag = ranked.find((item) => item.tag.name === name);
  if (!tag) {
    throw new Error(`Expected AgentMap ranked tag for ${name}.`);
  }
  return tag;
}

function reasonKinds(tag: AgentMapRankedTag): AgentMapRankingReasonKind[] {
  return tag.reasons.map((reason) => reason.kind);
}

describe("AgentMap ClawX-like fixture quality", () => {
  it("lifts active-file references and exact mentioned symbols with explainable evidence", async () => {
    const files = readClawxLikeAgentMapFixtureFiles();
    const tags = await extractAgentMapTagsFromSources({ files });
    const ranked = rankAgentMapTags({
      request: buildClawxLikeAgentMapFixtureRequest(),
      tags,
    });

    const sendClawMessage = requireRankedTag(ranked, "sendClawMessage");
    const dispatchRuntimeMessage = requireRankedTag(ranked, "dispatchRuntimeMessage");
    const tokenOnlyNeighbor = requireRankedTag(ranked, "buildDispatchRuntimeMessageNote");
    const pathOnlyNeighbor = requireRankedTag(ranked, "runtimeMessageQueueState");
    const promptPresentComponent = requireRankedTag(ranked, "ChatComposer");

    const activeReferenceReason = sendClawMessage.reasons.find(
      (reason) => reason.kind === "fromActiveFileReference",
    );
    expect(sendClawMessage.tag.file).toBe("src/lib/host-api.ts");
    expect(activeReferenceReason?.metadata).toMatchObject({
      activeFiles: ["src/pages/Chat/Composer.tsx"],
    });
    expect(activeReferenceReason?.metadata?.referenceCount).toBeGreaterThanOrEqual(1);
    expect(activeReferenceReason?.evidenceRefs.some((ref) =>
      ref.type === "file" &&
      ref.label === "AgentMap symbol reference" &&
      ref.ref.startsWith("src/pages/Chat/Composer.tsx:")
    )).toBe(true);

    const exactMentionReason = dispatchRuntimeMessage.reasons.find(
      (reason) => reason.kind === "mentionedByUser",
    );
    expect(ranked[0]?.tag.name).toBe("dispatchRuntimeMessage");
    expect(exactMentionReason?.metadata).toMatchObject({
      exact: true,
      mention: "dispatchruntimemessage",
    });
    expect(dispatchRuntimeMessage.evidenceRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "trace",
        ref: "agent-map:mentioned-symbol:dispatchruntimemessage",
        label: "Mentioned symbol",
      }),
      expect.objectContaining({
        type: "file",
        ref: "openclaw_runtime/src/runtime-core/chat-dispatch.ts:7",
        label: "AgentMap symbol definition",
      }),
    ]));

    expect(reasonKinds(tokenOnlyNeighbor)).toEqual(expect.arrayContaining([
      "mentionedByUser",
      "pathComponentMatch",
    ]));
    expect(tokenOnlyNeighbor.reasons.find((reason) =>
      reason.kind === "mentionedByUser"
    )?.metadata).toMatchObject({ exact: false });
    expect(reasonKinds(pathOnlyNeighbor)).toContain("pathComponentMatch");
    expect(reasonKinds(pathOnlyNeighbor)).not.toContain("mentionedByUser");
    expect(dispatchRuntimeMessage.rank).toBeLessThan(tokenOnlyNeighbor.rank);
    expect(dispatchRuntimeMessage.score).toBeGreaterThan(pathOnlyNeighbor.score);

    expect(reasonKinds(promptPresentComponent)).toContain("promptPresentFile");
  });

  it("excludes prompt-present files from rendered output while preserving selection evidence", async () => {
    const result = await buildBudgetedAgentMapResult({
      request: buildClawxLikeAgentMapFixtureRequest({ tokenBudget: 1000 }),
      files: readClawxLikeAgentMapFixtureFiles(),
      contextLines: 0,
    });

    expect(result.includedSymbols.some((symbol) =>
      symbol.tag.file === "src/pages/Chat/Composer.tsx"
    )).toBe(false);
    expect(result.excludedFiles).toContainEqual(expect.objectContaining({
      file: "src/pages/Chat/Composer.tsx",
      included: false,
      reason: "promptPresentFile",
      evidenceRefs: [expect.objectContaining({
        type: "file",
        ref: "src/pages/Chat/Composer.tsx",
        label: "Already present in prompt",
      })],
    }));
    const rankingEvidence = result.evidence.find((item) =>
      item.evidenceId === "agent-map:evidence:ranking"
    );
    expect(rankingEvidence?.reasonKinds).toEqual(expect.arrayContaining([
      "mentionedByUser",
      "pathComponentMatch",
      "fromActiveFileReference",
      "budgetFit",
    ]));
  });
});
