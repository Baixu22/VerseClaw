// @vitest-environment node
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserNetworkProxy } from '@electron/services/agent-browser-network-proxy';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
async function target() {
  let requests = 0;
  const server = createServer((_req, res) => { requests += 1; res.end('approved destination'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture address missing');
  return { port: address.port, requests: () => requests };
}
type ProxyHandle = Awaited<ReturnType<typeof createBrowserNetworkProxy>>;
const authorization = (proxy: ProxyHandle) => `Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString('base64')}`;
function through(proxy: ProxyHandle, url: string, authenticate = true): Promise<{ status: number; body: string }> {
  const address = new URL(proxy.url);
  return new Promise((resolve, reject) => {
    const req = request({ host: address.hostname, port: address.port, method: 'GET', path: url, headers: authenticate ? { 'Proxy-Authorization': authorization(proxy) } : {} }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject); req.end();
  });
}
describe('browser egress uses the checked numeric destination', () => {
  it('resolves once and connects to that exact approved address without a second hostname lookup', async () => {
    const fixture = await target();
    const lookupAddresses = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
    const authorize = vi.fn(async (_url: string, addresses: readonly string[]) => {
      expect(addresses).toEqual(['127.0.0.1']);
      lookupAddresses.mockResolvedValue([{ address: '192.0.2.123', family: 4 }]);
    });
    const proxy = await createBrowserNetworkProxy({ authorize, lookupAddresses }); cleanup.push(proxy.close);
    expect(await proxy.resolveAddresses('name-that-must-not-be-resolved-again.invalid')).toEqual([{ address: '127.0.0.1', family: 4 }]);
    const result = await through(proxy, `http://name-that-must-not-be-resolved-again.invalid:${fixture.port}/`);
    expect(result).toEqual({ status: 200, body: 'approved destination' });
    expect(lookupAddresses).toHaveBeenCalledOnce(); expect(fixture.requests()).toBe(1);
  });

  it('rejects a denied destination before HTTP or CONNECT reaches it', async () => {
    const fixture = await target();
    const proxy = await createBrowserNetworkProxy({ authorize: async () => { throw new Error('policy denied'); } }); cleanup.push(proxy.close);
    expect((await through(proxy, `http://127.0.0.1:${fixture.port}/`, false)).status).toBe(407);
    expect((await through(proxy, `http://127.0.0.1:${fixture.port}/`)).status).toBe(403);
    const proxyUrl = new URL(proxy.url);
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: proxyUrl.hostname, port: Number(proxyUrl.port) }, () => socket.write(`CONNECT 127.0.0.1:${fixture.port} HTTP/1.1\r\nHost: 127.0.0.1:${fixture.port}\r\nProxy-Authorization: ${authorization(proxy)}\r\n\r\n`));
      let text = ''; socket.on('data', chunk => { text += chunk; }); socket.on('end', () => resolve(text)); socket.on('error', reject);
    });
    expect(response).toContain('403 Forbidden'); expect(fixture.requests()).toBe(0);
  });

  it('revokes connections waiting on DNS before they can reach a destination', async () => {
    const fixture = await target();
    let finish!: (addresses: Array<{ address: string; family: number }>) => void;
    const lookupAddresses = vi.fn(() => new Promise<Array<{ address: string; family: number }>>(resolve => { finish = resolve; }));
    const proxy = await createBrowserNetworkProxy({ authorize: async () => {}, lookupAddresses }); cleanup.push(proxy.close);
    const pending = through(proxy, `http://pending.invalid:${fixture.port}/`);
    const result = pending.catch(() => ({ status: 0, body: 'revoked' }));
    await vi.waitFor(() => expect(lookupAddresses).toHaveBeenCalledOnce());
    proxy.revokeConnections(); finish([{ address: '127.0.0.1', family: 4 }]);
    expect((await result).status).not.toBe(200); expect(fixture.requests()).toBe(0);
  });

  it('tries another checked address before sending bytes and retries a previously failed DNS lookup', async () => {
    const fixture = await target();
    const lookupAddresses = vi.fn().mockRejectedValueOnce(new Error('temporary DNS outage'))
      .mockResolvedValue([{ address: '127.0.0.2', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    const proxy = await createBrowserNetworkProxy({ authorize: async () => {}, lookupAddresses }); cleanup.push(proxy.close);
    const url = `http://retry.invalid:${fixture.port}/`;
    expect((await through(proxy, url)).status).toBe(403);
    expect(await through(proxy, url)).toEqual({ status: 200, body: 'approved destination' });
    expect(lookupAddresses).toHaveBeenCalledTimes(2);
  });

  it('closes an active CONNECT tunnel at grant expiry even when the client remains connected', async () => {
    const fixture = await target();
    const proxy = await createBrowserNetworkProxy({ authorize: async () => Date.now() + 150 }); cleanup.push(proxy.close);
    const address = new URL(proxy.url);
    const result = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: address.hostname, port: Number(address.port) }, () => {
        socket.write(`CONNECT 127.0.0.1:${fixture.port} HTTP/1.1\r\nHost: 127.0.0.1:${fixture.port}\r\nProxy-Authorization: ${authorization(proxy)}\r\n\r\n`);
      });
      let data = ''; const timer = setTimeout(() => { socket.destroy(); reject(new Error('expired tunnel survived')); }, 2_000);
      socket.on('data', chunk => { data += chunk; });
      socket.on('close', () => { clearTimeout(timer); resolve(data); });
      socket.on('error', reject);
    });
    expect(result).toContain('200 Connection Established');
  });

  it('preserves a required upstream HTTP proxy while sending only the checked numeric destination', async () => {
    const fixture = await target();
    const connects: string[] = [];
    const upstream = createServer();
    upstream.on('connect', (req, client, head) => {
      connects.push(req.url!);
      const remote = connect({ host: '127.0.0.1', port: fixture.port }, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) remote.write(head);
        client.pipe(remote).pipe(client);
      });
      client.on('close', () => remote.destroy()); remote.on('close', () => client.destroy());
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => upstream.close());
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('proxy fixture missing');
    const proxy = await createBrowserNetworkProxy({ authorize: async () => {},
      lookupAddresses: async () => [{ address: '127.0.0.1', family: 4 }],
      resolveUpstreamProxy: async () => `PROXY 127.0.0.1:${address.port}` });
    cleanup.push(proxy.close);
    expect((await through(proxy, `http://must-use-upstream.invalid:${fixture.port}/`)).body).toBe('approved destination');
    expect(connects).toEqual([`127.0.0.1:${fixture.port}`]);
  });
});
