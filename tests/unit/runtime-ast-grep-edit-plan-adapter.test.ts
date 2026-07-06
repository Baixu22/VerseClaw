import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAstGrepEditPlanResumeDrift,
  generateAstGrepEditPlanReadonlyCandidates,
  type AstGrepEditPlanCheckpoint,
} from "../../openclaw_runtime/src/runtime-core";

describe("ast-grep EditPlan readonly candidate adapter", () => {
  it("generates deterministic React prop rename candidates as EditPlan IR", () => {
    const first = generateAstGrepEditPlanReadonlyCandidates({
      rule: {
        language: "tsx",
        pattern: "<Widget oldName={$VALUE} />",
        fix: "<Widget newName={$VALUE} />",
      },
      targetFiles: [target("react-prop-rename.tsx")],
      sourceScope: {
        kind: "agent_map_symbol_scope",
        description: "AgentMap/Symbol selected React component target.",
      },
    });
    const second = generateAstGrepEditPlanReadonlyCandidates({
      rule: {
        language: "tsx",
        pattern: "<Widget oldName={$VALUE} />",
        fix: "<Widget newName={$VALUE} />",
      },
      targetFiles: [target("react-prop-rename.tsx")],
      sourceScope: {
        kind: "agent_map_symbol_scope",
        description: "AgentMap/Symbol selected React component target.",
      },
    });

    expect(first.status).toBe("success");
    expect(first.editPlan.planId).toBe(second.editPlan.planId);
    expect(first.editPlan).toMatchObject({
      engineId: "runtime.ast_grep.napi.readonly_candidate_generation",
      source: {
        kind: "ast_grep_readonly_adapter",
        prototypeOnly: false,
        productionEngine: false,
      },
      sourceScope: {
        kind: "agent_map_symbol_scope",
        targetFilePaths: ["tests/fixtures/ast-grep-edit-plan/react-prop-rename.tsx"],
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
        editPlanIsNotTaskCompletionEvidence: true,
      },
    });
    expect(first.editPlan.matchEvidence).toEqual([
      expect.objectContaining({
        astKind: "jsx_self_closing_element",
        metavariableHashes: {
          VALUE: expect.stringMatching(/^[a-f0-9]{64}$/u),
        },
      }),
    ]);
    expect(first.editPlan.orderedOperations).toEqual([
      expect.objectContaining({
        kind: "replace_range",
        replacementPreview: "<Widget newName={label} />",
      }),
    ]);
    expect(first.editPlan.previewDiff.files).toHaveLength(1);
  });

  it("supports API call migration, import rewrite, IPC route rename, and deprecated option removal", () => {
    const cases = [
      {
        name: "api call migration",
        fileName: "api-call-migration.ts",
        pattern: "oldApi($VALUE)",
        fix: "newApi($VALUE)",
        expected: "newApi(input)",
      },
      {
        name: "import rewrite",
        fileName: "import-rewrite.ts",
        pattern: 'import { legacyThing } from $SOURCE',
        fix: 'import { modernThing as legacyThing } from "modern-lib"',
        expected: 'import { modernThing as legacyThing } from "modern-lib"',
      },
      {
        name: "Electron IPC route rename",
        fileName: "ipc-route-rename.ts",
        pattern: 'ipcRenderer.invoke("old-route", $PAYLOAD)',
        fix: 'ipcRenderer.invoke("new-route", $PAYLOAD)',
        expected: 'ipcRenderer.invoke("new-route", payload)',
      },
      {
        name: "deprecated option removal",
        fileName: "deprecated-option-removal.ts",
        pattern: 'createClient({ endpoint: $ENDPOINT, deprecatedOption: true })',
        fix: "createClient({ endpoint: $ENDPOINT })",
        expected: 'createClient({ endpoint: "/v1" })',
      },
    ] as const;

    for (const item of cases) {
      const result = generateAstGrepEditPlanReadonlyCandidates({
        rule: {
          language: "typescript",
          pattern: item.pattern,
          fix: item.fix,
        },
        targetFiles: [target(item.fileName)],
      });

      expect(result.status, item.name).toBe("success");
      expect(result.editPlan.orderedOperations, item.name).toEqual([
        expect.objectContaining({
          kind: "replace_range",
          replacementPreview: expect.stringContaining(item.expected),
        }),
      ]);
      expect(result.editPlan.previewDiff.available, item.name).toBe(true);
    }
  });

  it("fails closed on invalid and overbroad rules without candidate operations", () => {
    const invalid = generateAstGrepEditPlanReadonlyCandidates({
      rule: {
        language: "typescript",
        pattern: "oldApi($VALUE)",
        fix: "newApi($MISSING)",
      },
      targetFiles: [target("api-call-migration.ts")],
    });
    const overbroad = generateAstGrepEditPlanReadonlyCandidates({
      rule: {
        language: "typescript",
        pattern: "$ANY",
        fix: "$ANY",
      },
      targetFiles: [target("api-call-migration.ts")],
    });

    expect(invalid.status).toBe("invalid_rule");
    expect(invalid.editPlan.orderedOperations).toEqual([]);
    expect(invalid.editPlan.applyEligibility.status).toBe("ineligible");
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({
      code: "unbound_metavariable",
    }));

    expect(overbroad.status).toBe("invalid_rule");
    expect(overbroad.editPlan.orderedOperations).toEqual([]);
    expect(overbroad.editPlan.applyEligibility.status).toBe("ineligible");
    expect(overbroad.diagnostics).toContainEqual(expect.objectContaining({
      code: "overbroad_pattern",
    }));
  });

  it("reports bounded, review-required candidates for over-limit and overlapping matches", () => {
    const overLimit = generateAstGrepEditPlanReadonlyCandidates({
      rule: {
        language: "typescript",
        pattern: "oldApi($VALUE)",
        fix: "newApi($VALUE)",
      },
      targetFiles: [target("overlap-conflict.ts")],
      maxMatches: 1,
    });
    const overlap = generateAstGrepEditPlanReadonlyCandidates({
      rule: {
        language: "typescript",
        pattern: "oldApi($VALUE)",
        fix: "newApi($VALUE)",
      },
      targetFiles: [target("overlap-conflict.ts")],
    });

    expect(overLimit.status).toBe("review_required");
    expect(overLimit.editPlan.matchEvidence).toHaveLength(1);
    expect(overLimit.diagnostics).toContainEqual(expect.objectContaining({
      code: "match_limit_exceeded",
    }));
    expect(overLimit.editPlan.applyEligibility.status).toBe("review_required");

    expect(overlap.status).toBe("review_required");
    expect(overlap.editPlan.conflictDiagnostics).toEqual([
      expect.objectContaining({
        code: "overlapping_ranges",
      }),
    ]);
    expect(overlap.editPlan.previewDiff).toMatchObject({
      requested: true,
      available: false,
      unavailableReason: "review_required",
    });
  });

  it("keeps unfixable readonly scans non-authoritative", () => {
    const result = generateAstGrepEditPlanReadonlyCandidates({
      rule: {
        language: "typescript",
        pattern: "oldApi($VALUE)",
      },
      targetFiles: [target("api-call-migration.ts")],
    });

    expect(result.status).toBe("success");
    expect(result.editPlan.orderedOperations).toEqual([
      expect.objectContaining({
        kind: "match_only",
        reason: "unfixable_rule",
      }),
    ]);
    expect(result.editPlan.applyEligibility.status).toBe("ineligible");
    expect(result.editPlan.previewDiff.unavailableReason).toBe("unfixable_rule");
  });

  it("fails closed on explicit target drift and fingerprint mismatch", () => {
    const first = generateAstGrepEditPlanReadonlyCandidates({
      rule: {
        language: "typescript",
        pattern: "oldApi($VALUE)",
        fix: "newApi($VALUE)",
      },
      targetFiles: [target("api-call-migration.ts")],
    });
    const drifted = {
      ...target("api-call-migration.ts"),
      content: `const inserted = true;\n${target("api-call-migration.ts").content}`,
    };
    const resume = checkAstGrepEditPlanResumeDrift({
      checkpoint: checkpoint(first.checkpoint),
      rule: {
        language: "typescript",
        pattern: "oldApi($VALUE)",
        fix: "newApi($VALUE)",
      },
      targetFiles: [drifted],
    });

    expect(resume.status).toBe("review_required");
    expect(resume.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "source_hash_drift" }),
      expect.objectContaining({ code: "match_range_drift" }),
      expect.objectContaining({ code: "preview_diff_hash_drift" }),
    ]));
  });
});

function target(fileName: string) {
  const filePath = `tests/fixtures/ast-grep-edit-plan/${fileName}`;
  return {
    filePath,
    content: readFileSync(path.join(process.cwd(), filePath), "utf8"),
  };
}

function checkpoint(value: AstGrepEditPlanCheckpoint | undefined): AstGrepEditPlanCheckpoint {
  expect(value).toBeDefined();
  return value as AstGrepEditPlanCheckpoint;
}
