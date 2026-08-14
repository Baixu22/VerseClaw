import { describe, expect, it, vi } from "vitest";
import {
  CapabilityCodeModeAdapter,
} from "../capabilities/v3/code-mode-capability-v3.js";
import { CapabilityResultPointerService } from "../capabilities/v3/result-pointer.js";
import { buildCapabilityShadowCatalog } from "../capabilities/v3/shadow-catalog.js";
import { TrustedCapabilityCatalog } from "../capabilities/v3/trusted-catalog.js";
import { CapabilityUnifiedResolver } from "../capabilities/v3/unified-resolver.js";
import {
  createToolSearchCatalogRef,
  registerToolSearchCatalog,
  ToolSearchRuntime,
  type ToolSearchCatalogEntry,
  type ToolSearchConfig,
} from "./tool-search.js";
import { buildToolSearchCapabilityBridge } from "./tool-search-capability-v3.js";

const config: ToolSearchConfig = {
  enabled: true,
  mode: "code",
  codeTimeoutMs: 10_000,
  searchDefaultLimit: 8,
  maxSearchLimit: 20,
};

function deterministicRandomBytes() {
  let sequence = 1;
  return (size: number) => {
    const bytes = new Uint8Array(size);
    bytes.fill(sequence++);
    return bytes;
  };
}

function createRuntime() {
  const toolExecute = vi.fn(async (_id: string, input: unknown, signal?: AbortSignal, onUpdate?: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(input) }],
    details: { input, signal, onUpdate },
  }));
  const catalogExecutor = vi.fn(async (params: Parameters<NonNullable<ConstructorParameters<typeof ToolSearchRuntime>[0]["executeTool"]>>[0]) =>
    await params.tool.execute(params.toolCallId, params.input, params.signal, params.onUpdate, undefined as never),
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
  const runtime = new ToolSearchRuntime({ catalogRef, executeTool: catalogExecutor }, config);
  return { runtime, toolExecute, catalogExecutor };
}

function classify() {
  return {
    capabilityId: "tool:runtime:workspace-read",
    category: "engineering",
    workflowNamespace: "engineering.discovery",
    source: { owner: "runtime", type: "core", provenance: "tool-search-code-mode-v3-test" },
    permissions: ["workspace.read"],
  } as const;
}

function createPointerService(enabled = true) {
  return new CapabilityResultPointerService({
    enabled,
    budget: {
      maxActivePointers: 8,
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
        uri: `context-archive://${input.sessionId}/code-mode.context-archive.json`,
        checksum: `sha256:${"a".repeat(64)}` as never,
        byteLength: 64,
        source: input.source,
      }),
      verify: async () => ({ ok: true, payload: "archived" }),
    },
    now: () => 1_000,
  });
}

function createAdapter(params: {
  grantedPermissions?: readonly string[];
  pointerEnabled?: boolean;
  toolSearchConfig?: ToolSearchConfig;
} = {}) {
  const { runtime, toolExecute, catalogExecutor } = createRuntime();
  const bridge = buildToolSearchCapabilityBridge({ enabled: true, runtime, classify });
  if (bridge.enabled !== true || !("fallback" in bridge)) {
    throw new Error("expected Tool Search capability bridge");
  }
  const trustedCatalog = TrustedCapabilityCatalog.coldStart(bridge.registrations, {
    maxActiveLeases: 8,
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
  const adapter = new CapabilityCodeModeAdapter({
    enabled: true,
    resolver,
    trustedCatalog,
    resultPointers: createPointerService(params.pointerEnabled),
    sessionId: "session-a",
    taskId: "task-a",
    grantedPermissions: params.grantedPermissions ?? ["workspace.read"],
    leaseTtlMs: 1_000,
    resultPointerTtlMs: 1_000,
    toolSearchConfig: params.toolSearchConfig ?? config,
  });
  return { adapter, runtime, toolExecute, catalogExecutor, trustedCatalog };
}

describe("Tool Search Capability V3 Code Mode", () => {
  it("is inert while disabled and does not invoke its runner or dependencies", async () => {
    const runner = vi.fn();
    const adapter = new CapabilityCodeModeAdapter({
      enabled: false,
      get resolver() {
        throw new Error("disabled Code Mode must not inspect resolver");
      },
      runner,
    } as never);

    expect(await adapter.run({ code: "return 1", toolCallId: "parent" })).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-disabled" }),
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it("routes search, describe, and idempotent call through lease, Tool Search, and Result Pointer", async () => {
    const { adapter, runtime, toolExecute, catalogExecutor, trustedCatalog } = createAdapter();
    const callExactId = vi.spyOn(runtime, "callExactId");
    const revokeLease = vi.spyOn(trustedCatalog, "revokeLease");
    const controller = new AbortController();
    const onUpdate = vi.fn();
    const runner = vi.fn(async (params: Parameters<NonNullable<ConstructorParameters<typeof CapabilityCodeModeAdapter>[0]["runner"]>>[0]) => {
      expect(params.config).toBe(config);
      expect(params.signal).toBe(controller.signal);
      const search = await params.bridge.search("workspace", { limit: 1 });
      const described = await params.bridge.describe("tool:runtime:workspace-read");
      const first = await params.bridge.call(
        "tool:runtime:workspace-read",
        { path: "README.md" },
        { parentToolCallId: "parent", signal: controller.signal, onUpdate, requestId: "bridge-1" },
      );
      const replay = await params.bridge.call(
        "tool:runtime:workspace-read",
        { path: "README.md" },
        { parentToolCallId: "parent", signal: controller.signal, onUpdate, requestId: "bridge-1" },
      );
      return { value: { search, described, first, replay }, logs: ["code complete"] };
    });

    const result = await adapter.run({
      code: "return await openclaw.tools.search('workspace')",
      toolCallId: "parent",
      signal: controller.signal,
      onUpdate,
      runner,
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ logs: ["code complete"] }),
    });
    if (!result.ok) {
      throw new Error(result.failure.message);
    }
    const output = result.value.value as { search: Array<{ capabilityId: string }>; described: { schema: unknown }; first: { pointer: Record<string, unknown> }; replay: { pointer: Record<string, unknown> } };
    expect(output.search[0]).toEqual(expect.objectContaining({ capabilityId: "tool:runtime:workspace-read" }));
    expect(output.described).toEqual(expect.objectContaining({ schema: expect.objectContaining({ type: "object" }) }));
    expect(output.first).toEqual(expect.objectContaining({ pointer: expect.objectContaining({ pointerId: expect.stringMatching(/^resultptr_/) }) }));
    expect(output.replay).toEqual(output.first);
    // bridge.call hands the runner only Result Pointer metadata: no raw target
    // result, no details, no content, no credentials.
    expect(Object.keys(output.first).sort()).toEqual(["pointer"]);
    expect(Object.keys(output.first.pointer).sort()).toEqual([
      "archiveHandle",
      "capabilityId",
      "createdAt",
      "expiresAt",
      "pointerId",
      "requiredPermissions",
      "schemaVersion",
      "sessionId",
      "summary",
      "taskId",
    ]);
    expect(JSON.stringify(output)).not.toContain("README.md");
    expect(callExactId).toHaveBeenCalledTimes(1);
    expect(catalogExecutor).toHaveBeenCalledTimes(1);
    expect(toolExecute).toHaveBeenCalledTimes(1);
    expect(toolExecute).toHaveBeenCalledWith(expect.any(String), { path: "README.md" }, controller.signal, onUpdate, undefined);
    expect(revokeLease).toHaveBeenCalledTimes(1);
    expect(trustedCatalog.pruneLeases()).toBe(1);

    const rawRunner = vi.fn(async () => ({
      value: { rawTargetResult: "secret-target-output" },
      logs: [],
    }));
    const rawResult = await adapter.run({ code: "return 1", toolCallId: "raw-parent", runner: rawRunner });
    expect(rawResult).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(JSON.stringify(rawResult)).not.toContain("secret-target-output");
  });

  it("runs the V3 bridge through the existing Tool Search sandbox", async () => {
    const { adapter, toolExecute } = createAdapter();

    const result = await adapter.run({
      code: `
        const found = await openclaw.tools.search("workspace", { limit: 1 });
        const loaded = await openclaw.tools.describe(found[0].capabilityId);
        const called = await openclaw.tools.call(found[0].capabilityId, { path: "sandbox.md" });
        // The closed runner boundary accepts whole-value compositions only:
        // extracting loaded.schemaHash into a new object would be unprovable.
        return { found, loaded, called };
      `,
      toolCallId: "sandbox-parent",
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    if (!result.ok) {
      throw new Error(result.failure.message);
    }
    expect(result.value.value).toEqual(
      expect.objectContaining({
        found: [expect.objectContaining({ capabilityId: "tool:runtime:workspace-read" })],
        loaded: expect.objectContaining({ schemaHash: expect.stringMatching(/^sha256:/) }),
        called: { pointer: expect.objectContaining({ pointerId: expect.stringMatching(/^resultptr_/) }) },
      }),
    );
    expect(JSON.stringify(result)).not.toContain("sandbox.md");
    expect(toolExecute).toHaveBeenCalledTimes(1);
  });

  it("aborts the existing sandbox without invoking a target tool", async () => {
    const { adapter, toolExecute } = createAdapter();
    const controller = new AbortController();
    const run = adapter.run({
      code: "return await new Promise(() => undefined);",
      toolCallId: "abort-parent",
      signal: controller.signal,
    });
    controller.abort(new Error("test abort"));

    await expect(run).resolves.toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(toolExecute).not.toHaveBeenCalled();
  });

  it("enforces the existing parent timeout without invoking a target tool", async () => {
    const { adapter, toolExecute } = createAdapter({
      toolSearchConfig: { ...config, codeTimeoutMs: 50 },
    });

    await expect(
      adapter.run({
        code: "return await new Promise(() => undefined);",
        toolCallId: "timeout-parent",
      }),
    ).resolves.toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(toolExecute).not.toHaveBeenCalled();
  });

  it("fails closed before target execution when policy does not grant the required permission", async () => {
    const { adapter, toolExecute, trustedCatalog } = createAdapter({ grantedPermissions: [] });
    const issueLease = vi.spyOn(trustedCatalog, "issueLease");
    const revokeLease = vi.spyOn(trustedCatalog, "revokeLease");
    const runner = async (params: Parameters<NonNullable<ConstructorParameters<typeof CapabilityCodeModeAdapter>[0]["runner"]>>[0]) => ({
      value: await params.bridge.call("tool:runtime:workspace-read", { path: "README.md" }),
      logs: [],
    });

    expect(await adapter.run({ code: "return 1", toolCallId: "parent", runner })).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(toolExecute).not.toHaveBeenCalled();
    expect(issueLease).toHaveBeenCalledTimes(1);
    expect(revokeLease).not.toHaveBeenCalled();
  });

  it("fails closed when a Result Pointer cannot be created and never returns raw target output", async () => {
    const { adapter, toolExecute, trustedCatalog } = createAdapter({ pointerEnabled: false });
    const revokeLease = vi.spyOn(trustedCatalog, "revokeLease");
    const runner = async (params: Parameters<NonNullable<ConstructorParameters<typeof CapabilityCodeModeAdapter>[0]["runner"]>>[0]) => ({
      value: await params.bridge.call("tool:runtime:workspace-read", { path: "secret.md" }),
      logs: [],
    });

    const result = await adapter.run({ code: "return 1", toolCallId: "parent", runner });
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(JSON.stringify(result)).not.toContain("secret.md");
    expect(toolExecute).toHaveBeenCalledTimes(1);
    expect(revokeLease).toHaveBeenCalledTimes(1);
    expect(trustedCatalog.pruneLeases()).toBe(1);
  });

  it("fails closed when an injected runner never calls the bridge", async () => {
    const { adapter, toolExecute } = createAdapter();
    const runner = vi.fn(async () => ({ value: { computed: "IN-SANDBOX-VALUE" }, logs: [] }));

    const result = await adapter.run({ code: "return 1", toolCallId: "no-bridge-parent", runner });
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(JSON.stringify(result)).not.toContain("IN-SANDBOX-VALUE");
    expect(toolExecute).not.toHaveBeenCalled();
  });

  it("fails closed when a runner returns a primitive after calling bridge.search", async () => {
    const { adapter } = createAdapter();
    const runner = vi.fn(async (params: Parameters<NonNullable<ConstructorParameters<typeof CapabilityCodeModeAdapter>[0]["runner"]>>[0]) => {
      await params.bridge.search("workspace", { limit: 1 });
      return { value: "LEAK-PRIMITIVE", logs: [] };
    });

    const result = await adapter.run({ code: "return 1", toolCallId: "primitive-parent", runner });
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(JSON.stringify(result)).not.toContain("LEAK-PRIMITIVE");
  });

  it("fails closed when a runner returns an unprovenanced plain object after bridge.search", async () => {
    const { adapter } = createAdapter();
    const runner = vi.fn(async (params: Parameters<NonNullable<ConstructorParameters<typeof CapabilityCodeModeAdapter>[0]["runner"]>>[0]) => {
      await params.bridge.search("workspace", { limit: 1 });
      return { value: { fabricated: "LEAK-OBJECT" }, logs: [] };
    });

    const result = await adapter.run({ code: "return 1", toolCallId: "object-parent", runner });
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(JSON.stringify(result)).not.toContain("LEAK-OBJECT");
  });

  it("fails closed when a runner tries to return a raw target result after bridge.call", async () => {
    const { adapter, toolExecute } = createAdapter();
    const runner = vi.fn(async (params: Parameters<NonNullable<ConstructorParameters<typeof CapabilityCodeModeAdapter>[0]["runner"]>>[0]) => {
      await params.bridge.call("tool:runtime:workspace-read", { path: "secret-target.txt" });
      return {
        value: {
          content: [{ type: "text", text: "RAW-TARGET-OUTPUT" }],
          details: { path: "secret-target.txt" },
        },
        logs: [],
      };
    });

    const result = await adapter.run({ code: "return 1", toolCallId: "raw-call-parent", runner });
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(JSON.stringify(result)).not.toContain("RAW-TARGET-OUTPUT");
    expect(JSON.stringify(result)).not.toContain("secret-target.txt");
    // The bridge call itself executed exactly once; only its Result Pointer
    // metadata ever becomes provable output.
    expect(toolExecute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["raw", { raw: { value: "LEAK-SMUGGLED" } }],
    ["rawResult", { rawResult: { value: "LEAK-SMUGGLED" } }],
    ["rawTargetResult", { rawTargetResult: { value: "LEAK-SMUGGLED" } }],
    ["content", { content: [{ type: "text", text: "LEAK-SMUGGLED" }] }],
    ["details", { details: { secret: "LEAK-SMUGGLED" } }],
    ["credentials", { credentials: { token: "LEAK-SMUGGLED" } }],
    ["tool+result", { tool: "workspace_read", result: { text: "LEAK-SMUGGLED" } }],
    ["nested rawTargetResult", { wrapper: { rawTargetResult: "LEAK-SMUGGLED" } }],
  ])("fails closed when a runner smuggles a %s shape after bridge.search", async (_label, smuggled) => {
    const { adapter } = createAdapter();
    const runner = vi.fn(async (params: Parameters<NonNullable<ConstructorParameters<typeof CapabilityCodeModeAdapter>[0]["runner"]>>[0]) => {
      await params.bridge.search("workspace", { limit: 1 });
      return { value: smuggled, logs: [] };
    });

    const result = await adapter.run({ code: "return 1", toolCallId: "smuggle-parent", runner });
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(JSON.stringify(result)).not.toContain("LEAK-SMUGGLED");
  });

  it("fails closed when a runner reuses a known search string to fabricate an object", async () => {
    const { adapter } = createAdapter();
    const runner = vi.fn(async (params: Parameters<NonNullable<ConstructorParameters<typeof CapabilityCodeModeAdapter>[0]["runner"]>>[0]) => {
      const search = await params.bridge.search("workspace", { limit: 1 });
      const knownString = (search as Array<{ category: string }>)[0].category;
      return { value: { fabricated: knownString }, logs: [] };
    });

    const result = await adapter.run({ code: "return 1", toolCallId: "search-string-parent", runner });
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(JSON.stringify(result)).not.toContain("engineering");
  });

  it("fails closed when a runner reuses a known describe schema string to fabricate an object", async () => {
    const { adapter } = createAdapter();
    const runner = vi.fn(async (params: Parameters<NonNullable<ConstructorParameters<typeof CapabilityCodeModeAdapter>[0]["runner"]>>[0]) => {
      const described = await params.bridge.describe("tool:runtime:workspace-read");
      const knownString = (described as { schema: { type: string } }).schema.type;
      return { value: { fabricated: knownString }, logs: [] };
    });

    const result = await adapter.run({ code: "return 1", toolCallId: "describe-string-parent", runner });
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(JSON.stringify(result)).not.toContain("object");
  });

  it("fails closed when a runner reuses a known pointer string to fabricate an object", async () => {
    const { adapter, toolExecute } = createAdapter();
    const runner = vi.fn(async (params: Parameters<NonNullable<ConstructorParameters<typeof CapabilityCodeModeAdapter>[0]["runner"]>>[0]) => {
      const called = await params.bridge.call("tool:runtime:workspace-read", { path: "pointer-secret.txt" });
      const knownString = (called as { pointer: { pointerId: string } }).pointer.pointerId;
      return { value: { fabricated: knownString }, logs: [] };
    });

    const result = await adapter.run({ code: "return 1", toolCallId: "pointer-string-parent", runner });
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(JSON.stringify(result)).not.toContain("resultptr_");
    expect(JSON.stringify(result)).not.toContain("pointer-secret.txt");
    // The bridge call itself executed exactly once; its pointer metadata
    // never leaks into the controlled failure.
    expect(toolExecute).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a runner rebuilds a plain object from known search fields", async () => {
    const { adapter } = createAdapter();
    const runner = vi.fn(async (params: Parameters<NonNullable<ConstructorParameters<typeof CapabilityCodeModeAdapter>[0]["runner"]>>[0]) => {
      const search = await params.bridge.search("workspace", { limit: 1 });
      const entry = (search as Array<{ capabilityId: string; category: string }>)[0];
      return {
        value: { fabricated: { capabilityId: entry.capabilityId, category: entry.category } },
        logs: [],
      };
    });

    const result = await adapter.run({ code: "return 1", toolCallId: "rebuilt-object-parent", runner });
    expect(result).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "code-mode-failed" }),
    });
    expect(JSON.stringify(result)).not.toContain("tool:runtime:workspace-read");
    expect(JSON.stringify(result)).not.toContain("engineering");
  });
});
