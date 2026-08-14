import {
  canonicalizeCapabilityDescriptor,
  hashCapabilityMetadata,
  type CapabilityDescriptor,
  type CapabilityDescriptorDiagnostic,
  validateCapabilityDescriptor,
} from "./capability-descriptor.js";

export const CAPABILITY_SHADOW_CATALOG_SCHEMA_VERSION = "capability-shadow-catalog/v1" as const;

export type CapabilityShadowCatalogDiagnosticCode =
  | "invalid-descriptor"
  | "duplicate-capability-id"
  | "conflicting-owner";

export type CapabilityShadowCatalogDiagnostic = {
  code: CapabilityShadowCatalogDiagnosticCode;
  severity: "warning" | "error";
  capabilityId?: string;
  message: string;
  details?: Record<string, string[]>;
};

export type CapabilityShadowCatalogNamespace = {
  category: string;
  workflowNamespace: string;
  capabilityIds: string[];
};

export type CapabilityShadowCatalogSnapshot = {
  schemaVersion: typeof CAPABILITY_SHADOW_CATALOG_SCHEMA_VERSION;
  descriptors: CapabilityDescriptor[];
  namespaces: CapabilityShadowCatalogNamespace[];
  diagnostics: CapabilityShadowCatalogDiagnostic[];
  snapshotHash: string;
};

function ownerIdentity(descriptor: CapabilityDescriptor): string {
  return `${descriptor.source.owner}:${descriptor.source.type}:${descriptor.source.provenance}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortDescriptors(descriptors: readonly CapabilityDescriptor[]): CapabilityDescriptor[] {
  return [...descriptors].toSorted((left, right) => {
    return (
      compareStrings(left.category, right.category) ||
      compareStrings(left.workflowNamespace, right.workflowNamespace) ||
      compareStrings(left.capabilityId, right.capabilityId)
    );
  });
}

function sortDiagnostics(
  diagnostics: readonly CapabilityShadowCatalogDiagnostic[],
): CapabilityShadowCatalogDiagnostic[] {
  return [...diagnostics].toSorted((left, right) => {
    return (
      compareStrings(left.code, right.code) ||
      compareStrings(left.capabilityId ?? "", right.capabilityId ?? "") ||
      compareStrings(left.message, right.message)
    );
  });
}

function buildNamespaces(descriptors: readonly CapabilityDescriptor[]): CapabilityShadowCatalogNamespace[] {
  const byNamespace = new Map<string, CapabilityShadowCatalogNamespace>();
  for (const descriptor of descriptors) {
    const key = `${descriptor.category}\u0000${descriptor.workflowNamespace}`;
    const existing = byNamespace.get(key);
    if (existing) {
      existing.capabilityIds.push(descriptor.capabilityId);
      continue;
    }
    byNamespace.set(key, {
      category: descriptor.category,
      workflowNamespace: descriptor.workflowNamespace,
      capabilityIds: [descriptor.capabilityId],
    });
  }
  return [...byNamespace.values()]
    .map((namespace) => ({ ...namespace, capabilityIds: namespace.capabilityIds.toSorted() }))
    .toSorted(
      (left, right) =>
        compareStrings(left.category, right.category) ||
        compareStrings(left.workflowNamespace, right.workflowNamespace),
    );
}

function mapDescriptorDiagnostics(
  descriptor: unknown,
  diagnostics: readonly CapabilityDescriptorDiagnostic[],
): CapabilityShadowCatalogDiagnostic[] {
  const capabilityId =
    descriptor && typeof descriptor === "object" && "capabilityId" in descriptor
      ? String((descriptor as { capabilityId?: unknown }).capabilityId)
      : undefined;
  return diagnostics.map((entry) => ({
    code: "invalid-descriptor" as const,
    severity: "error" as const,
    ...(capabilityId ? { capabilityId } : {}),
    message: `${entry.field}: ${entry.message}`,
  }));
}

/**
 * Builds a caller-owned, in-memory metadata snapshot. Duplicate ids are
 * excluded rather than resolved, so this shadow layer cannot select an owner.
 */
export function buildCapabilityShadowCatalog(
  candidates: readonly unknown[],
): CapabilityShadowCatalogSnapshot {
  const diagnostics: CapabilityShadowCatalogDiagnostic[] = [];
  const validDescriptors: CapabilityDescriptor[] = [];
  for (const candidate of candidates) {
    const validation = validateCapabilityDescriptor(candidate);
    if (!validation.ok) {
      diagnostics.push(...mapDescriptorDiagnostics(candidate, validation.diagnostics));
      continue;
    }
    validDescriptors.push(canonicalizeCapabilityDescriptor(candidate as CapabilityDescriptor));
  }

  const byCapabilityId = new Map<string, CapabilityDescriptor[]>();
  for (const descriptor of validDescriptors) {
    const entries = byCapabilityId.get(descriptor.capabilityId) ?? [];
    entries.push(descriptor);
    byCapabilityId.set(descriptor.capabilityId, entries);
  }

  const accepted: CapabilityDescriptor[] = [];
  for (const [capabilityId, entries] of byCapabilityId) {
    if (entries.length === 1) {
      accepted.push(entries[0]);
      continue;
    }
    const owners = [...new Set(entries.map(ownerIdentity))].toSorted();
    diagnostics.push({
      code: "duplicate-capability-id",
      severity: "error",
      capabilityId,
      message: "duplicate capability ids are excluded from the shadow catalog",
      details: { owners },
    });
    if (owners.length > 1) {
      diagnostics.push({
        code: "conflicting-owner",
        severity: "error",
        capabilityId,
        message: "multiple owners declared the same capability id",
        details: { owners },
      });
    }
  }

  const descriptors = sortDescriptors(accepted);
  const namespaces = buildNamespaces(descriptors);
  const orderedDiagnostics = sortDiagnostics(diagnostics);
  const snapshotHash = hashCapabilityMetadata({
    schemaVersion: CAPABILITY_SHADOW_CATALOG_SCHEMA_VERSION,
    descriptors,
    namespaces,
    diagnostics: orderedDiagnostics,
  });
  return {
    schemaVersion: CAPABILITY_SHADOW_CATALOG_SCHEMA_VERSION,
    descriptors,
    namespaces,
    diagnostics: orderedDiagnostics,
    snapshotHash,
  };
}
