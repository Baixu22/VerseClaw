// @vitest-environment node
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Client } from '../../openclaw_runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '../../openclaw_runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import { StdioClientTransport } from '../../openclaw_runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { CallToolResultSchema } from '../../openclaw_runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { resultFixtureTools } from '../fixtures/mcp-result-tools';
import { startMcpLoopbackServer, getActiveMcpLoopbackRuntime } from '../../openclaw_runtime/src/gateway/mcp-http';
import { setRuntimeConfigSnapshot, clearRuntimeConfigSnapshot } from '../../openclaw_runtime/src/config/runtime-snapshot';

async function retain(name: string, evidence: unknown) {
  const directory = process.env.MCP_RESULT_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.json`), JSON.stringify({ driven_by: 'agent', actor: 'mcp-sdk-runner', realHumanEvidence: false, evidence }, null, 2));
}

const env = vi.hoisted(() => {
  const prior = process.env.OPENCLAW_STATE_DIR;
  const temporary = process.env.TEMP ?? process.env.TMP ?? process.env.TMPDIR ?? '/tmp';
  process.env.OPENCLAW_STATE_DIR = `${temporary}/mcp-result-sdk-${process.pid}`;
  return { prior, events: [] as string[] };
});
// Inject deterministic tools at the registry boundary; HTTP, stdio, SDK and hooks are real.
vi.mock('../../openclaw_runtime/src/gateway/tool-resolution', () => ({
  resolveGatewayScopedTools: () => ({ agentId: 'main', tools: resultFixtureTools(env.events) }),
}));
vi.mock('../../openclaw_runtime/src/gateway/session-utils', () => ({ loadSessionEntry: () => ({ entry: undefined }) }));
afterAll(() => {
  clearRuntimeConfigSnapshot();
  if (env.prior === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = env.prior;
});

describe.each(['http', 'stdio'] as const)('MCP actual %s SDK roundtrip', (transport) => {
  it('preserves results, failure and cancellation across the transport', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'mcp-result-sdk-'));
    await mkdir(join(scratch, 'state'));
    await writeFile(join(scratch, 'config.json'), JSON.stringify({ plugins: { enabled: false } }));
    setRuntimeConfigSnapshot({ plugins: { enabled: false } });
    const client = new Client({ name: 'fidelity-client', version: '1.0.0' });
    env.events.length = 0;
    let server: Awaited<ReturnType<typeof startMcpLoopbackServer>> | undefined;
    let stdioPid: number | null = null;
    const results: Record<string, unknown> = {};
    try {
      if (transport === 'http') {
        server = await startMcpLoopbackServer();
        const token = getActiveMcpLoopbackRuntime()!.ownerToken;
        const unsupported = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'mcp-protocol-version': 'unsupported-fixture' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'tools/list' }) });
        expect(unsupported.status).toBe(400);
        expect(await unsupported.json()).toEqual({ error: 'unsupported_protocol_version' });
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${token}`, 'x-session-key': 'agent:main:fidelity' } },
        }));
      } else {
        const stdio = new StdioClientTransport({ command: process.execPath,
          args: ['--import', pathToFileURL(resolve('openclaw_runtime/node_modules/tsx/dist/loader.mjs')).href, resolve('tests/fixtures/mcp-result-server.mts')],
          cwd: resolve('openclaw_runtime'), stderr: 'pipe',
          env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', APPDATA: scratch,
            TEMP: tmpdir(), TMP: tmpdir(), TSX_TSCONFIG_PATH: resolve('openclaw_runtime/tsconfig.json'),
            OPENCLAW_HOME: scratch, OPENCLAW_STATE_DIR: join(scratch, 'state'), OPENCLAW_CONFIG_PATH: join(scratch, 'config.json'),
            MCP_RESULT_EVENTS_PATH: join(scratch, 'events.txt') },
        });
        stdio.stderr?.on('data', () => {});
        await client.connect(stdio);
        stdioPid = stdio.pid;
      }
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('result_fixture');
      for (const kind of ['text', 'image', 'audio', 'resource', 'structured', 'error', 'throw', 'waiting']) {
        const result = await client.callTool({ name: 'result_fixture', arguments: { kind } });
        results[kind] = result;
        expect(CallToolResultSchema.safeParse(result).success).toBe(true);
        expect(result.isError).toBe(['error', 'throw', 'waiting'].includes(kind));
        if (['image', 'audio', 'resource'].includes(kind)) expect(result.content).toMatchObject([{ type: kind }]);
        if (kind === 'structured') {
          if (transport === 'stdio') expect(result.structuredContent).toEqual({ count: 1 });
          else expect(result).toMatchObject({ content: expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('structuredContent:') })]), _meta: { 'openclaw/contentLoss': ['structuredContent:2025-03-26'] } });
        }
      }
      const abort = new AbortController();
      const pending = client.callTool({ name: 'result_fixture', arguments: { kind: 'slow', marker: 'cancel-me' } }, undefined, { signal: abort.signal });
      setTimeout(() => abort.abort(), 100);
      await expect(pending).rejects.toThrow();
      if (transport === 'http') await expect.poll(() => env.events.includes('aborted:cancel-me')).toBe(true);
      else await expect.poll(async () => (await readFile(join(scratch, 'events.txt'), 'utf8')).includes('aborted:cancel-me')).toBe(true);
      await expect(client.callTool({ name: 'result_fixture', arguments: { kind: 'slow', marker: 'timeout-me' } }, undefined, { timeout: 100 }))
        .rejects.toMatchObject({ code: -32001 });
      if (transport === 'http') await expect.poll(() => env.events.includes('aborted:timeout-me')).toBe(true);
      else {
        await expect.poll(async () => (await readFile(join(scratch, 'events.txt'), 'utf8')).includes('aborted:timeout-me')).toBe(true);
        results.approval = await client.callTool({ name: 'result_fixture', arguments: { kind: 'approval' } });
        expect(results.approval).toMatchObject({ isError: true, _meta: { 'openclaw/resultStatus': 'waiting' } });
        expect(await readFile(join(scratch, 'events.txt'), 'utf8')).not.toContain('start:approval');
      }
      const next = await client.callTool({ name: 'result_fixture', arguments: { kind: 'text', marker: 'next-call' } });
      results.afterCancelAndTimeout = next;
      expect(next).toMatchObject({ isError: false, content: [{ type: 'text', text: 'next-call' }] });
      if (transport === 'http') {
        const { getOrCreateSessionMcpRuntime, disposeSessionMcpRuntime } = await import('../../openclaw_runtime/src/agents/agent-bundle-mcp-runtime');
        const sessionId = `cancel-${process.pid}`;
        const runtime = await getOrCreateSessionMcpRuntime({ sessionId, workspaceDir: scratch, agentId: 'main',
          cfg: { plugins: { enabled: false }, mcp: { servers: { fixture: { url: `http://127.0.0.1:${server!.port}/mcp`, transport: 'streamable-http', networkPolicy: 'localOnly',
            headers: { authorization: `Bearer ${getActiveMcpLoopbackRuntime()!.ownerToken}`, 'x-session-key': 'agent:main:runtime-cancel' } } } } } });
        try {
          await runtime.getCatalog();
          for (let index = 0; index < 3; index += 1) {
            const controller = new AbortController();
            const running = runtime.callTool('fixture', 'result_fixture', { kind: 'slow', marker: `runtime-${index}` }, controller.signal);
            setTimeout(() => controller.abort(), 50);
            await expect(running).rejects.toThrow();
          }
          expect(await runtime.callTool('fixture', 'result_fixture', { kind: 'text', marker: 'after-cancels' }))
            .toMatchObject({ isError: false, content: [{ type: 'text', text: 'after-cancels' }] });
        } finally { await disposeSessionMcpRuntime(sessionId); }
      }
    } finally {
      await client.close();
      await server?.close();
      if (stdioPid) await expect.poll(() => {
        try { process.kill(stdioPid!, 0); return false; }
        catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
      }).toBe(true);
      await retain(`sdk-${transport}`, { results, stdioPid, processExited: true,
        events: transport === 'http' ? env.events : (await readFile(join(scratch, 'events.txt'), 'utf8')).trim().split('\n') });
    }
  }, 90_000);
});

it.each(['2024-11-05', '2025-03-26'] as const)('downgrades newer result fields for negotiated %s over real HTTP and stdio', async (version) => {
  setRuntimeConfigSnapshot({ plugins: { enabled: false } });
  const server = await startMcpLoopbackServer();
  const token = getActiveMcpLoopbackRuntime()!.ownerToken;
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-session-key': 'agent:main:legacy' };
  let id = 1;
  const rpc = async (method: string, params: unknown) => fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) });
  const client = new Client({ name: 'legacy-stdio', version: '1' });
  const scratch = await mkdtemp(join(tmpdir(), 'mcp-legacy-'));
  await writeFile(join(scratch, 'config.json'), JSON.stringify({ plugins: { enabled: false } }));
  const stdio = new StdioClientTransport({ command: process.execPath,
    args: ['--import', pathToFileURL(resolve('openclaw_runtime/node_modules/tsx/dist/loader.mjs')).href, resolve('tests/fixtures/mcp-result-server.mts')],
    cwd: resolve('openclaw_runtime'), stderr: 'pipe', env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '',
      TEMP: tmpdir(), TMP: tmpdir(), TSX_TSCONFIG_PATH: resolve('openclaw_runtime/tsconfig.json'), OPENCLAW_HOME: scratch,
      OPENCLAW_STATE_DIR: join(scratch, 'state'), OPENCLAW_CONFIG_PATH: join(scratch, 'config.json') } });
  const send = stdio.send.bind(stdio);
  stdio.send = async (message) => {
    if ('method' in message && message.method === 'initialize') await send({ ...message, params: { ...message.params, protocolVersion: version } });
    else await send(message);
  };
  stdio.stderr?.on('data', () => {});
  const receipts: unknown[] = [];
  let pid: number | null = null;
  try {
    const initialized = await rpc('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'legacy-http', version: '1' } });
    expect((await initialized.json()).result.protocolVersion).toBe(version);
    headers['mcp-session-id'] = initialized.headers.get('mcp-session-id')!;
    headers['mcp-protocol-version'] = version;
    await client.connect(stdio); pid = stdio.pid;
    for (const kind of ['audio', 'resource_link', 'structured']) {
      const http = (await (await rpc('tools/call', { name: 'result_fixture', arguments: { kind } })).json()).result;
      const pipe = await client.callTool({ name: 'result_fixture', arguments: { kind } });
      for (const result of [http, pipe]) {
        expect(CallToolResultSchema.safeParse(result).success).toBe(true);
        expect(result.isError).toBe(false);
        if (kind === 'structured') expect(result.structuredContent).toBeUndefined();
        else expect(result.content[0].type).toBe(kind === 'audio' && version === '2025-03-26' ? 'audio' : 'text');
        if (kind !== 'audio' || version === '2024-11-05') expect(result._meta['openclaw/contentLoss']).toBeTruthy();
      }
      receipts.push({ kind, http, stdio: pipe });
    }
    expect((await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'DELETE', headers })).status).toBe(200);
    expect((await rpc('tools/list', {})).status).toBe(404);
  } finally {
    await client.close(); await server.close();
    if (pid) await expect.poll(() => { try { process.kill(pid!, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; } }).toBe(true);
    await retain(`sdk-version-${version}`, { receipts, pid, processExited: true });
  }
}, 90_000);

it('isolates cancellation and duplicate request ids between two initialized HTTP clients', async () => {
  setRuntimeConfigSnapshot({ plugins: { enabled: false } });
  env.events.length = 0;
  const server = await startMcpLoopbackServer();
  const token = getActiveMcpLoopbackRuntime()!.ownerToken;
  const first = new Client({ name: 'first', version: '1' });
  const second = new Client({ name: 'second', version: '1' });
  const transports = [first, second].map(() => new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}`, 'x-session-key': 'agent:main:shared' } },
  }));
  try {
    await first.connect(transports[0]);
    await second.connect(transports[1]);
    expect(transports[0].sessionId).toBeTruthy();
    expect(transports[0].sessionId).not.toBe(transports[1].sessionId);
    const pending = first.callTool({ name: 'result_fixture', arguments: { kind: 'slow', marker: 'first-client' } });
    await expect.poll(() => env.events.includes('start:slow:first-client')).toBe(true);
    // Both fresh SDK clients use id=1 after initialize. The second client's stale
    // cancellation must not target the first client's in-flight request.
    await second.notification({ method: 'notifications/cancelled', params: { requestId: 1 } });
    expect(await second.callTool({ name: 'result_fixture', arguments: { kind: 'text', marker: 'second-client' } }))
      .toMatchObject({ isError: false, content: [{ type: 'text', text: 'second-client' }] });
    expect(await pending).toMatchObject({ isError: false, content: [{ type: 'text', text: 'first-client' }] });
    expect(env.events).not.toContain('aborted:first-client');
    const post = (sessionKey: string, version: string, body: unknown) => fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json',
        'mcp-session-id': transports[0].sessionId!, 'mcp-protocol-version': version, 'x-session-key': sessionKey }, body: JSON.stringify(body),
    });
    const replay = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'result_fixture', arguments: { kind: 'text', marker: 'must-not-execute' } } };
    expect((await (await post('agent:main:shared', '2025-03-26', replay)).json()).error.code).toBe(-32600);
    expect((await post('agent:main:other', '2025-03-26', replay)).status).toBe(404);
    expect((await post('agent:main:shared', '2024-11-05', { ...replay, id: 10 })).status).toBe(400);
    expect(env.events.some((event) => event.includes('must-not-execute'))).toBe(false);
    await retain('client-isolation', { events: env.events, distinctSessionIds: transports[0].sessionId !== transports[1].sessionId,
      replayRejected: true, foreignSessionRejected: true, changedVersionRejected: true });
  } finally {
    await Promise.all([first.close(), second.close()]);
    await server.close();
  }
}, 90_000);

it.each(['notification', 'delete'] as const)('cancels queued HTTP batch calls through %s', async (mode) => {
  setRuntimeConfigSnapshot({ plugins: { enabled: false } }); env.events.length = 0;
  const server = await startMcpLoopbackServer();
  const token = getActiveMcpLoopbackRuntime()!.ownerToken;
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-session-key': 'agent:main:batch' };
  const post = (body: unknown) => fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    const init = await post({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    headers['mcp-session-id'] = init.headers.get('mcp-session-id')!;
    const pending = post([1, 2].map((id) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'result_fixture', arguments: { kind: id === 1 ? 'slow' : 'text', marker: `batch-${id}` } } })));
    await expect.poll(() => env.events.includes('start:slow:batch-1')).toBe(true);
    if (mode === 'delete') await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'DELETE', headers });
    else await post({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } });
    const response = await (await pending).json();
    expect(response[1].result).toMatchObject({ isError: true, _meta: { 'openclaw/resultStatus': 'cancelled' } });
    expect(env.events).not.toContain('start:text:batch-2');
    await retain(`batch-${mode}`, { response, events: [...env.events], queuedEffectExecuted: false });
  } finally { await server.close(); }
});

it('reconnects an expired MCP session without replaying the rejected call', async () => {
  setRuntimeConfigSnapshot({ plugins: { enabled: false } }); env.events.length = 0;
  const server = await startMcpLoopbackServer();
  const { getOrCreateSessionMcpRuntime, disposeSessionMcpRuntime } = await import('../../openclaw_runtime/src/agents/agent-bundle-mcp-runtime');
  const sessionId = `expired-${process.pid}`;
  const scratch = await mkdtemp(join(tmpdir(), 'mcp-expired-'));
  const runtime = await getOrCreateSessionMcpRuntime({ sessionId, workspaceDir: scratch, agentId: 'main', cfg: {
    plugins: { enabled: false }, mcp: { servers: { fixture: { url: `http://127.0.0.1:${server.port}/mcp`, transport: 'streamable-http', networkPolicy: 'localOnly',
      headers: { authorization: `Bearer ${getActiveMcpLoopbackRuntime()!.ownerToken}`, 'x-session-key': 'agent:main:expiry' } } } },
  } });
  const originalNow = Date.now();
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await runtime.getCatalog();
    clock = vi.spyOn(Date, 'now').mockReturnValue(originalNow + 11 * 60_000);
    await expect(runtime.callTool('fixture', 'result_fixture', { kind: 'text', marker: 'expired-attempt' })).rejects.toThrow();
    expect(env.events.some((event) => event.includes('expired-attempt'))).toBe(false);
    expect(await runtime.callTool('fixture', 'result_fixture', { kind: 'text', marker: 'fresh-call' }))
      .toMatchObject({ isError: false, content: [{ type: 'text', text: 'fresh-call' }] });
    await retain('expired-session', { events: [...env.events], expiredAttemptExecuted: false, explicitRecoveryPassed: true });
  } finally { clock?.mockRestore(); await disposeSessionMcpRuntime(sessionId); await server.close(); }
}, 90_000);

it('ignores a delayed 404 from a retired connection after its replacement is warm', async () => {
  setRuntimeConfigSnapshot({ plugins: { enabled: false } });
  const server = await startMcpLoopbackServer();
  const { getOrCreateSessionMcpRuntime, disposeSessionMcpRuntime } = await import('../../openclaw_runtime/src/agents/agent-bundle-mcp-runtime');
  const sessionId = `concurrent-expiry-${process.pid}`;
  const scratch = await mkdtemp(join(tmpdir(), 'mcp-expiry-race-'));
  const runtime = await getOrCreateSessionMcpRuntime({ sessionId, workspaceDir: scratch, agentId: 'main', cfg: {
    plugins: { enabled: false }, mcp: { servers: { fixture: { url: `http://127.0.0.1:${server.port}/mcp`, transport: 'streamable-http', networkPolicy: 'localOnly',
      headers: { authorization: `Bearer ${getActiveMcpLoopbackRuntime()!.ownerToken}`, 'x-session-key': 'agent:main:expiry-race' } } } },
  } });
  const oldSend = StreamableHTTPClientTransport.prototype.send;
  const oldTerminate = StreamableHTTPClientTransport.prototype.terminateSession;
  let releaseRetirement: (() => Promise<void>) | undefined;
  const terminate = vi.spyOn(StreamableHTTPClientTransport.prototype, 'terminateSession').mockImplementationOnce(function (this: StreamableHTTPClientTransport) {
    return new Promise<void>((resolve, reject) => {
      releaseRetirement = async () => {
        try { await oldTerminate.call(this); resolve(); }
        catch (error) { reject(error); }
      };
    });
  });
  let rejectLate: (error: Error) => void = () => {};
  let lateStarted = false;
  const send = vi.spyOn(StreamableHTTPClientTransport.prototype, 'send').mockImplementation(async function(this: StreamableHTTPClientTransport, message, options) {
    if ('method' in message && message.method === 'tools/call' && message.params?.arguments) {
      const marker = (message.params.arguments as { marker?: string }).marker;
      if (marker === 'late-old') { lateStarted = true; return await new Promise<void>((_resolve, reject) => { rejectLate = reject; }); }
      if (marker === 'first-old') throw new StreamableHTTPError(404, 'Expired session');
    }
    return await oldSend.call(this, message, options);
  });
  try {
    await runtime.getCatalog();
    const late = runtime.callTool('fixture', 'result_fixture', { kind: 'text', marker: 'late-old' }).catch((error) => error);
    await expect.poll(() => lateStarted).toBe(true);
    let firstRejected = false;
    const first = runtime.callTool('fixture', 'result_fixture', { kind: 'text', marker: 'first-old' }).catch((error) => { firstRejected = true; return error; });
    await expect.poll(() => Boolean(releaseRetirement)).toBe(true);
    await expect.poll(() => firstRejected, { timeout: 1000 }).toBe(true);
    expect(await runtime.callTool('fixture', 'result_fixture', { kind: 'text', marker: 'replacement' })).toMatchObject({ isError: false });
    const currentCatalog = runtime.peekCatalog();
    rejectLate(new StreamableHTTPError(404, 'Delayed expired response'));
    await late;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.peekCatalog()).toBe(currentCatalog);
    expect(await runtime.callTool('fixture', 'result_fixture', { kind: 'text', marker: 'still-live' })).toMatchObject({ isError: false });
    const preservedReplacement = runtime.peekCatalog() === currentCatalog;
    let fullyDisposed = false;
    const disposing = disposeSessionMcpRuntime(sessionId).then(() => { fullyDisposed = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fullyDisposed).toBe(false);
    await releaseRetirement?.();
    await first;
    await disposing;
    await retain('expiry-race', { preservedReplacement, originalErrorReturnedBeforeCleanup: firstRejected, runtimeDisposalDrained: fullyDisposed,
      faultInjection: 'controlled delayed SDK404 and retirement; real HTTP handshake and successful calls' });
  } finally { await releaseRetirement?.(); terminate.mockRestore(); send.mockRestore(); await disposeSessionMcpRuntime(sessionId); await server.close(); }
}, 90_000);
