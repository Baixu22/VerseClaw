/**
 * Regression tests for subagent spawn-quota release (issue #32).
 *
 * A failed subagent whose completion announce/cleanup bookkeeping has not
 * finished (e.g. the announce is stuck on "no visible reply") must not keep
 * occupying a spawn slot forever. countActiveRunsForSessionFromRuns counts
 * only children that are STILL RUNNING, so a finished run releases its slot
 * even when cleanup is still pending.
 */
import { describe, expect, it } from "vitest";
import {
  countActiveRunsForSessionFromRuns,
  countPendingDescendantRunsFromRuns,
} from "./subagent-registry-queries.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const CONTROLLER = "agent:main:main";

function makeRun(overrides: Partial<SubagentRunRecord>): SubagentRunRecord {
  const now = Date.now();
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`,
    childSessionKey: `agent:main:subagent:${Math.random().toString(36).slice(2)}`,
    controllerSessionKey: CONTROLLER,
    requesterSessionKey: CONTROLLER,
    requesterDisplayKey: CONTROLLER,
    task: "test task",
    cleanup: "delete",
    createdAt: now,
    ...overrides,
  };
}

function toMap(runs: SubagentRunRecord[]): Map<string, SubagentRunRecord> {
  return new Map(runs.map((run) => [run.runId, run]));
}

describe("subagent spawn quota release (issue #32)", () => {
  it('does not release capacity merely because an unended execution is old', () => {
    const runs = toMap([makeRun({ createdAt: Date.now() - 3 * 60 * 60 * 1000,
      startedAt: Date.now() - 3 * 60 * 60 * 1000, execution: { status: 'running' } })]);
    expect(countActiveRunsForSessionFromRuns(runs, CONTROLLER)).toBe(1);
  });

  it('retains an ended parent slot while its old descendant still has no terminal evidence', () => {
    const parent = makeRun({ endedAt: Date.now() - 10_000 });
    const child = makeRun({ controllerSessionKey: parent.childSessionKey, requesterSessionKey: parent.childSessionKey,
      createdAt: Date.now() - 3 * 60 * 60 * 1000, startedAt: Date.now() - 3 * 60 * 60 * 1000 });
    expect(countActiveRunsForSessionFromRuns(toMap([parent, child]), CONTROLLER)).toBe(1);
  });

  it("counts only still-running children, even when cleanup is pending", () => {
    const runs = toMap([
      // Live run: still occupies a slot.
      makeRun({}),
      // Finished run with cleanup still pending (announce stuck / cleanup not
      // yet completed): must NOT occupy a slot.
      makeRun({ endedAt: Date.now() - 5_000, cleanupCompletedAt: undefined }),
      // Finished run with cleanup completed: never counts.
      makeRun({ endedAt: Date.now() - 5_000, cleanupCompletedAt: Date.now() - 4_000 }),
    ]);

    expect(countActiveRunsForSessionFromRuns(runs, CONTROLLER)).toBe(1);
  });

  it("counts zero once every child in the lineage has finished, even with cleanup pending", () => {
    const parent = makeRun({ endedAt: Date.now() - 5_000, cleanupCompletedAt: undefined });
    const child = makeRun({
      requesterSessionKey: parent.childSessionKey,
      endedAt: Date.now() - 3_000,
      cleanupCompletedAt: undefined,
    });
    const runs = toMap([parent, child]);

    expect(countActiveRunsForSessionFromRuns(runs, CONTROLLER)).toBe(0);
    // The display-facing count keeps the old semantics (ended-but-uncleaned
    // still counts as pending); only the spawn-quota gate was relaxed.
    expect(countPendingDescendantRunsFromRuns(runs, parent.childSessionKey)).toBe(1);
  });
});
