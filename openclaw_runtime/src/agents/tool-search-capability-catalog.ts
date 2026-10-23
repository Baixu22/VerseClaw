/**
 * TF-0502: one capability-catalog projection over the existing Tool Search
 * catalog. This is an adapter, not a second registry: Tool Search remains the
 * owner of discovery, schema expansion and execution.
 */
import {
  hashCapabilityMetadata,
  type CapabilityExecutionTopology,
} from "../capabilities/v3/capability-descriptor.js";
import type { ToolSearchCapabilityEntry } from "./tool-search-capability-v3.js";

export const CAPABILITY_CATALOG_SNAPSHOT_SCHEMA = "CapabilityCatalogSnapshot/v1" as const;

export type CapabilityCatalogAvailability =
  | "available"
  | "disabled"
  | "quarantined"
  | "unavailable";

export type CapabilityCatalogExecutorRef = {
  kind: "tool-search";
  toolId: string;
};

export type CapabilityCatalogEntry = {
  capabilityId: string;
  name: string;
  source: "openclaw" | "mcp" | "client";
  sourceName?: string;
  scope: "run";
  permissions: readonly string[];
  executor: CapabilityCatalogExecutorRef;
  availability: CapabilityCatalogAvailability;
  availabilityReason: string | null;
  schemaHash: string;
  revision: string;
  executionTopologies: readonly CapabilityExecutionTopology[];
};

export type CapabilityCatalogSnapshot = {
  schemaVersion: typeof CAPABILITY_CATALOG_SNAPSHOT_SCHEMA;
  entries: readonly CapabilityCatalogEntry[];
  diagnostics: readonly string[];
  digest: string;
};

export type BuildCapabilityCatalogSnapshotInput = {
  entries: readonly ToolSearchCapabilityEntry[];
  classify(entry: ToolSearchCapabilityEntry): {
    capabilityId: string;
    permissions?: readonly string[];
    revision?: string;
  };
  availability?: (entry: ToolSearchCapabilityEntry) => {
    state: CapabilityCatalogAvailability;
    reason?: string | null;
  };
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalCatalogEntry(entry: CapabilityCatalogEntry) {
  return {
    capabilityId: entry.capabilityId,
    name: entry.name,
    source: entry.source,
    ...(entry.sourceName ? { sourceName: entry.sourceName } : {}),
    scope: entry.scope,
    permissions: [...entry.permissions].toSorted(compareStrings),
    executor: { kind: entry.executor.kind, toolId: entry.executor.toolId },
    availability: entry.availability,
    availabilityReason: entry.availabilityReason,
    schemaHash: entry.schemaHash,
    revision: entry.revision,
    executionTopologies: [...entry.executionTopologies].toSorted(compareStrings),
  };
}

export function computeCapabilityCatalogDigest(entries: readonly CapabilityCatalogEntry[]): string {
  return hashCapabilityMetadata(
    [...entries]
      .map(canonicalCatalogEntry)
      .toSorted((left, right) => compareStrings(left.capabilityId, right.capabilityId)),
  );
}

/**
 * Builds one deterministic snapshot. Duplicate capability ids fail closed:
 * no entry with that id is published, and a diagnostic is emitted.
 */
export function buildCapabilityCatalogSnapshot(
  input: BuildCapabilityCatalogSnapshotInput,
): CapabilityCatalogSnapshot {
  const diagnostics: string[] = [];
  const byId = new Map<string, CapabilityCatalogEntry[]>();
  for (const raw of input.entries) {
    const classified = input.classify(raw);
    if (!classified.capabilityId.trim()) {
      diagnostics.push(`${raw.id} has an empty capability id`);
      continue;
    }
    let schemaHash: string;
    try {
      schemaHash = hashCapabilityMetadata(raw.parameters ?? {});
    } catch (error) {
      diagnostics.push(`${raw.id} schema is not canonical metadata: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const availability = input.availability?.(raw) ?? { state: "available" as const, reason: null };
    const entry: CapabilityCatalogEntry = {
      capabilityId: classified.capabilityId.trim(),
      name: raw.name,
      source: raw.source,
      ...(raw.sourceName ? { sourceName: raw.sourceName } : {}),
      scope: "run",
      permissions: [...new Set((classified.permissions ?? []).map((item) => item.trim()).filter(Boolean))].toSorted(compareStrings),
      executor: { kind: "tool-search", toolId: raw.id },
      availability: availability.state,
      availabilityReason: availability.reason ?? null,
      schemaHash,
      revision: classified.revision?.trim() || "v1",
      executionTopologies: ["proxy"],
    };
    const existing = byId.get(entry.capabilityId) ?? [];
    existing.push(entry);
    byId.set(entry.capabilityId, existing);
  }

  const accepted: CapabilityCatalogEntry[] = [];
  for (const [capabilityId, entries] of byId) {
    if (entries.length > 1) {
      diagnostics.push(`duplicate capability id excluded: ${capabilityId}`);
      continue;
    }
    accepted.push(entries[0]!);
  }
  const ordered = accepted.toSorted((left, right) => compareStrings(left.capabilityId, right.capabilityId));
  return {
    schemaVersion: CAPABILITY_CATALOG_SNAPSHOT_SCHEMA,
    entries: ordered,
    diagnostics: diagnostics.toSorted(compareStrings),
    digest: computeCapabilityCatalogDigest(ordered),
  };
}

export type CapabilityCatalogDiscoveryResult =
  | { ok: true; entries: readonly CapabilityCatalogEntry[]; digest: string }
  | { ok: false; reason: string; digest: string };

/** Model-facing discovery fails closed with a reason when nothing is callable. */
export function discoverCapabilityCatalog(
  snapshot: CapabilityCatalogSnapshot,
  query: { text: string; limit?: number },
): CapabilityCatalogDiscoveryResult {
  const callable = snapshot.entries.filter((entry) => entry.availability === "available");
  if (callable.length === 0) {
    return {
      ok: false,
      reason: "No capability is available in the current run; Tool Search catalog is empty or all entries are unavailable.",
      digest: snapshot.digest,
    };
  }
  const text = query.text.trim().toLowerCase();
  if (!text) {
    return { ok: false, reason: "A capability discovery query is required.", digest: snapshot.digest };
  }
  const limit = Math.max(1, Math.min(query.limit ?? 8, 40));
  const terms = text.match(/[a-z0-9]+/gu) ?? [];
  const ranked = callable
    .map((entry) => {
      const haystack = [entry.name, entry.capabilityId, entry.sourceName ?? ""].join(" ").toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .toSorted((left, right) => right.score - left.score || compareStrings(left.entry.capabilityId, right.entry.capabilityId))
    .slice(0, limit)
    .map((item) => item.entry);
  if (ranked.length === 0) {
    return { ok: false, reason: "No callable capability matched the query; refine the query or inspect availability.", digest: snapshot.digest };
  }
  return { ok: true, entries: ranked, digest: snapshot.digest };
}

export type CapabilityCatalogModelEntry = {
  capabilityId: string;
  displayName: string;
  availability: CapabilityCatalogAvailability;
  reason: string | null;
};

/** Builds model-safe positioning from the same snapshot digest. */
export function buildModelCapabilityCatalogView(
  snapshot: CapabilityCatalogSnapshot,
  displayNameById: Readonly<Record<string, string>>,
): { digest: string; entries: readonly CapabilityCatalogModelEntry[] } {
  return {
    digest: snapshot.digest,
    entries: snapshot.entries.map((entry) => ({
      capabilityId: entry.capabilityId,
      displayName: displayNameById[entry.capabilityId] ?? entry.name,
      availability: entry.availability,
      reason: entry.availabilityReason,
    })),
  };
}
