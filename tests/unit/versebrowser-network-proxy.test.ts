// @vitest-environment node
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserNetworkProxy } from '@electron/services/agent-browser-network-proxy';
import { decideBrowserNavigation } from '@shared/agent-browser/private-network-policy';
import { SameOriginJsFetcher } from '../../packages/versebrowser/src/engine/browser-control/same-origin-js-fetcher';
import { SameOriginSourceMapFetcher } from '../../packages/versebrowser/src/engine/browser-control/same-origin-source-map-fetcher';
import { ReplayToolExecutor } from '../../packages/versebrowser/src/engine/browser-control/replay-tool-executor';
import { createBoundaryGrantScopeKey, type BoundaryGrantContext } from '../../packages/versebrowser/src/core/tool-authorization';
import { REPLAY_SEND_REQUEST_TOOL_NAME } from '../../packages/versebrowser/src/core/tool-registry';

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
  it('sends background resources through the same checked DNS and keeps the dispatcher profile-owned', async () => {
    const fixture = await target();
    const lookupAddresses = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
    const authorize = vi.fn(async () => {});
    const proxy = await createBrowserNetworkProxy({ authorize, lookupAddresses }); cleanup.push(proxy.close);
    const url = `http://background.invalid:${fixture.port}/resource`;
    expect(await (await proxy.fetch(url, { credentials: 'omit', redirect: 'manual' })).text()).toBe('approved destination');
    lookupAddresses.mockResolvedValue([{ address: '192.0.2.1', family: 4 }]);
    expect(await (await proxy.fetch(url)).text()).toBe('approved destination');
    expect(fixture.requests()).toBe(2);
    expect(lookupAddresses).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledTimes(2);
    proxy.close();
    await expect(proxy.fetch(url)).rejects.toThrow('owner is closed');
  });

  it('blocks JS, SourceMap and replay at the actual private destination with no global fetch fallback', async () => {
    const fixture = await target();
    const origin = `http://rebinding.invalid:${fixture.port}`;
    const proxy = await createBrowserNetworkProxy({
      lookupAddresses: async () => [{ address: '127.0.0.1', family: 4 }],
      authorize: async (url, addresses) => {
        const decision = decideBrowserNavigation({ url, sessionId: 'fixture', approvals: [], resolvedAddresses: [...addresses] });
        expect(decision.allowed).toBe(false);
        throw new Error('private destination denied');
      },
    }); cleanup.push(proxy.close);
    const fetcher: typeof fetch = (input, init) => proxy.fetch(input, init);
    expect((await new SameOriginJsFetcher(fetcher).fetch(`${origin}/app.js`, `${origin}/page`)).ok).toBe(false);
    expect((await new SameOriginSourceMapFetcher(fetcher).fetch(`${origin}/app.js.map`, `${origin}/page`)).ok).toBe(false);
    let grant: BoundaryGrantContext | undefined;
    const replay = new ReplayToolExecutor({ isEnabled: true, getRawRequestMeta: () => ({ id: 'post', url: `${origin}/items`, method: 'POST', requestHeaders: [{ name: 'Content-Type', value: 'application/json' }], requestBody: '{"item":1}' }), getDetails: async () => [] }, fetcher,
      () => ({ tabId: 7, origin, enhanced: true, grant }));
    const draftId = replay.prepareRequest({ requestId: 'post' }).content.match(/draftId：(\S+)/)![1];
    grant = { id: 'single-send', tabId: 7, origin, toolCallId: 'call', scopeKey: createBoundaryGrantScopeKey({ name: REPLAY_SEND_REQUEST_TOOL_NAME, arguments: { draftId } }), grants: ['send_single_confirmed_replay_request_without_credentials'], selectedChoiceIds: ['send'], createdAt: Date.now(), expiresAt: Date.now() + 30_000 };
    const result = await replay.sendRequest({ draftId });
    expect(result.content).toContain('403');
    expect(fixture.requests()).toBe(0);
    expect((await replay.sendRequest({ draftId })).isError).toBe(true);
  });

  it('never uses ambient fetch when a resource reader has no session network owner', async () => {
    const ambient = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('ambient network must not run'); });
    try {
      expect((await new SameOriginJsFetcher().fetch('https://example.com/app.js', 'https://example.com/')).ok).toBe(false);
      expect((await new SameOriginSourceMapFetcher().fetch('https://example.com/app.js.map', 'https://example.com/')).ok).toBe(false);
      expect(ambient).not.toHaveBeenCalled();
    } finally { ambient.mockRestore(); }
  });

  it('allows one real POST for concurrent sends and retains the claim after response loss', async () => {
    let received = 0;
    const release: Array<() => void> = [];
    const server = createServer((request) => {
      received += 1;
      release.push(() => request.socket.destroy());
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => { server.closeAllConnections(); server.close(); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture missing');
    const origin = `http://127.0.0.1:${address.port}`;
    const proxy = await createBrowserNetworkProxy({ authorize: async () => {} }); cleanup.push(proxy.close);
    let grant: BoundaryGrantContext | undefined;
    const replay = new ReplayToolExecutor({ isEnabled: true, getRawRequestMeta: () => ({ id: 'post', url: `${origin}/items`, method: 'POST', requestHeaders: [{ name: 'Content-Type', value: 'application/json' }], requestBody: '{"item":1}' }), getDetails: async () => [] },
      (input, init) => proxy.fetch(input, init), () => ({ tabId: 7, origin, enhanced: true, grant }));
    const draftId = replay.prepareRequest({ requestId: 'post' }).content.match(/draftId：(\S+)/)![1];
    grant = { id: 'single-send', tabId: 7, origin, toolCallId: 'call', scopeKey: createBoundaryGrantScopeKey({ name: REPLAY_SEND_REQUEST_TOOL_NAME, arguments: { draftId } }), grants: ['send_single_confirmed_replay_request_without_credentials'], selectedChoiceIds: ['send'], createdAt: Date.now(), expiresAt: Date.now() + 30_000 };
    const first = replay.sendRequest({ draftId }).catch(error => error as Error);
    try {
      expect((await replay.sendRequest({ draftId })).isError).toBe(true);
      await vi.waitFor(() => expect(received).toBe(1));
    } finally { for (const close of release) close(); }
    const lost = await first;
    if (!(lost instanceof Error)) expect(lost.content).toContain('502');
    expect((await replay.sendRequest({ draftId })).isError).toBe(true);
    expect(received).toBe(1);
  });

  it('returns redirects to the caller and rechecks policy before the next hop', async () => {
    let received = 0;
    let allowed = true;
    const server = createServer((_request, response) => {
      received += 1; allowed = false;
      response.writeHead(302, { location: '/next' }); response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => { server.closeAllConnections(); server.close(); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture missing');
    const proxy = await createBrowserNetworkProxy({ authorize: async () => { if (!allowed) throw new Error('grant revoked'); } }); cleanup.push(proxy.close);
    const url = `http://127.0.0.1:${address.port}`;
    const response = await proxy.fetch(url);
    expect(response.status).toBe(302);
    await response.body?.cancel();
    expect((await proxy.fetch(`${url}/next`)).status).toBe(403);
    expect(received).toBe(1);
  });

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
