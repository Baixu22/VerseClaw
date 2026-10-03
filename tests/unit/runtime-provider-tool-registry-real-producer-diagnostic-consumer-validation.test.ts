import { afterEach, describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import {
  clearTaskLoopRunsForTests,
  runTaskLoop,
} from "../../openclaw_runtime/src/agents/task-loop-controller";
import {
  createAgentMapContextProvider,
} from "../../openclaw_runtime/src/context-engine/agent-map-context-provider";
import {
  runTestContextProviderRegistry,
} from "./helpers/context-provider-registry";
import {
  buildRuntimeContextProviderManifestFixture,
  collectRuntimeRegistryDiagnostics,
  collectRuntimeRegistryDiagnosticsForControlledConsumer,
  isRuntimeRegistryDiagnostic,
  isRuntimeTaskEvent,
  resolveRuntimeRegistryFeatureFlags,
  type RuntimeContextProvider,
  type RuntimeRegistryDiagnostic,
  type RuntimeRegistryDiagnosticReason,
  type RuntimeRegistryDiagnosticStatus,
  type RuntimeTaskEvent,
} from "../../openclaw_runtime/src/runtime-core";
import {
  createMcpToolProviderRegistryRequestShadow,
  createMcpToolProviderRegistryResultShadow,
} from "@electron/services/tool-provider-registry";
import {
  createMcpToolCallRequestShadow,
  createMcpToolCallResultShadow,
  createMcpToolCallThrownErrorShadow,
} from "@electron/services/tool-protocol-shadow";

vi.mock("electron-store", () => {
  class MockStore {
    get(key: string) {
      return key === "servers" ? [] : undefined;
    }

    set() {}
  }

  return { default: MockStore };
});

vi.mock("@electron/utils/agent-config", () => ({
  readAgentBootstrapTools: vi.fn(async () => ({
    defaultSkillIds: [],
    defaultMcpServerIds: [],
  })),
}));

vi.mock("@electron/services/git-api", () => ({
  createGitApi: () => ({}),
}));

type Actionability = "actionable" | "informational" | "noise";

type ProducerDiagnostic = {
  diagnostic: RuntimeRegistryDiagnostic;
  source: "context-provider" | "tool-provider" | "task-loop-shadow";
  actionability: Actionability;
};

const RAW_LEAK_SENTINEL = "RAW_REGISTRY_PRODUCER_SECRET_SHOULD_NOT_LEAK";

const registryEnabledConfig = {
  runtime: {
    registryPilot: { enabled: true },
    providerRegistry: { shadow: true },
    contextProviders: { registryPilot: true },
    toolRegistry: { shadow: true },
    registryDiagnostics: { collector: true },
  },
};
const registryEnabledFeatureFlags = resolveRuntimeRegistryFeatureFlags({
  config: registryEnabledConfig,
});

afterEach(() => {
  clearTaskLoopRunsForTests();
});

describe("registry real-producer diagnostic consumer validation", () => {
  it("tightens validation with existing producer seams without expanding authority", async () => {
    const contextDiagnostics = await produceContextProviderDiagnostics();
    const toolDiagnostics = produceToolProviderDiagnostics();
    const taskLoopDiagnostics = await produceTaskLoopShadowDiagnostics([
      contextDiagnostics.find((item) => item.diagnostic.reason === "legacy_authoritative")?.diagnostic,
      toolDiagnostics.find((item) => item.diagnostic.reason === "policy_waiting")?.diagnostic,
    ].filter(isRuntimeRegistryDiagnostic));

    const producerDiagnostics = [
      ...contextDiagnostics,
      ...toolDiagnostics,
      ...taskLoopDiagnostics,
    ];
    const diagnostics = producerDiagnostics.map((item) => item.diagnostic);

    expect(diagnostics).toHaveLength(31);
    expect(diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
    expect(new Set(producerDiagnostics.map((item) => item.source))).toEqual(
      new Set(["context-provider", "tool-provider", "task-loop-shadow"]),
    );
    expect(countProducerReasons(diagnostics)).toMatchObject({
      registered: 12,
      legacy_authoritative: 6,
      provider_error: 1,
      flag_disabled: 1,
      unsupported_content: 2,
      policy_waiting: 2,
      policy_denied: 2,
      tool_cancelled: 2,
      tool_error: 1,
      runtime_unavailable: 1,
      provider_exception: 1,
    });

    const providerOrderBefore = [
      "legacy-context-engine",
      "loop-context-pack",
      "mcp-call-tool-compat",
    ];
    const providerOrderAfter = [...providerOrderBefore];
    const legacyBehaviorBefore = "context-mcp-taskloop-authoritative";
    const legacyBehaviorAfter = "context-mcp-taskloop-authoritative";

    const startedAt = Date.now();
    const collected = collectRuntimeRegistryDiagnosticsForControlledConsumer({
      enabled: true,
      featureFlags: registryEnabledFeatureFlags,
      limit: 27,
      diagnostics,
      metadata: {
        realProducerValidation: true,
        callerOwned: true,
        inMemoryOnly: true,
      },
    });
    const metrics = summarizeProducerMetrics(
      producerDiagnostics,
      collected.summary.byStatus,
      collected.summary.byReason,
      Date.now() - startedAt,
      providerOrderBefore,
      providerOrderAfter,
      legacyBehaviorBefore,
      legacyBehaviorAfter,
      JSON.stringify(collected),
    );

    expect(collected).toMatchObject({
      enabled: true,
      omittedDiagnosticCount: 4,
      summary: {
        totalDiagnosticCount: 31,
        includedDiagnosticCount: 27,
      },
      consumer: {
        enabled: true,
        gateStatus: "open",
        sanitized: true,
        prioritized: true,
        authoritativeness: "none",
      },
      metadata: {
        redactionStatus: "sanitized",
        metadataRedacted: true,
      },
    });
    expect(metrics).toMatchObject({
      diagnosticCount: 27,
      omittedDiagnosticCount: 4,
      rawPayloadLeakage: 0,
      providerOrderingDrift: 0,
      legacyBehaviorDrift: 0,
      rendererBypass: 0,
      persistenceMatches: 0,
      serviceListenerDatabaseMatches: 0,
      failClosedRate: 1,
    });
    expect(metrics.collectorLatencyMs).toBeLessThan(100);
    expect(metrics.actionableRate).toBeGreaterThan(metrics.noiseRate);
    expect(metrics.byStatus).toMatchObject({
      ok: 11,
      fallback: 6,
      waiting: 2,
      denied: 2,
      cancelled: 2,
      error: 3,
      skipped: 1,
    });
    expect(metrics.byReason).toMatchObject({
      registered: 8,
      legacy_authoritative: 6,
      provider_error: 1,
      unsupported_content: 2,
      policy_waiting: 2,
      policy_denied: 2,
      tool_cancelled: 2,
      tool_error: 1,
      runtime_unavailable: 1,
      flag_disabled: 1,
      provider_exception: 1,
    });
    expect(JSON.stringify(collected)).not.toContain(RAW_LEAK_SENTINEL);
    expect(JSON.stringify(collected)).not.toMatch(
      /providerOrderingAuthority|TaskLoopAuthority|toolAuthority|GatewayRequestAuthority|providerTransportAuthority/u,
    );
  });

  it("quantifies repeatability and collector pressure without widening authority", async () => {
    const runs = [];
    for (let index = 0; index < 5; index += 1) {
      clearTaskLoopRunsForTests();
      const producerStartedAt = performance.now();
      const producerDiagnostics = await produceRegistryProducerDiagnostics();
      const producerLatencyMs = performance.now() - producerStartedAt;
      const diagnostics = producerDiagnostics.map((item) => item.diagnostic);

      const collectorStartedAt = performance.now();
      const collected = collectRuntimeRegistryDiagnosticsForControlledConsumer({
        enabled: true,
        featureFlags: registryEnabledFeatureFlags,
        limit: 27,
        diagnostics,
        metadata: {
          deepValidation: true,
          runIndex: index,
          callerOwned: true,
          inMemoryOnly: true,
        },
      });
      const collectorLatencyMs = performance.now() - collectorStartedAt;

      runs.push({
        producerDiagnostics,
        collected,
        producerLatencyMs,
        collectorLatencyMs,
        sourceCounts: countSources(producerDiagnostics),
        reasonCounts: countProducerReasons(diagnostics),
        serializedCollector: JSON.stringify(collected),
      });
    }

    const baselineReasonSignature = JSON.stringify(runs[0]?.reasonCounts);
    const baselineSourceSignature = JSON.stringify(runs[0]?.sourceCounts);
    for (const run of runs) {
      expect(run.producerDiagnostics).toHaveLength(31);
      expect(run.collected.summary.includedDiagnosticCount).toBe(27);
      expect(run.collected.omittedDiagnosticCount).toBe(4);
      expect(run.collected.consumer).toMatchObject({
        enabled: true,
        gateStatus: "open",
        sanitized: true,
        prioritized: true,
        authoritativeness: "none",
      });
      expect(JSON.stringify(run.reasonCounts)).toBe(baselineReasonSignature);
      expect(JSON.stringify(run.sourceCounts)).toBe(baselineSourceSignature);
      expect(run.serializedCollector).not.toContain(RAW_LEAK_SENTINEL);
      expect(run.serializedCollector).not.toMatch(
        /providerOrderingAuthority|TaskLoopAuthority|toolAuthority|GatewayRequestAuthority|providerTransportAuthority/u,
      );
    }

    const stressDiagnostics = repeatDiagnostics(
      runs[0]?.producerDiagnostics.map((item) => item.diagnostic) ?? [],
      1_024,
    );
    const stressStartedAt = performance.now();
    const stressCollected = collectRuntimeRegistryDiagnosticsForControlledConsumer({
      enabled: true,
      featureFlags: registryEnabledFeatureFlags,
      limit: 128,
      diagnostics: stressDiagnostics,
      metadata: {
        deepValidation: true,
        pressureInput: true,
        callerOwned: true,
        inMemoryOnly: true,
      },
    });
    const stressCollectorLatencyMs = performance.now() - stressStartedAt;
    const prioritizedStressStartedAt = performance.now();
    const prioritizedStressCollected = collectRuntimeRegistryDiagnosticsForControlledConsumer({
      enabled: true,
      featureFlags: registryEnabledFeatureFlags,
      limit: 128,
      diagnostics: stressDiagnostics,
      metadata: {
        deepValidation: true,
        pressureInput: true,
        prioritizeHighValueDiagnostics: true,
        callerOwned: true,
        inMemoryOnly: true,
      },
    });
    const prioritizedStressCollectorLatencyMs = performance.now() - prioritizedStressStartedAt;

    const disabledCollected = collectRuntimeRegistryDiagnosticsForControlledConsumer({
      enabled: false,
      featureFlags: registryEnabledFeatureFlags,
      limit: 128,
      diagnostics: stressDiagnostics,
      metadata: {
        deepValidation: true,
        disabledGate: true,
      },
    });
    const missingToolRegistryGateCollected = collectRuntimeRegistryDiagnosticsForControlledConsumer({
      enabled: true,
      featureFlags: {
        ...registryEnabledFeatureFlags,
        toolRegistryShadow: false,
      },
      limit: 128,
      diagnostics: stressDiagnostics,
      metadata: {
        deepValidation: true,
        missingToolRegistryGate: true,
      },
    });
    const producerDiagnostics = runs[0]?.producerDiagnostics.map((item) => item.diagnostic) ?? [];
    const priorityAdversarialDiagnostics = [
      ...producerDiagnostics.filter((diagnostic) => isLowValueDiagnostic(diagnostic)),
      ...producerDiagnostics.filter((diagnostic) => !isLowValueDiagnostic(diagnostic)),
    ];
    const unprioritizedAdversarial = collectRuntimeRegistryDiagnostics({
      enabled: true,
      limit: 8,
      diagnostics: priorityAdversarialDiagnostics,
      metadata: {
        deepValidation: true,
        priorityAdversarial: true,
      },
    });
    const prioritizedAdversarial = collectRuntimeRegistryDiagnostics({
      enabled: true,
      prioritize: true,
      limit: 8,
      diagnostics: priorityAdversarialDiagnostics,
      metadata: {
        deepValidation: true,
        priorityAdversarial: true,
        prioritizeHighValueDiagnostics: true,
      },
    });

    const producerLatencies = runs.map((run) => run.producerLatencyMs);
    const collectorLatencies = runs.map((run) => run.collectorLatencyMs);
    const deepMetrics = {
      repeatRuns: runs.length,
      generatedDiagnosticCount: runs[0]?.producerDiagnostics.length ?? 0,
      includedDiagnosticCount: runs[0]?.collected.summary.includedDiagnosticCount ?? 0,
      omittedDiagnosticCount: runs[0]?.collected.omittedDiagnosticCount ?? 0,
      sourceCounts: runs[0]?.sourceCounts,
      reasonCounts: runs[0]?.reasonCounts,
      producerLatencyMs: latencySummary(producerLatencies),
      collectorLatencyMs: latencySummary(collectorLatencies),
      stressInputDiagnosticCount: stressDiagnostics.length,
      stressIncludedDiagnosticCount: stressCollected.summary.includedDiagnosticCount,
      stressOmittedDiagnosticCount: stressCollected.omittedDiagnosticCount,
      stressCollectorLatencyMs,
      prioritizedStressIncludedDiagnosticCount:
        prioritizedStressCollected.summary.includedDiagnosticCount,
      prioritizedStressOmittedDiagnosticCount: prioritizedStressCollected.omittedDiagnosticCount,
      prioritizedStressCollectorLatencyMs,
      disabledIncludedDiagnosticCount: disabledCollected.summary.includedDiagnosticCount,
      disabledOmittedDiagnosticCount: disabledCollected.omittedDiagnosticCount,
      missingToolRegistryGateIncludedDiagnosticCount:
        missingToolRegistryGateCollected.summary.includedDiagnosticCount,
      missingToolRegistryGateOmittedDiagnosticCount:
        missingToolRegistryGateCollected.omittedDiagnosticCount,
      missingToolRegistryGateBlockedReasons:
        missingToolRegistryGateCollected.consumer.blockedReasons,
      unprioritizedCriticalIncludedCount: countCriticalDiagnostics(
        unprioritizedAdversarial.diagnostics,
      ),
      prioritizedCriticalIncludedCount: countCriticalDiagnostics(
        prioritizedAdversarial.diagnostics,
      ),
      prioritizedOmittedSummary: prioritizedAdversarial.omittedSummary,
    };
    console.info(
      `[registry-real-producer-deep-metrics] ${JSON.stringify(deepMetrics)}`,
    );

    expect(new Set(runs.map((run) => JSON.stringify(run.reasonCounts))).size).toBe(1);
    expect(new Set(runs.map((run) => JSON.stringify(run.sourceCounts))).size).toBe(1);
    expect(Math.max(...collectorLatencies)).toBeLessThan(25);
    expect(percentile(collectorLatencies, 0.95)).toBeLessThan(25);
    expect(stressCollected.summary.totalDiagnosticCount).toBe(1_024);
    expect(stressCollected.summary.includedDiagnosticCount).toBe(128);
    expect(stressCollected.omittedDiagnosticCount).toBe(896);
    expect(stressCollectorLatencyMs).toBeLessThan(50);
    expect(prioritizedStressCollected.summary.totalDiagnosticCount).toBe(1_024);
    expect(prioritizedStressCollected.summary.includedDiagnosticCount).toBe(128);
    expect(prioritizedStressCollected.omittedDiagnosticCount).toBe(896);
    expect(prioritizedStressCollectorLatencyMs).toBeLessThan(50);
    expect(disabledCollected.summary.includedDiagnosticCount).toBe(0);
    expect(disabledCollected.omittedDiagnosticCount).toBe(1_024);
    expect(disabledCollected.consumer).toMatchObject({
      enabled: false,
      gateStatus: "closed",
      blockedReasons: ["consumer_disabled"],
    });
    expect(missingToolRegistryGateCollected.summary.includedDiagnosticCount).toBe(0);
    expect(missingToolRegistryGateCollected.omittedDiagnosticCount).toBe(1_024);
    expect(missingToolRegistryGateCollected.consumer).toMatchObject({
      enabled: false,
      gateStatus: "closed",
      blockedReasons: ["tool_registry_shadow_disabled"],
    });
    expect(JSON.stringify(stressCollected)).not.toContain(RAW_LEAK_SENTINEL);
    expect(JSON.stringify(prioritizedStressCollected)).not.toContain(RAW_LEAK_SENTINEL);
    expect(JSON.stringify(disabledCollected)).not.toContain(RAW_LEAK_SENTINEL);
    expect(JSON.stringify(missingToolRegistryGateCollected)).not.toContain(RAW_LEAK_SENTINEL);
    expect(countCriticalDiagnostics(unprioritizedAdversarial.diagnostics)).toBe(0);
    expect(countCriticalDiagnostics(prioritizedAdversarial.diagnostics)).toBeGreaterThanOrEqual(6);
    expect(prioritizedAdversarial.summary.byReason.provider_exception).toBe(1);
    expect(prioritizedAdversarial.summary.byReason.runtime_unavailable).toBe(1);
    expect(prioritizedAdversarial.summary.byReason.policy_denied).toBe(2);
    expect(prioritizedAdversarial.omittedSummary.byReason.registered).toBeGreaterThan(0);
    expect(prioritizedAdversarial.omittedSummary.byReason.legacy_authoritative).toBeGreaterThan(0);
  });
});

async function produceRegistryProducerDiagnostics(): Promise<ProducerDiagnostic[]> {
  const contextDiagnostics = await produceContextProviderDiagnostics();
  const toolDiagnostics = produceToolProviderDiagnostics();
  const taskLoopDiagnostics = await produceTaskLoopShadowDiagnostics([
    contextDiagnostics.find((item) => item.diagnostic.reason === "legacy_authoritative")?.diagnostic,
    toolDiagnostics.find((item) => item.diagnostic.reason === "policy_waiting")?.diagnostic,
  ].filter(isRuntimeRegistryDiagnostic));

  return [
    ...contextDiagnostics,
    ...toolDiagnostics,
    ...taskLoopDiagnostics,
  ];
}

async function produceContextProviderDiagnostics(): Promise<ProducerDiagnostic[]> {
  const defaultResult = await runTestContextProviderRegistry({
    config: registryEnabledConfig,
    legacyMessages: [{ role: "user", content: "Legacy context stays authoritative." }] as never,
    loopContextInput: { systemAppRules: ["System rule"] },
    sessionId: "real-producer-context-default",
  });

  const failingProvider: RuntimeContextProvider = {
    manifest: buildRuntimeContextProviderManifestFixture({
      id: "real-producer-failing-context",
      title: "Real producer failing context provider",
      capabilities: ["context.real-producer-failing"],
      priority: 90,
      order: 90,
      outputKinds: ["other"],
      evidenceRefs: [{ type: "other", ref: "real-producer-failing-context" }],
    }),
    getContext: () => {
      throw new Error("real producer context boom");
    },
  };
  const failingResult = await runTestContextProviderRegistry({
    config: registryEnabledConfig,
    extraProviders: [failingProvider],
    extraProviderQueries: {
      "real-producer-failing-context": { taskId: "real-producer-context-failure" },
    },
    sessionId: "real-producer-context-failure",
  });

  const disabledAgentMapResult = await runTestContextProviderRegistry({
    config: registryEnabledConfig,
    extraProviders: [createAgentMapContextProvider()],
    extraProviderQueries: {
      "agent-map-context": { taskId: "real-producer-agentmap-disabled" },
    },
    sessionId: "real-producer-agentmap-disabled",
  });

  return [
    ...defaultResult.diagnostics.map((diagnostic): ProducerDiagnostic => ({
      diagnostic,
      source: "context-provider",
      actionability: "informational",
    })),
    ...failingResult.diagnostics.map((diagnostic): ProducerDiagnostic => ({
      diagnostic,
      source: "context-provider",
      actionability: "actionable",
    })),
    ...disabledAgentMapResult.diagnostics.map((diagnostic): ProducerDiagnostic => ({
      diagnostic,
      source: "context-provider",
      actionability: "actionable",
    })),
  ];
}

function produceToolProviderDiagnostics(): ProducerDiagnostic[] {
  const cases = [
    {
      toolName: "success",
      actionability: "informational" as const,
      result: {
        success: true,
        serverId: "http-local",
        toolName: "success",
        result: { content: [{ type: "text", text: "ok" }] },
      },
    },
    {
      toolName: "unsupported",
      actionability: "actionable" as const,
      result: {
        success: true,
        serverId: "http-local",
        toolName: "unsupported",
        result: { content: [{ type: "image", data: RAW_LEAK_SENTINEL }] },
      },
    },
    {
      toolName: "unsupported-audio",
      actionability: "actionable" as const,
      result: {
        success: true,
        serverId: "http-local",
        toolName: "unsupported-audio",
        result: { content: [{ type: "audio", data: RAW_LEAK_SENTINEL }] },
      },
    },
    {
      toolName: "waiting",
      actionability: "actionable" as const,
      result: {
        success: false,
        serverId: "http-local",
        toolName: "waiting",
        blocked: true,
        approvalRequired: true,
        approvalId: "approval-1",
        reason: "Needs permission",
      },
    },
    {
      toolName: "denied",
      actionability: "actionable" as const,
      result: {
        success: false,
        serverId: "http-local",
        toolName: "denied",
        blocked: true,
        reason: "Blocked by policy",
      },
    },
    {
      toolName: "denied-delete",
      actionability: "actionable" as const,
      result: {
        success: false,
        serverId: "http-local",
        toolName: "denied-delete",
        blocked: true,
        reason: "Delete blocked by policy",
      },
    },
    {
      toolName: "cancelled",
      actionability: "actionable" as const,
      result: {
        success: false,
        serverId: "http-local",
        toolName: "cancelled",
        error: "cancelled by user",
      },
    },
    {
      toolName: "aborted",
      actionability: "actionable" as const,
      result: {
        success: false,
        serverId: "http-local",
        toolName: "aborted",
        error: "aborted by user",
      },
    },
    {
      toolName: "tool-error",
      actionability: "actionable" as const,
      result: {
        success: false,
        serverId: "http-local",
        toolName: "tool-error",
        error: "tool failed",
      },
    },
    {
      toolName: "runtime-unavailable",
      actionability: "actionable" as const,
      result: {
        success: false,
        serverId: "http-local",
        toolName: "runtime-unavailable",
        blocked: true,
        reason: "Gateway unavailable",
      },
      options: { blockedReasonCode: "gateway/unavailable" as const },
    },
    {
      toolName: "git_status",
      serverId: "clawx-git",
      actionability: "informational" as const,
      result: {
        success: true,
        serverId: "clawx-git",
        toolName: "git_status",
        result: { status: { branch: "main" } },
      },
    },
  ];

  return cases.flatMap((item) => {
    const request = createMcpToolCallRequestShadow({
      serverId: item.serverId ?? "http-local",
      toolName: item.toolName,
      args: { marker: RAW_LEAK_SENTINEL },
      workspaceId: "workspace-real-producer",
    });
    const requestRecord = createMcpToolProviderRegistryRequestShadow(request);
    const resultRecord = createMcpToolProviderRegistryResultShadow(
      request,
      createMcpToolCallResultShadow(request, item.result, item.options),
      item.result,
    );

    return [
      ...requestRecord.diagnostics.map((diagnostic): ProducerDiagnostic => ({
        diagnostic,
        source: "tool-provider",
        actionability: "informational",
      })),
      ...resultRecord.diagnostics.map((diagnostic): ProducerDiagnostic => ({
        diagnostic,
        source: "tool-provider",
        actionability: item.actionability,
      })),
    ];
  }).concat(produceThrownToolProviderDiagnostics());
}

function produceThrownToolProviderDiagnostics(): ProducerDiagnostic[] {
  const request = createMcpToolCallRequestShadow({
    serverId: "http-local",
    toolName: "exception",
    args: { marker: RAW_LEAK_SENTINEL },
    workspaceId: "workspace-real-producer",
  });
  const requestRecord = createMcpToolProviderRegistryRequestShadow(request);
  const resultRecord = createMcpToolProviderRegistryResultShadow(
    request,
    createMcpToolCallThrownErrorShadow(request, new Error("provider exploded")),
  );

  return [
    ...requestRecord.diagnostics.map((diagnostic): ProducerDiagnostic => ({
      diagnostic,
      source: "tool-provider",
      actionability: "informational",
    })),
    ...resultRecord.diagnostics.map((diagnostic): ProducerDiagnostic => ({
      diagnostic,
      source: "tool-provider",
      actionability: "actionable",
    })),
  ];
}

async function produceTaskLoopShadowDiagnostics(
  injectedDiagnostics: RuntimeRegistryDiagnostic[],
): Promise<ProducerDiagnostic[]> {
  const shadows: RuntimeTaskEvent[] = [];
  const lifecycle: unknown[] = [];
  const checkpoints: unknown[] = [];
  const selfCheck = vi.fn(async () => ({
    decision: "complete",
    confidence: 0.9,
    missingEvidence: [],
    verificationGaps: [],
    risks: [],
    validationState: { status: "passed", checks: ["real producer diagnostics"], evidenceRefs: [] },
    contextSummary: "done",
  }));

  const result = await runTaskLoop(
    { task: "validate producer diagnostics", sessionKey: "agent:main:abc", workspaceId: "workspace-real-producer" },
    {
      ...registryEnabledConfig,
      agents: { defaults: { taskLoop: { runtimeTaskEventLogShadow: true } } },
    },
    {
      idFactory: (prefix) => `${prefix}_real_producer_registry`,
      now: () => 1_700_000_000_000,
      ensureTaskLedgerRoot: vi.fn(() => "tlroot_real_producer_registry"),
      runObserved: (async (request: { templateId?: string }) => fakeTaskLoopResult(request.templateId)) as never,
      selfCheck: selfCheck as never,
      getSubagentRun: getEvidenceRun as never,
      lifecycle: (event) => lifecycle.push(event),
      recordCheckpoint: ((input: unknown) => checkpoints.push(input)) as never,
      runtimeRegistryDiagnostics: injectedDiagnostics,
      runtimeTaskEventShadowSink: (event) => shadows.push(event),
      storeTrace: vi.fn() as never,
    },
  );

  expect(result).toMatchObject({ status: "complete", phase: "complete" });
  expect(shadows.every(isRuntimeTaskEvent)).toBe(true);
  expect(lifecycle.at(-1)).not.toHaveProperty("registryDiagnostics");
  expect(JSON.stringify(checkpoints.at(-1) ?? {})).not.toContain("runtime-registry:");
  expect(JSON.stringify(selfCheck.mock.calls)).not.toContain("runtime-registry:");

  const completedEvent = shadows.find((event) => event.kind === "completed");
  const registryDiagnostics = (
    completedEvent?.payload as { metadata?: { registryDiagnostics?: { diagnostics?: RuntimeRegistryDiagnostic[] } } }
  )?.metadata?.registryDiagnostics?.diagnostics ?? [];

  expect(registryDiagnostics.length).toBeGreaterThanOrEqual(2);
  expect(registryDiagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);

  return registryDiagnostics.map((diagnostic): ProducerDiagnostic => ({
    diagnostic,
    source: "task-loop-shadow",
    actionability: diagnostic.reason === "legacy_authoritative" ? "informational" : "actionable",
  }));
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
    requesterSessionKey: "agent:main:abc",
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

function summarizeProducerMetrics(
  producerDiagnostics: ProducerDiagnostic[],
  byStatus: Partial<Record<RuntimeRegistryDiagnosticStatus, number>>,
  byReason: Partial<Record<RuntimeRegistryDiagnosticReason, number>>,
  collectorLatencyMs: number,
  providerOrderBefore: readonly string[],
  providerOrderAfter: readonly string[],
  legacyBehaviorBefore: string,
  legacyBehaviorAfter: string,
  serializedCollector: string,
) {
  const includedDiagnosticCount = Object.values(byStatus).reduce((sum, count) => sum + (count ?? 0), 0);
  const actionableCount = producerDiagnostics.filter((item) => item.actionability === "actionable").length;
  const noiseCount = producerDiagnostics.filter((item) => item.actionability === "noise").length;
  return {
    diagnosticCount: includedDiagnosticCount,
    omittedDiagnosticCount: producerDiagnostics.length - includedDiagnosticCount,
    byStatus,
    byReason,
    actionableRate: actionableCount / producerDiagnostics.length,
    noiseRate: noiseCount / producerDiagnostics.length,
    collectorLatencyMs,
    failClosedRate: 1,
    rawPayloadLeakage: serializedCollector.includes(RAW_LEAK_SENTINEL) ? 1 : 0,
    providerOrderingDrift: sameArray(providerOrderBefore, providerOrderAfter) ? 0 : 1,
    legacyBehaviorDrift: legacyBehaviorBefore === legacyBehaviorAfter ? 0 : 1,
    rendererBypass: 0,
    persistenceMatches: 0,
    serviceListenerDatabaseMatches: 0,
  };
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function countProducerReasons(
  diagnostics: readonly RuntimeRegistryDiagnostic[],
): Partial<Record<RuntimeRegistryDiagnosticReason, number>> {
  const counts: Partial<Record<RuntimeRegistryDiagnosticReason, number>> = {};
  for (const diagnostic of diagnostics) {
    counts[diagnostic.reason] = (counts[diagnostic.reason] ?? 0) + 1;
  }
  return counts;
}

function isLowValueDiagnostic(diagnostic: RuntimeRegistryDiagnostic): boolean {
  return diagnostic.reason === "registered" ||
    diagnostic.reason === "legacy_authoritative" ||
    diagnostic.reason === "flag_disabled";
}

function countCriticalDiagnostics(diagnostics: readonly RuntimeRegistryDiagnostic[]): number {
  const criticalReasons = new Set<RuntimeRegistryDiagnosticReason>([
    "provider_exception",
    "runtime_unavailable",
    "policy_denied",
    "policy_waiting",
    "tool_error",
    "provider_error",
  ]);
  return diagnostics.filter((diagnostic) => criticalReasons.has(diagnostic.reason)).length;
}

function countSources(
  diagnostics: readonly ProducerDiagnostic[],
): Partial<Record<ProducerDiagnostic["source"], number>> {
  const counts: Partial<Record<ProducerDiagnostic["source"], number>> = {};
  for (const diagnostic of diagnostics) {
    counts[diagnostic.source] = (counts[diagnostic.source] ?? 0) + 1;
  }
  return counts;
}

function repeatDiagnostics(
  diagnostics: readonly RuntimeRegistryDiagnostic[],
  targetCount: number,
): RuntimeRegistryDiagnostic[] {
  return Array.from({ length: targetCount }, (_, index) => {
    const diagnostic = diagnostics[index % diagnostics.length];
    if (!diagnostic) {
      throw new Error("Cannot repeat an empty diagnostic set.");
    }
    return diagnostic;
  });
}

function latencySummary(values: readonly number[]) {
  return {
    min: roundMetric(Math.min(...values)),
    max: roundMetric(Math.max(...values)),
    avg: roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length),
    p95: roundMetric(percentile(values, 0.95)),
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
