// @vitest-environment node
// S07: bounded, revocable verifier completion-verdict entry.
import { describe, expect, it } from "vitest";

import { buildEvidenceVerifierInputFixture } from "./evidence-verifier.js";
import {
  resolveVerifierCompletionVerdict,
  revokeVerifierCompletionVerdict,
  verifierCompletionTransition,
  type VerifierCompletionScope,
} from "./verifier-completion-verdict.js";

const scope: VerifierCompletionScope = { taskIds: ["task_1"] };

describe("S07 verifier completion verdict", () => {
  it("approves a completed task with the canonical evidence and produces one node->done transition", () => {
    const record = resolveVerifierCompletionVerdict({
      input: buildEvidenceVerifierInputFixture(),
      scope,
      priorStatus: "doing",
    });
    expect(record.verdict).toBe("approved");
    expect(record.taskId).toBe("task_1");
    expect(record.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(verifierCompletionTransition(record)).toEqual({ nodeId: "task_1", from: "doing", to: "done" });
  });

  it("is digest-only and grants no publish / product-lock authority", () => {
    const record = resolveVerifierCompletionVerdict({ input: buildEvidenceVerifierInputFixture(), scope, priorStatus: "review" });
    expect(record.grantsPublish).toBe(false);
    expect(record.grantsProductLock).toBe(false);
    const serialized = JSON.stringify(record);
    for (const forbidden of ["publish", "release", "productLock", "lockValue", "content", "summary"]) {
      // only the explicit grantsPublish/grantsProductLock flags may mention the words
      if (forbidden === "productLock" || forbidden === "publish") continue;
      expect(serialized.includes(forbidden), `${forbidden} must not appear in the verdict record`).toBe(false);
    }
    expect(Object.keys(record).sort()).toEqual(["evidenceDigest", "findingCodes", "grantsProductLock", "grantsPublish", "priorStatus", "taskId", "verdict"]);
  });

  it("returns insufficient-evidence and no transition when evidence is missing", () => {
    const record = resolveVerifierCompletionVerdict({
      input: buildEvidenceVerifierInputFixture({ evidenceRefs: [], toolResults: [], eventReplay: { status: "consistent", diagnosticCodes: [], pendingToolCallIds: [] } }),
      scope,
      priorStatus: "doing",
    });
    expect(record.verdict).toBe("insufficient-evidence");
    expect(verifierCompletionTransition(record)).toBeNull();
    expect(revokeVerifierCompletionVerdict(record)).toBeNull();
  });

  it("is bounded: a task outside the granted scope gets no verdict and no transition", () => {
    const record = resolveVerifierCompletionVerdict({
      input: buildEvidenceVerifierInputFixture({ taskId: "task_not_granted" }),
      scope,
      priorStatus: "doing",
    });
    expect(record.verdict).toBe("out-of-scope");
    expect(record.findingCodes).toEqual([]);
    expect(verifierCompletionTransition(record)).toBeNull();
  });

  it("is revocable: revocation restores the recorded prior status", () => {
    const record = resolveVerifierCompletionVerdict({ input: buildEvidenceVerifierInputFixture(), scope, priorStatus: "review" });
    expect(revokeVerifierCompletionVerdict(record)).toEqual({ nodeId: "task_1", from: "done", to: "review" });
  });

  it("is deterministic: the same evidence yields the same digest (replay-safe)", () => {
    const a = resolveVerifierCompletionVerdict({ input: buildEvidenceVerifierInputFixture(), scope, priorStatus: "doing" });
    const b = resolveVerifierCompletionVerdict({ input: buildEvidenceVerifierInputFixture(), scope, priorStatus: "doing" });
    expect(a.evidenceDigest).toBe(b.evidenceDigest);
    expect(a).toEqual(b);
  });
});