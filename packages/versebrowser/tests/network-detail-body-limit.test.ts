import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';

it('keeps a small chunked body but omits a body over 256 KiB with no declared size', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/large' || req.url === '/small') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write(req.url === '/large' ? 'x'.repeat(256 * 1024 + 1) : 'small body');
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><body><h1>fixture</h1><script>Promise.all(["large","small"].map(p=>fetch("/"+p).then(r=>r.text()))).then(()=>document.body.dataset.loaded="true")</script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const api = await createPlaywrightHostApi();
  let sessionId = '';
  try {
    sessionId = (await api.open({ url: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/` })).session.id;
    await api.waitForSelector({ sessionId, selector: 'body[data-loaded="true"]' });
    const rows = (await api.networkListRequests({ sessionId })).requests;
    const large = rows.find(row => row.url.endsWith('/large'))!;
    const small = rows.find(row => row.url.endsWith('/small'))!;
    const details = (await api.networkGetRequestDetails({ sessionId, requestIds: [large.id, small.id] })).details as Array<{ id: string; responseBody?: string }>;
    expect(details.find(row => row.id === large.id)?.responseBody).toBeUndefined();
    expect(details.find(row => row.id === small.id)?.responseBody).toBe('small body');
  } finally {
    if (sessionId) await Promise.resolve(api.close({ sessionId }));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}, 30_000);
