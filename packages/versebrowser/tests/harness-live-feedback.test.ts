import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';

it('fresh stdio MCP crosses form navigation and exports a consistent failed receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vb-live-feedback-'));
  const http = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url?.startsWith('/received')) {
      setTimeout(() => res.end('<title>Receipt</title><body><p id="receipt">Received!</p></body>'), 100);
    } else {
      res.end('<title>Form</title><body><form action="/received"><input id="query" name="q"><button>Submit</button></form></body>');
    }
  });
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  const port = (http.address() as { port: number }).port;
  const client = new Client({ name: 'vb-live-feedback', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-strip-types', resolve('src/mcp/server.ts')],
    cwd: root,
    env: { ...process.env, VERSEBROWSER_WORKSPACE: root, VERSEBROWSER_NO_DRIVER: '0',
      VERSEBROWSER_TOOL_GROUPS: 'core,debug,network,evidence',
      VERSEBROWSER_CAPS: 'browser.open,browser.navigate,browser.act,browser.observe,browser.close,debug.console,debug.explain,network.read,evidence.write,evidence.read' },
    stderr: 'pipe',
  });
  let sessionId: string | undefined;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: { ...(sessionId ? { sessionId } : {}), ...args } });
    return JSON.parse((response.content as Array<{ text: string }>)[0]!.text);
  };
  try {
    await client.connect(transport);
    const opened = await call('vb_open', { mode: 'headless', url: `http://127.0.0.1:${port}/` });
    expect(opened.ok).toBe(true);
    sessionId = opened.data.session.id;
    await call('vb_record_start');
    const beforeNavigation = await call('vb_network_list');
    expect(beforeNavigation.data.cursor).toEqual(expect.any(String));
    for (let i = 0; i < 3; i += 1) {
      if (i > 0) expect((await call('vb_nav', { url: `http://127.0.0.1:${port}/` })).ok).toBe(true);
      expect((await call('vb_type', { selector: '#query', text: `trial-${i}` })).ok).toBe(true);
      expect((await call('vb_press', { selector: '#query', key: 'Enter' })).ok).toBe(true);
      expect((await call('vb_wait', { text: 'Received!', timeoutMs: 3000 })).ok).toBe(true);
      const snapshot = await call('vb_snapshot', { includeText: true, textChars: 500 });
      expect(snapshot.ok).toBe(true);
      expect(snapshot.content).toContain('Received!');
    }
    const observed = await call('vb_network_wait', { sinceCursor: beforeNavigation.data.cursor, urlIncludes: '/received', status: 200, timeoutMs: 20 });
    expect(observed.ok).toBe(true);
    expect(observed.data.requests.length).toBeGreaterThan(0);
    const result = await call('vb_verify_flow', {
      screenshot: false, expect: [{ type: 'text', selector: '#receipt', equals: 'Wrong!', label: 'receipt' }],
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ outcome: 'fail', failedCheckCount: 1 });
    const dir = dirname(resolve(root, result.evidence.find((e: { kind: string }) => e.kind === 'verify').path));
    expect(await readFile(join(dir, 'diagnosis.md'), 'utf8')).toContain('expect receipt');
    expect(await readFile(join(dir, 'pr-comment.md'), 'utf8')).not.toContain('No failure points');
    const replay = await call('vb_diagnose', { dir });
    expect(replay.content).toContain('expect receipt');
  } finally {
    if (sessionId) await call('vb_close').catch(() => undefined);
    await client.close();
    await new Promise<void>((done) => http.close(() => done()));
  }
}, 30_000);

it('live text reads recover a replacing body and report a body that never arrives', async () => {
  const api = await createPlaywrightHostApi();
  const root = await mkdtemp(join(tmpdir(), 'vb-live-body-'));
  const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
  const opened = await api.open({ mode: 'headless', url: 'data:text/html,<body>Before</body>' });
  const sessionId = opened.session.id;
  try {
    await api.evaluate({ sessionId, expression: `(() => {
      document.body.remove();
      setTimeout(() => { const body = document.createElement('body'); body.textContent = 'Body ready'; document.documentElement.append(body); }, 120);
    })()` });
    const ready = await facade.extractPageText({ sessionId });
    expect(ready.ok).toBe(true);
    expect(ready.content).toContain('Body ready');
    await api.evaluate({ sessionId, expression: 'document.body.remove()' });
    const missing = await facade.extractPageText({ sessionId });
    expect(missing.ok).toBe(false);
    expect(missing.error?.message).toContain('E_PAGE_NOT_READY');
  } finally {
    await facade.close(sessionId);
  }
}, 15_000);
