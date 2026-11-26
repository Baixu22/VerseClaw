// Stage 3 pure Working Context contract helpers. These functions never touch
// disk, never read wall-clock time during projection, and never make Memory or
// provider decisions. Electron and the OpenClaw runtime import this single
// implementation so proposal/accept/reject validation, projection, and merge
// semantics cannot drift.
import { TASK_LEDGER_WORKING_CONTEXT_FIELDS } from './types/task-ledger.js';
import { normalizeContextSemanticState, type ContextSemanticState } from './types/context-item.js';
import type {
  TaskLedgerActor,
  TaskLedgerEvent,
  TaskLedgerEventInput,
  TaskLedgerEvidenceRef,
  TaskLedgerWorkingContextAcceptedRecord,
  TaskLedgerWorkingContextDecision,
  TaskLedgerWorkingContextField,
  TaskLedgerWorkingContextFieldProjection,
  TaskLedgerWorkingContextFieldValue,
  TaskLedgerWorkingContextProposal,
  TaskLedgerWorkingContextProposalRecord,
  TaskLedgerWorkingContextRejectedRecord,
  TaskLedgerWorkingContextSensitivity,
  TaskLedgerWorkingContextSnapshot,
  TaskLedgerWorkingContextTrust,
  TaskLedgerWorkingContextWarning,
} from './types/task-ledger.js';

export const STAGE3_WORKING_CONTEXT_RULE_ID = 'stage3-task-ledger-working-context:v1';

export function workingContextSemanticState(
  current: TaskLedgerWorkingContextAcceptedRecord,
  history: readonly TaskLedgerWorkingContextAcceptedRecord[] = [],
  conflicts: readonly TaskLedgerWorkingContextProposalRecord[] = [],
): ContextSemanticState {
  return normalizeContextSemanticState({
    owner: 'task-ledger-working-context', sourceStatus: current.trust,
    polarity: 'unknown', scope: `task:${current.taskId}`, evidenceRefs: current.evidenceRefs,
    sourceRef: current.acceptedEventId, sourceVersion: String(current.version),
    supersedes: history.filter(entry => entry.taskId === current.taskId && entry.field === current.field
      && entry.version < current.version).slice(-20).map(entry => entry.proposalId),
    conflicts: conflicts.filter(entry => entry.taskId === current.taskId && entry.field === current.field)
      .slice(0, 20).map(entry => entry.proposalId),
  });
}
export const STAGE3_WORKING_CONTEXT_POLICY_DIGEST =
  'sha256:f100f8862c9979e6bc662376c98b80587cec4a026d2cbdbb239dbe3a9c009f19';

export const STAGE3_WORKING_CONTEXT_LIMITS = {
  proposalIdMax: 128,
  scalarMax: 2_000,
  stringItemMax: 500,
  stringArrayMax: 20,
  evidenceRefsMax: 20,
  evidenceRefMax: 512,
  evidenceLabelMax: 120,
  rejectionReasonMax: 500,
  defaultTtlMs: 24 * 60 * 60 * 1_000,
  maxTtlMs: 7 * 24 * 60 * 60 * 1_000,
} as const;

export type Stage3WorkingContextPolicy =
  | 'stage3-task-ledger-working-context:v1';

export type TaskLedgerWorkingContextWarningWithReasons =
  | { ok: true }
  | { ok: false; reason: string };

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
const SHA256_DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const FORBIDDEN_VALUE_RE =
  /(sk-[a-z0-9]{12,}|deepseek_api_key|api[_-]?key\s*[:=]|-----begin [a-z ]+private key-----)/i;

function containsForbiddenValue(value: string): boolean {
  return FORBIDDEN_VALUE_RE.test(value);
}

const SCALAR_FIELDS = new Set<TaskLedgerWorkingContextField>(['Objective', 'NextAction']);
const STRING_ARRAY_FIELDS = new Set<TaskLedgerWorkingContextField>([
  'Constraints',
  'ConfirmedFacts',
  'Decisions',
  'OpenRisks',
  'ActiveFiles',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function isTaskLedgerActor(value: unknown): value is TaskLedgerActor {
  return value === 'user' || value === 'assistant' || value === 'system';
}

function isField(value: unknown): value is TaskLedgerWorkingContextField {
  return typeof value === 'string'
    && (TASK_LEDGER_WORKING_CONTEXT_FIELDS as readonly string[]).includes(value);
}

function validEvidenceRef(value: unknown): value is TaskLedgerEvidenceRef {
  if (!isRecord(value)) return false;
  const type = value.type;
  const ref = value.ref;
  const label = value.label;
  if (
    type !== 'session'
    && type !== 'trace'
    && type !== 'file'
    && type !== 'memory'
    && type !== 'manual'
    && type !== 'tool'
    && type !== 'other'
  ) return false;
  if (!nonEmptyString(ref, STAGE3_WORKING_CONTEXT_LIMITS.evidenceRefMax)
    || containsForbiddenValue(ref)) return false;
  if (label !== undefined && (!nonEmptyString(label, STAGE3_WORKING_CONTEXT_LIMITS.evidenceLabelMax)
    || containsForbiddenValue(label))) {
    return false;
  }
  return true;
}

function validEvidenceRefs(value: unknown): value is TaskLedgerEvidenceRef[] {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= STAGE3_WORKING_CONTEXT_LIMITS.evidenceRefsMax
    && value.every(validEvidenceRef);
}

function validateFieldValue(
  field: TaskLedgerWorkingContextField,
  value: unknown,
): TaskLedgerWorkingContextWarningWithReasons {
  if (SCALAR_FIELDS.has(field)) {
    if (!nonEmptyString(value, STAGE3_WORKING_CONTEXT_LIMITS.scalarMax)
      || containsForbiddenValue(value)) {
      return {
        ok: false,
        reason: `${field} must be a non-empty bounded string (max ${STAGE3_WORKING_CONTEXT_LIMITS.scalarMax} chars, no credential-like content)`,
      };
    }
    return { ok: true };
  }
  if (STRING_ARRAY_FIELDS.has(field)) {
    if (!Array.isArray(value)
      || value.length === 0
      || value.length > STAGE3_WORKING_CONTEXT_LIMITS.stringArrayMax
      || !value.every((item) => nonEmptyString(item, STAGE3_WORKING_CONTEXT_LIMITS.stringItemMax)
        && !containsForbiddenValue(item))) {
      return {
        ok: false,
        reason: `${field} must be a non-empty string array (max ${STAGE3_WORKING_CONTEXT_LIMITS.stringArrayMax} items, ${STAGE3_WORKING_CONTEXT_LIMITS.stringItemMax} chars each, no credential-like content)`,
      };
    }
    return { ok: true };
  }
  if (field === 'Evidence') {
    if (!validEvidenceRefs(value)) {
      return {
        ok: false,
        reason: `Evidence must be 1-${STAGE3_WORKING_CONTEXT_LIMITS.evidenceRefsMax} bounded evidence refs`,
      };
    }
    return { ok: true };
  }
  return { ok: false, reason: `unknown Working Context field ${String(field)}` };
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP_RE.test(value);
}

function validTtl(value: unknown): value is TaskLedgerWorkingContextProposal['ttl'] {
  if (!isRecord(value)) return false;
  const issuedAt = value.issuedAt;
  const expiresAt = value.expiresAt;
  if (!validIso(issuedAt) || !validIso(expiresAt)) return false;
  return expiresAt > issuedAt;
}

function cloneValue(value: TaskLedgerWorkingContextFieldValue): TaskLedgerWorkingContextFieldValue {
  if (typeof value === 'string') return value;
  return value.map((item) => (typeof item === 'string' ? item : { ...item })) as TaskLedgerWorkingContextFieldValue;
}

function emptyFieldProjection(field: TaskLedgerWorkingContextField): TaskLedgerWorkingContextFieldProjection {
  return {
    field,
    current: undefined,
    history: [],
    pending: [],
    conflicts: [],
    rejected: [],
    expired: [],
  } as TaskLedgerWorkingContextFieldProjection;
}

export function emptyTaskLedgerWorkingContextSnapshot(): TaskLedgerWorkingContextSnapshot {
  const fields = Object.fromEntries(
    TASK_LEDGER_WORKING_CONTEXT_FIELDS.map((field) => [field, emptyFieldProjection(field)]),
  ) as TaskLedgerWorkingContextSnapshot['fields'];
  return {
    schemaVersion: 1,
    fields,
    promotionCandidates: [],
    warnings: [],
  };
}

export type TaskLedgerWorkingContextProposalInput = {
  proposalId: string;
  field: TaskLedgerWorkingContextField;
  value: TaskLedgerWorkingContextFieldValue;
  version: number;
  actor: 'user' | 'assistant';
  taskId: string;
  sessionId?: string | null;
  evidenceRefs: TaskLedgerEvidenceRef[];
  ttl?: { issuedAt?: string; expiresAt?: string };
  sensitivity?: TaskLedgerWorkingContextSensitivity;
  trust?: TaskLedgerWorkingContextTrust;
  createdAt?: string;
  idempotencyKey?: string;
};

export type TaskLedgerWorkingContextDecisionInput = {
  proposalId: string;
  field: TaskLedgerWorkingContextField;
  version: number;
  decision: 'accepted' | 'rejected';
  actor: 'user' | 'system';
  taskId: string;
  sessionId?: string | null;
  policyDigest: string;
  rejectionReason?: string;
  createdAt?: string;
  idempotencyKey?: string;
};

export type WorkingContextEventResult =
  | { ok: true; event: TaskLedgerEventInput }
  | { ok: false; reason: string };

function baseValidation(input: {
  taskId: string;
  actor: TaskLedgerActor;
}): TaskLedgerWorkingContextWarningWithReasons {
  if (!nonEmptyString(input.taskId, STAGE3_WORKING_CONTEXT_LIMITS.proposalIdMax * 2)) {
    return { ok: false, reason: 'taskId is required and must be bounded' };
  }
  if (!isTaskLedgerActor(input.actor)) {
    return { ok: false, reason: 'actor is missing or invalid' };
  }
  return { ok: true };
}

export function createTaskLedgerWorkingContextProposal(
  input: TaskLedgerWorkingContextProposalInput,
): WorkingContextEventResult {
  const base = baseValidation({ taskId: input.taskId, actor: input.actor });
  if (!base.ok) return base;
  if (input.actor !== 'user' && input.actor !== 'assistant') {
    return { ok: false, reason: 'proposal actor must be user or assistant' };
  }
  if (!nonEmptyString(input.proposalId, STAGE3_WORKING_CONTEXT_LIMITS.proposalIdMax)
    || !ID_RE.test(input.proposalId)) {
    return { ok: false, reason: 'proposalId is missing or not a bounded id' };
  }
  if (!isField(input.field)) {
    return { ok: false, reason: 'field is not a Stage 3 Working Context field' };
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    return { ok: false, reason: 'version must be a positive integer' };
  }
  const value = validateFieldValue(input.field, input.value);
  if (!value.ok) return value;
  if (!validEvidenceRefs(input.evidenceRefs)) {
    return {
      ok: false,
      reason: `evidenceRefs must be 1-${STAGE3_WORKING_CONTEXT_LIMITS.evidenceRefsMax} bounded refs`,
    };
  }
  const issuedAt = input.ttl?.issuedAt ?? input.createdAt ?? new Date().toISOString();
  if (!validIso(issuedAt)) return { ok: false, reason: 'ttl.issuedAt must be ISO-8601' };
  const issuedMs = Date.parse(issuedAt);
  const expiresAt = input.ttl?.expiresAt
    ?? new Date(issuedMs + STAGE3_WORKING_CONTEXT_LIMITS.defaultTtlMs).toISOString();
  if (!validIso(expiresAt)) return { ok: false, reason: 'ttl.expiresAt must be ISO-8601' };
  const ttlMs = Date.parse(expiresAt) - issuedMs;
  if (ttlMs <= 0) return { ok: false, reason: 'ttl.expiresAt must be after ttl.issuedAt' };
  if (ttlMs > STAGE3_WORKING_CONTEXT_LIMITS.maxTtlMs) {
    return {
      ok: false,
      reason: `TTL exceeds ${STAGE3_WORKING_CONTEXT_LIMITS.maxTtlMs} ms`,
    };
  }
  const sensitivity = input.sensitivity ?? 'workspace';
  const trust = input.trust ?? 'proposed';
  if (sensitivity !== 'public' && sensitivity !== 'workspace' && sensitivity !== 'secret-adjacent') {
    return { ok: false, reason: 'sensitivity is invalid' };
  }
  if (trust !== 'confirmed' && trust !== 'proposed' && trust !== 'uncertain') {
    return { ok: false, reason: 'trust is invalid' };
  }
  const createdAt = input.createdAt ?? issuedAt;
  return {
    ok: true,
    event: {
      type: 'working_context_proposed',
      actor: input.actor,
      taskId: input.taskId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      idempotencyKey: input.idempotencyKey ?? `wc:proposal:${input.proposalId}`,
      createdAt,
      payload: {
        workingContextProposal: {
          proposalId: input.proposalId,
          field: input.field,
          value: cloneValue(input.value),
          version: input.version,
          evidenceRefs: input.evidenceRefs.map((ref) => ({ ...ref })),
          ttl: { issuedAt, expiresAt },
          sensitivity,
          trust,
        },
      },
    },
  };
}

export function createTaskLedgerWorkingContextDecision(
  input: TaskLedgerWorkingContextDecisionInput,
): WorkingContextEventResult {
  const base = baseValidation({ taskId: input.taskId, actor: input.actor });
  if (!base.ok) return base;
  if (input.actor !== 'user' && input.actor !== 'system') {
    return { ok: false, reason: 'decision actor must be user or system' };
  }
  if (!nonEmptyString(input.proposalId, STAGE3_WORKING_CONTEXT_LIMITS.proposalIdMax)
    || !ID_RE.test(input.proposalId)) {
    return { ok: false, reason: 'proposalId is missing or not a bounded id' };
  }
  if (!isField(input.field)) {
    return { ok: false, reason: 'field is not a Stage 3 Working Context field' };
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    return { ok: false, reason: 'version must be a positive integer' };
  }
  if (!SHA256_DIGEST_RE.test(input.policyDigest)) {
    return { ok: false, reason: 'policyDigest must be sha256:<64 lowercase hex>' };
  }
  if (input.decision !== 'accepted' && input.decision !== 'rejected') {
    return { ok: false, reason: 'decision must be accepted or rejected' };
  }
  let rejectionReason: string | undefined;
  if (input.decision === 'rejected') {
    if (!nonEmptyString(input.rejectionReason, STAGE3_WORKING_CONTEXT_LIMITS.rejectionReasonMax)) {
      return {
        ok: false,
        reason: `rejectionReason is required and at most ${STAGE3_WORKING_CONTEXT_LIMITS.rejectionReasonMax} chars`,
      };
    }
    rejectionReason = input.rejectionReason;
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    ok: true,
    event: {
      type: input.decision === 'accepted'
        ? 'working_context_proposal_accepted'
        : 'working_context_proposal_rejected',
      actor: input.actor,
      taskId: input.taskId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      idempotencyKey: input.idempotencyKey
        ?? `wc:${input.decision}:${input.proposalId}`,
      createdAt,
      payload: {
        workingContextDecision: {
          proposalId: input.proposalId,
          field: input.field,
          version: input.version,
          decision: input.decision,
          policyDigest: input.policyDigest,
          ...(rejectionReason ? { rejectionReason } : {}),
        },
      },
    },
  };
}

export type ProjectTaskLedgerWorkingContextOptions = {
  /** Deterministic replay time. Defaults to the latest event createdAt. */
  asOf?: string;
};

function latestCreatedAt(events: TaskLedgerEvent[]): string {
  let latest = '';
  for (const event of events) {
    if (event.createdAt > latest) latest = event.createdAt;
  }
  return latest;
}

type ProposalParseResult = {
  ok: boolean;
  reason: string;
  record?: TaskLedgerWorkingContextProposalRecord;
};

function proposalFromEvent(event: TaskLedgerEvent): ProposalParseResult {
  if (event.type !== 'working_context_proposed') {
    return { ok: false, reason: 'not a proposal event' };
  }
  const eventTaskId = event.taskId ?? '';
  if (!nonEmptyString(eventTaskId, 512)) {
    return { ok: false, reason: 'missing_task_id' };
  }
  if (!isTaskLedgerActor(event.actor)) {
    return { ok: false, reason: 'missing_actor' };
  }
  if (event.actor !== 'user' && event.actor !== 'assistant') {
    return { ok: false, reason: 'illegal_actor' };
  }
  const payload = event.payload.workingContextProposal;
  if (!isRecord(payload) || !isField(payload.field) || !validTtl(payload.ttl)) {
    return { ok: false, reason: 'invalid_event' };
  }
  const proposal = payload as unknown as TaskLedgerWorkingContextProposal;
  const value = validateFieldValue(proposal.field, proposal.value);
  if (!value.ok) return { ok: false, reason: value.reason };
  if (!nonEmptyString(proposal.proposalId, STAGE3_WORKING_CONTEXT_LIMITS.proposalIdMax)
    || !ID_RE.test(proposal.proposalId)) {
    return { ok: false, reason: 'invalid_event' };
  }
  if (!Number.isInteger(proposal.version) || proposal.version < 1) {
    return { ok: false, reason: 'invalid_event' };
  }
  if (!validEvidenceRefs(proposal.evidenceRefs)) {
    return { ok: false, reason: 'invalid_event' };
  }
  if (
    proposal.sensitivity !== 'public'
    && proposal.sensitivity !== 'workspace'
    && proposal.sensitivity !== 'secret-adjacent'
  ) {
    return { ok: false, reason: 'invalid_event' };
  }
  if (
    proposal.trust !== 'confirmed'
    && proposal.trust !== 'proposed'
    && proposal.trust !== 'uncertain'
  ) {
    return { ok: false, reason: 'invalid_event' };
  }
  return {
    ok: true,
    reason: 'ok',
    record: {
      proposalId: proposal.proposalId,
      field: proposal.field,
      value: cloneValue(proposal.value),
      version: proposal.version,
      actor: event.actor,
      evidenceRefs: proposal.evidenceRefs.map((ref) => ({ ...ref })),
      ttl: { ...proposal.ttl },
      sensitivity: proposal.sensitivity,
      trust: proposal.trust,
      eventId: event.id,
      taskId: eventTaskId,
      sessionId: event.sessionId,
      createdAt: event.createdAt,
    },
  };
}

type DecisionParseResult = {
  ok: boolean;
  reason: string;
  decision?: TaskLedgerWorkingContextDecision;
  rejected?: TaskLedgerWorkingContextRejectedRecord;
};

function decisionFromEvent(event: TaskLedgerEvent): DecisionParseResult {
  if (event.type !== 'working_context_proposal_accepted'
    && event.type !== 'working_context_proposal_rejected') {
    return { ok: false, reason: 'not a decision event' };
  }
  const eventTaskId = event.taskId ?? '';
  if (!nonEmptyString(eventTaskId, 512)) {
    return { ok: false, reason: 'missing_task_id' };
  }
  if (!isTaskLedgerActor(event.actor)) {
    return { ok: false, reason: 'missing_actor' };
  }
  const payload = event.payload.workingContextDecision;
  if (!isRecord(payload) || !isField(payload.field)) {
    return { ok: false, reason: 'invalid_event' };
  }
  const decision = payload as unknown as TaskLedgerWorkingContextDecision;
  if (!nonEmptyString(decision.proposalId, STAGE3_WORKING_CONTEXT_LIMITS.proposalIdMax)
    || !ID_RE.test(decision.proposalId)
    || !Number.isInteger(decision.version)
    || decision.version < 1
    || !SHA256_DIGEST_RE.test(decision.policyDigest)) {
    return { ok: false, reason: 'invalid_event' };
  }
  if (decision.decision !== 'accepted' && decision.decision !== 'rejected') {
    return { ok: false, reason: 'invalid_event' };
  }
  const expectedDecisionType = decision.decision === 'accepted'
    ? 'working_context_proposal_accepted'
    : 'working_context_proposal_rejected';
  if (event.type !== expectedDecisionType) {
    return { ok: false, reason: 'invalid_decision' };
  }
  if (decision.decision === 'rejected') {
    if (!nonEmptyString(decision.rejectionReason, STAGE3_WORKING_CONTEXT_LIMITS.rejectionReasonMax)) {
      return { ok: false, reason: 'invalid_event' };
    }
    return {
      ok: true,
      reason: 'ok',
      decision,
      rejected: {
        proposalId: decision.proposalId,
        field: decision.field,
        version: decision.version,
        actor: event.actor,
        policyDigest: decision.policyDigest,
        rejectionReason: decision.rejectionReason ?? '',
        eventId: event.id,
        taskId: eventTaskId,
        createdAt: event.createdAt,
      },
    };
  }
  return { ok: true, reason: 'ok', decision };
}

function removePending(
  snapshot: TaskLedgerWorkingContextSnapshot,
  proposal: TaskLedgerWorkingContextProposalRecord,
): void {
  snapshot.fields[proposal.field].pending = snapshot.fields[proposal.field].pending
    .filter((item) => item.proposalId !== proposal.proposalId);
}

export function projectTaskLedgerWorkingContext(
  events: TaskLedgerEvent[],
  options: ProjectTaskLedgerWorkingContextOptions = {},
): TaskLedgerWorkingContextSnapshot {
  const snapshot = emptyTaskLedgerWorkingContextSnapshot();
  const warnings: TaskLedgerWorkingContextWarning[] = [];
  const proposalsById = new Map<string, TaskLedgerWorkingContextProposalRecord>();
  const acceptedIds = new Set<string>();
  const asOf = options.asOf ?? latestCreatedAt(events);

  for (const event of events) {
    if (event.type === 'working_context_proposed') {
      const parsed = proposalFromEvent(event);
      if (!parsed.ok || !parsed.record) {
        warnings.push({
          type: parsed.reason === 'missing_task_id'
            ? 'missing_task_id'
            : parsed.reason === 'missing_actor'
              ? 'missing_actor'
              : parsed.reason === 'illegal_actor'
                ? 'illegal_actor'
                : 'invalid_event',
          message: parsed.reason,
          eventId: event.id,
        });
        continue;
      }
      if (proposalsById.has(parsed.record.proposalId)) {
        warnings.push({
          type: 'duplicate_proposal',
          message: `duplicate proposal ${parsed.record.proposalId}`,
          eventId: event.id,
          proposalId: parsed.record.proposalId,
          field: parsed.record.field,
        });
        continue;
      }
      proposalsById.set(parsed.record.proposalId, parsed.record);
      snapshot.fields[parsed.record.field].pending.push(parsed.record);
      continue;
    }

    if (
      event.type !== 'working_context_proposal_accepted'
      && event.type !== 'working_context_proposal_rejected'
    ) continue;

    const parsed = decisionFromEvent(event);
    if (!parsed.ok || !parsed.decision) {
      warnings.push({
        type: parsed.reason === 'missing_task_id'
          ? 'missing_task_id'
          : parsed.reason === 'missing_actor'
            ? 'missing_actor'
            : parsed.reason === 'invalid_decision'
              ? 'invalid_decision'
              : 'invalid_event',
        message: parsed.reason,
        eventId: event.id,
      });
      continue;
    }
    const decision = parsed.decision;
    if (decision.decision === 'rejected' && !parsed.rejected) {
      warnings.push({
        type: 'invalid_decision',
        message: 'reject decision missing rejectionReason',
        eventId: event.id,
        proposalId: decision.proposalId,
        field: decision.field,
      });
      continue;
    }
    if (event.actor !== 'user' && event.actor !== 'system') {
      warnings.push({
        type: 'illegal_actor',
        message: `${event.actor} may not accept or reject Working Context proposals`,
        eventId: event.id,
        proposalId: decision.proposalId,
        field: decision.field,
      });
      continue;
    }
    const proposal = proposalsById.get(decision.proposalId);
    if (!proposal) {
      warnings.push({
        type: 'missing_proposal',
        message: `proposal ${decision.proposalId} was not found`,
        eventId: event.id,
        proposalId: decision.proposalId,
        field: decision.field,
      });
      continue;
    }
    if (proposal.field !== decision.field || proposal.version !== decision.version) {
      warnings.push({
        type: 'version_mismatch',
        message: `decision ${decision.proposalId} does not match proposal field/version`,
        eventId: event.id,
        proposalId: decision.proposalId,
        field: decision.field,
      });
      continue;
    }
    if (decision.decision === 'accepted') {
      if (acceptedIds.has(decision.proposalId)) {
        warnings.push({
          type: 'duplicate_accept',
          message: `proposal ${decision.proposalId} was already accepted`,
          eventId: event.id,
          proposalId: decision.proposalId,
          field: decision.field,
        });
        continue;
      }
      if (asOf && proposal.ttl.expiresAt <= asOf) {
        removePending(snapshot, proposal);
        snapshot.fields[proposal.field].expired.push(proposal);
        warnings.push({
          type: 'expired_accept',
          message: `proposal ${decision.proposalId} expired at ${proposal.ttl.expiresAt}`,
          eventId: event.id,
          proposalId: decision.proposalId,
          field: decision.field,
        });
        continue;
      }
      acceptedIds.add(decision.proposalId);
      removePending(snapshot, proposal);
      const accepted: TaskLedgerWorkingContextAcceptedRecord = {
        ...proposal,
        acceptedEventId: event.id,
        policyDigest: decision.policyDigest,
        acceptedAt: event.createdAt,
      };
      snapshot.fields[proposal.field].history.push(accepted);
      snapshot.fields[proposal.field].current = accepted;
      snapshot.promotionCandidates.push({
        schema: 'MemPromotionCandidate/v1',
        proposalId: proposal.proposalId,
        field: proposal.field,
        value: cloneValue(proposal.value),
        version: proposal.version,
        actor: proposal.actor,
        evidenceRefs: proposal.evidenceRefs.map((ref) => ({ ...ref })),
        sensitivity: proposal.sensitivity,
        trust: proposal.trust,
        acceptedAt: event.createdAt,
        policyDigest: decision.policyDigest,
      });
      continue;
    }

    removePending(snapshot, proposal);
    snapshot.fields[proposal.field].rejected.push(parsed.rejected as TaskLedgerWorkingContextRejectedRecord);
  }

  for (const field of TASK_LEDGER_WORKING_CONTEXT_FIELDS) {
    const projection = snapshot.fields[field];
    const pending = projection.pending;
    projection.pending = [];
    projection.conflicts = [];
    projection.expired = [...projection.expired];
    const active = new Map<string, TaskLedgerWorkingContextProposalRecord>();
    for (const proposal of pending) {
      if (asOf && proposal.ttl.expiresAt <= asOf) {
        projection.expired.push(proposal);
        continue;
      }
      active.set(proposal.actor, proposal);
    }
    if (active.size === 1) {
      projection.pending = [...active.values()];
    } else if (active.size > 1) {
      projection.conflicts = [...active.values()];
    }
  }

  snapshot.warnings = warnings;
  return snapshot;
}

export type TaskLedgerWorkingContextMergeOptions = {
  copyFields: TaskLedgerWorkingContextField[];
  relation: 'forked_from' | 'handoff_from';
};

export type TaskLedgerWorkingContextMergeConflict = {
  field: TaskLedgerWorkingContextField;
  parent?: TaskLedgerWorkingContextAcceptedRecord;
  child?: TaskLedgerWorkingContextAcceptedRecord;
};

export type TaskLedgerWorkingContextMergedField = {
  current?: TaskLedgerWorkingContextAcceptedRecord & { source: 'parent' | 'child' };
  conflicts: TaskLedgerWorkingContextMergeConflict[];
};

export type TaskLedgerWorkingContextMergeResult = {
  schemaVersion: 1;
  relation: 'forked_from' | 'handoff_from';
  copiedFields: TaskLedgerWorkingContextField[];
  fields: Partial<Record<TaskLedgerWorkingContextField, TaskLedgerWorkingContextMergedField>>;
};

function sameValue(
  left: TaskLedgerWorkingContextFieldValue | undefined,
  right: TaskLedgerWorkingContextFieldValue | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function mergeTaskLedgerWorkingContext(
  parent: TaskLedgerWorkingContextSnapshot,
  child: TaskLedgerWorkingContextSnapshot,
  options: TaskLedgerWorkingContextMergeOptions,
): TaskLedgerWorkingContextMergeResult {
  const fields: TaskLedgerWorkingContextMergeResult['fields'] = {};
  const copiedFields = [...new Set(options.copyFields)].sort();
  for (const field of copiedFields) {
    const parentCurrent = parent.fields[field]?.current;
    const childCurrent = child.fields[field]?.current;
    if (!parentCurrent && !childCurrent) continue;
    if (parentCurrent && childCurrent) {
      if (sameValue(parentCurrent.value, childCurrent.value)) {
        fields[field] = {
          current: { ...parentCurrent, source: 'parent' },
          conflicts: [],
        };
      } else {
        fields[field] = {
          conflicts: [{
            field,
            parent: parentCurrent,
            child: childCurrent,
          }],
        };
      }
      continue;
    }
    fields[field] = {
      current: parentCurrent
        ? { ...parentCurrent, source: 'parent' }
        : { ...(childCurrent as TaskLedgerWorkingContextAcceptedRecord), source: 'child' },
      conflicts: [],
    };
  }
  return {
    schemaVersion: 1,
    relation: options.relation,
    copiedFields,
    fields,
  };
}
