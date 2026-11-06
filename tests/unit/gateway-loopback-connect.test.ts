// @vitest-environment node
import dns from 'node:dns';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { expect, it, vi } from 'vitest';
import { resolvePendingGatewayRequest, type PendingGatewayRequest } from '@electron/gateway/request-store';
import { connectGatewaySocket, probeGatewayReady } from '@electron/gateway/ws-client';

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
