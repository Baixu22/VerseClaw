import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_MAX_BYTES,
  RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RECOMMENDATIONS,
  RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RULE_IDS,
  createRuntimeFailureTaskOutcomeScorecardFromReplayReport,
  createRuntimeFailureToolInvocationGovernanceAdvisoryReport,
  runFailureReplayHarnessCore,
  validateReplayCase,
  validateRuntimeFailureToolInvocationGovernanceAdvisoryReport,
  type FailureEvent,
  type ReplayCase,
  type RuntimeFailureReplayFixtureBundle,
  type RuntimeFailureReplayReport,
  type RuntimeFailureTaskOutcomeScorecard,
  type RuntimeFailureToolInvocationGovernanceAdvisoryReport,
  type RuntimeFailureToolInvocationGovernanceFinding,
} from "../../openclaw_runtime/src/runtime-core";

const NOW_MS = Date.parse("2026-07-01T12:00:00.000Z");
const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/runtime-replay");
const FIXTURE_NAMES = [
  "success.json",
  "tool-error.json",
  "provider-timeout.json",
  "test-failure-after-repair.json",
  "dirty-workspace.json",
] as const;

type ReplayFixtureFile = {
  replayCase: ReplayCase;
  fixtures: RuntimeFailureReplayFixtureBundle;
};

function loadFixture(name: typeof FIXTURE_NAMES[number]): ReplayFixtureFile {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as ReplayFixtureFile;
}

function replayReportFor(name: typeof FIXTURE_NAMES[number]): RuntimeFailureReplayReport {
  const fixture = loadFixture(name);
  const replayValidation = validateReplayCase(fixture.replayCase);
  expect(replayValidation.ok).toBe(true);
  if (!replayValidation.ok) {
    throw new Error(replayValidation.errors.map((issue) => `${issue.path}:${issue.code}`).join(", "));
  }
  const replay = runFailureReplayHarnessCore(replayValidation.value, fixture.fixtures, { nowMs: NOW_MS });
  expect(replay.ok).toBe(true);
  if (!replay.ok) {
    throw new Error(replay.errors.map((issue) => `${issue.path}:${issue.code}`).join(", "));
  }
  return replay.value;
}

function scorecardFor(report: RuntimeFailureReplayReport): RuntimeFailureTaskOutcomeScorecard {
  const result = createRuntimeFailureTaskOutcomeScorecardFromReplayReport(report);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.errors.map((issue) => `${issue.path}:${issue.code}`).join(", "));
  }
  return result.value;
}

function governanceFor(report: RuntimeFailureReplayReport): RuntimeFailureToolInvocationGovernanceAdvisoryReport {
  const scorecard = scorecardFor(report);
  const governance = createRuntimeFailureToolInvocationGovernanceAdvisoryReport(report, scorecard);
  expect(governance.ok).toBe(true);
  if (!governance.ok) {
    throw new Error(governance.errors.map((issue) => `${issue.path}:${issue.code}`).join(", "));
  }
  return governance.value;
}

function errorCodes(result: { ok: true } | { ok: false; errors: Array<{ code: string }> }): string[] {
  return result.ok ? [] : result.errors.map((issue) => issue.code);
}

describe("runtime failure tool invocation governance advisory rules", () => {
  it("accepts the Phase 3 five replay fixture reports and Phase 4 scorecards", () => {
    for (const name of FIXTURE_NAMES) {
      const report = replayReportFor(name);
      const scorecard = scorecardFor(report);
      const governance = createRuntimeFailureToolInvocationGovernanceAdvisoryReport(report, scorecard);
      expect(governance.ok).toBe(true);
      if (!governance.ok) {
        throw new Error("Governance report generation failed.");
      }
      expect(governance.value).toMatchObject({
        diagnosticsOnly: true,
        completionProof: false,
        evaluationMetadataOnly: true,
        advisoryOnly: true,
        authority: "none",
        governanceDecisionAuthority: "none",
        activeBlocking: false,
        safety: {
          sanitizedReplayReportOnly: true,
          scorecardEvaluationMetadataOnly: true,
          activeRuntimeConsumer: false,
          checkpointLifecycleAuthorityWrite: false,
          futureActiveSpecRequiredForBlocking: true,
          rawPayloadRetained: false,
        },
      });
      expect(governance.value.findings.map((finding) => finding.ruleId)).toEqual([
        ...RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RULE_IDS,
      ]);
      expect(RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_RECOMMENDATIONS).toContain(
        governance.value.aggregate.recommendation,
      );
    }
  });

  it("proves repeated generation is deterministic, JSON-serializable, and bounded", () => {
    for (const name of FIXTURE_NAMES) {
      const report = replayReportFor(name);
      const scorecard = scorecardFor(report);
      const first = createRuntimeFailureToolInvocationGovernanceAdvisoryReport(report, scorecard);
      const second = createRuntimeFailureToolInvocationGovernanceAdvisoryReport(report, scorecard);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) {
        throw new Error("Governance generation failed.");
      }
      expect(first.value).toEqual(second.value);
      expect(JSON.parse(JSON.stringify(first.value))).toEqual(first.value);
      expect(new TextEncoder().encode(JSON.stringify(first.value)).length).toBeLessThanOrEqual(
        RUNTIME_FAILURE_TOOL_INVOCATION_GOVERNANCE_ADVISORY_MAX_BYTES,
      );
    }
  });

  it("keeps provenance refs on every advisory finding and aggregate recommendation", () => {
    for (const name of FIXTURE_NAMES) {
      const governance = governanceFor(replayReportFor(name));
      for (const finding of governance.findings) {
        expect(provenanceRefCount(finding)).toBeGreaterThan(0);
      }
      expect(provenanceRefCount(governance.aggregate)).toBeGreaterThan(0);
    }
  });

  it("supports every aggregate recommendation without granting active blocking authority", () => {
    const advisoryPass = governanceFor(replayReportFor("success.json"));
    const advisoryBackoff = governanceFor(replayReportFor("provider-timeout.json"));
    const advisoryAskUser = governanceFor(replayReportFor("dirty-workspace.json"));
    const warnReport = {
      ...replayReportFor("success.json"),
      touchedPathSummaries: [
        {
          path: "src/destructive-fixture.ts",
          status: "deleted",
          summary: "Deleted fixture path summary.",
        },
      ],
    } satisfies RuntimeFailureReplayReport;
    const advisoryWarn = governanceFor(warnReport);
    const inconclusiveReport = {
      ...replayReportFor("success.json"),
      touchedPathSummaries: [
        {
          path: "[redacted-path]",
          status: "modified",
          summary: "Sanitized mutation path cannot prove expected file ownership.",
        },
      ],
    } satisfies RuntimeFailureReplayReport;
    const inconclusive = governanceFor(inconclusiveReport);

    expect(new Set([
      advisoryPass.aggregate.recommendation,
      advisoryBackoff.aggregate.recommendation,
      advisoryAskUser.aggregate.recommendation,
      advisoryWarn.aggregate.recommendation,
      inconclusive.aggregate.recommendation,
    ])).toEqual(new Set([
      "advisory_pass",
      "advisory_backoff",
      "advisory_ask_user",
      "advisory_warn",
      "inconclusive",
    ]));

    const destructiveFinding = advisoryWarn.findings.find((finding) => finding.ruleId === "destructive_operation_guard");
    expect(destructiveFinding?.futureActiveCandidate).toMatchObject({
      action: "block",
      requiresAcceptedSpec: true,
    });
    expect(advisoryWarn.activeBlocking).toBe(false);
  });

  it("covers focused advisory cases for every Phase 5 rule", () => {
    const destructive = governanceFor({
      ...replayReportFor("success.json"),
      touchedPathSummaries: [
        {
          path: "src/destructive-fixture.ts",
          status: "deleted",
          summary: "Deleted fixture path summary.",
        },
      ],
    });
    expect(findingByRule(destructive, "destructive_operation_guard")).toMatchObject({
      level: "warn",
      recommendation: "advisory_warn",
      futureActiveCandidate: {
        action: "block",
        requiresAcceptedSpec: true,
      },
    });
    expect(destructive.activeBlocking).toBe(false);

    const repeatedFailureBase = replayReportFor("tool-error.json");
    const repeatedFailure = governanceFor({
      ...repeatedFailureBase,
      failureEvents: [
        ...repeatedFailureBase.failureEvents,
        {
          ...repeatedFailureBase.failureEvents[0],
          id: `${repeatedFailureBase.failureEvents[0].id}:repeat`,
          evidenceRefs: ["tool-error-fixture-repeat"],
        },
      ],
    });
    expect(findingByRule(repeatedFailure, "repeated_failure_backoff")).toMatchObject({
      level: "backoff",
      recommendation: "advisory_backoff",
    });

    const timeout = governanceFor(replayReportFor("provider-timeout.json"));
    expect(findingByRule(timeout, "timeout_classification")).toMatchObject({
      level: "backoff",
      recommendation: "advisory_backoff",
    });
    expect(findingByRule(timeout, "long_running_process_detection")).toMatchObject({
      level: "backoff",
      recommendation: "advisory_backoff",
    });

    const slowNonCompleted = governanceFor({
      ...replayReportFor("dirty-workspace.json"),
      replay: {
        ...replayReportFor("dirty-workspace.json").replay,
        budgets: {
          ...replayReportFor("dirty-workspace.json").replay.budgets,
          maxDurationMs: 600000,
        },
      },
    });
    expect(findingByRule(slowNonCompleted, "long_running_process_detection")).toMatchObject({
      level: "warn",
      recommendation: "advisory_warn",
    });

    const slowCompletedTest = governanceFor({
      ...replayReportFor("test-failure-after-repair.json"),
      replay: {
        ...replayReportFor("test-failure-after-repair.json").replay,
        budgets: {
          ...replayReportFor("test-failure-after-repair.json").replay.budgets,
          maxDurationMs: 600000,
        },
      },
    });
    expect(findingByRule(slowCompletedTest, "long_running_process_detection")).toMatchObject({
      level: "pass",
      recommendation: "advisory_pass",
    });

    const contamination = governanceFor(replayReportFor("dirty-workspace.json"));
    expect(findingByRule(contamination, "shell_environment_contamination_detection")).toMatchObject({
      level: "ask_user",
      recommendation: "advisory_ask_user",
    });
    expect(findingByRule(contamination, "ask_user_vs_continue_policy")).toMatchObject({
      level: "ask_user",
      recommendation: "advisory_ask_user",
    });

    const rejectedEvidence = governanceFor({
      ...replayReportFor("success.json"),
      evidenceEnvelopeDecisions: [
        {
          id: "rejected-tool-result-summary",
          kind: "tool_result_summary",
          authority: "none",
          accepted: false,
          confidence: 0.4,
          reason: "Rejected synthetic tool-result evidence for focused provenance coverage.",
        },
      ],
    });
    expect(findingByRule(rejectedEvidence, "tool_result_provenance")).toMatchObject({
      level: "inconclusive",
      recommendation: "inconclusive",
    });
  });

  it("rejects diagnosticsOnly=false, completionProof=true, activeBlocking=true, and missing input metadata", () => {
    const report = replayReportFor("success.json");
    const scorecard = scorecardFor(report);
    expect(errorCodes(createRuntimeFailureToolInvocationGovernanceAdvisoryReport({
      ...report,
      diagnosticsOnly: false,
    } as never, scorecard))).toContain("invalid_authority");

    expect(errorCodes(createRuntimeFailureToolInvocationGovernanceAdvisoryReport({
      ...report,
      completionProof: true,
    } as never, scorecard))).toContain("invalid_authority");

    expect(errorCodes(createRuntimeFailureToolInvocationGovernanceAdvisoryReport({
      ...report,
      activeBlocking: true,
    } as never, scorecard))).toContain("invalid_authority");

    expect(errorCodes(createRuntimeFailureToolInvocationGovernanceAdvisoryReport(report, {
      ...scorecard,
      activeBlocking: true,
    } as never))).toContain("invalid_authority");

    expect(errorCodes(createRuntimeFailureToolInvocationGovernanceAdvisoryReport({
      ...report,
      replay: undefined,
    } as never, scorecard))).toContain("missing_required");

    expect(errorCodes(createRuntimeFailureToolInvocationGovernanceAdvisoryReport(report, {
      ...scorecard,
      source: undefined,
    } as never))).toContain("missing_required");
  });

  it("rejects non-JSON payloads, oversized input/output, and missing finding provenance", () => {
    const report = replayReportFor("tool-error.json");
    const scorecard = scorecardFor(report);
    const circularReport = { ...report } as RuntimeFailureReplayReport & { self?: unknown };
    circularReport.self = circularReport;
    expect(errorCodes(createRuntimeFailureToolInvocationGovernanceAdvisoryReport(circularReport, scorecard))).toContain(
      "payload_not_json",
    );

    const circularScorecard = { ...scorecard } as RuntimeFailureTaskOutcomeScorecard & { self?: unknown };
    circularScorecard.self = circularScorecard;
    expect(errorCodes(createRuntimeFailureToolInvocationGovernanceAdvisoryReport(report, circularScorecard))).toContain(
      "payload_not_json",
    );

    expect(errorCodes(createRuntimeFailureToolInvocationGovernanceAdvisoryReport(report, scorecard, {
      maxReplayReportBytes: 64,
    }))).toContain("payload_oversized");

    expect(errorCodes(createRuntimeFailureToolInvocationGovernanceAdvisoryReport(report, scorecard, {
      maxGovernanceReportBytes: 64,
    }))).toContain("payload_oversized");

    const governance = governanceFor(report);
    const missingFindingProvenance = {
      ...governance,
      findings: governance.findings.map((finding, index): RuntimeFailureToolInvocationGovernanceFinding =>
        index === 0
          ? {
            ...finding,
            provenance: {
              replayRefs: [],
              scorecardRefs: [],
              failureRefs: [],
              evidenceRefs: [],
              touchedPathRefs: [],
            },
          }
          : finding
      ),
    };
    expect(errorCodes(validateRuntimeFailureToolInvocationGovernanceAdvisoryReport(missingFindingProvenance))).toContain(
      "missing_required",
    );
  });

  it("does not let raw prompt, provider payload, tool args, secrets, env, or workspace content survive governance output", () => {
    const report = replayReportFor("tool-error.json");
    const hostileFailureEvents = report.failureEvents.map((event): FailureEvent => ({
      ...event,
      id: `${event.id}:API_KEY=sk-governanceSecretShouldNotSurvive123456`,
      summary:
        "raw prompt should not survive providerPayload={\"messages\":[\"raw prompt should not survive\"]} toolArgs={\"secret\":\"do-not-report\"} PASSWORD=hunter2",
      evidenceRefs: [
        "providerPayload={\"messages\":[\"raw prompt should not survive\"]}",
        "toolArgs={\"secret\":\"do-not-report\"}",
        "C:\\Users\\27933\\Desktop\\clawx\\ClawX\\private\\secret-file.ts",
      ],
    }));
    const hostileReport: RuntimeFailureReplayReport = {
      ...report,
      replay: {
        ...report.replay,
        id: "replay-providerPayload={\"messages\":[\"raw prompt should not survive\"]}-API_KEY=sk-governanceSecretShouldNotSurvive123456",
      },
      failureEvents: hostileFailureEvents,
      touchedPathSummaries: [
        {
          path: "C:\\Users\\27933\\Desktop\\clawx\\ClawX\\private\\secret-file.ts",
          status: "modified",
          summary: "PASSWORD=hunter2 toolResult={\"secret\":\"do-not-report\"}",
        },
      ],
    };

    const governance = governanceFor(hostileReport);
    const payload = JSON.stringify(governance);
    expect(payload).not.toContain("raw prompt should not survive");
    expect(payload).not.toContain("do-not-report");
    expect(payload).not.toContain("hunter2");
    expect(payload).not.toContain("secret-file.ts");
    expect(payload).not.toContain("providerPayload");
    expect(payload).not.toContain("toolArgs");
    expect(payload).not.toContain("API_KEY");
    expect(payload).not.toContain("PASSWORD");
    expect(payload).toContain("[redacted");
  });

  it("does not introduce an active governance consumer", () => {
    const forbiddenRoots = [
      "openclaw_runtime/src/agents",
      "openclaw_runtime/src/gateway",
      "openclaw_runtime/src/acp",
      "electron/services",
      "electron/main",
      "src",
    ];
    const hits = forbiddenRoots.flatMap((root) => sourceHits(root, [
      "failure-tool-invocation-governance-advisory",
      "createRuntimeFailureToolInvocationGovernanceAdvisoryReport",
    ]));

    expect(hits).toEqual([]);
  });

  it("does not introduce checkpoint or lifecycle authority writes", () => {
    const authorityFiles = [
      "openclaw_runtime/src/runtime-core/checkpoint-serializer.ts",
      "openclaw_runtime/src/gateway/session-compaction-checkpoints.ts",
      "openclaw_runtime/src/acp/persistent-bindings.lifecycle.ts",
    ];
    const hits = authorityFiles.flatMap((file) => sourceFileHits(file, [
      "failure-tool-invocation-governance-advisory",
      "createRuntimeFailureToolInvocationGovernanceAdvisoryReport",
    ]));

    expect(hits).toEqual([]);
  });
});

function provenanceRefCount(
  value: RuntimeFailureToolInvocationGovernanceFinding | RuntimeFailureToolInvocationGovernanceAdvisoryReport["aggregate"],
): number {
  return value.provenance.replayRefs.length
    + value.provenance.scorecardRefs.length
    + value.provenance.failureRefs.length
    + value.provenance.evidenceRefs.length
    + value.provenance.touchedPathRefs.length;
}

function findingByRule(
  report: RuntimeFailureToolInvocationGovernanceAdvisoryReport,
  ruleId: RuntimeFailureToolInvocationGovernanceFinding["ruleId"],
): RuntimeFailureToolInvocationGovernanceFinding {
  const finding = report.findings.find((entry) => entry.ruleId === ruleId);
  expect(finding).toBeDefined();
  if (!finding) {
    throw new Error(`Missing governance finding for ${ruleId}.`);
  }
  return finding;
}

function sourceHits(root: string, needles: string[]): string[] {
  const absoluteRoot = join(process.cwd(), root);
  if (!existsSync(absoluteRoot)) {
    return [];
  }
  return collectSourceFiles(absoluteRoot).flatMap((file) => sourceFileHits(file, needles));
}

function sourceFileHits(file: string, needles: string[]): string[] {
  const absoluteFile = isAbsolute(file) ? file : join(process.cwd(), file);
  if (!existsSync(absoluteFile)) {
    return [];
  }
  const content = readFileSync(absoluteFile, "utf8");
  return needles.some((needle) => content.includes(needle))
    ? [absoluteFile.replace(process.cwd(), "").replace(/^[\\/]/, "")]
    : [];
}

function collectSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = join(root, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "build", ".git"].includes(entry.name)) {
        return [];
      }
      return collectSourceFiles(child);
    }
    return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [child] : [];
  });
}
