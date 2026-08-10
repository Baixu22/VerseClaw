// Role-first memory control-plane store.
//
// This is intentionally separate from memorySearch/QMD/MEMORY.md. The native
// memory engine remains the source/retrieval layer; this store owns structured
// role memory cards, review conflicts, audit history, and injection explain logs.

import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { resolveStateDir } from "../config/paths.js";
import { redactSecrets } from "../logging/redact.js";
import { normalizeMemoryProposal, reviewMemoryProposal } from "./gatekeeper.js";
import {
  filterCardsForModelInjection,
  resolveMemoryDualGateConfig,
  revokePoisonedMemory,
} from "./memory-dual-gate.js";
import { evaluateMemoryPolicy, evaluateRetentionCandidate, getMemoryPolicySnapshot, roleAppliesToCard } from "./memory-policy.js";
import { buildContextPack } from "./context-pack.js";
import { isMemoryCardInContextScope, type MemoryCardScopeContext } from "./memory-card.js";
import type {
  ContextPack,
  MemoryAuditActor,
  MemoryAuditEvent,
  MemoryCard,
  MemoryCardScope,
  MemoryCardSensitivity,
  MemoryCardStatus,
  MemoryCardType,
  MemoryConflict,
  MemoryConflictDetail,
  MemoryEvidenceCheckResult,
  MemoryEvidenceRef,
  MemoryEvidenceStatus,
  MemoryFeedbackOutcome,
  MemoryFeedbackRecord,
  MemoryGatekeeperDecision,
  MemoryHealthReport,
  MemoryInjectionRecord,
  MemoryInjectionSimulation,
  MemoryMergeDraft,
  MemoryPhaseTag,
  MemoryProposal,
  MemoryProposalOperation,
  MemoryProposalPreview,
  MemoryProposalRecord,
  MemoryProposalStatus,
  MemoryRetentionAction,
  MemoryRetentionCandidate,
  MemoryReviewAction,
  MemorySuggestedAction,
  MemoryTaskSuccess,
  MemoryUtilityCardReport,
  MemoryUtilityReport,
  MemoryReviewBatchResult,
  MemoryVersionRecord,
} from "./types.js";

const DEFAULT_DB_FILENAME = "role-memory.sqlite";

let storePath: string | undefined;
let database: DatabaseSync | undefined;

type CardRow = {
  id: string;
  type: MemoryCardType;
  scope_kind: MemoryCardScope;
  scope_key: string | null;
  role_tags_json: string;
  owner_role: string | null;
  source_role: string | null;
  applicable_roles_json: string | null;
  allowed_mutators_json: string | null;
  phase_tags_json: string;
  content: string;
  evidence_json: string;
  evidence_refs_json: string;
  confidence: number;
  importance: number;
  status: MemoryCardStatus;
  sensitivity: MemoryCardSensitivity;
  durability: MemoryCard["durability"];
  source: MemoryCard["source"];
  version: number;
  supersedes: string | null;
  superseded_by: string | null;
  correction_ref: string | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
  access_count: number;
  expires_at: string | null;
};

type ConflictRow = {
  id: string;
  type: MemoryConflict["type"];
  card_ids_json: string;
  status: MemoryConflict["status"];
  reason: string;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
};

type ProposalRow = {
  id: string;
  operation: MemoryProposalOperation;
  target_id: string | null;
  proposal_json: string;
  normalized_json: string;
  decision: MemoryGatekeeperDecision["action"];
  status: MemoryProposalStatus;
  review_reason: string | null;
  conflict_ids_json: string;
  actor_json: string;
  risk_level: MemoryProposalRecord["riskLevel"] | null;
  impact_scope: MemoryProposalRecord["impactScope"] | null;
  suggested_action: MemoryProposalRecord["suggestedAction"] | null;
  reason_summary: string | null;
  permission_decision: MemoryProposalRecord["permissionDecision"] | null;
  permission_reason: string | null;
  batch_id: string | null;
  evidence_status: MemoryEvidenceStatus | null;
  retention_reason: string | null;
  policy_snapshot_json: string | null;
  created_at: string;
  decided_at: string | null;
};

type VersionRow = {
  id: string;
  card_id: string;
  version: number;
  snapshot_json: string;
  actor_json: string;
  reason: string | null;
  created_at: string;
};

type AuditRow = {
  id: string;
  action: string;
  card_id: string | null;
  actor_json: string;
  reason: string | null;
  payload_json: string;
  created_at: string;
};

type InjectionRow = {
  id: string;
  role_name: string;
  task: string | null;
  session_key: string | null;
  card_ids_json: string;
  reasons_json: string;
  budget_json: string;
  estimated_tokens_json: string;
  truncated: number;
  policy_version: string | null;
  selector_snapshot_json: string | null;
  candidate_explanations_json: string | null;
  created_at: string;
};

type FeedbackRow = {
  id: string;
  injection_id: string | null;
  card_id: string | null;
  role_name: string | null;
  outcome: MemoryFeedbackOutcome;
  task_success: MemoryTaskSuccess;
  note: string | null;
  actor_json: string;
  created_at: string;
};

export function setMemoryStorePath(filePath: string): void {
  closeMemoryStore();
  storePath = filePath;
}

export function isMemoryStoreConfigured(): boolean {
  return Boolean(storePath);
}

export function isRoleMemoryEnabled(): boolean {
  return process.env.OPENCLAW_ROLE_MEMORY_ENABLED !== "0";
}

export function resolveRoleMemoryStorePath(): string {
  return storePath ?? path.join(resolveStateDir(), DEFAULT_DB_FILENAME);
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonRecord<T extends Record<string, unknown>>(value: string | null | undefined): T {
  if (!value) return {} as T;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

function parseJsonValue<T = unknown>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function openDatabase(): DatabaseSync {
  if (database?.isOpen) return database;
  const dbPath = resolveRoleMemoryStorePath();
  ensureParentDir(dbPath);
  const { DatabaseSync } = requireNodeSqlite();
  database = new DatabaseSync(dbPath);
  database.exec("PRAGMA busy_timeout = 5000;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS role_memory_cards (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      scope_kind TEXT NOT NULL,
      scope_key TEXT,
      role_tags_json TEXT NOT NULL,
      owner_role TEXT,
      source_role TEXT,
      applicable_roles_json TEXT,
      allowed_mutators_json TEXT,
      phase_tags_json TEXT NOT NULL,
      content TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      importance REAL NOT NULL,
      status TEXT NOT NULL,
      sensitivity TEXT NOT NULL,
      durability TEXT NOT NULL,
      source TEXT NOT NULL,
      version INTEGER NOT NULL,
      supersedes TEXT,
      superseded_by TEXT,
      correction_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL,
      access_count INTEGER NOT NULL,
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_role_memory_cards_scope ON role_memory_cards(scope_kind, scope_key);
    CREATE INDEX IF NOT EXISTS idx_role_memory_cards_status ON role_memory_cards(status);
    CREATE INDEX IF NOT EXISTS idx_role_memory_cards_type ON role_memory_cards(type);
    CREATE INDEX IF NOT EXISTS idx_role_memory_cards_sensitivity ON role_memory_cards(sensitivity);

    CREATE TABLE IF NOT EXISTS role_memory_versions (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_role_memory_versions_card ON role_memory_versions(card_id, version);

    CREATE TABLE IF NOT EXISTS role_memory_conflicts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      card_ids_json TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      resolution TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_role_memory_conflicts_status ON role_memory_conflicts(status);

    CREATE TABLE IF NOT EXISTS role_memory_proposals (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      target_id TEXT,
      proposal_json TEXT NOT NULL,
      normalized_json TEXT NOT NULL,
      decision TEXT NOT NULL,
      status TEXT NOT NULL,
      review_reason TEXT,
      conflict_ids_json TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      risk_level TEXT,
      impact_scope TEXT,
      suggested_action TEXT,
      reason_summary TEXT,
      permission_decision TEXT,
      permission_reason TEXT,
      batch_id TEXT,
      evidence_status TEXT,
      retention_reason TEXT,
      policy_snapshot_json TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_role_memory_proposals_status ON role_memory_proposals(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_role_memory_proposals_operation ON role_memory_proposals(operation, created_at);
    CREATE INDEX IF NOT EXISTS idx_role_memory_proposals_target ON role_memory_proposals(target_id, created_at);

    CREATE TABLE IF NOT EXISTS role_memory_audit_events (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      card_id TEXT,
      actor_json TEXT NOT NULL,
      reason TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_role_memory_audit_card ON role_memory_audit_events(card_id, created_at);

    CREATE TABLE IF NOT EXISTS role_memory_injections (
      id TEXT PRIMARY KEY,
      role_name TEXT NOT NULL,
      task TEXT,
      session_key TEXT,
      card_ids_json TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      budget_json TEXT NOT NULL,
      estimated_tokens_json TEXT NOT NULL,
      truncated INTEGER NOT NULL,
      policy_version TEXT,
      selector_snapshot_json TEXT,
      candidate_explanations_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_role_memory_injections_role ON role_memory_injections(role_name, created_at);

    CREATE TABLE IF NOT EXISTS role_memory_review_batches (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      proposal_ids_json TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      reason TEXT,
      results_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_memory_evidence_checks (
      id TEXT PRIMARY KEY,
      target_kind TEXT NOT NULL,
      target_id TEXT,
      status TEXT NOT NULL,
      refs_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_role_memory_evidence_checks_target ON role_memory_evidence_checks(target_kind, target_id, created_at);

    CREATE TABLE IF NOT EXISTS role_memory_retention_runs (
      id TEXT PRIMARY KEY,
      card_ids_json TEXT NOT NULL,
      action TEXT,
      proposals_json TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_memory_feedback (
      id TEXT PRIMARY KEY,
      injection_id TEXT,
      card_id TEXT,
      role_name TEXT,
      outcome TEXT NOT NULL,
      task_success TEXT NOT NULL,
      note TEXT,
      actor_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_role_memory_feedback_card ON role_memory_feedback(card_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_role_memory_feedback_injection ON role_memory_feedback(injection_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_role_memory_feedback_role ON role_memory_feedback(role_name, created_at);
  `);
  for (const sql of [
    `ALTER TABLE role_memory_injections ADD COLUMN policy_version TEXT`,
    `ALTER TABLE role_memory_injections ADD COLUMN selector_snapshot_json TEXT`,
    `ALTER TABLE role_memory_injections ADD COLUMN candidate_explanations_json TEXT`,
    `ALTER TABLE role_memory_cards ADD COLUMN owner_role TEXT`,
    `ALTER TABLE role_memory_cards ADD COLUMN source_role TEXT`,
    `ALTER TABLE role_memory_cards ADD COLUMN applicable_roles_json TEXT`,
    `ALTER TABLE role_memory_cards ADD COLUMN allowed_mutators_json TEXT`,
    `ALTER TABLE role_memory_cards ADD COLUMN correction_ref TEXT`,
    `ALTER TABLE role_memory_proposals ADD COLUMN risk_level TEXT`,
    `ALTER TABLE role_memory_proposals ADD COLUMN impact_scope TEXT`,
    `ALTER TABLE role_memory_proposals ADD COLUMN suggested_action TEXT`,
    `ALTER TABLE role_memory_proposals ADD COLUMN reason_summary TEXT`,
    `ALTER TABLE role_memory_proposals ADD COLUMN permission_decision TEXT`,
    `ALTER TABLE role_memory_proposals ADD COLUMN permission_reason TEXT`,
    `ALTER TABLE role_memory_proposals ADD COLUMN batch_id TEXT`,
    `ALTER TABLE role_memory_proposals ADD COLUMN evidence_status TEXT`,
    `ALTER TABLE role_memory_proposals ADD COLUMN retention_reason TEXT`,
    `ALTER TABLE role_memory_proposals ADD COLUMN policy_snapshot_json TEXT`,
  ]) {
    try { database.exec(sql); } catch { /* column already exists */ }
  }
  return database;
}

function rowToCard(row: CardRow): MemoryCard {
  const roleTags = parseJsonArray<string>(row.role_tags_json);
  const applicableRoles = parseJsonArray<string>(row.applicable_roles_json);
  return {
    id: row.id,
    type: row.type,
    scope: row.scope_kind,
    scopeKey: row.scope_key,
    roleTags,
    ownerRole: row.owner_role ?? roleTags[0] ?? null,
    sourceRole: row.source_role,
    applicableRoles: applicableRoles.length > 0 ? applicableRoles : roleTags,
    allowedMutators: parseJsonArray<string>(row.allowed_mutators_json),
    phaseTags: parseJsonArray<MemoryPhaseTag>(row.phase_tags_json),
    content: row.content,
    evidence: parseJsonArray<string>(row.evidence_json),
    evidenceRefs: parseJsonArray(row.evidence_refs_json),
    confidence: row.confidence,
    importance: row.importance,
    status: row.status,
    sensitivity: row.sensitivity,
    durability: row.durability,
    source: row.source,
    version: row.version,
    supersedes: row.supersedes,
    supersededBy: row.superseded_by,
    correctionRef: row.correction_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    expiresAt: row.expires_at,
  };
}

function cardParams(card: MemoryCard): SQLInputValue[] {
  return [
    card.id,
    card.type,
    card.scope,
    card.scopeKey ?? null,
    json(card.roleTags),
    card.ownerRole ?? null,
    card.sourceRole ?? null,
    json(card.applicableRoles ?? card.roleTags ?? []),
    json(card.allowedMutators ?? []),
    json(card.phaseTags ?? []),
    card.content,
    json(card.evidence),
    json(card.evidenceRefs ?? []),
    card.confidence,
    card.importance,
    card.status,
    card.sensitivity ?? "normal",
    card.durability ?? "long_term",
    card.source ?? "role",
    card.version,
    card.supersedes ?? null,
    card.supersededBy ?? null,
    card.correctionRef ?? null,
    card.createdAt,
    card.updatedAt ?? card.createdAt,
    card.lastAccessedAt,
    card.accessCount,
    card.expiresAt ?? null,
  ];
}

function insertAudit(action: string, cardId: string | null, payload: unknown, actor?: MemoryAuditActor, reason?: string): void {
  const db = openDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO role_memory_audit_events (id, action, card_id, actor_json, reason, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), action, cardId, json(actor ?? { type: "system" }), reason ?? null, json(redactSecrets(payload)), now);
}

function proposalStatusForDecision(decision: MemoryGatekeeperDecision): MemoryProposalStatus {
  if (decision.action === "reject") return "rejected";
  if (decision.action === "needs_review") return "needs_review";
  if (decision.accepted) return "auto_accepted";
  return "pending";
}

function isAutomaticMemoryProposal(proposal: MemoryProposal): boolean {
  return proposal.source === "trace" || proposal.source === "session_summary" || proposal.source === "role" || proposal.source === "system";
}

function reviewGateAutomaticMemoryProposal(decision: MemoryGatekeeperDecision, proposal: MemoryProposal): MemoryGatekeeperDecision {
  if (!isAutomaticMemoryProposal(proposal) || decision.action !== "accept") return decision;
  return {
    ...decision,
    action: "needs_review",
    accepted: false,
    card: undefined,
    reason: "Automatic Role Memory candidates are proposal-only until explicit user review.",
    permissionDecision: "needs_review",
    permissionReason: "Automatic memory capture cannot directly mutate Role Memory or Project Rules.",
    suggestedAction: decision.suggestedAction ?? "approve",
  };
}

function rowToProposal(row: ProposalRow): MemoryProposalRecord {
  return {
    id: row.id,
    operation: row.operation,
    targetId: row.target_id,
    proposal: parseJsonValue<MemoryProposal>(row.proposal_json, {} as MemoryProposal),
    normalized: parseJsonValue<MemoryProposal>(row.normalized_json, {} as MemoryProposal),
    decision: row.decision,
    status: row.status,
    reviewReason: row.review_reason,
    conflictIds: parseJsonArray<string>(row.conflict_ids_json),
    actor: parseJsonValue<MemoryAuditActor>(row.actor_json, { type: "system" }),
    riskLevel: row.risk_level ?? undefined,
    impactScope: row.impact_scope ?? undefined,
    suggestedAction: row.suggested_action ?? undefined,
    reasonSummary: row.reason_summary ?? undefined,
    permissionDecision: row.permission_decision ?? undefined,
    permissionReason: row.permission_reason ?? undefined,
    batchId: row.batch_id,
    evidenceStatus: row.evidence_status ?? undefined,
    retentionReason: row.retention_reason,
    policySnapshot: parseJsonValue(row.policy_snapshot_json, undefined),
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function storeProposalRecord(record: MemoryProposalRecord): MemoryProposalRecord {
  openDatabase().prepare(
    `INSERT INTO role_memory_proposals (
      id, operation, target_id, proposal_json, normalized_json, decision, status, review_reason,
      conflict_ids_json, actor_json, risk_level, impact_scope, suggested_action, reason_summary,
      permission_decision, permission_reason, batch_id, evidence_status, retention_reason, policy_snapshot_json,
      created_at, decided_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      decision=excluded.decision,
      status=excluded.status,
      review_reason=excluded.review_reason,
      conflict_ids_json=excluded.conflict_ids_json,
      risk_level=excluded.risk_level,
      impact_scope=excluded.impact_scope,
      suggested_action=excluded.suggested_action,
      reason_summary=excluded.reason_summary,
      permission_decision=excluded.permission_decision,
      permission_reason=excluded.permission_reason,
      batch_id=excluded.batch_id,
      evidence_status=excluded.evidence_status,
      retention_reason=excluded.retention_reason,
      policy_snapshot_json=excluded.policy_snapshot_json,
      decided_at=excluded.decided_at`,
  ).run(
    record.id,
    record.operation,
    record.targetId ?? null,
    json(record.proposal),
    json(record.normalized ?? record.proposal),
    record.decision,
    record.status,
    record.reviewReason ?? null,
    json(record.conflictIds),
    json(record.actor ?? { type: "system" }),
    record.riskLevel ?? null,
    record.impactScope ?? null,
    record.suggestedAction ?? null,
    record.reasonSummary ?? null,
    record.permissionDecision ?? null,
    record.permissionReason ?? null,
    record.batchId ?? null,
    record.evidenceStatus ?? null,
    record.retentionReason ?? null,
    json(record.policySnapshot ?? getMemoryPolicySnapshot()),
    record.createdAt,
    record.decidedAt ?? null,
  );
  return record;
}

function updateProposalStatus(id: string, status: MemoryProposalStatus, reason?: string | null): void {
  openDatabase().prepare(
    `UPDATE role_memory_proposals SET status = ?, review_reason = COALESCE(?, review_reason), decided_at = ? WHERE id = ?`,
  ).run(status, reason ?? null, new Date().toISOString(), id);
}

function makeProposalRecord(params: {
  operation: MemoryProposalOperation;
  targetId?: string | null;
  proposal: MemoryProposal;
  decision: MemoryGatekeeperDecision;
  actor?: MemoryAuditActor;
  batchId?: string | null;
  evidenceStatus?: MemoryEvidenceStatus;
  retentionReason?: string | null;
  policySnapshot?: unknown;
}): MemoryProposalRecord {
  const now = new Date().toISOString();
  const normalized = normalizeMemoryProposal(params.proposal);
  return {
    id: `prop_${randomUUID()}`,
    operation: params.operation,
    targetId: params.targetId ?? params.proposal.targetId ?? null,
    proposal: redactSecrets(params.proposal),
    normalized: redactSecrets(normalized),
    decision: params.decision.action,
    status: proposalStatusForDecision(params.decision),
    reviewReason: params.decision.reason ?? null,
    conflictIds: (params.decision.conflicts ?? []).map((conflict) => conflict.id),
    actor: params.actor ?? { type: "system" },
    riskLevel: params.decision.riskLevel,
    impactScope: params.decision.impactScope,
    suggestedAction: params.decision.suggestedAction,
    reasonSummary: params.decision.reasonSummary,
    permissionDecision: params.decision.permissionDecision,
    permissionReason: params.decision.permissionReason,
    batchId: params.batchId ?? null,
    evidenceStatus: params.evidenceStatus,
    retentionReason: params.retentionReason ?? null,
    policySnapshot: params.policySnapshot ?? getMemoryPolicySnapshot(),
    createdAt: now,
    decidedAt: params.decision.action === "needs_review" ? null : now,
  };
}

function attachProposal(decision: MemoryGatekeeperDecision, proposal: MemoryProposalRecord): MemoryGatekeeperDecision {
  return { ...decision, proposal };
}

function insertVersion(card: MemoryCard, actor?: MemoryAuditActor, reason?: string): void {
  const db = openDatabase();
  db.prepare(
    `INSERT INTO role_memory_versions (id, card_id, version, snapshot_json, actor_json, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), card.id, card.version, json(card), json(actor ?? { type: "system" }), reason ?? null, new Date().toISOString());
}

export function ensureMemoryCardsLoaded(): void {
  openDatabase();
}

export function storeMemoryCard(card: MemoryCard, options?: { actor?: MemoryAuditActor; reason?: string }): void {
  const db = openDatabase();
  db.prepare(
    `INSERT INTO role_memory_cards (
      id, type, scope_kind, scope_key, role_tags_json, owner_role, source_role, applicable_roles_json,
      allowed_mutators_json, phase_tags_json, content, evidence_json,
      evidence_refs_json, confidence, importance, status, sensitivity, durability, source,
      version, supersedes, superseded_by, correction_ref, created_at, updated_at, last_accessed_at, access_count, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type=excluded.type,
      scope_kind=excluded.scope_kind,
      scope_key=excluded.scope_key,
      role_tags_json=excluded.role_tags_json,
      owner_role=excluded.owner_role,
      source_role=excluded.source_role,
      applicable_roles_json=excluded.applicable_roles_json,
      allowed_mutators_json=excluded.allowed_mutators_json,
      phase_tags_json=excluded.phase_tags_json,
      content=excluded.content,
      evidence_json=excluded.evidence_json,
      evidence_refs_json=excluded.evidence_refs_json,
      confidence=excluded.confidence,
      importance=excluded.importance,
      status=excluded.status,
      sensitivity=excluded.sensitivity,
      durability=excluded.durability,
      source=excluded.source,
      version=excluded.version,
      supersedes=excluded.supersedes,
      superseded_by=excluded.superseded_by,
      correction_ref=excluded.correction_ref,
      updated_at=excluded.updated_at,
      last_accessed_at=excluded.last_accessed_at,
      access_count=excluded.access_count,
      expires_at=excluded.expires_at`,
  ).run(...cardParams(card));
  insertVersion(card, options?.actor, options?.reason);
  insertAudit("store", card.id, card, options?.actor, options?.reason);
}

export function getMemoryCards(params?: {
  scope?: string;
  scopeKey?: string | null;
  roleName?: string;
  status?: string;
  type?: string;
  sensitivity?: string;
  conflictStatus?: string;
}): MemoryCard[] {
  const db = openDatabase();
  const rows = db
    .prepare(`SELECT * FROM role_memory_cards ORDER BY last_accessed_at DESC, created_at DESC`)
    .all() as CardRow[];
  let results = rows.map(rowToCard);
  if (params?.scope) results = results.filter((c) => c.scope === params.scope);
  if (params && Object.hasOwn(params, "scopeKey")) results = results.filter((c) => (c.scopeKey ?? null) === (params.scopeKey ?? null));
  if (params?.roleName) results = results.filter((c) => roleAppliesToCard(c, params.roleName));
  if (params?.status && params.status !== "all") {
    results = results.filter((c) => c.status === params.status);
  } else if (params?.status !== "all") {
    results = results.filter((c) => c.status === "active");
  }
  if (params?.type) results = results.filter((c) => c.type === params.type);
  if (params?.sensitivity) results = results.filter((c) => c.sensitivity === params.sensitivity);
  if (params?.conflictStatus) {
    const conflictCardIds = new Set(
      listMemoryConflicts({ status: params.conflictStatus })
        .flatMap((conflict) => conflict.cardIds),
    );
    results = results.filter((card) => conflictCardIds.has(card.id));
  }
  return results;
}

export function getMemoryCard(id: string): MemoryCard | undefined {
  const row = openDatabase().prepare(`SELECT * FROM role_memory_cards WHERE id = ?`).get(id) as CardRow | undefined;
  return row ? rowToCard(row) : undefined;
}

function cardFromProposal(proposal: MemoryProposal, id: string, options?: { base?: MemoryCard; status?: MemoryCardStatus }): MemoryCard {
  const normalized = normalizeMemoryProposal(proposal);
  const now = new Date().toISOString();
  const base = options?.base;
  return {
    id,
    type: normalized.type,
    scope: normalized.scope,
    scopeKey: normalized.scopeKey,
    roleTags: normalized.roleTags ?? [],
    ownerRole: normalized.ownerRole ?? base?.ownerRole ?? normalized.roleTags?.[0] ?? null,
    sourceRole: normalized.sourceRole ?? base?.sourceRole ?? null,
    applicableRoles: normalized.applicableRoles ?? base?.applicableRoles ?? normalized.roleTags ?? [],
    allowedMutators: normalized.allowedMutators ?? base?.allowedMutators ?? [],
    phaseTags: normalized.phaseTags,
    content: normalized.content,
    evidence: normalized.evidence ?? [],
    evidenceRefs: normalized.evidenceRefs,
    confidence: normalized.confidence ?? 0.7,
    importance: normalized.importance ?? 0.5,
    lastAccessedAt: base?.lastAccessedAt ?? now,
    createdAt: base?.createdAt ?? now,
    updatedAt: now,
    accessCount: base?.accessCount ?? 0,
    version: base ? base.version + 1 : 1,
    status: options?.status ?? "active",
    sensitivity: normalized.sensitivity,
    durability: normalized.durability,
    source: normalized.source,
    supersedes: normalized.targetId ?? null,
    supersededBy: null,
    correctionRef: base?.correctionRef ?? null,
    expiresAt: normalized.expiresAt ?? null,
  };
}

function proposalFromPatchForPreview(
  proposal: MemoryProposal,
  operation: MemoryProposalOperation,
  target?: MemoryCard,
): MemoryProposal {
  if (!target) {
    return { ...proposal, operation, targetId: proposal.targetId };
  }
  return {
    type: proposal.type ?? target.type,
    scope: proposal.scope ?? target.scope,
    scopeKey: proposal.scopeKey ?? target.scopeKey,
    roleTags: proposal.roleTags ?? target.roleTags,
    ownerRole: proposal.ownerRole ?? target.ownerRole,
    sourceRole: proposal.sourceRole ?? target.sourceRole,
    applicableRoles: proposal.applicableRoles ?? target.applicableRoles ?? target.roleTags,
    allowedMutators: proposal.allowedMutators ?? target.allowedMutators,
    phaseTags: proposal.phaseTags ?? target.phaseTags,
    content: proposal.content ?? target.content,
    evidence: proposal.evidence ?? target.evidence,
    evidenceRefs: proposal.evidenceRefs ?? target.evidenceRefs,
    confidence: proposal.confidence ?? target.confidence,
    importance: proposal.importance ?? target.importance,
    sensitivity: proposal.sensitivity ?? target.sensitivity,
    durability: proposal.durability ?? target.durability,
    source: proposal.source ?? target.source,
    targetId: target.id,
    operation,
    reason: proposal.reason,
    expiresAt: proposal.expiresAt ?? target.expiresAt,
  };
}

export function previewMemoryProposal(
  proposal: MemoryProposal,
  options?: { actor?: MemoryAuditActor; operation?: MemoryProposalOperation; targetId?: string | null },
): MemoryProposalPreview {
  ensureMemoryCardsLoaded();
  const operation = options?.operation ?? proposal.operation ?? (options?.targetId ?? proposal.targetId ? "update" : "create");
  const targetId = options?.targetId ?? proposal.targetId ?? null;
  const target = targetId ? getMemoryCard(targetId) : undefined;
  const previewProposal = proposalFromPatchForPreview({ ...proposal, targetId: targetId ?? proposal.targetId }, operation, target);
  const normalized = normalizeMemoryProposal(previewProposal);
  if (targetId && !target && operation !== "create") {
    const decision: MemoryGatekeeperDecision = {
      action: "reject",
      accepted: false,
      reason: `Unknown memory card: ${targetId}`,
      targetId,
    };
    return {
      operation,
      targetId,
      proposal: previewProposal,
      normalized,
      decision,
      conflicts: [],
      evidence: checkMemoryEvidence({ refs: normalized.evidenceRefs, content: normalized.content }),
      wouldWrite: false,
    };
  }
  const existing = operation === "update" && target
    ? getMemoryCards({ status: "active" }).filter((card) => card.id !== target.id)
    : getMemoryCards({ status: "active" });
  const decision = reviewMemoryProposal(normalized, existing, {
    now: new Date(),
    idFactory: () => `preview_${randomUUID()}`,
    actor: options?.actor,
    operation,
    target,
  });
  const evidence = checkMemoryEvidence({ refs: normalized.evidenceRefs, content: normalized.content });
  return {
    operation,
    targetId,
    proposal: previewProposal,
    normalized,
    decision,
    conflicts: decision.conflicts ?? [],
    evidence,
    target,
    riskLevel: decision.riskLevel,
    impactScope: decision.impactScope,
    suggestedAction: decision.suggestedAction,
    reasonSummary: decision.reasonSummary,
    permissionDecision: decision.permissionDecision,
    permissionReason: decision.permissionReason,
    wouldWrite: false,
  };
}

export function proposeMemoryCard(
  proposal: MemoryProposal,
  options?: { actor?: MemoryAuditActor; idFactory?: () => string },
): MemoryGatekeeperDecision {
  const existing = getMemoryCards({ status: "active" });
  const reviewedDecision = reviewMemoryProposal(proposal, existing, {
    now: new Date(),
    idFactory: options?.idFactory ?? (() => `mem_${randomUUID()}`),
    actor: options?.actor,
    operation: proposal.operation ?? "create",
  });
  const decision = reviewGateAutomaticMemoryProposal(reviewedDecision, proposal);
  const proposalRecord = storeProposalRecord(makeProposalRecord({
    operation: proposal.operation ?? "create",
    targetId: proposal.targetId ?? decision.targetId ?? null,
    proposal,
    decision,
    actor: options?.actor,
  }));
  insertAudit("propose", decision.card?.id ?? proposal.targetId ?? null, { proposal, decision, proposalId: proposalRecord.id }, options?.actor, decision.reason);
  for (const conflict of decision.conflicts ?? []) {
    storeMemoryConflict(conflict);
  }
  if (decision.action === "accept" && decision.card) {
    storeMemoryCard(decision.card, { actor: options?.actor, reason: proposal.reason ?? "accepted by gatekeeper" });
    proposalRecord.status = "applied";
    proposalRecord.decidedAt = new Date().toISOString();
    updateProposalStatus(proposalRecord.id, "applied", decision.reason);
  }
  return attachProposal(decision, proposalRecord);
}

export function updateMemoryCard(
  id: string,
  patch: Partial<MemoryProposal>,
  options?: { actor?: MemoryAuditActor; reason?: string },
): MemoryGatekeeperDecision {
  const current = getMemoryCard(id);
  if (!current) {
    return { action: "reject", accepted: false, reason: `Unknown memory card: ${id}` };
  }
  const proposal: MemoryProposal = {
    type: patch.type ?? current.type,
    scope: patch.scope ?? current.scope,
    scopeKey: patch.scopeKey ?? current.scopeKey,
    roleTags: patch.roleTags ?? current.roleTags,
    ownerRole: patch.ownerRole ?? current.ownerRole,
    sourceRole: patch.sourceRole ?? current.sourceRole,
    applicableRoles: patch.applicableRoles ?? current.applicableRoles ?? current.roleTags,
    allowedMutators: patch.allowedMutators ?? current.allowedMutators,
    phaseTags: patch.phaseTags ?? current.phaseTags,
    content: patch.content ?? current.content,
    evidence: patch.evidence ?? current.evidence,
    evidenceRefs: patch.evidenceRefs ?? current.evidenceRefs,
    confidence: patch.confidence ?? current.confidence,
    importance: patch.importance ?? current.importance,
    sensitivity: patch.sensitivity ?? current.sensitivity,
    durability: patch.durability ?? current.durability,
    source: patch.source ?? current.source,
    expiresAt: patch.expiresAt ?? current.expiresAt,
  };
  const decision = reviewMemoryProposal(
    proposal,
    getMemoryCards({ status: "active" }).filter((card) => card.id !== id),
    { now: new Date(), idFactory: () => id, actor: options?.actor, operation: "update", target: current },
  );
  const proposalRecord = storeProposalRecord(makeProposalRecord({
    operation: "update",
    targetId: id,
    proposal: { ...proposal, operation: "update", targetId: id },
    decision,
    actor: options?.actor,
  }));
  for (const conflict of decision.conflicts ?? []) storeMemoryConflict(conflict);
  if (!decision.accepted || !decision.card) {
    insertAudit("update-rejected", id, { patch, decision, proposalId: proposalRecord.id }, options?.actor, decision.reason);
    return attachProposal(decision, proposalRecord);
  }
  const next: MemoryCard = {
    ...decision.card,
    id,
    createdAt: current.createdAt,
    version: current.version + 1,
    accessCount: current.accessCount,
    correctionRef: proposalRecord.id,
  };
  storeMemoryCard(next, { actor: options?.actor, reason: options?.reason ?? patch.reason ?? "updated" });
  proposalRecord.status = "applied";
  proposalRecord.decidedAt = new Date().toISOString();
  updateProposalStatus(proposalRecord.id, "applied", decision.reason);
  return attachProposal({ ...decision, card: next }, proposalRecord);
}

export function archiveMemoryCard(id: string, status: "archived" | "tombstone" = "archived", options?: { actor?: MemoryAuditActor; reason?: string }): MemoryGatekeeperDecision {
  const current = getMemoryCard(id);
  if (!current) return { action: "reject", accepted: false, reason: `Unknown memory card: ${id}` };
  const proposal: MemoryProposal = {
    type: current.type,
    scope: current.scope,
    scopeKey: current.scopeKey,
    roleTags: current.roleTags,
    ownerRole: current.ownerRole,
    sourceRole: current.sourceRole,
    applicableRoles: current.applicableRoles ?? current.roleTags,
    allowedMutators: current.allowedMutators,
    phaseTags: current.phaseTags,
    content: current.content,
    evidence: current.evidence,
    evidenceRefs: current.evidenceRefs,
    confidence: current.confidence,
    importance: current.importance,
    sensitivity: current.sensitivity,
    durability: current.durability,
    source: current.source,
    targetId: id,
    operation: status === "tombstone" ? "tombstone" : "archive",
    reason: options?.reason,
    expiresAt: current.expiresAt,
  };
  const policy = evaluateMemoryPolicy(proposal, { actor: options?.actor, operation: proposal.operation, target: current });
  const decision: MemoryGatekeeperDecision = {
    action: policy.permissionDecision === "reject" ? "reject" : policy.permissionDecision === "needs_review" ? "needs_review" : "accept",
    accepted: policy.permissionDecision === "allow",
    targetId: id,
    reason: policy.permissionReason,
    riskLevel: policy.riskLevel,
    impactScope: policy.impactScope,
    suggestedAction: policy.suggestedAction,
    reasonSummary: policy.reasonSummary,
    permissionDecision: policy.permissionDecision,
    permissionReason: policy.permissionReason,
  };
  const proposalRecord = storeProposalRecord(makeProposalRecord({
    operation: proposal.operation ?? "archive",
    targetId: id,
    proposal,
    decision,
    actor: options?.actor,
  }));
  if (!decision.accepted) {
    insertAudit("archive-review", id, { proposal, decision, proposalId: proposalRecord.id }, options?.actor, decision.reason);
    return attachProposal(decision, proposalRecord);
  }
  const next: MemoryCard = {
    ...current,
    status,
    correctionRef: proposalRecord.id,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  };
  storeMemoryCard(next, { actor: options?.actor, reason: options?.reason ?? status });
  proposalRecord.status = "applied";
  proposalRecord.decidedAt = new Date().toISOString();
  updateProposalStatus(proposalRecord.id, "applied", options?.reason ?? status);
  insertAudit(status, id, { card: next, proposalId: proposalRecord.id }, options?.actor, options?.reason);
  return { action: "accept", accepted: true, card: next, proposal: proposalRecord };
}

export function supersedeMemoryCard(id: string, proposal: MemoryProposal, options?: { actor?: MemoryAuditActor; reason?: string }): MemoryGatekeeperDecision {
  const current = getMemoryCard(id);
  if (!current) return { action: "reject", accepted: false, reason: `Unknown memory card: ${id}` };
  const decision = proposeMemoryCard({ ...proposal, operation: "supersede", targetId: id }, options);
  if (!decision.accepted || !decision.card) return decision;
  const oldNext: MemoryCard = {
    ...current,
    status: "archived",
    supersededBy: decision.card.id,
    correctionRef: decision.proposal?.id ?? null,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  };
  const newNext: MemoryCard = {
    ...decision.card,
    supersedes: id,
    correctionRef: decision.proposal?.id ?? null,
  };
  storeMemoryCard(oldNext, { actor: options?.actor, reason: options?.reason ?? "superseded" });
  storeMemoryCard(newNext, { actor: options?.actor, reason: options?.reason ?? "supersedes previous memory" });
  insertAudit("supersede", id, { oldId: id, newId: newNext.id }, options?.actor, options?.reason);
  return { action: "supersede", accepted: true, card: newNext, targetId: id, proposal: decision.proposal };
}

function rowToConflict(row: ConflictRow): MemoryConflict {
  return {
    id: row.id,
    type: row.type,
    cardIds: parseJsonArray<string>(row.card_ids_json),
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  };
}

export function storeMemoryConflict(conflict: MemoryConflict): void {
  openDatabase().prepare(
    `INSERT INTO role_memory_conflicts (id, type, card_ids_json, status, reason, created_at, resolved_at, resolution)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status=excluded.status, resolved_at=excluded.resolved_at, resolution=excluded.resolution`,
  ).run(conflict.id, conflict.type, json(conflict.cardIds), conflict.status, conflict.reason, conflict.createdAt, conflict.resolvedAt ?? null, conflict.resolution ?? null);
}

export function listMemoryConflicts(params?: { status?: string }): MemoryConflict[] {
  let rows = openDatabase()
    .prepare(`SELECT * FROM role_memory_conflicts ORDER BY created_at DESC`)
    .all() as ConflictRow[];
  if (params?.status) rows = rows.filter((row) => row.status === params.status);
  return rows.map(rowToConflict);
}

export function resolveMemoryConflict(id: string, resolution: string, options?: { actor?: MemoryAuditActor }): MemoryConflict | undefined {
  const conflict = listMemoryConflicts().find((entry) => entry.id === id);
  if (!conflict) return undefined;
  const next: MemoryConflict = {
    ...conflict,
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    resolution,
  };
  storeMemoryConflict(next);
  insertAudit("resolve-conflict", null, next, options?.actor, resolution);
  return next;
}

function rowToVersion(row: VersionRow): MemoryVersionRecord {
  return {
    id: row.id,
    cardId: row.card_id,
    version: row.version,
    snapshot: parseJsonValue<MemoryCard>(row.snapshot_json, {} as MemoryCard),
    actor: parseJsonValue<MemoryAuditActor>(row.actor_json, { type: "system" }),
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function rowToAudit(row: AuditRow): MemoryAuditEvent {
  return {
    id: row.id,
    action: row.action,
    cardId: row.card_id,
    actor: parseJsonValue<MemoryAuditActor>(row.actor_json, { type: "system" }),
    reason: row.reason,
    payload: parseJsonValue(row.payload_json, null),
    createdAt: row.created_at,
  };
}

export function listMemoryProposals(params?: {
  status?: string;
  roleName?: string;
  scope?: string;
  operation?: string;
  decision?: string;
  limit?: number;
}): MemoryProposalRecord[] {
  const limit = Math.max(1, Math.min(500, params?.limit ?? 100));
  const rows = openDatabase()
    .prepare(`SELECT * FROM role_memory_proposals ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as ProposalRow[];
  let records = rows.map(rowToProposal);
  if (params?.status) records = records.filter((proposal) => proposal.status === params.status);
  if (params?.operation) records = records.filter((proposal) => proposal.operation === params.operation);
  if (params?.decision) records = records.filter((proposal) => proposal.decision === params.decision);
  if (params?.scope) records = records.filter((proposal) => proposal.normalized?.scope === params.scope || proposal.proposal.scope === params.scope);
  if (params?.roleName) {
    records = records.filter((proposal) => (proposal.normalized?.roleTags ?? proposal.proposal.roleTags ?? []).includes(params.roleName!));
  }
  return records;
}

export function listMemoryVersions(params: { cardId: string; limit?: number }): MemoryVersionRecord[] {
  const limit = Math.max(1, Math.min(200, params.limit ?? 100));
  const rows = openDatabase()
    .prepare(`SELECT * FROM role_memory_versions WHERE card_id = ? ORDER BY version DESC LIMIT ?`)
    .all(params.cardId, limit) as VersionRow[];
  return rows.map(rowToVersion);
}

export function listMemoryAuditEvents(params?: { cardId?: string; action?: string; limit?: number }): MemoryAuditEvent[] {
  const limit = Math.max(1, Math.min(500, params?.limit ?? 100));
  let rows = openDatabase()
    .prepare(`SELECT * FROM role_memory_audit_events ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as AuditRow[];
  if (params?.cardId) rows = rows.filter((row) => row.card_id === params.cardId);
  if (params?.action) rows = rows.filter((row) => row.action === params.action);
  return rows.map(rowToAudit);
}

export function getMemoryStats(): Record<string, number> {
  const cards = getMemoryCards({ status: "all" });
  const proposals = listMemoryProposals({ limit: 500 });
  const conflicts = listMemoryConflicts();
  return {
    active: cards.filter((card) => card.status === "active").length,
    cold: cards.filter((card) => card.status === "cold").length,
    archived: cards.filter((card) => card.status === "archived").length,
    tombstone: cards.filter((card) => card.status === "tombstone").length,
    conflictsOpen: conflicts.filter((conflict) => conflict.status === "open").length,
    proposalsNeedsReview: proposals.filter((proposal) => proposal.status === "needs_review").length,
    proposalsRejected: proposals.filter((proposal) => proposal.status === "rejected").length,
    proposalsApplied: proposals.filter((proposal) => proposal.status === "applied").length,
  };
}

function applyProposalRecord(
  record: MemoryProposalRecord,
  options?: { actor?: MemoryAuditActor; status?: MemoryCardStatus; reason?: string; correctionRef?: string },
): MemoryGatekeeperDecision {
  const targetId = record.targetId ?? record.proposal.targetId ?? undefined;
  const nextStatus = options?.status ?? "active";
  const correctionRef = options?.correctionRef ?? record.batchId ?? record.id;
  if ((record.operation === "archive" || record.operation === "tombstone") && targetId) {
    const current = getMemoryCard(targetId);
    if (!current) return { action: "reject", accepted: false, reason: `Unknown memory card: ${targetId}`, proposal: record };
    const next: MemoryCard = {
      ...current,
      status: record.operation === "tombstone" ? "tombstone" : "archived",
      correctionRef,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    storeMemoryCard(next, { actor: options?.actor, reason: options?.reason ?? record.operation });
    return { action: "accept", accepted: true, card: next, targetId, proposal: record };
  }
  if (record.operation === "update" && targetId) {
    const current = getMemoryCard(targetId);
    if (!current) return { action: "reject", accepted: false, reason: `Unknown memory card: ${targetId}`, proposal: record };
    const next = {
      ...cardFromProposal(record.proposal, targetId, { base: current, status: nextStatus }),
      correctionRef,
    };
    storeMemoryCard(next, { actor: options?.actor, reason: options?.reason ?? "review approved update" });
    return { action: "accept", accepted: true, card: next, targetId, proposal: record };
  }
  const id = `mem_${randomUUID()}`;
  const next = {
    ...cardFromProposal(record.proposal, id, { status: nextStatus }),
    correctionRef,
  };
  if (record.operation === "supersede" && targetId) {
    const current = getMemoryCard(targetId);
    if (current) {
      storeMemoryCard({
        ...current,
        status: "archived",
        supersededBy: next.id,
        correctionRef,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      }, { actor: options?.actor, reason: "review approved supersede" });
    }
    next.supersedes = targetId;
  }
  storeMemoryCard(next, { actor: options?.actor, reason: options?.reason ?? "review approved proposal" });
  return { action: record.operation === "supersede" ? "supersede" : "accept", accepted: true, card: next, targetId, proposal: record };
}

export function reviewMemoryProposalRecord(
  id: string,
  action: "approve" | "reject" | "applyAsCold" | "supersede" | "merge",
  options?: { actor?: MemoryAuditActor; reason?: string; correctionRef?: string },
): MemoryGatekeeperDecision {
  const record = listMemoryProposals({ limit: 500 }).find((proposal) => proposal.id === id);
  if (!record) return { action: "reject", accepted: false, reason: `Unknown memory proposal: ${id}` };
  if (record.status === "applied") {
    return { action: "reject", accepted: false, reason: `Memory proposal already applied: ${id}`, proposal: record };
  }
  if (action === "reject") {
    updateProposalStatus(id, "rejected", options?.reason ?? "rejected by reviewer");
    insertAudit("review-reject", record.targetId ?? null, { proposalId: id, action }, options?.actor, options?.reason);
    return { action: "reject", accepted: false, reason: options?.reason ?? "rejected by reviewer", proposal: { ...record, status: "rejected" } };
  }
  if (record.status === "rejected") {
    return { action: "reject", accepted: false, reason: `Memory proposal already rejected: ${id}`, proposal: record };
  }
  if (action === "supersede" && !(record.targetId ?? record.proposal.targetId)) {
    return { action: "reject", accepted: false, reason: "memory.review supersede requires a target memory card", proposal: record };
  }
  const applyStatus: MemoryCardStatus = action === "applyAsCold" ? "cold" : "active";
  const applyRecord = action === "supersede" ? { ...record, operation: "supersede" as const } : record;
  const applied = applyProposalRecord(applyRecord, {
    actor: options?.actor,
    status: applyStatus,
    reason: options?.reason,
    correctionRef: options?.correctionRef,
  });
  const nextStatus: MemoryProposalStatus = applied.accepted ? "applied" : "rejected";
  updateProposalStatus(id, nextStatus, options?.reason ?? action);
  insertAudit("review-apply", applied.card?.id ?? record.targetId ?? null, { proposalId: id, action, applied }, options?.actor, options?.reason);
  return { ...applied, proposal: { ...record, status: nextStatus, decidedAt: new Date().toISOString() } };
}

export function mergeMemoryEntries(params: {
  cardIds?: string[];
  proposalIds?: string[];
  content?: string;
  roleTags?: string[];
  scope?: MemoryCardScope;
  scopeKey?: string | null;
  actor?: MemoryAuditActor;
  reason?: string;
}): MemoryGatekeeperDecision {
  const cards = (params.cardIds ?? []).map((id) => getMemoryCard(id)).filter((card): card is MemoryCard => Boolean(card));
  const proposals = listMemoryProposals({ limit: 500 }).filter((proposal) => (params.proposalIds ?? []).includes(proposal.id));
  const sourceContents = [
    ...cards.map((card) => card.content),
    ...proposals.map((proposal) => proposal.normalized?.content ?? proposal.proposal.content),
  ].filter(Boolean);
  if (sourceContents.length === 0 && !params.content?.trim()) {
    return { action: "reject", accepted: false, reason: "memory.merge requires at least one card/proposal or content" };
  }
  const proposal: MemoryProposal = {
    type: cards[0]?.type ?? proposals[0]?.normalized?.type ?? "role_experience",
    scope: params.scope ?? cards[0]?.scope ?? proposals[0]?.normalized?.scope ?? "role",
    scopeKey: params.scopeKey ?? cards[0]?.scopeKey ?? proposals[0]?.normalized?.scopeKey ?? null,
    roleTags: params.roleTags ?? cards[0]?.roleTags ?? proposals[0]?.normalized?.roleTags ?? [],
    phaseTags: cards[0]?.phaseTags ?? proposals[0]?.normalized?.phaseTags ?? [],
    content: params.content?.trim() || sourceContents.join(" "),
    evidenceRefs: [
      ...cards.map((card) => ({ type: "manual" as const, ref: `memory:${card.id}` })),
      ...proposals.map((proposal) => ({ type: "manual" as const, ref: `proposal:${proposal.id}` })),
    ],
    confidence: 0.8,
    importance: Math.max(0.5, ...cards.map((card) => card.importance), ...proposals.map((proposal) => proposal.normalized?.importance ?? 0.5)),
    source: "system",
    operation: "create",
    reason: params.reason ?? "merged memory entries",
  };
  const decision = proposeMemoryCard(proposal, { actor: params.actor });
  if (decision.accepted && decision.card) {
    for (const card of cards) {
      storeMemoryCard({
        ...card,
        status: "archived",
        supersededBy: decision.card.id,
        version: card.version + 1,
        updatedAt: new Date().toISOString(),
      }, { actor: params.actor, reason: params.reason ?? "merged into new memory" });
    }
    for (const proposal of proposals) {
      updateProposalStatus(proposal.id, "applied", params.reason ?? "merged into new memory");
    }
    insertAudit("merge", decision.card.id, { cardIds: params.cardIds ?? [], proposalIds: params.proposalIds ?? [] }, params.actor, params.reason);
  }
  return { ...decision, action: decision.accepted ? "merge" : decision.action };
}

export function getRoleMemoryPolicy(): ReturnType<typeof getMemoryPolicySnapshot> {
  return getMemoryPolicySnapshot();
}

export function listMemoryRetentionCandidates(params?: {
  roleName?: string;
  limit?: number;
  includeKeep?: boolean;
}): MemoryRetentionCandidate[] {
  const limit = Math.max(1, Math.min(200, params?.limit ?? 50));
  let candidates = getMemoryCards({ roleName: params?.roleName, status: "all" })
    .map((card) => evaluateRetentionCandidate(card))
    .filter((candidate) => params?.includeKeep === true || candidate.recommendedAction !== "keep");
  candidates = candidates.sort((left, right) => {
    const order = { tombstone: 4, archive: 3, cold: 2, review: 1, keep: 0 } as const;
    return order[right.recommendedAction] - order[left.recommendedAction] || left.retentionScore - right.retentionScore;
  });
  return candidates.slice(0, limit);
}

const SCOPE_PRECEDENCE: MemoryCardScope[] = ["user", "workspace", "project", "agent", "team", "role", "session", "task", "global"];

function evidenceStatusRank(status: MemoryEvidenceStatus): number {
  const order: Record<MemoryEvidenceStatus, number> = {
    missing: 6,
    contradicted: 5,
    stale: 4,
    weak: 3,
    unchecked: 2,
    verified: 1,
  };
  return order[status];
}

function aggregateEvidenceStatus(statuses: MemoryEvidenceStatus[]): MemoryEvidenceStatus {
  if (statuses.length === 0) return "weak";
  return statuses.reduce((worst, next) => evidenceStatusRank(next) > evidenceStatusRank(worst) ? next : worst, "verified" as MemoryEvidenceStatus);
}

function keywordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9_\u4e00-\u9fa5]+/i).filter((word) => word.length >= 3));
}

function evidenceOverlap(content: string | undefined, excerpt: string | undefined): number {
  if (!content?.trim() || !excerpt?.trim()) return 0;
  const contentWords = keywordSet(content);
  const excerptWords = keywordSet(excerpt);
  if (contentWords.size === 0 || excerptWords.size === 0) return 0;
  let matches = 0;
  for (const word of contentWords) {
    if (excerptWords.has(word)) matches += 1;
  }
  return matches / Math.max(1, Math.min(contentWords.size, 12));
}

function checkEvidenceRef(ref: MemoryEvidenceRef, content?: string): MemoryEvidenceCheckResult["refs"][number] {
  if (!ref?.ref?.trim()) {
    return { ref, status: "missing", reason: "Evidence ref is empty." };
  }
  if (ref.type === "file") {
    const filePath = path.isAbsolute(ref.ref) ? ref.ref : path.resolve(ref.ref);
    return fs.existsSync(filePath)
      ? { ref, status: "verified", reason: "Referenced file exists." }
      : { ref, status: "missing", reason: "Referenced file was not found." };
  }
  if (ref.type === "manual") {
    return { ref, status: "verified", reason: "Manual evidence was provided by the operator." };
  }
  if (!ref.excerpt?.trim()) {
    return { ref, status: "unchecked", reason: "Native evidence is referenced read-only but has no excerpt to verify locally." };
  }
  const overlap = evidenceOverlap(content, ref.excerpt);
  if (overlap < 0.08) {
    return { ref, status: "weak", reason: "Evidence excerpt has weak lexical overlap with the memory content." };
  }
  return { ref, status: "verified", reason: "Evidence excerpt overlaps with the memory content." };
}

export function checkMemoryEvidence(params: {
  id?: string;
  kind?: "card" | "proposal";
  refs?: MemoryProposal["evidenceRefs"];
  content?: string;
}): MemoryEvidenceCheckResult {
  const kind = params.kind ?? "card";
  const proposal = kind === "proposal" && params.id
    ? listMemoryProposals({ limit: 500 }).find((entry) => entry.id === params.id)
    : undefined;
  const card = kind === "card" && params.id ? getMemoryCard(params.id) : undefined;
  const refs = params.refs ?? card?.evidenceRefs ?? proposal?.normalized?.evidenceRefs ?? proposal?.proposal.evidenceRefs ?? [];
  const content = params.content ?? card?.content ?? proposal?.normalized?.content ?? proposal?.proposal.content;
  const checkedRefs = refs.map((ref) => checkEvidenceRef(ref, content));
  const status = aggregateEvidenceStatus(checkedRefs.map((ref) => ref.status));
  return {
    id: `ev_${randomUUID()}`,
    targetKind: params.id ? kind : "refs",
    targetId: params.id ?? null,
    status,
    refs: checkedRefs,
    summary: checkedRefs.length === 0
      ? "No evidence refs were provided."
      : `${checkedRefs.length} evidence refs checked; overall status ${status}.`,
    checkedAt: new Date().toISOString(),
  };
}

function proposalFromCardForRetention(candidate: MemoryRetentionCandidate, action: MemoryRetentionAction): MemoryProposal {
  const card = candidate.card;
  return {
    type: card.type,
    scope: card.scope,
    scopeKey: card.scopeKey,
    roleTags: card.roleTags,
    ownerRole: card.ownerRole,
    sourceRole: card.sourceRole,
    applicableRoles: card.applicableRoles ?? card.roleTags,
    allowedMutators: card.allowedMutators,
    phaseTags: card.phaseTags,
    content: card.content,
    evidence: card.evidence,
    evidenceRefs: card.evidenceRefs,
    confidence: card.confidence,
    importance: card.importance,
    sensitivity: card.sensitivity,
    durability: card.durability,
    source: "system",
    targetId: card.id,
    operation: action === "archive" ? "archive" : action === "tombstone" ? "tombstone" : "update",
    reason: `retention:${action}; ${candidate.reason}`,
    expiresAt: card.expiresAt,
  };
}

export function proposeMemoryRetention(params: {
  cardId?: string;
  cardIds?: string[];
  roleName?: string;
  action?: MemoryRetentionAction;
  limit?: number;
  actor?: MemoryAuditActor;
  reason?: string;
}): { runId: string; proposals: MemoryProposalRecord[]; candidates: MemoryRetentionCandidate[] } {
  const cardIds = new Set([...(params.cardIds ?? []), ...(params.cardId ? [params.cardId] : [])]);
  const candidates = listMemoryRetentionCandidates({
    roleName: params.roleName,
    limit: params.limit ?? (cardIds.size > 0 ? 200 : 20),
    includeKeep: Boolean(params.action),
  }).filter((candidate) => {
    if (cardIds.size > 0 && !cardIds.has(candidate.card.id)) return false;
    const action = params.action ?? candidate.recommendedAction;
    return action !== "keep";
  });
  const runId = `ret_${randomUUID()}`;
  const proposals: MemoryProposalRecord[] = [];
  for (const candidate of candidates) {
    const action = params.action ?? candidate.recommendedAction;
    if (action === "keep") continue;
    const proposal = proposalFromCardForRetention(candidate, action);
    const policy = evaluateMemoryPolicy(proposal, { actor: params.actor, operation: proposal.operation, target: candidate.card });
    const evidence = checkMemoryEvidence({ id: candidate.card.id, kind: "card" });
    const decision: MemoryGatekeeperDecision = {
      action: "needs_review",
      accepted: false,
      targetId: candidate.card.id,
      reason: params.reason ?? candidate.reason,
      riskLevel: policy.riskLevel,
      impactScope: policy.impactScope,
      suggestedAction: action === "cold" ? "applyAsCold" : action === "archive" || action === "tombstone" ? "approve" : policy.suggestedAction,
      reasonSummary: `${policy.reasonSummary}; retention suggests ${action}`,
      permissionDecision: "needs_review",
      permissionReason: "Retention suggestions are proposal-first and require explicit review.",
    };
    const record = storeProposalRecord(makeProposalRecord({
      operation: proposal.operation ?? "update",
      targetId: candidate.card.id,
      proposal,
      decision,
      actor: params.actor,
      batchId: runId,
      evidenceStatus: evidence.status,
      retentionReason: candidate.reason,
      policySnapshot: getMemoryPolicySnapshot(),
    }));
    proposals.push(record);
    insertAudit("retention-propose", candidate.card.id, { runId, action, candidate, proposalId: record.id }, params.actor, params.reason ?? candidate.reason);
  }
  openDatabase().prepare(
    `INSERT INTO role_memory_retention_runs (id, card_ids_json, action, proposals_json, actor_json, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(runId, json(candidates.map((candidate) => candidate.card.id)), params.action ?? null, json(proposals.map((proposal) => proposal.id)), json(params.actor ?? { type: "system" }), params.reason ?? null, new Date().toISOString());
  return { runId, proposals, candidates };
}

export function reviewMemoryProposalBatch(params: {
  ids: string[];
  action: MemoryReviewAction;
  actor?: MemoryAuditActor;
  reason?: string;
}): MemoryReviewBatchResult {
  const batchId = `batch_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const existingIds = new Set(listMemoryProposals({ limit: 500 }).map((proposal) => proposal.id));
  const results = params.ids.map((id) => {
    try {
      if (!existingIds.has(id)) {
        return {
          id,
          ok: false,
          decision: { action: "reject", accepted: false, reason: `Unknown memory proposal: ${id}` } satisfies MemoryGatekeeperDecision,
        };
      }
      const decision = reviewMemoryProposalRecord(id, params.action, {
        actor: params.actor,
        reason: params.reason ?? `batch ${params.action}`,
        correctionRef: batchId,
      });
      openDatabase().prepare(`UPDATE role_memory_proposals SET batch_id = ? WHERE id = ?`).run(batchId, id);
      return { id, ok: decision.accepted || decision.action === "reject", decision };
    } catch (error) {
      return {
        id,
        ok: false,
        decision: { action: "reject", accepted: false, reason: error instanceof Error ? error.message : String(error) } satisfies MemoryGatekeeperDecision,
      };
    }
  });
  openDatabase().prepare(
    `INSERT INTO role_memory_review_batches (id, action, proposal_ids_json, actor_json, reason, results_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(batchId, params.action, json(params.ids), json(params.actor ?? { type: "system" }), params.reason ?? null, json(results), createdAt);
  insertAudit("review-batch", null, { batchId, action: params.action, results }, params.actor, params.reason);
  return { batchId, action: params.action, results, createdAt };
}

function conflictSuggestedAction(conflict?: MemoryConflict): MemorySuggestedAction {
  if (!conflict) return "reject";
  if (conflict.type === "duplicate") return "merge";
  if (conflict.type === "contradiction" || conflict.type === "scope_conflict" || conflict.type === "role_conflict") return "supersede";
  if (conflict.type === "sensitive_review" || conflict.type === "permission_conflict") return "reject";
  return "applyAsCold";
}

export function getMemoryConflictDetail(id: string): MemoryConflictDetail {
  const conflict = listMemoryConflicts().find((entry) => entry.id === id);
  const cards = (conflict?.cardIds ?? []).map((cardId) => getMemoryCard(cardId)).filter((card): card is MemoryCard => Boolean(card));
  const proposals = listMemoryProposals({ limit: 500 }).filter((proposal) =>
    proposal.conflictIds.includes(id) ||
    cards.some((card) => proposal.targetId === card.id || proposal.proposal.targetId === card.id),
  );
  const evidence = cards.map((card) => checkMemoryEvidence({ id: card.id, kind: "card" }));
  const suggestedAction = conflictSuggestedAction(conflict);
  return {
    conflict,
    cards,
    proposals,
    evidence,
    scopePrecedence: SCOPE_PRECEDENCE,
    suggestedAction,
    reasonSummary: conflict
      ? `${conflict.type} conflict across ${cards.length} cards; suggested action ${suggestedAction}.`
      : `Unknown conflict ${id}.`,
  };
}

export function buildMemoryMergeDraft(params: {
  cardIds?: string[];
  proposalIds?: string[];
  content?: string;
  roleTags?: string[];
  scope?: MemoryCardScope;
  scopeKey?: string | null;
  suggestedAction?: "merge" | "supersede";
}): MemoryMergeDraft {
  const cards = (params.cardIds ?? []).map((id) => getMemoryCard(id)).filter((card): card is MemoryCard => Boolean(card));
  const proposals = listMemoryProposals({ limit: 500 }).filter((proposal) => (params.proposalIds ?? []).includes(proposal.id));
  const sourceContents = [
    ...cards.map((card) => card.content),
    ...proposals.map((proposal) => proposal.normalized?.content ?? proposal.proposal.content),
  ].filter(Boolean);
  const firstCard = cards[0];
  const firstProposal = proposals[0]?.normalized ?? proposals[0]?.proposal;
  const draft: MemoryProposal = {
    type: firstCard?.type ?? firstProposal?.type ?? "fact",
    scope: params.scope ?? firstCard?.scope ?? firstProposal?.scope ?? "role",
    scopeKey: params.scopeKey ?? firstCard?.scopeKey ?? firstProposal?.scopeKey ?? null,
    roleTags: params.roleTags ?? firstCard?.roleTags ?? firstProposal?.roleTags ?? [],
    ownerRole: firstCard?.ownerRole ?? firstProposal?.ownerRole ?? null,
    sourceRole: firstCard?.sourceRole ?? firstProposal?.sourceRole ?? null,
    applicableRoles: firstCard?.applicableRoles ?? firstProposal?.applicableRoles ?? firstCard?.roleTags ?? firstProposal?.roleTags ?? [],
    allowedMutators: firstCard?.allowedMutators ?? firstProposal?.allowedMutators,
    phaseTags: firstCard?.phaseTags ?? firstProposal?.phaseTags,
    content: params.content?.trim() || sourceContents.join(" "),
    evidenceRefs: [
      ...cards.map((card) => ({ type: "manual" as const, ref: `memory:${card.id}` })),
      ...proposals.map((proposal) => ({ type: "manual" as const, ref: `proposal:${proposal.id}` })),
    ],
    confidence: 0.8,
    importance: Math.max(0.5, ...cards.map((card) => card.importance), ...proposals.map((proposal) => proposal.normalized?.importance ?? 0.5)),
    sensitivity: firstCard?.sensitivity ?? firstProposal?.sensitivity ?? "normal",
    durability: firstCard?.durability ?? firstProposal?.durability,
    source: "system",
    operation: params.suggestedAction === "supersede" ? "supersede" : "create",
    targetId: params.suggestedAction === "supersede" ? firstCard?.id ?? firstProposal?.targetId : undefined,
    reason: "merge draft; not applied",
  };
  return {
    draft,
    cardIds: cards.map((card) => card.id),
    proposalIds: proposals.map((proposal) => proposal.id),
    suggestedAction: params.suggestedAction ?? "merge",
    reasonSummary: "Draft only. Submit as a proposal or merge review action to change memory.",
  };
}


export function revokePoisonedMemoryCard(
  id: string,
  options?: { actor?: MemoryAuditActor; reason?: string; correctionRef?: string },
): MemoryCard | undefined {
  const current = getMemoryCard(id);
  if (!current) return undefined;
  let correctionRef = options?.correctionRef?.trim();
  if (!correctionRef) {
    const proposal: MemoryProposal = {
      type: current.type,
      scope: current.scope,
      scopeKey: current.scopeKey,
      roleTags: current.roleTags,
      ownerRole: current.ownerRole,
      sourceRole: current.sourceRole,
      applicableRoles: current.applicableRoles,
      allowedMutators: current.allowedMutators,
      phaseTags: current.phaseTags,
      content: current.content,
      evidence: current.evidence,
      evidenceRefs: current.evidenceRefs,
      confidence: current.confidence,
      importance: current.importance,
      sensitivity: current.sensitivity,
      durability: current.durability,
      source: options?.actor?.type === "user" ? "user" : "system",
      targetId: id,
      operation: "tombstone",
      reason: options?.reason ?? "poison revoke (P3-003)",
      expiresAt: current.expiresAt,
    };
    const proposalRecord = storeProposalRecord(makeProposalRecord({
      operation: "tombstone",
      targetId: id,
      proposal,
      decision: {
        action: "accept",
        accepted: true,
        targetId: id,
        reason: options?.reason ?? "Safety revocation of poisoned memory.",
      },
      actor: options?.actor,
    }));
    proposalRecord.status = "applied";
    proposalRecord.decidedAt = new Date().toISOString();
    updateProposalStatus(proposalRecord.id, "applied", options?.reason ?? "poison revoke (P3-003)");
    correctionRef = proposalRecord.id;
  }
  const revoked = {
    ...revokePoisonedMemory(current, { reason: options?.reason }),
    correctionRef,
  };
  storeMemoryCard(revoked, {
    actor: options?.actor,
    reason: options?.reason ?? "poison revoke (P3-003)",
  });
  insertAudit(
    "tombstone",
    id,
    { poisonRevoked: true, correctionRef, reason: options?.reason ?? "poison revoke (P3-003)" },
    options?.actor,
    options?.reason ?? "poison revoke (P3-003)",
  );
  return revoked;
}

export function simulateMemoryInjection(params: {
  roleName: string;
  phase?: MemoryPhaseTag;
  task?: string;
  budget?: Partial<ContextPack["budget"]>;
  dualGate?: Partial<import("./memory-dual-gate.js").MemoryDualGateConfig>;
  scope?: MemoryCardScopeContext;
}): MemoryInjectionSimulation {
  const dualGate = resolveMemoryDualGateConfig(params.dualGate ?? {});
  const memories = filterCardsForModelInjection(
    getMemoryCards({ roleName: params.roleName, status: "all" })
      .filter((card) => card.status === "active" || card.status === "cold"),
    dualGate,
  ).filter((card) => isMemoryCardInContextScope(card, params.scope ?? {}));
  const memoryIds = new Set(memories.map((card) => card.id));
  const openConflictRecords = listMemoryConflicts({ status: "open" }).filter((conflict) =>
    conflict.cardIds.some((cardId) => memoryIds.has(cardId)),
  );
  const pack = buildContextPack({
    memories,
    roleName: params.roleName,
    phase: params.phase,
    taskState: params.task,
    openConflicts: openConflictRecords.map((conflict) => `${conflict.type}: ${conflict.reason}`),
    openConflictCardIds: openConflictRecords.flatMap((conflict) => conflict.cardIds),
    budget: params.budget,
  });
  const selectedIds = new Set(pack.candidateExplanations?.filter((entry) => entry.selected).map((entry) => entry.cardId) ?? []);
  return {
    roleName: params.roleName,
    task: params.task,
    phase: params.phase,
    pack,
    selectedCards: memories.filter((card) => selectedIds.has(card.id)),
    selectorSnapshot: getMemoryPolicySnapshot(),
  };
}

export function getMemoryHealthReport(): MemoryHealthReport {
  const checkedAt = new Date().toISOString();
  const cards = getMemoryCards({ status: "all" });
  const proposals = listMemoryProposals({ limit: 500 });
  const versions = cards.flatMap((card) => listMemoryVersions({ cardId: card.id, limit: 500 }));
  const cardIds = new Set(cards.map((card) => card.id));
  const supersedeMissing = cards.filter((card) => (card.supersedes && !cardIds.has(card.supersedes)) || (card.supersededBy && !cardIds.has(card.supersededBy)));
  const orphanProposals = proposals.filter((proposal) => {
    const targetId = proposal.targetId ?? proposal.proposal.targetId;
    return Boolean(targetId) && !cardIds.has(targetId!) && proposal.status !== "rejected";
  });
  const weakEvidence = cards.map((card) => checkMemoryEvidence({ id: card.id, kind: "card" })).filter((check) => check.status === "missing" || check.status === "weak");
  const checks: MemoryHealthReport["checks"] = [
    { name: "schema", status: "ok", message: "Role memory SQLite schema opened successfully." },
    {
      name: "versions",
      status: versions.length >= cards.length ? "ok" : "warn",
      message: versions.length >= cards.length ? "Version snapshots exist for stored cards." : "Some cards may be missing version snapshots.",
      count: Math.max(0, cards.length - versions.length),
    },
    {
      name: "supersede-chain",
      status: supersedeMissing.length === 0 ? "ok" : "warn",
      message: supersedeMissing.length === 0 ? "Supersede chains resolve locally." : "Some supersede links point to missing cards.",
      count: supersedeMissing.length,
    },
    {
      name: "orphan-proposals",
      status: orphanProposals.length === 0 ? "ok" : "warn",
      message: orphanProposals.length === 0 ? "Proposal targets resolve locally." : "Some proposals target missing cards.",
      count: orphanProposals.length,
    },
    {
      name: "evidence",
      status: weakEvidence.length === 0 ? "ok" : "warn",
      message: weakEvidence.length === 0 ? "Evidence refs look usable." : "Some cards have weak or missing evidence refs.",
      count: weakEvidence.length,
    },
  ];
  return { ok: checks.every((check) => check.status !== "error"), checkedAt, checks };
}

export function getMemoryDetail(params: {
  id: string;
  kind?: "card" | "proposal" | "conflict" | "injection";
}): Record<string, unknown> {
  const card = params.kind === "proposal" || params.kind === "conflict" || params.kind === "injection" ? undefined : getMemoryCard(params.id);
  const proposals = listMemoryProposals({ limit: 500 }).filter((proposal) =>
    proposal.id === params.id ||
    proposal.targetId === params.id ||
    proposal.conflictIds.includes(params.id),
  );
  const conflicts = listMemoryConflicts().filter((conflict) =>
    conflict.id === params.id ||
    conflict.cardIds.includes(params.id) ||
    proposals.some((proposal) => proposal.conflictIds.includes(conflict.id)),
  );
  const injections = explainMemoryInjection({ limit: 100 }).filter((injection) =>
    injection.id === params.id ||
    injection.cardIds.includes(params.id) ||
    injection.candidateExplanations?.some((candidate) => candidate.cardId === params.id),
  );
  return {
    card,
    proposal: proposals.find((proposal) => proposal.id === params.id),
    conflict: conflicts.find((conflict) => conflict.id === params.id),
    injection: injections.find((injection) => injection.id === params.id),
    proposals,
    conflicts,
    evidence: card ? checkMemoryEvidence({ id: card.id, kind: "card" }) : undefined,
    retention: card ? evaluateRetentionCandidate(card) : undefined,
    versions: card ? listMemoryVersions({ cardId: card.id }) : [],
    audit: listMemoryAuditEvents({ cardId: card?.id ?? params.id, limit: 100 }),
    injections,
  };
}

export function restoreMemoryCardAsProposal(
  id: string,
  options?: { actor?: MemoryAuditActor; reason?: string },
): MemoryGatekeeperDecision {
  const current = getMemoryCard(id);
  if (!current) return { action: "reject", accepted: false, reason: `Unknown memory card: ${id}` };
  const proposal: MemoryProposal = {
    type: current.type,
    scope: current.scope,
    scopeKey: current.scopeKey,
    roleTags: current.roleTags,
    ownerRole: current.ownerRole,
    sourceRole: current.sourceRole,
    applicableRoles: current.applicableRoles ?? current.roleTags,
    allowedMutators: current.allowedMutators,
    phaseTags: current.phaseTags,
    content: current.content,
    evidence: current.evidence,
    evidenceRefs: current.evidenceRefs,
    confidence: current.confidence,
    importance: current.importance,
    sensitivity: current.sensitivity,
    durability: current.durability,
    source: current.source,
    targetId: id,
    operation: "update",
    reason: options?.reason ?? "restore archived memory as proposal",
    expiresAt: current.expiresAt,
  };
  const policy = evaluateMemoryPolicy(proposal, { actor: options?.actor, operation: "update", target: current });
  const decision: MemoryGatekeeperDecision = {
    action: "needs_review",
    accepted: false,
    targetId: id,
    reason: "Restore requires review before reactivation.",
    riskLevel: policy.riskLevel,
    impactScope: policy.impactScope,
    suggestedAction: "approve",
    reasonSummary: policy.reasonSummary,
    permissionDecision: "needs_review",
    permissionReason: "Restore is intentionally proposal-first and does not directly reactivate memory.",
  };
  const proposalRecord = storeProposalRecord(makeProposalRecord({
    operation: "update",
    targetId: id,
    proposal,
    decision,
    actor: options?.actor,
  }));
  insertAudit("restore-propose", id, { proposalId: proposalRecord.id, proposal, decision }, options?.actor, options?.reason);
  return attachProposal(decision, proposalRecord);
}

export function recordMemoryInjection(params: {
  roleName: string;
  task?: string;
  sessionKey?: string;
  cards: readonly MemoryCard[];
  reasons?: Record<string, string>;
  pack: ContextPack;
}): MemoryInjectionRecord {
  const record: MemoryInjectionRecord = {
    id: `inj_${randomUUID()}`,
    roleName: params.roleName,
    task: params.task,
    sessionKey: params.sessionKey,
    cardIds: params.cards.map((card) => card.id),
    reasons: params.reasons ?? Object.fromEntries(params.cards.map((card) => [card.id, `matched role ${params.roleName}`])),
    budget: params.pack.budget,
    estimatedTokens: params.pack.estimatedTokens,
    truncated: params.pack.truncated,
    policyVersion: params.pack.policyVersion,
    selectorSnapshot: getMemoryPolicySnapshot(),
    candidateExplanations: params.pack.candidateExplanations,
    createdAt: new Date().toISOString(),
  };
  openDatabase().prepare(
    `INSERT INTO role_memory_injections (
      id, role_name, task, session_key, card_ids_json, reasons_json, budget_json,
      estimated_tokens_json, truncated, policy_version, selector_snapshot_json, candidate_explanations_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.roleName,
    record.task ?? null,
    record.sessionKey ?? null,
    json(record.cardIds),
    json(record.reasons),
    json(record.budget),
    json(record.estimatedTokens),
    record.truncated ? 1 : 0,
    record.policyVersion ?? null,
    json(record.selectorSnapshot ?? getMemoryPolicySnapshot()),
    json(record.candidateExplanations ?? []),
    record.createdAt,
  );
  return record;
}

export function explainMemoryInjection(params?: { id?: string; roleName?: string; sessionKey?: string; limit?: number }): MemoryInjectionRecord[] {
  const limit = Math.max(1, Math.min(500, params?.limit ?? 20));
  let rows = openDatabase()
    .prepare(`SELECT * FROM role_memory_injections ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as InjectionRow[];
  if (params?.id) rows = rows.filter((row) => row.id === params.id);
  if (params?.roleName) rows = rows.filter((row) => row.role_name === params.roleName);
  if (params?.sessionKey) rows = rows.filter((row) => row.session_key === params.sessionKey);
  return rows.map((row) => ({
    id: row.id,
    roleName: row.role_name,
    task: row.task ?? undefined,
    sessionKey: row.session_key ?? undefined,
    cardIds: parseJsonArray<string>(row.card_ids_json),
    reasons: parseJsonRecord<Record<string, string>>(row.reasons_json),
    budget: parseJsonRecord(row.budget_json) as MemoryInjectionRecord["budget"],
    estimatedTokens: parseJsonRecord(row.estimated_tokens_json) as MemoryInjectionRecord["estimatedTokens"],
    truncated: row.truncated === 1,
    policyVersion: row.policy_version ?? undefined,
    selectorSnapshot: parseJsonValue(row.selector_snapshot_json, undefined),
    candidateExplanations: parseJsonArray(row.candidate_explanations_json ?? "[]"),
    createdAt: row.created_at,
  }));
}

function rowToFeedback(row: FeedbackRow): MemoryFeedbackRecord {
  return {
    id: row.id,
    injectionId: row.injection_id,
    cardId: row.card_id,
    roleName: row.role_name,
    outcome: row.outcome,
    taskSuccess: row.task_success,
    note: row.note,
    actor: parseJsonValue<MemoryAuditActor>(row.actor_json, { type: "system" }),
    createdAt: row.created_at,
  };
}

function isFeedbackOutcome(value: unknown): value is MemoryFeedbackOutcome {
  return value === "helpful" || value === "neutral" || value === "harmful" || value === "missing_needed" || value === "user_corrected";
}

function isTaskSuccess(value: unknown): value is MemoryTaskSuccess {
  return value === "success" || value === "partial" || value === "failure" || value === "unknown";
}

export function recordMemoryFeedback(params: {
  injectionId?: string | null;
  cardId?: string | null;
  roleName?: string | null;
  outcome: MemoryFeedbackOutcome;
  taskSuccess?: MemoryTaskSuccess;
  note?: string | null;
  actor?: MemoryAuditActor;
}): MemoryFeedbackRecord {
  if (!isFeedbackOutcome(params.outcome)) {
    throw new Error(`Invalid memory feedback outcome: ${String(params.outcome)}`);
  }
  const injection = params.injectionId ? explainMemoryInjection({ id: params.injectionId, limit: 500 })[0] : undefined;
  const card = params.cardId ? getMemoryCard(params.cardId) : undefined;
  const record: MemoryFeedbackRecord = {
    id: `fb_${randomUUID()}`,
    injectionId: params.injectionId ?? null,
    cardId: params.cardId ?? null,
    roleName: params.roleName ?? injection?.roleName ?? card?.roleTags?.[0] ?? null,
    outcome: params.outcome,
    taskSuccess: isTaskSuccess(params.taskSuccess) ? params.taskSuccess : "unknown",
    note: params.note ?? null,
    actor: params.actor ?? { type: "user" },
    createdAt: new Date().toISOString(),
  };
  openDatabase().prepare(
    `INSERT INTO role_memory_feedback (
      id, injection_id, card_id, role_name, outcome, task_success, note, actor_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.injectionId ?? null,
    record.cardId ?? null,
    record.roleName ?? null,
    record.outcome,
    record.taskSuccess,
    record.note ?? null,
    json(record.actor ?? { type: "user" }),
    record.createdAt,
  );
  insertAudit("feedback", record.cardId ?? null, record, record.actor, record.note ?? undefined);
  return record;
}

export function listMemoryFeedback(params?: {
  injectionId?: string;
  cardId?: string;
  roleName?: string;
  outcome?: MemoryFeedbackOutcome;
  limit?: number;
}): MemoryFeedbackRecord[] {
  const limit = Math.max(1, Math.min(500, params?.limit ?? 100));
  let rows = openDatabase()
    .prepare(`SELECT * FROM role_memory_feedback ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as FeedbackRow[];
  if (params?.injectionId) rows = rows.filter((row) => row.injection_id === params.injectionId);
  if (params?.cardId) rows = rows.filter((row) => row.card_id === params.cardId);
  if (params?.roleName) rows = rows.filter((row) => row.role_name === params.roleName);
  if (params?.outcome) rows = rows.filter((row) => row.outcome === params.outcome);
  return rows.map(rowToFeedback);
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function roundMetric(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000) / 1000;
}

function feedbackDataQuality(feedbackCount: number, observedCount: number): MemoryUtilityCardReport["dataQuality"] {
  if (feedbackCount >= 3) return "strong";
  if (feedbackCount > 0 || observedCount > 0) return "partial";
  return "insufficient";
}

function utilityScoreFromFeedback(params: {
  helpful: number;
  neutral: number;
  harmful: number;
  missingNeeded: number;
  userCorrected: number;
  total: number;
}): number | null {
  if (params.total <= 0) return null;
  const raw = (
    params.helpful * 1 +
    params.neutral * 0.25 -
    params.harmful * 1 -
    params.missingNeeded * 0.6 -
    params.userCorrected * 0.8
  ) / params.total;
  return roundMetric((raw + 1) / 2);
}

export function getMemoryUtilityReport(params?: { roleName?: string; limit?: number }): MemoryUtilityReport {
  const generatedAt = new Date().toISOString();
  const cards = getMemoryCards({ roleName: params?.roleName, status: "all" });
  const proposals = listMemoryProposals({ roleName: params?.roleName, limit: 500 });
  const conflicts = listMemoryConflicts();
  const openConflicts = conflicts.filter((conflict) => conflict.status === "open");
  const injections = explainMemoryInjection({ roleName: params?.roleName, limit: 500 });
  const feedback = listMemoryFeedback({ roleName: params?.roleName, limit: 500 });
  const cardIds = new Set(cards.map((card) => card.id));
  const conflictCounts = new Map<string, number>();
  for (const conflict of openConflicts) {
    for (const cardId of conflict.cardIds) {
      conflictCounts.set(cardId, (conflictCounts.get(cardId) ?? 0) + 1);
    }
  }
  const selectedCounts = new Map<string, number>();
  const skippedCounts = new Map<string, number>();
  const selectedByInjection = new Map<string, Set<string>>();
  let tokenTotal = 0;
  let tokenRuns = 0;
  for (const injection of injections) {
    const totalTokens = injection.estimatedTokens?.total;
    if (typeof totalTokens === "number" && Number.isFinite(totalTokens)) {
      tokenTotal += totalTokens;
      tokenRuns += 1;
    }
    const selectedForInjection = new Set<string>();
    if (injection.candidateExplanations?.length) {
      for (const candidate of injection.candidateExplanations) {
        if (candidate.selected) {
          selectedCounts.set(candidate.cardId, (selectedCounts.get(candidate.cardId) ?? 0) + 1);
          selectedForInjection.add(candidate.cardId);
        } else {
          skippedCounts.set(candidate.cardId, (skippedCounts.get(candidate.cardId) ?? 0) + 1);
        }
      }
    } else {
      for (const cardId of injection.cardIds) {
        selectedCounts.set(cardId, (selectedCounts.get(cardId) ?? 0) + 1);
        selectedForInjection.add(cardId);
      }
    }
    selectedByInjection.set(injection.id, selectedForInjection);
  }
  for (const entry of feedback) {
    if (entry.cardId) cardIds.add(entry.cardId);
  }
  const retentionByCard = new Map(cards.map((card) => [card.id, evaluateRetentionCandidate(card)]));
  const cardReports: MemoryUtilityCardReport[] = [];
  for (const cardId of cardIds) {
    const card = cards.find((entry) => entry.id === cardId);
    const cardFeedback = feedback.filter((entry) => entry.cardId === cardId);
    const helpful = cardFeedback.filter((entry) => entry.outcome === "helpful").length;
    const neutral = cardFeedback.filter((entry) => entry.outcome === "neutral").length;
    const harmful = cardFeedback.filter((entry) => entry.outcome === "harmful").length;
    const missingNeeded = cardFeedback.filter((entry) => entry.outcome === "missing_needed").length;
    const userCorrected = cardFeedback.filter((entry) => entry.outcome === "user_corrected").length;
    const observedCount = (selectedCounts.get(cardId) ?? 0) + (skippedCounts.get(cardId) ?? 0);
    const retention = card ? retentionByCard.get(card.id) : undefined;
    const dataQuality = feedbackDataQuality(cardFeedback.length, observedCount);
    const utilityScore = utilityScoreFromFeedback({
      helpful,
      neutral,
      harmful,
      missingNeeded,
      userCorrected,
      total: cardFeedback.length,
    });
    cardReports.push({
      cardId,
      card,
      selectedCount: selectedCounts.get(cardId) ?? 0,
      skippedCount: skippedCounts.get(cardId) ?? 0,
      feedbackCount: cardFeedback.length,
      helpfulCount: helpful,
      neutralCount: neutral,
      harmfulCount: harmful,
      missingNeededCount: missingNeeded,
      userCorrectedCount: userCorrected,
      conflictCount: conflictCounts.get(cardId) ?? 0,
      retentionAction: retention?.recommendedAction ?? "review",
      utilityScore,
      dataQuality,
      reasonSummary: utilityScore === null
        ? "Insufficient direct feedback for a utility score."
        : `${helpful} helpful, ${harmful} harmful, ${missingNeeded} missing-needed, ${userCorrected} corrected feedback records.`,
    });
  }
  cardReports.sort((left, right) =>
    (right.harmfulCount + right.userCorrectedCount + right.missingNeededCount) -
    (left.harmfulCount + left.userCorrectedCount + left.missingNeededCount) ||
    (right.utilityScore ?? -1) - (left.utilityScore ?? -1) ||
    right.selectedCount - left.selectedCount,
  );
  const selectedFeedback = feedback.filter((entry) =>
    entry.injectionId && entry.cardId && selectedByInjection.get(entry.injectionId)?.has(entry.cardId),
  );
  const helpful = feedback.filter((entry) => entry.outcome === "helpful").length;
  const harmful = feedback.filter((entry) => entry.outcome === "harmful").length;
  const staleCount = cards.filter((card) => {
    const action = retentionByCard.get(card.id)?.recommendedAction;
    return action === "cold" || action === "archive" || action === "tombstone" || action === "review";
  }).length;
  const reviewed = proposals.filter((proposal) => proposal.status === "applied" || proposal.status === "rejected").length;
  const missingEvidence: string[] = [];
  if (feedback.length === 0) missingEvidence.push("No user/reviewer utility feedback has been recorded yet.");
  if (injections.length === 0) missingEvidence.push("No injection logs are available for this role.");
  missingEvidence.push("No memory-on/off evaluation pairs are available, so task success delta is not computed.");
  const dataQuality: MemoryUtilityReport["dataQuality"] = feedback.length >= 20 && injections.length >= 10
    ? "strong"
    : feedback.length > 0 || injections.length > 0 || proposals.length > 0
      ? "partial"
      : "insufficient";
  return {
    roleName: params?.roleName,
    generatedAt,
    dataQuality,
    missingEvidence,
    sample: {
      cards: cards.length,
      injections: injections.length,
      feedback: feedback.length,
      proposals: proposals.length,
      conflicts: openConflicts.length,
    },
    aggregate: {
      contextPrecisionAtK: roundMetric(ratio(
        selectedFeedback.filter((entry) => entry.outcome === "helpful").length,
        selectedFeedback.filter((entry) => entry.outcome === "helpful" || entry.outcome === "neutral" || entry.outcome === "harmful" || entry.outcome === "user_corrected").length,
      )),
      helpfulnessRate: roundMetric(ratio(helpful, feedback.length)),
      harmRate: roundMetric(ratio(harmful, feedback.length)),
      staleRate: roundMetric(ratio(staleCount, cards.length)),
      conflictRate: roundMetric(ratio(new Set(openConflicts.flatMap((conflict) => conflict.cardIds)).size, cards.length)),
      reviewAcceptanceRate: roundMetric(ratio(proposals.filter((proposal) => proposal.status === "applied").length, reviewed)),
      tokenOverheadPerRun: tokenRuns > 0 ? Math.round(tokenTotal / tokenRuns) : null,
      taskSuccessDelta: null,
    },
    cards: cardReports.slice(0, Math.max(1, Math.min(100, params?.limit ?? 25))),
  };
}

export function clearMemoryCards(): void {
  if (database?.isOpen) {
    database.exec(`
      DELETE FROM role_memory_feedback;
      DELETE FROM role_memory_retention_runs;
      DELETE FROM role_memory_evidence_checks;
      DELETE FROM role_memory_review_batches;
      DELETE FROM role_memory_injections;
      DELETE FROM role_memory_audit_events;
      DELETE FROM role_memory_proposals;
      DELETE FROM role_memory_conflicts;
      DELETE FROM role_memory_versions;
      DELETE FROM role_memory_cards;
    `);
    database.close();
  }
  database = undefined;
  const dbPath = storePath;
  if (dbPath) {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* ok */ }
    }
  }
}

export function closeMemoryStore(): void {
  if (database?.isOpen) database.close();
  database = undefined;
}
