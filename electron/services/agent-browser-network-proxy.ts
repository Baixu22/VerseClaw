import { lookup } from 'node:dns/promises';
import { Agent, createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from 'node:http';
import { connect, isIP, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

type Address = { address: string; family: number };
type Authorize = (url: string, addresses: readonly string[], tunnel?: boolean) => Promise<number | void>;

/** Main-owned browser egress: validate the resolved addresses, then connect to
 * that exact numeric address. Chromium never performs the destination lookup. */
export async function createBrowserNetworkProxy(options: {
  authorize: Authorize;
  lookupAddresses?: (hostname: string) => Promise<Address[]>;
  resolveUpstreamProxy?: (url: string) => Promise<string>;
}) {
  const sockets = new Set<Duplex>();
  const destinations = new Map<string, Promise<Address[]>>();
  const password = randomBytes(32).toString('hex');
  const authorization = `Basic ${Buffer.from(`verse-browser:${password}`).toString('base64')}`;
  const authenticated = (request: IncomingMessage) => {
    const received = Buffer.from(String(request.headers['proxy-authorization'] ?? ''));
    const expected = Buffer.from(authorization);
    return received.length === expected.length && timingSafeEqual(received, expected);
  };
  let epoch = 0;
  let closed = false;
  const resolveAddresses = (hostname: string): Promise<Address[]> => {
    let pending = destinations.get(hostname);
    if (!pending) {
      // Pin one DNS result for the lifetime of the active browser profile so
      // request authorization and the socket cannot see different answers.
      if (destinations.size >= 1024) return Promise.reject(new Error('Browser profile DNS limit reached'));
      pending = isIP(hostname) ? Promise.resolve([{ address: hostname, family: isIP(hostname) }])
        : (options.lookupAddresses ?? (host => lookup(host, { all: true })))(hostname);
      pending = pending.then(addresses => {
        if (addresses.length === 0 || addresses.some(entry => !isIP(entry.address))) throw new Error('Browser proxy DNS unavailable');
        return addresses;
      }).catch(error => { destinations.delete(hostname); throw error; });
      destinations.set(hostname, pending);
    }
    return pending;
  };
  const track = <T extends Duplex>(socket: T): T => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    return socket;
  };
  const resolveTarget = async (url: URL, tunnel = false) => {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid browser proxy target');
    const hostname = url.hostname.replace(/^\[|\]$/gu, '');
    const addresses = await resolveAddresses(hostname);
    if (addresses.length === 0 || addresses.some(entry => !isIP(entry.address))) throw new Error('Browser proxy DNS unavailable');
    const expiresAt = await options.authorize(url.href, addresses.map(entry => entry.address), tunnel);
    const upstreamRoute = await options.resolveUpstreamProxy?.(url.href) ?? 'DIRECT';
    return { addresses, expiresAt, upstreamRoute };
  };
  const connectChecked = async (addresses: Address[], port: number, startedEpoch: number, upstreamRoute: string) => {
    const route = upstreamRoute.split(';')[0].trim();
    const proxy = route === 'DIRECT' ? null : /^PROXY\s+([^\s:]+):(\d+)$/u.exec(route);
    if (route !== 'DIRECT' && !proxy) throw new Error('Required upstream proxy route is unsupported; direct fallback refused');
    for (const address of addresses) {
      if (epoch !== startedEpoch) throw new Error('Browser proxy connection revoked');
      try {
        return await new Promise<Socket>((resolve, reject) => {
          const socket = track(connect(proxy ? { host: proxy[1], port: Number(proxy[2]) } : { host: address.address, family: address.family, port }));
          const timer = setTimeout(() => { socket.destroy(); reject(new Error('Browser connection timeout')); }, 5_000);
          const failed = (error: Error) => { clearTimeout(timer); reject(error); };
          socket.once('error', failed);
          socket.once('connect', () => {
            if (!proxy) { clearTimeout(timer); socket.off('error', failed); resolve(socket); return; }
            const authority = `${address.family === 6 ? `[${address.address}]` : address.address}:${port}`;
            let reply = Buffer.alloc(0);
            const onData = (chunk: Buffer) => {
              reply = Buffer.concat([reply, chunk]);
              const end = reply.indexOf('\r\n\r\n');
              if (reply.length > 8192) { socket.destroy(); failed(new Error('Upstream proxy response too large')); return; }
              if (end < 0) return;
              socket.off('data', onData); clearTimeout(timer);
              if (!/^HTTP\/1\.[01] 200\b/u.test(reply.toString('ascii'))) { socket.destroy(); reject(new Error('Upstream proxy refused CONNECT')); return; }
              socket.off('error', failed);
              if (reply.length > end + 4) socket.unshift(reply.subarray(end + 4));
              resolve(socket);
            };
            socket.on('data', onData);
            socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
          });
        });
      } catch { /* Try only the already validated numeric alternatives, before request bytes. */ }
    }
    throw new Error('No approved browser destination is reachable');
  };
  const expire = (socket: Duplex, expiresAt: number | void) => {
    if (expiresAt === undefined) return;
    const timer = setTimeout(() => socket.destroy(), Math.max(0, expiresAt - Date.now()));
    timer.unref(); socket.once('close', () => clearTimeout(timer));
  };
  const deny = (socket: Duplex) => {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  };
  const tunnel = async (request: IncomingMessage, client: Duplex, head: Buffer, url: URL, connectMethod: boolean) => {
    if (!authenticated(request)) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="verse-browser"\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    const startedEpoch = epoch;
    const target = await resolveTarget(url, connectMethod);
    if (epoch !== startedEpoch || client.destroyed) throw new Error('Browser proxy request revoked');
    const upstream = await connectChecked(target.addresses, Number(url.port || (url.protocol === 'https:' ? 443 : 80)), startedEpoch, target.upstreamRoute);
    if (epoch !== startedEpoch || client.destroyed || (target.expiresAt !== undefined && target.expiresAt <= Date.now())) { upstream.destroy(); throw new Error('Browser tunnel authorization expired'); }
    expire(upstream, target.expiresAt);
    upstream.setTimeout(120_000, () => upstream.destroy());
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
    {
      if (epoch !== startedEpoch || client.destroyed) { upstream.destroy(); return; }
      if (connectMethod) client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      else {
        const headers = Object.entries(request.headers).filter(([name]) => !name.startsWith('proxy-'))
          .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\r\n');
        upstream.write(`${request.method} ${url.pathname}${url.search} HTTP/1.1\r\n${headers}\r\n\r\n`);
      }
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    }
  };
  const server = createServer((request, response) => {
    if (!authenticated(request)) { response.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="verse-browser"' }); response.end(); return; }
    const startedEpoch = epoch;
    void (async () => {
      const url = new URL(request.url ?? '');
      if (url.protocol !== 'http:') throw new Error('HTTPS requires CONNECT');
      const target = await resolveTarget(url);
      if (epoch !== startedEpoch || request.destroyed) throw new Error('Browser proxy request revoked');
      const socket = await connectChecked(target.addresses, Number(url.port || 80), startedEpoch, target.upstreamRoute);
      if (epoch !== startedEpoch || request.destroyed || (target.expiresAt !== undefined && target.expiresAt <= Date.now())) { socket.destroy(); throw new Error('Browser request authorization expired'); }
      expire(socket, target.expiresAt);
      const headers: OutgoingHttpHeaders = { ...request.headers, host: url.host };
      delete headers['proxy-authorization']; delete headers['proxy-connection'];
      const agent = new Agent({ keepAlive: false });
      agent.createConnection = () => socket;
      const upstream = httpRequest({ host: target.addresses[0].address, port: Number(url.port || 80),
        method: request.method, path: url.pathname + url.search, headers, agent }, result => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(response);
      });
      upstream.on('socket', socket => track(socket));
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      upstream.setTimeout(120_000, () => upstream.destroy());
      response.once('close', () => { upstream.destroy(); agent.destroy(); });
      request.pipe(upstream);
    })().catch(() => { if (!response.headersSent) response.writeHead(403); response.end(); });
  });
  server.on('connection', socket => {
    track(socket); (socket as Socket).setTimeout(120_000, () => socket.destroy());
  });
  server.on('connect', (request, socket, head) => {
    void (async () => {
      const url = new URL(`https://${request.url ?? ''}`);
      if (url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid CONNECT authority');
      await tunnel(request, socket, head, url, true);
    })().catch(() => deny(socket));
  });
  server.on('upgrade', (request, socket, head) => {
    void (async () => {
      const url = new URL(request.url ?? '');
      if (url.protocol === 'ws:') url.protocol = 'http:';
      if (url.protocol !== 'http:') throw new Error('Invalid browser WebSocket target');
      await tunnel(request, socket, head, url, false);
    })().catch(() => deny(socket));
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Browser proxy failed to bind');
  server.unref();
  const proxyUrl = `http://127.0.0.1:${address.port}`;
  const dispatcher = new ProxyAgent({ uri: proxyUrl, token: authorization, proxyTunnel: false });
  return {
    url: proxyUrl,
    credentials: { username: 'verse-browser', password },
    resolveAddresses,
    async fetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
      if (closed) throw new Error('Browser network owner is closed');
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return await undiciFetch(url, {
        ...init,
        credentials: 'omit',
        redirect: 'manual',
        dispatcher,
      } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
    },
    revokeConnections() { epoch += 1; for (const socket of sockets) socket.destroy(); },
    close() { closed = true; epoch += 1; for (const socket of sockets) socket.destroy(); destinations.clear(); void dispatcher.destroy(); server.close(); },
    onClose(callback: () => void) { server.once('close', callback); },
  };
}
