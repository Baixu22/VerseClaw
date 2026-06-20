import type {
  MemoryAuditActor,
  MemoryCard,
  MemoryCardScope,
  MemoryCardType,
  MemoryInjectionClass,
  MemoryPermissionDecision,
  MemoryPhaseTag,
  MemoryProposal,
  MemoryProposalOperation,
  MemoryRetentionAction,
  MemoryRetentionCandidate,
  MemoryRiskLevel,
  MemorySemanticCardType,
  MemorySuggestedAction,
  MemoryEvidenceStatus,
} from "./types.js";
import { isMemoryCardExpired } from "./memory-card.js";

export const MEMORY_GOVERNANCE_POLICY_VERSION = "role-memory-governance-v4" as const;
export const MEMORY_CONTEXT_POLICY_VERSION = "role-memory-context-v3" as const;

export const SEMANTIC_MEMORY_TYPES: readonly MemorySemanticCardType[] = [
  "fact",
  "constraint",
  "preference",
  "procedure",
  "risk",
  "decision",
  "episode",
  "handoff",
  "artifact_ref",
];

const LEGACY_TYPE_MAP: Record<string, MemorySemanticCardType> = {
  project_fact: "fact",
  role_experience: "procedure",
  episodic: "episode",
  procedural: "procedure",
  artifact_ref: "artifact_ref",
  fact: "fact",
  constraint: "constraint",
  preference: "preference",
  procedure: "procedure",
  risk: "risk",
  decision: "decision",
  episode: "episode",
  handoff: "handoff",
};

const SCOPE_IMPACT: Record<MemoryCardScope, number> = {
  global: 5,
  user: 5,
  workspace: 4,
  project: 3,
  agent: 2,
  team: 2,
  role: 1,
  session: 0,
  task: 0,
};

const RETENTION_TYPE_WEIGHT: Record<string, number> = {
  constraint: 1,
  decision: 0.95,
  risk: 0.8,
  procedure: 0.75,
  preference: 0.65,
  fact: 0.6,
  handoff: 0.45,
  artifact_ref: 0.4,
  episode: 0.3,
};

export type MemoryPolicyEvaluation = {
  permissionDecision: MemoryPermissionDecision;
  permissionReason: string;
  riskLevel: MemoryRiskLevel;
  impactScope: MemoryCardScope;
  suggestedAction: MemorySuggestedAction;
  reasonSummary: string;
};

export function normalizeMemoryType(type: unknown): MemoryCardType {
  const raw = typeof type === "string" ? type.trim() : "";
  return LEGACY_TYPE_MAP[raw] ?? "fact";
}

export function semanticMemoryType(type: MemoryCardType | string | undefined): MemorySemanticCardType {
  return normalizeMemoryType(type) as MemorySemanticCardType;
}

export function normalizeApplicableRoles(proposal: Pick<MemoryProposal, "applicableRoles" | "roleTags">): string[] {
  const values = proposal.applicableRoles?.length ? proposal.applicableRoles : proposal.roleTags;
  return [...new Set((values ?? []).map((entry) => entry.trim()).filter(Boolean))];
}

export function normalizeAllowedMutators(proposal: Pick<MemoryProposal, "allowedMutators" | "source">): string[] {
  if (proposal.allowedMutators?.length) {
    return [...new Set(proposal.allowedMutators.map((entry) => entry.trim()).filter(Boolean))];
  }
  if (proposal.source === "user") return ["user", "operator"];
  if (proposal.source === "system") return ["operator", "system"];
  return ["ownerRole", "operator"];
}

export function inferOwnerRole(proposal: Pick<MemoryProposal, "ownerRole" | "roleTags" | "applicableRoles">): string | null {
  return proposal.ownerRole ?? proposal.roleTags?.[0] ?? proposal.applicableRoles?.find((role) => role !== "*") ?? null;
}

export function inferSourceRole(proposal: Pick<MemoryProposal, "sourceRole" | "source" | "roleTags">): string | null {
  return proposal.sourceRole ?? (proposal.source === "role" ? proposal.roleTags?.[0] ?? null : null);
}

function riskFromScore(score: number): MemoryRiskLevel {
  if (score >= 7) return "critical";
  if (score >= 5) return "high";
  if (score >= 3) return "medium";
  return "low";
}

function actorKind(actor: MemoryAuditActor | undefined, proposal: MemoryProposal): "user" | "operator" | "role" | "system" | "trace" {
  if (actor?.type === "user") return "operator";
  if (actor?.type === "system") return "system";
  if (proposal.source === "user") return "user";
  if (proposal.source === "trace" || proposal.source === "session_summary") return "trace";
  if (proposal.source === "system") return "system";
  return "role";
}

export function evaluateMemoryPolicy(
  proposal: MemoryProposal,
  params?: { actor?: MemoryAuditActor; operation?: MemoryProposalOperation; target?: MemoryCard | null },
): MemoryPolicyEvaluation {
  const type = semanticMemoryType(proposal.type);
  const scope = proposal.scope;
  const operation = params?.operation ?? proposal.operation ?? "create";
  const actor = actorKind(params?.actor, proposal);
  let riskScore = SCOPE_IMPACT[scope] ?? 2;
  if (type === "constraint" || type === "decision") riskScore += 2;
  if (proposal.sensitivity === "secret" || proposal.sensitivity === "secret_adjacent") riskScore += 3;
  else if (proposal.sensitivity === "sensitive") riskScore += 2;
  if (operation === "supersede" || operation === "tombstone") riskScore += 1;
  if (operation === "update" && type === "decision") riskScore += 2;

  let permissionDecision: MemoryPermissionDecision = "allow";
  let permissionReason = "Low-risk memory mutation is allowed by policy.";
  let suggestedAction: MemorySuggestedAction = "approve";

  if (actor === "role" && (scope === "workspace" || scope === "user")) {
    permissionDecision = type === "constraint" || operation !== "create" ? "reject" : "needs_review";
    permissionReason = "Role-authored memory cannot directly control user/workspace scope.";
    suggestedAction = permissionDecision === "reject" ? "reject" : "applyAsCold";
    riskScore += 2;
  } else if (actor === "role" && scope === "project") {
    permissionDecision = "needs_review";
    permissionReason = "Role-authored project memory requires review.";
    suggestedAction = "applyAsCold";
    riskScore += 1;
  } else if (actor === "trace" && operation !== "create") {
    permissionDecision = "needs_review";
    permissionReason = "Trace/session summaries cannot mutate existing memory without review.";
    suggestedAction = "applyAsCold";
    riskScore += 1;
  } else if (actor === "system" && scope === "global") {
    permissionDecision = "needs_review";
    permissionReason = "Global/system-like memory is restricted and requires operator review.";
    suggestedAction = "reject";
    riskScore += 2;
  } else if (operation === "update" && type === "decision") {
    permissionDecision = "needs_review";
    permissionReason = "Decision memory should be superseded instead of silently updated.";
    suggestedAction = "supersede";
  }

  const riskLevel = riskFromScore(riskScore);
  const reasonSummary = `${riskLevel} risk ${operation} on ${scope} ${type}`;
  return {
    permissionDecision,
    permissionReason,
    riskLevel,
    impactScope: scope,
    suggestedAction,
    reasonSummary,
  };
}

export function roleAppliesToCard(card: Pick<MemoryCard, "applicableRoles" | "roleTags">, roleName?: string): boolean {
  if (!roleName) return true;
  const roles = card.applicableRoles?.length ? card.applicableRoles : card.roleTags;
  if (roles.length === 0) return true;
  return roles.includes("*") || roles.includes(roleName);
}

export function classifyInjectionCandidate(params: {
  card: MemoryCard;
  roleName?: string;
  phase?: MemoryPhaseTag;
  taskMatch: number;
  conflict: boolean;
  expired: boolean;
}): { injectionClass: MemoryInjectionClass; reason: string; whatWouldSelect?: string } {
  const { card, phase, taskMatch, conflict, expired } = params;
  const type = semanticMemoryType(card.type);
  if (card.status === "archived" || card.status === "tombstone" || card.supersededBy || expired || card.sensitivity === "secret") {
    return {
      injectionClass: "never",
      reason: "Memory is not injectable because it is inactive, expired, superseded, or secret.",
      whatWouldSelect: expired ? "Create a fresh proposal with current evidence." : undefined,
    };
  }
  if (type === "constraint" && card.status === "active") {
    return { injectionClass: "must", reason: `Injected as a must ${card.scope} constraint.` };
  }
  if (conflict) {
    return { injectionClass: "must", reason: "Relevant open conflict is surfaced for review." };
  }
  if (type === "decision" && card.importance >= 0.7) {
    return { injectionClass: "should", reason: "Important decision memory should guide this role." };
  }
  if (type === "procedure" && roleAppliesToCard(card, params.roleName)) {
    return { injectionClass: "should", reason: "Role-matched procedure should guide execution." };
  }
  if (type === "risk" && (phase === "review" || phase === "security" || phase === "test")) {
    return { injectionClass: "should", reason: "Risk memory is relevant to the current phase." };
  }
  if ((type === "fact" || type === "handoff") && taskMatch >= 0.45) {
    return { injectionClass: "should", reason: "Task-matched fact or handoff should be available." };
  }
  if (card.status === "cold" && taskMatch < 0.75) {
    return {
      injectionClass: "may",
      reason: "Cold memory needs stronger task match before injection.",
      whatWouldSelect: "Mention more of this memory's key terms in the task or raise its importance.",
    };
  }
  return {
    injectionClass: "may",
    reason: "Memory is optional and competes for remaining context budget.",
    whatWouldSelect: taskMatch < 0.3 ? "Would be selected more often with a stronger task match or higher importance." : undefined,
  };
}

export function evaluateRetentionCandidate(card: MemoryCard, now = new Date()): MemoryRetentionCandidate {
  const labels: string[] = [];
  const updated = Date.parse(card.updatedAt ?? card.createdAt);
  const ageDays = Number.isFinite(updated) ? Math.max(0, (now.getTime() - updated) / 86_400_000) : 0;
  const recency = Math.max(0, 1 - ageDays / 180);
  const accessFrequency = Math.min(1, card.accessCount / 10);
  const evidenceStrength = Math.min(1, ((card.evidence?.length ?? 0) + (card.evidenceRefs?.length ?? 0)) / 3);
  const type = semanticMemoryType(card.type);
  const typeWeight = RETENTION_TYPE_WEIGHT[type] ?? 0.5;
  const expired = isMemoryCardExpired(card, now);
  if (expired) labels.push("Expires soon");
  if (ageDays > 120) labels.push("Likely stale");
  if (card.accessCount <= 1) labels.push("Rarely used");
  if (type === "constraint" || type === "decision" || card.importance >= 0.8) labels.push("Still important");
  const sensitivityPenalty = card.sensitivity === "secret" || card.sensitivity === "secret_adjacent" ? 0.2 : 0;
  const retentionScore = Number((
    card.importance * 0.3 +
    card.confidence * 0.2 +
    evidenceStrength * 0.15 +
    accessFrequency * 0.15 +
    recency * 0.1 +
    typeWeight * 0.1 -
    (ageDays > 180 ? 0.2 : 0) -
    sensitivityPenalty
  ).toFixed(4));
  let recommendedAction: MemoryRetentionAction = "keep";
  let reason = "Memory remains useful.";
  if (expired && (card.scope === "session" || card.scope === "task")) {
    recommendedAction = "tombstone";
    reason = "Expired task/session memory should be tombstoned.";
  } else if ((type === "constraint" || type === "decision") && (ageDays > 180 || card.status === "cold")) {
    recommendedAction = "review";
    reason = "Important governance memory looks stale and should be reviewed, not auto-archived.";
  } else if (card.status === "active" && retentionScore < 0.45) {
    recommendedAction = "cold";
    reason = "Low-use active memory should be cooled before archival.";
  } else if (card.status === "cold" && retentionScore < 0.35) {
    recommendedAction = "archive";
    reason = "Long-unused cold memory can be archived.";
  }
  return { card: { ...card, retentionLabels: labels }, recommendedAction, retentionScore, labels, reason };
}

export function getMemoryPolicySnapshot() {
  return {
    version: MEMORY_GOVERNANCE_POLICY_VERSION,
    contextPolicyVersion: MEMORY_CONTEXT_POLICY_VERSION,
    semanticTypes: SEMANTIC_MEMORY_TYPES,
    injectionClasses: ["must", "should", "may", "never"] as const,
    lifecyclePolicy: {
      automaticMutation: false,
      allowedActions: ["keep", "cold", "archive", "tombstone", "review"] as readonly MemoryRetentionAction[],
    },
    evidencePolicy: {
      nativeBridge: "read_only" as const,
      statuses: ["verified", "missing", "stale", "weak", "contradicted", "unchecked"] as readonly MemoryEvidenceStatus[],
    },
    batchReviewPolicy: {
      partialFailure: "continue" as const,
      mutatingActions: ["approve", "reject", "applyAsCold", "supersede", "merge"] as const,
    },
  };
}
