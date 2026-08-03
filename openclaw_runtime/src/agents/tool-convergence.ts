// RC-08A MCP and host-native tool convergence. Keeps the MCP SDK runtime as the
// external protocol authority, makes Work Provider a catalog/projection, labels
// Git/storage/terminal/browser tools as host-native unless backed by a real MCP
// server, and corrects health so it requires a real MCP handshake (SDK initialize)
// — configuration presence or HTTP GET alone is never "connected".

export const TOOL_CONVERGENCE_FLAG = 'rc08a.toolConvergence';
export const TOOL_CONVERGENCE_SCHEMA_VERSION = '1';

export type TransportType = 'stdio' | 'sse' | 'streamable-http';

export type ToolOrigin = 'mcp-server' | 'host-native' | 'catalog-projection';

export type ToolClassification = {
  toolId: string;
  origin: ToolOrigin;
  /** When origin is host-native: the backing host surface (git/storage/terminal/browser). */
  hostSurface?: 'git' | 'storage' | 'terminal' | 'browser';
  /** When origin is mcp-server: the real MCP server transport that backs it. */
  mcpTransport?: TransportType;
  /** A host-native tool must never be labelled MCP without a real MCP server path. */
  labelledAsMcp: boolean;
};

/**
 * Classify a tool. A tool is mcp-server only when it is backed by a real MCP
 * server transport (stdio/sse/streamable-http). Otherwise it is host-native
 * (git/storage/terminal/browser) or a catalog projection.
 */
export function classifyTool(input: {
  toolId: string;
  hostSurface?: 'git' | 'storage' | 'terminal' | 'browser';
  mcpTransport?: TransportType;
  isWorkProviderCatalogEntry?: boolean;
}): ToolClassification {
  const hasRealMcpTransport =
    input.mcpTransport === 'stdio' ||
    input.mcpTransport === 'sse' ||
    input.mcpTransport === 'streamable-http';
  if (hasRealMcpTransport) {
    return {
      toolId: input.toolId,
      origin: 'mcp-server',
      mcpTransport: input.mcpTransport,
      labelledAsMcp: true,
    };
  }
  if (input.isWorkProviderCatalogEntry) {
    return {
      toolId: input.toolId,
      origin: 'catalog-projection',
      labelledAsMcp: false,
    };
  }
  return {
    toolId: input.toolId,
    origin: 'host-native',
    hostSurface: input.hostSurface ?? 'browser',
    labelledAsMcp: false,
  };
}

/** A host-native tool labelled as MCP without a real MCP server is a defect. */
export function isHostNativeMisLabelledAsMcp(classification: ToolClassification): boolean {
  return classification.origin === 'host-native' && classification.labelledAsMcp === true;
}

export type McpHealthVerdict =
  | { ok: true; connected: true; handshake: 'sdk-initialize' }
  | { ok: true; connected: false; handshake: 'not-attempted'; reason: string }
  | { ok: false; connected: false; handshake: 'rejected'; reason: string };

/**
 * Correct MCP health: connected requires a real SDK initialize handshake.
 * Configuration presence (command/url present) or an HTTP GET that returns a
 * body is not connected — it only means the server is configured.
 */
export function evaluateMcpHealth(input: {
  configured: boolean;
  handshakeCompleted: boolean;
  httpGetOk?: boolean;
  unsupportedTransport?: boolean;
}): McpHealthVerdict {
  if (input.unsupportedTransport === true) {
    return { ok: false, connected: false, handshake: 'rejected', reason: 'unsupported transport' };
  }
  if (!input.configured) {
    return { ok: true, connected: false, handshake: 'not-attempted', reason: 'not configured' };
  }
  if (!input.handshakeCompleted) {
    // HTTP GET succeeding is NOT a handshake; it must not be reported as connected.
    if (input.httpGetOk === true) {
      return { ok: true, connected: false, handshake: 'not-attempted', reason: 'HTTP GET ok but no SDK initialize handshake' };
    }
    return { ok: true, connected: false, handshake: 'not-attempted', reason: 'no SDK initialize handshake' };
  }
  return { ok: true, connected: true, handshake: 'sdk-initialize' };
}

/** Streamable HTTP naming check: "streamable-http" is the SDK spelling. */
export function isAccurateStreamableHttpTransport(transport: string | undefined): boolean {
  if (transport === undefined) return true;
  if (transport === 'streamable-http' || transport === 'streamableHttp') return true;
  // WebSocket-only choices are unsupported and must be rejected, not aliased.
  if (transport.toLowerCase().includes('websocket')) return false;
  return false;
}
