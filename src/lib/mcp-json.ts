import type { McpServerConfig } from '@shared/types/mcp';

type McpServerJsonPayload = Omit<McpServerConfig, 'id' | 'localAddress' | 'createdAt' | 'updatedAt'> & {
  id?: string;
  localAddress?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeJsonStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const entries = value.map((entry) => String(entry).trim()).filter(Boolean);
    return entries.length > 0 ? entries : undefined;
  }
  if (typeof value === 'string') {
    const entries = value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
    return entries.length > 0 ? entries : undefined;
  }
  return undefined;
}

function normalizeMcpJsonServer(name: string, value: unknown): McpServerJsonPayload {
  if (!isRecord(value)) throw new Error('MCP server configuration must be an object');
  const input = value;
  if (input.headers !== undefined && (!isRecord(input.headers) || Object.values(input.headers).some(entry => typeof entry !== 'string'))) {
    throw new Error('MCP headers must be a string map');
  }
  if (input.sslVerify !== undefined && typeof input.sslVerify !== 'boolean') throw new Error('MCP sslVerify must be boolean');
  if (input.exposure !== undefined && (!isRecord(input.exposure) || Object.entries(input.exposure).some(([key, entries]) =>
    !['agents', 'workspaces', 'roles'].includes(key) || !Array.isArray(entries)
      || entries.some(entry => typeof entry !== 'string' || !entry.trim())))) {
    throw new Error('MCP exposure must contain arrays of agent, workspace or role identifiers');
  }
  const transport = typeof input.transport === 'string'
    ? input.transport
    : typeof input.url === 'string'
      ? 'http'
      : 'stdio';
  return {
    id: typeof input.id === 'string' ? input.id : undefined,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : name,
    localAddress: typeof input.localAddress === 'string' && input.localAddress.trim()
      ? input.localAddress.trim()
      : `clawx://mcp/${encodeURIComponent(typeof input.id === 'string' && input.id.trim() ? input.id.trim() : name)}`,
    transport: transport as McpServerConfig['transport'],
    command: typeof input.command === 'string' ? input.command : undefined,
    args: normalizeJsonStringArray(input.args),
    cwd: typeof input.cwd === 'string' ? input.cwd : undefined,
    url: typeof input.url === 'string' ? input.url : undefined,
    headers: input.headers as McpServerConfig['headers'],
    exposure: input.exposure as McpServerConfig['exposure'],
    sslVerify: input.sslVerify as boolean | undefined,
    env: isRecord(input.env)
      ? Object.fromEntries(Object.entries(input.env).map(([key, raw]) => [key, String(raw)]))
      : undefined,
    enabled: input.enabled !== false,
    scope: (typeof input.scope === 'string' ? input.scope : 'global') as McpServerConfig['scope'],
    ownerId: typeof input.ownerId === 'string' ? input.ownerId : undefined,
    toolAllowlist: normalizeJsonStringArray(input.toolAllowlist ?? input.allowedTools),
    toolDenylist: normalizeJsonStringArray(input.toolDenylist ?? input.deniedTools),
    permissionMode: input.permissionMode as McpServerConfig['permissionMode'],
    sandboxProfileId: typeof input.sandboxProfileId === 'string' ? input.sandboxProfileId : undefined,
    networkPolicy: input.networkPolicy as McpServerConfig['networkPolicy'],
  };
}

export function parseMcpJsonConfigs(value: string, invalidObjectMessage: string): McpServerJsonPayload[] {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error(invalidObjectMessage);
  if (isRecord(parsed.mcpServers)) {
    return Object.entries(parsed.mcpServers).map(([name, config]) => normalizeMcpJsonServer(name, config));
  }
  return [normalizeMcpJsonServer('mcp-server', parsed)];
}

export function mcpServerToJson(server: McpServerConfig): string {
  const payload: McpServerJsonPayload = {
    id: server.id,
    name: server.name,
    localAddress: server.localAddress,
    transport: server.transport,
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    url: server.url,
    headers: server.headers,
    exposure: server.exposure,
    sslVerify: server.sslVerify,
    env: server.env,
    enabled: server.enabled,
    scope: server.scope,
    ownerId: server.ownerId,
    toolAllowlist: server.toolAllowlist,
    toolDenylist: server.toolDenylist,
    permissionMode: server.permissionMode,
    sandboxProfileId: server.sandboxProfileId,
    networkPolicy: server.networkPolicy,
  };
  return JSON.stringify(payload, null, 2);
}

