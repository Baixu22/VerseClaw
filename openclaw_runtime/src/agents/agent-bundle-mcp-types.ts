/** Shared bundle MCP catalog, runtime, and manager types. */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TSchema } from "typebox";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { AnyAgentTool } from "./tools/common.js";
import type { McpHealthVerdict, TransportType } from "./tool-convergence.js";

/** Materialized MCP tools plus diagnostics and cleanup handle for one run. */
export type BundleMcpToolRuntime = {
  tools: AnyAgentTool[];
  diagnostics?: readonly McpToolCatalogDiagnostic[];
  dispose: () => Promise<void>;
};

/** Catalog metadata for one configured MCP server. */
export type McpServerCatalog = {
  serverName: string;
  safeServerName?: string;
  launchSummary: string;
  toolCount: number;
  /** The transport that actually backed the SDK handshake for this server. */
  transportType?: TransportType;
  /**
   * RC-08A health verdict for this server. Connected requires the real SDK
   * initialize handshake; configuration presence or an HTTP GET alone is never
   * connected. Omitted only when the server never produced a catalog entry.
   */
  health?: McpHealthVerdict;
  resources?: {
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  tools?: {
    listChanged?: boolean;
    filteredCount?: number;
  };
  requestTimeoutMs?: number;
  supportsParallelToolCalls?: boolean;
  toolFilter?: {
    include?: string[];
    exclude?: string[];
  };
};

/** MCP tool entry after server-name sanitization and schema normalization. */
export type McpCatalogTool = {
  serverName: string;
  safeServerName: string;
  toolName: string;
  title?: string;
  description?: string;
  inputSchema: TSchema;
  fallbackDescription: string;
  /**
   * Trusted app configuration says this server is read-only. Provider/MCP
   * annotations are not used as a grant; this flag comes only from the stored
   * server permissionMode.
   */
  trustedReadOnly?: boolean;
};

/** Complete tool catalog for a session-scoped MCP runtime. */
export type McpToolCatalog = {
  version: number;
  generatedAt: number;
  servers: Record<string, McpServerCatalog>;
  tools: McpCatalogTool[];
  diagnostics?: readonly McpToolCatalogDiagnostic[];
};

export type McpToolCatalogDiagnostic = {
  serverName: string;
  safeServerName: string;
  launchSummary: string;
  message: string;
  errorCode?: number;
};

/** Live MCP runtime bound to one session/workspace. */
export type SessionMcpRuntime = {
  sessionId: string;
  sessionKey?: string;
  workspaceDir: string;
  configFingerprint: string;
  createdAt: number;
  lastUsedAt: number;
  activeLeases?: number;
  acquireLease?: () => () => void;
  /** Lists tools if needed and may connect MCP transports. */
  getCatalog: () => Promise<McpToolCatalog>;
  /** Returns the cached catalog only; must not start runtimes, connect transports, or issue tools/list. */
  peekCatalog: () => McpToolCatalog | null;
  markUsed: () => void;
  callTool: (serverName: string, toolName: string, input: unknown) => Promise<CallToolResult>;
  ping?: (serverName: string) => Promise<void>;
  listResources?: (serverName: string) => Promise<unknown>;
  readResource?: (serverName: string, uri: string) => Promise<unknown>;
  listPrompts?: (serverName: string) => Promise<unknown>;
  getPrompt?: (serverName: string, name: string, args?: Record<string, string>) => Promise<unknown>;
  dispose: () => Promise<void>;
};

/** Manager for session-scoped MCP runtimes and their idle lifecycle. */
export type SessionMcpRuntimeManager = {
  getOrCreate: (params: {
    sessionId: string;
    sessionKey?: string;
    workspaceDir: string;
    cfg?: OpenClawConfig;
    agentId?: string | null;
    workspaceId?: string | null;
    roleName?: string | null;
  }) => Promise<SessionMcpRuntime>;
  bindSessionKey: (sessionKey: string, sessionId: string) => void;
  resolveSessionId: (sessionKey: string) => string | undefined;
  /** Looks up an existing runtime only; must not create runtimes or connect transports. */
  peekSession: (params: {
    sessionId?: string;
    sessionKey?: string;
  }) => SessionMcpRuntime | undefined;
  disposeSession: (sessionId: string) => Promise<void>;
  disposeAll: () => Promise<void>;
  sweepIdleRuntimes: () => Promise<number>;
  listSessionIds: () => string[];
};
