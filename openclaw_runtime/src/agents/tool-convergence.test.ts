import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  classifyTool,
  evaluateMcpHealth,
  isAccurateStreamableHttpTransport,
  isHostNativeMisLabelledAsMcp,
} from './tool-convergence.js';
import { createSessionMcpRuntime } from './agent-bundle-mcp-runtime.js';
import { writeExecutable } from './bundle-mcp-shared.test-harness.js';
import { resolveMcpTransportConfig } from './mcp-transport-config.js';

const require = createRequire(import.meta.url);
const SDK_SERVER_MCP_PATH = pathToFileURL(
  require.resolve("@modelcontextprotocol/sdk/server/mcp.js"),
).href;
const SDK_SERVER_STDIO_PATH = pathToFileURL(
  require.resolve("@modelcontextprotocol/sdk/server/stdio.js"),
).href;

const CLEANUP_DIRS: string[] = [];
function tempWorkspaceDir(label: string): string {
  const dir = join(tmpdir(), `clawx-rc08a-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  CLEANUP_DIRS.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of CLEANUP_DIRS.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

describe('RC-08A MCP and host-native tool convergence', () => {
  it('classifies a tool backed by a real MCP server as mcp-server', () => {
    const stdio = classifyTool({ toolId: 'mcp-stdio', mcpTransport: 'stdio' });
    expect(stdio.origin).toBe('mcp-server');
    expect(stdio.labelledAsMcp).toBe(true);

    const http = classifyTool({ toolId: 'mcp-http', mcpTransport: 'streamable-http' });
    expect(http.origin).toBe('mcp-server');
    expect(http.mcpTransport).toBe('streamable-http');
  });

  it('classifies a host-native tool as host-native unless backed by a real MCP server', () => {
    const git = classifyTool({ toolId: 'git', hostSurface: 'git' });
    expect(git.origin).toBe('host-native');
    expect(git.hostSurface).toBe('git');
    expect(git.labelledAsMcp).toBe(false);

    const browser = classifyTool({ toolId: 'browser', hostSurface: 'browser' });
    expect(browser.origin).toBe('host-native');
    expect(browser.hostSurface).toBe('browser');
  });

  it('a host-native tool labelled as MCP without a real MCP server is a defect', () => {
    const defective = { toolId: 'git', origin: 'host-native' as const, hostSurface: 'git' as const, labelledAsMcp: true };
    expect(isHostNativeMisLabelledAsMcp(defective)).toBe(true);
    const ok = classifyTool({ toolId: 'git', hostSurface: 'git' });
    expect(isHostNativeMisLabelledAsMcp(ok)).toBe(false);
  });

  it('a Work Provider catalog entry is a catalog-projection, not MCP', () => {
    const catalog = classifyTool({ toolId: 'office-document', isWorkProviderCatalogEntry: true });
    expect(catalog.origin).toBe('catalog-projection');
    expect(catalog.labelledAsMcp).toBe(false);
  });

  it('health requires a real SDK initialize handshake; HTTP GET alone is not connected', () => {
    // Configured + handshake completed -> connected.
    expect(evaluateMcpHealth({ configured: true, handshakeCompleted: true })).toEqual({
      ok: true, connected: true, handshake: 'sdk-initialize',
    });
    // Configured but no handshake -> not connected.
    expect(evaluateMcpHealth({ configured: true, handshakeCompleted: false })).toEqual({
      ok: true, connected: false, handshake: 'not-attempted', reason: 'no SDK initialize handshake',
    });
    // HTTP GET ok but no handshake -> NOT connected (no fake-connected state).
    expect(evaluateMcpHealth({ configured: true, handshakeCompleted: false, httpGetOk: true })).toEqual({
      ok: true, connected: false, handshake: 'not-attempted', reason: 'HTTP GET ok but no SDK initialize handshake',
    });
    // Not configured -> not connected.
    expect(evaluateMcpHealth({ configured: false, handshakeCompleted: false })).toMatchObject({ connected: false });
  });

  it('unsupported transports (WebSocket-only) are rejected, not aliased', () => {
    expect(isAccurateStreamableHttpTransport('streamable-http')).toBe(true);
    expect(isAccurateStreamableHttpTransport('streamableHttp')).toBe(true);
    expect(isAccurateStreamableHttpTransport('websocket')).toBe(false);
    expect(isAccurateStreamableHttpTransport('ws')).toBe(false);
    expect(isAccurateStreamableHttpTransport('sse')).toBe(false);
    expect(isAccurateStreamableHttpTransport(undefined)).toBe(true);
  });

  it('the production transport resolver rejects WebSocket-only configs', () => {
    expect(resolveMcpTransportConfig('ws-server', {
      transport: 'websocket',
      url: 'ws://127.0.0.1:1',
    })).toBeNull();
    expect(resolveMcpTransportConfig('ws-server', {
      type: 'websocket',
      url: 'ws://127.0.0.1:1',
    })).toBeNull();
    // Supported choices still resolve.
    expect(resolveMcpTransportConfig('sse-server', {
      transport: 'sse',
      url: 'https://mcp.example.test/sse',
    })).not.toBeNull();
    expect(resolveMcpTransportConfig('streamable-server', {
      transport: 'streamable-http',
      url: 'https://mcp.example.test/mcp',
    })).not.toBeNull();
  });
});

describe('RC-08A production runtime: MCP initialize fixture and catalog health', () => {
  it('a server that completes the SDK initialize handshake is connected in the catalog', async () => {
    const workspaceDir = tempWorkspaceDir('probe');
    const probePath = join(workspaceDir, 'probe.mjs');
    await writeExecutable(
      probePath,
      `#!/usr/bin/env node
import { McpServer } from ${JSON.stringify(SDK_SERVER_MCP_PATH)};
import { StdioServerTransport } from ${JSON.stringify(SDK_SERVER_STDIO_PATH)};

const server = new McpServer({ name: "rc08a-probe", version: "1.0.0" });
server.tool("rc08a_probe", "RC-08A probe", async () => ({
  content: [{ type: "text", text: "probe-ok" }],
}));
await server.connect(new StdioServerTransport());
`,
    );

    const sessionId = `rc08a-probe-${Date.now()}`;
    const runtime = createSessionMcpRuntime({
      sessionId,
      sessionKey: 'rc08a:probe',
      workspaceDir,
      cfg: {
        mcp: {
          servers: {
            rc08aProbe: {
              command: 'node',
              args: [probePath],
              transport: 'stdio',
            },
          },
        },
      } as never,
    });
    try {
      const catalog = await runtime.getCatalog();
      // Real SDK initialize handshake completed -> connected, never from config presence.
      expect(catalog.servers.rc08aProbe).toBeDefined();
      expect(catalog.servers.rc08aProbe.transportType).toBe('stdio');
      expect(catalog.servers.rc08aProbe.health).toEqual({
        ok: true,
        connected: true,
        handshake: 'sdk-initialize',
      });
      // Catalog and runtime support match: the listed tool is exposed.
      expect(catalog.tools.map((tool) => tool.toolName)).toContain('rc08a_probe');
      // No fake-connected state anywhere in the catalog.
      for (const server of Object.values(catalog.servers)) {
        expect(server.health?.connected).toBe(true);
      }
    } finally {
      await runtime.dispose();
    }
  });

  it('a server that fails the handshake is absent from the catalog (no fake-connected state)', async () => {
    const workspaceDir = tempWorkspaceDir('broken');
    const sessionId = `rc08a-broken-${Date.now()}`;
    const runtime = createSessionMcpRuntime({
      sessionId,
      sessionKey: 'rc08a:broken',
      workspaceDir,
      cfg: {
        mcp: {
          servers: {
            broken: {
              command: 'node',
              // A missing entry script makes the child exit before any handshake.
              args: [join(workspaceDir, 'does-not-exist.mjs')],
              transport: 'stdio',
            },
          },
        },
      } as never,
    });
    try {
      const catalog = await runtime.getCatalog();
      // The server never connected: no catalog entry, so it can never report connected.
      expect(catalog.servers.broken).toBeUndefined();
      expect(catalog.diagnostics?.some((entry) => entry.serverName === 'broken')).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });
});
