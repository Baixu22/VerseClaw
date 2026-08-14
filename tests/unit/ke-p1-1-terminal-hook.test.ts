// KE-P1-1: terminal evidence extraction + hook (maps real terminal state, not model self-report)
import { describe, expect, it } from "vitest";
import {
  buildKeCandidateGenerationDiagnostics,
  buildKeTaskTerminalEvidence,
  mapTaskLoopStatusToTerminalReason,
  runKeCandidateGenerationForTerminal,
} from "../../openclaw_runtime/src/runtime-core/ke-candidate-generation";

const ENABLED = {
  runtime: { memory: { candidateGeneration: true, shadow: true, proposeFacts: true } },
};
const DISABLED = { runtime: { memory: { candidateGeneration: false } } };

describe("KE-P1-1 terminal evidence extraction + hook", () => {
  it("maps TaskLoop terminal status to the terminal-reason vocabulary", () => {
    expect(mapTaskLoopStatusToTerminalReason("complete")).toBe("completed");
    expect(mapTaskLoopStatusToTerminalReason("error")).toBe("failed");
    expect(mapTaskLoopStatusToTerminalReason("blocked")).toBe("blocked");
    expect(mapTaskLoopStatusToTerminalReason("cancelled")).toBe("cancelled");
    // Fail-closed: unknown status is treated as failure, never success.
    expect(mapTaskLoopStatusToTerminalReason("weird")).toBe("failed");
  });

  it("builds evidence from real terminal state with safe defaults", () => {
    const evidence = buildKeTaskTerminalEvidence({
      taskId: "loop_1",
      status: "error",
      error: "command exited 1",
      sourceRefs: ["task-loop:loop_1:error:error"],
      now: 1234,
    });
    expect(evidence.taskId).toBe("loop_1");
    expect(evidence.taskType).toBe("task_loop");
    expect(evidence.terminalReason).toBe("failed");
    expect(evidence.error).toBe("command exited 1");
    expect(evidence.priorFailureCount).toBe(0);
    expect(evidence.userCorrection).toBe(false);
    expect(evidence.now).toBe(1234);
  });

  it("flag off => disabled run, zero behavior", () => {
    const run = runKeCandidateGenerationForTerminal(DISABLED, {
      taskId: "loop_1",
      status: "error",
      error: "command exited 1",
      sourceRefs: ["task-loop:loop_1:error:error"],
    });
    expect(run.enabled).toBe(false);
    expect(run.disabledReason).toBe("flag_disabled");
    expect(run.factCandidates).toHaveLength(0);
    expect(run.errorCardProposals).toHaveLength(0);
  });

  it("flag on + repeated failure => error-card candidate (failure guard)", () => {
    const run = runKeCandidateGenerationForTerminal(ENABLED, {
      taskId: "loop_1",
      status: "error",
      error: "command exited 1",
      priorFailureCount: 1,
      sourceRefs: ["task-loop:loop_1:error:error"],
    });
    expect(run.enabled).toBe(true);
    expect(run.errorCardProposals).toHaveLength(1);
    expect(run.errorCardProposals[0]!.kind).toBe("error_card");
    expect(run.errorCardProposals[0]!.verificationStatus).toBe("candidate");
    // Candidates are never auto-persisted through the shadow.
    expect(run.proposalShadow.acceptedFacts).toHaveLength(0);
  });

  it("flag on + successful round => zero candidates", () => {
    const run = runKeCandidateGenerationForTerminal(ENABLED, {
      taskId: "loop_1",
      status: "complete",
      sourceRefs: ["task-loop:loop_1:complete:complete"],
    });
    expect(run.enabled).toBe(true);
    expect(run.factCandidates).toHaveLength(0);
    expect(run.errorCardProposals).toHaveLength(0);
  });

  it("builds a content-light diagnostic from a run", () => {
    const run = runKeCandidateGenerationForTerminal(ENABLED, {
      taskId: "loop_1",
      status: "error",
      error: "command exited 1",
      priorFailureCount: 1,
      sourceRefs: ["task-loop:loop_1:error:error"],
    });
    const diag = buildKeCandidateGenerationDiagnostics(run);
    expect(diag.enabled).toBe(true);
    expect(diag.errorCardProposalCount).toBe(1);
    expect(diag.failureGuardTriggered).toBe(true);
    expect(diag.envelopeIds.length).toBeGreaterThan(0);
    expect(diag.envelopeIds[0]).toMatch(/^error_card:/);
  });
});
