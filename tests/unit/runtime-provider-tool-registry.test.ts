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
  collectRuntimeRegistryDiagnosticsForControlledConsumer,
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
  sanitizeRuntimeRegistryDiagnostic,
  validateRuntimeContextProviderManifest,
  validateRuntimeToolProviderManifest,
  type RuntimeRegistryDiagnostic,
  type RuntimeRegistryDiagnosticReason,
  type RuntimeRegistryDiagnosticStatus,
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

  it("keeps default collector order while opt-in prioritization preserves high-value diagnostics", () => {
    const lowRegistered = registryDiagnostic("tool", "tool-registered", "ok", "registered");
    const lowLegacy = registryDiagnostic("context", "context-legacy", "fallback", "legacy_authoritative");
    const runtimeUnavailable = registryDiagnostic(
      "tool",
      "tool-runtime-unavailable",
      "error",
      "runtime_unavailable",
    );
    const policyDenied = registryDiagnostic("tool", "tool-policy-denied", "denied", "policy_denied");
    const diagnostics = [lowRegistered, lowLegacy, runtimeUnavailable, policyDenied];

    const defaultCollected = collectRuntimeRegistryDiagnostics({
      enabled: true,
      limit: 2,
      diagnostics,
    });

    expect(defaultCollected.diagnostics.map((diagnostic) => diagnostic.providerId)).toEqual([
      "tool-registered",
      "context-legacy",
    ]);
    expect(defaultCollected.omittedSummary).toMatchObject({
      diagnosticCount: 2,
      contextDiagnosticCount: 0,
      toolDiagnosticCount: 2,
      byStatus: { error: 1, denied: 1 },
      byReason: { runtime_unavailable: 1, policy_denied: 1 },
    });

    const prioritized = collectRuntimeRegistryDiagnostics({
      enabled: true,
      prioritize: true,
      limit: 2,
      diagnostics,
    });

    expect(prioritized.diagnostics.map((diagnostic) => diagnostic.providerId)).toEqual([
      "tool-runtime-unavailable",
      "tool-policy-denied",
    ]);
    expect(prioritized.omittedSummary).toMatchObject({
      diagnosticCount: 2,
      contextDiagnosticCount: 1,
      toolDiagnosticCount: 1,
      byStatus: { ok: 1, fallback: 1 },
      byReason: { registered: 1, legacy_authoritative: 1 },
    });
  });

  it("projects registry diagnostics into sanitized diagnostics-only payloads", () => {
    const apiKey = ["sk", "proj", "registrysanitizer1234567890abcdef"].join("-");
    const bearer = `Bearer ${["registry", "sanitizer", "token", "1234567890abcdef"].join("_")}`;
    const rawDiagnostic: RuntimeRegistryDiagnostic = {
      surface: "tool",
      providerId: apiKey,
      status: "error",
      reason: "provider_error",
      message: `Provider returned ${apiKey}.`,
      retryable: true,
      evidenceRefs: [{
        type: "tool",
        ref: `tool:${apiKey}`,
        label: `Leaky ${apiKey}`,
        summary: "Adapter referenced C:\\Users\\alice\\.ssh\\id_rsa.",
        metadata: {
          authorization: bearer,
          env: `OPENAI_API_${"KEY"}=${apiKey}`,
        },
      }],
      metadata: {
        rawToolPayload: "RAW_TOOL_PAYLOAD_SECRET_REGISTRY_SANITIZER",
        authorization: bearer,
      },
    };

    const sanitized = sanitizeRuntimeRegistryDiagnostic(rawDiagnostic);
    const serialized = JSON.stringify(sanitized);

    expect(isRuntimeRegistryDiagnostic(sanitized)).toBe(true);
    expect(sanitized).toMatchObject({
      surface: "tool",
      providerId: "redacted-provider",
      status: "error",
      reason: "provider_error",
      retryable: true,
      metadata: {
        redactionStatus: "sanitized",
        source: "runtime_registry.diagnostic_projection",
        messageRedacted: true,
        metadataRedacted: true,
      },
    });
    expect(sanitized.message).toBeUndefined();
    expect(sanitized.evidenceRefs).toEqual([expect.objectContaining({
      type: "tool",
      ref: "runtime-registry-evidence:tool:redacted-provider:provider_error:0",
      label: "Runtime registry evidence",
      metadata: expect.objectContaining({ redactionStatus: "sanitized" }),
    })]);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(bearer);
    expect(serialized).not.toContain("RAW_TOOL_PAYLOAD_SECRET_REGISTRY_SANITIZER");
    expect(serialized).not.toContain("C:\\Users\\alice");
  });

  it("keeps controlled diagnostic consumer fail-closed and forces sanitized prioritized output", () => {
    const lowRegistered = registryDiagnostic("tool", "tool-registered", "ok", "registered");
    const runtimeUnavailable = registryDiagnostic(
      "tool",
      "tool-runtime-unavailable",
      "error",
      "runtime_unavailable",
    );
    const secret = ["sk", "proj", "controlledconsumer1234567890abcdef"].join("-");
    const leakyDiagnostic: RuntimeRegistryDiagnostic = {
      ...runtimeUnavailable,
      message: `runtime unavailable ${secret}`,
      metadata: { authorization: `Bearer ${["controlled", "consumer", "1234567890abcdef"].join("_")}` },
      evidenceRefs: [{
        type: "tool",
        ref: `leaky:${secret}`,
        summary: `C:\\Users\\alice\\.ssh\\id_rsa ${secret}`,
      }],
    };

    const missingFlags = collectRuntimeRegistryDiagnosticsForControlledConsumer({
      enabled: true,
      diagnostics: [leakyDiagnostic],
      metadata: { raw: secret },
    });

    expect(missingFlags).toMatchObject({
      enabled: false,
      diagnostics: [],
      omittedDiagnosticCount: 1,
      consumer: {
        enabled: false,
        gateStatus: "closed",
        blockedReasons: ["feature_flags_missing"],
        sanitized: true,
        prioritized: true,
        authoritativeness: "none",
      },
    });
    expect(JSON.stringify(missingFlags)).not.toContain(secret);

    const featureFlags = resolveRuntimeRegistryFeatureFlags({
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
    const opened = collectRuntimeRegistryDiagnosticsForControlledConsumer({
      enabled: true,
      featureFlags,
      limit: 1,
      diagnostics: [lowRegistered, leakyDiagnostic],
      metadata: { raw: secret },
    });

    expect(opened).toMatchObject({
      enabled: true,
      omittedDiagnosticCount: 1,
      consumer: {
        enabled: true,
        gateStatus: "open",
        blockedReasons: [],
        sanitized: true,
        prioritized: true,
        diagnosticsOnly: true,
        inMemoryOnly: true,
        authoritativeness: "none",
      },
    });
    expect(opened.diagnostics.map((diagnostic) => diagnostic.reason)).toEqual([
      "runtime_unavailable",
    ]);
    expect(opened.diagnostics[0]?.metadata).toMatchObject({
      redactionStatus: "sanitized",
      source: "runtime_registry.diagnostic_projection",
      messageRedacted: true,
      metadataRedacted: true,
    });
    expect(JSON.stringify(opened)).not.toContain(secret);
    expect(JSON.stringify(opened)).not.toContain("C:\\Users\\alice");
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

function registryDiagnostic(
  surface: RuntimeRegistryDiagnostic["surface"],
  providerId: string,
  status: RuntimeRegistryDiagnosticStatus,
  reason: RuntimeRegistryDiagnosticReason,
): RuntimeRegistryDiagnostic {
  return {
    surface,
    providerId,
    status,
    reason,
    message: `${providerId}:${reason}`,
    evidenceRefs: [{
      type: surface === "tool" ? "tool" : "other",
      ref: `registry-priority:${providerId}`,
    }],
  };
}
