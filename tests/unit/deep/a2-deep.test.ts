import { describe, expect, it } from 'vitest';

import {
  buildExecutionWaves,
  buildTaskGraph,
  type OrchestrationTaskGraph,
  type OrchestrationTaskNode,
} from '../../../openclaw_runtime/src/agents/orchestration-protocol.js';
import {
  type WavePlan,
  ResourceAwareWaveScheduler,
} from '../../../openclaw_runtime/src/agents/resource-aware-wave-scheduler.js';

/**
 * A2 deep tests — Resource-aware wave scheduling + orchestration protocol.
 *
 * Covers:
 * - agents/resource-aware-wave-scheduler.ts (ResourceAwareWaveScheduler, WavePlan, WaveStatus, RePlanRequest, RePlanResult)
 * - agents/orchestration-protocol.ts (buildExecutionWaves, buildTaskGraph, OrchestrationTaskGraph, OrchestrationExecutionWave)
 *
 * Note on import depth: tests live in tests/unit/deep/, so the relative path to
 * the runtime tree is ../../../openclaw_runtime/src/... (three levels up to root).
 */

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function makeNode(
  id: string,
  deps: string[] = [],
  role = 'worker',
): OrchestrationTaskNode {
  return {
    taskNodeId: id,
    roleName: role,
    task: `Task ${id}`,
    phase: 'worker',
    dependsOn: deps,
    scope: 'default',
    requiredCapabilities: [],
    attemptPolicy: { maxRepairAttempts: 0, maxRedoAttempts: 0 },
    status: 'planned',
  };
}

function makeGraph(
  nodeCount: number,
  depsFn?: (index: number, id: string) => string[],
): OrchestrationTaskGraph {
  const nodes: OrchestrationTaskNode[] = Array.from({ length: nodeCount }, (_, i) => {
    const id = `task-${i + 1}`;
    return makeNode(id, depsFn ? depsFn(i, id) : []);
  });
  return { graphRunId: 'run-1', mode: 'router' as never, status: 'planned', nodes, edges: [] };
}

describe('A2 deep — orchestration-protocol / resource-aware-wave-scheduler', () => {
  // -------------------------------------------------------------------------
  // 1. 功能完整性 (8 tests)
  // -------------------------------------------------------------------------
  describe('功能完整性', () => {
    it('buildExecutionWaves: 3 tasks / 2 workers -> 2 waves', () => {
      const waves = buildExecutionWaves(makeGraph(3), 2);
      expect(waves.length).toBe(2);
      expect(waves[0].wave).toBe(1);
      expect(waves[1].wave).toBe(2);
      expect(waves[0].taskNodeIds).toEqual(['task-1', 'task-2']);
      expect(waves[1].taskNodeIds).toEqual(['task-3']);
    });

    it('buildExecutionWaves: graph with a verifier node places the verifier last', () => {
      const graph = buildTaskGraph({
        graphRunId: 'run-v',
        mode: 'router' as never,
        workers: [
          { roleName: 'implementer', task: 'do work' },
          { roleName: 'implementer', task: 'do more' },
        ],
        verifierRole: 'reviewer',
        verifierTask: 'verify all',
        requiredCapabilities: [],
      });
      const waves = buildExecutionWaves(graph, 10);
      expect(waves.length).toBe(2);
      // Verifier depends on both workers -> cannot be in wave 1.
      expect(waves[0].taskNodeIds).toEqual(expect.arrayContaining(['implementer-1', 'implementer-2']));
      expect(waves[0].taskNodeIds).not.toContain('reviewer-1');
      expect(waves[1].taskNodeIds).toEqual(['reviewer-1']);
    });

    it('wave.taskNodeIds concatenate to the full node set without duplicates', () => {
      const waves = buildExecutionWaves(makeGraph(5), 2);
      const allIds = waves.flatMap((w) => w.taskNodeIds);
      expect(allIds).toEqual(['task-1', 'task-2', 'task-3', 'task-4', 'task-5']);
      expect(new Set(allIds).size).toBe(5);
    });

    it('wave.roles are unique within a wave when nodes have distinct roles', () => {
      const graph: OrchestrationTaskGraph = {
        graphRunId: 'run-r',
        mode: 'router' as never,
        status: 'planned',
        nodes: [
          makeNode('t1', [], 'implementer'),
          makeNode('t2', [], 'architect'),
          makeNode('t3', [], 'tester'),
        ],
        edges: [],
      };
      const waves = buildExecutionWaves(graph, 10);
      expect(waves.length).toBe(1);
      expect(new Set(waves[0].roles).size).toBe(waves[0].roles.length);
      expect(waves[0].roles).toEqual(['implementer', 'architect', 'tester']);
    });

    it('buildExecutionWaves on an empty graph returns an empty array', () => {
      const empty: OrchestrationTaskGraph = {
        graphRunId: 'run-e',
        mode: 'router' as never,
        status: 'planned',
        nodes: [],
        edges: [],
      };
      expect(buildExecutionWaves(empty)).toEqual([]);
    });

    it('a single-node graph produces exactly one wave', () => {
      const waves = buildExecutionWaves(makeGraph(1));
      expect(waves.length).toBe(1);
      expect(waves[0].taskNodeIds).toEqual(['task-1']);
    });

    it('maxWorkers > tasks collapses all tasks into a single wave', () => {
      const waves = buildExecutionWaves(makeGraph(3), 1000);
      expect(waves.length).toBe(1);
      expect(waves[0].taskNodeIds.length).toBe(3);
    });

    it('ResourceAwareWaveScheduler.plan() returns WavePlan[] with status="planned" and the configured maxWorkers', () => {
      const scheduler = new ResourceAwareWaveScheduler(makeGraph(3), { maxWorkers: 2 });
      const waves: WavePlan[] = scheduler.plan();
      expect(Array.isArray(waves)).toBe(true);
      expect(waves.length).toBe(2);
      expect(waves.every((w) => w.status === 'planned')).toBe(true);
      expect(waves.every((w) => w.maxWorkers === 2)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 2. 边界条件 (5 tests)
  // -------------------------------------------------------------------------
  describe('边界条件', () => {
    it('maxWorkers=0 falls back to 1 (one task per wave, no throw)', () => {
      // workerCap = Math.max(1, Math.floor(0)) === 1.
      const waves = buildExecutionWaves(makeGraph(3), 0);
      expect(waves.length).toBe(3);
      for (const wave of waves) {
        expect(wave.taskNodeIds.length).toBe(1);
      }
    });

    it('maxWorkers=1 places exactly one task per wave', () => {
      const waves = buildExecutionWaves(makeGraph(3), 1);
      expect(waves.length).toBe(3);
      expect(waves[0].taskNodeIds).toEqual(['task-1']);
      expect(waves[1].taskNodeIds).toEqual(['task-2']);
      expect(waves[2].taskNodeIds).toEqual(['task-3']);
    });

    it('maxWorkers=1000 puts all tasks into a single wave', () => {
      const waves = buildExecutionWaves(makeGraph(4), 1000);
      expect(waves.length).toBe(1);
      expect(waves[0].taskNodeIds.length).toBe(4);
    });

    it('an orphan node (no deps, not depended on) is ready in the first wave', () => {
      const graph: OrchestrationTaskGraph = {
        graphRunId: 'run-o',
        mode: 'router' as never,
        status: 'planned',
        nodes: [
          makeNode('a', [], 'worker'),
          makeNode('b', ['a'], 'worker'), // depends on a
          makeNode('orphan', [], 'worker'), // no deps, not depended on
        ],
        edges: [],
      };
      const waves = buildExecutionWaves(graph, 10);
      expect(waves[0].taskNodeIds).toContain('orphan');
      expect(waves[0].taskNodeIds).toContain('a');
      // b depends on a -> not ready in wave 1.
      expect(waves[0].taskNodeIds).not.toContain('b');
    });

    it('ResourceAwareWaveScheduler with empty nodes produces an empty wave plan', () => {
      const empty: OrchestrationTaskGraph = {
        graphRunId: 'run-e',
        mode: 'router' as never,
        status: 'planned',
        nodes: [],
        edges: [],
      };
      const scheduler = new ResourceAwareWaveScheduler(empty, { maxWorkers: 4 });
      expect(scheduler.plan()).toEqual([]);
      expect(scheduler.getWaves()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 3. 错误路径 (3 tests)
  // -------------------------------------------------------------------------
  describe('错误路径', () => {
    it('a cyclic graph causes buildExecutionWaves to terminate (no ready nodes -> empty result)', () => {
      const cyclic: OrchestrationTaskGraph = {
        graphRunId: 'run-c',
        mode: 'router' as never,
        status: 'planned',
        nodes: [makeNode('a', ['b']), makeNode('b', ['a'])],
        edges: [],
      };
      // Neither a nor b can ever become ready -> the while loop breaks with [].
      const waves = buildExecutionWaves(cyclic);
      expect(waves).toEqual([]);
    });

    it('startWave on an unknown wave throws', () => {
      const scheduler = new ResourceAwareWaveScheduler(makeGraph(3), { maxWorkers: 2 });
      scheduler.plan();
      expect(() => scheduler.startWave(99)).toThrow();
    });

    it('rePlan on a non-existent wave returns wave_not_found', () => {
      const scheduler = new ResourceAwareWaveScheduler(makeGraph(3), { maxWorkers: 2 });
      scheduler.plan();
      const result = scheduler.rePlan({ appliesToWave: 99, maxWorkers: 4 });
      expect(result.accepted).toBe(false);
      if (!result.accepted) {
        expect(result.reason).toBe('wave_not_found');
        expect(result.waveNumber).toBe(99);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. 属性测试 (3 tests)
  // -------------------------------------------------------------------------
  describe('属性测试', () => {
    it('buildExecutionWaves is deterministic (same input -> same output across 5 runs)', () => {
      const graph = makeGraph(6);
      const first = buildExecutionWaves(graph, 2);
      for (let i = 0; i < 5; i++) {
        expect(buildExecutionWaves(graph, 2)).toEqual(first);
      }
    });

    it('topological order: a dependency is always scheduled in an earlier wave than its dependent', () => {
      // task-2 depends on task-1; task-3 depends on task-2.
      const graph = makeGraph(3, (_i, id) => {
        if (id === 'task-2') return ['task-1'];
        if (id === 'task-3') return ['task-2'];
        return [];
      });
      const waves = buildExecutionWaves(graph, 10);
      const waveOf = new Map<string, number>();
      for (const w of waves) {
        for (const id of w.taskNodeIds) waveOf.set(id, w.wave);
      }
      expect(waveOf.get('task-1')!).toBeLessThan(waveOf.get('task-2')!);
      expect(waveOf.get('task-2')!).toBeLessThan(waveOf.get('task-3')!);
    });

    it('wave count never exceeds ceil(tasks / maxWorkers) for independent tasks', () => {
      const cases: Array<{ tasks: number; workers: number }> = [
        { tasks: 5, workers: 2 },
        { tasks: 7, workers: 3 },
        { tasks: 10, workers: 4 },
      ];
      for (const { tasks, workers } of cases) {
        const waves = buildExecutionWaves(makeGraph(tasks), workers);
        const expected = Math.ceil(tasks / workers);
        expect(waves.length).toBeLessThanOrEqual(expected);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5. 并发测试 (2 tests)
  // -------------------------------------------------------------------------
  describe('并发测试', () => {
    it('two independent scheduler instances do not interfere with each other', () => {
      const s1 = new ResourceAwareWaveScheduler(makeGraph(3), { maxWorkers: 2 });
      const s2 = new ResourceAwareWaveScheduler(makeGraph(5), { maxWorkers: 1 });
      const w1 = s1.plan();
      const w2 = s2.plan();
      expect(w1.length).toBe(2);
      expect(w2.length).toBe(5);
      // Mutating s1's wave state must not affect s2.
      s1.startWave(1);
      expect(s2.getWaveStatus(1)).toBe('planned');
    });

    it('consecutive plan() calls are idempotent (later plan overwrites the former)', () => {
      const scheduler = new ResourceAwareWaveScheduler(makeGraph(4), { maxWorkers: 2 });
      const first = scheduler.plan();
      const second = scheduler.plan();
      expect(second.length).toBe(first.length);
      expect(second.map((w) => w.wave)).toEqual(first.map((w) => w.wave));
      expect(second.every((w) => w.status === 'planned')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 6. 压力测试 (2 tests)
  // -------------------------------------------------------------------------
  describe('压力测试', () => {
    it('100 task nodes + 10 workers build waves in under 100ms', () => {
      const graph = makeGraph(100);
      const start = Date.now();
      const waves = buildExecutionWaves(graph, 10);
      const elapsed = Date.now() - start;
      expect(waves.length).toBe(10); // 100 / 10
      expect(elapsed).toBeLessThan(100);
    });

    it('500 nodes + 50 workers do not crash the planner', () => {
      const graph = makeGraph(500);
      const waves = buildExecutionWaves(graph, 50);
      expect(waves).toBeDefined();
      expect(waves.length).toBe(10); // 500 / 50
      // Every node scheduled exactly once.
      const totalScheduled = waves.reduce((sum, w) => sum + w.taskNodeIds.length, 0);
      expect(totalScheduled).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // 7. 集成测试 (3 tests)
  // -------------------------------------------------------------------------
  describe('集成测试', () => {
    it('startWave -> completeWave -> rePlan lifecycle: completed wave rejected, planned wave accepted', () => {
      const scheduler = new ResourceAwareWaveScheduler(makeGraph(4), { maxWorkers: 2 });
      const waves = scheduler.plan();
      expect(waves.length).toBe(2);
      scheduler.startWave(1);
      scheduler.completeWave(1);
      // Re-planning the completed wave 1 is rejected (wave immutability).
      const rejected = scheduler.rePlan({ appliesToWave: 1, maxWorkers: 3 });
      expect(rejected.accepted).toBe(false);
      if (!rejected.accepted) {
        expect(rejected.reason).toBe('wave_started');
      }
      // Re-planning the still-planned wave 2 with a new worker cap is accepted.
      const accepted = scheduler.rePlan({ appliesToWave: 2, maxWorkers: 3 });
      expect(accepted.accepted).toBe(true);
      if (accepted.accepted) {
        expect(accepted.replannedWaves).toContain(2);
      }
    });

    it('rePlan on an already-completed wave returns reason wave_started', () => {
      const scheduler = new ResourceAwareWaveScheduler(makeGraph(2), { maxWorkers: 1 });
      scheduler.plan();
      scheduler.startWave(1);
      scheduler.completeWave(1);
      const result = scheduler.rePlan({ appliesToWave: 1, maxWorkers: 5 });
      expect(result.accepted).toBe(false);
      if (!result.accepted) {
        expect(result.reason).toBe('wave_started');
        expect(result.waveNumber).toBe(1);
      }
    });

    it('getWaves returns waves sorted by wave number ascending', () => {
      const scheduler = new ResourceAwareWaveScheduler(makeGraph(5), { maxWorkers: 2 });
      scheduler.plan();
      const waves = scheduler.getWaves();
      const numbers = waves.map((w) => w.wave);
      const sorted = [...numbers].sort((a, b) => a - b);
      expect(numbers).toEqual(sorted);
      // Expected wave numbers are 1..3 (5 tasks / 2 workers).
      expect(numbers).toEqual([1, 2, 3]);
    });
  });
});
