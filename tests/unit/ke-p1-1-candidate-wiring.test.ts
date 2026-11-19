// KE-P1-1: proposeFacts wiring (candidates -> shadow, never auto-persisted)
import { describe, expect, it } from "vitest";
import { assertRuntimeMemoryOwnerConvergence } from "../../openclaw_runtime/src/agents/slot-convergence";
import { buildKeFactProposalInputs, runKeCandidateGeneration } from "../../openclaw_runtime/src/runtime-core/ke-candidate-generation";
import { sanitizeRuntimeMemoryFactProposalInput } from "../../openclaw_runtime/src/runtime-core/memory-proposal-shadow";

const ENABLED = {
  runtime: { memory: { candidateGeneration: true, shadow: true, proposeFacts: true } },
};
const DISABLED = { runtime: { memory: { candidateGeneration: false } } };

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task_1",
    taskType: "codegen",
    terminalReason: "completed",
    priorFailureCount: 0,
    userCorrection: false,
    sourceRefs: ["trajectory:task_1", "receipt:task_1"],
    facts: [
      { subject: "User", predicate: "prefers", objectSummary: "dark mode", source: "human_confirmation" },
    ],
    ...overrides,
  };
}

describe("KE-P1-1 proposeFacts wiring", () => {
  it("flag off => zero candidates and zero shadow inputs (fail-closed)", () => {
    const run = runKeCandidateGeneration(DISABLED, evidence());
    expect(run.enabled).toBe(false);
    expect(run.disabledReason).toBe("flag_disabled");
    expect(run.factCandidates).toHaveLength(0);
    expect(run.errorCardProposals).toHaveLength(0);
    expect(run.proposalShadow.candidates).toHaveLength(0);
    expect(run.proposalShadow.acceptedFacts).toHaveLength(0);
  });

  it("flag on stages candidates while the retired proposeFacts shadow stays readonly and disabled", () => {
    const run = runKeCandidateGeneration(ENABLED, evidence());
    expect(run.enabled).toBe(true);
    expect(run.proposalShadow.enabled).toBe(false);
    expect(run.proposalShadow.disabledReason).toBe("runtime_memory_flags_disabled");
    expect(run.proposalShadow.proposalOnly).toBe(true);
    expect(run.proposalShadow.readonly).toBe(true);
    expect(run.factCandidates.length).toBeGreaterThan(0);
    expect(run.factCandidates[0]!.verificationStatus).toBe("candidate");
    expect(run.proposalShadow.candidates).toHaveLength(0);
    // Never auto-persisted: acceptedFacts is always empty.
    expect(run.proposalShadow.acceptedFacts).toHaveLength(0);
  });

  it("never auto-persists: acceptedFacts empty for every enabled run (zero-write guard)", () => {
    const run = runKeCandidateGeneration(ENABLED, evidence({
      facts: [
        { subject: "User", predicate: "prefers", objectSummary: "dark mode", source: "human_confirmation" },
        { subject: "User", predicate: "uses", objectSummary: "pnpm", source: "tool_result" },
      ],
    }));
    expect(run.factCandidates.length).toBeGreaterThan(0);
    expect(run.proposalShadow.candidates).toHaveLength(0);
    // The single write authority (appendFact) is only reachable after human
    // promotion; the shadow must never surface an accepted fact by itself.
    expect(run.proposalShadow.acceptedFacts).toHaveLength(0);
  });

  it("census: candidate generation keeps the single owner (no parallel writer)", () => {
    // Flag-off config leaves persist=false, so the owner-convergence census
    // reports zero parallel writers (zero durable writes). This is the KE-P1-1
    // zero-write census gate: persist=true would trip the fail-closed guard.
    expect(assertRuntimeMemoryOwnerConvergence({ runtimeMemoryPersist: false })).toEqual({
      ok: true,
      errors: [],
    });
    // The fail-closed guard rejects the second durable authority when persist
    // is turned on (R3-1 E-1 ruling) — proving the guard sees red on drift.
    expect(assertRuntimeMemoryOwnerConvergence({ runtimeMemoryPersist: true }).ok).toBe(false);
  });

  it("rejects an unsupported fact source (fail-closed, not silent)", () => {
    const run = runKeCandidateGeneration(ENABLED, evidence({
      facts: [
        { subject: "User", predicate: "prefers", objectSummary: "dark mode", source: "not_a_source" },
      ],
    }));
    expect(run.proposalShadow.candidates).toHaveLength(0);
    const rejected = sanitizeRuntimeMemoryFactProposalInput(buildKeFactProposalInputs(evidence({
      facts: [{ subject: "User", predicate: "prefers", objectSummary: "dark mode", source: "not_a_source" }],
    }))[0]);
    expect(rejected).toMatchObject({ accepted: false, reason: "unsupported_source" });
  });
});
