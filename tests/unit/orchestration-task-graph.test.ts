import { describe, expect, it, vi } from 'vitest';

vi.mock('../../openclaw_runtime/src/agents/subagent-spawn', () => ({
  spawnSubagentDirect: vi.fn(),
}));

vi.mock('../../openclaw_runtime/src/media/image-ops.js', () => ({
  IMAGE_REDUCE_QUALITY_STEPS: [85, 75, 65, 55, 45, 35],
  ImageProcessorUnavailableError: class ImageProcessorUnavailableError extends Error {},
  buildImageResizeSideGrid: vi.fn(() => []),
  convertHeicToJpeg: vi.fn(async (buffer: Buffer) => buffer),
  createImageProcessor: vi.fn(),
  getImageMetadata: vi.fn(async () => null),
  hasAlphaChannel: vi.fn(async () => false),
  isImageProcessorUnavailableError: vi.fn(() => false),
  normalizeExifOrientation: vi.fn(async (buffer: Buffer) => buffer),
  optimizeImageToPng: vi.fn(),
  readImageMetadataFromHeader: vi.fn(() => null),
  readImageProbeFromHeader: vi.fn(() => null),
  resizeToJpeg: vi.fn(async ({ buffer }: { buffer: Buffer }) => buffer),
  resizeToPng: vi.fn(async ({ buffer }: { buffer: Buffer }) => buffer),
}));

vi.mock('rastermill', () => ({
  createRastermill: () => ({
    probe: vi.fn(),
    encode: vi.fn(),
  }),
  isRastermillUnavailableError: () => false,
  RastermillError: class RastermillError extends Error {},
  RastermillUnavailableError: class RastermillUnavailableError extends Error {},
  readImageProbeFromHeader: vi.fn(),
  readImageMetadataFromHeader: vi.fn(),
}), { virtual: true });

import { createOrchestratorPlan } from '../../openclaw_runtime/src/agents/orchestrator';
import { runOrchestrationObserved } from '../../openclaw_runtime/src/agents/orchestrator-run-observed';
import {
  buildPendingGraphNodesFromFollowups,
  buildRepairNodes,
  buildRerouteRecommendations,
} from '../../openclaw_runtime/src/agents/orchestration-protocol';
import { createTeamOrchestrateTool } from '../../openclaw_runtime/src/agents/tools/team-orchestrate-tool';
import { emptyConfig } from './helpers/role-gateway-test-utils';

type FakeSpawnParams = {
  task: string;
  orchestration?: {
    taskNodeId?: string;
    graphRunId?: string;
    dependsOn?: string[];
    executionWave?: number;
  };
};

type FakeSpawnResult = {
  status: 'accepted' | 'forbidden' | 'error';
  runId?: string;
  childSessionKey?: string;
  error?: string;
};

describe('orchestration task graph v4', () => {
  it('generates a staged quick-development graph with dependency waves', () => {
    const plan = createOrchestratorPlan({
      task: 'implement and test a feature',
      templateId: 'quick-development',
      graphMode: 'auto',
      maxWorkers: 2,
    });

    expect(plan.taskGraph.mode).toBe('auto');
    expect(plan.taskGraph.nodes.map((node) => node.roleName)).toEqual([
      'planner',
      'implementer',
      'tester',
      'reviewer',
    ]);
    const implementer = plan.taskGraph.nodes.find((node) => node.roleName === 'implementer');
    const tester = plan.taskGraph.nodes.find((node) => node.roleName === 'tester');
    const reviewer = plan.taskGraph.nodes.find((node) => node.roleName === 'reviewer');
    expect(implementer?.dependsOn).toEqual(['planner-1']);
    expect(tester?.dependsOn).toEqual(['implementer-1']);
    expect(reviewer?.isVerifier).toBe(true);
    expect(reviewer?.dependsOn).toEqual(['planner-1', 'implementer-1', 'tester-1']);
    expect(plan.executionWaves.map((wave) => wave.roles)).toEqual([
      ['planner'],
      ['implementer'],
      ['tester'],
      ['reviewer'],
    ]);
  });

  it('keeps router plans as a single-node graph', () => {
    const plan = createOrchestratorPlan({
      task: 'explain this function',
      graphMode: 'auto',
    });

    expect(plan.taskGraph.nodes).toHaveLength(1);
    expect(plan.executionWaves).toHaveLength(1);
    expect(plan.executionWaves[0]?.roles).toEqual([plan.leadRole]);
  });

  it('limits execution wave concurrency without deleting template workers or verifier', () => {
    const plan = createOrchestratorPlan({
      task: 'security audit',
      templateId: 'security-audit',
      maxWorkers: 2,
      graphMode: 'auto',
    });

    expect(plan.workers.map((worker) => worker.roleName)).toEqual(['security-reviewer', 'reviewer', 'tester']);
    expect(plan.taskGraph.nodes.map((node) => node.roleName)).toContain('skeptic');
    expect(plan.executionWaves.every((wave) => wave.roles.length <= 2)).toBe(true);
    expect(plan.executionWaves.map((wave) => wave.roles)).toEqual([
      ['security-reviewer', 'reviewer'],
      ['tester'],
      ['skeptic'],
    ]);
  });

  it('runs workers by execution waves and carries graph metadata into spawn records', async () => {
    const spawned: FakeSpawnParams[] = [];
    const fakeSpawn = async (params: FakeSpawnParams): Promise<FakeSpawnResult> => {
      spawned.push(params);
      return {
        status: 'accepted',
        runId: `run_${spawned.length}`,
        childSessionKey: `child_${spawned.length}`,
      };
    };

    const result = await runOrchestrationObserved(
      {
        task: 'implement and test a feature',
        templateId: 'quick-development',
        maxWorkers: 2,
        graphMode: 'auto',
        orchestrationRunId: 'orch_graph',
      },
      { agentSessionKey: 'agent:main:abc' },
      { spawn: fakeSpawn as never },
    );

    expect(result.taskGraph.nodes.map((node) => node.roleName)).toEqual([
      'planner',
      'implementer',
      'tester',
      'reviewer',
    ]);
    expect(result.outcomes.map((outcome) => outcome.ledger.taskNodeId)).toEqual([
      'planner-1',
      'implementer-1',
      'tester-1',
    ]);
    expect(spawned.every((params) => params.orchestration?.graphRunId === 'quick-development')).toBe(true);
    expect(spawned.map((params) => params.orchestration?.executionWave)).toEqual([1, 2, 3]);
    expect(spawned[1]?.orchestration?.dependsOn).toEqual(['planner-1']);
  });

  it('derives repair, reroute, and pending follow-up graph nodes without auto-spawning them', () => {
    const plan = createOrchestratorPlan({
      task: 'implement risky change',
      templateId: 'quick-development',
    });
    const repairNodes = buildRepairNodes({
      taskGraph: plan.taskGraph,
      attempts: [{
        roleName: 'tester',
        taskId: 'tester-1',
        status: 'timeout',
        resultText: '',
      }],
      repairPolicy: plan.estimatedRepairPolicy,
    });
    expect(repairNodes).toHaveLength(1);
    expect(repairNodes[0]?.repairAction).toBe('redo');

    const reroutes = buildRerouteRecommendations({
      taskGraph: plan.taskGraph,
      routeDiagnostics: {
        ...plan.routeDiagnostics,
        capabilityGaps: [{ roleName: 'planner', missing: ['code-change'] }],
      },
      attempts: [{ roleName: 'planner', taskId: 'planner-1', status: 'forbidden', error: 'permission denied' }],
    });
    expect(reroutes).toEqual(expect.arrayContaining([
      expect.objectContaining({ roleName: 'planner', reason: 'capability-gap' }),
      expect.objectContaining({ roleName: 'planner', reason: 'permission-denied' }),
    ]));

    expect(buildPendingGraphNodesFromFollowups({
      followupCandidates: [{ roleName: 'reviewer', childRunId: 'run_1', task: 'review follow-up', reason: 'test' }],
      repairPolicy: plan.estimatedRepairPolicy,
      allowFollowupPlanning: false,
    })).toHaveLength(0);
    expect(buildPendingGraphNodesFromFollowups({
      followupCandidates: [{ roleName: 'reviewer', childRunId: 'run_1', task: 'review follow-up', reason: 'test' }],
      repairPolicy: plan.estimatedRepairPolicy,
      allowFollowupPlanning: true,
    })).toHaveLength(1);
  });

  it('keeps bounded A2A disabled while returning graph fields from team_orchestrate', async () => {
    const tool = createTeamOrchestrateTool({
      agentSessionKey: 'agent:main:abc',
      config: emptyConfig(),
      deps: {
        idFactory: () => 'orch_graph_tool',
        spawn: (async () => ({
          status: 'accepted',
          runId: 'run_graph',
          childSessionKey: 'child_graph',
        })) as never,
      },
    });

    const result = await tool.execute('call_1', {
      task: 'security audit',
      templateId: 'security-audit',
      graphMode: 'auto',
      maxWorkers: 2,
      workerCommunication: 'bounded_a2a',
    });
    const details = result.details as {
      taskGraph: { nodes: Array<{ roleName: string }> };
      executionWaves: Array<{ roles: string[] }>;
      resultPolicy: { workerCommunication: string; boundedA2aEnabled: boolean };
    };

    expect(details.taskGraph.nodes.map((node) => node.roleName)).toContain('skeptic');
    expect(details.executionWaves.every((wave) => wave.roles.length <= 2)).toBe(true);
    expect(details.resultPolicy.workerCommunication).toBe('none');
    expect(details.resultPolicy.boundedA2aEnabled).toBe(false);
  });
});
