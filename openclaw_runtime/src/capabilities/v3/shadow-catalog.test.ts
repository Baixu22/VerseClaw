import { describe, expect, it } from "vitest";
import { adaptSkillCapability, adaptToolCapability } from "./adapters.js";
import { buildCapabilityShadowCatalog } from "./shadow-catalog.js";

const source = { owner: "runtime", type: "core", provenance: "unit-test" };

function descriptor(name: string, namespace = "engineering.discovery") {
  return adaptToolCapability({
    name,
    description: `Use ${name}.`,
    category: "engineering",
    workflowNamespace: namespace,
    source,
  }).descriptor!;
}

describe("CapabilityShadowCatalog", () => {
  it("returns an order-independent, deterministically indexed metadata snapshot", () => {
    const read = descriptor("workspace-read");
    const search = descriptor("workspace-search");

    const first = buildCapabilityShadowCatalog([search, read]);
    const second = buildCapabilityShadowCatalog([read, search]);

    expect(first).toEqual(second);
    expect(first.descriptors.map((entry) => entry.capabilityId)).toEqual([
      "tool:runtime:workspace-read",
      "tool:runtime:workspace-search",
    ]);
    expect(first.namespaces).toEqual([
      {
        category: "engineering",
        workflowNamespace: "engineering.discovery",
        capabilityIds: ["tool:runtime:workspace-read", "tool:runtime:workspace-search"],
      },
    ]);
    expect(first.snapshotHash).toBe(second.snapshotHash);
  });

  it("excludes duplicate ids and emits owner-conflict diagnostics", () => {
    const ownerA = descriptor("workspace-read");
    const ownerB = adaptToolCapability({
      name: "workspace-read",
      description: "A different owner declaration.",
      category: "engineering",
      workflowNamespace: "engineering.discovery",
      source: { owner: "plugin", type: "extension", provenance: "unit-test" },
      capabilityId: ownerA.capabilityId,
    }).descriptor!;

    const catalog = buildCapabilityShadowCatalog([ownerA, ownerB]);

    expect(catalog.descriptors).toEqual([]);
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-capability-id", capabilityId: ownerA.capabilityId }),
        expect.objectContaining({ code: "conflicting-owner", capabilityId: ownerA.capabilityId }),
      ]),
    );
  });

  it("reports malformed input without turning it into a discoverable descriptor", () => {
    const valid = adaptSkillCapability({
      name: "release-notes",
      description: "Prepare notes.",
      category: "engineering",
      workflowNamespace: "engineering.release",
      source,
    }).descriptor!;
    const catalog = buildCapabilityShadowCatalog([
      valid,
      { ...valid, description: "x".repeat(4097) },
    ]);

    expect(catalog.descriptors).toEqual([valid]);
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid-descriptor" })]),
    );
  });
});
