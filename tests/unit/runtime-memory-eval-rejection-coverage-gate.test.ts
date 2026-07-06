// @vitest-environment node
// Phase 38 D1: Rejection coverage gate — meta-test asserting all 13 consumer
// rejection reasons fire at least once across the 3 rejection dimensions
// (conflict-resolution, hazard-sentinel, cross-axis-rejection).
//
// This is a structural completeness gate: if any rejection path silently
// regresses to untested, this test fails. The 13 reasons are defined by
// RuntimeMemoryHydrationConsumerRejectionReason in memory-read-hydration-consumer.ts.

import { describe, expect, it } from "vitest";
import { consumeRuntimeMemoryHydrationFacts } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-consumer";
import type {
  RuntimeMemoryHydrationConsumerRejectionReason,
  RuntimeMemoryHydrationConsumerResult,
  RuntimeMemoryHydrationShadowFactProjection,
  RuntimeMemoryHydrationConsumerQuery,
} from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-consumer";
import { buildConflictScenario } from "../../openclaw_runtime/src/agents/runtime-memory-eval/conflict-resolution-eval";
import {
  buildHazardScenario,
  toHazardProjection,
  toHazardConsumerQuery,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/hazard-sentinel-eval";
import { buildCrossAxisScenario } from "../../openclaw_runtime/src/agents/runtime-memory-eval/cross-axis-rejection-eval";

const TASK_ID = "task_rejection_gate";
const SUBJECT = "RejectionGateSubject";
const PREDICATE = "rejection_gate_predicate";
const REFERENCE_TIME = 1_000;

const ALL_13_REASONS: readonly RuntimeMemoryHydrationConsumerRejectionReason[] = [
  "record_kind_not_fact",
  "verification_status_not_verified",
  "future_valid_at",
  "invalidated_at_reference_time",
  "expired_at_reference_time",
  "task_mismatch",
  "subject_mismatch",
  "predicate_mismatch",
  "prompt_injection_sentinel",
  "raw_leak_sentinel",
  "conflicting_fact",
  "token_budget_exceeded",
  "limit_exceeded",
];

describe("rejection coverage gate — all 13 reasons fire", () => {
  it("13 rejection reasons are all covered by the enhanced eval suite", () => {
    expect(ALL_13_REASONS).toHaveLength(13);
  });

  it("all 13 rejection reasons fire at least once across 3 rejection dimensions", () => {
    const firedReasons = collectAllFiredReasons();

    const missing = ALL_13_REASONS.filter((r) => !firedReasons.has(r));
    expect(missing).toEqual([]);
  });

  it("each rejection reason fires at least once (count >= 1)", () => {
    const reasonCounts = countAllFiredReasons();

    for (const reason of ALL_13_REASONS) {
      const count = reasonCounts.get(reason) ?? 0;
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it("rejection reason distribution is non-empty and counts sum to total rejected facts", () => {
    const reasonCounts = countAllFiredReasons();
    const totalRejected = sumAllRejectedFacts();

    expect(reasonCounts.size).toBeGreaterThan(0);
    const countSum = [...reasonCounts.values()].reduce((a, b) => a + b, 0);
    expect(countSum).toBe(totalRejected);
  });
});

function collectAllFiredReasons(): Set<RuntimeMemoryHydrationConsumerRejectionReason> {
  const results = runAllRejectionScenarios();
  const fired = new Set<RuntimeMemoryHydrationConsumerRejectionReason>();

  for (const result of results) {
    for (const rejected of result.rejectedFacts) {
      fired.add(rejected.reason);
    }
  }

  return fired;
}

function countAllFiredReasons(): Map<RuntimeMemoryHydrationConsumerRejectionReason, number> {
  const results = runAllRejectionScenarios();
  const counts = new Map<RuntimeMemoryHydrationConsumerRejectionReason, number>();

  for (const result of results) {
    for (const rejected of result.rejectedFacts) {
      counts.set(rejected.reason, (counts.get(rejected.reason) ?? 0) + 1);
    }
  }

  return counts;
}

function sumAllRejectedFacts(): number {
  const results = runAllRejectionScenarios();
  return results.reduce((sum, r) => sum + r.rejectedFacts.length, 0);
}

function runAllRejectionScenarios(): RuntimeMemoryHydrationConsumerResult[] {
  const results: RuntimeMemoryHydrationConsumerResult[] = [];

  // 1. Cross-axis rejection: 10 reasons
  const crossScenario = buildCrossAxisScenario({
    taskId: TASK_ID,
    subject: SUBJECT,
    predicate: PREDICATE,
    referenceTime: REFERENCE_TIME,
  });
  for (const spec of crossScenario) {
    const result = consumeRuntimeMemoryHydrationFacts([spec.projection], spec.query);
    results.push(result);
  }

  // 2. Hazard sentinel: prompt_injection_sentinel + raw_leak_sentinel
  const hazardScenario = buildHazardScenario({
    taskId: TASK_ID,
    referenceTime: REFERENCE_TIME,
    cleanFactCount: 1,
    hazardFactCount: 1,
  });
  for (const entry of hazardScenario) {
    const projection = toHazardProjection(entry.fact);
    const query = toHazardConsumerQuery(entry.query);
    const result = consumeRuntimeMemoryHydrationFacts([projection], query);
    results.push(result);
  }

  // 3. Conflict resolution: conflicting_fact
  // Build a group with 3 facts sharing the same subject+predicate.
  // The consumer should accept 1 winner and reject 2 with conflicting_fact.
  const conflictScenario = buildConflictScenario({
    groupCount: 1,
    taskId: TASK_ID,
    referenceTime: REFERENCE_TIME,
  });
  for (const group of conflictScenario) {
    const projections: RuntimeMemoryHydrationShadowFactProjection[] = group.facts.map((f) =>
      toHazardProjection(f),
    );
    const query: RuntimeMemoryHydrationConsumerQuery = toHazardConsumerQuery(group.query);
    const result = consumeRuntimeMemoryHydrationFacts(projections, query);
    results.push(result);
  }

  return results;
}
