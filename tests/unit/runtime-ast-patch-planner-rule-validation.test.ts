import { describe, expect, it } from "vitest";
import { validateAstPatchPlannerRule } from "../../openclaw_runtime/src/runtime-core";

describe("AST patch planner rule validation", () => {
  it("accepts the MVP TypeScript pattern and fix shape", () => {
    const result = validateAstPatchPlannerRule({
      id: "use-modern-call",
      language: "typescript",
      pattern: "useLegacy($VALUE)",
      fix: "useModern($VALUE)",
      constraints: {
        VALUE: "\\w+",
      },
    });

    expect(result).toMatchObject({
      status: "accepted",
      language: "typescript",
      patternMetavariables: ["VALUE"],
      fixMetavariables: ["VALUE"],
    });
    expect(result.ruleHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects unsupported languages and invalid pattern/fix shapes", () => {
    expect(validateAstPatchPlannerRule({
      language: "javascript",
      pattern: "useLegacy($VALUE)",
      fix: "useModern($VALUE)",
    }).diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid_language",
    }));

    expect(validateAstPatchPlannerRule({
      language: "typescript",
      pattern: "",
      fix: 42,
    }).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_pattern" }),
      expect.objectContaining({ code: "invalid_fix" }),
    ]));
  });

  it("rejects unbound metavariables and unsupported transform surfaces", () => {
    expect(validateAstPatchPlannerRule({
      language: "typescript",
      pattern: "useLegacy($VALUE)",
      fix: "useModern($MISSING)",
    })).toMatchObject({
      status: "rejected",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "unbound_metavariable" }),
      ]),
    });

    expect(validateAstPatchPlannerRule({
      language: "typescript",
      pattern: "useLegacy($VALUE)",
      fix: "useModern($VALUE)",
      transform: { VALUE: "trim" },
    })).toMatchObject({
      status: "rejected",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "unsupported_transform" }),
      ]),
    });
  });

  it("rejects overbroad patterns and unbound constraints", () => {
    expect(validateAstPatchPlannerRule({
      language: "typescript",
      pattern: "$ANY",
      fix: "$ANY",
    })).toMatchObject({
      status: "rejected",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "overbroad_pattern" }),
      ]),
    });

    expect(validateAstPatchPlannerRule({
      language: "typescript",
      pattern: "useLegacy($VALUE)",
      fix: "useModern($VALUE)",
      constraints: {
        MISSING: "\\w+",
      },
    })).toMatchObject({
      status: "rejected",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "unbound_metavariable" }),
      ]),
    });
  });

  it("bounds validation diagnostics", () => {
    const result = validateAstPatchPlannerRule({
      language: "javascript",
      pattern: "$ANY",
      fix: "$MISSING",
      transform: { VALUE: "trim" },
      constraints: {
        MISSING: "\\w+",
      },
    }, { maxDiagnostics: 2 });

    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[1]).toMatchObject({
      code: "diagnostics_truncated",
    });
  });
});
