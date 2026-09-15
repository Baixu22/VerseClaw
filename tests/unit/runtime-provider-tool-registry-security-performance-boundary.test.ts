import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTaskLoopRunsForTests,
  runTaskLoop,
} from "../../openclaw_runtime/src/agents/task-loop-controller";
import {
  collectRuntimeRegistryDiagnostics,
  isRuntimeRegistryDiagnostic,
  isRuntimeTaskEvent,
  type RuntimeRegistryDiagnostic,
  type RuntimeRegistryDiagnosticReason,
  type RuntimeRegistryDiagnosticStatus,
  type RuntimeTaskEvent,
} from "../../openclaw_runtime/src/runtime-core";

type SensitiveKind =
  | "api_key"
  | "bearer_token"
  | "jwt"
  | "private_key"
  | "windows_user_path"
  | "env_secret"
  | "raw_tool_payload";

type SensitiveMatch = {
  kind: SensitiveKind;
  path: string;
};

const registryEnabledConfig = {
  runtime: {
    registryPilot: { enabled: true },
    providerRegistry: { shadow: true },
    contextProviders: { registryPilot: true },
    toolRegistry: { shadow: true },
    registryDiagnostics: { collector: true },
  },
};

const SENSITIVE_PATTERNS: Array<{ kind: SensitiveKind; pattern: RegExp }> = [
  { kind: "api_key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/gu },
  { kind: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._-]{24,}\b/gu },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu },
  { kind: "private_key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu },
  { kind: "windows_user_path", pattern: /\b[A-Z]:\\Users\\[^\\\s]+\\[^\s"]+/gu },
  { kind: "env_secret", pattern: /\b[A-Z0-9_]*(?:TOKEN|SECRET|KEY)=\S{8,}/gu },
  { kind: "raw_tool_payload", pattern: /RAW_TOOL_PAYLOAD_SECRET_[A-Z0-9_]+/gu },
];

const FIXTURE_API_KEY = ["sk", "proj", "adversarial1234567890abcdef1234567890"].join("-");
const SHADOW_API_KEY = ["sk", "proj", "taskloopshadow1234567890abcdef"].join("-");
const FIXTURE_BEARER = `Bearer ${["registry", "boundary", "token", "1234567890abcdef"].join("_")}`;
const SHADOW_BEARER = `Bearer ${["taskloop", "shadow", "token", "1234567890abcdef"].join("_")}`;
const FIXTURE_JWT = [
  "eyJhbGciOiJIUzI1NiJ9",
  "eyJzdWIiOiJyZWdpc3RyeSJ9",
  "signature123456",
].join(".");
const FIXTURE_PRIVATE_KEY_HEADER = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
const FIXTURE_ENV_SECRET = `GITHUB_${"TOKEN"}=ghp_registryboundary1234567890`;
const SHADOW_ENV_SECRET = `OPENAI_API_${"KEY"}=${SHADOW_API_KEY}`;

afterEach(() => {
  clearTaskLoopRunsForTests();
});

describe("registry diagnostic security and performance boundary", () => {
  it("locates adversarial content leakage in collector output with path-level evidence", () => {
    const diagnostics = buildAdversarialDiagnostics();
    const collected = collectRuntimeRegistryDiagnostics({
      enabled: true,
      prioritize: true,
      limit: diagnostics.length,
      diagnostics,
      metadata: {
        securityBoundaryAssessment: true,
        inMemoryOnly: true,
      },
    });

    const matches = findSensitiveMatches(collected);
    const byKind = countBy(matches.map((match) => match.kind));
    const pathsByKind = summarizePathsByKind(matches);

    console.info(
      `[registry-security-leak-detection-metrics] ${JSON.stringify({
        adversarialDiagnosticCount: diagnostics.length,
        leakMatchCount: matches.length,
        leakedKinds: Object.keys(byKind).sort(),
        byKind,
        pathsByKind,
        collectorIncludedCount: collected.summary.includedDiagnosticCount,
        collectorOmittedCount: collected.omittedDiagnosticCount,
      })}`,
    );

    expect(collected.summary.includedDiagnosticCount).toBe(diagnostics.length);
    expect(matches.length).toBeGreaterThanOrEqual(7);
    expect(byKind).toMatchObject({
      api_key: expect.any(Number),
      bearer_token: expect.any(Number),
      jwt: expect.any(Number),
      private_key: expect.any(Number),
      windows_user_path: expect.any(Number),
      env_secret: expect.any(Number),
      raw_tool_payload: expect.any(Number),
    });
    expect(matches.some((match) => match.path.includes(".message"))).toBe(true);
    expect(matches.some((match) => match.path.includes(".metadata"))).toBe(true);
    expect(matches.some((match) => match.path.includes(".evidenceRefs"))).toBe(true);
  });

  it("redacts adversarial content when collector sanitized projection is enabled", () => {
    const diagnostics = buildAdversarialDiagnostics();
    const collected = collectRuntimeRegistryDiagnostics({
      enabled: true,
      prioritize: true,
      sanitize: true,
      limit: diagnostics.length,
      diagnostics,
      metadata: {
        securityBoundaryAssessment: true,
        rawFixture: FIXTURE_API_KEY,
        env: FIXTURE_ENV_SECRET,
      },
    });

    const matches = findSensitiveMatches(collected);
    const redactedDiagnostics = collected.diagnostics.filter((item) =>
      item.metadata?.redactionStatus === "sanitized"
    ).length;

    console.info(
      `[registry-security-sanitized-projection-metrics] ${JSON.stringify({
        adversarialDiagnosticCount: diagnostics.length,
        sanitizedIncludedCount: collected.summary.includedDiagnosticCount,
        redactedDiagnostics,
        leakMatchCount: matches.length,
        evidenceRefCount: collected.evidenceRefs.length,
        metadataRedacted: collected.metadata?.redactionStatus === "sanitized",
      })}`,
    );

    expect(collected.summary.includedDiagnosticCount).toBe(diagnostics.length);
    expect(collected.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
    expect(redactedDiagnostics).toBe(diagnostics.length);
    expect(matches).toHaveLength(0);
    expect(collected.evidenceRefs.every((ref) =>
      ref.ref.startsWith("runtime-registry-evidence:")
    )).toBe(true);
    expect(collected.metadata).toMatchObject({
      redactionStatus: "sanitized",
      metadataRedacted: true,
    });
  });

  it("redacts injected diagnostic content in TaskLoop shadow events without touching authoritative paths", async () => {
    const sensitiveDiagnostic = diagnostic("tool", "shadow-sensitive-tool", "error", "provider_error", {
      message: `Tool adapter included Authorization: ${SHADOW_BEARER}`,
      metadata: {
        rawToolPayload: "RAW_TOOL_PAYLOAD_SECRET_TASKLOOP_SHADOW",
        env: SHADOW_ENV_SECRET,
      },
      evidenceSummary: "User file C:\\Users\\alice\\.ssh\\id_rsa was mentioned by adapter.",
    });
    const shadows: RuntimeTaskEvent[] = [];
    const lifecycle: unknown[] = [];
    const checkpoints: unknown[] = [];
    const selfCheck = vi.fn(async () => ({
      decision: "complete",
      confidence: 0.9,
      missingEvidence: [],
      verificationGaps: [],
      risks: [],
      validationState: { status: "passed", checks: ["security boundary"], evidenceRefs: [] },
      contextSummary: "complete",
    }));

    const result = await runTaskLoop(
      { task: "security boundary", sessionKey: "agent:main:security", workspaceId: "workspace-security" },
      {
        ...registryEnabledConfig,
        agents: { defaults: { taskLoop: { runtimeTaskEventLogShadow: true } } },
      },
      {
        idFactory: (prefix) => `${prefix}_security_boundary`,
        now: () => 1_700_000_000_000,
        ensureTaskLedgerRoot: vi.fn(() => "tlroot_security_boundary"),
        runObserved: (async (request: { templateId?: string }) => fakeTaskLoopResult(request.templateId)) as never,
        selfCheck: selfCheck as never,
        getSubagentRun: getEvidenceRun as never,
        lifecycle: (event) => lifecycle.push(event),
        recordCheckpoint: ((input: unknown) => checkpoints.push(input)) as never,
        runtimeRegistryDiagnostics: [sensitiveDiagnostic],
        runtimeTaskEventShadowSink: (event) => shadows.push(event),
        storeTrace: vi.fn() as never,
      },
    );

    const shadowMatches = findSensitiveMatches(shadows);
    const shadowRegistryDiagnostics = shadows.flatMap((event) => {
      const registryDiagnostics = (
        event.payload as { metadata?: { registryDiagnostics?: { diagnostics?: RuntimeRegistryDiagnostic[] } } }
      ).metadata?.registryDiagnostics?.diagnostics;
      return registryDiagnostics ?? [];
    });
    const authoritativeMatches = findSensitiveMatches({
      result,
      lifecycle,
      checkpoints,
      selfCheckCalls: selfCheck.mock.calls,
    });

    console.info(
      `[registry-security-shadow-path-metrics] ${JSON.stringify({
        shadowEventCount: shadows.length,
        shadowRegistryDiagnosticCount: shadowRegistryDiagnostics.length,
        shadowLeakMatchCount: shadowMatches.length,
        authoritativeLeakMatchCount: authoritativeMatches.length,
        shadowLeakKinds: Object.keys(countBy(shadowMatches.map((match) => match.kind))).sort(),
        sanitizedShadowDiagnostics: shadowRegistryDiagnostics.filter((item) =>
          item.metadata?.redactionStatus === "sanitized"
        ).length,
      })}`,
    );

    expect(result).toMatchObject({ status: "complete", phase: "complete" });
    expect(shadows.every(isRuntimeTaskEvent)).toBe(true);
    expect(shadowRegistryDiagnostics.length).toBeGreaterThan(0);
    expect(shadowRegistryDiagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
    expect(shadowRegistryDiagnostics.every((item) =>
      item.metadata?.redactionStatus === "sanitized"
    )).toBe(true);
    expect(shadowMatches).toHaveLength(0);
    expect(authoritativeMatches).toHaveLength(0);
  });

  it("quantifies multi-session prioritized collector latency and heap envelope", () => {
    const sessionCount = 24;
    const diagnosticsPerSession = 1_024;
    const defaultLatencies: number[] = [];
    const prioritizedLatencies: number[] = [];
    const sanitizedPrioritizedLatencies: number[] = [];
    let defaultCriticalIncluded = 0;
    let prioritizedCriticalIncluded = 0;
    let sanitizedPrioritizedCriticalIncluded = 0;
    const heapBefore = heapUsed();

    for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex += 1) {
      const diagnostics = buildPerformanceDiagnostics(diagnosticsPerSession, sessionIndex);
      const defaultStartedAt = performance.now();
      const defaultCollected = collectRuntimeRegistryDiagnostics({
        enabled: true,
        limit: 128,
        diagnostics,
        metadata: {
          performanceBoundaryAssessment: true,
          sessionIndex,
        },
      });
      defaultLatencies.push(performance.now() - defaultStartedAt);
      defaultCriticalIncluded += countCriticalDiagnostics(defaultCollected.diagnostics);

      const prioritizedStartedAt = performance.now();
      const prioritizedCollected = collectRuntimeRegistryDiagnostics({
        enabled: true,
        prioritize: true,
        limit: 128,
        diagnostics,
        metadata: {
          performanceBoundaryAssessment: true,
          sessionIndex,
          prioritizeHighValueDiagnostics: true,
        },
      });
      prioritizedLatencies.push(performance.now() - prioritizedStartedAt);
      prioritizedCriticalIncluded += countCriticalDiagnostics(prioritizedCollected.diagnostics);

      const sanitizedPrioritizedStartedAt = performance.now();
      const sanitizedPrioritizedCollected = collectRuntimeRegistryDiagnostics({
        enabled: true,
        prioritize: true,
        sanitize: true,
        limit: 128,
        diagnostics,
        metadata: {
          performanceBoundaryAssessment: true,
          sessionIndex,
          prioritizeHighValueDiagnostics: true,
          sanitizedProjection: true,
        },
      });
      sanitizedPrioritizedLatencies.push(performance.now() - sanitizedPrioritizedStartedAt);
      sanitizedPrioritizedCriticalIncluded += countCriticalDiagnostics(
        sanitizedPrioritizedCollected.diagnostics,
      );

      expect(defaultCollected.summary.includedDiagnosticCount).toBe(128);
      expect(defaultCollected.omittedDiagnosticCount).toBe(896);
      expect(prioritizedCollected.summary.includedDiagnosticCount).toBe(128);
      expect(prioritizedCollected.omittedDiagnosticCount).toBe(896);
      expect(sanitizedPrioritizedCollected.summary.includedDiagnosticCount).toBe(128);
      expect(sanitizedPrioritizedCollected.omittedDiagnosticCount).toBe(896);
      expect(sanitizedPrioritizedCollected.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
      expect(sanitizedPrioritizedCollected.evidenceRefs.every((ref) =>
        ref.ref.startsWith("runtime-registry-evidence:")
      )).toBe(true);
    }

    const heapAfter = heapUsed();
    const heapDeltaMb = heapBefore === null || heapAfter === null
      ? null
      : roundMetric(Math.max(0, heapAfter - heapBefore) / (1024 * 1024));
    const metrics = {
      sessionCount,
      diagnosticsPerSession,
      totalInputDiagnostics: sessionCount * diagnosticsPerSession,
      defaultLatencyMs: latencySummary(defaultLatencies),
      prioritizedLatencyMs: latencySummary(prioritizedLatencies),
      sanitizedPrioritizedLatencyMs: latencySummary(sanitizedPrioritizedLatencies),
      defaultCriticalIncluded,
      prioritizedCriticalIncluded,
      sanitizedPrioritizedCriticalIncluded,
      heapDeltaMb,
    };

    console.info(`[registry-performance-envelope-metrics] ${JSON.stringify(metrics)}`);

    expect(metrics.defaultLatencyMs.p95).toBeLessThan(50);
    expect(metrics.prioritizedLatencyMs.p95).toBeLessThan(75);
    expect(metrics.sanitizedPrioritizedLatencyMs.p95).toBeLessThan(100);
    expect(metrics.sanitizedPrioritizedLatencyMs.p99).toBeLessThan(125);
    expect(prioritizedCriticalIncluded).toBeGreaterThan(defaultCriticalIncluded);
    expect(sanitizedPrioritizedCriticalIncluded).toBe(prioritizedCriticalIncluded);
    if (heapDeltaMb !== null) {
      expect(heapDeltaMb).toBeLessThan(128);
    }
  });
});

function diagnostic(
  surface: RuntimeRegistryDiagnostic["surface"],
  providerId: string,
  status: RuntimeRegistryDiagnosticStatus,
  reason: RuntimeRegistryDiagnosticReason,
  options: {
    message?: string;
    metadata?: Record<string, unknown>;
    evidenceSummary?: string;
  } = {},
): RuntimeRegistryDiagnostic {
  return {
    surface,
    providerId,
    status,
    reason,
    message: options.message ?? `${providerId}:${reason}`,
    evidenceRefs: [{
      type: surface === "tool" ? "tool" : "other",
      ref: `registry-security:${providerId}`,
      label: "Registry security boundary fixture",
      summary: options.evidenceSummary,
      metadata: options.metadata as never,
    }],
    metadata: options.metadata as never,
  };
}

function buildAdversarialDiagnostics(): RuntimeRegistryDiagnostic[] {
  return [
    diagnostic("tool", "api-key-message", "error", "provider_error", {
      message: `Provider returned ${FIXTURE_API_KEY} in an error.`,
    }),
    diagnostic("tool", "bearer-metadata", "error", "tool_error", {
      metadata: { authorization: FIXTURE_BEARER },
    }),
    diagnostic("context", "jwt-evidence", "error", "provider_exception", {
      evidenceSummary: `JWT ${FIXTURE_JWT}`,
    }),
    diagnostic("context", "private-key-message", "error", "provider_error", {
      message: `${FIXTURE_PRIVATE_KEY_HEADER} test fixture only -----END PRIVATE KEY-----`,
    }),
    diagnostic("context", "windows-path", "fallback", "legacy_authoritative", {
      evidenceSummary: "Adapter referenced C:\\Users\\alice\\.ssh\\id_rsa.",
    }),
    diagnostic("tool", "env-secret", "denied", "policy_denied", {
      metadata: { env: FIXTURE_ENV_SECRET },
    }),
    diagnostic("tool", "raw-payload", "waiting", "policy_waiting", {
      metadata: { raw: "RAW_TOOL_PAYLOAD_SECRET_ADVERSARIAL_CORPUS" },
    }),
  ];
}

function buildPerformanceDiagnostics(
  count: number,
  sessionIndex: number,
): RuntimeRegistryDiagnostic[] {
  const diagnostics: RuntimeRegistryDiagnostic[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index < 768) {
      diagnostics.push(diagnostic(
        index % 2 === 0 ? "tool" : "context",
        `session-${sessionIndex}-low-${index}`,
        index % 3 === 0 ? "ok" : "fallback",
        index % 3 === 0 ? "registered" : "legacy_authoritative",
      ));
      continue;
    }
    const criticalReasons: RuntimeRegistryDiagnosticReason[] = [
      "provider_exception",
      "runtime_unavailable",
      "policy_denied",
      "policy_waiting",
      "tool_error",
      "provider_error",
      "timeout",
    ];
    const reason = criticalReasons[(index - 768) % criticalReasons.length] ?? "provider_error";
    diagnostics.push(diagnostic(
      "tool",
      `session-${sessionIndex}-critical-${index}`,
      reason === "policy_denied" ? "denied" : reason === "policy_waiting" ? "waiting" : "error",
      reason,
    ));
  }
  return diagnostics;
}

function findSensitiveMatches(value: unknown, path = "$"): SensitiveMatch[] {
  if (typeof value === "string") {
    return SENSITIVE_PATTERNS.flatMap(({ kind, pattern }) => {
      pattern.lastIndex = 0;
      return pattern.test(value) ? [{ kind, path }] : [];
    });
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSensitiveMatches(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      findSensitiveMatches(child, `${path}.${key}`)
    );
  }
  return [];
}

function countBy<T extends string>(values: readonly T[]): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function summarizePathsByKind(
  matches: readonly SensitiveMatch[],
): Partial<Record<SensitiveKind, string[]>> {
  const out: Partial<Record<SensitiveKind, string[]>> = {};
  for (const match of matches) {
    out[match.kind] = [...(out[match.kind] ?? []), match.path];
  }
  return out;
}

function countCriticalDiagnostics(diagnostics: readonly RuntimeRegistryDiagnostic[]): number {
  const criticalReasons = new Set<RuntimeRegistryDiagnosticReason>([
    "provider_exception",
    "runtime_unavailable",
    "policy_denied",
    "policy_waiting",
    "tool_error",
    "provider_error",
    "timeout",
  ]);
  return diagnostics.filter((item) => criticalReasons.has(item.reason)).length;
}

function latencySummary(values: readonly number[]) {
  return {
    min: roundMetric(Math.min(...values)),
    max: roundMetric(Math.max(...values)),
    avg: roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length),
    p95: roundMetric(percentile(values, 0.95)),
    p99: roundMetric(percentile(values, 0.99)),
  };
}

function percentile(values: readonly number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * percentileValue) - 1,
  );
  return sorted[index] ?? 0;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function heapUsed(): number | null {
  return typeof process !== "undefined" && typeof process.memoryUsage === "function"
    ? process.memoryUsage().heapUsed
    : null;
}

function fakeTaskLoopResult(templateId = "quick-development") {
  const plan = {
    mode: "lead-workers" as const,
    leadRole: "planner",
    templateId,
    verifierRole: "reviewer",
    reasons: [`template:${templateId}`],
    workers: [
      { roleName: "implementer", task: "implement" },
      { roleName: "tester", task: "test" },
      { roleName: "reviewer", task: "review" },
    ],
  };
  return {
    plan,
    outcomes: plan.workers.map((worker, index) => ({
      roleName: worker.roleName,
      task: worker.task,
      isVerifier: false,
      spawn: { status: "accepted", result: { runId: `run_${index}`, childSessionKey: `child_${index}` } },
    })),
    spawnedRunIds: ["run_0", "run_1", "run_2"],
    expectedWorkerRunIds: ["run_0", "run_1", "run_2"],
    pendingVerifier: true,
    failures: [],
  };
}

function getEvidenceRun(runId?: string, childSessionKey?: string) {
  if (!runId || !childSessionKey) return null;
  return {
    runId,
    childSessionKey,
    requesterSessionKey: "agent:main:security",
    requesterDisplayKey: "Main",
    task: "task",
    cleanup: "delete",
    createdAt: 1,
    endedAt: 2,
    outcome: { status: "ok" },
    completion: {
      required: true,
      capturedAt: 2,
      resultText: [
        "## Summary",
        `Completed ${runId} with evidence.`,
        "",
        "## Files Touched",
        `src/${runId}.ts`,
        "",
        "## Tests Run",
        `pnpm exec vitest run ${runId}.test.ts passed`,
      ].join("\n"),
    },
  };
}
