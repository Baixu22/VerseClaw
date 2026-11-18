// @vitest-environment node
import { createHash, generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebSocket } from 'ws';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  buildDeviceAuthPayload, publicKeyRawBase64UrlFromPem, signDevicePayload,
} from '../../electron/utils/device-identity';
import * as pairing from '../../openclaw_runtime/src/infra/device-pairing';
import { createSubsystemLogger } from '../../openclaw_runtime/src/logging/subsystem';
import { createGatewayRequestContext, type GatewayRequestContextParams } from '../../openclaw_runtime/src/gateway/server-request-context';
import { deviceHandlers } from '../../openclaw_runtime/src/gateway/server-methods/devices';
import {
  createGatewayWsMessageProcessor, runGatewayWsMessageProcessor, type GatewayWsMessageHandlerParams,
} from '../../openclaw_runtime/src/gateway/server/ws-connection/message-handler';
import type { GatewayWsClient } from '../../openclaw_runtime/src/gateway/server/ws-types';

vi.mock('../../openclaw_runtime/src/config/io', async importOriginal => ({
  ...await importOriginal<typeof import('../../openclaw_runtime/src/config/io')>(),
  getRuntimeConfig: () => ({ gateway: { mode: 'local', controlUi: { enabled: false } } }),
}));

const keys = generateKeyPairSync('ed25519');
const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const deviceId = createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)).digest('hex');
const scopes = ['operator.admin', 'operator.read'];
const token = 'test-inflight-device-token';
const log = createSubsystemLogger('test/device-credential-invalidation');
let baseDir: string;
let clients: Set<GatewayWsClient>;
let context: ReturnType<typeof createGatewayRequestContext>;
const sockets: Array<{ close: () => void }> = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'device-credential-invalidation-'));
  vi.stubEnv('OPENCLAW_STATE_DIR', baseDir);
  await mkdir(join(baseDir, 'devices'));
  await writeFile(join(baseDir, 'devices/pending.json'), '{}');
  await writeFile(join(baseDir, 'devices/paired.json'), JSON.stringify({ [deviceId]: {
    deviceId, publicKey: publicKeyRawBase64UrlFromPem(publicKeyPem), roles: ['operator'],
    approvedScopes: scopes, createdAtMs: 1, approvedAtMs: 1,
    tokens: { operator: { token, role: 'operator', scopes, createdAtMs: 1 } },
  } }));
  clients = new Set();
  context = createGatewayRequestContext({
    clients, runtimeState: { cronState: {} }, logGateway: log,
    getRuntimeConfig: () => ({ gateway: { mode: 'local' } }),
  } as unknown as GatewayRequestContextParams);
});
afterEach(async () => {
  sockets.splice(0).forEach(socket => socket.close());
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await rm(baseDir, { recursive: true, force: true });
});

function connection(id: string) {
  let client: GatewayWsClient | null = null;
  let closed = false;
  const frames: Array<Record<string, unknown>> = [];
  const socket = Object.assign(new EventEmitter(), {
    send: (wire: string, callback?: (error?: Error) => void) => { frames.push(JSON.parse(wire)); callback?.(); },
    close: () => { closed = true; socket.emit('close'); },
  });
  sockets.push(socket);
  const params: GatewayWsMessageHandlerParams = {
    socket: socket as unknown as WebSocket,
    upgradeReq: { headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage,
    connId: id, remoteAddr: '127.0.0.1', requestHost: 'localhost', connectNonce: id,
    getResolvedAuth: () => ({ mode: 'token', token: 'test-shared-token', allowTailscale: false }),
    gatewayMethods: ['health', 'device.token.revoke', 'device.token.rotate', 'device.pair.remove'], events: [],
    extraHandlers: {}, buildRequestContext: () => context,
    refreshHealthSnapshot: vi.fn(async () => ({})) as unknown as GatewayWsMessageHandlerParams['refreshHealthSnapshot'],
    send: frame => frames.push(frame as Record<string, unknown>),
    close: () => socket.close(), isClosed: () => closed, clearHandshakeTimer: vi.fn(),
    getClient: () => client,
    setClient: vi.fn(next => { client = next; clients.add(next); return true; }),
    setHandshakeState: vi.fn(), setCloseCause: vi.fn(), setLastFrameMeta: vi.fn(),
    originCheckMetrics: { hostHeaderFallbackAccepted: 0 }, logGateway: log, logHealth: log, logWsControl: log,
  };
  const signedAtMs = Date.now();
  const payload = buildDeviceAuthPayload({
    deviceId, clientId: 'gateway-client', clientMode: 'backend', role: 'operator', scopes,
    signedAtMs, token, nonce: id,
  });
  const frame = { type: 'req', id, method: 'connect', params: {
    minProtocol: 4, maxProtocol: 4,
    client: { id: 'gateway-client', version: '0.1.0', platform: 'win32', mode: 'backend' },
    role: 'operator', scopes, auth: { deviceToken: token },
    device: { id: deviceId, publicKey: publicKeyRawBase64UrlFromPem(publicKeyPem),
      signedAt: signedAtMs, nonce: id, signature: signDevicePayload(privateKeyPem, payload) },
  } };
  const processor = createGatewayWsMessageProcessor(params);
  return { params, frames, run: () => runGatewayWsMessageProcessor(processor, Buffer.from(JSON.stringify(frame))) };
}

it.each(['device.token.revoke', 'device.token.rotate', 'device.pair.remove'] as const)(
  '%s fences a pending device-token connection before registration', async method => {
    const issuer = connection('issuer');
    await issuer.run();
    expect(issuer.frames).toContainEqual(expect.objectContaining({ id: 'issuer', ok: true }));
    const issuerClient = issuer.params.getClient();
    if (!issuerClient) throw new Error('Authenticated test issuer missing');
    const reached = deferred();
    const pause = deferred();
    const originalEnsure = pairing.ensureDeviceToken;
    vi.spyOn(pairing, 'ensureDeviceToken').mockImplementationOnce(async params => {
      reached.resolve(); await pause.promise; return originalEnsure(params);
    });
    const pending = connection('pending');
    const running = pending.run();
    await reached.promise;
    const params = { deviceId, ...(method === 'device.pair.remove' ? {} : { role: 'operator' }) };
    const respond = vi.fn();
    try {
      await deviceHandlers[method]({ params, context, client: issuerClient, respond, isWebchatConnect: () => false,
        req: { type: 'req', id: 'mutation', method, params } });
      expect(respond).toHaveBeenCalledWith(true, expect.anything(), undefined);
    } finally { pause.resolve(); }
    await running;
    expect(pending.params.setClient).not.toHaveBeenCalled();
    expect(pending.frames).toContainEqual(expect.objectContaining({ id: 'pending', ok: false }));
    expect(context.getDeviceCredentialRevision?.(deviceId, 'operator')).toBeGreaterThan(0);
    if (method === 'device.token.revoke') {
      expect((await pairing.getPairedDevice(deviceId))?.tokens?.operator.revokedAtMs).toBeTruthy();
    }
  },
);

it('keeps invalidation scoped to the selected device and role', () => {
  context.invalidateClientsForDevice?.(deviceId, { role: 'operator' });
  expect(context.getDeviceCredentialRevision?.(deviceId, 'operator')).toBeGreaterThan(0);
  expect(context.getDeviceCredentialRevision?.(deviceId, 'node')).toBe(0);
  expect(context.getDeviceCredentialRevision?.('other-device', 'operator')).toBe(0);
  context.disconnectClientsForDevice?.(deviceId);
  expect(context.getDeviceCredentialRevision?.(deviceId, 'node')).toBeGreaterThan(0);
});

it('rejects a device handshake when the credential owner is unavailable', async () => {
  delete context.getDeviceCredentialRevision;
  const pending = connection('missing-owner');
  await pending.run();
  expect(pending.params.setClient).not.toHaveBeenCalled();
  expect(pending.frames).toContainEqual(expect.objectContaining({
    id: 'missing-owner', ok: false, error: expect.objectContaining({ code: 'UNAVAILABLE' }),
  }));
});
