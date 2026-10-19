import { describe, expect, it } from "vitest";
import {
  buildRuntimeAcceptance,
  buildRuntimeBoundaryMatrix,
  buildRuntimeNotInScope,
  buildRuntimeOptimizationTargets,
  buildRuntimeOverlapRisks,
  decideRuntimeEffectiveness,
  renderRuntimeEffectivenessMarkdown,
  summarizeRuntimeEffectiveness,
  type RuntimeEffectivenessComponent,
  type RuntimeEffectivenessReport,
} from "./helpers/runtime-effectiveness-eval";

function fixtureComponent(
  id: string,
  decision: RuntimeEffectivenessComponent["decision"],
): RuntimeEffectivenessComponent {
  return {
    id,
    lane: "deterministic",
    triggered: true,
    decision,
    effectivenessScore: decision === "effective" || decision === "shadow-only" ? 1 : 0.25,
    metrics: {},
    evidence: [`${id} evidence`],
    risks: [],
  };
}

describe("runtime effectiveness eval report helpers", () => {
  it("summarizes component decisions and treats AgentMap shadow-only as healthy", () => {
    const components = [
      fixtureComponent("impact-parity", "effective"),
      fixtureComponent("task-mission-repair", "effective"),
      fixtureComponent("clawgraph", "effective"),
      fixtureComponent("agentmap-shadow", "shadow-only"),
      fixtureComponent("transcript-toolcall-repair", "effective"),
    ];

    expect(summarizeRuntimeEffectiveness(components)).toEqual({
      componentCount: 5,
      triggeredCount: 5,
      effectiveCount: 4,
      neutralCount: 0,
      shadowOnlyCount: 1,
      regressionCount: 0,
    });
    expect(decideRuntimeEffectiveness(components)).toEqual({
      status: "effective",
      effectiveComponents: 4,
      blockedComponents: [],
    });
  });

  it("blocks the aggregate decision when a core component is not effective", () => {
    const decision = decideRuntimeEffectiveness([
      fixtureComponent("impact-parity", "not-effective"),
      fixtureComponent("agentmap-shadow", "shadow-only"),
    ]);

    expect(decision.status).toBe("blocked");
    expect(decision.blockedComponents).toEqual(["impact-parity"]);
  });

  it("renders markdown with live lane context and component scores", () => {
    const components = [
      fixtureComponent("impact-parity", "effective"),
      fixtureComponent("agentmap-shadow", "shadow-only"),
    ];
    const report: RuntimeEffectivenessReport = {
      generatedAt: "2026-07-03T00:00:00.000Z",
      mode: "hybrid",
      durationMs: 12.3,
      decision: decideRuntimeEffectiveness(components),
      components,
      summary: summarizeRuntimeEffectiveness(components),
      boundaryMatrix: buildRuntimeBoundaryMatrix(),
      overlaps: buildRuntimeOverlapRisks(),
      optimizationTargets: buildRuntimeOptimizationTargets(components),
      notInScope: buildRuntimeNotInScope(),
      acceptance: buildRuntimeAcceptance(components),
      live: {
        requested: true,
        available: false,
        reason: "no provider",
      },
    };

    const markdown = renderRuntimeEffectivenessMarkdown(report);
    expect(markdown).toContain("# Runtime Effectiveness Evaluation");
    expect(markdown).toContain("| impact-parity | deterministic | yes | effective | 100% |");
    expect(markdown).toContain("Live Lane");
    expect(markdown).toContain("no provider");
    expect(markdown).toContain("Boundary Matrix");
    expect(markdown).toContain("Overlap Risks");
    expect(markdown).toContain("Acceptance Status");
    expect(report.acceptance.status).toBe("passed");
  });
});
