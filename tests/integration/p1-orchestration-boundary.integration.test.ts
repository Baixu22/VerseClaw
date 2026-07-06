import { describe, expect, it, vi } from 'vitest';
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

  it('keeps active Routing Memo authority gated until scorecard-backed quality is present', async () => {
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

      const plan = async (qualityState?: Record<string, unknown> | null) => {
        const responses: CapturedRespond[] = [];
        await roleOrchestrationHandlers['orchestrator.plan'](
          buildHandlerArgs({
            task: 'review login flow',
            workspaceDir: workspace,
            ...(qualityState ? { qualityState } : {}),
          }, cfg, responses),
        );
        expect(responses[0]?.ok).toBe(true);
        return responses[0]?.payload as { plan?: { leadRole?: string }; routeDiagnostics?: { reasons?: string[] } };
      };

      const missingQuality = await plan(null);
      expect(missingQuality.plan?.leadRole).toBe('reviewer');
      expect(missingQuality.routeDiagnostics?.reasons?.some((reason) => reason.startsWith('memo-shadow:'))).toBe(true);

      const ordinaryQuality = await plan({
        source: 'ordinary_orchestration',
        qualityOverall: 'good',
        scorecardBacked: false,
      });
      expect(ordinaryQuality.plan?.leadRole).toBe('reviewer');
      expect(ordinaryQuality.routeDiagnostics?.reasons?.some((reason) => reason.startsWith('memo-shadow:'))).toBe(true);

      const scorecardQuality = await plan({
        source: 'scorecard',
        qualityOverall: 'good',
        scorecardBacked: true,
      });
      expect(scorecardQuality.plan?.leadRole).toBe('implementer');
      expect(scorecardQuality.routeDiagnostics?.reasons).toEqual(expect.arrayContaining([
        'memo:similar-task-success:implementer',
      ]));
      expect(scorecardQuality.routeDiagnostics?.reasons?.some((reason) => reason.startsWith('memo-shadow:'))).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
