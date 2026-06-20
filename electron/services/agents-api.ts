import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { AgentReasoningEffort, AgentRoleProfile } from '@shared/types/agent';
import {
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  deleteAgentConfig,
  listAgentsSnapshot,
  removeAgentWorkspaceDirectory,
  readAgentBootstrapFile,
  readAgentBootstrapTools,
  readAgentRoleProfile,
  readAgentSoul,
  resolveAccountIdForAgent,
  updateAgentModel,
  updateAgentName,
  updateAgentReasoningEffort,
  writeAgentBootstrapFile,
  writeAgentBootstrapTools,
  writeAgentRoleProfile,
  writeAgentSoul,
} from '../utils/agent-config';
import { deleteChannelAccountConfig } from '../utils/channel-config';
import { ensureClawXContext } from '../utils/openclaw-workspace';
import { isRecord } from './payload-utils';
import { syncAgentModelOverrideToRuntime, syncAllProviderAuthToRuntime } from './providers/provider-runtime-sync';

type AgentsApiContext = {
  gatewayManager: GatewayManager;
};

function requireString(payload: unknown, key: string): string {
  if (!isRecord(payload) || typeof payload[key] !== 'string' || !payload[key].trim()) {
    throw new Error(`${key} is required`);
  }
  return payload[key].trim();
}

const REASONING_EFFORTS = new Set<AgentReasoningEffort>([
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

function requireReasoningEffort(payload: unknown): AgentReasoningEffort {
  const value = isRecord(payload) ? payload.reasoningEffort : undefined;
  if (typeof value === 'string' && REASONING_EFFORTS.has(value as AgentReasoningEffort)) {
    return value as AgentReasoningEffort;
  }
  throw new Error('reasoningEffort is invalid');
}

type AgentBootstrapUpdateBody = {
  soulMd?: unknown;
  defaultSkillIds?: unknown;
  defaultMcpServerIds?: unknown;
  agentsMd?: unknown;
  toolsMd?: unknown;
  userMd?: unknown;
  identityMd?: unknown;
  heartbeatMd?: unknown;
  bootMd?: unknown;
  roleProfile?: unknown;
};

type BootstrapFileName = 'AGENTS.md' | 'TOOLS.md' | 'USER.md' | 'IDENTITY.md' | 'HEARTBEAT.md' | 'BOOT.md';

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
}

function scheduleGatewayReload(ctx: AgentsApiContext, reason: string): void {
  if (ctx.gatewayManager.getStatus().state !== 'stopped') {
    ctx.gatewayManager.debouncedReload();
    return;
  }
  void reason;
}

async function restartGatewayForAgentDeletion(ctx: AgentsApiContext): Promise<void> {
  try {
    await ctx.gatewayManager.restart();
    console.log('[agents] Gateway restart completed after agent deletion');
  } catch (err) {
    console.warn('[agents] Gateway restart after agent deletion failed:', err);
  }
}

export function createAgentsApi(ctx: AgentsApiContext): CompleteHostServiceRegistry['agents'] {
  return {
    list: async () => ({ success: true, ...(await listAgentsSnapshot()) }),
    create: async (payload) => {
      const name = requireString(payload, 'name');
      const inheritWorkspace = isRecord(payload) ? payload.inheritWorkspace === true : undefined;
      const snapshot = await createAgent(name, { inheritWorkspace });
      syncAllProviderAuthToRuntime().catch((err) => {
        console.warn('[agents] Failed to sync provider auth after agent creation:', err);
      });
      scheduleGatewayReload(ctx, 'create-agent');
      void ensureClawXContext({ waitForAllConfiguredWorkspaces: true }).catch((err) => {
        console.warn('[agents] Failed to ensure ClawX context after agent creation:', err);
      });
      return { success: true, ...snapshot };
    },
    update: async (payload) => {
      const agentId = requireString(payload, 'id');
      const name = requireString(payload, 'name');
      const snapshot = await updateAgentName(agentId, name);
      scheduleGatewayReload(ctx, 'update-agent');
      return { success: true, ...snapshot };
    },
    updateModel: async (payload) => {
      const agentId = requireString(payload, 'id');
      const modelRef = isRecord(payload) && typeof payload.modelRef === 'string' ? payload.modelRef : null;
      const snapshot = await updateAgentModel(agentId, modelRef);
      try {
        await syncAllProviderAuthToRuntime();
        await syncAgentModelOverrideToRuntime(agentId);
      } catch (syncError) {
        console.warn('[agents] Failed to sync runtime after updating agent model:', syncError);
      }
      return { success: true, ...snapshot };
    },
    updateReasoningEffort: async (payload) => {
      const agentId = requireString(payload, 'id');
      const reasoningEffort = requireReasoningEffort(payload);
      const snapshot = await updateAgentReasoningEffort(agentId, reasoningEffort);
      return { success: true, ...snapshot };
    },
    getBootstrap: async (payload) => {
      const agentId = requireString(payload, 'id');
      const [result, tools, roleProfile, agentsMd, toolsMd, userMd, identityMd, heartbeatMd, bootMd] = await Promise.all([
        readAgentSoul(agentId),
        readAgentBootstrapTools(agentId),
        readAgentRoleProfile(agentId).catch(() => null),
        readAgentBootstrapFile(agentId, 'AGENTS.md').catch(() => ({ content: '', path: '' })),
        readAgentBootstrapFile(agentId, 'TOOLS.md').catch(() => ({ content: '', path: '' })),
        readAgentBootstrapFile(agentId, 'USER.md').catch(() => ({ content: '', path: '' })),
        readAgentBootstrapFile(agentId, 'IDENTITY.md').catch(() => ({ content: '', path: '' })),
        readAgentBootstrapFile(agentId, 'HEARTBEAT.md').catch(() => ({ content: '', path: '' })),
        readAgentBootstrapFile(agentId, 'BOOT.md').catch(() => ({ content: '', path: '' })),
      ]);
      return {
        success: true,
        agentId,
        soulMd: result.soulMd,
        bootstrapPath: result.path,
        defaultSkillIds: tools.defaultSkillIds,
        defaultMcpServerIds: tools.defaultMcpServerIds,
        roleProfile,
        agentsMd: agentsMd.content,
        agentsMdPath: agentsMd.path,
        toolsMd: toolsMd.content,
        toolsMdPath: toolsMd.path,
        userMd: userMd.content,
        userMdPath: userMd.path,
        identityMd: identityMd.content,
        identityMdPath: identityMd.path,
        heartbeatMd: heartbeatMd.content,
        heartbeatMdPath: heartbeatMd.path,
        bootMd: bootMd.content,
        bootMdPath: bootMd.path,
      };
    },
    updateBootstrap: async (payload) => {
      const agentId = requireString(payload, 'id');
      const body = (isRecord(payload) ? payload : {}) as AgentBootstrapUpdateBody;

      // Handle role profile → compiles to SOUL.md
      const hasRoleProfile = body.roleProfile && typeof body.roleProfile === 'object';
      const hasRawSoulMd = typeof body.soulMd === 'string';

      // Write role profile if provided (compiles to SOUL.md)
      let soulResult: { soulMd: string; path: string };
      if (hasRoleProfile) {
        const profile = body.roleProfile as AgentRoleProfile;
        soulResult = await writeAgentRoleProfile(agentId, profile);
      } else if (hasRawSoulMd) {
        soulResult = await writeAgentSoul(agentId, body.soulMd as string);
      } else {
        soulResult = await readAgentSoul(agentId);
      }

      // Write other bootstrap files if provided
      const bootstrapFiles: Partial<Record<BootstrapFileName, string>> = {
        'AGENTS.md': typeof body.agentsMd === 'string' ? body.agentsMd : undefined,
        'TOOLS.md': typeof body.toolsMd === 'string' ? body.toolsMd : undefined,
        'USER.md': typeof body.userMd === 'string' ? body.userMd : undefined,
        'IDENTITY.md': typeof body.identityMd === 'string' ? body.identityMd : undefined,
        'HEARTBEAT.md': typeof body.heartbeatMd === 'string' ? body.heartbeatMd : undefined,
        'BOOT.md': typeof body.bootMd === 'string' ? body.bootMd : undefined,
      };

      const bootstrapWrites: Promise<unknown>[] = [];
      for (const [filename, content] of Object.entries(bootstrapFiles)) {
        if (content !== undefined) {
          bootstrapWrites.push(
            writeAgentBootstrapFile(agentId, filename as BootstrapFileName, content).catch((err) => {
              console.warn(`[agents] Failed to write ${filename}:`, err);
            })
          );
        }
      }

      const tools = await writeAgentBootstrapTools(agentId, {
        defaultSkillIds: optionalStringArray(body.defaultSkillIds),
        defaultMcpServerIds: optionalStringArray(body.defaultMcpServerIds),
      });

      await Promise.all(bootstrapWrites);
      scheduleGatewayReload(ctx, 'update-agent-bootstrap');
      return {
        success: true,
        agentId,
        soulMd: soulResult.soulMd,
        bootstrapPath: soulResult.path,
        defaultSkillIds: tools.defaultSkillIds,
        defaultMcpServerIds: tools.defaultMcpServerIds,
      };
    },
    delete: async (payload) => {
      const agentId = requireString(payload, 'id');
      const { snapshot, removedEntry } = await deleteAgentConfig(agentId);
      await restartGatewayForAgentDeletion(ctx);
      await removeAgentWorkspaceDirectory(removedEntry).catch((err) => {
        console.warn('[agents] Failed to remove workspace after agent deletion:', err);
      });
      return { success: true, ...snapshot };
    },
    assignChannel: async (payload) => {
      const agentId = requireString(payload, 'id');
      const channelType = requireString(payload, 'channelType');
      const snapshot = await assignChannelToAgent(agentId, channelType);
      scheduleGatewayReload(ctx, 'assign-channel');
      return { success: true, ...snapshot };
    },
    removeChannel: async (payload) => {
      const agentId = requireString(payload, 'id');
      const channelType = requireString(payload, 'channelType');
      const ownerId = agentId.trim().toLowerCase();
      const snapshotBefore = await listAgentsSnapshot();
      const ownedAccountIds = Object.entries(snapshotBefore.channelAccountOwners)
        .filter(([channelAccountKey, owner]) => {
          if (owner !== ownerId) return false;
          return channelAccountKey.startsWith(`${channelType}:`);
        })
        .map(([channelAccountKey]) => channelAccountKey.slice(channelAccountKey.indexOf(':') + 1));
      if (ownedAccountIds.length === 0) {
        const legacyAccountId = resolveAccountIdForAgent(agentId);
        if (snapshotBefore.channelAccountOwners[`${channelType}:${legacyAccountId}`] === ownerId) {
          ownedAccountIds.push(legacyAccountId);
        }
      }

      for (const accountId of ownedAccountIds) {
        await deleteChannelAccountConfig(channelType, accountId);
        await clearChannelBinding(channelType, accountId);
      }
      const snapshot = await listAgentsSnapshot();
      scheduleGatewayReload(ctx, 'remove-agent-channel');
      return { success: true, ...snapshot };
    },
  };
}
