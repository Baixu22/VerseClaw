import { describe, expect, it } from 'vitest';
import type {
  OrchestrationTaskGraph,
  OrchestrationTaskNode,
} from '../../openclaw_runtime/src/agents/orchestration-protocol';
import type { RoleContract } from '../../openclaw_runtime/src/agents/role-contract';
import { scheduleResourceAwareWaves, type ResourceSchedulerOptions } from '../../openclaw_runtime/src/agents/orchestration-resource-scheduler';
import { createWorktreeService } from '../../openclaw_runtime/src/agents/worktree-service';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function node(params: {
  taskNodeId: string;
  roleName: string;
  dependsOn?: string[];
  isVerifier?: boolean;
  writeSet?: string[];
  isolation?: OrchestrationTaskNode['isolation'];
}): OrchestrationTaskNode {
  return {
    taskNodeId: params.taskNodeId,
    roleName: params.roleName,
    task: `${params.roleName} task`,
    phase: params.isVerifier ? 'verifier' : 'worker',
    dependsOn: params.dependsOn ?? [],
    scope: `${params.roleName} scope`,
    requiredCapabilities: ['task-analysis'],
    attemptPolicy: { maxRepairAttempts: 1, maxRedoAttempts: 1 },
    status: params.dependsOn?.length ? 'planned' : 'ready',
    ...(params.isVerifier ? { isVerifier: true } : {}),
    ...(params.writeSet ? { writeSet: [...params.writeSet] } : {}),
    ...(params.isolation ? { isolation: params.isolation } : {}),
  };
}

function graph(nodes: OrchestrationTaskNode[]): OrchestrationTaskGraph {
  return {
    graphRunId: 'graph_scheduler',
    mode: 'staged',
    status: 'planned',
    nodes,
    edges: nodes.flatMap((target) =>
      target.dependsOn.map((source) => ({
        from: source,
        to: target.taskNodeId,
        type: target.isVerifier ? 'verification' as const : 'dependency' as const,
      })),
    ),
  };
}

function role(params: {
  name: string;
  tools?: string[];
  toolRequirements?: string[];
  effort?: RoleContract['effort'];
}): RoleContract {
  return {
    name: params.name,
    displayName: params.name,
    rolePrompt: `${params.name} role contract for scheduler tests.`,
    tools: params.tools ?? ['read'],
    capabilities: ['task-analysis'],
    toolRequirements: params.toolRequirements ?? [],
    riskProfile: 'medium',
    canModifyScope: false,
    permissions: { filesystem: 'read', network: 'none', commands: [] },
    model: { default: null, fallback: [] },
    effort: params.effort ?? 'medium',
    outputSchema: { format: 'markdown' },
    handoff: { to: [], from: [] },
    tags: [],
  };
}

describe('resource-aware orchestration scheduler', () => {
  it('produces deterministic waves and metrics for identical task graphs', () => {
    const inputGraph = graph([
      node({ taskNodeId: 'planner-1', roleName: 'planner' }),
      node({ taskNodeId: 'implementer-1', roleName: 'implementer', dependsOn: ['planner-1'] }),
      node({ taskNodeId: 'reviewer-1', roleName: 'reviewer', dependsOn: ['implementer-1'], isVerifier: true }),
    ]);
    const roles = [
      role({ name: 'planner', effort: 'high' }),
      role({ name: 'implementer', tools: ['read', 'write', 'bash'], effort: 'medium' }),
      role({ name: 'reviewer', effort: 'high' }),
    ];

    const first = scheduleResourceAwareWaves({ graph: inputGraph, roles, options: { maxActiveRoles: 2 } });
    const second = scheduleResourceAwareWaves({ graph: inputGraph, roles, options: { maxActiveRoles: 2 } });

    expect(second).toEqual(first);
    expect(first.waves.map((wave) => wave.taskNodeIds)).toEqual([
      ['planner-1'],
      ['implementer-1'],
      ['reviewer-1'],
    ]);
    expect(first.metrics).toMatchObject({
      queued: 3,
      running: 0,
      completed: 3,
      skipped: 0,
      concurrencyCap: 2,
    });
    expect(first.metrics.budgetEstimate).toBeGreaterThan(0);
    expect(first.metrics.roleCostSummary.map((entry) => entry.roleName)).toEqual([
      'planner',
      'implementer',
      'reviewer',
    ]);
  });

  it('enforces max active roles in each ready wave', () => {
    const inputGraph = graph([
      node({ taskNodeId: 'planner-1', roleName: 'planner' }),
      node({ taskNodeId: 'tester-1', roleName: 'tester' }),
      node({ taskNodeId: 'reviewer-1', roleName: 'reviewer' }),
    ]);

    const result = scheduleResourceAwareWaves({
      graph: inputGraph,
      roles: [role({ name: 'planner' }), role({ name: 'tester' }), role({ name: 'reviewer' })],
      options: { maxActiveRoles: 2 },
    });

    expect(result.waves.map((wave) => wave.taskNodeIds)).toEqual([
      ['planner-1', 'tester-1'],
      ['reviewer-1'],
    ]);
    expect(result.waves.every((wave) => wave.taskNodeIds.length <= result.metrics.concurrencyCap)).toBe(true);
  });

  it('splits roles with exclusive tool contention into separate waves', () => {
    const inputGraph = graph([
      node({ taskNodeId: 'implementer-1', roleName: 'implementer' }),
      node({ taskNodeId: 'docs-writer-1', roleName: 'docs-writer' }),
      node({ taskNodeId: 'reviewer-1', roleName: 'reviewer' }),
    ]);

    const result = scheduleResourceAwareWaves({
      graph: inputGraph,
      roles: [
        role({ name: 'implementer', tools: ['read', 'write', 'bash'], toolRequirements: ['bash'] }),
        role({ name: 'docs-writer', tools: ['read', 'write', 'edit'], toolRequirements: ['write'] }),
        role({ name: 'reviewer', tools: ['read', 'grep'] }),
      ],
      options: { maxActiveRoles: 3 },
    });

    expect(result.waves.map((wave) => wave.taskNodeIds)).toEqual([
      ['implementer-1', 'reviewer-1'],
      ['docs-writer-1'],
    ]);
    expect(result.waves[1]?.reason).toContain('tool contention');
  });

  it('skips nodes with unsatisfied dependencies and reports skipped metrics', () => {
    const inputGraph = graph([
      node({ taskNodeId: 'reviewer-1', roleName: 'reviewer', dependsOn: ['missing-node'] }),
    ]);

    const result = scheduleResourceAwareWaves({
      graph: inputGraph,
      roles: [role({ name: 'reviewer' })],
      options: { maxActiveRoles: 1 },
    });

    expect(result.waves).toEqual([]);
    expect(result.skipped).toEqual([
      {
        taskNodeId: 'reviewer-1',
        roleName: 'reviewer',
        reason: 'dependencies could not be satisfied',
      },
    ]);
    expect(result.metrics).toMatchObject({
      queued: 1,
      completed: 0,
      skipped: 1,
    });
  });

  it('uses custom exclusive tool groups and role cost overrides in metrics', () => {
    const inputGraph = graph([
      node({ taskNodeId: 'analyst-1', roleName: 'analyst' }),
      node({ taskNodeId: 'researcher-1', roleName: 'researcher' }),
      node({ taskNodeId: 'reviewer-1', roleName: 'reviewer' }),
    ]);

    const result = scheduleResourceAwareWaves({
      graph: inputGraph,
      roles: [
        role({ name: 'analyst', tools: ['read', 'gpu'] }),
        role({ name: 'researcher', tools: ['read', 'gpu'] }),
        role({ name: 'reviewer', tools: ['read'] }),
      ],
      options: {
        maxActiveRoles: 3,
        exclusiveToolGroups: [['gpu']],
        roleCost: { analyst: 7, researcher: 11 },
      },
    });

    expect(result.waves.map((wave) => wave.taskNodeIds)).toEqual([
      ['analyst-1', 'reviewer-1'],
      ['researcher-1'],
    ]);
    expect(result.metrics.roleCostSummary).toEqual([
      { roleName: 'analyst', taskNodeIds: ['analyst-1'], estimatedCost: 7 },
      { roleName: 'researcher', taskNodeIds: ['researcher-1'], estimatedCost: 11 },
      { roleName: 'reviewer', taskNodeIds: ['reviewer-1'], estimatedCost: 2 },
    ]);
    expect(result.metrics.budgetEstimate).toBe(20);
  });

  it('packs disjoint write sets into the same wave and splits intersecting write sets', () => {
    const disjoint = scheduleResourceAwareWaves({
      graph: graph([
        node({ taskNodeId: 'implementer-1', roleName: 'implementer', writeSet: ['src/a.ts'] }),
        node({ taskNodeId: 'docs-writer-1', roleName: 'docs-writer', writeSet: ['docs/a.md'] }),
      ]),
      roles: [
        role({ name: 'implementer', tools: ['read', 'write'] }),
        role({ name: 'docs-writer', tools: ['read', 'write'] }),
      ],
      options: { maxActiveRoles: 2 },
    });
    expect(disjoint.waves.map((wave) => wave.taskNodeIds)).toEqual([
      ['implementer-1', 'docs-writer-1'],
    ]);

    const intersecting = scheduleResourceAwareWaves({
      graph: graph([
        node({ taskNodeId: 'implementer-1', roleName: 'implementer', writeSet: ['src/a.ts'] }),
        node({ taskNodeId: 'docs-writer-1', roleName: 'docs-writer', writeSet: ['src/a.ts'] }),
      ]),
      roles: [
        role({ name: 'implementer', tools: ['read', 'write'] }),
        role({ name: 'docs-writer', tools: ['read', 'write'] }),
      ],
      options: { maxActiveRoles: 2 },
    });
    expect(intersecting.waves.map((wave) => wave.taskNodeIds)).toEqual([
      ['implementer-1'],
      ['docs-writer-1'],
    ]);
    expect(intersecting.waves[0]?.deferredReasons).toContain('write-set-conflict');
  });

  it('does not let custom roles bypass write-set conflicts without default write tools', () => {
    const result = scheduleResourceAwareWaves({
      graph: graph([
        node({ taskNodeId: 'custom-a', roleName: 'custom-a', writeSet: ['src/shared.ts'] }),
        node({ taskNodeId: 'custom-b', roleName: 'custom-b', writeSet: ['src/shared.ts'] }),
      ]),
      roles: [
        role({ name: 'custom-a', tools: ['read'] }),
        role({ name: 'custom-b', tools: ['read'] }),
      ],
      options: { maxActiveRoles: 2 },
    });

    expect(result.waves.map((wave) => wave.taskNodeIds)).toEqual([
      ['custom-a'],
      ['custom-b'],
    ]);
    expect(result.waves[0]?.deferredReasons).toContain('write-set-conflict');
  });

  it('keeps shared writers with incomplete write sets in single-writer waves', () => {
    const result = scheduleResourceAwareWaves({
      graph: graph([
        node({ taskNodeId: 'implementer-1', roleName: 'implementer', writeSet: ['src/a.ts'] }),
        node({ taskNodeId: 'implementer-2', roleName: 'implementer' }),
      ]),
      roles: [role({ name: 'implementer', tools: ['read', 'write'] })],
      options: { maxActiveRoles: 2 },
    });

    expect(result.waves.map((wave) => wave.taskNodeIds)).toEqual([
      ['implementer-1'],
      ['implementer-2'],
    ]);
    expect(result.waves[0]?.deferredReasons).toContain('insufficient-writeSet-proof');
    expect(result.waves[0]?.reason).toContain('insufficient-writeSet-proof');
  });

  it('serializes worktree-intent writers until checkout isolation is verified', () => {
    const result = scheduleResourceAwareWaves({
      graph: graph([
        node({
          taskNodeId: 'implementer-1',
          roleName: 'implementer',
          writeSet: ['src/shared.ts'],
          isolation: 'worktree',
        }),
        node({
          taskNodeId: 'implementer-2',
          roleName: 'implementer',
          writeSet: ['src/shared.ts'],
          isolation: 'worktree',
        }),
      ]),
      roles: [role({ name: 'implementer', tools: ['read', 'write'] })],
      options: { maxActiveRoles: 2 },
    });

    expect(result.waves.map((wave) => wave.taskNodeIds)).toEqual([
      ['implementer-1'],
      ['implementer-2'],
    ]);
    expect(result.waves[0]?.deferredReasons).toContain('write-set-conflict');
  });

  it('does not accept a caller boolean as checkout proof', () => {
    const result = scheduleResourceAwareWaves({
      graph: graph([
        node({ taskNodeId: 'implementer-1', roleName: 'implementer', writeSet: ['src/shared.ts'], isolation: 'worktree' }),
        node({ taskNodeId: 'implementer-2', roleName: 'implementer', writeSet: ['src/shared.ts'], isolation: 'worktree' }),
      ]),
      roles: [role({ name: 'implementer', tools: ['read', 'write'] })],
      options: { maxActiveRoles: 2, verifiedWorktreeIsolation: true } as ResourceSchedulerOptions,
    });
    expect(result.waves.map((wave) => wave.taskNodeIds)).toEqual([['implementer-1'], ['implementer-2']]);
  });

  it('admits only distinct live Git records from the worktree owner', () => {
    const root = mkdtempSync(join(tmpdir(), 's4-scheduler-'));
    try {
      const git = (...args: string[]) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
      git('init'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture');
      const service = createWorktreeService(root, { backend: 'git' });
      const a = service.create('a'); const b = service.create('b');
      const simulated = createWorktreeService(root).create('simulated');
      const taskGraph = graph([
        node({ taskNodeId: 'a', roleName: 'implementer', writeSet: ['same.ts'], isolation: 'worktree' }),
        node({ taskNodeId: 'b', roleName: 'implementer', writeSet: ['same.ts'], isolation: 'worktree' }),
      ]);
      for (const [second, allowed] of [[b, true], [a, false], [{ ...b }, false], [simulated, false]] as const) {
        const result = scheduleResourceAwareWaves({ graph: taskGraph,
          roles: [role({ name: 'implementer', tools: ['read', 'write'] })],
          options: { maxActiveRoles: 2, worktreeRecords: new Map([['a', a], ['b', second]]) },
        });
        expect(result.waves).toHaveLength(allowed ? 1 : 2);
      }
      rmSync(b.root, { recursive: true, force: true });
      expect(scheduleResourceAwareWaves({ graph: taskGraph,
        roles: [role({ name: 'implementer', tools: ['write'] })],
        options: { worktreeRecords: new Map([['a', a], ['b', b]]) },
      }).waves).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
