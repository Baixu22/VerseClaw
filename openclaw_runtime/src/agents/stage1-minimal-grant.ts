/**
 * Stage 1 temporary minimal CapabilityGrant derived from the existing durable
 * approval ledger. This is an in-memory execution credential, never a
 * permission database row. It intentionally implements only the Stage 1 slice:
 * actor, scope, approvalRef, TTL, effect idempotency, and status.
 *
 * Delegation, attenuation, cross-restart grant recovery, and full revocation
 * remain Stage 4 work.
 */
import { createHash, randomUUID } from "node:crypto";

import type { CapabilityGrant } from "../../../shared/types/context-control-plane/artifacts.js";
import {
  canonicalJsonValue,
  type ApprovalLedgerRow,
} from "./approval-ledger.js";

export const STAGE1_GRANT_RULE_ID = "grant-adapter/v1:derive-minimal-from-approved-ledger";
export const STAGE1_GRANT_RULE_VERSION = "1";
export const STAGE1_GRANT_TTL_MS = 60_000;
export const STAGE1_EFFECT_NAMESPACE = "coding-tool";
export const STAGE1_GRANT_ACTOR_KIND = "principal" as const;

export type Stage1GrantActor = {
  sessionKey: string;
  runId: string;
  attemptIndex: number;
  modelCallIndex: number;
  actorKind: "principal" | "delegate";
};

export type Stage1GrantScope = {
  taskBranchId: string;
  resource: string;
  action: string;
  purpose: string;
};

export type Stage1MinimalGrantInput = {
  approvalRow: Pick<
    ApprovalLedgerRow,
    "approval_id" | "decision" | "resolved_by" | "expires_at_ms" | "updated_at"
  >;
  actor: Stage1GrantActor;
  scope: Stage1GrantScope;
  policyDigest: string;
  toolCallId: string;
  /** Time captured after markExecutionStarted committed. */
  issuedAtMs?: number;
  nowMs?: number;
};

export type Stage1ToolGuardCall = {
  toolCallId: string;
  toolName: string;
  resource: string;
  action: string;
  purpose: string;
  actor: Stage1GrantActor;
  approvalId: string;
  policyDigest: string;
  resolvedBy: string;
  nowMs: number;
};

export type Stage1ToolGuardVerdict =
  | { allow: true; reason: null; grant: CapabilityGrant }
  | { allow: false; reason: Stage1ToolGuardDenyReason; grant: CapabilityGrant | null };

export type Stage1ToolGuardDenyReason =
  | "grant-missing"
  | "grant-not-active"
  | "actor-mismatch"
  | "scope-resource-mismatch"
  | "scope-action-mismatch"
  | "scope-purpose-mismatch"
  | "approval-mismatch"
  | "governance-mismatch"
  | "policy-digest-mismatch"
  | "ttl-expired"
  | "ttl-not-yet-valid"
  | "effect-idempotency-mismatch"
  | "wildcard-action";

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stage1Digest(value: unknown): string {
  return `sha256:${sha256Text(canonicalJsonValue(value))}`;
}

export function stage1GovernancePolicyDigest(policyRule: string, decision: "approved" | "denied"): string {
  return stage1Digest({ rule: policyRule, decision });
}

/**
 * Derive an active temporary minimal grant only after the approval ledger has
 * committed execution_started. The returned object is validated against the
 * Stage 0 CapabilityGrant/v1 contract by the Stage 1 contract tests.
 */
export function deriveStage1MinimalGrant(input: Stage1MinimalGrantInput): {
  ok: true;
  grant: CapabilityGrant;
} | {
  ok: false;
  reason:
    | "approval-not-approved"
    | "approval-expired"
    | "resolved-by-missing"
    | "invalid-ttl"
    | "invalid-identity"
    | "invalid-scope";
} {
  const now = input.nowMs ?? Date.now();
  const issuedAtMs = input.issuedAtMs ?? now;
  const approvalExpiresAtMs = input.approvalRow.expires_at_ms;
  if (input.approvalRow.decision !== "approved") {
    return { ok: false, reason: "approval-not-approved" };
  }
  const resolvedBy = input.approvalRow.resolved_by;
  if (!resolvedBy || resolvedBy.trim().length === 0) {
    return { ok: false, reason: "resolved-by-missing" };
  }
  if (approvalExpiresAtMs <= issuedAtMs) {
    return { ok: false, reason: "approval-expired" };
  }
  if (
    !input.actor.sessionKey ||
    !input.actor.runId ||
    !Number.isSafeInteger(input.actor.attemptIndex) ||
    input.actor.attemptIndex < 0 ||
    !Number.isSafeInteger(input.actor.modelCallIndex) ||
    input.actor.modelCallIndex < 0
  ) {
    return { ok: false, reason: "invalid-identity" };
  }
  if (
    !input.scope.taskBranchId ||
    !input.scope.resource ||
    !input.scope.action ||
    input.scope.action === "*" ||
    !input.scope.purpose
  ) {
    return { ok: false, reason: "invalid-scope" };
  }
  const expiresAtMs = Math.min(issuedAtMs + STAGE1_GRANT_TTL_MS, approvalExpiresAtMs);
  if (expiresAtMs <= issuedAtMs) {
    return { ok: false, reason: "invalid-ttl" };
  }
  const grantId = `grant_${randomUUID()}`;
  const effectIdempotencyKey = `${grantId}:${input.approvalRow.approval_id}:${input.toolCallId}`;
  const grant: CapabilityGrant = {
    schema: "CapabilityGrant/v1",
    grantId,
    derivation: {
      ruleId: STAGE1_GRANT_RULE_ID,
      ruleVersion: STAGE1_GRANT_RULE_VERSION,
      policyDigest: input.policyDigest,
      inputRefs: [
        `ref:approval:${input.approvalRow.approval_id}`,
        `ref:tool:${input.toolCallId}`,
      ],
    },
    actor: input.actor,
    scope: input.scope,
    approvalRef: {
      approvalId: input.approvalRow.approval_id,
      decision: "approved",
      resolvedBy,
      policyDigest: input.policyDigest,
    },
    ttl: {
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    },
    effectIdempotency: {
      key: effectIdempotencyKey,
      namespace: STAGE1_EFFECT_NAMESPACE,
    },
    status: "active",
  };
  return { ok: true, grant };
}

/** Validate the temporary minimal grant at the tool execution point. */
export function verifyStage1MinimalGrant(
  grant: CapabilityGrant | null | undefined,
  call: Stage1ToolGuardCall,
): Stage1ToolGuardVerdict {
  if (!grant) {
    return { allow: false, reason: "grant-missing", grant: null };
  }
  if (grant.status !== "active") {
    return { allow: false, reason: "grant-not-active", grant };
  }
  if (grant.scope.action === "*") {
    return { allow: false, reason: "wildcard-action", grant };
  }
  const now = call.nowMs;
  const issuedAt = Date.parse(grant.ttl.issuedAt);
  const expiresAt = Date.parse(grant.ttl.expiresAt);
  if (now < issuedAt) {
    return { allow: false, reason: "ttl-not-yet-valid", grant };
  }
  if (now >= expiresAt) {
    return { allow: false, reason: "ttl-expired", grant };
  }
  if (
    grant.actor.sessionKey !== call.actor.sessionKey ||
    grant.actor.runId !== call.actor.runId ||
    grant.actor.attemptIndex !== call.actor.attemptIndex ||
    grant.actor.modelCallIndex !== call.actor.modelCallIndex ||
    grant.actor.actorKind !== call.actor.actorKind
  ) {
    return { allow: false, reason: "actor-mismatch", grant };
  }
  if (grant.scope.resource !== call.resource) {
    return { allow: false, reason: "scope-resource-mismatch", grant };
  }
  if (grant.scope.action !== call.action) {
    return { allow: false, reason: "scope-action-mismatch", grant };
  }
  if (grant.scope.purpose !== call.purpose) {
    return { allow: false, reason: "scope-purpose-mismatch", grant };
  }
  if (grant.approvalRef.approvalId !== call.approvalId) {
    return { allow: false, reason: "approval-mismatch", grant };
  }
  if (grant.approvalRef.resolvedBy !== call.resolvedBy) {
    return { allow: false, reason: "governance-mismatch", grant };
  }
  if (grant.approvalRef.policyDigest !== call.policyDigest) {
    return { allow: false, reason: "policy-digest-mismatch", grant };
  }
  const expectedIdempotencyKey = `${grant.grantId}:${call.approvalId}:${call.toolCallId}`;
  if (grant.effectIdempotency.key !== expectedIdempotencyKey) {
    return { allow: false, reason: "effect-idempotency-mismatch", grant };
  }
  return { allow: true, reason: null, grant };
}
