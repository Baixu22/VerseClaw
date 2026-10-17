import { afterEach, expect, it, vi } from 'vitest';
vi.mock('node:dns/promises',()=>({lookup:vi.fn()}));
import { lookup } from 'node:dns/promises';
import { authorizedBrowserOrigins, resolveAuthorizedBrowserTarget, createUpstreamPageControl, describeTransferFailure, assertTransferTimeoutMs, transferPoolKey, DEFAULT_TRANSFER_TIMEOUT_MS, MAX_TRANSFER_TIMEOUT_MS, DEFAULT_NAVIGATION_DEADLINE_MS, navigationDeadlineMs } from '../src/engine/upstream-control.ts';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStandaloneFacade} from '../src/engine/standalone.ts';
import {createMcpServer} from '../src/mcp/server.ts';
import {resolveMcpPolicy} from '../src/mcp/capability-policy.ts';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
afterEach(()=>{vi.mocked(lookup).mockReset();vi.unstubAllEnvs();});

it('names a transport deadline instead of the bare "aborted" a policy refusal also produces', () => {
  const timedOut = new AbortController();
  timedOut.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  expect(describeTransferFailure(new Error('aborted'), timedOut.signal).message).toBe(
    'E_REQUEST_DEADLINE: a single request exceeded the 10s transport budget',
  );
  // A non-timeout abort (e.g. session lifetime) and an ordinary error keep their own identity.
  const cancelled = new AbortController();
  cancelled.abort();
  expect(describeTransferFailure(new Error('aborted'), cancelled.signal).message).toBe('aborted');
  expect(describeTransferFailure('raw string', new AbortController().signal).message).toBe('raw string');
});

it('applies the transfer-budget env only to the upstream worker', () => {
  // The variable is process-wide (a host sets it once), but it tunes the controlled upstream
  // transport and grants nothing - so a legacy worker sharing that environment must still start.
  // Measured before the fix: a legacy stdio worker died with 'Connection closed' whenever it was set.
  vi.stubEnv('VERSEBROWSER_TRANSFER_TIMEOUT_MS', '60000');
  expect(() => createMcpServer({})).not.toThrow();
  // An explicit programmatic value on a backend with no such transport is still a caller error.
  expect(() => createMcpServer({ transferTimeoutMs: 5_000 })).toThrow(/E_UPSTREAM_CONFIG/);
  expect(() => createMcpServer({ backend: 'upstream', transferTimeoutMs: 5_000 })).not.toThrow();
});

it('names the configured transport budget and rejects an out-of-range one', () => {
  const timedOut = new AbortController();
  timedOut.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  // The message must name the budget that actually applied, not a hard-coded 10s.
  expect(describeTransferFailure(new Error('aborted'), timedOut.signal, 45_000).message).toBe(
    'E_REQUEST_DEADLINE: a single request exceeded the 45s transport budget',
  );
  expect(describeTransferFailure(new Error('aborted'), timedOut.signal).message).toContain('10s');
  expect(assertTransferTimeoutMs(undefined)).toBe(DEFAULT_TRANSFER_TIMEOUT_MS);
  expect(assertTransferTimeoutMs(30_000)).toBe(30_000);
  for (const bad of [0, -1, 999, MAX_TRANSFER_TIMEOUT_MS + 1, 1.5, Number.NaN, '30000' as unknown as number]) {
    expect(() => assertTransferTimeoutMs(bad)).toThrow(/E_UPSTREAM_CONFIG/);
  }
});

it('surfaces the transport deadline on navigation instead of the opaque Playwright abort', async () => {
  // A granted origin that answers later than the budget. Playwright can only report its own
  // `net::ERR_BLOCKED_BY_CLIENT` here, which is also what an origin refusal looks like; the
  // recorded reason must reach the caller.
  const late = createServer((_req, res) => { setTimeout(() => { res.setHeader('content-type', 'text/html'); res.end('<h1>late</h1>'); }, 5_000); });
  await new Promise<void>((done) => late.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(late.address() as { port: number }).port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const control = await createUpstreamPageControl(await context.newPage(), origin, await mkdtemp(join(tmpdir(), 'vb-deadline-')), undefined, [origin], undefined, undefined, undefined, 1_000);
    await expect(control.navigate(origin + '/', 'load')).rejects.toThrow(/E_REQUEST_DEADLINE: a single request exceeded the 1s transport budget/);
    await control.close();
  } finally { await browser.close(); late.closeAllConnections(); await new Promise<void>((done) => late.close(() => done())); }
}, 15_000);

it('lets a host-granted larger budget read the same slow response', async () => {
  const late = createServer((_req, res) => { setTimeout(() => { res.setHeader('content-type', 'text/html'); res.end('<h1>late but ok</h1>'); }, 3_000); });
  await new Promise<void>((done) => late.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(late.address() as { port: number }).port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const control = await createUpstreamPageControl(page, origin, await mkdtemp(join(tmpdir(), 'vb-deadline-raised-')), undefined, [origin], undefined, undefined, undefined, 8_000);
    await control.navigate(origin + '/', 'load');
    expect(await page.locator('h1').innerText()).toBe('late but ok');
    await control.close();
  } finally { await browser.close(); late.closeAllConnections(); await new Promise<void>((done) => late.close(() => done())); }
}, 20_000);

it('opens a page whose load never settles when the caller asks for dom-ready', async () => {
  // `/hang` never answers, so the `load` event never fires. The historical open hard-coded `load`,
  // which made such a page unreachable for the upstream backend (a granted origin still needs a URL).
  const held: Array<import('node:http').ServerResponse> = [];
  const site = createServer((req, res) => {
    if (req.url === '/hang') { held.push(res); return; }
    res.setHeader('content-type', 'text/html');
    res.end('<h1>body ready</h1><img src="/hang">');
  });
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'vb-open-domready-'));
  let facade: Awaited<ReturnType<typeof createStandaloneFacade>>['facade'] | undefined;
  try {
    ({ facade } = await createStandaloneFacade({ backend: 'upstream', preferPlaywright: true, allowedOrigins: [origin], workspaceRoot }));
    const started = Date.now();
    const opened = await facade.open({ url: origin + '/', waitUntil: 'dom-ready' });
    expect(opened.ok, opened.content).toBe(true);
    // `load` cannot complete (its image never answers), so a quick success proves dom-ready applied.
    expect(Date.now() - started).toBeLessThan(8_000);
    const sessionId = (opened.data as { session: { id: string } }).session.id;
    const text = await facade.extractPageText({ sessionId, maxLength: 2_000 });
    expect(String((text.data as { text?: string } | undefined)?.text ?? text.content ?? '')).toContain('body ready');
    await facade.close(sessionId);
  } finally { if (facade) await facade.dispose(); for (const res of held) res.destroy(); site.closeAllConnections(); await new Promise<void>((done) => site.close(() => done())); }
}, 20_000);

it('keeps the transfer ceiling usable by the documented per-action deadline', async () => {
  // The per-action queue deadline is capped at 60 s (README / upstream-reuse). A transport budget
  // larger than that could never be used, and navigation would still die at its own hard-coded 30 s
  // while the host believed it had granted more.
  expect(MAX_TRANSFER_TIMEOUT_MS).toBe(60_000);
  expect(DEFAULT_NAVIGATION_DEADLINE_MS).toBe(30_000);
  expect(assertTransferTimeoutMs(60_000)).toBe(60_000);
  expect(() => assertTransferTimeoutMs(60_001)).toThrow(/E_UPSTREAM_CONFIG/);
  // Navigation follows the granted budget so a heavy document is not cut off at the 30 s default;
  // the default itself is unchanged.
  expect(navigationDeadlineMs(DEFAULT_TRANSFER_TIMEOUT_MS)).toBe(30_000);
  expect(navigationDeadlineMs(45_000)).toBe(45_000);
  expect(navigationDeadlineMs(MAX_TRANSFER_TIMEOUT_MS)).toBe(60_000);
  // Both navigation entry points must route through the helper, not a hard-coded 30 s.
  const source = await readFile(join(process.cwd(), 'src/engine/upstream-control.ts'), 'utf8');
  expect(source.split('navigationDeadlineMs(transferBudgetMs)').length - 1).toBe(2);
  expect(source).not.toMatch(/\}, ?30000\),/u);
});

it('keys the transport connection pool by the validated address, not just the host', () => {
  const base = transferPoolKey('https:', 'example.test', '443', '93.184.216.34', 4);
  expect(transferPoolKey('https:', 'example.test', '443', '93.184.216.34', 4)).toBe(base);
  // A pooled socket must never be reused for a different address/family/port/host/protocol - that is
  // the whole reason the key carries the validated address.
  expect(transferPoolKey('https:', 'example.test', '443', '93.184.216.35', 4)).not.toBe(base);
  expect(transferPoolKey('https:', 'example.test', '443', '93.184.216.34', 6)).not.toBe(base);
  expect(transferPoolKey('https:', 'example.test', '8443', '93.184.216.34', 4)).not.toBe(base);
  expect(transferPoolKey('https:', 'other.test', '443', '93.184.216.34', 4)).not.toBe(base);
  expect(transferPoolKey('http:', 'example.test', '443', '93.184.216.34', 4)).not.toBe(base);
});

it('reuses one kept-alive connection across a page and its assets', async () => {
  // Every request used `agent:false`, so a 13-request page opened 13 TCP connections and each paid a
  // fresh handshake - the reason a real 975 KB documentation page could not be read inside budget.
  let connections = 0;
  const asset = 'x'.repeat(4096);
  const site = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path.startsWith('/asset')) { res.setHeader('content-type', 'application/javascript'); res.end(asset); return; }
    res.setHeader('content-type', 'text/html');
    res.end('<h1>pooled</h1>' + Array.from({ length: 12 }, (_, i) => `<script src="/asset${i}.js"></script>`).join(''));
  });
  site.on('connection', () => { connections += 1; });
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(site.address() as { port: number }).port}`;
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'vb-keepalive-'));
  let facade: Awaited<ReturnType<typeof createStandaloneFacade>>['facade'] | undefined;
  try {
    ({ facade } = await createStandaloneFacade({ backend: 'upstream', preferPlaywright: true, allowedOrigins: [origin], workspaceRoot }));
    const opened = await facade.open({ url: origin + '/', waitUntil: 'dom-ready' });
    expect(opened.ok, opened.content).toBe(true);
    // 13 requests, but the pool caps at 8 sockets instead of one connection per request.
    expect(connections).toBeLessThanOrEqual(9);
    expect(connections).toBeGreaterThanOrEqual(1);
  } finally { if (facade) await facade.dispose(); site.closeAllConnections(); await new Promise<void>((done) => site.close(() => done())); }
}, 20_000);

it('accepts only exact origins and rejects ungranted targets before DNS',async()=>{
  for(const value of ['https://*.example.com','https://example.com/path','https://example.com?x=1','https://user:pass@example.com','file:///tmp'])expect(()=>authorizedBrowserOrigins([value])).toThrow();
  const origins=authorizedBrowserOrigins(['https://example.com']);
  await expect(resolveAuthorizedBrowserTarget('https://other.example/',origins)).rejects.toThrow('E_UPSTREAM_ORIGIN');
  expect(lookup).not.toHaveBeenCalled();
});
it('returns a validated address for pinning and rejects mixed DNS answers',async()=>{
  const origins=authorizedBrowserOrigins(['https://example.com']);
  vi.mocked(lookup).mockResolvedValue([{address:'93.184.216.34',family:4}] as never);
  expect(await resolveAuthorizedBrowserTarget('https://example.com/docs',origins)).toMatchObject({address:'93.184.216.34',family:4});
  for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','100.100.100.200','::ffff:127.0.0.1','64:ff9b::7f00:1','fc00::1','198.18.0.1']) {
    vi.mocked(lookup).mockResolvedValue([{address:'93.184.216.34',family:4},{address,family:address.includes(':')?6:4}] as never);
    await expect(resolveAuthorizedBrowserTarget('https://example.com/',origins)).rejects.toThrow('E_UPSTREAM_ADDRESS');
  }
});
it('allows only explicitly granted literal loopback and rejects private literals',async()=>{
  expect(await resolveAuthorizedBrowserTarget('http://127.0.0.1:1234/',authorizedBrowserOrigins(['http://127.0.0.1:1234']))).toMatchObject({address:'127.0.0.1',family:4});
  await expect(resolveAuthorizedBrowserTarget('http://10.0.0.1/',authorizedBrowserOrigins(['http://10.0.0.1']))).rejects.toThrow('E_UPSTREAM_ADDRESS');
  expect(()=>authorizedBrowserOrigins(['http://169.254.169.254'])).toThrow();
  expect(lookup).not.toHaveBeenCalled();
});

it.each(['sdk','mcp'])('enforces immutable host origin grants through %s',async entrance=>{
  let allowedHits=0,deniedHits=0;
  const allowed=createServer((_req,res)=>{allowedHits++;res.setHeader('content-type','text/html');res.end('<h1>Granted</h1>');});
  const denied=createServer((_req,res)=>{deniedHits++;res.end('forbidden');});
  for(const server of [allowed,denied])await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const url=(server:typeof allowed)=>`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const grants=[url(allowed)];const workspaceRoot=await mkdtemp(join(tmpdir(),'vb-host-origins-'));
  const facade=entrance==='sdk'?(await createStandaloneFacade({backend:'upstream',workspaceRoot,allowedOrigins:grants})).facade:undefined;
  if(entrance==='mcp')vi.stubEnv('VERSEBROWSER_ALLOWED_ORIGINS',JSON.stringify(grants));
  const server=entrance==='mcp'?createMcpServer({backend:'upstream',workspaceRoot,policy:resolveMcpPolicy({groups:'core',caps:'browser.open,browser.observe,browser.close',env:{}})}):undefined;
  const client=new Client({name:'origin-test',version:'1'});
  if(server){const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(a),client.connect(b)]);}
  grants[0]=url(denied);
  const open=async(target:string)=>facade?facade.open({url:target}):JSON.parse(((await client.callTool({name:'vb_open',arguments:{url:target}})).content as Array<{text:string}>)[0]!.text);
  try {
    const result=await open(url(allowed));expect(result.ok,result.content).toBe(true);
    expect((await open(url(denied))).ok).toBe(false);expect(deniedHits).toBe(0);expect(allowedHits).toBeGreaterThan(0);
    if(server){const forbidden=JSON.parse(((await client.callTool({name:'vb_open',arguments:{url:url(denied),allowedOrigins:[url(denied)]}})).content as Array<{text:string}>)[0]!.text);expect(forbidden.error.code).toBe('E_ARG_UNKNOWN');expect(deniedHits).toBe(0);}
  }finally{await facade?.dispose();await client.close();await server?.close();for(const service of [allowed,denied]){service.closeAllConnections();await new Promise<void>(done=>service.close(()=>done()));}}
});

it('rejects grants on legacy and honors an explicit empty grant',async()=>{
  await expect(createStandaloneFacade({backend:'legacy',allowedOrigins:[]})).rejects.toThrow('E_UPSTREAM_CONFIG');
  const {facade}=await createStandaloneFacade({backend:'upstream',allowedOrigins:[],workspaceRoot:await mkdtemp(join(tmpdir(),'vb-empty-origins-'))});
  try{const result=await facade.open({url:'http://127.0.0.1:9'});expect(result.ok).toBe(false);expect(result.content).toContain('initial origin is not authorized');}finally{await facade.dispose();}
});

it.each(['sdk','mcp'])('site-02 %s reports redirected resources and blocked collection honestly',async entrance=>{
  let a='',b='',c='';const hits={redirect:0,page:0,asset:0,forbidden:0};
  const services=[createServer((req,res)=>{
    if(req.url==='/asset.js'){hits.asset++;res.setHeader('content-type','text/javascript');res.end('document.querySelector("output").textContent="Resource ready"');return;}
    hits.redirect++;res.writeHead(302,{location:req.url==='/blocked'?c+'/secret':b+'/page'});res.end();
  }),createServer((req,res)=>{
    hits.page++;res.setHeader('content-type','text/html');
    res.end(req.url==='/bad'?`<output>Resource ready</output><script src="${c}/forbidden.js"></script>`:`<output>pending</output><script src="${a}/asset.js"></script>`);
  }),createServer((_req,res)=>{hits.forbidden++;res.end('must not arrive');})];
  for(const service of services)await new Promise<void>(done=>service.listen(0,'127.0.0.1',done));
  [a,b,c]=services.map(service=>`http://127.0.0.1:${(service.address() as {port:number}).port}`);
  const workspaceRoot=await mkdtemp(join(tmpdir(),'vb-site02-'));
  const facade=entrance==='sdk'?(await createStandaloneFacade({backend:'upstream',workspaceRoot,allowedOrigins:[a,b]})).facade:undefined;
  const server=entrance==='mcp'?createMcpServer({backend:'upstream',allowedOrigins:[a,b],workspaceRoot,policy:resolveMcpPolicy({groups:'core,network,evidence',caps:'browser.open,browser.observe,browser.close,network.read,evidence.write',env:{}})}):undefined;
  const client=new Client({name:'site02',version:'1'});
  if(server){const [left,right]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(left),client.connect(right)]);}
  const call=async(name:string,args:Record<string,unknown>={})=>{
    if(!facade)return JSON.parse(((await client.callTool({name,arguments:args})).content as Array<{text:string}>)[0]!.text);
    const id=String(args.sessionId??'');
    if(name==='vb_open')return facade.open({url:String(args.url)});
    if(name==='vb_page_text')return facade.extractPageText({sessionId:id});
    if(name==='vb_network_list')return facade.networkList(id);
    if(name==='vb_verify_flow')return facade.verifyFlow({sessionId:id,screenshot:false});
    return facade.close(id);
  };
  try {
    const opened=await call('vb_open',{url:a+'/redirect'});expect(opened.ok,opened.content).toBe(true);
    const id=opened.data.session.id;
    const text=await call('vb_page_text',{sessionId:id});expect(text.ok,text.content).toBe(true);expect(text.data.text).toContain('Resource ready');expect(text.data.source.url).toBe(b+'/page');
    expect(hits).toEqual({redirect:1,page:1,asset:1,forbidden:0});
    await call('vb_close',{sessionId:id});
    expect((await call('vb_open',{url:a+'/blocked'})).ok).toBe(false);expect(hits.forbidden).toBe(0);
    const bad=await call('vb_open',{url:b+'/bad'});expect(bad.ok,bad.content).toBe(true);
    const badId=bad.data.session.id;
    const network=await call('vb_network_list',{sessionId:badId});
    expect(network.data.requests.some((row:{url:string;failed?:boolean})=>row.url===c+'/forbidden.js'&&row.failed)).toBe(true);
    const health=await call('vb_verify_flow',{sessionId:badId,screenshot:false});
    expect(health.data.outcome).toBe('fail');expect(hits.forbidden).toBe(0);
    await call('vb_close',{sessionId:badId});
  }finally{await facade?.dispose();await client.close();await server?.close();for(const service of services){service.closeAllConnections();await new Promise<void>(done=>service.close(()=>done()));}}
});

it('guards every redirect hop and preserves final URL, cookies and cross-origin resources',async()=>{
  const hits={a:0,b:0,c:0,asset:0};let a='',b='',c='';let assetCookie='',destinationCookie='',postBody='',postMethod='';
  const servers=[createServer((req,res)=>{
    if(req.url==='/form'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<form method="post" action="/postredirect"><input name="field" value="café"><button>Submit</button></form>');return;}
    if(req.url==='/postredirect'){res.writeHead(307,{location:b+'/post'});res.end();return;}
    if(req.url==='/asset.js'){hits.asset++;assetCookie=req.headers.cookie??'';res.setHeader('access-control-allow-origin',b);res.setHeader('access-control-allow-credentials','true');res.setHeader('content-type','text/javascript');res.end('document.querySelector("output").textContent="Resource ready"');return;}
    hits.a++;res.writeHead(302,{location:b+(req.url==='/blocked'?'/blocked':'/page'),'set-cookie':['source=one; Path=/','second=two; Path=/']});res.end();
  }),createServer((req,res)=>{
    hits.b++;destinationCookie=req.headers.cookie??'';
    if(req.url==='/post'){postMethod=req.method??'';req.on('data',chunk=>postBody+=chunk);req.on('end',()=>res.end('saved'));return;}
    if(req.url==='/blocked'){res.writeHead(302,{location:c+'/secret'});res.end();return;}
    res.setHeader('content-type','text/html');
    res.end(`<output>pending</output><script type="module" crossorigin="use-credentials" src="${a}/asset.js"></script><img src="${c}/forbidden">`);
  }),createServer((_req,res)=>{hits.c++;res.end('must not arrive');})];
  for(const server of servers)await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  [a,b,c]=servers.map(server=>`http://127.0.0.1:${(server.address() as {port:number}).port}`);
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();
    const control=await createUpstreamPageControl(page,a,await mkdtemp(join(tmpdir(),'vb-origins-')),undefined,[a,b]);
    await control.navigate(a+'/redirect','load');
    expect(page.url()).toBe(b+'/page');expect(await page.locator('output').innerText()).toBe('Resource ready');
    expect(hits).toMatchObject({a:1,b:1,asset:1,c:0});expect(assetCookie).toContain('source=one');expect(assetCookie).toContain('second=two');
    expect(destinationCookie).toContain('source=one');expect(destinationCookie).toContain('second=two');
    await control.navigate(a+'/form','load');
    await Promise.all([page.waitForURL(b+'/post'),page.locator('button').click()]);
    expect(postMethod).toBe('POST');expect(postBody).toBe('field=caf%C3%A9');expect(hits.c).toBe(0);
    await expect(control.navigate(a+'/blocked','load')).rejects.toThrow();
    expect(hits.c).toBe(0);expect(hits.b).toBe(3);
    await control.close();
  }finally{await browser.close();for(const server of servers){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}}
});


it.each(['drain','cancel','overflow'] as const)('bounds concurrent HTTP resources and handles %s without replay',async mode=>{
  const total=mode==='overflow'?20:12;
  let hits=0,active=0,peak=0,released=false;
  const held=new Set<import('node:http').ServerResponse>();
  const service=createServer((req,res)=>{
    if(req.url?.startsWith('/work')){
      hits++;active++;peak=Math.max(peak,active);held.add(res);
      res.once('close',()=>{active--;held.delete(res);});
      if(released)res.end('ok');return;
    }
    res.setHeader('content-type','text/html');
    res.end(req.url==='/peer'?'<h1>Peer ready</h1>':`<link rel="icon" href="data:,"><output>pending</output><script>Promise.all(Array.from({length:${total}},(_,i)=>fetch('/work?id='+i).then(r=>r.text()).then(()=>true,()=>false))).then(rows=>document.querySelector('output').textContent=rows.filter(Boolean).length+'/'+rows.length)</script>`);
  });
  await new Promise<void>(done=>service.listen(0,'127.0.0.1',done));
  const origin='http://127.0.0.1:'+(service.address() as {port:number}).port;
  const browser=await chromium.launch({headless:true});
  const controls:Awaited<ReturnType<typeof createUpstreamPageControl>>[]=[];
  try{
    const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
    const control=await createUpstreamPageControl(page,origin,await mkdtemp(join(tmpdir(),'vb-http-queue-')),undefined,[origin]);controls.push(control);
    await control.navigate(origin,'load');
    await expect.poll(()=>hits).toBe(8);
    expect(peak).toBeLessThanOrEqual(8);
    if(mode==='cancel'){
      await control.close();await expect.poll(()=>active).toBe(0);
      expect(hits).toBe(8);
      const peerContext=await browser.newContext({serviceWorkers:'block'}),peer=await peerContext.newPage();
      const other=await createUpstreamPageControl(peer,origin,await mkdtemp(join(tmpdir(),'vb-http-peer-')),undefined,[origin]);controls.push(other);
      await other.navigate(origin+'/peer','load');expect(await peer.locator('h1').innerText()).toBe('Peer ready');expect(hits).toBe(8);
    }else{
      released=true;for(const res of held)res.end('ok');
      await expect.poll(()=>page.locator('output').innerText(),{timeout:3000}).toBe(mode==='drain'?'12/12':'16/20');
      expect(hits).toBe(mode==='drain'?12:16);expect(peak).toBeLessThanOrEqual(8);
    }
    console.log(JSON.stringify({mode,hits,peak,active,requested:total}));
  }finally{for(const control of controls)await control.close();await browser.close();service.closeAllConnections();await new Promise<void>(done=>service.close(()=>done()));}
},15000);
