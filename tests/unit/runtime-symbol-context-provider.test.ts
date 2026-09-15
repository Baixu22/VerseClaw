import { describe, expect, it } from "vitest";
import {
  SYMBOL_CONTEXT_PROVIDER_ID,
  createSymbolContextProvider,
} from "../../openclaw_runtime/src/context-engine/symbol-context-provider";
import {
  buildRuntimeSymbolOverview,
  buildGroundingRefFixture,
  createLspUnavailableSymbolResult,
  isContextItem,
  isRuntimeContextProviderManifest,
  isRuntimeContextProviderResult,
  isRuntimeRegistryDiagnostic,
  type RuntimeContextProviderResult,
  type RuntimeLspDocumentSymbol,
  type RuntimeSymbolRange,
} from "../../openclaw_runtime/src/runtime-core";

const RAW_GROUNDING_SENTINEL = "RAW_SYMBOL_GROUNDING_DIAGNOSTIC_SHOULD_NOT_SURVIVE";

const range = (
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): RuntimeSymbolRange => ({
  start: { line: startLine, character: startCharacter },
  end: { line: endLine, character: endCharacter },
});

const symbols: RuntimeLspDocumentSymbol[] = [
  {
    name: "Dashboard",
    kind: "Function",
    detail: "Dashboard(): JSX.Element",
    range: range(0, 0, 12, 1),
    selectionRange: range(0, 16, 0, 25),
    children: [
      {
        name: "render",
        kind: "Function",
        detail: "render(): JSX.Element",
        range: range(4, 2, 9, 3),
        selectionRange: range(4, 11, 4, 17),
      },
    ],
  },
];

describe("Symbol context provider shadow boundary", () => {
  it("declares an explicit shadow-only provider manifest", () => {
    const provider = createSymbolContextProvider();

    expect(provider.manifest.id).toBe(SYMBOL_CONTEXT_PROVIDER_ID);
    expect(provider.manifest.enabledByDefault).toBe(false);
    expect(provider.manifest.shadowOnly).toBe(true);
    expect(provider.manifest.outputKinds).toEqual(["symbol", "summary", "evidence"]);
    expect(isRuntimeContextProviderManifest(provider.manifest)).toBe(true);
  });

  it("wraps readonly symbol overviews as ContextItems and diagnostics only", async () => {
    const overview = buildRuntimeSymbolOverview({
      file: "src/ui/Dashboard.tsx",
      symbols,
    });
    const provider = createSymbolContextProvider({ overviews: [overview] });
    const result = await provider.getContext({
      taskId: "line-b-symbol",
      tokenBudget: 128,
    });
    const providerResult = expectProviderResult(result);

    expect(providerResult.status).toBe("success");
    expect(providerResult.contextItems.length).toBe(2);
    expect(providerResult.contextItems.every(isContextItem)).toBe(true);
    expect(providerResult.contextItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `${SYMBOL_CONTEXT_PROVIDER_ID}:symbol:src/ui/Dashboard.tsx#Dashboard@1`,
        kind: "symbol",
        text: expect.stringContaining("Dashboard (Function)"),
        metadata: expect.objectContaining({
          readonlySymbolContext: true,
          shadowOnly: true,
          legacyAuthoritative: true,
          noSymbolMutation: true,
          noPromptAuthority: true,
          noToolAuthority: true,
          noRuntimeAuthority: true,
        }),
      }),
      expect.objectContaining({
        id: `${SYMBOL_CONTEXT_PROVIDER_ID}:symbol:src/ui/Dashboard.tsx#Dashboard/render@1.1`,
        kind: "symbol",
        text: expect.stringContaining("render(): JSX.Element"),
      }),
    ]));
    expect(providerResult.diagnostics).toEqual([
      expect.objectContaining({
        providerId: SYMBOL_CONTEXT_PROVIDER_ID,
        status: "fallback",
        reason: "legacy_authoritative",
        metadata: expect.objectContaining({
          overviewCount: 1,
          symbolCount: 2,
          readonlySymbolContext: true,
        }),
      }),
    ]);
    expect(providerResult.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
  });

  it("keeps grounding diagnostics absent and disabled behavior unchanged", async () => {
    const overview = buildRuntimeSymbolOverview({
      file: "src/ui/Dashboard.tsx",
      symbols,
    });
    const input = {
      taskId: "line-c-symbol-grounding-default-off",
      tokenBudget: 128,
    };
    const baseline = expectProviderResult(await createSymbolContextProvider({
      overviews: [overview],
    }).getContext(input));
    const disabled = expectProviderResult(await createSymbolContextProvider({
      overviews: [overview],
      groundingDiagnostics: {
        enabled: false,
        refs: [buildGroundingRefFixture({ id: "symbol_grounding_disabled" })],
      },
    }).getContext(input));    expect(disabled).toEqual(baseline);
    expect(JSON.stringify(disabled)).not.toContain("groundingDiagnostics");
  });

  it("emits explicit grounding diagnostics metadata without symbol context cutover", async () => {
    const overview = buildRuntimeSymbolOverview({
      file: "src/ui/Dashboard.tsx",
      symbols,
    });
    const input = {
      taskId: "line-c-symbol-grounding-diagnostics",
      tokenBudget: 128,
    };
    const baseline = expectProviderResult(await createSymbolContextProvider({
      overviews: [overview],
    }).getContext(input));
    const trusted = buildGroundingRefFixture({
      id: "symbol_grounding_trusted",
      canonicalKey: "symbol:symbol_grounding_trusted",
      kind: "symbol",
      ref: "src/ui/Dashboard.tsx#Dashboard",
      label: "Symbol grounding trusted ref",
      summary: `Symbol grounding diagnostics summary ${"x".repeat(120)}`,
      metadata: {
        safe: "kept",
        sourceRefsAreRelevanceLinksOnly: true,
        noDurableFactPromotionFromGrounding: true,
        noSymbolMutationAuthority: true,
      },
    });
    const untrusted = buildGroundingRefFixture({
      id: "symbol_grounding_untrusted",
      canonicalKey: "trace:symbol_grounding_untrusted",
      ref: "trace:symbol_grounding_untrusted",
      trust: "untrusted",
      metadata: {
        rawTrace: RAW_GROUNDING_SENTINEL,
      } as never,
    });
    const result = expectProviderResult(await createSymbolContextProvider({
      overviews: [overview],
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
    }).getContext(input));    expect(result.status).toBe("success");
    expect(result.contextItems).toEqual(baseline.contextItems);
    expect(result.evidenceRefs).toEqual(baseline.evidenceRefs);
    expect(result.diagnostics).toHaveLength(baseline.diagnostics.length + 1);
    expect(result.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);

    const diagnostic = result.diagnostics.find((item) =>
      item.message?.includes("grounding diagnostics-only")
    );
    expect(diagnostic).toEqual(expect.objectContaining({
      providerId: SYMBOL_CONTEXT_PROVIDER_ID,
      status: "ok",
      reason: "registered",
      metadata: expect.objectContaining({
        symbolGroundingDiagnostics: true,
        diagnosticsOnly: true,
        metadataOnly: true,
        noContextItemAuthority: true,
        noProviderResultAuthority: true,
        noSymbolMutationAuthority: true,
        authority: "none",
        rawRetained: false,
        noRuntimeAuthority: true,
        noProviderOrderingAuthority: true,
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
    expect(diagnostic?.metadata?.items).toEqual([
      expect.objectContaining({
        authority: "none",
        trust: "supplied",
        metadata: expect.objectContaining({
          noDurableFactPromotionFromGrounding: true,
          sourceRefsAreRelevanceLinksOnly: true,
          noSymbolMutationAuthority: true,
        }),
      }),
    ]);
    expect(result.metadata).toEqual(expect.objectContaining({
      groundingDiagnostics: expect.objectContaining({
        symbolGroundingDiagnostics: true,
        itemCount: 1,
        authority: "none",
        rawRetained: false,
      }),
    }));
    expect(JSON.stringify(result)).not.toContain(RAW_GROUNDING_SENTINEL);
    expect(JSON.stringify(result)).not.toContain("rawTrace");
    expect(JSON.stringify(result)).not.toContain("apiKey");
  });

  it("converts structured readonly symbol fallback into provider diagnostics", async () => {
    const fallback = createLspUnavailableSymbolResult("overview");
    if (fallback.ok) {
      throw new Error("Fixture must be an LSP-unavailable fallback.");
    }

    const provider = createSymbolContextProvider({ fallback: fallback.fallback });
    const result = await provider.getContext({ taskId: "line-b-symbol-fallback" });
    const providerResult = expectProviderResult(result);

    expect(providerResult.status).toBe("fallback");
    expect(providerResult.contextItems).toEqual([]);
    expect(providerResult.diagnostics).toEqual([
      expect.objectContaining({
        providerId: SYMBOL_CONTEXT_PROVIDER_ID,
        status: "fallback",
        reason: "capability_unsupported",
        metadata: expect.objectContaining({
          operation: "overview",
          symbolFallbackReason: "lsp_unavailable",
          retryable: true,
          noSymbolMutation: true,
        }),
      }),
    ]);
  });
});

function expectProviderResult(
  result: Awaited<ReturnType<ReturnType<typeof createSymbolContextProvider>["getContext"]>>,
): RuntimeContextProviderResult {
  expect(isRuntimeContextProviderResult(result)).toBe(true);
  expect(Array.isArray(result)).toBe(false);
  if (Array.isArray(result)) {
    throw new Error("Symbol provider must return a RuntimeContextProviderResult.");
  }
  return result;
}
