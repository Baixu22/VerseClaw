import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chromium } from 'playwright-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import * as persistent from '../src/engine/persistent-sessions.ts';
import { setWorkspaceRoot } from '../src/host/workspace-paths.ts';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'vb-persistent-failure-')); setWorkspaceRoot(root); });
afterEach(async () => {
  vi.restoreAllMocks();
  setWorkspaceRoot(undefined);
  // Best-effort: a Chromium helper can still hold a profile file briefly. `force: true`
  // only suppresses ENOENT, and Node retries EBUSY only when maxRetries is set — without
  // this, a saturated run reddened the *hook* ("Hook timed out") after its assertions had
  // already passed. The product's own `removeSession` takes the same stance (C93).
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
});

it('closes its detached browser if initial CDP attachment fails before a session is registered', async () => {
  let endpoint = '';
  let launched: Awaited<ReturnType<typeof persistent.launchDetachedBrowser>> | undefined;
  const launch = persistent.launchDetachedBrowser;
  vi.spyOn(persistent, 'launchDetachedBrowser').mockImplementation(async options => {
    endpoint = persistent.cdpEndpoint(options.port);
    return launched = await launch(options);
  });
  vi.spyOn(chromium, 'connectOverCDP').mockRejectedValueOnce(new Error('injected attach failure'));
  const api = await createPlaywrightHostApi({ persistent: true });
  try {
    const result = await new AgentBrowserFacade({ api }).open();
    expect(result.error?.code).toBe('E_OPEN');
    // Holds on both cleanup outcomes below: the original attach error is always surfaced.
    expect(result.error?.message).toContain('injected attach failure');
    expect((await api.status()).sessions).toEqual([]);

    /**
     * Two outcomes are legitimate here, and the test must accept both.
     *
     * `closeBrowserThroughCdp` gives its internal `/json/version` fetch a **1500ms**
     * budget (`AbortSignal.timeout(Math.min(1500, …))`). Under full-suite load that can
     * time out, and a timeout is **not** an ECONNREFUSED — so it reports "not confirmed".
     * Since C83 the cleanup then retains an addressable recovery record and does not
     * pretend the browser exited. Asserting only the happy path made this test red on
     * ~1 in 4 saturated runs (`expected true to be false`), and — because the teardown
     * deleted the whole root — that run also **orphaned** the still-live browser by
     * discarding its only record, which is exactly what
     * `npm run check:stray-browsers` now catches.
     */
    const alive = await persistent.probeEndpoint(endpoint);
    const records = await persistent.listSessionRecords();
    const recoveryId = result.error?.details?.recoverySessionId;
    if (typeof recoveryId === 'string') {
      // An endpoint may go down after cleanup returned "unconfirmed". The later
      // probe does not retroactively invalidate the retained recovery receipt.
      expect(records).toHaveLength(1);
      expect(records[0]!.id).toBe(recoveryId);
      expect(records.map(record => record.endpoint)).toContain(endpoint);
      expect(result.error?.message).toContain('startup cleanup unconfirmed');
    } else {
      expect(alive).toBe(false);
      expect(records).toEqual([]);
    }
  } finally {
    // Terminate the browser this test started **before** dropping any record, so a
    // saturated run cannot leave a live browser the product can no longer address.
    if (endpoint && !(await persistent.closeBrowserThroughCdp(endpoint).catch(() => false))) {
      const child = launched?.child;
      if (child && child.exitCode === null && child.signalCode === null) child.kill();
    }
    for (const record of await persistent.listSessionRecords()) {
      await persistent.removeSession(record.id).catch(() => undefined);
    }
  }
}, 30_000);

it('reports an early browser process exit with its exit code and bounded stderr', async () => {
  const api = await createPlaywrightHostApi({ persistent: true, executablePath: process.execPath });
  const result = await new AgentBrowserFacade({ api }).open();
  expect(result.error?.code).toBe('E_OPEN');
  // Node rejects Chromium's command-line flags with exit code 9.
  expect(result.error?.message).toContain('exitCode=9');
  expect(result.error?.message).toContain('bad option');
  expect((await api.status()).sessions).toEqual([]);
}, 30_000);

it('terminates its own process when CDP readiness fails before attachment', async () => {
  let launched: Awaited<ReturnType<typeof persistent.launchDetachedBrowser>> | undefined;
  let endpoint = '';
  const launch = persistent.launchDetachedBrowser;
  vi.spyOn(persistent, 'launchDetachedBrowser').mockImplementation(async options => {
    endpoint = persistent.cdpEndpoint(options.port);
    return launched = await launch(options);
  });
  vi.spyOn(persistent, 'waitForCdpEndpoint').mockRejectedValueOnce(new Error('injected readiness failure'));
  const api = await createPlaywrightHostApi({ persistent: true });
  try {
    const result = await new AgentBrowserFacade({ api }).open();
    expect(result.error?.message).toContain('injected readiness failure');
    expect(launched).toBeDefined();
    expect(launched!.child.exitCode !== null || launched!.child.signalCode !== null).toBe(true);
    expect(await persistent.probeEndpoint(endpoint)).toBe(false);
    expect(await persistent.listSessionRecords()).toEqual([]);
  } finally {
    if (launched?.child.exitCode === null && launched.child.signalCode === null) launched.child.kill();
    if (endpoint) await persistent.closeBrowserThroughCdp(endpoint);
  }
}, 30_000);

it('keeps a recovery record when startup cleanup cannot confirm shutdown', async () => {
  const launch = persistent.launchDetachedBrowser;
  let endpoint = '';
  vi.spyOn(persistent, 'launchDetachedBrowser').mockImplementation(async options => {
    endpoint = persistent.cdpEndpoint(options.port);
    const launched = await launch(options);
    vi.spyOn(launched.child, 'kill').mockReturnValue(false);
    return launched;
  });
  vi.spyOn(persistent, 'waitForCdpEndpoint').mockRejectedValueOnce(new Error('injected readiness failure'));
  vi.spyOn(persistent, 'closeBrowserThroughCdp').mockResolvedValue(false);
  const api = await createPlaywrightHostApi({ persistent: true });
  const facade = new AgentBrowserFacade({ api });
  try {
    const result = await facade.open();
    expect(result.error?.code).toBe('E_OPEN');
    expect(result.error?.message).toContain('startup cleanup unconfirmed');
    const records = await persistent.listSessionRecords();
    expect(records).toHaveLength(1);
    expect(result.error?.message).toContain(records[0]!.id);
    // This open's readiness probe was injected to fail *before* the detached browser
    // binds its port (measured ~500ms after spawn), so the endpoint legitimately does
    // not answer yet. Wait on the observable condition — a single immediate probe made
    // this assertion a race between spawn and bind, not a statement about the product.
    let alive = false;
    for (let attempt = 0; attempt < 50 && !alive; attempt += 1) {
      alive = await persistent.probeEndpoint(endpoint, 300);
      if (!alive) await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(alive).toBe(true);
    vi.restoreAllMocks();
    const closed = await facade.close(records[0]!.id);
    expect(closed.ok, JSON.stringify(closed)).toBe(true);
    expect(await persistent.listSessionRecords()).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    if (endpoint) await persistent.closeBrowserThroughCdp(endpoint);
  }
}, 30_000);

it('preserves external browser ownership across reattachment and disconnects its CDP clients', async () => {
  const port = await persistent.allocatePort();
  const owner = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`, '--no-sandbox'] });
  const endpoint = persistent.cdpEndpoint(port);
  const connections: Awaited<ReturnType<typeof chromium.connectOverCDP>>[] = [];
  const connect = chromium.connectOverCDP.bind(chromium);
  vi.spyOn(chromium, 'connectOverCDP').mockImplementation(async (...args) => { const remote = await connect(...args); connections.push(remote); return remote; });
  const a = await createPlaywrightHostApi({ persistent: true });
  const b = await createPlaywrightHostApi({ persistent: true });
  let sessionId = '';
  try {
    await persistent.waitForCdpEndpoint(endpoint);
    sessionId = (await a.open({ connectionMode: 'cdp', cdpEndpoint: endpoint })).session.id;
    expect((await persistent.loadSessionRecord(sessionId))?.external).toBe(true);
    await b.takeSnapshot({ sessionId });
    await b.close({ sessionId });
    expect(owner.isConnected()).toBe(true);
    await a.close({ sessionId });
    expect(connections.every(connection => !connection.isConnected())).toBe(true);
    expect(await persistent.probeEndpoint(endpoint)).toBe(true);
  } finally {
    if (sessionId) { await Promise.resolve(a.close({ sessionId })).catch(() => {}); await Promise.resolve(b.close({ sessionId })).catch(() => {}); }
    await owner.close();
    await Promise.all(connections.map(connection => connection.close().catch(() => {})));
  }
}, 30_000);

it('does not report a successful close or delete its session when shutdown is unconfirmed', async () => {
  const api = await createPlaywrightHostApi({ persistent: true });
  const facade = new AgentBrowserFacade({ api });
  const sessionId = (await api.open()).session.id;
  const endpoint = (await persistent.loadSessionRecord(sessionId))!.endpoint;
  const close = vi.spyOn(persistent, 'closeBrowserThroughCdp').mockResolvedValueOnce(false);
  try {
    const result = await facade.close(sessionId);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('E_CLOSE');
    expect(await persistent.loadSessionRecord(sessionId)).not.toBeNull();
    close.mockRestore();
    expect((await facade.close(sessionId)).ok).toBe(true);
  } finally {
    close.mockRestore();
    await Promise.resolve(api.close({ sessionId })).catch(() => {});
    await persistent.closeBrowserThroughCdp(endpoint);
  }
}, 30_000);

it('exposes a recovery id when navigation fails and rollback cannot close the browser', async () => {
  let endpoint = '';
  const launch = persistent.launchDetachedBrowser;
  vi.spyOn(persistent, 'launchDetachedBrowser').mockImplementation(async options => {
    endpoint = persistent.cdpEndpoint(options.port);
    return launch(options);
  });
  vi.spyOn(persistent, 'closeBrowserThroughCdp').mockResolvedValue(false);
  const api = await createPlaywrightHostApi({ persistent: true });
  const facade = new AgentBrowserFacade({ api });
  try {
    const result = await facade.open({ url: 'http://127.0.0.1:1/' });
    expect(result.error?.code).toBe('E_OPEN');
    const records = await persistent.listSessionRecords();
    expect(records).toHaveLength(1);
    expect(result.error?.message).toContain(records[0]!.id);
    expect(result.error?.details).toMatchObject({ recoverySessionId: records[0]!.id });
    expect((await facade.dispose()).ok).toBe(false);
    const probeStarted = Date.now();
    const responding = await persistent.probeEndpoint(endpoint);
    expect(responding, JSON.stringify({ endpoint, elapsedMs: Date.now() - probeStarted,
      pid: records[0]!.pid, processAlive: persistent.isProcessAlive(records[0]!.pid) })).toBe(true);
    vi.restoreAllMocks();
    expect((await facade.dispose()).ok).toBe(true);
    expect(await persistent.probeEndpoint(endpoint)).toBe(false);
  } finally {
    vi.restoreAllMocks();
    if (endpoint) await persistent.closeBrowserThroughCdp(endpoint);
  }
}, 30_000);

it('restores the original native page despite reordered duplicate-URL tabs and refuses a closed target',async()=>{
  const {createServer}=await import('node:http');
  let documents=0;const writes:number[]=[];
  const server=createServer((req,res)=>{
    const requested=new URL(req.url!,'http://localhost');
    if(requested.pathname==='/effect'){writes.push(Number(requested.searchParams.get('page')));res.end('ok');return;}
    if(requested.pathname!=='/page'){res.writeHead(404);res.end();return;}
    const number=++documents;res.setHeader('content-type','text/html');
    res.end('<h1>'+ (number===1?'Owned page':'Decoy page') +'</h1><input id="value" value="initial" oninput="fetch(\'/effect?page='+number+'\')">');
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const url='http://127.0.0.1:'+(server.address() as import('node:net').AddressInfo).port+'/page';
  const a=await createPlaywrightHostApi({persistent:true,workspaceRoot:root});
  const facadeA=new AgentBrowserFacade({api:a,workspaceRoot:root,evidenceRoot:join(root,'ev')});
  const remotes:Awaited<ReturnType<typeof chromium.connectOverCDP>>[]=[];let sid='';
  const nativeId=async(page:import('playwright-core').Page)=>{const cdp=await page.context().newCDPSession(page);try{return(await cdp.send('Target.getTargetInfo')).targetInfo.targetId;}finally{await cdp.detach();}};
  try {
    const opened=await facadeA.open({url,mode:'headless'});expect(opened.ok,opened.content).toBe(true);sid=(opened.data as {session:{id:string}}).session.id;
    const record=(await persistent.loadSessionRecord(sid,root))!;const nativeConnect=chromium.connectOverCDP.bind(chromium);
    const admin=await nativeConnect(record.endpoint);remotes.push(admin);const context=admin.contexts()[0];const owned=context.pages().find(page=>page.url()===url)!;expect(owned).toBeTruthy();
    const wanted=await nativeId(owned);const decoy=await context.newPage();await decoy.goto(url);const decoyId=await nativeId(decoy);expect(decoy.url()).toBe(owned.url());
    vi.spyOn(chromium,'connectOverCDP').mockImplementation(async(...args)=>{
      const remote=await nativeConnect(...args);remotes.push(remote);
      for(const ctx of remote.contexts()){const entries=await Promise.all(ctx.pages().map(async page=>({page,id:await nativeId(page)})));
        vi.spyOn(ctx,'pages').mockImplementation(()=>entries.filter(entry=>!entry.page.isClosed()).sort((one,two)=>Number(two.id===decoyId)-Number(one.id===decoyId)).map(entry=>entry.page));}
      return remote;
    });
    const b=await createPlaywrightHostApi({persistent:true,workspaceRoot:root});const facadeB=new AgentBrowserFacade({api:b,workspaceRoot:root,evidenceRoot:join(root,'ev')});
    const read=await facadeB.extractPageText({sessionId:sid,selector:'h1'});
    console.log(JSON.stringify({persistentTargetReceipt:{recordedTarget:(record as typeof record&{targetId?:string}).targetId??null,wanted,decoyId,read}}));
    expect(read.ok,read.content).toBe(true);expect((read.data as {text:string}).text).toBe('Owned page');
    expect((record as typeof record&{targetId?:string}).targetId).toBe(wanted);
    expect((await facadeB.type(sid,'#value','authorized')).ok).toBe(true);await expect.poll(()=>writes).toEqual([1]);expect(await owned.locator('#value').inputValue()).toBe('authorized');expect(await decoy.locator('#value').inputValue()).toBe('initial');
    await owned.close();const count=context.pages().length;
    const c=await createPlaywrightHostApi({persistent:true,workspaceRoot:root});await expect(c.getConsoleMessages({sessionId:sid})).rejects.toThrow('E_PAGE_CLOSED');
    expect(await persistent.loadSessionRecord(sid,root)).not.toBeNull();expect(context.pages()).toHaveLength(count);expect(admin.isConnected()).toBe(true);expect(writes).toEqual([1]);
  } finally {vi.restoreAllMocks();if(sid)await facadeA.close(sid);await Promise.all(remotes.map(remote=>remote.close().catch(()=>{})));server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
},30000);
