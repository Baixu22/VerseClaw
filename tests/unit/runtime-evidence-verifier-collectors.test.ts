import { describe, expect, it } from "vitest";
import {
  buildEvidenceRefFixture,
  buildRuntimeTaskEventFixture,
  buildToolCallResultFixture,
  collectEvidenceVerifierInput,
  evaluateCollectedEvidenceVerifier,
  evaluateEvidenceVerifier,
  replayRuntimeTaskEvents,
  type EvidenceVerifierCollectionInput,
} from "../../openclaw_runtime/src/runtime-core";

const consistentReplay = {
  status: "consistent" as const,
  state: "completed" as const,
  diagnosticCodes: [],
  pendingToolCallIds: [],
  evidenceRefCount: 5,
};

function baseInput(overrides: Partial<EvidenceVerifierCollectionInput> = {}): EvidenceVerifierCollectionInput {
  return {
    taskId: "task_collectors",
    objective: "Collect deterministic verifier evidence.",
    taskLoop: {
      filesTouched: ["openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts"],
      testsRun: ["vitest tests/unit/runtime-evidence-verifier-collectors.test.ts"],
    },
    toolResults: [
      buildToolCallResultFixture({
        callId: "tool_collectors",
        evidence: [buildEvidenceRefFixture({ type: "tool", ref: "tool_collectors" })],
      }),
    ],
    eventReplay: consistentReplay,
    ...overrides,
  };
}

describe("runtime evidence verifier collectors", () => {
  it("normalizes file, test, tool, trace, and human evidence into verifier input", () => {
    const collected = collectEvidenceVerifierInput(baseInput({
      trace: { traceId: "trace_collectors", spanId: "span_collectors" },
      humanEvidenceRefs: [
        buildEvidenceRefFixture({ type: "human", ref: "reviewer-confirmed" }),
      ],
    }));
    const report = evaluateEvidenceVerifier(collected.input, {
      requiredEvidenceKinds: ["file", "test", "tool", "trace", "human"],
    });

    expect(collected.diagnostics).toEqual([]);
    expect(collected.projectedEvidenceRefs).toEqual([]);
    expect(collected.input.evidenceRefs.map((ref) => `${ref.type}:${ref.ref}`))
      .toEqual(expect.arrayContaining([
        "file:openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts",
        "test:vitest tests/unit/runtime-evidence-verifier-collectors.test.ts",
        "trace:trace_collectors",
        "human:reviewer-confirmed",
      ]));
    expect(collected.input.toolResults[0]?.evidence).toEqual([
      expect.objectContaining({ type: "tool", ref: "tool_collectors" }),
    ]);
    expect(JSON.stringify(collected.input)).not.toContain("raw-prompt");
    expect(report.decision).toBe("completed");
  });

  it("returns insufficient evidence when test evidence is missing", () => {
    const report = evaluateCollectedEvidenceVerifier(baseInput({
      taskLoop: {
        filesTouched: ["openclaw_runtime/src/runtime-core/evidence-verifier-collectors.ts"],
      },
    }));

    expect(report).toMatchObject({
      decision: "insufficient_evidence",
      findings: [expect.objectContaining({ code: "missing_test_evidence" })],
    });
  });

  it("fails when a collected tool result reports an error", () => {
    const report = evaluateCollectedEvidenceVerifier(baseInput({
      toolResults: [
        buildToolCallResultFixture({
          callId: "tool_error",
          status: "error",
          evidence: [buildEvidenceRefFixture({ type: "tool", ref: "tool_error" })],
        }),
      ],
    }));

    expect(report).toMatchObject({
      decision: "failed",
      findings: [expect.objectContaining({ code: "tool_result_error" })],
    });
  });

  it("blocks only when an explicit external dependency is present", () => {
    const report = evaluateCollectedEvidenceVerifier(baseInput({
      externalDependencies: [
        {
          id: "vendor_access",
          description: "Wait for the user to grant access to the external vendor account.",
          evidenceRefs: [buildEvidenceRefFixture({ type: "human", ref: "user-waiting" })],
        },
      ],
    }));

    expect(report).toMatchObject({
      decision: "blocked",
      findings: [
        expect.objectContaining({
          code: "external_dependency_blocked",
          category: "external_dependency",
        }),
      ],
    });
  });

  it("prevents completion when open obligations remain", () => {
    const report = evaluateCollectedEvidenceVerifier(baseInput({
      openObligations: ["Run one more focused verification after contract cleanup."],
    }));

    expect(report).toMatchObject({
      decision: "insufficient_evidence",
      findings: [
        expect.objectContaining({
          code: "open_obligation",
          category: "obligation",
        }),
      ],
    });
  });

  it("prevents completion when event replay diagnostics are present", () => {
    const replay = replayRuntimeTaskEvents([
      buildRuntimeTaskEventFixture({
        eventId: "event_duplicate",
        kind: "created",
        timestamp: 1,
        payload: { status: "created" },
      }),
      buildRuntimeTaskEventFixture({
        eventId: "event_duplicate",
        kind: "running",
        timestamp: 2,
        payload: { status: "running" },
      }),
    ]);
    const report = evaluateCollectedEvidenceVerifier(baseInput({ eventReplay: replay }));

    expect(report).toMatchObject({
      decision: "failed",
      findings: [
        expect.objectContaining({
          code: "event_replay_inconsistent",
          metadata: { diagnosticCodes: ["duplicate_event_id"] },
        }),
      ],
    });
  });

  it("prevents completion when checkpoint serializer diagnostics are present", () => {
    const report = evaluateCollectedEvidenceVerifier(baseInput({
      checkpointDiagnostics: [
        {
          code: "invalid_checkpoint",
          message: "Checkpoint payload is invalid.",
          recoverable: true,
        },
      ],
    }));

    expect(report).toMatchObject({
      decision: "failed",
      findings: [
        expect.objectContaining({
          code: "event_replay_inconsistent",
          metadata: { diagnosticCodes: ["invalid_checkpoint"] },
        }),
      ],
    });
  });

  it("keeps renderer-collected evidence projected and non-authoritative", () => {
    const collected = collectEvidenceVerifierInput(baseInput({
      taskLoop: {
        source: "renderer",
        sourceProjected: true,
        filesTouched: ["src/renderer-only.ts"],
        testsRun: ["renderer claimed tests"],
        evidenceRefs: [
          buildEvidenceRefFixture({
            type: "test",
            ref: "renderer-test",
            metadata: { raw: "raw-prompt" },
          }),
        ],
      },
    }));
    const report = evaluateEvidenceVerifier(collected.input);

    expect(collected.diagnostics).toEqual([
      expect.objectContaining({ code: "untrusted_renderer_evidence" }),
    ]);
    expect(collected.projectedEvidenceRefs).toEqual([
      expect.objectContaining({ type: "file", ref: "src/renderer-only.ts" }),
      expect.objectContaining({ type: "test", ref: "renderer claimed tests" }),
      expect.objectContaining({ type: "test", ref: "renderer-test" }),
    ]);
    expect(collected.input.evidenceRefs.map((ref) => ref.ref)).not.toContain("renderer-test");
    expect(JSON.stringify(collected)).not.toContain("raw-prompt");
    expect(report.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["missing_file_evidence", "missing_test_evidence"]),
    );
  });
});
