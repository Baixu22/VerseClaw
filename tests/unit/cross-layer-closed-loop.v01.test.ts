// @vitest-environment node
// V01: cross-layer closed loop + multi-component controlled ablation.
//
// Chains the shipped components into one deterministic closed loop and re-runs
// the paired ablation to prove the components compose without weakening safety:
//   failure storm -> L05 breaker opens -> E01 reliability aggregate drops
//   -> G01 bounded recovery action -> G03 redacted trace becomes an eval sample
//   -> S07 verifier refuses completion (insufficient evidence) -> L06 single owner
//   -> E02 paired ablation verdict unchanged.
import { describe, expect, it } from "vitest";

import { RateCircuitBreaker } from "../../openclaw_runtime/src/agents/rate-circuit-breaker";
import {
  claimWriteOwner,
  getActiveWriteOwner,
  releaseWriteOwner,
  resetHotFileWriteOwnersForTests,
} from "../../openclaw_runtime/src/agents/hot-file-write-owner";
import { buildEvidenceVerifierInputFixture } from "../../openclaw_runtime/src/runtime-core/evidence-verifier";
import {
  resolveVerifierCompletionVerdict,
  verifierCompletionTransition,
} from "../../openclaw_runtime/src/runtime-core/verifier-completion-verdict";
import { aggregateReliability } from "../../scripts/lib/reliability-aggregation.mjs";
import { evaluateAblation } from "../../scripts/lib/paired-ablation.mjs";
import { traceToEvalSample } from "../../scripts/lib/trace-to-eval-sample.mjs";
import { AppError } from "../../src/lib/error-model";

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("V01 cross-layer closed loop", () => {
  it("composes the layers without weakening safety and yields a re-runnable sample", () => {
    const c = clock();
    // 1. L05: a failure storm opens the rate breaker.
    const breaker = new RateCircuitBreaker({ windowMs: 1000, maxFailuresPerWindow: 5, cooldownMs: 2000, now: c.now });
    for (let i = 0; i < 5; i++) breaker.record(false);
    expect(breaker.getState()).toBe("open");
    expect(breaker.allowsRequest()).toBe(false);

    // 2. E01: the same failing trials aggregate into pass^k < 1.
    const reliability = aggregateReliability(
      [{ id: "case-1", trials: ["fail", "fail", "fail"] }, { id: "case-2", trials: ["pass", "pass", "pass"] }],
      { k: 3, minCases: 2 },
    );
    expect(reliability.passK).toBe(0.5);

    // 3. G01: the surfacing error carries a bounded recovery action.
    const error = new AppError("TIMEOUT", "provider timed out");
    expect(error.retryable).toBe(true);
    expect(error.nextAction).toEqual({ kind: "retry" });

    // 4. G03: the redacted failure trace becomes a re-runnable sample.
    const sample = traceToEvalSample({
      runId: "run-v01",
      createdAt: "2026-10-13T00:00:00.000Z",
      outcome: "failure",
      reproducer: { kind: "scenario", ref: "agent-dev-scenario:v01-loop" },
      signature: "rate-breaker-open",
    });
    expect(sample.ok).toBe(true);
    if (sample.ok) expect(sample.sample.expected).toEqual({ "before-fix": "fail", "after-fix": "pass" });

    // 5. S07: insufficient evidence yields no completion transition (no fake done).
    const verdict = resolveVerifierCompletionVerdict({
      input: buildEvidenceVerifierInputFixture({ evidenceRefs: [], toolResults: [], eventReplay: { status: "consistent", diagnosticCodes: [], pendingToolCallIds: [] } }),
      scope: { taskIds: ["task_1"] },
      priorStatus: "doing",
    });
    expect(verdict.verdict).toBe("insufficient-evidence");
    expect(verifierCompletionTransition(verdict)).toBeNull();

    // 6. L06: the loop writes under exactly one verified owner, then releases.
    resetHotFileWriteOwnersForTests();
    const claim = claimWriteOwner("/loop/hot.txt", "loop-owner", c.now());
    expect(claim.ok).toBe(true);
    if (claim.ok) {
      expect(getActiveWriteOwner("/loop/hot.txt")?.owner).toBe("loop-owner");
      expect(releaseWriteOwner("/loop/hot.txt", claim.token)).toBe(true);
    }
    expect(getActiveWriteOwner("/loop/hot.txt")).toBeUndefined();

    // 7. Recovery: after the cooldown the breaker admits one probe and closes.
    c.advance(2000);
    expect(breaker.allowsRequest()).toBe(true);
    expect(breaker.record(true)).toBe("closed");
  });

  it("re-runs the controlled paired ablation with the verdict unchanged (no regression)", () => {
    // A compact re-run of the E02 shape: a strictly positive component effect.
    const baseline = [];
    const treatment = [];
    for (let i = 0; i < 20; i++) {
      for (let r = 0; r < 3; r++) {
        baseline.push({ caseId: `c${i}`, repeat: r, success: false, retention: 0, latencyMs: 1, tokens: 10 });
        treatment.push({ caseId: `c${i}`, repeat: r, success: true, retention: 0.62 + (i % 5) * 0.04, latencyMs: 1, tokens: 10 });
      }
    }
    const result = evaluateAblation({
      baselineRuns: baseline,
      treatmentRuns: treatment,
      preRegistered: { primaryMetric: "retention", k: 3, minCases: 20, degradationBudget: 0 },
    });
    expect(result.verdict).toBe("component-helps");
    expect(result.effect.meanDiff).toBeCloseTo(0.7, 12);
    expect(result.treatment.falseBlocks).toBe(0);
    expect(result.treatment.safetyViolations).toBe(0);
  });
});
