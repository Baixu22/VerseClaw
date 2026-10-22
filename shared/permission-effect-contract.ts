import type { CapabilityGrant } from './types/context-control-plane/artifacts.js';
import { normalizeCapabilityGrant } from './types/context-control-plane/artifacts.js';

/**
 * Unified final authorization contract for side-effect components.
 *
 * This module is deliberately pure. It does not store grants, approvals or
 * effects. Existing owners produce the decision snapshot; this checkpoint only
 * verifies that the snapshot, grant and actual request still agree immediately
 * before execution.
 */
export const PERMISSION_EFFECT_CONTRACT_VERSION = 'PermissionEffectContract/v1' as const;

export const PERMISSION_EFFECT_COMPONENTS = [
  'browser',
  'exec',
  'knowledge-apply',
  'fact-tools',
  'memory-write',
  'coding-control',
] as const;

export type PermissionEffectComponentId = (typeof PERMISSION_EFFECT_COMPONENTS)[number];
export type PermissionEffectClass =
  | 'browser-effect'
  | 'process-exec'
  | 'knowledge-write'
  | 'fact-write'
  | 'memory-write'
  | 'coding-tool';
export type PermissionEffectScopeKind = 'workspace' | 'session' | 'task' | 'run' | 'turn' | 'action';

export type PermissionEffectBinding = {
  componentId: PermissionEffectComponentId;
  label: string;
  effect: PermissionEffectClass;
  finalAuthorityOwner: string;
  scopeKinds: readonly PermissionEffectScopeKind[];
};

export const PERMISSION_EFFECT_BINDINGS: readonly PermissionEffectBinding[] = Object.freeze([
  {
    componentId: 'browser',
    label: 'Browser effect',
    effect: 'browser-effect',
    finalAuthorityOwner: 'electron.services.agent-browser-api',
    scopeKinds: ['workspace', 'session', 'task', 'action'],
  },
  {
    componentId: 'exec',
    label: 'Process exec',
    effect: 'process-exec',
    finalAuthorityOwner: 'openclaw_runtime.agents.exec-policy',
    scopeKinds: ['workspace', 'session', 'task', 'run', 'action'],
  },
  {
    componentId: 'knowledge-apply',
    label: 'Knowledge apply',
    effect: 'knowledge-write',
    finalAuthorityOwner: 'electron.services.knowledge-api',
    scopeKinds: ['workspace', 'session', 'task', 'action'],
  },
  {
    componentId: 'fact-tools',
    label: 'Fact tools',
    effect: 'fact-write',
    finalAuthorityOwner: 'openclaw_runtime.agents.dcs-fact-tools',
    scopeKinds: ['workspace', 'session', 'task', 'turn', 'action'],
  },
  {
    componentId: 'memory-write',
    label: 'Memory write',
    effect: 'memory-write',
    finalAuthorityOwner: 'openclaw_runtime.memory.memory-dual-gate',
    scopeKinds: ['workspace', 'session', 'task', 'action'],
  },
  {
    componentId: 'coding-control',
    label: 'Coding control',
    effect: 'coding-tool',
    finalAuthorityOwner: 'openclaw_runtime.agents.stage4-capability-grant',
    scopeKinds: ['workspace', 'session', 'task', 'run', 'action'],
  },
] satisfies PermissionEffectBinding[]);

export function validatePermissionEffectBindings(
  bindings: readonly PermissionEffectBinding[],
): string[] {
  const issues: string[] = [];
  const components = new Set<string>();
  const effects = new Set<string>();
  for (const binding of bindings) {
    if (!PERMISSION_EFFECT_COMPONENTS.includes(binding.componentId)) {
      issues.push(`unknown-component:${String(binding.componentId)}`);
    }
    if (components.has(binding.componentId)) issues.push(`duplicate-component:${binding.componentId}`);
    components.add(binding.componentId);
    if (effects.has(binding.effect)) issues.push(`duplicate-effect:${binding.effect}`);
    effects.add(binding.effect);
    if (!binding.finalAuthorityOwner.trim()) issues.push(`owner-missing:${binding.componentId}`);
    if (binding.finalAuthorityOwner === binding.componentId || binding.finalAuthorityOwner.startsWith('component.')) {
      issues.push(`self-authority:${binding.componentId}`);
    }
    if (!binding.scopeKinds.includes('action')) issues.push(`action-scope-missing:${binding.componentId}`);
    if (new Set(binding.scopeKinds).size !== binding.scopeKinds.length) {
      issues.push(`duplicate-scope:${binding.componentId}`);
    }
  }
  return issues;
}

const DECLARED_BINDING_ISSUES = validatePermissionEffectBindings(PERMISSION_EFFECT_BINDINGS);
if (DECLARED_BINDING_ISSUES.length > 0) {
  throw new Error(`Invalid PermissionEffectContract bindings: ${DECLARED_BINDING_ISSUES.join(',')}`);
}

const BINDING_BY_COMPONENT = new Map(
  PERMISSION_EFFECT_BINDINGS.map((binding) => [binding.componentId, binding]),
);

export type PermissionEffectSubject = {
  sessionKey: string;
  runId: string;
  attemptIndex: number;
  modelCallIndex: number;
  actorKind: 'principal' | 'delegate';
  workspaceId: string;
  taskBranchId: string;
};

export type PermissionEffectRequest = {
  requestId: string;
  componentId: PermissionEffectComponentId;
  action: string;
  resource: string;
  purpose: string;
  idempotencyKey?: string;
};

export type PermissionEffectSnapshot = {
  grant: CapabilityGrant | null;
  authorityOwner: string;
  ownerDecision: 'allowed' | 'denied';
  ownerPolicyDigest: string;
  workspaceId: string;
  revocationEpoch: string;
  revokedGrantIds: readonly string[];
  policyEpoch: string;
  catalogEpoch: string;
  capturedAtMs: number;
};

export type PermissionEffectCurrentState = {
  nowMs: number;
  revocationEpoch: string;
  revokedGrantIds: readonly string[];
  policyEpoch: string;
  catalogEpoch: string;
};

export type PermissionEffectFinalCheckInput = {
  subject: PermissionEffectSubject;
  request: PermissionEffectRequest;
  snapshot: PermissionEffectSnapshot;
  current: PermissionEffectCurrentState;
};

/**
 * Evidence supplied only after an existing owner has allowed the action.
 *
 * `decisionRef` must identify the owner's actual approval/policy decision and
 * `idempotencyKey` must identify this effect. The helper derives a temporary,
 * non-persisted CapabilityGrant for the final check; it is not an approval
 * store and must never be called by a capability declaration itself.
 */
export type PermissionEffectOwnerCheckpointInput = {
  componentId: PermissionEffectComponentId;
  subject: PermissionEffectSubject;
  request: Omit<PermissionEffectRequest, 'componentId' | 'idempotencyKey'> & {
    idempotencyKey: string;
  };
  authorityOwner: string;
  decisionRef: string;
  policyDigest: string;
  issuedAtMs: number;
  expiresAtMs: number;
  nowMs: number;
  revocationEpoch: string;
  revokedGrantIds?: readonly string[];
  policyEpoch: string;
  catalogEpoch: string;
};

export function buildPermissionEffectOwnerCheckpoint(
  input: PermissionEffectOwnerCheckpointInput,
): PermissionEffectFinalCheckInput {
  const binding = permissionEffectBindingFor(input.componentId);
  if (!binding) throw new PermissionEffectDeniedError('component-not-registered');
  const request: PermissionEffectRequest = {
    ...input.request,
    componentId: input.componentId,
  };
  const grant: CapabilityGrant = {
    schema: 'CapabilityGrant/v1',
    grantId: input.decisionRef,
    derivation: {
      ruleId: 'permission-effect-owner-checkpoint/v1',
      ruleVersion: '1',
      policyDigest: input.policyDigest,
      inputRefs: [input.decisionRef, input.request.requestId],
    },
    actor: {
      sessionKey: input.subject.sessionKey,
      runId: input.subject.runId,
      attemptIndex: input.subject.attemptIndex,
      modelCallIndex: input.subject.modelCallIndex,
      actorKind: input.subject.actorKind,
    },
    scope: {
      taskBranchId: input.subject.taskBranchId,
      resource: input.request.resource,
      action: input.request.action,
      purpose: input.request.purpose,
    },
    approvalRef: {
      approvalId: input.decisionRef,
      decision: 'approved',
      resolvedBy: input.authorityOwner,
      policyDigest: input.policyDigest,
    },
    ttl: {
      issuedAt: new Date(input.issuedAtMs).toISOString(),
      expiresAt: new Date(input.expiresAtMs).toISOString(),
    },
    effectIdempotency: {
      key: input.request.idempotencyKey,
      namespace: binding.effect,
    },
    status: 'active',
  };
  return {
    subject: input.subject,
    request,
    snapshot: {
      grant: normalizeCapabilityGrant(grant),
      authorityOwner: input.authorityOwner,
      ownerDecision: 'allowed',
      ownerPolicyDigest: input.policyDigest,
      workspaceId: input.subject.workspaceId,
      revocationEpoch: input.revocationEpoch,
      revokedGrantIds: input.revokedGrantIds ?? [],
      policyEpoch: input.policyEpoch,
      catalogEpoch: input.catalogEpoch,
      capturedAtMs: input.issuedAtMs,
    },
    current: {
      nowMs: input.nowMs,
      revocationEpoch: input.revocationEpoch,
      revokedGrantIds: input.revokedGrantIds ?? [],
      policyEpoch: input.policyEpoch,
      catalogEpoch: input.catalogEpoch,
    },
  };
}

/** Verify a temporary grant immediately after the owning policy allowed it. */
export function assertPermissionEffectOwnerCheckpoint(
  input: PermissionEffectOwnerCheckpointInput,
): PermissionEffectBinding {
  return assertPermissionEffectAtFinalCheckpoint(buildPermissionEffectOwnerCheckpoint(input));
}

export type PermissionEffectDenyReason =
  | 'component-not-registered'
  | 'owner-denied'
  | 'authority-owner-mismatch'
  | 'grant-missing'
  | 'invalid-grant'
  | 'grant-not-active'
  | 'grant-revoked'
  | 'grant-expired'
  | 'grant-not-yet-valid'
  | 'snapshot-from-future'
  | 'workspace-mismatch'
  | 'actor-mismatch'
  | 'task-branch-mismatch'
  | 'resource-mismatch'
  | 'action-mismatch'
  | 'purpose-mismatch'
  | 'approval-decision-mismatch'
  | 'policy-digest-mismatch'
  | 'policy-epoch-stale'
  | 'catalog-epoch-stale'
  | 'revocation-epoch-stale'
  | 'effect-namespace-mismatch'
  | 'effect-idempotency-mismatch';

export type PermissionEffectVerdict =
  | { allowed: true; reason: null; binding: PermissionEffectBinding; grantId: string }
  | { allowed: false; reason: PermissionEffectDenyReason; binding: PermissionEffectBinding | null };

export class PermissionEffectDeniedError extends Error {
  readonly code = 'E_PERMISSION_EFFECT_DENIED';
  readonly reason: PermissionEffectDenyReason;

  constructor(reason: PermissionEffectDenyReason) {
    super(`Permission/effect final checkpoint denied: ${reason}`);
    this.name = 'PermissionEffectDeniedError';
    this.reason = reason;
  }
}

export function permissionEffectBindingFor(
  componentId: string,
): PermissionEffectBinding | undefined {
  return BINDING_BY_COMPONENT.get(componentId as PermissionEffectComponentId);
}

function timestampMs(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function deny(
  reason: PermissionEffectDenyReason,
  binding: PermissionEffectBinding | null,
): PermissionEffectVerdict {
  return { allowed: false, reason, binding };
}

/**
 * Final pure check. Call immediately before an effect, after the owner's policy
 * and approval/grant preparation, and never from a component descriptor itself.
 */
export function verifyPermissionEffectAtFinalCheckpoint(
  input: PermissionEffectFinalCheckInput,
): PermissionEffectVerdict {
  const binding = permissionEffectBindingFor(input.request.componentId);
  if (!binding) return deny('component-not-registered', null);
  if (input.snapshot.ownerDecision !== 'allowed') return deny('owner-denied', binding);
  if (input.snapshot.authorityOwner !== binding.finalAuthorityOwner) {
    return deny('authority-owner-mismatch', binding);
  }
  if (!input.snapshot.grant) return deny('grant-missing', binding);
  if (input.snapshot.grant.status !== 'active') {
    return deny(input.snapshot.grant.status === 'revoked' ? 'grant-revoked' : 'grant-not-active', binding);
  }

  let grant: CapabilityGrant;
  try {
    grant = normalizeCapabilityGrant(input.snapshot.grant);
  } catch {
    return deny('invalid-grant', binding);
  }
  if (grant.revocation) return deny('grant-revoked', binding);
  if (input.snapshot.revokedGrantIds.includes(grant.grantId) || input.current.revokedGrantIds.includes(grant.grantId)) {
    return deny('grant-revoked', binding);
  }

  if (
    input.subject.sessionKey !== grant.actor.sessionKey ||
    input.subject.runId !== grant.actor.runId ||
    input.subject.attemptIndex !== grant.actor.attemptIndex ||
    input.subject.modelCallIndex !== grant.actor.modelCallIndex ||
    input.subject.actorKind !== grant.actor.actorKind
  ) {
    return deny('actor-mismatch', binding);
  }
  if (input.subject.workspaceId !== input.snapshot.workspaceId) {
    return deny('workspace-mismatch', binding);
  }
  if (input.subject.taskBranchId !== grant.scope.taskBranchId) {
    return deny('task-branch-mismatch', binding);
  }
  if (input.request.resource !== grant.scope.resource) return deny('resource-mismatch', binding);
  if (input.request.action !== grant.scope.action) return deny('action-mismatch', binding);
  if (input.request.purpose !== grant.scope.purpose) return deny('purpose-mismatch', binding);
  if (grant.approvalRef.decision !== 'approved') return deny('approval-decision-mismatch', binding);
  if (
    grant.derivation.policyDigest !== input.snapshot.ownerPolicyDigest ||
    grant.approvalRef.policyDigest !== input.snapshot.ownerPolicyDigest
  ) {
    return deny('policy-digest-mismatch', binding);
  }
  if (input.current.policyEpoch !== input.snapshot.policyEpoch) return deny('policy-epoch-stale', binding);
  if (input.current.catalogEpoch !== input.snapshot.catalogEpoch) return deny('catalog-epoch-stale', binding);
  if (input.current.revocationEpoch !== input.snapshot.revocationEpoch) {
    return deny('revocation-epoch-stale', binding);
  }

  const issuedAt = timestampMs(grant.ttl.issuedAt);
  const expiresAt = timestampMs(grant.ttl.expiresAt);
  if (issuedAt === undefined || expiresAt === undefined || expiresAt <= issuedAt) {
    return deny('invalid-grant', binding);
  }
  if (input.current.nowMs < issuedAt) return deny('grant-not-yet-valid', binding);
  if (input.current.nowMs >= expiresAt) return deny('grant-expired', binding);
  if (input.snapshot.capturedAtMs > input.current.nowMs) return deny('snapshot-from-future', binding);

  if (grant.effectIdempotency.namespace !== binding.effect) {
    return deny('effect-namespace-mismatch', binding);
  }
  if (
    input.request.idempotencyKey !== undefined &&
    input.request.idempotencyKey !== grant.effectIdempotency.key
  ) {
    return deny('effect-idempotency-mismatch', binding);
  }

  return { allowed: true, reason: null, binding, grantId: grant.grantId };
}

export function assertPermissionEffectAtFinalCheckpoint(
  input: PermissionEffectFinalCheckInput,
): PermissionEffectBinding {
  const verdict = verifyPermissionEffectAtFinalCheckpoint(input);
  if (!verdict.allowed) throw new PermissionEffectDeniedError(verdict.reason);
  return verdict.binding;
}