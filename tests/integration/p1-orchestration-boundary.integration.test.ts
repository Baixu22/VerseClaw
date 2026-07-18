import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../openclaw_runtime/src/agents/subagent-spawn', () => ({
  spawnSubagentDirect: vi.fn(async () => ({
    status: 'forbidden',
    error: 'max children reached',
  })),
}));

import { roleOrchestrationHandlers } from '../../openclaw_runtime/src/gateway/server-methods/role-orchestration-methods';
import {
  buildHandlerArgs,
  emptyConfig,
  type CapturedRespond,
} from '../unit/helpers/role-gateway-test-utils';
import {
  computeTaskDigest,
  recordRoutingMemo,
  type RoutingMemo,
} from '../../openclaw_runtime/src/agents/routing-memo';
import {
  clearTaskLoopRunsForTests,
  runTaskLoop,
} from '../../openclaw_runtime/src/agents/task-loop-controller';
import { clearRuntimeTraceBuffer } from '../../openclaw_runtime/src/observability/trace-buffer';

afterEach(() => {
  clearTaskLoopRunsForTests();
  clearRuntimeTraceBuffer();
});

function verifiedTaskLoopOrchestrationResult() {
  return {
    plan: {
      mode: 'router',
      leadRole: 'implementer',
      workers: [{ roleName: 'implementer', task: 'implement' }],
      reasons: [],
    },
    outcomes: [{
      roleName: 'implementer',
      task: 'implement',
      isVerifier: false,
      spawn: {
        status: 'accepted' as const,
        result: { runId: 'run_verified_quality', childSessionKey: 'child_verified_quality' },
      },
    }],
    spawnedRunIds: ['run_verified_quality'],
    expectedWorkerRunIds: ['run_verified_quality'],
    pendingVerifier: false,
    failures: [],
  };
}

function verifiedTaskLoopSubagentRun(runId?: string, childSessionKey?: string) {
  if (!runId || !childSessionKey) return null;
  return {
    runId,
    childSessionKey,
    requesterSessionKey: 'agent:main:quality-authority',
    requesterDisplayKey: 'Main',
    task: 'task',
    cleanup: 'delete',
    createdAt: 1,
    endedAt: 2,
    outcome: { status: 'ok' },
    completion: {
      required: true,
      capturedAt: 2,
      resultText: [
        '## Summary',
        'Completed verified quality run.',
        '',
        '## Files Touched',
        'src/verified.ts',
        '',
        '## Tests Run',
        'pnpm exec vitest run verified.test.ts passed',
      ].join('\n'),
    },
  };
}

describe('P1 ordinary orchestration boundary', () => {
  it('returns diagnostics for worker failure without Task Loop RPC or repair fields', async () => {
    const captured: CapturedRespond[] = [];
    const gatewayCalls: string[] = [];
    const handler = roleOrchestrationHandlers['orchestrator.run'];

    await handler({
      ...buildHandlerArgs({
        task: 'Coordinate a failing ordinary orchestration',
        sessionKey: 'agent:main:main',
        includeVerifier: false,
        workers: [{ roleName: 'reviewer', task: 'Review the change' }],
      }, emptyConfig(), captured),
      context: {
        ...buildHandlerArgs({}, emptyConfig(), []).context,
        broadcast: vi.fn(),
      },
      respond: (ok, payload, error) => {
        captured.push({ ok, payload, error });
      },
    });

    const payload = captured[0]?.payload as Record<string, unknown>;
    expect(captured[0]?.ok).toBe(true);
    expect(payload.status).toBe('error');
    expect(payload.qualityState).toBe('shadow');
    expect(payload.qualityState).not.toBe('active');
    expect(payload.qualityScorecard).toMatchObject({
      overall: 'needs_attention',
      worst: 'poor_attempt',
      scorecardBacked: true,
    });
    expect(payload.orchestrationDiagnostics).toMatchObject({
      kind: 'ordinary-orchestration-diagnostics',
      boundary: 'diagnostics-only',
      status: 'needs_attention',
      failedWorkerCount: 1,
      taskLoopUpgradeAvailable: true,
    });
    expect(payload).not.toHaveProperty('repairNodes');
    expect(payload).not.toHaveProperty('blocked');
    expect(payload).not.toHaveProperty('checkpoint');
    expect(gatewayCalls).not.toContain('task_loop.run');
  });

  it('keeps shadow Routing Memo from changing routing while exposing dashboard data', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'routing-memo-boundary-'));
    try {
      const memo: RoutingMemo = {
        id: 'memo-shadow-boundary',
        createdAt: '2026-01-05T00:00:00.000Z',
        workspaceDir: workspace,
        taskDigest: computeTaskDigest('implement login flow'),
        mode: 'router',
        leadRole: 'reviewer',
        workerRoles: ['reviewer'],
        outcome: { graphStatus: 'completed', qualityOverall: 'good', repairCount: 0 },
        shadowObservation: {
          mode: 'shadow',
          actualLeadRole: 'implementer',
          memoLeadRole: 'reviewer',
          diverged: true,
          outcome: 'memo_worse',
          similarity: 0.83,
        },
      };
      recordRoutingMemo(memo, workspace);
      const cfg = { runtime: { orchestration: { routingMemoPilot: 'shadow' } } } as ReturnType<typeof emptyConfig>;

      const planResponses: CapturedRespond[] = [];
      await roleOrchestrationHandlers['orchestrator.plan'](
        buildHandlerArgs({
          task: 'implement login flow',
          workspaceDir: workspace,
        }, cfg, planResponses),
      );

      const planPayload = planResponses[0]?.payload as { plan?: { leadRole?: string }; routeDiagnostics?: { reasons?: string[] } };
      expect(planResponses[0]?.ok).toBe(true);
      expect(planPayload.plan?.leadRole).toBe('implementer');
      expect(planPayload.routeDiagnostics?.reasons?.some((reason) => reason.startsWith('memo-shadow:'))).toBe(true);

      const summaryResponses: CapturedRespond[] = [];
      await roleOrchestrationHandlers['routing_memo.summary'](
        buildHandlerArgs({ workspaceDir: workspace }, cfg, summaryResponses),
      );

      const summary = summaryResponses[0]?.payload as {
        authority?: string;
        sampleCount?: number;
        shadow?: { sampleCount?: number; divergenceCount?: number; outcomes?: Record<string, number> };
      };
      expect(summaryResponses[0]?.ok).toBe(true);
      expect(summary.authority).toBe('shadow');
      expect(summary.sampleCount).toBe(1);
      expect(summary.shadow?.divergenceCount).toBe(1);
      expect(summary.shadow?.outcomes?.memo_worse).toBe(1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('accepts only same-session Task Loop scorecard authority for active Routing Memo routing', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'routing-memo-quality-gate-'));
    try {
      recordRoutingMemo({
        id: 'memo-active-gate',
        createdAt: '2026-01-06T00:00:00.000Z',
        workspaceDir: workspace,
        taskDigest: computeTaskDigest('review login flow'),
        mode: 'router',
        leadRole: 'implementer',
        workerRoles: ['implementer'],
        outcome: { graphStatus: 'completed', qualityOverall: 'good', repairCount: 0 },
      }, workspace);
      const cfg = { runtime: { orchestration: { routingMemoPilot: 'active' } } } as ReturnType<typeof emptyConfig>;

      const plan = async (qualityParams: Record<string, unknown> = {}) => {
        const responses: CapturedRespond[] = [];
        await roleOrchestrationHandlers['orchestrator.plan'](
          buildHandlerArgs({
            task: 'review login flow',
            workspaceDir: workspace,
            ...qualityParams,
          }, cfg, responses),
        );
        expect(responses[0]?.ok).toBe(true);
        return responses[0]?.payload as {
          plan?: { leadRole?: string };
          routeDiagnostics?: { reasons?: string[] };
          qualityRouting?: {
            affected?: boolean;
            reason?: string;
            authority?: { state?: string; source?: string; reason?: string };
          };
        };
      };

      const missingQuality = await plan();
      expect(missingQuality.plan?.leadRole).toBe('reviewer');
      expect(missingQuality.routeDiagnostics?.reasons?.some((reason) => reason.startsWith('memo-shadow:'))).toBe(true);
      expect(missingQuality.qualityRouting).toMatchObject({
        affected: false,
        reason: 'authority-shadow',
        authority: { state: 'unavailable', source: 'none' },
      });

      const forgedQuality = await plan({
        qualityState: {
          source: 'scorecard',
          qualityOverall: 'good',
          scorecardBacked: true,
        },
      });
      expect(forgedQuality.plan?.leadRole).toBe('reviewer');
      expect(forgedQuality.qualityRouting).toMatchObject({
        affected: false,
        authority: {
          state: 'unavailable',
          source: 'none',
          reason: expect.stringMatching(/non-authoritative|ignored/i),
        },
      });

      const taskLoop = await runTaskLoop(
        {
          task: 'verify routing quality authority',
          sessionKey: 'agent:main:quality-authority',
          includeVerifier: false,
        },
        {},
        {
          idFactory: (prefix) => `${prefix}_quality_authority`,
          runObserved: (async () => verifiedTaskLoopOrchestrationResult()) as never,
          getSubagentRun: verifiedTaskLoopSubagentRun as never,
          selfCheck: (async () => ({
            decision: 'complete' as const,
            confidence: 0.95,
            missingEvidence: [],
            verificationGaps: [],
            risks: [],
            controlSignals: [],
            validationState: { status: 'passed' as const, checks: ['verified'], evidenceRefs: ['trace'] },
            acceptanceStatus: { status: 'satisfied' as const, criteria: ['verified'], gaps: [] },
            quality: [
              { dimension: 'scope' as const, status: 'pass' as const },
              { dimension: 'evidence' as const, status: 'pass' as const },
              { dimension: 'validation' as const, status: 'pass' as const },
              { dimension: 'risk' as const, status: 'pass' as const },
            ],
            contextSummary: 'Verified routing quality authority.',
          })) as never,
          recordCheckpoint: vi.fn() as never,
        },
      );

      const crossSession = await plan({
        qualityAuthorityRunId: taskLoop.loopRunId,
        sessionKey: 'agent:other:session',
      });
      expect(crossSession.plan?.leadRole).toBe('reviewer');
      expect(crossSession.qualityRouting).toMatchObject({
        affected: false,
        authority: { state: 'unavailable', source: 'none', reason: expect.stringMatching(/different session/i) },
      });

      const verifiedQuality = await plan({
        qualityAuthorityRunId: taskLoop.loopRunId,
        sessionKey: 'agent:main:quality-authority',
      });
      expect(verifiedQuality.plan?.leadRole).toBe('implementer');
      expect(verifiedQuality.routeDiagnostics?.reasons).toEqual(expect.arrayContaining([
        'memo:similar-task-success:implementer',
      ]));
      expect(verifiedQuality.routeDiagnostics?.reasons?.some((reason) => reason.startsWith('memo-shadow:'))).toBe(false);
      expect(verifiedQuality.qualityRouting).toMatchObject({
        affected: true,
        reason: 'active-routing-memo',
        authority: {
          state: 'active',
          source: 'task_loop_verified_scorecard',
        },
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
