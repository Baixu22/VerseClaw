import { describe, expect, it } from "vitest";
import {
  createContextProviderRegistryPilot,
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
} from "../../openclaw_runtime/src/context-engine/provider-registry";
import {
  buildGroundingRefFixture,
  createGroundingShadowConsumerSummary,
  createSingleExplicitGroundingDiagnosticsConsumerReport,
  GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
  isGroundingSingleExplicitDiagnosticsConsumerReport,
  type GroundingShadowConsumerSummary,
  type RuntimeCoreJsonObject,
} from "../../openclaw_runtime/src/runtime-core";

const RAW_SENTINEL =
  "RAW_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_SHOULD_NOT_SURVIVE";
const FORBIDDEN_SENTINEL =
  "SINGLE_EXPLICIT_FORBIDDEN_BOUNDARY_SHOULD_NOT_SURVIVE";

describe("single explicit grounding diagnostics-only consumer", () => {
  it("requires the exact explicit consumer id and never defaults", () => {
    const sourceSummary = sanitizedSourceSummary();

    const missing = createSingleExplicitGroundingDiagnosticsConsumerReport({
      summary: sourceSummary,
    });
    const wrong = createSingleExplicitGroundingDiagnosticsConsumerReport({
      consumerId: "line-c.grounding.wrongConsumer",
      summary: sourceSummary,
    });
    const explicit = createSingleExplicitGroundingDiagnosticsConsumerReport({
      consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
      summary: sourceSummary,
    });

    expectDisabledReport(missing, "missing_consumer_id");
    expectDisabledReport(wrong, "invalid_consumer_id");
    expect(isGroundingSingleExplicitDiagnosticsConsumerReport(explicit)).toBe(true);
    expect(explicit.consumerId).toBe(
      GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
    );
    expect(explicit.sourceConsumerId).toBe("source-grounding-summary");
  });

  it("runs only through direct explicit invocation and does not register providers", () => {
    const registry = createContextProviderRegistryPilot();
    const before = registry.listManifests().map((manifest) => manifest.id);
    const sourceSummary = sanitizedSourceSummary();

    expect(isGroundingSingleExplicitDiagnosticsConsumerReport(sourceSummary))
      .toBe(false);

    const report = createSingleExplicitGroundingDiagnosticsConsumerReport({
      consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
      summary: sourceSummary,
    });

    expect(isGroundingSingleExplicitDiagnosticsConsumerReport(report)).toBe(true);
    expect(registry.listManifests().map((manifest) => manifest.id)).toEqual(before);
    expect(before).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
  });

  it("converts valid sanitized summaries into bounded diagnostics-only output", () => {
    const report = createSingleExplicitGroundingDiagnosticsConsumerReport({
      consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
      summary: sanitizedSourceSummary(),
      limit: 1,
      tokenBudget: 5,
      metadata: hostileMetadata("report-options"),
    });

    expect(isGroundingSingleExplicitDiagnosticsConsumerReport(report)).toBe(true);
    expect(report).toMatchObject({
      readonly: true,
      localOnly: true,
      explicitOnly: true,
      metadataOnly: true,
      diagnosticOnly: true,
      summaryOnly: true,
      nonAuthoritative: true,
      enabled: true,
      skipped: false,
      reason: "explicit_diagnostics_summary",
      authority: "none",
      rawRetained: false,
      includeRaw: false,
      includeUntrusted: false,
      noRuntimeAuthority: true,
      noPromptAuthority: true,
      noModelMessageAuthority: true,
      noGatewayAuthority: true,
      noTaskLoopAuthority: true,
      noRuntimeDecisionAuthority: true,
      noProviderOrderingAuthority: true,
      noProviderSelectionAuthority: true,
      noPersistenceAuthority: true,
      noMemoryPromotionAuthority: true,
      noFactAcceptanceAuthority: true,
      noEpisodeWriteAuthority: true,
      noPatchMutationAuthority: true,
      noWorkspaceMutationAuthority: true,
      noSymbolMutationAuthority: true,
      inputItemCount: 1,
      acceptedItemCount: 1,
      omittedItemCount: 0,
    });
    expect(report.query).toEqual(expect.objectContaining({
      readonly: true,
      includeRaw: false,
      includeUntrusted: false,
    }));
    expect(report.items).toHaveLength(1);
    expect(report.items[0]).toEqual(expect.objectContaining({
      authority: "none",
      trust: "supplied",
    }));
    expect(report.items[0]?.summary.length).toBeLessThanOrEqual(20);
    expect(report.estimatedTokens).toBeLessThanOrEqual(report.tokenBudget);
    expectSerializedBoundary(report);
  });

  it("restores disabled/default-off parity through enabled false and kill switch", () => {
    const sourceSummary = sanitizedSourceSummary();
    const disabled = createSingleExplicitGroundingDiagnosticsConsumerReport({
      consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
      summary: sourceSummary,
      enabled: false,
      metadata: hostileMetadata("disabled"),
    });
    const killSwitch = createSingleExplicitGroundingDiagnosticsConsumerReport({
      consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
      summary: sourceSummary,
      killSwitch: true,
      metadata: hostileMetadata("kill-switch"),
    });

    expectDisabledReport(disabled, "flag_disabled");
    expectDisabledReport(killSwitch, "kill_switch");
    expect(disabled.items).toEqual(killSwitch.items);
    expect(disabled.acceptedItemCount).toBe(killSwitch.acceptedItemCount);
    expect(disabled.tokenBudget).toBe(killSwitch.tokenBudget);
    expect(disabled.estimatedTokens).toBe(killSwitch.estimatedTokens);
  });

  it("fails closed for invalid, missing, raw, and untrusted summary inputs", () => {
    const sourceSummary = sanitizedSourceSummary();
    const cases = [
      {
        reason: "invalid_summary",
        report: createSingleExplicitGroundingDiagnosticsConsumerReport({
          consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
        }),
      },
      {
        reason: "invalid_summary",
        report: createSingleExplicitGroundingDiagnosticsConsumerReport({
          consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
          summary: { readonly: true } as never,
        }),
      },
      {
        reason: "invalid_summary",
        report: createSingleExplicitGroundingDiagnosticsConsumerReport({
          consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
          summary: {
            ...sourceSummary,
            query: { ...sourceSummary.query, includeRaw: true },
          } as never,
        }),
      },
      {
        reason: "invalid_summary",
        report: createSingleExplicitGroundingDiagnosticsConsumerReport({
          consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
          summary: {
            ...sourceSummary,
            query: { ...sourceSummary.query, includeUntrusted: true },
          } as never,
        }),
      },
    ];

    for (const item of cases) {
      expectDisabledReport(item.report, item.reason);
    }
  });

  it("does not leak prompt, model-message, provider, Gateway, runtime-decision, raw, persistence, memory, or mutation data", () => {
    const report = createSingleExplicitGroundingDiagnosticsConsumerReport({
      consumerId: GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID,
      summary: sanitizedSourceSummary(),
      metadata: hostileMetadata("leakage-check"),
    });
    const serialized = JSON.stringify(report);

    expectSerializedBoundary(report);
    for (const forbiddenValue of [
      RAW_SENTINEL,
      FORBIDDEN_SENTINEL,
      "runtimeAuthority:true",
      "promptAuthority:true",
      "modelMessageAuthority:true",
      "providerOrderingAuthority:true",
      "providerSelectionAuthority:true",
      "gatewayAuthority:true",
      "taskLoopAuthority:true",
      "runtimeDecisionAuthority:true",
      "completionAuthority:true",
      "toolAuthority:true",
      "securityAuthority:true",
      "approvalAuthority:true",
      "retryAuthority:true",
      "persistenceAuthority:true",
      "memoryPromotionAuthority:true",
      "factAcceptanceAuthority:true",
      "episodeWriteAuthority:true",
      "patchMutationAuthority:true",
      "workspaceMutationAuthority:true",
      "symbolMutationAuthority:true",
    ]) {
      expect(serialized).not.toContain(forbiddenValue);
    }
  });
});

function sanitizedSourceSummary(): GroundingShadowConsumerSummary {
  return createGroundingShadowConsumerSummary([
    buildGroundingRefFixture({
      id: "single_explicit_diagnostics_ref",
      canonicalKey: "symbol:single_explicit_diagnostics_ref",
      kind: "symbol",
      ref: "src/SingleExplicit.ts#diagnostics",
      summary: `Single explicit diagnostics-only summary ${"x".repeat(96)}`,
      metadata: {
        safe: "kept",
        ...hostileMetadata("source-ref"),
      } as never,
    }),
  ], {
    consumerId: "source-grounding-summary",
    limit: 1,
    tokenBudget: 32,
    query: {
      readonly: true,
      includeRaw: true,
      includeUntrusted: true,
      metadata: hostileMetadata("source-query"),
    } as never,
    metadata: hostileMetadata("source-options"),
  });
}

function expectDisabledReport(
  report: ReturnType<typeof createSingleExplicitGroundingDiagnosticsConsumerReport>,
  reason: string,
): void {
  expect(isGroundingSingleExplicitDiagnosticsConsumerReport(report)).toBe(true);
  expect(report).toMatchObject({
    enabled: false,
    skipped: true,
    reason,
    authority: "none",
    rawRetained: false,
    includeRaw: false,
    includeUntrusted: false,
    items: [],
    acceptedItemCount: 0,
    tokenBudget: 0,
    estimatedTokens: 0,
  });
  expect(report.query).toEqual(expect.objectContaining({
    readonly: true,
    includeRaw: false,
    includeUntrusted: false,
  }));
  expectSerializedBoundary(report);
}

function expectSerializedBoundary(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(RAW_SENTINEL);
  expect(serialized).not.toContain(FORBIDDEN_SENTINEL);
  expect(serialized).not.toContain("rawPrompt");
  expect(serialized).not.toContain("rawTrace");
  expect(serialized).not.toContain("fullPayload");
  expect(serialized).not.toContain("toolArgs");
  expect(serialized).not.toContain("stdout");
  expect(serialized).not.toContain("stderr");
  expect(serialized).not.toContain("apiKey");
  expect(serialized).not.toContain("authHeader");
  expect(serialized).not.toContain("traceparent");
  expect(serialized).not.toContain("tracestate");
  expect(serialized).not.toContain("baggage");
  expect(serialized).not.toContain("gatewayRequest");
  expect(serialized).not.toContain("runtimeDecision");
  expect(serialized).not.toContain("providerOrdering\"");
  expect(serialized).not.toContain("providerSelection\"");
  expect(serialized).not.toContain("modelMessages");
  expect(serialized).not.toContain("promptPayload");
  expect(serialized).not.toContain("persistenceWrite");
  expect(serialized).not.toContain("memoryWrite");
  expect(serialized).not.toContain("patchApply");
  expect(serialized).not.toContain("workspaceEdit");
  expect(serialized).not.toContain("symbolMutation");
  expect(serialized).not.toContain("includeRaw\":true");
  expect(serialized).not.toContain("includeUntrusted\":true");
}

function hostileMetadata(location: string): RuntimeCoreJsonObject {
  return {
    location,
    rawPrompt: RAW_SENTINEL,
    rawTrace: RAW_SENTINEL,
    fullPayload: RAW_SENTINEL,
    toolArgs: RAW_SENTINEL,
    stdout: RAW_SENTINEL,
    stderr: RAW_SENTINEL,
    env: RAW_SENTINEL,
    secret: RAW_SENTINEL,
    apiKey: RAW_SENTINEL,
    authHeader: RAW_SENTINEL,
    traceparent: RAW_SENTINEL,
    tracestate: RAW_SENTINEL,
    baggage: RAW_SENTINEL,
    promptPayload: FORBIDDEN_SENTINEL,
    modelMessages: [FORBIDDEN_SENTINEL],
    providerOrdering: [FORBIDDEN_SENTINEL],
    providerSelection: FORBIDDEN_SENTINEL,
    gatewayRequest: FORBIDDEN_SENTINEL,
    taskLoopIntegration: FORBIDDEN_SENTINEL,
    runtimeDecision: FORBIDDEN_SENTINEL,
    persistenceWrite: FORBIDDEN_SENTINEL,
    memoryWrite: FORBIDDEN_SENTINEL,
    patchApply: FORBIDDEN_SENTINEL,
    workspaceEdit: FORBIDDEN_SENTINEL,
    symbolMutation: FORBIDDEN_SENTINEL,
    runtimeAuthorityAttempt: "runtimeAuthority:true",
    promptAuthorityAttempt: "promptAuthority:true",
    modelMessageAuthorityAttempt: "modelMessageAuthority:true",
    providerOrderingAuthorityAttempt: "providerOrderingAuthority:true",
    providerSelectionAuthorityAttempt: "providerSelectionAuthority:true",
    gatewayAuthorityAttempt: "gatewayAuthority:true",
    taskLoopAuthorityAttempt: "taskLoopAuthority:true",
    runtimeDecisionAuthorityAttempt: "runtimeDecisionAuthority:true",
    completionAuthorityAttempt: "completionAuthority:true",
    toolAuthorityAttempt: "toolAuthority:true",
    securityAuthorityAttempt: "securityAuthority:true",
    approvalAuthorityAttempt: "approvalAuthority:true",
    retryAuthorityAttempt: "retryAuthority:true",
    persistenceAuthorityAttempt: "persistenceAuthority:true",
    memoryPromotionAuthorityAttempt: "memoryPromotionAuthority:true",
    factAcceptanceAuthorityAttempt: "factAcceptanceAuthority:true",
    episodeWriteAuthorityAttempt: "episodeWriteAuthority:true",
    patchMutationAuthorityAttempt: "patchMutationAuthority:true",
    workspaceMutationAuthorityAttempt: "workspaceMutationAuthority:true",
    symbolMutationAuthorityAttempt: "symbolMutationAuthority:true",
  } as never;
}
