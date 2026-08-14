import { createHash } from "node:crypto";

export const CAPABILITY_DESCRIPTOR_SCHEMA_VERSION = "capability-descriptor/v1" as const;

export type CapabilityKind = "skill" | "tool" | "context";
export type CapabilityStickiness = "step" | "task" | "session";
export type CapabilityExecutionTopology = "direct" | "proxy" | "code" | "native";

export type CapabilityDescriptorSource = {
  owner: string;
  type: string;
  provenance: string;
};

/**
 * Metadata exposed to discovery consumers. Executor bindings intentionally do
 * not have a representation in this type.
 */
export type CapabilityDescriptor = {
  capabilityId: string;
  kind: CapabilityKind;
  category: string;
  workflowNamespace: string;
  title: string;
  description: string;
  triggerKeywords: string[];
  revision: string;
  manifestHash: string;
  schemaHash?: string;
  source: CapabilityDescriptorSource;
  dependsOn?: string[];
  permissions?: string[];
  stickiness: CapabilityStickiness;
  executionTopologies?: CapabilityExecutionTopology[];
};

export type CapabilityDescriptorDiagnosticCode =
  | "invalid-descriptor"
  | "unsupported-descriptor-field"
  | "invalid-capability-id"
  | "invalid-kind"
  | "invalid-category"
  | "invalid-workflow-namespace"
  | "invalid-title"
  | "invalid-description"
  | "invalid-trigger-keywords"
  | "invalid-revision"
  | "invalid-manifest-hash"
  | "invalid-schema-hash"
  | "invalid-source"
  | "invalid-dependency"
  | "invalid-permission"
  | "invalid-stickiness"
  | "invalid-execution-topology"
  | "invalid-metadata-value";

export type CapabilityDescriptorDiagnostic = {
  code: CapabilityDescriptorDiagnosticCode;
  field: string;
  message: string;
};

export type CapabilityDescriptorValidation = {
  ok: boolean;
  diagnostics: CapabilityDescriptorDiagnostic[];
};

export class CapabilityDescriptorValidationError extends Error {
  readonly diagnostics: readonly CapabilityDescriptorDiagnostic[];

  constructor(diagnostics: readonly CapabilityDescriptorDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join("; "));
    this.name = "CapabilityDescriptorValidationError";
    this.diagnostics = diagnostics;
  }
}

export type CapabilityClassificationInput = {
  kind: CapabilityKind;
  source: CapabilityDescriptorSource;
  category?: string;
  workflowNamespace?: string;
};

export type CapabilityClassification = {
  category: string;
  workflowNamespace: string;
};

export type CapabilityClassificationResult =
  | { ok: true; value: CapabilityClassification }
  | { ok: false; diagnostics: CapabilityDescriptorDiagnostic[] };

const CAPABILITY_KINDS = new Set<CapabilityKind>(["skill", "tool", "context"]);
const STICKINESS_VALUES = new Set<CapabilityStickiness>(["step", "task", "session"]);
const EXECUTION_TOPOLOGIES = new Set<CapabilityExecutionTopology>([
  "direct",
  "proxy",
  "code",
  "native",
]);
const CAPABILITY_ID_PATTERN = /^(skill|tool|context):[a-z0-9][a-z0-9._-]{0,127}:[a-z0-9][a-z0-9._-]{0,127}$/;
const PATH_SEGMENT_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SOURCE_VALUE_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PERMISSION_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/;
const MAX_TITLE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 4096;
const MAX_KEYWORD_COUNT = 32;
const MAX_KEYWORD_LENGTH = 128;
const MAX_LIST_COUNT = 64;

const DESCRIPTOR_FIELDS = new Set([
  "capabilityId",
  "kind",
  "category",
  "workflowNamespace",
  "title",
  "description",
  "triggerKeywords",
  "revision",
  "manifestHash",
  "schemaHash",
  "source",
  "dependsOn",
  "permissions",
  "stickiness",
  "executionTopologies",
]);
const SOURCE_FIELDS = new Set(["owner", "type", "provenance"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function diagnostic(
  code: CapabilityDescriptorDiagnosticCode,
  field: string,
  message: string,
): CapabilityDescriptorDiagnostic {
  return { code, field, message };
}

function validateString(
  value: unknown,
  field: string,
  diagnostics: CapabilityDescriptorDiagnostic[],
  options: { maxLength?: number; pattern?: RegExp; code: CapabilityDescriptorDiagnosticCode },
): value is string {
  if (typeof value !== "string" || !value.trim()) {
    diagnostics.push(diagnostic(options.code, field, `${field} must be a non-empty string`));
    return false;
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    diagnostics.push(
      diagnostic(options.code, field, `${field} must not exceed ${options.maxLength} characters`),
    );
    return false;
  }
  if (options.pattern && !options.pattern.test(value)) {
    diagnostics.push(diagnostic(options.code, field, `${field} has an invalid format`));
    return false;
  }
  return true;
}

function validateStringList(
  value: unknown,
  field: string,
  diagnostics: CapabilityDescriptorDiagnostic[],
  options: {
    code: CapabilityDescriptorDiagnosticCode;
    itemPattern?: RegExp;
    maxCount?: number;
    maxItemLength?: number;
  },
): value is string[] {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic(options.code, field, `${field} must be an array of strings`));
    return false;
  }
  const maxCount = options.maxCount ?? MAX_LIST_COUNT;
  if (value.length > maxCount) {
    diagnostics.push(diagnostic(options.code, field, `${field} must contain at most ${maxCount} entries`));
    return false;
  }
  let valid = true;
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !item.trim()) {
      diagnostics.push(diagnostic(options.code, `${field}[${index}]`, "list entries must be non-empty strings"));
      valid = false;
      continue;
    }
    if (options.maxItemLength !== undefined && item.length > options.maxItemLength) {
      diagnostics.push(
        diagnostic(
          options.code,
          `${field}[${index}]`,
          `list entries must not exceed ${options.maxItemLength} characters`,
        ),
      );
      valid = false;
      continue;
    }
    if (options.itemPattern && !options.itemPattern.test(item)) {
      diagnostics.push(diagnostic(options.code, `${field}[${index}]`, "list entry has an invalid format"));
      valid = false;
    }
  }
  return valid;
}

function validateOptionalStringList(
  value: unknown,
  field: string,
  diagnostics: CapabilityDescriptorDiagnostic[],
  options: Parameters<typeof validateStringList>[3],
): value is string[] | undefined {
  return value === undefined || validateStringList(value, field, diagnostics, options);
}

function validateDependencyTopology(
  kind: unknown,
  dependencies: unknown,
  diagnostics: CapabilityDescriptorDiagnostic[],
): void {
  if (!Array.isArray(dependencies) || dependencies.length === 0 || !CAPABILITY_KINDS.has(kind as CapabilityKind)) {
    return;
  }
  if (kind !== "skill") {
    diagnostics.push(
      diagnostic(
        "invalid-dependency",
        "dependsOn",
        "only Skill descriptors may declare workflow dependencies",
      ),
    );
    return;
  }
  for (const [index, dependency] of dependencies.entries()) {
    if (
      typeof dependency === "string" &&
      !dependency.startsWith("tool:") &&
      !dependency.startsWith("context:")
    ) {
      diagnostics.push(
        diagnostic(
          "invalid-dependency",
          `dependsOn[${index}]`,
          "Skill dependencies must reference Tool or Context descriptors",
        ),
      );
    }
  }
}

function normalizeStringList(values: readonly string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].toSorted();
}

function normalizeTopologyList(
  values: readonly CapabilityExecutionTopology[] | undefined,
): CapabilityExecutionTopology[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return [...new Set(values)].toSorted();
}

function validateSource(value: unknown, diagnostics: CapabilityDescriptorDiagnostic[]): value is CapabilityDescriptorSource {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("invalid-source", "source", "source must be an object"));
    return false;
  }
  let valid = true;
  for (const key of Object.keys(value)) {
    if (!SOURCE_FIELDS.has(key)) {
      diagnostics.push(
        diagnostic("invalid-source", `source.${key}`, "source contains an unsupported field"),
      );
      valid = false;
    }
  }
  for (const field of ["owner", "type", "provenance"] as const) {
    valid =
      validateString(value[field], `source.${field}`, diagnostics, {
        code: "invalid-source",
        maxLength: 128,
        pattern: SOURCE_VALUE_PATTERN,
      }) && valid;
  }
  return valid;
}

export function validateCapabilityDescriptor(value: unknown): CapabilityDescriptorValidation {
  const diagnostics: CapabilityDescriptorDiagnostic[] = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic("invalid-descriptor", "descriptor", "descriptor must be a plain object"),
      ],
    };
  }

  for (const key of Object.keys(value)) {
    if (!DESCRIPTOR_FIELDS.has(key)) {
      diagnostics.push(
        diagnostic(
          "unsupported-descriptor-field",
          key,
          "descriptor contains a field that is not part of the discoverable metadata contract",
        ),
      );
    }
  }

  const capabilityIdValid = validateString(value.capabilityId, "capabilityId", diagnostics, {
    code: "invalid-capability-id",
    maxLength: 320,
    pattern: CAPABILITY_ID_PATTERN,
  });
  const kindValid = CAPABILITY_KINDS.has(value.kind as CapabilityKind);
  if (!kindValid) {
    diagnostics.push(diagnostic("invalid-kind", "kind", "kind must be skill, tool, or context"));
  }
  if (
    capabilityIdValid &&
    kindValid &&
    typeof value.capabilityId === "string" &&
    !value.capabilityId.startsWith(`${value.kind as CapabilityKind}:`)
  ) {
    diagnostics.push(
      diagnostic("invalid-capability-id", "capabilityId", "capabilityId kind must match kind"),
    );
  }
  validateString(value.category, "category", diagnostics, {
    code: "invalid-category",
    maxLength: 64,
    pattern: PATH_SEGMENT_PATTERN,
  });
  const namespaceValid = validateString(value.workflowNamespace, "workflowNamespace", diagnostics, {
    code: "invalid-workflow-namespace",
    maxLength: 255,
    pattern: /^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63}){0,7}$/,
  });
  if (
    namespaceValid &&
    typeof value.category === "string" &&
    typeof value.workflowNamespace === "string" &&
    value.workflowNamespace !== value.category &&
    !value.workflowNamespace.startsWith(`${value.category}.`)
  ) {
    diagnostics.push(
      diagnostic(
        "invalid-workflow-namespace",
        "workflowNamespace",
        "workflowNamespace must be rooted in category",
      ),
    );
  }
  validateString(value.title, "title", diagnostics, {
    code: "invalid-title",
    maxLength: MAX_TITLE_LENGTH,
  });
  validateString(value.description, "description", diagnostics, {
    code: "invalid-description",
    maxLength: MAX_DESCRIPTION_LENGTH,
  });
  validateStringList(value.triggerKeywords, "triggerKeywords", diagnostics, {
    code: "invalid-trigger-keywords",
    maxCount: MAX_KEYWORD_COUNT,
    maxItemLength: MAX_KEYWORD_LENGTH,
  });
  validateString(value.revision, "revision", diagnostics, {
    code: "invalid-revision",
    maxLength: 256,
  });
  validateString(value.manifestHash, "manifestHash", diagnostics, {
    code: "invalid-manifest-hash",
    maxLength: 72,
    pattern: HASH_PATTERN,
  });
  if (value.schemaHash !== undefined) {
    validateString(value.schemaHash, "schemaHash", diagnostics, {
      code: "invalid-schema-hash",
      maxLength: 72,
      pattern: HASH_PATTERN,
    });
  }
  validateSource(value.source, diagnostics);
  validateOptionalStringList(value.dependsOn, "dependsOn", diagnostics, {
    code: "invalid-dependency",
    itemPattern: CAPABILITY_ID_PATTERN,
  });
  validateDependencyTopology(value.kind, value.dependsOn, diagnostics);
  validateOptionalStringList(value.permissions, "permissions", diagnostics, {
    code: "invalid-permission",
    itemPattern: PERMISSION_PATTERN,
  });
  if (!STICKINESS_VALUES.has(value.stickiness as CapabilityStickiness)) {
    diagnostics.push(diagnostic("invalid-stickiness", "stickiness", "stickiness must be step, task, or session"));
  }
  if (value.executionTopologies !== undefined) {
    if (!Array.isArray(value.executionTopologies) || value.executionTopologies.length > MAX_LIST_COUNT) {
      diagnostics.push(
        diagnostic(
          "invalid-execution-topology",
          "executionTopologies",
          "executionTopologies must be a bounded array",
        ),
      );
    } else {
      for (const [index, topology] of value.executionTopologies.entries()) {
        if (!EXECUTION_TOPOLOGIES.has(topology as CapabilityExecutionTopology)) {
          diagnostics.push(
            diagnostic(
              "invalid-execution-topology",
              `executionTopologies[${index}]`,
              "execution topology must be direct, proxy, code, or native",
            ),
          );
        }
      }
    }
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

/** Creates a deterministic category/namespace pair without reading owner state. */
export function classifyCapability(input: CapabilityClassificationInput): CapabilityClassificationResult {
  const diagnostics: CapabilityDescriptorDiagnostic[] = [];
  if (!CAPABILITY_KINDS.has(input.kind)) {
    diagnostics.push(diagnostic("invalid-kind", "kind", "kind must be skill, tool, or context"));
  }
  if (!validateSource(input.source, diagnostics)) {
    return { ok: false, diagnostics };
  }

  const category = input.category?.trim() || input.kind;
  if (!PATH_SEGMENT_PATTERN.test(category)) {
    diagnostics.push(diagnostic("invalid-category", "category", "category has an invalid format"));
  }
  const ownerSegment = capabilitySlug(input.source.owner);
  const workflowNamespace = input.workflowNamespace?.trim() || `${category}.${ownerSegment}`;
  if (!/^[a-z][a-z0-9-]{0,63}(?:\.[a-z][a-z0-9-]{0,63}){0,7}$/.test(workflowNamespace)) {
    diagnostics.push(
      diagnostic("invalid-workflow-namespace", "workflowNamespace", "workflowNamespace has an invalid format"),
    );
  } else if (workflowNamespace !== category && !workflowNamespace.startsWith(`${category}.`)) {
    diagnostics.push(
      diagnostic(
        "invalid-workflow-namespace",
        "workflowNamespace",
        "workflowNamespace must be rooted in category",
      ),
    );
  }
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return { ok: true, value: { category, workflowNamespace } };
}

export function capabilitySlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unknown";
}

export function createCapabilityId(
  kind: CapabilityKind,
  owner: string,
  localName: string,
): string {
  return `${kind}:${capabilitySlug(owner)}:${capabilitySlug(localName)}`;
}

/** Canonical, explicit whitelist serialization for metadata hashes and snapshots. */
export function canonicalizeMetadataValue(value: unknown): string {
  return canonicalizeMetadataValueInner(value, new WeakSet<object>());
}

function canonicalizeMetadataValueInner(value: unknown, stack: WeakSet<object>): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CapabilityDescriptorValidationError([
        diagnostic("invalid-metadata-value", "metadata", "metadata numbers must be finite"),
      ]);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (stack.has(value)) {
      throw new CapabilityDescriptorValidationError([
        diagnostic("invalid-metadata-value", "metadata", "metadata must not contain cycles"),
      ]);
    }
    stack.add(value);
    try {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new CapabilityDescriptorValidationError([
            diagnostic("invalid-metadata-value", "metadata", "metadata arrays must not be sparse"),
          ]);
        }
        items.push(canonicalizeMetadataValueInner(value[index], stack));
      }
      return `[${items.join(",")}]`;
    } finally {
      stack.delete(value);
    }
  }
  if (!isRecord(value)) {
    throw new CapabilityDescriptorValidationError([
      diagnostic(
        "invalid-metadata-value",
        "metadata",
        "metadata must use JSON-safe primitive, array, or plain-object values",
      ),
    ]);
  }
  if (stack.has(value)) {
    throw new CapabilityDescriptorValidationError([
      diagnostic("invalid-metadata-value", "metadata", "metadata must not contain cycles"),
    ]);
  }
  stack.add(value);
  try {
    const fields = Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeMetadataValueInner(value[key], stack)}`);
    return `{${fields.join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

export function hashCapabilityMetadata(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalizeMetadataValue(value), "utf8").digest("hex")}`;
}

export function canonicalizeCapabilityDescriptor(
  descriptor: CapabilityDescriptor,
): CapabilityDescriptor {
  const validation = validateCapabilityDescriptor(descriptor);
  if (!validation.ok) {
    throw new CapabilityDescriptorValidationError(validation.diagnostics);
  }
  const dependsOn = normalizeStringList(descriptor.dependsOn);
  const permissions = normalizeStringList(descriptor.permissions);
  const executionTopologies = normalizeTopologyList(descriptor.executionTopologies);
  return {
    capabilityId: descriptor.capabilityId.trim(),
    kind: descriptor.kind,
    category: descriptor.category.trim(),
    workflowNamespace: descriptor.workflowNamespace.trim(),
    title: descriptor.title.trim(),
    description: descriptor.description.trim(),
    triggerKeywords: normalizeStringList(descriptor.triggerKeywords) ?? [],
    revision: descriptor.revision.trim(),
    manifestHash: descriptor.manifestHash.trim(),
    ...(descriptor.schemaHash ? { schemaHash: descriptor.schemaHash.trim() } : {}),
    source: {
      owner: descriptor.source.owner.trim(),
      type: descriptor.source.type.trim(),
      provenance: descriptor.source.provenance.trim(),
    },
    ...(dependsOn ? { dependsOn } : {}),
    ...(permissions ? { permissions } : {}),
    stickiness: descriptor.stickiness,
    ...(executionTopologies ? { executionTopologies } : {}),
  };
}

export function serializeCapabilityDescriptor(descriptor: CapabilityDescriptor): string {
  const canonical = canonicalizeCapabilityDescriptor(descriptor);
  return JSON.stringify({
    schemaVersion: CAPABILITY_DESCRIPTOR_SCHEMA_VERSION,
    capabilityId: canonical.capabilityId,
    kind: canonical.kind,
    category: canonical.category,
    workflowNamespace: canonical.workflowNamespace,
    title: canonical.title,
    description: canonical.description,
    triggerKeywords: canonical.triggerKeywords,
    revision: canonical.revision,
    manifestHash: canonical.manifestHash,
    ...(canonical.schemaHash ? { schemaHash: canonical.schemaHash } : {}),
    source: canonical.source,
    ...(canonical.dependsOn ? { dependsOn: canonical.dependsOn } : {}),
    ...(canonical.permissions ? { permissions: canonical.permissions } : {}),
    stickiness: canonical.stickiness,
    ...(canonical.executionTopologies ? { executionTopologies: canonical.executionTopologies } : {}),
  });
}

export function hashCapabilityDescriptor(descriptor: CapabilityDescriptor): string {
  return `sha256:${createHash("sha256")
    .update(serializeCapabilityDescriptor(descriptor), "utf8")
    .digest("hex")}`;
}
