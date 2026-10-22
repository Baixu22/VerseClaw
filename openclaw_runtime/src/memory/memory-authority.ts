import {
  COMPONENT_AUTHORITY_MANIFEST,
  COMPONENT_AUTHORITY_OPERATIONS,
  type ComponentAuthorityOperation,
} from "../../../shared/component-authority-manifest.js";

export const MEMORY_AUTHORITY_SCHEMA_VERSION = "MemoryAuthorityManifest/v1" as const;
export const MEMORY_PRODUCT_PROFILE_SCHEMA_VERSION = "MemoryProductProfile/v1" as const;

export const MEMORY_AUTHORITY_DATA_TYPES = [
  "memory.role-card",
  "memory.candidate",
  "memory.runtime-fact",
  "memory.runtime-timeline",
  "memory.runtime-episode",
  "memory.embedding-index",
  "memory.native-file-query",
  "knowledge.sekb-candidate",
] as const;

export type MemoryAuthorityDataType = typeof MEMORY_AUTHORITY_DATA_TYPES[number];

export type MemoryAuthorityOperation = "accept" | "update" | "delete" | "retrieve";

export type MemoryInjectionPolicy =
  | "accepted-only"
  | "read-only-retrieval"
  | "never";

export type MemoryAuthorityEntry = {
  id: string;
  dataType: MemoryAuthorityDataType;
  scopes: readonly string[];
  acceptedMemory: boolean;
  productControlPlane: boolean;
  candidateProducerIds: readonly string[];
  injectionAuthority: string | null;
  persisted: boolean;
  storage: readonly string[];
  operations: {
    accept: string | null;
    update: string | null;
    delete: string | null;
    retrieve: readonly string[];
  };
  lifecycle: {
    retention: string;
    delete: string;
    invalidation: string;
    retrieval: string;
    injection: MemoryInjectionPolicy;
  };
  migration: string;
};

export type MemoryStoreBoundary = {
  id: string;
  kind: "sqlite" | "file" | "read-through" | "knowledge-store";
  owner: string;
  dataTypes: readonly MemoryAuthorityDataType[];
  canonicalForAcceptedMemory: boolean;
};

export type MemoryMigrationMapping = {
  id: string;
  sourceStore: string;
  targetDataType: MemoryAuthorityDataType;
  strategy: string;
  removesSource: false;
  requiresApprovalBeforeAcceptance: boolean;
  rollback: string;
};

export type MemoryProductProfile = {
  schemaVersion: typeof MEMORY_PRODUCT_PROFILE_SCHEMA_VERSION;
  profileId: "memory";
  concept: "memory";
  conceptCount: 1;
  modelSafeSummary: readonly string[];
  approvalBoundary: {
    automaticProposalAllowed: true;
    automaticAcceptanceAllowed: false;
    automaticWritebackAllowed: false;
    modelCanAcceptMemory: false;
    modelCanDeleteAcceptedMemory: false;
  };
};

const MEMORY_DATA_TYPE_SET = new Set<string>(MEMORY_AUTHORITY_DATA_TYPES);

function authorityFromManifest(
  dataType: MemoryAuthorityDataType,
  operation: ComponentAuthorityOperation,
): string | null {
  const explicit = COMPONENT_AUTHORITY_MANIFEST.authorities.find(
    (assignment) => assignment.dataType === dataType && assignment.operation === operation,
  );
  if (explicit) return explicit.authorityComponentId;
  const owners = COMPONENT_AUTHORITY_MANIFEST.components.filter(
    (component) =>
      component.ownedDataTypes.includes(dataType) &&
      component.effects.includes(operation),
  );
  return owners.length === 1 ? owners[0]!.id : null;
}

function scopesFromManifest(dataType: MemoryAuthorityDataType): readonly string[] {
  const scopes = COMPONENT_AUTHORITY_MANIFEST.authorities
    .filter((assignment) => assignment.dataType === dataType)
    .map((assignment) => assignment.scope);
  return [...new Set(scopes)];
}

function retrievalAuthorities(dataType: MemoryAuthorityDataType): readonly string[] {
  return COMPONENT_AUTHORITY_MANIFEST.components
    .filter((component) => component.allowedReads.includes(dataType))
    .map((component) => component.id);
}

function candidateProducers(dataType: MemoryAuthorityDataType): readonly string[] {
  const explicit = COMPONENT_AUTHORITY_MANIFEST.authorities
    .filter((assignment) => assignment.dataType === dataType)
    .flatMap((assignment) => assignment.candidateProviderIds ?? []);
  return [...new Set(explicit)];
}

const SEMANTICS: Record<MemoryAuthorityDataType, {
  acceptedMemory: boolean;
  productControlPlane: boolean;
  storage: readonly string[];
  lifecycle: MemoryAuthorityEntry["lifecycle"];
  migration: string;
  extraCandidateProducers?: readonly string[];
  injectionAuthority?: string | null;
  persisted: boolean;
}> = {
  "memory.role-card": {
    acceptedMemory: true,
    productControlPlane: true,
    persisted: true,
    storage: ["role-memory.sqlite:role_memory_cards"],
    lifecycle: {
      retention: "active -> cold -> archived; expiresAt is honored before retrieval; retention proposes transitions but never mutates automatically.",
      delete: "governed archive/tombstone or supersede transition; hard delete is not an ordinary model operation.",
      invalidation: "supersededBy/correctionRef plus audit events; historical rows remain for review.",
      retrieval: "active, in-scope cards must pass the use gate and candidate review boundary.",
      injection: "accepted-only",
    },
    injectionAuthority: "dcs-context-authority",
    migration: "Keep role_memory_cards in role-memory.sqlite; no forced move into another database.",
  },
  "memory.candidate": {
    acceptedMemory: false,
    productControlPlane: false,
    persisted: true,
    storage: [
      "role-memory.sqlite:role_memory_proposals",
      "openclaw-state.sqlite:runtime_memory_facts(record_kind=candidate)",
    ],
    lifecycle: {
      retention: "Retained with its proposal/candidate status until reviewed, rejected, superseded, or its source expires.",
      delete: "Candidate status can be rejected or superseded; rejection never creates accepted memory.",
      invalidation: "Candidate decisions are explicit proposal/review transitions, not accepted-memory invalidations.",
      retrieval: "Review surfaces only; default model retrieval and prompt injection are disabled.",
      injection: "never",
    },
    migration: "Import Dreaming/extraction output as candidates only; accepted memory is created later by its owning authority.",
    extraCandidateProducers: [
      "memory-core-dreaming",
      "memory-extractor",
      "runtime-memory-proposal",
      "role-memory-gatekeeper",
    ],
  },
  "memory.runtime-fact": {
    acceptedMemory: true,
    productControlPlane: false,
    persisted: true,
    storage: ["openclaw-state.sqlite:runtime_memory_facts"],
    lifecycle: {
      retention: "Append-only with bounded in-memory/persistence trimming; acceptedAt orders promotion history.",
      delete: "Logical invalidation with reason; physical row deletion is not the normal API.",
      invalidation: "A separate runtime_memory_invalidations row references the fact and optional replacement.",
      retrieval: "Default fact queries return accepted verification statuses only; candidates require the review flag.",
      injection: "accepted-only",
    },
    injectionAuthority: "dcs-context-authority",
    migration: "Keep accepted facts and their invalidation history in openclaw-state.sqlite.",
  },
  "memory.runtime-timeline": {
    acceptedMemory: true,
    productControlPlane: false,
    persisted: true,
    storage: ["openclaw-state.sqlite:runtime_memory_facts+relations+invalidations"],
    lifecycle: {
      retention: "Derived from accepted facts, relations, invalidations and reference time.",
      delete: "Invalidation removes a timeline point from default retrieval without deleting its source fact.",
      invalidation: "Same append-only invalidation authority as runtime facts.",
      retrieval: "Internal temporal queries only; it is not a second accepted-fact writer.",
      injection: "never",
    },
    injectionAuthority: null,
    migration: "Project timeline from the canonical runtime fact store; do not materialize a second fact table.",
  },
  "memory.runtime-episode": {
    acceptedMemory: true,
    productControlPlane: false,
    persisted: true,
    storage: ["openclaw-state.sqlite:runtime_memory_episodes"],
    lifecycle: {
      retention: "Idempotent bounded episode rows; accepted episodes support later fact promotion.",
      delete: "Episode retention is bounded by store limits; invalidation is expressed on derived facts.",
      invalidation: "Facts derived from an episode are invalidated through the runtime fact authority.",
      retrieval: "Inspection and provenance only; episodes are not directly projected as memory cards.",
      injection: "never",
    },
    injectionAuthority: null,
    migration: "Retain episode rows as provenance; derived facts keep source episode references.",
  },
  "memory.embedding-index": {
    acceptedMemory: false,
    productControlPlane: false,
    persisted: true,
    storage: ["openclaw-state.sqlite:runtime_memory_embeddings"],
    lifecycle: {
      retention: "Rebuildable retrieval index; it is never the source of truth for memory content.",
      delete: "Embedding rows are deleted or rebuilt when the accepted fact is invalidated or removed.",
      invalidation: "Index invalidation follows accepted-memory changes; it cannot invalidate a fact by itself.",
      retrieval: "May rank accepted content but has no authority to admit or inject it.",
      injection: "never",
    },
    migration: "Keep embeddings rebuildable in openclaw-state.sqlite; a provider/version change rebuilds without touching facts.",
    extraCandidateProducers: [],
  },
  "memory.native-file-query": {
    acceptedMemory: false,
    productControlPlane: false,
    persisted: false,
    storage: ["read-through:MEMORY.md|memory_search|qmd"],
    lifecycle: {
      retention: "Query results are ephemeral projections; source files retain their own lifecycle.",
      delete: "The query adapter cannot delete or rewrite native memory files.",
      invalidation: "Native source changes invalidate derived results on the next query.",
      retrieval: "Read-only retrieval adapter; it cannot accept memory or project candidates into prompts.",
      injection: "read-only-retrieval",
    },
    migration: "Keep native files in place and read them through the adapter; no data move is required.",
    extraCandidateProducers: [],
  },
  "knowledge.sekb-candidate": {
    acceptedMemory: false,
    productControlPlane: false,
    persisted: false,
    storage: [],
    lifecycle: {
      retention: "Knowledge-owned candidate lifetime and expiry; SEKB owns no memory store.",
      delete: "SEKB can reject or expire its candidate without affecting accepted memory.",
      invalidation: "Knowledge review owns applied knowledge; SEKB cannot invalidate memory.",
      retrieval: "Runtime Lessons are readable only through the Knowledge candidate/retrieval boundary.",
      injection: "never",
    },
    migration: "Never import SEKB candidates directly into memory; route them through Knowledge review or a memory proposal.",
    extraCandidateProducers: ["sekb-candidate-provider"],
  },
};

export const MEMORY_STORE_BOUNDARIES: readonly MemoryStoreBoundary[] = [
  {
    id: "role-memory.sqlite",
    kind: "sqlite",
    owner: "role-memory-card-governance",
    dataTypes: ["memory.role-card", "memory.candidate"],
    canonicalForAcceptedMemory: true,
  },
  {
    id: "openclaw-state.sqlite",
    kind: "sqlite",
    owner: "runtime-memory-store",
    dataTypes: [
      "memory.candidate",
      "memory.runtime-fact",
      "memory.runtime-timeline",
      "memory.runtime-episode",
      "memory.embedding-index",
    ],
    canonicalForAcceptedMemory: true,
  },
  {
    id: "native-memory-files",
    kind: "read-through",
    owner: "native-file-memory-retrieval",
    dataTypes: ["memory.native-file-query"],
    canonicalForAcceptedMemory: false,
  },
  {
    id: "knowledge-store",
    kind: "knowledge-store",
    owner: "knowledge-review-authority",
    dataTypes: ["knowledge.sekb-candidate"],
    canonicalForAcceptedMemory: false,
  },
];

export const MEMORY_MIGRATION_MAP: readonly MemoryMigrationMapping[] = [
  {
    id: "role-memory-cards-in-place",
    sourceStore: "role-memory.sqlite:role_memory_cards",
    targetDataType: "memory.role-card",
    strategy: "Map existing cards to the role-card authority contract in place; no table move.",
    removesSource: false,
    requiresApprovalBeforeAcceptance: false,
    rollback: "The source table is unchanged, so rollback is a code/config rollback only.",
  },
  {
    id: "role-and-runtime-candidates-proposal-only",
    sourceStore: "role_memory_proposals|runtime_memory_facts(record_kind=candidate)",
    targetDataType: "memory.candidate",
    strategy: "Keep candidate projections in their owning stores and treat them as proposal-only until explicit acceptance.",
    removesSource: false,
    requiresApprovalBeforeAcceptance: true,
    rollback: "Candidate rows remain reviewable in their original store; no accepted-memory deletion is required.",
  },
  {
    id: "runtime-facts-append-only",
    sourceStore: "openclaw-state.sqlite:runtime_memory_facts",
    targetDataType: "memory.runtime-fact",
    strategy: "Map existing facts and invalidations to the canonical runtime fact authority without rewriting history.",
    removesSource: false,
    requiresApprovalBeforeAcceptance: false,
    rollback: "Invalidation/relations remain append-only and the previous store version can still be read.",
  },
  {
    id: "runtime-timeline-derived-from-facts",
    sourceStore: "openclaw-state.sqlite:runtime_memory_facts+relations+invalidations",
    targetDataType: "memory.runtime-timeline",
    strategy: "Derive timeline queries from canonical runtime facts; do not copy facts into a timeline store.",
    removesSource: false,
    requiresApprovalBeforeAcceptance: false,
    rollback: "Timeline projections are derived and can be dropped/rebuilt without touching canonical facts.",
  },
  {
    id: "runtime-episodes-as-provenance",
    sourceStore: "openclaw-state.sqlite:runtime_memory_episodes",
    targetDataType: "memory.runtime-episode",
    strategy: "Retain episodes as provenance; derived facts keep source episode refs.",
    removesSource: false,
    requiresApprovalBeforeAcceptance: false,
    rollback: "Episode rows remain intact; rollback removes only derived reads/projections.",
  },
  {
    id: "dreaming-imports-as-candidates",
    sourceStore: "memory-core-dreaming|MEMORY.md",
    targetDataType: "memory.candidate",
    strategy: "Import Dreaming output as candidates only, preserving the source file until a separate governed decision.",
    removesSource: false,
    requiresApprovalBeforeAcceptance: true,
    rollback: "Keep the source artifact untouched and discard only the proposal projection.",
  },
  {
    id: "embeddings-rebuildable",
    sourceStore: "openclaw-state.sqlite:runtime_memory_embeddings",
    targetDataType: "memory.embedding-index",
    strategy: "Treat embeddings as rebuildable retrieval infrastructure, not migrated memory content.",
    removesSource: false,
    requiresApprovalBeforeAcceptance: false,
    rollback: "Drop and rebuild the embedding index from canonical accepted content.",
  },
  {
    id: "sekb-never-direct-memory-import",
    sourceStore: "knowledge.sekb-candidate",
    targetDataType: "knowledge.sekb-candidate",
    strategy: "Keep SEKB candidates in Knowledge review; never import them directly as accepted memory.",
    removesSource: false,
    requiresApprovalBeforeAcceptance: true,
    rollback: "Knowledge candidate history is unchanged; no memory write occurred.",
  },
];

export function buildMemoryAuthorityManifest(): MemoryAuthorityManifest {
  const entries = MEMORY_AUTHORITY_DATA_TYPES.map((dataType): MemoryAuthorityEntry => {
    const semantics = SEMANTICS[dataType];
    const candidates = [
      ...candidateProducers(dataType),
      ...(semantics.extraCandidateProducers ?? []),
    ];
    return {
      id: `memory-authority:${dataType}`,
      dataType,
      scopes: scopesFromManifest(dataType),
      acceptedMemory: semantics.acceptedMemory,
      productControlPlane: semantics.productControlPlane,
      candidateProducerIds: [...new Set(candidates)],
      injectionAuthority: semantics.injectionAuthority ?? null,
      persisted: semantics.persisted,
      storage: semantics.storage,
      operations: {
        accept: semantics.acceptedMemory ? authorityFromManifest(dataType, "accept") : null,
        update: authorityFromManifest(dataType, "update"),
        delete: authorityFromManifest(dataType, "delete"),
        retrieve: retrievalAuthorities(dataType),
      },
      lifecycle: semantics.lifecycle,
      migration: semantics.migration,
    };
  });
  return {
    schemaVersion: MEMORY_AUTHORITY_SCHEMA_VERSION,
    entries,
    storeBoundaries: MEMORY_STORE_BOUNDARIES,
    migrationMappings: MEMORY_MIGRATION_MAP,
  };
}

export type MemoryAuthorityManifest = {
  schemaVersion: typeof MEMORY_AUTHORITY_SCHEMA_VERSION;
  entries: readonly MemoryAuthorityEntry[];
  storeBoundaries: readonly MemoryStoreBoundary[];
  migrationMappings: readonly MemoryMigrationMapping[];
};

export type MemoryAuthorityValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type MemoryAuthorityValidationResult = {
  ok: boolean;
  issues: MemoryAuthorityValidationIssue[];
  duplicateAcceptedAuthorities: number;
  duplicateUpdateAuthorities: number;
  parallelPromptInjectionPaths: number;
  databaseClusteringRequired: boolean;
};

export function validateMemoryAuthorityManifest(
  manifest: MemoryAuthorityManifest = MEMORY_AUTHORITY_MANIFEST,
): MemoryAuthorityValidationResult {
  const issues: MemoryAuthorityValidationIssue[] = [];
  const acceptedKeys = new Map<string, string>();
  const updateKeys = new Map<string, string>();
  const persistentTypes = new Set<MemoryAuthorityDataType>();

  for (const entry of manifest.entries) {
    const scopeKey = entry.scopes.join(",") || "unspecified";
    if (entry.scopes.length === 0) {
      issues.push({ code: "scope_missing", message: `${entry.dataType} has no scope`, path: entry.id });
    }
    if (entry.acceptedMemory && !entry.operations.accept) {
      issues.push({ code: "accept_authority_missing", message: `${entry.dataType} is accepted memory but has no accept authority`, path: entry.id });
    }
    if (!entry.acceptedMemory && entry.operations.accept) {
      issues.push({ code: "non_accepted_accept_authority", message: `${entry.dataType} is not accepted memory but declares an accept authority`, path: entry.id });
    }
    if (entry.persisted && !entry.operations.update) {
      issues.push({ code: "update_authority_missing", message: `${entry.dataType} is persisted but has no update authority`, path: entry.id });
    }
    if (entry.operations.update) {
      const key = `${entry.dataType}:${scopeKey}:update`;
      const prior = updateKeys.get(key);
      if (prior) issues.push({ code: "duplicate_update_authority", message: `${key} is owned by both ${prior} and ${entry.operations.update}`, path: entry.id });
      else updateKeys.set(key, entry.operations.update);
    }
    if (entry.operations.accept) {
      const key = `${entry.dataType}:${scopeKey}:accept`;
      const prior = acceptedKeys.get(key);
      if (prior) issues.push({ code: "duplicate_accept_authority", message: `${key} is owned by both ${prior} and ${entry.operations.accept}`, path: entry.id });
      else acceptedKeys.set(key, entry.operations.accept);
    }
    if (entry.candidateProducerIds.includes(entry.operations.accept ?? "")) {
      issues.push({ code: "candidate_is_accept_authority", message: `${entry.dataType} lists its accepting authority as a candidate producer`, path: entry.id });
    }
    if (entry.persisted) persistentTypes.add(entry.dataType);
  }

  for (const mapping of manifest.migrationMappings) {
    if (mapping.removesSource) {
      issues.push({ code: "migration_removes_source", message: `${mapping.id} removes its source, violating no-data-loss migration`, path: mapping.id });
    }
    if (!manifest.entries.some((entry) => entry.dataType === mapping.targetDataType)) {
      issues.push({ code: "migration_target_unknown", message: `${mapping.id} targets unknown data type ${mapping.targetDataType}`, path: mapping.id });
    }
    if (mapping.requiresApprovalBeforeAcceptance && !mapping.strategy.match(/candidate|proposal|approval/i)) {
      issues.push({ code: "migration_approval_not_explicit", message: `${mapping.id} requires approval but strategy does not state the candidate/approval boundary`, path: mapping.id });
    }
  }

  for (const dataType of persistentTypes) {
    if (!manifest.migrationMappings.some((mapping) => mapping.targetDataType === dataType)) {
      issues.push({ code: "migration_mapping_missing", message: `${dataType} has no migration/compatibility mapping`, path: dataType });
    }
  }

  const duplicateAcceptedAuthorities = issues.filter((issue) => issue.code === "duplicate_accept_authority").length;
  const duplicateUpdateAuthorities = issues.filter((issue) => issue.code === "duplicate_update_authority").length;
  const parallelPromptInjectionPaths = manifest.entries.filter(
    (entry) =>
      entry.acceptedMemory &&
      entry.lifecycle.injection === "accepted-only" &&
      entry.injectionAuthority !== "dcs-context-authority",
  ).length;

  if (parallelPromptInjectionPaths > 0) {
    issues.push({ code: "parallel_injection_paths", message: `${parallelPromptInjectionPaths} accepted memory data types have more than one retrieval authority`, path: "authority" });
  }

  return {
    ok: issues.length === 0,
    issues,
    duplicateAcceptedAuthorities,
    duplicateUpdateAuthorities,
    parallelPromptInjectionPaths,
    databaseClusteringRequired: false,
  };
}

export const MEMORY_PRODUCT_PROFILE: MemoryProductProfile = {
  schemaVersion: MEMORY_PRODUCT_PROFILE_SCHEMA_VERSION,
  profileId: "memory",
  concept: "memory",
  conceptCount: 1,
  modelSafeSummary: [
    "Memory is governed context that can be proposed automatically but becomes active only after an explicit review or approval decision.",
    "Proposals and derived context are not active memory and must not be claimed as remembered facts.",
    "Accepted memory is scoped to its declared user, workspace, project, session or task boundary, and invalidation or deletion is honored before retrieval.",
  ],
  approvalBoundary: {
    automaticProposalAllowed: true,
    automaticAcceptanceAllowed: false,
    automaticWritebackAllowed: false,
    modelCanAcceptMemory: false,
    modelCanDeleteAcceptedMemory: false,
  },
};

export const MEMORY_AUTHORITY_MANIFEST = buildMemoryAuthorityManifest();

if (MEMORY_AUTHORITY_DATA_TYPES.some((dataType) => !MEMORY_DATA_TYPE_SET.has(dataType))) {
  throw new Error("Memory authority data type registry is inconsistent.");
}
if (!COMPONENT_AUTHORITY_OPERATIONS.includes("update")) {
  throw new Error("Component authority update operation is unavailable.");
}
