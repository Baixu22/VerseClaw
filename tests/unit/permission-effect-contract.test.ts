import { describe, expect, it } from 'vitest';
import type { CapabilityGrant } from '@shared/types/context-control-plane/artifacts';
import {
  PERMISSION_EFFECT_BINDINGS,
  PERMISSION_EFFECT_COMPONENTS,
  PermissionEffectDeniedError,
  assertPermissionEffectAtFinalCheckpoint,
  assertPermissionEffectOwnerCheckpoint,
  buildPermissionEffectOwnerCheckpoint,
  permissionEffectBindingFor,
  validatePermissionEffectBindings,
  verifyPermissionEffectAtFinalCheckpoint,
  type PermissionEffectFinalCheckInput,
  type PermissionEffectOwnerCheckpointInput,
} from '@shared/permission-effect-contract';

const POLICY_DIGEST = `sha256:${'a'.repeat(64)}`;
const NOW = Date.parse('2026-01-01T00:00:30.000Z');

function makeInput(componentId: (typeof PERMISSION_EFFECT_COMPONENTS)[number] = 'browser'): PermissionEffectFinalCheckInput {
  const binding = permissionEffectBindingFor(componentId)!;
  const grant: CapabilityGrant = {
    schema: 'CapabilityGrant/v1',
    grantId: 'grant-1',
    derivation: {
      ruleId: 'permission-effect-contract/v1',
      ruleVersion: '1',
      policyDigest: POLICY_DIGEST,
      inputRefs: ['request:1'],
    },
    actor: {
      sessionKey: 'session:one',
      runId: 'run-1',
      attemptIndex: 0,
      modelCallIndex: 0,
      actorKind: 'principal',
    },
    scope: {
      taskBranchId: 'task:root',
      resource: 'workspace:alpha/document',
      action: 'write',
      purpose: 'user requested',
    },
    approvalRef: {
      approvalId: 'approval-1',
      decision: 'approved',
      resolvedBy: binding.finalAuthorityOwner,
      policyDigest: POLICY_DIGEST,
    },
    ttl: {
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:01:00.000Z',
    },
    effectIdempotency: {
      key: 'grant-1:approval-1:call-1',
      namespace: binding.effect,
    },
    status: 'active',
  };
  return {
    subject: {
      sessionKey: 'session:one',
      runId: 'run-1',
      attemptIndex: 0,
      modelCallIndex: 0,
      actorKind: 'principal',
      workspaceId: 'workspace-alpha',
      taskBranchId: 'task:root',
    },
    request: {
      requestId: 'request-1',
      componentId,
      action: 'write',
      resource: 'workspace:alpha/document',
      purpose: 'user requested',
      idempotencyKey: 'grant-1:approval-1:call-1',
    },
    snapshot: {
      grant,
      authorityOwner: binding.finalAuthorityOwner,
      ownerDecision: 'allowed',
      ownerPolicyDigest: POLICY_DIGEST,
      workspaceId: 'workspace-alpha',
      revocationEpoch: 'revocation-1',
      revokedGrantIds: [],
      policyEpoch: 'policy-1',
      catalogEpoch: 'catalog-1',
      capturedAtMs: NOW - 1_000,
    },
    current: {
      nowMs: NOW,
      revocationEpoch: 'revocation-1',
      revokedGrantIds: [],
      policyEpoch: 'policy-1',
      catalogEpoch: 'catalog-1',
    },
  };
}

function denyReason(input: PermissionEffectFinalCheckInput) {
  const verdict = verifyPermissionEffectAtFinalCheckpoint(input);
  return verdict.allowed ? null : verdict.reason;
}

describe('permission/effect final contract', () => {
  it('registers exactly one authority binding for every required side-effect component', () => {
    expect(PERMISSION_EFFECT_BINDINGS.map((binding) => binding.componentId).sort()).toEqual(
      [...PERMISSION_EFFECT_COMPONENTS].sort(),
    );
    expect(new Set(PERMISSION_EFFECT_BINDINGS.map((binding) => binding.componentId)).size).toBe(
      PERMISSION_EFFECT_BINDINGS.length,
    );
    expect(new Set(PERMISSION_EFFECT_BINDINGS.map((binding) => binding.effect)).size).toBe(
      PERMISSION_EFFECT_BINDINGS.length,
    );
  });

  it('rejects duplicate component/effect declarations and self-authority widening', () => {
    expect(validatePermissionEffectBindings(PERMISSION_EFFECT_BINDINGS)).toEqual([]);
    const forged = [
      ...PERMISSION_EFFECT_BINDINGS,
      { ...PERMISSION_EFFECT_BINDINGS[0], finalAuthorityOwner: 'component.forged' },
      { ...PERMISSION_EFFECT_BINDINGS[1], effect: PERMISSION_EFFECT_BINDINGS[0].effect },
    ];
    expect(validatePermissionEffectBindings(forged as never)).toEqual(expect.arrayContaining([
      'duplicate-component:browser',
      'self-authority:browser',
      'duplicate-effect:browser-effect',
    ]));
  });
  it('allows a fully matching final checkpoint', () => {
    expect(verifyPermissionEffectAtFinalCheckpoint(makeInput())).toMatchObject({
      allowed: true,
      reason: null,
      grantId: 'grant-1',
    });
  });

  it('derives the same scoped checkpoint for each registered owner', () => {
    for (const componentId of PERMISSION_EFFECT_COMPONENTS) {
      const base = makeInput(componentId);
      const binding = permissionEffectBindingFor(componentId)!;
      const ownerInput: PermissionEffectOwnerCheckpointInput = {
        componentId,
        subject: base.subject,
        request: {
          requestId: base.request.requestId,
          action: base.request.action,
          resource: base.request.resource,
          purpose: base.request.purpose,
          idempotencyKey: base.request.idempotencyKey!,
        },
        authorityOwner: binding.finalAuthorityOwner,
        decisionRef: `decision-${componentId}`,
        policyDigest: POLICY_DIGEST,
        issuedAtMs: NOW - 1_000,
        expiresAtMs: NOW + 30_000,
        nowMs: NOW,
        revocationEpoch: 'revocation-1',
        policyEpoch: 'policy-1',
        catalogEpoch: 'catalog-1',
      };
      expect(buildPermissionEffectOwnerCheckpoint(ownerInput).snapshot.grant).toMatchObject({
        scope: {
          taskBranchId: base.subject.taskBranchId,
          resource: base.request.resource,
          action: base.request.action,
          purpose: base.request.purpose,
        },
        approvalRef: { resolvedBy: binding.finalAuthorityOwner },
        effectIdempotency: {
          key: base.request.idempotencyKey,
          namespace: binding.effect,
        },
      });
      expect(assertPermissionEffectOwnerCheckpoint(ownerInput)).toBe(binding);
    }
  });

  it('rejects a component that tries to name itself as the owner', () => {
    const base = makeInput('browser');
    expect(() => assertPermissionEffectOwnerCheckpoint({
      componentId: 'browser',
      subject: base.subject,
      request: {
        requestId: base.request.requestId,
        action: base.request.action,
        resource: base.request.resource,
        purpose: base.request.purpose,
        idempotencyKey: base.request.idempotencyKey!,
      },
      authorityOwner: 'component.browser',
      decisionRef: 'decision-browser-self',
      policyDigest: POLICY_DIGEST,
      issuedAtMs: NOW - 1_000,
      expiresAtMs: NOW + 30_000,
      nowMs: NOW,
      revocationEpoch: 'revocation-1',
      policyEpoch: 'policy-1',
      catalogEpoch: 'catalog-1',
    })).toThrow(expect.objectContaining({ reason: 'authority-owner-mismatch' }));
  });

  it('rejects an unregistered component or forged authority owner', () => {
    const unknown = makeInput();
    unknown.request.componentId = 'forged-component' as never;
    expect(denyReason(unknown)).toBe('component-not-registered');

    const forged = makeInput();
    forged.snapshot.authorityOwner = 'component.self';
    expect(denyReason(forged)).toBe('authority-owner-mismatch');
  });

  it('rejects owner denial and missing/invalid grants', () => {
    const denied = makeInput();
    denied.snapshot.ownerDecision = 'denied';
    expect(denyReason(denied)).toBe('owner-denied');

    const missing = makeInput();
    missing.snapshot.grant = null;
    expect(denyReason(missing)).toBe('grant-missing');

    const invalid = makeInput();
    invalid.snapshot.grant = { ...invalid.snapshot.grant!, grantId: '' };
    expect(denyReason(invalid)).toBe('invalid-grant');
  });

  it('rejects revoked status, grant revocation and either revoked-id set', () => {
    const revokedStatus = makeInput();
    revokedStatus.snapshot.grant = { ...revokedStatus.snapshot.grant!, status: 'revoked' };
    expect(denyReason(revokedStatus)).toBe('grant-revoked');

    const revocation = makeInput();
    revocation.snapshot.grant = {
      ...revocation.snapshot.grant!,
      status: 'revoked',
      revocation: {
        revokedAt: '2026-01-01T00:00:10.000Z',
        reason: 'user-revoked',
        revocationEpoch: 'revocation-2',
      },
    } satisfies CapabilityGrant;
    expect(denyReason(revocation)).toBe('grant-revoked');

    const snapshotRevoked = makeInput();
    snapshotRevoked.snapshot.revokedGrantIds = ['grant-1'];
    expect(denyReason(snapshotRevoked)).toBe('grant-revoked');

    const currentRevoked = makeInput();
    currentRevoked.current.revokedGrantIds = ['grant-1'];
    expect(denyReason(currentRevoked)).toBe('grant-revoked');
  });

  it('rejects actor, workspace and task-branch mismatches', () => {
    const actor = makeInput();
    actor.subject.sessionKey = 'session:two';
    expect(denyReason(actor)).toBe('actor-mismatch');

    const workspace = makeInput();
    workspace.subject.workspaceId = 'workspace-beta';
    expect(denyReason(workspace)).toBe('workspace-mismatch');

    const branch = makeInput();
    branch.subject.taskBranchId = 'task:other';
    expect(denyReason(branch)).toBe('task-branch-mismatch');
  });

  it('rejects action, resource and purpose mismatches before any effect', () => {
    const resource = makeInput();
    resource.request.resource = 'workspace:alpha/other';
    expect(denyReason(resource)).toBe('resource-mismatch');

    const action = makeInput();
    action.request.action = 'delete';
    expect(denyReason(action)).toBe('action-mismatch');

    const purpose = makeInput();
    purpose.request.purpose = 'different purpose';
    expect(denyReason(purpose)).toBe('purpose-mismatch');
  });

  it('rejects policy digest, policy epoch, catalog epoch and revocation epoch drift', () => {
    const digest = makeInput();
    digest.snapshot.ownerPolicyDigest = `sha256:${'b'.repeat(64)}`;
    expect(denyReason(digest)).toBe('policy-digest-mismatch');

    const policy = makeInput();
    policy.current.policyEpoch = 'policy-2';
    expect(denyReason(policy)).toBe('policy-epoch-stale');

    const catalog = makeInput();
    catalog.current.catalogEpoch = 'catalog-2';
    expect(denyReason(catalog)).toBe('catalog-epoch-stale');

    const revocation = makeInput();
    revocation.current.revocationEpoch = 'revocation-2';
    expect(denyReason(revocation)).toBe('revocation-epoch-stale');
  });

  it('rejects expired, not-yet-valid and future snapshots', () => {
    const expired = makeInput();
    expired.current.nowMs = Date.parse('2026-01-01T00:01:00.000Z');
    expect(denyReason(expired)).toBe('grant-expired');

    const future = makeInput();
    future.current.nowMs = Date.parse('2025-12-31T23:59:59.000Z');
    expect(denyReason(future)).toBe('grant-not-yet-valid');

    const snapshot = makeInput();
    snapshot.snapshot.capturedAtMs = NOW + 1;
    expect(denyReason(snapshot)).toBe('snapshot-from-future');
  });

  it('rejects effect namespace and idempotency mismatches', () => {
    const namespace = makeInput('coding-control');
    namespace.snapshot.grant = {
      ...namespace.snapshot.grant!,
      effectIdempotency: { ...namespace.snapshot.grant!.effectIdempotency, namespace: 'browser-effect' },
    } satisfies CapabilityGrant;
    expect(denyReason(namespace)).toBe('effect-namespace-mismatch');

    const idempotency = makeInput();
    idempotency.request.idempotencyKey = 'other-key';
    expect(denyReason(idempotency)).toBe('effect-idempotency-mismatch');
  });

  it('throws a typed error at the assert boundary', () => {
    const input = makeInput();
    input.current.revokedGrantIds = ['grant-1'];
    expect(() => assertPermissionEffectAtFinalCheckpoint(input)).toThrow(PermissionEffectDeniedError);
    try {
      assertPermissionEffectAtFinalCheckpoint(input);
    } catch (error) {
      expect(error).toMatchObject({ code: 'E_PERMISSION_EFFECT_DENIED', reason: 'grant-revoked' });
    }
  });
});