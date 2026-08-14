import { describe, expect, it } from "vitest";
import {
  canonicalizeCapabilityDescriptor,
  classifyCapability,
  hashCapabilityDescriptor,
  hashCapabilityMetadata,
  serializeCapabilityDescriptor,
  validateCapabilityDescriptor,
} from "./capability-descriptor.js";
import {
  adaptContextCapability,
  adaptSkillCapability,
  adaptToolCapability,
} from "./adapters.js";

const source = { owner: "runtime", type: "core", provenance: "unit-test" };

describe("CapabilityDescriptor", () => {
  it("canonicalizes equivalent metadata into one stable hash", () => {
    const first = adaptSkillCapability({
      name: "release-notes",
      description: "Prepare release notes.",
      triggerKeywords: ["release", "notes", "release"],
      dependsOn: ["tool:runtime:workspace-read", "context:runtime:task-state"],
      permissions: ["workspace.read", "workspace.read"],
      category: "engineering",
      workflowNamespace: "engineering.release",
      source,
    }).descriptor;
    const second = adaptSkillCapability({
      name: "release-notes",
      description: "Prepare release notes.",
      triggerKeywords: ["notes", "release"],
      dependsOn: ["context:runtime:task-state", "tool:runtime:workspace-read"],
      permissions: ["workspace.read"],
      category: "engineering",
      workflowNamespace: "engineering.release",
      source,
    }).descriptor;

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(serializeCapabilityDescriptor(first!)).toBe(serializeCapabilityDescriptor(second!));
    expect(hashCapabilityDescriptor(first!)).toBe(hashCapabilityDescriptor(second!));
    expect(canonicalizeCapabilityDescriptor(first!).triggerKeywords).toEqual([
      "Release Notes",
      "notes",
      "release",
      "release-notes",
    ]);
  });

  it("maps Skill, Tool, and Context metadata without retaining runtime objects", () => {
    const skill = adaptSkillCapability({
      name: "release-notes",
      description: "Prepare release notes.",
      category: "engineering",
      workflowNamespace: "engineering.release",
      source,
    }).descriptor;
    const tool = adaptToolCapability({
      name: "workspace-read",
      description: "Read a workspace file.",
      category: "engineering",
      workflowNamespace: "engineering.discovery",
      source,
      schemaHash: hashCapabilityMetadata({ type: "object", properties: { path: { type: "string" } } }),
    }).descriptor;
    const context = adaptContextCapability({
      id: "task-state",
      description: "Task state metadata.",
      category: "operations",
      workflowNamespace: "operations.tasks",
      source,
    }).descriptor;

    expect(skill?.kind).toBe("skill");
    expect(tool?.kind).toBe("tool");
    expect(context?.kind).toBe("context");
    expect(tool?.schemaHash).toMatch(/^sha256:/);
    expect(Object.keys(tool ?? {})).not.toContain("parameters");
    expect(Object.keys(tool ?? {})).not.toContain("executorRef");
  });

  it("rejects unsupported executor fields instead of silently dropping them", () => {
    const descriptor = adaptToolCapability({
      name: "workspace-read",
      description: "Read a workspace file.",
      category: "engineering",
      workflowNamespace: "engineering.discovery",
      source,
    }).descriptor!;
    const forged = { ...descriptor, executorRef: () => "not discoverable" };

    const validation = validateCapabilityDescriptor(forged);
    expect(validation.ok).toBe(false);
    expect(validation.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unsupported-descriptor-field", field: "executorRef" })]),
    );
    expect(() => serializeCapabilityDescriptor(forged as typeof descriptor)).toThrow(
      /discoverable metadata contract/,
    );
  });

  it("rejects inherited execution surfaces on non-plain descriptor objects", () => {
    const descriptor = adaptToolCapability({
      name: "workspace-read",
      description: "Read a workspace file.",
      category: "engineering",
      workflowNamespace: "engineering.discovery",
      source,
    }).descriptor!;
    const inherited = Object.assign(Object.create({ executorRef: () => undefined }), descriptor);

    expect(validateCapabilityDescriptor(inherited).diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid-descriptor" })]),
    );
  });

  it("rejects invalid namespaces and never normalizes them into another authority path", () => {
    const result = classifyCapability({
      kind: "skill",
      source,
      category: "engineering",
      workflowNamespace: "operations.release",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "invalid-workflow-namespace" })]),
      );
    }
  });

  it("rejects non-JSON metadata before it can become a manifest hash", () => {
    expect(() => hashCapabilityMetadata({ execute: () => undefined })).toThrow(/JSON-safe/);
    expect(() => hashCapabilityMetadata({ count: Number.NaN })).toThrow(/finite/);
  });

  it("rejects cycles through arrays as well as plain objects", () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);

    expect(() => hashCapabilityMetadata(cyclic)).toThrow(/must not contain cycles/);
  });

  it("rejects sparse arrays instead of hashing them as a different JSON value", () => {
    const sparse: unknown[] = [];
    sparse.length = 1;

    expect(() => hashCapabilityMetadata(sparse)).toThrow(/arrays must not be sparse/);
  });

  it("allows only Skill workflow dependencies on Tool or Context metadata", () => {
    const toolDependency = adaptToolCapability({
      name: "workspace-read",
      description: "Read a workspace file.",
      category: "engineering",
      workflowNamespace: "engineering.discovery",
      source,
      dependsOn: ["skill:runtime:release-notes"],
    });
    const skillDependency = adaptSkillCapability({
      name: "release-notes",
      description: "Prepare release notes.",
      category: "engineering",
      workflowNamespace: "engineering.release",
      source,
      dependsOn: ["skill:runtime:code-review"],
    });

    expect(toolDependency.descriptor).toBeUndefined();
    expect(skillDependency.descriptor).toBeUndefined();
    expect(toolDependency.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid-dependency" })]),
    );
    expect(skillDependency.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid-dependency" })]),
    );
  });
});
