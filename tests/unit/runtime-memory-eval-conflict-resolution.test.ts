// @vitest-environment node
// Phase 37 enhanced evaluation — Dimension 7: Conflict Resolution.
// Verifies that the consumer's selectConflictWinners picks the correct winner
// when multiple facts share the same (taskId, subject, predicate).

import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { closeOpenClawStateDatabaseForTest } from "../../openclaw_runtime/src/state/openclaw-state-db";
import { closeRuntimeMemoryHydrationShadowDatabasesForTest } from "../../openclaw_runtime/src/runtime-core/memory-read-hydration-shadow";
import {
  buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics,
} from "../../openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow";
import {
  buildConflictScenario,
  evaluateConflictResolution,
} from "../../openclaw_runtime/src/agents/runtime-memory-eval/conflict-resolution-eval";
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

const TASK_ID = "task_conflict_resolution";
const REFERENCE_TIME = 1_000;
const GROUP_COUNT = 6; // 2 groups per pattern (confidence, valid_at, factId)

describe("runtime memory conflict resolution evaluation", () => {
  it("buildConflictScenario generates groupCount groups × 3 facts each", () => {
    const scenario = buildConflictScenario({
      groupCount: GROUP_COUNT,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
    });

    expect(scenario).toHaveLength(GROUP_COUNT);
    for (const group of scenario) {
      expect(group.facts).toHaveLength(3);
      expect(group.expectedWinnerFactId).toBeTruthy();
      expect(group.query.expectedFactIds).toEqual([group.expectedWinnerFactId]);
    }
  });

  it("keeps retired conflict evaluation from seeding or reading a database", () => {
    const scenario = buildConflictScenario({
      groupCount: GROUP_COUNT,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
    });

    // TF-0500 retired runtime.memory.persist; seeding and diagnostics both need it.
    expect(scenario).toHaveLength(GROUP_COUNT);

    const dbPath = createTempDbPath("conflict-retired-", tempDirs);
    expect(tryInitializeDb(dbPath)).toBe("flag_disabled");
    expect(() => appendFactToDb(dbPath, scenario[0].facts[0])).toThrow(/appendFact failed .*status=skipped/);
  });

  it("still aggregates a fully supplied conflict scenario without persistence", () => {
    const scenario = buildConflictScenario({
      groupCount: GROUP_COUNT,
      taskId: TASK_ID,
      referenceTime: REFERENCE_TIME,
    });
    const diagnostics = scenario.map((group, index) =>
      buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics({
        config: CONFIG,
        options: {},
        loopRunId: `conflict-retired-${index}`,
        sessionKey: "agent:main:conflict",
        iteration: index,
        query: group.query,
      } as never),
    );

    // With no accepted facts every group is a wrong winner and every candidate
    // counts as suppressed: the correct degenerate result while the
    // persistence-backed evaluation path is retired.
    const result = evaluateConflictResolution(scenario, diagnostics);
    expect(result.wrongConflictWinnerRate).toBe(1);
    expect(result.conflictSuppressionRate).toBe(1);
    expect(result.totalConflicts).toBe(GROUP_COUNT * 3);
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
