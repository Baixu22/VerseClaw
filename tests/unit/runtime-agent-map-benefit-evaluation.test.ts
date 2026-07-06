import { describe, expect, it } from "vitest";
import {
  AGENT_MAP_BENEFIT_SCENARIO_IDS,
  buildAgentMapBenefitCorpus,
  evaluateAgentMapBenefit,
} from "./helpers/agent-map-benefit-eval";

describe("AgentMap benefit evaluation", () => {
  it("covers the deterministic virtual ClawX/Electron/runtime corpus", async () => {
    const corpus = await buildAgentMapBenefitCorpus();

    expect(corpus.map((scenario) => scenario.id)).toEqual([
      ...AGENT_MAP_BENEFIT_SCENARIO_IDS,
    ]);
    expect(corpus).toHaveLength(12);
    expect(new Set(corpus.flatMap((scenario) => scenario.budgets))).toEqual(
      new Set([128, 512, 1000, 2000]),
    );
    expect(new Set(corpus.flatMap((scenario) => scenario.expectedLayers))).toEqual(
      new Set(["renderer", "main", "runtime", "shared"]),
    );
    expect(corpus.every((scenario) => scenario.candidateFiles.length > 0)).toBe(true);
    expect(
      corpus.every((scenario) =>
        scenario.files.every((file) => typeof file.content === "string")
      ),
    ).toBe(true);
  });

  it("shows deterministic positive lift without expanding runtime authority", async () => {
    const report = await evaluateAgentMapBenefit();

    expect(report.provenance).toBe("controlled_virtual_fixture");
    expect(report.deterministic).toBe(true);
    expect(report.noUserRealData).toBe(true);
    expect(report.metrics.corpusSize).toBe(12);
    expect(report.metrics.positiveScenarioCount).toBe(11);
    expect(report.metrics.positiveBenefitScenarioCount).toBeGreaterThanOrEqual(8);
    expect(report.metrics.relevantSymbolRecallAtBudget).toBeGreaterThanOrEqual(0.75);
    expect(report.metrics.relevantFileRecallAtBudget).toBe(1);
    expect(report.metrics.precision).toBeGreaterThanOrEqual(0.70);
    expect(report.metrics.taskLocalizationLiftVsBaseline).toBeGreaterThan(0);
    expect(report.metrics.agentMapLiftVsNaive).toBeGreaterThan(0.05);
    expect(report.metrics.generatedLeakRate).toBe(0);
    expect(report.metrics.promptPresentRedundancyRate).toBe(0);
    expect(report.metrics.mustRejectLeakRate).toBe(0);
    expect(report.metrics.authorityEscalationCount).toBe(0);
    expect(report.metrics.legacyPromptDriftCount).toBe(0);
    expect(report.metrics.irrelevantTaskInsertionBenefit).toBe(0);
    expect(report.metrics.benefitScore).toBe(98);
    expect(report.metrics.investmentRecommendation).toBe("continue_investment");
    expect(report.recommendationReasons.length).toBeGreaterThan(0);
  });

  it("keeps generated, prompt-present, and irrelevant negative controls harmless", async () => {
    const report = await evaluateAgentMapBenefit();
    const atDecisionBudget = (scenarioId: string) => {
      const scenario = report.scenarios.find((entry) => entry.id === scenarioId);
      expect(scenario).toBeDefined();
      const observation = scenario?.observations.find((entry) =>
        entry.arm === "agentMapExplicit" &&
        entry.budget === report.metrics.decisionBudget
      );
      expect(observation).toBeDefined();
      return observation!;
    };

    const generated = atDecisionBudget("generated-file-false-positive-suppression");
    expect(generated.generatedLeaks).toEqual([]);
    expect(generated.mustRejectLeaks).toEqual([]);
    expect(generated.includedFiles).not.toContain("src/generated/api.generated.ts");

    const promptPresent = atDecisionBudget("prompt-present-exclusion");
    expect(promptPresent.promptPresentLeaks).toEqual([]);
    expect(promptPresent.mustRejectLeaks).toEqual([]);
    expect(promptPresent.includedFiles).not.toContain("src/pages/Chat/Composer.tsx");

    const irrelevant = atDecisionBudget("irrelevant-task-negative-control");
    expect(irrelevant.status).toBe("legacy");
    expect(irrelevant.includedSymbols).toEqual([]);
    expect(irrelevant.authorityEscalated).toBe(false);
    expect(irrelevant.legacyPromptDrift).toBe(false);
  });
});
