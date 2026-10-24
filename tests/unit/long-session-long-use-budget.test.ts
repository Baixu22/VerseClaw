// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  LONG_SESSION_LONG_USE_BUDGET,
  evaluateLongSessionLongUseBudgets,
  percentile,
  type LongUseMeasurement,
} from '../../shared/long-session-long-use-budget';
import { buildCompletionActivity } from '../../src/components/rareui/completion-activity';
import { buildOrchestrationCompletionBatches } from '../../openclaw_runtime/src/agents/orchestration-completion-batches';
import { evaluateCronCoordinatorScope } from '../../shared/long-session-followup-scope';

function measurement(overrides: Partial<LongUseMeasurement> = {}): LongUseMeasurement {
  return {
    sessionCount: 333,
    transcriptBytes: 52 * 1024 * 1024,
    loadP95Ms: 900,
    switchP95Ms: 180,
    compactP95Ms: 2_000,
    continuationP95Ms: 1_500,
    gcAvailable: true,
    idleDurationMs: 300_000,
    idleSampleCount: 60,
    idleGrowthBytes: 8 * 1024 * 1024,
    idleLongestRise: 5,
    lifecycleCycles: 50,
    ownerResidual: 0,
    notificationDuplicates: 0,
    pausedQueueLength: 10,
    expiredQueueLength: 10,
    ...overrides,
  };
}

describe('long-session long-use budgets', () => {
  it('freezes the F2 minimums and configured headroom above current smoke samples', () => {
    expect(LONG_SESSION_LONG_USE_BUDGET.minimumSessionCount).toBe(333);
    expect(LONG_SESSION_LONG_USE_BUDGET.minimumTranscriptBytes).toBeGreaterThanOrEqual(50 * 1024 * 1024);
    expect(LONG_SESSION_LONG_USE_BUDGET.maxLoadP95Ms).toBe(1_500);
    expect(LONG_SESSION_LONG_USE_BUDGET.maxSwitchP95Ms).toBe(300);
    expect(LONG_SESSION_LONG_USE_BUDGET.maxCompactP95Ms).toBe(15_000);
    expect(LONG_SESSION_LONG_USE_BUDGET.idleDurationMs).toBe(300_000);
    expect(LONG_SESSION_LONG_USE_BUDGET.minimumLifecycleCycles).toBe(50);
  });

  it('passes a representative clean measurement and computes exact percentiles', () => {
    expect(evaluateLongSessionLongUseBudgets(measurement())).toEqual([]);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(3);
    expect(percentile([], 0.95)).toBeNull();
  });

  it('fails closed for missing GC, growth, residual owners, duplicate notices, and oversized queues', () => {
    expect(evaluateLongSessionLongUseBudgets(measurement({ gcAvailable: false }))).toContain('gc-unavailable');
    expect(evaluateLongSessionLongUseBudgets(measurement({ idleGrowthBytes: 65 * 1024 * 1024 }))).toContain('idle-growth');
    expect(evaluateLongSessionLongUseBudgets(measurement({ ownerResidual: 1 }))).toContain('owner-residual');
    expect(evaluateLongSessionLongUseBudgets(measurement({ notificationDuplicates: 1 }))).toContain('notification-duplicates');
    expect(evaluateLongSessionLongUseBudgets(measurement({ pausedQueueLength: 65 }))).toContain('paused-queue');
    expect(evaluateLongSessionLongUseBudgets(measurement({ expiredQueueLength: 65 }))).toContain('expired-queue');
  });

  it('keeps the duplicate-completion notification feed deduped and bounded', () => {
    expect(LONG_SESSION_LONG_USE_BUDGET.maxNotificationDuplicates).toBe(0);
    const sessionKey = 'agent:main:s000';
    const cards = [
      { runKey: 'dup-card', runId: 'run-dup', triggerIndex: 3, status: 'completed', active: false, hasVisibleReply: true, endedAt: 99_000 },
      ...Array.from({ length: 80 }, (_, index) => ({
        runKey: `turn-${index}`,
        runId: `turn-run-${index}`,
        triggerIndex: 100 + index,
        status: 'completed',
        active: false,
        hasVisibleReply: true,
        endedAt: 9_000 + index,
      })),
    ];
    const runs = {
      dup: {
        runId: 'run-dup',
        sessionKey,
        status: 'completed',
        endedAt: 99_000,
        assistantText: 'same run seen twice',
        thinkingText: '',
        events: [],
      },
    };
    const turns = [
      { index: 3, response: 'same turn seen twice', completedAt: 99 },
      ...Array.from({ length: 80 }, (_, index) => ({
        index: 100 + index,
        response: `reply ${index}`,
        completedAt: 9 + index,
      })),
    ];
    const entries = buildCompletionActivity(
      sessionKey,
      cards as never,
      runs as never,
      new Map([[3, 'Visible response']]),
      turns,
    );
    // The same completion arriving as card + run + turn must produce one row.
    expect(entries.filter((entry) => entry.id === `${sessionKey}:run-dup`)).toHaveLength(1);
    expect(entries.some((entry) => entry.id === `${sessionKey}:message:3`)).toBe(false);
    // Long-lived feeds stay bounded, and every row keeps a unique notification id.
    expect(entries.length).toBeLessThanOrEqual(50);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });

  it('bounds a paused delivery batch and refuses an expired follow-up queue', () => {
    expect(LONG_SESSION_LONG_USE_BUDGET.maxPausedQueueLength).toBe(64);
    expect(LONG_SESSION_LONG_USE_BUDGET.maxExpiredQueueLength).toBe(64);
    const expectedWorkerRunIds = Array.from({ length: 200 }, (_, index) => `run-${index}`);
    const runs = expectedWorkerRunIds.map((runId, index) => ({
      runId,
      label: `worker-${index}`,
      childSessionKey: `agent:child:${index}`,
      requesterSessionKey: 'agent:main:s000',
      createdAt: 1_000 + index,
      endedAt: 2_000 + index,
      endedReason: undefined,
      outcome: { status: 'ok' },
      orchestration: {
        phase: 'worker',
        orchestrationRunId: 'orch-long-use',
        expectedWorkerRunIds,
        roleName: 'worker',
      },
    }));
    const batches = buildOrchestrationCompletionBatches({
      runs: runs as never,
      requesterSessionKey: 'agent:main:s000',
      currentRequesterSessionId: 'generation-1',
    });
    expect(batches).toHaveLength(1);
    // A batch larger than the shipped 64-member cap can never become terminal,
    // so a paused/suspended delivery queue cannot grow without bound.
    expect(batches[0].members.length).toBeLessThanOrEqual(64);
    expect(batches[0].status).toBe('collecting');
    expect(batches[0].consolidatedReceiptId).toBeNull();

    const nowMs = Date.parse('2026-10-25T00:00:00.000Z');
    const verdict = evaluateCronCoordinatorScope({
      scope: {
        schemaVersion: 'CronCoordinatorScope/v1',
        workspaceId: 'workspace-f2',
        coordinatorSessionKey: 'agent:main:s000',
        expectedSessionId: 'generation-1',
        intent: 'follow-up',
        expiresAtMs: nowMs - 1,
        notificationPolicy: 'silent-unless-result',
      },
      nowMs,
      liveSessionId: 'generation-1',
    });
    // Expired follow-ups are refused at delivery time instead of being queued.
    expect(verdict.allowed).toBe(false);
    expect(verdict.state).toBe('expired');
  });
});
