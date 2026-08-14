import {
  canonicalizeCapabilityDescriptor,
  classifyCapability,
  createCapabilityId,
  hashCapabilityMetadata,
  type CapabilityDescriptor,
  type CapabilityDescriptorDiagnostic,
  type CapabilityDescriptorSource,
  type CapabilityExecutionTopology,
  type CapabilityKind,
  type CapabilityStickiness,
  validateCapabilityDescriptor,
} from "./capability-descriptor.js";

type CapabilityAdapterCommon = {
  capabilityId?: string;
  category?: string;
  workflowNamespace?: string;
  title?: string;
  description: string;
  triggerKeywords?: readonly string[];
  revision?: string;
  manifestHash?: string;
  source: CapabilityDescriptorSource;
  dependsOn?: readonly string[];
  permissions?: readonly string[];
  stickiness?: CapabilityStickiness;
  executionTopologies?: readonly CapabilityExecutionTopology[];
};

export type SkillCapabilityMetadata = CapabilityAdapterCommon & {
  name: string;
};

export type ToolCapabilityMetadata = CapabilityAdapterCommon & {
  name: string;
  schemaHash?: string;
};

export type ContextCapabilityMetadata = CapabilityAdapterCommon & {
  id: string;
};

export type CapabilityAdapterResult = {
  descriptor?: CapabilityDescriptor;
  diagnostics: CapabilityDescriptorDiagnostic[];
};

function humanize(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeStrings(values: readonly string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].toSorted();
}

function normalizeTopologies(
  values: readonly CapabilityExecutionTopology[] | undefined,
): CapabilityExecutionTopology[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return [...new Set(values)].toSorted();
}

function adaptCapability(
  kind: CapabilityKind,
  localName: string,
  input: CapabilityAdapterCommon,
  defaults: { stickiness: CapabilityStickiness; executionTopologies?: CapabilityExecutionTopology[] },
  schemaHash?: string,
): CapabilityAdapterResult {
  const classification = classifyCapability({
    kind,
    source: input.source,
    category: input.category,
    workflowNamespace: input.workflowNamespace,
  });
  if (!classification.ok) {
    return { diagnostics: classification.diagnostics };
  }

  const capabilityId = input.capabilityId?.trim() || createCapabilityId(kind, input.source.owner, localName);
  const title = input.title?.trim() || humanize(localName);
  const description = input.description.trim();
  const revision = input.revision?.trim() || "v1";
  const source = {
    owner: input.source.owner.trim(),
    type: input.source.type.trim(),
    provenance: input.source.provenance.trim(),
  };
  const normalizedSchemaHash = schemaHash?.trim();
  const triggerKeywords = normalizeStrings([localName, title, ...(input.triggerKeywords ?? [])]) ?? [];
  const dependsOn = normalizeStrings(input.dependsOn);
  const permissions = normalizeStrings(input.permissions);
  const executionTopologies = normalizeTopologies(
    input.executionTopologies ?? defaults.executionTopologies,
  );
  const manifestHash = input.manifestHash?.trim() || hashCapabilityMetadata({
    kind,
    capabilityId,
    category: classification.value.category,
    workflowNamespace: classification.value.workflowNamespace,
    title,
    description,
    triggerKeywords,
    revision,
    source,
    ...(dependsOn ? { dependsOn } : {}),
    ...(permissions ? { permissions } : {}),
    stickiness: input.stickiness ?? defaults.stickiness,
    ...(executionTopologies ? { executionTopologies } : {}),
    ...(normalizedSchemaHash ? { schemaHash: normalizedSchemaHash } : {}),
  });
  const descriptor: CapabilityDescriptor = {
    capabilityId,
    kind,
    category: classification.value.category,
    workflowNamespace: classification.value.workflowNamespace,
    title,
    description,
    triggerKeywords,
    revision,
    manifestHash,
    ...(normalizedSchemaHash ? { schemaHash: normalizedSchemaHash } : {}),
    source,
    ...(dependsOn ? { dependsOn } : {}),
    ...(permissions ? { permissions } : {}),
    stickiness: input.stickiness ?? defaults.stickiness,
    ...(executionTopologies ? { executionTopologies } : {}),
  };
  const validation = validateCapabilityDescriptor(descriptor);
  return validation.ok
    ? { descriptor: canonicalizeCapabilityDescriptor(descriptor), diagnostics: [] }
    : { diagnostics: validation.diagnostics };
}

/** Maps caller-supplied Skill metadata into a descriptor without loading a Skill body. */
export function adaptSkillCapability(input: SkillCapabilityMetadata): CapabilityAdapterResult {
  return adaptCapability("skill", input.name, input, { stickiness: "task" });
}

/** Maps caller-supplied Tool metadata into a descriptor without retaining a schema or executor. */
export function adaptToolCapability(input: ToolCapabilityMetadata): CapabilityAdapterResult {
  return adaptCapability(
    "tool",
    input.name,
    input,
    { stickiness: "step", executionTopologies: ["direct", "proxy"] },
    input.schemaHash,
  );
}

/** Maps caller-supplied Context metadata into a descriptor without reading a context store. */
export function adaptContextCapability(input: ContextCapabilityMetadata): CapabilityAdapterResult {
  return adaptCapability("context", input.id, input, { stickiness: "session" });
}
