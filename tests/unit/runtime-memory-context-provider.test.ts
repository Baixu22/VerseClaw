import { describe, expect, it } from "vitest";
import {
  createTestContextProviderRegistry,
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
} from "./helpers/context-provider-registry";
import {
  createRuntimeMemoryContextProvider,
  createRuntimeMemoryProviderResult,
  RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
} from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import {
  buildGroundingRefFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  isContextItem,
  isRuntimeContextProviderManifest,
  isRuntimeContextProviderResult,
  isRuntimeMemoryContextProviderResult,
  isRuntimeRegistryDiagnostic,
  type RuntimeContextProviderResult,
  type RuntimeMemoryQueryableFact,
} from "../../openclaw_runtime/src/runtime-core";

const enabledConfig = {
  runtime: {
    memory: {
      provider: true,
    },
  },
};

const RAW_GROUNDING_SENTINEL =
  "RAW_RUNTIME_MEMORY_GROUNDING_DIAGNOSTIC_SHOULD_NOT_SURVIVE";

describe("runtime memory context provider", () => {
  it("keeps registration optional, default-off, and shadow-only", () => {
    const provider = createRuntimeMemoryContextProvider({ config: enabledConfig });
    const defaultRegistry = createTestContextProviderRegistry();
    const registryWithMemory = createTestContextProviderRegistry([provider]);

    expect(defaultRegistry.listManifests().map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
    expect(registryWithMemory.listManifests().map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
      RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
    ]);
    expect(isRuntimeContextProviderManifest(provider.manifest)).toBe(true);
    expect(provider.manifest).toMatchObject({
      id: RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
      enabledByDefault: false,
      shadowOnly: true,
      outputKinds: ["memory", "summary", "evidence"],
      dependsOnIndexing: false,
      metadata: {
        readonlyMemoryContext: true,
        noMemoryDump: true,
        noCompletionAuthority: true,
        noVerifierAuthority: true,
        noSecurityAuthority: true,
        noRetryAuthority: true,
        noToolAuthority: true,
        noRuntimeAuthority: true,
      },
    });
  });

  it("returns only a skipped diagnostic when the memory provider flag is disabled", async () => {
    const provider = createRuntimeMemoryContextProvider({
      facts: [fact({ factId: "fact_disabled", taskId: "task_disabled" })],
      config: {},
    });

    const result = await provider.getContext({
      taskId: "task_disabled",
      tokenBudget: 128,
    });

    expectProviderResult(result);
    expect(result).toMatchObject({
      status: "fallback",
      contextItems: [],
      diagnostics: [
        expect.objectContaining({
          providerId: RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
          status: "skipped",
          reason: "flag_disabled",
          metadata: expect.objectContaining({
            legacyBehaviorUnaffected: true,
            shadowOnly: true,
            requiredFlag: "runtime.memory.provider",
          }),
        }),
      ],
      metadata: expect.objectContaining({
        enabled: false,
        legacyBehaviorUnaffected: true,
      }),
    });
  });

  it("keeps absent and disabled grounding diagnostics identical to baseline", async () => {
    const facts = [
      fact({
        factId: "fact_grounding_disabled",
        taskId: "task_grounding_disabled",
      }),
    ];
    const input = {
      taskId: "task_grounding_disabled",
      tokenBudget: 128,
    };
    const baseline = await createRuntimeMemoryContextProvider({
      facts,
      config: enabledConfig,
    }).getContext(input);
    const disabled = await createRuntimeMemoryContextProvider({
      facts,
      config: enabledConfig,
      groundingDiagnostics: {
        enabled: false,
        refs: [buildGroundingRefFixture({ id: "runtime_memory_grounding_disabled" })],
      },
    }).getContext(input);

    expectProviderResult(baseline);
    expectProviderResult(disabled);
    expect(disabled).toEqual(baseline);
    expect(JSON.stringify(disabled)).not.toContain("groundingDiagnostics");
  });

  it("emits explicit grounding diagnostics metadata without memory context cutover", async () => {
    const facts = [
      fact({
        factId: "fact_grounding_enabled",
        taskId: "task_grounding_enabled",
        subject: "RuntimeMemoryProvider",
        predicate: "keeps",
        objectSummary: "Accepted memory summaries remain unchanged.",
      }),
    ];
    const input = {
      taskId: "task_grounding_enabled",
      tokenBudget: 128,
      metadata: { subject: "RuntimeMemoryProvider" },
    };
    const baseline = await createRuntimeMemoryContextProvider({
      facts,
      config: enabledConfig,
    }).getContext(input);
    const trusted = buildGroundingRefFixture({
      id: "runtime_memory_grounding_trusted",
      canonicalKey: "memory:fact_grounding_enabled",
      kind: "memory",
      ref: "fact_grounding_enabled",
      label: "Runtime memory fact anchor",
      summary: `Runtime Memory grounding diagnostics summary ${"x".repeat(120)}`,
      metadata: {
        safe: "kept",
        memoryRefsAreAnchorsOnly: true,
        sourceRefsAreEvidenceLinksOnly: true,
        noDurableFactAuthority: true,
        noMemoryFactPromotionAuthority: true,
        noFactAcceptanceAuthority: true,
        noEpisodeWriteAuthority: true,
        noMemoryPersistenceAuthority: true,
        noPromptAuthority: true,
        noProviderOrderingAuthority: true,
      },
    });
    const untrusted = buildGroundingRefFixture({
      id: "runtime_memory_grounding_untrusted",
      canonicalKey: "trace:runtime_memory_grounding_untrusted",
      ref: "trace:runtime_memory_grounding_untrusted",
      trust: "untrusted",
      metadata: {
        rawTrace: RAW_GROUNDING_SENTINEL,
      } as never,
    });
    const result = await createRuntimeMemoryContextProvider({
      facts,
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
      providerId: RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
      status: "ok",
      reason: "registered",
      metadata: expect.objectContaining({
        runtimeMemoryGroundingDiagnostics: true,
        diagnosticsOnly: true,
        metadataOnly: true,
        noContextItemAuthority: true,
        noProviderResultAuthority: true,
        noPromptAuthority: true,
        noProviderOrderingAuthority: true,
        noDurableFactAuthority: true,
        noMemoryFactPromotionAuthority: true,
        noFactAcceptanceAuthority: true,
        noEpisodeWriteAuthority: true,
        noMemoryPersistenceAuthority: true,
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
          memoryRefsAreAnchorsOnly: true,
          noDurableFactAuthority: true,
          noMemoryFactPromotionAuthority: true,
          noFactAcceptanceAuthority: true,
          noEpisodeWriteAuthority: true,
          noMemoryPersistenceAuthority: true,
          noPromptAuthority: true,
          noProviderOrderingAuthority: true,
          sourceRefsAreEvidenceLinksOnly: true,
        }),
      }),
    ]);
    expect(result.metadata).toEqual(expect.objectContaining({
      groundingDiagnostics: expect.objectContaining({
        runtimeMemoryGroundingDiagnostics: true,
        itemCount: 1,
        authority: "none",
        rawRetained: false,
        noDurableFactAuthority: true,
        noMemoryFactPromotionAuthority: true,
        noFactAcceptanceAuthority: true,
        noEpisodeWriteAuthority: true,
        noMemoryPersistenceAuthority: true,
        noPromptAuthority: true,
        noProviderOrderingAuthority: true,
      }),
    }));
    expect(JSON.stringify(result)).not.toContain(RAW_GROUNDING_SENTINEL);
    expect(JSON.stringify(result)).not.toContain("rawTrace");
    expect(JSON.stringify(result)).not.toContain("apiKey");
  });

  it("ranks verified current facts with task, file, symbol, and evidence matches first", async () => {
    const facts = [
      fact({
        factId: "fact_other",
        taskId: "task_other",
        objectSummary: "A verified but unrelated memory summary.",
        valid_at: 40,
        reference_time: 40,
      }),
      fact({
        factId: "fact_focus",
        taskId: "task_focus",
        subject: "RuntimeMemoryProvider",
        predicate: "uses",
        objectSummary: "A verified current fact linked to the focused code path.",
        valid_at: 20,
        reference_time: 20,
        evidenceRefs: [
          { type: "file", ref: "src/focus.ts", summary: "focusSymbol behavior" },
        ],
        metadata: {
          file: "src/focus.ts",
          symbol: "focusSymbol",
          sourceBody: "SOURCE_BODY_DO_NOT_LEAK",
        },
      }),
      fact({
        factId: "fact_sibling",
        taskId: "task_focus",
        objectSummary: "A verified sibling fact for the same task.",
        valid_at: 30,
        reference_time: 30,
      }),
    ];
    const provider = createRuntimeMemoryContextProvider({ facts, config: enabledConfig });

    const result = await provider.getContext({
      taskId: "task_focus",
      tokenBudget: 256,
      activeFiles: ["src/focus.ts"],
      metadata: {
        symbol: "focusSymbol",
        evidenceRef: "src/focus.ts",
      },
    });

    expectProviderResult(result);
    expect(result.status).toBe("success");
    expect(result.contextItems.every(isContextItem)).toBe(true);
    expect(result.contextItems.map((item) => item.metadata?.factId)[0]).toBe("fact_focus");
    expect(result.contextItems[0]).toMatchObject({
      kind: "memory",
      source: "runtime-memory:fact_focus",
      priority: "P1",
      metadata: expect.objectContaining({
        readonlyMemoryContext: true,
        noMemoryDump: true,
        noCompletionAuthority: true,
        noVerifierAuthority: true,
        noSecurityAuthority: true,
        noRetryAuthority: true,
        noToolAuthority: true,
        noRuntimeAuthority: true,
      }),
    });
    expect(result.contextItems[0]?.text).toContain("valid_at=20");
    expect(result.contextItems[0]?.text).toContain("reference_time=20");
    expect(JSON.stringify(result)).not.toContain("SOURCE_BODY_DO_NOT_LEAK");
  });

  it("labels historical facts with their time fields", async () => {
    const facts = [
      fact({
        factId: "fact_old",
        subject: "Preference",
        predicate: "uses",
        objectSummary: "Mode A.",
        valid_at: 10,
        invalid_at: 30,
        reference_time: 10,
        acceptedAt: 11,
      }),
      fact({
        factId: "fact_current",
        subject: "Preference",
        predicate: "uses",
        objectSummary: "Mode B.",
        valid_at: 30,
        reference_time: 30,
        acceptedAt: 31,
      }),
    ];
    const provider = createRuntimeMemoryContextProvider({ facts, config: enabledConfig });

    const result = await provider.getContext({
      tokenBudget: 128,
      metadata: {
        memoryQuery: {
          subject: "Preference",
          reference_time: 20,
        },
      },
    });

    expectProviderResult(result);
    expect(result.contextItems.map((item) => item.metadata?.factId)).toEqual(["fact_old"]);
    expect(result.contextItems[0]?.text).toContain("time_scope=historical");
    expect(result.contextItems[0]?.text).toContain("valid_at=10");
    expect(result.contextItems[0]?.text).toContain("invalid_at=30");
    expect(result.contextItems[0]?.text).toContain("reference_time=10");
  });

  it("includes candidate facts only when the caller explicitly requests them", async () => {
    const facts = [
      fact({
        factId: "fact_verified",
        subject: "RuntimeMemoryProvider",
        predicate: "returns",
        objectSummary: "Accepted memory summaries.",
      }),
      candidate({
        factId: "candidate_unverified",
        subject: "RuntimeMemoryProvider",
        predicate: "returns",
        objectSummary: "Candidate memory summary.",
      }),
    ];
    const provider = createRuntimeMemoryContextProvider({ facts, config: enabledConfig });

    const defaultResult = await provider.getContext({
      metadata: { subject: "RuntimeMemoryProvider" },
    });
    const requestedResult = await provider.getContext({
      metadata: {
        subject: "RuntimeMemoryProvider",
        includeCandidates: true,
      },
    });

    expectProviderResult(defaultResult);
    expectProviderResult(requestedResult);
    expect(defaultResult.contextItems.map((item) => item.metadata?.factId)).toEqual([
      "fact_verified",
    ]);
    expect(requestedResult.contextItems.map((item) => item.metadata?.factId)).toEqual([
      "fact_verified",
      "candidate_unverified",
    ]);
    expect(requestedResult.metadata).toMatchObject({
      candidateFactsRequested: true,
    });
  });

  it("returns budgeted readonly provider summaries without source bodies", async () => {
    const providerResult = await createRuntimeMemoryProviderResult({
      facts: [
        fact({
          factId: "fact_budget",
          subject: "RuntimeMemoryProvider",
          predicate: "returns",
          objectSummary: "Readonly budgeted memory context items for focused runtime work.",
          metadata: {
            sourceBody: "SOURCE_BODY_DO_NOT_LEAK",
          },
        }),
      ],
      config: enabledConfig,
    }, {
      tokenBudget: 6,
      metadata: {
        config: enabledConfig,
        subject: "RuntimeMemoryProvider",
      },
    });

    expect(isRuntimeMemoryContextProviderResult(providerResult)).toBe(true);
    expect(providerResult.readonly).toBe(true);
    expect(providerResult.summary.readonly).toBe(true);
    expect(providerResult.summary.estimatedTokens)
      .toBeLessThanOrEqual(providerResult.summary.tokenBudget);
    expect(providerResult.contextItems).toHaveLength(1);
    expect(providerResult.contextItems[0]?.text.length).toBeLessThanOrEqual(24);
    expect(JSON.stringify(providerResult)).not.toContain("SOURCE_BODY_DO_NOT_LEAK");
  });

  it("uses the readonly query callback without exposing runtime authority", async () => {
    const provider = createRuntimeMemoryContextProvider({
      config: enabledConfig,
      queryFacts: (query) => [
        fact({
          factId: `fact_for_${query.taskId}`,
          taskId: query.taskId,
          objectSummary: "Callback supplied a bounded fact summary.",
        }),
      ],
    });

    const result = await provider.getContext({ taskId: "task_callback" });

    expectProviderResult(result);
    expect(result.contextItems).toHaveLength(1);
    expect(result.contextItems[0]?.metadata).toMatchObject({
      factId: "fact_for_task_callback",
      noRuntimeAuthority: true,
      noToolAuthority: true,
    });
  });
});

function expectProviderResult(
  value: RuntimeContextProviderResult | RuntimeContextProviderResult["contextItems"],
): asserts value is RuntimeContextProviderResult {
  expect(Array.isArray(value)).toBe(false);
  expect(isRuntimeContextProviderResult(value)).toBe(true);
}

function fact(
  overrides: Partial<Extract<RuntimeMemoryQueryableFact, { acceptedAt: number }>> = {},
): Extract<RuntimeMemoryQueryableFact, { acceptedAt: number }> {
  return buildRuntimeMemoryTemporalFactFixture({
    sourceEpisodeRefs: [
      {
        episodeId: "episode_memory",
        taskId: overrides.taskId ?? "task_memory",
        kind: "verifier_summary",
        idempotencyKey: "task_memory:verifier:summary",
        reference_time: overrides.reference_time ?? 10,
      },
    ],
    evidenceRefs: [{ type: "test", ref: "tests/unit/runtime-memory-context-provider.test.ts" }],
    ...overrides,
  });
}

function candidate(
  overrides: Partial<RuntimeMemoryQueryableFact> = {},
): RuntimeMemoryQueryableFact {
  return buildRuntimeMemoryTemporalFactCandidateFixture({
    sourceEpisodeRefs: [
      {
        episodeId: "episode_candidate",
        taskId: "task_memory",
        kind: "verifier_summary",
        idempotencyKey: "task_memory:verifier:candidate",
        reference_time: 10,
      },
    ],
    evidenceRefs: [{ type: "test", ref: "tests/unit/runtime-memory-context-provider.test.ts" }],
    ...overrides,
  });
}
