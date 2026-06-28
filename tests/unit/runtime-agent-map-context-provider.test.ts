import { describe, expect, it } from "vitest";
import {
  AGENT_MAP_CONTEXT_PROVIDER_ID,
  createAgentMapContextProvider,
} from "../../openclaw_runtime/src/context-engine/agent-map-context-provider";
import {
  buildAgentMapDiagnosticFixture,
  buildAgentMapResultFixture,
  buildGroundingRefFixture,
  isContextItem,
  isRuntimeContextProviderManifest,
  isRuntimeContextProviderResult,
  isRuntimeRegistryDiagnostic,
  type RuntimeContextProviderResult,
} from "../../openclaw_runtime/src/runtime-core";

const agentMapProviderEnabledConfig = {
  runtime: {
    agentMap: { provider: true },
  },
};

const RAW_GROUNDING_SENTINEL = "RAW_AGENT_MAP_GROUNDING_DIAGNOSTIC_SHOULD_NOT_SURVIVE";

describe("AgentMap context provider shadow boundary", () => {
  it("declares an explicit shadow-only provider manifest", () => {
    const provider = createAgentMapContextProvider();

    expect(provider.manifest.id).toBe(AGENT_MAP_CONTEXT_PROVIDER_ID);
    expect(provider.manifest.enabledByDefault).toBe(false);
    expect(provider.manifest.shadowOnly).toBe(true);
    expect(provider.manifest.outputKinds).toEqual(["symbol", "file", "summary", "evidence"]);
    expect(isRuntimeContextProviderManifest(provider.manifest)).toBe(true);
  });

  it("wraps readonly AgentMap output as ContextItems and diagnostics only", async () => {
    const agentMapResult = buildAgentMapResultFixture();
    const provider = createAgentMapContextProvider({
      result: agentMapResult,
      config: agentMapProviderEnabledConfig,
    });
    const result = await provider.getContext({
      taskId: "line-b-agent-map",
      tokenBudget: 128,
    });
    const providerResult = expectProviderResult(result);

    expect(providerResult.status).toBe("success");
    expect(providerResult.contextItems.length).toBeGreaterThan(0);
    expect(providerResult.contextItems.every(isContextItem)).toBe(true);
    expect(providerResult.contextItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `${AGENT_MAP_CONTEXT_PROVIDER_ID}:symbol:${agentMapResult.includedSymbols[0].tag.tagId}`,
        kind: "symbol",
        metadata: expect.objectContaining({
          readonlyAgentMap: true,
          shadowOnly: true,
          legacyAuthoritative: true,
          noPromptAuthority: true,
          noToolAuthority: true,
          noRuntimeAuthority: true,
        }),
      }),
      expect.objectContaining({
        id: `${AGENT_MAP_CONTEXT_PROVIDER_ID}:summary:${agentMapResult.status}`,
        kind: "summary",
      }),
    ]));
    expect(providerResult.diagnostics).toEqual([
      expect.objectContaining({
        providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
        status: "fallback",
        reason: "legacy_authoritative",
        metadata: expect.objectContaining({
          includedSymbolCount: agentMapResult.includedSymbols.length,
          promptPresentExcludedCount: 1,
          readonlyAgentMap: true,
        }),
      }),
    ]);
    expect(providerResult.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
  });

  it("keeps grounding diagnostics absent and disabled behavior unchanged", async () => {
    const agentMapResult = buildAgentMapResultFixture();
    const input = {
      taskId: "line-c-agent-map-grounding-default-off",
      tokenBudget: 128,
    };
    const baseline = await createAgentMapContextProvider({
      result: agentMapResult,
      config: agentMapProviderEnabledConfig,
    }).getContext(input);
    const disabled = await createAgentMapContextProvider({
      result: agentMapResult,
      config: agentMapProviderEnabledConfig,
      groundingDiagnostics: {
        enabled: false,
        refs: [buildGroundingRefFixture({ id: "agent_map_grounding_disabled" })],
      },
    }).getContext(input);

    expectProviderResult(baseline);
    expectProviderResult(disabled);
    expect(disabled).toEqual(baseline);
    expect(JSON.stringify(disabled)).not.toContain("groundingDiagnostics");
  });

  it("emits explicit grounding diagnostics metadata without AgentMap context cutover", async () => {
    const agentMapResult = buildAgentMapResultFixture();
    const input = {
      taskId: "line-c-agent-map-grounding-diagnostics",
      tokenBudget: 128,
    };
    const baseline = await createAgentMapContextProvider({
      result: agentMapResult,
      config: agentMapProviderEnabledConfig,
    }).getContext(input);
    const trusted = buildGroundingRefFixture({
      id: "agent_map_grounding_trusted",
      canonicalKey: "file:src/ui/Dashboard.tsx",
      kind: "file",
      ref: "src/ui/Dashboard.tsx",
      label: "AgentMap file anchor",
      summary: `AgentMap grounding diagnostics summary ${"x".repeat(120)}`,
      metadata: {
        safe: "kept",
        sourceRefsAreEvidenceLinksOnly: true,
        sourceRefsAreRelevanceLinksOnly: true,
        noPromptAuthority: true,
        noProviderOrderingAuthority: true,
        noDurableFactPromotionFromGrounding: true,
      },
    });
    const untrusted = buildGroundingRefFixture({
      id: "agent_map_grounding_untrusted",
      canonicalKey: "trace:agent_map_grounding_untrusted",
      ref: "trace:agent_map_grounding_untrusted",
      trust: "untrusted",
      metadata: {
        rawTrace: RAW_GROUNDING_SENTINEL,
      } as never,
    });
    const result = await createAgentMapContextProvider({
      result: agentMapResult,
      config: agentMapProviderEnabledConfig,
      groundingDiagnostics: {
        enabled: true,
        refs: [untrusted, trusted],
        limit: 1,
        tokenBudget: 4,
        query: { readonly: true, includeRaw: true } as never,
        metadata: {
          safe: "kept",
          rawChat: RAW_GROUNDING_SENTINEL,
          secrets: { apiKey: RAW_GROUNDING_SENTINEL },
        } as never,
      },
    }).getContext(input);

    expectProviderResult(baseline);
    expectProviderResult(result);
    expect(result.status).toBe("success");
    expect(result.contextItems).toEqual(baseline.contextItems);
    expect(result.evidenceRefs).toEqual(baseline.evidenceRefs);
    expect(result.diagnostics).toHaveLength(baseline.diagnostics.length + 1);
    expect(result.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);

    const diagnostic = result.diagnostics.find((item) =>
      item.message.includes("grounding diagnostics-only")
    );
    expect(diagnostic).toEqual(expect.objectContaining({
      providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
      status: "ok",
      reason: "registered",
      metadata: expect.objectContaining({
        agentMapGroundingDiagnostics: true,
        diagnosticsOnly: true,
        metadataOnly: true,
        noContextItemAuthority: true,
        noProviderResultAuthority: true,
        noPromptAuthority: true,
        noProviderOrderingAuthority: true,
        authority: "none",
        rawRetained: false,
        noRuntimeAuthority: true,
        noCompletionAuthority: true,
        noMemoryPromotionAuthority: true,
        noPatchMutationAuthority: true,
        itemCount: 1,
      }),
    }));
    expect(diagnostic?.metadata?.query).toEqual(expect.objectContaining({
      readonly: true,
      includeRaw: false,
      includeUntrusted: false,
      tokenBudget: 4,
    }));
    expect(Number(diagnostic?.metadata?.estimatedTokens))
      .toBeLessThanOrEqual(Number(diagnostic?.metadata?.tokenBudget));
    expect(diagnostic?.metadata?.items).toEqual([
      expect.objectContaining({
        authority: "none",
        trust: "supplied",
        metadata: expect.objectContaining({
          noDurableFactPromotionFromGrounding: true,
          noPromptAuthority: true,
          noProviderOrderingAuthority: true,
          sourceRefsAreEvidenceLinksOnly: true,
          sourceRefsAreRelevanceLinksOnly: true,
        }),
      }),
    ]);
    expect(result.metadata).toEqual(expect.objectContaining({
      groundingDiagnostics: expect.objectContaining({
        agentMapGroundingDiagnostics: true,
        itemCount: 1,
        authority: "none",
        rawRetained: false,
        noPromptAuthority: true,
        noProviderOrderingAuthority: true,
      }),
    }));
    expect(JSON.stringify(result)).not.toContain(RAW_GROUNDING_SENTINEL);
    expect(JSON.stringify(result)).not.toContain("rawTrace");
    expect(JSON.stringify(result)).not.toContain("apiKey");
  });

  it("accepts explicit hardened AgentMap result injection as shadow diagnostics", async () => {
    const agentMapDiagnostic = buildAgentMapDiagnosticFixture({
      code: "parse_failure",
      severity: "warning",
      file: "src/runtime/broken.ts",
      message: "Skipped src/runtime/broken.ts after TypeScript parse diagnostics.",
    });
    const agentMapResult = buildAgentMapResultFixture({
      diagnostics: [agentMapDiagnostic],
    });
    const provider = createAgentMapContextProvider();
    const result = await provider.getContext({
      taskId: "line-b-agent-map-metadata",
      metadata: {
        agentMapResult: agentMapResult as never,
        config: agentMapProviderEnabledConfig as never,
      },
    });
    const providerResult = expectProviderResult(result);

    expect(providerResult.status).toBe("success");
    expect(providerResult.contextItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `${AGENT_MAP_CONTEXT_PROVIDER_ID}:diagnostic:1:parse_failure`,
        kind: "evidence",
        text: expect.stringContaining("parse_failure"),
        metadata: expect.objectContaining({
          readonlyAgentMap: true,
          shadowOnly: true,
          legacyAuthoritative: true,
          agentMapDiagnosticCode: "parse_failure",
          noPromptAuthority: true,
          noToolAuthority: true,
          noRuntimeAuthority: true,
        }),
      }),
    ]));
    expect(providerResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
        status: "fallback",
        reason: "legacy_authoritative",
        metadata: expect.objectContaining({
          agentMapDiagnosticCount: 1,
          readonlyAgentMap: true,
        }),
      }),
      expect.objectContaining({
        providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
        status: "fallback",
        reason: "legacy_authoritative",
        message: agentMapDiagnostic.message,
        metadata: expect.objectContaining({
          agentMapDiagnosticCode: "parse_failure",
          agentMapDiagnosticSeverity: "warning",
          shadowOnly: true,
          noPromptAuthority: true,
        }),
      }),
    ]));
    expect(providerResult.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
    expect(providerResult.metadata).toEqual(expect.objectContaining({
      agentMapDiagnosticCount: 1,
      readonlyAgentMap: true,
      shadowOnly: true,
    }));
  });

  it("isolates provider failures as diagnostics without context output", async () => {
    const provider = createAgentMapContextProvider({
      config: agentMapProviderEnabledConfig,
      getResult: () => {
        throw new Error("agent map shadow collection failed");
      },
    });
    const result = await provider.getContext({ taskId: "line-b-agent-map-error" });
    const providerResult = expectProviderResult(result);

    expect(providerResult.status).toBe("error");
    expect(providerResult.contextItems).toEqual([]);
    expect(providerResult.diagnostics).toEqual([
      expect.objectContaining({
        providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
        status: "error",
        reason: "provider_error",
        message: "agent map shadow collection failed",
        metadata: expect.objectContaining({
          providerFailureIsolated: true,
          legacyBehaviorUnaffected: true,
          shadowOnly: true,
          legacyAuthoritative: true,
          noRuntimeAuthority: true,
        }),
      }),
    ]);
    expect(providerResult.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
  });

  it("returns no_result diagnostics when no readonly AgentMap result is supplied", async () => {
    const provider = createAgentMapContextProvider({ config: agentMapProviderEnabledConfig });
    const result = await provider.getContext({ taskId: "line-b-agent-map-empty" });
    const providerResult = expectProviderResult(result);

    expect(providerResult.status).toBe("fallback");
    expect(providerResult.contextItems).toEqual([]);
    expect(providerResult.diagnostics).toEqual([
      expect.objectContaining({
        providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
        status: "skipped",
        reason: "no_result",
        metadata: expect.objectContaining({
          legacyAuthoritative: true,
          shadowOnly: true,
        }),
      }),
    ]);
  });

  it("keeps AgentMap provider output disabled until the explicit config flag is enabled", async () => {
    let agentMapRuns = 0;
    const provider = createAgentMapContextProvider({
      getResult: () => {
        agentMapRuns += 1;
        return buildAgentMapResultFixture();
      },
    });
    const result = await provider.getContext({
      taskId: "line-b-agent-map-flag-off",
      metadata: {
        config: { runtime: { agentMap: {} } } as never,
      },
    });
    const providerResult = expectProviderResult(result);

    expect(agentMapRuns).toBe(0);
    expect(providerResult.status).toBe("fallback");
    expect(providerResult.contextItems).toEqual([]);
    expect(providerResult.diagnostics).toEqual([
      expect.objectContaining({
        providerId: AGENT_MAP_CONTEXT_PROVIDER_ID,
        status: "skipped",
        reason: "flag_disabled",
        metadata: expect.objectContaining({
          requiredFlag: "runtime.agentMap.provider",
          legacyBehaviorUnaffected: true,
          noPromptAuthority: true,
          noToolAuthority: true,
          noRuntimeAuthority: true,
        }),
      }),
    ]);
  });
});

function expectProviderResult(
  result: Awaited<ReturnType<ReturnType<typeof createAgentMapContextProvider>["getContext"]>>,
): RuntimeContextProviderResult {
  expect(isRuntimeContextProviderResult(result)).toBe(true);
  expect(Array.isArray(result)).toBe(false);
  if (Array.isArray(result)) {
    throw new Error("AgentMap provider must return a RuntimeContextProviderResult.");
  }
  return result;
}
