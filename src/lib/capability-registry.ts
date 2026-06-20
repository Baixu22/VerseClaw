import { hostApi } from '@/lib/host-api';
import { auditMcpServerForAction, auditSkillForAction } from '@/lib/capability-audit';
import type { CapabilityRegistryEntry } from '@shared/host-api/contract';
import type { McpServerConfig } from '@shared/types/mcp';
import type { Skill } from '@/types/skill';

type CapabilityRegistryHostApi = {
  skills: Pick<typeof hostApi.skills, 'local'>;
  mcp: Pick<typeof hostApi.mcp, 'listServers'>;
};

function skillSource(skill: Skill): CapabilityRegistryEntry['source'] {
  if (skill.isBundled || skill.isCore) return 'bundled';
  if (skill.source === 'workspace') return 'workspace';
  return 'local';
}

export function skillRegistryEntry(skill: Skill): CapabilityRegistryEntry {
  return {
    id: `skill:${skill.id}`,
    kind: 'skill',
    name: skill.name,
    source: skillSource(skill),
    installed: true,
    enabled: skill.enabled,
    verified: Boolean(skill.filePath || skill.baseDir || skill.isBundled || skill.isCore),
    skillId: skill.id,
    lastAuditResult: auditSkillForAction(skill),
  };
}

export function mcpRegistryEntry(server: McpServerConfig): CapabilityRegistryEntry {
  const auditResult = auditMcpServerForAction({
    name: server.name,
    localAddress: server.localAddress,
    transport: server.transport,
    command: server.command,
    args: server.args,
    cwd: server.cwd,
    url: server.url,
    env: server.env,
    enabled: server.enabled,
    scope: server.scope,
    ownerId: server.ownerId,
    toolAllowlist: server.toolAllowlist,
    toolDenylist: server.toolDenylist,
    permissionMode: server.permissionMode,
    sandboxProfileId: server.sandboxProfileId,
    networkPolicy: server.networkPolicy,
  });
  return {
    id: `mcp:${server.id}`,
    kind: 'mcp',
    name: server.name,
    source: 'registered',
    installed: true,
    enabled: server.enabled,
    verified: server.runtimeStatus === 'connected' || server.runtimeStatus === 'registered' || (server.toolCount ?? 0) > 0,
    serverId: server.id,
    lastAuditResult: { ...auditResult, source: 'registered' },
  };
}

export async function loadCapabilityRegistry(
  api: CapabilityRegistryHostApi = hostApi,
): Promise<CapabilityRegistryEntry[]> {
  const [skillsResult, serversResult] = await Promise.allSettled([
    api.skills.local(),
    api.mcp.listServers(),
  ]);

  const skills = skillsResult.status === 'fulfilled' && skillsResult.value.success && Array.isArray(skillsResult.value.skills)
    ? skillsResult.value.skills
    : [];
  const servers = serversResult.status === 'fulfilled' && Array.isArray(serversResult.value.servers)
    ? serversResult.value.servers
    : [];

  return [
    ...skills.map(skillRegistryEntry),
    ...servers.map(mcpRegistryEntry),
  ];
}
