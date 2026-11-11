import { describe, expect, it } from "vitest";
import {
  createTestContextProviderRegistry,
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
} from "./helpers/context-provider-registry";
import {
  createRuntimeMemoryContextProvider,
  RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
} from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import {
  buildGroundingRefFixture,
  buildRuntimeMemoryTemporalFactFixture,
  isRuntimeContextProviderManifest,
  isRuntimeContextProviderResult,
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

  it("keeps the retired memory provider on the fallback path", async () => {
    // TF-0500 retired runtime.memory.provider; the provider cannot reach the
    // success path, so the five cases that asserted ranking, grounding metadata,
    // historical labels, candidate inclusion and readonly-query authority are
    // replaced by this retirement boundary.
    const provider = createRuntimeMemoryContextProvider({
      config: { runtime: { memory: { provider: true, persist: true } } },
    });
    const result = await provider.getContext(
      { taskId: "task_retired", tokenBudget: 512, activeFiles: [] },
      {},
    );
    expectProviderResult(result);
    expect(result.status).toBe("fallback");
    expect(result.contextItems ?? []).toHaveLength(0);
  });

  it("still reports a disabled provider without exposing runtime authority", async () => {
    const provider = createRuntimeMemoryContextProvider({ config: {} });
    const result = await provider.getContext(
      { taskId: "task_disabled", tokenBudget: 512, activeFiles: [] },
      {},
    );
    expectProviderResult(result);
    expect(result.status).not.toBe("success");
    expect(result.contextItems ?? []).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("\"noRuntimeAuthority\":false");
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
