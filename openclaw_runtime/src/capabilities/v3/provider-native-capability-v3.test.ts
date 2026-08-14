import { describe, expect, it, vi } from "vitest";
import type { AgentToolUpdateCallback } from "../../agents/runtime/index.js";
import {
  buildToolSearchCapabilityBridge,
} from "../../agents/tool-search-capability-v3.js";
import {
  createToolSearchCatalogRef,
  registerToolSearchCatalog,
  ToolSearchRuntime,
  type ToolSearchCatalogEntry,
  type ToolSearchConfig,
} from "../../agents/tool-search.js";
import {
  CapabilityProviderNativeAdapter,
  CapabilityProviderNativeOwnerError,
  type CapabilityProviderDeferredOwner,
  type CapabilityProviderNativeOwner,
  type CapabilityProviderNativePolicy,
} from "./provider-native-capability-v3.js";
import {
  CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION,
  CAPABILITY_PROVIDER_NATIVE_REQUEST_SCHEMA_VERSION,
  type CapabilityProviderNativeResponse,
} from "./provider-native-protocol-v3.js";
import { CapabilityResultPointerService } from "./result-pointer.js";
import { buildCapabilityShadowCatalog } from "./shadow-catalog.js";
import { CapabilityToolExecutionService } from "./tool-execution-v3.js";
import { TrustedCapabilityCatalog } from "./trusted-catalog.js";
import { CapabilityUnifiedResolver } from "./unified-resolver.js";

const target = {
  providerId: "provider-test",
  modelId: "model-test",
  workflowNamespace: "engineering.discovery",
} as const;

const toolSearchConfig: ToolSearchConfig = {
  enabled: true,
  mode: "code",
  codeTimeoutMs: 10_000,
  searchDefaultLimit: 8,
  maxSearchLimit: 20,
};

const basePolicy: CapabilityProviderNativePolicy = {
  timeoutMs: 100,
  maxAttempts: 2,
  maxRememberedRequests: 16,
  backoff: { initialMs: 10, maxMs: 100, factor: 2, jitter: 0 },
  circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 1_000, halfOpenMaxCalls: 1 },
};

function deterministicRandomBytes() {
  let sequence = 1;
  return (size: number) => {
    const bytes = new Uint8Array(size);
    bytes.fill(sequence++);
    return bytes;
  };
}

function createPointerService(enabled = true) {
  return new CapabilityResultPointerService({
    enabled,
    budget: {
      maxActivePointers: 16,
      maxSummaryCharacters: 256,
      maxTtlMs: 10_000,
      maxReadCharacters: 1_000,
      maxSliceCharacters: 1_000,
      maxSearchScanCharacters: 1_000,
      maxSearchOutputCharacters: 1_000,
      maxSearchMatches: 8,
      maxQueryCharacters: 128,
    },
    archiveOwner: {
      create: async (input) => ({
        uri: `context-archive://${input.sessionId}/provider-native.context-archive.json`,
        checksum: `sha256:${"b".repeat(64)}` as never,
        byteLength: 64,
        source: input.source,
      }),
      verify: async () => ({ ok: true, payload: "archived" }),
    },
    now: () => 1_000,
  });
}

function createExecutionFixture() {
  const toolExecute = vi.fn(
    async (
      _toolCallId: string,
      input: unknown,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback,
    ) => ({
      content: [{ type: "text" as const, text: `secret:${JSON.stringify(input)}` }],
      details: { secret: "do-not-return", input, signal, onUpdate },
    }),
  );
  const entry: ToolSearchCatalogEntry = {
    id: "openclaw:workspace-read",
    source: "openclaw",
    name: "workspace_read",
    label: "Workspace Read",
    description: "Read one workspace file.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    tool: {
      name: "workspace_read",
      label: "Workspace Read",
      description: "Read one workspace file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      execute: toolExecute,
    },
  };
  const catalogRef = createToolSearchCatalogRef();
  registerToolSearchCatalog({ catalogRef, entries: [entry] });
  const catalogExecutor = vi.fn(
    async (params: Parameters<NonNullable<ConstructorParameters<typeof ToolSearchRuntime>[0]["executeTool"]>>[0]) =>
      await params.tool.execute(
        params.toolCallId,
        params.input,
        params.signal,
        params.onUpdate,
        undefined as never,
      ),
  );
  const runtime = new ToolSearchRuntime({ catalogRef, executeTool: catalogExecutor }, toolSearchConfig);
  const bridge = buildToolSearchCapabilityBridge({
    enabled: true,
    runtime,
    classify: () => ({
      capabilityId: "tool:runtime:workspace-read",
      category: "engineering",
      workflowNamespace: "engineering.discovery",
      source: { owner: "runtime", type: "core", provenance: "provider-native-test" },
      permissions: ["workspace.read"],
    }),
  });
  if (bridge.enabled !== true || !("fallback" in bridge)) {
    throw new Error("expected Tool Search bridge");
  }
  const trustedCatalog = TrustedCapabilityCatalog.coldStart(bridge.registrations, {
    maxActiveLeases: 16,
    maxLeaseTtlMs: 5_000,
    randomBytes: deterministicRandomBytes(),
    now: () => 1_000,
  });
  const resolver = new CapabilityUnifiedResolver({
    enabled: true,
    catalog: buildCapabilityShadowCatalog(bridge.descriptors),
    toolFallback: bridge.fallback,
    trustedCatalog,
  });
  const execution = new CapabilityToolExecutionService({
    resolver,
    trustedCatalog,
    resultPointers: createPointerService(),
    sessionId: "provider-session",
    taskId: "provider-task",
    grantedPermissions: ["workspace.read"],
    leaseTtlMs: 1_000,
    resultPointerTtlMs: 1_000,
  });
  return { resolver, execution, runtime, toolExecute, catalogExecutor };
}

function makeAdapter(params: {
  enabled?: boolean;
  allowlist?: readonly typeof target[];
  nativeOwner: CapabilityProviderNativeOwner;
  proxyOwner?: CapabilityProviderDeferredOwner;
  policy?: CapabilityProviderNativePolicy;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): { adapter: CapabilityProviderNativeAdapter; fixture: ReturnType<typeof createExecutionFixture> } {
  const fixture = createExecutionFixture();
  return {
    fixture,
    adapter: new CapabilityProviderNativeAdapter({
      enabled: params.enabled ?? true,
      target,
      allowlist: params.allowlist ?? [target],
      resolver: fixture.resolver,
      execution: fixture.execution,
      nativeOwner: params.nativeOwner,
      ...(params.proxyOwner ? { proxyOwner: params.proxyOwner } : {}),
      policy: params.policy ?? basePolicy,
      ...(params.sleep ? { sleep: params.sleep } : {}),
    }),
  };
}

function response(value: string): CapabilityProviderNativeResponse {
  return JSON.parse(value) as CapabilityProviderNativeResponse;
}

describe("Capability Registry V3 provider-native adapter", () => {
  it("is inert while disabled", async () => {
    const probe = vi.fn();
    const run = vi.fn();
    const { adapter } = makeAdapter({
      enabled: false,
      nativeOwner: { probe, run } as never,
      proxyOwner: { run: vi.fn() },
    });

    const result = await adapter.run({ query: "workspace", requestId: "disabled-1" });

    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "provider-native-disabled", effectState: "not_started" }),
    });
    expect(probe).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("uses proxy when the target is not allowlisted or the probe misses", async () => {
    const allowlistProbe = vi.fn(async () => ({ supported: true }));
    const allowlistNativeRun = vi.fn();
    const allowlistProxyRun = vi.fn(async () => ({ topology: "proxy" }));
    const allowlist = makeAdapter({
      nativeOwner: { probe: allowlistProbe, run: allowlistNativeRun },
      allowlist: [],
      proxyOwner: { run: allowlistProxyRun },
    }).adapter;
    await expect(allowlist.run({ query: "workspace", requestId: "allowlist-1" })).resolves.toEqual(
      expect.objectContaining({ ok: true, topology: "proxy", fallbackReason: "native-not-allowlisted" }),
    );
    expect(allowlistProbe).not.toHaveBeenCalled();
    expect(allowlistNativeRun).not.toHaveBeenCalled();
    expect(allowlistProxyRun).toHaveBeenCalledTimes(1);

    const probeMiss = vi.fn(async () => ({ supported: false }));
    const probeNativeRun = vi.fn();
    const probeProxyRun = vi.fn(async () => ({ topology: "proxy" }));
    const probeAdapter = makeAdapter({
      nativeOwner: { probe: probeMiss, run: probeNativeRun },
      proxyOwner: { run: probeProxyRun },
    }).adapter;
    await expect(probeAdapter.run({ query: "workspace", requestId: "probe-1" })).resolves.toEqual(
      expect.objectContaining({ ok: true, topology: "proxy", fallbackReason: "native-unsupported" }),
    );
    expect(probeNativeRun).not.toHaveBeenCalled();
    expect(probeProxyRun).toHaveBeenCalledTimes(1);

    const malformedNativeRun = vi.fn();
    const malformedProxyRun = vi.fn(async () => ({ topology: "proxy" }));
    const malformedInputAdapter = makeAdapter({
      nativeOwner: { probe: vi.fn(), run: malformedNativeRun } as never,
      proxyOwner: { run: malformedProxyRun },
    }).adapter;
    for (const input of [null, undefined, 42, "request"] as unknown[]) {
      await expect(malformedInputAdapter.run(input as never)).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          failure: expect.objectContaining({ code: "invalid-request", effectState: "not_started" }),
        }),
      );
    }
    await expect(malformedInputAdapter.run({ query: "workspace", requestId: 123 } as never)).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        failure: expect.objectContaining({ code: "invalid-request", effectState: "not_started" }),
      }),
    );
    expect(malformedNativeRun).not.toHaveBeenCalled();

    for (const [index, probe] of ([null, undefined, 1, {}, { supported: "yes" }] as unknown[]).entries()) {
      const adapter = makeAdapter({
        nativeOwner: { probe: async () => probe, run: malformedNativeRun } as never,
        proxyOwner: { run: malformedProxyRun },
      }).adapter;
      await expect(adapter.run({ query: "workspace", requestId: `probe-malformed-${index}` })).resolves.toEqual(
        expect.objectContaining({ ok: true, topology: "proxy", fallbackReason: "native-probe-failed" }),
      );
    }
    expect(malformedNativeRun).not.toHaveBeenCalled();
  });

  it("serializes descriptor-only navigation and routes native events through resolver, lease, and pointer", async () => {
    const updates = vi.fn();
    const nativeRun = vi.fn(async ({ request, handleEvent }: Parameters<CapabilityProviderNativeOwner["run"]>[0]) => {
      const parsed = JSON.parse(request) as {
        schemaVersion: string;
        navigation: Array<Record<string, unknown>>;
      };
      expect(parsed.schemaVersion).toBe(CAPABILITY_PROVIDER_NATIVE_REQUEST_SCHEMA_VERSION);
      expect(parsed.navigation).toHaveLength(1);
      expect(JSON.stringify(parsed)).not.toContain("execute");
      expect(JSON.stringify(parsed)).not.toContain("do-not-return");
      const searched = response(
        await handleEvent({
          schemaVersion: CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION,
          requestId: "event-search",
          type: "search",
          query: "workspace",
          limit: 1,
        }),
      );
      const described = response(
        await handleEvent({
          schemaVersion: CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION,
          requestId: "event-describe",
          type: "describe",
          capabilityId: "tool:runtime:workspace-read",
        }),
      );
      const called = response(
        await handleEvent({
          schemaVersion: CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION,
          requestId: "event-call",
          type: "call",
          capabilityId: "tool:runtime:workspace-read",
          input: { path: "secret.md" },
          toolCallId: "native-call",
        }),
      );
      const replayed = response(
        await handleEvent({
          schemaVersion: CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION,
          requestId: "event-call",
          type: "call",
          capabilityId: "tool:runtime:workspace-read",
          input: { path: "secret.md" },
          toolCallId: "native-call",
        }),
      );
      return { searched, described, called, replayed };
    });
    const { adapter, fixture } = makeAdapter({
      nativeOwner: { probe: async () => ({ supported: true }), run: nativeRun },
    });

    const result = await adapter.run({
      query: "workspace",
      requestId: "native-1",
      onUpdate: updates,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, topology: "native", attempts: 1 }));
    if (!result.ok) {
      throw new Error(result.failure.message);
    }
    const value = result.value as {
      searched: CapabilityProviderNativeResponse;
      described: CapabilityProviderNativeResponse;
      called: CapabilityProviderNativeResponse;
      replayed: CapabilityProviderNativeResponse;
    };
    expect(value.searched).toEqual(expect.objectContaining({ ok: true, requestId: "event-search" }));
    expect(value.described).toEqual(expect.objectContaining({ ok: true, requestId: "event-describe" }));
    expect(value.called).toEqual(expect.objectContaining({ ok: true, requestId: "event-call" }));
    expect(value.replayed).toEqual(value.called);
    expect(JSON.stringify(result)).not.toContain("secret.md");
    expect(fixture.toolExecute).toHaveBeenCalledTimes(1);
    expect(fixture.toolExecute).toHaveBeenCalledWith(
      expect.any(String),
      { path: "secret.md" },
      expect.any(AbortSignal),
      updates,
      undefined,
    );
  });

  it("fails closed when the parent aborts while resolver discovery is pending", async () => {
    const nativeRun = vi.fn(async () => ({ native: true }));
    const proxyRun = vi.fn(async () => ({ proxy: true }));
    const { adapter, fixture } = makeAdapter({
      nativeOwner: { probe: async () => ({ supported: true }), run: nativeRun },
      proxyOwner: { run: proxyRun },
    });
    let release!: () => void;
    const discoveryPending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalDiscover = fixture.resolver.discover.bind(fixture.resolver);
    const discover = vi.spyOn(fixture.resolver, "discover").mockImplementation(async (params) => {
      await discoveryPending;
      return await originalDiscover(params);
    });
    const controller = new AbortController();
    const run = adapter.run({ query: "workspace", requestId: "abort-discover-1", signal: controller.signal });

    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(1));
    controller.abort(new Error("cancelled during discovery"));
    release();

    await expect(run).resolves.toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "native-aborted", effectState: "not_started" }),
    });
    expect(nativeRun).not.toHaveBeenCalled();
    expect(proxyRun).not.toHaveBeenCalled();
  });

  it("projects owner responses and rejects raw target results, credentials, and complex values", async () => {
    const nativeRun = vi.fn(async () => ({
      rawTargetResult: "do-not-leak",
      credentials: { token: "secret-token" },
      complex: { nested: [{ value: "sensitive" }] },
    }));
    const proxyRun = vi.fn(async () => ({ proxy: true }));
    const { adapter } = makeAdapter({
      nativeOwner: { probe: async () => ({ supported: true }), run: nativeRun },
      proxyOwner: { run: proxyRun },
    });

    const result = await adapter.run({ query: "workspace", requestId: "projection-1" });

    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "provider-native-failed", effectState: "unknown" }),
    });
    expect(JSON.stringify(result)).not.toContain("do-not-leak");
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(JSON.stringify(result)).not.toContain("sensitive");
    expect(proxyRun).not.toHaveBeenCalled();

    const mismatchedRequest = makeAdapter({
      nativeOwner: {
        probe: async () => ({ supported: true }),
        run: async () => ({
          schemaVersion: "capability-provider-native-response/v1",
          requestId: "other-request",
          ok: false,
          failure: { code: "rejected", effectState: "not_started" },
        }),
      },
    }).adapter;
    await expect(mismatchedRequest.run({ query: "workspace", requestId: "request-a" })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        failure: expect.objectContaining({ code: "provider-native-failed", effectState: "unknown" }),
      }),
    );

    const mismatchedCorrelation = makeAdapter({
      nativeOwner: {
        probe: async () => ({ supported: true }),
        run: async () => ({ topology: "native", correlationId: `sha256:${"0".repeat(64)}` }),
      },
    }).adapter;
    await expect(mismatchedCorrelation.run({ query: "workspace", requestId: "request-b" })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        failure: expect.objectContaining({ code: "provider-native-failed", effectState: "unknown" }),
      }),
    );

    const missingCorrelation = makeAdapter({
      nativeOwner: {
        probe: async () => ({ supported: true }),
        run: async () => ({
          schemaVersion: "capability-provider-native-response/v1",
          requestId: "request-c",
          ok: false,
          failure: { code: "rejected", effectState: "not_started" },
        }),
      },
    }).adapter;
    await expect(missingCorrelation.run({ query: "workspace", requestId: "request-c" })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        failure: expect.objectContaining({ code: "provider-native-failed", effectState: "unknown" }),
      }),
    );

    const invalidCorrelation = makeAdapter({
      nativeOwner: {
        probe: async () => ({ supported: true }),
        run: async () => ({ topology: "native", correlationId: "not-a-correlation-hash" }),
      },
    }).adapter;
    await expect(invalidCorrelation.run({ query: "workspace", requestId: "request-d" })).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        failure: expect.objectContaining({ code: "provider-native-failed", effectState: "unknown" }),
      }),
    );
  });

  it("retries explicitly retryable pre-start failures with bounded backoff", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new CapabilityProviderNativeOwnerError("http-503", true))
      .mockRejectedValueOnce(new CapabilityProviderNativeOwnerError("http-503", true))
      .mockResolvedValueOnce({ native: "ok" });
    const sleep = vi.fn(async () => undefined);
    const { adapter } = makeAdapter({
      nativeOwner: { probe: async () => ({ supported: true }), run },
      policy: { ...basePolicy, maxAttempts: 3 },
      sleep,
    });

    const controller = new AbortController();
    const result = await adapter.run({ query: "workspace", requestId: "retry-1", signal: controller.signal });

    expect(result).toEqual(expect.objectContaining({ ok: true, topology: "native", attempts: 3 }));
    expect(sleep).toHaveBeenNthCalledWith(1, 10, expect.any(AbortSignal));
    expect(sleep).toHaveBeenNthCalledWith(2, 20, expect.any(AbortSignal));
    expect(adapter.snapshot()).toEqual(expect.objectContaining({ retries: 2, nativeRuns: 1 }));
  });

  it("opens the circuit after repeated failures and routes subsequent requests to proxy", async () => {
    const nativeRun = vi.fn(async () => {
      throw new CapabilityProviderNativeOwnerError("http-500", false);
    });
    const proxyRun = vi.fn(async () => ({ proxy: true }));
    const policy = {
      ...basePolicy,
      maxAttempts: 1,
      circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 1_000, halfOpenMaxCalls: 1 },
    } satisfies CapabilityProviderNativePolicy;
    const probe = vi.fn(async () => ({ supported: true }));
    const { adapter } = makeAdapter({
      nativeOwner: { probe, run: nativeRun },
      proxyOwner: { run: proxyRun },
      policy,
    });

    await adapter.run({ query: "workspace", requestId: "breaker-1" });
    await adapter.run({ query: "workspace", requestId: "breaker-2" });
    const third = await adapter.run({ query: "workspace", requestId: "breaker-3" });

    expect(third).toEqual(expect.objectContaining({ ok: true, topology: "proxy", fallbackReason: "native-circuit-open" }));
    expect(nativeRun).toHaveBeenCalledTimes(2);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(proxyRun).toHaveBeenCalledTimes(3);
    expect(adapter.snapshot().circuitBreaker.state).toBe("open");
  });

  it("deduplicates replayed request ids and rejects conflicting payloads", async () => {
    let release!: () => void;
    const pending = new Promise((resolve) => {
      release = () => resolve({ native: true });
    });
    const run = vi.fn(async () => await pending);
    const { adapter } = makeAdapter({ nativeOwner: { probe: async () => ({ supported: true }), run } });

    const first = adapter.run({ query: "workspace", requestId: "replay-1" });
    const replay = adapter.run({ query: "workspace", requestId: "replay-1" });
    expect(replay).toBe(first);
    await expect(adapter.run({ query: "other", requestId: "replay-1" })).resolves.toEqual(
      expect.objectContaining({ ok: false, failure: expect.objectContaining({ code: "request-id-conflict" }) }),
    );
    release();
    await expect(first).resolves.toEqual(expect.objectContaining({ ok: true, topology: "native" }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never falls back after a completed or ambiguous native side effect", async () => {
    const proxyRun = vi.fn(async () => ({ proxy: true }));
    const nativeRun = vi.fn(async ({ handleEvent }: Parameters<CapabilityProviderNativeOwner["run"]>[0]) => {
      const eventResult = response(
        await handleEvent({
          schemaVersion: CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION,
          requestId: "effect-call",
          type: "call",
          capabilityId: "tool:runtime:workspace-read",
          input: { path: "effect.md" },
        }),
      );
      expect(eventResult.ok).toBe(true);
      throw new CapabilityProviderNativeOwnerError("connection-lost-after-call", true);
    });
    const { adapter, fixture } = makeAdapter({
      nativeOwner: { probe: async () => ({ supported: true }), run: nativeRun },
      proxyOwner: { run: proxyRun },
    });

    const result = await adapter.run({ query: "workspace", requestId: "effect-1" });

    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "native-side-effect-uncertain", effectState: "completed" }),
    });
    expect(proxyRun).not.toHaveBeenCalled();
    expect(fixture.toolExecute).toHaveBeenCalledTimes(1);
  });

  it("fails closed on malformed events without invoking the execution owner", async () => {
    const nativeRun = vi.fn(async ({ handleEvent }: Parameters<CapabilityProviderNativeOwner["run"]>[0]) =>
      response(
        await handleEvent({
          schemaVersion: CAPABILITY_PROVIDER_NATIVE_EVENT_SCHEMA_VERSION,
          requestId: "malformed-1",
          type: "call",
          capabilityId: "../../not-a-capability",
          input: { secret: "payload" },
        }),
      ),
    );
    const { adapter, fixture } = makeAdapter({
      nativeOwner: { probe: async () => ({ supported: true }), run: nativeRun },
    });

    const result = await adapter.run({ query: "workspace", requestId: "malformed-run" });

    expect(result).toEqual(expect.objectContaining({ ok: true, topology: "native" }));
    if (!result.ok) {
      throw new Error(result.failure.message);
    }
    expect(result.value).toEqual(
      expect.objectContaining({ ok: false, requestId: "malformed-1", failure: { code: "invalid-event", effectState: "not_started" } }),
    );
    expect(JSON.stringify(result)).not.toContain("payload");
    expect(fixture.toolExecute).not.toHaveBeenCalled();
  });

  it("treats an owner timeout as ambiguous and does not replay through proxy", async () => {
    const proxyRun = vi.fn(async () => ({ proxy: true }));
    const nativeRun = vi.fn(async () => await new Promise<never>(() => undefined));
    const { adapter } = makeAdapter({
      nativeOwner: { probe: async () => ({ supported: true }), run: nativeRun },
      proxyOwner: { run: proxyRun },
      policy: { ...basePolicy, timeoutMs: 5, maxAttempts: 1 },
    });

    const result = await adapter.run({ query: "workspace", requestId: "timeout-1" });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        failure: expect.objectContaining({ code: "native-side-effect-uncertain", effectState: "unknown" }),
      }),
    );
    expect(proxyRun).not.toHaveBeenCalled();
  });
});
