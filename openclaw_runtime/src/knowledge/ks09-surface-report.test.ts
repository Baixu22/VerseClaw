import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertNoFalseGraduation,
  buildSurfaceReport,
  loadKnowledgeSurfacePlan,
  SIX_KNOWLEDGE_SURFACES,
  type KnowledgeCommandResult,
  type KnowledgeSurfaceReport,
} from "./ks09-surface-report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "ks09-surface-plan.json");

function passingResult(commands: string[]): Record<string, KnowledgeCommandResult> {
  return Object.fromEntries(commands.map((commandId, index) => [
    commandId,
    {
      commandId,
      label: commandId,
      kind: "unit",
      exitCode: 0,
      testFilesPassed: 1,
      testsPassed: 4 + index,
      testsFailed: 0,
      durationMs: 120,
      outputSummary: `${4 + index} passed`,
    },
  ]));
}

describe("KS-09 per-surface canary/graduation report", () => {
  it("loads the committed surface plan with six surfaces and false product locks", () => {
    const plan = loadKnowledgeSurfacePlan(fixturePath);
    expect(plan.schema).toBe("KnowledgeSurfacePlan/v1");
    expect(plan.productLocks).toEqual({
      liveReady: false,
      productApproved: false,
      defaultOn: false,
    });
    expect(plan.surfaces.map((surface) => surface.id)).toEqual(SIX_KNOWLEDGE_SURFACES);
    for (const surface of plan.surfaces) {
      expect(surface.currentStage).toBeTruthy();
      expect(surface.evaluation.commands.length).toBeGreaterThan(0);
    }
  });

  it("keeps every report below product approval and never relabels E1-E3 as E4/E5", () => {
    const plan = loadKnowledgeSurfacePlan(fixturePath);
    const reports: KnowledgeSurfaceReport[] = plan.surfaces.map((surface) =>
      buildSurfaceReport({
        plan,
        surface,
        results: passingResult(surface.evaluation.commands.map((command) => command.id)),
        productLocks: plan.productLocks,
        includeE2e: true,
        generatedAt: "2026-08-18T12:00:00.000Z",
      }),
    );
    expect(reports).toHaveLength(6);
    for (const report of reports) {
      expect(["E1", "E2", "E3"]).toContain(report.evidenceLevel);
      expect(report.e4).toBe("not-evaluated");
      expect(report.e5).toBe("blocked");
      expect(report.claims).toEqual({
        liveReady: false,
        productApproved: false,
        defaultOn: false,
        ga: false,
      });
      expect(["shadow", "opt-in"]).toContain(report.currentStage);
      expect(report.metrics.length).toBeGreaterThan(0);
      expect(() => assertNoFalseGraduation(report, plan.productLocks)).not.toThrow();
    }
  });

  it("fails closed on any default-on / GA / productApproved claim", () => {
    const plan = loadKnowledgeSurfacePlan(fixturePath);
    const surface = plan.surfaces[0]!;
    const base = buildSurfaceReport({
      plan,
      surface,
      results: passingResult(surface.evaluation.commands.map((command) => command.id)),
      productLocks: plan.productLocks,
      includeE2e: true,
      generatedAt: "2026-08-18T12:00:00.000Z",
    });
    expect(() =>
      assertNoFalseGraduation(
        { ...base, claims: { ...base.claims, defaultOn: true } },
        plan.productLocks,
      ),
    ).toThrow(/defaultOn/);
    expect(() =>
      assertNoFalseGraduation(
        { ...base, claims: { ...base.claims, productApproved: true } },
        plan.productLocks,
      ),
    ).toThrow(/productApproved/);
    expect(() =>
      assertNoFalseGraduation(
        { ...base, currentStage: "consider-default-on" },
        plan.productLocks,
      ),
    ).toThrow(/consider-default-on/);
  });

  it("rejects E4/E5 labels that do not carry real E4/E5 evidence", () => {
    const plan = loadKnowledgeSurfacePlan(fixturePath);
    const surface = plan.surfaces[0]!;
    const report = buildSurfaceReport({
      plan,
      surface,
      results: passingResult(surface.evaluation.commands.map((command) => command.id)),
      productLocks: plan.productLocks,
      includeE2e: false,
      generatedAt: "2026-08-18T12:00:00.000Z",
    });
    expect(report.evidenceLevel).toBe("E2");
    expect(() =>
      assertNoFalseGraduation(
        { ...report, evidenceLevel: "E4" },
        plan.productLocks,
      ),
    ).toThrow(/E4/);
  });
});
