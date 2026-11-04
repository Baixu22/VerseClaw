import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS,
  RUNTIME_MEMORY_ACCEPTED_VERIFICATION_STATUSES,
  RUNTIME_MEMORY_CONTEXT_FLAG_PATHS,
  RUNTIME_MEMORY_EPISODE_KINDS,
  RUNTIME_MEMORY_FACT_SOURCES,
  RUNTIME_MEMORY_INVALIDATION_REASONS,
  RUNTIME_MEMORY_RAW_INPUT_REJECTION_REASONS,
  RUNTIME_MEMORY_SOURCE_REF_TYPES,
  RUNTIME_MEMORY_VERIFICATION_STATUSES,
  RETIRED_RUNTIME_MEMORY_FLAGS,
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryInvalidationProposalFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  dedupeRuntimeMemoryEpisodes,
  findRuntimeMemoryFacts,
  isRuntimeMemoryContextProviderResult,
  isRuntimeMemoryEpisodeRecord,
  isRuntimeMemoryFactPromotionEvidence,
  isRuntimeMemoryFactQuery,
  isRuntimeMemoryInvalidationProposal,
  isRuntimeMemorySummary,
  isRuntimeMemoryTemporalFact,
  isRuntimeMemoryTemporalFactCandidate,
  rankRuntimeMemoryFacts,
  rejectRawRuntimeMemoryInput,
  resolveRuntimeMemoryFeatureFlags,
  runtimeMemoryFlagEnabled,
  sanitizeRuntimeMemoryMetadata,
  sanitizeRuntimeMemoryText,
  summarizeRuntimeMemoryFacts,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime memory context contracts", () => {
  it("defines memory taxonomies and default-off feature flags", () => {
    expect(RUNTIME_MEMORY_EPISODE_KINDS).toEqual([
      "task_event",
      "tool_result",
      "test_output",
      "verifier_summary",
      "trace_summary",
      "human_confirmation",
      "agent_self_edit",
      "deterministic_rule",
      "other",
    ]);
    expect(RUNTIME_MEMORY_SOURCE_REF_TYPES).toEqual([
      "event",
      "tool",
      "test",
      "verifier",
      "trace",
      "human",
      "file",
      "symbol",
      "checkpoint",
      "deterministic_rule",
      "other",
    ]);
    expect(RUNTIME_MEMORY_FACT_SOURCES).toEqual([
      "task_event",
      "tool_result",
      "test_output",
      "verifier_summary",
      "trace_summary",
      "human_confirmation",
      "agent_self_edit",
      "deterministic_rule",
      "other",
    ]);
    expect(RUNTIME_MEMORY_VERIFICATION_STATUSES).toEqual([
      "candidate",
      "verified",
      "human_approved",
      "agent_approved",
      "deterministic_rule",
      "rejected",
      "invalidated",
    ]);
    expect(RUNTIME_MEMORY_ACCEPTED_VERIFICATION_STATUSES).toEqual([
      "verified",
      "human_approved",
      "agent_approved",
      "deterministic_rule",
    ]);
    expect(RUNTIME_MEMORY_INVALIDATION_REASONS).toEqual([
      "superseded",
      "contradicted",
      "expired",
      "retracted",
      "evidence_failed",
      "human_rejected",
    ]);
    expect(RUNTIME_MEMORY_RAW_INPUT_REJECTION_REASONS).toEqual([
      "raw_chat_log",
      "raw_transcript",
      "raw_trace_dump",
      "prompt",
      "full_payload",
      "full_tool_args",
      "full_tool_output",
      "env",
      "secret",
      "trace_baggage",
      "trace_tracestate",
    ]);
    expect(RUNTIME_MEMORY_CONTEXT_FLAG_PATHS).toEqual({
      shadow: "runtime.memory.shadow",
      provider: "runtime.memory.provider",
      proposeFacts: "runtime.memory.proposeFacts",
      persist: "runtime.memory.persist",
      candidateGeneration: "runtime.memory.candidateGeneration",
    });
    expect(DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS).toEqual({
      shadow: false,
      provider: false,
      proposeFacts: false,
      persist: false,
      candidateGeneration: false,
    });
    expect(resolveRuntimeMemoryFeatureFlags({})).toEqual({
      shadow: false,
      provider: false,
      proposeFacts: false,
      persist: false,
      candidateGeneration: false,
    });
    expect(resolveRuntimeMemoryFeatureFlags({
      runtime: {
        memory: {
          shadow: true,
          provider: true,
          proposeFacts: true,
          persist: true,
          candidateGeneration: true,
          rawChat: true,
        },
      },
    })).toEqual({
      shadow: false,
      provider: false,
      proposeFacts: false,
      persist: false,
      candidateGeneration: true,
    });
    expect(RETIRED_RUNTIME_MEMORY_FLAGS).toEqual([
      'shadow',
      'provider',
      'proposeFacts',
      'persist',
    ]);
    expect(resolveRuntimeMemoryFeatureFlags({
      memory: {
        shadow: "true",
        provider: 1,
        proposeFacts: false,
        persist: null,
        candidateGeneration: null,
      },
    })).toEqual({
      shadow: false,
      provider: false,
      proposeFacts: false,
      persist: false,
      candidateGeneration: false,
    });
    expect(runtimeMemoryFlagEnabled({}, "shadow")).toBe(false);
  });

  it("validates sanitized episode, candidate, accepted fact, and invalidation shapes", () => {
    const episode = buildRuntimeMemoryEpisodeFixture({
      episodeId: "episode_contract",
      taskId: "task_contract",
      kind: "verifier_summary",
      reference_time: 100,
      idempotencyKey: "task_contract:verifier:summary",
      boundedSummary: "Verifier confirmed the contract with bounded evidence.",
      sourceRefs: [
        {
          type: "verifier",
          ref: "verifier_report_1",
          label: "Verifier report",
        },
      ],
      evidenceRefs: [
        {
          type: "test",
          ref: "tests/unit/runtime-memory-context-contracts.test.ts",
          metadata: { prompt: "raw prompt", safe: "kept" },
        },
      ],
    });
    const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "candidate_contract",
      taskId: "task_contract",
      subject: "RuntimeMemoryProvider",
      predicate: "requires",
      objectSummary: "Verifier or human evidence before durable promotion.",
      valid_at: 100,
      reference_time: 100,
      sourceEpisodeRefs: [
        {
          episodeId: episode.episodeId,
          taskId: episode.taskId,
          kind: episode.kind,
          idempotencyKey: episode.idempotencyKey,
          reference_time: episode.reference_time,
        },
      ],
      evidenceRefs: episode.evidenceRefs,
    });
    const fact = buildRuntimeMemoryTemporalFactFixture({
      ...candidate,
      factId: "fact_contract",
      verificationStatus: "verified",
      acceptedAt: 110,
      promotion: {
        promotedBy: "verifier",
        evidenceRefs: [
          {
            type: "test",
            ref: "tests/unit/runtime-memory-context-contracts.test.ts",
          },
        ],
      },
    });
    const invalidation = buildRuntimeMemoryInvalidationProposalFixture({
      factId: fact.factId,
      invalid_at: 120,
      reference_time: 120,
      sourceEpisodeRefs: fact.sourceEpisodeRefs,
      evidenceRefs: fact.evidenceRefs,
    });

    expect(isRuntimeMemoryEpisodeRecord(episode)).toBe(true);
    expect(isRuntimeMemoryTemporalFactCandidate(candidate)).toBe(true);
    expect(isRuntimeMemoryTemporalFact(fact)).toBe(true);
    expect(isRuntimeMemoryFactPromotionEvidence(fact.promotion)).toBe(true);
    expect(isRuntimeMemoryInvalidationProposal(invalidation)).toBe(true);
    expect(fact.valid_at).toBe(100);
    expect(fact.reference_time).toBe(100);
    expect(fact.sourceEpisodeRefs[0]?.episodeId).toBe(episode.episodeId);
    expect(fact.evidenceRefs[0]?.ref).toBe(episode.evidenceRefs[0]?.ref);
    expect(JSON.stringify(episode)).toContain("[redacted]");
    expect(isRuntimeMemoryTemporalFact({
      ...fact,
      verificationStatus: "candidate",
    })).toBe(false);
    expect(isRuntimeMemoryTemporalFact({
      ...fact,
      promotion: { promotedBy: "verifier", evidenceRefs: [] },
    })).toBe(false);
  });

  it("rejects raw chat logs, transcripts, trace dumps, prompts, payloads, tool IO, env, secrets, and trace headers", () => {
    const cases = [
      ["user: please remember this whole chat", "raw_chat_log"],
      ['{"role":"assistant","content":"raw"}', "raw_chat_log"],
      ["session transcript stored as .jsonl", "raw_transcript"],
      ["raw trace dump traceparent=00-abc", "raw_trace_dump"],
      ["system prompt: do the hidden thing", "prompt"],
      ['{"payload":{"full":true}}', "full_payload"],
      ["toolArgs: { command: 'print secrets' }", "full_tool_args"],
      ["stdout: full command output", "full_tool_output"],
      ["process.env contains OPENAI_API_KEY", "env"],
      ["authorization bearer sk-live-secret", "secret"],
      ["baggage=user=alice", "trace_baggage"],
      ["tracestate=vendor-secret", "trace_tracestate"],
    ] as const;

    for (const [input, reason] of cases) {
      expect(rejectRawRuntimeMemoryInput(input)).toMatchObject({
        accepted: false,
        reason,
      });
      expect(sanitizeRuntimeMemoryText(input)).toMatchObject({
        accepted: false,
        reason,
      });
    }

    expect(rejectRawRuntimeMemoryInput({ toolOutput: "full result" }))
      .toMatchObject({ reason: "full_tool_output" });
    expect(() =>
      buildRuntimeMemoryEpisodeFixture({
        boundedSummary: "assistant: raw chat log should not become memory",
      })
    ).toThrow("Invalid runtime memory episode fixture");
  });

  it("redacts sensitive metadata while preserving bounded safe fields", () => {
    const sanitized = sanitizeRuntimeMemoryMetadata({
      prompt: "raw prompt",
      payload: { full: true },
      toolArgs: { path: "secret.ts" },
      toolOutput: "stdout dump",
      env: { OPENAI_API_KEY: "sk-live" },
      secret: "sk-live",
      baggage: "session=secret",
      tracestate: "vendor=secret",
      safe: "kept",
      nested: {
        safeNumber: 1,
        apiKey: "sk-live",
      },
    });

    expect(sanitized).toMatchObject({
      prompt: "[redacted]",
      payload: "[redacted]",
      toolArgs: "[redacted]",
      toolOutput: "[redacted]",
      env: "[redacted]",
      secret: "[redacted]",
      baggage: "[redacted]",
      tracestate: "[redacted]",
      safe: "kept",
      nested: {
        safeNumber: 1,
        apiKey: "[redacted]",
      },
    });
  });

  it("deduplicates sanitized episodes by idempotency key without dropping source and evidence refs", () => {
    const first = buildRuntimeMemoryEpisodeFixture({
      episodeId: "episode_first",
      idempotencyKey: "task_1:tool:read",
      sourceRefs: [{ type: "tool", ref: "tool_first" }],
      evidenceRefs: [{ type: "tool", ref: "tool_first" }],
    });
    const duplicate = buildRuntimeMemoryEpisodeFixture({
      episodeId: "episode_duplicate",
      idempotencyKey: "task_1:tool:read",
      sourceRefs: [{ type: "tool", ref: "tool_duplicate" }],
      evidenceRefs: [{ type: "tool", ref: "tool_duplicate" }],
    });
    const second = buildRuntimeMemoryEpisodeFixture({
      episodeId: "episode_second",
      idempotencyKey: "task_1:test:run",
      kind: "test_output",
      sourceRefs: [{ type: "test", ref: "test_run" }],
      evidenceRefs: [{ type: "test", ref: "tests/unit/example.test.ts" }],
    });

    const deduped = dedupeRuntimeMemoryEpisodes([first, duplicate, second]);

    expect(deduped.map((episode) => episode.episodeId)).toEqual([
      "episode_first",
      "episode_second",
    ]);
    expect(deduped[0]?.sourceRefs[0]?.ref).toBe("tool_first");
    expect(deduped[0]?.evidenceRefs[0]?.ref).toBe("tool_first");
  });

  it("filters current-valid and historical temporal facts without promoting candidates by default", () => {
    const oldFact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_old",
      subject: "Preference",
      predicate: "uses",
      objectSummary: "Mode A.",
      valid_at: 10,
      invalid_at: 30,
      reference_time: 10,
      acceptedAt: 11,
      evidenceRefs: [{ type: "human", ref: "human_old" }],
      promotion: {
        promotedBy: "human",
        evidenceRefs: [{ type: "human", ref: "human_old" }],
      },
    });
    const replacementFact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_new",
      subject: "Preference",
      predicate: "uses",
      objectSummary: "Mode B.",
      valid_at: 30,
      reference_time: 30,
      acceptedAt: 31,
      evidenceRefs: [{ type: "human", ref: "human_new" }],
      promotion: {
        promotedBy: "human",
        evidenceRefs: [{ type: "human", ref: "human_new" }],
      },
    });
    const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "candidate_unverified",
      subject: "Preference",
      predicate: "uses",
      objectSummary: "Unverified Mode C.",
      valid_at: 35,
      reference_time: 35,
      verificationStatus: "candidate",
    });
    const rejected = buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "candidate_rejected",
      subject: "Preference",
      predicate: "uses",
      objectSummary: "Rejected Mode D.",
      valid_at: 35,
      reference_time: 35,
      verificationStatus: "rejected",
    });
    const expired = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_expired",
      subject: "Preference",
      predicate: "uses",
      objectSummary: "Expired Mode E.",
      valid_at: 1,
      expired_at: 20,
      reference_time: 1,
      acceptedAt: 2,
    });
    const facts = [oldFact, replacementFact, candidate, rejected, expired];

    expect(findRuntimeMemoryFacts(facts, {
      subject: "Preference",
      reference_time: 25,
    }).map((fact) => fact.factId)).toEqual(["fact_old"]);
    expect(findRuntimeMemoryFacts(facts, {
      subject: "Preference",
      reference_time: 35,
    }).map((fact) => fact.factId)).toEqual(["fact_new"]);
    expect(findRuntimeMemoryFacts(facts, {
      subject: "Preference",
      reference_time: 35,
      includeCandidates: true,
    }).map((fact) => fact.factId)).toEqual([
      "fact_new",
      "candidate_unverified",
    ]);
    expect(findRuntimeMemoryFacts(facts, {
      subject: "Preference",
      reference_time: 35,
      includeRejected: true,
      includeInvalidated: true,
      includeExpired: true,
    }).map((fact) => fact.factId)).toEqual([
      "fact_new",
      "fact_old",
      "fact_expired",
      "candidate_rejected",
    ]);
    expect(isRuntimeMemoryFactQuery({
      subject: "Preference",
      reference_time: 35,
      includeCandidates: true,
      verificationStatuses: ["candidate"],
      limit: 1,
    })).toBe(true);
    expect(isRuntimeMemoryFactQuery({ verificationStatuses: ["accepted"] }))
      .toBe(false);
  });

  it("ranks verified evidence-backed facts before less authoritative facts", () => {
    const deterministic = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_rule",
      verificationStatus: "deterministic_rule",
      promotion: {
        promotedBy: "deterministic_rule",
        ruleId: "rule_1",
        evidenceRefs: [{ type: "test", ref: "rule_test" }],
      },
    });
    const human = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_human",
      verificationStatus: "human_approved",
      promotion: {
        promotedBy: "human",
        approvedBy: "maintainer",
        evidenceRefs: [{ type: "human", ref: "approval_1" }],
      },
    });
    const verified = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_verified",
      verificationStatus: "verified",
      promotion: {
        promotedBy: "verifier",
        evidenceRefs: [{ type: "test", ref: "verification_test" }],
      },
    });

    expect(rankRuntimeMemoryFacts([deterministic, human, verified])
      .map((fact) => fact.factId)).toEqual([
        "fact_verified",
        "fact_human",
        "fact_rule",
      ]);
  });

  it("builds readonly token-budgeted memory summaries and provider result contracts", () => {
    const safeFact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_summary",
      subject: "RuntimeMemoryProvider",
      predicate: "returns",
      objectSummary: "Readonly source-linked context items.",
      valid_at: 10,
      reference_time: 10,
      evidenceRefs: [
        {
          type: "test",
          ref: "tests/unit/runtime-memory-context-contracts.test.ts",
          metadata: { toolOutput: "raw output", safe: "kept" },
        },
      ],
    });
    const summary = summarizeRuntimeMemoryFacts([safeFact], {
      subject: "RuntimeMemoryProvider",
      reference_time: 20,
      tokenBudget: 32,
    });
    const tinySummary = summarizeRuntimeMemoryFacts([safeFact], {
      subject: "RuntimeMemoryProvider",
      reference_time: 20,
      tokenBudget: 1,
    });
    const result = {
      contextItems: [
        {
          id: "runtime-memory:fact_summary",
          kind: "memory",
          text: summary.items[0]?.summary ?? "",
          source: "runtime-memory",
          priority: "P1",
          evidenceRefs: summary.items[0]?.evidenceRefs ?? [],
          metadata: {
            factId: "fact_summary",
            sourceEpisodeIds: summary.items[0]?.sourceEpisodeRefs.map((ref) =>
              ref.episodeId
            ) ?? [],
          },
        },
      ],
      summary,
      evidenceRefs: summary.items.flatMap((item) => item.evidenceRefs),
      readonly: true,
    };

    expect(isRuntimeMemorySummary(summary)).toBe(true);
    expect(summary.readonly).toBe(true);
    expect(summary.estimatedTokens).toBeLessThanOrEqual(summary.tokenBudget);
    expect(tinySummary.items).toHaveLength(1);
    expect(tinySummary.estimatedTokens).toBeLessThanOrEqual(1);
    expect(JSON.stringify(summary)).not.toContain("raw output");
    expect(JSON.stringify(summary)).toContain("[redacted]");
    expect(isRuntimeMemoryContextProviderResult(result)).toBe(true);
    expect(isRuntimeMemoryContextProviderResult({ ...result, readonly: false }))
      .toBe(false);
  });
});
