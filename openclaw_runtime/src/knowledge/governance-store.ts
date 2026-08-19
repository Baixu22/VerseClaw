import { createHash, randomUUID } from "node:crypto";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabase,
  type OpenClawStateDatabaseOptions,
} from "../state/openclaw-state-db.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export type GovernanceCandidateRecord = {
  id: string;
  recordKind: "inbox" | "draft";
  kind: string;
  type: string;
  status: string;
  title: string;
  body: string;
  sourceIds: string[];
  sourceRefs: unknown[];
  tags: string[];
  workspaceId?: string | null;
  agentId?: string | null;
  roleTags?: string[];
  createdBy: string;
  warnings?: string[];
  metadata?: Record<string, unknown>;
  captureKey?: string;
  revision?: number;
  contentDigest?: string;
  stewardNotes?: string;
  confidence?: number;
  promotedDraftId?: string;
  promotedProposalId?: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  appliedAt?: string;
  promotedAt?: string;
  dismissedAt?: string;
};

export type GovernanceProposalRecord = {
  id: string;
  operation: string;
  status: string;
  targetPageIds?: string[];
  draftId?: string;
  diff?: string;
  reason: string;
  sources: unknown[];
  requiresUserConfirmation: boolean;
  workspaceId?: string | null;
  revision?: number;
  contentDigest?: string;
  reviewedDigest?: string;
  expectedRevision?: number;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
};

export type GovernanceEventRecord = {
  id: string;
  stream: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type GovernanceOwnerLinkRecord = {
  sourceRef: string;
  owner: string;
  subjectKind: string;
  subjectId: string;
  revision: number;
  contentDigest: string;
  createdAt: string;
  updatedAt: string;
};

export type GovernanceImportBatch = {
  candidates: GovernanceCandidateRecord[];
  proposals: GovernanceProposalRecord[];
  events?: GovernanceEventRecord[];
  ownerLinks?: GovernanceOwnerLinkRecord[];
};

export type GovernanceImportParity = {
  schema: "knowledge-governance-import-parity.v1";
  importedAt: string;
  candidates: { jsonCount: number; importedCount: number; digest: string };
  proposals: { jsonCount: number; importedCount: number; digest: string };
  legacyJsonMode: "read-only";
  legacyJsonRemovalWindow: "one release window after cutover";
};

export type GovernanceStoreOptions = {
  database?: OpenClawStateDatabaseOptions;
  openDatabase?: (options?: OpenClawStateDatabaseOptions) => OpenClawStateDatabase;
  now?: () => Date;
};

export class GovernanceStore {
  readonly #database?: OpenClawStateDatabaseOptions;
  readonly #openDatabase: (options?: OpenClawStateDatabaseOptions) => OpenClawStateDatabase;
  readonly #now: () => Date;

  constructor(options: GovernanceStoreOptions = {}) {
    this.#database = options.database;
    this.#openDatabase = options.openDatabase ?? openOpenClawStateDatabase;
    this.#now = options.now ?? (() => new Date());
  }

  saveCandidate(record: GovernanceCandidateRecord): void {
    const candidate = normalizeCandidate(record);
    runOpenClawStateWriteTransaction((database) => {
      database.db.prepare(`
        INSERT INTO knowledge_candidates (
          id, record_kind, kind, type, status, title, body,
          source_ids_json, source_refs_json, tags_json, workspace_id, agent_id,
          role_tags_json, created_by, warnings_json, metadata_json, capture_key,
          revision, content_digest, steward_notes, confidence, promoted_draft_id, promoted_proposal_id,
          created_at, updated_at, reviewed_at, applied_at, promoted_at, dismissed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          record_kind = excluded.record_kind, kind = excluded.kind,
          type = excluded.type, status = excluded.status, title = excluded.title,
          body = excluded.body, source_ids_json = excluded.source_ids_json,
          source_refs_json = excluded.source_refs_json, tags_json = excluded.tags_json,
          workspace_id = excluded.workspace_id, agent_id = excluded.agent_id,
          role_tags_json = excluded.role_tags_json, created_by = excluded.created_by,
          warnings_json = excluded.warnings_json, metadata_json = excluded.metadata_json,
          capture_key = excluded.capture_key, revision = excluded.revision,
          content_digest = excluded.content_digest,
          promoted_draft_id = excluded.promoted_draft_id,
          promoted_proposal_id = excluded.promoted_proposal_id,
          created_at = excluded.created_at, updated_at = excluded.updated_at,
          reviewed_at = excluded.reviewed_at, applied_at = excluded.applied_at,
          promoted_at = excluded.promoted_at, dismissed_at = excluded.dismissed_at
      `).run(
        candidate.id, candidate.recordKind, candidate.kind, candidate.type,
        candidate.status, candidate.title, candidate.body,
        JSON.stringify(candidate.sourceIds), JSON.stringify(candidate.sourceRefs),
        JSON.stringify(candidate.tags), candidate.workspaceId ?? null, candidate.agentId ?? null,
        JSON.stringify(candidate.roleTags ?? []), candidate.createdBy,
        JSON.stringify(candidate.warnings ?? []), JSON.stringify(candidate.metadata ?? {}),
        candidate.captureKey ?? null, candidate.revision ?? 1, candidate.contentDigest ?? "",
        candidate.stewardNotes ?? null, candidate.confidence ?? null,
        candidate.promotedDraftId ?? null, candidate.promotedProposalId ?? null,
        candidate.createdAt, candidate.updatedAt, candidate.reviewedAt ?? null,
        candidate.appliedAt ?? null, candidate.promotedAt ?? null, candidate.dismissedAt ?? null,
      );
    }, this.#database);
  }

  saveProposal(record: GovernanceProposalRecord): void {
    const proposal = normalizeProposal(record);
    runOpenClawStateWriteTransaction((database) => {
      database.db.prepare(`
        INSERT INTO knowledge_governance_proposals (
          id, operation, status, target_page_ids_json, draft_id, diff, reason,
          sources_json, requires_user_confirmation, workspace_id, revision,
          content_digest, reviewed_digest, expected_revision, idempotency_key,
          created_at, updated_at, applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          operation = excluded.operation, status = excluded.status,
          target_page_ids_json = excluded.target_page_ids_json, draft_id = excluded.draft_id,
          diff = excluded.diff, reason = excluded.reason, sources_json = excluded.sources_json,
          requires_user_confirmation = excluded.requires_user_confirmation,
          workspace_id = excluded.workspace_id, revision = excluded.revision,
          content_digest = excluded.content_digest, reviewed_digest = excluded.reviewed_digest,
          expected_revision = excluded.expected_revision, idempotency_key = excluded.idempotency_key,
          created_at = excluded.created_at, updated_at = excluded.updated_at,
          applied_at = excluded.applied_at
      `).run(
        proposal.id, proposal.operation, proposal.status,
        JSON.stringify(proposal.targetPageIds ?? []), proposal.draftId ?? null,
        proposal.diff ?? null, proposal.reason, JSON.stringify(proposal.sources),
        proposal.requiresUserConfirmation ? 1 : 0, proposal.workspaceId ?? null,
        proposal.revision ?? 1, proposal.contentDigest ?? null,
        proposal.reviewedDigest ?? null, proposal.expectedRevision ?? null,
        proposal.idempotencyKey ?? null, proposal.createdAt, proposal.updatedAt,
        proposal.appliedAt ?? null,
      );
    }, this.#database);
  }

  saveEvent(record: GovernanceEventRecord): void {
    const id = record.id || `kge_${randomUUID()}`;
    runOpenClawStateWriteTransaction((database) => {
      database.db.prepare(`
        INSERT INTO knowledge_governance_events (id, stream, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          stream = excluded.stream, event_type = excluded.event_type,
          payload_json = excluded.payload_json, created_at = excluded.created_at
      `).run(id, record.stream, record.eventType, JSON.stringify(record.payload), record.createdAt);
    }, this.#database);
  }

  saveOwnerLink(record: GovernanceOwnerLinkRecord): void {
    runOpenClawStateWriteTransaction((database) => {
      database.db.prepare(`
        INSERT INTO knowledge_owner_links (source_ref, owner, subject_kind, subject_id, revision, content_digest, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_ref) DO UPDATE SET
          owner = excluded.owner, subject_kind = excluded.subject_kind,
          subject_id = excluded.subject_id, revision = excluded.revision,
          content_digest = excluded.content_digest, created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `).run(
        record.sourceRef, record.owner, record.subjectKind, record.subjectId,
        record.revision, record.contentDigest, record.createdAt, record.updatedAt,
      );
    }, this.#database);
  }

  getCandidate(id: string): GovernanceCandidateRecord | null {
    const row = this.#db().prepare("SELECT * FROM knowledge_candidates WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? candidateFromRow(row) : null;
  }

  listCandidates(filters: { status?: string; recordKind?: string; captureKey?: string } = {}): GovernanceCandidateRecord[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (filters.status) { clauses.push("status = ?"); params.push(filters.status); }
    if (filters.recordKind) { clauses.push("record_kind = ?"); params.push(filters.recordKind); }
    if (filters.captureKey) { clauses.push("capture_key = ?"); params.push(filters.captureKey); }
    const sql = `SELECT * FROM knowledge_candidates${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC, id ASC`;
    const rows = this.#db().prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(candidateFromRow);
  }

  getProposal(id: string): GovernanceProposalRecord | null {
    const row = this.#db().prepare("SELECT * FROM knowledge_governance_proposals WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? proposalFromRow(row) : null;
  }

  listProposals(filters: { status?: string; draftId?: string } = {}): GovernanceProposalRecord[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (filters.status) { clauses.push("status = ?"); params.push(filters.status); }
    if (filters.draftId) { clauses.push("draft_id = ?"); params.push(filters.draftId); }
    const sql = `SELECT * FROM knowledge_governance_proposals${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC, id ASC`;
    const rows = this.#db().prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(proposalFromRow);
  }

  /**
   * KS-06: CAS-protected proposal status transition with audit event.
   * Accepts an optional expectedRevision and optional expectedDigest so stale
   * approvals cannot be committed against a moved proposal.
   */
  transitionProposal(input: {
    proposalId: string;
    fromStatuses: string[];
    toStatus: string;
    expectedRevision?: number;
    expectedDigest?: string;
    actorId?: string;
    eventType?: string;
  }): GovernanceProposalRecord {
    const proposal = this.getProposal(input.proposalId);
    if (!proposal) {
      throw new Error(`governance proposal not found: ${input.proposalId}`);
    }
    if (!input.fromStatuses.includes(proposal.status)) {
      throw new Error(
        `governance proposal ${input.proposalId} has status ${proposal.status}, expected ${input.fromStatuses.join(" or ")}`,
      );
    }
    const currentRevision = proposal.revision ?? 1;
    if (input.expectedRevision !== undefined && currentRevision !== input.expectedRevision) {
      throw new Error(
        `stale_revision for proposal ${input.proposalId}: expected ${input.expectedRevision}, actual ${currentRevision}`,
      );
    }
    if (input.expectedDigest !== undefined && proposal.contentDigest !== input.expectedDigest) {
      throw new Error(
        `stale_digest for proposal ${input.proposalId}: expected ${input.expectedDigest}, actual ${proposal.contentDigest}`,
      );
    }
    const now = this.#now().toISOString();
    const nextRevision = currentRevision + 1;
    this.saveProposal({
      ...proposal,
      status: input.toStatus,
      revision: nextRevision,
      updatedAt: now,
      ...(input.toStatus === "approved" && input.expectedDigest
        ? { reviewedDigest: input.expectedDigest }
        : {}),
      ...(input.toStatus === "committed" ? { appliedAt: now } : {}),
    });
    this.saveEvent({
      id: `kge_${input.proposalId}_${nextRevision}_${input.toStatus}`,
      stream: "governance",
      eventType: input.eventType ?? `proposal_${input.toStatus}`,
      payload: {
        proposalId: input.proposalId,
        fromStatus: proposal.status,
        toStatus: input.toStatus,
        revision: nextRevision,
        ...(input.actorId ? { actorId: input.actorId } : {}),
      },
      createdAt: now,
    });
    return this.getProposal(input.proposalId)!;
  }

  listOwnerLinks(owner?: string): GovernanceOwnerLinkRecord[] {
    const sql = owner
      ? "SELECT * FROM knowledge_owner_links WHERE owner = ? ORDER BY updated_at DESC"
      : "SELECT * FROM knowledge_owner_links ORDER BY updated_at DESC";
    const rows = (owner ? this.#db().prepare(sql).all(owner) : this.#db().prepare(sql).all()) as Array<Record<string, unknown>>;
    return rows.map(ownerLinkFromRow);
  }

  /** KS-03 one-shot import in one immediate transaction. */
  importBatch(batch: GovernanceImportBatch, importedAt = this.#now().toISOString()): GovernanceImportParity {
    const candidates = batch.candidates.map(normalizeCandidate);
    const proposals = batch.proposals.map(normalizeProposal);
    const candidateDigest = createHash("sha256").update(JSON.stringify(candidates)).digest("hex");
    const proposalDigest = createHash("sha256").update(JSON.stringify(proposals)).digest("hex");
    const database = this.#openDatabase(this.#database);
    runSqliteImmediateTransactionSync(database.db, () => {
      for (const candidate of candidates) runCandidateUpsert(database.db, candidate);
      for (const proposal of proposals) runProposalUpsert(database.db, proposal);
      for (const event of batch.events ?? []) runEventUpsert(database.db, event);
      for (const link of batch.ownerLinks ?? []) runOwnerLinkUpsert(database.db, link);
    });
    return {
      schema: "knowledge-governance-import-parity.v1",
      importedAt,
      candidates: { jsonCount: candidates.length, importedCount: this.listCandidates().length, digest: candidateDigest },
      proposals: { jsonCount: proposals.length, importedCount: this.listProposals().length, digest: proposalDigest },
      legacyJsonMode: "read-only",
      legacyJsonRemovalWindow: "one release window after cutover",
    };
  }

  #db() {
    return this.#openDatabase(this.#database).db;
  }
}


function runCandidateUpsert(db: DatabaseSync, candidate: GovernanceCandidateRecord): void {
  db.prepare(`
    INSERT INTO knowledge_candidates (
      id, record_kind, kind, type, status, title, body,
      source_ids_json, source_refs_json, tags_json, workspace_id, agent_id,
      role_tags_json, created_by, warnings_json, metadata_json, capture_key,
      revision, content_digest, steward_notes, confidence, promoted_draft_id, promoted_proposal_id,
      created_at, updated_at, reviewed_at, applied_at, promoted_at, dismissed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      record_kind = excluded.record_kind, kind = excluded.kind,
      type = excluded.type, status = excluded.status, title = excluded.title,
      body = excluded.body, source_ids_json = excluded.source_ids_json,
      source_refs_json = excluded.source_refs_json, tags_json = excluded.tags_json,
      workspace_id = excluded.workspace_id, agent_id = excluded.agent_id,
      role_tags_json = excluded.role_tags_json, created_by = excluded.created_by,
      warnings_json = excluded.warnings_json, metadata_json = excluded.metadata_json,
      capture_key = excluded.capture_key, revision = excluded.revision,
      content_digest = excluded.content_digest,
      steward_notes = excluded.steward_notes,
      confidence = excluded.confidence,
      promoted_draft_id = excluded.promoted_draft_id,
      promoted_proposal_id = excluded.promoted_proposal_id,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      reviewed_at = excluded.reviewed_at, applied_at = excluded.applied_at,
      promoted_at = excluded.promoted_at, dismissed_at = excluded.dismissed_at
  `).run(
    candidate.id, candidate.recordKind, candidate.kind, candidate.type,
    candidate.status, candidate.title, candidate.body,
    JSON.stringify(candidate.sourceIds), JSON.stringify(candidate.sourceRefs),
    JSON.stringify(candidate.tags), candidate.workspaceId ?? null, candidate.agentId ?? null,
    JSON.stringify(candidate.roleTags ?? []), candidate.createdBy,
    JSON.stringify(candidate.warnings ?? []), JSON.stringify(candidate.metadata ?? {}),
    candidate.captureKey ?? null, candidate.revision ?? 1, candidate.contentDigest ?? "",
    candidate.stewardNotes ?? null, candidate.confidence ?? null,
    candidate.promotedDraftId ?? null, candidate.promotedProposalId ?? null,
    candidate.createdAt, candidate.updatedAt, candidate.reviewedAt ?? null,
    candidate.appliedAt ?? null, candidate.promotedAt ?? null, candidate.dismissedAt ?? null,
  );
}

function runProposalUpsert(db: DatabaseSync, proposal: GovernanceProposalRecord): void {
  db.prepare(`
    INSERT INTO knowledge_governance_proposals (
      id, operation, status, target_page_ids_json, draft_id, diff, reason,
      sources_json, requires_user_confirmation, workspace_id, revision,
      content_digest, reviewed_digest, expected_revision, idempotency_key,
      created_at, updated_at, applied_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      operation = excluded.operation, status = excluded.status,
      target_page_ids_json = excluded.target_page_ids_json, draft_id = excluded.draft_id,
      diff = excluded.diff, reason = excluded.reason, sources_json = excluded.sources_json,
      requires_user_confirmation = excluded.requires_user_confirmation,
      workspace_id = excluded.workspace_id, revision = excluded.revision,
      content_digest = excluded.content_digest, reviewed_digest = excluded.reviewed_digest,
      expected_revision = excluded.expected_revision, idempotency_key = excluded.idempotency_key,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      applied_at = excluded.applied_at
  `).run(
    proposal.id, proposal.operation, proposal.status,
    JSON.stringify(proposal.targetPageIds ?? []), proposal.draftId ?? null,
    proposal.diff ?? null, proposal.reason, JSON.stringify(proposal.sources),
    proposal.requiresUserConfirmation ? 1 : 0, proposal.workspaceId ?? null,
    proposal.revision ?? 1, proposal.contentDigest ?? null,
    proposal.reviewedDigest ?? null, proposal.expectedRevision ?? null,
    proposal.idempotencyKey ?? null, proposal.createdAt, proposal.updatedAt,
    proposal.appliedAt ?? null,
  );
}

function runEventUpsert(db: DatabaseSync, record: GovernanceEventRecord): void {
  db.prepare(`
    INSERT INTO knowledge_governance_events (id, stream, event_type, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      stream = excluded.stream, event_type = excluded.event_type,
      payload_json = excluded.payload_json, created_at = excluded.created_at
  `).run(record.id || `kge_${randomUUID()}`, record.stream, record.eventType, JSON.stringify(record.payload), record.createdAt);
}

function runOwnerLinkUpsert(db: DatabaseSync, record: GovernanceOwnerLinkRecord): void {
  db.prepare(`
    INSERT INTO knowledge_owner_links (source_ref, owner, subject_kind, subject_id, revision, content_digest, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_ref) DO UPDATE SET
      owner = excluded.owner, subject_kind = excluded.subject_kind,
      subject_id = excluded.subject_id, revision = excluded.revision,
      content_digest = excluded.content_digest, created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `).run(
    record.sourceRef, record.owner, record.subjectKind, record.subjectId,
    record.revision, record.contentDigest, record.createdAt, record.updatedAt,
  );
}

function normalizeCandidate(record: GovernanceCandidateRecord): GovernanceCandidateRecord {
  return {
    ...record,
    sourceIds: Array.isArray(record.sourceIds) ? record.sourceIds : [],
    sourceRefs: Array.isArray(record.sourceRefs) ? record.sourceRefs : [],
    tags: Array.isArray(record.tags) ? record.tags : [],
    roleTags: Array.isArray(record.roleTags) ? record.roleTags : [],
    warnings: Array.isArray(record.warnings) ? record.warnings : [],
    revision: Math.max(1, record.revision ?? 1),
    contentDigest: record.contentDigest ?? "",
    stewardNotes: record.stewardNotes,
    confidence: record.confidence,
  };
}

function normalizeProposal(record: GovernanceProposalRecord): GovernanceProposalRecord {
  return {
    ...record,
    targetPageIds: Array.isArray(record.targetPageIds) ? record.targetPageIds : [],
    sources: Array.isArray(record.sources) ? record.sources : [],
    requiresUserConfirmation: record.requiresUserConfirmation !== false,
    revision: Math.max(1, record.revision ?? 1),
  };
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStringArray(value: unknown): string[] {
  return parseJsonArray(value).filter((item): item is string => typeof item === "string");
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function candidateFromRow(row: Record<string, unknown>): GovernanceCandidateRecord {
  return {
    id: String(row.id),
    recordKind: String(row.record_kind) as GovernanceCandidateRecord['recordKind'],
    kind: String(row.kind),
    type: String(row.type),
    status: String(row.status),
    title: String(row.title),
    body: String(row.body),
    sourceIds: parseStringArray(row.source_ids_json),
    sourceRefs: parseJsonArray(row.source_refs_json),
    tags: parseStringArray(row.tags_json),
    ...(row.workspace_id === null ? { workspaceId: null } : typeof row.workspace_id === "string" ? { workspaceId: row.workspace_id } : {}),
    ...(row.agent_id === null ? { agentId: null } : typeof row.agent_id === "string" ? { agentId: row.agent_id } : {}),
    roleTags: parseStringArray(row.role_tags_json),
    createdBy: String(row.created_by),
    warnings: parseStringArray(row.warnings_json),
    metadata: parseJsonObject(row.metadata_json),
    ...(optionalString(row.capture_key) ? { captureKey: optionalString(row.capture_key) } : {}),
    revision: Number(row.revision) || 1,
    contentDigest: String(row.content_digest ?? ""),
    ...(optionalString(row.steward_notes) ? { stewardNotes: optionalString(row.steward_notes) } : {}),
    ...(row.confidence === null ? {} : { confidence: Number(row.confidence) }),
    ...(optionalString(row.promoted_draft_id) ? { promotedDraftId: optionalString(row.promoted_draft_id) } : {}),
    ...(optionalString(row.promoted_proposal_id) ? { promotedProposalId: optionalString(row.promoted_proposal_id) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(optionalString(row.reviewed_at) ? { reviewedAt: optionalString(row.reviewed_at) } : {}),
    ...(optionalString(row.applied_at) ? { appliedAt: optionalString(row.applied_at) } : {}),
    ...(optionalString(row.promoted_at) ? { promotedAt: optionalString(row.promoted_at) } : {}),
    ...(optionalString(row.dismissed_at) ? { dismissedAt: optionalString(row.dismissed_at) } : {}),
  };
}

function proposalFromRow(row: Record<string, unknown>): GovernanceProposalRecord {
  return {
    id: String(row.id),
    operation: String(row.operation),
    status: String(row.status),
    targetPageIds: parseStringArray(row.target_page_ids_json),
    ...(optionalString(row.draft_id) ? { draftId: optionalString(row.draft_id) } : {}),
    ...(optionalString(row.diff) ? { diff: optionalString(row.diff) } : {}),
    reason: String(row.reason),
    sources: parseJsonArray(row.sources_json),
    requiresUserConfirmation: Number(row.requires_user_confirmation) === 1,
    ...(row.workspace_id === null ? { workspaceId: null } : typeof row.workspace_id === "string" ? { workspaceId: row.workspace_id } : {}),
    revision: Number(row.revision) || 1,
    ...(optionalString(row.content_digest) ? { contentDigest: optionalString(row.content_digest) } : {}),
    ...(optionalString(row.reviewed_digest) ? { reviewedDigest: optionalString(row.reviewed_digest) } : {}),
    ...(row.expected_revision === null ? {} : { expectedRevision: Number(row.expected_revision) }),
    ...(optionalString(row.idempotency_key) ? { idempotencyKey: optionalString(row.idempotency_key) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(optionalString(row.applied_at) ? { appliedAt: optionalString(row.applied_at) } : {}),
  };
}

function ownerLinkFromRow(row: Record<string, unknown>): GovernanceOwnerLinkRecord {
  return {
    sourceRef: String(row.source_ref),
    owner: String(row.owner),
    subjectKind: String(row.subject_kind),
    subjectId: String(row.subject_id),
    revision: Number(row.revision) || 1,
    contentDigest: String(row.content_digest),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
