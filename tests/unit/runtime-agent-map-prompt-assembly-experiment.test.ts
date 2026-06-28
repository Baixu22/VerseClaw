import { describe, expect, it } from "vitest";
import {
  assembleAgentMapPromptAssemblyExperimentCandidate,
  buildBudgetedAgentMapResult,
  resolveRuntimeAgentMapPromptAssemblyExperimentFlag,
} from "../../openclaw_runtime/src/runtime-core";
import {
  buildClawxLikeAgentMapFixtureRequest,
  readClawxLikeAgentMapFixtureFiles,
} from "../fixtures/agent-map/fixture-loader";

const ENABLED_CONFIG = {
  runtime: { agentMap: { promptAssemblyExperiment: true } },
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

describe("AgentMap prompt assembly experiment", () => {
  it("stays default-off unless explicitly opted in", async () => {
    const result = await buildClawxLikeResult();
    const candidate = assembleAgentMapPromptAssemblyExperimentCandidate({
      result,
      config: {},
      tokenBudget: 600,
    });

    expect(resolveRuntimeAgentMapPromptAssemblyExperimentFlag({})).toBe(false);
    expect(resolveRuntimeAgentMapPromptAssemblyExperimentFlag(ENABLED_CONFIG)).toBe(true);
    expect(candidate.status).toBe("disabled");
    expect(candidate.content).toBe("");
    expect(candidate.includedSymbols).toEqual([]);
    expect(candidate.metadata).toMatchObject({
      experimental: true,
      readonlyAgentMap: true,
      defaultOff: true,
      optIn: false,
      noPromptCutover: true,
      noPromptAuthority: true,
      noToolAuthority: true,
      noRuntimeAuthority: true,
      legacyPromptAuthoritative: true,
    });
    expect(candidate.diagnostics).toContainEqual(expect.objectContaining({
      code: "flag_disabled",
    }));
  });

  it("assembles deterministic bounded candidate text with complete symbol blocks", async () => {
    const result = await buildClawxLikeResult();
    const first = assembleAgentMapPromptAssemblyExperimentCandidate({
      result,
      config: ENABLED_CONFIG,
      tokenBudget: 620,
    });
    const second = assembleAgentMapPromptAssemblyExperimentCandidate({
      result: {
        ...result,
        includedSymbols: [...result.includedSymbols].reverse(),
      },
      config: ENABLED_CONFIG,
      tokenBudget: 620,
    });

    expect(first.status).toBe("success");
    expect(first.tokenEstimate).toBeLessThanOrEqual(first.tokenBudget);
    expect(first.content).toBe(second.content);
    expect(first.content).toContain("AgentMap experimental prompt candidate");
    expect(first.content).toContain("@@ symbol dispatchRuntimeMessage (function)");
    expect(first.content).toContain("@@ end tag:openclaw_runtime/src/runtime-core/chat-dispatch.ts");
    expect((first.content.match(/@@ symbol /g) ?? []).length)
      .toBe((first.content.match(/@@ end /g) ?? []).length);
    expect(first.metadata).toMatchObject({
      optIn: true,
      candidateKind: "prompt_addendum",
      boundedByCallerTokenBudget: true,
      noPromptCutover: true,
      noRuntimeAuthority: true,
    });
  });

  it("keeps prompt-present files out of the experiment candidate", async () => {
    const result = await buildClawxLikeResult({
      promptPresentFiles: [],
      tokenBudget: 1200,
    });
    const candidate = assembleAgentMapPromptAssemblyExperimentCandidate({
      result,
      config: ENABLED_CONFIG,
      tokenBudget: 800,
      promptPresentFiles: ["src/pages/Chat/Composer.tsx"],
    });

    expect(result.includedSymbols.some((rankedTag) =>
      rankedTag.tag.file === "src/pages/Chat/Composer.tsx"
    )).toBe(true);
    expect(candidate.content).not.toContain("src/pages/Chat/Composer.tsx");
    expect(candidate.includedSymbols.every((rankedTag) =>
      rankedTag.tag.file !== "src/pages/Chat/Composer.tsx"
    )).toBe(true);
    expect(candidate.diagnostics).toContainEqual(expect.objectContaining({
      code: "prompt_present_file_excluded",
      file: "src/pages/Chat/Composer.tsx",
    }));
  });

  it("lowers output monotonically as the experiment token budget shrinks", async () => {
    const result = await buildClawxLikeResult();
    const roomy = assembleAgentMapPromptAssemblyExperimentCandidate({
      result,
      config: ENABLED_CONFIG,
      tokenBudget: 900,
    });
    const tight = assembleAgentMapPromptAssemblyExperimentCandidate({
      result,
      config: ENABLED_CONFIG,
      tokenBudget: 300,
    });
    const none = assembleAgentMapPromptAssemblyExperimentCandidate({
      result,
      config: ENABLED_CONFIG,
      tokenBudget: 0,
    });

    expect(tight.tokenEstimate).toBeLessThanOrEqual(roomy.tokenEstimate);
    expect(tight.includedSymbols.length).toBeLessThanOrEqual(roomy.includedSymbols.length);
    expect(none.status).toBe("budget_exhausted");
    expect(none.content).toBe("");
    expect(none.tokenEstimate).toBe(0);
    expect(none.diagnostics).toContainEqual(expect.objectContaining({
      code: "budget_exhausted",
    }));
  });
});
