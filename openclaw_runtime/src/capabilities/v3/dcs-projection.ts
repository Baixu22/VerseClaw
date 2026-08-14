import {
  canonicalizeMetadataValue,
  hashCapabilityMetadata,
  type CapabilityDescriptor,
} from "./capability-descriptor.js";
import type { CapabilityShadowCatalogSnapshot } from "./shadow-catalog.js";

export const CAPABILITY_DCS_PROJECTION_SCHEMA_VERSION =
  "capability-dcs-projection/v1" as const;

export type CapabilityDcsProjectionBudget = {
  maxProjectionCharacters: number;
  maxNamespaces: number;
  maxNamespaceCharacters: number;
  maxCapabilitiesPerNamespace: number;
  maxCapabilityCharacters: number;
};

export type CapabilityDcsNamespaceNavigation = {
  category: string;
  workflowNamespace: string;
  capabilityCount: number;
  kinds: CapabilityDescriptor["kind"][];
  triggerKeywords: string[];
  omittedTriggerKeywordCount: number;
};

export type CapabilityDcsRootProjection = {
  schemaVersion: typeof CAPABILITY_DCS_PROJECTION_SCHEMA_VERSION;
  navigationOnly: true;
  catalogSnapshotHash: string;
  characterBudget: number;
  maxNamespaces: number;
  entries: CapabilityDcsNamespaceNavigation[];
  omittedNamespaceCount: number;
  characterCount: number;
  projectionHash: string;
};

export type CapabilityDcsNamespaceRead = {
  workflowNamespace: string;
  capabilities: CapabilityDescriptor[];
  omittedCapabilityCount: number;
  characterBudget: number;
  characterCount: number;
  namespaceHash: string;
};

export type CapabilityDcsProjectionFailureCode =
  | "projection-disabled"
  | "invalid-budget"
  | "invalid-query"
  | "budget-too-small"
  | "unknown-namespace"
  | "unknown-capability"
  | "capability-budget-exceeded";

export type CapabilityDcsProjectionFailure = {
  code: CapabilityDcsProjectionFailureCode;
  message: string;
};

export type CapabilityDcsProjectionResult<T> =
  | { ok: true; value: T; diagnostics?: string[] }
  | { ok: false; failure: CapabilityDcsProjectionFailure };

export type CapabilityDcsProjectionInput = {
  /** Explicit opt-in. This facade has no active DCS integration by itself. */
  enabled?: boolean;
  catalog: CapabilityShadowCatalogSnapshot;
  budget: CapabilityDcsProjectionBudget;
};

type NamespaceCandidate = {
  category: string;
  workflowNamespace: string;
  descriptors: CapabilityDescriptor[];
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function validateBudget(
  budget: CapabilityDcsProjectionBudget,
): CapabilityDcsProjectionFailure | undefined {
  for (const [name, value] of Object.entries(budget)) {
    if (!isPositiveInteger(value)) {
      return {
        code: "invalid-budget",
        message: `${name} must be a positive integer`,
      };
    }
  }
  return undefined;
}

function cloneDescriptor(descriptor: CapabilityDescriptor): CapabilityDescriptor {
  return {
    ...descriptor,
    triggerKeywords: [...descriptor.triggerKeywords],
    source: { ...descriptor.source },
    ...(descriptor.dependsOn ? { dependsOn: [...descriptor.dependsOn] } : {}),
    ...(descriptor.permissions ? { permissions: [...descriptor.permissions] } : {}),
    ...(descriptor.executionTopologies ? { executionTopologies: [...descriptor.executionTopologies] } : {}),
  };
}

function namespaceCandidates(
  descriptors: readonly CapabilityDescriptor[],
): NamespaceCandidate[] {
  const groups = new Map<string, NamespaceCandidate>();
  for (const descriptor of descriptors) {
    const key = `${descriptor.category}\u0000${descriptor.workflowNamespace}`;
    const group = groups.get(key) ?? {
      category: descriptor.category,
      workflowNamespace: descriptor.workflowNamespace,
      descriptors: [],
    };
    group.descriptors.push(descriptor);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      descriptors: group.descriptors.toSorted((left, right) =>
        compareStrings(left.capabilityId, right.capabilityId),
      ),
    }))
    .toSorted(
      (left, right) =>
        compareStrings(left.category, right.category) ||
        compareStrings(left.workflowNamespace, right.workflowNamespace),
    );
}

function navigationFor(group: NamespaceCandidate): CapabilityDcsNamespaceNavigation {
  const keywords = [
    ...new Set(group.descriptors.flatMap((descriptor) => descriptor.triggerKeywords)),
  ].toSorted(compareStrings);
  const triggerKeywords = keywords.slice(0, 12);
  return {
    category: group.category,
    workflowNamespace: group.workflowNamespace,
    capabilityCount: group.descriptors.length,
    kinds: [...new Set(group.descriptors.map((descriptor) => descriptor.kind))].toSorted(compareStrings),
    triggerKeywords,
    omittedTriggerKeywordCount: keywords.length - triggerKeywords.length,
  };
}

function rootProjection(
  catalogSnapshotHash: string,
  budget: CapabilityDcsProjectionBudget,
  entries: readonly CapabilityDcsNamespaceNavigation[],
  totalNamespaceCount: number,
): CapabilityDcsRootProjection {
  const base = {
    schemaVersion: CAPABILITY_DCS_PROJECTION_SCHEMA_VERSION,
    navigationOnly: true as const,
    catalogSnapshotHash,
    characterBudget: budget.maxProjectionCharacters,
    maxNamespaces: budget.maxNamespaces,
    entries: entries.map((entry) => ({ ...entry, triggerKeywords: [...entry.triggerKeywords], kinds: [...entry.kinds] })),
    omittedNamespaceCount: totalNamespaceCount - entries.length,
  };
  const projectionHash = hashCapabilityMetadata(base);
  let characterCount = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = canonicalizeMetadataValue({ ...base, projectionHash, characterCount }).length;
    if (next === characterCount) {
      break;
    }
    characterCount = next;
  }
  return { ...base, characterCount, projectionHash };
}

function namespaceRead(
  workflowNamespace: string,
  budget: number,
  descriptors: readonly CapabilityDescriptor[],
  totalCapabilityCount: number,
): CapabilityDcsNamespaceRead {
  const capabilities = descriptors.map(cloneDescriptor);
  const base = {
    workflowNamespace,
    capabilities,
    omittedCapabilityCount: totalCapabilityCount - capabilities.length,
    characterBudget: budget,
  };
  const namespaceHash = hashCapabilityMetadata(base);
  return {
    ...base,
    characterCount: canonicalizeMetadataValue({ ...base, namespaceHash }).length,
    namespaceHash,
  };
}

function disabledFailure(): CapabilityDcsProjectionResult<never> {
  return {
    ok: false,
    failure: {
      code: "projection-disabled",
      message: "Capability Registry V3 DCS projection is disabled",
    },
  };
}

/**
 * Caller-owned navigation projection for DCS consumers. It does not create a
 * ContextBlock, touch BlockStore, or change the existing tool_registry path.
 */
export class CapabilityDcsProjection {
  constructor(private readonly input: CapabilityDcsProjectionInput) {}

  project(): CapabilityDcsProjectionResult<CapabilityDcsRootProjection> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    const budgetFailure = validateBudget(this.input.budget);
    if (budgetFailure) {
      return { ok: false, failure: budgetFailure };
    }
    const candidates = namespaceCandidates(this.input.catalog.descriptors);
    const selected: CapabilityDcsNamespaceNavigation[] = [];
    for (const candidate of candidates) {
      if (selected.length >= this.input.budget.maxNamespaces) {
        break;
      }
      const next = navigationFor(candidate);
      const nextProjection = rootProjection(
        this.input.catalog.snapshotHash,
        this.input.budget,
        [...selected, next],
        candidates.length,
      );
      if (nextProjection.characterCount > this.input.budget.maxProjectionCharacters) {
        continue;
      }
      selected.push(next);
    }
    const projection = rootProjection(
      this.input.catalog.snapshotHash,
      this.input.budget,
      selected,
      candidates.length,
    );
    if (projection.characterCount > this.input.budget.maxProjectionCharacters) {
      return {
        ok: false,
        failure: {
          code: "budget-too-small",
          message: "DCS projection metadata exceeds the configured character budget",
        },
      };
    }
    if (candidates.length > 0 && selected.length === 0) {
      return {
        ok: false,
        failure: {
          code: "budget-too-small",
          message: "DCS projection budget cannot represent a namespace navigation entry",
        },
      };
    }
    return { ok: true, value: projection };
  }

  readNamespace(params: {
    workflowNamespace: string;
    maxCapabilities?: number;
    maxCharacters?: number;
  }): CapabilityDcsProjectionResult<CapabilityDcsNamespaceRead> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    const budgetFailure = validateBudget(this.input.budget);
    if (budgetFailure) {
      return { ok: false, failure: budgetFailure };
    }
    const workflowNamespace = params.workflowNamespace?.trim();
    if (!workflowNamespace) {
      return {
        ok: false,
        failure: { code: "invalid-query", message: "workflowNamespace must be a non-empty string" },
      };
    }
    if (
      params.maxCapabilities !== undefined &&
      !isPositiveInteger(params.maxCapabilities)
    ) {
      return {
        ok: false,
        failure: { code: "invalid-query", message: "maxCapabilities must be a positive integer" },
      };
    }
    if (params.maxCharacters !== undefined && !isPositiveInteger(params.maxCharacters)) {
      return {
        ok: false,
        failure: { code: "invalid-query", message: "maxCharacters must be a positive integer" },
      };
    }
    const group = namespaceCandidates(this.input.catalog.descriptors).find(
      (candidate) => candidate.workflowNamespace === workflowNamespace,
    );
    if (!group) {
      return {
        ok: false,
        failure: { code: "unknown-namespace", message: `unknown namespace: ${workflowNamespace}` },
      };
    }
    const maxCapabilities = Math.min(
      params.maxCapabilities ?? this.input.budget.maxCapabilitiesPerNamespace,
      this.input.budget.maxCapabilitiesPerNamespace,
    );
    const maxCharacters = Math.min(
      params.maxCharacters ?? this.input.budget.maxNamespaceCharacters,
      this.input.budget.maxNamespaceCharacters,
    );
    const selected: CapabilityDescriptor[] = [];
    for (const descriptor of group.descriptors) {
      if (selected.length >= maxCapabilities) {
        break;
      }
      const next = namespaceRead(
        workflowNamespace,
        maxCharacters,
        [...selected, descriptor],
        group.descriptors.length,
      );
      if (next.characterCount > maxCharacters) {
        continue;
      }
      selected.push(descriptor);
    }
    const result = namespaceRead(
      workflowNamespace,
      maxCharacters,
      selected,
      group.descriptors.length,
    );
    if (result.characterCount > maxCharacters || (group.descriptors.length > 0 && selected.length === 0)) {
      return {
        ok: false,
        failure: {
          code: "budget-too-small",
          message: "namespace metadata exceeds the configured character budget",
        },
      };
    }
    return { ok: true, value: result };
  }

  readCapability(params: {
    capabilityId: string;
    maxCharacters?: number;
  }): CapabilityDcsProjectionResult<CapabilityDescriptor> {
    if (this.input.enabled !== true) {
      return disabledFailure();
    }
    const budgetFailure = validateBudget(this.input.budget);
    if (budgetFailure) {
      return { ok: false, failure: budgetFailure };
    }
    const capabilityId = params.capabilityId?.trim();
    if (!capabilityId) {
      return {
        ok: false,
        failure: { code: "invalid-query", message: "capabilityId must be a non-empty string" },
      };
    }
    if (params.maxCharacters !== undefined && !isPositiveInteger(params.maxCharacters)) {
      return {
        ok: false,
        failure: { code: "invalid-query", message: "maxCharacters must be a positive integer" },
      };
    }
    const descriptor = this.input.catalog.descriptors.find(
      (candidate) => candidate.capabilityId === capabilityId,
    );
    if (!descriptor) {
      return {
        ok: false,
        failure: { code: "unknown-capability", message: `unknown capability: ${capabilityId}` },
      };
    }
    const value = cloneDescriptor(descriptor);
    const maxCharacters = Math.min(
      params.maxCharacters ?? this.input.budget.maxCapabilityCharacters,
      this.input.budget.maxCapabilityCharacters,
    );
    if (canonicalizeMetadataValue(value).length > maxCharacters) {
      return {
        ok: false,
        failure: {
          code: "capability-budget-exceeded",
          message: "capability metadata exceeds the configured character budget",
        },
      };
    }
    return { ok: true, value };
  }
}
