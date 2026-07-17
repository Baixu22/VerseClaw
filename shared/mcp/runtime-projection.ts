/**
 * Project MCP UI security fields into runtime config and enforce network policy.
 */

export type McpNetworkPolicy = 'disabled' | 'localOnly' | 'enabled';

export type McpSecurityProjectionSource = {
  permissionMode?: string;
  sandboxProfileId?: string;
  networkPolicy?: McpNetworkPolicy;
  sslVerify?: boolean;
  headers?: Record<string, string>;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  env?: Record<string, string>;
  transport?: string;
  url?: string;
};

export type McpRuntimeProjection = Record<string, unknown>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLocalMcpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Merge security-relevant fields from app MCP server config into OpenClaw runtime entry.
 */
export function projectMcpSecurityFields(
  server: McpSecurityProjectionSource,
  target: McpRuntimeProjection = {},
): McpRuntimeProjection {
  const next: McpRuntimeProjection = { ...target };

  if (server.permissionMode) {
    next.permissionMode = server.permissionMode;
  } else {
    delete next.permissionMode;
  }

  if (server.sandboxProfileId) {
    next.sandboxProfileId = server.sandboxProfileId;
  } else {
    delete next.sandboxProfileId;
  }

  if (server.networkPolicy) {
    next.networkPolicy = server.networkPolicy;
  } else {
    delete next.networkPolicy;
  }

  if (server.sslVerify !== undefined) {
    next.sslVerify = server.sslVerify;
    next.ssl_verify = server.sslVerify;
  }

  if (server.headers && Object.keys(server.headers).length > 0) {
    next.headers = { ...server.headers };
  } else {
    delete next.headers;
  }

  if (server.env && Object.keys(server.env).length > 0) {
    next.env = { ...server.env };
  } else {
    delete next.env;
  }

  if (server.toolAllowlist || server.toolDenylist) {
    next.toolFilter = {
      ...(server.toolAllowlist ? { include: server.toolAllowlist } : {}),
      ...(server.toolDenylist ? { exclude: server.toolDenylist } : {}),
    };
  } else {
    delete next.toolFilter;
  }

  return next;
}

export type NetworkPolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Evaluate whether a server may perform network I/O under its networkPolicy.
 * stdio transport never needs remote network access.
 */
export function evaluateMcpNetworkPolicy(server: {
  transport?: string;
  networkPolicy?: McpNetworkPolicy;
  url?: string;
}): NetworkPolicyDecision {
  const transport = server.transport ?? 'stdio';
  if (transport === 'stdio') {
    return { allowed: true };
  }

  const policy = server.networkPolicy ?? 'localOnly';
  if (policy === 'disabled') {
    return { allowed: false, reason: 'MCP network policy is disabled; remote MCP I/O is blocked' };
  }
  if (policy === 'enabled') {
    return { allowed: true };
  }
  // localOnly
  if (!server.url || !isLocalMcpUrl(server.url)) {
    return {
      allowed: false,
      reason: 'localOnly network policy only allows localhost / 127.0.0.1 MCP endpoints',
    };
  }
  return { allowed: true };
}

export function assertMcpNetworkPolicyAllows(server: {
  transport?: string;
  networkPolicy?: McpNetworkPolicy;
  url?: string;
}): void {
  const decision = evaluateMcpNetworkPolicy(server);
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
}
