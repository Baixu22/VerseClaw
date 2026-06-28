import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAstPatchPlannerResumeDrift,
  scanAstPatchPlannerReadonly,
  type AstPatchPlannerCheckpoint,
} from "../../openclaw_runtime/src/runtime-core";

const CONFIG = {
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

describe("AST patch planner resume drift and overlap diagnostics", () => {
  it("reports stable resume checkpoints for unchanged readonly inputs", () => {
    const first = scanAstPatchPlannerReadonly({
      rule: RULE,
      targetFiles: [target("alpha.ts")],
      config: CONFIG,
    });

    const resume = checkAstPatchPlannerResumeDrift({
      checkpoint: checkpoint(first.checkpoint),
      rule: RULE,
      targetFiles: [target("alpha.ts")],
      config: CONFIG,
    });

    expect(resume.status).toBe("stable");
    expect(resume.diagnostics).toEqual([]);
    expect(resume.scan.checkpoint).toEqual(first.checkpoint);
  });

  it("fails closed when source ranges and preview hash drift", () => {
    const first = scanAstPatchPlannerReadonly({
      rule: RULE,
      targetFiles: [target("alpha.ts")],
      config: CONFIG,
    });
    const changed = {
      ...target("alpha.ts"),
      content: `const drift = true;\n${target("alpha.ts").content}`,
    };

    const resume = checkAstPatchPlannerResumeDrift({
      checkpoint: checkpoint(first.checkpoint),
      rule: RULE,
      targetFiles: [changed],
      config: CONFIG,
    });

    expect(resume.status).toBe("review_required");
    expect(resume.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "source_hash_drift" }),
      expect.objectContaining({ code: "match_range_drift" }),
      expect.objectContaining({ code: "preview_diff_hash_drift" }),
    ]));
  });

  it("fails closed when the rule hash changes", () => {
    const first = scanAstPatchPlannerReadonly({
      rule: RULE,
      targetFiles: [target("alpha.ts")],
      config: CONFIG,
    });

    const resume = checkAstPatchPlannerResumeDrift({
      checkpoint: checkpoint(first.checkpoint),
      rule: {
        ...RULE,
        fix: "useNewest($VALUE)",
      },
      targetFiles: [target("alpha.ts")],
      config: CONFIG,
    });

    expect(resume.status).toBe("review_required");
    expect(resume.diagnostics).toContainEqual(expect.objectContaining({
      code: "rule_hash_drift",
    }));
  });

  it("fails closed when target files and match count drift", () => {
    const first = scanAstPatchPlannerReadonly({
      rule: RULE,
      targetFiles: [target("alpha.ts")],
      config: CONFIG,
    });

    const resume = checkAstPatchPlannerResumeDrift({
      checkpoint: checkpoint(first.checkpoint),
      rule: RULE,
      targetFiles: [target("alpha.ts"), target("beta.ts")],
      config: CONFIG,
    });

    expect(resume.status).toBe("review_required");
    expect(resume.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "target_files_drift" }),
      expect.objectContaining({ code: "match_count_drift" }),
    ]));
  });

  it("fails closed when nested matches create overlapping ranges", () => {
    const result = scanAstPatchPlannerReadonly({
      rule: RULE,
      targetFiles: [target("nested-overlap.ts")],
      config: CONFIG,
    });

    expect(result.status).toBe("review_required");
    expect(result.previewDiff).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "overlapping_ranges",
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

function checkpoint(value: AstPatchPlannerCheckpoint | undefined): AstPatchPlannerCheckpoint {
  expect(value).toBeDefined();
  return value as AstPatchPlannerCheckpoint;
}
