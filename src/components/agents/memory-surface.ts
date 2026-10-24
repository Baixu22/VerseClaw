/**
 * TF-0498: one user-facing Memory surface contract.
 *
 * The renderer may present role and runtime-memory internals inside tabs, but
 * the product surface is one concept: memory. This module keeps the product
 * semantics deterministic so the panel and acceptance tests do not infer
 * them from transport payload shape.
 */

export const MEMORY_SURFACE_SCHEMA_VERSION = 'MemoryProductSurface/v1' as const;
export const MEMORY_EXPORT_SCHEMA_VERSION = 'MemoryExport/v1' as const;

export type MemorySurfaceStatus = 'active' | 'cold' | 'archived' | 'tombstone';

export type MemorySurfaceCard = {
  id: string;
  status: string;
  content: string;
  type?: string;
  scope?: string;
  scopeKey?: string | null;
  sensitivity?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string | null;
  evidenceRefs?: Array<{ type?: string; ref?: string; excerpt?: string }>;
  confidence?: number;
  importance?: number;
};

export type MemorySurfaceProposal = {
  id: string;
  status?: string;
  operation?: string;
  createdAt?: string;
  proposal?: {
    content?: string;
    type?: string;
    scope?: string;
    scopeKey?: string | null;
    sensitivity?: string;
    source?: string;
    confidence?: number;
    importance?: number;
  };
};

export type MemorySurfaceInjection = {
  id: string;
  roleName?: string;
  createdAt?: string;
  cardIds?: string[];
};

export type MemorySurfaceSemantics = {
  schemaVersion: typeof MEMORY_SURFACE_SCHEMA_VERSION;
  surfaceId: 'agents.memory';
  productConcept: 'memory';
  actions: readonly ['view', 'review', 'approve', 'delete', 'export', 'remember'];
  masterSwitch: {
    id: 'roleMemoryEnabled';
    offBlocksRead: true;
    offBlocksWrite: true;
    offBlocksInjection: true;
    deletesStoredMemory: false;
  };
  writeGate: {
    automaticCapture: 'candidate-queue-only';
    explicitRemember: 'same-review-authority';
    automaticAcceptance: false;
  };
  readGate: {
    acceptedOnly: true;
    acceptedStatuses: readonly MemorySurfaceStatus[];
    unapprovedCandidateRetrievable: false;
    unapprovedCandidateInjectable: false;
  };
  candidateQueue: {
    persistent: true;
    reviewRequired: true;
    acceptedStatus: 'active';
    modelVisibleBeforeApproval: false;
  };
  legacyFallback: {
    nativeOpenClawMemory: 'unchanged-and-outside-this-surface';
    existingManagedCardsWhenOff: 'retained-on-disk-not-injected';
    modelExplanation: 'Only accepted memory is recalled or injected; candidates are review material and must not be described as remembered facts.';
  };
  deletion: {
    userAction: 'delete';
    mechanism: 'tombstone';
    hardDelete: false;
    auditHistoryRetained: true;
    retrievableOrInjectableAfterDelete: false;
  };
  modelVisibility: {
    approvedOnly: true;
    candidateExplanation: 'Candidate memory is stored for review only and is not accepted, retrievable, or injectable memory.';
  };
};

export const MEMORY_SURFACE_SEMANTICS: MemorySurfaceSemantics = {
  schemaVersion: MEMORY_SURFACE_SCHEMA_VERSION,
  surfaceId: 'agents.memory',
  productConcept: 'memory',
  actions: ['view', 'review', 'approve', 'delete', 'export', 'remember'],
  masterSwitch: {
    id: 'roleMemoryEnabled',
    offBlocksRead: true,
    offBlocksWrite: true,
    offBlocksInjection: true,
    deletesStoredMemory: false,
  },
  writeGate: {
    automaticCapture: 'candidate-queue-only',
    explicitRemember: 'same-review-authority',
    automaticAcceptance: false,
  },
  readGate: {
    acceptedOnly: true,
    acceptedStatuses: ['active', 'cold'],
    unapprovedCandidateRetrievable: false,
    unapprovedCandidateInjectable: false,
  },
  candidateQueue: {
    persistent: true,
    reviewRequired: true,
    acceptedStatus: 'active',
    modelVisibleBeforeApproval: false,
  },
  legacyFallback: {
    nativeOpenClawMemory: 'unchanged-and-outside-this-surface',
    existingManagedCardsWhenOff: 'retained-on-disk-not-injected',
    modelExplanation: 'Only accepted memory is recalled or injected; candidates are review material and must not be described as remembered facts.',
  },
  deletion: {
    userAction: 'delete',
    mechanism: 'tombstone',
    hardDelete: false,
    auditHistoryRetained: true,
    retrievableOrInjectableAfterDelete: false,
  },
  modelVisibility: {
    approvedOnly: true,
    candidateExplanation: 'Candidate memory is stored for review only and is not accepted, retrievable, or injectable memory.',
  },
};

export function isAcceptedMemoryStatus(status: string | undefined): boolean {
  return status === 'active' || status === 'cold';
}

export function isCandidateMemoryProposal(proposal: MemorySurfaceProposal): boolean {
  return proposal.status === 'pending' || proposal.status === 'needs_review';
}

export function buildMemoryExportSnapshot(params: {
  generatedAt: string;
  roleName?: string | null;
  cards: readonly MemorySurfaceCard[];
  proposals: readonly MemorySurfaceProposal[];
  injections: readonly MemorySurfaceInjection[];
}): Record<string, unknown> {
  const acceptedCards = params.cards.filter((card) => isAcceptedMemoryStatus(card.status));
  const candidateProposals = params.proposals.filter(isCandidateMemoryProposal);
  const reviewedProposals = params.proposals.filter((proposal) => !isCandidateMemoryProposal(proposal));

  return {
    schemaVersion: MEMORY_EXPORT_SCHEMA_VERSION,
    generatedAt: params.generatedAt,
    productSurface: MEMORY_SURFACE_SEMANTICS,
    roleName: params.roleName ?? null,
    counts: {
      accepted: acceptedCards.length,
      candidates: candidateProposals.length,
      proposalHistory: reviewedProposals.length,
      injections: params.injections.length,
    },
    acceptedMemory: acceptedCards,
    candidateQueue: candidateProposals,
    proposalHistory: reviewedProposals,
    injectionHistory: params.injections,
  };
}
