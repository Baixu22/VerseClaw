import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRuntimeMemoryContextProvider,
  RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
} from "../../openclaw_runtime/src/context-engine/memory-context-provider";
import {
  createTestContextProviderRegistry,
  LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
  LOOP_CONTEXT_PACK_PROVIDER_ID,
} from "./helpers/context-provider-registry";
import {
  createRuntimeMemoryRuntimeIntegration,
} from "../../openclaw_runtime/src/runtime-core/memory-runtime-integration";
import {
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryInvalidationProposalFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryEpisodeRecord,
  type RuntimeMemorySourceEpisodeRef,
} from "../../openclaw_runtime/src/runtime-core";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime memory runtime integration adapter", () => {
  it("does not open sqlite when persist is false", () => {
    let openCalls = 0;
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: { runtime: { memory: { persist: false } } },
      openDatabase: () => {
        openCalls += 1;
        throw new Error("disabled adapter must not open sqlite");
      },
    });

    expect(integration.migrate()).toEqual({
      status: "skipped",
      reason: "flag_disabled",
      migrated: false,
    });
    expect(integration.appendEpisode(buildEpisode("adapter_disabled", 10)))
      .toEqual({
        status: "skipped",
        reason: "flag_disabled",
        persisted: false,
      });
    expect(integration.appendFact(buildRuntimeMemoryTemporalFactFixture()))
      .toMatchObject({ status: "skipped", reason: "flag_disabled" });
    expect(
      integration.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture()),
    ).toMatchObject({ status: "skipped", reason: "flag_disabled" });

    const loaded = integration.loadStore();
    expect(loaded.status).toBe("skipped");
    expect(loaded.store.stats()).toMatchObject({
      episodes: 0,
      facts: 0,
      invalidations: 0,
    });
    expect(openCalls).toBe(0);
  });

  it("keeps retired persistence disabled and returns no durable store", () => {
    let appendEpisodeCalls = 0;
    let appendFactCalls = 0;
    let invalidateCalls = 0;
    const episode = buildEpisode("adapter_enabled", 20);
    const sourceEpisodeRefs = [sourceEpisodeRef(episode)];
    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "adapter_fact",
      subject: "RuntimeMemoryRuntimeIntegration",
      predicate: "hydrates",
      objectSummary: "A sanitized memory store snapshot.",
      valid_at: 20,
      reference_time: 20,
      sourceEpisodeRefs,
    });
    const persistence = {
      migrate: () => {
        throw new Error("retired persistence must not be reached");
      },
      appendEpisode: () => {
        appendEpisodeCalls += 1;
        throw new Error("retired persistence must not be reached");
      },
      appendFact: () => {
        appendFactCalls += 1;
        throw new Error("retired persistence must not be reached");
      },
      invalidateFact: () => {
        invalidateCalls += 1;
        throw new Error("retired persistence must not be reached");
      },
      persistRelation: () => {
        throw new Error("retired persistence must not be reached");
      },
      recordFactAccess: () => {
        throw new Error("retired persistence must not be reached");
      },
      loadStore: () => {
        throw new Error("retired persistence must not be reached");
      },
    };
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: { runtime: { memory: { persist: true } } },
      persistence,
      now: () => 1_000,
    });

    // TF-0500 retires persist even when config requests it. The former success
    // path is unreachable; this asserts the boundary and no downstream calls.
    expect(integration.migrate()).toEqual({
      status: "skipped",
      reason: "flag_disabled",
      migrated: false,
    });
    expect(integration.appendEpisode(episode)).toEqual({
      status: "skipped",
      reason: "flag_disabled",
      persisted: false,
    });
    expect(integration.appendFact(fact)).toEqual({
      status: "skipped",
      reason: "flag_disabled",
      persisted: false,
    });
    expect(integration.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture({
      invalidationId: "adapter_invalidation",
      factId: fact.factId,
      invalid_at: 30,
      reference_time: 30,
      verificationStatus: "verified",
      sourceEpisodeRefs,
      evidenceRefs: fact.evidenceRefs,
    }))).toEqual({
      status: "skipped",
      reason: "flag_disabled",
      persisted: false,
    });

    const loaded = integration.loadStore();
    expect(loaded.status).toBe("skipped");
    expect(loaded.store.stats()).toMatchObject({ episodes: 0, facts: 0, invalidations: 0 });
    expect({ appendEpisodeCalls, appendFactCalls, invalidateCalls }).toEqual({
      appendEpisodeCalls: 0,
      appendFactCalls: 0,
      invalidateCalls: 0,
    });
  });
  it("keeps retired adapter inspection empty and does not invoke persistence", () => {
    let appendEpisodeCalls = 0;
    let appendFactCalls = 0;
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: { runtime: { memory: { persist: true } } },
      persistence: {
        migrate: () => {
          throw new Error("retired persistence must not be reached");
        },
        appendEpisode: () => {
          appendEpisodeCalls += 1;
          throw new Error("retired persistence must not be reached");
        },
        appendFact: () => {
          appendFactCalls += 1;
          throw new Error("retired persistence must not be reached");
        },
        invalidateFact: () => {
          throw new Error("retired persistence must not be reached");
        },
        persistRelation: () => {
          throw new Error("retired persistence must not be reached");
        },
        recordFactAccess: () => {
          throw new Error("retired persistence must not be reached");
        },
        loadStore: () => {
          throw new Error("retired persistence must not be reached");
        },
      },
      now: () => 4_000,
    });

    // Sanitization of raw episode/fact/invalidation records remains covered by
    // runtime-memory-context-contracts. Persisted episode inspection itself is
    // retired with TF-0500 and cannot be exercised through this adapter.
    expect(integration.appendEpisode(buildEpisode("adapter_inspection_episode", 70)))
      .toEqual({ status: "skipped", reason: "flag_disabled", persisted: false });
    expect(integration.appendFact(buildRuntimeMemoryTemporalFactFixture({
      factId: "adapter_inspection_fact",
    }))).toEqual({ status: "skipped", reason: "flag_disabled", persisted: false });

    const loaded = integration.loadStore();
    expect(loaded.status).toBe("skipped");
    expect(loaded.store.listEpisodes()).toEqual([]);
    expect(loaded.store.stats()).toMatchObject({ episodes: 0, facts: 0, invalidations: 0 });
    expect({ appendEpisodeCalls, appendFactCalls }).toEqual({
      appendEpisodeCalls: 0,
      appendFactCalls: 0,
    });
  });
  it("does not reach the adapter write boundary while persistence is retired", () => {
    const episode = buildEpisode("adapter_raw_episode", 40);
    const sourceEpisodeRefs = [sourceEpisodeRef(episode)];
    const fact = {
      ...buildRuntimeMemoryTemporalFactFixture({
        factId: "adapter_raw_fact",
        sourceEpisodeRefs,
      }),
      objectSummary: "toolArgs: full tool args must stay outside memory",
    };
    const candidate = {
      ...buildRuntimeMemoryTemporalFactCandidateFixture({
        factId: "adapter_raw_candidate",
        sourceEpisodeRefs,
      }),
      objectSummary: "developer prompt must stay outside memory",
    };
    const invalidation = buildRuntimeMemoryInvalidationProposalFixture({
      invalidationId: "adapter_raw_invalidation",
      factId: "adapter_raw_fact",
      sourceEpisodeRefs,
      evidenceRefs: [
        {
          type: "test",
          ref: "tests/unit/runtime-memory-runtime-integration.test.ts",
          summary: "baggage=user=alice",
        },
      ],
    });
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: { runtime: { memory: { persist: true } } },
      database: { path: createTempDbPath() },
      now: () => 2_000,
    });

    // The retirement gate runs before sanitization, so every write reports the
    // same disabled boundary. Raw-retention rejection itself remains covered by
    // the runtime-memory context-contract tests.
    expect(integration.appendEpisode({
      ...episode,
      boundedSummary: "session transcript stored as .jsonl",
    })).toEqual({ status: "skipped", reason: "flag_disabled", persisted: false });
    expect(integration.appendFact(fact))
      .toEqual({ status: "skipped", reason: "flag_disabled", persisted: false });
    expect(integration.appendFact(candidate))
      .toEqual({ status: "skipped", reason: "flag_disabled", persisted: false });
    expect(integration.invalidateFact(invalidation))
      .toEqual({ status: "skipped", reason: "flag_disabled", persisted: false });

    const loaded = integration.loadStore();
    expect(loaded.status).toBe("skipped");
    expect(loaded.store.stats()).toMatchObject({
      episodes: 0,
      facts: 0,
      invalidations: 0,
    });
  });
  it("does not durably store adapter candidates while persistence is retired", () => {
    let appendEpisodeCalls = 0;
    let appendFactCalls = 0;
    const episode = buildEpisode("adapter_candidate_episode", 50);
    const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "adapter_candidate_verified_without_promotion",
      subject: "RuntimeMemoryRuntimeIntegration",
      predicate: "keeps",
      objectSummary: "Verified-looking candidates remain non-durable candidates.",
      verificationStatus: "verified",
      sourceEpisodeRefs: [sourceEpisodeRef(episode)],
    });
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: { runtime: { memory: { persist: true } } },
      persistence: {
        migrate: () => {
          throw new Error("retired persistence must not be reached");
        },
        appendEpisode: () => {
          appendEpisodeCalls += 1;
          throw new Error("retired persistence must not be reached");
        },
        appendFact: () => {
          appendFactCalls += 1;
          throw new Error("retired persistence must not be reached");
        },
        invalidateFact: () => {
          throw new Error("retired persistence must not be reached");
        },
        persistRelation: () => {
          throw new Error("retired persistence must not be reached");
        },
        recordFactAccess: () => {
          throw new Error("retired persistence must not be reached");
        },
        loadStore: () => {
          throw new Error("retired persistence must not be reached");
        },
      },
      now: () => 3_000,
    });

    expect(integration.appendEpisode(episode))
      .toEqual({ status: "skipped", reason: "flag_disabled", persisted: false });
    expect(integration.appendFact(candidate))
      .toEqual({ status: "skipped", reason: "flag_disabled", persisted: false });
    expect(integration.loadStore().store.queryFacts({
      subject: "RuntimeMemoryRuntimeIntegration",
      time: 60,
    })).toEqual([]);
    expect({ appendEpisodeCalls, appendFactCalls }).toEqual({
      appendEpisodeCalls: 0,
      appendFactCalls: 0,
    });
  });
  it("does not hydrate provider context from retired persistence", async () => {
    let appendEpisodeCalls = 0;
    let appendFactCalls = 0;
    let queryCalls = 0;
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: { runtime: { memory: { persist: true } } },
      persistence: {
        migrate: () => {
          throw new Error("retired persistence must not be reached");
        },
        appendEpisode: () => {
          appendEpisodeCalls += 1;
          throw new Error("retired persistence must not be reached");
        },
        appendFact: () => {
          appendFactCalls += 1;
          throw new Error("retired persistence must not be reached");
        },
        invalidateFact: () => {
          throw new Error("retired persistence must not be reached");
        },
        persistRelation: () => {
          throw new Error("retired persistence must not be reached");
        },
        recordFactAccess: () => {
          throw new Error("retired persistence must not be reached");
        },
        loadStore: () => {
          throw new Error("retired persistence must not be reached");
        },
      },
      now: () => 1_100,
    });
    const episode = buildEpisode("adapter_provider_hydration", 40);
    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "adapter_provider_fact",
      taskId: "task_runtime_memory_adapter",
      subject: "ProviderHydration",
      predicate: "uses",
      objectSummary: "Loaded RuntimeMemoryStore query results only.",
      valid_at: 40,
      reference_time: 40,
      sourceEpisodeRefs: [sourceEpisodeRef(episode)],
    });

    expect(integration.appendEpisode(episode))
      .toEqual({ status: "skipped", reason: "flag_disabled", persisted: false });
    expect(integration.appendFact(fact))
      .toEqual({ status: "skipped", reason: "flag_disabled", persisted: false });
    const loaded = integration.loadStore();
    expect(loaded.status).toBe("skipped");
    expect(loaded.store.queryFacts({ subject: "ProviderHydration", time: 50 })).toEqual([]);

    const memoryProvider = createRuntimeMemoryContextProvider({
      config: { runtime: { memory: { provider: true } } },
      queryFacts: () => {
        queryCalls += 1;
        return [fact];
      },
    });
    const registry = createTestContextProviderRegistry([memoryProvider]);
    const result = await registry.resolve(RUNTIME_MEMORY_CONTEXT_PROVIDER_ID)
      ?.getContext({
        taskId: "task_runtime_memory_adapter",
        tokenBudget: 128,
        metadata: { subject: "ProviderHydration", reference_time: 50 },
      });

    expect(result).toMatchObject({ status: "fallback", contextItems: [] });
    expect({ appendEpisodeCalls, appendFactCalls, queryCalls }).toEqual({
      appendEpisodeCalls: 0,
      appendFactCalls: 0,
      queryCalls: 0,
    });
  });
  it("does not let runtime.memory.persist enable provider output", async () => {
    let queryCalls = 0;
    const provider = createRuntimeMemoryContextProvider({
      config: { runtime: { memory: { persist: true, provider: false } } },
      queryFacts: () => {
        queryCalls += 1;
        return [buildRuntimeMemoryTemporalFactFixture({
          factId: "persist_only_fact",
          subject: "PersistOnly",
          predicate: "does_not_enable",
          objectSummary: "Provider output stays behind runtime.memory.provider.",
        })];
      },
    });
    const registry = createTestContextProviderRegistry([provider]);

    expect(registry.listManifests().map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
      RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
    ]);

    const result = await provider.getContext({
      tokenBudget: 128,
      metadata: { subject: "PersistOnly" },
    });

    expect(result).toMatchObject({
      status: "fallback",
      contextItems: [],
      diagnostics: [
        expect.objectContaining({
          reason: "flag_disabled",
          metadata: expect.objectContaining({
            requiredFlag: "runtime.memory.provider",
          }),
        }),
      ],
    });
    expect(queryCalls).toBe(0);
  });
});

function buildEpisode(
  episodeId: string,
  referenceTime: number,
): RuntimeMemoryEpisodeRecord {
  return buildRuntimeMemoryEpisodeFixture({
    episodeId,
    taskId: "task_runtime_memory_adapter",
    kind: "verifier_summary",
    reference_time: referenceTime,
    idempotencyKey: `task_runtime_memory_adapter:${episodeId}`,
    boundedSummary: `Sanitized adapter evidence for ${episodeId}.`,
    sourceRefs: [
      {
        type: "file",
        ref: "src/runtime-core/memory-runtime-integration.ts",
        file: "src/runtime-core/memory-runtime-integration.ts",
      },
    ],
    evidenceRefs: [
      {
        type: "test",
        ref: "tests/unit/runtime-memory-runtime-integration.test.ts",
      },
    ],
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

function createTempDbPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "runtime-memory-adapter-"));
  tempDirs.push(dir);
  return path.join(dir, "openclaw.sqlite");
}
