// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DeviceIdentity } from '../../electron/utils/device-identity';

const settings = vi.hoisted(() => ({ token: 'bootstrap-token' }));
vi.mock('electron', () => ({ app: { getPath: () => 'D:/tmp', isPackaged: false }, utilityProcess: { fork: vi.fn() } }));
vi.mock('@electron/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@electron/utils/store', () => ({ getSetting: vi.fn(async () => settings.token), getAllSettings: vi.fn(async () => ({})) }));
vi.mock('@electron/gateway/ws-client', () => ({ connectGatewaySocket: vi.fn(), waitForGatewayReady: vi.fn() }));

import { GatewayManager } from '@electron/gateway/manager';
import { connectGatewaySocket } from '@electron/gateway/ws-client';
import { GatewayRpcError } from '@electron/gateway/protocol';

type ConnectionOwner = {
  connect: (port: number) => Promise<void>;
  deviceIdentity: DeviceIdentity | null;
  lifecycleController: { bump: (reason: string) => number };
  startPing: () => void;
  scheduleGatewayReadyFallback: () => void;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  settings.token = 'bootstrap-token';
  vi.mocked(connectGatewaySocket).mockImplementation(async options => {
    const socket = { on: vi.fn() } as unknown as Awaited<ReturnType<typeof connectGatewaySocket>>;
    options.onHandshakeComplete(socket, { protocol: 4, auth: { deviceToken: 'paired-token' } });
    return socket;
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function owner() {
  const manager = new GatewayManager();
  const connection = manager as unknown as ConnectionOwner;
  connection.deviceIdentity = { deviceId: 'paired-device', publicKeyPem: 'test-public', privateKeyPem: 'test-private' };
  vi.spyOn(manager, 'rpc').mockResolvedValue({});
  vi.spyOn(connection, 'startPing').mockImplementation(() => {});
  vi.spyOn(connection, 'scheduleGatewayReadyFallback').mockImplementation(() => {});
  return connection;
}
function latestToken() {
  return vi.mocked(connectGatewaySocket).mock.calls.at(-1)?.[0].deviceToken;
}

const rejectedToken = () => new GatewayRpcError({
  code: 'INVALID_REQUEST', details: { code: 'AUTH_DEVICE_TOKEN_MISMATCH' },
});

it('reuses the successfully authenticated device token on the same Gateway', async () => {
  const connection = owner();
  await connection.connect(18789);
  expect(latestToken()).toBeUndefined();
  await connection.connect(18789);
  expect(latestToken()).toBe('paired-token');
});

it.each(['port', 'device', 'credential'])('starts a new bootstrap after the %s changes', async change => {
  const connection = owner();
  await connection.connect(18789);
  let port = 18789;
  if (change === 'port') port = 18790;
  if (change === 'device') connection.deviceIdentity = { ...connection.deviceIdentity!, deviceId: 'replacement-device' };
  if (change === 'credential') settings.token = 'rotated-bootstrap-token';
  await connection.connect(port);
  expect(latestToken()).toBeUndefined();
});

it('retries a rejected cached token with shared credentials in the same connection', async () => {
  const connection = owner();
  await connection.connect(18789);
  vi.mocked(connectGatewaySocket).mockRejectedValueOnce(rejectedToken());
  await connection.connect(18789);
  expect(vi.mocked(connectGatewaySocket).mock.calls.map(([options]) => options.deviceToken))
    .toEqual([undefined, 'paired-token', undefined]);
  await connection.connect(18789);
  expect(latestToken()).toBe('paired-token');
});

it('propagates bootstrap failure without retrying again', async () => {
  const connection = owner();
  await connection.connect(18789);
  const failure = rejectedToken();
  vi.mocked(connectGatewaySocket).mockRejectedValueOnce(rejectedToken()).mockRejectedValueOnce(failure);
  await expect(connection.connect(18789)).rejects.toBe(failure);
  expect(vi.mocked(connectGatewaySocket).mock.calls.map(([options]) => options.deviceToken))
    .toEqual([undefined, 'paired-token', undefined]);
});

it('does not bootstrap after the startup lifecycle is superseded', async () => {
  const connection = owner();
  await connection.connect(18789);
  vi.mocked(connectGatewaySocket).mockImplementationOnce(async () => {
    connection.lifecycleController.bump('stop');
    throw rejectedToken();
  });
  await expect(connection.connect(18789)).rejects.toMatchObject({ name: 'LifecycleSupersededError' });
  expect(vi.mocked(connectGatewaySocket)).toHaveBeenCalledTimes(2);
});

it.each([
  new GatewayRpcError({ code: 'UNAVAILABLE', message: 'gateway starting; retry shortly' }),
  new Error('connect ECONNREFUSED 127.0.0.1:18789'),
])('retains the authenticated token after %s', async error => {
  const connection = owner();
  await connection.connect(18789);
  vi.mocked(connectGatewaySocket).mockRejectedValueOnce(error);
  await expect(connection.connect(18789)).rejects.toBe(error);
  expect(vi.mocked(connectGatewaySocket)).toHaveBeenCalledTimes(2);
  await connection.connect(18789);
  expect(latestToken()).toBe('paired-token');
});
