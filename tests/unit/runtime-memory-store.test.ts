import { describe, expect, it } from "vitest";
import { RuntimeMemoryStore } from "../../openclaw_runtime/src/runtime-core/memory-store";
import {
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryInvalidationProposalFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryEpisodeRecord,
  type RuntimeMemorySourceEpisodeRef,
  type RuntimeMemorySummary,
} from "../../openclaw_runtime/src/runtime-core";

describe("runtime memory local episode/fact store", () => {
  it("bounds local episodes, idempotently merges duplicate source evidence, and returns frozen clones", () => {
    const store = new RuntimeMemoryStore({ maxEpisodes: 2 });
    const firstEpisode = buildEpisode({
      episodeId: "episode_first",
      taskId: "task_memory",
      idempotencyKey: "task_memory:tool:read",
      file: "src/preferences.ts",
      symbol: "PreferenceMode",
      referenceTime: 10,
    });

    expect(store.appendEpisode(firstEpisode)).toMatchObject({
      accepted: true,
      stored: true,
      duplicate: false,
    });
    expect(store.appendEpisode({
      ...firstEpisode,
      episodeId: "episode_duplicate",
      sourceRefs: [
        { type: "file", ref: "src/preferences.ts", file: "src/preferences.ts" },
        {
          type: "symbol",
          ref: "PreferenceModeAlias",
          file: "src/preferences.ts",
          symbol: "PreferenceModeAlias",
        },
      ],
      evidenceRefs: [{ type: "test", ref: "tests/unit/runtime-memory-store.test.ts" }],
    })).toMatchObject({
      accepted: true,
      stored: false,
      duplicate: true,
    });

    const merged = store.getEpisodeById("episode_first");
    expect(merged?.sourceRefs.map((ref) => ref.ref)).toEqual([
      "src/preferences.ts",
      "PreferenceMode",
      "PreferenceModeAlias",
    ]);
    expect(merged?.evidenceRefs.map((ref) => ref.ref)).toContain(
      "tests/unit/runtime-memory-store.test.ts",
    );
    expect(Object.isFrozen(merged)).toBe(true);
    expect(Object.isFrozen(merged?.sourceRefs)).toBe(true);

    if (merged !== undefined) {
      try {
        (merged as { boundedSummary: string }).boundedSummary = "mutated";
      } catch {
        // Frozen clone mutation may throw; either way the store must not change.
      }
    }
    expect(store.getEpisodeById("episode_first")?.boundedSummary).toBe(
      firstEpisode.boundedSummary,
    );

    store.appendEpisode(buildEpisode({
      episodeId: "episode_second",
      taskId: "task_memory",
      idempotencyKey: "task_memory:test:second",
      file: "src/second.ts",
      symbol: "SecondSymbol",
      referenceTime: 20,
    }));
    store.appendEpisode(buildEpisode({
      episodeId: "episode_third",
      taskId: "task_memory",
      idempotencyKey: "task_memory:test:third",
      file: "src/third.ts",
      symbol: "ThirdSymbol",
      referenceTime: 30,
    }));

    expect(store.stats()).toMatchObject({ episodes: 2, maxEpisodes: 2 });
    expect(store.listEpisodes().map((episode) => episode.episodeId)).toEqual([
      "episode_second",
      "episode_third",
    ]);
    expect(store.getEpisodeById("episode_first")).toBeUndefined();
  });

  it("rejects raw chat and raw tool-output retention on append", () => {
    const store = new RuntimeMemoryStore();
    const rawEpisode = {
      ...buildEpisode({
        episodeId: "episode_raw",
        taskId: "task_raw",
        idempotencyKey: "task_raw:chat",
        file: "src/raw.ts",
        symbol: "RawSymbol",
        referenceTime: 1,
      }),
      boundedSummary: "assistant: remember this full chat log",
    };
    const rawFact = {
      ...buildRuntimeMemoryTemporalFactFixture({ factId: "fact_raw" }),
      objectSummary: "stdout: full command output",
    };

    expect(store.appendEpisode(rawEpisode)).toMatchObject({
      accepted: false,
      reason: "raw_chat_log",
    });
    expect(store.appendFact(rawFact)).toMatchObject({
      accepted: false,
      reason: "full_tool_output",
    });
    expect(store.stats()).toMatchObject({ episodes: 0, facts: 0 });
  });

  it("keeps default retention bounded at 256 episodes, 512 facts, and 256 invalidations", () => {
    const store = new RuntimeMemoryStore({ evictionPolicy: "fifo" });

    for (let index = 0; index < 257; index += 1) {
      store.appendEpisode(buildEpisode({
        episodeId: `episode_${index}`,
        taskId: "task_retention",
        idempotencyKey: `task_retention:episode:${index}`,
        file: `src/retention-${index}.ts`,
        symbol: `Retention${index}`,
        referenceTime: index,
      }));
    }

    for (let index = 0; index < 513; index += 1) {
      store.appendFact(buildRuntimeMemoryTemporalFactFixture({
        factId: `fact_${index}`,
        taskId: "task_retention",
        valid_at: index,
        reference_time: index,
        acceptedAt: index + 1,
      }));
    }

    for (let index = 0; index < 257; index += 1) {
      store.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture({
        invalidationId: `invalidation_${index}`,
        factId: `fact_${index}`,
        invalid_at: index + 10,
        reference_time: index + 10,
        verificationStatus: "verified",
      }));
    }

    expect(store.stats()).toEqual({
      episodes: 256,
      facts: 512,
      invalidations: 256,
      maxEpisodes: 256,
      maxFacts: 512,
      maxInvalidations: 256,
    });
    expect(store.getEpisodeById("episode_0")).toBeUndefined();
    expect(store.getFactById("fact_0")).toBeUndefined();
    expect(store.listInvalidations().map((item) => item.invalidationId))
      .not.toContain("invalidation_0");
    expect(store.getEpisodeById("episode_256")?.redactionStatus).toBe(
      "sanitized",
    );
    expect(store.getFactById("fact_512")?.factId).toBe("fact_512");
    expect(store.listInvalidations().at(-1)?.invalidationId).toBe(
      "invalidation_256",
    );
  });

  it("queries temporal facts by task, file, symbol, evidence, status, and historical time without overwriting truth", () => {
    const store = new RuntimeMemoryStore();
    const oldEpisode = buildEpisode({
      episodeId: "episode_old",
      taskId: "task_memory",
      idempotencyKey: "task_memory:human:old",
      file: "src/preferences.ts",
      symbol: "PreferenceMode",
      referenceTime: 10,
    });
    const newEpisode = buildEpisode({
      episodeId: "episode_new",
      taskId: "task_memory",
      idempotencyKey: "task_memory:human:new",
      file: "src/preferences.ts",
      symbol: "PreferenceMode",
      referenceTime: 30,
    });
    store.appendEpisode(oldEpisode);
    store.appendEpisode(newEpisode);

    const oldFact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_old",
      taskId: "task_memory",
      subject: "Preference",
      predicate: "uses",
      objectSummary: "Mode A.",
      verificationStatus: "human_approved",
      source: "human_confirmation",
      valid_at: 10,
      reference_time: 10,
      acceptedAt: 11,
      sourceEpisodeRefs: [sourceEpisodeRef(oldEpisode)],
      evidenceRefs: [{ type: "human", ref: "human_old" }],
      promotion: {
        promotedBy: "human",
        approvedBy: "maintainer",
        evidenceRefs: [{ type: "human", ref: "human_old" }],
      },
    });
    const duplicateOldFact = {
      ...oldFact,
      objectSummary: "Mode B should not overwrite fact_old.",
    };
    const newFact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_new",
      taskId: "task_memory",
      subject: "Preference",
      predicate: "uses",
      objectSummary: "Mode B.",
      verificationStatus: "verified",
      source: "verifier_summary",
      valid_at: 30,
      reference_time: 30,
      acceptedAt: 31,
      sourceEpisodeRefs: [sourceEpisodeRef(newEpisode)],
      evidenceRefs: [{ type: "human", ref: "human_new" }],
      promotion: {
        promotedBy: "verifier",
        evidenceRefs: [{ type: "human", ref: "human_new" }],
      },
    });
    store.appendFact(oldFact);
    expect(store.appendFact(duplicateOldFact)).toMatchObject({
      accepted: true,
      stored: false,
      duplicate: true,
    });
    store.appendFact(newFact);
    store.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture({
      invalidationId: "invalidation_old",
      factId: oldFact.factId,
      reason: "superseded",
      invalid_at: 30,
      reference_time: 30,
      verificationStatus: "human_approved",
      sourceEpisodeRefs: [sourceEpisodeRef(newEpisode)],
      evidenceRefs: [{ type: "human", ref: "human_new" }],
      replacementFactId: newFact.factId,
    }));

    expect(store.getFactById("fact_old")?.objectSummary).toBe("Mode A.");
    expect(store.getFactById("fact_old")?.invalid_at).toBeUndefined();
    expect(factIds(store.queryFacts({
      subject: "Preference",
      time: 20,
    }))).toEqual(["fact_old"]);
    expect(factIds(store.queryFacts({
      subject: "Preference",
      time: 35,
    }))).toEqual(["fact_new"]);

    const invalidatedView = store.queryFacts({
      subject: "Preference",
      time: 35,
      includeInvalidated: true,
    });
    expect(factIds(invalidatedView)).toEqual(["fact_new", "fact_old"]);
    expect(invalidatedView.find((fact) => fact.factId === "fact_old")?.invalid_at)
      .toBe(30);

    expect(factIds(store.queryFacts({ taskId: "task_memory", time: 35 })))
      .toEqual(["fact_new"]);
    expect(factIds(store.queryFacts({ file: "src/preferences.ts", time: 35 })))
      .toEqual(["fact_new"]);
    expect(factIds(store.queryFacts({ symbol: "PreferenceMode", time: 35 })))
      .toEqual(["fact_new"]);
    expect(factIds(store.queryFacts({ evidenceRef: "human_old", time: 20 })))
      .toEqual(["fact_old"]);
    expect(factIds(store.queryFacts({ status: "verified", time: 35 })))
      .toEqual(["fact_new"]);
  });

  it("applies only accepted invalidations to current-valid fact queries", () => {
    const store = new RuntimeMemoryStore();
    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_invalidation_gate",
      subject: "RollbackPolicy",
      predicate: "preserves",
      objectSummary: "User memory data remains present until explicitly deleted.",
      valid_at: 10,
      reference_time: 10,
      acceptedAt: 11,
    });
    store.appendFact(fact);

    store.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture({
      invalidationId: "invalidation_candidate",
      factId: fact.factId,
      invalid_at: 20,
      reference_time: 20,
      verificationStatus: "candidate",
    }));
    store.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture({
      invalidationId: "invalidation_rejected",
      factId: fact.factId,
      invalid_at: 21,
      reference_time: 21,
      verificationStatus: "rejected",
    }));

    expect(factIds(store.queryFacts({
      subject: "RollbackPolicy",
      time: 30,
    }))).toEqual(["fact_invalidation_gate"]);

    store.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture({
      invalidationId: "invalidation_accepted",
      factId: fact.factId,
      invalid_at: 22,
      reference_time: 22,
      verificationStatus: "verified",
    }));

    expect(factIds(store.queryFacts({
      subject: "RollbackPolicy",
      time: 30,
    }))).toEqual([]);

    const invalidatedView = store.queryFacts({
      subject: "RollbackPolicy",
      time: 30,
      includeInvalidated: true,
    });
    expect(factIds(invalidatedView)).toEqual(["fact_invalidation_gate"]);
    expect(invalidatedView[0]?.invalid_at).toBe(22);
  });

  it("excludes candidates, rejected facts, expired facts, and unpromoted verified candidates by default", () => {
    const store = new RuntimeMemoryStore();
    const episode = buildEpisode({
      episodeId: "episode_policy",
      taskId: "task_policy",
      idempotencyKey: "task_policy:verifier",
      file: "src/policy.ts",
      symbol: "Policy",
      referenceTime: 10,
    });
    store.appendEpisode(episode);
    const sourceEpisodeRefs = [sourceEpisodeRef(episode)];

    store.appendFact(buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_current",
      taskId: "task_policy",
      subject: "Policy",
      predicate: "allows",
      objectSummary: "Verified current behavior.",
      valid_at: 10,
      reference_time: 10,
      sourceEpisodeRefs,
    }));
    store.appendFact(buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "candidate_policy",
      taskId: "task_policy",
      subject: "Policy",
      predicate: "allows",
      objectSummary: "Unverified candidate behavior.",
      verificationStatus: "candidate",
      valid_at: 10,
      reference_time: 10,
      sourceEpisodeRefs,
    }));
    store.appendFact(buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "candidate_verified_without_promotion",
      taskId: "task_policy",
      subject: "Policy",
      predicate: "allows",
      objectSummary: "A verified-looking candidate without promotion evidence.",
      verificationStatus: "verified",
      valid_at: 10,
      reference_time: 10,
      sourceEpisodeRefs,
    }));
    store.appendFact(buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "candidate_rejected",
      taskId: "task_policy",
      subject: "Policy",
      predicate: "allows",
      objectSummary: "Rejected behavior.",
      verificationStatus: "rejected",
      valid_at: 10,
      reference_time: 10,
      sourceEpisodeRefs,
    }));
    store.appendFact(buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_expired",
      taskId: "task_policy",
      subject: "Policy",
      predicate: "allows",
      objectSummary: "Expired behavior.",
      valid_at: 1,
      expired_at: 20,
      reference_time: 1,
      acceptedAt: 2,
      sourceEpisodeRefs,
    }));

    expect(factIds(store.queryFacts({ subject: "Policy", time: 100 })))
      .toEqual(["fact_current"]);
    expect(factIds(store.queryFacts({
      subject: "Policy",
      time: 100,
      includeCandidates: true,
    }))).toContain("candidate_policy");
    expect(factIds(store.queryFacts({
      subject: "Policy",
      time: 100,
      includeRejected: true,
    }))).toContain("candidate_rejected");
    expect(factIds(store.queryFacts({
      subject: "Policy",
      time: 100,
      includeExpired: true,
    }))).toContain("fact_expired");
    expect(factIds(store.queryFacts({
      subject: "Policy",
      time: 100,
      status: "verified",
    }))).toContain("candidate_verified_without_promotion");
  });

  it("returns token-budgeted readonly summaries without raw metadata retention", () => {
    const store = new RuntimeMemoryStore();
    const episode = buildEpisode({
      episodeId: "episode_summary",
      taskId: "task_summary",
      idempotencyKey: "task_summary:test",
      file: "src/summary.ts",
      symbol: "RuntimeMemoryProvider",
      referenceTime: 10,
    });
    store.appendEpisode(episode);
    store.appendFact(buildRuntimeMemoryTemporalFactFixture({
      factId: "fact_summary",
      taskId: "task_summary",
      subject: "RuntimeMemoryProvider",
      predicate: "returns",
      objectSummary: "Readonly source-linked context summaries within a budget.",
      valid_at: 10,
      reference_time: 10,
      sourceEpisodeRefs: [sourceEpisodeRef(episode)],
      evidenceRefs: [
        {
          type: "test",
          ref: "tests/unit/runtime-memory-store.test.ts",
          metadata: { toolOutput: "stdout dump", safe: "kept" },
        },
      ],
    }));

    const summary = store.summarizeFacts({
      subject: "RuntimeMemoryProvider",
      time: 20,
      tokenBudget: 8,
    });

    expect(summary.readonly).toBe(true);
    expect(summary.estimatedTokens).toBeLessThanOrEqual(summary.tokenBudget);
    expect(summary.items).toHaveLength(1);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.items)).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("stdout dump");
    expect(JSON.stringify(summary)).toContain("[redacted]");

    try {
      (summary as RuntimeMemorySummary).items = [];
    } catch {
      // Frozen clone mutation may throw; either way the returned summary is readonly.
    }
    expect(store.summarizeFacts({
      subject: "RuntimeMemoryProvider",
      time: 20,
      tokenBudget: 8,
    }).items).toHaveLength(1);
  });
});

function buildEpisode(params: {
  episodeId: string;
  taskId: string;
  idempotencyKey: string;
  file: string;
  symbol: string;
  referenceTime: number;
}): RuntimeMemoryEpisodeRecord {
  return buildRuntimeMemoryEpisodeFixture({
    episodeId: params.episodeId,
    taskId: params.taskId,
    idempotencyKey: params.idempotencyKey,
    kind: "verifier_summary",
    reference_time: params.referenceTime,
    boundedSummary: `Sanitized memory evidence for ${params.symbol}.`,
    sourceRefs: [
      { type: "file", ref: params.file, file: params.file },
      {
        type: "symbol",
        ref: params.symbol,
        file: params.file,
        symbol: params.symbol,
      },
    ],
    evidenceRefs: [{ type: "file", ref: params.file }],
  });
}

function sourceEpisodeRef(
  episode: RuntimeMemoryEpisodeRecord,
): RuntimeMemorySourceEpisodeRef {
  return {
    episodeId: episode.episodeId,
    taskId: episode.taskId,
    kind: episode.kind,
    idempotencyKey: episode.idempotencyKey,
    reference_time: episode.reference_time,
  };
}

function factIds(
  facts: readonly { readonly factId: string }[],
): string[] {
  return facts.map((fact) => fact.factId);
}
