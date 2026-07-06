import { hostApi } from '@/lib/host-api';
import { auditMcpServerForAction, auditSkillForAction } from '@/lib/capability-audit';
import type {
  CapabilityAuditFinding,
  CapabilityAuditResult,
  CapabilityPublicationEntry,
  CapabilityRegistryEntry,
} from '@shared/host-api/contract';
import type { McpServerConfig } from '@shared/types/mcp';
import type { Skill } from '@/types/skill';

type CapabilityRegistryHostApi = {
  capabilities: Pick<typeof hostApi.capabilities, 'publications'>;
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

function publicationAudit(publication: CapabilityPublicationEntry): CapabilityAuditResult {
  const blocked = publication.diagnostics.filter((entry) => entry.severity === 'blocked');
  const warnings = publication.diagnostics.filter((entry) => entry.severity === 'warning');
  const findings: CapabilityAuditFinding[] = publication.diagnostics.map((entry) => ({
    id: entry.code,
    severity: entry.severity === 'blocked' ? 'blocked' : entry.severity === 'warning' ? 'warning' : 'info',
    title: entry.message,
    detail: entry.details ? JSON.stringify(entry.details) : undefined,
  }));
  if (blocked.length > 0 || publication.state === 'blocked') {
    return {
      status: 'blocked',
      summary: blocked[0]?.message ?? 'Capability is blocked in this context.',
      findings,
      auditedAt: new Date().toISOString(),
      source: publication.source === 'registered' ? 'registered' : 'unknown',
    };
  }
  if (warnings.length > 0 || publication.state === 'runtimeUnavailable') {
    return {
      status: 'warning',
      summary: warnings[0]?.message ?? 'Capability has publication diagnostics.',
      findings,
      auditedAt: new Date().toISOString(),
      source: publication.source === 'registered' ? 'registered' : 'unknown',
    };
  }
  return {
    status: 'passed',
    summary: publication.state === 'published'
      ? 'Capability is published for this context.'
      : 'Capability is available for explicit management.',
    findings,
    auditedAt: new Date().toISOString(),
    source: publication.source === 'registered' ? 'registered' : 'unknown',
  };
}

function registrySource(publication: CapabilityPublicationEntry): CapabilityRegistryEntry['source'] {
  if (publication.source === 'bundled') return 'bundled';
  if (publication.source === 'workspace') return 'workspace';
  if (publication.source === 'registered') return 'registered';
  if (publication.source === 'mcp-json') return 'mcp-json';
  if (publication.source === 'local') return 'local';
  return 'unknown';
}

export function publicationRegistryEntry(publication: CapabilityPublicationEntry): CapabilityRegistryEntry {
  const enabled = publication.state === 'published';
  const verified = ['ready', 'configured', 'warm'].includes(publication.runtime.status);
  return {
    id: publication.id,
    kind: publication.kind,
    name: publication.name,
    source: registrySource(publication),
    installed: publication.state !== 'missing',
    enabled,
    verified,
    lastAuditResult: publicationAudit(publication),
    skillId: publication.skillId ?? (publication.kind === 'skill' ? publication.sourceId : undefined),
    serverId: publication.serverId ?? (publication.kind === 'mcp' ? publication.sourceId : undefined),
    publication,
  };
}

export async function loadCapabilityRegistry(
  api: CapabilityRegistryHostApi = hostApi,
): Promise<CapabilityRegistryEntry[]> {
  const result = await api.capabilities.publications({
    includeDiagnostics: true,
    includeCandidates: true,
    includeToolCatalog: 'warmOnly',
  });
  return result.publications.map(publicationRegistryEntry);
}
