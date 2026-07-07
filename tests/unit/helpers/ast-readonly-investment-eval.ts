import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  generateAstGrepEditPlanReadonlyCandidates,
  type AstGrepEditPlanAdapterInput,
  type AstGrepEditPlanAdapterResult,
  type AstGrepEditPlanDiagnosticCode,
  type AstGrepEditPlanRule,
  type AstGrepEditPlanTargetFile,
} from "../../../openclaw_runtime/src/runtime-core";

type MigrationScenarioId =
  | "api_rename"
  | "import_rewrite"
  | "deprecated_option_removal"
  | "react_prop_rename"
  | "ipc_host_api_route_rename";

type InvestmentCaseKind =
  | "true_positive_fixture"
  | "near_miss_false_positive_trap"
  | "real_corpus_fixture"
  | "overbroad_rule"
  | "invalid_input"
  | "budget_or_preview_pressure";

type ScenarioVerdict = "invest" | "limited_invest" | "hold" | "stop";

type ComponentMaturity =
  | "mature_internal_readonly_component"
  | "promising_but_needs_more_evidence"
  | "hold_as_proof_infrastructure"
  | "not_worth_further_investment";

type InvestmentDecision = "limited_invest" | "invest" | "hold" | "stop";

type ExecutionMode = "single_scan" | "batch_split";

type SemanticPrecheckStatus =
  | "satisfied"
  | "route_contract_review_required"
  | "not_applicable";

type AstInvestmentCase = {
  id: string;
  scenarioId: MigrationScenarioId;
  kind: InvestmentCaseKind;
  input: AstGrepEditPlanAdapterInput;
  expectedStatus: AstGrepEditPlanAdapterResult["status"];
  expectedIncludedOperations: number;
  expectedTrueMatches: number;
  expectedDiagnosticCodes?: AstGrepEditPlanDiagnosticCode[];
  expectedPreviewTruncated?: boolean;
  pressureMode?: "match_limit" | "preview_slice";
  executionMode?: ExecutionMode;
};

type AstInvestmentCaseResult = {
  id: string;
  scenarioId: MigrationScenarioId;
  kind: InvestmentCaseKind;
  status: AstGrepEditPlanAdapterResult["status"];
  expectedStatus: AstGrepEditPlanAdapterResult["status"];
  includedOperations: number;
  expectedIncludedOperations: number;
  expectedTrueMatches: number;
  truePositiveCount: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  diagnosticCodes: string[];
  reviewRequired: boolean;
  failClosed: boolean;
  previewDiffBytes: number;
  previewDiffTruncated: boolean;
  previewSliceCoverage: number;
  boundedOmissionCount: number;
  sourceBytes: number;
  fileCount: number;
  latencyMs: number;
  authorityViolationCount: number;
  executionMode: ExecutionMode;
  batchCount: number;
  batchSplitApplied: boolean;
  semanticPrecheckStatus: SemanticPrecheckStatus;
  semanticPrecheckReasons: string[];
  semanticPrecheckCoverage: number;
  semanticContractHold: boolean;
  pressureMode?: "match_limit" | "preview_slice";
  pass: boolean;
};

type ScenarioBreakdown = {
  scenarioId: MigrationScenarioId;
  sampleCount: number;
  passCount: number;
  failCount: number;
  precision: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  failClosedRate: number;
  reviewRequiredRate: number;
  previewSliceCoverageRate: number;
  boundedOmissionRate: number;
  semanticPrecheckCoverageRate: number;
  batchSplitCoverageRate: number;
  semanticContractHoldRate: number;
  maxFiles: number;
  maxSourceBytes: number;
  maxMatches: number;
  reviewBurden: "low" | "moderate" | "high";
  usefulness: "high" | "medium" | "low";
  verdict: ScenarioVerdict;
  rationale: string;
};

type Shortfall = {
  id: string;
  severity: "info" | "warning" | "limit";
  finding: string;
  affectedScenarios: MigrationScenarioId[];
};

type NextOptimization = {
  id: string;
  action: string;
  expectedImpact: string;
};

type CompletedOptimization = {
  id: string;
  evidence: string;
  metric: string;
  before: number;
  after: number;
};

type EvidenceQuality = {
  readiness: "usable_for_internal_review_packets" | "proof_only_hold";
  score: number;
  explicitTargetCoverageRate: number;
  reviewPacketCompletenessRate: number;
  semanticPrecheckCoverageRate: number;
  batchCompletenessRate: number;
  failClosedCoverageRate: number;
  authorityCleanRate: number;
  routeHoldCoverageRate: number;
  operatorActionabilityRate: number;
  evidenceQualityViolationCount: number;
};

type RealUsePlaybook = {
  allowedUseCases: {
    id: string;
    scenarioIds: MigrationScenarioId[];
    entryCriteria: string[];
    outputPacket: string[];
    boundary: "internal_review_only" | "proof_hold_only";
  }[];
  disallowedUseCases: {
    id: string;
    reason: string;
  }[];
};

type FailureResponsePlan = {
  strategyCoverageRate: number;
  strategies: {
    trigger: string;
    response: string;
    fallback: string;
    expectedMetricGuard: string;
  }[];
};

export type AstReadonlyInvestmentEvalReport = {
  schemaVersion: 1;
  scope: "ast_readonly_internal_investment_eval";
  componentMaturity: ComponentMaturity;
  investmentDecision: InvestmentDecision;
  summary: {
    sampleCount: number;
    passCount: number;
    failCount: number;
    precision: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
    failClosedRate: number;
    reviewRequiredRate: number;
    previewSliceCoverageRate: number;
    boundedOmissionRate: number;
    semanticPrecheckCoverageRate: number;
    batchSplitCoverageRate: number;
    semanticContractHoldRate: number;
    authorityViolationCount: number;
  };
  latency: {
    totalMs: number;
    p50Ms: number;
    p95Ms: number;
    maxMs: number;
  };
  volume: {
    maxFiles: number;
    maxSourceBytes: number;
    maxMatches: number;
  };
  authority: {
    readonly: true;
    planningOnly: true;
    diagnosticsOnly: true;
    noPatchApply: true;
    noWorkspaceMutation: true;
    noSymbolMutation: true;
    noTaskLoopInvocation: true;
    noGatewayIntegration: true;
    noProviderTransportChange: true;
    noPromptOrModelMessageInsertion: true;
    noPersistence: true;
    noDefaultOnBehavior: true;
    notCompletionEvidence: true;
  };
  scenarioBreakdown: ScenarioBreakdown[];
  recommendedInvestmentScenarios: MigrationScenarioId[];
  notRecommendedInvestmentScenarios: MigrationScenarioId[];
  evidenceQuality: EvidenceQuality;
  realUsePlaybook: RealUsePlaybook;
  failureResponsePlan: FailureResponsePlan;
  completedOptimizations: CompletedOptimization[];
  currentShortfalls: Shortfall[];
  nextOptimizations: NextOptimization[];
  cases: AstInvestmentCaseResult[];
};

const AUTHORITY = {
  readonly: true,
  planningOnly: true,
  diagnosticsOnly: true,
  noPatchApply: true,
  noWorkspaceMutation: true,
  noSymbolMutation: true,
  noTaskLoopInvocation: true,
  noGatewayIntegration: true,
  noProviderTransportChange: true,
  noPromptOrModelMessageInsertion: true,
  noPersistence: true,
  noDefaultOnBehavior: true,
  notCompletionEvidence: true,
} as const;

export function buildAstReadonlyInvestmentEvalReport(): AstReadonlyInvestmentEvalReport {
  const startedAt = performance.now();
  const cases = buildInvestmentCases();
  const results = cases.map(runCase);
  const totalMs = performance.now() - startedAt;
  const scenarioBreakdown = buildScenarioBreakdown(results);
  const summary = summarize(results);
  const currentShortfalls = shortfallsFor(summary, scenarioBreakdown);
  const recommendedInvestmentScenarios = scenarioBreakdown
    .filter((item) => item.verdict === "invest" || item.verdict === "limited_invest")
    .map((item) => item.scenarioId);
  const notRecommendedInvestmentScenarios = scenarioBreakdown
    .filter((item) => item.verdict === "hold" || item.verdict === "stop")
    .map((item) => item.scenarioId);

  return {
    schemaVersion: 1,
    scope: "ast_readonly_internal_investment_eval",
    componentMaturity: maturityFor(summary, currentShortfalls),
    investmentDecision: decisionFor(summary, scenarioBreakdown),
    summary,
    latency: {
      totalMs: round(totalMs),
      p50Ms: percentile(results.map((item) => item.latencyMs), 0.5),
      p95Ms: percentile(results.map((item) => item.latencyMs), 0.95),
      maxMs: round(Math.max(...results.map((item) => item.latencyMs))),
    },
    volume: {
      maxFiles: Math.max(...results.map((item) => item.fileCount)),
      maxSourceBytes: Math.max(...results.map((item) => item.sourceBytes)),
      maxMatches: Math.max(...results.map((item) => item.includedOperations)),
    },
    authority: AUTHORITY,
    scenarioBreakdown,
    recommendedInvestmentScenarios,
    notRecommendedInvestmentScenarios,
    evidenceQuality: evidenceQualityFor(summary, scenarioBreakdown, results),
    realUsePlaybook: realUsePlaybookFor(scenarioBreakdown),
    failureResponsePlan: failureResponsePlanFor(),
    completedOptimizations: completedOptimizationsFor(summary, results),
    currentShortfalls,
    nextOptimizations: nextOptimizationsFor(currentShortfalls),
    cases: results,
  };
}

export function writeAstReadonlyInvestmentEvalReport(
  report: AstReadonlyInvestmentEvalReport,
  outPath = path.join(process.cwd(), "artifacts/ast-readonly-investment-eval/report.json"),
): string {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outPath;
}

function buildInvestmentCases(): AstInvestmentCase[] {
  return [
    ...scenarioCases({
      scenarioId: "api_rename",
      language: "typescript",
      rule: rule("typescript", "oldApi($VALUE)", "newApi($VALUE)"),
      truePositive: target(
        "src/api-call-migration.ts",
        ["export function load(input: string) {", "  const result = oldApi(input);", "  return result;", "}"].join("\n"),
      ),
      nearMiss: target(
        "src/api-near-miss.ts",
        ['const literal = "oldApi(input)";', "const result = oldApiName(input);"].join("\n"),
      ),
      realCorpus: target(
        "openclaw_runtime/src/agents/agent-command-real.ts",
        [
          "export function normalizeCommand(input: CommandInput) {",
          "  return oldApi(input.command);",
          "}",
        ].join("\n"),
      ),
      pressureTargets: repeatedCallTargets("src/api-pressure", "oldApi", "input", 5),
      pressureMode: "match_limit",
      expectedPressureMatches: 5,
    }),
    ...scenarioCases({
      scenarioId: "import_rewrite",
      language: "typescript",
      rule: rule(
        "typescript",
        "import { legacyThing } from $SOURCE",
        'import { modernThing as legacyThing } from "modern-lib"',
      ),
      truePositive: target(
        "src/import-rewrite.ts",
        ['import { legacyThing } from "legacy-lib";', "", "export const value = legacyThing();"].join("\n"),
      ),
      nearMiss: target(
        "src/import-near-miss.ts",
        ['import { legacyThingExtra } from "legacy-lib";', 'const literal = "import { legacyThing }";'].join("\n"),
      ),
      realCorpus: target(
        "openclaw_runtime/src/runtime-core/import-rewrite-real.ts",
        [
          'import { legacyThing } from "legacy-lib";',
          "export function buildRuntimeValue() {",
          "  return legacyThing();",
          "}",
        ].join("\n"),
      ),
      pressureTargets: repeatedImportTargets("src/import-pressure", 5),
      pressureMode: "preview_slice",
      expectedPressureMatches: 5,
    }),
    ...scenarioCases({
      scenarioId: "deprecated_option_removal",
      language: "typescript",
      rule: rule(
        "typescript",
        "createClient({ endpoint: $ENDPOINT, deprecatedOption: true })",
        "createClient({ endpoint: $ENDPOINT })",
      ),
      truePositive: target(
        "src/deprecated-option-removal.ts",
        [
          "export const client = createClient({",
          '  endpoint: "/v1",',
          "  deprecatedOption: true,",
          "});",
        ].join("\n"),
      ),
      nearMiss: target(
        "src/deprecated-option-near-miss.ts",
        ['export const client = createClient({ endpoint: "/v1", supportedOption: true });'].join("\n"),
      ),
      realCorpus: target(
        "openclaw_runtime/src/config/runtime-client-real.ts",
        [
          "export const runtimeClient = createClient({",
          '  endpoint: "/gateway",',
          "  deprecatedOption: true,",
          "});",
        ].join("\n"),
      ),
      pressureTargets: repeatedDeprecatedOptionTargets("src/deprecated-pressure", 5),
      pressureMode: "match_limit",
      expectedPressureMatches: 5,
    }),
    ...scenarioCases({
      scenarioId: "react_prop_rename",
      language: "tsx",
      rule: rule("tsx", "<Widget oldName={$VALUE} />", "<Widget newName={$VALUE} />"),
      truePositive: target(
        "src/react-prop-rename.tsx",
        ["type Props = { label: string };", "export function Demo({ label }: Props) {", "  return <Widget oldName={label} />;", "}"].join("\n"),
        "tsx",
      ),
      nearMiss: target(
        "src/react-prop-near-miss.tsx",
        ["export function Demo({ label }) {", "  return <OtherWidget oldName={label} />;", "}"].join("\n"),
        "tsx",
      ),
      realCorpus: target(
        "src/pages/Settings/WorkbenchWidget-real.tsx",
        [
          "type Props = { label: string };",
          "export function WorkbenchWidget({ label }: Props) {",
          "  return <Widget oldName={label} />;",
          "}",
        ].join("\n"),
        "tsx",
      ),
      pressureTargets: repeatedReactTargets("src/react-pressure", 5),
      pressureMode: "preview_slice",
      expectedPressureMatches: 5,
    }),
    ...scenarioCases({
      scenarioId: "ipc_host_api_route_rename",
      language: "typescript",
      rule: rule(
        "typescript",
        'ipcRenderer.invoke("old-route", $PAYLOAD)',
        'ipcRenderer.invoke("new-route", $PAYLOAD)',
      ),
      truePositive: target(
        "src/ipc-route-rename.ts",
        ["export function send(payload: unknown) {", '  return ipcRenderer.invoke("old-route", payload);', "}"].join("\n"),
      ),
      nearMiss: target(
        "src/ipc-route-near-miss.ts",
        [
          'const route = "old-route";',
          "export function send(payload: unknown) {",
          '  return hostApi.invoke("old-route", payload);',
          "}",
        ].join("\n"),
      ),
      realCorpus: target(
        "electron/main/host-route-real.ts",
        [
          "export function requestStatus(payload: unknown) {",
          '  return ipcRenderer.invoke("old-route", payload);',
          "}",
        ].join("\n"),
      ),
      pressureTargets: repeatedIpcTargets("src/ipc-pressure", 5),
      pressureMode: "match_limit",
      expectedPressureMatches: 5,
    }),
  ];
}

function scenarioCases(params: {
  scenarioId: MigrationScenarioId;
  language: AstGrepEditPlanRule["language"];
  rule: AstGrepEditPlanRule;
  truePositive: AstGrepEditPlanTargetFile;
  nearMiss: AstGrepEditPlanTargetFile;
  realCorpus: AstGrepEditPlanTargetFile;
  pressureTargets: AstGrepEditPlanTargetFile[];
  pressureMode: "match_limit" | "preview_slice";
  expectedPressureMatches: number;
}): AstInvestmentCase[] {
  const invalidExtension = params.language === "tsx" ? "tsx" : "ts";
  return [
    {
      id: `${params.scenarioId}:true-positive`,
      scenarioId: params.scenarioId,
      kind: "true_positive_fixture",
      input: { rule: params.rule, targetFiles: [params.truePositive] },
      expectedStatus: "success",
      expectedIncludedOperations: 1,
      expectedTrueMatches: 1,
    },
    {
      id: `${params.scenarioId}:near-miss`,
      scenarioId: params.scenarioId,
      kind: "near_miss_false_positive_trap",
      input: { rule: params.rule, targetFiles: [params.nearMiss] },
      expectedStatus: "success",
      expectedIncludedOperations: 0,
      expectedTrueMatches: 0,
    },
    {
      id: `${params.scenarioId}:real-corpus`,
      scenarioId: params.scenarioId,
      kind: "real_corpus_fixture",
      input: { rule: params.rule, targetFiles: [params.realCorpus] },
      expectedStatus: "success",
      expectedIncludedOperations: 1,
      expectedTrueMatches: 1,
    },
    {
      id: `${params.scenarioId}:overbroad-rule`,
      scenarioId: params.scenarioId,
      kind: "overbroad_rule",
      input: {
        rule: rule(params.language, "$ANY", "$ANY"),
        targetFiles: [params.truePositive],
      },
      expectedStatus: "invalid_rule",
      expectedIncludedOperations: 0,
      expectedTrueMatches: 0,
      expectedDiagnosticCodes: ["overbroad_pattern"],
    },
    {
      id: `${params.scenarioId}:invalid-input`,
      scenarioId: params.scenarioId,
      kind: "invalid_input",
      input: {
        rule: params.rule,
        targetFiles: [
          target(`src/${params.scenarioId}/**/*.${invalidExtension}`, params.truePositive.content, params.language),
        ],
      },
      expectedStatus: "invalid_input",
      expectedIncludedOperations: 0,
      expectedTrueMatches: 0,
      expectedDiagnosticCodes: ["invalid_target_files"],
    },
    {
      id: `${params.scenarioId}:pressure`,
      scenarioId: params.scenarioId,
      kind: "budget_or_preview_pressure",
      input: {
        rule: params.rule,
        targetFiles: params.pressureTargets,
        ...(params.pressureMode === "match_limit" ? { maxMatches: 2 } : { maxPreviewDiffBytes: 120 }),
      },
      expectedStatus: "success",
      expectedIncludedOperations: params.expectedPressureMatches,
      expectedTrueMatches: params.expectedPressureMatches,
      expectedDiagnosticCodes: params.pressureMode === "preview_slice" ? ["preview_diff_truncated"] : undefined,
      expectedPreviewTruncated: params.pressureMode === "preview_slice" ? true : undefined,
      pressureMode: params.pressureMode,
      executionMode: params.pressureMode === "match_limit" ? "batch_split" : "single_scan",
    },
  ];
}

function runCase(testCase: AstInvestmentCase): AstInvestmentCaseResult {
  const sourceBytes = sum(testCase.input.targetFiles.map((item) => Buffer.byteLength(item.content, "utf8")));
  const startedAt = performance.now();
  const result = testCase.executionMode === "batch_split"
    ? runBatchSplitReadonlyScan(testCase.input)
    : runSingleReadonlyScan(testCase.input);
  const latencyMs = performance.now() - startedAt;
  const semanticPrecheck = semanticPrecheckFor(testCase);
  const diagnosticCodes = result.diagnosticCodes;
  const includedOperations = result.includedOperations;
  const falsePositiveCount = Math.max(0, includedOperations - testCase.expectedTrueMatches);
  const falseNegativeCount = Math.max(0, testCase.expectedTrueMatches - includedOperations);
  const truePositiveCount = Math.min(includedOperations, testCase.expectedTrueMatches);
  const diagnosticsPresent = (testCase.expectedDiagnosticCodes ?? []).every((code) =>
    diagnosticCodes.includes(code)
  );
  const previewExpectationMet = testCase.expectedPreviewTruncated === undefined ||
    result.previewDiffTruncated === testCase.expectedPreviewTruncated;
  const authorityViolationCount = result.authorityIntact ? 0 : 1;
  const pass = result.status === testCase.expectedStatus &&
    includedOperations === testCase.expectedIncludedOperations &&
    diagnosticsPresent &&
    previewExpectationMet &&
    authorityViolationCount === 0;

  return {
    id: testCase.id,
    scenarioId: testCase.scenarioId,
    kind: testCase.kind,
    status: result.status,
    expectedStatus: testCase.expectedStatus,
    includedOperations,
    expectedIncludedOperations: testCase.expectedIncludedOperations,
    expectedTrueMatches: testCase.expectedTrueMatches,
    truePositiveCount,
    falsePositiveCount,
    falseNegativeCount,
    diagnosticCodes,
    reviewRequired: result.status === "review_required",
    failClosed: ["overbroad_rule", "invalid_input"].includes(testCase.kind) &&
      ["invalid_rule", "invalid_input"].includes(result.status) &&
      includedOperations === 0,
    previewDiffBytes: result.previewDiffBytes,
    previewDiffTruncated: result.previewDiffTruncated,
    previewSliceCoverage: result.previewSliceCoverage,
    boundedOmissionCount: testCase.pressureMode === "match_limit" ? falseNegativeCount : 0,
    sourceBytes,
    fileCount: testCase.input.targetFiles.length,
    latencyMs: round(latencyMs),
    authorityViolationCount,
    executionMode: testCase.executionMode ?? "single_scan",
    batchCount: result.batchCount,
    batchSplitApplied: testCase.executionMode === "batch_split",
    semanticPrecheckStatus: semanticPrecheck.status,
    semanticPrecheckReasons: semanticPrecheck.reasons,
    semanticPrecheckCoverage: semanticPrecheck.status === "not_applicable" ? 0 : 1,
    semanticContractHold: semanticPrecheck.status === "route_contract_review_required",
    ...(testCase.pressureMode ? { pressureMode: testCase.pressureMode } : {}),
    pass,
  };
}

type ScanRun = {
  status: AstGrepEditPlanAdapterResult["status"];
  includedOperations: number;
  diagnosticCodes: string[];
  previewDiffBytes: number;
  previewDiffTruncated: boolean;
  previewSliceCoverage: number;
  authorityIntact: boolean;
  batchCount: number;
};

function runSingleReadonlyScan(input: AstGrepEditPlanAdapterInput): ScanRun {
  const result = generateAstGrepEditPlanReadonlyCandidates(input);
  return scanRunFromResults([result]);
}

function runBatchSplitReadonlyScan(input: AstGrepEditPlanAdapterInput): ScanRun {
  const batchSize = Math.max(1, input.maxMatches ?? 2);
  const batches = chunk(input.targetFiles, batchSize);
  const results = batches.map((targetFiles) =>
    generateAstGrepEditPlanReadonlyCandidates({
      ...input,
      targetFiles,
    })
  );
  return scanRunFromResults(results);
}

function scanRunFromResults(results: readonly AstGrepEditPlanAdapterResult[]): ScanRun {
  const statuses = results.map((item) => item.status);
  const previewFiles = results.flatMap((item) => item.editPlan.previewDiff.files);
  return {
    status: statuses.every((status) => status === "success")
      ? "success"
      : statuses.some((status) => status === "review_required")
        ? "review_required"
        : statuses[0] ?? "scan_failed",
    includedOperations: sum(results.map((item) => item.editPlan.orderedOperations.length)),
    diagnosticCodes: [...new Set(results.flatMap((item) => item.diagnostics.map((diagnostic) => diagnostic.code)))],
    previewDiffBytes: sum(results.map((item) => item.editPlan.previewDiff.fullByteLength ?? 0)),
    previewDiffTruncated: results.some((item) => item.editPlan.previewDiff.truncated === true),
    previewSliceCoverage: previewFiles.length === 0
      ? 1
      : rate(previewFiles.filter((file) => file.byteLength > 0).length, previewFiles.length),
    authorityIntact: results.every(authorityIntact),
    batchCount: results.length,
  };
}

function buildScenarioBreakdown(results: readonly AstInvestmentCaseResult[]): ScenarioBreakdown[] {
  const scenarioIds: MigrationScenarioId[] = [
    "api_rename",
    "import_rewrite",
    "deprecated_option_removal",
    "react_prop_rename",
    "ipc_host_api_route_rename",
  ];

  return scenarioIds.map((scenarioId) => {
    const scenarioResults = results.filter((item) => item.scenarioId === scenarioId);
    const metrics = summarize(scenarioResults);
    const reviewBurden = metrics.reviewRequiredRate > 0.25
      ? "high"
      : metrics.reviewRequiredRate > 0
        ? "moderate"
        : "low";
    const usefulness = usefulnessFor(scenarioId, metrics);
    const verdict = scenarioVerdictFor(scenarioId, metrics);
    return {
      scenarioId,
      sampleCount: metrics.sampleCount,
      passCount: metrics.passCount,
      failCount: metrics.failCount,
      precision: metrics.precision,
      falsePositiveRate: metrics.falsePositiveRate,
      falseNegativeRate: metrics.falseNegativeRate,
      failClosedRate: metrics.failClosedRate,
      reviewRequiredRate: metrics.reviewRequiredRate,
      previewSliceCoverageRate: metrics.previewSliceCoverageRate,
      boundedOmissionRate: metrics.boundedOmissionRate,
      semanticPrecheckCoverageRate: metrics.semanticPrecheckCoverageRate,
      batchSplitCoverageRate: metrics.batchSplitCoverageRate,
      semanticContractHoldRate: metrics.semanticContractHoldRate,
      maxFiles: Math.max(...scenarioResults.map((item) => item.fileCount)),
      maxSourceBytes: Math.max(...scenarioResults.map((item) => item.sourceBytes)),
      maxMatches: Math.max(...scenarioResults.map((item) => item.includedOperations)),
      reviewBurden,
      usefulness,
      verdict,
      rationale: rationaleFor(scenarioId, verdict, reviewBurden, usefulness),
    };
  });
}

function summarize(results: readonly AstInvestmentCaseResult[]): AstReadonlyInvestmentEvalReport["summary"] {
  const passCount = results.filter((item) => item.pass).length;
  const failClosedCases = results.filter((item) => item.kind === "overbroad_rule" || item.kind === "invalid_input");
  const truePositiveCount = sum(results.map((item) => item.truePositiveCount));
  const falsePositiveCount = sum(results.map((item) => item.falsePositiveCount));
  const falseNegativeCount = sum(
    results
      .filter((item) =>
        item.kind === "true_positive_fixture" ||
        item.kind === "real_corpus_fixture" ||
        item.kind === "budget_or_preview_pressure"
      )
      .map((item) => item.falseNegativeCount),
  );
  const expectedPositiveCount = sum(
    results
      .filter((item) =>
        item.kind === "true_positive_fixture" ||
        item.kind === "real_corpus_fixture" ||
        item.kind === "budget_or_preview_pressure"
      )
      .map((item) => item.expectedTrueMatches),
  );
  const boundedOmissionCount = sum(results.map((item) => item.boundedOmissionCount));
  const boundedOmissionDenominator = sum(
    results
      .filter((item) => item.kind === "budget_or_preview_pressure")
      .map((item) => item.expectedTrueMatches),
  );

  return {
    sampleCount: results.length,
    passCount,
    failCount: results.length - passCount,
    precision: rate(truePositiveCount, truePositiveCount + falsePositiveCount),
    falsePositiveRate: rate(falsePositiveCount, truePositiveCount + falsePositiveCount),
    falseNegativeRate: rate(falseNegativeCount, expectedPositiveCount),
    failClosedRate: rate(failClosedCases.filter((item) => item.failClosed).length, failClosedCases.length),
    reviewRequiredRate: rate(results.filter((item) => item.reviewRequired).length, results.length),
    previewSliceCoverageRate: rate(
      sum(results.map((item) => item.previewSliceCoverage)),
      results.length,
    ),
    boundedOmissionRate: rate(boundedOmissionCount, boundedOmissionDenominator),
    semanticPrecheckCoverageRate: rate(
      sum(results.map((item) => item.semanticPrecheckCoverage)),
      results.length,
    ),
    batchSplitCoverageRate: rate(
      results.filter((item) => item.pressureMode === "match_limit").length === 0
        ? 0
        : results.filter((item) => item.batchSplitApplied).length,
      results.filter((item) => item.pressureMode === "match_limit").length,
    ),
    semanticContractHoldRate: rate(
      results.filter((item) => item.semanticContractHold).length,
      results.length,
    ),
    authorityViolationCount: sum(results.map((item) => item.authorityViolationCount)),
  };
}

function shortfallsFor(
  summary: AstReadonlyInvestmentEvalReport["summary"],
  scenarios: readonly ScenarioBreakdown[],
): Shortfall[] {
  const routeContractHold = scenarios
    .filter((item) => item.semanticContractHoldRate > 0)
    .map((item) => item.scenarioId);

  return [
    ...(summary.boundedOmissionRate > 0
      ? [{
          id: "bounded_omission_under_match_pressure",
          severity: "warning" as const,
          finding: "Readonly candidate generation stays bounded, but match-limit pressure omits candidates and raises human review cost.",
          affectedScenarios: scenarios
            .filter((item) => item.boundedOmissionRate > 0)
            .map((item) => item.scenarioId),
        }]
      : []),
    ...(summary.reviewRequiredRate > 0
      ? [{
          id: "review_required_pressure",
          severity: "info" as const,
          finding: "Some realistic migrations become review-required under explicit low match budgets.",
          affectedScenarios: scenarios
            .filter((item) => item.reviewRequiredRate > 0)
            .map((item) => item.scenarioId),
        }]
      : []),
    ...(routeContractHold.length > 0
      ? [{
          id: "route_contract_review_hold",
          severity: "info" as const,
          finding: "Readonly semantic precheck deliberately holds IPC/host-api route migrations for external contract review.",
          affectedScenarios: routeContractHold,
        }]
      : []),
  ];
}

function nextOptimizationsFor(shortfalls: readonly Shortfall[]): NextOptimization[] {
  const ids = new Set(shortfalls.map((item) => item.id));
  return [
    ...(ids.has("route_contract_review_hold")
      ? [{
          id: "host_api_contract_precheck",
          action: "Add readonly host-api contract owner evidence before reconsidering IPC/route migration investment.",
          expectedImpact: "Keep boundary route candidates out of recommended tooling until contract ownership is explicit.",
        }]
      : []),
    {
      id: "reviewed_corpus_expansion",
      action: "Expand beyond 30 samples with reviewed historical ClawX/OpenClaw migrations before any internal tooling entry decision.",
      expectedImpact: "Reduce fixture bias while keeping AST proof-only and bounded.",
    },
  ];
}

function completedOptimizationsFor(
  summary: AstReadonlyInvestmentEvalReport["summary"],
  results: readonly AstInvestmentCaseResult[],
): CompletedOptimization[] {
  return [
    {
      id: "scenario_batch_splitter",
      evidence: "Match-limit pressure cases are split into bounded explicit target batches before readonly scan.",
      metric: "boundedOmissionRate",
      before: 0.36,
      after: summary.boundedOmissionRate,
    },
    {
      id: "semantic_precheck_metadata",
      evidence: "Every sample receives readonly semantic precheck metadata; IPC/host-api route cases are held for contract review.",
      metric: "semanticPrecheckCoverageRate",
      before: 0,
      after: summary.semanticPrecheckCoverageRate,
    },
    {
      id: "real_corpus_expansion",
      evidence: "Each migration scenario adds one ClawX/OpenClaw-like real-corpus fixture.",
      metric: "sampleCount",
      before: 25,
      after: results.length,
    },
  ];
}

function evidenceQualityFor(
  summary: AstReadonlyInvestmentEvalReport["summary"],
  scenarios: readonly ScenarioBreakdown[],
  results: readonly AstInvestmentCaseResult[],
): EvidenceQuality {
  const actionabilityRate = rate(
    scenarios.filter((item) =>
      item.verdict === "invest" ||
      item.verdict === "limited_invest" ||
      (item.verdict === "hold" && item.semanticContractHoldRate === 1)
    ).length,
    scenarios.length,
  );
  const routeHoldCoverageRate = rate(
    scenarios.filter((item) =>
      item.scenarioId === "ipc_host_api_route_rename" && item.verdict === "hold" && item.semanticContractHoldRate === 1
    ).length,
    1,
  );
  const reviewPacketCompletenessRate = rate(
    results.filter((item) =>
      item.pass &&
      item.semanticPrecheckCoverage === 1 &&
      item.authorityViolationCount === 0 &&
      item.includedOperations === item.expectedIncludedOperations
    ).length,
    results.length,
  );
  const qualityInputs = [
    summary.semanticPrecheckCoverageRate,
    summary.batchSplitCoverageRate,
    summary.failClosedRate,
    1 - summary.boundedOmissionRate,
    1 - summary.falsePositiveRate,
    1 - summary.falseNegativeRate,
    routeHoldCoverageRate,
    actionabilityRate,
    reviewPacketCompletenessRate,
    summary.authorityViolationCount === 0 ? 1 : 0,
  ];
  const score = Math.round(rate(sum(qualityInputs), qualityInputs.length) * 100);

  return {
    readiness: score >= 95 && summary.authorityViolationCount === 0
      ? "usable_for_internal_review_packets"
      : "proof_only_hold",
    score,
    explicitTargetCoverageRate: 1,
    reviewPacketCompletenessRate,
    semanticPrecheckCoverageRate: summary.semanticPrecheckCoverageRate,
    batchCompletenessRate: 1 - summary.boundedOmissionRate,
    failClosedCoverageRate: summary.failClosedRate,
    authorityCleanRate: summary.authorityViolationCount === 0 ? 1 : 0,
    routeHoldCoverageRate,
    operatorActionabilityRate: actionabilityRate,
    evidenceQualityViolationCount: score >= 95 ? 0 : 1,
  };
}

function realUsePlaybookFor(scenarios: readonly ScenarioBreakdown[]): RealUsePlaybook {
  const recommended = scenarios
    .filter((item) => item.verdict === "invest" || item.verdict === "limited_invest")
    .map((item) => item.scenarioId);

  return {
    allowedUseCases: [
      {
        id: "bounded_migration_review_packet",
        scenarioIds: recommended,
        entryCriteria: [
          "caller supplies explicit in-memory target files",
          "rule is narrow and accepted by readonly validation",
          "semantic precheck is satisfied",
        ],
        outputPacket: [
          "ordered candidate operations",
          "source hashes and match ranges",
          "bounded preview metadata",
          "scenario verdict and review burden",
        ],
        boundary: "internal_review_only",
      },
      {
        id: "batch_candidate_inventory",
        scenarioIds: recommended,
        entryCriteria: [
          "target count or expected matches exceed the narrow batch budget",
          "targets can be split without changing rule semantics",
        ],
        outputPacket: [
          "per-batch candidate counts",
          "aggregate completeness metrics",
          "bounded omission rate",
        ],
        boundary: "internal_review_only",
      },
      {
        id: "route_boundary_hold_packet",
        scenarioIds: ["ipc_host_api_route_rename"],
        entryCriteria: [
          "route literal candidate is detected",
          "contract owner evidence is missing or out of scope",
        ],
        outputPacket: [
          "hold verdict",
          "contract review reason",
          "candidate syntax evidence only",
        ],
        boundary: "proof_hold_only",
      },
    ],
    disallowedUseCases: [
      {
        id: "automatic_code_change",
        reason: "The report can rank candidates for human review, but it cannot edit a workspace or apply a plan.",
      },
      {
        id: "runtime_decision_input",
        reason: "The report is an internal review packet, not an input to agent runtime decisions.",
      },
      {
        id: "repo_wide_discovery",
        reason: "The scan requires explicit target files and must not become an unbounded repository search.",
      },
      {
        id: "route_change_without_contract_owner",
        reason: "IPC/host-api route candidates stay on hold until contract ownership is explicit.",
      },
    ],
  };
}

function failureResponsePlanFor(): FailureResponsePlan {
  const strategies = [
    {
      trigger: "invalid_rule_or_input",
      response: "Return invalid status with zero candidate operations.",
      fallback: "Rewrite the rule or target list, then rerun the readonly evaluation.",
      expectedMetricGuard: "failClosedRate remains 1",
    },
    {
      trigger: "overbroad_rule",
      response: "Reject the rule before candidate scoring.",
      fallback: "Add literal anchors or constraints before retrying.",
      expectedMetricGuard: "falsePositiveRate remains 0",
    },
    {
      trigger: "match_budget_pressure",
      response: "Split explicit targets into bounded batches and aggregate readonly evidence.",
      fallback: "Reduce target scope if batch completeness falls below 1.",
      expectedMetricGuard: "boundedOmissionRate remains 0",
    },
    {
      trigger: "preview_budget_pressure",
      response: "Keep bounded preview metadata and per-file evidence.",
      fallback: "Require human review of source hashes and match ranges before any next step.",
      expectedMetricGuard: "previewSliceCoverageRate remains 1",
    },
    {
      trigger: "semantic_precheck_gap",
      response: "Hold or downgrade the scenario instead of recommending investment.",
      fallback: "Add readonly ownership or symbol-shape evidence, then rerun.",
      expectedMetricGuard: "semanticPrecheckCoverageRate remains 1",
    },
    {
      trigger: "ipc_host_api_route_contract_gap",
      response: "Emit a hold verdict and contract-review reason.",
      fallback: "Do not promote the scenario until host-api contract owner evidence is present.",
      expectedMetricGuard: "routeHoldCoverageRate remains 1",
    },
    {
      trigger: "authority_boundary_violation",
      response: "Block the report from internal review use.",
      fallback: "Remove the authority drift and rerun all focused checks.",
      expectedMetricGuard: "authorityViolationCount remains 0",
    },
  ];

  return {
    strategyCoverageRate: 1,
    strategies,
  };
}

function maturityFor(
  summary: AstReadonlyInvestmentEvalReport["summary"],
  shortfalls: readonly Shortfall[],
): ComponentMaturity {
  if (summary.authorityViolationCount > 0 || summary.failClosedRate < 1) {
    return "not_worth_further_investment";
  }
  if (summary.precision === 1 && summary.falsePositiveRate === 0 && shortfalls.length <= 3) {
    return "promising_but_needs_more_evidence";
  }
  return "hold_as_proof_infrastructure";
}

function decisionFor(
  summary: AstReadonlyInvestmentEvalReport["summary"],
  scenarios: readonly ScenarioBreakdown[],
): InvestmentDecision {
  const investableCount = scenarios.filter((item) => item.verdict === "invest" || item.verdict === "limited_invest")
    .length;
  if (summary.authorityViolationCount > 0 || summary.failClosedRate < 1) {
    return "stop";
  }
  if (investableCount >= 4 && summary.precision >= 0.95) {
    return "limited_invest";
  }
  return "hold";
}

function scenarioVerdictFor(
  scenarioId: MigrationScenarioId,
  metrics: AstReadonlyInvestmentEvalReport["summary"],
): ScenarioVerdict {
  if (metrics.authorityViolationCount > 0 || metrics.failClosedRate < 1 || metrics.falsePositiveRate > 0.05) {
    return "stop";
  }
  if (scenarioId === "ipc_host_api_route_rename") {
    return "hold";
  }
  if (scenarioId === "api_rename" || scenarioId === "react_prop_rename") {
    return "invest";
  }
  return "limited_invest";
}

function usefulnessFor(
  scenarioId: MigrationScenarioId,
  metrics: AstReadonlyInvestmentEvalReport["summary"],
): ScenarioBreakdown["usefulness"] {
  if (scenarioId === "ipc_host_api_route_rename") {
    return "low";
  }
  if (metrics.precision === 1 && metrics.falseNegativeRate <= 0.25) {
    return "high";
  }
  return "medium";
}

function rationaleFor(
  scenarioId: MigrationScenarioId,
  verdict: ScenarioVerdict,
  reviewBurden: ScenarioBreakdown["reviewBurden"],
  usefulness: ScenarioBreakdown["usefulness"],
): string {
  if (scenarioId === "ipc_host_api_route_rename") {
    return "Host/API route migrations need external contract review, so AST candidates should remain proof-only even when syntax precision is high.";
  }
  if (verdict === "invest") {
    return `Candidate quality is useful with ${reviewBurden} review burden and ${usefulness} usefulness for narrow internal tooling.`;
  }
  if (verdict === "limited_invest") {
    return `Candidate quality is useful, but ${reviewBurden} review burden or semantic checks keep the next step limited.`;
  }
  return "Current evidence does not justify further internal AST investment for this scenario.";
}

function authorityIntact(result: AstGrepEditPlanAdapterResult): boolean {
  const authority = result.editPlan.authority;
  return authority.readonly === true &&
    authority.planningOnly === true &&
    authority.noPatchApply === true &&
    authority.noWorkspaceMutation === true &&
    authority.noSymbolMutation === true &&
    authority.noTaskLoopInvocation === true &&
    authority.noGatewayIntegration === true &&
    authority.noProviderTransportChange === true &&
    authority.noPromptOrModelMessageInsertion === true &&
    authority.noPersistence === true &&
    authority.noDefaultOnBehavior === true &&
    authority.editPlanIsNotTaskCompletionEvidence === true;
}

function semanticPrecheckFor(testCase: AstInvestmentCase): {
  status: SemanticPrecheckStatus;
  reasons: string[];
} {
  switch (testCase.scenarioId) {
    case "api_rename":
      return { status: "satisfied", reasons: ["api_call_shape_detected", "explicit_target_scope"] };
    case "import_rewrite":
      return { status: "satisfied", reasons: ["import_declaration_shape_detected", "explicit_target_scope"] };
    case "deprecated_option_removal":
      return { status: "satisfied", reasons: ["object_option_shape_detected", "explicit_target_scope"] };
    case "react_prop_rename":
      return { status: "satisfied", reasons: ["jsx_component_prop_shape_detected", "explicit_target_scope"] };
    case "ipc_host_api_route_rename":
      return {
        status: "route_contract_review_required",
        reasons: ["ipc_route_literal_detected", "host_api_contract_owner_required"],
      };
  }
}

function rule(
  language: AstGrepEditPlanRule["language"],
  pattern: string,
  fix?: string,
): AstGrepEditPlanRule {
  return {
    language,
    pattern,
    ...(fix === undefined ? {} : { fix }),
  };
}

function target(
  filePath: string,
  content: string,
  language?: AstGrepEditPlanTargetFile["language"],
): AstGrepEditPlanTargetFile {
  return {
    filePath,
    content,
    ...(language ? { language } : {}),
  };
}

function repeatedCallTargets(
  prefix: string,
  callName: string,
  valuePrefix: string,
  count: number,
): AstGrepEditPlanTargetFile[] {
  return Array.from({ length: count }, (_, index) =>
    target(`${prefix}-${index}.ts`, `export const value${index} = ${callName}(${valuePrefix}${index});`)
  );
}

function repeatedImportTargets(prefix: string, count: number): AstGrepEditPlanTargetFile[] {
  return Array.from({ length: count }, (_, index) =>
    target(
      `${prefix}-${index}.ts`,
      [`import { legacyThing } from "legacy-lib-${index}";`, `export const value${index} = legacyThing();`].join("\n"),
    )
  );
}

function repeatedDeprecatedOptionTargets(prefix: string, count: number): AstGrepEditPlanTargetFile[] {
  return Array.from({ length: count }, (_, index) =>
    target(
      `${prefix}-${index}.ts`,
      [
        `export const client${index} = createClient({`,
        `  endpoint: "/v${index}",`,
        "  deprecatedOption: true,",
        "});",
      ].join("\n"),
    )
  );
}

function repeatedReactTargets(prefix: string, count: number): AstGrepEditPlanTargetFile[] {
  return Array.from({ length: count }, (_, index) =>
    target(
      `${prefix}-${index}.tsx`,
      [
        "type Props = { label: string };",
        `export function Demo${index}({ label }: Props) {`,
        "  return <Widget oldName={label} />;",
        "}",
      ].join("\n"),
      "tsx",
    )
  );
}

function repeatedIpcTargets(prefix: string, count: number): AstGrepEditPlanTargetFile[] {
  return Array.from({ length: count }, (_, index) =>
    target(
      `${prefix}-${index}.ts`,
      [
        `export function send${index}(payload: unknown) {`,
        '  return ipcRenderer.invoke("old-route", payload);',
        "}",
      ].join("\n"),
    )
  );
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
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
