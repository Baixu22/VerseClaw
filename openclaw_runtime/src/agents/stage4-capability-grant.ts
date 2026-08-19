/**
 * Stage 4 unified CapabilityGrant/v1 pure derived credential.
 *
 * The grant is an in-memory execution credential derived from the existing
 * durable ApprovalLedger, policy digest, and session identity. It is never a
 * permission database row. Delegation is attenuation-only: a child grant can
 * only be derived from an active parent, must use actorKind "delegate", and
 * must have resource, action, task branch, purpose, TTL, and delegation depth
 * bounded by the parent.
 *
 * Restart policy: active grants are process-local and are never revived after
 * restart. recoverStage4GrantAfterRestart always resolves to explicit
 * invalidation.
 */
import { createHash, randomUUID } from "node:crypto";

import type { CapabilityGrant } from "../../../shared/types/context-control-plane/artifacts.js";
import { canonicalJsonValue, type ApprovalLedgerRow } from "./approval-ledger.js";

export const STAGE4_GRANT_RULE_ID = "grant-adapter/v1:derive-unified-from-approved-ledger";
export const STAGE4_GRANT_RULE_VERSION = "2";
export const STAGE4_GRANT_TTL_MS = 60_000;
export const STAGE4_EFFECT_NAMESPACE = "coding-tool";
export const STAGE4_REVOCATION_EPOCH = "grant-revocation-epoch:v1";
export const STAGE4_RESTART_RECOVERY = "explicit-invalid" as const;

export type Stage4GrantActor = {
  sessionKey: string;
  runId: string;
  attemptIndex: number;
  modelCallIndex: number;
  actorKind: "principal" | "delegate";
};

export type Stage4GrantScope = {
  taskBranchId: string;
  resource: string;
  action: string;
  purpose: string;
};

export type Stage4GrantCall = {
  toolCallId: string;
  toolName: string;
  resource: string;
  action: string;
  purpose: string;
  actor: Stage4GrantActor;
  approvalId: string;
  policyDigest: string;
  resolvedBy: string;
};

export type Stage4GrantResolver = (
  grantId: string,
) => CapabilityGrant | null | undefined;

export type Stage4GrantDeriveInput = {
  approvalRow: Pick<
    ApprovalLedgerRow,
    "approval_id" | "state" | "decision" | "resolved_by" | "expires_at_ms" | "updated_at"
  >;
  actor: Stage4GrantActor;
  scope: Stage4GrantScope;
  policyDigest: string;
  toolCallId: string;
  issuedAtMs?: number;
  nowMs?: number;
  ttlMs?: number;
  parentGrant?: CapabilityGrant;
  delegation?: { parentGrantId: string; maxDepth: number };
  actorChain?: string[];
  /** Optional ancestor resolver used to fail closed on missing parent chains. */
  resolveParentGrant?: Stage4GrantResolver;
  revokedGrantIds?: ReadonlySet<string>;
};

export type Stage4GrantVerdict =
  | { allow: true; reason: null; grant: CapabilityGrant; actorChain: string[] }
  | { allow: false; reason: Stage4GrantDenyReason; grant: CapabilityGrant; actorChain: string[] };

export type Stage4GrantDenyReason =
  | "approval-not-approved"
  | "approval-not-execution-started"
  | "approval-expired"
  | "resolved-by-missing"
  | "invalid-identity"
  | "invalid-scope"
  | "invalid-ttl"
  | "invalid-policy-digest"
  | "invalid-tool-call-id"
  | "invalid-approval-ref"
  | "invalid-governance"
  | "invalid-delegation"
  | "wildcard-action"
  | "grant-missing"
  | "grant-not-active"
  | "grant-expired"
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
  | "revoked"
  | "parent-grant-missing"
  | "parent-grant-mismatch"
  | "parent-grant-not-active"
  | "parent-scope-escalation"
  | "parent-ttl-escalation"
  | "delegation-requires-delegate-actor"
  | "delegation-depth-exceeded"
  | "grant-not-recoverable-after-restart"
  | "already-revoked";

export function stage4ActorKey(actor: Stage4GrantActor): string {
  return [
    actor.sessionKey,
    actor.runId,
    actor.attemptIndex,
    actor.modelCallIndex,
    actor.actorKind,
  ].join("|");
}

export function stage4GovernancePolicyDigest(
  policyRule: string,
  decision: "approved" | "denied",
): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJsonValue({ rule: policyRule, decision }))
    .digest("hex")}`;
}

export function stage4EffectIdempotencyKey(
  grantId: string,
  approvalId: string,
  toolCallId: string,
): string {
  return `${grantId}:${approvalId}:${toolCallId}`;
}

const STAGE4_MAX_ID_LENGTH = 256;
const STAGE4_MAX_REFERENCE_LENGTH = 512;
const STAGE4_MAX_INDEX = 2_147_483_647;
const STAGE4_MAX_TIMESTAMP_MS = 8_640_000_000_000_000;
const STAGE4_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;
const STAGE4_ACTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9*._:@/-]*$/;
const STAGE4_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@%+_-]*$/;
const STAGE4_PURPOSE_PATTERN = /^[^\r\n]+$/;
const STAGE4_POLICY_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function isStage4Id(value: unknown, maxLength = STAGE4_MAX_ID_LENGTH): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    STAGE4_ID_PATTERN.test(value)
  );
}

function isStage4Reference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= STAGE4_MAX_REFERENCE_LENGTH &&
    STAGE4_REFERENCE_PATTERN.test(value)
  );
}

function isStage4Action(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= STAGE4_MAX_ID_LENGTH &&
    STAGE4_ACTION_PATTERN.test(value)
  );
}

function isStage4Purpose(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= STAGE4_MAX_ID_LENGTH &&
    STAGE4_PURPOSE_PATTERN.test(value)
  );
}

function isStage4PolicyDigest(value: unknown): value is string {
  return typeof value === "string" && STAGE4_POLICY_DIGEST_PATTERN.test(value);
}

function isStage4Index(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= STAGE4_MAX_INDEX;
}

function isStage4TimestampMs(value: number): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= STAGE4_MAX_TIMESTAMP_MS
  );
}

function parseTimestampMs(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isActiveGrantAt(grant: CapabilityGrant, atMs: number): boolean {
  if (grant.status !== "active" || grant.revocation) return false;
  const issuedAt = parseTimestampMs(grant.ttl.issuedAt);
  const expiresAt = parseTimestampMs(grant.ttl.expiresAt);
  if (issuedAt === undefined || expiresAt === undefined) return false;
  return atMs >= issuedAt && atMs < expiresAt;
}

function isResourceBoundedBy(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function isActionBoundedBy(child: string, parent: string): boolean {
  return child === parent;
}

function isTaskBranchBoundedBy(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function isPurposeBoundedBy(child: string, parent: string): boolean {
  return child === parent;
}

function isScopeBoundedBy(child: Stage4GrantScope, parent: Stage4GrantScope): boolean {
  return (
    isResourceBoundedBy(child.resource, parent.resource) &&
    isActionBoundedBy(child.action, parent.action) &&
    isTaskBranchBoundedBy(child.taskBranchId, parent.taskBranchId) &&
    isPurposeBoundedBy(child.purpose, parent.purpose)
  );
}

function isTtlBoundedBy(child: CapabilityGrant, parent: CapabilityGrant): boolean {
  const childIssuedAt = parseTimestampMs(child.ttl.issuedAt);
  const childExpiresAt = parseTimestampMs(child.ttl.expiresAt);
  const parentIssuedAt = parseTimestampMs(parent.ttl.issuedAt);
  const parentExpiresAt = parseTimestampMs(parent.ttl.expiresAt);
  if (
    childIssuedAt === undefined ||
    childExpiresAt === undefined ||
    parentIssuedAt === undefined ||
    parentExpiresAt === undefined
  ) {
    return false;
  }
  return childIssuedAt >= parentIssuedAt && childExpiresAt <= parentExpiresAt;
}

/**
 * Validate every link in a delegation chain. Each child must be bounded by its
 * direct parent; the walk continues through each parent delegation link so a
 * revoked, expired, missing, or escalated ancestor fails the whole chain.
 */
function checkStage4ParentChain(
  grant: CapabilityGrant,
  nowMs: number,
  revokedGrantIds: ReadonlySet<string>,
  resolveParentGrant: Stage4GrantResolver,
): Stage4GrantDenyReason | null {
  const visited = new Set<string>([grant.grantId]);
  let current = grant;
  while (current.delegation) {
    const parentId = current.delegation.parentGrantId;
    if (visited.has(parentId)) return "parent-grant-not-active";
    const parent = resolveParentGrant(parentId);
    if (!parent) return "parent-grant-missing";
    if (parent.grantId !== parentId) return "parent-grant-mismatch";
    if (
      revokedGrantIds.has(parentId) ||
      parent.status === "revoked" ||
      parent.revocation ||
      !isActiveGrantAt(parent, nowMs)
    ) {
      return "parent-grant-not-active";
    }
    if (current.actor.actorKind !== "delegate") {
      return "delegation-requires-delegate-actor";
    }
    if (!isScopeBoundedBy(current.scope, parent.scope)) {
      return "parent-scope-escalation";
    }
    if (!isTtlBoundedBy(current, parent)) {
      return "parent-ttl-escalation";
    }
    if (
      parent.delegation &&
      current.delegation.maxDepth >= parent.delegation.maxDepth
    ) {
      return "delegation-depth-exceeded";
    }
    visited.add(parentId);
    current = parent;
  }
  return null;
}

/** Build a root-first actor chain from the grant back through resolvable parents. */
function buildStage4ActorChain(
  grant: CapabilityGrant,
  resolveParentGrant: Stage4GrantResolver,
): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: CapabilityGrant | undefined = grant;
  while (current && !visited.has(current.grantId)) {
    chain.push(stage4ActorKey(current.actor));
    visited.add(current.grantId);
    current = current.delegation
      ? resolveParentGrant(current.delegation.parentGrantId) ?? undefined
      : undefined;
  }
  return chain.reverse();
}

function validateActor(actor: Stage4GrantActor): boolean {
  return (
    isStage4Id(actor.sessionKey) &&
    isStage4Id(actor.runId) &&
    isStage4Index(actor.attemptIndex) &&
    isStage4Index(actor.modelCallIndex) &&
    (actor.actorKind === "principal" || actor.actorKind === "delegate")
  );
}

function validateScope(scope: Stage4GrantScope): boolean {
  return (
    isStage4Id(scope.taskBranchId) &&
    isStage4Reference(scope.resource) &&
    isStage4Action(scope.action) &&
    isStage4Purpose(scope.purpose)
  );
}

function validateDelegation(delegation: { parentGrantId: string; maxDepth: number }): boolean {
  return isStage4Id(delegation.parentGrantId) && isStage4Index(delegation.maxDepth);
}

function grantInputRefs(
  approvalId: string,
  toolCallId: string,
  parentGrant?: CapabilityGrant,
): string[] {
  const refs = [`ref:approval:${approvalId}`, `ref:tool:${toolCallId}`];
  if (parentGrant) refs.push(`ref:grant:${parentGrant.grantId}`);
  return refs;
}

/**
 * Derive an active unified CapabilityGrant/v1 only after the approval ledger
 * has committed execution_started. The returned object is pure and does not
 * write to any store. Every field is validated against the Stage 0
 * CapabilityGrant/v1 schema constraints before an active grant is returned.
 */
export function deriveStage4CapabilityGrant(
  input: Stage4GrantDeriveInput,
): { ok: true; grant: CapabilityGrant; actorChain: string[] } | { ok: false; reason: Stage4GrantDenyReason } {
  const now = input.nowMs ?? Date.now();
  const issuedAtMs = input.issuedAtMs ?? now;
  if (!isStage4TimestampMs(issuedAtMs)) {
    return { ok: false, reason: "invalid-ttl" };
  }

  if (input.approvalRow.decision !== "approved") {
    return { ok: false, reason: "approval-not-approved" };
  }
  if (input.approvalRow.state !== "execution_started") {
    return { ok: false, reason: "approval-not-execution-started" };
  }
  const resolvedBy = input.approvalRow.resolved_by;
  if (!resolvedBy || resolvedBy.trim().length === 0) {
    return { ok: false, reason: "resolved-by-missing" };
  }
  if (!isStage4Id(resolvedBy)) {
    return { ok: false, reason: "invalid-governance" };
  }
  if (!isStage4Id(input.approvalRow.approval_id)) {
    return { ok: false, reason: "invalid-approval-ref" };
  }
  if (!isStage4PolicyDigest(input.policyDigest)) {
    return { ok: false, reason: "invalid-policy-digest" };
  }
  const approvalExpiresAtMs = input.approvalRow.expires_at_ms;
  if (!isStage4TimestampMs(approvalExpiresAtMs)) {
    return { ok: false, reason: "invalid-ttl" };
  }
  if (approvalExpiresAtMs <= issuedAtMs) {
    return { ok: false, reason: "approval-expired" };
  }
  if (!validateActor(input.actor)) {
    return { ok: false, reason: "invalid-identity" };
  }
  if (!validateScope(input.scope)) {
    return { ok: false, reason: "invalid-scope" };
  }
  if (!isStage4Id(input.toolCallId)) {
    return { ok: false, reason: "invalid-tool-call-id" };
  }
  if (input.scope.action === "*") {
    return { ok: false, reason: "wildcard-action" };
  }
  if (input.delegation && !validateDelegation(input.delegation)) {
    return { ok: false, reason: "invalid-delegation" };
  }

  let actorChain = input.actorChain ?? [stage4ActorKey(input.actor)];
  const delegation = input.delegation;
  const resolveParentGrant: Stage4GrantResolver =
    input.resolveParentGrant ??
    ((grantId) => (grantId === input.parentGrant?.grantId ? input.parentGrant : undefined));
  if (input.parentGrant) {
    const parent = input.parentGrant;
    if (!delegation) {
      return { ok: false, reason: "parent-grant-mismatch" };
    }
    if (delegation.parentGrantId !== parent.grantId) {
      return { ok: false, reason: "parent-grant-mismatch" };
    }
    if (
      input.revokedGrantIds?.has(parent.grantId) ||
      !isActiveGrantAt(parent, issuedAtMs)
    ) {
      return { ok: false, reason: "parent-grant-not-active" };
    }
    if (input.actor.actorKind !== "delegate") {
      return { ok: false, reason: "delegation-requires-delegate-actor" };
    }
    if (!isScopeBoundedBy(input.scope, parent.scope)) {
      return { ok: false, reason: "parent-scope-escalation" };
    }
    if (parent.delegation && delegation.maxDepth >= parent.delegation.maxDepth) {
      return { ok: false, reason: "delegation-depth-exceeded" };
    }
    if (parent.delegation) {
      const parentChainReason = checkStage4ParentChain(
        parent,
        issuedAtMs,
        input.revokedGrantIds ?? new Set<string>(),
        resolveParentGrant,
      );
      if (parentChainReason) {
        return { ok: false, reason: parentChainReason };
      }
    }
    if (input.actorChain && input.actorChain.length > 0) {
      actorChain = [...input.actorChain, stage4ActorKey(input.actor)];
    } else {
      // Build the root-first ancestor chain through the resolver so that issue
      // and revoke audit records carry the full delegation chain, matching the
      // verify/deny path. `parent` is the direct parent; `buildStage4ActorChain`
      // walks its own delegation links back to the root.
      actorChain = [
        ...buildStage4ActorChain(parent, resolveParentGrant),
        stage4ActorKey(input.actor),
      ];
    }
  } else if (delegation) {
    return { ok: false, reason: "parent-grant-missing" };
  }

  const ttlMs = input.ttlMs ?? STAGE4_GRANT_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return { ok: false, reason: "invalid-ttl" };
  }
  const expiresAtMs = Math.min(issuedAtMs + ttlMs, approvalExpiresAtMs);
  if (!isStage4TimestampMs(expiresAtMs) || expiresAtMs <= issuedAtMs) {
    return { ok: false, reason: "invalid-ttl" };
  }
  if (input.parentGrant) {
    const parentIssuedAt = parseTimestampMs(input.parentGrant.ttl.issuedAt);
    const parentExpiresAt = parseTimestampMs(input.parentGrant.ttl.expiresAt);
    if (
      parentIssuedAt === undefined ||
      parentExpiresAt === undefined ||
      issuedAtMs < parentIssuedAt ||
      expiresAtMs > parentExpiresAt
    ) {
      return { ok: false, reason: "parent-ttl-escalation" };
    }
  }

  const grantId = `grant_${randomUUID()}`;
  const effectIdempotencyKey = stage4EffectIdempotencyKey(
    grantId,
    input.approvalRow.approval_id,
    input.toolCallId,
  );
  if (!isStage4Id(effectIdempotencyKey)) {
    return { ok: false, reason: "invalid-tool-call-id" };
  }
  const grant: CapabilityGrant = {
    schema: "CapabilityGrant/v1",
    grantId,
    derivation: {
      ruleId: STAGE4_GRANT_RULE_ID,
      ruleVersion: STAGE4_GRANT_RULE_VERSION,
      policyDigest: input.policyDigest,
      inputRefs: grantInputRefs(input.approvalRow.approval_id, input.toolCallId, input.parentGrant),
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
      namespace: STAGE4_EFFECT_NAMESPACE,
    },
    ...(delegation ? { delegation } : {}),
    status: "active",
  };
  return { ok: true, grant, actorChain };
}

/**
 * Verify a unified CapabilityGrant at the tool execution point. Pure function:
 * it never mutates a grant and never calls an executor. When a delegation
 * field exists the complete parent chain is resolved and every ancestor must
 * be active and bounded; a missing ancestor fails closed.
 */
export function verifyStage4CapabilityGrant(input: {
  grant: CapabilityGrant;
  call: Stage4GrantCall;
  nowMs: number;
  parentGrant?: CapabilityGrant | null;
  resolveParentGrant?: Stage4GrantResolver;
  revokedGrantIds?: ReadonlySet<string>;
}): Stage4GrantVerdict {
  const { grant, call } = input;
  const now = input.nowMs;
  const revokedGrantIds = input.revokedGrantIds ?? new Set<string>();
  const directParentId = grant.delegation?.parentGrantId;
  const resolveParentGrant: Stage4GrantResolver =
    input.resolveParentGrant ??
    ((grantId) => {
      if (grantId === directParentId) return input.parentGrant ?? undefined;
      return input.parentGrant?.grantId === grantId ? input.parentGrant : undefined;
    });
  const chainFromGrant = buildStage4ActorChain(grant, resolveParentGrant);

  if (revokedGrantIds.has(grant.grantId)) {
    return { allow: false, reason: "revoked", grant, actorChain: chainFromGrant };
  }
  if (grant.status === "revoked" || grant.revocation) {
    return { allow: false, reason: "revoked", grant, actorChain: chainFromGrant };
  }
  if (grant.status === "expired") {
    return { allow: false, reason: "grant-expired", grant, actorChain: chainFromGrant };
  }
  if (grant.status !== "active") {
    return { allow: false, reason: "grant-not-active", grant, actorChain: chainFromGrant };
  }
  if (grant.scope.action === "*") {
    return { allow: false, reason: "wildcard-action", grant, actorChain: chainFromGrant };
  }

  const issuedAt = parseTimestampMs(grant.ttl.issuedAt);
  const expiresAt = parseTimestampMs(grant.ttl.expiresAt);
  if (issuedAt === undefined || expiresAt === undefined || expiresAt <= issuedAt) {
    return { allow: false, reason: "invalid-ttl", grant, actorChain: chainFromGrant };
  }
  if (now < issuedAt) {
    return { allow: false, reason: "ttl-not-yet-valid", grant, actorChain: chainFromGrant };
  }
  if (now >= expiresAt) {
    return { allow: false, reason: "ttl-expired", grant, actorChain: chainFromGrant };
  }

  if (
    grant.actor.sessionKey !== call.actor.sessionKey ||
    grant.actor.runId !== call.actor.runId ||
    grant.actor.attemptIndex !== call.actor.attemptIndex ||
    grant.actor.modelCallIndex !== call.actor.modelCallIndex ||
    grant.actor.actorKind !== call.actor.actorKind
  ) {
    return { allow: false, reason: "actor-mismatch", grant, actorChain: chainFromGrant };
  }
  if (grant.scope.resource !== call.resource) {
    return { allow: false, reason: "scope-resource-mismatch", grant, actorChain: chainFromGrant };
  }
  if (grant.scope.action !== call.action) {
    return { allow: false, reason: "scope-action-mismatch", grant, actorChain: chainFromGrant };
  }
  if (grant.scope.purpose !== call.purpose) {
    return { allow: false, reason: "scope-purpose-mismatch", grant, actorChain: chainFromGrant };
  }
  if (grant.approvalRef.approvalId !== call.approvalId) {
    return { allow: false, reason: "approval-mismatch", grant, actorChain: chainFromGrant };
  }
  if (grant.approvalRef.resolvedBy !== call.resolvedBy) {
    return { allow: false, reason: "governance-mismatch", grant, actorChain: chainFromGrant };
  }
  if (grant.approvalRef.policyDigest !== call.policyDigest) {
    return { allow: false, reason: "policy-digest-mismatch", grant, actorChain: chainFromGrant };
  }
  const expectedIdempotencyKey = stage4EffectIdempotencyKey(
    grant.grantId,
    call.approvalId,
    call.toolCallId,
  );
  if (grant.effectIdempotency.key !== expectedIdempotencyKey) {
    return { allow: false, reason: "effect-idempotency-mismatch", grant, actorChain: chainFromGrant };
  }

  if (grant.delegation) {
    const parentChainReason = checkStage4ParentChain(
      grant,
      now,
      revokedGrantIds,
      resolveParentGrant,
    );
    if (parentChainReason) {
      return { allow: false, reason: parentChainReason, grant, actorChain: chainFromGrant };
    }
  }

  return { allow: true, reason: null, grant, actorChain: chainFromGrant };
}

/**
 * Return a new revoked grant object. Idempotent: re-applying revocation to an
 * already-revoked grant returns the same logical revocation.
 */
export function revokeStage4CapabilityGrant(
  grant: CapabilityGrant,
  input: { revokedAtMs?: number; reason: string; revocationEpoch?: string },
): { ok: true; grant: CapabilityGrant; revocationEpoch: string } | { ok: false; reason: "already-revoked" | "invalid-identity" } {
  if (grant.status === "revoked" || grant.revocation) {
    return {
      ok: true,
      grant,
      revocationEpoch: grant.revocation?.revocationEpoch ?? input.revocationEpoch ?? STAGE4_REVOCATION_EPOCH,
    };
  }
  if (!grant.grantId) {
    return { ok: false, reason: "invalid-identity" };
  }
  const revokedAtMs = input.revokedAtMs ?? Date.now();
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, reason: "invalid-identity" };
  }
  const revocationEpoch = input.revocationEpoch ?? STAGE4_REVOCATION_EPOCH;
  const revoked: CapabilityGrant = {
    ...grant,
    status: "revoked",
    revocation: {
      revokedAt: new Date(revokedAtMs).toISOString(),
      reason,
      revocationEpoch,
    },
  };
  return { ok: true, grant: revoked, revocationEpoch };
}

/** Return an expired grant object when the current time is past the TTL. */
export function markStage4GrantExpired(
  grant: CapabilityGrant,
  nowMs: number,
): CapabilityGrant {
  if (grant.status !== "active" || grant.revocation) return grant;
  const expiresAt = parseTimestampMs(grant.ttl.expiresAt);
  if (expiresAt !== undefined && nowMs >= expiresAt) {
    return { ...grant, status: "expired" };
  }
  return grant;
}

/** Stage 4 restart recovery: active grants are process-local and never revived. */
export function recoverStage4GrantAfterRestart(grantId: string): {
  ok: false;
  reason: "grant-not-recoverable-after-restart";
  grantId: string;
} {
  return { ok: false, reason: "grant-not-recoverable-after-restart", grantId };
}

export type Stage4GrantAuditEvent = "grant-issued" | "grant-denied" | "grant-revoked";

export type Stage4GrantAuditRecord = {
  recordId: string;
  event: Stage4GrantAuditEvent;
  grantId: string | null;
  policyDigest: string;
  actorChain: string[];
  reason: string | null;
  atMs: number;
};

export class Stage4GrantAuditTrail {
  #records: Stage4GrantAuditRecord[] = [];

  append(input: {
    event: Stage4GrantAuditEvent;
    grantId: string | null;
    policyDigest: string;
    actorChain: string[];
    reason?: string | null;
    atMs: number;
  }): Stage4GrantAuditRecord {
    const record: Stage4GrantAuditRecord = {
      recordId: `ga_${randomUUID()}`,
      event: input.event,
      grantId: input.grantId,
      policyDigest: input.policyDigest,
      actorChain: [...input.actorChain],
      reason: input.reason ?? null,
      atMs: input.atMs,
    };
    this.#records.push(record);
    return record;
  }

  list(): readonly Stage4GrantAuditRecord[] {
    return this.#records;
  }

  listByGrant(grantId: string): Stage4GrantAuditRecord[] {
    return this.#records.filter((record) => record.grantId === grantId);
  }

  listDenials(): Stage4GrantAuditRecord[] {
    return this.#records.filter((record) => record.event === "grant-denied");
  }

  listRevocations(): Stage4GrantAuditRecord[] {
    return this.#records.filter((record) => record.event === "grant-revoked");
  }

  clearForTest(): void {
    this.#records.length = 0;
  }
}

type Stage4ActiveGrantRecord = { grant: CapabilityGrant; actorChain: string[] };

export class Stage4GrantAuthority {
  #active = new Map<string, Stage4ActiveGrantRecord>();
  #revoked = new Map<string, Stage4ActiveGrantRecord>();
  #expired = new Map<string, Stage4ActiveGrantRecord>();
  #audit = new Stage4GrantAuditTrail();
  #nowMs: () => number;
  #revocationEpoch: string;

  constructor(options?: { nowMs?: () => number; revocationEpoch?: string }) {
    this.#nowMs = options?.nowMs ?? (() => Date.now());
    this.#revocationEpoch = options?.revocationEpoch ?? STAGE4_REVOCATION_EPOCH;
  }

  get audit(): Stage4GrantAuditTrail {
    return this.#audit;
  }

  issue(input: Stage4GrantDeriveInput):
    | { ok: true; grant: CapabilityGrant; actorChain: string[] }
    | { ok: false; reason: Stage4GrantDenyReason } {
    const derived = deriveStage4CapabilityGrant({
      ...input,
      resolveParentGrant: (grantId) => this.getGrant(grantId),
      revokedGrantIds: new Set(this.#revoked.keys()),
    });
    const now = input.nowMs ?? this.#nowMs();
    if (!derived.ok) {
      this.#audit.append({
        event: "grant-denied",
        grantId: null,
        policyDigest: input.policyDigest,
        actorChain: input.actorChain ?? [stage4ActorKey(input.actor)],
        reason: derived.reason,
        atMs: now,
      });
      return derived;
    }
    this.#active.set(derived.grant.grantId, {
      grant: derived.grant,
      actorChain: derived.actorChain,
    });
    this.#audit.append({
      event: "grant-issued",
      grantId: derived.grant.grantId,
      policyDigest: derived.grant.derivation.policyDigest,
      actorChain: derived.actorChain,
      reason: null,
      atMs: now,
    });
    return derived;
  }

  deny(input: {
    grantId: string | null;
    policyDigest: string;
    actorChain: string[];
    reason: string;
    atMs: number;
  }): Stage4GrantAuditRecord {
    return this.#audit.append({
      event: "grant-denied",
      grantId: input.grantId,
      policyDigest: input.policyDigest,
      actorChain: input.actorChain,
      reason: input.reason,
      atMs: input.atMs,
    });
  }

  verify(grant: CapabilityGrant, call: Stage4GrantCall, nowMs?: number): Stage4GrantVerdict {
    const now = nowMs ?? this.#nowMs();
    const verdict = verifyStage4CapabilityGrant({
      grant,
      call,
      nowMs: now,
      resolveParentGrant: (grantId) => this.getGrant(grantId),
      revokedGrantIds: new Set(this.#revoked.keys()),
    });
    if (!verdict.allow) {
      this.#audit.append({
        event: "grant-denied",
        grantId: grant.grantId,
        policyDigest: grant.derivation.policyDigest,
        actorChain: verdict.actorChain,
        reason: verdict.reason,
        atMs: now,
      });
    }
    return verdict;
  }

  revoke(grantId: string, reason: string, revokedAtMs?: number):
    | { ok: true; grant: CapabilityGrant; revocationEpoch: string }
    | { ok: false; reason: "grant-missing" | "already-revoked" | "invalid-identity" } {
    const record = this.getRecord(grantId);
    if (!record) return { ok: false, reason: "grant-missing" };
    const revoked = revokeStage4CapabilityGrant(record.grant, {
      revokedAtMs,
      reason,
      revocationEpoch: this.#revocationEpoch,
    });
    if (!revoked.ok) return revoked;
    this.#active.delete(grantId);
    this.#expired.delete(grantId);
    this.#revoked.set(grantId, { grant: revoked.grant, actorChain: record.actorChain });
    this.#audit.append({
      event: "grant-revoked",
      grantId,
      policyDigest: record.grant.derivation.policyDigest,
      actorChain: record.actorChain,
      reason,
      atMs: revokedAtMs ?? this.#nowMs(),
    });
    return { ok: true, grant: revoked.grant, revocationEpoch: revoked.revocationEpoch };
  }

  markExpired(grantId: string, nowMs?: number): CapabilityGrant | undefined {
    const now = nowMs ?? this.#nowMs();
    const record = this.getRecord(grantId);
    if (!record) return undefined;
    const expired = markStage4GrantExpired(record.grant, now);
    if (expired.status === "expired") {
      this.#active.delete(grantId);
      this.#revoked.delete(grantId);
      this.#expired.set(grantId, { grant: expired, actorChain: record.actorChain });
    }
    return expired;
  }

  getGrant(grantId: string): CapabilityGrant | undefined {
    return this.getRecord(grantId)?.grant;
  }

  listActive(): CapabilityGrant[] {
    return [...this.#active.values()].map((record) => record.grant);
  }

  listDenials(): Stage4GrantAuditRecord[] {
    return this.#audit.listDenials();
  }

  listRevocations(): Stage4GrantAuditRecord[] {
    return this.#audit.listRevocations();
  }

  recoverAfterRestart(grantId: string): ReturnType<typeof recoverStage4GrantAfterRestart> {
    return recoverStage4GrantAfterRestart(grantId);
  }

  clearForTest(): void {
    this.#active.clear();
    this.#revoked.clear();
    this.#expired.clear();
    this.#audit.clearForTest();
  }

  #getRecord(grantId: string): Stage4ActiveGrantRecord | undefined {
    return (
      this.#active.get(grantId) ??
      this.#revoked.get(grantId) ??
      this.#expired.get(grantId)
    );
  }

  private getRecord(grantId: string): Stage4ActiveGrantRecord | undefined {
    return this.#getRecord(grantId);
  }
}
