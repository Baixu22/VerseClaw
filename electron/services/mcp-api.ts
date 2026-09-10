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
import type { RemoteForgeApi } from './remote-forge-api';
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
import { redactMcpEnvMap, type McpEnvMap } from '../../shared/mcp/secret-ref';
import {
  assertMcpNetworkPolicyAllows,
  projectMcpSecurityFields,
} from '../../shared/mcp/runtime-projection';
import {
  filterToolsWithValidSchemas,
  validateToolArgsAgainstSchema,
} from '../../shared/mcp/tool-schema';
import {
  deleteMcpEnvSecretsForServer,
  migrateLegacyMcpEnv,
  resolveMcpEnvMap,
  sealMcpEnvMap,
  type McpEnvSecretVault,
} from './secrets/mcp-env-broker';

type McpStoreDocument = {
  servers: McpServerConfig[];
  envSecrets?: McpEnvSecretVault;
};

type StoredMcpServer = Omit<McpServerConfig, 'env'> & {
  env?: McpEnvMap;
};

type McpApiContext = {
  gatewayManager?: GatewayManager;
  remoteForgeApi?: RemoteForgeApi;
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
  toolCount: 36,
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
    name: 'git_apply_patch',
    description: 'Apply a unified diff to the active workspace with preflight/apply/revert modes. Apply and revert require host approval.',
    inputSchema: {
      type: 'object',
      properties: {
        patch: { type: 'string' },
        mode: { type: 'string', enum: ['preflight', 'apply', 'revert'] },
        approvalId: { type: 'string' },
      },
      required: ['patch'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_diff_to_base',
    description: 'Diff HEAD against its nearest remote ancestor (explicit base, upstream, the remote default branch, or the nearest remote-tracking ancestor). Read-only. Reports how the base was resolved, or unavailable when no remote ancestor exists.',
    inputSchema: {
      type: 'object',
      properties: {
        base: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' } },
        includePatches: { type: 'boolean' },
      },
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
    name: 'git_reflog',
    description: 'Read the complete local Git reference lifecycle for the active workspace repository.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_merge',
    description: 'Merge a branch through the host approval flow.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string' }, noFastForward: { type: 'boolean' }, approvalId: { type: 'string' } },
      required: ['ref'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_rebase',
    description: 'Rebase the current branch through the host approval flow.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string' }, approvalId: { type: 'string' } },
      required: ['ref'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'git_reset',
    description: 'Reset repository state through the host approval flow.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string' }, mode: { type: 'string', enum: ['soft', 'mixed', 'hard'] }, approvalId: { type: 'string' } },
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
  {
    name: 'remote_forge_capabilities',
    description: 'Read GitHub Remote Forge protocol, authentication, permission, and resource capability state.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repository: { type: 'string' },
      },
      required: ['owner', 'repository'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'remote_forge_pull_request_read',
    description: 'Read bounded GitHub pull request detail, commits, files, diff, checks, reviews, protection, and readiness.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repository: { type: 'string' },
        number: { type: 'number' },
      },
      required: ['owner', 'repository', 'number'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'remote_forge_content_read',
    description: 'Read bounded repository file content from GitHub Remote Forge.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repository: { type: 'string' },
        ref: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' }, maxItems: 16 },
      },
      required: ['owner', 'repository', 'ref', 'paths'],
      additionalProperties: false,
    },
    serverId: VERSE_CLAW_GIT_MCP_SERVER_ID,
  },
  {
    name: 'remote_forge_pull_request_merge',
    description: 'Request or consume an externally decided one-time approval for a fail-closed sandbox pull request merge. Agent merge is disabled unless Main policy explicitly enables it.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repository: { type: 'string' },
        number: { type: 'number' },
        expectedHeadSha: { type: 'string' },
        strategy: { type: 'string', enum: ['merge', 'squash', 'rebase'] },
        commitTitle: { type: 'string' },
        commitMessage: { type: 'string' },
        approvalId: { type: 'string' },
        expectedReadinessDigest: { type: 'string' },
        expectedPolicyDigest: { type: 'string' },
      },
      required: ['owner', 'repository', 'number', 'expectedHeadSha', 'strategy'],
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
    throw new Error('URL 型 MCP 服务必须配置地址');
  }
  if (server.scope !== 'global' && !server.ownerId?.trim()) {
    throw new Error('Agent 或 Workspace 作用域必须配置 ownerId');
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
    headers: normalizeEnv(payload.headers),
    sslVerify: payload.sslVerify,
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
    headers: payload.headers === undefined ? current.headers : normalizeEnv(payload.headers),
    sslVerify: payload.sslVerify === undefined ? current.sslVerify : payload.sslVerify,
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

async function readEnvVault(): Promise<McpEnvSecretVault> {
  const store = await getMcpStore();
  const vault = store.get('envSecrets');
  return isRecord(vault) ? { ...(vault as McpEnvSecretVault) } : {};
}

async function writeEnvVault(vault: McpEnvSecretVault): Promise<void> {
  const store = await getMcpStore();
  store.set('envSecrets', vault);
}

async function readServers(): Promise<StoredMcpServer[]> {
  const store = await getMcpStore();
  const servers = store.get('servers');
  if (!Array.isArray(servers)) return [];
  let vault = await readEnvVault();
  let vaultDirty = false;
  let serversDirty = false;
  const migrated: StoredMcpServer[] = [];
  for (const raw of servers as StoredMcpServer[]) {
    const base = hydrateMcpServerAddress(raw as McpServerConfig) as StoredMcpServer;
    if (base !== raw) {
      serversDirty = true;
    }
    const result = await migrateLegacyMcpEnv(base.id, base.env, vault);
    if (result.migrated) {
      vault = result.vault;
      vaultDirty = true;
      serversDirty = true;
      migrated.push({ ...base, env: result.env });
    } else {
      migrated.push(base);
    }
  }
  if (vaultDirty || serversDirty) {
    store.set('servers', migrated.slice(0, MAX_MCP_SERVERS));
  }
  if (vaultDirty) {
    await writeEnvVault(vault);
  }
  return migrated;
}

async function writeServers(servers: StoredMcpServer[], vault?: McpEnvSecretVault): Promise<void> {
  const store = await getMcpStore();
  store.set('servers', hydrateMcpServerAddresses(servers as McpServerConfig[]).slice(0, MAX_MCP_SERVERS));
  if (vault) {
    store.set('envSecrets', vault);
  }
}

function normalizeRuntimeMcpTransport(server: McpServerConfig): 'sse' | 'streamable-http' | undefined {
  const transport = server.canonicalTransport ?? server.transport;
  if (transport === 'sse') return 'sse';
  if (transport === 'http' || transport === 'streamable-http') return 'streamable-http';
  return undefined;
}

/** ClawX-local bridge servers (clawx-git / clawx-storage) are implemented in Main, not in the
 *  OpenClaw runtime, so they must never be mirrored into openclaw.json. Note that user servers
 *  also carry a hydrated `clawx://mcp/<id>` localAddress, so exclusion is by builtin id only. */
function isClawxBridgeServer(server: McpServerConfig | StoredMcpServer): boolean {
  return server.id === VERSE_CLAW_GIT_MCP_SERVER_ID || server.id === VERSE_CLAW_STORAGE_MCP_SERVER_ID;
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

function redactHeadersForRenderer(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers || Object.keys(headers).length === 0) return undefined;
  return Object.fromEntries(Object.keys(headers).map((key) => [key, '????']));
}

/** Renderer-safe projection: never includes plaintext env/header secrets. */
function toRendererServer(server: StoredMcpServer | McpServerConfig): McpServerConfig {
  const env = redactMcpEnvMap(server.env as McpEnvMap | undefined);
  const headers = redactHeadersForRenderer(server.headers);
  return {
    ...(server as McpServerConfig),
    env,
    headers,
  };
}

async function toRuntimeServer(
  server: StoredMcpServer | McpServerConfig,
  vault: McpEnvSecretVault,
): Promise<McpServerConfig> {
  const env = await resolveMcpEnvMap(server.env as McpEnvMap | undefined, vault);
  return {
    ...(server as McpServerConfig),
    env,
  };
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

  // Security fields + env/headers/toolFilter must project into runtime (A1).
  return projectMcpSecurityFields({
    permissionMode: server.permissionMode,
    sandboxProfileId: server.sandboxProfileId,
    networkPolicy: server.networkPolicy,
    sslVerify: server.sslVerify,
    headers: server.headers,
    toolAllowlist: server.toolAllowlist,
    toolDenylist: server.toolDenylist,
    env: server.env as Record<string, string> | undefined,
    transport: server.transport,
    url: server.url,
  }, next);
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
      const vault = await readEnvVault();
      const runtimeServer = selected ? await toRuntimeServer(server, vault) : (server as McpServerConfig);
      const next = selected
        ? projectServerToRuntimeConfig(runtimeServer, existing)
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

/**
 * Mirrors the full user-configured MCP server snapshot into `mcp.servers` in
 * openclaw.json so the OpenClaw gateway runtime can actually consume it. The
 * runtime's config watcher treats `mcp` prefix changes as a hot "dispose-mcp-
 * runtimes" reload, so no RPC is needed — there is no `mcp.reload` gateway
 * method. Built-in ClawX bridge servers (`clawx://` localAddress) are
 * Main-process-local and intentionally not mirrored.
 */
export async function syncAllMcpServersToOpenClawConfig(): Promise<void> {
  const servers = (await readServers()).filter((server) => !isClawxBridgeServer(server));
  await withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const mcp = isRecord(config.mcp) ? { ...(config.mcp as Record<string, unknown>) } : {};
    const currentServers = isRecord(mcp.servers)
      ? { ...(mcp.servers as Record<string, unknown>) }
      : {};
    const vault = await readEnvVault();
    const nextServers: Record<string, unknown> = {};
    for (const server of servers) {
      const runtimeServer = await toRuntimeServer(server, vault);
      nextServers[server.id] = projectServerToRuntimeConfig(
        runtimeServer,
        isRecord(currentServers[server.id])
          ? (currentServers[server.id] as Record<string, unknown>)
          : undefined,
      );
    }
    mcp.servers = nextServers;
    config.mcp = mcp;
    await writeOpenClawConfig(config);
  });
}

function listResult(servers: Array<StoredMcpServer | McpServerConfig>) {
  const custom = hydrateMcpServerAddresses(servers as McpServerConfig[]).map((server) => toRendererServer(server));
  return {
    success: true,
    servers: [VERSE_CLAW_GIT_MCP_SERVER, VERSE_CLAW_STORAGE_MCP_SERVER, ...custom],
  };
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
  /** When true, resolve env SecretRefs to plaintext for runtime/gateway only. */
  forRuntime?: boolean;
}): Promise<McpServerConfig[]> {
  const servers = await readServers();
  const defaultMcpServerIds = input.agentId
    ? (await readAgentBootstrapTools(input.agentId).catch(() => ({ defaultMcpServerIds: [] }))).defaultMcpServerIds
    : [];
  const defaultIdSet = new Set(defaultMcpServerIds);
  const resolved = servers.filter((server) => (
    matchesContext(server as McpServerConfig, input.workspaceId, input.agentId)
    || (server.enabled && defaultIdSet.has(server.id))
  ));
  const ordered = orderResolvedServers(resolved as McpServerConfig[], defaultIdSet) as StoredMcpServer[];
  const withBuiltins: Array<StoredMcpServer | McpServerConfig> = [
    VERSE_CLAW_GIT_MCP_SERVER,
    VERSE_CLAW_STORAGE_MCP_SERVER,
    ...ordered,
  ];
  if (!input.forRuntime) {
    return withBuiltins.map((server) => toRendererServer(server));
  }
  const vault = await readEnvVault();
  const runtime: McpServerConfig[] = [];
  for (const server of withBuiltins) {
    runtime.push(await toRuntimeServer(server, vault));
  }
  return runtime;
}

function parsePayload<T>(payload: unknown): T {
  return (isRecord(payload) ? payload : {}) as T;
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
    throw new Error('URL 型 MCP 服务缺少地址');
  }
  assertMcpNetworkPolicyAllows(server);
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

async function updateServerRuntimeFields(
  id: string,
  patch: Partial<McpServerConfig>,
): Promise<StoredMcpServer | undefined> {
  const servers = await readServers();
  const index = servers.findIndex((server) => server.id === id);
  if (index === -1) return undefined;
  const next = [...servers];
  next[index] = { ...next[index], ...patch, updatedAt: Date.now() };
  await writeServers(next);
  return next[index];
}

async function findServer(id: string): Promise<StoredMcpServer | McpServerConfig> {
  if (id === VERSE_CLAW_GIT_MCP_SERVER_ID) return VERSE_CLAW_GIT_MCP_SERVER;
  if (id === VERSE_CLAW_STORAGE_MCP_SERVER_ID) return VERSE_CLAW_STORAGE_MCP_SERVER;
  const server = (await readServers()).find((entry) => entry.id === id);
  if (!server) throw new Error(`MCP server "${id}" not found`);
  return server;
}

async function callClawxGitTool(
  toolName: string,
  args: Record<string, unknown>,
  remoteForgeApi?: RemoteForgeApi,
) {
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
    case 'git_apply_patch':
      return await gitApi.applyPatch({
        patch: typeof args.patch === 'string' ? args.patch : '',
        mode: args.mode === 'apply' || args.mode === 'revert' ? args.mode : 'preflight',
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_diff_to_base':
      return await gitApi.diffToBase({
        base: normalizeString(args.base),
        paths: Array.isArray(args.paths) ? args.paths.filter((entry): entry is string => typeof entry === 'string') : [],
        // Agents read the diff itself, not just a count, so patches are on
        // here even though the host default is off.
        includePatches: args.includePatches !== false,
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
    case 'git_reflog':
      return await gitApi.reflog({
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      });
    case 'git_merge':
      return await gitApi.merge({
        ref: typeof args.ref === 'string' ? args.ref : '',
        noFastForward: args.noFastForward === true,
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_rebase':
      return await gitApi.rebase({
        ref: typeof args.ref === 'string' ? args.ref : '',
        approvalId: normalizeString(args.approvalId),
      });
    case 'git_reset':
      return await gitApi.reset({
        ref: normalizeString(args.ref),
        mode: args.mode === 'soft' || args.mode === 'hard' ? args.mode : 'mixed',
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
    case 'remote_forge_capabilities':
      if (!remoteForgeApi) throw new Error('Remote Forge host service is unavailable');
      return await remoteForgeApi.capabilities({
        provider: 'github',
        owner: typeof args.owner === 'string' ? args.owner : '',
        repository: typeof args.repository === 'string' ? args.repository : '',
      });
    case 'remote_forge_pull_request_read':
      if (!remoteForgeApi) throw new Error('Remote Forge host service is unavailable');
      return await remoteForgeApi.readPullRequest({
        provider: 'github',
        owner: typeof args.owner === 'string' ? args.owner : '',
        repository: typeof args.repository === 'string' ? args.repository : '',
        number: typeof args.number === 'number' ? args.number : 0,
      });
    case 'remote_forge_content_read':
      if (!remoteForgeApi) throw new Error('Remote Forge host service is unavailable');
      return await remoteForgeApi.readContents({
        provider: 'github',
        owner: typeof args.owner === 'string' ? args.owner : '',
        repository: typeof args.repository === 'string' ? args.repository : '',
        ref: typeof args.ref === 'string' ? args.ref : '',
        paths: Array.isArray(args.paths)
          ? args.paths.filter((entry): entry is string => typeof entry === 'string')
          : [],
      });
    case 'remote_forge_pull_request_merge':
      if (!remoteForgeApi) throw new Error('Remote Forge host service is unavailable');
      return await remoteForgeApi.mergePullRequest({
        provider: 'github',
        owner: typeof args.owner === 'string' ? args.owner : '',
        repository: typeof args.repository === 'string' ? args.repository : '',
        number: typeof args.number === 'number' ? args.number : 0,
        expectedHeadSha: typeof args.expectedHeadSha === 'string' ? args.expectedHeadSha : '',
        strategy: args.strategy === 'merge' || args.strategy === 'squash' || args.strategy === 'rebase'
          ? args.strategy
          : 'merge',
        ...(typeof args.commitTitle === 'string' ? { commitTitle: args.commitTitle } : {}),
        ...(typeof args.commitMessage === 'string' ? { commitMessage: args.commitMessage } : {}),
        ...(typeof args.approvalId === 'string' ? { approvalId: args.approvalId } : {}),
        ...(typeof args.expectedReadinessDigest === 'string'
          ? { expectedReadinessDigest: args.expectedReadinessDigest }
          : {}),
        ...(typeof args.expectedPolicyDigest === 'string'
          ? { expectedPolicyDigest: args.expectedPolicyDigest }
          : {}),
      }, { initiator: 'agent' });
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
  /**
   * Fail-closed runtime apply: mirrors the full MCP server snapshot into
   * `mcp.servers` in openclaw.json, then lets the OpenClaw gateway config
   * watcher hot-reload its MCP runtimes. There is no `mcp.reload` gateway
   * method; writing openclaw.json is the only runtime-consumed channel.
   * Returns {ok:true} when the Gateway is not running (persist-only / restart path).
   */
  const reloadRuntimeStrict = async (options?: {
    workspaceId?: string | null;
    agentId?: string | null;
  }): Promise<{ ok: boolean; hotReloaded: boolean; restartRequired: boolean; error?: string; serverCount: number; workspaceId: string | null; agentId: string | null }> => {
    let workspaceId = options?.workspaceId ?? null;
    let agentId = options?.agentId ?? null;
    if (workspaceId === undefined || agentId === undefined || (options?.workspaceId === undefined && options?.agentId === undefined)) {
      try {
        const workspace = await getActiveWorkspaceProfile();
        workspaceId = workspace?.id ?? null;
        agentId = workspace?.selectedAgentId || workspace?.agentId || null;
      } catch {
        workspaceId = workspaceId ?? null;
        agentId = agentId ?? null;
      }
    }
    const servers = await resolveMcpServersForContext({
      workspaceId,
      agentId,
      forRuntime: true,
    });
    const gatewayState = ctx.gatewayManager?.getStatus().state;
    try {
      await syncAllMcpServersToOpenClawConfig();
    } catch (error) {
      return {
        ok: false,
        hotReloaded: false,
        restartRequired: true,
        error: `MCP config mirror to openclaw.json failed: ${error instanceof Error ? error.message : String(error)}`,
        serverCount: servers.length,
        workspaceId,
        agentId,
      };
    }
    if (gatewayState !== 'running') {
      return {
        ok: true,
        hotReloaded: false,
        restartRequired: true,
        serverCount: servers.length,
        workspaceId,
        agentId,
      };
    }
    ctx.gatewayManager?.debouncedReload?.();
    return {
      ok: true,
      hotReloaded: true,
      restartRequired: false,
      serverCount: servers.length,
      workspaceId,
      agentId,
    };
  };

  return {
    listServers: async () => listResult(await readServers()),
    createServer: async (payload) => {
      const servers = await readServers();
      const previous = [...servers];
      const previousVault = await readEnvVault();
      const built = buildServer(
        parsePayload<McpServerCreatePayload>(payload),
        new Set(servers.map((entry) => entry.id)),
      ) as StoredMcpServer;
      const sealed = await sealMcpEnvMap({
        serverId: built.id,
        env: normalizeEnv(parsePayload<McpServerCreatePayload>(payload).env),
        vault: previousVault,
      });
      const server: StoredMcpServer = { ...built, env: sealed.env };
      const next = [server, ...servers];
      await writeServers(next, sealed.vault);
      const ack = await reloadRuntimeStrict();
      if (!ack.ok) {
        await writeServers(previous, previousVault);
        throw new Error(ack.error || 'MCP reload failed; create rolled back');
      }
      return listResult(next);
    },
    updateServer: async (payload) => {
      const body = parsePayload<McpServerUpdatePayload>(payload);
      const id = normalizeString(body.id);
      if (!id) throw new Error('id is required');
      const servers = await readServers();
      const index = servers.findIndex((server) => server.id === id);
      if (index === -1) throw new Error(`MCP server "${id}" not found`);
      const previous = [...servers];
      const previousVault = await readEnvVault();
      const current = servers[index];
      const updated = updateServer(current as McpServerConfig, body) as StoredMcpServer;
      let vault = previousVault;
      if (body.env !== undefined) {
        const sealed = await sealMcpEnvMap({
          serverId: id,
          env: normalizeEnv(body.env),
          previousEnv: current.env as McpEnvMap | undefined,
          vault,
        });
        updated.env = sealed.env;
        vault = sealed.vault;
      }
      const next = [...servers];
      next[index] = updated;
      await writeServers(next, vault);
      const ack = await reloadRuntimeStrict();
      if (!ack.ok) {
        await writeServers(previous, previousVault);
        throw new Error(ack.error || 'MCP reload failed; update rolled back');
      }
      return listResult(next);
    },
    deleteServer: async (payload) => {
      const id = normalizeString((parsePayload<{ id?: unknown }>(payload)).id);
      if (!id) throw new Error('id is required');
      const servers = await readServers();
      const previous = [...servers];
      const previousVault = await readEnvVault();
      const next = servers.filter((server) => server.id !== id);
      if (next.length === servers.length) throw new Error(`MCP server "${id}" not found`);
      const vault = deleteMcpEnvSecretsForServer(previousVault, id);
      await writeServers(next, vault);
      const ack = await reloadRuntimeStrict();
      if (!ack.ok) {
        await writeServers(previous, previousVault);
        throw new Error(ack.error || 'MCP reload failed; delete rolled back');
      }
      return listResult(next);
    },
    testServer: async (payload) => {
      const body = parsePayload<{ id?: unknown; server?: unknown }>(payload);
      try {
        let server: StoredMcpServer | McpServerConfig;
        const id = normalizeString(body.id);
        if (id) {
          server = await findServer(id);
        } else {
          server = buildServer(parsePayload<McpServerCreatePayload>(body.server), new Set());
        }
        const isBuiltin = server.id === VERSE_CLAW_GIT_MCP_SERVER_ID
          || server.id === VERSE_CLAW_STORAGE_MCP_SERVER_ID;
        const runtimeServer = isBuiltin
          ? server as McpServerConfig
          : await toRuntimeServer(server, await readEnvVault());
        if (!isBuiltin) validateServer(runtimeServer);
        const heartbeat = server.id === VERSE_CLAW_GIT_MCP_SERVER_ID
          ? { message: 'Verse Claw Git tools are available through the host Git service.', latencyMs: 0 }
          : server.id === VERSE_CLAW_STORAGE_MCP_SERVER_ID
            ? { message: 'Verse Claw Storage tools are available through the host System service.', latencyMs: 0 }
            : await checkMcpHeartbeat(runtimeServer);
        return {
          success: true,
          server: toRendererServer(server),
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
          server: toRendererServer(server),
        };
      }
      if (id === VERSE_CLAW_STORAGE_MCP_SERVER_ID) {
        return {
          success: true,
          serverId: id,
          status: 'connected',
          latencyMs: 0,
          message: 'Verse Claw Storage tools are available through the host System service.',
          server: toRendererServer(server),
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
        return { ...runtime, server: toRendererServer((updated ?? server) as McpServerConfig) };
      }
      try {
        const runtimeServer = await toRuntimeServer(server, await readEnvVault());
        const heartbeat = await checkMcpHeartbeat(runtimeServer);
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
          server: toRendererServer((updated ?? server) as McpServerConfig),
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
          server: toRendererServer((updated ?? server) as McpServerConfig),
        };
      }
    },
    listTools: async (payload) => {
      const body = parsePayload<McpListToolsPayload>(payload);
      const id = normalizeString(body.serverId);
      if (!id) throw new Error('serverId is required');
      const server = await findServer(id);
      if (id !== VERSE_CLAW_GIT_MCP_SERVER_ID && id !== VERSE_CLAW_STORAGE_MCP_SERVER_ID) {
        try {
          assertMcpNetworkPolicyAllows(server);
        } catch (error) {
          return {
            success: false,
            serverId: id,
            tools: [],
            status: 'error' as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
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
        const filtered = filterToolsWithValidSchemas(runtime.tools ?? []);
        if (filtered.rejected.length > 0) {
          return {
            success: false,
            serverId: id,
            tools: [],
            status: 'error' as const,
            error: `Rejected invalid tool schema(s): ${filtered.rejected.map((entry) => `${entry.name} (${entry.reason})`).join('; ')}`,
          };
        }
        await updateServerRuntimeFields(id, {
          runtimeStatus: runtime.status,
          toolCount: filtered.tools.length,
        });
        return { ...runtime, tools: filtered.tools };
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

      // A4: reject calls whose tool schema is invalid or args do not conform.
      if (serverId === VERSE_CLAW_GIT_MCP_SERVER_ID || serverId === VERSE_CLAW_STORAGE_MCP_SERVER_ID) {
        const catalog = serverId === VERSE_CLAW_GIT_MCP_SERVER_ID
          ? VERSE_CLAW_GIT_MCP_TOOLS
          : VERSE_CLAW_STORAGE_MCP_TOOLS;
        const tool = catalog.find((entry) => entry.name === toolName);
        if (!tool) {
          return {
            success: false,
            serverId,
            toolName,
            blocked: true,
            reason: `Unknown tool "${toolName}"`,
            error: `Unknown tool "${toolName}"`,
          };
        }
        const schemaCheck = validateToolArgsAgainstSchema(tool.inputSchema, args);
        if (!schemaCheck.ok) {
          return {
            success: false,
            serverId,
            toolName,
            blocked: true,
            reason: schemaCheck.reason,
            error: schemaCheck.reason,
          };
        }
      } else {
        try {
          const remoteServer = await findServer(serverId);
          assertMcpNetworkPolicyAllows(remoteServer);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // Unknown server ids fall through to Gateway (legacy). Policy failures fail closed.
          if (!message.toLowerCase().includes('not found')) {
            return {
              success: false,
              serverId,
              toolName,
              blocked: true,
              reason: message,
              error: message,
            };
          }
        }
      }

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
            result: await callClawxGitTool(toolName, gitArgs, ctx.remoteForgeApi),
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
      const ack = await reloadRuntimeStrict({ workspaceId, agentId });
      if (!ack.ok) {
        return {
          success: false,
          workspaceId: ack.workspaceId,
          agentId: ack.agentId,
          serverCount: ack.serverCount,
          hotReloaded: false,
          restartRequired: true,
          error: ack.error || 'MCP reload failed without acknowledgement',
          message: ack.error || 'MCP reload failed without acknowledgement',
        };
      }
      return {
        success: true,
        workspaceId: ack.workspaceId,
        agentId: ack.agentId,
        serverCount: ack.serverCount,
        hotReloaded: ack.hotReloaded,
        restartRequired: ack.restartRequired,
        message: ack.hotReloaded
          ? 'MCP Runtime hot-reloaded'
          : 'MCP config saved; Gateway not running, applies on next start',
      };
    },
  };
}
