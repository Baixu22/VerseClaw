import {
  COMPONENT_AUTHORITY_MANIFEST,
  type ComponentAuthorityManifest,
  type ComponentAuthorityOperation,
  type ComponentAuthorityScope,
} from '../component-authority-manifest.js';

export const MEMORY_CONTROL_PLANE_SCHEMA = 'MemoryControlPlaneManifest/v1' as const;

export type MemoryDomainKind = 'accepted' | 'candidate' | 'derived' | 'query';
export type MemoryRetrievalMode = 'accepted-only' | 'internal-derived' | 'transient' | 'none';
export type MemoryWriteBoundary = 'review-required' | 'owner-accepted' | 'derived-only' | 'transient';

export type MemoryDomainAuthority = {
  id: string;
  dataType: string;
  authorityComponentId: string;
  kind: MemoryDomainKind;
  scopes: readonly ComponentAuthorityScope[];
  acceptanceOperations: readonly ComponentAuthorityOperation[];
  writeBoundary: MemoryWriteBoundary;
  retrieval: MemoryRetrievalMode;
  injectable: boolean;
  retention: string;
  deletion: string;
  invalidation: string;
  migration: string;
};

export type MemoryControlPlaneManifest = {
  schemaVersion: typeof MEMORY_CONTROL_PLANE_SCHEMA;
  productConcept: {
    id: 'memory';
    label: 'Memory';
    modelSafeDescription: string;
    approvalBoundary: string;
    acceptedOnlyForPrompt: true;
  };
  domains: readonly MemoryDomainAuthority[];
};

const accepted = (input: Omit<MemoryDomainAuthority, 'kind' | 'retrieval' | 'injectable'>): MemoryDomainAuthority => ({
  ...input,
  kind: 'accepted',
  retrieval: 'accepted-only',
  injectable: true,
});

export const MEMORY_CONTROL_PLANE_MANIFEST: MemoryControlPlaneManifest = {
  schemaVersion: MEMORY_CONTROL_PLANE_SCHEMA,
  productConcept: {
    id: 'memory',
    label: 'Memory',
    modelSafeDescription: 'Memory is one reviewable product concept: accepted facts or cards with provenance, scope and lifecycle state. Runtime facts, role cards, embeddings and Dreaming caches are implementation data domains, not separate product memories.',
    approvalBoundary: 'Candidates and derived signals never become accepted memory without the owning governance or runtime acceptance path. Only accepted memory may be retrieved or injected into model context.',
    acceptedOnlyForPrompt: true,
  },
  domains: [
    accepted({
      id: 'role-memory-card',
      dataType: 'memory.role-card',
      authorityComponentId: 'role-memory-card-governance',
      scopes: ['workspace'],
      acceptanceOperations: ['accept'],
      writeBoundary: 'review-required',
      retention: 'Owner-managed role-memory card lifecycle; active/cold/archived/tombstone states remain explicit.',
      deletion: 'Deletion and tombstoning are performed by role-memory card governance and remove retrievability.',
      invalidation: 'Review, evidence, scope or version invalidation marks the card non-injectable until the owner re-accepts it.',
      migration: 'Legacy role-memory SQLite cards remain in place; field normalization is applied without moving the store.',
    }),
    accepted({
      id: 'runtime-fact',
      dataType: 'memory.runtime-fact',
      authorityComponentId: 'runtime-memory-store',
      scopes: ['session', 'run'],
      acceptanceOperations: ['update'],
      writeBoundary: 'owner-accepted',
      retention: 'Runtime Memory owns fact TTL, session/run scope and eviction.',
      deletion: 'Runtime Memory removes the fact and invalidates dependent usage/embedding entries.',
      invalidation: 'Contradiction, stale evidence or scope mismatch invalidates the fact before retrieval.',
      migration: 'Existing Runtime Memory state remains in its domain store; no forced single-database migration.',
    }),
    accepted({
      id: 'runtime-timeline',
      dataType: 'memory.runtime-timeline',
      authorityComponentId: 'runtime-memory-store',
      scopes: ['session', 'run'],
      acceptanceOperations: ['update'],
      writeBoundary: 'owner-accepted',
      retention: 'Timeline retention follows its owning session or run.',
      deletion: 'Deleting the owning session/run removes or invalidates timeline state.',
      invalidation: 'A replaced generation or invalidated episode makes the timeline stale.',
      migration: 'Timeline records stay in Runtime Memory; schema changes are additive.',
    }),
    accepted({
      id: 'runtime-episode',
      dataType: 'memory.runtime-episode',
      authorityComponentId: 'runtime-memory-store',
      scopes: ['session', 'run'],
      acceptanceOperations: ['update'],
      writeBoundary: 'owner-accepted',
      retention: 'Episode retention is bounded by Runtime Memory lifecycle.',
      deletion: 'Runtime Memory owns episode deletion and dependent index removal.',
      invalidation: 'Lost execution context or contradiction invalidates the episode.',
      migration: 'Episodes remain in Runtime Memory; retrieval indexes can be rebuilt from accepted evidence.',
    }),
    {
      id: 'memory-candidate',
      dataType: 'memory.candidate',
      authorityComponentId: 'memory-candidate-queue',
      kind: 'candidate',
      scopes: ['workspace', 'session'],
      acceptanceOperations: ['update'],
      writeBoundary: 'review-required',
      retrieval: 'none',
      injectable: false,
      retention: 'Candidate queue may persist beyond a session but is bounded by owner policy.',
      deletion: 'Reject/delete removes the candidate or leaves an audit tombstone without accepted content.',
      invalidation: 'Rejected, superseded or stale candidates are never promoted into retrieval.',
      migration: 'Candidate records remain in the queue store and reference an accepted-memory target by identity.',
    },
    {
      id: 'embedding-index',
      dataType: 'memory.embedding-index',
      authorityComponentId: 'memory-embedding-provider',
      kind: 'derived',
      scopes: ['workspace'],
      acceptanceOperations: ['update'],
      writeBoundary: 'derived-only',
      retrieval: 'internal-derived',
      injectable: false,
      retention: 'Index lifetime follows the accepted source and embedding provider policy.',
      deletion: 'Deleting an accepted source removes or rebuilds its vector entries.',
      invalidation: 'Changed source digest, provider/model change or deleted source invalidates the index entry.',
      migration: 'Embeddings are rebuildable derived data and are never the sole copy of memory.',
    },
    {
      id: 'native-file-query',
      dataType: 'memory.native-file-query',
      authorityComponentId: 'native-file-memory-retrieval',
      kind: 'query',
      scopes: ['workspace'],
      acceptanceOperations: ['update'],
      writeBoundary: 'transient',
      retrieval: 'transient',
      injectable: false,
      retention: 'Query receipts are transient and bounded by the request.',
      deletion: 'No durable memory is created; transient query records may be discarded.',
      invalidation: 'A changed source file invalidates the query result.',
      migration: 'Native memory files remain read-only sources; no migration into another database is required.',
    },
    {
      id: 'dreaming-derived-cache',
      dataType: 'memory.dreaming-derived-signal',
      authorityComponentId: 'dreaming-derived-cache',
      kind: 'derived',
      scopes: ['workspace'],
      acceptanceOperations: ['update'],
      writeBoundary: 'derived-only',
      retrieval: 'internal-derived',
      injectable: false,
      retention: 'Dreaming caches follow phase/storage policy and may be rebuilt from accepted sources.',
      deletion: 'Reset/repair operations remove derived diary/cache artifacts without deleting accepted memory.',
      invalidation: 'Cache input changes, duplicate repair or reset invalidates and rebuilds derived signals.',
      migration: 'Dreaming remains a rebuildable derived cache; it is not migrated as accepted memory.',
    },
  ],
};

export type MemoryControlPlaneValidationIssue = { code: string; message: string; domainId?: string };

export function validateMemoryControlPlaneManifest(
  manifest: MemoryControlPlaneManifest = MEMORY_CONTROL_PLANE_MANIFEST,
  authorityManifest: ComponentAuthorityManifest = COMPONENT_AUTHORITY_MANIFEST,
): MemoryControlPlaneValidationIssue[] {
  const issues: MemoryControlPlaneValidationIssue[] = [];
  const seenIds = new Set<string>();
  const seenDataTypes = new Set<string>();
  const componentById = new Map(authorityManifest.components.map((component) => [component.id, component]));
  for (const domain of manifest.domains) {
    if (seenIds.has(domain.id)) issues.push({ code: 'duplicate_domain_id', message: 'Duplicate memory domain id', domainId: domain.id });
    if (seenDataTypes.has(domain.dataType)) issues.push({ code: 'duplicate_data_type', message: 'Duplicate memory data type', domainId: domain.id });
    seenIds.add(domain.id);
    seenDataTypes.add(domain.dataType);
    const component = componentById.get(domain.authorityComponentId);
    if (!component) {
      issues.push({ code: 'missing_authority_component', message: 'Memory authority component is missing', domainId: domain.id });
      continue;
    }
    if (!component.domains.includes('memory')) issues.push({ code: 'authority_not_memory', message: 'Memory authority component is not in the memory domain', domainId: domain.id });
    if (!component.ownedDataTypes.includes(domain.dataType)) issues.push({ code: 'authority_does_not_own_type', message: 'Memory authority does not own the data type', domainId: domain.id });
    for (const scope of domain.scopes) {
      for (const operation of domain.acceptanceOperations) {
        const matches = authorityManifest.authorities.filter((assignment) => (
          assignment.dataType === domain.dataType
          && assignment.scope === scope
          && assignment.operation === operation
        ));
        if (matches.length !== 1 || matches[0]?.authorityComponentId !== domain.authorityComponentId) {
          issues.push({ code: 'non_unique_accepting_authority', message: 'Each data type/scope/operation must have one matching authority', domainId: domain.id });
        }
      }
    }
    if (domain.kind === 'candidate' && (domain.injectable || domain.retrieval !== 'none')) {
      issues.push({ code: 'candidate_is_injectable', message: 'Candidates must not be retrievable or injectable', domainId: domain.id });
    }
    if (domain.kind === 'derived' && domain.injectable) {
      issues.push({ code: 'derived_is_injectable', message: 'Derived indexes and caches must not inject directly', domainId: domain.id });
    }
    if (domain.kind !== 'accepted' && domain.retrieval === 'accepted-only') {
      issues.push({ code: 'non_accepted_retrieval', message: 'Only accepted memory may use accepted-only retrieval', domainId: domain.id });
    }
  }
  if (!manifest.productConcept.acceptedOnlyForPrompt) {
    issues.push({ code: 'prompt_boundary_open', message: 'Prompt memory must be accepted-only' });
  }
  return issues;
}
