import { describe, expect, it } from "vitest";
import {
  buildAgentMapPromptCandidateRuntimeShadowReport,
  buildBudgetedAgentMapResult,
  resolveRuntimeAgentMapPromptCandidateRuntimeShadowFlags,
} from "../../openclaw_runtime/src/runtime-core";
import {
  buildClawxLikeAgentMapFixtureRequest,
  readClawxLikeAgentMapFixtureFiles,
} from "../fixtures/agent-map/fixture-loader";

const ENABLED_CONFIG = {
  runtime: {
    agentMap: {
      promptAssemblyExperiment: true,
      promptCandidateRuntimeShadow: true,
    },
  },
};

async function buildClawxLikeResult(overrides = {}) {
  return buildBudgetedAgentMapResult({
    request: buildClawxLikeAgentMapFixtureRequest({
      mentionedSymbols: ["dispatchRuntimeMessage"],
      tokenBudget: 1000,
      ...overrides,
    }),
    files: readClawxLikeAgentMapFixtureFiles(),
    contextLines: 0,
  });
}

describe("AgentMap prompt candidate runtime shadow", () => {
  it("requires double opt-in and stores diagnostics instead of candidate text", async () => {
    const result = await buildClawxLikeResult();
    const report = buildAgentMapPromptCandidateRuntimeShadowReport({
      result,
      config: { runtime: { agentMap: { promptCandidateRuntimeShadow: true } } },
      tokenBudget: 700,
      generatedAt: 123,
      runtime: { source: "runtime" },
    });

    expect(resolveRuntimeAgentMapPromptCandidateRuntimeShadowFlags(ENABLED_CONFIG)).toEqual({
      promptAssemblyExperiment: true,
      promptCandidateRuntimeShadow: true,
      enabled: true,
    });
    expect(report.status).toBe("disabled");
    expect(report.flags).toEqual({
      promptAssemblyExperiment: false,
      promptCandidateRuntimeShadow: true,
      enabled: false,
    });
    expect(report.candidate.contentLength).toBe(0);
    expect(report.candidate.contentHash).toBe("");
    expect("content" in report.candidate).toBe(false);
    expect(report.candidate.candidateTextStored).toBe(false);
    expect(report.candidate.candidateTextInsertedIntoPrompt).toBe(false);
    expect(report.authority).toMatchObject({
      noPromptCutover: true,
      noPromptAuthority: true,
      noToolAuthority: true,
      noRuntimeAuthority: true,
      noGatewayCutover: true,
      noProviderTransportCutover: true,
      noModelMessageCutover: true,
      taskLoopDecisionUnaffected: true,
    });
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "flag_disabled",
    }));
  });

  it("measures enabled candidate metadata without exposing candidate content", async () => {
    const result = await buildClawxLikeResult();
    const report = buildAgentMapPromptCandidateRuntimeShadowReport({
      result,
      config: ENABLED_CONFIG,
      tokenBudget: 700,
      generatedAt: 456,
      runtime: {
        source: "task_loop",
        loopRunId: "loop_shadow",
        sessionKey: "agent:main:abc",
        phase: "self_check",
        status: "running",
        iteration: 1,
        contextPackHash: "context-hash",
      },
    });

    expect(report.status).toBe("success");
    expect(report.runtime).toEqual({
      source: "task_loop",
      loopRunId: "loop_shadow",
      sessionKey: "agent:main:abc",
      phase: "self_check",
      status: "running",
      iteration: 1,
      contextPackHash: "context-hash",
    });
    expect(report.candidate.tokenEstimate).toBeLessThanOrEqual(report.candidate.tokenBudget);
    expect(report.candidate.contentLength).toBeGreaterThan(0);
    expect(report.candidate.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.candidate.includedSymbolCount).toBeGreaterThan(0);
    expect("content" in report.candidate).toBe(false);
    expect(report.metadata).toMatchObject({
      candidateTextMeasuredOnly: true,
      candidateTextStored: false,
      candidateTextInsertedIntoPrompt: false,
      noPromptAuthority: true,
      noRuntimeAuthority: true,
    });
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "candidate_measured",
    }));
  });

  it("records prompt-present exclusions as diagnostics only", async () => {
    const result = await buildClawxLikeResult({
      promptPresentFiles: [],
      tokenBudget: 1200,
    });
    const report = buildAgentMapPromptCandidateRuntimeShadowReport({
      result,
      config: ENABLED_CONFIG,
      tokenBudget: 800,
      promptPresentFiles: ["src/pages/Chat/Composer.tsx"],
      runtime: { source: "runtime" },
    });

    expect(report.candidate.promptPresentExcludedCount).toBeGreaterThan(0);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: "prompt_present_file_excluded",
      file: "src/pages/Chat/Composer.tsx",
    }));
    expect(report.authority.legacyPromptAuthoritative).toBe(true);
  });
});
