import type {
  CapabilityPublicationDiagnostic,
  CapabilityPublicationEntry,
  CapabilityPublicationQuery,
  CapabilityPublicationResult,
} from '@shared/host-api/contract';
import type { McpServerConfig } from '@shared/types/mcp';
import type { Skill } from '@shared/types/skill';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import { listLocalSkills } from './skills/local-skill-service';
import { listMcpServersForCapabilityPublication } from './mcp-api';
import { isRecord } from './payload-utils';

type CapabilitiesApiContext = {
  gatewayManager?: GatewayManager;
};

function normalizeQuery(payload: unknown): CapabilityPublicationQuery {
  const body = isRecord(payload) ? payload : {};
  return {
    agentId: typeof body.agentId === 'string' ? body.agentId : null,
    workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : null,
    roleName: typeof body.roleName === 'string' ? body.roleName : null,
    includeDiagnostics: body.includeDiagnostics === true,
    includeCandidates: body.includeCandidates === true,
    includeToolCatalog: body.includeToolCatalog === 'warmOnly' ? 'warmOnly' : 'none',
  };
}

function diagnostic(
  code: string,
  severity: CapabilityPublicationDiagnostic['severity'],
  message: string,
  details?: CapabilityPublicationDiagnostic['details'],
): CapabilityPublicationDiagnostic {
  return { code, severity, message, ...(details ? { details } : {}) };
}

function skillSource(skill: Skill): CapabilityPublicationEntry['source'] {
  if (skill.isBundled || skill.isCore) return 'bundled';
  if (skill.source === 'workspace') return 'workspace';
  return 'local';
}

function skillPublication(skill: Skill): CapabilityPublicationEntry {
  const enabled = skill.enabled !== false;
  return {
    id: `skill:${skill.id}`,
    kind: 'skill',
    sourceId: skill.id,
    name: skill.name,
    owner: { type: 'unknown' },
    scope: skill.source === 'workspace' ? 'workspace' : 'unknown',
    source: skillSource(skill),
    state: enabled ? 'available' : 'disabled',
    exposure: {
      runtimeVisible: enabled,
      promptVisible: enabled,
      userInvocable: enabled,
    },
    useModes: enabled ? ['prompt', 'userCommand', 'adminAction'] : ['adminAction'],
    runtime: {
      status: enabled ? 'configured' : 'disabled',
      method: 'fallback',
      source: 'local-fallback',
      message: 'Gateway publication data is unavailable; using local Skill configuration.',
    },
    reasons: enabled ? ['local-skill-enabled'] : ['local-skill-disabled'],
    diagnostics: [
      diagnostic(
        'runtimeUnavailable',
        'warning',
        'Runtime publication data is unavailable; this entry is a local fallback.',
      ),
    ],
    skillId: skill.id,
  };
}

function mcpPublication(server: McpServerConfig): CapabilityPublicationEntry {
  const enabled = server.enabled !== false;
  const exposure = server.exposure;
  const agentIds = exposure?.agents ?? (server.scope === 'agent' && server.ownerId ? [server.ownerId] : undefined);
  const workspaceIds = exposure?.workspaces ?? (server.scope === 'workspace' && server.ownerId ? [server.ownerId] : undefined);
  const roleNames = exposure?.roles;
  const owner = agentIds && agentIds.length > 0
    ? { type: 'agent' as const, id: agentIds[0] }
    : workspaceIds && workspaceIds.length > 0
      ? { type: 'workspace' as const, id: workspaceIds[0] }
      : roleNames && roleNames.length > 0
        ? { type: 'role' as const, id: roleNames[0] }
        : {
            type: server.scope === 'agent' ? 'agent' as const : server.scope === 'workspace' ? 'workspace' as const : 'global' as const,
            id: server.ownerId ?? null,
          };
  return {
    id: `mcp:${server.id}`,
    kind: 'mcp',
    sourceId: server.id,
    name: server.name,
    owner,
    scope: owner.type,
    source: 'registered',
    state: enabled ? 'available' : 'disabled',
    exposure: {
      agentIds,
      workspaceIds,
      roleNames,
      toolVisible: enabled,
      runtimeVisible: enabled,
    },
    useModes: enabled ? ['modelTool', 'adminAction'] : ['adminAction'],
    runtime: {
      status: enabled ? 'configured' : 'disabled',
      method: 'fallback',
      source: 'local-fallback',
      message: 'Gateway publication data is unavailable; using local MCP configuration.',
    },
    toolNames: undefined,
    reasons: enabled ? ['local-mcp-enabled'] : ['local-mcp-disabled'],
    diagnostics: [
      diagnostic(
        'runtimeUnavailable',
        'warning',
        'Runtime publication data is unavailable; this entry is a local fallback.',
      ),
    ],
    serverId: server.id,
  };
}

async function localFallbackPublications(
  query: CapabilityPublicationQuery,
  cause?: unknown,
): Promise<CapabilityPublicationResult> {
  const [skills, servers] = await Promise.all([
    listLocalSkills().catch(() => [] as Skill[]),
    listMcpServersForCapabilityPublication({
      workspaceId: query.workspaceId ?? null,
      agentId: query.agentId ?? null,
      includeCandidates: query.includeCandidates === true,
    }).catch(() => [] as McpServerConfig[]),
  ]);
  const diagnostics = [
    diagnostic(
      'runtimeUnavailable',
      'warning',
      'Gateway capability publication data is unavailable; returned local fallback publications.',
      cause instanceof Error ? { message: cause.message } : undefined,
    ),
  ];
  return {
    success: true,
    source: 'local-fallback',
    generatedAt: new Date().toISOString(),
    publications: [
      ...skills.map(skillPublication),
      ...servers.map(mcpPublication),
    ],
    diagnostics,
  };
}

export function createCapabilitiesApi(
  ctx: CapabilitiesApiContext,
): CompleteHostServiceRegistry['capabilities'] {
  return {
    publications: async (payload) => {
      const query = normalizeQuery(payload);
      if (ctx.gatewayManager?.getStatus().state === 'running') {
        try {
          const result = await ctx.gatewayManager.rpc(
            'capabilities.publications',
            query,
            8000,
          );
          if (isRecord(result) && Array.isArray(result.publications)) {
            return result as CapabilityPublicationResult;
          }
          return await localFallbackPublications(
            query,
            new Error('capabilities.publications returned an invalid payload'),
          );
        } catch (error) {
          return await localFallbackPublications(query, error);
        }
      }
      return await localFallbackPublications(query);
    },
  };
}
