// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildEvidenceRefFixture,
  buildRuntimeMemoryEpisodeFixture,
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryEpisodeRecord,
  type RuntimeMemoryTemporalFact,
  type RuntimeMemoryVerificationStatus,
} from "../../openclaw_runtime/src/runtime-core";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import {
  buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
} from "../../openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";

const REFERENCE_TIME = 100;
const CONFIG = { runtime: { memory: { persist: true } } } as const;

const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("testResearchOnly breakthrough injection gate", () => {
  it("skips when testResearchOnly is not set", () => {
    const result = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
      config: CONFIG,
      loopRunId: "run-1",
      sessionKey: "agent:main:breakthrough-skip",
      iteration: 0,
      options: {
        explicitOptIn: true,
        databasePath: path.join(os.tmpdir(), "must-not-open.sqlite"),
        queries: [],
      },
    });
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("test_research_gate_required");
    expect(result.breakthroughInjection).toBeUndefined();
  });

  it("keeps the retired seed step from enabling breakthrough injection", () => {
    const dbPath = createTempDb("breakthrough-no-inject");

    // TF-0500 retired runtime.memory.persist; persistFacts writes through the
    // store that can no longer be enabled, so no facts reach the hydration step.
    persistFactsUnchecked(dbPath, "task-1", [
      fact("fact_a", "task-1", "RepoPreference", "package_manager",
        "Use pnpm for installs.", 0.9, 10),
    ]);

    const result = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
      config: CONFIG,
      loopRunId: "run-2",
      sessionKey: "agent:main:breakthrough-no-inject",
      iteration: 0,
      options: {
        explicitOptIn: true,
        testResearchOnly: true,
        databasePath: dbPath,
        limit: 4,
        maxFacts: 4,
        now: () => REFERENCE_TIME,
        queries: [
          {
            taskId: "task-1",
            subject: "RepoPreference",
            predicate: "package_manager",
            referenceTime: REFERENCE_TIME,
            expectedFactIds: ["fact_a"],
          },
        ],
      },
    });
    expect(result.status).toBe("skipped");
    expect(result.breakthroughInjection).toBeUndefined();
    expect(result.authority.noPromptContextModelMessageInjection).toBe(true);
  });

  it("never records a breakthrough summary while persistence is retired", () => {
    const dbPath = createTempDb("breakthrough-inject");
    persistFactsUnchecked(dbPath, "task-1", [
      fact("fact_a", "task-1", "RepoPreference", "package_manager",
        "Use pnpm for installs.", 0.9, 10),
    ]);

    const result = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
      config: CONFIG,
      loopRunId: "run-3",
      sessionKey: "agent:main:breakthrough-inject",
      iteration: 0,
      options: {
        explicitOptIn: true,
        testResearchOnly: true,
        databasePath: dbPath,
        limit: 4,
        maxFacts: 4,
        now: () => REFERENCE_TIME,
        queries: [
          {
            taskId: "task-1",
            subject: "RepoPreference",
            predicate: "package_manager",
            referenceTime: REFERENCE_TIME,
            expectedFactIds: ["fact_a"],
          },
        ],
      },
    });
    expect(result.status).toBe("skipped");
    expect(result.breakthroughInjection).toBeUndefined();
  });

  it("cannot reach the token-budget truncation path while retired", () => {
    const dbPath = createTempDb("breakthrough-truncate");
    persistFactsUnchecked(dbPath, "task-1", [
      fact("fact_a", "task-1", "RepoPreference", "package_manager",
        "Use pnpm for installs.", 0.9, 10),
    ]);

    const result = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
      config: CONFIG,
      loopRunId: "run-4",
      sessionKey: "agent:main:breakthrough-truncate",
      iteration: 0,
      options: {
        explicitOptIn: true,
        testResearchOnly: true,
        databasePath: dbPath,
        limit: 4,
        maxFacts: 4,
        now: () => REFERENCE_TIME,
        queries: [
          {
            taskId: "task-1",
            subject: "RepoPreference",
            predicate: "package_manager",
            referenceTime: REFERENCE_TIME,
            expectedFactIds: ["fact_a"],
          },
        ],
      },
    });
    expect(result.status).toBe("skipped");
    expect(result.hydration?.factProjectionCount ?? 0).toBe(0);
  });



  it("preserves the authority boundary in the breakthrough path", () => {
    const dbPath = createTempDb("breakthrough-auth");
    persistFacts(dbPath, "task-1", [
      fact("fact_a", "task-1", "RepoPreference", "package_manager",
        "Use pnpm for installs.", 0.9, 10),
    ]);

    const result = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
      config: CONFIG,
      loopRunId: "run-5",
      sessionKey: "agent:main:breakthrough-auth",
      iteration: 0,
      options: {
        explicitOptIn: true,
        testResearchOnly: true,
        testResearchOnlyBreakthrough: true,
        breakthroughInjection: {
          enabled: true,
          arm: "treatment",
          acceptedFactsMaxTokens: 512,
        },
        databasePath: dbPath,
        limit: 4,
        maxFacts: 4,
        now: () => REFERENCE_TIME,
        queries: [
          {
            taskId: "task-1",
            subject: "RepoPreference",
            predicate: "package_manager",
            referenceTime: REFERENCE_TIME,
            expectedFactIds: ["fact_a"],
          },
        ],
      },
    });
    expect(result.authority).toMatchObject({
      diagnosticsOnly: true,
      readonly: true,
      shadowOnly: true,
      noPromptInjection: true,
      noPromptContextModelMessageInjection: true,
      noTaskLoopDecisionAuthority: true,
      noProviderOrdering: true,
      noDurableFactAuthority: true,
      noMemoryWriteAuthority: true,
    });
  });
});

function createTempDb(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), `phase36-${prefix}-`));
  tempDirs.push(dir);
  return path.join(dir, "runtime-memory.sqlite");
}

function persistFacts(
  dbPath: string,
  taskId: string,
  facts: readonly RuntimeMemoryTemporalFact[],
): void {
  const episode = buildEpisode(taskId, "ep-1", 10);
  let now = 1_000;
  const persistence = createRuntimeMemoryPersistenceStore({
    config: CONFIG,
    database: { path: dbPath },
    now: () => now++,
  });
  persistence.migrate();
  persistence.appendEpisode(episode);
  for (const f of facts) {
    persistence.appendFact(f);
  }
}

function buildEpisode(
  taskId: string,
  episodeId: string,
  referenceTime: number,
): RuntimeMemoryEpisodeRecord {
  return buildRuntimeMemoryEpisodeFixture({
    episodeId: `episode_${episodeId}`,
    taskId,
    kind: "verifier_summary",
    reference_time: referenceTime,
    idempotencyKey: `${taskId}:${episodeId}`,
    boundedSummary: `Phase 36 breakthrough evidence for ${episodeId}.`,
    sourceRefs: [
      {
        type: "test",
        ref: "tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts",
      },
    ],
    evidenceRefs: [
      buildEvidenceRefFixture({
        type: "test",
        ref: "tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts",
      }),
    ],
  });
}

function fact(
  factId: string,
  taskId: string,
  subject: string,
  predicate: string,
  objectSummary: string,
  confidence: number,
  validAt: number,
  overrides: Partial<{
    expired_at: number;
    invalid_at: number;
    verificationStatus: RuntimeMemoryVerificationStatus;
  }> = {},
): RuntimeMemoryTemporalFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId,
    taskId,
    subject,
    predicate,
    objectSummary,
    confidence,
    valid_at: validAt,
    reference_time: validAt,
    verificationStatus: (overrides.verificationStatus ?? "verified") as never,
    ...(overrides.expired_at !== undefined ? { expired_at: overrides.expired_at } : {}),
    ...(overrides.invalid_at !== undefined ? { invalid_at: overrides.invalid_at } : {}),
  });
}


// TF-0500 retired persist, so persistFacts() silently writes nothing; this wrapper
// keeps the call shape explicit without asserting a throw that never happens.
function persistFactsUnchecked(dbPath: string, taskId: string, facts: readonly RuntimeMemoryTemporalFact[]): void {
  persistFacts(dbPath, taskId, facts);
}