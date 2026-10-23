import {
  adaptToolCapability,
  type CapabilityAdapterResult,
} from "../capabilities/v3/adapters.js";
import {
  hashCapabilityMetadata,
  type CapabilityDescriptor,
  type CapabilityDescriptorSource,
} from "../capabilities/v3/capability-descriptor.js";
import type {
  CapabilityResolverToolFallback,
  CapabilityResolverToolFallbackHit,
} from "../capabilities/v3/unified-resolver.js";
import type { TrustedCapabilityRegistrationInput } from "../capabilities/v3/trusted-catalog.js";
import { ToolSearchRuntime } from "./tool-search.js";
import {
  buildCapabilityCatalogSnapshot,
  type CapabilityCatalogSnapshot,
} from "./tool-search-capability-catalog.js";

export type ToolSearchCapabilityEntry = {
  id: string;
  source: "openclaw" | "mcp" | "client";
  sourceName?: string;
  name: string;
  label?: string;
  description: string;
  parameters?: unknown;
};

export type ToolSearchCapabilityClassification = {
  capabilityId?: string;
  category: string;
  workflowNamespace: string;
  source: CapabilityDescriptorSource;
  revision?: string;
  triggerKeywords?: readonly string[];
  permissions?: readonly string[];
};

export type ToolSearchCapabilityBridge = {
  enabled: true;
  descriptors: CapabilityDescriptor[];
  registrations: TrustedCapabilityRegistrationInput[];
  fallback: CapabilityResolverToolFallback;
  /** The same canonical snapshot consumed by model discovery and execution. */
  catalogSnapshot: CapabilityCatalogSnapshot;
};

export type ToolSearchCapabilityBridgeResult =
  | ToolSearchCapabilityBridge
  | { enabled: false; descriptors: []; registrations: []; diagnostics: []; catalogSnapshot: null }
  | { enabled: true; descriptors: []; registrations: []; diagnostics: string[]; catalogSnapshot: null };

type BridgeEntry = {
  entry: ToolSearchCapabilityEntry;
  descriptor: CapabilityDescriptor;
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireDescriptor(result: CapabilityAdapterResult): CapabilityDescriptor | undefined {
  return result.descriptor;
}

function asEntry(value: ReturnType<ToolSearchRuntime["namespaceEntries"]>[number]): ToolSearchCapabilityEntry {
  return {
    id: value.id,
    source: value.source,
    ...(value.sourceName ? { sourceName: value.sourceName } : {}),
    name: value.name,
    ...(value.label ? { label: value.label } : {}),
    description: value.description,
    parameters: value.parameters,
  };
}

/**
 * Builds an opt-in compatibility bridge over the public Tool Search runtime.
 * Target execution always returns through ToolSearchRuntime.callExactId.
 */
export function buildToolSearchCapabilityBridge(params: {
  enabled?: boolean;
  runtime: ToolSearchRuntime;
  classify: (entry: ToolSearchCapabilityEntry) => ToolSearchCapabilityClassification;
}): ToolSearchCapabilityBridgeResult {
  if (params.enabled !== true) {
    return { enabled: false, descriptors: [], registrations: [], diagnostics: [], catalogSnapshot: null };
  }

  const diagnostics: string[] = [];
  const entries: BridgeEntry[] = [];
  for (const runtimeEntry of params.runtime.namespaceEntries()) {
    const entry = asEntry(runtimeEntry);
    const classification = params.classify(entry);
    let schemaHash: string;
    try {
      schemaHash = hashCapabilityMetadata(entry.parameters ?? {});
    } catch (error) {
      diagnostics.push(
        `${entry.id} schema cannot be represented as V3 metadata: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const adapted = adaptToolCapability({
      name: entry.name,
      ...(classification.capabilityId ? { capabilityId: classification.capabilityId } : {}),
      ...(entry.label ? { title: entry.label } : {}),
      description: entry.description,
      category: classification.category,
      workflowNamespace: classification.workflowNamespace,
      source: classification.source,
      schemaHash,
      revision: classification.revision,
      triggerKeywords: [
        entry.id,
        entry.name,
        ...(entry.sourceName ? [entry.sourceName] : []),
        ...(classification.triggerKeywords ?? []),
      ],
      permissions: classification.permissions,
      executionTopologies: ["proxy"],
    });
    const descriptor = requireDescriptor(adapted);
    if (!descriptor) {
      diagnostics.push(
        `${entry.id} descriptor is invalid: ${adapted.diagnostics.map((item) => item.message).join(", ")}`,
      );
      continue;
    }
    entries.push({ entry, descriptor });
  }

  const duplicateCapabilityIds = entries
    .map((item) => item.descriptor.capabilityId)
    .filter((capabilityId, index, values) => values.indexOf(capabilityId) !== index);
  if (duplicateCapabilityIds.length > 0) {
    diagnostics.push(
      `duplicate Tool Search capability ids: ${[...new Set(duplicateCapabilityIds)].toSorted(compareStrings).join(", ")}`,
    );
  }
  const catalogSnapshot = buildCapabilityCatalogSnapshot({
    entries: entries.map((item) => item.entry),
    classify: (entry) => {
      const item = entries.find((candidate) => candidate.entry.id === entry.id);
      if (!item) throw new Error(`missing bridge classification for ${entry.id}`);
      return {
        capabilityId: item.descriptor.capabilityId,
        permissions: item.descriptor.permissions,
        revision: item.descriptor.revision,
      };
    },
    availability: () => ({ state: "available", reason: null }),
  });
  if (catalogSnapshot.diagnostics.length > 0) {
    diagnostics.push(...catalogSnapshot.diagnostics);
  }
  if (diagnostics.length > 0) {
    return { enabled: true, descriptors: [], registrations: [], diagnostics, catalogSnapshot: null };
  }

  const ordered = entries.toSorted((left, right) =>
    compareStrings(left.descriptor.capabilityId, right.descriptor.capabilityId),
  );
  const byCapabilityId = new Map(ordered.map((item) => [item.descriptor.capabilityId, item]));
  const byToolIdentity = new Map<string, BridgeEntry>();
  for (const item of ordered) {
    byToolIdentity.set(item.entry.id, item);
    byToolIdentity.set(item.entry.name, item);
  }

  const fallback: CapabilityResolverToolFallback = {
    search: async (query, limit) => {
      const hits = await params.runtime.search(query, { limit });
      const mapped: CapabilityResolverToolFallbackHit[] = [];
      for (const hit of hits) {
        const entry = byToolIdentity.get(hit.id) ?? byToolIdentity.get(hit.name);
        if (!entry) {
          continue;
        }
        mapped.push({
          capabilityId: entry.descriptor.capabilityId,
          toolId: entry.entry.id,
          name: entry.entry.name,
          description: entry.entry.description,
        });
      }
      return mapped;
    },
    describe: async (capabilityId) => {
      const item = byCapabilityId.get(capabilityId);
      if (!item) {
        throw new Error(`Tool Search capability mapping is unavailable: ${capabilityId}`);
      }
      const described = await params.runtime.describe(item.entry.id);
      const schema = described.parameters ?? {};
      return {
        capabilityId,
        schema,
        schemaHash: hashCapabilityMetadata(schema),
      };
    },
  };
  return {
    enabled: true,
    descriptors: ordered.map((item) => item.descriptor),
    registrations: ordered.map((item) => ({
      descriptor: item.descriptor,
      executor: async (input, context) =>
        await params.runtime.callExactId(item.entry.id, input, {
          ...(context.toolCallId ? { parentToolCallId: context.toolCallId } : {}),
          ...(context.signal ? { signal: context.signal } : {}),
          ...(context.onUpdate ? { onUpdate: context.onUpdate } : {}),
        }),
    })),
    fallback,
    catalogSnapshot,
  };
}
