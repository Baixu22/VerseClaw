/**
 * Lock-in tests for the evidence verifier (shadow/pilot gating).
 *
 * The verifier is a real evaluation pipeline wired into task-loop evidence
 * collection, but its OUTPUT is gated: shadow/pilot flags default off, so it
 * must not change task completion decisions unless explicitly enabled. These
 * tests pin both properties so the gate cannot silently flip.
 */
import { describe, expect, it } from "vitest";
import {
  buildEvidenceVerifierInputFixture,
  DEFAULT_EVIDENCE_VERIFIER_FEATURE_FLAGS,
  evaluateEvidenceVerifier,
  EVIDENCE_VERIFIER_FLAG_PATHS,
  type EvidenceVerifierPolicy,
} from "./evidence-verifier.js";
import { evaluateCollectedEvidenceVerifier } from "./evidence-verifier-collectors.js";

describe("evidence verifier shadow/pilot gating", () => {
  it("keeps shadow and pilot flags off by default (no production injection)", () => {
    expect(DEFAULT_EVIDENCE_VERIFIER_FEATURE_FLAGS).toEqual({
      shadow: false,
      pilot: false,
    });
    expect(EVIDENCE_VERIFIER_FLAG_PATHS).toEqual({
      shadow: "runtime.evidenceVerifier.shadow",
      pilot: "runtime.evidenceVerifier.pilot",
    });
  });

  it("completes a task with the canonical fixture (all evidence kinds present)", () => {
    const report = evaluateEvidenceVerifier(buildEvidenceVerifierInputFixture());
    expect(report.decision).toBe("completed");
    expect(report.findings).toEqual([]);
  });

  it("reports insufficient evidence when required kinds are missing", () => {
    const report = evaluateEvidenceVerifier(
      buildEvidenceVerifierInputFixture({
        evidenceRefs: [],
        obligations: [],
        toolResults: [],
      }),
      { requiredEvidenceKinds: ["file", "test", "tool"] },
    );
    expect(report.decision).toBe("insufficient_evidence");
    expect(report.findings.some((f) => f.category === "evidence")).toBe(true);
  });

  it("respects policy overrides for required evidence kinds", () => {
    const policy: EvidenceVerifierPolicy = { requiredEvidenceKinds: ["file"] };
    const report = evaluateEvidenceVerifier(
      buildEvidenceVerifierInputFixture({
        evidenceRefs: [{
          type: "file",
          ref: "src/example.ts",
          label: "file evidence",
        }],
        obligations: [],
        toolResults: [],
      }),
      policy,
    );
    expect(report.requiredEvidenceKinds).toEqual(["file"]);
    expect(report.decision).toBe("completed");
  });

  it("collects evidence through the task-loop bridge without changing legacy decisions", () => {
    const report = evaluateCollectedEvidenceVerifier({
      taskId: "t1",
      objective: "Implement feature",
      taskLoop: {
        filesTouched: ["src/a.ts"],
        testsRun: ["pnpm test"],
        evidenceRefs: [{ type: "tool", ref: "tool:1", label: "tool result" }],
        source: "task_loop",
      },
      toolResults: [
        { callId: "tool:1", status: "success", evidence: [{ type: "tool", ref: "tool:1" }] },
      ],
      eventReplay: {
        status: "consistent",
        state: "completed",
        diagnosticCodes: [],
        pendingToolCallIds: [],
        evidenceRefCount: 3,
      },
    });
    expect(report.decision).toBe("completed");
    // Shadow mode: report never claims to affect the legacy decision.
    expect(report.legacyDecisionUnaffected).toBe(true);
  });
});
