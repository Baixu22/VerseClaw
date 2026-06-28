import { describe, expect, it } from "vitest";
import {
  createContextProviderRegistryPilot,
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
} from "../../openclaw_runtime/src/context-engine/provider-registry";
import {
  buildGroundingRefFixture,
  createGroundingShadowConsumerSummary,
  isGroundingShadowConsumerSummary,
  type GroundingRef,
  type RuntimeCoreJsonObject,
} from "../../openclaw_runtime/src/runtime-core";

const RAW_SENTINEL = "DEFAULT_ON_GROUNDING_RAW_SENTINEL_SHOULD_NOT_SURVIVE";
const AUTHORITY_SENTINEL = "runtimeAuthority:true";

describe("runtime grounding default-on diagnostics", () => {
  it("emits bounded diagnostics-only metadata by default", () => {
    const summary = createGroundingShadowConsumerSummary(defaultOnRefs(), {
      consumerId: "default-on-diagnostics",
      limit: 1,
      tokenBudget: 16,
      query: {
        readonly: true,
        includeRaw: true,
        includeUntrusted: true,
        metadata: hostileBoundaryMetadata("query"),
      } as never,
      metadata: hostileBoundaryMetadata("options"),
    });

    expect(isGroundingShadowConsumerSummary(summary)).toBe(true);
    expect(summary).toMatchObject({
      readonly: true,
      localOnly: true,
      shadowOnly: true,
      diagnosticOnly: true,
      summaryOnly: true,
      nonAuthoritative: true,
      authority: "none",
      rawRetained: false,
      noRuntimeAuthority: true,
      noCompletionAuthority: true,
      noProviderOrderingAuthority: true,
      noMemoryPromotionAuthority: true,
      noPatchMutationAuthority: true,
      metadata: expect.objectContaining({
        defaultOnDiagnostics: true,
        enabled: true,
        skipped: false,
        reason: "default_on_diagnostics_summary",
        acceptedRefCount: 2,
        untrustedInputRefCount: 1,
        untrustedExcluded: true,
      }),
    });
    expect(summary.query).toEqual(expect.objectContaining({
      readonly: true,
      includeRaw: false,
      includeUntrusted: false,
    }));
    expect(summary.items).toHaveLength(1);
    expect(summary.items[0]).toEqual(expect.objectContaining({
      authority: "none",
      trust: "supplied",
    }));
    expect(summary.items[0]?.trust).not.toBe("untrusted");
    expect(summary.estimatedTokens).toBeLessThanOrEqual(summary.tokenBudget);
    expectSerializedBoundary(summary);
  });

  it("restores disabled parity through explicit disable and kill switch", () => {
    const explicitDisable = createGroundingShadowConsumerSummary(defaultOnRefs(), {
      enabled: false,
      metadata: hostileBoundaryMetadata("disabled"),
    });
    const killSwitch = createGroundingShadowConsumerSummary(defaultOnRefs(), {
      killSwitch: true,
      metadata: hostileBoundaryMetadata("kill-switch"),
    });

    expectDisabledSummary(explicitDisable, "flag_disabled");
    expectDisabledSummary(killSwitch, "kill_switch");
    expect(explicitDisable.items).toEqual(killSwitch.items);
    expect(explicitDisable.omittedRefCount).toBe(killSwitch.omittedRefCount);
    expect(explicitDisable.estimatedTokens).toBe(killSwitch.estimatedTokens);
  });

  it("fails closed for missing input, invalid refs, invalid config, and exhausted budget", () => {
    const cases = [
      {
        reason: "missing_refs",
        summary: createGroundingShadowConsumerSummary([], {}),
      },
      {
        reason: "invalid_refs",
        summary: createGroundingShadowConsumerSummary([
          { id: "not-a-grounding-ref" } as never,
        ], {}),
      },
      {
        reason: "invalid_config",
        summary: createGroundingShadowConsumerSummary(defaultOnRefs(), {
          limit: -1,
        }),
      },
      {
        reason: "budget_exhausted",
        summary: createGroundingShadowConsumerSummary(defaultOnRefs(), {
          tokenBudget: 0,
        }),
      },
    ] as const;

    for (const item of cases) {
      expectDisabledSummary(item.summary, item.reason);
      expectSerializedBoundary(item.summary);
    }
  });

  it("does not change provider ordering, provider selection, model messages, or runtime decisions", () => {
    const registry = createContextProviderRegistryPilot();
    const before = registry.listManifests().map((manifest) => manifest.id);

    const summary = createGroundingShadowConsumerSummary(defaultOnRefs(), {
      metadata: {
        providerOrdering: ["must-not-survive"],
        providerSelection: "must-not-survive",
        modelMessages: ["must-not-survive"],
        runtimeDecision: "must-not-survive",
        gatewayRequest: "must-not-survive",
        prompt: "must-not-survive",
      } as never,
    });

    expect(registry.listManifests().map((manifest) => manifest.id)).toEqual(before);
    expect(before).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
    expect(JSON.stringify(summary)).not.toContain("must-not-survive");
    expectSerializedBoundary(summary);
  });
});

function expectDisabledSummary(
  summary: ReturnType<typeof createGroundingShadowConsumerSummary>,
  reason: string,
): void {
  expect(isGroundingShadowConsumerSummary(summary)).toBe(true);
  expect(summary.items).toEqual([]);
  expect(summary.omittedRefCount).toBe(0);
  expect(summary.estimatedTokens).toBe(0);
  expect(summary).toMatchObject({
    authority: "none",
    rawRetained: false,
    metadata: expect.objectContaining({
      defaultOnDiagnostics: true,
      enabled: false,
      skipped: true,
      reason,
      acceptedRefCount: 0,
      authority: "none",
      rawRetained: false,
    }),
  });
}

function expectSerializedBoundary(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(RAW_SENTINEL);
  expect(serialized).not.toContain(AUTHORITY_SENTINEL);
  expect(serialized).not.toContain("rawPrompt");
  expect(serialized).not.toContain("rawTrace");
  expect(serialized).not.toContain("apiKey");
  expect(serialized).not.toContain("authHeader");
  expect(serialized).not.toContain("traceparent");
  expect(serialized).not.toContain("tracestate");
  expect(serialized).not.toContain("baggage");
  expect(serialized).not.toContain("includeRaw\":true");
  expect(serialized).not.toContain("includeUntrusted\":true");
}

function defaultOnRefs(): GroundingRef[] {
  return [
    buildGroundingRefFixture({
      id: "default_on_untrusted",
      canonicalKey: "trace:default_on_untrusted",
      ref: "trace:default_on_untrusted",
      trust: "untrusted",
      metadata: hostileBoundaryMetadata("untrusted-ref") as never,
    }),
    buildGroundingRefFixture({
      id: "default_on_trusted",
      canonicalKey: "symbol:default_on_trusted",
      kind: "symbol",
      ref: "src/DefaultOn.ts#trusted",
      summary: "Default-on diagnostics-only grounding summary.",
      metadata: {
        safe: "kept",
        ...hostileBoundaryMetadata("trusted-ref"),
      } as never,
    }),
  ];
}

function hostileBoundaryMetadata(location: string): RuntimeCoreJsonObject {
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
    runtimeAuthorityAttempt: AUTHORITY_SENTINEL,
    prompt: RAW_SENTINEL,
    modelMessages: [RAW_SENTINEL],
    providerOrdering: [RAW_SENTINEL],
    providerSelection: RAW_SENTINEL,
    runtimeDecision: RAW_SENTINEL,
    gatewayRequest: RAW_SENTINEL,
  } as never;
}
