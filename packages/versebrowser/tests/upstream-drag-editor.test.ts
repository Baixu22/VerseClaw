import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createMcpServer } from '../src/mcp/server.ts';
import { resolveMcpPolicy } from '../src/mcp/capability-policy.ts';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import { profileFromHostApi } from '../src/engine/driver-profile.ts';
import { exposureReason } from '../src/mcp/tool-availability.ts';
import type { AgentBrowserHostApi, AgentBrowserDragPayload } from '../src/types/host-api.ts';
import { chromium } from 'playwright';
import { dragWithNativeStart } from '../src/engine/interactive-snapshot.ts';

it('starts the requested drag before a small nested container scrolls the target', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div style="height:100px;width:250px;overflow:auto"><div style="height:600px"></div>${['a','b'].map(id => `<div id="${id}" draggable="true" style="height:70px;border:1px solid" ondragstart="window.events.push('start-${id}');event.dataTransfer.setData('text/plain','${id}')" ondragover="event.preventDefault()" ondrop="event.preventDefault();window.events.push('drop-'+event.dataTransfer.getData('text/plain')+'-${id}')">${id}</div>`).join('')}</div><script>window.events=[]</script>`);
    await page.locator('#b').scrollIntoViewIfNeeded();
    const deadline = Date.now() + 5000;
    await dragWithNativeStart(page, page.locator('#b'), page.locator('#a'), () => Math.max(1, deadline - Date.now()));
    expect(await page.evaluate('window.events')).toEqual(['start-b', 'drop-b-a']);
  } finally { await browser.close(); }
});

it.each(['sdk', 'stdio', 'legacy'] as const)('persists native drag order, ownership and contenteditable changes through %s', async mode => {
  const groups = { left: ['a', 'b'], right: ['c'] };
  let saved = 'Initial', writes = 0;
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const server = createServer((req, res) => {
    const requested = new URL(req.url!, 'http://localhost');
    if (requested.pathname === '/move') {
      const source = requested.searchParams.get('source')!, target = requested.searchParams.get('target')!;
      const destination = target === 'left' || target === 'right' ? target : groups.left.includes(target) ? 'left' : 'right';
      groups.left = groups.left.filter(id => id !== source); groups.right = groups.right.filter(id => id !== source);
      const index = groups[destination].indexOf(target);
      groups[destination].splice(index < 0 ? groups[destination].length : index, 0, source);
      writes++; res.end('moved'); return;
    }
    if (requested.pathname === '/save') {
      let text = ''; req.setEncoding('utf8'); req.on('data', part => { text += part; });
      req.on('end', () => { saved = text; writes++; res.end('saved'); }); return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<style>section{display:inline-block;vertical-align:top;width:240px;min-height:180px;border:1px solid;margin:20px}.item{padding:20px;margin:10px;border:1px solid}#editor{border:1px solid;min-height:40px}</style>
      ${Object.entries(groups).map(([group, ids]) => `<section id="${group}" ondragover="event.preventDefault()" ondrop="drop(event,'${group}')">${ids.map(id => `<div class="item" role="button" tabindex="0" id="${id}" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','${id}')" ondragover="event.preventDefault()" ondrop="drop(event,'${id}')">${id.toUpperCase()}</div>`).join('')}</section>`).join('')}
      <div id="editor" role="textbox" aria-label="Editor" contenteditable="true">${escape(saved)}</div>
      <button id="save" onclick="fetch('/save',{method:'POST',body:document.querySelector('#editor').textContent}).then(()=>document.querySelector('#status').textContent='saved')">Save</button><output id="status">pending</output>
      <script>function drop(event,target){event.preventDefault();event.stopPropagation();fetch('/move?source='+event.dataTransfer.getData('text/plain')+'&target='+target).then(()=>document.querySelector('#status').textContent='moved')}</script>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const root = await mkdtemp(join(tmpdir(), 'vb-drag-editor-'));
  const facade = mode === 'stdio' ? undefined : (await createStandaloneFacade({ backend: mode === 'sdk' ? 'upstream' : 'legacy', preferPlaywright: true, workspaceRoot: root })).facade;
  const client = new Client({ name: 'drag-editor-test', version: '1' });
  if (!facade) { const transport = new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', resolve('src/mcp/server.ts')], cwd: root,
    env: { ...process.env, VERSEBROWSER_BACKEND: 'upstream', VERSEBROWSER_TOOL_GROUPS: 'core', VERSEBROWSER_CAPS: 'browser.open,browser.navigate,browser.act,browser.observe,browser.close' } as Record<string, string>, stderr: 'pipe' }); transport.stderr?.on('data', () => {}); await client.connect(transport); }
  const call = async (name: string, args: Record<string, unknown>) => {
    if (facade) {
      const id = String(args.sessionId ?? '');
      if (name === 'vb_open') return facade.open({ url });
      if (name === 'vb_nav') return facade.nav(id, url);
      if (name === 'vb_drag') return facade.drag(args as AgentBrowserDragPayload);
      if (name === 'vb_snapshot') return facade.snapshot(id);
      if (name === 'vb_page_text') return facade.extractPageText({ sessionId: id, selector: args.selector as string });
      if (name === 'vb_type') return facade.type(id, String(args.selector), String(args.text), { clear: true });
      if (name === 'vb_press') return facade.pressKey(id, String(args.key), args.selector as string);
      if (name === 'vb_click') return facade.click(id, String(args.selector));
      if (name === 'vb_close') return facade.close(id);
      throw new Error(name);
    }
    const response = await client.callTool({ name, arguments: args });
    return JSON.parse((response.content as { text: string }[])[0].text);
  };
  let id: string | undefined;
  try {
    if (!facade) expect((await client.listTools()).tools.map(t => t.name)).toContain('vb_drag');
    const opened = await call('vb_open', { url }); expect(opened.ok, opened.content).toBe(true); id = opened.data.session.id;
    const drag = (sourceSelector: string, targetSelector: string, timeoutMs = 5000) => call('vb_drag', { sessionId: id, sourceSelector, targetSelector, timeoutMs });
    const snapshot = await call('vb_snapshot', { sessionId: id });
    const ref = (name: string) => `[data-vb-ref="${new RegExp('\\[([^\\]]+)\\] button \\| "' + name + '"').exec(snapshot.content)?.[1]}"]`;
    const aRef = ref('A'), bRef = ref('B');
    const reordered = await drag(bRef, aRef); expect(reordered.ok, reordered.content).toBe(true);
    expect(reordered.data.observation).toMatchObject({businessOutcome:'unknown',scope:'session-window'});
    expect(reordered.data.observation.sinceCursor).toBeTruthy();
    await expect.poll(() => groups.left).toEqual(['b', 'a']);
    expect((await call('vb_nav', { sessionId: id, url })).ok).toBe(true);
    if (mode !== 'legacy') expect((await drag(aRef, '#right')).ok).toBe(false);
    const moved = await drag('#a', '#right'); expect(moved.ok, moved.content).toBe(true);
    await expect.poll(() => groups).toEqual({ left: ['b'], right: ['c', 'a'] });
    expect((await call('vb_nav', { sessionId: id, url })).ok).toBe(true);
    expect((await call('vb_page_text', { sessionId: id, selector: '#right' })).content).toContain('A');
    expect((await call('vb_type', { sessionId: id, selector: '#editor', text: 'Draft 汉字' })).ok).toBe(true);
    expect((await call('vb_press', { sessionId: id, selector: '#editor', key: 'Control+A' })).ok).toBe(true);
    expect((await call('vb_press', { sessionId: id, selector: '#editor', key: 'Backspace' })).ok).toBe(true);
    expect((await call('vb_click', { sessionId: id, selector: '#save' })).ok).toBe(true);
    await expect.poll(() => saved).toBe('');
    expect((await call('vb_nav', { sessionId: id, url })).ok).toBe(true);
    expect((await call('vb_type', { sessionId: id, selector: '#editor', text: 'Persisted 汉字 <value>' })).ok).toBe(true);
    expect((await call('vb_click', { sessionId: id, selector: '#save' })).ok).toBe(true);
    await expect.poll(() => saved).toBe('Persisted 汉字 <value>');
    expect((await call('vb_nav', { sessionId: id, url })).ok).toBe(true);
    expect((await call('vb_page_text', { sessionId: id, selector: '#editor' })).content).toContain('Persisted 汉字 <value>');
    const count = writes;
    expect((await drag('.item', '#right', 500)).ok).toBe(false);
    expect(writes).toBe(count);
  } finally { if (id) await call('vb_close', { sessionId: id }); await facade?.dispose(); await client.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
}, 40_000);

it('keeps drag hidden for old injected facades that only implement pointer actions', async () => {
  class OldHost {
    pointer() { return { success: true }; }
    get drag() { throw new Error('capability discovery must not invoke accessors'); }
  }
  const api = new OldHost() as unknown as AgentBrowserHostApi;
  expect(exposureReason('vb_drag', profileFromHostApi(api))).toBeTruthy();
  const facade = new AgentBrowserFacade({ api });
  const server = createMcpServer({ facade, policy: resolveMcpPolicy({ groups: 'core', caps: 'browser.act', env: {} }) });
  const client = new Client({ name: 'old-host-test', version: '1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(s); await client.connect(c);
    const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toContain('vb_pointer');
    expect(names).not.toContain('vb_drag');
  } finally { await client.close(); await server.close(); await facade.dispose(); }
});
