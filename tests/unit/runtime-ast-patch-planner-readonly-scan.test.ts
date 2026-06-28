import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanAstPatchPlannerReadonly } from "../../openclaw_runtime/src/runtime-core";

const CONFIG = {
  runtime: {
    astPatchPlanner: {
      readonlyScan: true,
      previewDiff: true,
    },
  },
};

describe("AST patch planner readonly scan and preview diff", () => {
  it("returns ordered match evidence and a bounded multi-file preview diff", () => {
    const beforeAlpha = fixture("alpha.ts");
    const beforeBeta = fixture("beta.ts");
    const result = scanAstPatchPlannerReadonly({
      rule: {
        language: "typescript",
        pattern: "useLegacy($VALUE)",
        fix: "useModern($VALUE)",
      },
      targetFiles: [target("beta.ts"), target("alpha.ts")],
      config: CONFIG,
    });

    expect(result.status).toBe("success");
    expect(result.matches.map((match) => match.filePath)).toEqual([
      "tests/fixtures/ast-patch-planner/alpha.ts",
      "tests/fixtures/ast-patch-planner/beta.ts",
    ]);
    expect(result.matches[0]).toMatchObject({
      astKind: "CallExpression",
      metavariables: {
        VALUE: {
          text: "input",
        },
      },
    });
    expect(result.previewDiff?.text).toContain("--- a/tests/fixtures/ast-patch-planner/alpha.ts");
    expect(result.previewDiff?.text).toContain("+  const result = useModern(input);");
    expect(result.previewDiff?.text).toContain("--- a/tests/fixtures/ast-patch-planner/beta.ts");
    expect(result.previewDiff?.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.checkpoint).toMatchObject({
      matchCount: 2,
      previewDiffHash: result.previewDiff?.hash,
    });
    expect(fixture("alpha.ts")).toBe(beforeAlpha);
    expect(fixture("beta.ts")).toBe(beforeBeta);
  });

  it("reports unfixable rules as match evidence only", () => {
    const result = scanAstPatchPlannerReadonly({
      rule: {
        language: "typescript",
        pattern: "useLegacy($VALUE)",
      },
      targetFiles: [target("alpha.ts")],
      config: CONFIG,
    });

    expect(result.status).toBe("success");
    expect(result.matches).toHaveLength(1);
    expect(result.previewDiff).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "unfixable_rule",
    }));
  });

  it("handles TSX attribute snippets without exposing a mutation path", () => {
    const result = scanAstPatchPlannerReadonly({
      rule: {
        language: "tsx",
        pattern: "oldName={$VALUE}",
        fix: "newName={$VALUE}",
      },
      targetFiles: [target("component.tsx")],
      config: CONFIG,
    });

    expect(result.status).toBe("success");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      astKind: "JsxAttribute",
      metavariables: {
        VALUE: {
          text: "label",
        },
      },
    });
    expect(result.previewDiff?.text).toContain("+  return <Widget newName={label} />;");
    expect(JSON.stringify(result.authority)).toContain("previewDiffIsNotCompletionEvidence");
  });

  it("fails closed on invalid target inputs", () => {
    const result = scanAstPatchPlannerReadonly({
      rule: {
        language: "typescript",
        pattern: "useLegacy($VALUE)",
        fix: "useModern($VALUE)",
      },
      targetFiles: [
        {
          filePath: "src/**/*.ts",
          content: "",
        },
      ],
      config: CONFIG,
    });

    expect(result.status).toBe("invalid_input");
    expect(result.matches).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid_target_files",
    }));
  });
});

function target(fileName: string) {
  const filePath = `tests/fixtures/ast-patch-planner/${fileName}`;
  return {
    filePath,
    content: fixture(fileName),
  };
}

function fixture(fileName: string): string {
  return readFileSync(path.join(process.cwd(), "tests/fixtures/ast-patch-planner", fileName), "utf8");
}

