// @vitest-environment node
// Phase 36 enhanced evaluation — Dimension 4: Topic Drift.
// Verifies that subject-scoped queries do not cross-contaminate across topics
// and that recall recovers immediately after a topic switch.

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import {
  buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
  type TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
} from "../../openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow";
import {
  buildTopicSegments,
  evaluateTopicDrift,
  type TopicSegment,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/topic-drift-eval";
import {
  appendFactToDb,
  createTempDbPath,
  RUNTIME_MEMORY_EVAL_CONFIG,
} from "./helpers/runtime-memory-eval-helpers";
import { createRuntimeMemoryPersistenceStore } from "../../openclaw_runtime/src/runtime-core/memory-persistence";

const CONFIG = RUNTIME_MEMORY_EVAL_CONFIG;
const tempDirs: string[] = [];

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  closeRuntimeMemoryHydrationShadowDatabasesForTest();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const TASK_ID = "task_topic_drift";
const REFERENCE_TIME = 1_000;
const TOPIC_COUNT = 3;
const TURNS_PER_TOPIC = 4;

describe("runtime memory topic drift evaluation", () => {
  it("builds 3 segments × 4 turns = 12 total queries", () => {
    const segments = buildTopicSegments({
      topicCount: TOPIC_COUNT,
      turnsPerTopic: TURNS_PER_TOPIC,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
    });

    expect(segments).toHaveLength(3);
    expect(segments[0].topicId).toBe("topic_0");
    expect(segments[1].subject).toBe("TopicSubject_1");
    expect(segments[2].queries).toHaveLength(TURNS_PER_TOPIC);
    const totalQueries = segments.reduce((sum, s) => sum + s.queries.length, 0);
    expect(totalQueries).toBe(12);
  });

  it("keeps retired topic-drift evaluation from seeding or reading a database", () => {
    const segments = buildTopicSegments({
      topicCount: TOPIC_COUNT,
      turnsPerTopic: TURNS_PER_TOPIC,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
    });

    // TF-0500 retired runtime.memory.persist; both the fixture seeding above and
    // the read-hydration shadow diagnostics below depend on it.
    expect(segments).toHaveLength(TOPIC_COUNT);

    const dbPath = createTempDbPath("topic-retired-", tempDirs);
    expect(tryInitializeDb(dbPath)).toBe("flag_disabled");
    expect(() => appendFactToDb(dbPath, segments[0].writeFact)).toThrow(/appendFact failed .*status=skipped/);
  });

  it("still aggregates a fully supplied topic-drift scenario without persistence", () => {
    const segments = buildTopicSegments({
      topicCount: TOPIC_COUNT,
      turnsPerTopic: TURNS_PER_TOPIC,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
    });
    // Use the real diagnostics builder so the shape stays authoritative. Without
    // the retired persist/hydration path it reports skipped and recalls nothing.
    const diagnostics = segments
      .flatMap((seg) => seg.queries)
      .map((query, index) =>
        buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
          config: CONFIG,
          options: {},
          loopRunId: `topic-retired-${index}`,
          sessionKey: "agent:main:topic-drift",
          iteration: index,
          query,
        } as never),
      );

    const result = evaluateTopicDrift(segments, diagnostics);
    expect(result.totalTurns).toBe(TOPIC_COUNT * TURNS_PER_TOPIC);
  });
});

function tryInitializeDb(dbPath: string): string {
  const persistence = createRuntimeMemoryPersistenceStore({
    config: CONFIG,
    database: { path: dbPath },
    now: () => REFERENCE_TIME,
  });
  const result = persistence.migrate();
  return result.status === "skipped" ? result.reason : result.status;
}

function _runTopicDiagnostics(
  segments: readonly TopicSegment[],
  dbPath: string,
): TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics[] {
  const results: TaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics[] = [];
  let globalTurn = 0;
  for (const segment of segments) {
    for (const query of segment.queries) {
      const diag = buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
        config: CONFIG,
        loopRunId: `topic_drift_${globalTurn}`,
        sessionKey: "agent:main:topic-drift",
        iteration: globalTurn,
        options: {
          explicitOptIn: true,
          testResearchOnly: true,
          databasePath: dbPath,
          limit: 50,
          maxFacts: 200,
          now: () => REFERENCE_TIME,
          queries: [
            {
              queryId: query.queryId,
              taskId: query.taskId,
              subject: query.subject,
              predicate: query.predicate,
              referenceTime: query.referenceTime,
              tokenBudget: query.tokenBudget,
              limit: query.limit,
              expectedFactIds: [...query.expectedFactIds],
            },
          ],
        },
      });
      results.push(diag);
      globalTurn += 1;
    }
  }
  return results;
}
