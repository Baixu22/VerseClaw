import { hostApi } from '@/lib/host-api';
import type {
  ChatCapabilityActionPlan,
  ChatCapabilityActionResult,
  McpServerCreatePayload,
} from '@shared/host-api/contract';
import type { McpNetworkPolicy, McpScope, McpTransport } from '@shared/types/mcp';
import type { Skill } from '@/types/skill';
import {
  auditMcpServerForAction,
  auditSkillForAction,
  riskFromAudit,
} from '@/lib/capability-audit';
import { executeCapabilityActionPlan, type CapabilityActionHostApi } from '@/lib/capability-orchestrator';

type CapabilityHostApi = CapabilityActionHostApi;

export type ChatCapabilityPlanResolution = {
  actions: ChatCapabilityActionPlan[];
  unsupportedReason?: 'skillNotFound' | 'mcpConfigRequired' | 'mcpServerNotFound';
  unsupportedTarget?: string;
};

const VALID_TRANSPORTS = new Set<McpTransport>(['stdio', 'http', 'streamable-http', 'sse', 'websocket']);
const VALID_SCOPES = new Set<McpScope>(['global', 'agent', 'workspace']);
const VALID_NETWORK_POLICIES = new Set<McpNetworkPolicy>(['disabled', 'localOnly', 'enabled']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
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

function normalizeEnv(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, raw]) => [key.trim(), String(raw)] as const)
    .filter(([key]) => Boolean(key));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeTransport(input: Record<string, unknown>): McpTransport {
  if (typeof input.transport === 'string' && VALID_TRANSPORTS.has(input.transport as McpTransport)) {
    return input.transport as McpTransport;
  }
  return typeof input.url === 'string' && input.url.trim() ? 'http' : 'stdio';
}

function normalizeScope(value: unknown): McpScope {
  return typeof value === 'string' && VALID_SCOPES.has(value as McpScope)
    ? value as McpScope
    : 'global';
}

function normalizeNetworkPolicy(value: unknown): McpNetworkPolicy | undefined {
  return typeof value === 'string' && VALID_NETWORK_POLICIES.has(value as McpNetworkPolicy)
    ? value as McpNetworkPolicy
    : undefined;
}

function looksLikeMcpServer(value: Record<string, unknown>): boolean {
  return isRecord(value.mcpServers)
    || typeof value.command === 'string'
    || typeof value.url === 'string'
    || typeof value.transport === 'string';
}

function normalizeMcpJsonServer(name: string, value: unknown): McpServerCreatePayload | null {
  const input = isRecord(value) ? value : {};
  if (!looksLikeMcpServer(input)) return null;
  const transport = normalizeTransport(input);
  return {
    name: normalizeString(input.name) ?? name,
    localAddress: normalizeString(input.localAddress),
    transport,
    command: normalizeString(input.command),
    args: normalizeStringArray(input.args),
    cwd: normalizeString(input.cwd),
    url: normalizeString(input.url),
    env: normalizeEnv(input.env),
    enabled: input.enabled !== false,
    scope: normalizeScope(input.scope),
    ownerId: normalizeString(input.ownerId),
    toolAllowlist: normalizeStringArray(input.toolAllowlist ?? input.allowedTools),
    toolDenylist: normalizeStringArray(input.toolDenylist ?? input.deniedTools),
    permissionMode: typeof input.permissionMode === 'string'
      ? input.permissionMode as McpServerCreatePayload['permissionMode']
      : undefined,
    sandboxProfileId: normalizeString(input.sandboxProfileId),
    networkPolicy: normalizeNetworkPolicy(input.networkPolicy),
  };
}

function parseMcpJsonConfigsFromObject(parsed: unknown): McpServerCreatePayload[] {
  if (!isRecord(parsed)) return [];
  if (isRecord(parsed.mcpServers)) {
    return Object.entries(parsed.mcpServers).flatMap(([name, config]) => {
      const server = normalizeMcpJsonServer(name, config);
      return server ? [server] : [];
    });
  }
  const server = normalizeMcpJsonServer('mcp-server', parsed);
  return server ? [server] : [];
}

function extractJsonObjectTexts(value: string): string[] {
  const results: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        results.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return results;
}

function parseMcpJsonConfigs(value: string): McpServerCreatePayload[] {
  return extractJsonObjectTexts(value).flatMap((jsonText) => {
    try {
      return parseMcpJsonConfigsFromObject(JSON.parse(jsonText) as unknown);
    } catch {
      return [];
    }
  });
}

function textContainsSkillIntent(value: string): boolean {
  return /(?:\b(?:enable|activate|install|use)\b|启用|啟用|安装|安裝|使用|开启|開啟|打开|打開)/i.test(value)
    && /(?:\bskill\b|技能|能力)/i.test(value);
}

function textContainsMcpIntent(value: string): boolean {
  return /\bmcp\b/i.test(value);
}

export function shouldRunChatCapabilityPreflight(message: string): boolean {
  return textContainsMcpIntent(message) || textContainsSkillIntent(message);
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[_\s]+/g, '-');
}

function skillAliases(skill: Skill): string[] {
  return [skill.id, skill.slug, skill.name]
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim().toLowerCase());
}

function findRequestedSkills(message: string, skills: Skill[]): Skill[] {
  const normalizedMessage = normalizeSearchText(message);
  return skills.filter((skill) => (
    skillAliases(skill).some((alias) => {
      const normalizedAlias = normalizeSearchText(alias);
      return normalizedAlias.length > 0 && normalizedMessage.includes(normalizedAlias);
    })
  ));
}

function summarizeMcpServer(server: McpServerCreatePayload): string {
  if (server.transport === 'stdio') {
    return [server.command, ...(server.args ?? [])].filter(Boolean).join(' ') || 'stdio';
  }
  return server.url || server.transport;
}

function actionId(kind: string, index: number): string {
  return `${kind}:${index + 1}`;
}

async function resolveSkillActions(
  message: string,
  api: CapabilityHostApi,
): Promise<Pick<ChatCapabilityPlanResolution, 'actions' | 'unsupportedReason' | 'unsupportedTarget'>> {
  if (!textContainsSkillIntent(message)) return { actions: [] };
  const result = await api.skills.local();
  const skills = result.success && Array.isArray(result.skills) ? result.skills : [];
  const matches = findRequestedSkills(message, skills);
  if (matches.length === 0) {
    return { actions: [], unsupportedReason: 'skillNotFound' };
  }
  return {
    actions: matches.map((skill, index) => {
      const auditResult = auditSkillForAction(skill);
      return {
        id: actionId('skill.enable', index),
        kind: 'skill.enable',
        label: skill.enabled ? `Skill already enabled: ${skill.name}` : `Enable skill: ${skill.name}`,
        targetName: skill.name,
        skillId: skill.id,
        skillAlreadyEnabled: skill.enabled,
        summary: skill.enabled ? 'No change needed' : skill.description,
        risk: riskFromAudit(auditResult),
        auditResult,
      };
    }),
  };
}

function mcpManagementIntent(message: string): 'mcp.reload' | 'mcp.heartbeat' | 'mcp.listTools' | null {
  if (!textContainsMcpIntent(message)) return null;
  if (/(?:\breload\b|\bsync\b|重载|重載|刷新|同步)/i.test(message)) return 'mcp.reload';
  if (/(?:\btools?\b|工具|列出|查看)/i.test(message)) return 'mcp.listTools';
  if (/(?:\bheartbeat\b|\btest\b|\bcheck\b|心跳|测试|測試|检查|檢查)/i.test(message)) return 'mcp.heartbeat';
  return null;
}

async function resolveMcpManagementAction(
  message: string,
  api: CapabilityHostApi,
): Promise<Pick<ChatCapabilityPlanResolution, 'actions' | 'unsupportedReason' | 'unsupportedTarget'>> {
  const kind = mcpManagementIntent(message);
  if (!kind) return { actions: [] };
  if (kind === 'mcp.reload') {
    return {
      actions: [{
        id: actionId(kind, 0),
        kind,
        label: 'Reload MCP runtime',
        summary: 'Sync registered MCP servers into the active runtime context',
        risk: 'low',
      }],
    };
  }

  const listed = await api.mcp.listServers();
  const servers = Array.isArray(listed.servers) ? listed.servers : [];
  const normalizedMessage = normalizeSearchText(message);
  const server = servers.find((entry) => (
    [entry.id, entry.name, entry.localAddress]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .some((value) => normalizedMessage.includes(normalizeSearchText(value)))
  ));
  if (!server) return { actions: [], unsupportedReason: 'mcpServerNotFound' };
  return {
    actions: [{
      id: actionId(kind, 0),
      kind,
      label: kind === 'mcp.listTools' ? `List MCP tools: ${server.name}` : `Check MCP heartbeat: ${server.name}`,
      targetName: server.name,
      serverId: server.id,
      summary: server.localAddress,
      risk: 'low',
    }],
  };
}

function resolveMcpRegisterActions(message: string): ChatCapabilityActionPlan[] {
  if (!textContainsMcpIntent(message)) return [];
  const servers = parseMcpJsonConfigs(message);
  return servers.map((server, index) => {
    const auditResult = auditMcpServerForAction(server);
    return {
      id: actionId('mcp.register', index),
      kind: 'mcp.register',
      label: `Register MCP server: ${server.name}`,
      targetName: server.name,
      mcpServer: server,
      summary: summarizeMcpServer(server),
      risk: riskFromAudit(auditResult),
      auditResult,
    };
  });
}

export async function resolveChatCapabilityActions(
  message: string,
  api: CapabilityHostApi = hostApi,
): Promise<ChatCapabilityPlanResolution> {
  const text = message.trim();
  if (!text) return { actions: [] };

  const mcpRegisterActions = resolveMcpRegisterActions(text);
  if (mcpRegisterActions.length > 0) return { actions: mcpRegisterActions };

  const skillResolution = await resolveSkillActions(text, api);
  if (skillResolution.actions.length > 0 || skillResolution.unsupportedReason) {
    return skillResolution;
  }

  const mcpManagementResolution = await resolveMcpManagementAction(text, api);
  if (mcpManagementResolution.actions.length > 0 || mcpManagementResolution.unsupportedReason) {
    return mcpManagementResolution;
  }

  if (textContainsMcpIntent(text) && /(?:\binstall\b|安装|安裝|注册|註冊|配置)/i.test(text)) {
    return { actions: [], unsupportedReason: 'mcpConfigRequired' };
  }

  return { actions: [] };
}

export async function executeChatCapabilityActions(
  actions: ChatCapabilityActionPlan[],
  context: { workspaceId?: string | null; agentId?: string | null } = {},
  api: CapabilityHostApi = hostApi,
): Promise<ChatCapabilityActionResult[]> {
  return executeCapabilityActionPlan(actions, context, api);
}

export function hasSuccessfulCapabilityResult(results: ChatCapabilityActionResult[]): boolean {
  return results.some((result) => result.success && result.id !== 'mcp.register:reload');
}

export function buildCapabilityActionMessage(
  originalMessage: string,
  results: ChatCapabilityActionResult[],
): string {
  const metadata = {
    clawxCapabilityActionResults: results,
    generatedAt: new Date().toISOString(),
    instruction: 'These results are trusted Verse Claw capability management metadata. Continue the user request with these local skill/MCP changes in mind.',
  };
  const block = `Conversation info (trusted Verse Claw capability action results): \`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\``;
  return originalMessage.trim() ? `${block}\n\n${originalMessage}` : block;
}
