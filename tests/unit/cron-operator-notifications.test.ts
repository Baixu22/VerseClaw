// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import type { CronJob } from '../../openclaw_runtime/src/cron/types';
const { send } = vi.hoisted(() => ({ send: vi.fn(async () => {}) }));
vi.mock('../../openclaw_runtime/src/cron/delivery', () => ({
  resolveCronDeliveryPlan: () => ({ mode: 'announce', requested: true, channel: 'irc', to: '#rc10' }),
  resolveFailureDestination: () => null,
  sendFailureNotificationAnnounce: send,
  sendCronAnnouncePayloadStrict: vi.fn(),
}));
import { dispatchGatewayCronFinishedNotifications } from '../../openclaw_runtime/src/gateway/server-cron-notifications';

afterEach(() => { vi.unstubAllEnvs(); send.mockClear(); });
it.each([
  ['denied', true, ''],
  ['cancelled', true, ''],
  ['interrupted by gateway restart', false, '1'],
  ['ordinary transport failure', false, ''],
] as const)('keeps %s notifications inside the governed boundary', (error, configured, env) => {
  vi.stubEnv('RC05_OPERATOR_SLICE', env);
  const job: CronJob = {
    id: 'job', name: 'Bounded task', enabled: true, createdAtMs: 1, updatedAtMs: 1,
    schedule: { kind: 'every', everyMs: 10000 }, sessionTarget: 'isolated', wakeMode: 'now',
    payload: { kind: 'agentTurn', message: 'bounded result' },
    delivery: { mode: 'announce', channel: 'irc', to: '#rc10' }, state: {},
  };
  dispatchGatewayCronFinishedNotifications({
    evt: { jobId: job.id, action: 'finished', status: 'error', error, runAtMs: 1 },
    job, deps: {} as never, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    resolveCronAgent: () => ({ agentId: 'main', cfg: { runtime: { rc05: { operatorSliceEnabled: configured } } } }),
  });
  expect(send).toHaveBeenCalledTimes(configured || env === '1' ? 0 : 1);
});
