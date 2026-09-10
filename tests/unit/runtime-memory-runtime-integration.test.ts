import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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

  it("delegates enabled writes and loads a store snapshot through explicit memory records", () => {
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
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: { runtime: { memory: { persist: true } } },
      database: { path: createTempDbPath() },
      now: () => 1_000,
    });

    expect(integration.migrate()).toMatchObject({ status: "migrated" });
    expect(integration.appendEpisode(episode)).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(integration.appendFact(fact)).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(integration.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture({
      invalidationId: "adapter_invalidation",
      factId: fact.factId,
      invalid_at: 30,
      reference_time: 30,
      verificationStatus: "verified",
      sourceEpisodeRefs,
      evidenceRefs: fact.evidenceRefs,
    }))).toMatchObject({
      status: "persisted",
      stored: true,
    });

    const loaded = integration.loadStore();
    expect(loaded.status).toBe("loaded");
    expect(loaded.store.getEpisodeById(episode.episodeId)).toMatchObject({
      episodeId: episode.episodeId,
    });
    expect(loaded.store.getFactById(fact.factId)).toMatchObject({
      factId: fact.factId,
    });
    expect(loaded.store.listInvalidations()).toHaveLength(1);
  });

  it("inspects persisted sanitized episode summaries without raw rows or fact authority", () => {
    const dbPath = createTempDbPath();
    const episode = {
      ...buildEpisode("adapter_inspection_episode", 70),
      metadata: {
        inspectionSafe: true,
        operatorProof: "episode-summary-only",
        noRuntimeAuthority: true,
      },
    };
    const sourceEpisodeRefs = [sourceEpisodeRef(episode)];
    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "adapter_inspection_fact",
      subject: "RuntimeMemoryInspection",
      predicate: "stays_out_of",
      objectSummary: "Episode inspection summaries.",
      valid_at: 70,
      reference_time: 70,
      sourceEpisodeRefs,
    });
    const candidate = buildRuntimeMemoryTemporalFactCandidateFixture({
      factId: "adapter_inspection_candidate",
      subject: "RuntimeMemoryInspection",
      predicate: "remains",
      objectSummary: "A non-durable candidate outside episode inspection.",
      verificationStatus: "verified",
      valid_at: 70,
      reference_time: 70,
      sourceEpisodeRefs,
    });
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: { runtime: { memory: { persist: true } } },
      database: { path: dbPath },
      now: () => 4_000,
    });

    expect(integration.appendEpisode(episode)).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(integration.appendEpisode({
      ...episode,
      episodeId: "adapter_inspection_raw_episode",
      idempotencyKey: "task_runtime_memory_adapter:adapter_inspection_raw_episode",
      boundedSummary: "raw task text with transcript jsonl and toolOutput stdout dump",
    })).toMatchObject({
      status: "rejected",
      persisted: false,
    });
    expect(integration.appendFact(fact)).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(integration.appendFact(candidate)).toMatchObject({
      status: "persisted",
      stored: true,
    });

    const loaded = integration.loadStore();
    expect(loaded.status).toBe("loaded");
    expect(loaded.store.stats()).toMatchObject({
      episodes: 1,
      facts: 2,
      invalidations: 0,
    });

    const inspection = {
      episodeCount: loaded.store.listEpisodes().length,
      episodes: loaded.store.listEpisodes().map((item) => ({
        episodeId: item.episodeId,
        taskId: item.taskId,
        kind: item.kind,
        reference_time: item.reference_time,
        boundedSummary: item.boundedSummary,
        sourceRefs: item.sourceRefs,
        evidenceRefs: item.evidenceRefs,
        redactionStatus: item.redactionStatus,
        metadata: item.metadata,
      })),
    };

    expect(inspection).toEqual({
      episodeCount: 1,
      episodes: [
        expect.objectContaining({
          episodeId: "adapter_inspection_episode",
          taskId: "task_runtime_memory_adapter",
          kind: "verifier_summary",
          reference_time: 70,
          boundedSummary: "Sanitized adapter evidence for adapter_inspection_episode.",
          redactionStatus: "sanitized",
          metadata: expect.objectContaining({
            inspectionSafe: true,
            operatorProof: "episode-summary-only",
            noRuntimeAuthority: true,
          }),
          sourceRefs: [
            expect.objectContaining({
              type: "file",
              ref: "src/runtime-core/memory-runtime-integration.ts",
            }),
          ],
          evidenceRefs: [
            expect.objectContaining({
              type: "test",
              ref: "tests/unit/runtime-memory-runtime-integration.test.ts",
            }),
          ],
        }),
      ],
    });

    const inspectionJson = JSON.stringify(inspection);
    expect(inspectionJson).not.toContain("raw task text");
    expect(inspectionJson).not.toContain("transcript");
    expect(inspectionJson).not.toContain("jsonl");
    expect(inspectionJson).not.toContain("toolOutput");
    expect(inspectionJson).not.toContain("stdout");
    expect(inspectionJson).not.toContain("stderr");
    expect(inspectionJson).not.toContain("process.env");
    expect(inspectionJson).not.toContain("secret");
    expect(inspectionJson).not.toContain("traceparent");
    expect(inspectionJson).not.toContain("tracestate");
    expect(inspectionJson).not.toContain("baggage");
    expect(inspectionJson).not.toContain("record_json");
    expect(inspectionJson).not.toContain("raw row");
    expect(inspectionJson).not.toContain("adapter_inspection_fact");
    expect(inspectionJson).not.toContain("adapter_inspection_candidate");
    expect(inspectionJson).not.toContain("ProviderHydration");
    expect(inspectionJson).not.toContain("RuntimeMemoryProvider");
    expect(inspectionJson).not.toContain("completionAuthority");
    expect(inspectionJson).not.toContain("verifierAuthority");
    expect(inspectionJson).not.toContain("securityAuthority");
    expect(inspectionJson).not.toContain("retryAuthority");
    expect(inspectionJson).not.toContain("toolAuthority");
    expect(inspectionJson).not.toContain("runtimeAuthority");
  });

  it("rejects raw retention markers at the adapter write boundary", () => {
    const dbPath = createTempDbPath();
    const episode = buildEpisode("adapter_raw_episode", 40);
    const sourceEpisodeRefs = [sourceEpisodeRef(episode)];
    const fact = {
      ...buildRuntimeMemoryTemporalFactFixture({
        factId: "adapter_raw_fact",
        sourceEpisodeRefs,
      }),
      factId: "adapter_raw_fact",
      objectSummary: "toolArgs: full tool args must stay outside memory",
    };
    const candidate = {
      ...buildRuntimeMemoryTemporalFactCandidateFixture({
        factId: "adapter_raw_candidate",
        sourceEpisodeRefs,
      }),
      factId: "adapter_raw_candidate",
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
      database: { path: dbPath },
      now: () => 2_000,
    });

    expect(integration.appendEpisode({
      ...episode,
      boundedSummary: "session transcript stored as .jsonl",
    })).toMatchObject({
      status: "rejected",
      reason: "raw_transcript",
      persisted: false,
    });
    expect(integration.appendFact(fact)).toMatchObject({
      status: "rejected",
      reason: "full_tool_args",
      persisted: false,
    });
    expect(integration.appendFact(candidate)).toMatchObject({
      status: "rejected",
      reason: "prompt",
      persisted: false,
    });
    expect(integration.invalidateFact(invalidation)).toMatchObject({
      status: "rejected",
      reason: "trace_baggage",
      persisted: false,
    });

    const loaded = integration.loadStore();
    expect(loaded.status).toBe("loaded");
    expect(loaded.store.stats()).toMatchObject({
      episodes: 0,
      facts: 0,
      invalidations: 0,
    });
  });

  it("keeps adapter candidates non-durable without promotion fields", () => {
    const dbPath = createTempDbPath();
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
      database: { path: dbPath },
      now: () => 3_000,
    });

    expect(integration.appendEpisode(episode)).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(integration.appendFact(candidate)).toMatchObject({
      status: "persisted",
      stored: true,
    });
    expect(integration.loadStore().store.queryFacts({
      subject: "RuntimeMemoryRuntimeIntegration",
      time: 60,
    })).toEqual([]);
    expect(integration.loadStore().store.queryFacts({
      subject: "RuntimeMemoryRuntimeIntegration",
      time: 60,
      status: "verified",
    }).map((fact) => fact.factId)).toEqual([
      "adapter_candidate_verified_without_promotion",
    ]);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare(
        "SELECT record_kind, accepted_at, promotion_json, record_json FROM runtime_memory_facts WHERE fact_id = ?",
      ).get(candidate.factId) as {
        record_kind?: unknown;
        accepted_at?: unknown;
        promotion_json?: unknown;
        record_json?: unknown;
      };
      const record = JSON.parse(String(row.record_json)) as Record<string, unknown>;

      expect(row.record_kind).toBe("candidate");
      expect(row.accepted_at).toBeNull();
      expect(row.promotion_json).toBeNull();
      expect(record.acceptedAt).toBeUndefined();
      expect(record.promotion).toBeUndefined();
      expect(record.proposedAt).toBeDefined();
    } finally {
      db.close();
    }
  });

  it("hydrates provider context only through explicit extra-provider injection from a loaded store", async () => {
    const episode = buildEpisode("adapter_provider_hydration", 40);
    const sourceEpisodeRefs = [sourceEpisodeRef(episode)];
    const fact = buildRuntimeMemoryTemporalFactFixture({
      factId: "adapter_provider_fact",
      taskId: "task_runtime_memory_adapter",
      subject: "ProviderHydration",
      predicate: "uses",
      objectSummary: "Loaded RuntimeMemoryStore query results only.",
      valid_at: 40,
      reference_time: 40,
      sourceEpisodeRefs,
      metadata: {
        sourceBody: "RAW_ROW_DO_NOT_LEAK",
      },
    });
    const integration = createRuntimeMemoryRuntimeIntegration({
      config: { runtime: { memory: { persist: true } } },
      database: { path: createTempDbPath() },
      now: () => 1_100,
    });

    integration.appendEpisode(episode);
    integration.appendFact(fact);
    const loaded = integration.loadStore();
    expect(loaded.status).toBe("loaded");
    expect(loaded.store.queryFacts({
      subject: "ProviderHydration",
      time: 50,
    }).map((item) => item.factId)).toEqual(["adapter_provider_fact"]);

    const memoryProvider = createRuntimeMemoryContextProvider({
      config: { runtime: { memory: { provider: true } } },
      queryFacts: (query) => loaded.store.queryFacts(query) as never,
    });
    const registry = createTestContextProviderRegistry([memoryProvider]);

    expect(registry.listManifests().map((manifest) => manifest.id)).toEqual([
      LEGACY_CONTEXT_ENGINE_PROVIDER_ID,
      LOOP_CONTEXT_PACK_PROVIDER_ID,
      RUNTIME_MEMORY_CONTEXT_PROVIDER_ID,
    ]);

    const result = await registry.resolve(RUNTIME_MEMORY_CONTEXT_PROVIDER_ID)
      ?.getContext({
        taskId: "task_runtime_memory_adapter",
        tokenBudget: 128,
        metadata: {
          subject: "ProviderHydration",
          reference_time: 50,
        },
      });

    expect(result).toBeDefined();
    expect(result).toMatchObject({
      status: "success",
      contextItems: [
        expect.objectContaining({
          id: "runtime-memory:adapter_provider_fact",
          kind: "memory",
          metadata: expect.objectContaining({
            readonlyMemoryContext: true,
            noMemoryDump: true,
            noCompletionAuthority: true,
            noVerifierAuthority: true,
            noSecurityAuthority: true,
            noRetryAuthority: true,
            noToolAuthority: true,
            noRuntimeAuthority: true,
          }),
        }),
      ],
      metadata: expect.objectContaining({
        readonlyMemoryContext: true,
        noMemoryDump: true,
        noRuntimeAuthority: true,
      }),
    });
    expect(JSON.stringify(result)).not.toContain("RAW_ROW_DO_NOT_LEAK");
    expect(JSON.stringify(result)).not.toContain("record_json");
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
