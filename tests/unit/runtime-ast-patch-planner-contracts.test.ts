import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveRuntimeAstPatchPlannerFlags,
  scanAstPatchPlannerReadonly,
} from "../../openclaw_runtime/src/runtime-core";

const ENABLED_SCAN_CONFIG = {
  runtime: {
    astPatchPlanner: {
      readonlyScan: true,
    },
  },
};

const ENABLED_SCAN_AND_PREVIEW_CONFIG = {
  runtime: {
    astPatchPlanner: {
      readonlyScan: true,
      previewDiff: true,
    },
  },
};

describe("AST patch planner contracts and flags", () => {
  it("keeps readonly scan and preview diff default-off by omission", () => {
    expect(resolveRuntimeAstPatchPlannerFlags({})).toEqual({
      readonlyScan: false,
      previewDiff: false,
    });

    const result = scanAstPatchPlannerReadonly({
      rule: {
        language: "typescript",
        pattern: "useLegacy($VALUE)",
        fix: "useModern($VALUE)",
      },
      targetFiles: [target("alpha.ts")],
      config: {},
    });

    expect(result.status).toBe("skipped");
    expect(result.matches).toEqual([]);
    expect(result.previewDiff).toBeUndefined();
    expect(result.checkpoint).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "flag_disabled",
    }));
    expect(result.authority).toMatchObject({
      diagnosticsOnly: true,
      readonly: true,
      noPatchApply: true,
      noWorkspaceMutation: true,
      noSymbolMutation: true,
      noTaskLoopInvocation: true,
      noGatewayIntegration: true,
      noProviderTransportChange: true,
      previewDiffOnly: true,
      previewDiffIsNotCompletionEvidence: true,
    });
  });

  it("separates readonly scan opt-in from preview diff opt-in", () => {
    expect(resolveRuntimeAstPatchPlannerFlags(ENABLED_SCAN_AND_PREVIEW_CONFIG)).toEqual({
      readonlyScan: true,
      previewDiff: true,
    });

    const result = scanAstPatchPlannerReadonly({
      rule: {
        language: "typescript",
        pattern: "useLegacy($VALUE)",
        fix: "useModern($VALUE)",
      },
      targetFiles: [target("alpha.ts")],
      config: ENABLED_SCAN_CONFIG,
    });

    expect(result.status).toBe("success");
    expect(result.matches).toHaveLength(1);
    expect(result.previewDiff).toBeUndefined();
    expect(result.checkpoint).toMatchObject({
      schemaVersion: 1,
      matchCount: 1,
      previewDiffHash: "",
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "preview_diff_disabled",
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

