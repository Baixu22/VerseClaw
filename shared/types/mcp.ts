import type { WorkspacePermissionMode } from './workspace';

export type McpTransport = 'stdio' | 'http' | 'streamable-http' | 'sse' | 'websocket';
export type McpCanonicalTransport = 'stdio' | 'streamable-http' | 'sse' | 'websocket';
export type McpScope = 'global' | 'agent' | 'workspace';
export type McpNetworkPolicy = 'disabled' | 'localOnly' | 'enabled';
export type McpRuntimeStatus = 'unknown' | 'registered' | 'connecting' | 'connected' | 'error';

export interface McpExposureConfig {
  agents?: string[];
  workspaces?: string[];
  roles?: string[];
}

export interface McpServerConfig {
  id: string;
  name: string;
  localAddress?: string;
  transport: McpTransport;
  canonicalTransport?: McpCanonicalTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  /** Env values are SecretRef or legacy plaintext in Main store; Renderer always receives masked strings. */
  env?: Record<string, string | { kind: 'secret-ref'; secretId: string }>;
  headers?: Record<string, string>;
  /** HTTP TLS verification; default true for remote transports. */
  sslVerify?: boolean;
  enabled: boolean;
  scope: McpScope;
  ownerId?: string;
  exposure?: McpExposureConfig;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  permissionMode?: WorkspacePermissionMode;
  sandboxProfileId?: string;
  networkPolicy?: McpNetworkPolicy;
  runtimeStatus?: McpRuntimeStatus;
  lastHeartbeatAt?: number;
  lastHeartbeatMs?: number;
  lastHeartbeatError?: string;
  toolCount?: number;
  createdAt: number;
  updatedAt: number;
}

export interface McpResolvedConfig {
  servers: McpServerConfig[];
  workspaceId?: string | null;
  agentId?: string | null;
  updatedAt: number;
}

export interface McpServerTestResult {
  success: boolean;
  error?: string;
  server?: McpServerConfig;
  message?: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  serverId?: string;
}

export interface McpListToolsResult {
  success: boolean;
  serverId: string;
  tools: McpToolInfo[];
  status: McpRuntimeStatus;
  latencyMs?: number;
  message?: string;
  error?: string;
}

export interface McpHeartbeatResult {
  success: boolean;
  serverId: string;
  status: McpRuntimeStatus;
  latencyMs?: number;
  message?: string;
  error?: string;
  server?: McpServerConfig;
}

export interface McpCallToolResult {
  success: boolean;
  serverId: string;
  toolName: string;
  result?: unknown;
  blocked?: boolean;
  approvalRequired?: boolean;
  approvalId?: string;
  reason?: string;
  error?: string;
}

export interface McpReloadRuntimeResult {
  success: boolean;
  workspaceId?: string | null;
  agentId?: string | null;
  serverCount: number;
  hotReloaded: boolean;
  restartRequired: boolean;
  message?: string;
  error?: string;
}
