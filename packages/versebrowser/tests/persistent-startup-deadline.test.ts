import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { waitForCdpEndpoint, closeBrowserThroughCdp } from '../src/engine/persistent-sessions.ts';

it('the CDP startup deadline also bounds a server that never returns HTTP headers', async () => {
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer(() => {});
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const pending = waitForCdpEndpoint(`http://127.0.0.1:${port}`, 100).then(() => 'unexpected success', error => String(error));
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([pending, new Promise<string>(resolve => { guard = setTimeout(() => resolve('deadline ignored'), 2000); })]);
    expect(outcome).not.toBe('deadline ignored');
    expect(outcome).toContain('100ms');
  } finally {
    clearTimeout(guard);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pending;
  }
});

it('a ready CDP endpoint still succeeds', async () => {
  const server = createServer((_req, res) => res.end('{}'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as import('node:net').AddressInfo).port;
    await expect(waitForCdpEndpoint(`http://127.0.0.1:${port}`, 1000)).resolves.toBeUndefined();
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('close is bounded and does not report success when the CDP HTTP response hangs', async () => {
  const server = createServer(() => {});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as import('node:net').AddressInfo).port;
    expect(await closeBrowserThroughCdp(`http://127.0.0.1:${port}`, 100)).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
