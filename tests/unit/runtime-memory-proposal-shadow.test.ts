import { describe, expect, it } from "vitest";
import {
  RUNTIME_MEMORY_FACT_PROPOSAL_INPUT_SOURCES,
  RUNTIME_MEMORY_FACT_PROPOSAL_REJECTION_REASONS,
  buildRuntimeMemoryFactProposalShadow,
  buildRuntimeMemoryTemporalFactFixture,
  isRuntimeMemoryTemporalFact,
  isRuntimeMemoryTemporalFactCandidate,
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

  it("creates sanitized candidate facts only when both shadow and proposeFacts are enabled", () => {
    const result = buildRuntimeMemoryFactProposalShadow({
      config: enabledConfig,
      inputs: [
        proposalInput({
          factId: "candidate_from_test",
          source: "test_output",
          confidence: 0.95,
          metadata: {
            safe: "kept",
          },
        }),
      ],
    });

    expect(result.enabled).toBe(true);
    expect(result.proposalOnly).toBe(true);
    expect(result.readonly).toBe(true);
    expect(result.acceptedFacts).toEqual([]);
    expect(result.rejectedInputs).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      factId: "candidate_from_test",
      source: "test_output",
      verificationStatus: "candidate",
    });
    expect(isRuntimeMemoryTemporalFactCandidate(result.candidates[0]))
      .toBe(true);
    expect(isRuntimeMemoryTemporalFact(result.candidates[0])).toBe(false);
    expect(result.candidates[0]?.metadata).toEqual({ safe: "kept" });
  });

  it("rejects unsupported sources, accepted fact inputs, invalid shapes, and raw summaries", () => {
    const result = buildRuntimeMemoryFactProposalShadow({
      config: enabledConfig,
      inputs: [
        proposalInput({
          factId: "unsupported_source",
          source: "other",
        }),
        {
          ...proposalInput({
            factId: "accepted_fact_input",
          }),
          verificationStatus: "verified",
        },
        {
          schemaVersion: 1,
          factId: "invalid_shape",
        },
        proposalInput({
          factId: "raw_trace_summary",
          objectSummary: "raw trace dump traceparent=00-abc",
        }),
      ],
    });

    expect(result.candidates).toEqual([]);
    expect(result.rejectedInputs.map((rejection) => rejection.reason)).toEqual([
      "unsupported_source",
      "accepted_fact_input",
      "invalid_shape",
      "raw_input",
    ]);
    expect(result.rejectedInputs[3]).toMatchObject({
      inputId: "raw_trace_summary",
      rawReason: "raw_trace_dump",
    });
    expect(JSON.stringify(result)).not.toContain("traceparent=00-abc");
  });

  it("builds invalidation proposals for conflicting accepted facts without mutating them", () => {
    const acceptedFact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_current_requirement",
      subject: "RuntimeMemoryProvider",
      predicate: "requires",
      objectSummary: "Verifier evidence before durable promotion.",
      valid_at: 10,
      reference_time: 10,
      acceptedAt: 11,
    });
    const result = buildRuntimeMemoryFactProposalShadow({
      config: enabledConfig,
      acceptedFacts: [acceptedFact],
      inputs: [
        proposalInput({
          factId: "candidate_replacement_requirement",
          source: "human_confirmation",
          subject: "RuntimeMemoryProvider",
          predicate: "requires",
          objectSummary: "Human approval before durable promotion.",
          valid_at: 30,
          reference_time: 30,
          proposedAt: 31,
        }),
      ],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.verificationStatus).toBe("candidate");
    expect(result.acceptedFacts).toEqual([]);
    expect(acceptedFact.invalid_at).toBeUndefined();
    expect(result.invalidationProposals).toEqual([
      expect.objectContaining({
        factId: "fact_current_requirement",
        replacementFactId: "candidate_replacement_requirement",
        reason: "contradicted",
        invalid_at: 30,
        reference_time: 30,
        proposedBy: "human_confirmation",
        verificationStatus: "candidate",
      }),
    ]);
    expect(result.invalidationProposals[0]?.metadata).toMatchObject({
      candidateFactId: "candidate_replacement_requirement",
      proposalOnly: true,
    });
  });

  it("does not propose invalidation for identical or already invalid facts", () => {
    const acceptedFact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_same",
      subject: "ProviderOrdering",
      predicate: "stays",
      objectSummary: "Default provider order remains unchanged.",
      valid_at: 10,
      invalid_at: 25,
      reference_time: 10,
      acceptedAt: 11,
    });
    const identical = buildRuntimeMemoryFactProposalShadow({
      config: enabledConfig,
      acceptedFacts: [
        buildRuntimeMemoryTemporalFactFixture({
          factId: "fact_identical",
          subject: "ProviderOrdering",
          predicate: "stays",
          objectSummary: "Default provider order remains unchanged.",
          valid_at: 10,
        }),
      ],
      inputs: [
        proposalInput({
          factId: "candidate_identical",
          subject: "ProviderOrdering",
          predicate: "stays",
          objectSummary: "Default provider order remains unchanged.",
          valid_at: 20,
        }),
      ],
    });
    const alreadyInvalid = buildRuntimeMemoryFactProposalShadow({
      config: enabledConfig,
      acceptedFacts: [acceptedFact],
      inputs: [
        proposalInput({
          factId: "candidate_after_invalid",
          subject: "ProviderOrdering",
          predicate: "stays",
          objectSummary: "Memory provider controls ordering.",
          valid_at: 30,
        }),
      ],
    });

    expect(identical.invalidationProposals).toEqual([]);
    expect(alreadyInvalid.invalidationProposals).toEqual([]);
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
