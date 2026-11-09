import { describe, expect, it } from "vitest";

import {
  buildMainSessionRecoveryRequest,
  classifyMainSessionReplayClass,
  type MainSessionRecoveryFacts,
} from "./main-session-adapter.js";
import { recoveryAuthorityV1 } from "./authority.js";
import {
  RecoveryShadowSink,
  compareRecoveryShadow,
  isRecoveryAuthorityShadowEnabled,
} from "./shadow.js";

function facts(overrides: Partial<MainSessionRecoveryFacts> = {}): MainSessionRecoveryFacts {
  return {
    sessionKey: "agent:main:main",
    sessionId: "sess-1",
    attemptsConsumed: 1,
    maxAttempts: 3,
    resumable: true,
    approvalPending: false,
    visibleOutputObserved: false,
    pendingFinalDelivery: false,
    now: 1_700_000_000_000,
    ...overrides,
  };
}

describe("TF-0714 recovery authority (read-only aggregation)", () => {
  it("returns exactly one decision and preserves entry/owner", () => {
    const request = buildMainSessionRecoveryRequest(facts());
    const decision = recoveryAuthorityV1.decide(request);
    expect(decision.entry).toBe("main-session-restart");
    expect(decision.owner?.kind).toBe("main-session");
    expect(decision.evidenceOnly).toBe(true);
    expect(decision.attempt).toEqual({ current: 1, max: 3 });
  });

  it("classifies a resumable tail as reconcile and an approval-pending tail as unsafe", () => {
    expect(classifyMainSessionReplayClass(facts())).toBe("reconcile");
    expect(classifyMainSessionReplayClass(facts({ approvalPending: true }))).toBe("unsafe");
    expect(classifyMainSessionReplayClass(facts({ resumable: false }))).toBe("unsafe");
  });

  it("does not resume an unknown-effect turn: it reconciles instead", () => {
    const decision = recoveryAuthorityV1.decide(buildMainSessionRecoveryRequest(facts()));
    expect(decision.kind).toBe("reconcile");
    expect(decision.basis).toBe("effect-certainty");
  });

  it("rejects resume for a stale approval-pending tail", () => {
    const decision = recoveryAuthorityV1.decide(
      buildMainSessionRecoveryRequest(facts({ resumable: true, approvalPending: true })),
    );
    expect(decision.kind).toBe("reject");
    expect(decision.basis).toBe("admission-boundary");
  });

  it("forces reconcile, never replay, once visible output was observed", () => {
    const decision = recoveryAuthorityV1.decide(
      buildMainSessionRecoveryRequest(facts({ visibleOutputObserved: true })),
    );
    expect(decision.kind).toBe("reconcile");
    expect(decision.basis).toBe("admission-boundary");
  });

  it("wedges when the attempt budget is exhausted", () => {
    const decision = recoveryAuthorityV1.decide(
      buildMainSessionRecoveryRequest(facts({ attemptsConsumed: 3, maxAttempts: 3 })),
    );
    expect(decision.kind).toBe("wedge");
    expect(decision.basis).toBe("budget");
  });

  it("routes a pending final delivery to the delivery owner", () => {
    const decision = recoveryAuthorityV1.decide(
      buildMainSessionRecoveryRequest(facts({ pendingFinalDelivery: true, effect: "not_applied" })),
    );
    expect(decision.kind).toBe("deliver");
    expect(decision.basis).toBe("owner-state");
  });

  it("fail-closes on an invalid request", () => {
    const decision = recoveryAuthorityV1.decide({ nonsense: true } as never);
    expect(decision.kind).toBe("reject");
    expect(decision.owner).toBeNull();
    expect(decision.basis).toBe("invalid-request");
  });
});

describe("TF-0714 recovery authority shadow", () => {
  it("is disabled unless the env flag is truthy", () => {
    expect(isRecoveryAuthorityShadowEnabled({})).toBe(false);
    expect(isRecoveryAuthorityShadowEnabled({ OPENCLAW_RECOVERY_AUTHORITY_SHADOW: "0" })).toBe(
      false,
    );
    expect(isRecoveryAuthorityShadowEnabled({ OPENCLAW_RECOVERY_AUTHORITY_SHADOW: "1" })).toBe(
      true,
    );
    expect(isRecoveryAuthorityShadowEnabled({ OPENCLAW_RECOVERY_AUTHORITY_SHADOW: "on" })).toBe(
      true,
    );
  });

  it("records drift when the legacy outcome disagrees with the authority", () => {
    const request = buildMainSessionRecoveryRequest(facts());
    const decision = recoveryAuthorityV1.decide(request);
    const record = compareRecoveryShadow(request, decision, "resumed", 1);
    expect(decision.kind).toBe("reconcile");
    expect(record.drift).toBe(true);
    expect(record.reasons.length).toBeGreaterThan(0);
    expect(record.entry).toBe("main-session-restart");
  });

  it("records no drift when the legacy outcome matches", () => {
    const request = buildMainSessionRecoveryRequest(facts({ attemptsConsumed: 3, maxAttempts: 3 }));
    const decision = recoveryAuthorityV1.decide(request);
    const record = compareRecoveryShadow(request, decision, "failed", 1);
    expect(decision.kind).toBe("wedge");
    expect(record.drift).toBe(false);
  });

  it("keeps the sink bounded and counts drifts", () => {
    const sink = new RecoveryShadowSink(2);
    const request = buildMainSessionRecoveryRequest(facts());
    const decision = recoveryAuthorityV1.decide(request);
    for (let i = 0; i < 5; i += 1)
      sink.record(compareRecoveryShadow(request, decision, "resumed", i));
    const snapshot = sink.snapshot();
    expect(snapshot.records.length).toBe(2);
    expect(snapshot.droppedCount).toBe(3);
    expect(snapshot.driftCount).toBe(2);
  });
});
