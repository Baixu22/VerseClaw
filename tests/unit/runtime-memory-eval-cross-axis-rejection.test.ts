// @vitest-environment node
// Phase 37 enhanced evaluation — Dimension 9: Cross-Axis Rejection.
// Verifies that the consumer rejects facts for all 10 non-dedicated rejection
// reasons (record_kind_not_fact, verification_status_not_verified,
// future_valid_at, invalidated_at_reference_time, expired_at_reference_time,
// task_mismatch, subject_mismatch, predicate_mismatch, token_budget_exceeded,
// limit_exceeded) and that the clean fact is accepted.
//
// Calls consumeRuntimeMemoryHydrationFacts directly (same pattern as
// hazard-sentinel-eval) so fact attributes are seen exactly as constructed.

import { describe, expect, it } from "vitest";
import { consumeRuntimeMemoryHydrationFacts } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-consumer";
import {
  buildCrossAxisScenario,
  evaluateCrossAxisRejection,
  CROSS_AXIS_REJECTION_REASONS,
  type CrossAxisFactSpec,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/cross-axis-rejection-eval";
import type { RuntimeMemoryHydrationConsumerResult } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-consumer";

const TASK_ID = "task_cross_axis";
const SUBJECT = "CrossSubject";
const PREDICATE = "cross_predicate";
const REFERENCE_TIME = 1_000;

describe("runtime memory cross-axis rejection evaluation", () => {
  it("buildCrossAxisScenario generates clean + 10 rejection facts", () => {
    const scenario = buildCrossAxisScenario({
      taskId: TASK_ID,
      subject: SUBJECT,
      predicate: PREDICATE,
      referenceTime: REFERENCE_TIME,
    });

    // 1 clean + 10 rejection = 11 specs
    expect(scenario).toHaveLength(11);
    const clean = scenario.filter((s) => s.isClean);
    const rejection = scenario.filter((s) => !s.isClean);
    expect(clean).toHaveLength(1);
    expect(rejection).toHaveLength(10);

    const reasons = rejection.map((s) => s.expectedRejectionReason);
    expect(new Set(reasons).size).toBe(10);
    for (const reason of CROSS_AXIS_REJECTION_REASONS) {
      expect(reasons).toContain(reason);
    }
  });

  it("allReasonsFired = true (all 10 rejection reasons trigger)", () => {
    const scenario = buildCrossAxisScenario({
      taskId: TASK_ID,
      subject: SUBJECT,
      predicate: PREDICATE,
      referenceTime: REFERENCE_TIME,
    });
    const results = runCrossAxisConsumer(scenario);
    const result = evaluateCrossAxisRejection(scenario, results);

    expect(result.allReasonsFired).toBe(true);
  });

  it("rejectionCoverage = 1 (all 10 reasons fire)", () => {
    const scenario = buildCrossAxisScenario({
      taskId: TASK_ID,
      subject: SUBJECT,
      predicate: PREDICATE,
      referenceTime: REFERENCE_TIME,
    });
    const results = runCrossAxisConsumer(scenario);
    const result = evaluateCrossAxisRejection(scenario, results);

    expect(result.rejectionCoverage).toBe(1);
  });

  it("correctReasonRate = 1 (each fact rejected for the right reason)", () => {
    const scenario = buildCrossAxisScenario({
      taskId: TASK_ID,
      subject: SUBJECT,
      predicate: PREDICATE,
      referenceTime: REFERENCE_TIME,
    });
    const results = runCrossAxisConsumer(scenario);
    const result = evaluateCrossAxisRejection(scenario, results);

    expect(result.correctReasonRate).toBe(1);
  });

  it("cleanFactAccepted = true (clean fact is not rejected)", () => {
    const scenario = buildCrossAxisScenario({
      taskId: TASK_ID,
      subject: SUBJECT,
      predicate: PREDICATE,
      referenceTime: REFERENCE_TIME,
    });
    const results = runCrossAxisConsumer(scenario);
    const result = evaluateCrossAxisRejection(scenario, results);

    expect(result.cleanFactAccepted).toBe(true);
  });

  it("invalidated_at_reference_time triggers (Phase 37 expansion)", () => {
    const scenario = buildCrossAxisScenario({
      taskId: TASK_ID,
      subject: SUBJECT,
      predicate: PREDICATE,
      referenceTime: REFERENCE_TIME,
    });
    const results = runCrossAxisConsumer(scenario);
    const result = evaluateCrossAxisRejection(scenario, results);

    const entry = result.perReason.find(
      (entry) => entry.reason === "invalidated_at_reference_time",
    );
    expect(entry).toBeDefined();
    expect(entry!.rejected).toBe(true);
    expect(entry!.correctReason).toBe(true);
  });

  it("subject_mismatch triggers (Phase 37 expansion)", () => {
    const scenario = buildCrossAxisScenario({
      taskId: TASK_ID,
      subject: SUBJECT,
      predicate: PREDICATE,
      referenceTime: REFERENCE_TIME,
    });
    const results = runCrossAxisConsumer(scenario);
    const result = evaluateCrossAxisRejection(scenario, results);

    const entry = result.perReason.find(
      (entry) => entry.reason === "subject_mismatch",
    );
    expect(entry).toBeDefined();
    expect(entry!.rejected).toBe(true);
    expect(entry!.correctReason).toBe(true);
  });

  it("token_budget_exceeded + limit_exceeded trigger (Phase 37 expansion)", () => {
    const scenario = buildCrossAxisScenario({
      taskId: TASK_ID,
      subject: SUBJECT,
      predicate: PREDICATE,
      referenceTime: REFERENCE_TIME,
    });
    const results = runCrossAxisConsumer(scenario);
    const result = evaluateCrossAxisRejection(scenario, results);

    const tokenEntry = result.perReason.find(
      (entry) => entry.reason === "token_budget_exceeded",
    );
    expect(tokenEntry).toBeDefined();
    expect(tokenEntry!.rejected).toBe(true);
    expect(tokenEntry!.correctReason).toBe(true);

    const limitEntry = result.perReason.find(
      (entry) => entry.reason === "limit_exceeded",
    );
    expect(limitEntry).toBeDefined();
    expect(limitEntry!.rejected).toBe(true);
    expect(limitEntry!.correctReason).toBe(true);
  });
});

function runCrossAxisConsumer(
  scenario: readonly CrossAxisFactSpec[],
): RuntimeMemoryHydrationConsumerResult[] {
  const results: RuntimeMemoryHydrationConsumerResult[] = [];
  for (const spec of scenario) {
    const result = consumeRuntimeMemoryHydrationFacts(
      [spec.projection],
      spec.query,
    );
    results.push(result);
  }
  return results;
}
