import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRuntimeFailureTaskOutcomeScorecardFromReplayReport,
  runFailureReplayHarnessCore,
  validateReplayCase,
  type ReplayCase,
  type RuntimeFailureReplayFixtureBundle,
  type RuntimeFailureReplayReport,
  type RuntimeFailureReplayTouchedPathSummary,
  type RuntimeFailureTaskOutcomeScorecard,
  type RuntimeFailureTaskOutcomeScorecardMetricId,
} from "../../openclaw_runtime/src/runtime-core";
import {
  RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_MAX_BYTES,
  RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_FALSE_BLOCK_CASES,
  RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_TRIGGER_SIGNALS,
  createRuntimeFailureDestructiveOperationGuardEvidenceProofReport,
  validateRuntimeFailureDestructiveOperationGuardEvidenceProofReport,
  type RuntimeFailureDestructiveOperationGuardEvidenceProofCaseInput,
  type RuntimeFailureDestructiveOperationGuardEvidenceProofReport,
} from "../../openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-evidence-proof";

const NOW_MS = Date.parse("2026-07-01T12:00:00.000Z");
const FIXTURE_DIR = join(process.cwd(), "tests/fixtures/runtime-replay");
const FIXTURE_NAMES = [
  "success.json",
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

function proofFor(
  cases = destructiveOperationGuardCorpus(),
): RuntimeFailureDestructiveOperationGuardEvidenceProofReport {
  const result = createRuntimeFailureDestructiveOperationGuardEvidenceProofReport(cases);
  if (!result.ok) {
    throw new Error(result.errors.map((issue) => `${issue.path}:${issue.code}:${issue.message}`).join(", "));
  }
  expect(result.ok).toBe(true);
  return result.value;
}

describe("runtime failure destructive_operation_guard evidence proof", () => {
  it("covers positive trigger metadata and the false-block corpus without active authority", () => {
    const proof = proofFor();

    expect(proof).toMatchObject({
      diagnosticsOnly: true,
      completionProof: false,
      evaluationMetadataOnly: true,
      authority: "none",
      governanceDecisionAuthority: "none",
      activeBlocking: false,
      candidateRuleId: "destructive_operation_guard",
      readiness: {
        status: "evidence_conditions_met_not_active_runtime_ready",
        activeRuntimeReady: false,
        defaultOffLimitedActiveGuardCanBeProposedByFutureSpec: true,
      },
      safety: {
        activeRuntimeConsumer: false,
        toolBlockingBehaviorChanged: false,
        checkpointLifecycleAuthorityWrite: false,
        completionProof: false,
        rawPayloadRetained: false,
      },
    });

    expect(proof.source).toMatchObject({
      caseCount: 9,
      triggerCaseCount: 1,
      falseBlockCaseCount: 8,
    });
    expect(Object.values(proof.coverage.triggerSignals).every(Boolean)).toBe(true);
    expect(Object.values(proof.coverage.falseBlockCases).every(Boolean)).toBe(true);
    expect(proof.coverage.provenance).toEqual({
      replayScenarioTerminalStatusRefs: true,
      scorecardAggregateDecisionRefs: true,
      wrongFileEditMetricRefs: true,
      unnecessaryEditMetricRefs: true,
      failureRefs: true,
      evidenceRefs: true,
      touchedPathRefs: true,
    });
    expect(proof.coverage.rollbackReadiness).toMatchObject({
      futureFlagDisableRollbackRequired: true,
      futureOwnerBoundary: "tool_invocation_preflight",
      activeConsumerBoundaryScanPlanned: true,
      checkpointLifecycleAuthorityWriteAllowed: false,
    });

    const trigger = caseById(proof, "positive-deleted-and-scorecard-fail");
    expect(trigger.outcome).toBe("evidence_qualified_trigger");
    expect(trigger.triggerSignals).toEqual([...RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_TRIGGER_SIGNALS]);
    expect(trigger.phase5Finding.futureActiveCandidate).toEqual({
      action: "block",
      requiresAcceptedSpec: true,
    });
    expect(trigger.scorecard.wrongFileEdit.ref).toBe("scorecard:metric:wrong_file_edit:fail");
    expect(trigger.scorecard.unnecessaryEdit.ref).toBe("scorecard:metric:unnecessary_edit:fail");

    for (const falseBlockCase of RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_FALSE_BLOCK_CASES) {
      const entry = proof.cases.find((item) => item.falseBlockCase === falseBlockCase);
      expect(entry).toBeDefined();
      expect(entry?.passed).toBe(true);
      expect(entry?.outcome).toBe("not_triggered");
    }

    const expectedDeletion = caseById(proof, "false-block-expected-deletion");
    expect(expectedDeletion.triggerSignals).toEqual([
      "deleted_touched_path_metadata",
      "phase5_future_block_candidate",
    ]);
    expect(expectedDeletion.phase5Finding.futureActiveCandidate).toEqual({
      action: "block",
      requiresAcceptedSpec: true,
    });
    expect(expectedDeletion.scorecard.wrongFileEdit.status).toBe("pass");
    expect(expectedDeletion.scorecard.unnecessaryEdit.status).toBe("pass");
  });

  it("keeps proof output bounded, serializable, sanitized, and diagnostics-only", () => {
    const hostileCase = destructiveOperationGuardCorpus()[0];
    const proof = proofFor([
      {
        ...hostileCase,
        id: "providerPayload={\"messages\":[\"raw prompt should not survive\"]}-API_KEY=sk-proofSecretShouldNotSurvive123456",
        notes: [
          "toolArgs={\"secret\":\"do-not-report\"} toolResult={\"secret\":\"do-not-report\"} PASSWORD=hunter2 C:\\Users\\27933\\Desktop\\clawx\\ClawX\\private\\secret-file.ts",
        ],
      },
      ...destructiveOperationGuardCorpus().slice(1),
    ]);
    const payload = JSON.stringify(proof);

    expect(JSON.parse(payload)).toEqual(proof);
    expect(new TextEncoder().encode(payload).length).toBeLessThanOrEqual(
      RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_EVIDENCE_PROOF_MAX_BYTES,
    );
    expect(payload).not.toContain("raw prompt should not survive");
    expect(payload).not.toContain("do-not-report");
    expect(payload).not.toContain("hunter2");
    expect(payload).not.toContain("secret-file.ts");
    expect(payload).not.toContain("providerPayload");
    expect(payload).not.toContain("toolArgs");
    expect(payload).not.toContain("toolResult");
    expect(payload).not.toContain("API_KEY");
    expect(payload).not.toContain("PASSWORD");
    expect(payload).toContain("[redacted");

    expect(validateRuntimeFailureDestructiveOperationGuardEvidenceProofReport({
      ...proof,
      activeBlocking: true,
    }).ok).toBe(false);
    expect(validateRuntimeFailureDestructiveOperationGuardEvidenceProofReport({
      ...proof,
      completionProof: true,
    }).ok).toBe(false);
    expect(validateRuntimeFailureDestructiveOperationGuardEvidenceProofReport({
      ...proof,
      authority: "block",
    }).ok).toBe(false);
  });

  it("reports needs_more_evidence when a false-block case becomes evidence-qualified", () => {
    const unsafeFalseBlock = destructiveOperationGuardCorpus().map((entry) => {
      if (entry.id !== "false-block-expected-deletion") {
        return entry;
      }
      return {
        ...entry,
        scorecard: scorecardWithMetricFailures(entry.scorecard, ["wrong_file_edit", "unnecessary_edit"]),
      };
    });
    const proof = proofFor(unsafeFalseBlock);
    const expectedDeletion = caseById(proof, "false-block-expected-deletion");

    expect(expectedDeletion.passed).toBe(false);
    expect(expectedDeletion.outcome).toBe("evidence_qualified_trigger");
    expect(proof.readiness).toMatchObject({
      status: "needs_more_evidence",
      activeRuntimeReady: false,
      defaultOffLimitedActiveGuardCanBeProposedByFutureSpec: false,
    });
  });

  it("does not introduce an active evidence proof consumer or checkpoint authority write", () => {
    const forbiddenRoots = [
      "openclaw_runtime/src/agents",
      "openclaw_runtime/src/gateway",
      "openclaw_runtime/src/acp",
      "electron/services",
      "electron/main",
      "src",
    ];
    const hits = forbiddenRoots.flatMap((root) => sourceHits(root, [
      "failure-tool-invocation-governance-destructive-operation-guard-evidence-proof",
      "createRuntimeFailureDestructiveOperationGuardEvidenceProofReport",
    ]));

    expect(hits).toEqual([]);

    const authorityFiles = [
      "openclaw_runtime/src/runtime-core/checkpoint-serializer.ts",
      "openclaw_runtime/src/gateway/session-compaction-checkpoints.ts",
      "openclaw_runtime/src/acp/persistent-bindings.lifecycle.ts",
    ];
    const authorityHits = authorityFiles.flatMap((file) => sourceFileHits(file, [
      "failure-tool-invocation-governance-destructive-operation-guard-evidence-proof",
      "createRuntimeFailureDestructiveOperationGuardEvidenceProofReport",
    ]));

    expect(authorityHits).toEqual([]);
  });
});

function destructiveOperationGuardCorpus(): RuntimeFailureDestructiveOperationGuardEvidenceProofCaseInput[] {
  const success = replayReportFor("success.json");
  const testRepair = replayReportFor("test-failure-after-repair.json");
  const dirtyWorkspace = replayReportFor("dirty-workspace.json");
  const positive = withReplayId(
    withTouchedPaths(dirtyWorkspace, [
      {
        path: "src/generated-delete-target.ts",
        status: "deleted",
        summary: "Deleted synthetic fixture target after unsafe repair attempt.",
      },
      ...dirtyWorkspace.touchedPathSummaries,
    ]),
    "positive-deleted-and-scorecard-fail-replay",
  );
  const expectedDeletion = withReplayId(
    withTouchedPaths(success, [
      {
        path: "src/expected-remove-fixture.ts",
        status: "deleted",
        summary: "Expected fixture deletion during completed task.",
      },
    ]),
    "false-block-expected-deletion-replay",
  );

  return [
    {
      id: "positive-deleted-and-scorecard-fail",
      expectation: "trigger",
      replayReport: positive,
      scorecard: scorecardWithMetricFailures(scorecardFor(positive), ["wrong_file_edit", "unnecessary_edit"]),
      notes: ["Deleted touched-path metadata plus failing edit scorecard metadata should qualify the proof trigger."],
    },
    {
      id: "false-block-expected-edit",
      expectation: "false_block",
      falseBlockCase: "expected_edit",
      replayReport: withReplayId(success, "false-block-expected-edit-replay"),
      scorecard: scorecardFor(withReplayId(success, "false-block-expected-edit-replay")),
      notes: ["Expected fixture edit remains a non-trigger."],
    },
    {
      id: "false-block-expected-deletion",
      expectation: "false_block",
      falseBlockCase: "expected_deletion",
      replayReport: expectedDeletion,
      scorecard: scorecardFor(expectedDeletion),
      notes: ["Expected deletion may carry Phase 5 future metadata, but passing edit metrics keep the proof non-triggering."],
    },
    {
      id: "false-block-normal-completed-repair",
      expectation: "false_block",
      falseBlockCase: "normal_completed_repair",
      replayReport: withReplayId(
        withTouchedPaths(success, [
          {
            path: "src/repair-target.ts",
            status: "modified",
            summary: "Completed synthetic repair modified the intended fixture file.",
          },
        ]),
        "false-block-normal-completed-repair-replay",
      ),
      scorecard: scorecardFor(withReplayId(
        withTouchedPaths(success, [
          {
            path: "src/repair-target.ts",
            status: "modified",
            summary: "Completed synthetic repair modified the intended fixture file.",
          },
        ]),
        "false-block-normal-completed-repair-replay",
      )),
      notes: ["Normal completed repair remains outside destructive-operation trigger conditions."],
    },
    {
      id: "false-block-completed-test-repair",
      expectation: "false_block",
      falseBlockCase: "completed_test_repair",
      replayReport: withReplayId(testRepair, "false-block-completed-test-repair-replay"),
      scorecard: scorecardFor(withReplayId(testRepair, "false-block-completed-test-repair-replay")),
      notes: ["Completed test repair is not a destructive-operation block."],
    },
    {
      id: "false-block-sanitized-or-inconclusive-path",
      expectation: "false_block",
      falseBlockCase: "sanitized_or_inconclusive_touched_path",
      replayReport: withReplayId(
        withTouchedPaths(success, [
          {
            path: "[redacted-path]",
            status: "modified",
            summary: "Sanitized fixture mutation cannot prove file ownership.",
          },
        ]),
        "false-block-sanitized-or-inconclusive-path-replay",
      ),
      scorecard: scorecardFor(withReplayId(
        withTouchedPaths(success, [
          {
            path: "[redacted-path]",
            status: "modified",
            summary: "Sanitized fixture mutation cannot prove file ownership.",
          },
        ]),
        "false-block-sanitized-or-inconclusive-path-replay",
      )),
      notes: ["Sanitized or inconclusive touched-path metadata cannot qualify the destructive-operation trigger."],
    },
    {
      id: "false-block-legitimate-fixture-mutation",
      expectation: "false_block",
      falseBlockCase: "legitimate_fixture_mutation",
      replayReport: withReplayId(success, "false-block-legitimate-fixture-mutation-replay"),
      scorecard: scorecardFor(withReplayId(success, "false-block-legitimate-fixture-mutation-replay")),
      notes: ["Fixture-owned mutation remains allowed evidence metadata."],
    },
    {
      id: "false-block-slow-test-command",
      expectation: "false_block",
      falseBlockCase: "slow_test_command",
      replayReport: withReplayId(withMaxDuration(testRepair, 600000), "false-block-slow-test-command-replay"),
      scorecard: scorecardFor(withReplayId(withMaxDuration(testRepair, 600000), "false-block-slow-test-command-replay")),
      notes: ["Slow completed test metadata is not destructive-operation evidence."],
    },
    {
      id: "false-block-known-dev-server-like-long-running",
      expectation: "false_block",
      falseBlockCase: "known_dev_server_like_long_running",
      replayReport: devServerLikeReport(success),
      scorecard: scorecardFor(devServerLikeReport(success)),
      notes: ["Known dev-server-like long-running metadata is not destructive-operation evidence."],
    },
  ];
}

function scorecardWithMetricFailures(
  scorecard: RuntimeFailureTaskOutcomeScorecard,
  ids: RuntimeFailureTaskOutcomeScorecardMetricId[],
): RuntimeFailureTaskOutcomeScorecard {
  const idSet = new Set(ids);
  const metrics = scorecard.metrics.map((metric) =>
    idSet.has(metric.id)
      ? {
        ...metric,
        status: "fail" as const,
        score: -1 as const,
        summary: `Synthetic ${metric.id} failure metadata for destructive-operation evidence proof.`,
      }
      : metric
  );
  return {
    ...scorecard,
    metrics,
    aggregate: {
      ...scorecard.aggregate,
      decision: "regressed",
      score: metrics.reduce((total, metric) => total + metric.score, 0),
      reasons: [
        "synthetic_destructive_operation_metric_fail",
        ...scorecard.aggregate.reasons,
      ],
    },
  };
}

function withReplayId(report: RuntimeFailureReplayReport, id: string): RuntimeFailureReplayReport {
  return {
    ...report,
    replay: {
      ...report.replay,
      id,
    },
  };
}

function withTouchedPaths(
  report: RuntimeFailureReplayReport,
  touchedPathSummaries: RuntimeFailureReplayTouchedPathSummary[],
): RuntimeFailureReplayReport {
  return {
    ...report,
    touchedPathSummaries,
  };
}

function withMaxDuration(report: RuntimeFailureReplayReport, maxDurationMs: number): RuntimeFailureReplayReport {
  return {
    ...report,
    replay: {
      ...report.replay,
      budgets: {
        ...report.replay.budgets,
        maxDurationMs,
      },
    },
  };
}

function devServerLikeReport(report: RuntimeFailureReplayReport): RuntimeFailureReplayReport {
  return {
    ...report,
    replay: {
      ...report.replay,
      id: "false-block-known-dev-server-like-long-running-replay",
      terminalStatus: "interrupted",
      expectedTerminalStatus: "interrupted",
      budgets: {
        ...report.replay.budgets,
        maxDurationMs: 1800000,
      },
      fixtureRefs: {
        ...report.replay.fixtureRefs,
        tool: "runtime-replay/tools/dev-server-like-long-running",
      },
    },
    status: {
      passed: true,
      reasons: ["dev_server_like_long_running_fixture", "terminal_status_matched"],
    },
    failureEvents: [],
    evidenceEnvelopeDecisions: [],
    touchedPathSummaries: [],
  };
}

function caseById(
  proof: RuntimeFailureDestructiveOperationGuardEvidenceProofReport,
  id: string,
): RuntimeFailureDestructiveOperationGuardEvidenceProofReport["cases"][number] {
  const entry = proof.cases.find((item) => item.id === id);
  expect(entry).toBeDefined();
  if (!entry) {
    throw new Error(`Missing proof case ${id}.`);
  }
  return entry;
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
