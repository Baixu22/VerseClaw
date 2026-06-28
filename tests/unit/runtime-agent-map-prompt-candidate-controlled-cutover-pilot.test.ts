import { describe, expect, it } from "vitest";
import {
  AGENT_MAP_PROMPT_CANDIDATE_CONTROLLED_CUTOVER_SURFACE,
  assembleAgentMapPromptCandidateControlledCutoverPilot,
  buildAgentMapResultFixture,
  buildBudgetedAgentMapResult,
  resolveRuntimeAgentMapPromptCandidateControlledCutoverFlags,
  type AgentMapRequest,
  type AgentMapResult,
} from "../../openclaw_runtime/src/runtime-core";
import {
  buildClawxLikeAgentMapFixtureRequest,
  readClawxLikeAgentMapFixtureFiles,
} from "../fixtures/agent-map/fixture-loader";

const LEGACY_PROMPT = [
  "System prompt",
  "",
  "Use the existing context only.",
].join("\n");

const ENABLED_CONFIG = {
  runtime: {
    agentMap: {
      promptAssemblyExperiment: true,
      promptCandidateRuntimeShadow: true,
      promptCandidateControlledCutoverPilot: true,
    },
  },
};

async function buildClawxLikeResult(
  overrides: Partial<AgentMapRequest> = {},
): Promise<AgentMapResult> {
  return buildBudgetedAgentMapResult({
    request: buildClawxLikeAgentMapFixtureRequest({
      mentionedSymbols: ["dispatchRuntimeMessage"],
      tokenBudget: 1_200,
      ...overrides,
    }),
    files: readClawxLikeAgentMapFixtureFiles(),
    contextLines: 0,
  });
}

describe("AgentMap prompt candidate controlled cutover pilot", () => {
  it("requires all gates and explicit valid AgentMapResult before leaving legacy prompt bytes", () => {
    const result = buildAgentMapResultFixture();
    const cases = [
      {},
      { runtime: { agentMap: { promptAssemblyExperiment: true } } },
      {
        runtime: {
          agentMap: {
            promptAssemblyExperiment: true,
            promptCandidateRuntimeShadow: true,
          },
        },
      },
      {
        runtime: {
          agentMap: {
            promptCandidateRuntimeShadow: true,
            promptCandidateControlledCutoverPilot: true,
          },
        },
      },
    ];

    expect(resolveRuntimeAgentMapPromptCandidateControlledCutoverFlags(ENABLED_CONFIG))
      .toEqual({
        promptAssemblyExperiment: true,
        promptCandidateRuntimeShadow: true,
        promptCandidateControlledCutoverPilot: true,
        enabled: true,
      });

    for (const config of cases) {
      const pilot = assembleAgentMapPromptCandidateControlledCutoverPilot({
        legacyPrompt: LEGACY_PROMPT,
        result,
        config,
        tokenBudget: 500,
      });

      expect(pilot.status).toBe("legacy");
      expect(pilot.prompt).toBe(LEGACY_PROMPT);
      expect(pilot.metadata.legacyPromptByteIdentical).toBe(true);
      expect(pilot.candidate.insertedIntoControlledPilotSurface).toBe(false);
      expect(pilot.diagnostics).toContainEqual(expect.objectContaining({
        code: "gate_disabled",
      }));
    }

    const missingResult = assembleAgentMapPromptCandidateControlledCutoverPilot({
      legacyPrompt: LEGACY_PROMPT,
      result: { schemaVersion: 1, readonly: true },
      config: ENABLED_CONFIG,
      tokenBudget: 500,
    });
    expect(missingResult.status).toBe("legacy");
    expect(missingResult.prompt).toBe(LEGACY_PROMPT);
    expect(missingResult.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid_agent_map_result",
    }));
  });

  it("inserts candidate text only into the named controlled pilot surface", async () => {
    const result = await buildClawxLikeResult();
    const pilot = assembleAgentMapPromptCandidateControlledCutoverPilot({
      legacyPrompt: LEGACY_PROMPT,
      result,
      config: ENABLED_CONFIG,
      tokenBudget: 700,
      generatedAt: 123,
    });

    expect(pilot.status).toBe("inserted");
    expect(pilot.source).toBe(AGENT_MAP_PROMPT_CANDIDATE_CONTROLLED_CUTOVER_SURFACE);
    expect(pilot.prompt.startsWith(LEGACY_PROMPT)).toBe(true);
    expect(pilot.prompt).toContain("## AgentMap controlled prompt candidate pilot");
    expect(pilot.prompt).toContain("AgentMap experimental prompt candidate");
    expect(pilot.prompt).toContain("@@ symbol dispatchRuntimeMessage (function)");
    expect(pilot.metadata.legacyPromptByteIdentical).toBe(false);
    expect(pilot.metadata).toMatchObject({
      controlledCutoverPilot: true,
      defaultOff: true,
      explicitAgentMapResultRequired: true,
      noDefaultPromptCutover: true,
      noTaskLoopReviewerPromptCutover: true,
      noGatewayCutover: true,
      noProviderTransportCutover: true,
      noModelMessageCutover: true,
      noRuntimeAuthority: true,
      noToolAuthority: true,
      noPersistence: true,
    });
    expect(pilot.candidate).toMatchObject({
      status: "success",
      insertedIntoControlledPilotSurface: true,
      insertedIntoDefaultPrompt: false,
      insertedIntoTaskLoopReviewerPrompt: false,
      insertedIntoGateway: false,
      insertedIntoModelMessages: false,
      insertedIntoProviderTransport: false,
      persisted: false,
    });
    expect(pilot.runtimeShadowReport?.candidate.candidateTextStored).toBe(false);
    expect(pilot.runtimeShadowReport?.candidate.candidateTextInsertedIntoPrompt).toBe(false);
    expect(pilot.diagnostics).toContainEqual(expect.objectContaining({
      code: "candidate_inserted",
    }));
  });

  it("fails closed for budget exhaustion without silently truncating candidate text into prompts", async () => {
    const result = await buildClawxLikeResult();
    const pilot = assembleAgentMapPromptCandidateControlledCutoverPilot({
      legacyPrompt: LEGACY_PROMPT,
      result,
      config: ENABLED_CONFIG,
      tokenBudget: 0,
    });

    expect(pilot.status).toBe("legacy");
    expect(pilot.prompt).toBe(LEGACY_PROMPT);
    expect(pilot.candidate.status).toBe("budget_exhausted");
    expect(pilot.candidate.contentLength).toBe(0);
    expect(pilot.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "candidate_budget_exhausted" }),
    ]));
    expect(pilot.prompt).not.toContain("AgentMap experimental prompt candidate");
    expect(pilot.prompt).not.toContain("@@ symbol");
  });

  it("excludes prompt-present files from the controlled pilot candidate", async () => {
    const result = await buildClawxLikeResult({
      promptPresentFiles: [],
      tokenBudget: 1_500,
    });
    const pilot = assembleAgentMapPromptCandidateControlledCutoverPilot({
      legacyPrompt: LEGACY_PROMPT,
      result,
      config: ENABLED_CONFIG,
      tokenBudget: 900,
      promptPresentFiles: ["src/pages/Chat/Composer.tsx"],
    });

    expect(result.includedSymbols.some((rankedTag) =>
      rankedTag.tag.file === "src/pages/Chat/Composer.tsx"
    )).toBe(true);
    expect(pilot.prompt).not.toContain("## src/pages/Chat/Composer.tsx");
    expect(pilot.candidate.promptPresentExcludedCount).toBeGreaterThan(0);
    expect(pilot.diagnostics).toContainEqual(expect.objectContaining({
      code: "prompt_present_file_excluded",
      file: "src/pages/Chat/Composer.tsx",
    }));
  });
});
