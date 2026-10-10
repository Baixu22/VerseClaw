// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveMcpTransport } from '../../openclaw_runtime/src/agents/mcp-transport';

let server: Server;
let origin: string;
let requestCount = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    requestCount += 1;
    res.statusCode = 501;
    res.end('unexpected transport request');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('loopback MCP fixture did not bind');
  origin = `http://127.0.0.1:${address.port}/mcp`;
});

afterAll(async () => {
  if (!server) return;
  const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await closed;
});

describe('MCP transport networkPolicy enforcement (#128)', () => {
  it('does not instantiate a transport for disabled or remote localOnly servers', () => {
    expect(resolveMcpTransport('disabled', {
      transport: 'streamable-http',
      url: origin,
      networkPolicy: 'disabled',
    })).toBeNull();
    expect(resolveMcpTransport('remote', {
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      networkPolicy: 'localOnly',
    })).toBeNull();
    expect(requestCount).toBe(0);
  });

  it('still creates a transport for an allowed loopback endpoint', async () => {
    const resolved = resolveMcpTransport('local', {
      transport: 'streamable-http',
      url: origin,
      networkPolicy: 'localOnly',
    });
    expect(resolved).not.toBeNull();
    await resolved?.transport.close();
    expect(requestCount).toBe(0);
  });
});
