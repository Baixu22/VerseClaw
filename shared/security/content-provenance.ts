/**
 * Small, transport-neutral provenance contract for content crossing runtime
 * boundaries. This is metadata only; authorization remains at each sink.
 */
export const CONTENT_PROVENANCE_SCHEMA = "content-provenance.v1" as const;

export const PROVENANCE_SOURCE_KINDS = [
  "user-direct",
  "channel",
  "web",
  "file",
  "tool-result",
  "memory",
  "mcp",
  "skill",
  "agent-handoff",
  "system-generated",
  "unknown",
] as const;

export type ProvenanceSourceKind = (typeof PROVENANCE_SOURCE_KINDS)[number];
export type ExternalProvenanceSourceKind = Exclude<
  ProvenanceSourceKind,
  "system-generated" | "user-direct"
>;

export const PROVENANCE_TRUST_LEVELS = [
  "trusted",
  "operator",
  "untrusted",
  "derived-untrusted",
] as const;

export type ProvenanceTrustLevel = (typeof PROVENANCE_TRUST_LEVELS)[number];

export const SENSITIVE_SINK_KINDS = [
  "secret-read",
  "network-send",
  "external-write",
  "command-exec",
  "browser-effect",
  "credential-use",
] as const;

export type SensitiveSinkKind = (typeof SENSITIVE_SINK_KINDS)[number];

export type SensitiveSinkEnforcement = "classification-only" | "source-dependent";

export const SENSITIVE_SINK_CLASSIFICATION: Readonly<
  Record<SensitiveSinkKind, { enforcement: SensitiveSinkEnforcement }>
> = {
  "secret-read": { enforcement: "classification-only" },
  "network-send": { enforcement: "classification-only" },
  "external-write": { enforcement: "classification-only" },
  "command-exec": { enforcement: "source-dependent" },
  "browser-effect": { enforcement: "classification-only" },
  "credential-use": { enforcement: "classification-only" },
};

export type ContentProvenance = {
  schema: typeof CONTENT_PROVENANCE_SCHEMA;
  sourceKind: ProvenanceSourceKind;
  trustLevel: ProvenanceTrustLevel;
  sourceId: string;
  receivedAt: string;
  parentSourceIds: string[];
  containsExternalUntrustedContent: boolean;
  workspaceId?: string;
  sessionId?: string;
  agentId?: string;
};

export type ProvenanceStatus =
  | { status: "present"; provenance: ContentProvenance }
  | { status: "missing"; reason: "missing" | "invalid" };

/** Presence of this wrapper opts a sink into source-dependent inspection. */
export type ContentProvenanceContext = {
  provenance: unknown;
};

type ProvenanceIdentityInput = {
  sourceKind: ProvenanceSourceKind;
  sourceId: string;
  receivedAt?: string | number | Date;
  parentSourceIds?: readonly string[];
  workspaceId?: string;
  sessionId?: string;
  agentId?: string;
};

type TrustedProvenanceInput = Omit<ProvenanceIdentityInput, "sourceKind"> & {
  sourceKind: "system-generated" | "user-direct";
};

type ExternalProvenanceInput = Omit<ProvenanceIdentityInput, "sourceKind"> & {
  sourceKind: ExternalProvenanceSourceKind;
};

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_PARENT_SOURCE_IDS = 64;

function normalizeIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) return undefined;
  return normalized;
}

function normalizeReceivedAt(value: string | number | Date | undefined): string {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : new Date().toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const epochMs = Math.abs(value) < 1e12 ? value * 1000 : value;
    const parsed = new Date(epochMs);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    const parsed = Number.isFinite(numeric)
      ? new Date(Math.abs(numeric) < 1e12 ? numeric * 1000 : numeric)
      : new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizeParentSourceIds(values: readonly string[] | undefined): string[] {
  const unique = new Set<string>();
  for (const value of values ?? []) {
    const normalized = normalizeIdentifier(value);
    if (normalized) unique.add(normalized);
    if (unique.size >= MAX_PARENT_SOURCE_IDS) break;
  }
  return [...unique];
}

function buildProvenance(
  input: ProvenanceIdentityInput,
  trustLevel: ProvenanceTrustLevel,
  containsExternalUntrustedContent: boolean,
): ContentProvenance {
  const sourceId = normalizeIdentifier(input.sourceId) ?? "unknown-source";
  const parentSourceIds = normalizeParentSourceIds(input.parentSourceIds);
  const workspaceId = normalizeIdentifier(input.workspaceId);
  const sessionId = normalizeIdentifier(input.sessionId);
  const agentId = normalizeIdentifier(input.agentId);
  return {
    schema: CONTENT_PROVENANCE_SCHEMA,
    sourceKind: input.sourceKind,
    trustLevel,
    sourceId,
    receivedAt: normalizeReceivedAt(input.receivedAt),
    parentSourceIds,
    containsExternalUntrustedContent,
    ...(workspaceId ? { workspaceId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

/** External adapters use this constructor so ordinary content cannot select trust. */
export function createExternalProvenance(input: ExternalProvenanceInput): ContentProvenance {
  return buildProvenance(input, "untrusted", true);
}

/** Explicit operator/system boundaries are separate from content-derived data. */
export function createTrustedProvenance(input: TrustedProvenanceInput): ContentProvenance {
  const trustLevel: ProvenanceTrustLevel =
    input.sourceKind === "system-generated" ? "trusted" : "operator";
  return buildProvenance(input, trustLevel, false);
}

/**
 * Derive metadata for a new value. Any untrusted or missing parent is
 * monotonic: the child becomes `derived-untrusted` and retains parent IDs.
 */
export function deriveProvenance(
  input: ProvenanceIdentityInput & {
    parents?: readonly unknown[];
    containsExternalUntrustedContent?: boolean;
  },
): ContentProvenance {
  const parentStatuses = (input.parents ?? []).map(provenanceStatus);
  const parentValues = parentStatuses.flatMap((entry) =>
    entry.status === "present" ? [entry.provenance] : [],
  );
  const parentSourceIds = normalizeParentSourceIds([
    ...(input.parentSourceIds ?? []),
    ...parentValues.flatMap((parent) => [parent.sourceId, ...parent.parentSourceIds]),
  ]);
  const hasMissingParent = parentStatuses.some((entry) => entry.status === "missing");
  const hasUntrustedParent = parentValues.some(
    (parent) =>
      parent.containsExternalUntrustedContent ||
      parent.trustLevel === "untrusted" ||
      parent.trustLevel === "derived-untrusted",
  );
  const external =
    Boolean(input.containsExternalUntrustedContent) ||
    hasMissingParent ||
    hasUntrustedParent ||
    parentValues.length === 0 ||
    input.sourceKind !== "system-generated";
  const trustLevel: ProvenanceTrustLevel = external ? "derived-untrusted" : "trusted";
  return buildProvenance({ ...input, parentSourceIds }, trustLevel, external);
}

/** Adapter for a tool result that was produced from one or more content values. */
export function deriveToolResultProvenance(input: {
  toolName: string;
  parents: readonly unknown[];
  sourceId?: string;
  receivedAt?: string | number | Date;
  workspaceId?: string;
  sessionId?: string;
  agentId?: string;
}): ContentProvenance {
  return deriveProvenance({
    sourceKind: "tool-result",
    sourceId: input.sourceId ?? stableSourceId("tool-result", input.toolName),
    receivedAt: input.receivedAt,
    parents: input.parents,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    agentId: input.agentId,
  });
}

export function normalizeContentProvenance(value: unknown): ContentProvenance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const sourceKind = input.sourceKind;
  const trustLevel = input.trustLevel;
  if (
    input.schema !== CONTENT_PROVENANCE_SCHEMA ||
    !PROVENANCE_SOURCE_KINDS.includes(sourceKind as ProvenanceSourceKind) ||
    !PROVENANCE_TRUST_LEVELS.includes(trustLevel as ProvenanceTrustLevel) ||
    !normalizeIdentifier(input.sourceId) ||
    typeof input.receivedAt !== "string" ||
    !Number.isFinite(new Date(input.receivedAt).getTime()) ||
    !Array.isArray(input.parentSourceIds) ||
    !input.parentSourceIds.every((entry) => normalizeIdentifier(entry)) ||
    typeof input.containsExternalUntrustedContent !== "boolean"
  ) {
    return undefined;
  }
  const directTrustLevel: ProvenanceTrustLevel =
    sourceKind === "system-generated"
      ? "trusted"
      : sourceKind === "user-direct"
        ? "operator"
        : "untrusted";
  if (trustLevel !== "derived-untrusted" && trustLevel !== directTrustLevel) {
    return undefined;
  }
  if (
    (trustLevel === "untrusted" || trustLevel === "derived-untrusted") !==
    input.containsExternalUntrustedContent
  ) {
    return undefined;
  }
  const allowedKeys = new Set([
    "schema",
    "sourceKind",
    "trustLevel",
    "sourceId",
    "receivedAt",
    "parentSourceIds",
    "containsExternalUntrustedContent",
    "workspaceId",
    "sessionId",
    "agentId",
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return undefined;
  const normalized = buildProvenance(
    {
      sourceKind: sourceKind as ProvenanceSourceKind,
      sourceId: input.sourceId as string,
      receivedAt: input.receivedAt as string,
      parentSourceIds: input.parentSourceIds as string[],
      workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : undefined,
      sessionId: typeof input.sessionId === "string" ? input.sessionId : undefined,
      agentId: typeof input.agentId === "string" ? input.agentId : undefined,
    },
    trustLevel as ProvenanceTrustLevel,
    input.containsExternalUntrustedContent,
  );
  const sameValue = (left: unknown, right: unknown): boolean =>
    Array.isArray(left) && Array.isArray(right)
      ? left.length === right.length && left.every((entry, index) => entry === right[index])
      : left === right;
  return Object.keys(normalized).length === Object.keys(input).length &&
    Object.entries(normalized).every(([key, entry]) => sameValue(entry, input[key]))
    ? normalized
    : undefined;
}

export function provenanceStatus(value: unknown): ProvenanceStatus {
  if (value == null) return { status: "missing", reason: "missing" };
  const provenance = normalizeContentProvenance(value);
  return provenance ? { status: "present", provenance } : { status: "missing", reason: "invalid" };
}

export function isExternalOrUnknownProvenance(status: ProvenanceStatus): boolean {
  return (
    status.status === "missing" ||
    status.provenance.trustLevel === "untrusted" ||
    status.provenance.trustLevel === "derived-untrusted" ||
    status.provenance.containsExternalUntrustedContent
  );
}

/** Stable, bounded IDs for adapters that do not have a provider message ID. */
export function stableSourceId(...parts: readonly unknown[]): string {
  const normalized = parts
    .map((part) =>
      typeof part === "string" || typeof part === "number" ? String(part).trim() : "",
    )
    .filter(Boolean)
    .join(":");
  return normalized.slice(0, MAX_IDENTIFIER_LENGTH) || "unknown-source";
}
