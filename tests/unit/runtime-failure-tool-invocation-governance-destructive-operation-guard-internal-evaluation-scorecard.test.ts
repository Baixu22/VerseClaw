import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER,
  assertRuntimeFailureDestructiveOperationGuardReportSanitized,
  createRuntimeFailureDestructiveOperationGuardObservationOnlyShadowSummary,
  createRuntimeFailureDestructiveOperationGuardInternalEvaluationReport,
  evaluateRuntimeFailureDestructiveOperationGuardRuntimeCouplingReadiness,
  explainRuntimeFailureDestructiveOperationGuardRealDataFeedback,
  parseRuntimeFailureDestructiveOperationGuardTranscriptJsonl,
  scanRuntimeFailureDestructiveOperationGuardTranscriptRoot,
  type RuntimeFailureDestructiveOperationGuardFalseBlockCategory,
  type RuntimeFailureDestructiveOperationGuardInternalEvaluationInput,
  type RuntimeFailureDestructiveOperationGuardPreflightCandidate,
} from "../../openclaw_runtime/src/runtime-core";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("destructive_operation_guard internal evaluation scorecard", () => {
  it("aggregates a 0-100 internal score and recommends separate-spec continuation for strong evidence", () => {
    const report = createRuntimeFailureDestructiveOperationGuardInternalEvaluationReport(strongEvaluationInput());

    expect(report).toMatchObject({
      diagnosticsOnly: true,
      productionReady: false,
      activeRuntimeConsumer: false,
      aggregateScore: 100,
      decision: "continue_with_separate_accepted_spec",
      hardVetoes: [],
    });
    expect(dimensionScore(report, "false_block_safety")).toBe(30);
    expect(dimensionScore(report, "trigger_correctness")).toBe(20);
    expect(dimensionScore(report, "owner_boundary_integrity")).toBe(15);
    expect(dimensionScore(report, "rollback_default_off")).toBe(15);
    expect(dimensionScore(report, "real_data_feedback_quality")).toBe(15);
    expect(dimensionScore(report, "sanitization_report_hygiene")).toBe(5);
    expect(report.optimizationPlan).toContain("Expand real-data sampling and add observation-only shadow summaries in a separate accepted spec.");
  });

  it("forces blocked_for_continuation when hard vetoes are present", () => {
    const report = createRuntimeFailureDestructiveOperationGuardInternalEvaluationReport({
      ...strongEvaluationInput(),
      boundary: {
        allowedActiveConsumerOnly: false,
        deniedRootHits: ["openclaw_runtime/src/gateway/server-methods/agent.ts"],
      },
      sanitization: {
        rawLeakDetected: false,
        secretLeakDetected: true,
        pathLeakDetected: false,
      },
    });

    expect(report.aggregateScore).toBe(0);
    expect(report.decision).toBe("blocked_for_continuation");
    expect(report.hardVetoes.map((veto) => veto.id)).toEqual([
      "denied_root_consumer",
      "secret_report_leak",
    ]);
    expect(report.dimensions.find((dimension) => dimension.id === "owner_boundary_integrity")?.status)
      .toBe("veto");
    expect(report.dimensions.find((dimension) => dimension.id === "sanitization_report_hygiene")?.status)
      .toBe("veto");
  });

  it("lowers confidence for missing real data without hard vetoing continuation", () => {
    const report = createRuntimeFailureDestructiveOperationGuardInternalEvaluationReport({
      ...strongEvaluationInput(),
      realData: parseRuntimeFailureDestructiveOperationGuardTranscriptJsonl(""),
    });

    expect(report.hardVetoes).toEqual([]);
    expect(report.realDataFeedback.feedbackStatus).toBe("insufficient_real_data");
    expect(dimensionScore(report, "real_data_feedback_quality")).toBe(5);
    expect(report.aggregateScore).toBe(90);
    expect(report.decision).toBe("continue_with_separate_accepted_spec");
  });

  it("parses local transcript metadata without retaining raw prompts, paths, tool args, or secrets", () => {
    const summary = parseRuntimeFailureDestructiveOperationGuardTranscriptJsonl([
      JSON.stringify({
        type: "tool_call",
        toolName: "code_mode_exec",
        toolKind: "code_mode_exec",
        prompt: "raw prompt must not survive",
        toolArgs: {
          cwd: "C:\\Users\\27933\\Desktop\\clawx\\ClawX",
          apiKey: "sk-secretShouldNotSurvive123456789",
        },
        toolGovernance: {
          destructiveOperationGuard: {
            preflightCandidate: positiveCandidate(),
          },
        },
      }),
      JSON.stringify({
        type: "tool_call",
        toolName: "unknown_tool",
      }),
      "{ malformed json",
    ].join("\n"), { sourceRef: "transcript:test" });

    expect(summary.totals).toMatchObject({
      transcriptsScanned: 1,
      recordsParsed: 2,
      parseErrors: 1,
      toolInvocationCount: 2,
      mutationCapableToolInvocationCount: 1,
      unknownToolInvocationCount: 0,
      candidateMetadataCount: 1,
      wouldBlockCount: 1,
      wouldAllowCount: 0,
    });
    expect(summary.metadataCounts).toEqual({
      usageMetadataCount: 0,
      missingUsageMetadataCount: 2,
    });
    expect(summary.feedbackStatus).toBe("parse_failures_observed");

    const payload = JSON.stringify(summary);
    expect(payload).not.toContain("raw prompt must not survive");
    expect(payload).not.toContain("toolArgs");
    expect(payload).not.toContain("secretShouldNotSurvive");
    expect(payload).not.toContain("C:\\Users");
    expect(assertRuntimeFailureDestructiveOperationGuardReportSanitized(summary)).toEqual({
      ok: true,
      leaks: [],
    });
  });

  it("parses richer JSONL fixture shapes while retaining only sanitized metadata", () => {
    const summary = parseRuntimeFailureDestructiveOperationGuardTranscriptJsonl([
      "{ malformed json",
      JSON.stringify({
        type: "tool_call",
        toolKind: "code_mode_exec",
      }),
      JSON.stringify({
        type: "assistant_message",
        message: {
          tool_calls: [
            { function: { name: "code_mode_exec" } },
            { id: "missing-name-tool-call" },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 4,
          },
        },
      }),
      JSON.stringify({
        type: "tool_call",
        toolName: "code_mode_exec",
        toolKind: "code_mode_exec",
        destructiveOperationGuardPreflightCandidate: allowCandidate(),
      }),
    ].join("\n"), { sourceRef: "transcript:fixture-rich" });

    expect(summary.totals).toMatchObject({
      transcriptsScanned: 1,
      recordsParsed: 3,
      parseErrors: 1,
      toolInvocationCount: 4,
      mutationCapableToolInvocationCount: 3,
      unknownToolInvocationCount: 2,
      candidateMetadataCount: 1,
      wouldBlockCount: 0,
      wouldAllowCount: 1,
    });
    expect(summary.partialSignalCounts).toMatchObject({
      deletedTouchedPathMetadata: 1,
      wrongFileEditScorecardFail: 0,
      unnecessaryEditScorecardFail: 0,
      phase5FutureBlockCandidate: 1,
      falseBlockCorpusPassing: 1,
    });
    expect(summary.metadataCounts).toEqual({
      usageMetadataCount: 1,
      missingUsageMetadataCount: 2,
    });
    expect(assertRuntimeFailureDestructiveOperationGuardReportSanitized(summary)).toEqual({
      ok: true,
      leaks: [],
    });
  });

  it("scans an OpenClaw transcript root and reports only hashed transcript refs", async () => {
    const root = await mkdtemp(join(tmpdir(), "dog-scorecard-"));
    tempRoots.push(root);
    const sessionsDir = join(root, "agents", "main", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "session-1.jsonl"), [
      JSON.stringify({
        type: "tool_call",
        toolName: "code_mode_exec",
        toolKind: "code_mode_exec",
        destructiveOperationGuardPreflightCandidate: positiveCandidate(),
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          tool_calls: [
            { function: { name: "read_file" } },
          ],
        },
      }),
    ].join("\n"), "utf8");

    const summary = await scanRuntimeFailureDestructiveOperationGuardTranscriptRoot({
      transcriptRoot: root,
      maxFiles: 10,
      maxBytesPerFile: 64 * 1024,
    });

    expect(summary.totals.transcriptsScanned).toBe(1);
    expect(summary.totals.recordsParsed).toBe(2);
    expect(summary.totals.toolInvocationCount).toBe(2);
    expect(summary.totals.candidateMetadataCount).toBe(1);
    expect(summary.source.transcriptRefs).toHaveLength(1);
    expect(summary.source.transcriptRefs[0]).toMatch(/^transcript:[a-f0-9]{16}$/);
    expect(JSON.stringify(summary)).not.toContain(root);
    expect(JSON.stringify(summary)).not.toContain("session-1.jsonl");
  });

  it("detects sanitizer leak classes when a report accidentally contains raw content", () => {
    const result = assertRuntimeFailureDestructiveOperationGuardReportSanitized({
      raw: "tool_args tool result stdout stderr raw prompt provider_payload",
      secret: "Authorization: Bearer secretShouldBeCaught123456789",
      env: "OPENAI_API_KEY=secretShouldBeCaught123456789",
      windowsPath: "C:\\Users\\27933\\Desktop\\secret.ts",
      posixPath: "/home/me/workspace/secret.ts",
    });

    expect(result.ok).toBe(false);
    expect(result.leaks).toEqual(["raw", "secret", "path", "env"]);
  });

  it("creates observation-only shadow summaries without active decisions", () => {
    const realData = parseRuntimeFailureDestructiveOperationGuardTranscriptJsonl([
      JSON.stringify({
        toolName: "code_mode_exec",
        toolKind: "code_mode_exec",
        destructiveOperationGuardPreflightCandidate: positiveCandidate(),
      }),
      JSON.stringify({
        toolName: "code_mode_exec",
        toolKind: "code_mode_exec",
        destructiveOperationGuardPreflightCandidate: allowCandidate(),
      }),
    ].join("\n"));

    const summary = createRuntimeFailureDestructiveOperationGuardObservationOnlyShadowSummary(realData);
    const explanation = explainRuntimeFailureDestructiveOperationGuardRealDataFeedback(realData);

    expect(summary).toMatchObject({
      diagnosticsOnly: true,
      observationOnly: true,
      activeDecision: false,
      activeRuntimeConsumer: false,
      productionReady: false,
      allowedFutureCouplingOwner: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER,
      shadowTotals: {
        candidateMetadataCount: 2,
        wouldBlockCount: 1,
        wouldAllowCount: 1,
      },
    });
    expect(summary).not.toHaveProperty("action");
    expect(summary.realDataFeedbackExplanation.nextRoundTarget).toMatchObject({
      targetScore: 12,
    });
    expect(explanation.score).toBeGreaterThanOrEqual(12);
  });

  it("limits runtime coupling readiness to future mutation-capable preflight ownership", () => {
    expect(evaluateRuntimeFailureDestructiveOperationGuardRuntimeCouplingReadiness({
      futureCouplingOwner: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER,
      activeConsumerRefs: [
        "openclaw_runtime/src/agents/agent-tools.before-tool-call.ts",
        "openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard.ts",
      ],
    })).toMatchObject({
      diagnosticsOnly: true,
      productionReady: false,
      activeRuntimeConsumerApproved: false,
      status: "ready_for_future_mutation_capable_preflight_owner_only",
      deniedRootHits: [],
      ownerExpansionHits: [],
    });

    expect(evaluateRuntimeFailureDestructiveOperationGuardRuntimeCouplingReadiness({
      futureCouplingOwner: "task_loop",
      activeConsumerRefs: ["openclaw_runtime/src/gateway/server-methods/agent.ts"],
    })).toMatchObject({
      status: "blocked_by_denied_root_consumer",
      deniedRootHits: ["openclaw_runtime/src/gateway/server-methods/agent.ts"],
      ownerExpansionHits: ["task_loop"],
    });
  });

  it("does not add an active evaluation scorecard consumer outside tests and runtime-core exports", () => {
    const moduleNeedle =
      "failure-tool-invocation-governance-destructive-operation-guard-internal-evaluation-scorecard";
    const activeNeedles = [
      "createRuntimeFailureDestructiveOperationGuardInternalEvaluationReport",
      "scanRuntimeFailureDestructiveOperationGuardTranscriptRoot",
      "createRuntimeFailureDestructiveOperationGuardObservationOnlyShadowSummary",
      "evaluateRuntimeFailureDestructiveOperationGuardRuntimeCouplingReadiness",
    ];
    const deniedRoots = [
      "openclaw_runtime/src/agents/task-loop-controller.ts",
      "openclaw_runtime/src/acp",
      "openclaw_runtime/src/gateway",
      "openclaw_runtime/src/auto-reply",
      "openclaw_runtime/src/channels",
      "openclaw_runtime/src/plugin-sdk",
      "openclaw_runtime/src/tasks",
      "electron/main",
      "electron/services",
      "src",
      "scripts",
    ];

    const deniedHits = deniedRoots.flatMap((root) =>
      sourceHits(root, [moduleNeedle, ...activeNeedles])
    );

    expect(deniedHits).toEqual([]);
  });
});

function strongEvaluationInput(): RuntimeFailureDestructiveOperationGuardInternalEvaluationInput {
  return {
    falseBlockHoldouts: falseBlockCategories().map((category) => ({ category, passed: true })),
    triggerChecks: [
      { id: "positive-control", expected: "block", actual: "block" },
      { id: "deleted-path-alone", expected: "allow", actual: "allow" },
      { id: "partial-signal", expected: "allow", actual: "allow" },
      { id: "false-block-corpus-failing", expected: "allow", actual: "allow" },
    ],
    boundary: {
      allowedActiveConsumerOnly: true,
      deniedRootHits: [],
    },
    rollback: {
      flagOffLegacyAllow: true,
      omittedFlagLegacyAllow: true,
      schemaDefaultOff: true,
    },
    realData: parseRuntimeFailureDestructiveOperationGuardTranscriptJsonl([
      JSON.stringify({
        toolName: "code_mode_exec",
        toolKind: "code_mode_exec",
        destructiveOperationGuardPreflightCandidate: positiveCandidate(),
      }),
      JSON.stringify({
        toolName: "code_mode_exec",
        toolKind: "code_mode_exec",
        destructiveOperationGuardPreflightCandidate: allowCandidate(),
      }),
    ].join("\n")),
    sanitization: {
      rawLeakDetected: false,
      secretLeakDetected: false,
      pathLeakDetected: false,
    },
  };
}

function falseBlockCategories(): RuntimeFailureDestructiveOperationGuardFalseBlockCategory[] {
  return [
    "expected_edit",
    "expected_deletion",
    "normal_completed_repair",
    "completed_test_repair",
    "sanitized_or_inconclusive_touched_path",
    "legitimate_fixture_mutation",
    "slow_test_command",
    "known_dev_server_like_long_running",
  ];
}

function positiveCandidate(): RuntimeFailureDestructiveOperationGuardPreflightCandidate {
  return {
    ruleId: "destructive_operation_guard",
    toolName: "code_mode_exec",
    toolCallId: "positive-control",
    futureActiveCandidate: {
      action: "block",
      requiresAcceptedSpec: true,
    },
    signals: {
      deletedTouchedPathMetadata: true,
      wrongFileEditScorecardFail: true,
      phase5FutureBlockCandidate: true,
      falseBlockCorpusPassing: true,
    },
    provenance: {
      replayRefs: ["replay:positive"],
      scorecardRefs: ["scorecard:wrong_file_edit:fail"],
      touchedPathRefs: ["touched-path:deleted"],
      phase5FindingRefs: ["phase5:futureActiveCandidate:block"],
    },
  };
}

function allowCandidate(): RuntimeFailureDestructiveOperationGuardPreflightCandidate {
  return {
    ...positiveCandidate(),
    toolCallId: "expected-deletion-holdout",
    signals: {
      deletedTouchedPathMetadata: true,
      phase5FutureBlockCandidate: true,
      falseBlockCorpusPassing: true,
    },
    provenance: {
      replayRefs: ["replay:expected-deletion"],
      scorecardRefs: ["scorecard:wrong_file_edit:pass", "scorecard:unnecessary_edit:pass"],
      touchedPathRefs: ["touched-path:deleted"],
      phase5FindingRefs: ["phase5:futureActiveCandidate:block"],
    },
  };
}

function dimensionScore(
  report: ReturnType<typeof createRuntimeFailureDestructiveOperationGuardInternalEvaluationReport>,
  id: ReturnType<typeof createRuntimeFailureDestructiveOperationGuardInternalEvaluationReport>["dimensions"][number]["id"],
): number {
  const dimension = report.dimensions.find((item) => item.id === id);
  expect(dimension).toBeDefined();
  return dimension?.score ?? -1;
}

function sourceHits(root: string, needles: string[]): string[] {
  const absoluteRoot = join(process.cwd(), root);
  if (!existsSync(absoluteRoot)) {
    return [];
  }
  const files = statSync(absoluteRoot).isDirectory() ? collectSourceFiles(absoluteRoot) : [absoluteRoot];
  return files.flatMap((file) => sourceFileHits(file, needles));
}

function sourceFileHits(file: string, needles: string[]): string[] {
  const absoluteFile = isAbsolute(file) ? file : join(process.cwd(), file);
  if (!existsSync(absoluteFile)) {
    return [];
  }
  const content = readFileSync(absoluteFile, "utf8");
  if (!needles.some((needle) => content.includes(needle))) {
    return [];
  }
  return [relative(process.cwd(), absoluteFile).replaceAll("\\", "/")];
}

function collectSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = join(root, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", ".git", "coverage"].includes(entry.name)) {
        return [];
      }
      return collectSourceFiles(child);
    }
    return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [child] : [];
  });
}
