import { afterEach, expect, it, vi } from 'vitest';
import { assertBrowserRuntime } from '../src/engine/runtime-compatibility.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import { closeBrowserThroughCdp, launchDetachedBrowser, probeEndpoint, waitForCdpEndpoint } from '../src/engine/persistent-sessions.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.ts';
import { resolveMcpPolicy } from '../src/mcp/capability-policy.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('accepts the patched libuv boundary and leaves other operating systems usable', () => {
  for (const uv of ['1.52.1', '1.53.0', '2.0.0']) {
    expect(() => assertBrowserRuntime({ platform: 'win32', versions: { node: '24.16.0', uv } })).not.toThrow();
  }
  for (const platform of ['linux', 'darwin']) {
    expect(() => assertBrowserRuntime({ platform, versions: { node: '24.15.0', uv: '1.51.0' } })).not.toThrow();
  }
});

it.each(['1.49.2', '1.51.0', '1.52.0', 'unknown'])(
  'rejects Windows libuv %s with an actionable error', uv => {
    expect(() => assertBrowserRuntime({ platform: 'win32', versions: { node: '24.15.0', uv } }))
      .toThrow(expect.objectContaining({ code: 'E_NODE_RUNTIME', message: expect.stringContaining('Node.js 24.16.0') }));
  },
);

it('fails before launch and network I/O, and preserves the error through the standalone factory', async () => {
  vi.stubGlobal('process', { ...process, platform: 'win32', versions: { ...process.versions, uv: '1.51.0' } });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const error = expect.objectContaining({ code: 'E_NODE_RUNTIME' });
  await expect(createPlaywrightHostApi()).rejects.toMatchObject(error);
  await expect(createStandaloneFacade({ preferPlaywright: true })).rejects.toMatchObject(error);
  await expect(launchDetachedBrowser({ executablePath: 'missing', profileDir: 'unused', port: 1, headless: true })).rejects.toMatchObject(error);
  await expect(probeEndpoint('http://127.0.0.1:1')).rejects.toMatchObject(error);
  await expect(waitForCdpEndpoint('http://127.0.0.1:1')).rejects.toMatchObject(error);
  await expect(closeBrowserThroughCdp('http://127.0.0.1:1')).rejects.toMatchObject(error);
  expect(fetch).not.toHaveBeenCalled();
});

it('MCP returns the runtime upgrade error while offline ping still works', async () => {
  vi.stubGlobal('process', { ...process, platform: 'win32', versions: { ...process.versions, uv: '1.51.0' } });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const server = createMcpServer({ policy: resolveMcpPolicy({ groups: 'core', caps: 'browser.open', env: {} }) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'runtime-test', version: '1' });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const opened = await client.callTool({ name: 'vb_open', arguments: {} });
    expect(opened.isError).toBe(true);
    expect(JSON.stringify(opened.content)).toContain('E_NODE_RUNTIME');
    expect(JSON.stringify(opened.content)).toContain('Node.js 24.16.0');
    const ping = await client.callTool({ name: 'vb_ping', arguments: {} });
    expect(ping.isError).not.toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});
