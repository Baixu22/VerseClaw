// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createCronApi } from '@electron/services/cron-api';
function makeGatewayJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cron-job-1',
    name: 'Check-in',
    enabled: true,
    createdAtMs: 1_800_000_000_000,
    updatedAtMs: 1_800_000_000_000,
    schedule: { kind: 'cron', expr: '0 9 * * *' },
    payload: { kind: 'agentTurn', message: 'Check in' },
    delivery: { mode: 'none' },
    sessionTarget: 'isolated',
    wakeMode: 'next-heartbeat',
    state: {},
    ...overrides,
  };
}


describe('Cron owner snapshots', () => {
  it.each([
    { mode: 'announce', to: 'telegram:123456' },
    { mode: 'announce', channel: 'last' },
    { mode: 'announce' },
    { mode: 'webhook', to: 'https://example.invalid/hook', bestEffort: true },
  ])('preserves delivery without list-time mutations: %j', async delivery => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'cron.list') return { jobs: [makeGatewayJob({ delivery })] };
      throw Error('Unexpected mutation: ' + method);
    });
    const jobs = await createCronApi({ gatewayManager: { rpc } as never }).list();
    expect(jobs[0].delivery).toMatchObject(delivery);
    expect(rpc.mock.calls.map(([method]) => method)).toEqual(['cron.list']);
  });
  it.each(['Gateway offline', 'RPC timeout'])('surfaces %s without pretending the queue is empty', async message => {
    const rpc = vi.fn().mockRejectedValue(Error(message));
    await expect(createCronApi({ gatewayManager: { rpc } as never }).list()).rejects.toThrow(message);
  });
  it('accepts a genuine empty runtime snapshot', async () => {
    const rpc = vi.fn().mockResolvedValue({ jobs: [] });
    expect(await createCronApi({ gatewayManager: { rpc } as never }).list()).toEqual([]);
  });
});
