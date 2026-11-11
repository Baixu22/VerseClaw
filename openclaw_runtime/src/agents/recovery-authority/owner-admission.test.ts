import { describe, expect, it } from "vitest";
import type { RecoveryAuthorityRequest } from "../../../../shared/recovery-authority/contract.js";
import {
  buildRecoveryAdmissionKey,
  finishOwnerRecoveryAdmission,
  isRecoveryAuthorityEnabled,
  prepareOwnerRecoveryAdmission,
  getRecoveryAdmissionIdentity,
  isCurrentRecoverySession,
} from "./owner-admission.js";

function request(): RecoveryAuthorityRequest {
  return {
    requestId: "recovery-1",
    entry: "subagent-orphan",
    owner: {
      kind: "subagent-run",
      ownerId: "run-1",
      sessionKey: "agent:main:subagent:one",
      runId: "run-1",
    },
    admission: {
      trigger: "gateway-restart",
      requiredPreState: "active-subagent-run",
      admitted: true,
      visibleOutputObserved: false,
    },
    budget: {
      attempts: { current: 0, max: 2 },
      backoff: { initialMs: 5000, multiplier: 2 },
      wedge: { afterAttempts: 2, wedged: false },
    },
    replayClass: "reconcile",
    effect: "not_applied",
    requestedAction: "resume",
    idempotencyKey: "owner-boundary-1",
    evidence: [],
    requestedAt: 100,
  };
}

describe("owner-bound recovery admission", () => {
  it("pins a committed recovery generation and rejects replaced owners or attempts", () => {
    const admitted = prepareOwnerRecoveryAdmission(request());
    if (!admitted.admitted) throw new Error("admission missing");
    const expected = getRecoveryAdmissionIdentity(admitted.record);
    const params = {
      sessionId: "generation",
      requestedSessionId: "generation",
      lifecycleRunId: "run-1",
      runId: admitted.record.idempotencyKey,
      admission: admitted.record,
      expected,
    };
    expect(isCurrentRecoverySession(params)).toBe(true);
    expect(isCurrentRecoverySession({ ...params, sessionId: "replacement" })).toBe(false);
    expect(isCurrentRecoverySession({ ...params, lifecycleRunId: "newer-run" })).toBe(false);
    expect(
      isCurrentRecoverySession({ ...params, admission: { ...admitted.record, attempts: 2 } }),
    ).toBe(false);
    expect(isCurrentRecoverySession({ ...params, admission: undefined })).toBe(false);
  });
  it("requires the explicit authority mode and binds retry identity to owner, generation and boundary", () => {
    expect(isRecoveryAuthorityEnabled({})).toBe(false);
    expect(isRecoveryAuthorityEnabled({ OPENCLAW_RECOVERY_AUTHORITY_SHADOW: "1" })).toBe(false);
    expect(isRecoveryAuthorityEnabled({ OPENCLAW_RECOVERY_AUTHORITY_MODE: "authority" })).toBe(
      true,
    );
    const key = buildRecoveryAdmissionKey("subagent-orphan", "run", "generation", "boundary");
    expect(key).not.toMatch(/[<>:"/\\|?*]/);
    expect(buildRecoveryAdmissionKey("subagent-orphan", "run", "generation", "boundary")).toBe(key);
    expect(
      buildRecoveryAdmissionKey("subagent-orphan", "run", "new-generation", "boundary"),
    ).not.toBe(key);
  });

  it("does not refund failed attempts and wedges at the owner's existing ceiling", () => {
    const first = prepareOwnerRecoveryAdmission(request());
    expect(first.admitted).toBe(true);
    if (!first.admitted) throw new Error("first admission missing");
    const failed = finishOwnerRecoveryAdmission(first.record, first.record, "failed", 110);
    const second = prepareOwnerRecoveryAdmission(request(), failed);
    expect(second.admitted).toBe(true);
    if (!second.admitted) throw new Error("second admission missing");
    expect(second.record.attempts).toBe(2);
    const exhausted = finishOwnerRecoveryAdmission(second.record, second.record, "failed", 120);
    const third = prepareOwnerRecoveryAdmission(request(), exhausted);
    expect(third.admitted).toBe(false);
    expect(third.decision.kind).toBe("wedge");
    expect(third.record?.attempts).toBe(2);
  });

  it("retains an unacknowledged reservation after serialization and rejects its duplicate", () => {
    const first = prepareOwnerRecoveryAdmission(request());
    if (!first.admitted) throw new Error("first admission missing");
    const reloaded = JSON.parse(JSON.stringify(first.record)) as typeof first.record;
    const duplicate = prepareOwnerRecoveryAdmission(request(), reloaded);
    expect(duplicate.admitted).toBe(false);
    expect(duplicate.decision).toEqual(first.decision);
    expect(duplicate.record?.state).toBe("pending");
    expect(duplicate.record?.attempts).toBe(1);
  });

  it.each(["idempotencyKey", "ownerEpoch"] as const)(
    "rejects an acknowledgement from a different %s",
    (field) => {
      const first = prepareOwnerRecoveryAdmission(request());
      if (!first.admitted) throw new Error("admission missing");
      const newer = { ...first.record, [field]: "replacement" };
      expect(finishOwnerRecoveryAdmission(newer, first.record, "accepted")).toBeUndefined();
      expect(newer.state).toBe("pending");
    },
  );

  it.each(["applied", "reconciled"] as const)(
    "settles %s final delivery without dispatch",
    (effect) => {
      const delivered: RecoveryAuthorityRequest = {
        ...request(),
        entry: "final-delivery",
        requestedAction: "deliver",
        effect,
        owner: {
          kind: "final-delivery",
          ownerId: "delivery-1",
          deliveryId: "delivery-1",
          sessionKey: "agent:main:main",
        },
      };
      const result = prepareOwnerRecoveryAdmission(delivered);
      expect(result.admitted).toBe(false);
      expect(result.decision.kind).toBe("settle");
      expect(result.record?.attempts).toBe(0);
      expect(prepareOwnerRecoveryAdmission(delivered, result.record).decision.kind).toBe("settle");
    },
  );

  it("observes a committed effect after the last permitted attempt without another delivery", () => {
    const pending = prepareOwnerRecoveryAdmission({
      ...request(),
      budget: {
        ...request().budget,
        attempts: { current: 1, max: 2 },
      },
    });
    if (!pending.admitted) throw new Error("last admission missing");
    const known = prepareOwnerRecoveryAdmission(
      { ...request(), effect: "applied" },
      pending.record,
    );
    expect(known.admitted).toBe(false);
    expect(known.decision.kind).toBe("settle");
    expect(known.record?.attempts).toBe(2);
    expect(known.record?.state).toBe("settled");
  });

  it("keeps an exhausted unknown effect in reconciliation without refunding its budget", () => {
    const unknown = prepareOwnerRecoveryAdmission({
      ...request(),
      effect: "unknown",
      budget: {
        ...request().budget,
        attempts: { current: 2, max: 2 },
      },
    });
    expect(unknown.admitted).toBe(false);
    expect(unknown.record?.state).toBe("reconcile");
    expect(unknown.record?.attempts).toBe(2);
    expect(unknown.decision.effect).toBe("unknown");
  });
});
