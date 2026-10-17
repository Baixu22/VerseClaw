/**
 * Agent audit trail (TF-0058).
 *
 * Field shape aligned with IETF draft-sharif-agent-audit-trail concepts:
 * actor · action · resource · decision · timestamp — plus outcome and reason.
 *
 * Secrets never enter `details`. HITL pause/resume/deny maps 1:1 into this
 * trail so compliance consumers read one schema.
 */
import { randomUUID } from 'node:crypto';
import type { HitlAuditEvent } from '../engine/hitl-checkpoint.ts';
import { REDACTED, isSensitiveNetworkName, redactSecretsInText } from './redact-secrets.ts';

export const AUDIT_TRAIL_SCHEMA_VERSION = 1 as const;

export type AuditActorType = 'agent' | 'human' | 'system';

export type AuditActor = {
  type: AuditActorType;
  id: string;
};

export type AuditResource = {
  type: string;
  id: string;
};

export type AuditDecision = 'allow' | 'deny' | 'pause' | 'resume' | 'info';

export type AuditEvent = {
  schemaVersion: typeof AUDIT_TRAIL_SCHEMA_VERSION;
  id: string;
  /** ISO-8601 timestamp (draft: event time). */
  at: string;
  actor: AuditActor;
  /** Verb phrase, e.g. `browser.navigate`, `hitl.pause`, `capability.deny`. */
  action: string;
  resource: AuditResource;
  decision: AuditDecision;
  outcome?: 'ok' | 'error';
  reason?: string;
  sessionId?: string;
  /** Flat, non-secret metadata only. */
  details?: Record<string, string | number | boolean | null>;
};

export type AuditRecordInput = {
  actor: AuditActor;
  action: string;
  resource: AuditResource;
  decision: AuditDecision;
  outcome?: 'ok' | 'error';
  reason?: string;
  sessionId?: string;
  details?: Record<string, string | number | boolean | null>;
  at?: string;
  id?: string;
};

// C96/TF-0123: the key check delegates to the repository's canonical name check plus the
// field-family extras (`otp`/`pin`) that `readFieldState` also treats as secret. Measured
// 2026-10-14: `private_key`, `session`, `sid`, `csrf`, `otp`, `pin` and `auth` all reached
// `details` verbatim while `password` / `api_key` / `token` were redacted.
/** Bare credential tokens the shared keyed-value redactor cannot see without a key context. */
const BARE_SECRET_VALUE = /sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]+/u;
function isSensitiveDetailKey(key: string): boolean {
  return isSensitiveNetworkName(key);
}

function scrubDetails(
  details: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!details) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (isSensitiveDetailKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    if (typeof value !== 'string') {
      out[key] = value;
      continue;
    }
    if (BARE_SECRET_VALUE.test(value)) {
      out[key] = REDACTED;
      continue;
    }
    // Reuse the shared free-text redactor for values that carry their own key context
    // (`Authorization: Bearer ...`, `token=...`, JWTs) under a benign detail key.
    out[key] = redactSecretsInText(value);
  }
  return out;
}

export function createAuditEvent(input: AuditRecordInput): AuditEvent {
  const event: AuditEvent = {
    schemaVersion: AUDIT_TRAIL_SCHEMA_VERSION,
    id: input.id ?? randomUUID(),
    at: input.at ?? new Date().toISOString(),
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    decision: input.decision,
  };
  if (input.outcome) event.outcome = input.outcome;
  if (input.reason) event.reason = input.reason;
  if (input.sessionId) event.sessionId = input.sessionId;
  const details = scrubDetails(input.details);
  if (details && Object.keys(details).length > 0) event.details = details;
  return event;
}

/** Map HITL store events into the shared audit schema. */
export function auditEventFromHitl(hitl: HitlAuditEvent): AuditEvent {
  const decision: AuditDecision =
    hitl.event === 'pause'
      ? 'pause'
      : hitl.event === 'resume'
        ? 'resume'
        : hitl.event === 'deny'
          ? 'deny'
          : 'info';
  return createAuditEvent({
    at: hitl.at,
    actor: { type: 'system', id: 'hitl-checkpoint' },
    action: `hitl.${hitl.event}`,
    resource: { type: 'session', id: hitl.sessionId },
    decision,
    sessionId: hitl.sessionId,
    ...(hitl.reason ? { reason: hitl.reason } : {}),
    ...(hitl.detail ? { details: { detail: hitl.detail } } : {}),
  });
}

export class AuditTrail {
  private readonly events: AuditEvent[] = [];
  private readonly limit: number;

  constructor(options: { limit?: number } = {}) {
    const limit = options.limit;
    this.limit = typeof limit === 'number' && limit > 0 ? limit : 1000;
  }

  record(input: AuditRecordInput): AuditEvent {
    const event = createAuditEvent(input);
    this.events.push(event);
    if (this.events.length > this.limit) {
      this.events.splice(0, this.events.length - this.limit);
    }
    return event;
  }

  recordHitl(hitl: HitlAuditEvent): AuditEvent {
    const event = auditEventFromHitl(hitl);
    this.events.push(event);
    if (this.events.length > this.limit) {
      this.events.splice(0, this.events.length - this.limit);
    }
    return event;
  }

  list(filter: { sessionId?: string; action?: string; decision?: AuditDecision } = {}): AuditEvent[] {
    return this.events.filter((e) => {
      if (filter.sessionId && e.sessionId !== filter.sessionId) return false;
      if (filter.action && e.action !== filter.action) return false;
      if (filter.decision && e.decision !== filter.decision) return false;
      return true;
    });
  }

  /** Newline-delimited JSON — append-only export shape. */
  toNdjson(): string {
    return this.events.map((e) => JSON.stringify(e)).join('\n');
  }

  get size(): number {
    return this.events.length;
  }
}

export const auditTrail = new AuditTrail();

/** Stable deny/action codes for hosts. */
export const AUDIT_ACTIONS = Object.freeze({
  hitlPause: 'hitl.pause',
  hitlResume: 'hitl.resume',
  hitlDeny: 'hitl.deny',
  capabilityDeny: 'capability.deny',
  agentConflict: 'agent.conflict',
  tabPin: 'agent.tab_pin',
  policyApply: 'policy.apply',
  evidenceIndex: 'evidence.index',
} as const);
