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

  it("loads without breakthroughInjection when breakthrough not enabled", () => {
    const dbPath = createTempDb("breakthrough-no-inject");
    persistFacts(dbPath, "task-1", [
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
    expect(result.status).toBe("loaded");
    expect(result.breakthroughInjection).toBeUndefined();
    expect(result.authority.noPromptContextModelMessageInjection).toBe(true);
  });

  it("records breakthroughInjection summary when breakthrough is enabled", () => {
    const dbPath = createTempDb("breakthrough-inject");
    persistFacts(dbPath, "task-1", [
      fact("fact_a", "task-1", "RepoPreference", "package_manager",
        "Use pnpm for installs.", 0.9, 10),
      fact("fact_b", "task-1", "RepoPreference", "formatter",
        "Use oxfmt for formatting.", 0.85, 10),
    ]);

    const result = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
      config: CONFIG,
      loopRunId: "run-3",
      sessionKey: "agent:main:breakthrough-inject",
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
          {
            taskId: "task-1",
            subject: "RepoPreference",
            predicate: "formatter",
            referenceTime: REFERENCE_TIME,
            expectedFactIds: ["fact_b"],
          },
        ],
      },
    });
    expect(result.status).toBe("loaded");
    expect(result.breakthroughInjection).toBeDefined();
    expect(result.breakthroughInjection).toMatchObject({
      arm: "treatment",
      acceptedFactCount: 2,
      acceptedFactsMaxTokens: 512,
      truncatedByTokenBudget: false,
    });
    expect(result.breakthroughInjection?.estimatedTokens).toBeGreaterThan(0);
    expect(result.breakthroughInjection?.estimatedTokens).toBeLessThanOrEqual(512);
  });

  it("marks truncatedByTokenBudget when tokens exceed the cap", () => {
    const dbPath = createTempDb("breakthrough-trunc");
    persistFacts(dbPath, "task-1", [
      fact("fact_a", "task-1", "RepoPreference", "package_manager",
        "Use pnpm for installs across the monorepo.", 0.9, 10),
    ]);

    const result = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
      config: CONFIG,
      loopRunId: "run-4",
      sessionKey: "agent:main:breakthrough-trunc",
      iteration: 0,
      options: {
        explicitOptIn: true,
        testResearchOnly: true,
        testResearchOnlyBreakthrough: true,
        breakthroughInjection: {
          enabled: true,
          arm: "treatment",
          acceptedFactsMaxTokens: 1,
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
            tokenBudget: 512,
          },
        ],
      },
    });
    expect(result.status).toBe("loaded");
    expect(result.breakthroughInjection?.truncatedByTokenBudget).toBe(true);
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
    verificationStatus: overrides.verificationStatus ?? "verified",
    ...(overrides.expired_at !== undefined ? { expired_at: overrides.expired_at } : {}),
    ...(overrides.invalid_at !== undefined ? { invalid_at: overrides.invalid_at } : {}),
  });
}
