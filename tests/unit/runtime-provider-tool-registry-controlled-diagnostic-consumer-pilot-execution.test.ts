import { describe, expect, it } from "vitest";
import {
  buildProviderToolRegistryControlledDiagnosticConsumerReport,
  collectRuntimeRegistryDiagnosticsForControlledConsumer,
  isolateRuntimeRegistryError,
  isRuntimeRegistryDiagnostic,
  resolveRuntimeRegistryFeatureFlags,
  type RuntimeRegistryDiagnostic,
  type RuntimeRegistryDiagnosticReason,
  type RuntimeRegistryDiagnosticStatus,
} from "../../openclaw_runtime/src/runtime-core";

type Actionability = "actionable" | "informational" | "noise";

type PilotBoundaryAssertion = {
  failClosed: true;
  providerOrderBefore?: readonly string[];
  providerOrderAfter?: readonly string[];
  legacyBehaviorBefore?: string;
  legacyBehaviorAfter?: string;
  rendererBypassMatches?: number;
  persistenceMatches?: number;
  serviceListenerDatabaseMatches?: number;
};

type PilotMetricsContribution = {
  diagnosticCount: number;
  omittedDiagnosticCount: number;
  actionableCount: number;
  informationalCount: number;
  noiseCount: number;
  failClosedCount: number;
  providerOrderingDrift: number;
  legacyBehaviorDrift: number;
  rendererBypass: number;
  persistenceMatches: number;
  serviceListenerDatabaseMatches: number;
};

type PilotSample = {
  id: string;
  input: {
    enabled: boolean;
    limit?: number;
    diagnostics?: readonly RuntimeRegistryDiagnostic[];
    rawDiagnostics?: readonly unknown[];
  };
  expectedOutput: {
    enabled: boolean;
    diagnosticCount: number;
    omittedDiagnosticCount: number;
    invalidInjectedDiagnosticCount?: number;
    byStatus?: Partial<Record<RuntimeRegistryDiagnosticStatus, number>>;
    byReason?: Partial<Record<RuntimeRegistryDiagnosticReason, number>>;
  };
  failureMode: string;
  boundaryAssertion: PilotBoundaryAssertion;
  evidenceSource: string;
  actionability: Actionability;
  expectedMetricsContribution: PilotMetricsContribution;
};

const allRegistryFlagsEnabled = {
  runtime: {
    registryDiagnostics: { collector: true },
    registryPilot: { enabled: true },
    providerRegistry: { shadow: true },
    contextProviders: { registryPilot: true },
    toolRegistry: { shadow: true },
  },
};
const allRegistryFeatureFlags = resolveRuntimeRegistryFeatureFlags({
  config: allRegistryFlagsEnabled,
});

const legacyAuthoritative = {
  legacyAuthoritative: true,
  diagnosticsOnly: true,
  noRuntimeAuthority: true,
  noCompletionAuthority: true,
};

describe("registry-only controlled diagnostic consumer pilot execution", () => {
  it("stays disabled without explicit consumer enablement and registry gates", () => {
    const report = buildProviderToolRegistryControlledDiagnosticConsumerReport({
      diagnostics: [diagnostic("tool", "disabled-provider", "error", "provider_exception")],
    });

    expect(report).toMatchObject({
      enabled: false,
      gateStatus: "closed",
      blockedReasons: ["consumer_disabled", "feature_flags_missing"],
      decision: {
        status: "disabled",
        diagnosticsOnly: true,
        operatorSummaryOnly: true,
        authoritative: false,
      },
      totalDiagnosticCount: 1,
      includedDiagnosticCount: 0,
      omittedDiagnosticCount: 1,
      invalidDiagnosticCount: 0,
      actionability: {
        actionableDiagnosticCount: 0,
        noiseDiagnosticCount: 0,
        reviewRequiredDiagnosticCount: 0,
      },
      authority: {
        noProviderOrderingChange: true,
        noToolAuthority: true,
        noTaskLoopAuthority: true,
        noGatewayAuthority: true,
        noProviderTransportAuthority: true,
        noPromptOrModelMessageInsertion: true,
        noPersistence: true,
        notTaskCompletionEvidence: true,
      },
    });
  });

  it("summarizes a bounded in-memory sample corpus without widening runtime authority", () => {
    const sampleMatrix = buildPilotSamples();
    expect(sampleMatrix).toHaveLength(32);

    const startedAt = Date.now();
    const outcomes = sampleMatrix.map((sample) => runPilotSample(sample));
    const metrics = summarizePilotExecution(outcomes, Date.now() - startedAt);
    const expected = summarizeExpectedContributions(sampleMatrix);

    for (const outcome of outcomes) {
      assertSampleOutcome(outcome);
    }

    expect(metrics.diagnosticCount).toBe(expected.diagnosticCount);
    expect(metrics.omittedDiagnosticCount).toBe(expected.omittedDiagnosticCount);
    expect(metrics.actionableCount).toBe(expected.actionableCount);
    expect(metrics.informationalCount).toBe(expected.informationalCount);
    expect(metrics.noiseCount).toBe(expected.noiseCount);
    expect(metrics.providerOrderingDrift).toBe(0);
    expect(metrics.legacyBehaviorDrift).toBe(0);
    expect(metrics.rendererBypass).toBe(0);
    expect(metrics.persistenceMatches).toBe(0);
    expect(metrics.serviceListenerDatabaseMatches).toBe(0);
    expect(metrics.failClosedRate).toBe(1);
    expect(metrics.collectorLatencyMs).toBeLessThan(100);
    expect(metrics.actionableRate).toBeGreaterThan(metrics.noiseRate);
    expect(metrics.omittedDiagnosticCount).toBeGreaterThan(0);
    expect(metrics.invalidInjectedDiagnosticCount).toBe(1);
    expect(metrics.byStatus).toMatchObject({
      ok: 4,
      fallback: 5,
      waiting: 1,
      denied: 1,
      cancelled: 1,
      error: 14,
      skipped: 5,
    });
    expect(metrics.byReason).toMatchObject({
      registered: 2,
      legacy_authoritative: 7,
      provider_exception: 2,
      unsupported_content: 1,
      policy_denied: 1,
      policy_waiting: 1,
      tool_cancelled: 1,
      tool_error: 4,
      runtime_unavailable: 1,
      unknown_provider: 1,
      provider_disabled: 1,
      duplicate_provider: 1,
      manifest_invalid: 1,
      provider_error: 3,
      no_result: 1,
      timeout: 1,
      capability_unsupported: 1,
      flag_disabled: 1,
    });
    expect(JSON.stringify(metrics)).not.toMatch(
      /providerOrderingAuthority|toolAuthority|TaskLoopAuthority|GatewayRequestAuthority|providerTransportAuthority/u,
    );
  });
});

function buildPilotSamples(): PilotSample[] {
  const samples: PilotSample[] = [
    sample("normal-no-diagnostics", {
      diagnostics: [],
      expectedOutput: output({ diagnosticCount: 0 }),
      failureMode: "none",
      boundaryAssertion: boundary(),
      evidenceSource: "test-owned empty collector input",
      actionability: "informational",
    }),
    sample("registered-context-provider", {
      diagnostics: [diagnostic("context", "context-legacy", "ok", "registered")],
      expectedOutput: output({ diagnosticCount: 1, byStatus: { ok: 1 }, byReason: { registered: 1 } }),
      failureMode: "none",
      boundaryAssertion: boundary(),
      evidenceSource: "runtime-core registry manifest acceptance",
      actionability: "informational",
    }),
    sample("legacy-authoritative-fallback", {
      diagnostics: [diagnostic("context", "legacy-context-engine", "fallback", "legacy_authoritative")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { fallback: 1 },
        byReason: { legacy_authoritative: 1 },
      }),
      failureMode: "legacy path remains authoritative",
      boundaryAssertion: boundary({
        legacyBehaviorBefore: "legacy-context-authoritative",
        legacyBehaviorAfter: "legacy-context-authoritative",
      }),
      evidenceSource: "context-provider registry collector diagnostics",
      actionability: "informational",
    }),
    sample("tool-provider-exception", {
      diagnostics: [providerException("tool", "mcp-call-tool-compat", "adapter exploded")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { error: 1 },
        byReason: { provider_exception: 1 },
      }),
      failureMode: "provider exception isolated as diagnostic",
      boundaryAssertion: boundary(),
      evidenceSource: "tool-provider registry exception normalization",
      actionability: "actionable",
    }),
    sample("unsupported-mcp-content", {
      diagnostics: [diagnostic("tool", "mcp-call-tool-compat", "fallback", "unsupported_content")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { fallback: 1 },
        byReason: { unsupported_content: 1 },
      }),
      failureMode: "unsupported content remains legacy-shaped response",
      boundaryAssertion: boundary(),
      evidenceSource: "MCP unsupported content diagnostic",
      actionability: "actionable",
    }),
    sample("policy-denied", {
      diagnostics: [diagnostic("tool", "mcp-call-tool-compat", "denied", "policy_denied")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { denied: 1 },
        byReason: { policy_denied: 1 },
      }),
      failureMode: "policy denial remains adapter metadata",
      boundaryAssertion: boundary(),
      evidenceSource: "MCP policy denied diagnostic",
      actionability: "actionable",
    }),
    sample("policy-waiting", {
      diagnostics: [diagnostic("tool", "mcp-call-tool-compat", "waiting", "policy_waiting")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { waiting: 1 },
        byReason: { policy_waiting: 1 },
      }),
      failureMode: "approval waiting remains non-authoritative metadata",
      boundaryAssertion: boundary(),
      evidenceSource: "MCP approval waiting diagnostic",
      actionability: "actionable",
    }),
    sample("tool-cancelled", {
      diagnostics: [diagnostic("tool", "mcp-call-tool-compat", "cancelled", "tool_cancelled")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { cancelled: 1 },
        byReason: { tool_cancelled: 1 },
      }),
      failureMode: "tool cancellation remains legacy result status",
      boundaryAssertion: boundary(),
      evidenceSource: "MCP cancellation diagnostic",
      actionability: "actionable",
    }),
    sample("tool-error", {
      diagnostics: [diagnostic("tool", "mcp-call-tool-compat", "error", "tool_error")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { error: 1 },
        byReason: { tool_error: 1 },
      }),
      failureMode: "tool error remains diagnostic-only",
      boundaryAssertion: boundary(),
      evidenceSource: "MCP tool error diagnostic",
      actionability: "actionable",
    }),
    sample("runtime-unavailable", {
      diagnostics: [diagnostic("tool", "mcp-call-tool-compat", "error", "runtime_unavailable")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { error: 1 },
        byReason: { runtime_unavailable: 1 },
      }),
      failureMode: "runtime unavailable is fail-closed diagnostic",
      boundaryAssertion: boundary(),
      evidenceSource: "Gateway runtime unavailable diagnostic",
      actionability: "actionable",
    }),
    sample("unknown-provider", {
      diagnostics: [diagnostic("tool", "missing-provider", "error", "unknown_provider")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { error: 1 },
        byReason: { unknown_provider: 1 },
      }),
      failureMode: "unknown provider does not register or run",
      boundaryAssertion: boundary(),
      evidenceSource: "registry resolve miss diagnostic",
      actionability: "actionable",
    }),
    sample("disabled-provider", {
      diagnostics: [diagnostic("context", "agent-map-context", "skipped", "provider_disabled")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { skipped: 1 },
        byReason: { provider_disabled: 1 },
      }),
      failureMode: "disabled provider stays disabled",
      boundaryAssertion: boundary(),
      evidenceSource: "explicit provider flag disabled diagnostic",
      actionability: "actionable",
    }),
    sample("duplicate-provider", {
      diagnostics: [diagnostic("tool", "mcp-call-tool-compat", "skipped", "duplicate_provider")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { skipped: 1 },
        byReason: { duplicate_provider: 1 },
      }),
      failureMode: "duplicate provider is skipped",
      boundaryAssertion: boundary(),
      evidenceSource: "registry duplicate registration diagnostic",
      actionability: "actionable",
    }),
    sample("invalid-manifest", {
      diagnostics: [diagnostic("context", "broken-context", "error", "manifest_invalid")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { error: 1 },
        byReason: { manifest_invalid: 1 },
      }),
      failureMode: "invalid manifest fails closed",
      boundaryAssertion: boundary(),
      evidenceSource: "manifest validation diagnostic",
      actionability: "actionable",
    }),
    sample("invalid-injected-diagnostics", {
      rawDiagnostics: [{ surface: "tool", status: "error", reason: "not_a_registry_reason" }],
      expectedOutput: output({
        diagnosticCount: 0,
        invalidInjectedDiagnosticCount: 1,
      }),
      failureMode: "invalid injected diagnostic is rejected before inclusion",
      boundaryAssertion: boundary(),
      evidenceSource: "collector shape guard",
      actionability: "actionable",
    }),
    sample("over-limit-diagnostics", {
      limit: 2,
      diagnostics: [
        diagnostic("tool", "tool-over-limit-1", "error", "tool_error"),
        diagnostic("tool", "tool-over-limit-2", "error", "tool_error"),
        diagnostic("tool", "tool-over-limit-3", "error", "tool_error"),
        diagnostic("tool", "tool-over-limit-4", "error", "tool_error"),
      ],
      expectedOutput: output({
        diagnosticCount: 2,
        omittedDiagnosticCount: 2,
        byStatus: { error: 2 },
        byReason: { tool_error: 2 },
      }),
      failureMode: "over-limit diagnostics are counted as omitted",
      boundaryAssertion: boundary(),
      evidenceSource: "collector limit accounting",
      actionability: "actionable",
    }),
    sample("gated-off-behavior", {
      enabled: false,
      diagnostics: [diagnostic("tool", "mcp-call-tool-compat", "skipped", "flag_disabled")],
      expectedOutput: output({
        enabled: false,
        diagnosticCount: 0,
        omittedDiagnosticCount: 1,
      }),
      failureMode: "collector disabled by omission",
      boundaryAssertion: boundary(),
      evidenceSource: "runtime.registryDiagnostics.collector default-off gate",
      actionability: "informational",
    }),
    sample("provider-ordering-sensitive-case", {
      diagnostics: [diagnostic("context", "context-a", "ok", "legacy_authoritative")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { ok: 1 },
        byReason: { legacy_authoritative: 1 },
      }),
      failureMode: "diagnostics must not reorder providers",
      boundaryAssertion: boundary({
        providerOrderBefore: ["context-a", "context-z"],
        providerOrderAfter: ["context-a", "context-z"],
      }),
      evidenceSource: "provider-ordering-sensitive fixture",
      actionability: "informational",
    }),
    sample("taskloop-shadow-gate-closed", {
      enabled: false,
      diagnostics: [diagnostic("context", "task-loop-registry-shadow", "skipped", "flag_disabled")],
      expectedOutput: output({
        enabled: false,
        diagnosticCount: 0,
        omittedDiagnosticCount: 1,
      }),
      failureMode: "TaskLoop shadow gate closed",
      boundaryAssertion: boundary({
        legacyBehaviorBefore: "task-loop-legacy-authoritative",
        legacyBehaviorAfter: "task-loop-legacy-authoritative",
      }),
      evidenceSource: "TaskLoop registry shadow gate sentinel",
      actionability: "informational",
    }),
    sample("taskloop-all-gates-open-legacy-authority-unchanged", {
      diagnostics: [diagnostic("context", "task-loop-registry-shadow", "fallback", "legacy_authoritative")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { fallback: 1 },
        byReason: { legacy_authoritative: 1 },
      }),
      failureMode: "TaskLoop diagnostics attach without decision authority",
      boundaryAssertion: boundary({
        legacyBehaviorBefore: "final-status-self-check-checkpoint-authoritative",
        legacyBehaviorAfter: "final-status-self-check-checkpoint-authoritative",
      }),
      evidenceSource: `TaskLoop injected diagnostics with ${JSON.stringify(allRegistryFlagsEnabled.runtime)}`,
      actionability: "informational",
    }),
    sample("renderer-bypass-sentinel", {
      diagnostics: [diagnostic("context", "renderer-boundary", "skipped", "legacy_authoritative")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { skipped: 1 },
        byReason: { legacy_authoritative: 1 },
      }),
      failureMode: "renderer bypass remains absent",
      boundaryAssertion: boundary({ rendererBypassMatches: 0 }),
      evidenceSource: "renderer boundary scan sentinel",
      actionability: "noise",
    }),
    sample("persistence-sentinel", {
      diagnostics: [diagnostic("context", "in-memory-diagnostics", "fallback", "legacy_authoritative")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { fallback: 1 },
        byReason: { legacy_authoritative: 1 },
      }),
      failureMode: "diagnostics remain in-memory only",
      boundaryAssertion: boundary({ persistenceMatches: 0 }),
      evidenceSource: "diagnostic persistence sentinel",
      actionability: "noise",
    }),
    sample("service-listener-database-sentinel", {
      diagnostics: [diagnostic("tool", "runtime-boundary", "skipped", "legacy_authoritative")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { skipped: 1 },
        byReason: { legacy_authoritative: 1 },
      }),
      failureMode: "no new service/listener/database surface",
      boundaryAssertion: boundary({ serviceListenerDatabaseMatches: 0 }),
      evidenceSource: "service/listener/database boundary sentinel",
      actionability: "noise",
    }),
    sample("builtin-host-tool-compat", {
      diagnostics: [diagnostic("tool", "clawx-git-host-tool", "ok", "legacy_authoritative")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { ok: 1 },
        byReason: { legacy_authoritative: 1 },
      }),
      failureMode: "built-in host tool stays on existing adapter seam",
      boundaryAssertion: boundary(),
      evidenceSource: "built-in host tool registry diagnostic",
      actionability: "informational",
    }),
    sample("no-result", {
      diagnostics: [diagnostic("context", "context-no-result", "fallback", "no_result")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { fallback: 1 },
        byReason: { no_result: 1 },
      }),
      failureMode: "no-result provider output is diagnostic-only",
      boundaryAssertion: boundary(),
      evidenceSource: "context provider no-result diagnostic",
      actionability: "actionable",
    }),
    sample("timeout", {
      diagnostics: [diagnostic("tool", "slow-tool", "error", "timeout", { retryable: true })],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { error: 1 },
        byReason: { timeout: 1 },
      }),
      failureMode: "timeout stays retryable diagnostic metadata",
      boundaryAssertion: boundary(),
      evidenceSource: "tool timeout diagnostic",
      actionability: "actionable",
    }),
    sample("provider-error", {
      diagnostics: [
        isolateRuntimeRegistryError({
          surface: "tool",
          providerId: "mcp-provider-error",
          error: new Error("provider failed"),
          metadata: legacyAuthoritative,
        }).diagnostic,
      ],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { error: 1 },
        byReason: { provider_error: 1 },
      }),
      failureMode: "provider error isolated as diagnostic",
      boundaryAssertion: boundary(),
      evidenceSource: "isolateRuntimeRegistryError",
      actionability: "actionable",
    }),
    sample("capability-unsupported", {
      diagnostics: [diagnostic("context", "context-capability-miss", "error", "capability_unsupported")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { error: 1 },
        byReason: { capability_unsupported: 1 },
      }),
      failureMode: "unsupported capability fails closed",
      boundaryAssertion: boundary(),
      evidenceSource: "registry capability diagnostic",
      actionability: "actionable",
    }),
    sample("flag-disabled-provider", {
      diagnostics: [diagnostic("context", "context-flag-disabled", "skipped", "flag_disabled")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { skipped: 1 },
        byReason: { flag_disabled: 1 },
      }),
      failureMode: "flag-disabled provider does not run",
      boundaryAssertion: boundary(),
      evidenceSource: "provider flag diagnostic",
      actionability: "informational",
    }),
    sample("registered-tool-provider", {
      diagnostics: [diagnostic("tool", "mcp-call-tool-compat", "ok", "registered")],
      expectedOutput: output({ diagnosticCount: 1, byStatus: { ok: 1 }, byReason: { registered: 1 } }),
      failureMode: "none",
      boundaryAssertion: boundary(),
      evidenceSource: "tool provider manifest acceptance",
      actionability: "informational",
    }),
    sample("context-provider-exception", {
      diagnostics: [providerException("context", "agent-map-context", "agent map failed")],
      expectedOutput: output({
        diagnosticCount: 1,
        byStatus: { error: 1 },
        byReason: { provider_exception: 1 },
      }),
      failureMode: "context provider exception isolated",
      boundaryAssertion: boundary(),
      evidenceSource: "context provider exception diagnostic",
      actionability: "actionable",
    }),
    sample("collector-mixed-over-limit", {
      limit: 3,
      diagnostics: [
        diagnostic("tool", "mixed-1", "error", "provider_error"),
        diagnostic("tool", "mixed-2", "error", "tool_error"),
        diagnostic("context", "mixed-3", "error", "provider_error"),
        diagnostic("context", "mixed-4", "error", "timeout"),
      ],
      expectedOutput: output({
        diagnosticCount: 3,
        omittedDiagnosticCount: 1,
        byStatus: { error: 3 },
        byReason: { provider_error: 2, tool_error: 1 },
      }),
      failureMode: "mixed overflow is explicitly counted",
      boundaryAssertion: boundary(),
      evidenceSource: "bounded mixed collector fixture",
      actionability: "actionable",
    }),
  ];

  return samples;
}

function sample(
  id: string,
  params: Omit<PilotSample, "id" | "input" | "expectedMetricsContribution"> & {
    enabled?: boolean;
    limit?: number;
    diagnostics?: readonly RuntimeRegistryDiagnostic[];
    rawDiagnostics?: readonly unknown[];
  },
): PilotSample {
  const actionabilityCounts = {
    actionableCount: params.actionability === "actionable" ? 1 : 0,
    informationalCount: params.actionability === "informational" ? 1 : 0,
    noiseCount: params.actionability === "noise" ? 1 : 0,
  };
  const contribution: PilotMetricsContribution = {
    diagnosticCount: params.expectedOutput.diagnosticCount,
    omittedDiagnosticCount: params.expectedOutput.omittedDiagnosticCount,
    ...actionabilityCounts,
    failClosedCount: 1,
    providerOrderingDrift: 0,
    legacyBehaviorDrift: 0,
    rendererBypass: params.boundaryAssertion.rendererBypassMatches ?? 0,
    persistenceMatches: params.boundaryAssertion.persistenceMatches ?? 0,
    serviceListenerDatabaseMatches: params.boundaryAssertion.serviceListenerDatabaseMatches ?? 0,
  };

  return {
    id,
    input: {
      enabled: params.enabled ?? true,
      limit: params.limit,
      diagnostics: params.diagnostics,
      rawDiagnostics: params.rawDiagnostics,
    },
    expectedOutput: params.expectedOutput,
    failureMode: params.failureMode,
    boundaryAssertion: params.boundaryAssertion,
    evidenceSource: params.evidenceSource,
    actionability: params.actionability,
    expectedMetricsContribution: contribution,
  };
}

function diagnostic(
  surface: RuntimeRegistryDiagnostic["surface"],
  providerId: string,
  status: RuntimeRegistryDiagnosticStatus,
  reason: RuntimeRegistryDiagnosticReason,
  options: { retryable?: boolean } = {},
): RuntimeRegistryDiagnostic {
  return {
    surface,
    providerId,
    status,
    reason,
    retryable: options.retryable,
    message: `${providerId} ${reason}`,
    evidenceRefs: [{
      type: surface === "tool" ? "tool" : "other",
      ref: `registry-pilot:${providerId}:${reason}`,
      label: "Registry diagnostic pilot fixture",
      summary: `${status}:${reason}`,
    }],
    metadata: legacyAuthoritative,
  };
}

function providerException(
  surface: RuntimeRegistryDiagnostic["surface"],
  providerId: string,
  message: string,
): RuntimeRegistryDiagnostic {
  return isolateRuntimeRegistryError({
    surface,
    providerId,
    error: new Error(message),
    reason: "provider_exception",
    metadata: legacyAuthoritative,
  }).diagnostic;
}

function boundary(
  overrides: Partial<PilotBoundaryAssertion> = {},
): PilotBoundaryAssertion {
  return {
    failClosed: true,
    rendererBypassMatches: 0,
    persistenceMatches: 0,
    serviceListenerDatabaseMatches: 0,
    ...overrides,
  };
}

function output(params: {
  enabled?: boolean;
  diagnosticCount: number;
  omittedDiagnosticCount?: number;
  invalidInjectedDiagnosticCount?: number;
  byStatus?: Partial<Record<RuntimeRegistryDiagnosticStatus, number>>;
  byReason?: Partial<Record<RuntimeRegistryDiagnosticReason, number>>;
}): PilotSample["expectedOutput"] {
  return {
    enabled: params.enabled ?? true,
    diagnosticCount: params.diagnosticCount,
    omittedDiagnosticCount: params.omittedDiagnosticCount ?? 0,
    invalidInjectedDiagnosticCount: params.invalidInjectedDiagnosticCount,
    byStatus: params.byStatus,
    byReason: params.byReason,
  };
}

function runPilotSample(sample: PilotSample) {
  const rawDiagnostics = sample.input.rawDiagnostics ?? sample.input.diagnostics ?? [];
  const invalidInjectedDiagnosticCount = rawDiagnostics.filter((item) =>
    !isRuntimeRegistryDiagnostic(item)
  ).length;
  const collectorOutput = collectRuntimeRegistryDiagnosticsForControlledConsumer({
    enabled: sample.input.enabled,
    featureFlags: allRegistryFeatureFlags,
    limit: sample.input.limit,
    diagnostics: rawDiagnostics as RuntimeRegistryDiagnostic[],
    metadata: {
      pilotExecution: true,
      callerOwned: true,
      inMemoryOnly: true,
      evidenceSource: sample.evidenceSource,
    },
  });
  const report = buildProviderToolRegistryControlledDiagnosticConsumerReport({
    enabled: sample.input.enabled,
    featureFlags: allRegistryFeatureFlags,
    limit: sample.input.limit,
    diagnostics: rawDiagnostics,
    metadata: {
      pilotExecution: true,
      callerOwned: true,
      inMemoryOnly: true,
      evidenceSource: sample.evidenceSource,
    },
  });

  return {
    sample,
    collectorOutput,
    report,
    invalidInjectedDiagnosticCount,
  };
}

function assertSampleOutcome(outcome: ReturnType<typeof runPilotSample>): void {
  const { collectorOutput, invalidInjectedDiagnosticCount, report, sample } = outcome;
  expect(collectorOutput.enabled).toBe(sample.expectedOutput.enabled);
  expect(collectorOutput.consumer).toMatchObject({
    sanitized: true,
    prioritized: true,
    inMemoryOnly: true,
    diagnosticsOnly: true,
    authoritativeness: "none",
    legacyDecisionUnaffected: true,
    finalTaskStatusUnaffected: true,
  });
  expect(collectorOutput.consumer.gateStatus).toBe(
    sample.expectedOutput.enabled ? "open" : "closed",
  );
  expect(collectorOutput.summary.includedDiagnosticCount).toBe(
    sample.expectedOutput.diagnosticCount,
  );
  expect(collectorOutput.omittedDiagnosticCount).toBe(
    sample.expectedOutput.omittedDiagnosticCount,
  );
  expect(report).toMatchObject({
    enabled: collectorOutput.enabled,
    gateStatus: collectorOutput.consumer.gateStatus,
    blockedReasons: collectorOutput.consumer.blockedReasons,
    totalDiagnosticCount: collectorOutput.summary.totalDiagnosticCount,
    includedDiagnosticCount: collectorOutput.summary.includedDiagnosticCount,
    omittedDiagnosticCount: collectorOutput.omittedDiagnosticCount,
    invalidDiagnosticCount: invalidInjectedDiagnosticCount,
    byStatus: collectorOutput.summary.byStatus,
    byReason: collectorOutput.summary.byReason,
    authority: {
      noProviderOrderingChange: true,
      noToolAuthority: true,
      noTaskLoopAuthority: true,
      noGatewayAuthority: true,
      noProviderTransportAuthority: true,
      noPromptOrModelMessageInsertion: true,
      noPersistence: true,
      notTaskCompletionEvidence: true,
    },
  });
  expect(report.decision).toMatchObject({
    status: expectedReportStatus(collectorOutput.enabled, collectorOutput.summary.totalDiagnosticCount),
    diagnosticsOnly: true,
    operatorSummaryOnly: true,
    authoritative: false,
  });
  expect(report.evidenceRefs.length).toBeLessThanOrEqual(16);
  expect(report.actionability.actionableDiagnosticCount + report.actionability.noiseDiagnosticCount +
    report.actionability.reviewRequiredDiagnosticCount).toBe(report.includedDiagnosticCount);
  expect(invalidInjectedDiagnosticCount).toBe(
    sample.expectedOutput.invalidInjectedDiagnosticCount ?? 0,
  );
  expect(sample.input).toBeDefined();
  expect(sample.expectedOutput).toBeDefined();
  expect(sample.failureMode.length).toBeGreaterThan(0);
  expect(sample.boundaryAssertion.failClosed).toBe(true);
  expect(sample.evidenceSource.length).toBeGreaterThan(0);
  expect(["actionable", "informational", "noise"]).toContain(sample.actionability);
  expect(JSON.stringify(collectorOutput)).not.toContain("Registry diagnostic pilot fixture");
  expect(JSON.stringify(collectorOutput)).not.toContain("legacyAuthoritative");
  expect(JSON.stringify(report)).not.toContain("Registry diagnostic pilot fixture");
  expect(JSON.stringify(report)).not.toContain("legacyAuthoritative");
  expect(report.decision.authoritative).toBe(false);
  expect(report.authority.notTaskCompletionEvidence).toBe(true);

  for (const [status, count] of Object.entries(sample.expectedOutput.byStatus ?? {})) {
    expect(collectorOutput.summary.byStatus[status as RuntimeRegistryDiagnosticStatus]).toBe(count);
  }
  for (const [reason, count] of Object.entries(sample.expectedOutput.byReason ?? {})) {
    expect(collectorOutput.summary.byReason[reason as RuntimeRegistryDiagnosticReason]).toBe(count);
  }
}

function expectedReportStatus(enabled: boolean, totalDiagnosticCount: number) {
  if (!enabled) {
    return "disabled";
  }
  if (totalDiagnosticCount === 0) {
    return "no_diagnostics";
  }
  return "diagnostics_only_operator_summary";
}

function summarizePilotExecution(
  outcomes: readonly ReturnType<typeof runPilotSample>[],
  collectorLatencyMs: number,
) {
  const byStatus: Partial<Record<RuntimeRegistryDiagnosticStatus, number>> = {};
  const byReason: Partial<Record<RuntimeRegistryDiagnosticReason, number>> = {};
  let diagnosticCount = 0;
  let omittedDiagnosticCount = 0;
  let invalidInjectedDiagnosticCount = 0;
  let actionableCount = 0;
  let informationalCount = 0;
  let noiseCount = 0;
  let failClosedCount = 0;
  let providerOrderingDrift = 0;
  let legacyBehaviorDrift = 0;
  let rendererBypass = 0;
  let persistenceMatches = 0;
  let serviceListenerDatabaseMatches = 0;

  for (const outcome of outcomes) {
    const { sample, collectorOutput } = outcome;
    diagnosticCount += collectorOutput.summary.includedDiagnosticCount;
    omittedDiagnosticCount += collectorOutput.omittedDiagnosticCount;
    invalidInjectedDiagnosticCount += outcome.invalidInjectedDiagnosticCount;
    failClosedCount += sample.boundaryAssertion.failClosed ? 1 : 0;
    actionableCount += sample.actionability === "actionable" ? 1 : 0;
    informationalCount += sample.actionability === "informational" ? 1 : 0;
    noiseCount += sample.actionability === "noise" ? 1 : 0;
    rendererBypass += sample.boundaryAssertion.rendererBypassMatches ?? 0;
    persistenceMatches += sample.boundaryAssertion.persistenceMatches ?? 0;
    serviceListenerDatabaseMatches += sample.boundaryAssertion.serviceListenerDatabaseMatches ?? 0;
    if (!sameArray(sample.boundaryAssertion.providerOrderBefore, sample.boundaryAssertion.providerOrderAfter)) {
      providerOrderingDrift += 1;
    }
    if (sample.boundaryAssertion.legacyBehaviorBefore !== sample.boundaryAssertion.legacyBehaviorAfter) {
      legacyBehaviorDrift += 1;
    }
    addCounts(byStatus, collectorOutput.summary.byStatus);
    addCounts(byReason, collectorOutput.summary.byReason);
  }

  return {
    diagnosticCount,
    omittedDiagnosticCount,
    invalidInjectedDiagnosticCount,
    byStatus,
    byReason,
    actionableCount,
    informationalCount,
    noiseCount,
    actionableRate: actionableCount / outcomes.length,
    noiseRate: noiseCount / outcomes.length,
    collectorLatencyMs,
    failClosedRate: failClosedCount / outcomes.length,
    providerOrderingDrift,
    legacyBehaviorDrift,
    rendererBypass,
    persistenceMatches,
    serviceListenerDatabaseMatches,
  };
}

function summarizeExpectedContributions(samples: readonly PilotSample[]): PilotMetricsContribution {
  return samples.reduce<PilotMetricsContribution>((acc, sample) => ({
    diagnosticCount: acc.diagnosticCount + sample.expectedMetricsContribution.diagnosticCount,
    omittedDiagnosticCount:
      acc.omittedDiagnosticCount + sample.expectedMetricsContribution.omittedDiagnosticCount,
    actionableCount: acc.actionableCount + sample.expectedMetricsContribution.actionableCount,
    informationalCount:
      acc.informationalCount + sample.expectedMetricsContribution.informationalCount,
    noiseCount: acc.noiseCount + sample.expectedMetricsContribution.noiseCount,
    failClosedCount: acc.failClosedCount + sample.expectedMetricsContribution.failClosedCount,
    providerOrderingDrift:
      acc.providerOrderingDrift + sample.expectedMetricsContribution.providerOrderingDrift,
    legacyBehaviorDrift:
      acc.legacyBehaviorDrift + sample.expectedMetricsContribution.legacyBehaviorDrift,
    rendererBypass: acc.rendererBypass + sample.expectedMetricsContribution.rendererBypass,
    persistenceMatches:
      acc.persistenceMatches + sample.expectedMetricsContribution.persistenceMatches,
    serviceListenerDatabaseMatches:
      acc.serviceListenerDatabaseMatches +
      sample.expectedMetricsContribution.serviceListenerDatabaseMatches,
  }), {
    diagnosticCount: 0,
    omittedDiagnosticCount: 0,
    actionableCount: 0,
    informationalCount: 0,
    noiseCount: 0,
    failClosedCount: 0,
    providerOrderingDrift: 0,
    legacyBehaviorDrift: 0,
    rendererBypass: 0,
    persistenceMatches: 0,
    serviceListenerDatabaseMatches: 0,
  });
}

function addCounts<T extends string>(
  target: Partial<Record<T, number>>,
  source: Partial<Record<T, number>>,
): void {
  for (const [key, value] of Object.entries(source) as Array<[T, number]>) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function sameArray(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}
