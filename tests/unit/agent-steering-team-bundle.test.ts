import { describe, expect, it } from 'vitest';
import {
  leasePendingAgentSteeringItemsFromSubagentRuns,
  listPendingAgentSteeringItemsFromSubagentRuns,
} from '../../openclaw_runtime/src/agents/agent-steering-queue';
import type {
  SubagentRunRecord,
  TeamOrchestrationMetadata,
} from '../../openclaw_runtime/src/agents/subagent-registry.types';

function orchestration(overrides: Partial<TeamOrchestrationMetadata>): TeamOrchestrationMetadata {
  return {
    orchestrationRunId: 'orch_bundle',
    roleName: 'tester',
    isVerifier: false,
    phase: 'worker',
    expectedWorkerRunIds: ['run_worker_1', 'run_worker_2'],
    leadRole: 'planner',
    originalTask: 'ship the feature',
    verifierRole: 'reviewer',
    ...overrides,
  };
}

function runRecord(params: {
  runId: string;
  roleName: string;
  phase?: 'worker' | 'verifier';
  resultText?: string;
  outcome?: SubagentRunRecord['outcome'];
  verifierStartedRunId?: string;
}): SubagentRunRecord {
  const isVerifier = params.phase === 'verifier';
  const meta = orchestration({
    roleName: params.roleName,
    isVerifier,
    phase: isVerifier ? 'verifier' : 'worker',
    verifierStartedRunId: params.verifierStartedRunId,
  });
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
      resultText: params.resultText ?? `${params.roleName} result`,
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
        frozenResultText: params.resultText ?? `${params.roleName} result`,
        orchestration: meta,
      },
    },
    orchestration: meta,
  };
}

describe('agent steering team result bundles', () => {
  it('holds worker completions until the deferred verifier is complete', () => {
    const runs = new Map<string, SubagentRunRecord>();
    runs.set('run_worker_1', runRecord({ runId: 'run_worker_1', roleName: 'implementer' }));
    runs.set('run_worker_2', runRecord({ runId: 'run_worker_2', roleName: 'tester' }));

    const pending = listPendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: 'agent:main:abc',
    });

    expect(pending).toHaveLength(0);
  });

  it('leases a single Team Result Bundle once verifier completion is pending', () => {
    const runs = new Map<string, SubagentRunRecord>();
    runs.set(
      'run_worker_1',
      runRecord({
        runId: 'run_worker_1',
        roleName: 'implementer',
        verifierStartedRunId: 'run_verifier',
      }),
    );
    runs.set(
      'run_worker_2',
      runRecord({
        runId: 'run_worker_2',
        roleName: 'tester',
        resultText: 'tests passed',
        verifierStartedRunId: 'run_verifier',
      }),
    );
    runs.set(
      'run_verifier',
      runRecord({
        runId: 'run_verifier',
        roleName: 'reviewer',
        phase: 'verifier',
        resultText: 'verified with caveats',
        verifierStartedRunId: 'run_verifier',
      }),
    );

    const leased = leasePendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: 'agent:main:abc',
      leaseId: 'lease_1',
    });

    expect(leased?.runIds.sort()).toEqual(['run_verifier', 'run_worker_1', 'run_worker_2']);
    expect(leased?.prompt).toContain('Team Result Bundle');
    expect(leased?.prompt).toContain('orchestrationRunId: orch_bundle');
    expect(leased?.prompt).toContain('workers:');
    expect(leased?.prompt).toContain('verifier:');
    expect(leased?.prompt).toContain('verified with caveats');
  });
});
