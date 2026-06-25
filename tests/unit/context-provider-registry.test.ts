import { describe, expect, it } from "vitest";
import {
  buildLoopContextPack,
  formatLoopContextPackForPrompt,
} from "../../openclaw_runtime/src/agents/loop-context-pack";
import {
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
  createContextProviderRegistryPilot,
  createLegacyContextEngineProvider,
  createLoopContextPackProvider,
  runContextProviderRegistryPilot,
} from "../../openclaw_runtime/src/context-engine/provider-registry";
import {
  isContextItem,
  isRuntimeContextProviderManifest,
  isRuntimeContextProviderResult,
  isRuntimeRegistryDiagnostic,
} from "../../openclaw_runtime/src/runtime-core";

const enabledConfig = {
  runtime: {
    registryPilot: { enabled: true },
    providerRegistry: { shadow: true },
    contextProviders: { registryPilot: true },
  },
};

describe("context provider registry pilot", () => {
  it("keeps registry providers explicit and validates compatibility manifests", () => {
    const registry = createContextProviderRegistryPilot();
    const legacy = registry.resolve(LEGACY_CONTEXT_ENGINE_PROVIDER_ID);
    const loop = registry.resolve(LOOP_CONTEXT_PACK_PROVIDER_ID);

    expect(registry.listManifests().map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
    expect(legacy).toBeTruthy();
    expect(loop).toBeTruthy();
    expect(isRuntimeContextProviderManifest(legacy?.manifest)).toBe(true);
    expect(isRuntimeContextProviderManifest(loop?.manifest)).toBe(true);
    expect(registry.listByCapability("context.legacy").map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
    ]);
    expect(registry.listByCapability("context.loop-pack").map((manifest) => manifest.id)).toEqual([
      LOOP_CONTEXT_PACK_PROVIDER_ID,
    ]);
  });

  it("returns flag-disabled diagnostics without changing legacy messages or prompt text", async () => {
    const messages = [
      { role: "user", content: "Keep legacy message identity." },
      { role: "assistant", content: "I will not reorder messages." },
    ] as never;
    const loopContextInput = {
      systemAppRules: ["System rule"],
      projectRules: ["Project rule"],
      initialConstraints: ["Initial constraint"],
    };
    const baselinePack = buildLoopContextPack(loopContextInput);
    const baselinePrompt = formatLoopContextPackForPrompt(baselinePack);

    const result = await runContextProviderRegistryPilot({
      config: {},
      legacyMessages: messages,
      loopContextInput,
      sessionId: "session-flag-off",
    });

    expect(result.enabled).toBe(false);
    expect(result.contextItems).toEqual([]);
    expect(result.providerResults).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        surface: "context",
        status: "skipped",
        reason: "flag_disabled",
        metadata: expect.objectContaining({ legacyAuthoritative: true }),
      }),
    ]);
    expect(result.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
    expect(messages[0]).toMatchObject({ content: "Keep legacy message identity." });
    expect(messages[1]).toMatchObject({ content: "I will not reorder messages." });
    expect(formatLoopContextPackForPrompt(buildLoopContextPack(loopContextInput))).toBe(
      baselinePrompt,
    );
  });

  it("emits shadow context items and diagnostics without changing prompt text or message order", async () => {
    const messages = [
      { role: "user", content: "Implement registry shadow only." },
      { role: "assistant", content: "Legacy messages stay authoritative." },
    ] as never;
    const loopContextInput = {
      systemAppRules: ["System rule"],
      projectRules: ["Project rule"],
      relevantKnowledge: ["knowledge ".repeat(120)],
      budget: {
        totalTokens: 35,
        sectionTokens: { relevantKnowledge: 5 },
      },
    };
    const baselinePrompt = formatLoopContextPackForPrompt(buildLoopContextPack(loopContextInput));

    const result = await runContextProviderRegistryPilot({
      config: enabledConfig,
      legacyMessages: messages,
      loopContextInput,
      sessionId: "session-shadow",
    });

    expect(result.enabled).toBe(true);
    expect(result.providerResults.map((providerResult) => providerResult.metadata?.providerId))
      .toEqual([LEGACY_CONTEXT_ENGINE_PROVIDER_ID, LOOP_CONTEXT_PACK_PROVIDER_ID]);
    expect(result.contextItems.length).toBeGreaterThan(0);
    expect(result.contextItems.every(isContextItem)).toBe(true);
    expect(result.contextItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "legacy_context_engine:message:1",
        text: "Implement registry shadow only.",
      }),
      expect.objectContaining({
        id: "loop_context_pack:systemAppRules:systemAppRules:1",
        source: "system_app_rules",
      }),
    ]));
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
        reason: "legacy_authoritative",
        metadata: expect.objectContaining({
          messagesIdentityPreserved: true,
          messageOrderPreserved: true,
        }),
      }),
      expect.objectContaining({
        providerId: LOOP_CONTEXT_PACK_PROVIDER_ID,
        reason: "legacy_authoritative",
        metadata: expect.objectContaining({
          promptTextUnchanged: true,
          packHashUnchanged: true,
        }),
      }),
    ]));
    expect(result.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
    expect(messages.map((message) => message.content)).toEqual([
      "Implement registry shadow only.",
      "Legacy messages stay authoritative.",
    ]);
    expect(formatLoopContextPackForPrompt(buildLoopContextPack(loopContextInput))).toBe(
      baselinePrompt,
    );
  });

  it("wraps LegacyContextEngine and LoopContextPack as standalone compatibility providers", async () => {
    const legacyProvider = createLegacyContextEngineProvider();
    const loopProvider = createLoopContextPackProvider();

    const legacyResult = await legacyProvider.getContext({
      taskId: "session-provider",
      metadata: {
        messages: [{ role: "user", content: "Provider messages become ContextItems." }] as never,
      },
    });
    const loopResult = await loopProvider.getContext({
      taskId: "session-provider",
      metadata: {
        loopContextInput: {
          userInterventions: ["User changed scope."],
          taskLedgerState: ["Old plan."],
        } as never,
      },
    });

    expect(isRuntimeContextProviderResult(legacyResult)).toBe(true);
    expect(isRuntimeContextProviderResult(loopResult)).toBe(true);
    if (!Array.isArray(legacyResult) && !Array.isArray(loopResult)) {
      expect(legacyResult.contextItems[0]).toMatchObject({
        id: "legacy_context_engine:message:1",
        kind: "message",
      });
      expect(loopResult.contextItems).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "instruction",
          text: "User changed scope.",
          metadata: expect.objectContaining({ sourceKind: "userInterventions" }),
        }),
      ]));
      expect(legacyResult.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
      expect(loopResult.diagnostics.every(isRuntimeRegistryDiagnostic)).toBe(true);
    }
  });
});
