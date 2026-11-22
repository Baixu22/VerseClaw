import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentBrowserService } from '../src/engine/service.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { loadSessionRecord } from '../src/engine/persistent-sessions.ts';
import { assertKitesurfLoopback, cdpVersionUrl, isKitesurfLoopback, isKitesurfVersion, KITESURF_METHODS } from '../src/engine/kitesurf-cdp.ts';
import { profileForKitesurf } from '../src/engine/driver-profile.ts';
import { createCli } from '../src/cli.ts';

const mocks = vi.hoisted(() => {
  const page = {
    goto: vi.fn(async () => undefined),
    waitForSelector: vi.fn(async () => undefined),
    url: () => 'https://example.com/',
    title: vi.fn(async () => 'Example'),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    content: vi.fn(async () => '<main>Example</main>'),
    click: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
    keyboard: { press: vi.fn(async () => undefined) },
    locator: vi.fn(() => ({
      evaluate: vi.fn(async () => false),
      focus: vi.fn(async () => undefined),
      fill: vi.fn(async () => undefined),
      waitFor: vi.fn(async () => undefined),
      elementHandle: vi.fn(async () => ({
        evaluate: vi.fn(async () => ({ value: '', valueRedacted: false, truncated: false })),
        dispose: vi.fn(async () => undefined),
      })),
    })),
    screenshot: vi.fn(async () => { const png = Buffer.alloc(24); png.writeUInt32BE(1280, 16); png.writeUInt32BE(720, 20); return png; }),
    evaluate: vi.fn(async (expression: string) => String(expression).includes('extractPageText')
      ? JSON.stringify({ text: 'Example', truncated: false, usedFallback: false })
      : []),
    close: vi.fn(async () => undefined),
    isClosed: () => false,
    context: () => context,
    newCDPSessionContext: () => ({
      newCDPSession: async () => ({
        send: async () => ({ targetInfo: { targetId: 'page-1' } }),
        detach: async () => undefined,
      }),
    }),
  };
  const context = { pages: () => [page], newPage: vi.fn(async () => page), on: vi.fn(), off: vi.fn(), once: vi.fn(), routeWebSocket: vi.fn(), close: vi.fn(), newCDPSession: vi.fn(async () => ({ send: vi.fn(async () => ({ targetInfo: { targetId: 'page-1' } })), detach: vi.fn() })) };
  Object.assign(context, { browser: () => browser });
  const browser = {
    contexts: vi.fn(() => [context]),
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
    isConnected: () => true,
    on: vi.fn(), off: vi.fn(), once: vi.fn(),
  };
  return { page, context, browser, launch: vi.fn(), connectOverCDP: vi.fn(async (_endpoint: string) => browser), cliOpen: vi.fn() };
});

vi.mock('playwright-core', () => ({
  chromium: {
    connectOverCDP: mocks.connectOverCDP,
    launch: mocks.launch,
    executablePath: () => 'unused',
  },
}));
vi.mock('../src/engine/kitesurf-cdp.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/engine/kitesurf-cdp.ts')>(),
  connectKitesurfOverCDP: (chromium: { connectOverCDP: (endpoint: string) => unknown }, endpoint: string) => chromium.connectOverCDP(endpoint),
}));
vi.mock('../src/engine/kitesurf-session.ts', () => ({
  openKitesurfSession: mocks.cliOpen,
  createKitesurfHostApi: () => ({ close: mocks.cliOpen }),
}));

const { page, browser, connectOverCDP, cliOpen } = mocks;
const observations: Record<string, unknown> = {};
let workspaceRoot: string;
let server: Server | undefined;
let endpoint: string;
let version: unknown = { Browser: 'Kitesurf/0.1.0' };
let probeCount = 0;
let failed = false;
let registered = 0, passed = 0;
function run(name: string, assertion: () => Promise<void> | void) {
  registered++;
  return it(name, assertion);
}

async function listen(): Promise<string> {
  server = createServer((request, response) => {
    probeCount += 1;
    if (request.url !== '/json/version') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(version));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server!.address();
  if (!address || typeof address === 'string') throw new Error('loopback listener unavailable');
  return `ws://127.0.0.1:${address.port}/devtools/browser`;
}

async function openKitesurf() {
  const api = await createPlaywrightHostApi({ persistent: true, workspaceRoot });
  const opened = await api.open({ browser: 'kitesurf', connectionMode: 'cdp', cdpEndpoint: endpoint, url: 'https://example.com/' });
  return { api, opened };
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join('D:\\tmp', 'kitesurf-cdp-'));
  endpoint = await listen();
  version = { Browser: 'Kitesurf/0.1.0' };
  probeCount = 0;
  vi.clearAllMocks();
    cliOpen.mockResolvedValue({ success: true, session: { id: 'cli-session' } });
});

afterEach(async ({ task }) => {
  if (task.result?.state === 'pass') passed++; else failed = true;
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  server = undefined;
  await rm(workspaceRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('kitesurf loopback CDP', () => {
  run('accepts IPv4, localhost and IPv6 loopback and rejects other addresses and URL credentials', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      const endpoint = `ws://${host}:8787/devtools/browser?ignored=1#ignored`;
      expect(isKitesurfLoopback(endpoint)).toBe(true);
      expect(() => assertKitesurfLoopback(endpoint)).not.toThrow();
      expect(cdpVersionUrl(endpoint)).toBe(`http://${host}:8787/json/version`);
    }
    for (const endpoint of ['wss://kitesurf.example.workers.dev/devtools/browser', 'ws://192.168.1.2:8787', 'ws://[::ffff:127.0.0.1]:8787', 'ws://user:password@127.0.0.1:8787', 'file:///tmp/cdp', 'not a URL']) {
      expect(() => assertKitesurfLoopback(endpoint)).toThrow(/E_KITESURF_ENDPOINT/);
    }
    observations.allLoopbackFamilies = true;
  });

  run('declares the native method set without Chromium-only methods', () => {
    expect([...profileForKitesurf().methods!].sort()).toEqual(['open', ...KITESURF_METHODS].sort());
    observations.nativeProfileMatchesAdapter = true;
  });

  run('normalizes only loopback endpoints and recognizes all version identity fields', () => {
    expect(cdpVersionUrl(endpoint)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/json\/version$/);
    expect(isKitesurfVersion({ Browser: 'Kitesurf/0.1.0' })).toBe(true);
    expect(isKitesurfVersion({ Product: 'kitesurf' })).toBe(true);
    expect(isKitesurfVersion({ 'User-Agent': 'Kitesurf' })).toBe(true);
    expect(isKitesurfVersion({ Browser: 'Chrome/131.0.0.0' })).toBe(false);
    observations.versionIdentity = true;
  });

  run('rejects the desktop browser field before creating a window', async () => {
    const createWindow = vi.fn(() => { throw new Error('window created'); });
    const service = new AgentBrowserService({ createWindow: createWindow as never });
    await expect(service.open({ browser: 'kitesurf', url: 'https://example.com/' })).rejects.toThrow(/E_CAPABILITY_UNAVAILABLE/);
    expect(createWindow).not.toHaveBeenCalled();
    observations.desktopRejectedBeforeWindow = createWindow.mock.calls.length === 0;
  });

  run('rejects remote and misidentified endpoints before connecting', async () => {
    const api = await createPlaywrightHostApi({ persistent: true, workspaceRoot });
    await expect(api.open({ browser: 'kitesurf', connectionMode: 'cdp', cdpEndpoint: 'wss://kitesurf.example.workers.dev/devtools/browser' })).rejects.toThrow(/E_KITESURF_ENDPOINT/);
    expect(connectOverCDP).not.toHaveBeenCalled();
    version = { Browser: 'Chrome/131.0.0.0' };
    await expect(api.open({ browser: 'kitesurf', connectionMode: 'cdp', cdpEndpoint: endpoint })).rejects.toThrow(/E_KITESURF_ENDPOINT/);
    expect(connectOverCDP).not.toHaveBeenCalled();
    observations.connectCallsAfterRejection = connectOverCDP.mock.calls.length;
  });

  run('attaches, probes before connecting, records the engine, and keeps status synchronous', async () => {
    const { api, opened } = await openKitesurf();
    expect(opened.success).toBe(true);
    expect(connectOverCDP).toHaveBeenCalledWith(endpoint);
    expect(probeCount).toBe(1);
    expect(page.goto).toHaveBeenCalledWith('https://example.com/', { waitUntil: 'load', timeout: expect.any(Number) });
    const record = await loadSessionRecord(opened.session.id, workspaceRoot);
    expect(record?.engine).toBe('kitesurf');
    expect(record?.external).toBe(true);
    const status = api.status();
    expect(status).not.toBeInstanceOf(Promise);
    expect((await status).success).toBe(true);
    expect((await status).sessions?.map(session => session.id)).toEqual([opened.session.id]);
    observations.sessionEngine = record?.engine;
    observations.probedBeforeConnect = probeCount === 1 && connectOverCDP.mock.calls.length === 1;
    observations.statusSynchronous = !(status instanceof Promise);
  });

  run('serves native script, page, and observation capabilities', async () => {
    const { api, opened } = await openKitesurf();
    const sessionId = opened.session.id;
    await expect(api.uploadFiles!({ sessionId, selector: 'input', paths: ['D:\\tmp\\x.txt'] })).rejects.toThrow(/E_CAPABILITY_UNAVAILABLE/);
    await expect(api.downloadFile!({ sessionId, selector: 'a', path: 'D:\\tmp\\x.txt' })).rejects.toThrow(/E_CAPABILITY_UNAVAILABLE/);
    await expect(api.semanticRead!({ sessionId, action: 'observe', instruction: 'read' })).rejects.toThrow(/E_CAPABILITY_UNAVAILABLE/);
    await expect(api.runtimeInspectGlobals({ sessionId, paths: ['application'] })).rejects.toThrow(/E_CAPABILITY_UNAVAILABLE/);
    expect(page.evaluate).not.toHaveBeenCalled();
    const shot = await api.screenshot({ sessionId });
    expect(shot.success).toBe(true);
    expect(page.screenshot).toHaveBeenCalledOnce();
    await api.navigate({ sessionId, url: 'https://example.com/next' });
    expect(page.goto).toHaveBeenCalledWith('https://example.com/next', { waitUntil: 'load', timeout: expect.any(Number) });
    const extracted = await api.extractPageText({ sessionId, rules: [] });
    expect(extracted.text).toBe('Example');
    expect(page.evaluate).toHaveBeenCalled();
    expect((await api.networkListRequests({ sessionId })).success).toBe(true);
    expect(api.status()).toMatchObject({ success: true, sessions: [{ id: sessionId }] });
    await api.close({ sessionId });
    expect(browser.close).toHaveBeenCalledOnce();
    expect(await loadSessionRecord(sessionId, workspaceRoot)).toBeNull();
    observations.screenshotCallsAfterAttach = page.screenshot.mock.calls.length;
    observations.bannedActions = ['uploadFiles', 'downloadFile', 'semanticRead'];
  });

  run('refuses unsupported AI actions before reconnecting and revalidates identity for allowed actions', async () => {
    const { opened } = await openKitesurf();
    const api = await createPlaywrightHostApi({ persistent: true, workspaceRoot });
    connectOverCDP.mockClear();
    probeCount = 0;
    await expect(api.semanticRead!({ sessionId: opened.session.id, action: 'observe', instruction: 'read' })).rejects.toThrow(/E_CAPABILITY_UNAVAILABLE/);
    expect(connectOverCDP).not.toHaveBeenCalled();
    expect(probeCount).toBe(0);
    await expect(api.navigate({ sessionId: opened.session.id, url: 'https://example.com/restored' })).rejects.toThrow(/original WebSocket/);
    expect(probeCount).toBe(1);
    expect(connectOverCDP).not.toHaveBeenCalled();
    version = { Browser: 'Chrome/131.0.0.0' };
    const changed = await createPlaywrightHostApi({ persistent: true, workspaceRoot });
    connectOverCDP.mockClear();
    await expect(changed.navigate({ sessionId: opened.session.id, url: 'https://example.com/changed' })).rejects.toThrow(/no longer identifies Kitesurf/);
    expect(connectOverCDP).not.toHaveBeenCalled();
    observations.restoredUnsupportedActionBlockedBeforeConnect = true;
    observations.restoredIdentityRevalidated = true;
  });

  run('auto-detects Kitesurf and applies the same ceiling without the flag', async () => {
    const api = await createPlaywrightHostApi({ persistent: true, workspaceRoot });
    const opened = await api.open({ connectionMode: 'cdp', cdpEndpoint: endpoint });
    await expect(api.evaluate({ sessionId: opened.session.id, expression: '1' })).resolves.toMatchObject({ success: true });
    expect(page.evaluate).toHaveBeenCalled();
    expect((await loadSessionRecord(opened.session.id, workspaceRoot))?.engine).toBe('kitesurf');
    observations.evaluateCallsAfterAutoDetect = page.evaluate.mock.calls.length;
  });

  run('keeps ordinary Chromium CDP behavior when probing fails', async () => {
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
    const { chromium: actualChromium } = await vi.importActual<typeof import('playwright-core')>('playwright-core');
    const actualBrowser = await actualChromium.launch({ headless: true, args: [`--remote-debugging-port=${new URL(endpoint).port}`] });
    const versionResponse = await fetch(cdpVersionUrl(endpoint));
    endpoint = (await versionResponse.json() as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
    connectOverCDP.mockImplementationOnce(actualChromium.connectOverCDP.bind(actualChromium) as never);
    const realFetch = globalThis.fetch;
    const failedProbe = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => input === cdpVersionUrl(endpoint)
      ? Promise.resolve(new Response('version unavailable', { status: 503 }))
      : realFetch(input, init));
    try {
      const api = await createPlaywrightHostApi({ persistent: true, workspaceRoot });
      const opened = await api.open({ connectionMode: 'cdp', cdpEndpoint: endpoint });
      expect(opened.success).toBe(true);
      expect(await api.evaluate({ sessionId: opened.session.id, expression: '1 + 1' })).toMatchObject({ value: 2 });
      expect((await loadSessionRecord(opened.session.id, workspaceRoot))?.engine).toBeUndefined();
      expect(failedProbe).toHaveBeenCalledWith(cdpVersionUrl(endpoint), expect.any(Object));
      await api.close({ sessionId: opened.session.id });
      expect(actualBrowser.isConnected()).toBe(true);
    } finally { failedProbe.mockRestore(); await actualBrowser.close(); }
    observations.chromiumFallbackOnProbeFailure = true;
  });

  run('creates only Kitesurf targets, never a local Chromium browser', async () => {
    connectOverCDP.mockResolvedValueOnce({ ...browser, contexts: () => [] } as never);
    await expect((await createPlaywrightHostApi({ persistent: true, workspaceRoot })).open({ browser: 'kitesurf', connectionMode: 'cdp', cdpEndpoint: endpoint })).rejects.toThrow(/E_KITESURF_ENDPOINT/);
    expect(browser.newContext).not.toHaveBeenCalled();
    expect(mocks.launch).not.toHaveBeenCalled();
    observations.noChromiumResourcesCreated = true;
  });

  run('passes the CLI flag through the standalone facade', async () => {
    await createCli().parseAsync(['node', 'vb', 'open', '--kitesurf', '--cdp', endpoint, '--url', 'https://example.com/']);
    expect(cliOpen).toHaveBeenCalledWith({ browser: 'kitesurf', cdpEndpoint: endpoint, connectionMode: 'cdp', url: 'https://example.com/' }, expect.any(String));
    observations.cliFlagForwarded = true;
  });

  run('routes an auto-detected Kitesurf CLI attach through the control process', async () => {
    await createCli().parseAsync(['node', 'vb', 'open', '--cdp', endpoint, '--url', 'https://example.com/']);
    expect(cliOpen).toHaveBeenCalledWith({ browser: 'kitesurf', cdpEndpoint: endpoint, connectionMode: 'cdp', url: 'https://example.com/' }, expect.any(String));
    observations.cliAutoDetectForwarded = true;
  });
});

const SOURCE_FILES = [
  'packages/versebrowser/src/engine/kitesurf-cdp.ts',
  'packages/versebrowser/src/engine/service.ts',
  'packages/versebrowser/src/engine/playwright-host-api.ts',
  'packages/versebrowser/src/engine/persistent-sessions.ts',
  'packages/versebrowser/src/cli.ts',
  'packages/versebrowser/src/types/host-api.ts',
  'packages/versebrowser/src/engine/kitesurf-session.ts',
  'packages/versebrowser/src/engine/upstream-control.ts',
  'packages/versebrowser/src/engine/facade.ts',
  'packages/versebrowser/src/engine/driver-profile.ts',
  'packages/versebrowser/src/evidence/output.ts',
  'scripts/kitesurf-local-runtime.mjs',
  'pnpm-workspace.yaml',
  'scripts/contract-check.mjs',
  'vitest.agent-dev.node.config.ts',
  'scripts/typecheck-agent-dev.mjs',
  'tests/unit/typecheck-gate.test.ts',
];

afterAll(async () => {
  if (failed || passed !== registered) return;
  let root = dirname(fileURLToPath(import.meta.url));
  while (dirname(root) !== root && !existsSync(join(root, 'pnpm-workspace.yaml'))) root = dirname(root);
  const sourceHashes: Record<string, string> = {};
  for (const file of SOURCE_FILES) sourceHashes[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
  const receiptPath = join(root, 'harness/specs/fixtures/kitesurf-loopback-cdp/receipt.json');
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify({ schema: 'clawx.kitesurf-loopback-cdp/v2', driven_by: 'agent', actor: 'codex', liveEngine: false, remoteBrowserRun: false, sourceHashes, observations, executedAt: new Date().toISOString(), testSourceHash: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex') }, null, 2)}\n`);
});
