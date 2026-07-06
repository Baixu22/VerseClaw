import type {
  McpCanonicalTransport,
  McpCallToolResult,
  McpHeartbeatResult,
  McpListToolsResult,
  McpScope,
  McpServerConfig,
  McpTransport,
} from '@shared/types/mcp';
import type {
  McpCallToolPayload,
  McpHeartbeatPayload,
  McpListToolsPayload,
  McpReloadRuntimePayload,
  McpServerCreatePayload,
  McpServerUpdatePayload,
} from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { SystemScanCategoryId } from '@shared/host-api/contract';
import type { GatewayManager } from '../gateway/manager';
import { isRecord } from './payload-utils';
import { readAgentBootstrapTools } from '../utils/agent-config';
import { readOpenClawConfig, writeOpenClawConfig } from '../utils/channel-config';
import { withConfigLock } from '../utils/config-mutex';
import { getDataDir } from '../utils/paths';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { createGitApi } from './git-api';
import { createSystemApi } from './system-api';
import {
  createMcpToolCallRequestShadow,
  createMcpToolCallResultShadow,
  createMcpToolCallThrownErrorShadow,
  emitToolProtocolShadow,
} from './tool-protocol-shadow';
import type { McpToolCallShadowRecord } from './tool-protocol-shadow';
import {
  createMcpToolProviderRegistryRequestShadow,
  createMcpToolProviderRegistryResultShadow,
  emitMcpToolProviderRegistryShadow,
} from './tool-provider-registry';
import type { McpToolProviderRegistryShadowRecord } from './tool-provider-registry';

type McpStoreDocument = {
  servers: McpServerConfig[];
};

type McpApiContext = {
  gatewayManager?: GatewayManager;
  runtime?: {
    toolProtocol?: {
      mcpShadow?: boolean;
    };
    toolRegistry?: {
      shadow?: boolean;
    };
  };
  toolProtocolShadowSink?: (record: McpToolCallShadowRecord) => void;
  toolProviderRegistryShadowSink?: (record: McpToolProviderRegistryShadowRecord) => void;
};

const VALID_TRANSPORTS = new Set<McpTransport>(['stdio', 'http', 'streamable-http', 'sse', 'websocket']);
const VALID_SCOPES = new Set<McpScope>(['global', 'agent', 'workspace']);
const DEFAULT_TRANSPORT: McpTransport = 'stdio';
const DEFAULT_SCOPE: McpScope = 'global';
const MAX_MCP_SERVERS = 200;
const VERSE_CLAW_GIT_MCP_SERVER_ID = 'clawx-git';

const VERSE_CLAW_GIT_MCP_SERVER: McpServerConfig = {
  id: VERSE_CLAW_GIT_MCP_SERVER_ID,
  name: 'Verse Claw Git',
  localAddress: 'clawx://mcp/clawx-git',
  transport: 'stdio',
  canonicalTransport: 'stdio',
  enabled: true,
  scope: 'workspace',
  ownerId: '*',
  networkPolicy: 'disabled',
  runtimeStatus: 'connected',
  toolCount: 27,
  createdAt: 1,
  updatedAt: 1,
};

const VERSE_CLAW_GIT_MCP_TOOLS = [
  {
    name: 'git_status',
    description: 'Read the active workspace Git status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_diff',
    description: 'Read the active workspace Git patch and changed file list.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['unstaged', 'staged'] },
      },
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_file_diff',
    description: 'Read a Git diff for one workspace file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        mode: { type: 'string', enum: ['unstaged', 'staged'] },
      },
      required: ['path'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_stage',
    description: 'Stage one or more workspace files.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' } },
        approvalId: { type: 'string' },
      },
      required: ['paths'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_unstage',
    description: 'Unstage one or more workspace files.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' } },
        approvalId: { type: 'string' },
      },
      required: ['paths'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_revert_file',
    description: 'Revert one workspace file through the host approval flow.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        approvalId: { type: 'string' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_commit',
    description: 'Commit staged changes in the active workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        approvalId: { type: 'string' },
      },
      required: ['message'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_branch_list',
    description: 'List local branches for the active workspace repository.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_checkout_branch',
    description: 'Checkout an existing branch through the host permission flow.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        approvalId: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_create_branch',
    description: 'Create a branch, optionally checking it out.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        startPoint: { type: 'string' },
        checkout: { type: 'boolean' },
        approvalId: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_stash_list',
    description: 'List Git stash entries for the active workspace repository.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_stash_push',
    description: 'Create a Git stash through the host permission flow.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        includeUntracked: { type: 'boolean' },
        approvalId: { type: 'string' },
      },
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_stash_apply',
    description: 'Apply a Git stash through the host approval flow.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        approvalId: { type: 'string' },
      },
      required: ['selector'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_stash_pop',
    description: 'Pop a Git stash through the host approval flow.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        approvalId: { type: 'string' },
      },
      required: ['selector'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_worktree_list',
    description: 'List Git worktrees for the active workspace repository.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_worktree_add',
    description: 'Add a Git worktree through the host permission flow.',
    inputSchema: {
      type: 'object',
      properties: {
        branch: { type: 'string' },
        path: { type: 'string' },
        startPoint: { type: 'string' },
        checkoutNewBranch: { type: 'boolean' },
        approvalId: { type: 'string' },
      },
      required: ['branch'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_worktree_remove',
    description: 'Remove a Git worktree through the host approval flow.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        approvalId: { type: 'string' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_worktree_prune',
    description: 'Prune stale Git worktree metadata through the host approval flow.',
    inputSchema: {
      type: 'object',
      properties: {
        approvalId: { type: 'string' },
      },
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_fetch',
    description: 'Fetch remote refs through the host permission flow.',
    inputSchema: {
      type: 'object',
      properties: {
        remote: { type: 'string' },
        approvalId: { type: 'string' },
      },
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_pull',
    description: 'Pull remote changes through the host approval flow.',
    inputSchema: {
      type: 'object',
      properties: {
        remote: { type: 'string' },
        branch: { type: 'string' },
        rebase: { type: 'boolean' },
        approvalId: { type: 'string' },
      },
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_push',
    description: 'Push commits through the host approval flow.',
    inputSchema: {
      type: 'object',
      properties: {
        remote: { type: 'string' },
        branch: { type: 'string' },
        setUpstream: { type: 'boolean' },
        approvalId: { type: 'string' },
      },
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'github_auth_status',
    description: 'Read gh CLI authentication status for the active workspace.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'github_repo',
    description: 'Read GitHub repository metadata for the active workspace.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'github_pr_list',
    description: 'List GitHub pull requests for the active workspace repository.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['open', 'closed', 'merged', 'all'] },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'github_pr_view',
    description: 'View one GitHub pull request by number.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'number' },
      },
      required: ['number'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'github_pr_create',
    description: 'Create a GitHub pull request using gh CLI.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        base: { type: 'string' },
        head: { type: 'string' },
        draft: { type: 'boolean' },
        approvalId: { type: 'string' },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'github_open_pr',
    description: 'Open a GitHub pull request in the default browser.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'number' },
      },
      required: ['number'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
];

const VERSE_CLAW_STORAGE_MCP_SERVER_ID = 'clawx-storage';

const VERSE_CLAW_STORAGE_MCP_SERVER: McpServerConfig = {
  id: VERSE_CLAW_STORAGE_MCP_SERVER_ID,
  name: 'Verse Claw Storage',
  localAddress: 'clawx://mcp/clawx-storage',
  transport: 'stdio',
  canonicalTransport: 'stdio',
  enabled: true,
  scope: 'workspace',
  ownerId: '*',
  networkPolicy: 'disabled',
  runtimeStatus: 'connected',
  toolCount: 4,
  createdAt: 1,
  updatedAt: 1,
};

const VERSE_CLAW_STORAGE_MCP_TOOLS = [
  {
    name: 'storage_info',
    description: 'Read a snapshot of system RAM, disk, and CPU usage. Use this first to assess resource pressure.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    serverId: VERSE_CLAW_STORAGE_MCP_SERVER_ID,
  },
  {
    name: 'storage_scan',
    description: 'Scan app-owned data directories (logs, sessions, trajectories, media, uv cache, electron cache, trash) and return categorized item lists with sizes. Pass categories to filter.',
    inputSchema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['logs', 'sessions', 'trajectories', 'mediaOutbound', 'mediaThumbs', 'uvCache', 'electronCache', 'trash'],
          },
        },
      },
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_STORAGE_MCP_SERVER_ID,
  },
  {
    name: 'storage_delete',
    description: 'Delete selected storage items. Always call with dryRun=true first to obtain an approvalId, then call again with dryRun=false and the approvalId to perform the real deletion. Real deletion requires a valid approvalId from a dry-run within the last 60 seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              path: { type: 'string' },
            },
            required: ['id', 'path'],
          },
        },
        dryRun: { type: 'boolean' },
        approvalId: { type: 'string' },
      },
      required: ['items', 'dryRun'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_STORAGE_MCP_SERVER_ID,
  },
  {
    name: 'storage_recommend',
    description: 'Scan storage and return a ranked list of recommended items to delete (largest first). Use this to help the user decide what to clean up.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_STORAGE_MCP_SERVER_ID,
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mcpStoreInstance: any = null;

async function getMcpStore() {
  if (!mcpStoreInstance) {
    const Store = (await import('electron-store')).default;
    const options = {
      name: 'mcp-servers',
      projectName: 'Verse Claw',
      cwd: getDataDir(),
      defaults: {
        servers: [],
      },
    };
    mcpStoreInstance = new Store<McpStoreDocument>(
      // electron-store forwards this to conf, which requires projectName
      // outside Electron. The published types do not expose that option.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options as any,
    );
  }
  return mcpStoreInstance;
}

function createId(name: string, existingIds: Set<string>): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'mcp-server';
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function createMcpLocalAddress(id: string): string {
  return `clawx://mcp/${encodeURIComponent(id)}`;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    return value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean);
  }
  if (!Array.isArray(value)) return undefined;
  const values = value.map((entry) => normalizeString(entry)).filter((entry): entry is string => Boolean(entry));
  return values.length > 0 ? values : undefined;
}

function normalizeExposure(value: unknown): McpServerConfig['exposure'] {
  if (!isRecord(value)) return undefined;
  const exposure = {
    agents: normalizeStringArray(value.agents),
    workspaces: normalizeStringArray(value.workspaces),
    roles: normalizeStringArray(value.roles),
  };
  return exposure.agents || exposure.workspaces || exposure.roles ? exposure : undefined;
}

function normalizeEnv(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const env: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    if (typeof rawValue === 'string') {
      env[normalizedKey] = rawValue;
    } else if (rawValue != null) {
      env[normalizedKey] = String(rawValue);
    }
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

function normalizeTransport(value: unknown): McpTransport {
  return typeof value === 'string' && VALID_TRANSPORTS.has(value as McpTransport)
    ? value as McpTransport
    : DEFAULT_TRANSPORT;
}

function normalizeCanonicalTransport(value: unknown): McpCanonicalTransport {
  const transport = normalizeTransport(value);
  return transport === 'http' ? 'streamable-http' : transport;
}

function normalizeScope(value: unknown): McpScope {
  return typeof value === 'string' && VALID_SCOPES.has(value as McpScope)
    ? value as McpScope
    : DEFAULT_SCOPE;
}

function hydrateMcpServerAddress(server: McpServerConfig): McpServerConfig {
  const localAddress = normalizeString(server.localAddress) ?? createMcpLocalAddress(server.id);
  const canonicalTransport = normalizeCanonicalTransport(server.transport);
  const networkPolicy = server.networkPolicy ?? (server.transport === 'stdio' ? 'disabled' : 'localOnly');
  const next = { ...server, localAddress, canonicalTransport, networkPolicy };
  return (
    localAddress === server.localAddress
    && canonicalTransport === server.canonicalTransport
    && networkPolicy === server.networkPolicy
  ) ? server : next;
}

function hydrateMcpServerAddresses(servers: McpServerConfig[]): McpServerConfig[] {
  return servers.map(hydrateMcpServerAddress);
}

function validateServer(server: McpServerConfig): void {
  if (!server.name.trim()) {
    throw new Error('MCP 服务名称不能为空');
  }
  if (server.transport === 'stdio' && !server.command?.trim()) {
    throw new Error('stdio MCP 服务必须配置命令');
  }
  if (server.transport !== 'stdio' && !server.url?.trim()) {
    throw new Error('URL �?MCP 服务必须配置地址');
  }
  if (server.scope !== 'global' && !server.ownerId?.trim()) {
    throw new Error('Agent �?Workspace 作用域必须配�?ownerId');
  }
}

function buildServer(
  payload: McpServerCreatePayload,
  existingIds: Set<string>,
): McpServerConfig {
  const name = normalizeString(payload.name);
  if (!name) throw new Error('MCP 服务名称不能为空');
  const now = Date.now();
  const id = createId(name, existingIds);
  const transport = normalizeTransport(payload.transport);
  const server: McpServerConfig = {
    id,
    name,
    localAddress: normalizeString(payload.localAddress) ?? createMcpLocalAddress(id),
    transport,
    canonicalTransport: normalizeCanonicalTransport(transport),
    command: normalizeString(payload.command),
    args: normalizeStringArray(payload.args),
    cwd: normalizeString(payload.cwd),
    url: normalizeString(payload.url),
    env: normalizeEnv(payload.env),
    enabled: payload.enabled !== false,
    scope: normalizeScope(payload.scope),
    ownerId: normalizeString(payload.ownerId),
    exposure: normalizeExposure(payload.exposure),
    toolAllowlist: normalizeStringArray(payload.toolAllowlist),
    toolDenylist: normalizeStringArray(payload.toolDenylist),
    permissionMode: payload.permissionMode,
    sandboxProfileId: normalizeString(payload.sandboxProfileId),
    networkPolicy: payload.networkPolicy ?? (transport === 'stdio' ? 'disabled' : 'localOnly'),
    runtimeStatus: 'registered',
    toolCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  validateServer(server);
  return server;
}

function updateServer(current: McpServerConfig, payload: McpServerUpdatePayload): McpServerConfig {
  const transport = payload.transport === undefined ? current.transport : normalizeTransport(payload.transport);
  const next: McpServerConfig = {
    ...current,
    localAddress: payload.localAddress === undefined
      ? normalizeString(current.localAddress) ?? createMcpLocalAddress(current.id)
      : normalizeString(payload.localAddress) ?? createMcpLocalAddress(current.id),
    name: payload.name === undefined ? current.name : normalizeString(payload.name) ?? '',
    transport,
    canonicalTransport: normalizeCanonicalTransport(transport),
    command: payload.command === undefined ? current.command : normalizeString(payload.command),
    args: payload.args === undefined ? current.args : normalizeStringArray(payload.args),
    cwd: payload.cwd === undefined ? current.cwd : normalizeString(payload.cwd),
    url: payload.url === undefined ? current.url : normalizeString(payload.url),
    env: payload.env === undefined ? current.env : normalizeEnv(payload.env),
    enabled: payload.enabled === undefined ? current.enabled : payload.enabled !== false,
    scope: payload.scope === undefined ? current.scope : normalizeScope(payload.scope),
    ownerId: payload.ownerId === undefined ? current.ownerId : normalizeString(payload.ownerId),
    exposure: payload.exposure === undefined ? current.exposure : normalizeExposure(payload.exposure),
    toolAllowlist: payload.toolAllowlist === undefined ? current.toolAllowlist : normalizeStringArray(payload.toolAllowlist),
    toolDenylist: payload.toolDenylist === undefined ? current.toolDenylist : normalizeStringArray(payload.toolDenylist),
    permissionMode: payload.permissionMode === undefined ? current.permissionMode : payload.permissionMode,
    sandboxProfileId: payload.sandboxProfileId === undefined ? current.sandboxProfileId : normalizeString(payload.sandboxProfileId),
    networkPolicy: payload.networkPolicy === undefined
      ? current.networkPolicy ?? (transport === 'stdio' ? 'disabled' : 'localOnly')
      : payload.networkPolicy,
    updatedAt: Date.now(),
  };
  validateServer(next);
  return next;
}

async function readServers(): Promise<McpServerConfig[]> {
  const store = await getMcpStore();
  const servers = store.get('servers');
  if (!Array.isArray(servers)) return [];
  const hydrated = hydrateMcpServerAddresses(servers as McpServerConfig[]);
  if (hydrated.some((server, index) => server !== servers[index])) {
    store.set('servers', hydrated.slice(0, MAX_MCP_SERVERS));
  }
  return hydrated;
}

async function writeServers(servers: McpServerConfig[]): Promise<void> {
  const store = await getMcpStore();
  store.set('servers', hydrateMcpServerAddresses(servers).slice(0, MAX_MCP_SERVERS));
}

function normalizeRuntimeMcpTransport(server: McpServerConfig): 'sse' | 'streamable-http' | undefined {
  const transport = server.canonicalTransport ?? server.transport;
  if (transport === 'sse') return 'sse';
  if (transport === 'http' || transport === 'streamable-http') return 'streamable-http';
  return undefined;
}

function withMembership(values: string[] | undefined, value: string, enabled: boolean): string[] | undefined {
  const set = new Set((values ?? []).map((entry) => entry.trim()).filter(Boolean));
  if (enabled) {
    set.add(value);
  } else {
    set.delete(value);
  }
  const next = [...set].sort((a, b) => a.localeCompare(b));
  return next.length > 0 ? next : undefined;
}

function projectServerToRuntimeConfig(
  server: McpServerConfig,
  current: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  next.enabled = server.enabled !== false;
  if (server.transport === 'stdio') {
    next.command = server.command;
    next.args = server.args;
    next.cwd = server.cwd;
    delete next.url;
    delete next.transport;
  } else {
    next.url = server.url;
    const transport = normalizeRuntimeMcpTransport(server);
    if (transport) {
      next.transport = transport;
    }
    delete next.command;
    delete next.args;
  }
  if (server.env) {
    next.env = server.env;
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

export async function syncAgentMcpExposureToOpenClawConfig(
  agentId: string,
  defaultMcpServerIds: string[],
): Promise<void> {
  const selectedIds = new Set(defaultMcpServerIds);
  selectedIds.delete(VERSE_CLAW_GIT_MCP_SERVER_ID);
  selectedIds.delete(VERSE_CLAW_STORAGE_MCP_SERVER_ID);
  const servers = await readServers();
  await withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const mcp = isRecord(config.mcp) ? { ...config.mcp } as Record<string, unknown> : {};
    const currentServers = isRecord(mcp.servers)
      ? { ...(mcp.servers as Record<string, unknown>) }
      : {};
    for (const server of servers) {
      const selected = selectedIds.has(server.id);
      const existing = isRecord(currentServers[server.id])
        ? { ...(currentServers[server.id] as Record<string, unknown>) }
        : undefined;
      if (!selected && !existing) {
        continue;
      }
      const next = selected
        ? projectServerToRuntimeConfig(server, existing)
        : { ...(existing ?? {}) };
      const exposure = isRecord(next.exposure) ? { ...next.exposure } as Record<string, unknown> : {};
      const agents = withMembership(normalizeStringArray(exposure.agents), agentId, selected);
      if (agents) {
        exposure.agents = agents;
      } else {
        delete exposure.agents;
      }
      if (!selected && Object.keys(exposure).length === 0) {
        exposure.agents = [];
      }
      next.exposure = exposure;
      currentServers[server.id] = next;
    }
    mcp.servers = currentServers;
    config.mcp = mcp;
    await writeOpenClawConfig(config);
  });
}

function listResult(servers: McpServerConfig[]) {
  return { success: true, servers: [VERSE_CLAW_GIT_MCP_SERVER, VERSE_CLAW_STORAGE_MCP_SERVER, ...hydrateMcpServerAddresses(servers)] };
}

export async function listMcpServersForCapabilityPublication(input: {
  workspaceId?: string | null;
  agentId?: string | null;
  includeCandidates?: boolean;
}): Promise<McpServerConfig[]> {
  if (input.includeCandidates) {
    return listResult(await readServers()).servers;
  }
  return await resolveMcpServersForContext({
    workspaceId: input.workspaceId,
    agentId: input.agentId,
  });
}

function matchesContext(server: McpServerConfig, workspaceId?: string | null, agentId?: string | null): boolean {
  if (!server.enabled) return false;
  if (server.scope === 'global') return true;
  if (server.scope === 'agent') return Boolean(agentId && server.ownerId === agentId);
  if (server.scope === 'workspace') return Boolean(workspaceId && server.ownerId === workspaceId);
  return false;
}

function orderResolvedServers(servers: McpServerConfig[], defaultIdSet = new Set<string>()): McpServerConfig[] {
  const rank: Record<McpScope, number> = {
    global: 0,
    agent: 1,
    workspace: 2,
  };
  return [...servers].sort((a, b) => {
    const scopeRank = rank[a.scope] - rank[b.scope];
    if (scopeRank !== 0) return scopeRank;
    const defaultRank = Number(!defaultIdSet.has(a.id)) - Number(!defaultIdSet.has(b.id));
    if (defaultRank !== 0) return defaultRank;
    const createdAtRank = a.createdAt - b.createdAt;
    if (createdAtRank !== 0) return createdAtRank;
    return a.id.localeCompare(b.id);
  });
}

export async function resolveMcpServersForContext(input: {
  workspaceId?: string | null;
  agentId?: string | null;
}): Promise<McpServerConfig[]> {
  const servers = await readServers();
  const defaultMcpServerIds = input.agentId
    ? (await readAgentBootstrapTools(input.agentId).catch(() => ({ defaultMcpServerIds: [] }))).defaultMcpServerIds
    : [];
  const defaultIdSet = new Set(defaultMcpServerIds);
  const resolved = servers.filter((server) => (
    matchesContext(server, input.workspaceId, input.agentId)
    || (server.enabled && defaultIdSet.has(server.id))
  ));
  return [VERSE_CLAW_GIT_MCP_SERVER, VERSE_CLAW_STORAGE_MCP_SERVER, ...orderResolvedServers(resolved, defaultIdSet)];
}

function parsePayload<T>(payload: unknown): T {
  return (isRecord(payload) ? payload : {}) as T;
}

function isLocalMcpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function checkMcpHeartbeat(server: McpServerConfig): Promise<{ message: string; latencyMs: number }> {
  const startedAt = Date.now();
  if (server.transport === 'stdio') {
    return {
      message: 'stdio 配置校验通过；实际进程由 Verse Claw MCP Runtime 通过 OpenClaw 沙盒启动',
      latencyMs: Date.now() - startedAt,
    };
  }
  if (!server.url) {
    throw new Error('URL �?MCP 服务缺少地址');
  }
  const networkPolicy = server.networkPolicy ?? 'localOnly';
  if (networkPolicy === 'disabled') {
    throw new Error('�?MCP 服务网络策略为关闭，不能发起 HTTP 心跳');
  }
  if (networkPolicy === 'localOnly' && !isLocalMcpUrl(server.url)) {
    throw new Error('localOnly 网络策略只允�?localhost / 127.0.0.1 MCP 服务');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(server.url, {
      method: 'GET',
      signal: controller.signal,
    });
    return {
      message: `端点可访问，HTTP ${response.status}`,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('MCP 心跳超时', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function updateServerRuntimeFields(id: string, patch: Partial<McpServerConfig>): Promise<McpServerConfig | undefined> {
  const servers = await readServers();
  const index = servers.findIndex((server) => server.id === id);
  if (index === -1) return undefined;
  const next = [...servers];
  next[index] = { ...next[index], ...patch, updatedAt: Date.now() };
  await writeServers(next);
  return next[index];
}

async function findServer(id: string): Promise<McpServerConfig> {
  if (id === VERSE_CLAW_GIT_MCP_SERVER_ID) return VERSE_CLAW_GIT_MCP_SERVER;
  if (id === VERSE_CLAW_STORAGE_MCP_SERVER_ID) return VERSE_CLAW_STORAGE_MCP_SERVER;
  const server = (await readServers()).find((entry) => entry.id === id);
  if (!server) throw new Error(`MCP 服务 "${id}" 不存在`);
  return server;
}

async function callClawxGitTool(toolName: string, args: Record<string, unknown>) {
  const gitApi = createGitApi();
  switch (toolName) {
    case 'git_status':
      return await gitApi.status();
    case 'git_diff':
      return await gitApi.diff({
        mode: args.mode === 'staged' ? 'staged' : 'unstaged',
      });
    case 'git_file_diff':
      return await gitApi.fileDiff({
        path: typeof args.path === 'string' ? args.path : '',
        mode: args.mode === 'staged' ? 'staged' : 'unstaged',
      });
    case 'git_stage':
      return await gitApi.stage({
        paths: Array.isArray(args.paths) ? args.paths.filter((entry): entry is string => typeof entry === 'string') : [],
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_unstage':
      return await gitApi.unstage({
        paths: Array.isArray(args.paths) ? args.paths.filter((entry): entry is string => typeof entry === 'string') : [],
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_revert_file':
      return await gitApi.revertFile({
        path: typeof args.path === 'string' ? args.path : '',
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_commit':
      return await gitApi.commit({
        message: typeof args.message === 'string' ? args.message : '',
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_branch_list':
      return await gitApi.branches();
    case 'git_checkout_branch':
      return await gitApi.checkoutBranch({
        name: typeof args.name === 'string' ? args.name : '',
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_create_branch':
      return await gitApi.createBranch({
        name: typeof args.name === 'string' ? args.name : '',
        startPoint: normalizeString(args.startPoint),
        checkout: typeof args.checkout === 'boolean' ? args.checkout : undefined,
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_stash_list':
      return await gitApi.stashList();
    case 'git_stash_push':
      return await gitApi.stashPush({
        message: normalizeString(args.message),
        includeUntracked: args.includeUntracked === true,
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_stash_apply':
      return await gitApi.stashApply({
        selector: typeof args.selector === 'string' ? args.selector : '',
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_stash_pop':
      return await gitApi.stashPop({
        selector: typeof args.selector === 'string' ? args.selector : '',
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_worktree_list':
      return await gitApi.worktrees();
    case 'git_worktree_add':
      return await gitApi.worktreeAdd({
        branch: typeof args.branch === 'string' ? args.branch : '',
        path: normalizeString(args.path),
        startPoint: normalizeString(args.startPoint),
        checkoutNewBranch: typeof args.checkoutNewBranch === 'boolean' ? args.checkoutNewBranch : undefined,
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_worktree_remove':
      return await gitApi.worktreeRemove({
        path: typeof args.path === 'string' ? args.path : '',
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_worktree_prune':
      return await gitApi.worktreePrune({
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_fetch':
      return await gitApi.fetch({
        remote: normalizeString(args.remote),
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_pull':
      return await gitApi.pull({
        remote: normalizeString(args.remote),
        branch: normalizeString(args.branch),
        rebase: args.rebase === true,
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_push':
      return await gitApi.push({
        remote: normalizeString(args.remote),
        branch: normalizeString(args.branch),
        setUpstream: args.setUpstream === true,
        approvalId: normalizeString(args.approvalId),
      });
    case 'github_auth_status':
      return await gitApi.githubAuthStatus();
    case 'github_repo':
      return await gitApi.githubRepo();
    case 'github_pr_list':
      return await gitApi.prList({
        state: args.state === 'closed' || args.state === 'merged' || args.state === 'all' ? args.state : 'open',
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      });
    case 'github_pr_view':
      return await gitApi.prView({
        number: typeof args.number === 'number' ? args.number : 0,
      });
    case 'github_pr_create':
      return await gitApi.prCreate({
        title: typeof args.title === 'string' ? args.title : '',
        body: typeof args.body === 'string' ? args.body : '',
        base: normalizeString(args.base),
        head: normalizeString(args.head),
        draft: args.draft === true,
        approvalId: normalizeString(args.approvalId),
      });
    case 'github_open_pr':
      return await gitApi.openPr({
        number: typeof args.number === 'number' ? args.number : 0,
      });
    default:
      throw new Error(`Unknown Verse Claw Git tool "${toolName}"`);
  }
}

async function callClawxStorageTool(toolName: string, args: Record<string, unknown>) {
  const systemApi = createSystemApi();
  switch (toolName) {
    case 'storage_info':
      return await systemApi.info();

    case 'storage_scan': {
      const categories = Array.isArray(args.categories)
        ? args.categories.filter((c): c is string => typeof c === 'string')
        : undefined;
      return await systemApi.scan({ categories: categories as SystemScanCategoryId[] | undefined });
    }

    case 'storage_delete': {
      const items = Array.isArray(args.items)
        ? args.items
            .filter((i): i is Record<string, unknown> => isRecord(i) && typeof i.path === 'string')
            .map((i) => ({
              id: typeof i.id === 'string' ? i.id : '',
              path: typeof i.path === 'string' ? i.path : '',
            }))
        : [];
      const dryRun = args.dryRun !== false;
      const approvalId = normalizeString(args.approvalId);
      return await systemApi.deleteItems({ items, dryRun, approvalId });
    }

    case 'storage_recommend': {
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 50) : 10;
      const scan = await systemApi.scan({});
      const allItems = scan.categories.flatMap((cat) =>
        cat.items.map((item) => ({
          category: cat.id,
          id: item.id,
          path: item.path,
          sizeBytes: item.sizeBytes,
          mtime: item.mtime,
          safeToDelete: item.safeToDelete,
        })),
      );
      allItems.sort((a, b) => b.sizeBytes - a.sizeBytes);
      return {
        success: true,
        system: scan.system,
        recommendations: allItems.slice(0, limit),
        totalScannedBytes: allItems.reduce((sum, i) => sum + i.sizeBytes, 0),
      };
    }

    default:
      throw new Error(`Unknown Verse Claw Storage tool "${toolName}"`);
  }
}

async function tryGatewayMcpRpc<T>(
  gatewayManager: GatewayManager | undefined,
  method: string,
  params: Record<string, unknown>,
): Promise<T | null> {
  if (gatewayManager?.getStatus().state !== 'running') return null;
  try {
    return await gatewayManager.rpc(method, params, 5000) as T;
  } catch {
    return null;
  }
}

export function createMcpApi(): CompleteHostServiceRegistry['mcp'] {
  return createMcpApiWithContext();
}

export function createMcpApiWithContext(ctx: McpApiContext = {}): CompleteHostServiceRegistry['mcp'] {
  // Dispatch a best-effort runtime reload signal to the gateway. The
  // electron-store `mcp-servers.json` is the authoritative MCP server
  // store; this RPC only sends the resolved server snapshot for any
  // runtime that can apply it without touching openclaw.json.
  const dispatchReload = async () => {
    if (ctx.gatewayManager?.getStatus().state !== 'running') return;
    let workspaceId: string | null = null;
    let agentId: string | null = null;
    let servers: McpServerConfig[] = [];
    try {
      const workspace = await getActiveWorkspaceProfile();
      workspaceId = workspace?.id ?? null;
      agentId = workspace?.selectedAgentId || workspace?.agentId || null;
      servers = await resolveMcpServersForContext({ workspaceId, agentId });
    } catch {
      // Non-disruptive: fall through with whatever we have.
    }
    try {
      await ctx.gatewayManager.rpc(
        'mcp.reload',
        { workspaceId, agentId, servers },
        4000,
      );
    } catch {
      // Non-disruptive by design.
    }
  };

  return {
    listServers: async () => listResult(await readServers()),
    createServer: async (payload) => {
      const servers = await readServers();
      const server = buildServer(parsePayload<McpServerCreatePayload>(payload), new Set(servers.map((entry) => entry.id)));
      const next = [server, ...servers];
      await writeServers(next);
      await dispatchReload();
      return listResult(next);
    },
    updateServer: async (payload) => {
      const body = parsePayload<McpServerUpdatePayload>(payload);
      const id = normalizeString(body.id);
      if (!id) throw new Error('id is required');
      const servers = await readServers();
      const index = servers.findIndex((server) => server.id === id);
      if (index === -1) throw new Error(`MCP 服务 "${id}" 不存在`);
      const next = [...servers];
      next[index] = updateServer(next[index], body);
      await writeServers(next);
      await dispatchReload();
      return listResult(next);
    },
    deleteServer: async (payload) => {
      const id = normalizeString((parsePayload<{ id?: unknown }>(payload)).id);
      if (!id) throw new Error('id is required');
      const servers = await readServers();
      const next = servers.filter((server) => server.id !== id);
      if (next.length === servers.length) throw new Error(`MCP 服务 "${id}" 不存在`);
      await writeServers(next);
      await dispatchReload();
      return listResult(next);
    },
    testServer: async (payload) => {
      const body = parsePayload<{ id?: unknown; server?: unknown }>(payload);
      try {
        let server: McpServerConfig | undefined;
        const id = normalizeString(body.id);
        if (id) {
          server = await findServer(id);
        } else {
          server = buildServer(parsePayload<McpServerCreatePayload>(body.server), new Set());
        }
        const isBuiltin = server.id === VERSE_CLAW_GIT_MCP_SERVER_ID
          || server.id === VERSE_CLAW_STORAGE_MCP_SERVER_ID;
        if (!isBuiltin) validateServer(server);
        const heartbeat = server.id === VERSE_CLAW_GIT_MCP_SERVER_ID
          ? { message: 'Verse Claw Git tools are available through the host Git service.', latencyMs: 0 }
          : server.id === VERSE_CLAW_STORAGE_MCP_SERVER_ID
            ? { message: 'Verse Claw Storage tools are available through the host System service.', latencyMs: 0 }
            : await checkMcpHeartbeat(server);
        return {
          success: true,
          server,
          message: heartbeat.message,
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    resolveForContext: async (payload) => {
      const body = parsePayload<{ workspaceId?: unknown; agentId?: unknown }>(payload);
      const workspaceId = normalizeString(body.workspaceId) ?? null;
      const agentId = normalizeString(body.agentId) ?? null;
      const servers = await resolveMcpServersForContext({ workspaceId, agentId });
      return {
        success: true,
        servers,
        workspaceId,
        agentId,
        updatedAt: Date.now(),
      };
    },
    heartbeat: async (payload) => {
      const body = parsePayload<McpHeartbeatPayload>(payload);
      const id = normalizeString(body.serverId);
      if (!id) throw new Error('serverId is required');
      const server = await findServer(id);
      if (id === VERSE_CLAW_GIT_MCP_SERVER_ID) {
        return {
          success: true,
          serverId: id,
          status: 'connected',
          latencyMs: 0,
          message: 'Verse Claw Git tools are available through the host Git service.',
          server,
        };
      }
      if (id === VERSE_CLAW_STORAGE_MCP_SERVER_ID) {
        return {
          success: true,
          serverId: id,
          status: 'connected',
          latencyMs: 0,
          message: 'Verse Claw Storage tools are available through the host System service.',
          server,
        };
      }
      const runtime = await tryGatewayMcpRpc<McpHeartbeatResult>(ctx.gatewayManager, 'mcp.heartbeat', { serverId: id });
      if (runtime?.success) {
        const updated = await updateServerRuntimeFields(id, {
          runtimeStatus: runtime.status,
          lastHeartbeatAt: Date.now(),
          lastHeartbeatMs: runtime.latencyMs,
          lastHeartbeatError: undefined,
        });
        return { ...runtime, server: updated ?? server };
      }
      try {
        const heartbeat = await checkMcpHeartbeat(server);
        const updated = await updateServerRuntimeFields(id, {
          runtimeStatus: 'connected',
          lastHeartbeatAt: Date.now(),
          lastHeartbeatMs: heartbeat.latencyMs,
          lastHeartbeatError: undefined,
        });
        return {
          success: true,
          serverId: id,
          status: 'connected',
          latencyMs: heartbeat.latencyMs,
          message: heartbeat.message,
          server: updated ?? server,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const updated = await updateServerRuntimeFields(id, {
          runtimeStatus: 'error',
          lastHeartbeatAt: Date.now(),
          lastHeartbeatError: message,
        });
        return {
          success: false,
          serverId: id,
          status: 'error',
          error: message,
          server: updated ?? server,
        };
      }
    },
    listTools: async (payload) => {
      const body = parsePayload<McpListToolsPayload>(payload);
      const id = normalizeString(body.serverId);
      if (!id) throw new Error('serverId is required');
      const server = await findServer(id);
      if (id === VERSE_CLAW_GIT_MCP_SERVER_ID) {
        return {
          success: true,
          serverId: id,
          tools: VERSE_CLAW_GIT_MCP_TOOLS,
          status: 'connected',
          message: 'Verse Claw Git host tools',
        };
      }
      if (id === VERSE_CLAW_STORAGE_MCP_SERVER_ID) {
        return {
          success: true,
          serverId: id,
          tools: VERSE_CLAW_STORAGE_MCP_TOOLS,
          status: 'connected',
          message: 'Verse Claw Storage host tools',
        };
      }
      const runtime = await tryGatewayMcpRpc<McpListToolsResult>(ctx.gatewayManager, 'mcp.listTools', { serverId: id });
      if (runtime?.success) {
        await updateServerRuntimeFields(id, {
          runtimeStatus: runtime.status,
          toolCount: runtime.tools.length,
        });
        return runtime;
      }
      return {
        success: true,
        serverId: id,
        tools: [],
        status: server.runtimeStatus ?? 'registered',
        message: 'MCP 服务已注册；当前 OpenClaw Runtime 尚未返回工具目录',
      };
    },
    callTool: async (payload) => {
      const body = parsePayload<McpCallToolPayload>(payload);
      const serverId = normalizeString(body.serverId);
      const toolName = normalizeString(body.toolName);
      if (!serverId || !toolName) throw new Error('serverId and toolName are required');
      const args = isRecord(body.args) ? body.args : {};
      const approvalId = normalizeString(body.approvalId);
      const workspaceId = normalizeString(body.workspaceId) ?? undefined;
      const agentId = normalizeString(body.agentId) ?? undefined;
      const requestShadow = createMcpToolCallRequestShadow({
        serverId,
        toolName,
        args,
        approvalId,
        workspaceId,
        agentId,
      });
      const finish = (
        result: McpCallToolResult,
        options?: Parameters<typeof createMcpToolCallResultShadow>[2],
      ): McpCallToolResult => {
        const resultShadow = createMcpToolCallResultShadow(requestShadow, result, options);
        emitToolProtocolShadow(ctx, resultShadow);
        emitMcpToolProviderRegistryShadow(
          ctx,
          createMcpToolProviderRegistryResultShadow(requestShadow, resultShadow, result),
        );
        return result;
      };

      emitToolProtocolShadow(ctx, requestShadow);
      emitMcpToolProviderRegistryShadow(
        ctx,
        createMcpToolProviderRegistryRequestShadow(requestShadow),
      );
      try {
      if (serverId === VERSE_CLAW_GIT_MCP_SERVER_ID) {
        const gitArgs = { ...args };
        if (approvalId && !normalizeString(gitArgs.approvalId)) {
          gitArgs.approvalId = approvalId;
        }
        try {
          return finish({
            success: true,
            serverId,
            toolName,
            result: await callClawxGitTool(toolName, gitArgs),
          });
        } catch (error) {
          return finish({
            success: false,
            serverId,
            toolName,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (serverId === VERSE_CLAW_STORAGE_MCP_SERVER_ID) {
        const storageArgs = { ...args };
        if (approvalId && !normalizeString(storageArgs.approvalId)) {
          storageArgs.approvalId = approvalId;
        }
        try {
          return finish({
            success: true,
            serverId,
            toolName,
            result: await callClawxStorageTool(toolName, storageArgs),
          });
        } catch (error) {
          return finish({
            success: false,
            serverId,
            toolName,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const gatewayRunning = ctx.gatewayManager?.getStatus().state === 'running';
      const result = await tryGatewayMcpRpc<McpCallToolResult>(ctx.gatewayManager, 'mcp.callTool', {
        serverId,
        toolName,
        args,
        approvalId,
        workspaceId,
        agentId,
      });
      if (result) return finish(result);
      return finish({
        success: false,
        serverId,
        toolName,
        blocked: true,
        reason: '当前 OpenClaw Runtime 尚未暴露 MCP 工具调用 RPC；Verse Claw 已保留配置、心跳、权限与审计入口',
      }, {
        blockedReasonCode: gatewayRunning ? 'tool/blocked' : 'gateway/unavailable',
      });
      } catch (error) {
        const thrownShadow = createMcpToolCallThrownErrorShadow(requestShadow, error);
        emitToolProtocolShadow(ctx, thrownShadow);
        emitMcpToolProviderRegistryShadow(
          ctx,
          createMcpToolProviderRegistryResultShadow(requestShadow, thrownShadow),
        );
        throw error;
      }
    },
    reloadRuntime: async (payload) => {
      const body = parsePayload<McpReloadRuntimePayload>(payload);
      const workspaceId = normalizeString(body.workspaceId) ?? null;
      const agentId = normalizeString(body.agentId) ?? null;
      const servers = await resolveMcpServersForContext({ workspaceId, agentId });
      const runtime = await tryGatewayMcpRpc<Record<string, unknown>>(ctx.gatewayManager, 'mcp.reload', {
        workspaceId,
        agentId,
        servers,
      });
      return {
        success: true,
        workspaceId,
        agentId,
        serverCount: servers.length,
        hotReloaded: Boolean(runtime),
        restartRequired: false,
        message: runtime
          ? 'MCP Runtime 已热重载'
          : 'MCP 配置已保存；Gateway 未提供热重载响应，将在下次启动时生效',
      };
    },
  };
}
