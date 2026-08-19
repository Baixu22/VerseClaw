/**
 * KS-03: adapter contracts shared by Main and renderer. Canonical payloads
 * stay with domain owners; adapters receive ContextRef-like references and
 * an EffectReceipt-capable grant rather than raw store handles.
 */

export type ContextRefV1 = {
  schema: "ContextRef/v1";
  refId: string;
  owner: "memory-wiki" | "memory-slot" | "sekb" | "task-ledger" | "session" | "archive";
  subjectKind: "wiki-page" | "memory-card" | "experience-principle" | "task-context" | "transcript" | "artifact";
  subjectId: string;
  revision: string;
  contentDigest: string;
  scope?: {
    workspaceId?: string;
    agentId?: string;
    roleTags?: string[];
    sessionKey?: string;
    taskId?: string;
  };
  trust: "untrusted" | "advisory" | "confirmed" | "high-trust";
  sensitivity: "public" | "workspace" | "sensitive" | "secret-adjacent" | "secret";
  retention: {
    policy: "source-coupled" | "promoted" | "ephemeral" | "legal-hold";
    expiresAt?: string;
  };
  acl: { read: string[] };
  provenance: {
    sourceRefs: string[];
    evidenceRefs: string[];
    derivedFrom?: string[];
  };
};

export type GovernanceProposalV1 = {
  schema: "GovernanceProposal/v1";
  proposalId: string;
  reviewBundleId: string;
  candidateId: string;
  operation: "create" | "update" | "merge" | "archive" | "revoke" | "delete" | "restore";
  targetOwner: "memory-wiki" | "memory-slot" | "sekb";
  targetRef?: ContextRefV1;
  expectedRevision?: string;
  contentDigest: string;
  captureKey?: string;
  sourceRefs: string[];
  evidenceRefs: string[];
  scope?: ContextRefV1["scope"];
  sensitivity: ContextRefV1["sensitivity"];
  retentionPolicy: ContextRefV1["retention"]["policy"];
  policyDecision: "allow" | "needs-review" | "reject";
  status: "pending" | "reviewing" | "approved" | "rejected" | "committing" | "committed" | "commit-failed";
  approval?: { actorId: string; decidedAt: string; reviewedDigest: string };
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};

export type CapabilityGrant = {
  grantId: string;
  proposalId: string;
  targetOwner: ContextRefV1["owner"];
  allowedOperations: GovernanceProposalV1["operation"][];
  expiresAt: string;
  policyDigest: string;
};

export type EffectReceipt = {
  receiptId: string;
  idempotencyKey: string;
  owner: ContextRefV1["owner"];
  operation: GovernanceProposalV1["operation"];
  status: "committed" | "compensated" | "unrecoverable";
  subjectId: string;
  subjectRevision: string;
  contentDigest: string;
  committedAt: string;
  evidenceRefs: string[];
};

export type MaterializedContext = {
  ref: ContextRefV1;
  content: string;
  materializedAt: string;
  grant: CapabilityGrant;
};

export type MutationPlan = {
  planId: string;
  proposal: GovernanceProposalV1;
  owner: ContextRefV1["owner"];
  preparedAt: string;
  steps: Array<{ kind: string; description: string; idempotencyKey: string }>;
};

export type MutationResult = {
  success: boolean;
  receipt?: EffectReceipt;
  conflict?: { code: string; reason: string };
};

export type CompensationResult = {
  status: "compensated" | "partial" | "unrecoverable";
  receipt: EffectReceipt;
  reason?: string;
};

export type ProjectionResult = {
  sourceRef: ContextRefV1;
  projectionId: string;
  status: "rebuilt" | "noop";
  rebuiltAt: string;
};

export type InvalidationResult = {
  sourceRef: ContextRefV1;
  invalidatedIds: string[];
  reason: string;
  invalidatedAt: string;
};

export interface ContextSourceAdapter {
  descriptor(): { owner: ContextRefV1["owner"]; schema: "ContextSourceAdapter/v1" };
  search(query: { text: string; limit?: number; scope?: ContextRefV1["scope"] }): Promise<ContextRefV1[]>;
  materialize(ref: ContextRefV1, grant: CapabilityGrant): Promise<MaterializedContext>;
}

export interface GovernedTargetAdapter {
  descriptor(): { owner: ContextRefV1["owner"]; schema: "GovernedTargetAdapter/v1" };
  prepare(proposal: GovernanceProposalV1): Promise<MutationPlan>;
  commit(plan: MutationPlan, grant: CapabilityGrant): Promise<MutationResult>;
  compensate(receipt: EffectReceipt): Promise<CompensationResult>;
  enumerateBySource(sourceRef: string): Promise<ContextRefV1[]>;
}

export interface ProjectionAdapter {
  descriptor(): { schema: "ProjectionAdapter/v1" };
  rebuild(source: ContextRefV1): Promise<ProjectionResult>;
  invalidateBySource(source: ContextRefV1, reason: string): Promise<InvalidationResult>;
}
