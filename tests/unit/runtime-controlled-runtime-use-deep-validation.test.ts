import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  RuntimeContextProviderRegistry,
  buildRuntimeContextProviderManifestFixture,
  collectRuntimeRegistryDiagnostics,
  isolateRuntimeRegistryError,
  resolveRuntimeAstPatchPlannerFlags,
  resolveRuntimeRegistryFeatureFlags,
  scanAstPatchPlannerReadonly,
  type RuntimeContextProvider,
  type RuntimeRegistryDiagnostic,
} from "../../openclaw_runtime/src/runtime-core";

const AST_ENABLED = {
  runtime: {
    astPatchPlanner: {
      readonlyScan: true,
      previewDiff: true,
    },
  },
};

function contextProvider(id: string, order: number): RuntimeContextProvider {
  return {
    manifest: buildRuntimeContextProviderManifestFixture({
      id,
      order,
      priority: order,
      capabilities: ["context.deep-validation"],
    }),
    getContext: () => [],
  };
}

describe("controlled runtime-use deep validation", () => {
  it("keeps both pilots disabled by omission with no default runtime behavior", () => {
    expect(resolveRuntimeAstPatchPlannerFlags({})).toEqual({
      readonlyScan: false,
      previewDiff: false,
    });
    expect(resolveRuntimeRegistryFeatureFlags({})).toMatchObject({
      registryPilotEnabled: false,
      providerRegistryShadow: false,
      contextProviderRegistryPilot: false,
      toolRegistryShadow: false,
      registryDiagnosticsCollector: false,
    });

    const ast = scanAstPatchPlannerReadonly({
      rule: {
        language: "typescript",
        pattern: "legacy($VALUE)",
        fix: "modern($VALUE)",
      },
      targetFiles: [{
        filePath: "deep-validation.ts",
        content: "const value = legacy(input);",
      }],
      config: {},
    });
    const registry = collectRuntimeRegistryDiagnostics({
      toolDiagnostics: [diagnostic("tool", "provider_exception", "error")],
    });

    expect(ast.status).toBe("skipped");
    expect(ast.matches).toEqual([]);
    expect(ast.previewDiff).toBeUndefined();
    expect(registry).toMatchObject({
      enabled: false,
      diagnostics: [],
      omittedDiagnosticCount: 1,
      summary: {
        totalDiagnosticCount: 1,
        includedDiagnosticCount: 0,
      },
    });
  });

  it("shows AST has high candidate value only for narrow explicit readonly rules", () => {
    const files = Array.from({ length: 6 }, (_, fileIndex) => ({
      filePath: `src/deep-${fileIndex}.ts`,
      content: Array.from({ length: 4 }, (_line, lineIndex) =>
        `export const value_${fileIndex}_${lineIndex} = legacy(input_${fileIndex}_${lineIndex});`
      ).join("\n"),
    }));

    const result = scanAstPatchPlannerReadonly({
      rule: {
        language: "typescript",
        pattern: "legacy($VALUE)",
        fix: "modern($VALUE)",
      },
      targetFiles: files,
      config: AST_ENABLED,
      maxMatches: 64,
      maxPreviewDiffBytes: 16_000,
    });

    expect(result.status).toBe("success");
    expect(result.matches).toHaveLength(24);
    expect(result.matches.map((match) => match.filePath)).toEqual(
      [...result.matches.map((match) => match.filePath)].sort(),
    );
    expect(result.previewDiff?.files).toHaveLength(6);
    expect(result.previewDiff?.truncated).toBe(false);
    expect(JSON.stringify(result.authority)).toContain("previewDiffIsNotCompletionEvidence");
  });

  it("shows AST cost and failure risk grow with scanned source volume", () => {
    const targetFiles = Array.from({ length: 24 }, (_, fileIndex) => ({
      filePath: `src/large-${fileIndex}.ts`,
      content: Array.from({ length: 12 }, (_line, lineIndex) =>
        `export const large_${fileIndex}_${lineIndex} = legacy(input_${fileIndex}_${lineIndex});`
      ).join("\n"),
    }));

    const startedAt = performance.now();
    const result = scanAstPatchPlannerReadonly({
      rule: {
        language: "typescript",
        pattern: "legacy($VALUE)",
        fix: "modern($VALUE)",
      },
      targetFiles,
      config: AST_ENABLED,
      maxMatches: 64,
      maxPreviewDiffBytes: 4_000,
    });
    const elapsedMs = performance.now() - startedAt;

    expect(result.status).toBe("review_required");
    expect(result.matches).toHaveLength(0);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "preflight_budget_exceeded",
    }));
    expect(result.previewDiff).toBeUndefined();
    expect(elapsedMs).toBeLessThan(1_500);
  });

  it("shows AST fail-closed coverage for invalid and ambiguous inputs is complete", () => {
    const cases = [
      scanAstPatchPlannerReadonly({
        rule: {
          language: "typescript",
          pattern: "$VALUE",
          fix: "modern($VALUE)",
        },
        targetFiles: [{ filePath: "a.ts", content: "const a = 1;" }],
        config: AST_ENABLED,
      }),
      scanAstPatchPlannerReadonly({
        rule: {
          language: "typescript",
          pattern: "legacy($VALUE)",
          fix: "modern($MISSING)",
        },
        targetFiles: [{ filePath: "a.ts", content: "const a = legacy(input);" }],
        config: AST_ENABLED,
      }),
      scanAstPatchPlannerReadonly({
        rule: {
          language: "typescript",
          pattern: "legacy($VALUE)",
          fix: "modern($VALUE)",
        },
        targetFiles: [{ filePath: "src/**/*.ts", content: "const a = legacy(input);" }],
        config: AST_ENABLED,
      }),
      scanAstPatchPlannerReadonly({
        rule: {
          language: "typescript",
          pattern: "legacy($VALUE)",
          fix: "modern($VALUE)",
        },
        targetFiles: [{ filePath: "a.ts", content: "const a = legacy(input);" }],
        config: {},
      }),
    ];

    expect(cases.map((item) => item.status)).toEqual([
      "invalid_rule",
      "invalid_rule",
      "invalid_input",
      "skipped",
    ]);
    expect(cases.every((item) => item.matches.length === 0)).toBe(true);
    expect(cases.every((item) => item.previewDiff === undefined)).toBe(true);
  });

  it("shows Registry diagnostics provide bounded aggregate value at low cost", () => {
    const diagnostics = [
      diagnostic("context", "provider_exception", "error"),
      diagnostic("tool", "unsupported_content", "error"),
      diagnostic("tool", "policy_denied", "denied"),
      diagnostic("tool", "policy_waiting", "waiting"),
      diagnostic("tool", "tool_cancelled", "cancelled"),
      diagnostic("tool", "tool_error", "error"),
      { broken: true },
    ] as unknown as RuntimeRegistryDiagnostic[];

    const startedAt = performance.now();
    const result = collectRuntimeRegistryDiagnostics({
      enabled: true,
      limit: 5,
      diagnostics,
      metadata: { deepValidation: true },
    });
    const elapsedMs = performance.now() - startedAt;

    expect(result).toMatchObject({
      enabled: true,
      omittedDiagnosticCount: 1,
      metadata: { deepValidation: true },
      summary: {
        totalDiagnosticCount: 6,
        includedDiagnosticCount: 5,
        contextDiagnosticCount: 1,
        toolDiagnosticCount: 4,
        byStatus: {
          error: 2,
          denied: 1,
          waiting: 1,
          cancelled: 1,
        },
        byReason: {
          provider_exception: 1,
          unsupported_content: 1,
          policy_denied: 1,
          policy_waiting: 1,
          tool_cancelled: 1,
        },
      },
    });
    expect(result.diagnostics).toHaveLength(5);
    expect(elapsedMs).toBeLessThan(50);
  });

  it("shows Registry does not perturb provider ordering or legacy authority", () => {
    const registry = new RuntimeContextProviderRegistry([
      contextProvider("z-context", 20),
      contextProvider("a-context", 10),
    ]);
    const before = registry.listManifests().map((manifest) => manifest.id);

    const collector = collectRuntimeRegistryDiagnostics({
      enabled: true,
      diagnostics: [
        diagnostic("context", "legacy_authoritative", "fallback"),
        diagnostic("tool", "provider_exception", "error"),
      ],
    });
    const after = registry.listManifests().map((manifest) => manifest.id);

    expect(before).toEqual(["a-context", "z-context"]);
    expect(after).toEqual(before);
    expect(JSON.stringify(collector)).not.toMatch(
      /providerOrdering|defaultProviderRegistration|toolAuthority|taskLoopAuthority|gatewayPayload|providerTransport/u,
    );
  });
});

function diagnostic(
  surface: "context" | "tool",
  reason: RuntimeRegistryDiagnostic["reason"],
  status: RuntimeRegistryDiagnostic["status"],
): RuntimeRegistryDiagnostic {
  if (status === "error") {
    return isolateRuntimeRegistryError({
      surface,
      providerId: `${surface}-${reason}`,
      reason,
      error: new Error(reason),
      metadata: {
        legacyAuthoritative: true,
        deepValidation: true,
      },
    }).diagnostic satisfies RuntimeRegistryDiagnostic;
  }
  return {
    surface,
    providerId: `${surface}-${reason}`,
    status,
    reason,
    message: reason,
    evidenceRefs: [{
      type: surface === "tool" ? "tool" : "other",
      ref: `${surface}-${reason}`,
      label: "Controlled runtime-use deep validation diagnostic",
    }],
    metadata: {
      legacyAuthoritative: true,
      deepValidation: true,
    },
  };
}
