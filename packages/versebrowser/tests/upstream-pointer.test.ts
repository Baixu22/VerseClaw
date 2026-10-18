import { it, expect, vi } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { chromium as legacyChromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import { profileFromHostApi } from '../src/engine/driver-profile.ts';
import { exposureReason } from '../src/mcp/tool-availability.ts';
import type { AgentBrowserHostApi, AgentBrowserPointerPayload } from '../src/types/host-api.ts';

it.each(['sdk', 'stdio', 'legacy'] as const)('performs pointer tasks through %s with native events and fresh references', async mode => {
  const receipts: string[] = [];
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/receipt?')) { receipts.push(new URL(req.url, 'http://localhost').searchParams.get('event')!); res.end('ok'); return; }
    res.setHeader('content-type', 'text/html');
    res.end(`<style>body{height:2800px;margin:25px}#list{height:100px;width:200px;overflow:auto;border:1px solid}#list button{display:block;height:30px}#menu{display:none}#bottom{position:absolute;top:2400px}</style>
      <button id="trigger" onmouseover="document.querySelector('#menu').style.display='block'">Menu</button><span id="menu">Menu opened</span>
      <button id="double" ondblclick="report('double')">Double</button><button id="right" oncontextmenu="event.preventDefault();report('right')">Right</button>
      <div id="list" onscroll="document.querySelector('#scroll-state').textContent='container '+this.scrollTop">${Array.from({ length: 30 }, (_, i) => `<button onclick="report('item-${i}')">Item ${i}</button>`).join('')}</div>
      <div id="virtual" style="height:100px;width:200px;overflow:auto" onscroll="renderVirtual(this.scrollTop)"><div style="height:2400px;position:relative"><button id="virtual-row" style="position:absolute;top:0">Virtual 0</button></div></div>
      <output id="scroll-state">container 0</output><output id="page-state">page 0</output><output id="result">pending</output><button id="bottom" onclick="report('bottom')">Bottom</button>
      <button class="same" onclick="report('wrong')">Same</button><button class="same" onclick="report('wrong')">Same</button>
      <button id="disabled" disabled ondblclick="report('wrong')">Disabled</button><div style="position:relative;width:100px;height:40px"><button id="covered" ondblclick="report('wrong')">Covered</button><div style="position:absolute;inset:0;background:white"></div></div>
      <script>window.onscroll=()=>document.querySelector('#page-state').textContent='page '+scrollY;function report(value){fetch('/receipt?event='+value).then(()=>document.querySelector('#result').textContent=value)}function renderVirtual(y){const i=Math.floor(y/30),next=document.createElement('button');next.id='virtual-row';next.style='position:absolute;top:'+i*30+'px';next.textContent='Virtual '+i;next.onclick=()=>report('virtual-'+i);document.querySelector('#virtual-row').replaceWith(next)}</script>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const root = await mkdtemp(join(tmpdir(), 'vb-pointer-'));
  const browsers: Browser[] = [];
  const launch = chromium.launch.bind(chromium);
  const spy = mode === 'sdk' ? vi.spyOn(chromium, 'launch').mockImplementation(async options => {
    const browser = await launch(options); browsers.push(browser); return browser;
  }) : undefined;
  const legacyBrowsers: import('playwright-core').Browser[] = [];
  const legacyLaunch = legacyChromium.launch.bind(legacyChromium);
  const legacySpy = mode === 'legacy' ? vi.spyOn(legacyChromium, 'launch').mockImplementation(async options => {
    const browser = await legacyLaunch(options); legacyBrowsers.push(browser); return browser;
  }) : undefined;
  const facade = mode === 'stdio' ? undefined : (await createStandaloneFacade({ backend: mode === 'sdk' ? 'upstream' : 'legacy', preferPlaywright: true, workspaceRoot: root })).facade;
  const client = new Client({ name: 'pointer-test', version: '1' });
  if (!facade) { const transport = new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', resolve('src/mcp/server.ts')], cwd: root,
    env: { ...process.env, VERSEBROWSER_BACKEND: 'upstream', VERSEBROWSER_TOOL_GROUPS: 'core', VERSEBROWSER_CAPS: 'browser.open,browser.act,browser.observe,browser.close' } as Record<string, string>, stderr: 'pipe' }); transport.stderr?.on('data', () => {}); await client.connect(transport); }
  const call = async (name: string, args: Record<string, unknown>) => {
    if (facade) {
      const id = String(args.sessionId ?? '');
      if (name === 'vb_open') return facade.open({ url });
      if (name === 'vb_pointer') return facade.pointer(args as AgentBrowserPointerPayload);
      if (name === 'vb_snapshot') return facade.snapshot(id);
      if (name === 'vb_page_text') return facade.extractPageText({ sessionId: id, selector: args.selector as string });
      if (name === 'vb_wait') return facade.wait({ sessionId: id, selector: args.selector as string, text: args.text as string, timeoutMs: 3000 });
      if (name === 'vb_click') return facade.click(id, String(args.selector));
      if (name === 'vb_close') return facade.close(id);
      throw new Error(name);
    }
    const response = await client.callTool({ name, arguments: args });
    return JSON.parse((response.content as { text: string }[])[0].text);
  };
  let id: string | undefined;
  try {
    if (!facade) expect((await client.listTools()).tools.map(t => t.name)).toContain('vb_pointer');
    const opened = await call('vb_open', { url }); expect(opened.ok, opened.content).toBe(true); id = opened.data.session.id;
    const pointer = (action: string, extra: Record<string, unknown> = {}) => call('vb_pointer', { sessionId: id, action, ...extra });
    expect((await pointer('scroll', { deltaY: Infinity })).ok).toBe(false);
    expect((await pointer('hover')).ok).toBe(false);
    expect((await pointer('unknown', { selector: '#trigger' })).ok).toBe(false);
    expect((await pointer('hover', { selector: '#trigger' })).ok).toBe(true);
    expect((await call('vb_wait', { sessionId: id, selector: '#menu' })).ok).toBe(true);
    expect((await pointer('double-click', { selector: '#double' })).ok).toBe(true);
    await expect.poll(() => receipts).toEqual(['double']);
    const rightClick = await pointer('right-click', { selector: '#right' });
    expect(rightClick.ok, JSON.stringify(rightClick)).toBe(true);
    expect(rightClick.data).toMatchObject({observation:{businessOutcome:'unknown',scope:'session-window'}});
    expect(rightClick.data.observation.sinceCursor).toBeTruthy();
    await expect.poll(() => receipts).toEqual(['double', 'right']);
    const snapshot = await call('vb_snapshot', { sessionId: id });
    const ref = /\[([^\]]+)\] button \| "Menu"/.exec(snapshot.content)?.[1]; expect(ref).toBeTruthy();
    expect((await pointer('scroll', { selector: '#list', deltaY: 500 })).ok).toBe(true);
    if (mode !== 'legacy') expect((await pointer('hover', { selector: `[data-vb-ref="${ref}"]` })).ok).toBe(false);
    try { await expect.poll(async () => (await call('vb_page_text', { sessionId: id, selector: '#scroll-state' })).content).toMatch(/container [1-9]\d*/); }
    catch (error) {
      const page = (browsers[0] ?? legacyBrowsers[0])?.contexts()[0]?.pages()[0];
      const diagnostic = page ? await page.evaluate(() => {
        const el = document.querySelector('#list')!;
        const box = el.getBoundingClientRect();
        return { hover: el.matches(':hover'), box: box.toJSON(), scrollTop: el.scrollTop,
          center: document.elementFromPoint(box.x + box.width/2, box.y + box.height/2)?.outerHTML,
          hovered: Array.from(document.querySelectorAll(':hover')).map(node => node.id || node.tagName), visibility: document.visibilityState };
      }) : null;
      throw new Error(`${String(error)}; page position: ${(await call('vb_page_text', { sessionId: id, selector: '#page-state' })).content}; failure-only geometry: ${JSON.stringify(diagnostic)}`, { cause: error });
    }
    expect((await call('vb_snapshot', { sessionId: id })).ok).toBe(true);
    expect((await pointer('scroll-into-view', { selector: '#list button:last-child' })).ok).toBe(true);
    expect((await call('vb_click', { sessionId: id, selector: '#list button:last-child' })).ok).toBe(true);
    await expect.poll(() => receipts).toEqual(['double', 'right', 'item-29']);
    expect((await pointer('scroll', { selector: '#virtual', deltaY: 600 })).ok).toBe(true);
    await expect.poll(async () => (await call('vb_page_text', { sessionId: id, selector: '#virtual-row' })).content).toContain('Virtual 20');
    const virtualSnapshot = await call('vb_snapshot', { sessionId: id });
    const virtualRef = /\[([^\]]+)\] button \| "Virtual 20"/.exec(virtualSnapshot.content)?.[1]; expect(virtualRef).toBeTruthy();
    expect((await call('vb_click', { sessionId: id, selector: `[data-vb-ref="${virtualRef}"]` })).ok).toBe(true);
    await expect.poll(() => receipts).toEqual(['double', 'right', 'item-29', 'virtual-20']);
    expect((await pointer('scroll', { deltaY: 1800 })).ok).toBe(true);
    await expect.poll(async () => (await call('vb_page_text', { sessionId: id, selector: '#page-state' })).content).toMatch(/page [1-9]\d*/);
    expect((await pointer('scroll-into-view', { selector: '#bottom' })).ok).toBe(true);
    expect((await call('vb_click', { sessionId: id, selector: '#bottom' })).ok).toBe(true);
    await expect.poll(() => receipts).toEqual(['double', 'right', 'item-29', 'virtual-20', 'bottom']);
    expect((await pointer('double-click', { selector: '.same', timeoutMs: 500 })).ok).toBe(false);
    expect(receipts).not.toContain('wrong');
    for (const selector of ['#disabled', '#covered']) {
      await call('vb_close', { sessionId: id });
      const fresh = await call('vb_open', { url }); expect(fresh.ok, fresh.content).toBe(true); id = fresh.data.session.id;
      expect((await pointer('double-click', { selector, timeoutMs: 500 })).ok).toBe(false);
      expect(receipts).not.toContain('wrong');
    }
  } finally { spy?.mockRestore(); legacySpy?.mockRestore(); if (id) await call('vb_close', { sessionId: id }); await facade?.dispose(); await client.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}, 40_000);

it('does not advertise pointer operations for an old host without the optional method', () => {
  expect(exposureReason('vb_pointer', profileFromHostApi({ click: () => ({ success: true }) } as unknown as AgentBrowserHostApi))).toBeTruthy();
});
