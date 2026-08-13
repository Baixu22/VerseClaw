// @vitest-environment node
// R0-4.4: preview proxying must stream non-HTML, cap HTML buffering, and
// kill hanging upstreams via the proxyReq idle timeout. Real-socket test.

import { createServer, get as httpGet, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { proxyHttpRequestImpl, type WebPreviewProxyOptions } from '@electron/services/web-preview-manager';

const servers: Server[] = [];

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', () => resolvePromise()));
  const address = server.address();
  return typeof address === 'object' && address ? address.port : 0;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolvePromise) => {
    server.closeAllConnections?.();
    server.close(() => resolvePromise());
  })));
});

async function runThroughProxy(
  upstreamPort: number,
  path: string,
  options?: WebPreviewProxyOptions,
): Promise<{ statusCode: number; body: string }> {
  const proxyServer = createServer((req, res) => {
    void proxyHttpRequestImpl(
      new URL('http://127.0.0.1:' + upstreamPort),
      'preview-1',
      true,
      req,
      res,
      options,
    ).catch(() => { /* the impl answers the client itself on failure */ });
  });
  const proxyPort = await listen(proxyServer);

  return await new Promise((resolvePromise, reject) => {
    const request = httpGet('http://127.0.0.1:' + proxyPort + path, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        resolvePromise({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.on('error', reject);
    request.setTimeout(10_000, () => {
      request.destroy(new Error('proxy client timeout'));
    });
  });
}

describe('R0-4 web preview proxy', () => {
  it('streams non-HTML responses through without buffering', async () => {
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('hello stream');
    });
    const upstreamPort = await listen(upstream);

    const result = await runThroughProxy(upstreamPort, '/file.txt');
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('hello stream');
  });

  it('returns 502 when the upstream HTML exceeds the buffer cap', async () => {
    const bigHtml = '<!doctype html><html>' + 'x'.repeat(64 * 1024) + '</html>';
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(bigHtml);
    });
    const upstreamPort = await listen(upstream);

    const result = await runThroughProxy(upstreamPort, '/big', { maxHtmlBytes: 1024 });
    expect(result.statusCode).toBe(502);
    expect(result.body).toContain('buffer limit');
  });

  it('injects the inspector into HTML under the cap', async () => {
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><head></head><body>ok</body></html>');
    });
    const upstreamPort = await listen(upstream);

    const result = await runThroughProxy(upstreamPort, '/page');
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('ok');
    expect(result.body).toContain('data-clawx-preview-inspector');
  });

  it('kills a hanging upstream after the idle timeout', async () => {
    const upstream = createServer(() => {
      // Never respond — the socket stays open.
    });
    const upstreamPort = await listen(upstream);

    const result = await runThroughProxy(upstreamPort, '/hang', { idleTimeoutMs: 200 });
    expect(result.statusCode).toBe(502);
    expect(result.body).toContain('idle');
  });
});
