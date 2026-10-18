/**
 * TF-0104：`vb_network_wait` 成为真能力 —— 等一个匹配请求出现，或等页面安静下来。
 *
 * 覆盖：匹配等待、无过滤的"安静"等待、**过滤超时必须显式失败**（不静默返回空），
 * 以及列表 URL 的脱敏（查询串可能带凭据）。无 Chromium 时 SKIP，不红 CI。
 */
import { describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

const PAGE = `<!doctype html><html><body><h1>fixture</h1>
<script>
  setTimeout(function () {
    fetch('/api/slow?access_token=supersecret').then(function (r) { return r.json(); })
      .then(function () { document.body.setAttribute('data-done', 'yes'); });
  }, 400);
</script>
</body></html>`;

async function startFixture(): Promise<{ base: string; server: Server }> {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/';
    if (url === '/api/slow') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, server };
}

describe('vb_network_wait (TF-0104)', () => {
  it('rejects invalid deadlines and missing collection, and bounds a hung host read',async()=>{
    const networkWaitForRequests=vi.fn().mockResolvedValue({success:true});
    const facade=new AgentBrowserFacade({api:{networkWaitForRequests} as unknown as AgentBrowserHostApi});
    for(const timeoutMs of [NaN,Infinity,0,-1,30001])expect((await facade.networkWait('s',{timeoutMs})).error?.code).toBe('E_ARG');
    expect(networkWaitForRequests).not.toHaveBeenCalled();
    const missing=await facade.networkWait('s');
    expect(missing.ok).toBe(false);expect(missing.error?.details).toMatchObject({recoveryHint:{category:'collection_failed',retryable:false}});
    networkWaitForRequests.mockImplementation(()=>new Promise(()=>{}));
    const hung=await Promise.race([facade.networkWait('s',{timeoutMs:30}),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('network wait escaped deadline')),500))]);
    expect(hung.ok).toBe(false);expect(hung.error?.details).toMatchObject({recoveryHint:{category:'timeout',retryable:false}});
    expect(networkWaitForRequests).toHaveBeenCalledTimes(2);
  });
  it.each([false,true])('requires transfer completion and rejects interrupted responses (upstream=%s)',async(upstream)=>{
    let held: import('node:http').ServerResponse | undefined;
    const server=createServer((req,res)=>{
      if(req.url?.startsWith('/stream')) {held=res;res.writeHead(200,{'content-type':'application/octet-stream'});res.write('part');return;}
      res.end('<button>Ready</button>');
    });
    await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
    const api=await createPlaywrightHostApi({upstream});const facade=new AgentBrowserFacade({api});
    const opened=await api.open({url:`http://127.0.0.1:${(server.address() as {port:number}).port}`});const sessionId=opened.session.id;
    try {
      for(const interrupted of [false,true]) {
        held=undefined;
        const sinceCursor=((await facade.networkList(sessionId)).data as {cursor:string}).cursor;
        await api.evaluate({sessionId,expression:'void fetch("/stream").then(r=>r.arrayBuffer()).catch(()=>{})'});
        await expect.poll(()=>Boolean(held)).toBe(true);
        // The restricted upstream route buffers the transfer before fulfill;
        // only the direct driver exposes headers while the server holds the body.
        if(!upstream) {
          const headers=await facade.networkWait(sessionId,{sinceCursor,filter:{urlIncludes:'/stream'},timeoutMs:1000});
          expect(headers.ok,headers.content).toBe(true);
        }
        expect((await facade.networkWait(sessionId,{sinceCursor,filter:{urlIncludes:'/stream'},responseComplete:true,timeoutMs:50})).ok).toBe(false);
        if(interrupted)held!.destroy();else held!.end('done');
        const finished=await facade.networkWait(sessionId,{sinceCursor,filter:{urlIncludes:'/stream'},responseComplete:true,timeoutMs:500});
        expect(finished.ok,finished.content).toBe(!interrupted);
      }
    }finally{await facade.close(sessionId);await facade.dispose();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
  });
  it('does not claim completion when an older host only reports headers',async()=>{
    const facade=new AgentBrowserFacade({api:{networkWaitForRequests:async()=>({success:true,requests:[{id:'n',url:'https://example.test',method:'GET',status:200}]})} as unknown as AgentBrowserHostApi});
    expect((await facade.networkWait('s',{responseComplete:true,filter:{status:200}})).error?.code).toBe('E_NOT_IMPLEMENTED');
    expect((await facade.networkWait('s',{responseComplete:true})).error?.code).toBe('E_ARG');
  });
  it('uses an explicit observation cursor without accepting old or unrelated responses', async () => {
    const api = await createPlaywrightHostApi();
    const fixture = await startFixture();
    const facade = new AgentBrowserFacade({ api });
    const opened = await api.open({ mode: 'headless', url: fixture.base });
    const sessionId = opened.session.id;
    try {
      const before = await facade.networkList(sessionId);
      const cursor = (before.data as { cursor: string }).cursor;
      expect(cursor).toBeTruthy();
      await api.evaluate({ sessionId, expression: 'fetch("/api/fast").then(r => r.text()).then(() => true)' });
      const matched = await facade.networkWait(sessionId, { sinceCursor: cursor, filter: { urlIncludes: '/api/fast', status: 200 }, timeoutMs: 30 });
      expect(matched.ok).toBe(true);
      const after = (await facade.networkList(sessionId)).data as { cursor: string };
      await api.evaluate({ sessionId, expression: 'fetch("/unrelated").then(r => r.text()).then(() => true)' });
      const old = await facade.networkWait(sessionId, { sinceCursor: after.cursor, filter: { urlIncludes: '/api/fast' }, timeoutMs: 30 });
      expect(old.ok).toBe(false);
      const invalid = await facade.networkWait(sessionId, { sinceCursor: 'foreign:0', filter: { urlIncludes: '/api/fast' }, timeoutMs: 30 });
      expect(invalid.ok).toBe(false);
      expect(invalid.content).toContain('cursor unavailable');
    } finally {
      await facade.close(sessionId);
      await new Promise<void>(done => fixture.server.close(() => done()));
    }
  });

  it('does not accept a host returning the wrong unredacted method or status', async () => {
    const facade = new AgentBrowserFacade({ api: { networkWaitForRequests: async () => ({ success: true, requests: [{ id: 'x', url: 'https://example.test/wrong', method: 'GET', status: 200 }] }) } as unknown as AgentBrowserHostApi });
    expect((await facade.networkWait('s', { filter: { method: 'POST', status: 201 } })).ok).toBe(false);
  });

  it('live：等到匹配请求；无过滤时等安静；过滤超时显式失败；列表 URL 脱敏', async () => {
    let api: AgentBrowserHostApi;
    try {
      api = await createPlaywrightHostApi();
    } catch {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const fixture = await startFixture();
    const root = await mkdtemp(join(tmpdir(), 'vb-netwait-'));
    const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
    const opened = await facade.open({ url: `${fixture.base}/`, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;

    try {
      const matched = await facade.networkWait(sessionId, {
        filter: { urlIncludes: '/api/slow?access_token=supersecret' },
        timeoutMs: 4_000,
      });
      expect(matched.ok).toBe(true);
      expect(String(matched.content)).toContain('request matching');
      const rows = (matched.data as { requests?: Array<{ url: string; status?: number }> }).requests ?? [];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe(200);
      // TF-0104: list/wait rows are redacted — the token must not survive.
      expect(rows[0]?.url).not.toContain('supersecret');

      const idle = await facade.networkWait(sessionId, { timeoutMs: 2_000 });
      expect(idle.ok).toBe(true);
      expect(String(idle.content)).toContain('network idle');

      const timeout = await facade.networkWait(sessionId, {
        filter: { urlIncludes: '/api/never' },
        timeoutMs: 400,
      });
      expect(timeout.ok).toBe(false);
      expect(timeout.error?.code).toBe('E_NETWORK_WAIT');
      expect(String(timeout.error?.message)).toContain('no request matching');
      expect(String(timeout.error?.message)).toContain('400ms');

      const listed = await facade.networkList(sessionId);
      const listRows = (listed.data as { requests?: Array<{ url: string }> }).requests ?? [];
      const slow = listRows.find((row) => row.url.includes('/api/slow'));
      expect(slow).toBeTruthy();
      expect(slow?.url).not.toContain('supersecret');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
      await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    }
  }, 90_000);
});
