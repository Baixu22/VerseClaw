import type {
  MemoryCard,
  MemoryCardDurability,
  MemoryCardScope,
  MemoryCardSensitivity,
  MemoryCardSource,
  MemoryCardType,
  MemoryConflict,
  MemoryConflictType,
  MemoryGatekeeperDecision,
  MemoryPhaseTag,
  MemoryProposal,
} from "./types.js";
import {
  evaluateMemoryPolicy,
  inferOwnerRole,
  inferSourceRole,
  normalizeAllowedMutators,
  normalizeApplicableRoles,
  normalizeMemoryType,
} from "./memory-policy.js";

export type MemoryGatekeeperOptions = {
  now?: Date;
  idFactory?: () => string;
  minConfidence?: number;
  actor?: import("./types.js").MemoryAuditActor;
  operation?: import("./types.js").MemoryProposalOperation;
  target?: MemoryCard | null;
};

const LOW_CONFIDENCE_REJECT_THRESHOLD = 0.45;
const AUTO_ACCEPT_CONFIDENCE_THRESHOLD = 0.7;
const HIGH_IMPORTANCE_REVIEW_THRESHOLD = 0.8;

const VALID_TYPES = new Set<MemoryCardType>([
  "project_fact",
  "role_experience",
  "episodic",
  "procedural",
  "artifact_ref",
  "fact",
  "constraint",
  "preference",
  "procedure",
  "risk",
  "decision",
  "episode",
  "handoff",
]);
const VALID_SCOPES = new Set<MemoryCardScope>([
  "global",
  "project",
  "workspace",
  "agent",
  "team",
  "role",
  "session",
  "task",
  "user",
]);
const VALID_SENSITIVITY = new Set<MemoryCardSensitivity>([
  "normal",
  "sensitive",
  "secret_adjacent",
  "secret",
]);
const VALID_DURABILITY = new Set<MemoryCardDurability>([
  "ephemeral",
  "session",
  "project",
  "long_term",
]);
const VALID_SOURCE = new Set<MemoryCardSource>([
  "user",
  "role",
  "system",
  "trace",
  "session_summary",
]);
const VALID_PHASES = new Set<MemoryPhaseTag>([
  "plan",
  "implement",
  "test",
  "review",
  "security",
  "docs",
  "handoff",
]);

function defaultIdFactory(): string {
  return `mem_${Date.now().toString(36)}`;
}

function normalizeScore(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeStringArray(value: readonly string[] | undefined): string[] {
  return [...new Set((value ?? []).map((entry) => entry.trim()).filter(Boolean))];
}

function normalizeType(value: unknown): MemoryCardType {
  const normalized = normalizeMemoryType(value);
  return VALID_TYPES.has(normalized as MemoryCardType) ? (normalized as MemoryCardType) : "fact";
}

function normalizeScope(value: unknown): MemoryCardScope {
  const raw = typeof value === "string" ? value.trim() : "";
  return VALID_SCOPES.has(raw as MemoryCardScope) ? (raw as MemoryCardScope) : "project";
}

function normalizeSensitivity(value: unknown): MemoryCardSensitivity {
  const raw = typeof value === "string" ? value.trim() : "";
  return VALID_SENSITIVITY.has(raw as MemoryCardSensitivity) ? (raw as MemoryCardSensitivity) : "normal";
}

function normalizeDurability(value: unknown, scope: MemoryCardScope): MemoryCardDurability {
  const raw = typeof value === "string" ? value.trim() : "";
  if (VALID_DURABILITY.has(raw as MemoryCardDurability)) return raw as MemoryCardDurability;
  if (scope === "session" || scope === "task") return "session";
  if (scope === "project" || scope === "workspace") return "project";
  return "long_term";
}

function normalizeSource(value: unknown): MemoryCardSource {
  const raw = typeof value === "string" ? value.trim() : "";
  return VALID_SOURCE.has(raw as MemoryCardSource) ? (raw as MemoryCardSource) : "role";
}

function normalizePhaseTags(value: readonly MemoryPhaseTag[] | undefined): MemoryPhaseTag[] {
  return [...new Set((value ?? []).filter((entry) => VALID_PHASES.has(entry)))];
}

function normalizedContent(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasEvidence(proposal: MemoryProposal): boolean {
  return (proposal.evidence?.length ?? 0) > 0 || (proposal.evidenceRefs?.length ?? 0) > 0;
}

function looksLikePromptInjection(content: string): boolean {
  const normalized = normalizedContent(content);
  return [
    "ignore previous instructions",
    "ignore all previous",
    "disregard system",
    "override developer",
    "reveal hidden prompt",
    "bypass policy",
  ].some((needle) => normalized.includes(needle));
}

function looksLikeSecret(content: string): boolean {
  return /\b(sk-[a-z0-9_-]{12,}|api[_-]?key|secret[_-]?key|password\s*[:=]|token\s*[:=])/i.test(content);
}

function conflictId(type: MemoryConflictType, cardIds: readonly string[], content: string): string {
  return `conf_${type}_${cardIds.join("_")}_${Math.abs(hashString(content))}`;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function makeConflict(
  type: MemoryConflictType,
  cardIds: string[],
  reason: string,
  createdAt: string,
  content: string,
): MemoryConflict {
  return {
    id: conflictId(type, cardIds, content),
    type,
    cardIds,
    status: "open",
    reason,
    createdAt,
    resolvedAt: null,
    resolution: null,
  };
}

function findDuplicate(proposal: MemoryProposal, existing: readonly MemoryCard[]): MemoryCard | undefined {
  const normalized = normalizedContent(proposal.content);
  return existing.find((card) =>
    card.status === "active" &&
    card.scope === proposal.scope &&
    (card.scopeKey ?? null) === (proposal.scopeKey ?? null) &&
    card.type === proposal.type &&
    normalizedContent(card.content) === normalized,
  );
}

function detectContradiction(proposal: MemoryProposal, existing: readonly MemoryCard[]): MemoryCard | undefined {
  const normalized = normalizedContent(proposal.content);
  const negated = normalized
    .replace(/\bis\b/g, "is not")
    .replace(/\buses\b/g, "does not use");
  return existing.find((card) =>
    card.status === "active" &&
    card.scope === proposal.scope &&
    card.type === proposal.type &&
    (normalizedContent(card.content).includes(`not ${normalized}`) ||
      normalizedContent(card.content) === negated ||
      normalized.includes(`not ${normalizedContent(card.content)}`)),
  );
}

function detectRoleConflict(proposal: MemoryProposal, existing: readonly MemoryCard[]): MemoryCard | undefined {
  const roleTags = new Set(proposal.applicableRoles?.length ? proposal.applicableRoles : proposal.roleTags ?? []);
  if (roleTags.size === 0) return undefined;
  return existing.find((card) =>
    card.status === "active" &&
    card.type === proposal.type &&
    card.scope === proposal.scope &&
    (card.applicableRoles?.length ?? card.roleTags.length) > 0 &&
    !(card.applicableRoles?.length ? card.applicableRoles : card.roleTags).some((role) => roleTags.has(role) || role === "*" || roleTags.has("*")) &&
    normalizedContent(card.content) === normalizedContent(proposal.content),
  );
}

function withPolicy(
  decision: MemoryGatekeeperDecision,
  policy: ReturnType<typeof evaluateMemoryPolicy>,
): MemoryGatekeeperDecision {
  return {
    ...decision,
    riskLevel: policy.riskLevel,
    impactScope: policy.impactScope,
    suggestedAction: policy.suggestedAction,
    reasonSummary: policy.reasonSummary,
    permissionDecision: policy.permissionDecision,
    permissionReason: policy.permissionReason,
  };
}

function detectScopeConflict(proposal: MemoryProposal, existing: readonly MemoryCard[]): MemoryCard | undefined {
  if (!["user", "workspace", "project"].includes(proposal.scope)) return undefined;
  return existing.find((card) =>
    card.status === "active" &&
    card.type === proposal.type &&
    card.scope !== proposal.scope &&
    normalizedContent(card.content) === normalizedContent(proposal.content),
  );
}

export function normalizeMemoryProposal(proposal: MemoryProposal): MemoryProposal {
  const scope = normalizeScope(proposal.scope);
  return {
    ...proposal,
    type: normalizeType(proposal.type),
    scope,
    scopeKey: typeof proposal.scopeKey === "string" && proposal.scopeKey.trim() ? proposal.scopeKey.trim() : null,
    content: proposal.content.trim(),
    roleTags: normalizeStringArray(proposal.roleTags),
    ownerRole: inferOwnerRole(proposal),
    sourceRole: inferSourceRole(proposal),
    applicableRoles: normalizeApplicableRoles(proposal),
    allowedMutators: normalizeAllowedMutators(proposal),
    phaseTags: normalizePhaseTags(proposal.phaseTags),
    evidence: normalizeStringArray(proposal.evidence),
    evidenceRefs: proposal.evidenceRefs ?? [],
    confidence: normalizeScore(proposal.confidence, 0.7),
    importance: normalizeScore(proposal.importance, 0.5),
    sensitivity: normalizeSensitivity(proposal.sensitivity),
    durability: normalizeDurability(proposal.durability, scope),
    source: normalizeSource(proposal.source),
  };
}

export function reviewMemoryProposal(
  proposal: MemoryProposal,
  existing: readonly MemoryCard[] = [],
  options: MemoryGatekeeperOptions = {},
): MemoryGatekeeperDecision {
  const normalizedProposal = normalizeMemoryProposal(proposal);
  const policy = evaluateMemoryPolicy(normalizedProposal, {
    actor: options.actor,
    operation: options.operation ?? normalizedProposal.operation,
    target: options.target,
  });
  const content = normalizedProposal.content;
  if (!content) {
    return withPolicy({ action: "reject", accepted: false, reason: "Memory proposal content is empty." }, policy);
  }
  const confidence = normalizeScore(normalizedProposal.confidence, 0.7);
  const minConfidence = options.minConfidence ?? LOW_CONFIDENCE_REJECT_THRESHOLD;
  if (confidence < minConfidence) {
    return withPolicy({ action: "reject", accepted: false, reason: "Memory proposal confidence is below threshold." }, policy);
  }
  if (looksLikePromptInjection(content)) {
    return withPolicy({ action: "reject", accepted: false, reason: "Memory proposal looks like prompt-injection guidance." }, policy);
  }
  if (normalizedProposal.sensitivity === "secret" || looksLikeSecret(content)) {
    return withPolicy({ action: "reject", accepted: false, reason: "Secret-like memory content must not be stored." }, policy);
  }
  if (policy.permissionDecision === "reject") {
    const conflict = makeConflict("permission_conflict", [], policy.permissionReason, (options.now ?? new Date()).toISOString(), content);
    return withPolicy({ action: "reject", accepted: false, reason: policy.permissionReason, conflicts: [conflict] }, policy);
  }
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  if (policy.permissionDecision === "needs_review") {
    const conflict = makeConflict("permission_conflict", [], policy.permissionReason, nowIso, content);
    return withPolicy({ action: "needs_review", accepted: false, reason: policy.permissionReason, conflicts: [conflict] }, policy);
  }
  if (confidence < AUTO_ACCEPT_CONFIDENCE_THRESHOLD) {
    const conflict = makeConflict("stale_conflict", [], "Memory proposal confidence needs review before activation.", nowIso, content);
    return withPolicy({ action: "needs_review", accepted: false, reason: conflict.reason, conflicts: [conflict] }, policy);
  }
  const duplicate = findDuplicate(normalizedProposal, existing);
  if (duplicate) {
    const conflict = makeConflict("duplicate", [duplicate.id], `Memory already exists: ${duplicate.id}`, nowIso, content);
    return withPolicy({
      action: "needs_review",
      accepted: false,
      reason: conflict.reason,
      targetId: duplicate.id,
      conflicts: [conflict],
    }, policy);
  }
  const conflicts = [
    detectContradiction(normalizedProposal, existing)
      ? makeConflict("contradiction", [detectContradiction(normalizedProposal, existing)!.id], "Memory appears to contradict an active card.", nowIso, content)
      : undefined,
    detectScopeConflict(normalizedProposal, existing)
      ? makeConflict("scope_conflict", [detectScopeConflict(normalizedProposal, existing)!.id], "Memory overlaps a higher/lower scope card and needs review.", nowIso, content)
      : undefined,
    detectRoleConflict(normalizedProposal, existing)
      ? makeConflict("role_conflict", [detectRoleConflict(normalizedProposal, existing)!.id], "Memory overlaps another role's active card and needs review.", nowIso, content)
      : undefined,
    normalizedProposal.sensitivity === "sensitive" || normalizedProposal.sensitivity === "secret_adjacent"
      ? makeConflict("sensitive_review", [], "Sensitive memory requires explicit review.", nowIso, content)
      : undefined,
  ].filter((conflict): conflict is MemoryConflict => Boolean(conflict));
  if (conflicts.length > 0) {
    return withPolicy({
      action: "needs_review",
      accepted: false,
      reason: conflicts[0]?.reason,
      conflicts,
    }, policy);
  }
  if (
    (normalizedProposal.importance ?? 0) >= HIGH_IMPORTANCE_REVIEW_THRESHOLD &&
    !hasEvidence(normalizedProposal)
  ) {
    const conflict = makeConflict("stale_conflict", [], "High-importance memory without evidence needs review.", nowIso, content);
    return withPolicy({ action: "needs_review", accepted: false, reason: conflict.reason, conflicts: [conflict] }, policy);
  }
  const card: MemoryCard = {
    id: options.idFactory?.() ?? defaultIdFactory(),
    type: normalizedProposal.type,
    scope: normalizedProposal.scope,
    scopeKey: normalizedProposal.scopeKey,
    roleTags: normalizedProposal.roleTags ?? [],
    ownerRole: normalizedProposal.ownerRole,
    sourceRole: normalizedProposal.sourceRole,
    applicableRoles: normalizedProposal.applicableRoles,
    allowedMutators: normalizedProposal.allowedMutators,
    phaseTags: normalizedProposal.phaseTags,
    content,
    evidence: normalizedProposal.evidence ?? [],
    evidenceRefs: normalizedProposal.evidenceRefs,
    confidence,
    importance: normalizeScore(normalizedProposal.importance, 0.5),
    lastAccessedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    accessCount: 0,
    version: 1,
    status: "active",
    sensitivity: normalizedProposal.sensitivity,
    durability: normalizedProposal.durability,
    source: normalizedProposal.source,
    supersedes: null,
    supersededBy: null,
    expiresAt: normalizedProposal.expiresAt ?? null,
  };
  return withPolicy({ action: "accept", accepted: true, card }, policy);
}

export function commitMemoryProposal(
  proposal: MemoryProposal,
  existing: readonly MemoryCard[] = [],
  options: MemoryGatekeeperOptions = {},
): { cards: MemoryCard[]; decision: MemoryGatekeeperDecision } {
  const decision = reviewMemoryProposal(proposal, existing, options);
  return {
    cards: decision.card ? [...existing, decision.card] : [...existing],
    decision,
  };
}
