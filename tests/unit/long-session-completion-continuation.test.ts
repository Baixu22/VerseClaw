import { describe, expect, it } from 'vitest';
import { buildOrchestrationCompletionBatches } from '../../openclaw_runtime/src/agents/orchestration-completion-batches';
import type { SubagentRunRecord } from '../../openclaw_runtime/src/agents/subagent-registry.types';

function run(params: {
  runId: string;
  batch: string;
  expected: string[];
  role?: string;
  createdAt?: number;
  endedAt?: number;
  outcome?: 'ok' | 'error' | 'timeout' | 'unknown';
  reason?: 'subagent-complete' | 'subagent-error' | 'subagent-killed';
  generation?: string;
  delivery?: SubagentRunRecord['delivery'];
  resultText?: string;
}): SubagentRunRecord {
  return {
    runId: params.runId,
    childSessionKey: `agent:main:subagent:${params.runId}`,
    requesterSessionKey: 'agent:main:long-session',
    requesterSessionId: params.generation ?? 'generation-1',
    requesterDisplayKey: 'main',
    task: `task ${params.runId}`,
    cleanup: 'keep',
    createdAt: params.createdAt ?? 100,
    endedAt: params.endedAt,
    endedReason: params.reason,
    outcome: params.outcome ? { status: params.outcome } : undefined,
    completion: { required: true, ...(params.resultText ? { resultText: params.resultText } : {}) },
    delivery: params.delivery,
    orchestration: {
      orchestrationRunId: params.batch,
      roleName: params.role ?? 'worker',
      isVerifier: false,
      phase: 'worker',
      leadRole: 'lead',
      originalTask: 'batch task',
      expectedWorkerRunIds: params.expected,
    },
  };
}

const expected = ['run-a', 'run-b'];

describe('long-session orchestration completion batches', () => {
  it('stays collecting until every expected accepted worker is terminal', () => {
    const batches = buildOrchestrationCompletionBatches({
      runs: [run({ runId: 'run-a', batch: 'orch-1', expected, endedAt: 200, outcome: 'ok' })],
      requesterSessionKey: 'agent:main:long-session',
      currentRequesterSessionId: 'generation-1',
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      status: 'collecting',
      outcome: 'incomplete',
      consolidatedReceiptId: null,
      counts: { expected: 2, settled: 1, completed: 1 },
    });
  });

  it('commits one deterministic consolidated receipt after success, failure and cancellation all settle', () => {
    const runs = [
      run({ runId: 'run-a', batch: 'orch-1', expected, endedAt: 200, outcome: 'ok', delivery: { status: 'delivered', deliveredAt: 220 } }),
      run({ runId: 'run-b', batch: 'orch-1', expected, endedAt: 210, outcome: 'error', reason: 'subagent-killed', delivery: { status: 'suspended', suspendedAt: 230, suspendedReason: 'expiry' } }),
    ];
    const first = buildOrchestrationCompletionBatches({ runs, requesterSessionKey: 'agent:main:long-session', currentRequesterSessionId: 'generation-1' })[0];
    const second = buildOrchestrationCompletionBatches({ runs: [...runs].reverse(), requesterSessionKey: 'agent:main:long-session', currentRequesterSessionId: 'generation-1' })[0];
    expect(first).toMatchObject({
      status: 'terminal',
      outcome: 'partial',
      counts: { expected: 2, settled: 2, completed: 1, cancelled: 1 },
      delivery: { delivered: 1, suspended: 1 },
    });
    expect(first?.consolidatedReceiptId).toBe('orch-1:agent:main:long-session:generation-1:consolidated:v1');
    expect(second?.consolidatedReceiptId).toBe(first?.consolidatedReceiptId);
  });

  it('fences a terminal batch when the requester generation changed', () => {
    const runs = expected.map((runId) => run({ runId, batch: 'orch-2', expected, endedAt: 300, outcome: 'ok' }));
    const [batch] = buildOrchestrationCompletionBatches({
      runs,
      requesterSessionKey: 'agent:main:long-session',
      currentRequesterSessionId: 'generation-2',
    });
    expect(batch).toMatchObject({ status: 'fenced', outcome: 'fenced', generationState: 'mismatch', consolidatedReceiptId: null });
  });

  it('preserves busy/paused delivery intent and never treats a pending intent as delivered', () => {
    const runs = expected.map((runId, index) => run({
      runId,
      batch: 'orch-3',
      expected,
      endedAt: 300 + index,
      outcome: 'ok',
      delivery: {
        status: 'pending',
        lastDropReason: 'waiting_for_requester_turn',
        payload: {
          requesterSessionKey: 'agent:main:long-session',
          requesterDisplayKey: 'main',
          childSessionKey: `agent:main:subagent:${runId}`,
          childRunId: runId,
          task: 'task',
        },
      },
    }));
    const [batch] = buildOrchestrationCompletionBatches({ runs, requesterSessionKey: 'agent:main:long-session', currentRequesterSessionId: 'generation-1' });
    expect(batch).toMatchObject({
      status: 'terminal',
      delivery: { state: 'pending', pending: 2, delivered: 0, waitingForRequesterTurn: true },
      consolidatedReceiptId: expect.any(String),
    });
  });

  it('replays the same batch receipt from persisted rows after restart', () => {
    const runs = expected.map((runId) => run({ runId, batch: 'orch-4', expected, endedAt: 400, outcome: 'ok', delivery: { status: 'delivered', deliveredAt: 410 } }));
    const before = buildOrchestrationCompletionBatches({ runs, requesterSessionKey: 'agent:main:long-session', currentRequesterSessionId: 'generation-1' });
    const restored = JSON.parse(JSON.stringify(runs)) as SubagentRunRecord[];
    const after = buildOrchestrationCompletionBatches({ runs: restored, requesterSessionKey: 'agent:main:long-session', currentRequesterSessionId: 'generation-1' });
    expect(after).toEqual(before);
  });

  it('keeps multiple independent batches separate', () => {
    const batches = buildOrchestrationCompletionBatches({
      runs: [
        run({ runId: 'run-a', batch: 'orch-a', expected: ['run-a'], endedAt: 200, outcome: 'ok' }),
        run({ runId: 'run-b', batch: 'orch-b', expected: ['run-b'], endedAt: 210, outcome: 'error', reason: 'subagent-error' }),
      ],
      requesterSessionKey: 'agent:main:long-session',
      currentRequesterSessionId: 'generation-1',
    });
    expect(batches.map((batch) => [batch.orchestrationRunId, batch.outcome])).toEqual([
      ['orch-a', 'completed'],
      ['orch-b', 'failed'],
    ]);
  });

  it('uses terminal outcome facts rather than model text to classify a member', () => {
    const [batch] = buildOrchestrationCompletionBatches({
      runs: [run({ runId: 'run-a', batch: 'orch-text', expected: ['run-a'], endedAt: 500, outcome: 'ok', resultText: 'failed' })],
      requesterSessionKey: 'agent:main:long-session',
      currentRequesterSessionId: 'generation-1',
    });
    expect(batch?.members[0]?.status).toBe('completed');
    expect(batch?.outcome).toBe('completed');
  });
});