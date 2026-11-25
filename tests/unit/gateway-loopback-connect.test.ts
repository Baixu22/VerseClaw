// @vitest-environment node
import dns from 'node:dns';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { expect, it, vi } from 'vitest';
import { resolvePendingGatewayRequest, type PendingGatewayRequest } from '@electron/gateway/request-store';
import { connectGatewaySocket, probeGatewayReady } from '@electron/gateway/ws-client';
import type { GatewayRequestContext } from '../../openclaw_runtime/src/gateway/server-methods/shared-types';

vi.mock('@electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

it('probes and authenticates the managed loopback Gateway when DNS is unavailable', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
  server.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'local' } }));
    socket.on('message', (data) => {
      const request = JSON.parse(data.toString());
      expect(request.params.auth).toEqual({ token: 'local-test-token' });
      socket.send(JSON.stringify({ type: 'res', id: request.id, ok: true, payload: { protocol: 4 } }));
    });
  });
  const lookup = vi.spyOn(dns, 'lookup').mockImplementation((function (...args: unknown[]) {
    const callback = args.at(-1);
    if (typeof callback !== 'function') throw new Error('DNS callback missing');
    queueMicrotask(() => callback(Object.assign(new Error('DNS unavailable'), { code: 'EAI_AGAIN' })));
  }) as typeof dns.lookup);
  try {
    expect(await probeGatewayReady(address.port, 1_000)).toBe(true);
    const pendingRequests = new Map<string, PendingGatewayRequest>();
    const onHandshakeComplete = vi.fn();
    const socket = await connectGatewaySocket({
      port: address.port, platform: process.platform, deviceIdentity: null, pendingRequests,
      getToken: async () => 'local-test-token', onHandshakeComplete, onCloseAfterHandshake: vi.fn(),
      onMessage: (message) => {
        const response = message as { id: string; payload: unknown };
        resolvePendingGatewayRequest(pendingRequests, response.id, response.payload);
      },
    });
    expect(onHandshakeComplete).toHaveBeenCalledOnce();
    expect(lookup).not.toHaveBeenCalled();
    socket.terminate();
  } finally {
    lookup.mockRestore();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('reads startup readiness directly from the Gateway owner before authenticating', async () => {
  const { attachGatewayWsConnectionHandler } = await import('../../openclaw_runtime/src/gateway/server/ws-connection');
  const { createPreauthConnectionBudget } = await import('../../openclaw_runtime/src/gateway/server/preauth-connection-budget');
  const { createSubsystemLogger } = await import('../../openclaw_runtime/src/logging/subsystem');
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(wss, 'listening');
  try {
    const address = wss.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
    let pending = true;
    const clients: Parameters<typeof attachGatewayWsConnectionHandler>[0]['clients'] = new Set();
    const probeContext: Partial<GatewayRequestContext> = { unsubscribeAllSessionEvents: vi.fn() };
    const log = createSubsystemLogger('startup-probe-test');
    attachGatewayWsConnectionHandler({
      wss, port: address.port, clients,
      preauthConnectionBudget: createPreauthConnectionBudget(),
      isStartupPending: () => pending,
      resolvedAuth: { mode: 'token', token: 'fixture', allowTailscale: false },
      gatewayMethods: ['health'], events: [], extraHandlers: {},
      logGateway: log, logHealth: log, logWsControl: log, broadcast: vi.fn(),
      buildRequestContext: () => probeContext as GatewayRequestContext,
      refreshHealthSnapshot: async () => { throw new Error('A readiness probe requested a health refresh'); },
    });
    expect(await probeGatewayReady(address.port)).toBe(false);
    pending = false;
    expect(await probeGatewayReady(address.port)).toBe(true);
    expect(clients.size).toBe(0);
  } finally {
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
  }
});
