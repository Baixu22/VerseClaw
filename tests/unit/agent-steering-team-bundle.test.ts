import { afterEach, describe, expect, it } from 'vitest';
import {
  leasePendingAgentSteeringItemsFromSubagentRuns,
  listPendingAgentSteeringItemsFromSubagentRuns,
} from '../../openclaw_runtime/src/agents/agent-steering-queue';
import {
  clearMemoryCards,
  getMemoryCards,
} from '../../openclaw_runtime/src/memory/memory-store';
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
  meta?: Partial<TeamOrchestrationMetadata>;
}): SubagentRunRecord {
  const isVerifier = params.phase === 'verifier';
  const meta = orchestration({
    roleName: params.roleName,
    isVerifier,
    phase: isVerifier ? 'verifier' : 'worker',
    verifierStartedRunId: params.verifierStartedRunId,
    ...params.meta,
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
  it.each([true, false])('routes verifier failure to the lead only when configured (%s)', (noSelfRepair) => {
    const runs = new Map<string, SubagentRunRecord>();
    const meta = { verifierStartedRunId: 'run_verifier', verifierNoSelfRepair: noSelfRepair };
    for (const [runId, roleName] of [['run_worker_1', 'implementer'], ['run_worker_2', 'tester']]) {
      runs.set(runId, runRecord({ runId, roleName, meta,
        resultText: 'Implemented and verified tests/unit/agent-steering-team-bundle.test.ts passed.' }));
    }
    runs.set('run_verifier', runRecord({ runId: 'run_verifier', roleName: 'reviewer', phase: 'verifier',
      meta: { ...meta, verificationVerdict: 'fail' }, resultText: 'verificationVerdict: fail' }));
    const prompt = leasePendingAgentSteeringItemsFromSubagentRuns({ runs,
      requesterSessionKey: 'agent:main:abc', leaseId: `discipline-${noSelfRepair}` })?.prompt;
    expect(prompt).toContain('verifierGate: fail');
    const leadNode = 'taskNodeId: lead-fix-orch_bundle-1; roleName: planner; action: repair';
    if (noSelfRepair) expect(prompt).toContain(leadNode);
    else expect(prompt).not.toContain(leadNode);
    expect(prompt).not.toContain('roleName: reviewer; action: repair');
    if (noSelfRepair) expect(prompt).toContain('status: skipped');
  });
  it.each([1, 2])('keeps lead repair inside the existing attempt budget (%s)', (attempt) => {
    const runs = new Map<string, SubagentRunRecord>();
    const meta = { verifierStartedRunId: 'run_verifier', verifierNoSelfRepair: true, attempt };
    for (const [runId, roleName] of [['run_worker_1', 'implementer'], ['run_worker_2', 'tester']]) {
      runs.set(runId, runRecord({ runId, roleName, meta,
        resultText: 'Implemented and verified tests/unit/agent-steering-team-bundle.test.ts passed.' }));
    }
    runs.set('run_verifier', runRecord({ runId: 'run_verifier', roleName: 'reviewer', phase: 'verifier',
      meta: { ...meta, verificationVerdict: 'repair_required' }, resultText: 'verificationVerdict: repair_required' }));
    const prompt = leasePendingAgentSteeringItemsFromSubagentRuns({ runs,
      requesterSessionKey: 'agent:main:abc', leaseId: `budget-${attempt}` })?.prompt;
    expect(prompt).toContain('taskNodeId: lead-fix-orch_bundle-1; roleName: planner; action: repair');
    expect(prompt).toContain(attempt === 1 ? 'repair: action=repair; allowed=true' : 'allowed=false');
    expect(prompt).not.toContain('roleName: reviewer; action: repair');
  });
  afterEach(() => {
    clearMemoryCards();
  });

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
    const taskGraph: NonNullable<TeamOrchestrationMetadata['taskGraph']> = {
      graphRunId: 'graph_bundle',
      mode: 'staged',
      status: 'completed' as never,
      nodes: [
        {
          taskNodeId: 'implementer-1',
          roleName: 'implementer',
          task: 'implementer task',
          phase: 'implementation',
          dependsOn: [],
          scope: 'implementation',
          requiredCapabilities: [],
          attemptPolicy: { maxRepairAttempts: 1, maxRedoAttempts: 1 },
          status: 'completed' as never,
        },
        {
          taskNodeId: 'tester-1',
          roleName: 'tester',
          task: 'tester task',
          phase: 'verification',
          dependsOn: ['implementer-1'],
          scope: 'verification',
          requiredCapabilities: [],
          attemptPolicy: { maxRepairAttempts: 1, maxRedoAttempts: 1 },
          status: 'completed' as never,
        },
      ],
      edges: [
        { from: 'implementer-1', to: 'tester-1', type: 'verification' },
        { from: 'implementer-1', to: 'tester-1', type: 'handoff' },
      ],
    };
    const runs = new Map<string, SubagentRunRecord>();
    runs.set(
      'run_worker_1',
      runRecord({
        runId: 'run_worker_1',
        roleName: 'implementer',
        verifierStartedRunId: 'run_verifier',
        meta: { taskId: 'implementer-1', taskNodeId: 'implementer-1', graphRunId: 'graph_bundle', taskGraph, handoffArtifactsMode: 'on' },
      }),
    );
    runs.set(
      'run_worker_2',
      runRecord({
        runId: 'run_worker_2',
        roleName: 'tester',
        resultText: 'tests passed',
        verifierStartedRunId: 'run_verifier',
        meta: { taskId: 'tester-1', taskNodeId: 'tester-1', graphRunId: 'graph_bundle', taskGraph, handoffArtifactsMode: 'on' },
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
        meta: { taskId: 'reviewer-1', taskNodeId: 'reviewer-1', graphRunId: 'graph_bundle', taskGraph, handoffArtifactsMode: 'on' },
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
    expect(leased?.prompt).toContain('OrchestrationResultBundle');
    expect(leased?.prompt).toContain('schemaVersion: 1');
    expect(leased?.prompt).toContain('schemaGate:');
    expect(leased?.prompt).toContain('verifierGate:');
    expect(leased?.prompt).toContain('memoryProposals:');
    expect(leased?.prompt).toContain('handoffArtifacts: 1');
    expect(leased?.prompt).toContain('ready; implementer-1 -> tester-1');
  });

  it("does not use a same-string taskId as the handoff taskNodeId", () => {
    const taskGraph: NonNullable<TeamOrchestrationMetadata["taskGraph"]> = {
      graphRunId: "graph_bundle",
      mode: "staged",
      status: "completed" as never,
      nodes: [
        {
          taskNodeId: "implementer-1",
          roleName: "implementer",
          task: "implementer task",
          phase: "implementation",
          dependsOn: [],
          scope: "implementation",
          requiredCapabilities: [],
          attemptPolicy: { maxRepairAttempts: 1, maxRedoAttempts: 1 },
          status: "completed" as never,
        },
        {
          taskNodeId: "tester-1",
          roleName: "tester",
          task: "tester task",
          phase: "verification",
          dependsOn: ["implementer-1"],
          scope: "verification",
          requiredCapabilities: [],
          attemptPolicy: { maxRepairAttempts: 1, maxRedoAttempts: 1 },
          status: "completed" as never,
        },
      ],
      edges: [
        { from: "implementer-1", to: "tester-1", type: "handoff" },
      ],
    };
    const runs = new Map<string, SubagentRunRecord>();
    runs.set("run_worker_1", runRecord({
      runId: "run_worker_1",
      roleName: "implementer",
      verifierStartedRunId: "run_verifier",
      meta: { taskId: "implementer-1", graphRunId: "graph_bundle", taskGraph, handoffArtifactsMode: "on" },
    }));
    runs.set("run_worker_2", runRecord({
      runId: "run_worker_2",
      roleName: "tester",
      verifierStartedRunId: "run_verifier",
      meta: { taskNodeId: "tester-1", graphRunId: "graph_bundle", taskGraph, handoffArtifactsMode: "on" },
    }));
    runs.set("run_verifier", runRecord({
      runId: "run_verifier",
      roleName: "reviewer",
      phase: "verifier",
      verifierStartedRunId: "run_verifier",
      meta: { taskNodeId: "reviewer-1", graphRunId: "graph_bundle", taskGraph, handoffArtifactsMode: "on" },
    }));

    const leased = leasePendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: "agent:main:abc",
      leaseId: "lease_missing_task_node",
    });

    expect(leased?.prompt).toContain("handoffArtifacts: 0");
    expect(leased?.prompt).not.toContain("implementer-1 -> tester-1");
  });

  it('renders schema gate failure when successful worker evidence is missing', () => {
    const runs = new Map<string, SubagentRunRecord>();
    runs.set(
      'run_worker_1',
      runRecord({
        runId: 'run_worker_1',
        roleName: 'implementer',
        resultText: 'ok',
        verifierStartedRunId: 'run_verifier',
      }),
    );
    runs.set(
      'run_worker_2',
      runRecord({
        runId: 'run_worker_2',
        roleName: 'tester',
        resultText: 'ok',
        verifierStartedRunId: 'run_verifier',
      }),
    );
    runs.set(
      'run_verifier',
      runRecord({
        runId: 'run_verifier',
        roleName: 'reviewer',
        phase: 'verifier',
        resultText: 'repair required: worker evidence is missing',
        verifierStartedRunId: 'run_verifier',
      }),
    );

    const leased = leasePendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: 'agent:main:abc',
      leaseId: 'lease_missing_evidence',
    });

    expect(leased?.prompt).toContain('schemaGate: fail');
    expect(leased?.prompt).toContain('missing_evidence');
  });

  it('renders memory proposals from structured bundle data without writing role memory', () => {
    const runs = new Map<string, SubagentRunRecord>();
    runs.set(
      'run_worker_1',
      runRecord({
        runId: 'run_worker_1',
        roleName: 'implementer',
        resultText: [
          'Implemented the feature and verified tests/unit/example.test.ts passed.',
          'Memory Candidates:',
          '- scopeKey: orch_bundle; importance: 0.8; durability: stable; content: Keep implementation evidence tied to exact test files.',
        ].join('\n'),
        verifierStartedRunId: 'run_verifier',
      }),
    );
    runs.set(
      'run_worker_2',
      runRecord({
        runId: 'run_worker_2',
        roleName: 'tester',
        resultText: 'tests/unit/example.test.ts passed',
        verifierStartedRunId: 'run_verifier',
      }),
    );
    runs.set(
      'run_verifier',
      runRecord({
        runId: 'run_verifier',
        roleName: 'reviewer',
        phase: 'verifier',
        resultText: 'verified with tests/unit/example.test.ts',
        verifierStartedRunId: 'run_verifier',
      }),
    );

    const leased = leasePendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: 'agent:main:abc',
      leaseId: 'lease_memory_proposal',
    });

    expect(leased?.prompt).toContain('memoryProposals: 1');
    expect(leased?.prompt).toContain('- memoryProposal: roleName: implementer; scopeKey: orch_bundle; evidenceRefs: run:run_worker_1; content: Keep implementation evidence tied to exact test files.');
    expect(getMemoryCards({ status: 'all' })).toHaveLength(0);
  });
});
