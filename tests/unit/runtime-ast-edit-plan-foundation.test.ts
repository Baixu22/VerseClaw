import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  editPlanFromReadonlyAstPatchPlannerScan,
  scanAstPatchPlannerReadonly,
  type EditPlan,
} from "../../openclaw_runtime/src/runtime-core";

const SCAN_CONFIG = {
  runtime: {
    astPatchPlanner: {
      readonlyScan: true,
    },
  },
};

const SCAN_AND_PREVIEW_CONFIG = {
  runtime: {
    astPatchPlanner: {
      readonlyScan: true,
      previewDiff: true,
    },
  },
};

const RULE = {
  language: "typescript",
  pattern: "useLegacy($VALUE)",
  fix: "useModern($VALUE)",
} as const;

describe("AST EditPlan IR foundation", () => {
  it("maps readonly scan evidence into a structured EditPlan shape", () => {
    const scan = scanAstPatchPlannerReadonly({
      rule: RULE,
      targetFiles: [target("alpha.ts")],
      config: SCAN_AND_PREVIEW_CONFIG,
    });
    const plan: EditPlan = editPlanFromReadonlyAstPatchPlannerScan(scan, {
      sourceScope: {
        kind: "agent_map_symbol_scope",
        description: "AgentMap/Symbol selected fixture target.",
      },
    });

    expect(plan).toMatchObject({
      schemaVersion: 1,
      engineId: "runtime.ast_patch_planner.typescript_text_matcher.prototype",
      source: {
        kind: "ast_patch_planner_readonly_scan",
        mode: "readonly_scan",
        prototypeOnly: true,
        productionEngine: false,
      },
      mode: "readonly_scan",
      sourceScope: {
        kind: "agent_map_symbol_scope",
        targetFilePaths: ["tests/fixtures/ast-patch-planner/alpha.ts"],
      },
      applyEligibility: {
        status: "eligible_after_verification",
        descriptiveOnly: true,
      },
      authority: {
        planningOnly: true,
        readonly: true,
        noPatchApply: true,
        noWorkspaceMutation: true,
        noSymbolMutation: true,
        explicitApplyGateRequired: true,
      },
      previewDiff: {
        requested: true,
        available: true,
      },
    });
    expect(plan.planId).toMatch(/^edit_plan_[a-f0-9]{24}$/u);
    expect(plan.targetFiles).toEqual([
      expect.objectContaining({
        filePath: "tests/fixtures/ast-patch-planner/alpha.ts",
        sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(plan.sourceHashes).toEqual({
      "tests/fixtures/ast-patch-planner/alpha.ts": expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(plan.matchEvidence).toEqual([
      expect.objectContaining({
        matchId: "match_0001",
        astKind: "CallExpression",
        excerptHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        metavariableHashes: {
          VALUE: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      }),
    ]);
    expect(plan.orderedOperations).toEqual([
      expect.objectContaining({
        order: 1,
        operationId: "operation_0001",
        kind: "replace_range",
        replacementHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(plan.verifierRequirements).toMatchObject({
      requiredBeforeApplyGate: true,
      requirements: expect.arrayContaining([
        expect.objectContaining({
          id: "source_hashes_present",
          status: "satisfied_by_readonly_scan",
        }),
        expect.objectContaining({
          id: "evidence_verifier_review",
          status: "pending",
        }),
      ]),
    });
    expect(plan.conflictDiagnostics).toEqual([]);
  });

  it("represents unfixable rules as match-only operations and ineligible plans", () => {
    const scan = scanAstPatchPlannerReadonly({
      rule: {
        language: "typescript",
        pattern: "useLegacy($VALUE)",
      },
      targetFiles: [target("alpha.ts")],
      config: SCAN_AND_PREVIEW_CONFIG,
    });
    const plan = editPlanFromReadonlyAstPatchPlannerScan(scan);

    expect(plan.previewDiff).toMatchObject({
      requested: true,
      available: false,
      unavailableReason: "unfixable_rule",
    });
    expect(plan.orderedOperations).toEqual([
      expect.objectContaining({
        kind: "match_only",
        reason: "unfixable_rule",
      }),
    ]);
    expect(plan.applyEligibility).toMatchObject({
      status: "ineligible",
      reasons: expect.arrayContaining(["unfixable_rule"]),
    });
  });

  it("keeps preview diff disabled plans review-required without losing operations", () => {
    const scan = scanAstPatchPlannerReadonly({
      rule: RULE,
      targetFiles: [target("alpha.ts")],
      config: SCAN_CONFIG,
    });
    const plan = editPlanFromReadonlyAstPatchPlannerScan(scan);

    expect(plan.previewDiff).toMatchObject({
      requested: false,
      available: false,
      unavailableReason: "preview_diff_disabled",
    });
    expect(plan.orderedOperations).toEqual([
      expect.objectContaining({
        kind: "replace_range",
        replacementHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(plan.applyEligibility).toMatchObject({
      status: "review_required",
      reasons: expect.arrayContaining(["preview_diff:preview_diff_disabled"]),
    });
    expect(plan.verifierRequirements.requirements).toContainEqual(expect.objectContaining({
      id: "preview_diff_available",
      status: "pending",
      diagnostics: ["preview_diff_disabled"],
    }));
  });

  it("maps overlap diagnostics into review-required conflict diagnostics", () => {
    const scan = scanAstPatchPlannerReadonly({
      rule: RULE,
      targetFiles: [target("nested-overlap.ts")],
      config: SCAN_AND_PREVIEW_CONFIG,
    });
    const plan = editPlanFromReadonlyAstPatchPlannerScan(scan);

    expect(plan.applyEligibility).toMatchObject({
      status: "review_required",
      reasons: expect.arrayContaining([
        "readonly_scan_status:review_required",
        "conflict_diagnostics_present",
      ]),
    });
    expect(plan.previewDiff).toMatchObject({
      requested: true,
      available: false,
      unavailableReason: "review_required",
    });
    expect(plan.conflictDiagnostics).toEqual([
      expect.objectContaining({
        code: "overlapping_ranges",
        severity: "error",
      }),
    ]);
    expect(plan.verifierRequirements.requirements).toContainEqual(expect.objectContaining({
      id: "no_conflict_diagnostics",
      status: "blocked",
      diagnostics: ["overlapping_ranges"],
    }));
  });
});

function target(fileName: string) {
  const filePath = `tests/fixtures/ast-patch-planner/${fileName}`;
  return {
    filePath,
    content: readFileSync(path.join(process.cwd(), filePath), "utf8"),
  };
}
