import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVIDENCE_VERIFIER_FEATURE_FLAGS,
  DEFAULT_EVIDENCE_VERIFIER_REQUIRED_EVIDENCE_KINDS,
  EVIDENCE_VERIFIER_DECISIONS,
  EVIDENCE_VERIFIER_EVIDENCE_KINDS,
  EVIDENCE_VERIFIER_FINDING_CATEGORIES,
  EVIDENCE_VERIFIER_FINDING_CODES,
  EVIDENCE_VERIFIER_FINDING_SEVERITIES,
  EVIDENCE_VERIFIER_FLAG_PATHS,
  buildEvidenceRefFixture,
  buildEvidenceVerifierInputFixture,
  buildToolCallResultFixture,
  evaluateEvidenceVerifier,
  evidenceVerifierFlagEnabled,
  isEvidenceVerifierInput,
  isEvidenceVerifierReport,
  resolveEvidenceVerifierFeatureFlags,
  type EvidenceVerifierEvidenceKind,
  type EvidenceVerifierInput,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime evidence verifier contracts", () => {
  it("defines canonical evidence kinds, decisions, finding taxonomy, and default-off flags", () => {
    expect(EVIDENCE_VERIFIER_EVIDENCE_KINDS).toEqual([
      "file",
      "test",
      "tool",
      "trace",
      "human",
    ]);
    expect(EVIDENCE_VERIFIER_DECISIONS).toEqual([
      "completed",
      "failed",
      "blocked",
      "cancelled",
      "insufficient_evidence",
    ]);
    expect(EVIDENCE_VERIFIER_FINDING_SEVERITIES).toEqual([
      "info",
      "warning",
      "error",
    ]);
    expect(EVIDENCE_VERIFIER_FINDING_CATEGORIES).toEqual([
      "contract",
      "obligation",
      "evidence",
      "tool",
      "event_replay",
      "external_dependency",
      "cancellation",
    ]);
    expect(EVIDENCE_VERIFIER_FINDING_CODES).toEqual(
      expect.arrayContaining([
        "missing_file_evidence",
        "missing_test_evidence",
        "missing_tool_evidence",
        "tool_result_error",
        "external_dependency_blocked",
        "blocked_without_external_dependency",
      ]),
    );
    expect(DEFAULT_EVIDENCE_VERIFIER_REQUIRED_EVIDENCE_KINDS).toEqual([
      "file",
      "test",
      "tool",
    ]);
    expect(EVIDENCE_VERIFIER_FLAG_PATHS).toEqual({
      shadow: "runtime.evidenceVerifier.shadow",
      pilot: "runtime.evidenceVerifier.pilot",
    });
    expect(DEFAULT_EVIDENCE_VERIFIER_FEATURE_FLAGS).toEqual({
      shadow: false,
      pilot: false,
    });
    expect(resolveEvidenceVerifierFeatureFlags({})).toEqual({
      shadow: false,
      pilot: false,
    });
    expect(resolveEvidenceVerifierFeatureFlags({
      runtime: { evidenceVerifier: { shadow: true, pilot: true, gate: true } },
    })).toEqual({
      shadow: true,
      pilot: true,
    });
    expect(evidenceVerifierFlagEnabled({}, "shadow")).toBe(false);
  });

  it("validates verifier input and report shapes", () => {
    const input = buildEvidenceVerifierInputFixture();
    const report = evaluateEvidenceVerifier(input);

    expect(isEvidenceVerifierInput(input)).toBe(true);
    expect(isEvidenceVerifierInput({ ...input, taskId: "" })).toBe(false);
    expect(isEvidenceVerifierInput({ ...input, eventReplay: undefined })).toBe(false);
    expect(isEvidenceVerifierReport(report)).toBe(true);
    expect(report).toMatchObject({
      taskId: "task_1",
      decision: "completed",
      findings: [],
      legacyDecisionUnaffected: true,
    });

    const invalidReport = evaluateEvidenceVerifier({ taskId: "task_bad" });
    expect(isEvidenceVerifierReport(invalidReport)).toBe(true);
    expect(invalidReport).toMatchObject({
      taskId: "task_bad",
      decision: "failed",
      findings: [{ code: "invalid_verifier_input", category: "contract" }],
      legacyDecisionUnaffected: true,
    });
  });

  it("maps deterministic decisions for completed, failed, cancelled, and replay gaps", () => {
    expect(evaluateEvidenceVerifier(buildEvidenceVerifierInputFixture()).decision)
      .toBe("completed");

    const failed = evaluateEvidenceVerifier(buildEvidenceVerifierInputFixture({
      toolResults: [
        buildToolCallResultFixture({
          callId: "tool_error",
          status: "error",
          evidence: [buildEvidenceRefFixture({ type: "tool", ref: "tool_error" })],
        }),
      ],
    }));
    expect(failed).toMatchObject({
      decision: "failed",
      findings: [{ code: "tool_result_error", category: "tool" }],
    });

    const cancelled = evaluateEvidenceVerifier(buildEvidenceVerifierInputFixture({
      toolResults: [
        buildToolCallResultFixture({
          callId: "tool_cancelled",
          status: "cancelled",
          evidence: [buildEvidenceRefFixture({ type: "tool", ref: "tool_cancelled" })],
        }),
      ],
    }));
    expect(cancelled).toMatchObject({
      decision: "cancelled",
      findings: [{ code: "tool_result_cancelled", category: "cancellation" }],
    });

    const replayMissing = evaluateEvidenceVerifier(buildEvidenceVerifierInputFixture({
      eventReplay: {
        status: "not_run",
        state: "unknown",
        diagnosticCodes: [],
        pendingToolCallIds: [],
      },
    }));
    expect(replayMissing).toMatchObject({
      decision: "insufficient_evidence",
      findings: [{ code: "event_replay_not_run", category: "event_replay" }],
    });

    const replayFailed = evaluateEvidenceVerifier(buildEvidenceVerifierInputFixture({
      eventReplay: {
        status: "inconsistent",
        state: "failed",
        diagnosticCodes: ["duplicate_event_id"],
        pendingToolCallIds: [],
      },
    }));
    expect(replayFailed).toMatchObject({
      decision: "failed",
      findings: [{ code: "event_replay_inconsistent", category: "event_replay" }],
    });
  });

  it("allows blocked only for explicit external dependencies", () => {
    const externalBlocked = evaluateEvidenceVerifier(buildEvidenceVerifierInputFixture({
      obligations: [
        {
          id: "external_api",
          description: "Wait for an external service credential.",
          status: "blocked",
          externalDependency: true,
          evidenceRefs: [buildEvidenceRefFixture({ type: "human", ref: "user_waiting" })],
        },
      ],
    }));
    expect(externalBlocked).toMatchObject({
      decision: "blocked",
      findings: [
        {
          code: "external_dependency_blocked",
          category: "external_dependency",
        },
      ],
    });

    const ordinaryFailure = evaluateEvidenceVerifier(buildEvidenceVerifierInputFixture({
      obligations: [
        {
          id: "unit_test_failure",
          description: "Fix the failing unit test.",
          status: "blocked",
          externalDependency: false,
        },
      ],
    }));
    expect(ordinaryFailure).toMatchObject({
      decision: "failed",
      findings: [
        {
          code: "blocked_without_external_dependency",
          category: "obligation",
        },
      ],
    });
  });

  it.each([
    ["file", "missing_file_evidence"],
    ["test", "missing_test_evidence"],
    ["tool", "missing_tool_evidence"],
  ] as const)(
    "returns insufficient evidence when %s evidence refs are missing",
    (kind, code) => {
      const input = withoutEvidenceKind(buildEvidenceVerifierInputFixture(), kind);
      const report = evaluateEvidenceVerifier(input);

      expect(report.decision).toBe("insufficient_evidence");
      expect(report.findings.map((finding) => finding.code)).toContain(code);
    },
  );

  it("does not mutate verifier inputs or retain live evidence references", () => {
    const input = buildEvidenceVerifierInputFixture({
      metadata: { caller: "contract-test" },
    });
    const before = JSON.stringify(input);
    deepFreeze(input);

    const report = evaluateEvidenceVerifier(input);

    expect(JSON.stringify(input)).toBe(before);
    expect(report.decision).toBe("completed");
    expect(report.evidenceRefs[0]).not.toBe(input.evidenceRefs[0]);
    expect(report.legacyDecisionUnaffected).toBe(true);
  });
});

function withoutEvidenceKind(
  input: EvidenceVerifierInput,
  kind: EvidenceVerifierEvidenceKind,
): EvidenceVerifierInput {
  return {
    ...input,
    evidenceRefs: input.evidenceRefs.filter((ref) => ref.type !== kind),
    toolResults: input.toolResults.map((result) => ({
      ...result,
      evidence: result.evidence.filter((ref) => ref.type !== kind),
    })),
    obligations: input.obligations.map((obligation) => {
      const evidenceRefs = obligation.evidenceRefs?.filter((ref) => ref.type !== kind);
      return {
        ...obligation,
        ...(evidenceRefs ? { evidenceRefs } : {}),
      };
    }),
  };
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") {
    return value;
  }
  Object.freeze(value);
  for (const property of Object.getOwnPropertyNames(value)) {
    const child = (value as Record<string, unknown>)[property];
    if (child && typeof child === "object" && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}
