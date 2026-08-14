import { describe, expect, it, vi } from "vitest";
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
  mode: "tools",
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
  const toolExecute = vi.fn(async (_id: string, input: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(input) }],
    details: { input },
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
  return { runtime, entry, toolExecute, catalogExecutor };
}

function classify() {
  return {
    capabilityId: "tool:runtime:workspace-read",
    category: "engineering",
    workflowNamespace: "engineering.discovery",
    source: { owner: "runtime", type: "core", provenance: "tool-search-v3-test" },
    permissions: ["workspace.read"],
  } as const;
}

describe("Tool Search Capability V3 compatibility", () => {
  it("is inert when disabled and does not enumerate the Tool Search catalog", () => {
    const namespaceEntries = vi.fn(() => {
      throw new Error("flag-off must not enumerate Tool Search");
    });
    const result = buildToolSearchCapabilityBridge({
      enabled: false,
      runtime: { namespaceEntries } as never,
      classify,
    });

    expect(result).toEqual({ enabled: false, descriptors: [], registrations: [], diagnostics: [] });
    expect(namespaceEntries).not.toHaveBeenCalled();
  });

  it("maps Tool Search metadata without exposing schemas or executors in descriptors", async () => {
    const { runtime } = createRuntime();
    const search = vi.spyOn(runtime, "search");
    const describe = vi.spyOn(runtime, "describe");
    const bridge = buildToolSearchCapabilityBridge({ enabled: true, runtime, classify });

    expect(bridge.enabled).toBe(true);
    if (bridge.enabled !== true || !("fallback" in bridge)) {
      throw new Error("expected an enabled bridge");
    }
    expect(bridge.descriptors).toEqual([
      expect.objectContaining({
        capabilityId: "tool:runtime:workspace-read",
        schemaHash: expect.stringMatching(/^sha256:/),
        executionTopologies: ["proxy"],
      }),
    ]);
    expect(JSON.stringify(bridge.descriptors)).not.toContain("properties");
    expect(JSON.stringify(bridge.descriptors)).not.toContain("execute");

    expect(await bridge.fallback.search("workspace read", 1)).toEqual([
      expect.objectContaining({ capabilityId: "tool:runtime:workspace-read" }),
    ]);
    expect(search).toHaveBeenCalledWith("workspace read", { limit: 1 });
    expect(await bridge.fallback.describe("tool:runtime:workspace-read")).toEqual(
      expect.objectContaining({
        capabilityId: "tool:runtime:workspace-read",
        schema: expect.objectContaining({ type: "object" }),
        schemaHash: bridge.descriptors[0]?.schemaHash,
      }),
    );
    expect(describe).toHaveBeenCalledWith("openclaw:workspace-read");
  });

  it("executes through a V3 lease and ToolSearchRuntime.callExactId", async () => {
    const { runtime, toolExecute, catalogExecutor } = createRuntime();
    const callExactId = vi.spyOn(runtime, "callExactId");
    const bridge = buildToolSearchCapabilityBridge({ enabled: true, runtime, classify });
    if (bridge.enabled !== true || !("fallback" in bridge)) {
      throw new Error("expected an enabled bridge");
    }
    const catalog = buildCapabilityShadowCatalog(bridge.descriptors);
    const trustedCatalog = TrustedCapabilityCatalog.coldStart(bridge.registrations, {
      maxActiveLeases: 4,
      maxLeaseTtlMs: 10_000,
      randomBytes: deterministicRandomBytes(),
    });
    const issued = trustedCatalog.issueLease({
      sessionId: "session-a",
      capabilityId: "tool:runtime:workspace-read",
      ttlMs: 1_000,
      grantedPermissions: ["workspace.read"],
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) {
      throw new Error(issued.failure.message);
    }
    const resolver = new CapabilityUnifiedResolver({
      enabled: true,
      catalog,
      toolFallback: bridge.fallback,
      trustedCatalog,
    });

    expect(await resolver.load("tool:runtime:workspace-read")).toEqual({
      ok: true,
      value: expect.objectContaining({ kind: "tool" }),
    });
    const executed = await resolver.execute({
      capabilityId: "tool:runtime:workspace-read",
      lease: issued.handle,
      sessionId: "session-a",
      input: { path: "README.md" },
      toolCallId: "parent-call",
    });

    expect(executed.ok).toBe(true);
    expect(callExactId).toHaveBeenCalledWith(
      "openclaw:workspace-read",
      { path: "README.md" },
      expect.objectContaining({ parentToolCallId: "parent-call" }),
    );
    expect(catalogExecutor).toHaveBeenCalledTimes(1);
    expect(toolExecute).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale schema and an invalid lease before the target tool runs", async () => {
    const { runtime, entry, toolExecute } = createRuntime();
    const bridge = buildToolSearchCapabilityBridge({ enabled: true, runtime, classify });
    if (bridge.enabled !== true || !("fallback" in bridge)) {
      throw new Error("expected an enabled bridge");
    }
    entry.parameters = { type: "object", properties: { changed: { type: "boolean" } } };
    const trustedCatalog = TrustedCapabilityCatalog.coldStart(bridge.registrations, {
      maxActiveLeases: 4,
      maxLeaseTtlMs: 10_000,
      randomBytes: deterministicRandomBytes(),
    });
    const resolver = new CapabilityUnifiedResolver({
      enabled: true,
      catalog: buildCapabilityShadowCatalog(bridge.descriptors),
      toolFallback: bridge.fallback,
      trustedCatalog,
    });

    expect(await resolver.load("tool:runtime:workspace-read")).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "schema-mismatch" }),
    });
    expect(
      await resolver.execute({
        capabilityId: "tool:runtime:workspace-read",
        lease: { issuedId: `caplease_${"A".repeat(43)}` },
        sessionId: "session-a",
        input: {},
      }),
    ).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "lease-not-found" }),
    });
    expect(toolExecute).not.toHaveBeenCalled();
  });
});
