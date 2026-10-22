import { describe, expect, it } from 'vitest';
import {
  buildCompletionBatchReceipts,
  MAX_SESSION_COMPLETION_BATCH_WORKERS,
} from '../../openclaw_runtime/src/agents/completion-batch-receipt';
import {
  ackLeasedAgentSteeringItemsFromSubagentRuns,
  buildMergedAgentSteeringPrompt,
  leasePendingAgentSteeringItemsFromSubagentRuns,
  listPendingAgentSteeringItemsFromSubagentRuns,
} from '../../openclaw_runtime/src/agents/agent-steering-queue';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';

const REQUESTER = 'agent:main:coordinator';
const GENERATION = 'requester-generation-1';

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function workerRun(overrides: Partial<SubagentRunRecord> & { runId: string; childSessionKey: string }): SubagentRunRecord {
  const orchestration = overrides.orchestration ?? {
    orchestrationRunId: 'orch-a',
    roleName: 'implementer',
    isVerifier: false,
    phase: 'worker' as const,
    leadRole: 'architect',
    originalTask: 'Implement the coordinated slice',
    expectedWorkerRunIds: [overrides.runId],
    taskId: overrides.runId,
    taskNodeId: overrides.runId,
  };
  const outcome = hasOwn(overrides, 'outcome')
    ? overrides.outcome
    : { status: 'ok' as const };
  const endedAt = hasOwn(overrides, 'endedAt') ? overrides.endedAt : 2_000;
  const priorDelivery = overrides.delivery;
  const priorPayload = priorDelivery?.payload;
  return {
    controllerSessionKey: REQUESTER,
    requesterSessionKey: REQUESTER,
    requesterSessionId: GENERATION,
    requesterDisplayKey: 'main',
    task: 'Task ' + overrides.runId,
    cleanup: 'keep',
    createdAt: 1_000,
    startedAt: 1_100,
    expectsCompletionMessage: true,
    ...overrides,
    orchestration,
    outcome,
    endedAt,
    delivery: {
      ...priorDelivery,
      status: priorDelivery?.status ?? 'pending',
      payload: {
        requesterSessionKey: REQUESTER,
        requesterDisplayKey: 'main',
        childSessionKey: overrides.childSessionKey,
        childRunId: overrides.runId,
        task: 'Task ' + overrides.runId,
        outcome,
        endedAt,
        ...priorPayload,
        orchestration: priorPayload?.orchestration ?? orchestration,
      },
    },
  };
}

function workerForBatch(runId: string, overrides: Partial<SubagentRunRecord> = {}): SubagentRunRecord {
  const expectedWorkerRunIds = ['worker-a', 'worker-b', 'worker-c'];
  return workerRun({
    runId,
    childSessionKey: 'agent:main:' + runId,
    orchestration: {
      orchestrationRunId: 'orch-a',
      roleName: runId,
      isVerifier: false,
      phase: 'worker',
      leadRole: 'architect',
      originalTask: 'Implement the coordinated slice',
      expectedWorkerRunIds,
      taskId: runId,
      taskNodeId: runId,
    },
    ...overrides,
  });
}

function batchRuns(): Map<string, SubagentRunRecord> {
  return new Map([
    ['worker-a', workerForBatch('worker-a')],
    ['worker-b', workerForBatch('worker-b', {
      outcome: { status: 'error', error: 'tests failed' },
    })],
    ['worker-c', workerForBatch('worker-c', {
      endedAt: undefined,
      outcome: undefined,
    })],
  ]);
}

function finishWorkers(runs: Map<string, SubagentRunRecord>, endedAt = 3_000): void {
  for (const run of runs.values()) {
    run.endedAt = endedAt;
    run.outcome = run.outcome ?? { status: 'ok' };
    run.delivery = { ...run.delivery, status: 'pending', payload: run.delivery?.payload };
    if (run.delivery?.payload) {
      run.delivery.payload.endedAt = endedAt;
      run.delivery.payload.outcome = run.outcome;
    }
  }
}

describe('long-session completion continuation', () => {
  it('collects completion and cancellation until the whole batch is terminal, then delivers once', () => {
    const runs = batchRuns();
    const collecting = buildCompletionBatchReceipts([...runs.values()], REQUESTER);
    expect(collecting).toHaveLength(1);
    expect(collecting[0]).toMatchObject({
      orchestrationRunId: 'orch-a',
      terminal: false,
      status: 'collecting',
      expectedWorkerCount: 3,
      completedWorkerCount: 1,
      failedWorkerCount: 1,
      pendingWorkerCount: 1,
      completionAuthority: 'none',
      generationState: 'consistent',
    });
    expect(listPendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
    })).toHaveLength(0);

    const cancelled = runs.get('worker-c')!;
    cancelled.endedAt = 3_000;
    cancelled.endedReason = 'subagent-killed';
    cancelled.outcome = undefined;
    if (cancelled.delivery?.payload) {
      cancelled.delivery.payload.endedAt = 3_000;
      cancelled.delivery.payload.outcome = undefined;
    }
    const terminal = buildCompletionBatchReceipts([...runs.values()], REQUESTER)[0]!;
    expect(terminal).toMatchObject({
      terminal: true,
      status: 'delivery-pending',
      completedWorkerCount: 1,
      failedWorkerCount: 1,
      cancelledWorkerCount: 1,
      pendingWorkerCount: 0,
      delivery: { state: 'pending', pendingCount: 3 },
    });
    expect(terminal.idempotencyKey).toBe('completion-batch:orch-a:' + REQUESTER);

    const leased = leasePendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
      leaseId: 'lease-a',
    });
    expect(leased?.runIds.sort()).toEqual(['worker-a', 'worker-b', 'worker-c']);
    expect(leased?.prompt).toContain('idempotencyKey: completion-batch:orch-a:' + REQUESTER);
    expect(leased?.prompt).toContain('completionAuthority: none');
    expect(ackLeasedAgentSteeringItemsFromSubagentRuns({
      runs,
      runIds: leased!.runIds,
      leaseId: 'lease-a',
    })).toBe(3);

    const delivered = buildCompletionBatchReceipts([...runs.values()], REQUESTER)[0]!;
    expect(delivered).toMatchObject({ status: 'delivered', delivery: { deliveredCount: 3 } });
    expect(delivered.idempotencyKey).toBe(terminal.idempotencyKey);
  });

  it('requires a deferred verifier to become terminal before releasing the team bundle', () => {
    const runs = batchRuns();
    finishWorkers(runs);
    for (const run of runs.values()) {
      run.orchestration = {
        ...run.orchestration!,
        verifierRole: 'reviewer',
        verifierStartedRunId: 'verifier-a',
      };
      if (run.delivery?.payload) {
        run.delivery.payload.orchestration = run.orchestration;
      }
    }
    const collecting = buildCompletionBatchReceipts([...runs.values()], REQUESTER)[0]!;
    expect(collecting).toMatchObject({
      terminal: false,
      verifier: { runId: 'verifier-a', status: 'pending' },
      pendingWorkerCount: 0,
    });
    expect(listPendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
    })).toHaveLength(0);

    const verifier = workerRun({
      runId: 'verifier-a',
      childSessionKey: 'agent:main:verifier-a',
      orchestration: {
        orchestrationRunId: 'orch-a',
        roleName: 'reviewer',
        isVerifier: true,
        phase: 'verifier',
        leadRole: 'architect',
        originalTask: 'Implement the coordinated slice',
        expectedWorkerRunIds: ['worker-a', 'worker-b', 'worker-c'],
        verifierRole: 'reviewer',
        verifierStartedRunId: 'verifier-a',
        taskId: 'verifier-a',
        taskNodeId: 'verifier-a',
      },
    });
    runs.set('verifier-a', verifier);
    const terminal = buildCompletionBatchReceipts([...runs.values()], REQUESTER)[0]!;
    expect(terminal).toMatchObject({ terminal: true, verifier: { runId: 'verifier-a', status: 'completed' } });
    const pending = listPendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
    });
    expect(pending).toHaveLength(4);
    expect(buildMergedAgentSteeringPrompt(pending)).toContain('Verifier result');
  });

  it('reports a missing accepted worker without creating a phantom completion or delivery', () => {
    const runs = batchRuns();
    finishWorkers(runs);
    const first = runs.get('worker-a')!;
    first.orchestration = {
      ...first.orchestration!,
      expectedWorkerRunIds: ['worker-a', 'worker-b', 'worker-c', 'worker-missing'],
    };
    if (first.delivery?.payload) {
      first.delivery.payload.orchestration = first.orchestration;
    }
    const receipt = buildCompletionBatchReceipts([...runs.values()], REQUESTER)[0]!;
    expect(receipt).toMatchObject({
      terminal: false,
      status: 'collecting',
      expectedWorkerCount: 4,
      pendingWorkerCount: 1,
    });
    expect(receipt.workerRuns.find((worker) => worker.runId === 'worker-missing')).toMatchObject({ status: 'missing' });
    expect(listPendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
    })).toHaveLength(0);
  });

  it('keeps independent batches isolated and fences mixed worker generations', () => {
    const runs = batchRuns();
    finishWorkers(runs);
    const x = workerRun({
      runId: 'worker-x',
      childSessionKey: 'agent:main:worker-x',
      requesterSessionId: 'requester-generation-2',
      orchestration: {
        orchestrationRunId: 'orch-b',
        roleName: 'docs-writer',
        isVerifier: false,
        phase: 'worker',
        leadRole: 'architect',
        originalTask: 'Write documentation',
        expectedWorkerRunIds: ['worker-x', 'worker-y'],
        taskId: 'task-x',
        taskNodeId: 'task-x',
      },
    });
    const y = workerRun({
      runId: 'worker-y',
      childSessionKey: 'agent:main:worker-y',
      requesterSessionId: 'requester-generation-3',
      orchestration: {
        orchestrationRunId: 'orch-b',
        roleName: 'docs-reviewer',
        isVerifier: false,
        phase: 'worker',
        leadRole: 'architect',
        originalTask: 'Write documentation',
        expectedWorkerRunIds: ['worker-x', 'worker-y'],
        taskId: 'task-y',
        taskNodeId: 'task-y',
      },
    });
    for (const run of runs.values()) runs.set(run.runId, run);
    runs.set(x.runId, x);
    runs.set(y.runId, y);
    const receipts = buildCompletionBatchReceipts([...runs.values()], REQUESTER);
    expect(receipts.find((receipt) => receipt.orchestrationRunId === 'orch-b')).toMatchObject({
      terminal: true,
      generationState: 'mismatch',
      status: 'partial',
    });
    const pending = listPendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
    });
    expect(pending.map((item) => item.runId).sort()).toEqual(['worker-a', 'worker-b', 'worker-c']);
    const prompt = buildMergedAgentSteeringPrompt(pending)!;
    expect(prompt.match(/Team Result Bundle/g)).toHaveLength(1);
    expect(prompt).not.toContain('docs-writer');
  });

  it('fences a stale parent generation and leaves the durable delivery intent pending', () => {
    const runs = batchRuns();
    finishWorkers(runs);
    expect(leasePendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: 'requester-generation-stale',
      leaseId: 'stale-lease',
    })).toBeUndefined();
    expect([...runs.values()].every((run) => run.delivery?.status === 'pending')).toBe(true);
    const leased = leasePendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
      leaseId: 'current-lease',
    });
    expect(leased?.runIds.sort()).toEqual(['worker-a', 'worker-b', 'worker-c']);
  });

  it('does not split a bounded batch into a partial prompt after a crash and replay', () => {
    const runs = batchRuns();
    finishWorkers(runs);
    const firstLease = leasePendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
      leaseId: 'lease-before-restart',
      now: 5_000,
    })!;
    expect(firstLease.runIds).toHaveLength(3);
    const replayed = new Map<string, SubagentRunRecord>(
      JSON.parse(JSON.stringify([...runs.entries()])) as Array<[string, SubagentRunRecord]>,
    );
    expect(listPendingAgentSteeringItemsFromSubagentRuns({
      runs: replayed,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
      now: 5_001,
    })).toHaveLength(0);
    expect(leasePendingAgentSteeringItemsFromSubagentRuns({
      runs: replayed,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
      leaseId: 'duplicate-lease',
      now: 5_001,
    })).toBeUndefined();
    expect(ackLeasedAgentSteeringItemsFromSubagentRuns({
      runs: replayed,
      runIds: firstLease.runIds,
      leaseId: 'lease-before-restart',
      now: 6_000,
    })).toBe(3);
    expect(listPendingAgentSteeringItemsFromSubagentRuns({
      runs: replayed,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
      now: 20_000,
    })).toHaveLength(0);
  });

  it('keeps one consolidated delivery per orchestration across multiple terminal batches', () => {
    const runs = batchRuns();
    finishWorkers(runs);
    const x = workerRun({
      runId: 'worker-x',
      childSessionKey: 'agent:main:worker-x',
      orchestration: {
        orchestrationRunId: 'orch-b',
        roleName: 'docs-writer',
        isVerifier: false,
        phase: 'worker',
        leadRole: 'architect',
        originalTask: 'Write documentation',
        expectedWorkerRunIds: ['worker-x'],
        taskId: 'task-x',
        taskNodeId: 'task-x',
      },
    });
    runs.set(x.runId, x);
    const leased = leasePendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
      leaseId: 'multi-batch-lease',
    })!;
    expect(leased.runIds.sort()).toEqual(['worker-a', 'worker-b', 'worker-c', 'worker-x']);
    expect(leased.prompt.match(/Team Result Bundle/g)).toHaveLength(2);
    expect(leased.prompt).toContain('idempotencyKey: completion-batch:orch-a:' + REQUESTER);
    expect(leased.prompt).toContain('idempotencyKey: completion-batch:orch-b:' + REQUESTER);
  });

  it('bounds worker references and refuses consolidated delivery above the batch limit', () => {
    const expectedWorkerRunIds = Array.from(
      { length: MAX_SESSION_COMPLETION_BATCH_WORKERS + 1 },
      (_, index) => 'worker-' + index,
    );
    const runs = new Map<string, SubagentRunRecord>();
    for (const runId of expectedWorkerRunIds) {
      runs.set(runId, workerRun({
        runId,
        childSessionKey: 'agent:main:' + runId,
        orchestration: {
          orchestrationRunId: 'orch-large',
          roleName: 'worker',
          isVerifier: false,
          phase: 'worker',
          leadRole: 'architect',
          originalTask: 'Large bounded batch',
          expectedWorkerRunIds,
          taskId: runId,
          taskNodeId: runId,
        },
      }));
    }
    const receipt = buildCompletionBatchReceipts([...runs.values()], REQUESTER)[0]!;
    expect(receipt).toMatchObject({
      expectedWorkerCount: MAX_SESSION_COMPLETION_BATCH_WORKERS + 1,
      bounded: false,
      terminal: true,
      status: 'partial',
    });
    expect(receipt.workerRuns).toHaveLength(MAX_SESSION_COMPLETION_BATCH_WORKERS);
    expect(listPendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
    })).toHaveLength(0);
  });

  it('does not infer delivery from immediate worker text and requires explicit delivery state', () => {
    const immediate = workerRun({
      runId: 'worker-immediate',
      childSessionKey: 'agent:main:worker-immediate',
      createdAt: 1_000,
      endedAt: 1_000,
      outcome: { status: 'ok' },
      delivery: {
        status: 'pending',
        payload: {
          requesterSessionKey: REQUESTER,
          requesterDisplayKey: 'main',
          childSessionKey: 'agent:main:worker-immediate',
          childRunId: 'worker-immediate',
          task: 'Task worker-immediate',
          frozenResultText: 'Done',
        },
      },
      orchestration: {
        orchestrationRunId: 'orch-immediate',
        roleName: 'implementer',
        isVerifier: false,
        phase: 'worker',
        leadRole: 'architect',
        originalTask: 'Immediate completion',
        expectedWorkerRunIds: ['worker-immediate'],
        taskId: 'worker-immediate',
        taskNodeId: 'worker-immediate',
      },
    });
    const runs = new Map([[immediate.runId, immediate]]);
    const pendingDelivery = buildCompletionBatchReceipts([...runs.values()], REQUESTER)[0]!;
    expect(pendingDelivery).toMatchObject({
      terminal: true,
      status: 'delivery-pending',
      completedWorkerCount: 1,
      delivery: { state: 'pending', deliveredCount: 0 },
    });
    immediate.delivery = { status: 'delivered', deliveredAt: 2_000 };
    expect(buildCompletionBatchReceipts([...runs.values()], REQUESTER)[0]).toMatchObject({
      status: 'delivered',
      delivery: { state: 'delivered', deliveredCount: 1 },
    });
  });

  it('keeps suspended delivery intent and resumes it only in the pinned parent generation', () => {
    const runs = batchRuns();
    finishWorkers(runs);
    runs.get('worker-b')!.delivery = {
      ...runs.get('worker-b')!.delivery,
      status: 'suspended',
      suspendedAt: 2_500,
      suspendedReason: 'retry-limit',
    };
    const receipt = buildCompletionBatchReceipts([...runs.values()], REQUESTER)[0]!;
    expect(receipt).toMatchObject({
      terminal: true,
      status: 'delivery-pending',
      delivery: { state: 'suspended', pendingCount: 2, suspendedCount: 1 },
    });
    expect(leasePendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: 'requester-generation-stale',
      leaseId: 'stale-suspended-lease',
    })).toBeUndefined();
    expect(leasePendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
      leaseId: 'active-suspended-lease',
    })?.runIds.sort()).toEqual(['worker-a', 'worker-b', 'worker-c']);
  });

  it('never retries a team prompt once any member has started or completed delivery', () => {
    const runs = batchRuns();
    finishWorkers(runs);
    runs.get('worker-a')!.delivery = { status: 'delivered', deliveredAt: 4_000 };
    expect(listPendingAgentSteeringItemsFromSubagentRuns({
      runs,
      requesterSessionKey: REQUESTER,
      requesterSessionId: GENERATION,
      now: 10_000,
    })).toHaveLength(0);
    const receipt = buildCompletionBatchReceipts([...runs.values()], REQUESTER)[0]!;
    expect(receipt).toMatchObject({ terminal: true, status: 'partial', delivery: { deliveredCount: 1 } });
  });
});
