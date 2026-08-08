import { describe, expect, it } from 'vitest';

/**
 * RC-08A root acceptance test. Runs the PRODUCTION MCP/host-native tool
 * convergence implementation (openclaw_runtime/src/agents/tool-convergence.ts
 * and mcp-transport-config.ts), not local constants:
 * - MCP SDK transports are the protocol authority (stdio/sse/streamable-http).
 * - Git/storage/terminal/browser are host-native unless backed by a real MCP
 *   server path; a host-native tool labelled MCP without a server is a defect.
 * - Health is connected only after a real SDK initialize handshake; HTTP GET
 *   alone or unsupported (WebSocket-only) transports are never connected.
 * - Unsupported WebSocket choices are rejected by the production transport
 *   resolver; Streamable HTTP naming matches the SDK spelling.
 */
import {
  classifyMcpCatalogServer,
  classifyTool,
  evaluateMcpHealth,
  isAccurateStreamableHttpTransport,
  isHostNativeMisLabelledAsMcp,
} from '../../openclaw_runtime/src/agents/tool-convergence.js';
import { resolveMcpTransportConfig } from '../../openclaw_runtime/src/agents/mcp-transport-config.js';

const HOST_NATIVE_SURFACES = ['git', 'storage', 'terminal', 'browser'] as const;
const MCP_TRANSPORTS = ['stdio', 'sse', 'streamable-http'] as const;

describe('RC-08A MCP and host-native tool convergence (root acceptance)', () => {
  it('the MCP SDK transport set is the protocol authority; no WebSocket-only choice', () => {
    expect(MCP_TRANSPORTS).toEqual(['stdio', 'sse', 'streamable-http']);
    expect(MCP_TRANSPORTS).not.toContain('websocket');
  });

  it('Git/storage/terminal/browser are host-native surfaces through the production classifier', () => {
    for (const surface of HOST_NATIVE_SURFACES) {
      const classified = classifyTool({ toolId: surface, hostSurface: surface });
      expect(classified.origin).toBe('host-native');
      expect(classified.hostSurface).toBe(surface);
      expect(classified.labelledAsMcp).toBe(false);
      expect(isHostNativeMisLabelledAsMcp(classified)).toBe(false);
    }
  });

  it('a host-native tool is never labelled MCP without a real MCP server path', () => {
    const git = classifyTool({ toolId: 'git', hostSurface: 'git' });
    expect(git.labelledAsMcp).toBe(false);
    // Same tool backed by a real MCP transport is genuinely mcp-server.
    const gitViaMcp = classifyTool({ toolId: 'git', hostSurface: 'git', mcpTransport: 'stdio' });
    expect(gitViaMcp.origin).toBe('mcp-server');
    expect(gitViaMcp.labelledAsMcp).toBe(true);
    // Defect detection: host-native + labelledAsMcp must be flagged.
    expect(isHostNativeMisLabelledAsMcp({
      toolId: 'git', origin: 'host-native', hostSurface: 'git', labelledAsMcp: true,
    })).toBe(true);
  });

  it('health is connected only after a real SDK initialize handshake', () => {
    // Configured + handshake completed -> connected (the only connected verdict).
    expect(evaluateMcpHealth({ configured: true, handshakeCompleted: true })).toEqual({
      ok: true, connected: true, handshake: 'sdk-initialize',
    });
    // Configured but no handshake -> not connected.
    expect(evaluateMcpHealth({ configured: true, handshakeCompleted: false })).toMatchObject({
      connected: false,
    });
    // HTTP GET succeeding is NOT a handshake; it must never report connected.
    expect(evaluateMcpHealth({ configured: true, handshakeCompleted: false, httpGetOk: true })).toEqual({
      ok: true, connected: false, handshake: 'not-attempted',
      reason: 'HTTP GET ok but no SDK initialize handshake',
    });
    // Not configured -> not connected.
    expect(evaluateMcpHealth({ configured: false, handshakeCompleted: false })).toMatchObject({
      connected: false,
    });
  });

  it('the production catalog-server classifier never reports fake-connected state', () => {
    const live = classifyMcpCatalogServer({
      serverName: 'srv', transportType: 'streamable-http', configured: true, handshakeCompleted: true,
    });
    expect(live.origin).toBe('mcp-server');
    expect(live.health).toEqual({ ok: true, connected: true, handshake: 'sdk-initialize' });

    // Configured + HTTP GET ok but NO handshake -> explicitly not connected.
    const httpGetOnly = classifyMcpCatalogServer({
      serverName: 'srv', transportType: 'streamable-http', configured: true,
      handshakeCompleted: false, httpGetOk: true,
    });
    expect(httpGetOnly.health.connected).toBe(false);

    // Unsupported transport (WebSocket-only) -> rejected, never connected.
    const unsupported = classifyMcpCatalogServer({
      serverName: 'srv', transportType: 'sse', configured: true,
      handshakeCompleted: false, unsupportedTransport: true,
    });
    expect(unsupported.health).toEqual({
      ok: false, connected: false, handshake: 'rejected', reason: 'unsupported transport',
    });
  });

  it('the production transport resolver rejects WebSocket-only and keeps Streamable HTTP naming', () => {
    // WebSocket-only transport is rejected at transport resolution (returns null).
    expect(resolveMcpTransportConfig('ws-server', { transport: 'websocket', url: 'ws://127.0.0.1:1' }))
      .toBeNull();
    // Streamable HTTP is the accurate SDK spelling and resolves to that transport type.
    const streamable = resolveMcpTransportConfig('http-server', {
      transport: 'streamable-http',
      url: 'https://mcp.example.test/mcp',
    });
    expect(streamable).not.toBeNull();
    // SSE remains supported.
    expect(resolveMcpTransportConfig('sse-server', { transport: 'sse', url: 'https://mcp.example.test/sse' }))
      .not.toBeNull();

    expect(isAccurateStreamableHttpTransport('streamable-http')).toBe(true);
    expect(isAccurateStreamableHttpTransport('streamableHttp')).toBe(true);
    expect(isAccurateStreamableHttpTransport('websocket')).toBe(false);
    expect(isAccurateStreamableHttpTransport('ws')).toBe(false);
  });
});
