// @vitest-environment node
import type { ElectronApplication } from '@playwright/test';
import { beforeEach, expect, it, vi } from 'vitest';
import { hostInvoke } from '../e2e/fixtures/fp-p1-harness';
import { checkWindowsProcesses } from '../e2e/fixtures/windows-process';
import { captureRecoveryGatewayProcess, terminateRecoveryGatewayProcess } from '../e2e/fixtures/recovery-process';

vi.mock('../e2e/fixtures/fp-p1-harness', () => ({ hostInvoke: vi.fn() }));
vi.mock('../e2e/fixtures/windows-process', () => ({ checkWindowsProcesses: vi.fn() }));
const hit = { pid: 1234, observedAt: 2000 };
const identity = { pid: 1234, creationTime: 1000 };
let metrics: Array<{ pid: number; creationTime: number; type: string }>;
const evaluate = vi.fn(async (run, pid) => run({ app: { getAppMetrics: () => metrics } }, pid));
const app = { evaluate } as unknown as ElectronApplication;

beforeEach(() => {
  vi.clearAllMocks();
  metrics = [{ ...identity, type: 'Utility' }];
  vi.mocked(hostInvoke).mockResolvedValue({ pid: hit.pid });
  vi.mocked(checkWindowsProcesses).mockResolvedValue([{ ...identity, status: 'terminated' }]);
});

it.skipIf(process.platform !== 'win32')('binds the fault to Main and native creation time before terminating its tree', async () => {
  const owned = await captureRecoveryGatewayProcess(app, hit);
  expect(owned).toEqual(identity);
  expect(hostInvoke).toHaveBeenCalledWith(app, 'gateway', 'status');
  expect(await terminateRecoveryGatewayProcess(owned)).toEqual({
    ...identity, status: 'terminated', method: 'native-process-tree', observations: [{ ...identity, status: 'terminated' }],
  });
  expect(checkWindowsProcesses).toHaveBeenCalledExactlyOnceWith([identity], true, { entireProcessTree: true });
});

it.skipIf(process.platform !== 'win32').each(['different-owner', 'missing', 'replaced', 'wrong-type'])(
  'rejects an unsafe fault target before termination: %s', async (scenario) => {
    if (scenario === 'different-owner') vi.mocked(hostInvoke).mockResolvedValue({ pid: 5678 });
    if (scenario === 'missing') metrics = [];
    if (scenario === 'replaced') metrics[0].creationTime = hit.observedAt + 1;
    if (scenario === 'wrong-type') metrics[0].type = 'Browser';
    await expect(captureRecoveryGatewayProcess(app, hit)).rejects.toThrow(/current Gateway|identity/);
    expect(checkWindowsProcesses).not.toHaveBeenCalled();
  },
);

it.skipIf(process.platform !== 'win32').each(['alive', 'exited', 'replaced', 'unavailable'] as const)(
  'does not count an unconfirmed termination as an injected crash: %s', async (status) => {
    vi.mocked(checkWindowsProcesses).mockResolvedValue([{ ...identity, status }]);
    await expect(terminateRecoveryGatewayProcess(identity)).rejects.toThrow(status);
    expect(checkWindowsProcesses).toHaveBeenCalledTimes(status === 'alive' ? 3 : 1);
    expect(vi.mocked(checkWindowsProcesses).mock.calls.filter(([, terminate]) => terminate)).toHaveLength(1);
  },
);

it.skipIf(process.platform !== 'win32').each(['exited', 'replaced'] as const)(
  'confirms delayed native exit with read-only observations: %s', async (status) => {
    vi.mocked(checkWindowsProcesses)
      .mockResolvedValueOnce([{ ...identity, status: 'alive' }])
      .mockResolvedValueOnce([{ ...identity, status: 'alive' }])
      .mockResolvedValueOnce([{ ...identity, status }]);
    expect(await terminateRecoveryGatewayProcess(identity)).toEqual({
      ...identity, status: 'terminated', method: 'native-process-tree',
      observations: [{ ...identity, status: 'alive' }, { ...identity, status: 'alive' }, { ...identity, status }],
    });
    expect(checkWindowsProcesses).toHaveBeenNthCalledWith(1, [identity], true, { entireProcessTree: true });
    expect(checkWindowsProcesses).toHaveBeenNthCalledWith(2, [identity]);
    expect(checkWindowsProcesses).toHaveBeenNthCalledWith(3, [identity]);
  },
);

it.skipIf(process.platform !== 'win32')('fails closed when delayed exit cannot be observed', async () => {
  vi.mocked(checkWindowsProcesses)
    .mockResolvedValueOnce([{ ...identity, status: 'alive' }])
    .mockResolvedValueOnce([{ ...identity, status: 'unavailable' }]);
  await expect(terminateRecoveryGatewayProcess(identity)).rejects.toThrow('unavailable');
  expect(checkWindowsProcesses).toHaveBeenCalledTimes(2);
  expect(checkWindowsProcesses).toHaveBeenLastCalledWith([identity]);
});

it.skipIf(process.platform !== 'win32')('retains collected observations when a read-only exit check throws', async () => {
  const failure = new Error('native read timed out');
  vi.mocked(checkWindowsProcesses)
    .mockResolvedValueOnce([{ ...identity, status: 'alive' }])
    .mockRejectedValueOnce(failure);
  const error = await terminateRecoveryGatewayProcess(identity).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain(JSON.stringify([{ ...identity, status: 'alive' }]));
  expect((error as Error).message).toContain(failure.message);
  expect((error as Error).cause).toBe(failure);
  expect(checkWindowsProcesses).toHaveBeenCalledTimes(2);
  expect(checkWindowsProcesses).toHaveBeenLastCalledWith([identity]);
});

it.skipIf(process.platform !== 'win32')('rejects missing identity and never retries an uncertain native operation', async () => {
  await expect(terminateRecoveryGatewayProcess({ pid: hit.pid })).rejects.toThrow('creation time');
  await expect(captureRecoveryGatewayProcess(app, { ...hit, pid: -1 })).rejects.toThrow('verified');
  expect(checkWindowsProcesses).not.toHaveBeenCalled();
  const failure = new Error('native operation timed out');
  vi.mocked(checkWindowsProcesses).mockRejectedValue(failure);
  await expect(terminateRecoveryGatewayProcess(identity)).rejects.toBe(failure);
  expect(checkWindowsProcesses).toHaveBeenCalledOnce();
});
