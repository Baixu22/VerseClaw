// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequestAttemptBudget } from "../../openclaw_runtime/src/agents/request-attempt-budget";

// Semantic convergence RETRY-1 contract.
// This test was written to fail on the pre-TF-0729 implementation:
// `physicalAttempt` was derived from the reversible `usedCount`, so a successful
// attempt freed the counter and the next attempt reused the same identity.
// After TF-0729 it must pass unchanged.
describe("attempt identity is independent from retry budget", () => {
  it("does not reuse an identity after a successful attempt releases budget", () => {
    const budget = createRequestAttemptBudget({ logicalRequestId: "retry-identity", maxPhysicalAttempts: 2 });
    const first = budget.tryRecordAttempt({ layer: "first", outcome: "failure" });
    expect(first).toBeDefined();
    budget.completeAttempt(first!, "success");
    const second = budget.tryRecordAttempt({ layer: "second", outcome: "failure" });
    expect(second).not.toBe(first);
    const records = budget.snapshot().attempts;
    expect(new Set(records.map((record) => record.physicalAttempt)).size).toBe(records.length);
  });

  it("keeps the first success record when a later attempt fails", () => {
    const budget = createRequestAttemptBudget({ logicalRequestId: "retry-identity-2", maxPhysicalAttempts: 2 });
    const first = budget.tryRecordAttempt({ layer: "first" });
    budget.completeAttempt(first!, "success");
    const second = budget.tryRecordAttempt({ layer: "second" });
    budget.completeAttempt(second!, "failure");
    const records = budget.snapshot().attempts;
    expect(records.find((record) => record.layer === "first")?.outcome).toBe("success");
    expect(records.find((record) => record.layer === "second")?.outcome).toBe("failure");
  });

  it("makes completeAttempt idempotent", () => {
    const budget = createRequestAttemptBudget({ logicalRequestId: "retry-idempotent", maxPhysicalAttempts: 2 });
    const first = budget.tryRecordAttempt({ layer: "only" });
    budget.completeAttempt(first!, "success");
    budget.completeAttempt(first!, "success");
    expect(budget.snapshot().used).toBe(0);
    expect(budget.snapshot().attempts).toHaveLength(1);
  });
});


