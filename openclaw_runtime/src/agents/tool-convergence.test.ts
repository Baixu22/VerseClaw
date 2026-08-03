import { describe, expect, it } from 'vitest';

import {
  classifyTool,
  evaluateMcpHealth,
  isAccurateStreamableHttpTransport,
  isHostNativeMisLabelledAsMcp,
} from './tool-convergence.js';

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
});
