import { describe, expect, it } from "vitest";
import {
  AGENT_MAP_INVESTIGATION_REQUIRED_REPLAY_IDS,
  classifyLowPollutionGate,
  buildAgentMapInvestmentReplayCorpus,
  investigateAgentMapInvestment,
} from "./helpers/agent-map-investment-investigation";

describe("AgentMap investment investigation", () => {
  it("expands replay coverage across real fixture families", async () => {
    const corpus = await buildAgentMapInvestmentReplayCorpus();

    expect(corpus.map((item) => item.id)).toEqual([
      ...AGENT_MAP_INVESTIGATION_REQUIRED_REPLAY_IDS,
    ]);
    expect(corpus).toHaveLength(8);
    expect(new Set(corpus.map((item) => item.fixture))).toEqual(
      new Set(["tsx-electron-workspace", "clawx-like-workspace"]),
    );
    expect(new Set(corpus.map((item) => item.state))).toEqual(
      new Set(["successful", "failed", "blocked", "negative_control"]),
    );
    expect(corpus.some((item) => item.expectedStatus === "legacy")).toBe(true);
    expect(corpus.every((item) => item.files.length > 0)).toBe(true);
  });

  it("separates replay gaps from explicit pilot consumption safety", async () => {
    const report = await investigateAgentMapInvestment(0);

    expect(report.deterministicReplayInputs).toBe(true);
    expect(report.noRuntimeAuthorityChange).toBe(true);
    expect(report.noDefaultOnRecommendation).toBe(true);
    expect(report.replayCorpus).toMatchObject({
      status: "pass",
      caseCount: 8,
      fixtureCount: 2,
      realFixtureFileCount: 10,
      insertedCount: 7,
      failClosedCount: 1,
      expectedStatusMatches: 8,
      promptPresentLeakCount: 0,
      defaultPromptDriftCount: 0,
      authorityEscalationCount: 0,
    });
    expect(report.replayCorpus.expectedSymbolRecall).toBe(1);
    expect(report.replayCorpus.expectedFileRecall).toBe(1);
    expect(report.explicitPilotQuality).toEqual({
      status: "pass",
      observedCases: 8,
      insertedCases: 7,
      failClosedCases: 1,
      surfaceInsertionCount: 7,
      defaultPromptDriftCount: 0,
      nonAllowedSurfaceLeakCount: 0,
      authorityEscalationCount: 0,
      promptPresentExcludedCases: 1,
      diagnosticCoverageCount: 8,
      candidateBudgetFitCount: 8,
      qualityScore: 100,
    });
    expect(report.lowPollutionGate).toMatchObject({
      status: "gate-eligible",
      reliability: "gate-eligible",
      strictGateExpectedExit: 0,
      ciGradePerformanceClaimAllowed: true,
    });
    expect(report.recommendation).toBe("continue_evidence_investment");
    expect(report.observations.filter((item) => item.missingSymbols.length > 0))
      .toHaveLength(0);
  });

  it("makes the low-pollution performance gate fail closed under pollution", () => {
    expect(classifyLowPollutionGate(10)).toMatchObject({
      status: "gate-eligible",
      reliability: "gate-eligible",
      strictGateExpectedExit: 0,
      ciGradePerformanceClaimAllowed: true,
      nextAction: "run_agent_map_validate_gate",
    });
    expect(classifyLowPollutionGate(11)).toMatchObject({
      status: "blocked_by_pollution",
      reliability: "informational",
      strictGateExpectedExit: 2,
      ciGradePerformanceClaimAllowed: false,
      nextAction: "retry_in_clean_worker",
    });
  });
});
