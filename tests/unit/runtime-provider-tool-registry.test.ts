import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "../../openclaw_runtime/src/config/zod-schema";
import {
  DEFAULT_RUNTIME_REGISTRY_FEATURE_FLAGS,
  RuntimeContextProviderRegistry,
  ToolProviderRegistry,
  buildContextItemFixture,
  buildRuntimeContextProviderManifestFixture,
  buildRuntimeToolProviderManifestFixture,
  buildToolCallRequestFixture,
  buildToolCallResultFixture,
  collectRuntimeRegistryDiagnostics,
  isContextItem,
  isolateRuntimeRegistryError,
  isRuntimeContextProviderManifest,
  isRuntimeContextProviderResult,
  isRuntimeRegistryDiagnostic,
  isRuntimeProviderManifest,
  isRuntimeToolProviderManifest,
  isRuntimeToolProviderResult,
  resolveRuntimeRegistryFeatureFlags,
  runtimeRegistryFlagEnabled,
  validateRuntimeContextProviderManifest,
  validateRuntimeToolProviderManifest,
  type RuntimeContextProvider,
  type RuntimeToolProvider,
} from "../../openclaw_runtime/src/runtime-core";

const contextProvider = (id: string, priority: number): RuntimeContextProvider => ({
  manifest: buildRuntimeContextProviderManifestFixture({
    id,
    priority,
    order: priority,
    capabilities: ["context.legacy"],
  }),
  getContext: () => ({
    status: "success",
    contextItems: [
      buildContextItemFixture({
        id: `${id}:context`,
        source: id,
        kind: "message",
      }),
    ],
    diagnostics: [],
    evidenceRefs: [],
  }),
});

const toolProvider = (id: string, priority: number): RuntimeToolProvider => ({
  manifest: buildRuntimeToolProviderManifestFixture({
    id,
    priority,
    order: priority,
    capabilities: ["tool.mcp"],
    toolNames: ["mcp.callTool"],
  }),
  callTool: (request) => buildToolCallResultFixture({ callId: request.callId }),
});

describe("runtime provider/tool registry contracts and flags", () => {
  it("keeps Phase-3 registry flags disabled unless explicitly enabled", () => {
    expect(resolveRuntimeRegistryFeatureFlags(undefined)).toEqual(
      DEFAULT_RUNTIME_REGISTRY_FEATURE_FLAGS,
    );
    expect(runtimeRegistryFlagEnabled({}, "registryPilotEnabled")).toBe(false);
    expect(runtimeRegistryFlagEnabled({}, "providerRegistryShadow")).toBe(false);
    expect(runtimeRegistryFlagEnabled({}, "contextProviderRegistryPilot")).toBe(false);
    expect(runtimeRegistryFlagEnabled({}, "toolRegistryShadow")).toBe(false);
    expect(runtimeRegistryFlagEnabled({}, "registryDiagnosticsCollector")).toBe(false);

    const flags = resolveRuntimeRegistryFeatureFlags({
      config: {
        runtime: {
          registryPilot: { enabled: true },
          providerRegistry: { shadow: true },
          contextProviders: { registryPilot: true },
          toolRegistry: { shadow: true },
          registryDiagnostics: { collector: true },
        },
      },
    });

    expect(flags).toEqual({
      registryPilotEnabled: true,
      providerRegistryShadow: true,
      contextProviderRegistryPilot: true,
      toolRegistryShadow: true,
      registryDiagnosticsCollector: true,
    });
  });

  it("validates canonical context/tool provider manifests without duplicating core results", () => {
    const contextManifest = buildRuntimeContextProviderManifestFixture({
      id: "legacy-context",
      outputKinds: ["message", "summary"],
    });
    const toolManifest = buildRuntimeToolProviderManifestFixture({
      id: "mcp-compat",
      resultStatuses: ["success", "error", "denied", "cancelled"],
    });

    expect(isRuntimeContextProviderManifest(contextManifest)).toBe(true);
    expect(isRuntimeToolProviderManifest(toolManifest)).toBe(true);
    expect(isRuntimeProviderManifest(contextManifest)).toBe(true);
    expect(isRuntimeProviderManifest(toolManifest)).toBe(true);
    expect(validateRuntimeContextProviderManifest(contextManifest)).toEqual({
      ok: true,
      manifest: contextManifest,
    });
    expect(validateRuntimeToolProviderManifest(toolManifest)).toEqual({
      ok: true,
      manifest: toolManifest,
    });

    expect(validateRuntimeContextProviderManifest({ ...contextManifest, capabilities: [] }))
      .toMatchObject({
        ok: false,
        diagnostic: { surface: "context", reason: "manifest_invalid" },
      });
    expect(validateRuntimeToolProviderManifest({ ...toolManifest, resultStatuses: ["bad"] }))
      .toMatchObject({
        ok: false,
        diagnostic: { surface: "tool", reason: "manifest_invalid" },
      });
  });

  it("registers provider manifests deterministically and rejects duplicates safely", () => {
    const contextRegistry = new RuntimeContextProviderRegistry();
    const toolRegistry = new ToolProviderRegistry();

    expect(contextRegistry.size()).toBe(0);
    expect(toolRegistry.size()).toBe(0);
    expect(contextRegistry.register(contextProvider("context-b", 20))).toMatchObject({
      status: "registered",
    });
    expect(contextRegistry.register(contextProvider("context-a", 10))).toMatchObject({
      status: "registered",
    });
    expect(toolRegistry.register(toolProvider("tool-b", 20))).toMatchObject({
      status: "registered",
    });
    expect(toolRegistry.register(toolProvider("tool-a", 10))).toMatchObject({
      status: "registered",
    });

    expect(contextRegistry.listManifests().map((manifest) => manifest.id)).toEqual([
      "context-a",
      "context-b",
    ]);
    expect(toolRegistry.listManifests().map((manifest) => manifest.id)).toEqual([
      "tool-a",
      "tool-b",
    ]);
    expect(contextRegistry.listByCapability("context.legacy").map((manifest) => manifest.id))
      .toEqual(["context-a", "context-b"]);
    expect(toolRegistry.resolveByToolName("mcp.callTool")?.manifest.id).toBe("tool-a");

    expect(contextRegistry.register(contextProvider("context-a", 10))).toMatchObject({
      status: "duplicate",
      diagnostic: {
        surface: "context",
        providerId: "context-a",
        reason: "duplicate_provider",
        metadata: { legacyBehaviorUnaffected: true },
      },
    });
  });

  it("accepts strict runtime registry pilot config without making it default-on", () => {
    const parsed = OpenClawSchema.parse({
      runtime: {
        registryPilot: { enabled: true },
        providerRegistry: { shadow: true },
        contextProviders: { shadow: true, loopPackShadow: true, registryPilot: true },
        toolRegistry: { shadow: true },
        registryDiagnostics: { collector: true },
        toolProtocol: { mcpShadow: true },
      },
    });

    expect(parsed.runtime?.registryPilot?.enabled).toBe(true);
    expect(parsed.runtime?.registryDiagnostics?.collector).toBe(true);
    expect(OpenClawSchema.parse({}).runtime).toBeUndefined();
    expect(() =>
      OpenClawSchema.parse({ runtime: { toolRegistry: { shadow: true, enabled: true } } }),
    ).toThrow();
  });

  it("collects context and tool registry diagnostics into bounded shadow output only when enabled", () => {
    const contextDiagnostic = isolateRuntimeRegistryError({
      surface: "context",
      providerId: "context-provider",
      error: new Error("context boom"),
    }).diagnostic;
    const toolDiagnostic = isolateRuntimeRegistryError({
      surface: "tool",
      providerId: "tool-provider",
      error: new Error("tool boom"),
    }).diagnostic;

    const disabled = collectRuntimeRegistryDiagnostics({
      contextDiagnostics: [contextDiagnostic],
      toolDiagnostics: [toolDiagnostic],
    });

    expect(disabled).toMatchObject({
      enabled: false,
      diagnostics: [],
      omittedDiagnosticCount: 2,
      summary: {
        totalDiagnosticCount: 2,
        includedDiagnosticCount: 0,
        contextDiagnosticCount: 0,
        toolDiagnosticCount: 0,
      },
    });

    const enabled = collectRuntimeRegistryDiagnostics({
      enabled: true,
      limit: 1,
      contextDiagnostics: [contextDiagnostic],
      toolDiagnostics: [toolDiagnostic],
      metadata: { shadowOnly: true },
    });

    expect(enabled).toMatchObject({
      enabled: true,
      diagnostics: [expect.objectContaining({ surface: "context", providerId: "context-provider" })],
      omittedDiagnosticCount: 1,
      metadata: { shadowOnly: true },
      summary: {
        totalDiagnosticCount: 2,
        includedDiagnosticCount: 1,
        contextDiagnosticCount: 1,
        toolDiagnosticCount: 0,
        byStatus: { error: 1 },
        byReason: { provider_error: 1 },
      },
    });
    expect(enabled.evidenceRefs.length).toBeGreaterThan(0);
  });

  it("keeps provider errors isolated as diagnostics and typed RuntimeError evidence", () => {
    const isolated = isolateRuntimeRegistryError({
      surface: "tool",
      providerId: "mcp-compat",
      error: new Error("adapter failed"),
      reason: "provider_error",
      metadata: { legacyAuthoritative: true },
    });

    expect(isolated).toMatchObject({
      isolated: true,
      diagnostic: {
        surface: "tool",
        providerId: "mcp-compat",
        status: "error",
        reason: "provider_error",
        message: "adapter failed",
        metadata: { legacyAuthoritative: true },
      },
      error: { type: "tool", message: "adapter failed", retryable: false },
    });
    expect(isRuntimeRegistryDiagnostic(isolated.diagnostic)).toBe(true);
  });

  it("validates context arrays and normalized ToolCallResult as provider outputs", async () => {
    const request = buildToolCallRequestFixture({ callId: "call-1" });
    const contexts = await contextProvider("legacy-context", 0).getContext(
      { goal: "use old context" },
      { legacyAuthoritative: true, shadowOnly: true },
    );
    const result = await toolProvider("mcp-compat", 0).callTool(request);

    expect(isRuntimeContextProviderResult(contexts)).toBe(true);
    expect(contexts.contextItems.every(isContextItem)).toBe(true);
    expect(isRuntimeToolProviderResult(result)).toBe(true);
    expect(result).toMatchObject({ callId: "call-1", status: "success" });
  });
});
