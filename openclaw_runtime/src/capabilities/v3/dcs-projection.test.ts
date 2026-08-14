import { describe, expect, it } from "vitest";
import { CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS } from "./evaluation-baseline.js";
import { buildCapabilityShadowCatalog } from "./shadow-catalog.js";
import { CapabilityDcsProjection } from "./dcs-projection.js";

const budget = {
  maxProjectionCharacters: 4_000,
  maxNamespaces: 16,
  maxNamespaceCharacters: 4_000,
  maxCapabilitiesPerNamespace: 8,
  maxCapabilityCharacters: 2_000,
} as const;

function catalog() {
  return buildCapabilityShadowCatalog(CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS);
}

describe("Capability Registry V3 DCS projection", () => {
  it("is inert while disabled and does not inspect the catalog", () => {
    const projection = new CapabilityDcsProjection({
      enabled: false,
      get catalog() {
        throw new Error("disabled projection must not inspect the catalog");
      },
      budget,
    } as never);

    expect(projection.project()).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "projection-disabled" }),
    });
    expect(projection.readNamespace({ workflowNamespace: "engineering.discovery" })).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "projection-disabled" }),
    });
  });

  it("builds deterministic bounded navigation metadata without schemas or execution authority", () => {
    const projection = new CapabilityDcsProjection({ enabled: true, catalog: catalog(), budget });
    const first = projection.project();
    const second = projection.project();

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error(first.failure.message);
    }
    expect(first.value.navigationOnly).toBe(true);
    expect(first.value.characterCount).toBeLessThanOrEqual(budget.maxProjectionCharacters);
    expect(first.value.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "engineering",
          workflowNamespace: "engineering.discovery",
          capabilityCount: 2,
          kinds: ["tool"],
        }),
      ]),
    );
    expect(first.value.projectionHash).toMatch(/^sha256:/);
    const serialized = JSON.stringify(first.value);
    expect(serialized).not.toContain("properties");
    expect(serialized).not.toContain("executor");
    expect(serialized).not.toContain("tool_registry");
  });

  it("reports omitted namespaces when the entry cap is reached", () => {
    const projection = new CapabilityDcsProjection({
      enabled: true,
      catalog: catalog(),
      budget: { ...budget, maxNamespaces: 2 },
    });
    const result = projection.project();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.failure.message);
    }
    expect(result.value.entries).toHaveLength(2);
    expect(result.value.omittedNamespaceCount).toBeGreaterThan(0);
  });

  it("supports bounded namespace and capability reads with descriptor identity intact", () => {
    const projection = new CapabilityDcsProjection({ enabled: true, catalog: catalog(), budget });
    const namespace = projection.readNamespace({
      workflowNamespace: "engineering.discovery",
      maxCapabilities: 1,
    });

    expect(namespace.ok).toBe(true);
    if (!namespace.ok) {
      throw new Error(namespace.failure.message);
    }
    expect(namespace.value.capabilities).toHaveLength(1);
    expect(namespace.value.omittedCapabilityCount).toBe(1);
    expect(namespace.value.characterCount).toBeLessThanOrEqual(budget.maxNamespaceCharacters);
    expect(namespace.value.capabilities[0]).toEqual(
      expect.objectContaining({
        capabilityId: "tool:fixture:workspace-read",
        workflowNamespace: "engineering.discovery",
        schemaHash: expect.stringMatching(/^sha256:/),
      }),
    );

    const capability = projection.readCapability({
      capabilityId: "tool:fixture:workspace-read",
    });
    expect(capability).toEqual({
      ok: true,
      value: expect.objectContaining({
        capabilityId: "tool:fixture:workspace-read",
        source: expect.objectContaining({ owner: "fixture" }),
      }),
    });
  });

  it("fails closed for unknown targets and invalid budgets", () => {
    const projection = new CapabilityDcsProjection({ enabled: true, catalog: catalog(), budget });
    expect(projection.readNamespace({ workflowNamespace: "missing.namespace" })).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "unknown-namespace" }),
    });
    expect(projection.readCapability({ capabilityId: "tool:missing" })).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "unknown-capability" }),
    });
    expect(
      new CapabilityDcsProjection({
        enabled: true,
        catalog: catalog(),
        budget: { ...budget, maxProjectionCharacters: 0 },
      }).project(),
    ).toEqual({
      ok: false,
      failure: expect.objectContaining({ code: "invalid-budget" }),
    });
  });
});
