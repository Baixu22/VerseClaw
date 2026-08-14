// KE-P1-1: error-card -> knowledge-inbox draft adapter (runtime -> electron bridge seam).
import { describe, expect, it } from "vitest";
import {
  buildKeErrorCardInboxDraft,
  buildKeErrorCardInboxDrafts,
  generateKeTaskTerminalCandidates,
} from "../../openclaw_runtime/src/runtime-core/ke-candidate-generation";

const ENABLED = { runtime: { memory: { candidateGeneration: true, shadow: true, proposeFacts: true } } };

describe("KE-P1-1 error-card inbox draft adapter", () => {
  it("maps a failure-guard error card into a content-light inbox draft", () => {
    const result = generateKeTaskTerminalCandidates(ENABLED, {
      taskId: "task_1",
      taskType: "codegen",
      terminalReason: "failed",
      error: "command exited 1",
      priorFailureCount: 1,
      userCorrection: false,
      sourceRefs: ["task-loop:loop-1:error:error"],
    });
    expect(result.errorCardProposals).toHaveLength(1);
    const draft = buildKeErrorCardInboxDraft(result.errorCardProposals[0]!);
    expect(draft.kind).toBe("task-ledger");
    expect(draft.type).toBe("troubleshooting");
    expect(draft.title).toContain("repeated failure");
    expect(draft.sourceIds).toContain("task-loop:loop-1:error:error");
    expect(draft.metadata.envelopeId).toMatch(/^error_card:/);
    expect(draft.metadata.verificationStatus).toBe("candidate");
  });

  it("marks L4-touching error cards proposal-only (never auto-apply)", () => {
    const result = generateKeTaskTerminalCandidates(ENABLED, {
      taskId: "task_1",
      taskType: "codegen",
      terminalReason: "failed",
      error: "system prompt routing needs an approval rule change",
      priorFailureCount: 1,
      userCorrection: false,
      sourceRefs: ["task-loop:loop-1:error:error"],
    });
    const drafts = buildKeErrorCardInboxDrafts(result.errorCardProposals);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.tags).toContain("l4-proposal-only");
    expect(drafts[0]!.warnings).toContain("L4 proposal-only: never auto-apply");
    expect(drafts[0]!.metadata.proposalOnly).toBe(true);
  });
});
