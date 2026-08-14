import { describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS,
} from "./evaluation-baseline.js";
import { buildCapabilityShadowCatalog } from "./shadow-catalog.js";
import { TrustedCapabilityCatalog } from "./trusted-catalog.js";
import {
  CapabilityUnifiedResolver,
  type CapabilityResolverToolFallback,
} from "./unified-resolver.js";

function deterministicRandomBytes() {
  let sequence = 1;
  return (size: number) => {
    const bytes = new Uint8Array(size);
    bytes.fill(sequence++);
    return bytes;
  };
}

describe("Capability Registry V3 unified resolver", () => {
  it("is inert while disabled and does not inspect the catalog or delegates", async () => {
    const search = vi.fn();
    const resolver = new CapabilityUnifiedResolver({
      enabled: false,
      get catalog() {
        throw new Error("disabled resolver must not inspect catalog");
      },
      toolFallback: { search, describe: vi.fn() },
    } as never);

    expect(resolver.categories()).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "resolver-disabled" }),
    });
    expect(await resolver.discover({ query: "workspace" })).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "resolver-disabled" }),
    });
    expect(search).not.toHaveBeenCalled();
  });

  it("exposes categories, deterministic discovery, owner load, and bounded reflection", async () => {
    const catalog = buildCapabilityShadowCatalog(CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS);
    const resolver = new CapabilityUnifiedResolver({
      enabled: true,
      catalog,
      skillLoader: { load: async (descriptor) => `skill:${descriptor.capabilityId}` },
      contextLoader: { load: async (descriptor) => `context:${descriptor.capabilityId}` },
    });

    const categories = resolver.categories();
    expect(categories.ok).toBe(true);
    if (!categories.ok) {
      throw new Error(categories.failure.message);
    }
    expect(categories.value.map((entry) => entry.category)).toEqual([
      "engineering",
      "knowledge",
      "operations",
    ]);

    const discovered = await resolver.discover({ query: "release notes", kind: "skill", limit: 2 });
    expect(discovered.ok).toBe(true);
    if (!discovered.ok) {
      throw new Error(discovered.failure.message);
    }
    expect(discovered.value.capabilities[0]?.capabilityId).toBe("skill:fixture:release-notes");
    expect(discovered.value.fallbackUsed).toBe(false);
    expect(discovered.value.resolverHash).toMatch(/^sha256:/);

    const described = resolver.describe("skill:fixture:release-notes");
    expect(described).toEqual({
      ok: true,
      value: expect.objectContaining({ capabilityId: "skill:fixture:release-notes" }),
    });
    const loaded = await resolver.load("skill:fixture:release-notes");
    expect(loaded).toEqual({
      ok: true,
      value: expect.objectContaining({
        kind: "skill",
        content: "skill:skill:fixture:release-notes",
      }),
    });

    const reflected = resolver.reflect({
      capabilityId: "skill:fixture:release-notes",
      status: "success",
      summary: "Prepared verified release notes.",
    });
    expect(reflected).toEqual({
      ok: true,
      value: expect.objectContaining({
        capabilityId: "skill:fixture:release-notes",
        reflectionHash: expect.stringMatching(/^sha256:/),
      }),
    });
    expect(
      resolver.reflect({
        capabilityId: "skill:fixture:release-notes",
        status: "success",
        summary: "x".repeat(4_097),
      }),
    ).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "invalid-reflection" }),
    });
  });

  it("loads Tool L3 only when the owner schema hash still matches", async () => {
    const tool = CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS.find(
      (descriptor) => descriptor.capabilityId === "tool:fixture:workspace-read",
    )!;
    const describe = vi.fn<CapabilityResolverToolFallback["describe"]>(async () => ({
      capabilityId: tool.capabilityId,
      schema: { type: "object" },
      schemaHash: tool.schemaHash!,
    }));
    const fallback = {
      search: vi.fn(async () => []),
      describe,
    } satisfies CapabilityResolverToolFallback;
    const resolver = new CapabilityUnifiedResolver({
      enabled: true,
      catalog: buildCapabilityShadowCatalog([tool]),
      toolFallback: fallback,
    });

    expect(await resolver.load(tool.capabilityId)).toEqual({
      ok: true,
      value: expect.objectContaining({ kind: "tool", schemaHash: tool.schemaHash }),
    });
    describe.mockResolvedValueOnce({
      capabilityId: tool.capabilityId,
      schema: { type: "object", properties: { changed: { type: "boolean" } } },
      schemaHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    });
    expect(await resolver.load(tool.capabilityId)).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "schema-mismatch" }),
    });
  });

  it("requires a valid lease before delegating Tool execution", async () => {
    const tool = CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS.find(
      (descriptor) => descriptor.capabilityId === "tool:fixture:workspace-read",
    )!;
    const executor = vi.fn(async (input: unknown) => ({ input }));
    const trustedCatalog = TrustedCapabilityCatalog.coldStart(
      [{ descriptor: tool, executor }],
      {
        maxActiveLeases: 4,
        maxLeaseTtlMs: 10_000,
        randomBytes: deterministicRandomBytes(),
      },
    );
    const issued = trustedCatalog.issueLease({
      sessionId: "session-a",
      capabilityId: tool.capabilityId,
      ttlMs: 1_000,
      grantedPermissions: [],
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) {
      throw new Error(issued.failure.message);
    }
    const resolver = new CapabilityUnifiedResolver({
      enabled: true,
      catalog: buildCapabilityShadowCatalog([tool]),
      trustedCatalog,
    });

    const forged = await resolver.execute({
      capabilityId: tool.capabilityId,
      lease: { issuedId: `caplease_${"A".repeat(43)}` },
      sessionId: "session-a",
      input: {},
    });
    expect(forged).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "lease-not-found" }),
    });
    expect(executor).not.toHaveBeenCalled();

    const executed = await resolver.execute({
      capabilityId: tool.capabilityId,
      lease: issued.handle,
      sessionId: "session-a",
      input: { path: "README.md" },
    });
    expect(executed).toEqual({
      ok: true,
      value: expect.objectContaining({ result: { input: { path: "README.md" } } }),
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });
});
