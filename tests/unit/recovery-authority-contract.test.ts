import { describe, expect, expectTypeOf, it } from "vitest";

import {
  RECOVERY_AUTHORITY_CONTRACT_VERSION,
  evaluateRecoveryRequest,
  validateRecoveryAuthorityRequest,
  type RecoveryAuthority,
  type RecoveryAuthorityRequest,
  type RecoveryDecision,
} from "../../shared/recovery-authority/contract";

function baseRequest(): RecoveryAuthorityRequest {
  return {
    requestId: "req-1",
    entry: "main-session-restart",
    owner: {
      kind: "main-session",
      ownerId: "main:agent:main:one",
      sessionKey: "agent:main:one",
    },
    admission: {
      trigger: "gateway-restart",
      requiredPreState: "aborted-last-run",
      admitted: true,
      visibleOutputObserved: false,
    },
    budget: {
      attempts: { current: 1, max: 3 },
      backoff: { initialMs: 5_000, multiplier: 2, maxMs: 30_000 },
      wedge: { afterAttempts: 3, wedged: false },
    },
    replayClass: "safe",
    effect: "not_applied",
    requestedAction: "resume",
    idempotencyKey: "idem-req-1",
    evidence: [],
    requestedAt: 1_000,
  };
}

describe("recovery-authority contract invariants", () => {
  it.each(["effect-receipt", "event-log", "transcript"] as const)(
    "does not let %s evidence authorize replay",
    (kind) => {
      const request: RecoveryAuthorityRequest = {
        ...baseRequest(),
        requestedAction: "replay",
        replayClass: "safe",
        effect: "not_applied",
        evidence: [{ kind, ref: "evidence-1", role: "evidence" }],
      };

      const decision = evaluateRecoveryRequest(request);

      expect(decision.kind).toBe("reject");
      expect(decision.basis).toBe("replay-policy");
      expect(decision.reason).toContain("domain-journal");
      expect(decision.owner).not.toBeNull();
    },
  );

  it("authorizes replay only with domain-journal effect truth and a safe replay class", () => {
    const request: RecoveryAuthorityRequest = {
      ...baseRequest(),
      requestedAction: "replay",
      replayClass: "safe",
      effect: "not_applied",
      evidence: [{ kind: "domain-journal", ref: "journal-1", role: "effect-truth" }],
    };

    expect(evaluateRecoveryRequest(request).kind).toBe("replay");
  });

  it("forces unknown effect certainty through reconcile before resume or replay", () => {
    for (const requestedAction of ["resume", "replay", "deliver"] as const) {
      const request: RecoveryAuthorityRequest = {
        ...baseRequest(),
        requestedAction,
        effect: "unknown",
      };

      const decision = evaluateRecoveryRequest(request);
      expect(decision.kind).toBe("reconcile");
      expect(decision.basis).toBe("effect-certainty");
    }
  });

  it("reconciles when visible output was already observed instead of resuming", () => {
    const request: RecoveryAuthorityRequest = {
      ...baseRequest(),
      admission: { ...baseRequest().admission, visibleOutputObserved: true },
    };

    const decision = evaluateRecoveryRequest(request);
    expect(decision.kind).toBe("reconcile");
    expect(decision.basis).toBe("admission-boundary");
  });

  it("requires an owner and a finite, non-zero retry ceiling on every request", () => {
    const missingOwner = { ...baseRequest(), owner: undefined };
    expect(validateRecoveryAuthorityRequest(missingOwner).ok).toBe(false);

    const zeroMax = {
      ...baseRequest(),
      budget: { ...baseRequest().budget, attempts: { current: 0, max: 0 } },
    };
    expect(validateRecoveryAuthorityRequest(zeroMax).ok).toBe(false);

    const infiniteMax = {
      ...baseRequest(),
      budget: {
        ...baseRequest().budget,
        attempts: { current: 0, max: Number.POSITIVE_INFINITY },
      },
    };
    expect(validateRecoveryAuthorityRequest(infiniteMax).ok).toBe(false);

    const decision = evaluateRecoveryRequest(baseRequest());
    expect(decision.owner).not.toBeNull();
    expect(decision.attempt.max).toBe(3);
    expect(decision.attempt.current).toBeLessThanOrEqual(decision.attempt.max);
  });

  it("returns exactly one decision for one entry and one request", () => {
    const authority: RecoveryAuthority = {
      contractVersion: RECOVERY_AUTHORITY_CONTRACT_VERSION,
      id: "recovery-authority/v1",
      decide: evaluateRecoveryRequest,
    };

    const decision = authority.decide(baseRequest());

    expect(Array.isArray(decision)).toBe(false);
    expect(decision.requestId).toBe("req-1");
    expect(decision.authorityId).toBe("recovery-authority/v1");
    expectTypeOf<ReturnType<RecoveryAuthority["decide"]>>().toEqualTypeOf<RecoveryDecision>();
    expectTypeOf<Parameters<RecoveryAuthority["decide"]>>().toEqualTypeOf<
      [request: RecoveryAuthorityRequest]
    >();
  });

  it("fails closed on malformed input with no owner and an explicit reason", () => {
    const invalidInputs: unknown[] = [
      null,
      undefined,
      42,
      "",
      {},
      { requestId: "only-id" },
      { ...baseRequest(), entry: "not-a-recovery-entry" },
      { ...baseRequest(), replayClass: "sometimes" },
      { ...baseRequest(), effect: "maybe" },
      { ...baseRequest(), owner: null },
      { ...baseRequest(), requestedAt: Number.NaN },
      {
        ...baseRequest(),
        evidence: [{ kind: "effect-receipt", ref: "efx-1", role: "effect-truth" }],
      },
      {
        ...baseRequest(),
        budget: { ...baseRequest().budget, attempts: { current: 2, max: 1 } },
      },
    ];

    for (const input of invalidInputs) {
      const decision = evaluateRecoveryRequest(input);
      expect(decision.kind).toBe("reject");
      expect(decision.basis).toBe("invalid-request");
      expect(decision.owner).toBeNull();
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });

  it("turns an exhausted or wedged budget into a terminal wedge decision", () => {
    const exhausted = {
      ...baseRequest(),
      budget: { ...baseRequest().budget, attempts: { current: 3, max: 3 } },
    };
    expect(evaluateRecoveryRequest(exhausted).kind).toBe("wedge");

    const wedged = {
      ...baseRequest(),
      budget: {
        ...baseRequest().budget,
        wedge: { afterAttempts: 3, wedged: true, reason: "repeated resume without progress" },
      },
    };
    const decision = evaluateRecoveryRequest(wedged);
    expect(decision.kind).toBe("wedge");
    expect(decision.basis).toBe("budget");
    expect(decision.reason).toContain("repeated resume");
  });

  it("rejects an effect receipt promoted to effect truth at the validation boundary", () => {
    const promoted = {
      ...baseRequest(),
      evidence: [{ kind: "effect-receipt", ref: "efx-1", role: "effect-truth" }],
    };

    const validation = validateRecoveryAuthorityRequest(promoted);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.reason).toContain("effect-receipt");
    }
  });
});
