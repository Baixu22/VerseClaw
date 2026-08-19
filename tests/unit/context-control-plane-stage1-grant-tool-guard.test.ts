import { describe, expect, it } from "vitest";
import { normalizeCapabilityGrant } from "../../shared/types/context-control-plane/artifacts";
import {
  deriveStage1MinimalGrant,
  verifyStage1MinimalGrant,
} from "../../openclaw_runtime/src/agents/stage1-minimal-grant";

const policyDigest = `sha256:${"a".repeat(64)}`;

function approvedRowFixture() {
  return {
    approval_id: "aprv_1",
    decision: "approved",
    resolved_by: "owner:stage1",
    expires_at_ms: Date.now() + 60_000,
    updated_at: Date.now(),
  };
}

describe("stage1 grant and Tool Guard acceptance surface", () => {
  it("derives a schema-valid active grant and allows the exact call", () => {
    const actor = { sessionKey: "sess:1", runId: "run:1", attemptIndex: 0, modelCallIndex: 0, actorKind: "principal" as const };
    const scope = { taskBranchId: "run:1", resource: "workspace:sentinel.txt", action: "write", purpose: "golden write" };
    const derived = deriveStage1MinimalGrant({
      approvalRow: approvedRowFixture(),
      actor,
      scope,
      policyDigest,
      toolCallId: "tool_1",
    });
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(() => normalizeCapabilityGrant(derived.grant)).not.toThrow();
    expect(verifyStage1MinimalGrant(derived.grant, {
      toolCallId: "tool_1",
      toolName: "write",
      resource: "workspace:sentinel.txt",
      action: "write",
      purpose: "golden write",
      actor,
      approvalId: "aprv_1",
      policyDigest,
      resolvedBy: "owner:stage1",
      nowMs: Date.now() + 1,
    }).allow).toBe(true);
  });

  it("denies every field mismatch with a queryable reason and zero side effects", () => {
    const actor = { sessionKey: "sess:1", runId: "run:1", attemptIndex: 0, modelCallIndex: 0, actorKind: "principal" as const };
    const derived = deriveStage1MinimalGrant({
      approvalRow: approvedRowFixture(),
      actor,
      scope: { taskBranchId: "run:1", resource: "workspace:a.txt", action: "write", purpose: "p" },
      policyDigest,
      toolCallId: "tool_1",
    });
    if (!derived.ok) throw new Error("derive failed");
    const base = {
      toolCallId: "tool_1",
      toolName: "write",
      resource: "workspace:a.txt",
      action: "write",
      purpose: "p",
      actor,
      approvalId: "aprv_1",
      policyDigest,
      resolvedBy: "owner:stage1",
      nowMs: Date.now() + 1,
    };
    expect(verifyStage1MinimalGrant(derived.grant, { ...base, actor: { ...actor, runId: "run:2" } }))
      .toMatchObject({ allow: false, reason: "actor-mismatch" });
    expect(verifyStage1MinimalGrant(derived.grant, { ...base, resource: "workspace:b.txt" }))
      .toMatchObject({ allow: false, reason: "scope-resource-mismatch" });
    expect(verifyStage1MinimalGrant(derived.grant, { ...base, action: "read" }))
      .toMatchObject({ allow: false, reason: "scope-action-mismatch" });
    expect(verifyStage1MinimalGrant(derived.grant, { ...base, approvalId: "aprv_2" }))
      .toMatchObject({ allow: false, reason: "approval-mismatch" });
    expect(verifyStage1MinimalGrant(derived.grant, { ...base, nowMs: Date.now() + 120_000 }))
      .toMatchObject({ allow: false, reason: "ttl-expired" });
  });
});
