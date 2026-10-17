import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.ts';
import { resolveMcpPolicy } from '../src/mcp/capability-policy.ts';
import { profileForDriver } from '../src/engine/driver-profile.ts';
import { createFsSourceMapResolver } from '../src/mcp/explain-error.ts';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { chromium as upstreamChromium } from 'playwright';
import { createUpstreamPageControl } from '../src/engine/upstream-control.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';

async function fixture() {
  const receipts: string[] = []; let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    if (req.method === 'POST') {
      let body = ''; req.on('data', chunk => { body += chunk; });
      req.on('end', () => { receipts.push(body); res.end('saved'); }); return;
    }
    res.setHeader('content-type', 'text/html');
    if (req.url === '/shots') {
      res.end(`<style>body{margin:0;background:#f6f8fb}#card{display:block;margin:900px 16px 24px;width:240px;height:80px;background:#134e4a;color:white;border:0;font:18px sans-serif}#hidden{display:none}</style><button id=replace onclick="document.querySelector('#card').replaceWith(document.querySelector('#card').cloneNode(true))">Replace card</button><button id=spoof onclick="Object.defineProperty(window,'innerWidth',{value:9999});Object.defineProperty(window,'devicePixelRatio',{value:99});Object.defineProperty(window,'scrollY',{value:9999})">Spoof globals</button><button class=tile>Duplicate</button><button class=tile>Duplicate</button><button id=hidden>Hidden</button><button id=card>Evidence card</button><div style="height:900px">End</div>`); return;
    }
    res.end('<style>#menu{display:none}@media(max-width:500px){#menu{display:block}#panel:not([data-open]){display:none}}</style><button id="menu" onclick="document.querySelector(\'#panel\').setAttribute(\'data-open\',\'\')">Menu</button><div id="panel"><form onsubmit="event.preventDefault();fetch(\'/save\',{method:\'POST\',body:document.querySelector(\'#name\').value}).then(()=>document.querySelector(\'#result\').textContent=\'saved\')"><input id="name" aria-label="Name"><button id="save">Save</button></form></div><output id="result">pending</output><output id="metrics"></output><script>document.querySelector(\'#metrics\').textContent=innerWidth+\'x\'+innerHeight+\' dpr=\'+devicePixelRatio</script>');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  return { url: 'http://127.0.0.1:' + (server.address() as { port: number }).port, receipts, hits: () => hits,
    close: async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } };
}
async function entrance(kind: string, root: string) {
  const facade = kind === 'sdk' ? (await createStandaloneFacade({ backend: 'upstream', workspaceRoot: root })).facade : undefined;
  const client = new Client({ name: 'viewport-tests', version: '1' });
  if (!facade) {
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', resolve('src/mcp/server.ts')], cwd: root,
      env: { ...process.env, VERSEBROWSER_BACKEND: 'upstream', VERSEBROWSER_TOOL_GROUPS: 'core,debug,network,evidence', VERSEBROWSER_CAPS: 'browser.open,browser.navigate,browser.act,browser.observe,browser.close,debug.console,debug.explain,network.read,evidence.write' } as Record<string, string>, stderr: 'pipe' });
    transport.stderr?.on('data', () => {}); await client.connect(transport);
  }
  const call = async (name: string, args: Record<string, any>): Promise<any> => {
    if (!facade) return JSON.parse(((await client.callTool({ name, arguments: args })).content as Array<{ text: string }>)[0]!.text);
    const id = String(args.sessionId ?? '');
    if (name === 'vb_open') return facade.open(args);
    if (name === 'vb_click') return facade.click(id, args.selector);
    if (name === 'vb_type') return facade.type(id, args.selector, args.text);
    if (name === 'vb_page_text') return facade.extractPageText({ sessionId: id, selector: args.selector });
    if (name === 'vb_screenshot') return facade.screenshotToDisk(id, args);
    if (name === 'vb_snapshot') return facade.snapshot(id);
    if (name === 'vb_pages') return facade.listPages(id);
    if (name === 'vb_page_new') return facade.newPage(id, { url: args.url, background: true });
    if (name === 'vb_page_select') return facade.selectPage(id, args.pageId);
    if (name === 'vb_page_close') return facade.closePage(id, args.pageId);
    if (name === 'vb_close') return facade.close(id);
    if (name === 'vb_nav') return facade.nav(id, args.url);
    if (name === 'vb_console') return facade.console(id);
    if (name === 'vb_explain_error') return facade.explain(args.error);
    if (name === 'vb_verify_flow') return facade.verifyFlow({ ...args, sessionId: id });
    if (name === 'vb_wait') return facade.wait({ ...args, sessionId: id });
    throw new Error(name);
  };
  return { call, close: async () => { await facade?.dispose(); await client.close(); } };
}
it.each(['sdk', 'stdio'])('runs desktop and narrow workflows via %s using the existing open viewport', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'vb-viewport-')), site = await fixture(), api = await entrance(kind, root);
  try {
    for (const [width, height] of [[1280, 720], [390, 844]]) {
      const opened = await api.call('vb_open', { url: site.url, width, height }); expect(opened.ok, opened.content).toBe(true);
      const sessionId = opened.data.session.id;
      const call = async (name: string, args: Record<string, unknown> = {}) => { const result = await api.call(name, { sessionId, ...args }); expect(result.ok, result.content).toBe(true); return result; };
      expect((await call('vb_page_text', { selector: '#metrics' })).content).toContain(width + 'x' + height + ' dpr=1');
      if (width < 500) await call('vb_click', { selector: '#menu' });
      await call('vb_type', { selector: '#name', text: 'Alex' }); await call('vb_click', { selector: '#save' });
      await expect.poll(() => site.receipts.length).toBe(width === 1280 ? 1 : 2);
      expect(site.receipts.every(value => value === 'Alex')).toBe(true);
      const shot = await call('vb_screenshot'), bytes = await readFile(resolve(root, shot.data.path));
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([width, height]);
      await call('vb_close');
    }
  } finally { await api.close(); await site.close(); }
});
it.each(['sdk', 'stdio'])('rejects invalid viewport values before browser requests via %s', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'vb-viewport-invalid-')), site = await fixture(), api = await entrance(kind, root);
  try {
    for (const value of [0, -1, 4097, 1.5, '390', null]) for (const dimension of ['width', 'height']) {
      const result = await api.call('vb_open', { url: site.url, [dimension]: value });
      expect(result.ok, JSON.stringify({ dimension, value, result })).toBe(false); expect(site.hits()).toBe(0);
    }
  } finally { await api.close(); await site.close(); }
});
it('rejects explicit viewport for persistent/CDP sessions without attaching', async () => {
  const connect = vi.spyOn(chromium, 'connectOverCDP').mockRejectedValue(new Error('unexpected CDP attachment'));
  const facade = new AgentBrowserFacade({ api: await createPlaywrightHostApi({ persistent: true }) });
  try {
    const result = await facade.open({ connectionMode: 'cdp', cdpEndpoint: 'http://127.0.0.1:1', width: 390, height: 844 });
    expect(result.ok).toBe(false); expect(result.content).toContain('viewport'); expect(connect).not.toHaveBeenCalled();
  } finally { connect.mockRestore(); await facade.dispose(); }
});
it('rejects open payloads the in-process driver cannot honour instead of silently substituting', async () => {
  // Measured before these guards, over MCP: `vb_open {cdpEndpoint}` answered ok:true with a fresh
  // managed browser (the endpoint was dropped), and `vb_open {profile:'acme'}` answered ok:true
  // with `session.profile='standalone'` (the name was dropped). Both told the caller it had done
  // something it had not. docs/mcp.md states the rule for explicit viewport requests - rejected
  // rather than silently ignored - and the upstream backend already rejects both fields.
  const launch = vi.spyOn(chromium, 'launch').mockRejectedValue(new Error('unexpected managed launch'));
  const connect = vi.spyOn(chromium, 'connectOverCDP').mockRejectedValue(new Error('unexpected CDP attachment'));
  const facade = new AgentBrowserFacade({ api: await createPlaywrightHostApi({}) });
  try {
    const attempts: Array<[Record<string, unknown>, string]> = [
      [{ connectionMode: 'cdp', cdpEndpoint: 'http://127.0.0.1:1' }, 'persistent'],
      [{ connectionMode: 'auto-connect' }, 'persistent'],
      [{ connectionMode: 'external-profile', externalProfile: 'Default', allowExternalBrowser: true }, 'persistent'],
      [{ profile: 'work' }, 'profile'],
      [{ profile: 'standalone' }, 'profile'],
    ];
    for (const [payload, expected] of attempts) {
      const result = await facade.open({ url: 'http://127.0.0.1:1/', ...payload });
      expect(result.ok, JSON.stringify(payload)).toBe(false);
      expect(result.content, JSON.stringify(payload)).toContain(expected);
    }
    expect(launch, 'a refused open must not fall back to a managed browser').not.toHaveBeenCalled();
    expect(connect, 'a refused open must not reach CDP').not.toHaveBeenCalled();
  } finally { launch.mockRestore(); connect.mockRestore(); await facade.dispose(); }
});

it.each(['sdk', 'stdio'])('captures bound element/full-page images with unspoofed metrics via %s', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'vb-shot-metrics-')), site = await fixture(), api = await entrance(kind, root);
  try {
    const opened = await api.call('vb_open', { url: site.url + '/shots', width: 390, height: 844 });
    expect(opened.ok, opened.content).toBe(true); const sessionId = opened.data.session.id;
    const call = (name: string, args: Record<string, unknown> = {}) => api.call(name, { sessionId, ...args });
    expect((await call('vb_click', { selector: '#spoof' })).ok).toBe(true);
    const full = await call('vb_screenshot', { fullPage: true }); expect(full.ok, full.content).toBe(true);
    const fullBytes = await readFile(resolve(root, full.data.path));
    expect(fullBytes.readUInt32BE(16)).toBe(390); expect(fullBytes.readUInt32BE(20)).toBeGreaterThan(1700);
    expect(full.data.capture).toMatchObject({ kind: 'fullPage', metrics: { state: 'stable', after: { viewport: { width: 390, height: 844 }, devicePixelRatio: 1, scroll: { y: 0 } } } });
    const shot = await call('vb_screenshot', { selector: '#card' }); expect(shot.ok, shot.content).toBe(true);
    const bytes = await readFile(resolve(root, shot.data.path));
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([240, 80]);
    expect(shot.data.capture).toMatchObject({ kind: 'element', pixels: { width: 240, height: 80 }, metrics: { state: 'stable', after: { viewport: { width: 390, height: 844 }, devicePixelRatio: 1 } } });
    expect(shot.data.capture.metrics.after.scroll.y).toBeGreaterThan(0);
    expect(JSON.stringify(shot)).not.toContain('base64'); expect(shot.data.outcome).toBeUndefined();
    expect((await call('vb_screenshot', { selector: '.tile' })).ok).toBe(false);
    expect((await call('vb_screenshot', { selector: '#hidden' })).ok).toBe(false);
    expect((await call('vb_screenshot', { selector: '#missing' })).ok).toBe(false);
    expect((await call('vb_screenshot', { selector: '#card', fullPage: true })).ok).toBe(false);
    const snap = await call('vb_snapshot'); expect(snap.ok, snap.content).toBe(true);
    const ref = /data-vb-ref=["'](u[A-Za-z0-9-]+)["']/.exec(snap.content)?.[1]; expect(ref).toBeTruthy();
    const byRef = await call('vb_screenshot', { selector: '[data-vb-ref="' + ref + '"]' }); expect(byRef.ok, byRef.content).toBe(true);
    const peer = await api.call('vb_open', { url: site.url + '/shots' }); expect(peer.ok).toBe(true);
    expect((await api.call('vb_screenshot', { sessionId: peer.data.session.id, selector: '[data-vb-ref="' + ref + '"]' })).ok).toBe(false);
    expect((await api.call('vb_close', { sessionId: peer.data.session.id })).ok).toBe(true);
    expect((await call('vb_click', { selector: '#replace' })).ok).toBe(true);
    const stale = await call('vb_screenshot', { selector: '[data-vb-ref="' + ref + '"]' });
    expect(stale.ok).toBe(false); expect(stale.content).toMatch(/stale|fresh snapshot/i);
    const pages = await call('vb_pages'); const parentId = pages.data.activePageId;
    const created = await call('vb_page_new', { url: site.url + '/shots', background: true }); expect(created.ok, created.content).toBe(true);
    const newId = created.data.createdPageId;
    const parentShot = await call('vb_screenshot'); expect(parentShot.ok, parentShot.content).toBe(true);
    expect(parentShot.data.capture.pageId).toBe(parentId);
    expect((await call('vb_page_select', { pageId: newId })).ok).toBe(true);
    const selectedShot = await call('vb_screenshot'); expect(selectedShot.ok, selectedShot.content).toBe(true);
    expect(selectedShot.data.capture.pageId).toBe(newId);
    expect((await call('vb_page_close', { pageId: newId })).ok).toBe(true);
    expect((await call('vb_screenshot')).ok).toBe(false);
    expect((await call('vb_page_select', { pageId: parentId })).ok).toBe(true);
    expect((await call('vb_screenshot')).ok).toBe(true);
  } finally { await api.close(); await site.close(); }
});

it('uses actual DPR and keeps screenshot failure, changed metrics, and unavailable metrics distinct', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vb-shot-dpr-')), site = await fixture();
  const browser = await upstreamChromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage(), control = await createUpstreamPageControl(page, site.url, root);
  try {
    await control.navigate(site.url + '/shots', 'load');
    const shot = await control.screenshot({ sessionId: 'fixture', selector: '#card' });
    expect(shot.capture.metrics.after).toMatchObject({ viewport: { width: 390, height: 844 }, devicePixelRatio: 2 });
    expect(shot.capture.pixels).toEqual({ width: 480, height: 160 });
    const refs = await control.snapshot(), cardRef = refs.find(item => item.name === 'Evidence card')!.ref;
    await page.evaluate(() => { const card = document.querySelector('#card')!; card.replaceWith(card.cloneNode(true)); });
    await expect(control.screenshot({ sessionId: 'fixture', selector: '[data-vb-ref="' + cardRef + '"]' })).rejects.toThrow(/not found|snapshot|stale/i);
    let calls = 0;
    const capture = page.screenshot.bind(page);
    const transient = vi.spyOn(page, 'screenshot').mockImplementation(async options => {
      calls++; if (calls === 1) throw new Error('Protocol error (Page.captureScreenshot): Unable to capture screenshot');
      return capture(options);
    });
    expect((await control.screenshot({ sessionId: 'fixture' })).capture.pixels).toEqual({ width: 780, height: 1688 });
    expect(calls).toBe(2); transient.mockRestore();
    const changed = vi.spyOn(page, 'screenshot').mockImplementation(async options => {
      const buffer = await capture(options); await page.evaluate(() => scrollTo(0, 0)); return buffer;
    });
    expect((await control.screenshot({ sessionId: 'fixture' })).capture.metrics.state).toBe('changed'); changed.mockRestore();
    const broken = vi.spyOn(page, 'screenshot').mockRejectedValue(new Error('Protocol error (Page.captureScreenshot): Target closed'));
    await expect(control.screenshot({ sessionId: 'fixture' })).rejects.toThrow('Target closed'); expect(broken).toHaveBeenCalledTimes(1); broken.mockRestore();
    const original = context.newCDPSession.bind(context);
    const other = await context.newPage();
    await control.selectPage((await control.listPages()).pages.find(item => !item.active)!.pageId);
    let refused = 0;
    const metadata = vi.spyOn(context, 'newCDPSession').mockImplementation(async target => {
      const cdp = await original(target); const send = cdp.send.bind(cdp);
      cdp.send = ((method: string, params: any) => method === 'Page.createIsolatedWorld' ? (refused++, Promise.reject(new Error('synthetic metrics refusal'))) : send(method as any, params)) as typeof cdp.send;
      return cdp;
    });
    // Recreate a page so its metadata connection is created through the explicit failure injection.
    await other.close(); const last = await context.newPage();
    await control.selectPage((await control.listPages()).pages.find(item => item.pageId !== shot.capture.pageId)!.pageId);
    const unavailable = await control.screenshot({ sessionId: 'fixture' });
    expect(unavailable.capture.metrics).toEqual({ state: 'unavailable' }); expect(refused).toBe(2);
    expect(unavailable.buffer.length).toBeGreaterThan(24); metadata.mockRestore(); await last.close();
  } finally { await control.close(); await browser.close(); await site.close(); }
});

it.each(['sdk', 'stdio'])('preserves console, unmapped, network and business failures after a successful screenshot via %s', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'vb-shot-diagnostics-'));
  const server = createServer((req,res) => {
    if(req.url === '/failed-api') { res.writeHead(503);res.end('unavailable');return; }
    res.setHeader('content-type','text/html');
    res.end('<output id="state">ready</output>' + (req.url === '/console' ? '<script>try{throw new Error("viewport diagnostic crash")}catch(error){console.error(error.stack)}</script>' : req.url === '/network' ? '<script>fetch("/failed-api").then(()=>document.querySelector("output").textContent="network observed")</script>' : ''));
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const url='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const api=await entrance(kind,root);
  try {
    const opened=await api.call('vb_open',{url:url+'/console'});expect(opened.ok).toBe(true);const sessionId=opened.data.session.id;
    const call=(name:string,args:Record<string,unknown>={})=>api.call(name,{sessionId,...args});
    expect((await call('vb_screenshot')).ok).toBe(true);
    const consoleResult=await call('vb_console');expect(consoleResult.content).toContain('viewport diagnostic crash');
    const explained=await api.call('vb_explain_error',{error:consoleResult.data?.content??consoleResult.content});expect(explained.ok,explained.content).toBe(true);
    expect(explained.data.primary.mapped).toBe(false);expect(explained.data.primary.reason).toContain('no source-map');expect(explained.data.primary.originalLine).toBeUndefined();
    const consoleFailure=await call('vb_verify_flow',{expect:[{type:'text',selector:'#state',equals:'ready'}],screenshot:true});
    expect(consoleFailure.ok).toBe(true);expect(consoleFailure.data.outcome).toBe('fail');
    expect(kind==='sdk'?consoleFailure.data.consoleDiff.newErrors.length:consoleFailure.data.consoleErrorCount).toBeGreaterThan(0);
    expect((await call('vb_nav',{url:url+'/network'})).ok).toBe(true);
    expect((await call('vb_wait',{selector:'#state',textEquals:'network observed'})).ok).toBe(true);
    const networkFailure=await call('vb_verify_flow',{screenshot:true});expect(networkFailure.data.outcome).toBe('fail');
    expect(kind==='sdk'?networkFailure.data.networkFailures.count:networkFailure.data.networkFailureCount).toBeGreaterThan(0);
    expect((await call('vb_nav',{url:url+'/clean'})).ok).toBe(true);
    const businessFailure=await call('vb_verify_flow',{expect:[{type:'text',selector:'#state',equals:'not ready'}],screenshot:true});expect(businessFailure.data.outcome).toBe('fail');
    const clean=await call('vb_verify_flow',{expect:[{type:'text',selector:'#state',equals:'ready'}],screenshot:true});expect(clean.data.outcome).toBe('pass');
    expect(clean.evidence.some((item:{kind:string})=>item.kind==='screenshot')).toBe(true);
  } finally {await api.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
it.each(['sdk', 'mcp-injected'])('retains a real minified stack source mapping with a host-supplied resolver via %s', async kind => {
  const root=await mkdtemp(join(tmpdir(),'vb-shot-mapped-'));
  const built=await transform('function crash() {\n  throw new Error("mapped screenshot failure");\n}\ntry { crash(); } catch (error) { console.error(error.stack); }',{sourcefile:'viewport-source.ts',loader:'ts',minify:true,sourcemap:'external'});
  const mapPath=join(root,'app.js.map');await writeFile(mapPath,built.map);
  const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?built.code:'<output>ready</output><script src="/app.js"></script>');});
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const url='http://127.0.0.1:'+(server.address() as {port:number}).port;
  const api=await createPlaywrightHostApi({upstream:true,workspaceRoot:root});
  const facade=new AgentBrowserFacade({api,workspaceRoot:root,driverProfile:profileForDriver('upstream'),resolveSourceMap:createFsSourceMapResolver({mapPaths:[mapPath]})});
  const mcp=createMcpServer({facade,workspaceRoot:root,policy:resolveMcpPolicy({groups:'core,debug',caps:'browser.open,browser.close,browser.observe,debug.console,debug.explain'})});
  const client=new Client({name:'mapped-viewport',version:'1'}),[serverTransport,clientTransport]=InMemoryTransport.createLinkedPair();
  try {
    await mcp.connect(serverTransport);await client.connect(clientTransport);
    const call=async(name:string,args:Record<string,any>):Promise<any>=>kind==='sdk'?(name==='vb_open'?facade.open(args):name==='vb_console'?facade.console(args.sessionId):facade.explain(args.error)):JSON.parse(((await client.callTool({name,arguments:args})).content as Array<{text:string}>)[0]!.text);
    const opened=await call('vb_open',{url});expect(opened.ok).toBe(true);const sessionId=opened.data.session.id;
    const captured=await call('vb_console',{sessionId});expect(captured.content).toContain('mapped screenshot failure');
    const explained=await call('vb_explain_error',{error:captured.data?.content??captured.content});expect(explained.ok).toBe(true);
    expect(explained.data.primary).toMatchObject({mapped:true,source:'viewport-source.ts',originalLine:2});expect(explained.data.primary.snippet).toContain('throw new Error');
  } finally {await client.close();await mcp.close();await facade.dispose();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
