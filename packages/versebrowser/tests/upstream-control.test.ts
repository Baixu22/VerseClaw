import { it, expect, vi } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, symlink, readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createSocket } from 'node:dgram';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { createUpstreamPageControl } from '../src/engine/upstream-control.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createMcpServer } from '../src/mcp/server.ts';
import { resolveMcpPolicy } from '../src/mcp/capability-policy.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { sessionIdOf } from './session-result.ts';

async function fixture(redirectTo?: string) {
  let writes = 0, hits = 0, slowClosed = false;
  let startSlow!: () => void;
  const slowStarted = new Promise<void>(done => { startSlow = done; });
  const server = createServer((req, res) => {
    hits++;
    if (req.url === '/slow') { res.on('close', () => { slowClosed = true; }); startSlow(); return; }
    if (req.url === '/redirect' && redirectTo) { res.writeHead(302, { location: redirectTo }); res.end(); return; }
    if (req.url === '/receipt') { writes++; res.end('ok'); return; }
    res.setHeader('content-type', 'text/html');
    res.end(`<button onclick="fetch('/receipt').then(()=>document.querySelector('output').textContent='saved')">Save</button><button id="slow" onclick="location.href='/slow'">Slow</button><output>pending</output><input id="first"><input id="second" value="untouched" oninput="fetch('/receipt')"><input id="readonly" readonly><input id="disabled" type="checkbox" disabled><input type="password" aria-label="Password" value="NeverExpose_this_value"><script>console.log('password=VB_LOG_SECRET_0179')</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, writes: () => writes, hits: () => hits, slowStarted, slowClosed: () => slowClosed, close: () => new Promise<void>((resolve, reject) => { server.closeAllConnections(); server.close(e => e ? reject(e) : resolve()); }) };
}
const sessionId = (result: { ok?: boolean; content?: string; data?: unknown }) => sessionIdOf(result);
it('prevents WebRTC and WebSocket from contacting disallowed UDP and TCP endpoints', async () => {
  const udp = createSocket('udp4'); let packets = 0, connections = 0;
  const tcp = createTcpServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(done => tcp.listen(0, '127.0.0.1', done));
  const tcpPort = (tcp.address() as {port:number}).port;
  udp.on('message', () => packets++);
  await new Promise<void>(done => udp.bind(0, '127.0.0.1', done));
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<button>Ready</button><script>window.pc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${udp.address().port}'},{urls:'turn:127.0.0.1:${tcpPort}?transport=tcp',username:'synthetic',credential:'synthetic'}]});pc.createDataChannel('probe');pc.createOffer().then(o=>pc.setLocalDescription(o));new WebSocket('ws://127.0.0.1:${tcpPort}');</script>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const { facade } = await createStandaloneFacade({ backend: 'upstream', workspaceRoot: await mkdtemp(join(tmpdir(), 'vb-upstream-rtc-')) });
  try {
    const opened = await facade.open({ url: `http://127.0.0.1:${(server.address() as {port:number}).port}` });
    expect(opened.ok).toBe(true);
    await new Promise(done => setTimeout(done, 1500));
    expect(packets).toBe(0);
    expect(connections).toBe(0);
  } finally { await facade.dispose(); udp.close(); await new Promise<void>(done => tcp.close(() => done())); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}, 30_000);

it('bounds chunked and compressed upstream responses, preserves POST/cookies and disables downloads', async () => {
  let produced = 0, stopped = false;
  const server = createServer((req, res) => {
    if (req.url === '/big') {
      res.setHeader('content-type', 'text/plain');
      const timer = setInterval(() => { produced += 65536; res.write(Buffer.alloc(65536, 65)); }, 5);
      res.on('close', () => { clearInterval(timer); stopped = true; }); return;
    }
    if (req.url === '/compressed') {
      res.setHeader('content-encoding', 'gzip'); res.end(gzipSync(Buffer.alloc(8 * 1024 * 1024, 65))); return;
    }
    if (req.url === '/echo') {
      let data = ''; req.on('data', chunk => { data += chunk; });
      req.on('end', () => res.end(`${req.method}:${data}:${req.headers.cookie}`)); return;
    }
    if (req.url === '/file') {
      res.setHeader('content-disposition', 'attachment; filename=blocked-download.txt'); res.end('VB_DOWNLOAD_MUST_NOT_BE_SAVED'); return;
    }
    res.setHeader('set-cookie', ['first=one; Path=/', 'second=two; Path=/']);
    res.setHeader('content-type', 'text/html');
    res.end(`<button id="post" onclick="fetch('/echo',{method:'POST',body:'hello'}).then(r=>r.text()).then(t=>document.querySelector('output').textContent=t)">Post</button>
      <button id="big" onclick="fetch('/big').catch(()=>document.querySelector('output').textContent='big blocked')">Big</button>
      <button id="compressed" onclick="fetch('/compressed').catch(()=>document.querySelector('output').textContent='compressed blocked')">Compressed</button>
      <a id="download" href="/file" download>Download</a><output>pending</output><script>for(let i=0;i<8;i++)console.log('token=VB_BUDGET_SECRET '+ 'x'.repeat(10000))</script>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'vb-upstream-bounds-'));
  const { facade } = await createStandaloneFacade({ backend: 'upstream', workspaceRoot: root });
  try {
    const id = sessionId(await facade.open({ url: `http://127.0.0.1:${(server.address() as {port:number}).port}` }));
    expect((await facade.click(id, '#post')).ok).toBe(true);
    expect((await facade.wait({ sessionId: id, text: 'POST:hello:first=one; second=two', timeoutMs: 3000 })).ok).toBe(true);
    await facade.click(id, '#big');
    expect((await facade.wait({ sessionId: id, text: 'big blocked', timeoutMs: 3000 })).ok).toBe(true);
    await expect.poll(() => stopped).toBe(true);
    expect(produced).toBeLessThan(6 * 1024 * 1024);
    await facade.click(id, '#compressed');
    expect((await facade.wait({ sessionId: id, text: 'compressed blocked', timeoutMs: 3000 })).ok).toBe(true);
    await facade.click(id, '#download');
    await facade.snapshot(id);
    await facade.close(id);
    let logs = 0;
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const content = await readFile(join(entry.parentPath, entry.name), 'utf8');
      expect(content).not.toContain('VB_DOWNLOAD_MUST_NOT_BE_SAVED');
      expect(content).not.toContain('VB_BUDGET_SECRET');
      if (entry.name === 'console.log') {
        logs++;
        expect(content.length).toBeLessThan(64100);
        expect(content).toContain('[upstream log truncated at 64000 characters]');
      }
    }
    expect(logs).toBe(1);
  } finally { await facade.dispose(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}, 30_000);

it('rejects an upstream output root redirected outside the workspace before navigation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vb-upstream-link-')), outside = await mkdtemp(join(tmpdir(), 'vb-upstream-outside-'));
  await mkdir(join(root, '.ae'));
  await symlink(outside, join(root, '.ae', 'evidence'), process.platform === 'win32' ? 'junction' : 'dir');
  const f = await fixture();
  const { facade } = await createStandaloneFacade({ backend: 'upstream', workspaceRoot: root });
  try {
    const result = await facade.open({ url: f.url });
    expect(result.ok).toBe(false); expect(result.content).toContain('outside');
    expect(f.hits()).toBe(0); expect(await readdir(outside)).toEqual([]);
  } finally { await facade.dispose(); await f.close(); }
}, 30_000);

it('interrupts upstream SDK open during navigation without closing a sibling session', async () => {
  const f = await fixture();
  const { facade } = await createStandaloneFacade({ backend: 'upstream', workspaceRoot: await mkdtemp(join(tmpdir(), 'vb-upstream-open-abort-')) });
  const controller = new AbortController();
  const browsers: Browser[] = [];
  const launch = chromium.launch.bind(chromium);
  const spy = vi.spyOn(chromium, 'launch').mockImplementation(async options => {
    const browser = await launch(options); browsers.push(browser); return browser;
  });
  try {
    const sibling = sessionId(await facade.open({ url: f.url }));
    const pending = facade.open({ url: f.url + '/slow' }, { signal: controller.signal });
    await f.slowStarted;
    controller.abort();
    const result = await Promise.race([pending, new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('cancelled open did not settle within 3 seconds')), 3000);
      void pending.finally(() => clearTimeout(timer));
    })]);
    expect(result.ok).toBe(false);
    expect(browsers).toHaveLength(2);
    expect(browsers[1].isConnected()).toBe(false);
    expect(browsers[0].isConnected()).toBe(true);
    await expect.poll(f.slowClosed, { timeout: 3000 }).toBe(true);
    expect((await facade.snapshot(sibling)).ok).toBe(true);
    const hits = f.hits();
    expect((await facade.open({ url: f.url }, { signal: controller.signal })).ok).toBe(false);
    expect(f.hits()).toBe(hits);
    expect(browsers).toHaveLength(2);
    // Hold the actual launch result to exercise cancellation before the driver gets its handle.
    const launching = new AbortController();
    spy.mockImplementationOnce(async options => {
      const browser = await launch(options); browsers.push(browser); launching.abort(); return browser;
    });
    expect((await facade.open({ url: f.url }, { signal: launching.signal })).ok).toBe(false);
    expect(browsers).toHaveLength(3);
    expect(browsers[2].isConnected()).toBe(false);
    expect(f.hits()).toBe(hits);
  } finally { spy.mockRestore(); controller.abort(); await facade.dispose(); await f.close(); }
}, 30_000);
function saveRef(content: string) {
  const ref = /\[([^\]]+)\] button \| "Save"/.exec(content)?.[1];
  expect(ref, content).toBeTruthy(); return `[data-vb-ref="${ref}"]`;
}
it('rejects invalid upstream action deadlines before any field changes', async () => {
  const f = await fixture();
  const { facade } = await createStandaloneFacade({ backend: 'upstream', workspaceRoot: await mkdtemp(join(tmpdir(), 'vb-invalid-deadline-')) });
  try {
    const id = sessionId(await facade.open({ url: f.url }));
    for (const timeoutMs of [0, -1, Number.NaN, Infinity, 60001]) {
      const result = await facade.type(id, '#second', 'forbidden', { timeoutMs });
      expect(result.ok).toBe(false); expect(result.content).toContain('E_ARG');
    }
    expect(f.writes()).toBe(0);
  } finally { await facade.dispose(); await f.close(); }
}, 30_000);

it('keeps a pre-page startup failure addressable when browser shutdown fails', async () => {
  const f = await fixture();
  const { facade } = await createStandaloneFacade({ backend: 'upstream', workspaceRoot: await mkdtemp(join(tmpdir(), 'vb-startup-recovery-')) });
  const launch = chromium.launch.bind(chromium);
  let failedBrowser: Browser | undefined;
  let restoreClose = () => {};
  const openingController = new AbortController();
  let pendingSibling: ReturnType<typeof facade.open> | undefined;
  try {
    const sibling = sessionId(await facade.open({ url: f.url }));
    pendingSibling = facade.open({ url: f.url + '/slow' }, { signal: openingController.signal });
    await f.slowStarted;
    const spy = vi.spyOn(chromium, 'launch').mockImplementationOnce(async options => {
      const browser = await launch(options); failedBrowser = browser;
      const newContext=browser.newContext.bind(browser);
      vi.spyOn(browser,'newContext').mockImplementation(async options=>{
        const context=await newContext(options);
        vi.spyOn(context,'newPage').mockRejectedValue(new Error('page creation failed'));
        return context;
      });
      const close = vi.spyOn(browser, 'close').mockRejectedValue(new Error('shutdown blocked'));
      restoreClose = () => close.mockRestore();
      return browser;
    });
    const opened = await facade.open({ url: f.url });
    spy.mockRestore();
    const recoveryId = opened.error?.details?.recoverySessionId;
    expect(typeof recoveryId).toBe('string');
    expect(failedBrowser!.isConnected()).toBe(true);
    expect((await facade.close(recoveryId as string)).ok).toBe(false);
    expect((await facade.snapshot(sibling)).ok).toBe(true);
    restoreClose();
    expect((await facade.close(recoveryId as string)).ok).toBe(true);
    expect(failedBrowser!.isConnected()).toBe(false);
    expect((await facade.snapshot(sibling)).ok).toBe(true);
  } finally { vi.restoreAllMocks(); openingController.abort(); await pendingSibling; await failedBrowser?.close(); await facade.dispose(); await f.close(); }
}, 30_000);

it('expires queued writes within their original deadline without executing them later', async () => {
  const f = await fixture();
  const { facade } = await createStandaloneFacade({ backend: 'upstream', workspaceRoot: await mkdtemp(join(tmpdir(), 'vb-queue-deadline-')) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const id = sessionId(await facade.open({ url: f.url }));
    let activeFinished = false;
    const active = facade.click(id, '#slow', 5000).then(result => { activeFinished = true; return result; });
    await f.slowStarted;
    const queued = facade.type(id, '#second', 'must never execute', { timeoutMs: 50 });
    const result = await Promise.race([queued, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('queued action ignored its deadline')), 1000); })]);
    clearTimeout(timer);
    expect(result.ok).toBe(false); expect(result.content).toContain('E_QUEUE_TIMEOUT');
    expect(activeFinished).toBe(false);
    await facade.close(id); await active;
    expect(f.writes()).toBe(0);
  } finally { clearTimeout(timer); await facade.dispose(); await f.close(); }
}, 30_000);

it('uses upstream refs while retaining VB business verdicts, evidence and secret boundaries', async () => {
  await expect(createStandaloneFacade({ backend: 'invalid' as never })).rejects.toThrow('E_BACKEND_CONFIG');
  const f = await fixture();
  const root = await mkdtemp(join(tmpdir(), 'vb-upstream-'));
  const { facade, driver } = await createStandaloneFacade({ backend: 'upstream', workspaceRoot: root });
  try {
    expect(driver).toBe('upstream');
    expect((await facade.open({ url: 'https://example.com' })).ok).toBe(false);
    const opened = await facade.open({ url: f.url }); expect(opened.ok).toBe(true);
    const id = sessionId(opened);
    const snapshot = await facade.snapshot(id, { includeText: true });
    expect(snapshot.ok, snapshot.content).toBe(true); expect(snapshot.content).not.toContain('NeverExpose_this_value');
    expect(snapshot.content).toContain('vb_type');
    const selector = saveRef(snapshot.content);
    const before = await facade.verifyFlow({ sessionId: id, screenshot: false, expect: [{ type: 'text', selector: 'output', equals: 'saved' }] });
    expect((before.data as { outcome: string }).outcome).toBe('fail');
    expect((await facade.click(id, selector)).ok).toBe(true);
    expect((await facade.wait({ sessionId: id, text: 'saved', timeoutMs: 3000 })).ok).toBe(true);
    expect((await facade.click(id, selector)).ok).toBe(false); expect(f.writes()).toBe(1);
    const after = await facade.verifyFlow({ sessionId: id, screenshot: false, expect: [{ type: 'text', selector: 'output', equals: 'saved' }] });
    expect((after.data as { outcome: string }).outcome).toBe('pass'); expect(after.evidence?.length).toBeGreaterThan(0);
    expect((await facade.close(id)).ok).toBe(true);
    const logs = (await readdir(root, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile() && entry.name === 'console.log');
    expect(logs.length).toBeGreaterThan(0);
    for (const entry of logs) {
      const text = await readFile(join(entry.parentPath, entry.name), 'utf8');
      expect(text).not.toContain('VB_LOG_SECRET_0179'); expect(text).toContain('[REDACTED]');
    }
  } finally { await facade.dispose(); await f.close(); }
}, 30_000);
it('blocks cross-origin redirects before the target server receives a request', async () => {
  const target = await fixture(), source = await fixture(target.url);
  const { facade } = await createStandaloneFacade({ backend: 'upstream', workspaceRoot: await mkdtemp(join(tmpdir(), 'vb-upstream-route-')) });
  try {
    const id = sessionId(await facade.open({ url: source.url }));
    expect((await facade.nav(id, source.url + '/redirect')).ok).toBe(false);
    expect(target.hits()).toBe(0);
  } finally { await facade.dispose(); await source.close(); await target.close(); }
}, 30_000);
it('blocks cross-origin frames, images and fetch before the target receives traffic', async () => {
  const target = await fixture();
  const source = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<iframe src="${target.url}/frame"></iframe><img src="${target.url}/image"><output>pending</output><script>fetch('${target.url}/fetch').catch(()=>document.querySelector('output').textContent='blocked')</script>`);
  });
  await new Promise<void>(done => source.listen(0, '127.0.0.1', done));
  const { facade } = await createStandaloneFacade({ backend: 'upstream', workspaceRoot: await mkdtemp(join(tmpdir(), 'vb-upstream-resources-')) });
  try {
    const opened = await facade.open({ url: `http://127.0.0.1:${(source.address() as { port: number }).port}` });
    expect(opened.ok, opened.content).toBe(true);
    const id = sessionId(opened);
    expect((await facade.wait({ sessionId: id, text: 'blocked' })).ok).toBe(true);
    const network = await facade.networkList(id);
    const requests = (network.data as { requests: { url: string; failed?: boolean }[] }).requests;
    for (const path of ['/frame', '/image', '/fetch']) expect(requests).toContainEqual(expect.objectContaining({ url: target.url + path, failed: true }));
    expect(target.hits()).toBe(0);
    expect((await facade.nav(id, target.url.replace('http://', 'http://user:secret@'))).ok).toBe(false);
    expect(target.hits()).toBe(0);
  } finally { await facade.dispose(); source.closeAllConnections(); await new Promise<void>(done => source.close(() => done())); await target.close(); }
}, 30_000);
/**
 * The budget must outlast the LOCAL pre-flight of each upstream action (target
 * resolution + elementHandle + focus), because only a timeout inside the RPC
 * proves the reclaim path. At 100ms those pre-flight steps raced the RPC: under a
 * loaded 4-worker run the focus step alone consumed the budget and the failure
 * came back as `locator.focus: Timeout 70ms exceeded` instead of the RPC's
 * `Request timed out` - the earlier full run failed exactly on that string. A
 * budget that clears the pre-flight while staying far below the upstream fill
 * wait keeps the assertion (RPC deadline -> reclaim) and drops the race.
 */
const UPSTREAM_RPC_TIMEOUT_MS = 1500;
it.each(['click', 'type', 'check'] as const)('reclaims the owned browser after an upstream %s timeout without closing a sibling', async action => {
  const f = await fixture();
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'vb-upstream-timeout-'));
  const api = await createPlaywrightHostApi({ upstream: true, workspaceRoot });
  const facade = new AgentBrowserFacade({ api, workspaceRoot });
  const browsers: Browser[] = [];
  const launch = chromium.launch.bind(chromium);
  const spy = vi.spyOn(chromium, 'launch').mockImplementation(async options => {
    const browser = await launch(options); browsers.push(browser); return browser;
  });
  try {
    const sibling = sessionId(await facade.open({ url: f.url }));
    const id = sessionId(await facade.open({ url: f.url }));
    // Exercise the RPC deadline directly. facade.click has a separate selector
    // wait, whose timeout proves no RPC was started and must keep the session.
    const result = action === 'click' ? await Promise.resolve(api.click({ sessionId: id, selector: '#slow', timeoutMs: UPSTREAM_RPC_TIMEOUT_MS })).then(
      () => ({ ok: true, content: '' }), error => ({ ok: false, content: String(error) }))
      : action === 'type' ? await facade.type(id, '#readonly', 'never written', { timeoutMs: UPSTREAM_RPC_TIMEOUT_MS })
      : await facade.setChecked(id, '#disabled', true, UPSTREAM_RPC_TIMEOUT_MS);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('Request timed out');
    expect(browsers).toHaveLength(2);
    expect(browsers[1].isConnected()).toBe(false);
    expect(browsers[0].isConnected()).toBe(true);
    expect((await facade.snapshot(sibling)).ok).toBe(true);
    expect((await facade.snapshot(id)).ok).toBe(false);
    expect((await facade.close(id)).ok).toBe(true);
    expect(f.writes()).toBe(0);
  } finally { spy.mockRestore(); await facade.dispose(); await f.close(); }
}, 30_000);
it('runs the real stdio worker and cancels pending opens and in-flight sessions', async () => {
  const f = await fixture(), opening = await fixture(), root = await mkdtemp(join(tmpdir(), 'vb-upstream-stdio-'));
  const client = new Client({ name: 'stdio-upstream', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', resolve('src/mcp/server.ts')], cwd: root,
    env: { ...process.env, VERSEBROWSER_BACKEND: 'upstream', VERSEBROWSER_TOOL_GROUPS: 'core,evidence', VERSEBROWSER_CAPS: 'browser.open,browser.navigate,browser.act,browser.observe,browser.close,evidence.write' } as Record<string, string>, stderr: 'pipe' });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as Array<{ text: string }>)[0].text);
  };
  let id: string | undefined;
  try {
    id = sessionId(await call('vb_open', { url: f.url }));
    const openController = new AbortController();
    const pendingOpen = client.callTool({ name: 'vb_open', arguments: { url: opening.url + '/slow' } }, undefined, { signal: openController.signal }).catch(e => e);
    await opening.slowStarted;
    openController.abort(); await pendingOpen;
    await expect.poll(opening.slowClosed, { timeout: 3000 }).toBe(true);
    expect((await call('vb_snapshot', { sessionId: id })).ok).toBe(true);
    const selector = saveRef((await call('vb_snapshot', { sessionId: id })).content);
    expect((await call('vb_click', { sessionId: id, selector })).ok).toBe(true);
    await call('vb_wait', { sessionId: id, text: 'saved', timeoutMs: 3000 });
    const verified = await call('vb_verify_flow', { sessionId: id, screenshot: false, expect: [{ type: 'text', selector: 'output', equals: 'saved' }] });
    expect(verified.data.outcome).toBe('pass');
    const controller = new AbortController();
    const action = client.callTool({ name: 'vb_click', arguments: { sessionId: id, selector: '#slow', timeoutMs: 10000 } }, undefined, { signal: controller.signal }).catch(e => e);
    await f.slowStarted;
    const beforeCancel = f.writes();
    const queuedWrite = call('vb_type', { sessionId: id, selector: '#second', text: 'must not run after cancellation' });
    await client.ping(); // The worker received the queued request before cancellation.
    controller.abort(); await action;
    expect((await queuedWrite).ok).toBe(false);
    expect(f.writes()).toBe(beforeCancel);
    await expect.poll(async () => (await call('vb_snapshot', { sessionId: id })).ok, { timeout: 5000 }).toBe(false);
    expect((await call('vb_close', { sessionId: id })).ok).toBe(true); id = undefined;
  } finally { if (id) await call('vb_close', { sessionId: id }).catch(() => {}); await client.close(); await f.close(); await opening.close(); }
}, 30_000);
it('invalidates old observations and keeps sessions and origins isolated', async () => {
  const a = await fixture(), b = await fixture();
  const { facade } = await createStandaloneFacade({ backend: 'upstream', workspaceRoot: await mkdtemp(join(tmpdir(), 'vb-upstream-')) });
  try {
    const one = sessionId(await facade.open({ url: a.url })), two = sessionId(await facade.open({ url: b.url }));
    const old = saveRef((await facade.snapshot(one)).content);
    await facade.snapshot(one);
    expect((await facade.click(one, old)).ok).toBe(false);
    const current = saveRef((await facade.snapshot(one)).content);
    expect((await facade.click(two, current)).ok).toBe(false);
    expect((await facade.nav(one, b.url)).ok).toBe(false);
    expect((await facade.close(one)).ok).toBe(true);
    expect((await facade.snapshot(two)).ok).toBe(true);
  } finally { await facade.dispose(); await a.close(); await b.close(); }
}, 30_000);
it('exposes only the slice through MCP and applies revocation and argument guards before execution', async () => {
  const f = await fixture(); let allowed = true;
  const policy = resolveMcpPolicy({ groups: 'core,evidence,debug,network', caps: 'browser.open,browser.navigate,browser.act,browser.observe,browser.close,evidence.write,debug.console,network.read', env: {} });
  const deny = resolveMcpPolicy({});
  const server = createMcpServer({ backend: 'upstream', workspaceRoot: await mkdtemp(join(tmpdir(), 'vb-upstream-mcp-')), getPolicy: () => allowed ? policy : deny });
  const client = new Client({ name: 'upstream-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    return JSON.parse((result.content as Array<{ text: string }>)[0].text);
  };
  let id: string | undefined;
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    expect(names).toContain('vb_snapshot'); expect(names).toContain('vb_type'); expect(names).toContain('vb_press'); expect(names).not.toContain('browser_run_code');
    expect((await call('browser_run_code', { code: 'throw new Error("must not execute")' })).ok).toBe(false);
    id = sessionId(await call('vb_open', { url: f.url }));
    const selector = saveRef((await call('vb_snapshot', { sessionId: id })).content);
    for (const args of [
      { selector: '#second', text: 'bad', timeoutMs: '50' },
      { selector: '#second', text: 42 },
      { selector: '#second', text: 'bad', timeoutMs: null },
      { text: 'bad' },
    ]) expect((await call('vb_type', { sessionId: id, ...args })).error.code).toBe('E_ARG');
    expect((await call('vb_click', { sessionId: id, selector, _meta: { cwd: '/' } })).ok).toBe(false);
    expect((await call('vb_type', { sessionId: id, selector: '#first', text: 'authorized' })).ok).toBe(true);
    allowed = false;
    expect((await call('vb_click', { sessionId: id, selector })).ok).toBe(false); expect(f.writes()).toBe(0);
    expect((await call('vb_type', { sessionId: id, selector: '#second', text: 'forbidden' })).ok).toBe(false);
    expect((await call('vb_select', { sessionId: id, selector: '#second', label: 'forbidden' })).ok).toBe(false);
    expect((await call('vb_check', { sessionId: id, selector: '#second', checked: true })).ok).toBe(false);
    allowed = true;
    const verified = await call('vb_verify_flow', { sessionId: id, screenshot: false, expect: [
      { type: 'value', selector: '#first', equals: 'authorized' },
      { type: 'value', selector: '#second', equals: 'untouched' },
    ] });
    expect(verified.data.outcome).toBe('pass');
  } finally { allowed = true; if (id) await call('vb_close', { sessionId: id }); await client.close(); await server.close(); await f.close(); }
}, 30_000);

it('starts click observation inside the serial queue, not while waiting', async () => {
  const server = createServer((_req, res) => {res.setHeader('content-type','text/html');res.end('<button>Save</button>');});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  const control=await createUpstreamPageControl(page,url,await mkdtemp(join(tmpdir(),'vb-observation-queue-')));
  try {
    await control.navigate(url,'load');
    const order:string[]=[];
    const waiting=control.wait('#missing',150).catch(()=>{});
    const click=control.click('button',3000,()=>{order.push('observe');});
    expect(order).toEqual([]);
    await new Promise(resolve=>setTimeout(resolve,50));
    expect(order).toEqual([]);
    await waiting; await click;
    expect(order).toEqual(['observe']);
    let release!:()=>void, observing!:()=>void;
    const hold=new Promise<void>(resolve=>{release=resolve;});
    const started=new Promise<void>(resolve=>{observing=resolve;});
    const first=control.click('button',3000,undefined,async()=>{observing();await hold;});
    await started;
    let secondStarted=false;
    const second=control.click('button',3000,()=>{secondStarted=true;});
    await new Promise(resolve=>setTimeout(resolve,50));
    expect(secondStarted).toBe(false);
    release();await first;await second;expect(secondStarted).toBe(true);
  } finally {await control.close();await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
}, 10000);

it('rejects invalid direct host click options before resolving a session or performing actions', async () => {
  const api = await createPlaywrightHostApi({upstream:true});
  for (const options of [{after:'unsupported'}, {timeoutMs:0}, {timeoutMs:Infinity}, {timeoutMs:60001}]) {
    await expect(api.click({sessionId:'must-not-be-looked-up',selector:'button',...options} as never)).rejects.toThrow('E_ARG');
  }
});

it('aborts guarded HTTP on open cancellation before native browser shutdown finishes',async()=>{
  const f=await fixture();const {facade}=await createStandaloneFacade({backend:'upstream',workspaceRoot:await mkdtemp(join(tmpdir(),'vb-open-cancel-transport-'))});
  const transportCloseSpy=vi.spyOn(Client.prototype,'close');
  const controller=new AbortController();const browsers:Browser[]=[];const events:Array<{event:string;at:number}>=[];
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});const launch=chromium.launch.bind(chromium);
  const spy=vi.spyOn(chromium,'launch').mockImplementation(async options=>{
    const browser=await launch(options);browsers.push(browser);
    if(browsers.length===2){
      const nativeClose=browser.close.bind(browser);
      vi.spyOn(browser,'close').mockImplementation(async()=>{events.push({event:'native-close-started',at:Date.now()});await held;await nativeClose();events.push({event:'native-close-ended',at:Date.now()});});
    }
    return browser;
  });
  let pending:ReturnType<typeof facade.open>|undefined;
  try {
    const peer=sessionId(await facade.open({url:f.url}));pending=facade.open({url:f.url+'/slow'},{signal:controller.signal});await f.slowStarted;
    events.push({event:'abort-requested',at:Date.now()});controller.abort();
    await expect.poll(f.slowClosed,{timeout:1000}).toBe(true);events.push({event:'http-closed',at:Date.now()});
    expect(browsers[1].isConnected()).toBe(true);expect(browsers[0].isConnected()).toBe(true);release();
    const result=await Promise.race([pending,new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error('cancelled open did not settle within 3 seconds')),3000);void pending!.finally(()=>clearTimeout(timer));})]);
    expect(result.ok).toBe(false);expect(transportCloseSpy).toHaveBeenCalledTimes(1);expect(browsers[1].isConnected()).toBe(false);expect((await facade.snapshot(peer)).ok).toBe(true);expect(f.writes()).toBe(0);
  } finally {
    console.log(JSON.stringify({openAbortTransportReceipt:{events,transportCloseCalls:transportCloseSpy.mock.calls.length,slowClosed:f.slowClosed(),connected:browsers.map(browser=>browser.isConnected())}}));
    release();controller.abort();await pending;spy.mockRestore();transportCloseSpy.mockRestore();await facade.dispose();await f.close();
  }
},15000);

/**
 * TF-0164: frame-scoped snapshot refs must drive real actions.
 *
 * The upstream snapshot already traverses same-origin and granted cross-origin frames and
 * tags those elements `f<n>e<m>`, but VB used to pre-resolve every ref with its own
 * Playwright locator, which only searches the main frame — so every frame-internal ref
 * failed with E_CLICK before the upstream ever saw it. Frame refs are now delegated
 * straight to the upstream, which resolves them itself and refuses invalid ones.
 *
 * The verdict comes from independent per-scope POST receipts on the servers, not from VB.
 */
it('acts on same-origin and granted cross-origin frame refs and refuses a detached one', async () => {
  const receipts: Array<{ scope: string; body: string }> = [];
  const scopeForm = (scope: string) =>
    `<form data-scope="${scope}"><label>${scope} value<input name="value" value="initial"></label>` +
    `<button type="button" onclick="fetch('/receipt?scope=${scope}',{method:'POST',body:new URLSearchParams(new FormData(this.form))})">Save ${scope}</button></form>`;
  let origin = '';
  const root = createServer((req, res) => {
    const url = new URL(req.url ?? '/', origin || 'http://127.0.0.1');
    if (url.pathname === '/receipt' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => { receipts.push({ scope: url.searchParams.get('scope') ?? '', body }); res.end('ok'); });
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/top') {
      res.end(`<!doctype html><title>Top</title>${scopeForm('top')}<iframe id="mid" src="${origin}/mid"></iframe><button type="button" onclick="document.querySelector('#mid').remove()">Detach middle</button>`);
      return;
    }
    if (url.pathname === '/mid') { res.end(`<!doctype html>${scopeForm('middle')}<iframe src="${origin}/leaf"></iframe>`); return; }
    if (url.pathname === '/leaf') { res.end(`<!doctype html>${scopeForm('leaf')}`); return; }
    res.end('nope');
  });
  await new Promise<void>((done) => root.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(root.address() as { port: number }).port}`;

  const browser = await chromium.launch({ headless: true });
  const workspace = await mkdtemp(join(tmpdir(), 'vb-frame-refs-'));
  try {
    const control = await createUpstreamPageControl(
      await (await browser.newContext({ serviceWorkers: 'block' })).newPage(),
      origin,
      workspace,
      undefined,
      [origin],
    );
    // Refs are per-snapshot by contract: re-observe before every action.
    const actInScope = async (label: string) => {
      const items = await control.snapshot();
      const match = items.find((item) => item.name === label);
      expect(match, `snapshot must expose ${label}`).toBeTruthy();
      expect(match!.ref, `${label} ref must be frame-scoped`).toMatch(/-f\d+e\d+$/);
      const before = receipts.length;
      await control.click(`[data-vb-ref="${match!.ref}"]`);
      await new Promise((done) => setTimeout(done, 700));
      // the receipt scope is the URL parameter, i.e. the form scope without the "Save " prefix
      expect(receipts.slice(before).map((entry) => entry.scope), `${label} receipt`).toEqual([label.replace(/^Save /, '')]);
    };

    await control.navigate(`${origin}/top`, 'load');
    await actInScope('Save middle');
    await actInScope('Save leaf');

    // A detached frame invalidates its refs: the old ref must be refused, not guessed.
    const detachItems = await control.snapshot();
    const detach = detachItems.find((item) => item.name === 'Detach middle');
    expect(detach).toBeTruthy();
    await control.click(`[data-vb-ref="${detach!.ref}"]`);
    const stale = await control.snapshot();
    const former = stale.find((item) => item.name === 'Save middle');
    if (former) {
      // the node is gone from the tree, so only assert we never fabricate a receipt
      await expect(control.click(`[data-vb-ref="${former.ref}"]`)).rejects.toThrow();
    }
    await control.close();
  } finally {
    await browser.close();
    root.closeAllConnections();
    await new Promise<void>((done) => root.close(() => done()));
  }
}, 60_000);

/**
 * TF-0164: the page inventory binds each page to its child frames.
 *
 * The numbering asserted below lines up with the snapshot's frame-scoped refs only on a fresh load:
 * `frameId` is the page.frames() position, while the `f<n>` prefix inside a ref is the upstream
 * frame sequence, so the two diverge after any navigation (covered by the prefix/position test
 * below). Do not read this assertion as a general identity between the two schemes.
 *
 * A frame outside the authorized origin set must be reported as present-but-unauthorized so
 * the host can tell "not present" from "present but not permitted"; it is never hidden and
 * never silently counted as usable.
 */
it('lists child frames per page with authorized flags matching the snapshot frame refs', async () => {
  let origin = '';
  let peer = '';
  const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL(req.url ?? '/', origin);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/top') { res.end(`<!doctype html><title>Top</title><button type="button">Save top</button><iframe src="${origin}/mid"></iframe><iframe src="${peer}/leaf"></iframe>`); return; }
    if (url.pathname === '/mid') { res.end(`<!doctype html><button type="button">Save middle</button><iframe src="${origin}/deep"></iframe>`); return; }
    if (url.pathname === '/deep') { res.end(`<!doctype html><button type="button">Save deep</button>`); return; }
    if (url.pathname === '/leaf') { res.end(`<!doctype html><button type="button">Save leaf</button>`); return; }
    res.end('nope');
  };
  const root = createServer(handler);
  await new Promise<void>((done) => root.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(root.address() as { port: number }).port}`;
  const peerServer = createServer(handler);
  await new Promise<void>((done) => peerServer.listen(0, '127.0.0.1', done));
  peer = `http://127.0.0.1:${(peerServer.address() as { port: number }).port}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const control = await createUpstreamPageControl(await context.newPage(), origin, await mkdtemp(join(tmpdir(), 'vb-frame-list-')), undefined, [origin]);
    await control.navigate(`${origin}/top`, 'load');

    const inventory = await control.listPages();
    const page = inventory.pages[0];
    expect(page.frames, 'page inventory must expose child frames').toBeTruthy();
    // the main frame is not listed; children start at f1
    expect(page.frames!.every((frame) => /^f[1-9]\d*$/.test(frame.frameId))).toBe(true);
    expect(page.frames!.map((frame) => frame.frameId)).not.toContain('f0');

    // the granted origin is authorized; the ungranted peer frame must be listed but not authorized
    expect(page.frames!.some((frame) => frame.authorized)).toBe(true);
    expect(page.frames!.some((frame) => !frame.authorized)).toBe(true);

    // on a fresh load the position id and the snapshot's frame prefix line up; after a navigation
    // they do not, which the prefix/position test below proves
    const items = await control.snapshot();
    const snapshotFrames = new Set(items.map((item) => /-(\d+)-(f\d+)e\d+$/.exec(item.ref)?.[2]).filter(Boolean));
    for (const frame of page.frames!) {
      if (frame.authorized) expect(snapshotFrames.has(frame.frameId), `${frame.frameId} must appear in snapshot refs`).toBe(true);
    }
    await control.close();
  } finally {
    await browser.close();
    root.closeAllConnections();
    peerServer.closeAllConnections();
    await new Promise<void>((done) => root.close(() => done()));
    await new Promise<void>((done) => peerServer.close(() => done()));
  }
}, 60_000);

/**
 * TF-0164: delegating a frame ref to the upstream must not become a way around the host
 * origin grants. The upstream resolves `f<n>e<m>` refs but does not know which origins this
 * session was granted, so VB checks the frame's origin before delegating.
 *
 * The negative case needs a ref that exists but points at an ungranted frame. A never-granted
 * frame never reaches the snapshot at all, so the grant is established first and the check is
 * exercised through the inventory's `authorized` flag plus a direct guard unit assertion.
 */
it('marks ungranted child frames unauthorized and keeps them out of reach', async () => {
  let origin = '';
  let peer = '';
  const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL(req.url ?? '/', origin);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/top') { res.end(`<!doctype html><title>Top</title><button type="button">Save top</button><iframe src="${peer}/outside"></iframe>`); return; }
    if (url.pathname === '/outside') { res.end('<!doctype html><button type="button">Save outside</button>'); return; }
    res.end('nope');
  };
  const root = createServer(handler);
  await new Promise<void>((done) => root.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(root.address() as { port: number }).port}`;
  const peerServer = createServer(handler);
  await new Promise<void>((done) => peerServer.listen(0, '127.0.0.1', done));
  peer = `http://127.0.0.1:${(peerServer.address() as { port: number }).port}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    // grant ONLY the root origin: the peer frame is present but not permitted
    const control = await createUpstreamPageControl(await context.newPage(), origin, await mkdtemp(join(tmpdir(), 'vb-frame-guard-')), undefined, [origin]);
    await control.navigate(`${origin}/top`, 'load');

    const inventory = await control.listPages();
    const frames = inventory.pages[0].frames ?? [];
    // the frame exists and is reported, but it must be marked unauthorized rather than hidden
    expect(frames.length, 'the ungranted frame is still listed').toBeGreaterThan(0);
    expect(frames.every((frame) => !frame.authorized)).toBe(true);
    // and its contents never reach the snapshot, so no ref can be minted for it
    const items = await control.snapshot();
    expect(items.some((item) => item.name === 'Save outside')).toBe(false);
    expect(items.some((item) => item.name === 'Save top')).toBe(true);
    await control.close();
  } finally {
    await browser.close();
    root.closeAllConnections();
    peerServer.closeAllConnections();
    await new Promise<void>((done) => root.close(() => done()));
    await new Promise<void>((done) => peerServer.close(() => done()));
  }
}, 60_000);

/**
 * TF-0164 — the gap the task matrix still lists: acting INSIDE a granted cross-origin frame.
 *
 * The frame-action test above only ever used one origin, so despite its name it never exercised a
 * granted cross-origin frame; the two-origin tests below only covered the inventory's authorized
 * flag and the ungranted refusal. This one grants BOTH origins and proves an action inside the
 * cross-origin frame is delivered to the PEER server: the receipt is recorded there, so the top
 * server cannot forge it, and the top server's own receipt list must stay untouched.
 */
it('acts inside a granted cross-origin frame and lands the receipt on the peer server', async () => {
  const peerReceipts: string[] = [];
  const topReceipts: string[] = [];
  let top = '';
  let peer = '';
  const scopeButton = (scope: string) =>
    `<button type="button" data-scope="${scope}" onclick="fetch('/receipt?scope=${scope}',{method:'POST'})">Save ${scope}</button>`;
  const topServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', top || 'http://127.0.0.1');
    if (url.pathname === '/receipt') { topReceipts.push(url.searchParams.get('scope') ?? ''); res.end('ok'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/top') {
      res.end(`<!doctype html><title>Top</title>${scopeButton('top')}<iframe id="peer" src="${peer}/outer"></iframe>`);
      return;
    }
    res.end('nope');
  });
  const peerServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', peer || 'http://127.0.0.1');
    if (url.pathname === '/receipt') { peerReceipts.push(url.searchParams.get('scope') ?? ''); res.end('ok'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    // '/outer' is the granted cross-origin frame; '/inner' is same-origin *to the peer*, i.e. nested
    if (url.pathname === '/outer') { res.end(`<!doctype html><title>Outer</title>${scopeButton('outer')}<iframe src="/inner"></iframe>`); return; }
    if (url.pathname === '/inner') { res.end(`<!doctype html><title>Inner</title>${scopeButton('inner')}`); return; }
    res.end('nope');
  });
  await new Promise<void>((done) => topServer.listen(0, '127.0.0.1', done));
  top = `http://127.0.0.1:${(topServer.address() as { port: number }).port}`;
  await new Promise<void>((done) => peerServer.listen(0, '127.0.0.1', done));
  peer = `http://127.0.0.1:${(peerServer.address() as { port: number }).port}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const control = await createUpstreamPageControl(
      await (await browser.newContext({ serviceWorkers: 'block' })).newPage(),
      top,
      await mkdtemp(join(tmpdir(), 'vb-frame-cross-origin-')),
      undefined,
      [top, peer],
    );
    await control.navigate(`${top}/top`, 'load');

    const frames = (await control.listPages()).pages[0].frames ?? [];
    expect(frames.length, 'the cross-origin child must be listed').toBeGreaterThan(0);
    expect(frames.filter((frame) => frame.authorized).length, 'the granted peer frame is authorized').toBeGreaterThan(0);

    const actInScope = async (label: string, scope: string) => {
      const items = await control.snapshot();
      const match = items.find((item) => item.name === label);
      expect(match, `snapshot must expose ${label}`).toBeTruthy();
      expect(match!.ref, `${label} ref must be frame-scoped`).toMatch(/-f\d+e\d+$/);
      const before = peerReceipts.length;
      await control.click(`[data-vb-ref="${match!.ref}"]`);
      await new Promise((done) => setTimeout(done, 700));
      // The oracle is the PEER's receipt list: the parent server never sees this POST.
      expect(peerReceipts.slice(before), `${label} must deliver its receipt to the peer origin`).toEqual([scope]);
    };

    await actInScope('Save outer', 'outer');
    await actInScope('Save inner', 'inner');

    expect(peerReceipts, 'both frame scopes must have posted to the peer origin').toEqual(['outer', 'inner']);
    expect(topReceipts, 'the parent origin must not receive frame-scoped posts').toEqual([]);
    await control.close();
  } finally {
    await browser.close();
    topServer.closeAllConnections();
    peerServer.closeAllConnections();
    await new Promise<void>((done) => topServer.close(() => done()));
    await new Promise<void>((done) => peerServer.close(() => done()));
  }
}, 60_000);

/**
 * TF-0167 item 2: a revocation must take effect BEFORE the next action.
 *
 * The policy tests cover that revoke() clears the grant; this covers that an action actually
 * consults the policy afterwards. Measured end to end on the real upstream facade: a session
 * that could read runtime globals stops being able to read them the moment revoke returns, and
 * a second revoke is idempotent rather than an error.
 */
it('revocation closes the elevated surface before the next action', async () => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><title>Revoke</title><button type="button">Hello</button>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const { facade } = await createStandaloneFacade({
    preferPlaywright: true, backend: 'upstream',
    workspaceRoot: await mkdtemp(join(tmpdir(), 'vb-revoke-')),
    allowedOrigins: [origin],
  });
  try {
    const open = await facade.open({ url: `${origin}/` });
    expect(open.ok, open.content).toBe(true);
    const id = (open.data as { session: { id: string } }).session.id;

    // a normal session cannot read runtime globals
    const before = await facade.runtimeRead({ sessionId: id, paths: ['window.__probe'] });
    expect(before.ok).toBe(false);
    expect(before.error?.code).toBe('E_RUNTIME_MODE');

    // an explicitly confirmed upgrade opens it
    const upgrade = await facade.requestModeUpgrade({
      sessionId: id, target: 'controlled_enhanced', confirmed: true, reason: 'tf0167 revoke test', ttlMs: 60_000,
    });
    expect(upgrade.ok, upgrade.content).toBe(true);
    const elevated = await facade.runtimeRead({ sessionId: id, paths: ['window.__probe'] });
    expect(elevated.ok, elevated.content).toBe(true);

    // revoke closes it again for the very next call
    const revoked = await facade.revokeMode(id);
    expect(revoked.ok, revoked.content).toBe(true);
    const after = await facade.runtimeRead({ sessionId: id, paths: ['window.__probe'] });
    expect(after.ok, 'a revoked session must not keep the elevated surface').toBe(false);
    expect(after.error?.code).toBe('E_RUNTIME_MODE');

    // revoking again is idempotent
    const again = await facade.revokeMode(id);
    expect(again.ok, again.content).toBe(true);

    await facade.close(id);
  } finally {
    await facade.dispose?.();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}, 60_000);

/**
 * TF-0164: a snapshot ref and a vb_pages frameId are two different numbering schemes.
 *
 * Measured 2026-10-10: the `f<n>` prefix inside a ref is the upstream frame sequence and keeps
 * increasing across navigations (the main frame carries one too), while vb_pages reports the
 * page.frames() position. They coincide on a fresh load and diverge afterwards, so a host holding
 * ref f5e3 could not read that frame's text: frameId f5 was refused as if it were a stale
 * reference. A frame read now accepts either identifier, resolving a prefix to the frame that
 * really owns the ref through the element's ownerFrame() rather than by guessing a number.
 */
it('reads a frame by snapshot prefix as well as by page.frames() position', async () => {
  let origin = '';
  const root = createServer((req, res) => {
    const url = new URL(req.url ?? '/', origin || 'http://127.0.0.1');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (url.pathname === '/top') { res.end(`<!doctype html><title>Top</title><p>TOP BODY</p><iframe src="${origin}/mid"></iframe>`); return; }
    if (url.pathname === '/mid') { res.end(`<!doctype html><title>Mid</title><p>MIDDLE BODY</p><button type="button">Save middle</button>`); return; }
    res.end('nope');
  });
  await new Promise<void>((done) => root.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(root.address() as { port: number }).port}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const control = await createUpstreamPageControl(
      await (await browser.newContext({ serviceWorkers: 'block' })).newPage(),
      origin,
      await mkdtemp(join(tmpdir(), 'vb-frame-numbering-')),
      undefined,
      [origin],
    );

    // a fresh load: the position id resolves, which is the only case the older test covered
    await control.navigate(`${origin}/top`, 'load');
    const freshRead = await control.frameText({ frameId: 'f1', maxLength: 200 });
    expect(freshRead.text).toContain('MIDDLE BODY');

    // one more top-level navigation moves the upstream frame sequence on
    await control.navigate(`${origin}/top`, 'load');
    const inventory = await control.listPages();
    const frames = inventory.pages[0].frames ?? [];
    expect(frames.map((frame) => frame.frameId), 'the position id is stable').toContain('f1');

    const items = await control.snapshot();
    const ref = items.find((item) => item.name === 'Save middle')?.ref;
    expect(ref, 'snapshot must expose the middle-frame button').toBeTruthy();
    const prefix = /-(f\d+)e\d+$/.exec(ref!)?.[1];
    expect(prefix, 'a frame ref must carry a prefix').toMatch(/^f\d+$/);
    // this is the divergence the test exists for
    expect(prefix, 'after a navigation the ref prefix is not the position id').not.toBe('f1');

    // the identifier the snapshot itself handed out must be usable for a frame-scoped read
    const byPrefix = await control.frameText({ frameId: prefix!, maxLength: 200 });
    expect(byPrefix.text).toContain('MIDDLE BODY');
    expect(byPrefix.scope.frameId, 'the read answers in the stable position scheme').toBe('f1');

    // an identifier that denotes nothing is still refused, never guessed
    await expect(control.frameText({ frameId: 'f42', maxLength: 100 })).rejects.toThrow(/unknown frame f42/);

    await control.close();
  } finally {
    await browser.close();
    root.closeAllConnections();
    await new Promise<void>((done) => root.close(() => done()));
  }
}, 60_000);
