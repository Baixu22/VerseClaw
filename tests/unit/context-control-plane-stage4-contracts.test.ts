import { describe, expect, it } from "vitest";

import {
  normalizeCapabilityGrant,
  type CapabilityGrant,
} from "../../shared/types/context-control-plane/artifacts";
import {
  deriveStage4CapabilityGrant,
  markStage4GrantExpired,
  recoverStage4GrantAfterRestart,
  revokeStage4CapabilityGrant,
  Stage4GrantAuthority,
  stage4ActorKey,
  stage4GovernancePolicyDigest,
  verifyStage4CapabilityGrant,
  type Stage4GrantActor,
  type Stage4GrantCall,
  type Stage4GrantScope,
} from "../../openclaw_runtime/src/agents/stage4-capability-grant";

const policyDigest = `sha256:${"a".repeat(64)}`;

function approvedRowFixture(now = Date.now()) {
  return {
    approval_id: "aprv_1",
    state: "execution_started" as const,
    decision: "approved" as const,
    resolved_by: "owner:stage4",
    expires_at_ms: now + 120_000,
    updated_at: now,
  };
}

function actorFixture(overrides: Partial<Stage4GrantActor> = {}): Stage4GrantActor {
  return {
    sessionKey: "sess:1",
    runId: "run:1",
    attemptIndex: 0,
    modelCallIndex: 0,
    actorKind: "principal",
    ...overrides,
  };
}

function scopeFixture(overrides: Partial<Stage4GrantScope> = {}): Stage4GrantScope {
  return {
    taskBranchId: "run:1",
    resource: "workspace:sub/file.txt",
    action: "write",
    purpose: "stage4 golden write",
    ...overrides,
  };
}

function callFixture(
  grant: CapabilityGrant,
  overrides: Partial<Stage4GrantCall> = {},
): Stage4GrantCall {
  return {
    toolCallId: "tool_1",
    toolName: "write",
    resource: grant.scope.resource,
    action: grant.scope.action,
    purpose: grant.scope.purpose,
    taskBranchId: grant.scope.taskBranchId,
    actor: grant.actor,
    approvalId: grant.approvalRef.approvalId,
    policyDigest: grant.approvalRef.policyDigest,
    resolvedBy: grant.approvalRef.resolvedBy,
    ...overrides,
  };
}

function deriveReason(input: Parameters<typeof deriveStage4CapabilityGrant>[0]) {
  const derived = deriveStage4CapabilityGrant(input);
  return derived.ok ? undefined : derived.reason;
}

describe("stage4 unified CapabilityGrant derivation and verification", () => {
  it("derives a schema-valid active grant and allows the exact call", () => {
    const now = Date.now();
    const derived = deriveStage4CapabilityGrant({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture(),
      policyDigest,
      toolCallId: "tool_1",
      nowMs: now,
    });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(() => normalizeCapabilityGrant(derived.grant)).not.toThrow();
    expect(derived.grant.status).toBe("active");
    expect(derived.grant.effectIdempotency.key).toBe(
      `${derived.grant.grantId}:aprv_1:tool_1`,
    );
    const verdict = verifyStage4CapabilityGrant({
      grant: derived.grant,
      call: callFixture(derived.grant),
      nowMs: now + 1,
    });
    expect(verdict.allow).toBe(true);
  });

  it("fails closed before execution_started and rejects schema-invalid inputs", () => {
    const now = Date.now();
    expect(
      deriveReason({
        approvalRow: { ...approvedRowFixture(now), state: "approved" },
        actor: actorFixture(),
        scope: scopeFixture(),
        policyDigest,
        toolCallId: "tool_1",
        nowMs: now,
      }),
    ).toBe("approval-not-execution-started");

    const base = {
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture(),
      policyDigest,
      toolCallId: "tool_1",
      nowMs: now,
    };
    expect(deriveReason({ ...base, policyDigest: "not-a-digest" })).toBe(
      "invalid-policy-digest",
    );
    expect(
      deriveReason({ ...base, actor: { ...actorFixture(), sessionKey: "bad key|" } }),
    ).toBe("invalid-identity");
    expect(
      deriveReason({
        ...base,
        actor: { ...actorFixture(), attemptIndex: Number.MAX_SAFE_INTEGER },
      }),
    ).toBe("invalid-identity");
    expect(
      deriveReason({ ...base, scope: { ...scopeFixture(), resource: "bad resource!" } }),
    ).toBe("invalid-scope");
    expect(
      deriveReason({ ...base, scope: { ...scopeFixture(), purpose: "bad\npurpose" } }),
    ).toBe("invalid-scope");
    expect(
      deriveReason({ ...base, scope: { ...scopeFixture(), purpose: "x".repeat(300) } }),
    ).toBe("invalid-scope");
    expect(deriveReason({ ...base, toolCallId: "bad id" })).toBe(
      "invalid-tool-call-id",
    );
    expect(deriveReason({ ...base, ttlMs: Number.NaN })).toBe("invalid-ttl");
  });

  it("denies expired, governance mismatch, and revoked grants with queryable reasons", () => {
    const now = Date.now();
    const derived = deriveStage4CapabilityGrant({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture(),
      policyDigest,
      toolCallId: "tool_1",
      nowMs: now,
      ttlMs: 1_000,
    });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;

    const expiredCall = callFixture(derived.grant, {
      toolCallId: "tool_expired",
    });
    expect(
      verifyStage4CapabilityGrant({
        grant: markStage4GrantExpired(derived.grant, now + 2_000),
        call: expiredCall,
        nowMs: now + 2_000,
      }).reason,
    ).toBe("grant-expired");

    expect(
      verifyStage4CapabilityGrant({
        grant: derived.grant,
        call: callFixture(derived.grant, { resolvedBy: "owner:someone-else" }),
        nowMs: now + 1,
      }).reason,
    ).toBe("governance-mismatch");

    const revoked = revokeStage4CapabilityGrant(derived.grant, {
      revokedAtMs: now + 500,
      reason: "owner-revoked",
      revocationEpoch: "grant-revocation-epoch:v1",
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(
      verifyStage4CapabilityGrant({
        grant: revoked.grant,
        call: callFixture(revoked.grant),
        nowMs: now + 1_000,
      }).reason,
    ).toBe("revoked");
  });

  it("denies an actor with a different task branch at the final execution check", () => {
    const now = Date.now();
    const authority = new Stage4GrantAuthority({ nowMs: () => now });
    const issued = authority.issue({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture(),
      policyDigest,
      toolCallId: "tool_task_branch",
      nowMs: now,
    });
    if (!issued.ok) throw new Error("derive failed");
    const verdict = authority.verify(
      issued.grant,
      callFixture(issued.grant, { taskBranchId: "run:other-branch" }),
      now + 1,
    );
    expect(verdict).toMatchObject({ allow: false, reason: "task-branch-mismatch" });
  });

  it("denies a grant revoked after the preflight snapshot at final execution", () => {
    const now = Date.now();
    const authority = new Stage4GrantAuthority({ nowMs: () => now });
    const issued = authority.issue({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture(),
      policyDigest,
      toolCallId: "tool_stale_revoke",
      nowMs: now,
    });
    if (!issued.ok) throw new Error("derive failed");
    const snapshot = callFixture(issued.grant, { toolCallId: "tool_stale_revoke" });
    expect(authority.verify(issued.grant, snapshot, Date.parse(issued.grant.ttl.issuedAt))).toMatchObject({ allow: true, reason: null });
    expect(authority.revoke(issued.grant.grantId, "revoked after snapshot", Date.parse(issued.grant.ttl.issuedAt)).ok).toBe(true);
    expect(authority.verify(issued.grant, snapshot, Date.parse(issued.grant.ttl.issuedAt) + 1)).toMatchObject({
      allow: false,
      reason: "revoked",
    });
  });

  it("denies every field mismatch with a queryable reason", () => {
    const now = Date.now();
    const derived = deriveStage4CapabilityGrant({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture(),
      policyDigest,
      toolCallId: "tool_1",
      nowMs: now,
    });
    if (!derived.ok) throw new Error("derive failed");
    const base = callFixture(derived.grant);

    expect(
      verifyStage4CapabilityGrant({
        grant: derived.grant,
        call: { ...base, actor: { ...base.actor, runId: "run:2" } },
        nowMs: now + 1,
      }).reason,
    ).toBe("actor-mismatch");
    expect(
      verifyStage4CapabilityGrant({
        grant: derived.grant,
        call: { ...base, resource: "workspace:other.txt" },
        nowMs: now + 1,
      }).reason,
    ).toBe("scope-resource-mismatch");
    expect(
      verifyStage4CapabilityGrant({
        grant: derived.grant,
        call: { ...base, action: "read" },
        nowMs: now + 1,
      }).reason,
    ).toBe("scope-action-mismatch");
    expect(
      verifyStage4CapabilityGrant({
        grant: derived.grant,
        call: { ...base, approvalId: "aprv_other" },
        nowMs: now + 1,
      }).reason,
    ).toBe("approval-mismatch");
    expect(
      verifyStage4CapabilityGrant({
        grant: derived.grant,
        call: { ...base, policyDigest: `sha256:${"b".repeat(64)}` },
        nowMs: now + 1,
      }).reason,
    ).toBe("policy-digest-mismatch");
    expect(
      verifyStage4CapabilityGrant({
        grant: derived.grant,
        call: { ...base, toolCallId: "tool_other" },
        nowMs: now + 1,
      }).reason,
    ).toBe("effect-idempotency-mismatch");
  });
});

describe("stage4 child delegation is attenuation-only", () => {
  it("derives a bounded child grant from an active parent", () => {
    const now = Date.now();
    const parent = deriveStage4CapabilityGrant({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture({ resource: "workspace:sub" }),
      policyDigest,
      toolCallId: "tool_parent",
      nowMs: now,
    });
    if (!parent.ok) throw new Error("parent derive failed");

    const child = deriveStage4CapabilityGrant({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture({ actorKind: "delegate" }),
      scope: scopeFixture({ resource: "workspace:sub/file.txt", purpose: "stage4 golden write" }),
      policyDigest,
      toolCallId: "tool_child",
      nowMs: now,
      parentGrant: parent.grant,
      delegation: { parentGrantId: parent.grant.grantId, maxDepth: 0 },
    });
    expect(child.ok).toBe(true);
    if (!child.ok) return;
    expect(child.grant.delegation).toEqual({
      parentGrantId: parent.grant.grantId,
      maxDepth: 0,
    });
    expect(child.actorChain).toEqual([
      stage4ActorKey(parent.grant.actor),
      stage4ActorKey(child.grant.actor),
    ]);
    expect(
      verifyStage4CapabilityGrant({
        grant: child.grant,
        call: callFixture(child.grant, { toolCallId: "tool_child" }),
        nowMs: now + 1,
        parentGrant: parent.grant,
      }).allow,
    ).toBe(true);
  });

  it("authority resolves parent chains and denies a child after parent revocation", () => {
    const now = Date.now();
    const authority = new Stage4GrantAuthority({ nowMs: () => now });
    const parent = authority.issue({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture({ resource: "workspace:sub" }),
      policyDigest,
      toolCallId: "tool_parent",
      nowMs: now,
    });
    if (!parent.ok) throw new Error("parent issue failed");
    const child = authority.issue({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture({ actorKind: "delegate" }),
      scope: scopeFixture({ resource: "workspace:sub/file.txt", purpose: "stage4 golden write" }),
      policyDigest,
      toolCallId: "tool_child",
      nowMs: now,
      parentGrant: parent.grant,
      delegation: { parentGrantId: parent.grant.grantId, maxDepth: 0 },
    });
    if (!child.ok) throw new Error("child issue failed");
    expect(
      authority.verify(child.grant, callFixture(child.grant, { toolCallId: "tool_child" }), now + 1).allow,
    ).toBe(true);
    authority.revoke(parent.grant.grantId, "owner-revoked", now + 2);
    expect(
      authority.verify(child.grant, callFixture(child.grant, { toolCallId: "tool_child" }), now + 3).reason,
    ).toBe("parent-grant-not-active");
  });

  it("authority denies a grandchild after root revocation with a full actor chain", () => {
    const now = Date.now();
    const authority = new Stage4GrantAuthority({ nowMs: () => now });
    const root = authority.issue({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture({ resource: "workspace:sub" }),
      policyDigest,
      toolCallId: "tool_root",
      nowMs: now,
    });
    if (!root.ok) throw new Error("root issue failed");
    const mid = authority.issue({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture({ actorKind: "delegate" }),
      scope: scopeFixture({ resource: "workspace:sub/mid" }),
      policyDigest,
      toolCallId: "tool_mid",
      nowMs: now,
      parentGrant: root.grant,
      delegation: { parentGrantId: root.grant.grantId, maxDepth: 2 },
    });
    if (!mid.ok) throw new Error("mid issue failed");
    const leaf = authority.issue({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture({ actorKind: "delegate" }),
      scope: scopeFixture({ resource: "workspace:sub/mid/leaf" }),
      policyDigest,
      toolCallId: "tool_leaf",
      nowMs: now,
      parentGrant: mid.grant,
      delegation: { parentGrantId: mid.grant.grantId, maxDepth: 1 },
    });
    if (!leaf.ok) throw new Error("leaf issue failed");
    const call = callFixture(leaf.grant, { toolCallId: "tool_leaf" });
    expect(authority.verify(leaf.grant, call, now + 1).allow).toBe(true);

    authority.revoke(root.grant.grantId, "root-revoked", now + 2);
    const verdict = authority.verify(leaf.grant, call, now + 3);
    expect(verdict.allow).toBe(false);
    expect(verdict.reason).toBe("parent-grant-not-active");
    expect(verdict.actorChain).toEqual([
      stage4ActorKey(root.grant.actor),
      stage4ActorKey(mid.grant.actor),
      stage4ActorKey(leaf.grant.actor),
    ]);
    const denials = authority.listDenials();
    expect(denials[denials.length - 1]?.actorChain).toEqual(verdict.actorChain);
    expect(denials[denials.length - 1]?.reason).toBe("parent-grant-not-active");
  });

  it("fails closed across the complete ancestor chain", () => {
    const now = Date.now();
    const root = deriveStage4CapabilityGrant({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture({ resource: "workspace:sub" }),
      policyDigest,
      toolCallId: "tool_root",
      nowMs: now,
    });
    if (!root.ok) throw new Error("root derive failed");
    const mid = deriveStage4CapabilityGrant({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture({ actorKind: "delegate" }),
      scope: scopeFixture({ resource: "workspace:sub/mid" }),
      policyDigest,
      toolCallId: "tool_mid",
      nowMs: now,
      parentGrant: root.grant,
      delegation: { parentGrantId: root.grant.grantId, maxDepth: 2 },
    });
    if (!mid.ok) throw new Error("mid derive failed");
    const grants = new Map([
      [root.grant.grantId, root.grant],
      [mid.grant.grantId, mid.grant],
    ]);
    const leaf = deriveStage4CapabilityGrant({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture({ actorKind: "delegate" }),
      scope: scopeFixture({ resource: "workspace:sub/mid/leaf" }),
      policyDigest,
      toolCallId: "tool_leaf",
      nowMs: now,
      parentGrant: mid.grant,
      delegation: { parentGrantId: mid.grant.grantId, maxDepth: 1 },
      resolveParentGrant: (grantId) => grants.get(grantId),
    });
    if (!leaf.ok) throw new Error("leaf derive failed");
    grants.set(leaf.grant.grantId, leaf.grant);
    const resolveParentGrant = (grantId: string) => grants.get(grantId);
    const call = callFixture(leaf.grant, { toolCallId: "tool_leaf" });

    const allowed = verifyStage4CapabilityGrant({
      grant: leaf.grant,
      call,
      nowMs: now + 1,
      resolveParentGrant,
    });
    expect(allowed.allow).toBe(true);
    expect(allowed.actorChain).toEqual([
      stage4ActorKey(root.grant.actor),
      stage4ActorKey(mid.grant.actor),
      stage4ActorKey(leaf.grant.actor),
    ]);

    const missingAncestor = verifyStage4CapabilityGrant({
      grant: leaf.grant,
      call,
      nowMs: now + 1,
      resolveParentGrant: (grantId) =>
        grantId === leaf.grant.grantId ? leaf.grant : undefined,
    });
    expect(missingAncestor.reason).toBe("parent-grant-missing");

    const revokedAncestor = verifyStage4CapabilityGrant({
      grant: leaf.grant,
      call,
      nowMs: now + 1,
      resolveParentGrant,
      revokedGrantIds: new Set([root.grant.grantId]),
    });
    expect(revokedAncestor.reason).toBe("parent-grant-not-active");
    expect(revokedAncestor.actorChain).toEqual([
      stage4ActorKey(root.grant.actor),
      stage4ActorKey(mid.grant.actor),
      stage4ActorKey(leaf.grant.actor),
    ]);

    const expiredAncestor = verifyStage4CapabilityGrant({
      grant: leaf.grant,
      call,
      nowMs: now + 1,
      resolveParentGrant: (grantId) => {
        if (grantId === root.grant.grantId) {
          return { ...root.grant, status: "expired" as const };
        }
        return grants.get(grantId);
      },
    });
    expect(expiredAncestor.reason).toBe("parent-grant-not-active");

    // Pure derivation without an ancestor resolver must fail closed rather
    // than assume the missing ancestor is active.
    expect(
      deriveReason({
        approvalRow: approvedRowFixture(now),
        actor: actorFixture({ actorKind: "delegate" }),
        scope: scopeFixture({ resource: "workspace:sub/mid/leaf" }),
        policyDigest,
        toolCallId: "tool_leaf_no_resolver",
        nowMs: now,
        parentGrant: mid.grant,
        delegation: { parentGrantId: mid.grant.grantId, maxDepth: 1 },
      }),
    ).toBe("parent-grant-missing");
  });

  it("rejects every child privilege escalation counterexample", () => {
    const now = Date.now();
    const parent = deriveStage4CapabilityGrant({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture({ resource: "workspace:sub", taskBranchId: "run:1" }),
      policyDigest,
      toolCallId: "tool_parent",
      nowMs: now,
    });
    if (!parent.ok) throw new Error("parent derive failed");

    const childInput = {
      approvalRow: approvedRowFixture(now),
      policyDigest,
      toolCallId: "tool_child",
      nowMs: now,
      parentGrant: parent.grant,
      delegation: { parentGrantId: parent.grant.grantId, maxDepth: 0 },
    };

    expect(
      deriveReason({
        ...childInput,
        actor: actorFixture({ actorKind: "principal" }),
        scope: scopeFixture({ resource: "workspace:sub/file.txt", purpose: "stage4 golden write" }),
      }),
    ).toBe("delegation-requires-delegate-actor");

    expect(
      deriveReason({
        ...childInput,
        actor: actorFixture({ actorKind: "delegate" }),
        scope: scopeFixture({ resource: "workspace:other/file.txt", purpose: "stage4 golden write" }),
      }),
    ).toBe("parent-scope-escalation");

    expect(
      deriveReason({
        ...childInput,
        actor: actorFixture({ actorKind: "delegate" }),
        scope: scopeFixture({ resource: "workspace:sub/file.txt", action: "read", purpose: "stage4 golden write" }),
      }),
    ).toBe("parent-scope-escalation");

    expect(
      deriveReason({
        ...childInput,
        actor: actorFixture({ actorKind: "delegate" }),
        scope: scopeFixture({ resource: "workspace:sub/file.txt", taskBranchId: "run:2", purpose: "stage4 golden write" }),
      }),
    ).toBe("parent-scope-escalation");

    expect(
      deriveReason({
        ...childInput,
        actor: actorFixture({ actorKind: "delegate" }),
        scope: scopeFixture({ resource: "workspace:sub/file.txt", purpose: "different purpose" }),
      }),
    ).toBe("parent-scope-escalation");

    expect(
      deriveReason({
        ...childInput,
        actor: actorFixture({ actorKind: "delegate" }),
        scope: scopeFixture({ resource: "workspace:sub/file.txt", purpose: "stage4 golden write" }),
        ttlMs: 120_000,
      }),
    ).toBe("parent-ttl-escalation");

    const depthParent = deriveStage4CapabilityGrant({
      ...childInput,
      actor: actorFixture({ actorKind: "delegate" }),
      scope: scopeFixture({ resource: "workspace:sub/file.txt", purpose: "stage4 golden write" }),
      delegation: { parentGrantId: parent.grant.grantId, maxDepth: 1 },
    });
    if (!depthParent.ok) throw new Error("depth parent derive failed");
    expect(
      deriveReason({
        approvalRow: approvedRowFixture(now),
        actor: actorFixture({ actorKind: "delegate" }),
        scope: scopeFixture({
          resource: "workspace:sub/file.txt/part",
          purpose: "stage4 golden write",
        }),
        policyDigest,
        toolCallId: "tool_depth_child",
        nowMs: now,
        parentGrant: depthParent.grant,
        delegation: { parentGrantId: depthParent.grant.grantId, maxDepth: 1 },
      }),
    ).toBe("delegation-depth-exceeded");

    const revokedParent = revokeStage4CapabilityGrant(parent.grant, {
      revokedAtMs: now,
      reason: "owner-revoked",
    });
    if (!revokedParent.ok) throw new Error("revoke failed");
    expect(
      deriveReason({
        ...childInput,
        actor: actorFixture({ actorKind: "delegate" }),
        scope: scopeFixture({ resource: "workspace:sub/file.txt", purpose: "stage4 golden write" }),
        parentGrant: revokedParent.grant,
      }),
    ).toBe("parent-grant-not-active");

    // Missing parent at verification time must fail closed.
    const child = deriveStage4CapabilityGrant({
      ...childInput,
      actor: actorFixture({ actorKind: "delegate" }),
      scope: scopeFixture({ resource: "workspace:sub/file.txt", purpose: "stage4 golden write" }),
    });
    if (!child.ok) throw new Error("child derive failed");
    expect(
      verifyStage4CapabilityGrant({
        grant: child.grant,
        call: callFixture(child.grant, { toolCallId: "tool_child" }),
        nowMs: now + 1,
        parentGrant: null,
      }).reason,
    ).toBe("parent-grant-missing");
  });
});

describe("stage4 restart recovery and audit trail", () => {
  it("resolves every active grant to explicit invalidation after restart", () => {
    expect(recoverStage4GrantAfterRestart("grant_1")).toEqual({
      ok: false,
      reason: "grant-not-recoverable-after-restart",
      grantId: "grant_1",
    });
  });

  it("records issue, denial, and revocation with policy digest and actor chain", () => {
    const now = Date.now();
    const authority = new Stage4GrantAuthority({ nowMs: () => now });
    const issued = authority.issue({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture(),
      policyDigest,
      toolCallId: "tool_audit",
      nowMs: now,
    });
    if (!issued.ok) throw new Error("issue failed");
    authority.verify(issued.grant, callFixture(issued.grant, { toolCallId: "tool_other" }), now + 1);
    authority.revoke(issued.grant.grantId, "owner-revoked", now + 2);

    const denials = authority.listDenials();
    const revocations = authority.listRevocations();
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({
      event: "grant-denied",
      grantId: issued.grant.grantId,
      policyDigest,
      reason: "effect-idempotency-mismatch",
    });
    expect(denials[0].actorChain).toEqual([stage4ActorKey(issued.grant.actor)]);
    expect(revocations).toHaveLength(1);
    expect(revocations[0]).toMatchObject({
      event: "grant-revoked",
      grantId: issued.grant.grantId,
      policyDigest,
      reason: "owner-revoked",
    });
    expect(authority.audit.listByGrant(issued.grant.grantId).map((r) => r.event)).toEqual([
      "grant-issued",
      "grant-denied",
      "grant-revoked",
    ]);
  });

  it("audits root-first full actor chain for issue and revoke on a deep delegation", () => {
    const now = Date.now();
    const authority = new Stage4GrantAuthority({ nowMs: () => now });

    const root = authority.issue({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture(),
      scope: scopeFixture({ resource: "workspace:sub" }),
      policyDigest,
      toolCallId: "tool_root",
      nowMs: now,
    });
    if (!root.ok) throw new Error("root issue failed");
    const mid = authority.issue({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture({ actorKind: "delegate" }),
      scope: scopeFixture({ resource: "workspace:sub/mid" }),
      policyDigest,
      toolCallId: "tool_mid",
      nowMs: now,
      parentGrant: root.grant,
      delegation: { parentGrantId: root.grant.grantId, maxDepth: 2 },
    });
    if (!mid.ok) throw new Error("mid issue failed");
    const leaf = authority.issue({
      approvalRow: approvedRowFixture(now),
      actor: actorFixture({ actorKind: "delegate" }),
      scope: scopeFixture({ resource: "workspace:sub/mid/leaf" }),
      policyDigest,
      toolCallId: "tool_leaf",
      nowMs: now,
      parentGrant: mid.grant,
      delegation: { parentGrantId: mid.grant.grantId, maxDepth: 1 },
    });
    if (!leaf.ok) throw new Error("leaf issue failed");

    const fullChain = [
      stage4ActorKey(root.grant.actor),
      stage4ActorKey(mid.grant.actor),
      stage4ActorKey(leaf.grant.actor),
    ];
    const issuedLeaf = authority.audit
      .listByGrant(leaf.grant.grantId)
      .find((record) => record.event === "grant-issued");
    expect(issuedLeaf?.actorChain).toEqual(fullChain);

    authority.revoke(leaf.grant.grantId, "leaf-revoked", now + 2);
    const revocations = authority.listRevocations();
    expect(revocations[revocations.length - 1]?.actorChain).toEqual(fullChain);
    expect(revocations[revocations.length - 1]?.reason).toBe("leaf-revoked");
  });
});

describe("stage4 governance policy digest", () => {
  it("is stable and decision-specific", () => {
    expect(stage4GovernancePolicyDigest("rule:v1", "approved")).toBe(
      stage4GovernancePolicyDigest("rule:v1", "approved"),
    );
    expect(stage4GovernancePolicyDigest("rule:v1", "approved")).not.toBe(
      stage4GovernancePolicyDigest("rule:v1", "denied"),
    );
  });
});
