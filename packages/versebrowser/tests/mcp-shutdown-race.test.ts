import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createMcpServer, type McpServerDeps } from '../src/mcp/server.ts';
import { resolveMcpPolicy } from '../src/mcp/capability-policy.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isProcessAlive } from '../src/engine/persistent-sessions.ts';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const tick = () => new Promise<void>(done => setImmediate(done));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function connect(options: McpServerDeps) {
  const client = new Client({ name: 'shutdown-test', version: '1' });
  const server = createMcpServer({ policy: resolveMcpPolicy({ groups: 'core', caps: 'browser.open', env: {} }), ...options });
  const [c, s] = InMemoryTransport.createLinkedPair(); await server.connect(s); await client.connect(c);
  return { client, server };
}

it('does not execute a tool after its transport closes during audit', async () => {
  const entered = deferred(), release = deferred();
  const open = vi.fn(async () => ({ success: true, session: { id: 'late' } }));
  const facade = new AgentBrowserFacade({ api: { open, close: async () => ({ success: true }) } as unknown as AgentBrowserHostApi });
  const { client, server } = await connect({ facade, permissionRecorder: async event => { entered.resolve(); await release.promise; return event; } });
  const pending = client.callTool({ name: 'vb_open', arguments: {} }).catch(() => undefined);
  try {
    await entered.promise; await client.close(); await server.close(); release.resolve();
    await pending; await tick();
    expect(open).not.toHaveBeenCalled();
  } finally { release.resolve(); await facade.dispose(); await client.close(); await server.close(); }
});

it('disposes an auto-created facade that finishes initialization after close', async () => {
  const entered = deferred(), release = deferred();
  const open = vi.fn(async () => ({ success: true, session: { id: 'late' } }));
  const facade = new AgentBrowserFacade({ api: { open, close: async () => ({ success: true }) } as unknown as AgentBrowserHostApi });
  const dispose = vi.spyOn(facade, 'dispose');
  vi.doMock('../src/engine/standalone.ts', () => ({ createStandaloneFacade: async () => { entered.resolve(); await release.promise; return { facade, driver: 'playwright' }; } }));
  const { client, server } = await connect({});
  const pending = client.callTool({ name: 'vb_open', arguments: {} }).catch(() => undefined);
  try {
    await entered.promise; await client.close(); await server.close(); release.resolve();
    await pending; await tick();
    expect(open).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
  } finally { release.resolve(); await facade.dispose(); await client.close(); await server.close(); vi.doUnmock('../src/engine/standalone.ts'); }
});

it('retains a redacted recovery receipt when owned MCP cleanup fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vb-mcp-recovery-'));
  const close = vi.fn().mockResolvedValueOnce({ success: false, error: 'token=RECOVERY_SECRET' }).mockResolvedValue({ success: true });
  const facade = new AgentBrowserFacade({ workspaceRoot: root, api: {
    open: async () => ({ success: true, session: { id: 'owned-recovery' } }), close,
  } as unknown as AgentBrowserHostApi });
  vi.doMock('../src/engine/standalone.ts', () => ({ createStandaloneFacade: async () => ({ facade, driver: 'playwright' }) }));
  const { client, server } = await connect({ workspaceRoot: root });
  try {
    await client.callTool({ name: 'vb_open', arguments: {} });
    await client.close(); await server.close();
    const evidence = join(root, '.ae', 'evidence');
    await expect.poll(async () => (await readdir(evidence).catch(() => [])).filter(name => name.startsWith('mcp-cleanup-')).length).toBe(1);
    const name = (await readdir(evidence)).find(name => name.startsWith('mcp-cleanup-'))!;
    const text = await readFile(join(evidence, name), 'utf8');
    expect(text).not.toContain('RECOVERY_SECRET');
    const receipt = JSON.parse(text);
    expect(receipt).toMatchObject({ schemaVersion: 1, kind: 'mcp-cleanup', outcome: 'unconfirmed', processId: process.pid,
      details: { failures: [{ sessionId: 'owned-recovery' }] } });
    expect(receipt.serverInstanceId).toBeTruthy();
    expect((await facade.dispose()).ok).toBe(true);
    expect(close).toHaveBeenCalledTimes(2);
  } finally { await facade.dispose(); await client.close(); await server.close(); vi.doUnmock('../src/engine/standalone.ts'); }
});

it.each([false, true])('closes the stdio worker on EOF with an open request pending=%s', async pendingOpen => {
  const entered = deferred(), disconnected = deferred();
  const http = createServer((req, res) => {
    if (req.url === '/held') { res.on('close', disconnected.resolve); entered.resolve(); return; }
    res.setHeader('content-type', 'text/html');
    res.end('<button>Ready</button><script>fetch("/held")</script>');
  });
  await new Promise<void>(done => http.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const child = spawn(process.execPath, ['--experimental-strip-types', resolve('src/mcp/server.ts')], {
    cwd: await mkdtemp(join(tmpdir(), 'vb-worker-eof-')), windowsHide: true,
    env: { ...process.env, VERSEBROWSER_BACKEND: 'upstream', VERSEBROWSER_TOOL_GROUPS: 'core', VERSEBROWSER_CAPS: 'browser.open,browser.close,browser.observe' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise<number | null>(done => child.once('exit', done));
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  type TestResponse = { result: { content: Array<{ text: string }> } };
  const responses = new Map<number, (value: TestResponse) => void>();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { const message = JSON.parse(line); responses.get(message.id)?.(message); });
  const request = (id: number, method: string, params: object) => new Promise<TestResponse>(done => {
    responses.set(id, done); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    await request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'eof-test', version: '1' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const opened = request(2, 'tools/call', { name: 'vb_open', arguments: { url: url + (pendingOpen ? '/held' : '') } });
    const checkOpened = opened.then(message => {
      const result = JSON.parse(message.result.content[0].text);
      expect(result.ok, result.content).toBe(true);
    });
    if (!pendingOpen) await checkOpened;
    // A launch failure must report its cause instead of waiting for an HTTP
    // request that the browser will never make.
    await Promise.race([entered.promise, checkOpened.then(() => entered.promise)]);
    child.stdin.end();
    const timeout = Symbol('timeout');
    let timer: ReturnType<typeof setTimeout>;
    const result = await Promise.race([exited, new Promise<symbol>(done => { timer = setTimeout(() => done(timeout), 3000); })]);
    clearTimeout(timer!);
    expect(result, stderr || 'worker did not exit after its input closed').toBe(0);
    await disconnected.promise;
  } finally {
    child.kill(); await exited; lines.close(); http.closeAllConnections();
    await new Promise<void>(done => http.close(() => done()));
  }
}, 20_000);

it.skipIf(process.platform !== 'win32')('releases a killed worker browser tree and restarts without replay or harming another worker', async () => {
  const entered = deferred();
  let writes = 0;
  const http = createServer((req, res) => {
    if (req.url === '/held') { entered.resolve(); return; }
    if (req.url === '/write') { writes++; res.end('saved'); return; }
    res.setHeader('content-type', 'text/html');
    res.end('<button onclick="fetch(\'/write\')">Save</button>');
  });
  await new Promise<void>(done => http.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const root = await mkdtemp(join(tmpdir(), 'vb-worker-kill-'));
  const worker = () => {
    const client = new Client({ name: 'kill-test', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', resolve('src/mcp/server.ts')], cwd: root,
      env: { ...process.env, VERSEBROWSER_BACKEND: 'upstream', VERSEBROWSER_TOOL_GROUPS: 'core', VERSEBROWSER_CAPS: 'browser.open,browser.navigate,browser.observe,browser.act,browser.close' } as Record<string, string>, stderr: 'pipe' });
    return { client, transport };
  };
  const first = worker(), sibling = worker(), restarted = worker();
  const call = async (client: Client, name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    return JSON.parse((response.content as { text: string }[])[0].text);
  };
  const open = async (client: Client) => {
    const result = await call(client, 'vb_open', { url });
    expect(result.ok, result.content).toBe(true); return result.data.session.id as string;
  };
  try {
    await first.client.connect(first.transport); await sibling.client.connect(sibling.transport);
    const oldId = await open(first.client), siblingId = await open(sibling.client);
    const pending = call(first.client, 'vb_nav', { sessionId: oldId, url: url + '/held' }).then(
      () => 'unexpected response', () => 'connection closed');
    await entered.promise;
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'],
    { windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    const rows = JSON.parse(stdout) as { ProcessId: number; ParentProcessId: number; Name: string }[];
    const owned = new Set([first.transport.pid!]);
    for (let size = -1; size !== owned.size;) {
      size = owned.size;
      for (const row of rows) if (owned.has(row.ParentProcessId)) owned.add(row.ProcessId);
    }
    const browserPids = rows.filter(row => owned.has(row.ProcessId) && /chrome/i.test(row.Name)).map(row => row.ProcessId);
    expect(browserPids.length).toBeGreaterThan(0);
    process.kill(first.transport.pid!, 'SIGKILL');
    expect(await pending).toBe('connection closed');
    await expect.poll(() => browserPids.filter(isProcessAlive), { timeout: 10000 }).toEqual([]);
    expect((await call(sibling.client, 'vb_snapshot', { sessionId: siblingId })).ok).toBe(true);
    await restarted.client.connect(restarted.transport);
    expect((await call(restarted.client, 'vb_click', { sessionId: oldId, selector: 'button' })).ok).toBe(false);
    const freshId = await open(restarted.client);
    expect(freshId).not.toBe(oldId);
    expect(writes).toBe(0);
    expect((await call(restarted.client, 'vb_snapshot', { sessionId: freshId })).ok).toBe(true);
    await call(restarted.client, 'vb_close', { sessionId: freshId });
    await call(sibling.client, 'vb_close', { sessionId: siblingId });
  } finally {
    await first.client.close(); await sibling.client.close(); await restarted.client.close();
    http.closeAllConnections(); await new Promise<void>(done => http.close(() => done()));
  }
}, 40_000);
