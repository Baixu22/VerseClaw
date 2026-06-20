import { describe, expect, it, vi } from 'vitest';

vi.mock('../../openclaw_runtime/src/agents/subagent-spawn', () => ({
  spawnSubagentDirect: vi.fn(),
}));

import { createOrchestratorPlan } from '../../openclaw_runtime/src/agents/orchestrator';
import { runOrchestration } from '../../openclaw_runtime/src/agents/orchestrator-run';
import {
  extractFollowupCandidates,
  extractMemoryCandidates,
  normalizeWorkerCommunication,
  recommendRepairAction,
  scoreWorkerQuality,
} from '../../openclaw_runtime/src/agents/orchestration-protocol';
import { createTeamOrchestrateTool } from '../../openclaw_runtime/src/agents/tools/team-orchestrate-tool';
import { leasePendingAgentSteeringItemsFromSubagentRuns } from '../../openclaw_runtime/src/agents/agent-steering-queue';
import type {
  SubagentRunRecord,
  TeamOrchestrationMetadata,
} from '../../openclaw_runtime/src/agents/subagent-registry.types';
import { emptyConfig } from './helpers/role-gateway-test-utils';

type FakeSpawnParams = {
  task: string;
  orchestration?: TeamOrchestrationMetadata;
};

type FakeSpawnResult = {
  status: 'accepted' | 'forbidden' | 'error';
  runId?: string;
  childSessionKey?: string;
  error?: string;
};

function runRecord(params: {
  runId: string;
  roleName: string;
  phase?: 'worker' | 'verifier';
  resultText: string;
  outcome?: SubagentRunRecord['outcome'];
  meta?: Partial<TeamOrchestrationMetadata>;
}): SubagentRunRecord {
  const isVerifier = params.phase === 'verifier';
  const meta: TeamOrchestrationMetadata = {
    orchestrationRunId: 'orch_v3',
    roleName: params.roleName,
    isVerifier,
    phase: isVerifier ? 'verifier' : 'worker',
    expectedWorkerRunIds: ['run_worker_1'],
    leadRole: 'planner',
    originalTask: 'ship feature',
    verifierRole: 'reviewer',
    verifierStartedRunId: 'run_verifier',
    taskId: isVerifier ? 'verifier-2' : 'worker-1',
    roleInstanceId: `orch_v3:${isVerifier ? 'verifier-2' : 'worker-1'}:${params.roleName}:attempt-1`,
    attempt: 1,
    scope: `${params.roleName} task`,
    requiredCapabilities: ['task-analysis', 'verification'],
    ...params.meta,
  };
  return {
    runId: params.runId,
    childSessionKey: `child:${params.runId}`,
    requesterSessionKey: 'agent:main:abc',
    requesterDisplayKey: 'agent:main:abc',
    task: `${params.roleName} task`,
    cleanup: 'keep',
    label: params.roleName,
    createdAt: 1,
    startedAt: 1,
    endedAt: 2,
    outcome: params.outcome ?? { status: 'ok' },
    expectsCompletionMessage: true,
    completion: {
      required: true,
      resultText: params.resultText,
    },
    delivery: {
      status: 'pending',
      payload: {
        requesterSessionKey: 'agent:main:abc',
        requesterDisplayKey: 'agent:main:abc',
        childSessionKey: `child:${params.runId}`,
        childRunId: params.runId,
        task: `${params.roleName} task`,
        label: params.roleName,
        endedAt: 2,
        outcome: params.outcome ?? { status: 'ok' },
        expectsCompletionMessage: true,
        frozenResultText: params.resultText,
        orchestration: meta,
      },
    },
    orchestration: meta,
  };
}

describe('role-first orchestration v3 protocol', () => {
  it('records multiple instances for the same role without cloning the role contract', async () => {
    const spawned: FakeSpawnParams[] = [];
    const fakeSpawn = async (params: FakeSpawnParams): Promise<FakeSpawnResult> => {
      spawned.push(params);
      return {
        status: 'accepted',
        runId: `run_${spawned.length}`,
        childSessionKey: `child_${spawned.length}`,
      };
    };
    const result = await runOrchestration(
      {
        task: 'split implementation work',
        templateId: 'double-implementer',
        orchestrationRunId: 'orch_double',
        cfg: {
          agents: {
            teams: [{
              id: 'double-implementer',
              mode: 'lead-workers',
              defaultLeadRole: 'planner',
              verifierRole: 'reviewer',
              roles: [
                { roleName: 'implementer', required: true },
                { roleName: 'implementer', required: true },
                { roleName: 'reviewer', required: true },
              ],
            }],
          },
        },
      },
      { agentSessionKey: 'agent:main:abc' },
      { spawn: fakeSpawn as never },
    );

    const implementerAttempts = result.attempts.filter((attempt) => attempt.roleName === 'implementer');
    expect(implementerAttempts).toHaveLength(2);
    expect(implementerAttempts.map((attempt) => attempt.taskId)).toEqual(['implementer-1', 'implementer-2']);
    expect(new Set(implementerAttempts.map((attempt) => attempt.roleInstanceId)).size).toBe(2);
    expect(spawned.map((params) => params.orchestration?.roleName)).toEqual(['implementer', 'implementer']);
  });

  it('reports capability gaps instead of widening a role tool allowlist', () => {
    const plan = createOrchestratorPlan({
      task: 'implement code changes',
      preferredLeadRole: 'planner',
    });

    expect(plan.leadRole).toBe('planner');
    expect(plan.routeDiagnostics.requiredCapabilities).toContain('code-change');
    expect(plan.routeDiagnostics.capabilityGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleName: 'planner', missing: expect.arrayContaining(['code-change']) }),
      ]),
    );
  });

  it('normalizes bounded A2A as a recorded request while team_orchestrate keeps effective communication closed', async () => {
    expect(normalizeWorkerCommunication('bounded_a2a')).toBe('bounded_a2a');
    const tool = createTeamOrchestrateTool({
      agentSessionKey: 'agent:main:abc',
      config: emptyConfig(),
      deps: {
        idFactory: () => 'orch_a2a',
        spawn: (async () => ({
          status: 'accepted',
          runId: 'run_a2a',
          childSessionKey: 'child_a2a',
        })) as never,
      },
    });

    const result = await tool.execute('call_1', {
      task: 'explain this function',
      workerCommunication: 'bounded_a2a',
    });
    const details = result.details as {
      resultPolicy: {
        workerCommunication: string;
        requestedWorkerCommunication: string;
        boundedA2aEnabled: boolean;
      };
    };
    expect(details.resultPolicy.requestedWorkerCommunication).toBe('bounded_a2a');
    expect(details.resultPolicy.workerCommunication).toBe('none');
    expect(details.resultPolicy.boundedA2aEnabled).toBe(false);
  });

  it('classifies poor worker output and recommends redo for no-output failures', () => {
    const poor = scoreWorkerQuality({
      roleName: 'tester',
      childRunId: 'run_poor',
      resultText: 'ok',
      outcomeStatus: 'ok',
    });
    expect(poor.overall).toBe('poor_attempt');
    expect(poor.reasons).toContain('missing-evidence');

    expect(recommendRepairAction({ status: 'timeout', resultText: '' })).toBe('redo');
    expect(recommendRepairAction({ status: 'error', error: 'permission denied', resultText: 'failed' })).toBe('reroute');
  });

  it('extracts follow-up and memory candidates without spawning follow-up work', () => {
    const text = [
      '## Result',
      'Implemented the first slice.',
      '## Follow-up Candidates',
      '- Add regression coverage for the retry path',
      '## Memory Candidates',
      '- Reviewer should require routeDiagnostics on orchestration changes',
    ].join('\n');

    expect(extractFollowupCandidates({ text, roleName: 'implementer', childRunId: 'run_1' })).toEqual([
      expect.objectContaining({ task: 'Add regression coverage for the retry path' }),
    ]);
    expect(extractMemoryCandidates({ text, roleName: 'implementer', childRunId: 'run_1' })).toEqual([
      expect.objectContaining({ content: 'Reviewer should require routeDiagnostics on orchestration changes' }),
    ]);
  });

  it('injects attempts, quality, follow-up, memory candidates, and route diagnostics into the Team Result Bundle', () => {
    const runs = new Map<string, SubagentRunRecord>();
    runs.set(
      'run_worker_1',
      runRecord({
        runId: 'run_worker_1',
        roleName: 'tester',
        resultText: [
          '## Results',
          'Verified tests/unit/example.test.ts passed.',
          '## Follow-up Candidates',
          '- Add integration coverage',
          '## Memory Candidates',
          '- Testing role should cite exact test files',
        ].join('\n'),
        meta: {
          routeDiagnostics: {
            difficulty: 'moderate',
            confidence: 0.7,
            reasons: ['unit-test'],
            selectedRoles: ['tester', 'reviewer'],
            rejectedRoles: [],
            requiredCapabilities: ['verification'],
            capabilityGaps: [],
          },
        },
      }),
    );
    runs.set(
      'run_verifier',
      runRecord({
        runId: 'run_verifier',
        roleName: 'reviewer',
        phase: 'verifier',
        resultText: 'verified',
      }),
    );

    const leased = leasePendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: 'agent:main:abc',
      leaseId: 'lease_v3',
    });

    expect(leased?.prompt).toContain('attempts:');
    expect(leased?.prompt).toContain('quality:');
    expect(leased?.prompt).toContain('routeDiagnostics:');
    expect(leased?.prompt).toContain('followupCandidates:');
    expect(leased?.prompt).toContain('Add integration coverage');
    expect(leased?.prompt).toContain('memoryCandidates:');
    expect(leased?.prompt).toContain('Testing role should cite exact test files');
  });
});
