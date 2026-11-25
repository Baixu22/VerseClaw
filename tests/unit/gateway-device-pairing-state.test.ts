// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ensureDeviceToken,
  clearDevicePairing,
  getPairedDevice,
  listPairedDevices,
  removePairedDevice,
  revokeDeviceToken,
  rotateDeviceToken,
  updatePairedDeviceMetadata,
  verifyDeviceToken,
  type PairedDevice,
} from '../../openclaw_runtime/src/infra/device-pairing';

let baseDir: string;
const device: PairedDevice = {
  deviceId: 'paired-device', publicKey: 'test-public-key',
  roles: ['operator'], approvedScopes: ['operator.read'],
  createdAtMs: 1, approvedAtMs: 1,
  tokens: { operator: {
    token: 'test-device-token', role: 'operator', scopes: ['operator.read'], createdAtMs: 1,
  } },
};
const authenticate = (token = 'test-device-token') => verifyDeviceToken({
  baseDir, deviceId: device.deviceId, token,
  role: 'operator', scopes: ['operator.read'],
});

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'device-pairing-state-'));
  await mkdir(join(baseDir, 'devices'));
  await writeFile(join(baseDir, 'devices/paired.json'), JSON.stringify({ [device.deviceId]: device }));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(baseDir, { recursive: true, force: true }); });

it('authenticates and updates paired devices independently of pending requests, while honoring revocation', async () => {
  const pendingPath = join(baseDir, 'devices/pending.json');
  await writeFile(pendingPath, '{interrupted pending request');
  expect(await authenticate()).toEqual({ ok: true });
  expect(await updatePairedDeviceMetadata(device.deviceId, { displayName: 'Updated' }, baseDir)).toBe(true);
  expect((await getPairedDevice(device.deviceId, baseDir))?.displayName).toBe('Updated');
  expect((await listPairedDevices(baseDir)).map(paired => paired.deviceId)).toEqual([device.deviceId]);
  expect((await ensureDeviceToken({
    baseDir, deviceId: device.deviceId, role: 'operator', scopes: ['operator.read'],
  }))?.token).toBe('test-device-token');
  expect(await readFile(pendingPath, 'utf8')).toBe('{interrupted pending request');

  expect(await ensureDeviceToken({
    baseDir, deviceId: device.deviceId, role: 'operator', scopes: ['operator.admin'],
  })).toBeNull();
  expect(await revokeDeviceToken({
    baseDir, deviceId: device.deviceId, role: 'operator', callerScopes: [],
  })).toMatchObject({ ok: false, reason: 'caller-missing-scope' });
  expect(await authenticate()).toEqual({ ok: true });
  const rotated = await rotateDeviceToken({
    baseDir, deviceId: device.deviceId, role: 'operator', scopes: ['operator.read'],
    callerScopes: ['operator.read'],
  });
  expect(rotated.ok).toBe(true);
  if (!rotated.ok) throw new Error(rotated.reason);
  expect(await authenticate()).toEqual({ ok: false, reason: 'token-mismatch' });
  expect(await authenticate(rotated.entry.token)).toEqual({ ok: true });
  expect(await revokeDeviceToken({
    baseDir, deviceId: device.deviceId, role: 'operator', callerScopes: ['operator.read'],
  })).toMatchObject({ ok: true });
  expect(await authenticate(rotated.entry.token)).toEqual({ ok: false, reason: 'token-revoked' });
  expect(await ensureDeviceToken({
    baseDir, deviceId: device.deviceId, role: 'operator', scopes: ['operator.read'],
    expectedToken: rotated.entry.token,
  })).toBeNull();
  expect((await getPairedDevice(device.deviceId, baseDir))?.tokens?.operator.revokedAtMs).toBeTruthy();
  await expect(removePairedDevice(device.deviceId, baseDir)).rejects.toThrow();
  expect(await clearDevicePairing(device.deviceId, baseDir)).toBe(true);
  expect(await authenticate(rotated.entry.token)).toEqual({ ok: false, reason: 'device-not-paired' });
  expect(await readFile(pendingPath, 'utf8')).toBe('{interrupted pending request');
});

it('rejects unreadable paired records', async () => {
  await writeFile(join(baseDir, 'devices/pending.json'), '{}');
  await writeFile(join(baseDir, 'devices/paired.json'), '{interrupted paired record');
  await expect(authenticate()).rejects.toThrow();
});

it('preserves authorized rotation after revocation while rejecting reuse of the previous credential', async () => {
  await revokeDeviceToken({ baseDir, deviceId: device.deviceId, role: 'operator' });
  expect(await ensureDeviceToken({
    baseDir, deviceId: device.deviceId, role: 'operator', scopes: ['operator.read'],
    expectedToken: 'test-device-token',
  })).toBeNull();
  const rotated = await rotateDeviceToken({
    baseDir, deviceId: device.deviceId, role: 'operator', callerScopes: ['operator.read'],
  });
  expect(rotated.ok).toBe(true);
  if (!rotated.ok) throw new Error(rotated.reason);
  expect(await authenticate(rotated.entry.token)).toEqual({ ok: true });
  expect(await authenticate()).toEqual({ ok: false, reason: 'token-mismatch' });
});

it('serves Control UI metadata with a paired read token and denies it immediately after revocation', async () => {
  vi.stubEnv('OPENCLAW_STATE_DIR', baseDir);
  await writeFile(join(baseDir, 'devices/pending.json'), '{interrupted pending request');
  const { handleControlUiAvatarRequest } = await import('../../openclaw_runtime/src/gateway/control-ui');
  const server = createServer((req, res) => {
    void handleControlUiAvatarRequest(req, res, {
      auth: { mode: 'token', token: 'test-shared-token', allowTailscale: false },
      resolveAvatar: () => ({ kind: 'none', reason: 'test fixture' }),
    }).catch(error => { res.statusCode = 500; res.end(String(error)); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server port');
    const url = `http://127.0.0.1:${address.port}/avatar/main?meta=1`;
    const headers = { authorization: 'Bearer test-device-token' };
    const accepted = await fetch(url, { headers });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).avatarStatus).toBe('none');
    expect(await revokeDeviceToken({ baseDir, deviceId: device.deviceId, role: 'operator' })).toMatchObject({ ok: true });
    const rejected = await fetch(url, { headers });
    expect(rejected.status).toBe(401);
    await rejected.text();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
