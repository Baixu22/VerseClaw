// KE-P1-1: task-terminal candidate generation (0-3, failure-guard first)
import { describe, expect, it } from "vitest";
import {
  extractKeErrorSignature,
  generateKeTaskTerminalCandidates,
  type KeTaskTerminalEvidence,
} from "../../openclaw_runtime/src/runtime-core/ke-candidate-generation";

const ENABLED = {
  runtime: { memory: { candidateGeneration: true, shadow: true, proposeFacts: true } },
};
const DISABLED = { runtime: { memory: { candidateGeneration: false } } };

function evidence(overrides: Partial<KeTaskTerminalEvidence> = {}): KeTaskTerminalEvidence {
  return {
    taskId: "task_1",
    taskType: "codegen",
    terminalReason: "completed",
    priorFailureCount: 0,
    userCorrection: false,
    sourceRefs: ["trajectory:task_1", "receipt:task_1"],
    ...overrides,
  };
}

describe("KE-P1-1 candidate generation", () => {
  describe("failure guard (①)", () => {
    it("emits a failure-guard error card on the 2nd repeated failure", () => {
      const result = generateKeTaskTerminalCandidates(ENABLED, evidence({
        terminalReason: "failed",
        error: "Command exited with code 1: npm test failed",
        priorFailureCount: 1,
      }));
      expect(result.failureGuardTriggered).toBe(true);
      expect(result.errorCardProposals).toHaveLength(1);
      expect(result.errorCardProposals[0]!.kind).toBe("error_card");
      expect(result.errorCardProposals[0]!.verificationStatus).toBe("candidate");
    });

    it("emits a failure-guard error card on one explicit user correction", () => {
      const result = generateKeTaskTerminalCandidates(ENABLED, evidence({
        terminalReason: "completed",
        userCorrection: true,
      }));
      expect(result.failureGuardTriggered).toBe(true);
      expect(result.errorCardProposals).toHaveLength(1);
    });

    it("emits zero candidates on a normal success round", () => {
      const result = generateKeTaskTerminalCandidates(ENABLED, evidence({}));
      expect(result.failureGuardTriggered).toBe(false);
      expect(result.factCandidates).toHaveLength(0);
      expect(result.errorCardProposals).toHaveLength(0);
    });

    it("emits zero candidates on a first-time failure (not yet repeated)", () => {
      const result = generateKeTaskTerminalCandidates(ENABLED, evidence({
        terminalReason: "failed",
        error: "first failure",
        priorFailureCount: 0,
      }));
      expect(result.failureGuardTriggered).toBe(false);
      expect(result.errorCardProposals).toHaveLength(0);
    });

    it("caps total candidates at 3", () => {
      const result = generateKeTaskTerminalCandidates(ENABLED, evidence({
        terminalReason: "failed",
        error: "repeated failure",
        priorFailureCount: 1,
        userCorrection: true,
        facts: [
          { subject: "User", predicate: "prefers", objectSummary: "dark mode", source: "human_confirmation" },
          { subject: "User", predicate: "uses", objectSummary: "pnpm", source: "tool_result" },
          { subject: "User", predicate: "rejects", objectSummary: "git add -A", source: "human_confirmation" },
          { subject: "User", predicate: "rejects", objectSummary: "git push", source: "human_confirmation" },
        ],
      }));
      expect(result.factCandidates.length + result.errorCardProposals.length).toBeLessThanOrEqual(3);
    });
  });

  describe("candidate shape (②)", () => {
    it("produces the Envelope fact-path subset with verificationStatus=candidate", () => {
      const result = generateKeTaskTerminalCandidates(ENABLED, evidence({
        terminalReason: "completed",
        facts: [{ subject: "User", predicate: "prefers", objectSummary: "dark mode", source: "human_confirmation" }],
      }));
      expect(result.factCandidates).toHaveLength(1);
      const c = result.factCandidates[0]!;
      expect(c.kind).toBe("fact");
      expect(c.schemaVersion).toBe(1);
      expect(c.verificationStatus).toBe("candidate");
      expect(typeof c.envelopeId).toBe("string");
      expect(typeof c.contentRef).toBe("string");
      expect(Array.isArray(c.sourceRefs)).toBe(true);
      expect(c.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(c.contentVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(typeof c.validity.validAt).toBe("number");
      expect(c.sensitivity).toBe("normal");
      // activationStatus must be absent (candidate => disabled ceiling)
      expect("activationStatus" in c).toBe(false);
    });
  });

  describe("flag gate (③)", () => {
    it("emits zero candidates when the flag is off (fail-closed)", () => {
      const result = generateKeTaskTerminalCandidates(DISABLED, evidence({
        terminalReason: "failed",
        error: "repeated failure",
        priorFailureCount: 1,
      }));
      expect(result.enabled).toBe(false);
      expect(result.disabledReason).toBe("flag_disabled");
      expect(result.factCandidates).toHaveLength(0);
      expect(result.errorCardProposals).toHaveLength(0);
    });
  });

  describe("L4 proposal-only (④)", () => {
    it("marks L4-touching candidates proposalOnly and never mutates policy", () => {
      const result = generateKeTaskTerminalCandidates(ENABLED, evidence({
        terminalReason: "failed",
        error: "system prompt routing needs an approval rule change",
        priorFailureCount: 1,
      }));
      expect(result.errorCardProposals).toHaveLength(1);
      expect(result.errorCardProposals[0]!.proposalOnly).toBe(true);
      // The module is pure: it must not change any config/policy. Re-running
      // with the same inputs is deterministic and returns the same shape.
      const again = generateKeTaskTerminalCandidates(ENABLED, evidence({
        terminalReason: "failed",
        error: "system prompt routing needs an approval rule change",
        priorFailureCount: 1,
      }));
      expect(again).toEqual(result);
    });
  });

  describe("error signature", () => {
    it("is stable for the same failure and distinct for different failures", () => {
      const a = extractKeErrorSignature({ terminalReason: "failed", error: "npm test failed", taskType: "codegen" });
      const b = extractKeErrorSignature({ terminalReason: "failed", error: "npm test failed", taskType: "codegen" });
      const c = extractKeErrorSignature({ terminalReason: "failed", error: "tsc failed", taskType: "codegen" });
      expect(a).toBeDefined();
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });

    it("returns undefined for a completed round", () => {
      expect(extractKeErrorSignature({ terminalReason: "completed", taskType: "codegen" })).toBeUndefined();
    });
  });
});
