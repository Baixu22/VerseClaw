import { describe, expect, it } from "vitest";
import {
  ResourceAwareWaveScheduler,
} from "../../openclaw_runtime/src/agents/resource-aware-wave-scheduler.js";
import type { OrchestrationTaskGraph } from "../../openclaw_runtime/src/agents/orchestration-protocol.js";

/**
 * Stage 3, criterion 3.9: A5 wave immutability.
 *
 * Once a wave has been started, re-planning that wave (via `appliesToWave`)
 * must be ignored. Only waves still in "planned" status can be re-planned.
 */
function makeGraph(nodeCount: number): OrchestrationTaskGraph {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    taskNodeId: `task-${i + 1}`,
    roleName: "worker",
    task: `Task ${i + 1}`,
    phase: "worker" as const,
    dependsOn: [] as string[],
    scope: "default",
    requiredCapabilities: [],
    attemptPolicy: { maxRepairAttempts: 0, maxRedoAttempts: 0 },
    status: "planned" as const,
    isVerifier: false,
  }));
  return {
    graphRunId: "run-1",
    mode: "router" as never,
    status: "planned",
    nodes,
    edges: [],
  };
}

describe("Stage 3 / 3.9: A5 wave immutability (ResourceAwareWaveScheduler)", () => {
  it("plans waves with the given worker cap", () => {
    const scheduler = new ResourceAwareWaveScheduler(makeGraph(6), { maxWorkers: 2 });
    const waves = scheduler.plan();
    // 6 tasks / 2 workers = 3 waves
    expect(waves).toHaveLength(3);
    expect(waves[0].wave).toBe(1);
    expect(waves[0].taskNodeIds).toEqual(["task-1", "task-2"]);
    expect(waves[0].status).toBe("planned");
    expect(waves[0].maxWorkers).toBe(2);
  });

  it("marks a wave as started via startWave", () => {
    const scheduler = new ResourceAwareWaveScheduler(makeGraph(4), { maxWorkers: 2 });
    scheduler.plan();
    expect(scheduler.getWaveStatus(1)).toBe("planned");
    scheduler.startWave(1);
    expect(scheduler.getWaveStatus(1)).toBe("started");
  });

  it("ignores rePlan when appliesToWave is already started", () => {
    const scheduler = new ResourceAwareWaveScheduler(makeGraph(6), { maxWorkers: 2 });
    scheduler.plan();
    scheduler.startWave(1);

    const result = scheduler.rePlan({ appliesToWave: 1, maxWorkers: 1 });

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toBe("wave_started");
      expect(result.waveNumber).toBe(1);
    }
    // Wave 1 must be unchanged.
    expect(scheduler.getWave(1)?.maxWorkers).toBe(2);
    expect(scheduler.getWaveStatus(1)).toBe("started");
  });

  it("accepts rePlan when appliesToWave is still planned", () => {
    const scheduler = new ResourceAwareWaveScheduler(makeGraph(6), { maxWorkers: 2 });
    scheduler.plan();
    scheduler.startWave(1);
    // Wave 2 is still planned.
    expect(scheduler.getWaveStatus(2)).toBe("planned");

    const result = scheduler.rePlan({ appliesToWave: 2, maxWorkers: 1 });

    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.replannedWaves).toContain(2);
      expect(result.replannedWaves).toContain(3);
    }
    // Wave 2 now has maxWorkers=1.
    expect(scheduler.getWave(2)?.maxWorkers).toBe(1);
    // Wave 3 also re-planned (it's after wave 2).
    expect(scheduler.getWave(3)?.maxWorkers).toBe(1);
    // Wave 1 (started) is unchanged.
    expect(scheduler.getWave(1)?.maxWorkers).toBe(2);
  });

  it("rejects rePlan for a non-existent wave", () => {
    const scheduler = new ResourceAwareWaveScheduler(makeGraph(2), { maxWorkers: 2 });
    scheduler.plan();

    const result = scheduler.rePlan({ appliesToWave: 99 });

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toBe("wave_not_found");
    }
  });

  it("rejects rePlan when there is no change (same workers, same graph)", () => {
    const scheduler = new ResourceAwareWaveScheduler(makeGraph(4), { maxWorkers: 2 });
    scheduler.plan();

    const result = scheduler.rePlan({ appliesToWave: 1, maxWorkers: 2 });

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toBe("no_change");
    }
  });

  it("ignores rePlan for a completed wave", () => {
    const scheduler = new ResourceAwareWaveScheduler(makeGraph(6), { maxWorkers: 2 });
    scheduler.plan();
    scheduler.startWave(1);
    scheduler.completeWave(1);

    const result = scheduler.rePlan({ appliesToWave: 1, maxWorkers: 1 });

    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.reason).toBe("wave_started");
    }
  });

  it("preserves started wave's taskNodeIds after rejected rePlan", () => {
    const scheduler = new ResourceAwareWaveScheduler(makeGraph(6), { maxWorkers: 2 });
    scheduler.plan();
    scheduler.startWave(1);
    const originalIds = scheduler.getWave(1)?.taskNodeIds;

    scheduler.rePlan({ appliesToWave: 1, maxWorkers: 1 });

    expect(scheduler.getWave(1)?.taskNodeIds).toEqual(originalIds);
  });

  it("does not re-plan earlier waves when a later wave is re-planned", () => {
    const scheduler = new ResourceAwareWaveScheduler(makeGraph(6), { maxWorkers: 2 });
    scheduler.plan();
    scheduler.startWave(1);

    const result = scheduler.rePlan({ appliesToWave: 2, maxWorkers: 1 });

    expect(result.accepted).toBe(true);
    // Wave 1 (started) must NOT be in replannedWaves.
    if (result.accepted) {
      expect(result.replannedWaves).not.toContain(1);
    }
  });

  it("startWave throws for unknown wave", () => {
    const scheduler = new ResourceAwareWaveScheduler(makeGraph(2), { maxWorkers: 2 });
    scheduler.plan();
    expect(() => scheduler.startWave(99)).toThrow("Cannot start unknown wave");
  });

  it("completeWave marks wave as completed", () => {
    const scheduler = new ResourceAwareWaveScheduler(makeGraph(4), { maxWorkers: 2 });
    scheduler.plan();
    scheduler.startWave(1);
    scheduler.completeWave(1);
    expect(scheduler.getWaveStatus(1)).toBe("completed");
  });

  it("getWaves returns all waves in order", () => {
    const scheduler = new ResourceAwareWaveScheduler(makeGraph(6), { maxWorkers: 2 });
    const waves = scheduler.plan();
    expect(waves.map((w) => w.wave)).toEqual([1, 2, 3]);
  });
});
