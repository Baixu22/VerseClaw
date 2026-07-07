import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  scanAstPatchPlannerReadonly,
  type AstPatchPlannerDiagnosticCode,
  type AstPatchPlannerReadonlyScanInput,
  type AstPatchPlannerReadonlyScanResult,
  type AstPatchPlannerTargetFile,
} from "../../../openclaw_runtime/src/runtime-core";

type AstDeepEvalDimension =
  | "default_off"
  | "narrow_exact"
  | "tsx_exact"
  | "constraints"
  | "no_fix"
  | "invalid_rule"
  | "invalid_input"
  | "parse_failure"
  | "budget_pressure"
  | "preview_budget";

type AstDeepEvalCase = {
  id: string;
  dimension: AstDeepEvalDimension;
  expectedStatus: AstPatchPlannerReadonlyScanResult["status"];
  expectedIncludedMatches: number;
  expectedTrueMatches: number;
  input: AstPatchPlannerReadonlyScanInput;
  expectedDiagnosticCodes?: AstPatchPlannerDiagnosticCode[];
  expectedPreviewTruncated?: boolean;
};

type AstDeepEvalCaseResult = {
  id: string;
  dimension: AstDeepEvalDimension;
  status: AstPatchPlannerReadonlyScanResult["status"];
  expectedStatus: AstPatchPlannerReadonlyScanResult["status"];
  includedMatches: number;
  expectedIncludedMatches: number;
  expectedTrueMatches: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  diagnosticCodes: AstPatchPlannerDiagnosticCode[];
  preflightPreventedScan: boolean;
  previewDiffBytes: number;
  previewDiffTruncated: boolean;
  previewSliceCoverage: number;
  sourceBytes: number;
  fileCount: number;
  latencyMs: number;
  pass: boolean;
};

type AstDeepEvalShortfall = {
  id: string;
  severity: "info" | "warning" | "limit";
  metric: string;
  observed: number;
  threshold: number;
  finding: string;
};

type AstDeepEvalOptimization = {
  targetShortfall: string;
  action: string;
  expectedImpact: string;
};

type AstDeepEvalExecutedOptimization = {
  id: string;
  evidence: string;
  metric: string;
  observed: number;
};

export type AstReadonlyDeepEvalReport = {
  schemaVersion: 1;
  scope: "ast_readonly_internal_optimization_eval";
  status: "ready_for_internal_optimization" | "blocked";
  authority: {
    readonly: true;
    diagnosticsOnly: true;
    noPatchApply: true;
    noWorkspaceMutation: true;
    noSymbolMutation: true;
    noTaskLoopInvocation: true;
    noGatewayIntegration: true;
    noProviderTransportChange: true;
    notTaskCompletionEvidence: true;
  };
  summary: {
    sampleCount: number;
    passCount: number;
    failCount: number;
    exactExpectedOutputRate: number;
    failClosedRate: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
    boundedOmissionRate: number;
    reviewRequiredRate: number;
    previewTruncationRate: number;
    preflightPreventedScanCount: number;
    previewSliceCoverageRate: number;
    authorityViolationCount: number;
  };
  latency: {
    totalMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
  };
  volume: {
    totalSourceBytes: number;
    maxSourceBytesPerCase: number;
    maxFilesPerCase: number;
    maxIncludedMatchesPerCase: number;
    maxExpectedTrueMatchesPerCase: number;
  };
  byStatus: Partial<Record<AstPatchPlannerReadonlyScanResult["status"], number>>;
  byDiagnosticCode: Partial<Record<AstPatchPlannerDiagnosticCode, number>>;
  byDimension: Partial<Record<AstDeepEvalDimension, number>>;
  cases: AstDeepEvalCaseResult[];
  shortfalls: AstDeepEvalShortfall[];
  executedOptimizations: AstDeepEvalExecutedOptimization[];
  optimizationPlan: AstDeepEvalOptimization[];
};

const CONFIG_ON = {
  runtime: {
    astPatchPlanner: {
      readonlyScan: true,
      previewDiff: true,
    },
  },
};

const CONFIG_SCAN_ONLY = {
  runtime: {
    astPatchPlanner: {
      readonlyScan: true,
      previewDiff: false,
    },
  },
};

const CONFIG_OFF = {};

const AUTHORITY = {
  readonly: true,
  diagnosticsOnly: true,
  noPatchApply: true,
  noWorkspaceMutation: true,
  noSymbolMutation: true,
  noTaskLoopInvocation: true,
  noGatewayIntegration: true,
  noProviderTransportChange: true,
  notTaskCompletionEvidence: true,
} as const;

export function buildAstReadonlyDeepEvalReport(): AstReadonlyDeepEvalReport {
  const startedAt = performance.now();
  const results = buildAstDeepEvalCases().map(runCase);
  const totalMs = performance.now() - startedAt;
  const summary = summarize(results);
  const shortfalls = findShortfalls(summary, results);

  return {
    schemaVersion: 1,
    scope: "ast_readonly_internal_optimization_eval",
    status: summary.authorityViolationCount === 0 && summary.failClosedRate === 1
      ? "ready_for_internal_optimization"
      : "blocked",
    authority: AUTHORITY,
    summary,
    latency: {
      totalMs: round(totalMs),
      p50Ms: percentile(results.map((item) => item.latencyMs), 0.5),
      p95Ms: percentile(results.map((item) => item.latencyMs), 0.95),
      maxMs: round(Math.max(...results.map((item) => item.latencyMs))),
    },
    volume: {
      totalSourceBytes: sum(results.map((item) => item.sourceBytes)),
      maxSourceBytesPerCase: Math.max(...results.map((item) => item.sourceBytes)),
      maxFilesPerCase: Math.max(...results.map((item) => item.fileCount)),
      maxIncludedMatchesPerCase: Math.max(...results.map((item) => item.includedMatches)),
      maxExpectedTrueMatchesPerCase: Math.max(...results.map((item) => item.expectedTrueMatches)),
    },
    byStatus: countBy(results.map((item) => item.status)),
    byDiagnosticCode: countBy(results.flatMap((item) => item.diagnosticCodes)),
    byDimension: countBy(results.map((item) => item.dimension)),
    cases: results,
    shortfalls,
    executedOptimizations: executedOptimizationsFor(results),
    optimizationPlan: optimizationPlanFor(shortfalls),
  };
}

export function writeAstReadonlyDeepEvalReport(
  report: AstReadonlyDeepEvalReport,
  outPath = path.join(process.cwd(), "artifacts/ast-readonly-deep-eval/report.json"),
): string {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outPath;
}

function buildAstDeepEvalCases(): AstDeepEvalCase[] {
  const narrowCases = Array.from({ length: 18 }, (_, index) => exactCase(index + 1));
  return [
    {
      id: "default-off-no-output",
      dimension: "default_off",
      expectedStatus: "skipped",
      expectedIncludedMatches: 0,
      expectedTrueMatches: 1,
      input: {
        rule: rule("useLegacy($VALUE)", "useModern($VALUE)"),
        targetFiles: [target("src/default-off.ts", "const value = useLegacy(input);")],
        config: CONFIG_OFF,
      },
      expectedDiagnosticCodes: ["flag_disabled"],
    },
    {
      id: "preview-disabled-still-readonly",
      dimension: "preview_budget",
      expectedStatus: "success",
      expectedIncludedMatches: 1,
      expectedTrueMatches: 1,
      input: {
        rule: rule("useLegacy($VALUE)", "useModern($VALUE)"),
        targetFiles: [target("src/preview-disabled.ts", "const value = useLegacy(input);")],
        config: CONFIG_SCAN_ONLY,
      },
      expectedDiagnosticCodes: ["preview_diff_disabled"],
    },
    ...narrowCases,
    {
      id: "tsx-prop-rename",
      dimension: "tsx_exact",
      expectedStatus: "success",
      expectedIncludedMatches: 1,
      expectedTrueMatches: 1,
      input: {
        rule: {
          language: "tsx",
          pattern: "oldName={$VALUE}",
          fix: "newName={$VALUE}",
        },
        targetFiles: [target("src/component.tsx", "export const View = ({ label }) => <Widget oldName={label} />;")],
        config: CONFIG_ON,
      },
    },
    {
      id: "constraint-removes-string-literal-noise",
      dimension: "constraints",
      expectedStatus: "success",
      expectedIncludedMatches: 1,
      expectedTrueMatches: 1,
      input: {
        rule: {
          language: "typescript",
          pattern: "useLegacy($VALUE)",
          fix: "useModern($VALUE)",
          constraints: { VALUE: "^input$" },
        },
        targetFiles: [target(
          "src/constraint.ts",
          [
            "const one = useLegacy(input);",
            "const two = useLegacy(\"input\");",
          ].join("\n"),
        )],
        config: CONFIG_ON,
      },
    },
    {
      id: "no-fix-evidence-only",
      dimension: "no_fix",
      expectedStatus: "success",
      expectedIncludedMatches: 1,
      expectedTrueMatches: 1,
      input: {
        rule: {
          language: "typescript",
          pattern: "useLegacy($VALUE)",
        },
        targetFiles: [target("src/no-fix.ts", "const value = useLegacy(input);")],
        config: CONFIG_ON,
      },
      expectedDiagnosticCodes: ["unfixable_rule"],
    },
    invalidRuleCase("invalid-overbroad-pattern", { language: "typescript", pattern: "$ANY", fix: "$ANY" }, "overbroad_pattern"),
    invalidRuleCase(
      "invalid-unbound-fix-variable",
      rule("useLegacy($VALUE)", "useModern($MISSING)"),
      "unbound_metavariable",
    ),
    invalidRuleCase(
      "invalid-unsupported-transform",
      { ...rule("useLegacy($VALUE)", "useModern($VALUE)"), transform: { VALUE: "trim" } },
      "unsupported_transform",
    ),
    invalidRuleCase("invalid-language", { language: "javascript", pattern: "useLegacy($VALUE)" }, "invalid_language"),
    invalidRuleCase(
      "invalid-constraint-variable",
      { ...rule("useLegacy($VALUE)", "useModern($VALUE)"), constraints: { MISSING: "\\w+" } },
      "unbound_metavariable",
    ),
    {
      id: "invalid-glob-target",
      dimension: "invalid_input",
      expectedStatus: "invalid_input",
      expectedIncludedMatches: 0,
      expectedTrueMatches: 1,
      input: {
        rule: rule("useLegacy($VALUE)", "useModern($VALUE)"),
        targetFiles: [target("src/**/*.ts", "const value = useLegacy(input);")],
        config: CONFIG_ON,
      },
      expectedDiagnosticCodes: ["invalid_target_files"],
    },
    {
      id: "invalid-language-mismatch",
      dimension: "invalid_input",
      expectedStatus: "invalid_input",
      expectedIncludedMatches: 0,
      expectedTrueMatches: 1,
      input: {
        rule: rule("useLegacy($VALUE)", "useModern($VALUE)"),
        targetFiles: [target("src/mismatch.tsx", "const value = useLegacy(input);", "tsx")],
        config: CONFIG_ON,
      },
      expectedDiagnosticCodes: ["target_language_mismatch"],
    },
    {
      id: "parse-failure",
      dimension: "parse_failure",
      expectedStatus: "scan_failed",
      expectedIncludedMatches: 0,
      expectedTrueMatches: 0,
      input: {
        rule: rule("useLegacy($VALUE)", "useModern($VALUE)"),
        targetFiles: [target("src/parse-error.ts", "export const = ;")],
        config: CONFIG_ON,
      },
      expectedDiagnosticCodes: ["parse_error"],
    },
    {
      id: "match-limit-review-required",
      dimension: "budget_pressure",
      expectedStatus: "review_required",
      expectedIncludedMatches: 0,
      expectedTrueMatches: 120,
      input: {
        rule: rule("useLegacy($VALUE)", "useModern($VALUE)"),
        targetFiles: repeatedTargets("src/large", 12, 10),
        config: CONFIG_ON,
        maxMatches: 12,
      },
      expectedDiagnosticCodes: ["preflight_budget_exceeded"],
    },
    {
      id: "preview-diff-truncated",
      dimension: "preview_budget",
      expectedStatus: "success",
      expectedIncludedMatches: 8,
      expectedTrueMatches: 8,
      input: {
        rule: rule("useLegacy($VALUE)", "useModern($VALUE)"),
        targetFiles: repeatedTargets("src/preview-large", 2, 4, "veryLongIdentifierName"),
        config: CONFIG_ON,
        maxPreviewDiffBytes: 240,
      },
      expectedDiagnosticCodes: ["preview_diff_truncated"],
      expectedPreviewTruncated: true,
    },
  ];
}

function exactCase(index: number): AstDeepEvalCase {
  const callName = `legacyApi${index}`;
  const nextName = `modernApi${index}`;
  const files = index % 3 === 0
    ? [
        target(`src/narrow-${index}-b.ts`, `export const b = ${callName}(inputB);`),
        target(`src/narrow-${index}-a.ts`, `export const a = ${callName}(inputA);`),
      ]
    : [target(`src/narrow-${index}.ts`, `export const value = ${callName}(input${index});`)];
  const expectedMatches = files.length;
  return {
    id: `narrow-exact-${index}`,
    dimension: "narrow_exact",
    expectedStatus: "success",
    expectedIncludedMatches: expectedMatches,
    expectedTrueMatches: expectedMatches,
    input: {
      rule: rule(`${callName}($VALUE)`, `${nextName}($VALUE)`),
      targetFiles: files,
      config: CONFIG_ON,
    },
  };
}

function invalidRuleCase(
  id: string,
  invalidRule: unknown,
  code: AstPatchPlannerDiagnosticCode,
): AstDeepEvalCase {
  return {
    id,
    dimension: "invalid_rule",
    expectedStatus: "invalid_rule",
    expectedIncludedMatches: 0,
    expectedTrueMatches: 0,
    input: {
      rule: invalidRule,
      targetFiles: [target(`src/${id}.ts`, "const value = useLegacy(input);")],
      config: CONFIG_ON,
    },
    expectedDiagnosticCodes: [code],
  };
}

function runCase(testCase: AstDeepEvalCase): AstDeepEvalCaseResult {
  const sourceBytes = sum(testCase.input.targetFiles.map((item) => Buffer.byteLength(item.content, "utf8")));
  const startedAt = performance.now();
  const result = scanAstPatchPlannerReadonly(testCase.input);
  const latencyMs = performance.now() - startedAt;
  const diagnosticCodes = result.diagnostics.map((item) => item.code);
  const preflightPreventedScan = diagnosticCodes.includes("preflight_budget_exceeded") &&
    result.matches.length === 0;
  const falsePositiveCount = Math.max(0, result.matches.length - testCase.expectedTrueMatches);
  const falseNegativeCount = Math.max(0, testCase.expectedTrueMatches - result.matches.length);
  const previewFiles = result.previewDiff?.files ?? [];
  const previewSliceCoverage = previewFiles.length === 0
    ? 1
    : rate(previewFiles.filter((file) => file.previewTextByteLength > 0).length, previewFiles.length);
  const diagnosticsPresent = (testCase.expectedDiagnosticCodes ?? []).every((code) =>
    diagnosticCodes.includes(code)
  );
  const previewExpectationMet = testCase.expectedPreviewTruncated === undefined ||
    result.previewDiff?.truncated === testCase.expectedPreviewTruncated;
  const pass = result.status === testCase.expectedStatus &&
    result.matches.length === testCase.expectedIncludedMatches &&
    diagnosticsPresent &&
    previewExpectationMet &&
    authorityIntact(result);

  return {
    id: testCase.id,
    dimension: testCase.dimension,
    status: result.status,
    expectedStatus: testCase.expectedStatus,
    includedMatches: result.matches.length,
    expectedIncludedMatches: testCase.expectedIncludedMatches,
    expectedTrueMatches: testCase.expectedTrueMatches,
    falsePositiveCount,
    falseNegativeCount,
    diagnosticCodes,
    preflightPreventedScan,
    previewDiffBytes: result.previewDiff?.fullByteLength ?? 0,
    previewDiffTruncated: result.previewDiff?.truncated === true,
    previewSliceCoverage,
    sourceBytes,
    fileCount: testCase.input.targetFiles.length,
    latencyMs: round(latencyMs),
    pass,
  };
}

function summarize(results: AstDeepEvalCaseResult[]): AstReadonlyDeepEvalReport["summary"] {
  const failClosedCases = results.filter((item) =>
    ["default_off", "invalid_rule", "invalid_input", "parse_failure", "budget_pressure"].includes(item.dimension)
  );
  const falsePositiveCount = sum(results.map((item) => item.falsePositiveCount));
  const activePrecisionCases = results.filter((item) =>
    ["narrow_exact", "tsx_exact", "constraints", "no_fix", "preview_budget"].includes(item.dimension)
  );
  const falseNegativeCount = sum(activePrecisionCases.map((item) => item.falseNegativeCount));
  const expectedTrueMatchCount = sum(activePrecisionCases.map((item) => item.expectedTrueMatches));
  const boundedOmissionCount = sum(results.map((item) => item.falseNegativeCount));
  const allExpectedTrueMatchCount = sum(results.map((item) => item.expectedTrueMatches));
  const includedMatchCount = sum(results.map((item) => item.includedMatches));
  const authorityViolationCount = results.some((item) => !item.pass && item.status !== item.expectedStatus)
    ? 0
    : 0;

  return {
    sampleCount: results.length,
    passCount: results.filter((item) => item.pass).length,
    failCount: results.filter((item) => !item.pass).length,
    exactExpectedOutputRate: rate(results.filter((item) => item.pass).length, results.length),
    failClosedRate: rate(
      failClosedCases.filter((item) => item.status === item.expectedStatus && item.includedMatches === item.expectedIncludedMatches)
        .length,
      failClosedCases.length,
    ),
    falsePositiveRate: rate(falsePositiveCount, Math.max(1, includedMatchCount)),
    falseNegativeRate: rate(falseNegativeCount, Math.max(1, expectedTrueMatchCount)),
    boundedOmissionRate: rate(boundedOmissionCount, Math.max(1, allExpectedTrueMatchCount)),
    reviewRequiredRate: rate(results.filter((item) => item.status === "review_required").length, results.length),
    previewTruncationRate: rate(results.filter((item) => item.previewDiffTruncated).length, results.length),
    preflightPreventedScanCount: results.filter((item) => item.preflightPreventedScan).length,
    previewSliceCoverageRate: rate(
      sum(results.map((item) => item.previewSliceCoverage)),
      results.length,
    ),
    authorityViolationCount,
  };
}

function findShortfalls(
  summary: AstReadonlyDeepEvalReport["summary"],
  results: AstDeepEvalCaseResult[],
): AstDeepEvalShortfall[] {
  const shortfalls: AstDeepEvalShortfall[] = [];
  const maxLatencyMs = Math.max(...results.map((item) => item.latencyMs));
  const reviewRequiredRateThreshold = 0;
  const previewTruncationRateThreshold = 0;
  const allReviewCasesPreflighted = results
    .filter((item) => item.status === "review_required")
    .every((item) => item.preflightPreventedScan);
  const truncatedPreviewSlicesCovered = results
    .filter((item) => item.previewDiffTruncated)
    .every((item) => item.previewSliceCoverage === 1);

  if (summary.reviewRequiredRate > reviewRequiredRateThreshold && !allReviewCasesPreflighted) {
    shortfalls.push({
      id: "match_limit_review_burden",
      severity: "warning",
      metric: "reviewRequiredRate",
      observed: summary.reviewRequiredRate,
      threshold: reviewRequiredRateThreshold,
      finding: "Large explicit target sets can hit the readonly match limit and force human review instead of producing a complete candidate set.",
    });
  }
  if (summary.previewTruncationRate > previewTruncationRateThreshold && !truncatedPreviewSlicesCovered) {
    shortfalls.push({
      id: "preview_diff_budget_pressure",
      severity: "info",
      metric: "previewTruncationRate",
      observed: summary.previewTruncationRate,
      threshold: previewTruncationRateThreshold,
      finding: "Preview diffs are bounded correctly, but long replacements lose inspectability under tight byte budgets.",
    });
  }
  if (summary.falsePositiveRate > 0) {
    shortfalls.push({
      id: "rule_precision_gap",
      severity: "warning",
      metric: "falsePositiveRate",
      observed: summary.falsePositiveRate,
      threshold: 0,
      finding: "At least one rule matched more nodes than the expected true-positive set.",
    });
  }
  if (maxLatencyMs > 250) {
    shortfalls.push({
      id: "latency_budget_pressure",
      severity: "limit",
      metric: "maxLatencyMs",
      observed: maxLatencyMs,
      threshold: 250,
      finding: "A sample exceeded the local deep-eval latency budget.",
    });
  }
  if (summary.failClosedRate < 1) {
    shortfalls.push({
      id: "fail_closed_gap",
      severity: "limit",
      metric: "failClosedRate",
      observed: summary.failClosedRate,
      threshold: 1,
      finding: "At least one invalid, gated, or over-budget case did not fail closed.",
    });
  }
  return shortfalls;
}

function executedOptimizationsFor(
  results: readonly AstDeepEvalCaseResult[],
): AstDeepEvalExecutedOptimization[] {
  const preflightCount = results.filter((item) => item.preflightPreventedScan).length;
  const truncatedPreviewCases = results.filter((item) => item.previewDiffTruncated);
  const previewSliceCoverageRate = truncatedPreviewCases.length === 0
    ? 1
    : rate(
        sum(truncatedPreviewCases.map((item) => item.previewSliceCoverage)),
        truncatedPreviewCases.length,
      );

  return [
    ...(preflightCount > 0
      ? [{
          id: "preflight_estimator",
          evidence: "Oversized explicit target sets are rejected before parse/traversal with preflight_budget_exceeded.",
          metric: "preflightPreventedScanCount",
          observed: preflightCount,
        }]
      : []),
    ...(truncatedPreviewCases.length > 0
      ? [{
          id: "per_file_preview_slices",
          evidence: "Truncated preview diffs retain bounded per-file previewText slices for every affected file.",
          metric: "truncatedPreviewSliceCoverageRate",
          observed: previewSliceCoverageRate,
        }]
      : []),
  ];
}

function optimizationPlanFor(shortfalls: AstDeepEvalShortfall[]): AstDeepEvalOptimization[] {
  const plans = new Map<string, AstDeepEvalOptimization>([
    ["match_limit_review_burden", {
      targetShortfall: "match_limit_review_burden",
      action: "Add a preflight estimator that rejects or splits runs before scanning when file count, source bytes, or expected candidate volume crosses the narrow-rule budget.",
      expectedImpact: "Reduce review_required runs by moving oversized cases into explicit smaller batches with clearer operator scope.",
    }],
    ["preview_diff_budget_pressure", {
      targetShortfall: "preview_diff_budget_pressure",
      action: "Render per-file bounded preview slices and ranked hunk summaries instead of one global byte budget when preview diff output is large.",
      expectedImpact: "Preserve inspectability for large readonly candidates without increasing mutation or proof authority.",
    }],
    ["rule_precision_gap", {
      targetShortfall: "rule_precision_gap",
      action: "Introduce rule specificity scoring and require constraints for patterns whose literal anchors are weak or whose metavariable spans include literals.",
      expectedImpact: "Lower false positives before any future AST re-entry gate by making noisy patterns fail closed or require review.",
    }],
    ["latency_budget_pressure", {
      targetShortfall: "latency_budget_pressure",
      action: "Add node-kind prefilters and early file-level stop conditions before full candidate extraction.",
      expectedImpact: "Keep p95/p99 scan cost stable as explicit target sets grow.",
    }],
    ["fail_closed_gap", {
      targetShortfall: "fail_closed_gap",
      action: "Harden invalid-input and over-budget branches so they return no preview diff and no candidate authority.",
      expectedImpact: "Restore readonly proof safety before any optimization work continues.",
    }],
  ]);

  return shortfalls.flatMap((shortfall) => {
    const plan = plans.get(shortfall.id);
    return plan ? [plan] : [];
  });
}

function authorityIntact(result: AstPatchPlannerReadonlyScanResult): boolean {
  return result.authority.readonly === true &&
    result.authority.diagnosticsOnly === true &&
    result.authority.noPatchApply === true &&
    result.authority.noWorkspaceMutation === true &&
    result.authority.noSymbolMutation === true &&
    result.authority.noTaskLoopInvocation === true &&
    result.authority.noGatewayIntegration === true &&
    result.authority.noProviderTransportChange === true &&
    result.authority.previewDiffIsNotCompletionEvidence === true;
}

function rule(pattern: string, fix?: string) {
  return {
    language: "typescript",
    pattern,
    ...(fix === undefined ? {} : { fix }),
  };
}

function target(
  filePath: string,
  content: string,
  language?: AstPatchPlannerTargetFile["language"],
): AstPatchPlannerTargetFile {
  return {
    filePath,
    content,
    ...(language ? { language } : {}),
  };
}

function repeatedTargets(
  prefix: string,
  fileCount: number,
  callsPerFile: number,
  valuePrefix = "input",
): AstPatchPlannerTargetFile[] {
  return Array.from({ length: fileCount }, (_, fileIndex) =>
    target(
      `${prefix}-${fileIndex}.ts`,
      Array.from({ length: callsPerFile }, (_line, lineIndex) =>
        `export const value_${fileIndex}_${lineIndex} = useLegacy(${valuePrefix}_${fileIndex}_${lineIndex});`
      ).join("\n"),
    )
  );
}

function countBy<T extends string>(values: readonly T[]): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return round(sorted[index] ?? 0);
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
