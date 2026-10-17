import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { loadSessionRecord } from '../src/engine/persistent-sessions.ts';
import { setWorkspaceRoot } from '../src/host/workspace-paths.ts';

async function setup(persistent: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'vb-page-verdict-'));
  setWorkspaceRoot(root);
  const server = createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    res.writeHead(req.url === '/broken' ? 404 : 200, { 'content-type': 'text/html' });
    res.end(req.url === '/dirty'
      ? '<!doctype html><script>console.error("old-page-error")</script><a id=go href=/clean>clean</a><a id=bad href=/broken>broken</a>'
      : '<!doctype html><title>New page</title><h1>new page</h1>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const api = await createPlaywrightHostApi({ persistent });
  const facade = new AgentBrowserFacade({ api });
  const opened = await api.open({ url: `${url}/dirty` });
  const sessionId = opened.session.id;
  const cleanup = async () => {
    await Promise.resolve(api.close({ sessionId })).catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    setWorkspaceRoot(undefined);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  return { api, facade, sessionId, url, cleanup };
}

it.each([false, true])('click navigation judges the current page and retains its own HTTP failure (persistent=%s)', async persistent => {
  const { api, facade, sessionId, url, cleanup } = await setup(persistent);
  try {
    expect((await api.getConsoleMessages({ sessionId })).content).toContain('old-page-error');
    expect((await facade.click(sessionId, '#go')).ok).toBe(true);
    const healthy = await facade.verifyFlow({ sessionId, selectors: [], screenshot: false });
    expect(healthy.data).toMatchObject({ outcome: 'pass', consoleDiff: { newErrors: [] }, networkFailures: { count: 0 } });
    const historical = await facade.verifyFlow({ sessionId, selectors: [], screenshot: false, baselineConsoleCount: 0, baselineNetworkCount: 0 });
    expect(historical.data).toMatchObject({ outcome: 'fail' });
    await facade.nav(sessionId, `${url}/dirty`);
    expect((await facade.click(sessionId, '#bad')).ok).toBe(true);
    const broken = await facade.verifyFlow({ sessionId, selectors: [], screenshot: false });
    expect(broken.data).toMatchObject({ outcome: 'fail', networkFailures: { count: 1 } });
  } finally { await cleanup(); }
}, 30_000);

it('reattachment does not apply a persisted old-page window to a different live URL', async () => {
  const { sessionId, url, cleanup } = await setup(true);
  let remote: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  let second: Awaited<ReturnType<typeof createPlaywrightHostApi>> | undefined;
  try {
    const record = (await loadSessionRecord(sessionId))!;
    remote = await chromium.connectOverCDP(record.endpoint);
    await remote.contexts()[0]!.pages()[0]!.goto(`${url}/clean`);
    second = await createPlaywrightHostApi({ persistent: true });
    // Explicit budget: the reattach assertion is about the window, not about surviving the 5 s
    // default under 4-worker browser contention (observed: waitForSelector timeout at 5 s, then
    // the same test passes 3/3 in isolation - the documented C79 family).
    expect((await second.waitForSelector({ sessionId, selector: 'h1', timeoutMs: 15000 })).session.title).toBe('New page');
    const result = await new AgentBrowserFacade({ api: second }).verifyFlow({ sessionId, selectors: [], screenshot: false });
    // No listener observed this navigation in the new client. Refuse to invent
    // a healthy history or reuse the old page's errors.
    expect(result.data).toMatchObject({ outcome: 'unknown', consoleDiff: { newErrors: [], collection: 'failed' }, networkFailures: { count: 0, collection: 'failed' } });
    expect(result.content).toContain('current page observation window is unavailable');
    await second.navigate({ sessionId, url: `${url}/clean` });
    const recovered = await new AgentBrowserFacade({ api: second }).verifyFlow({ sessionId, selectors: [], screenshot: false });
    expect(recovered.data).toMatchObject({ outcome: 'pass' });
  } finally {
    if (second) await Promise.resolve(second.close({ sessionId })).catch(() => undefined);
    await remote?.close().catch(() => undefined);
    await cleanup();
  }
}, 30_000);
