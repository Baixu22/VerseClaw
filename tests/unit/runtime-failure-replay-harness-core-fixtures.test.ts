import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_FAILURE_REPLAY_HARNESS_DIAGNOSTICS_ONLY,
  RUNTIME_FAILURE_REPLAY_REPORT_MAX_BYTES,
  runFailureReplayHarnessCore,
  validateEvidenceEnvelope,
  validateFailureEvent,
  validateReplayCase,
  type FailureEvent,
  type ReplayCase,
  type RuntimeFailureReplayFixtureBundle,
  type RuntimeFailureReplayReport,
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
  expectedFailureKinds?: string[];
  expectedEvidenceDecisions?: Array<{
    kind: string;
    accepted: boolean;
    authority: string;
  }>;
  expectedTouchedPathSummaries?: string[];
};

function loadFixture(name: typeof FIXTURE_NAMES[number]): ReplayFixtureFile {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as ReplayFixtureFile;
}

function expectReport(name: typeof FIXTURE_NAMES[number]): RuntimeFailureReplayReport {
  const fixture = loadFixture(name);
  const replayValidation = validateReplayCase(fixture.replayCase);
  expect(replayValidation.ok).toBe(true);
  if (!replayValidation.ok) {
    throw new Error(replayValidation.errors.map((issue) => `${issue.path}:${issue.code}`).join(", "));
  }

  const first = runFailureReplayHarnessCore(replayValidation.value, fixture.fixtures, { nowMs: NOW_MS });
  const second = runFailureReplayHarnessCore(replayValidation.value, fixture.fixtures, { nowMs: NOW_MS });

  expect(first.ok).toBe(true);
  expect(second.ok).toBe(true);
  if (!first.ok || !second.ok) {
    throw new Error("Replay fixture did not produce a report.");
  }
  expect(first.value).toEqual(second.value);
  expect(JSON.parse(JSON.stringify(first.value))).toEqual(first.value);
  expect(new TextEncoder().encode(JSON.stringify(first.value)).length).toBeLessThanOrEqual(
    RUNTIME_FAILURE_REPLAY_REPORT_MAX_BYTES,
  );
  return first.value;
}

function errorCodes(result: { ok: true } | { ok: false; errors: Array<{ code: string }> }): string[] {
  return result.ok ? [] : result.errors.map((issue) => issue.code);
}

describe("runtime failure replay harness core fixtures", () => {
  it("accepts the first five fixture-backed ReplayCase scenarios", () => {
    const scenarios = FIXTURE_NAMES.map((name) => {
      const fixture = loadFixture(name);
      const report = expectReport(name);
      expect(report.diagnosticsOnly).toBe(true);
      expect(report.completionProof).toBe(false);
      expect(report.status.passed).toBe(true);
      expect(report.replay.fixtureRefs).toEqual({
        provider: fixture.replayCase.input.providerFixture,
        tool: fixture.replayCase.input.toolFixture,
        workspace: fixture.replayCase.input.workspaceFixture,
      });
      return report.replay.scenario;
    });

    expect(scenarios).toEqual([
      "success",
      "tool_error",
      "provider_timeout",
      "test_failure",
      "dirty_workspace",
    ]);
  });

  it("proves fixture failure events and evidence decisions are validated", () => {
    for (const name of FIXTURE_NAMES) {
      const fixture = loadFixture(name);
      const report = expectReport(name);
      const expectedFailureKinds = fixture.expectedFailureKinds ?? [];
      expect(report.failureEvents.map((event) => event.kind)).toEqual(expectedFailureKinds);

      for (const event of report.failureEvents) {
        expect(validateFailureEvent(event).ok).toBe(true);
      }
      for (const decision of report.evidenceEnvelopeDecisions) {
        expect(decision.accepted).toBe(true);
        expect(decision.authority).toBe("none");
      }
      for (const expectedDecision of fixture.expectedEvidenceDecisions ?? []) {
        expect(report.evidenceEnvelopeDecisions).toEqual(
          expect.arrayContaining([
            expect.objectContaining(expectedDecision),
          ]),
        );
      }
    }
  });

  it("rejects missing provider, tool, and workspace fixtures", () => {
    const fixture = loadFixture("tool-error.json");
    expect(errorCodes(runFailureReplayHarnessCore(fixture.replayCase, {
      ...fixture.fixtures,
      provider: undefined as never,
    }, { nowMs: NOW_MS }))).toContain("missing_fixture");
    expect(errorCodes(runFailureReplayHarnessCore(fixture.replayCase, {
      ...fixture.fixtures,
      tool: undefined as never,
    }, { nowMs: NOW_MS }))).toContain("missing_fixture");
    expect(errorCodes(runFailureReplayHarnessCore(fixture.replayCase, {
      ...fixture.fixtures,
      workspace: undefined as never,
    }, { nowMs: NOW_MS }))).toContain("missing_fixture");
  });

  it("rejects live provider defaults, invalid scenarios, and invalid budgets", () => {
    const fixture = loadFixture("provider-timeout.json");
    expect(errorCodes(runFailureReplayHarnessCore({
      ...fixture.replayCase,
      input: { ...fixture.replayCase.input, providerFixture: "live" },
    }, {
      ...fixture.fixtures,
      provider: { ...fixture.fixtures.provider, ref: "live", liveProvider: true },
    }, { nowMs: NOW_MS }))).toContain("live_provider_default");

    expect(errorCodes(runFailureReplayHarnessCore({
      ...fixture.replayCase,
      scenario: "provider_live" as never,
    }, fixture.fixtures, { nowMs: NOW_MS }))).toContain("invalid_enum");

    expect(errorCodes(runFailureReplayHarnessCore({
      ...fixture.replayCase,
      budgets: {},
    }, fixture.fixtures, { nowMs: NOW_MS }))).toContain("invalid_budget");
  });

  it("rejects invalid loaded FailureEvent and EvidenceEnvelope fixtures", () => {
    const fixture = loadFixture("tool-error.json");
    const invalidFailureEvent = {
      id: "invalid-loaded-failure",
      stage: "provider_retry",
      kind: "timeout",
      recoverability: "retryable",
      suggestedAction: "retry",
      confidence: 0.8,
      source: "fixture",
      occurredAt: "2026-07-01T11:59:00.000Z",
      summary: "Invalid failure fixture.",
      evidenceRefs: [],
      rawRetained: false,
      redaction: "sanitized",
    } as unknown as FailureEvent;

    expect(errorCodes(runFailureReplayHarnessCore(fixture.replayCase, {
      ...fixture.fixtures,
      failureSignals: [],
      failureEvents: [invalidFailureEvent],
    }, { nowMs: NOW_MS }))).toContain("invalid_enum");

    const invalidEnvelope = {
      id: "invalid-envelope",
      kind: "failure_summary",
      source: { component: "fixture" },
      scope: {},
      createdAt: "2026-07-01T11:59:00.000Z",
      ttlMs: 120000,
      confidence: 0.8,
      redaction: { state: "sanitized", rawRetained: false, secretScan: "pass" },
      provenance: { producer: "fixture", version: "0", inputs: [] },
      authority: "runtime",
      payload: { summary: "invalid authority" },
    };
    expect(validateEvidenceEnvelope(invalidEnvelope, { nowMs: NOW_MS }).ok).toBe(false);
    expect(errorCodes(runFailureReplayHarnessCore(fixture.replayCase, {
      ...fixture.fixtures,
      evidenceEnvelopes: [invalidEnvelope as never],
    }, { nowMs: NOW_MS }))).toContain("invalid_authority");
  });

  it("rejects oversized reports", () => {
    const fixture = loadFixture("test-failure-after-repair.json");
    expect(errorCodes(runFailureReplayHarnessCore(fixture.replayCase, fixture.fixtures, {
      nowMs: NOW_MS,
      maxReportBytes: 64,
    }))).toContain("payload_oversized");
  });

  it("does not let raw prompt, provider payload, tool args, secrets, env, or workspace content survive the report", () => {
    const reports = FIXTURE_NAMES.map(expectReport);
    const payload = JSON.stringify(reports);

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

  it("keeps touched path summaries sanitized and bounded", () => {
    const report = expectReport("dirty-workspace.json");
    expect(report.touchedPathSummaries).toEqual([
      expect.objectContaining({
        path: "[redacted-path]",
        status: "dirty",
      }),
    ]);
  });

  it("does not introduce an active replay harness consumer", () => {
    expect(RUNTIME_FAILURE_REPLAY_HARNESS_DIAGNOSTICS_ONLY).toBe(true);
    const forbiddenRoots = [
      "openclaw_runtime/src/agents",
      "openclaw_runtime/src/gateway",
      "openclaw_runtime/src/acp",
      "electron/services",
      "electron/main",
      "src",
    ];
    const hits = forbiddenRoots.flatMap((root) => sourceHits(root, [
      "failure-replay-harness-core",
      "runFailureReplayHarnessCore",
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
      "failure-replay-harness-core",
      "runFailureReplayHarnessCore",
    ]));

    expect(hits).toEqual([]);
  });
});

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
