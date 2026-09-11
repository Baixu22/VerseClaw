import { describe, expect, it } from "vitest";
import {
  createTestContextProviderRegistry,
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
} from "./helpers/context-provider-registry";
import {
  RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
  createRuntimeTraceContextProvider,
} from "../../openclaw_runtime/src/context-engine/trace-context-provider";
import {
  buildGroundingRefFixture,
  buildRuntimeTraceSpanFixture,
  createRuntimeTraceSpanStore,
  isContextItem,
  isRuntimeContextProviderManifest,
  isRuntimeContextProviderResult,
  isRuntimeRegistryDiagnostic,
  type RuntimeContextProviderResult,
  type RuntimeTraceSpan,
} from "../../openclaw_runtime/src/runtime-core";

const enabledConfig = {
  runtime: {
    traceContext: {
      provider: true,
    },
  },
};

const RAW_GROUNDING_SENTINEL = "RAW_TRACE_GROUNDING_DIAGNOSTIC_SHOULD_NOT_SURVIVE";

describe("runtime trace context provider", () => {
  it("keeps registration optional, default-off, and shadow-only", () => {
    const store = createRuntimeTraceSpanStore();
    const provider = createRuntimeTraceContextProvider({ store, config: enabledConfig });
    const defaultRegistry = createTestContextProviderRegistry();
    const registryWithTrace = createTestContextProviderRegistry([provider]);

    expect(defaultRegistry.listManifests().map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
    expect(registryWithTrace.listManifests().map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
      RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
    ]);
    expect(isRuntimeContextProviderManifest(provider.manifest)).toBe(true);
    expect(provider.manifest).toMatchObject({
      id: RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
      enabledByDefault: false,
      shadowOnly: true,
      outputKinds: ["trace", "summary", "evidence"],
      dependsOnIndexing: false,
      metadata: {
        readonlyTraceContext: true,
        noRuntimeAuthority: true,
      },
    });
  });

  it("returns only a skipped diagnostic when the trace provider flag is disabled", async () => {
    const store = createRuntimeTraceSpanStore();
    store.append(span({
      traceId: "trace_disabled",
      spanId: "span_error",
      status: "error",
      attributes: { "task.id": "task_disabled" },
    }));
    const provider = createRuntimeTraceContextProvider({ store, config: {} });

    const result = await provider.getContext({
      taskId: "task_disabled",
      tokenBudget: 128,
      metadata: { traceId: "trace_disabled" },
    });

    expectProviderResult(result);
    expect(result).toMatchObject({
      status: "fallback",
      contextItems: [],
      diagnostics: [
        expect.objectContaining({
          providerId: RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
          status: "skipped",
          reason: "flag_disabled",
          metadata: expect.objectContaining({
            legacyBehaviorUnaffected: true,
            shadowOnly: true,
          }),
        }),
      ],
      metadata: expect.objectContaining({
        enabled: false,
        legacyBehaviorUnaffected: true,
      }),
    });
  });

  it("keeps grounding diagnostics absent and disabled behavior unchanged", async () => {
    const store = createRuntimeTraceSpanStore();
    store.append(span({
      traceId: "trace_grounding_default_off",
      spanId: "span_grounding_default_off",
      attributes: { "task.id": "task_grounding_default_off" },
    }));
    const input = {
      taskId: "task_grounding_default_off",
      tokenBudget: 128,
      metadata: { traceId: "trace_grounding_default_off" },
    };
    const baseline = await createRuntimeTraceContextProvider({
      store,
      config: enabledConfig,
    }).getContext(input);
    const disabled = await createRuntimeTraceContextProvider({
      store,
      config: enabledConfig,
      groundingDiagnostics: {
        enabled: false,
        refs: [buildGroundingRefFixture({ id: "trace_grounding_disabled" })],
      },
    }).getContext(input);

    expectProviderResult(baseline);
    expectProviderResult(disabled);
    expect(disabled).toEqual(baseline);
    expect(JSON.stringify(disabled)).not.toContain("groundingDiagnostics");
  });

  it("returns ranked budgeted trace context items without full trace dumps", async () => {
    const store = createRuntimeTraceSpanStore();
    store.appendMany(providerRankingFixture());
    const provider = createRuntimeTraceContextProvider({ store, config: enabledConfig });

    const result = await provider.getContext({
      taskId: "task_focus",
      tokenBudget: 420,
      activeFiles: ["src/focus.ts"],
      metadata: {
        traceId: "trace_provider",
        toolName: "focus_tool",
        symbol: "focusSymbol",
      },
    });

    expectProviderResult(result);
    expect(result.status).toBe("success");
    expect(result.contextItems.every(isContextItem)).toBe(true);
    expect(result.contextItems.map((item) => item.metadata?.spanId)).toEqual([
      "span_error",
      "span_match",
      "span_test",
      "span_verifier",
      "span_linked",
      "span_sibling",
    ]);
    expect(result.contextItems.map((item) => item.priority)).toEqual([
      "P0",
      "P2",
      "P1",
      "P1",
      "P1",
      "P2",
    ]);
    expect(result.contextItems[0]).toMatchObject({
      kind: "trace",
      source: "trace:trace_provider:span_error",
      metadata: expect.objectContaining({
        readonlyTraceContext: true,
        noVerifierAuthority: true,
        noRuntimeAuthority: true,
      }),
    });
    expect(result.metadata).toMatchObject({
      providerId: RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
      enabled: true,
      shadowOnly: true,
      readonlyTraceContext: true,
      noRuntimeAuthority: true,
      traceIds: ["trace_provider"],
      contextItemCount: 6,
    });
    expect(Number(result.metadata?.estimatedTokens)).toBeLessThanOrEqual(420);
    expect(JSON.stringify(result)).not.toContain("raw output");
    expect(JSON.stringify(result)).not.toContain("raw prompt");
    expect(JSON.stringify(result)).not.toContain("sk-live");
  });

  it("emits explicit grounding diagnostics metadata without context cutover", async () => {
    const store = createRuntimeTraceSpanStore();
    store.append(span({
      traceId: "trace_grounding_diagnostics",
      spanId: "span_grounding_diagnostics",
      kind: "tool",
      attributes: {
        "task.id": "task_grounding_diagnostics",
        "tool.name": "grounding_tool",
      },
      sourceRefs: [{ file: "src/grounding.ts", symbol: "runGrounding" }],
      evidenceRefs: [{ type: "file", ref: "src/grounding.ts" }],
    }));
    const input = {
      taskId: "task_grounding_diagnostics",
      tokenBudget: 128,
      metadata: {
        traceId: "trace_grounding_diagnostics",
        toolName: "grounding_tool",
      },
    };
    const baseline = await createRuntimeTraceContextProvider({
      store,
      config: enabledConfig,
    }).getContext(input);
    const trusted = buildGroundingRefFixture({
      id: "trace_grounding_trusted",
      canonicalKey: "symbol:trace_grounding_trusted",
      kind: "symbol",
      ref: "src/grounding.ts#runGrounding",
      label: "Trace grounding trusted ref",
      summary: `Trace grounding diagnostics summary ${"x".repeat(120)}`,
      metadata: {
        safe: "kept",
        sourceRefsAreRelevanceLinksOnly: true,
        noDurableFactPromotionFromGrounding: true,
      },
    });
    const untrusted = buildGroundingRefFixture({
      id: "trace_grounding_untrusted",
      canonicalKey: "trace:trace_grounding_untrusted",
      ref: "trace:trace_grounding_untrusted",
      trust: "untrusted",
      metadata: {
        rawTrace: RAW_GROUNDING_SENTINEL,
      } as never,
    });
    const result = await createRuntimeTraceContextProvider({
      store,
      config: enabledConfig,
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
      item?.message?.includes("grounding diagnostics-only")
    );
    expect(diagnostic).toEqual(expect.objectContaining({
      providerId: RUNTIME_TRACE_CONTEXT_PROVIDER_ID,
      status: "ok",
      reason: "registered",
      metadata: expect.objectContaining({
        runtimeTraceGroundingDiagnostics: true,
        diagnosticsOnly: true,
        metadataOnly: true,
        noContextItemAuthority: true,
        noProviderResultAuthority: true,
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
        }),
      }),
    ]);
    expect(result.metadata).toEqual(expect.objectContaining({
      groundingDiagnostics: expect.objectContaining({
        runtimeTraceGroundingDiagnostics: true,
        itemCount: 1,
        authority: "none",
        rawRetained: false,
      }),
    }));
    expect(JSON.stringify(result)).not.toContain(RAW_GROUNDING_SENTINEL);
    expect(JSON.stringify(result)).not.toContain("rawTrace");
    expect(JSON.stringify(result)).not.toContain("apiKey");
  });

  it("links source refs to evidence refs without replacing verifier evidence", async () => {
    const store = createRuntimeTraceSpanStore();
    store.append(span({
      traceId: "trace_source",
      spanId: "span_source",
      kind: "tool",
      attributes: {
        "task.id": "task_source",
        "tool.name": "source_tool",
      },
      sourceRefs: [
        {
          file: "src/source.ts",
          symbol: "runSource",
          startLine: 10,
          endLine: 12,
        },
      ],
      evidenceRefs: [{ type: "file", ref: "src/source.ts", summary: "Patch evidence" }],
    }));
    const provider = createRuntimeTraceContextProvider({ store, config: enabledConfig });

    const result = await provider.getContext({
      taskId: "task_source",
      metadata: {
        traceId: "trace_source",
        toolName: "source_tool",
        file: "src/source.ts",
        symbol: "runSource",
      },
    });

    expectProviderResult(result);
    expect(result.contextItems).toHaveLength(1);
    expect(result.contextItems[0]?.metadata).toMatchObject({
      sourceRefsAreEvidenceLinksOnly: true,
      noVerifierAuthority: true,
      sourceRefs: [
        {
          file: "src/source.ts",
          symbol: "runSource",
          startLine: 10,
          endLine: 12,
        },
      ],
    });
    expect(result.contextItems[0]?.evidenceRefs).toEqual(expect.arrayContaining([
      { type: "trace", ref: "trace_source:span_source", label: "Runtime trace span", summary: expect.any(String) },
      { type: "file", ref: "src/source.ts", summary: "Patch evidence" },
    ]));
  });

  it("discovers traces from current task/file query and still honors the token budget", async () => {
    const store = createRuntimeTraceSpanStore();
    store.appendMany(providerRankingFixture());
    const provider = createRuntimeTraceContextProvider({ store, config: enabledConfig });

    const result = await provider.getContext({
      taskId: "task_focus",
      tokenBudget: 20,
      activeFiles: ["src/focus.ts"],
      metadata: {
        symbol: "focusSymbol",
      },
    });

    expectProviderResult(result);
    expect(result.contextItems.length).toBeGreaterThan(0);
    expect(result.contextItems.length).toBeLessThan(providerRankingFixture().length);
    expect(result.contextItems[0]?.metadata?.spanId).toBe("span_error");
    expect(Number(result.metadata?.estimatedTokens)).toBeLessThanOrEqual(20);
  });
});

function expectProviderResult(
  value: RuntimeContextProviderResult | RuntimeContextProviderResult["contextItems"],
): asserts value is RuntimeContextProviderResult {
  expect(Array.isArray(value)).toBe(false);
  expect(isRuntimeContextProviderResult(value)).toBe(true);
}

function providerRankingFixture(): RuntimeTraceSpan[] {
  return [
    span({
      traceId: "trace_provider",
      spanId: "span_sibling",
      kind: "runtime",
      name: "runtime.note",
      startedAt: 1,
      endedAt: 2,
      attributes: { "task.id": "task_focus" },
      sourceRefs: [{ file: "src/other.ts", symbol: "otherSymbol" }],
      evidenceRefs: [],
      events: [],
    }),
    span({
      traceId: "trace_provider",
      spanId: "span_match",
      kind: "tool",
      name: "tool.call",
      startedAt: 2,
      endedAt: 3,
      attributes: {
        "task.id": "task_focus",
        "tool.name": "focus_tool",
      },
      sourceRefs: [{ file: "src/focus.ts", symbol: "focusSymbol" }],
      evidenceRefs: [{ type: "file", ref: "src/focus.ts" }],
      events: [],
    }),
    span({
      traceId: "trace_provider",
      spanId: "span_test",
      kind: "test",
      name: "test.run",
      startedAt: 3,
      endedAt: 4,
      attributes: { "task.id": "task_focus" },
      evidenceRefs: [{ type: "test", ref: "tests/unit/focus.test.ts" }],
      events: [],
    }),
    span({
      traceId: "trace_provider",
      spanId: "span_verifier",
      kind: "verifier",
      name: "verifier.decision",
      startedAt: 4,
      endedAt: 5,
      attributes: { "task.id": "task_focus", prompt: "raw prompt" },
      evidenceRefs: [{ type: "trace", ref: "trace_provider" }],
      events: [],
    }),
    span({
      traceId: "trace_provider",
      spanId: "span_linked",
      kind: "checkpoint",
      name: "resume.link",
      startedAt: 5,
      endedAt: 6,
      links: [
        {
          traceId: "trace_previous",
          spanId: "span_checkpoint",
          relationship: "resume",
        },
      ],
      attributes: { "task.id": "task_focus" },
      evidenceRefs: [{ type: "checkpoint", ref: "checkpoint_1" }],
      events: [],
    }),
    span({
      traceId: "trace_provider",
      spanId: "span_error",
      kind: "tool",
      name: "tool.call",
      status: "error",
      statusMessage: "failed with sk-live token",
      startedAt: 6,
      endedAt: 7,
      attributes: {
        "task.id": "task_focus",
        "tool.name": "broken_tool",
        output: "raw output",
      },
      evidenceRefs: [{ type: "tool", ref: "tool_call_failed" }],
      events: [],
    }),
  ];
}

function span(overrides: Partial<RuntimeTraceSpan> = {}): RuntimeTraceSpan {
  return {
    ...buildRuntimeTraceSpanFixture({
      traceId: "trace_provider",
      evidenceRefs: [],
      events: [],
      sourceRefs: [{ file: "src/default.ts", symbol: "defaultSymbol" }],
    }),
    ...overrides,
  };
}
