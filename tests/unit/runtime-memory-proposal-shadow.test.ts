import { describe, expect, it } from "vitest";
import {
  RUNTIME_MEMORY_FACT_PROPOSAL_INPUT_SOURCES,
  RUNTIME_MEMORY_FACT_PROPOSAL_REJECTION_REASONS,
  buildRuntimeMemoryFactProposalShadow,
  buildRuntimeMemoryTemporalFactFixture,
  sanitizeRuntimeMemoryFactProposalInput,
  type RuntimeMemoryFactProposalInput,
} from "../../openclaw_runtime/src/runtime-core";

const enabledConfig = {
  runtime: {
    memory: {
      shadow: true,
      proposeFacts: true,
    },
  },
};

describe("runtime memory fact proposal shadow", () => {
  it("defines allowed deterministic proposal sources and rejection reasons", () => {
    expect(RUNTIME_MEMORY_FACT_PROPOSAL_INPUT_SOURCES).toEqual([
      "task_event",
      "tool_result",
      "test_output",
      "verifier_summary",
      "trace_summary",
      "human_confirmation",
      "deterministic_rule",
    ]);
    expect(RUNTIME_MEMORY_FACT_PROPOSAL_REJECTION_REASONS).toEqual([
      "raw_input",
      "unsupported_source",
      "accepted_fact_input",
      "invalid_shape",
    ]);
  });

  it("returns no proposals, invalidations, or retained input when flags are off", () => {
    const result = buildRuntimeMemoryFactProposalShadow({
      config: {},
      inputs: [
        proposalInput({
          factId: "raw_disabled",
          objectSummary: "toolOutput: full command output stays outside memory",
        }),
      ],
      acceptedFacts: [
        buildRuntimeMemoryTemporalFactFixture({ factId: "accepted_disabled" }),
      ],
    });

    expect(result.enabled).toBe(false);
    expect(result.disabledReason).toBe("runtime_memory_flags_disabled");
    expect(result.candidates).toEqual([]);
    expect(result.acceptedFacts).toEqual([]);
    expect(result.invalidationProposals).toEqual([]);
    expect(result.rejectedInputs).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("full command output");

    expect(buildRuntimeMemoryFactProposalShadow({
      config: { runtime: { memory: { shadow: true, proposeFacts: false } } },
      inputs: [proposalInput()],
    }).enabled).toBe(false);
    expect(buildRuntimeMemoryFactProposalShadow({
      config: { runtime: { memory: { shadow: false, proposeFacts: true } } },
      inputs: [proposalInput()],
    }).enabled).toBe(false);
  });

  it("emits no candidates even when the retired shadow + proposeFacts flags are requested", () => {
    const result = buildRuntimeMemoryFactProposalShadow({
      config: enabledConfig,
      inputs: [
        proposalInput({
          factId: "candidate_from_test",
          source: "test_output",
          confidence: 0.95,
        }),
      ],
    });

    // TF-0500 retired shadow/proposeFacts; both are pinned to false, so the
    // shadow builder reports disabled and yields nothing.
    expect(result.enabled).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.acceptedFacts).toEqual([]);
  });

  it("remains readonly and non-mutating while retired", () => {
    const result = buildRuntimeMemoryFactProposalShadow({
      config: enabledConfig,
      inputs: [
        proposalInput({ factId: "unsupported_source", source: "other" }),
      ],
    });
    expect(result.proposalOnly).toBe(true);
    expect(result.readonly).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(result.invalidationProposals ?? []).toEqual([]);
  });

  it("never retains raw summaries even on the retired path", () => {
    const result = buildRuntimeMemoryFactProposalShadow({
      config: enabledConfig,
      inputs: [
        proposalInput({
          factId: "raw_trace_summary",
          objectSummary: "raw trace dump traceparent=00-abc",
        }),
      ],
    });
    expect(JSON.stringify(result)).not.toContain("traceparent=00-abc");
  });
  it("sanitizes individual proposal inputs deterministically", () => {
    const sanitized = sanitizeRuntimeMemoryFactProposalInput(proposalInput({
      factId: "candidate_deterministic",
      source: "deterministic_rule",
      confidence: 2,
      proposedAt: undefined,
    }));

    expect(sanitized.accepted).toBe(true);
    if (!sanitized.accepted) {
      throw new Error("expected sanitized proposal input");
    }
    expect(sanitized.value).toMatchObject({
      factId: "candidate_deterministic",
      confidence: 1,
      proposedAt: 10,
      source: "deterministic_rule",
      verificationStatus: "candidate",
    });
  });
});

function proposalInput(
  overrides: Partial<RuntimeMemoryFactProposalInput> = {},
): RuntimeMemoryFactProposalInput {
  return {
    schemaVersion: 1,
    factId: "candidate_1",
    taskId: "task_1",
    subject: "RuntimeMemoryProvider",
    predicate: "stores",
    objectSummary: "Evidence-backed temporal facts only.",
    confidence: 0.8,
    source: "verifier_summary",
    valid_at: 10,
    reference_time: 10,
    sourceEpisodeRefs: [
      {
        episodeId: "episode_1",
        taskId: "task_1",
        kind: "verifier_summary",
        idempotencyKey: "task_1:verifier:summary",
        reference_time: 10,
      },
    ],
    evidenceRefs: [
      {
        type: "trace",
        ref: "trace_1",
        summary: "Bounded verifier trace summary.",
      },
    ],
    proposedAt: 11,
    ...overrides,
  };
}
