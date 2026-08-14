import { describe, expect, it, vi } from "vitest";
import { adaptSkillCapability, adaptToolCapability } from "./adapters.js";
import { hashCapabilityMetadata, type CapabilityDescriptor } from "./capability-descriptor.js";
import {
  CapabilityLeaseVerificationError,
  TrustedCapabilityCatalog,
  TrustedCapabilityCatalogBuildError,
  type CapabilityLeaseVerificationRequest,
  type TrustedCapabilityExecutor,
} from "./trusted-catalog.js";

const source = { owner: "runtime", type: "core", provenance: "trusted-catalog-test" };

function toolDescriptor(overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  const descriptor = adaptToolCapability({
    name: "workspace-read",
    description: "Read one workspace file through the existing runtime.",
    category: "engineering",
    workflowNamespace: "engineering.discovery",
    source,
    schemaHash: hashCapabilityMetadata({ type: "object", properties: { path: { type: "string" } } }),
    permissions: ["workspace.read"],
  }).descriptor!;
  return { ...descriptor, ...overrides };
}

function deterministicRandomBytes() {
  let sequence = 1;
  return (size: number) => {
    const bytes = new Uint8Array(size);
    bytes.fill(sequence % 255);
    sequence += 1;
    return bytes;
  };
}

function createCatalog(params: {
  now?: () => number;
  executor?: TrustedCapabilityExecutor;
  descriptor?: CapabilityDescriptor;
  maxActiveLeases?: number;
} = {}) {
  const executor = params.executor ?? vi.fn(async (input: unknown) => ({ input }));
  return {
    executor,
    catalog: TrustedCapabilityCatalog.coldStart(
      [{ descriptor: params.descriptor ?? toolDescriptor(), executor }],
      {
        maxActiveLeases: params.maxActiveLeases ?? 4,
        maxLeaseTtlMs: 10_000,
        now: params.now,
        randomBytes: deterministicRandomBytes(),
      },
    ),
  };
}

function issue(catalog: TrustedCapabilityCatalog, ttlMs = 1_000) {
  const result = catalog.issueLease({
    sessionId: "session-a",
    capabilityId: "tool:runtime:workspace-read",
    ttlMs,
    grantedPermissions: ["workspace.read"],
  });
  if (!result.ok) {
    throw new Error(result.failure.message);
  }
  return result.handle;
}

function verification(
  handle: ReturnType<typeof issue>,
  overrides: Partial<CapabilityLeaseVerificationRequest> = {},
): CapabilityLeaseVerificationRequest {
  const descriptor = toolDescriptor();
  return {
    handle,
    sessionId: "session-a",
    capabilityId: descriptor.capabilityId,
    revision: descriptor.revision,
    manifestHash: descriptor.manifestHash,
    schemaHash: descriptor.schemaHash,
    requiredPermissions: ["workspace.read"],
    ...overrides,
  };
}

describe("Capability Registry V3 trusted catalog", () => {
  it("seals runtime executors behind a metadata-only snapshot", () => {
    const secretExecutor = vi.fn(async () => "executor-secret-sentinel");
    const { catalog } = createCatalog({ executor: secretExecutor });

    const snapshot = catalog.snapshot();
    expect(snapshot.bindingCount).toBe(1);
    expect(snapshot.registrations[0]?.descriptor.capabilityId).toBe("tool:runtime:workspace-read");
    expect(JSON.stringify(snapshot)).not.toContain("executor-secret-sentinel");
    expect(JSON.stringify(snapshot)).not.toContain("executorRegistrationId");
    expect(Object.keys(snapshot.registrations[0] ?? {})).toEqual(["descriptor"]);
    expect(snapshot.bindingFingerprint).toMatch(/^sha256:/);
  });

  it("rejects non-Tool, schema-less, duplicate, and non-function registrations atomically", () => {
    const skill = adaptSkillCapability({
      name: "release-notes",
      description: "Prepare release notes.",
      category: "engineering",
      workflowNamespace: "engineering.release",
      source,
    }).descriptor!;
    const executor = vi.fn();
    const options = {
      maxActiveLeases: 4,
      maxLeaseTtlMs: 10_000,
      randomBytes: deterministicRandomBytes(),
    };

    expect(() => TrustedCapabilityCatalog.coldStart([{ descriptor: skill, executor }], options)).toThrow(
      /not a Tool descriptor/,
    );
    expect(() =>
      TrustedCapabilityCatalog.coldStart(
        [{ descriptor: { ...toolDescriptor(), schemaHash: undefined }, executor }],
        options,
      ),
    ).toThrow(/must include schemaHash/);
    expect(() =>
      TrustedCapabilityCatalog.coldStart(
        [
          { descriptor: toolDescriptor(), executor },
          { descriptor: toolDescriptor(), executor },
        ],
        options,
      ),
    ).toThrow(/duplicate trusted capability id/);
    expect(() =>
      TrustedCapabilityCatalog.coldStart(
        [{ descriptor: toolDescriptor(), executor: undefined as never }],
        options,
      ),
    ).toThrow(TrustedCapabilityCatalogBuildError);
  });

  it("issues an opaque session lease and invokes only after complete verification", async () => {
    const executor = vi.fn(async (input: unknown, context: unknown) => ({ input, context }));
    const { catalog } = createCatalog({ executor });
    const handle = issue(catalog);

    expect(Object.keys(handle)).toEqual(["issuedId"]);
    expect(handle.issuedId).toMatch(/^caplease_[A-Za-z0-9_-]{43}$/);
    const verified = catalog.verifyLease(verification(handle));
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      throw new Error(verified.failure.message);
    }
    const output = await catalog.invokeLease({
      verification: verification(handle, {
        expectedExecutorRegistrationId: verified.executorRegistrationId,
      }),
      input: { path: "README.md" },
      context: { toolCallId: "call-1" },
    });

    expect(output).toEqual({
      input: { path: "README.md" },
      context: {
        sessionId: "session-a",
        capabilityId: "tool:runtime:workspace-read",
        toolCallId: "call-1",
      },
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["session-mismatch", { sessionId: "session-b" }],
    ["capability-mismatch", { capabilityId: "tool:runtime:workspace-write" }],
    ["revision-mismatch", { revision: "v2" }],
    ["manifest-hash-mismatch", { manifestHash: hashCapabilityMetadata("forged") }],
    ["schema-hash-mismatch", { schemaHash: hashCapabilityMetadata("forged-schema") }],
    ["permission-mismatch", { requiredPermissions: ["workspace.write"] }],
    ["registration-mismatch", { expectedExecutorRegistrationId: "capreg_forged" }],
  ] as const)("fails closed on %s", async (code, overrides) => {
    const executor = vi.fn();
    const { catalog } = createCatalog({ executor });
    const handle = issue(catalog);
    const request = verification(handle, overrides);

    expect(catalog.verifyLease(request)).toEqual({
      ok: false,
      failure: expect.objectContaining({ code }),
    });
    await expect(
      catalog.invokeLease({ verification: request, input: {}, context: {} }),
    ).rejects.toMatchObject({ failure: { code } });
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects forged, revoked, and expired leases before executor invocation", async () => {
    let now = 1_000;
    const executor = vi.fn();
    const { catalog } = createCatalog({ now: () => now, executor });
    const forged = { issuedId: `caplease_${"A".repeat(43)}` };
    expect(catalog.verifyLease(verification(forged))).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "lease-not-found" }),
    });

    const revoked = issue(catalog);
    expect(catalog.revokeLease(revoked)).toBe(true);
    expect(catalog.verifyLease(verification(revoked))).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "lease-revoked" }),
    });

    const expired = issue(catalog, 100);
    now = 1_100;
    expect(catalog.verifyLease(verification(expired))).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "lease-expired" }),
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it("rotates catalog and policy epochs independently and rejects stale leases", () => {
    const executor = vi.fn();
    const { catalog } = createCatalog({ executor });
    const catalogLease = issue(catalog);
    const beforeReload = catalog.snapshot();

    const afterReload = catalog.reload([{ descriptor: toolDescriptor(), executor }]);
    expect(afterReload.catalogEpoch).not.toBe(beforeReload.catalogEpoch);
    expect(afterReload.policyEpoch).toBe(beforeReload.policyEpoch);
    expect(afterReload.bindingFingerprint).not.toBe(beforeReload.bindingFingerprint);
    expect(catalog.verifyLease(verification(catalogLease))).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "catalog-epoch-mismatch" }),
    });

    const policyLease = issue(catalog);
    const catalogEpoch = catalog.catalogEpoch;
    const oldPolicyEpoch = catalog.policyEpoch;
    catalog.rotatePolicy();
    expect(catalog.catalogEpoch).toBe(catalogEpoch);
    expect(catalog.policyEpoch).not.toBe(oldPolicyEpoch);
    expect(catalog.verifyLease(verification(policyLease))).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "policy-epoch-mismatch" }),
    });
  });

  it("keeps the previous catalog live when a controlled reload is invalid", () => {
    const executor = vi.fn();
    const { catalog } = createCatalog({ executor });
    const lease = issue(catalog);
    const before = catalog.snapshot();

    expect(() =>
      catalog.reload([
        { descriptor: toolDescriptor(), executor },
        { descriptor: toolDescriptor(), executor },
      ]),
    ).toThrow(/duplicate trusted capability id/);
    expect(catalog.snapshot()).toEqual(before);
    expect(catalog.verifyLease(verification(lease)).ok).toBe(true);
  });

  it("enforces permission, ttl, and active-lease capacity at issuance", () => {
    const { catalog } = createCatalog({ maxActiveLeases: 1 });

    expect(
      catalog.issueLease({
        sessionId: "session-a",
        capabilityId: "tool:runtime:workspace-read",
        ttlMs: 1_000,
        grantedPermissions: [],
      }),
    ).toEqual({ ok: false, failure: expect.objectContaining({ code: "permission-denied" }) });
    expect(
      catalog.issueLease({
        sessionId: "session-a",
        capabilityId: "tool:runtime:workspace-read",
        ttlMs: 20_000,
        grantedPermissions: ["workspace.read"],
      }),
    ).toEqual({ ok: false, failure: expect.objectContaining({ code: "invalid-lease-ttl" }) });

    const first = issue(catalog);
    expect(
      catalog.issueLease({
        sessionId: "session-b",
        capabilityId: "tool:runtime:workspace-read",
        ttlMs: 1_000,
        grantedPermissions: ["workspace.read"],
      }),
    ).toEqual({ ok: false, failure: expect.objectContaining({ code: "lease-capacity-exceeded" }) });
    expect(catalog.revokeLease(first)).toBe(true);
    expect(
      catalog.issueLease({
        sessionId: "session-b",
        capabilityId: "tool:runtime:workspace-read",
        ttlMs: 1_000,
        grantedPermissions: ["workspace.read"],
      }).ok,
    ).toBe(true);
  });

  it("preserves the existing executor error after a valid lease", async () => {
    const original = new Error("existing runtime executor failure");
    const { catalog } = createCatalog({ executor: async () => Promise.reject(original) });
    const handle = issue(catalog);

    await expect(
      catalog.invokeLease({ verification: verification(handle), input: {}, context: {} }),
    ).rejects.toBe(original);
    expect(CapabilityLeaseVerificationError).toBeDefined();
  });
});
