import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_DECISIONS,
  RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_MAX_BYTES,
  RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_METRIC_IDS,
  createRuntimeFailureTaskOutcomeScorecardFromReplayReport,
  runFailureReplayHarnessCore,
  validateRuntimeFailureTaskOutcomeScorecard,
  validateReplayCase,
  type FailureEvent,
  type ReplayCase,
  type RuntimeFailureReplayFixtureBundle,
  type RuntimeFailureReplayReport,
  type RuntimeFailureTaskOutcomeScorecard,
  type RuntimeFailureTaskOutcomeScorecardMetric,
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

function scorecardFor(name: typeof FIXTURE_NAMES[number]): RuntimeFailureTaskOutcomeScorecard {
  const result = createRuntimeFailureTaskOutcomeScorecardFromReplayReport(replayReportFor(name));
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.errors.map((issue) => `${issue.path}:${issue.code}`).join(", "));
  }
  return result.value;
}

function errorCodes(result: { ok: true } | { ok: false; errors: Array<{ code: string }> }): string[] {
  return result.ok ? [] : result.errors.map((issue) => issue.code);
}

describe("runtime failure task outcome scorecard from replay reports", () => {
  it("accepts the Phase 3 five replay fixture reports and covers the Phase 4 metric set", () => {
    const decisions = new Set<string>();
    for (const name of FIXTURE_NAMES) {
      const scorecard = scorecardFor(name);
      expect(scorecard.diagnosticsOnly).toBe(true);
      expect(scorecard.completionProof).toBe(false);
      expect(scorecard.authority).toBe("none");
      expect(scorecard.evaluationMetadataOnly).toBe(true);
      expect(scorecard.safety).toMatchObject({
        sanitizedReplayReportOnly: true,
        activeRuntimeConsumer: false,
        checkpointLifecycleAuthorityWrite: false,
      });
      expect(scorecard.metrics.map((metric) => metric.id)).toEqual([...RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_METRIC_IDS]);
      expect(RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_DECISIONS).toContain(scorecard.aggregate.decision);
      decisions.add(scorecard.aggregate.decision);
    }

    expect(decisions).toEqual(new Set(["improved", "neutral"]));
  });

  it("proves repeated scorecard generation is deterministic, JSON-serializable, and bounded", () => {
    for (const name of FIXTURE_NAMES) {
      const report = replayReportFor(name);
      const first = createRuntimeFailureTaskOutcomeScorecardFromReplayReport(report);
      const second = createRuntimeFailureTaskOutcomeScorecardFromReplayReport(report);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) {
        throw new Error("Scorecard generation failed.");
      }
      expect(first.value).toEqual(second.value);
      expect(JSON.parse(JSON.stringify(first.value))).toEqual(first.value);
      expect(new TextEncoder().encode(JSON.stringify(first.value)).length).toBeLessThanOrEqual(
        RUNTIME_FAILURE_TASK_OUTCOME_SCORECARD_MAX_BYTES,
      );
    }
  });

  it("keeps provenance refs on every nontrivial metric and aggregate decision", () => {
    for (const name of FIXTURE_NAMES) {
      const scorecard = scorecardFor(name);
      for (const metric of scorecard.metrics) {
        expect(provenanceRefCount(metric)).toBeGreaterThan(0);
      }
      expect(provenanceRefCount(scorecard.aggregate)).toBeGreaterThan(0);
    }
  });

  it("supports improved, regressed, neutral, and inconclusive aggregate decisions", () => {
    const improved = scorecardFor("success.json").aggregate.decision;
    const neutral = scorecardFor("tool-error.json").aggregate.decision;
    const regressed = expectScorecard({
      ...replayReportFor("success.json"),
      replay: {
        ...replayReportFor("success.json").replay,
        terminalStatus: "failed",
      },
      status: {
        passed: false,
        reasons: ["terminal_status_mismatch"],
      },
    }).aggregate.decision;
    const inconclusive = expectScorecard({
      ...replayReportFor("success.json"),
      touchedPathSummaries: [
        {
          path: "[redacted-path]",
          status: "modified",
          summary: "Sanitized mutation path cannot prove expected file ownership.",
        },
      ],
    }).aggregate.decision;

    expect(new Set([improved, neutral, regressed, inconclusive])).toEqual(
      new Set(["improved", "neutral", "regressed", "inconclusive"]),
    );
  });

  it("rejects diagnosticsOnly=false, completionProof=true, and missing replay metadata", () => {
    const report = replayReportFor("success.json");
    expect(errorCodes(createRuntimeFailureTaskOutcomeScorecardFromReplayReport({
      ...report,
      diagnosticsOnly: false,
    } as never))).toContain("invalid_authority");

    expect(errorCodes(createRuntimeFailureTaskOutcomeScorecardFromReplayReport({
      ...report,
      completionProof: true,
    } as never))).toContain("invalid_authority");

    expect(errorCodes(createRuntimeFailureTaskOutcomeScorecardFromReplayReport({
      ...report,
      replay: undefined,
    } as never))).toContain("missing_required");
  });

  it("rejects non-JSON payloads, oversized replay reports, oversized scorecards, and missing provenance", () => {
    const report = replayReportFor("tool-error.json");
    const circular = { ...report } as RuntimeFailureReplayReport & { self?: unknown };
    circular.self = circular;
    expect(errorCodes(createRuntimeFailureTaskOutcomeScorecardFromReplayReport(circular))).toContain("payload_not_json");

    expect(errorCodes(createRuntimeFailureTaskOutcomeScorecardFromReplayReport(report, {
      maxReplayReportBytes: 64,
    }))).toContain("payload_oversized");

    expect(errorCodes(createRuntimeFailureTaskOutcomeScorecardFromReplayReport(report, {
      maxScorecardBytes: 64,
    }))).toContain("payload_oversized");

    const missingFailureProvenance = {
      ...report,
      failureEvents: report.failureEvents.map((event) => ({ ...event, evidenceRefs: [] })),
      evidenceEnvelopeDecisions: [],
    };
    expect(errorCodes(createRuntimeFailureTaskOutcomeScorecardFromReplayReport(missingFailureProvenance))).toContain(
      "missing_required",
    );

    const scorecard = scorecardFor("tool-error.json");
    const missingMetricProvenance = {
      ...scorecard,
      metrics: scorecard.metrics.map((metric, index) =>
        index === 0
          ? {
            ...metric,
            provenance: {
              replayRefs: [],
              failureRefs: [],
              evidenceRefs: [],
              touchedPathRefs: [],
            },
          }
          : metric
      ),
    };
    expect(errorCodes(validateRuntimeFailureTaskOutcomeScorecard(missingMetricProvenance))).toContain("missing_required");
  });

  it("does not let raw prompt, provider payload, tool args, secrets, env, or workspace content survive the scorecard", () => {
    const report = replayReportFor("tool-error.json");
    const hostileFailureEvents = report.failureEvents.map((event): FailureEvent => ({
      ...event,
      id: `${event.id}:API_KEY=sk-scorecardSecretShouldNotSurvive123456`,
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
        id: "replay-providerPayload={\"messages\":[\"raw prompt should not survive\"]}-API_KEY=sk-scorecardSecretShouldNotSurvive123456",
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

    const scorecard = expectScorecard(hostileReport);
    const payload = JSON.stringify(scorecard);
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

  it("does not introduce an active scorecard consumer", () => {
    const forbiddenRoots = [
      "openclaw_runtime/src/agents",
      "openclaw_runtime/src/gateway",
      "openclaw_runtime/src/acp",
      "electron/services",
      "electron/main",
      "src",
    ];
    const hits = forbiddenRoots.flatMap((root) => sourceHits(root, [
      "failure-task-outcome-scorecard",
      "createRuntimeFailureTaskOutcomeScorecardFromReplayReport",
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
      "failure-task-outcome-scorecard",
      "createRuntimeFailureTaskOutcomeScorecardFromReplayReport",
    ]));

    expect(hits).toEqual([]);
  });
});

function expectScorecard(report: RuntimeFailureReplayReport): RuntimeFailureTaskOutcomeScorecard {
  const result = createRuntimeFailureTaskOutcomeScorecardFromReplayReport(report);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.errors.map((issue) => `${issue.path}:${issue.code}`).join(", "));
  }
  return result.value;
}

function provenanceRefCount(value: RuntimeFailureTaskOutcomeScorecardMetric | RuntimeFailureTaskOutcomeScorecard["aggregate"]): number {
  return value.provenance.replayRefs.length
    + value.provenance.failureRefs.length
    + value.provenance.evidenceRefs.length
    + value.provenance.touchedPathRefs.length;
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
