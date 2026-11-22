// @vitest-environment node
import type { ElectronApplication } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { hostInvoke } from '../e2e/fixtures/fp-p1-harness';
import { runWithHostDeadline } from '../../electron/utils/host-deadline-context';
import { HOST_ACTION_DEFAULT_TIMEOUT_MS, HOST_ACTION_LONG_TIMEOUT_MS } from '../../shared/host-api/host-action-timeouts';
import type { HostDeadline, HostTimeoutDetails } from '../../shared/host-api/host-deadline';

function bridge(response: unknown = { ok: true, data: { result: 'observed' } }) {
  const evaluate = vi.fn(async (_fn: unknown, _input: unknown) => ({ response, windowId: 7 }));
  return { evaluate, app: { evaluate } as unknown as ElectronApplication };
}

describe('FP-P1 Host request deadline', () => {
  it('gives a new call its own deadline despite an expired ambient action', async () => {
    const { app, evaluate } = bridge();
    const before = Date.now();
    await runWithHostDeadline({ stage: 'main', timeoutMs: 1, deadlineAtMs: before - 1 },
      () => hostInvoke(app, 'gateway', 'rpc', { method: 'memory.explainInjection', timeoutMs: 1234 }));
    const request = evaluate.mock.calls[0]?.[1] as unknown as {
      id: string; deadline: HostDeadline; payload: { timeoutMs: number };
    };
    expect(request.deadline).toMatchObject({ stage: 'renderer', timeoutMs: HOST_ACTION_DEFAULT_TIMEOUT_MS, requestId: request.id });
    expect(request.deadline.deadlineAtMs).toBeGreaterThanOrEqual(before + HOST_ACTION_DEFAULT_TIMEOUT_MS);
    expect(request.payload.timeoutMs).toBe(1234);
  });

  it('uses the existing Mission budget for the bridge request', async () => {
    const { app, evaluate } = bridge();
    await hostInvoke(app, 'gateway', 'rpc', { method: 'mission.run' });
    const request = evaluate.mock.calls[0]?.[1] as unknown as { deadline: HostDeadline };
    expect(request.deadline.timeoutMs).toBe(HOST_ACTION_LONG_TIMEOUT_MS);
  });

  it('retains the enforcing layer and budget when a Host call fails', async () => {
    const details: HostTimeoutDetails = { stage: 'gateway', deadlineMs: 0, elapsedMs: 0, requestId: 'expired-owner' };
    const { app } = bridge({ ok: false, error: { code: 'TIMEOUT', message: 'RPC timeout: memory.explainInjection', details } });
    await expect(hostInvoke(app, 'gateway', 'rpc')).rejects.toMatchObject({
      message: '[TIMEOUT] RPC timeout: memory.explainInjection', details,
    });
  });
});
