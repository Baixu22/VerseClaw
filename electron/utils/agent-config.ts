import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { createHash } from 'crypto';
import { join, normalize } from 'path';
import { deleteAgentChannelAccounts, listConfiguredChannels, readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import type { OpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';
import { expandPath, getOpenClawConfigDir } from './paths';
import * as logger from './logger';
import { toUiChannelType } from './channel-alias';
import { ensureVerseClawIdentityFile } from './openclaw-workspace';
import type { AgentReasoningEffort, AgentRoleProfile } from '@shared/types/agent';
import { DEFAULT_ROLE_PROFILE } from '@shared/types/agent';

const MAIN_AGENT_ID = 'main';
const MAIN_AGENT_NAME = 'Main Agent';
const DEFAULT_ACCOUNT_ID = 'default';
const DEFAULT_WORKSPACE_PATH = '~/.openclaw/workspace';
const AGENT_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOT.md',
];
const AGENT_RUNTIME_FILES = [
  'auth-profiles.json',
  'models.json',
];
const AGENT_REASONING_EFFORTS = new Set<AgentReasoningEffort>([
  'auto',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

interface AgentModelConfig {
  primary?: string;
  [key: string]: unknown;
}

interface AgentDefaultsConfig {
  workspace?: string;
  model?: string | AgentModelConfig;
  [key: string]: unknown;
}

interface AgentListEntry extends Record<string, unknown> {
  id: string;
  name?: string;
  default?: boolean;
  workspace?: string;
  agentDir?: string;
  model?: string | AgentModelConfig;
  // Legacy Verse Claw-only key. Runtime config schema uses thinkingDefault.
  reasoningEffort?: AgentReasoningEffort;
  thinkingDefault?: AgentReasoningEffort;
  skills?: string[];
}

interface AgentsConfig extends Record<string, unknown> {
  defaults?: AgentDefaultsConfig;
  list?: AgentListEntry[];
}

interface BindingMatch extends Record<string, unknown> {
  channel?: string;
  accountId?: string;
}

interface BindingConfig extends Record<string, unknown> {
  agentId?: string;
  match?: BindingMatch;
}

interface ChannelSectionConfig extends Record<string, unknown> {
  accounts?: Record<string, Record<string, unknown>>;
  defaultAccount?: string;
  enabled?: boolean;
}

interface AgentConfigDocument extends Record<string, unknown> {
  agents?: AgentsConfig;
  bindings?: BindingConfig[];
  channels?: Record<string, ChannelSectionConfig>;
  session?: {
    mainKey?: string;
    [key: string]: unknown;
  };
}

export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  modelRef: string | null;
  overrideModelRef: string | null;
  inheritedModel: boolean;
  reasoningEffort: AgentReasoningEffort;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
}

export interface AgentsSnapshot {
  agents: AgentSummary[];
  defaultAgentId: string;
  defaultModelRef: string | null;
  configuredChannelTypes: string[];
  channelOwners: Record<string, string>;
  channelAccountOwners: Record<string, string>;
}

export interface AgentBootstrapToolsConfig {
  defaultSkillIds: string[];
  defaultMcpServerIds: string[];
}

interface AgentBootstrapStoreDocument {
  agents: Record<string, AgentBootstrapToolsConfig>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let agentBootstrapStoreInstance: any = null;

async function getAgentBootstrapStore() {
  if (!agentBootstrapStoreInstance) {
    const Store = (await import('electron-store')).default;
    agentBootstrapStoreInstance = new Store<AgentBootstrapStoreDocument>({
      name: 'agent-bootstrap',
      defaults: {
        agents: {},
      },
    });
  }
  return agentBootstrapStoreInstance;
}

function normalizeIdList(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n|,/)
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of rawValues) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function normalizeAgentBootstrapTools(value: unknown): AgentBootstrapToolsConfig {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    defaultSkillIds: normalizeIdList(record.defaultSkillIds),
    defaultMcpServerIds: normalizeIdList(record.defaultMcpServerIds),
  };
}

function resolveModelRef(model: unknown): string | null {
  if (typeof model === 'string' && model.trim()) {
    return model.trim();
  }

  if (model && typeof model === 'object') {
    const primary = (model as AgentModelConfig).primary;
    if (typeof primary === 'string' && primary.trim()) {
      return primary.trim();
    }
  }

  return null;
}

function formatModelLabel(model: unknown): string | null {
  const modelRef = resolveModelRef(model);
  if (modelRef) {
    const trimmed = modelRef;
    const parts = trimmed.split('/');
    return parts[parts.length - 1] || trimmed;
  }

  return null;
}

function normalizeAgentName(name: string): string {
  return name.trim() || 'Agent';
}

function slugifyAgentId(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!normalized || /^\d+$/.test(normalized)) return 'agent';
  if (normalized === MAIN_AGENT_ID) return 'agent';
  return normalized;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path: string): Promise<void> {
  if (!(await fileExists(path))) {
    await mkdir(path, { recursive: true });
  }
}

function getDefaultWorkspacePath(config: AgentConfigDocument): string {
  const defaults = (config.agents && typeof config.agents === 'object'
    ? (config.agents as AgentsConfig).defaults
    : undefined);
  return typeof defaults?.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace
    : DEFAULT_WORKSPACE_PATH;
}

function getDefaultAgentDirPath(agentId: string): string {
  return `~/.openclaw/agents/${agentId}/agent`;
}

function createImplicitMainEntry(config: AgentConfigDocument): AgentListEntry {
  return {
    id: MAIN_AGENT_ID,
    name: MAIN_AGENT_NAME,
    default: true,
    workspace: getDefaultWorkspacePath(config),
    agentDir: getDefaultAgentDirPath(MAIN_AGENT_ID),
  };
}

function normalizeAgentsConfig(config: AgentConfigDocument): {
  agentsConfig: AgentsConfig;
  entries: AgentListEntry[];
  defaultAgentId: string;
  syntheticMain: boolean;
} {
  const agentsConfig = (config.agents && typeof config.agents === 'object'
    ? { ...(config.agents as AgentsConfig) }
    : {}) as AgentsConfig;
  const rawEntries = Array.isArray(agentsConfig.list)
    ? agentsConfig.list.filter((entry): entry is AgentListEntry => (
      Boolean(entry) && typeof entry === 'object' && typeof entry.id === 'string' && entry.id.trim().length > 0
    ))
    : [];

  if (rawEntries.length === 0) {
    const main = createImplicitMainEntry(config);
    return {
      agentsConfig,
      entries: [main],
      defaultAgentId: MAIN_AGENT_ID,
      syntheticMain: true,
    };
  }

  const defaultEntry = rawEntries.find((entry) => entry.default) ?? rawEntries[0];
  return {
    agentsConfig,
    entries: rawEntries.map((entry) => ({ ...entry })),
    defaultAgentId: defaultEntry.id,
    syntheticMain: false,
  };
}

function isChannelBinding(binding: unknown): binding is BindingConfig {
  if (!binding || typeof binding !== 'object') return false;
  const candidate = binding as BindingConfig;
  if (typeof candidate.agentId !== 'string' || !candidate.agentId) return false;
  if (!candidate.match || typeof candidate.match !== 'object' || Array.isArray(candidate.match)) return false;
  if (typeof candidate.match.channel !== 'string' || !candidate.match.channel) return false;
  const keys = Object.keys(candidate.match);
  // Accept bindings with just {channel} or {channel, accountId}
  if (keys.length === 1 && keys[0] === 'channel') return true;
  if (keys.length === 2 && keys.includes('channel') && keys.includes('accountId')) return true;
  return false;
}

/** Normalize agent ID for consistent comparison (bindings vs entries). */
function normalizeAgentIdForBinding(id: string): string {
  return (id ?? '').trim().toLowerCase() || '';
}

function normalizeMainKey(value: unknown): string {
  if (typeof value !== 'string') return 'main';
  const trimmed = value.trim().toLowerCase();
  return trimmed || 'main';
}

function buildAgentMainSessionKey(config: AgentConfigDocument, agentId: string): string {
  return `agent:${normalizeAgentIdForBinding(agentId) || MAIN_AGENT_ID}:${normalizeMainKey(config.session?.mainKey)}`;
}

/**
 * Returns a map of channelType -> agentId from bindings.
 * Account-scoped bindings are preferred; channel-wide bindings serve as fallback.
 * Multiple agents can own the same channel type (different accounts).
 */
function getChannelBindingMap(bindings: unknown): {
  channelToAgent: Map<string, string>;
  accountToAgent: Map<string, string>;
} {
  const channelToAgent = new Map<string, string>();
  const accountToAgent = new Map<string, string>();
  if (!Array.isArray(bindings)) return { channelToAgent, accountToAgent };

  for (const binding of bindings) {
    if (!isChannelBinding(binding)) continue;
    const agentId = normalizeAgentIdForBinding(binding.agentId!);
    const channel = binding.match?.channel;
    if (!agentId || !channel) continue;

    const accountId = binding.match?.accountId;
    if (accountId) {
      accountToAgent.set(`${channel}:${accountId}`, agentId);
    } else {
      channelToAgent.set(channel, agentId);
    }
  }

  return { channelToAgent, accountToAgent };
}

function upsertBindingsForChannel(
  bindings: unknown,
  channelType: string,
  agentId: string | null,
  accountId?: string,
): BindingConfig[] | undefined {
  const normalizedAccountId = accountId?.trim() || '';
  const nextBindings = Array.isArray(bindings)
    ? [...bindings as BindingConfig[]].filter((binding) => {
      if (!isChannelBinding(binding)) return true;
      if (binding.match?.channel !== channelType) return true;

      const bindingAccountId = typeof binding.match?.accountId === 'string'
        ? binding.match.accountId.trim()
        : '';

      // Account-scoped updates must only replace the exact account owner.
      // Otherwise rebinding one Feishu/Lark account can silently drop a
      // sibling account binding on the same agent, which looks like routing
      // or model config "drift" in multi-account setups.
      if (normalizedAccountId) {
        return bindingAccountId !== normalizedAccountId;
      }

      // No accountId: remove channel-wide binding (legacy)
      return Boolean(bindingAccountId);
    })
    : [];

  if (agentId) {
    const match: BindingMatch = { channel: channelType };
    if (normalizedAccountId) {
      match.accountId = normalizedAccountId;
    }
    nextBindings.push({ agentId, match });
  }

  return nextBindings.length > 0 ? nextBindings : undefined;
}

async function listExistingAgentIdsOnDisk(): Promise<Set<string>> {
  const ids = new Set<string>();
  const agentsDir = join(getOpenClawConfigDir(), 'agents');

  try {
    if (!(await fileExists(agentsDir))) return ids;
    const entries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) ids.add(entry.name);
    }
  } catch {
    // ignore discovery failures
  }

  return ids;
}

async function removeAgentRuntimeDirectory(agentId: string): Promise<void> {
  const runtimeDir = join(getOpenClawConfigDir(), 'agents', agentId);
  try {
    await rm(runtimeDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent runtime directory', {
      agentId,
      runtimeDir,
      error: String(error),
    });
  }
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function getManagedWorkspaceDirectory(agent: AgentListEntry): string | null {
  if (agent.id === MAIN_AGENT_ID) return null;

  const configuredWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const managedWorkspace = join(getOpenClawConfigDir(), `workspace-${agent.id}`);
  const normalizedConfigured = trimTrailingSeparators(normalize(configuredWorkspace));
  const normalizedManaged = trimTrailingSeparators(normalize(managedWorkspace));

  return normalizedConfigured === normalizedManaged ? configuredWorkspace : null;
}

export async function removeAgentWorkspaceDirectory(agent: { id: string; workspace?: string }): Promise<void> {
  const workspaceDir = getManagedWorkspaceDirectory(agent as AgentListEntry);
  if (!workspaceDir) {
    logger.warn('Skipping agent workspace deletion for unmanaged path', {
      agentId: agent.id,
      workspace: agent.workspace,
    });
    return;
  }

  try {
    await rm(workspaceDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Failed to remove agent workspace directory', {
      agentId: agent.id,
      workspaceDir,
      error: String(error),
    });
  }
}

async function copyBootstrapFiles(sourceWorkspace: string, targetWorkspace: string): Promise<void> {
  await ensureDir(targetWorkspace);

  for (const fileName of AGENT_BOOTSTRAP_FILES) {
    const source = join(sourceWorkspace, fileName);
    const target = join(targetWorkspace, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function copyRuntimeFiles(sourceAgentDir: string, targetAgentDir: string): Promise<void> {
  await ensureDir(targetAgentDir);

  for (const fileName of AGENT_RUNTIME_FILES) {
    const source = join(sourceAgentDir, fileName);
    const target = join(targetAgentDir, fileName);
    if (!(await fileExists(source)) || (await fileExists(target))) continue;
    await copyFile(source, target);
  }
}

async function provisionAgentFilesystem(
  config: AgentConfigDocument,
  agent: AgentListEntry,
  options?: { inheritWorkspace?: boolean },
): Promise<void> {
  const { entries } = normalizeAgentsConfig(config);
  const mainEntry = entries.find((entry) => entry.id === MAIN_AGENT_ID) ?? createImplicitMainEntry(config);
  const sourceWorkspace = expandPath(mainEntry.workspace || getDefaultWorkspacePath(config));
  const targetWorkspace = expandPath(agent.workspace || `~/.openclaw/workspace-${agent.id}`);
  const sourceAgentDir = expandPath(mainEntry.agentDir || getDefaultAgentDirPath(MAIN_AGENT_ID));
  const targetAgentDir = expandPath(agent.agentDir || getDefaultAgentDirPath(agent.id));
  const targetSessionsDir = join(getOpenClawConfigDir(), 'agents', agent.id, 'sessions');

  await ensureDir(targetWorkspace);
  await ensureDir(targetAgentDir);
  await ensureDir(targetSessionsDir);

  // When inheritWorkspace is true, copy the main agent's workspace bootstrap
  // files (SOUL.md, AGENTS.md, etc.) so the new agent inherits the same
  // personality / instructions. Otherwise OpenClaw will seed the missing files
  // on first use, but ClawX still pre-seeds IDENTITY.md so desktop workspaces
  // skip the chat-first bootstrap flow.
  if (options?.inheritWorkspace && targetWorkspace !== sourceWorkspace) {
    await copyBootstrapFiles(sourceWorkspace, targetWorkspace);
  }
  await ensureVerseClawIdentityFile(targetWorkspace, { createDir: true });
  if (targetAgentDir !== sourceAgentDir) {
    await copyRuntimeFiles(sourceAgentDir, targetAgentDir);
  }
}

export function resolveAccountIdForAgent(agentId: string): string {
  return agentId === MAIN_AGENT_ID ? DEFAULT_ACCOUNT_ID : agentId;
}

function listConfiguredAccountIdsForChannel(config: AgentConfigDocument, channelType: string): string[] {
  const channelSection = config.channels?.[channelType];
  if (!channelSection || channelSection.enabled === false) {
    return [];
  }

  const accounts = channelSection.accounts;
  if (!accounts || typeof accounts !== 'object' || Object.keys(accounts).length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return Object.keys(accounts)
    .filter(Boolean)
    .sort((a, b) => {
      if (a === DEFAULT_ACCOUNT_ID) return -1;
      if (b === DEFAULT_ACCOUNT_ID) return 1;
      return a.localeCompare(b);
    });
}

async function buildSnapshotFromConfig(config: AgentConfigDocument, preloadedChannels?: string[]): Promise<AgentsSnapshot> {
  const { entries, defaultAgentId } = normalizeAgentsConfig(config);
  const configuredChannels = preloadedChannels ?? await listConfiguredChannels();
  const { channelToAgent, accountToAgent } = getChannelBindingMap(config.bindings);
  const defaultAgentIdNorm = normalizeAgentIdForBinding(defaultAgentId);
  const channelOwners: Record<string, string> = {};
  const channelAccountOwners: Record<string, string> = {};

  // Build per-agent channel lists from account-scoped bindings
  const agentChannelSets = new Map<string, Set<string>>();

  for (const channelType of configuredChannels) {
    const accountIds = listConfiguredAccountIdsForChannel(config, channelType);
    let primaryOwner: string | undefined;
    const hasExplicitAccountBindingForChannel = accountIds.some((accountId) =>
      accountToAgent.has(`${channelType}:${accountId}`),
    );

    for (const accountId of accountIds) {
      const owner =
        accountToAgent.get(`${channelType}:${accountId}`)
        || (
          accountId === DEFAULT_ACCOUNT_ID && !hasExplicitAccountBindingForChannel
            ? channelToAgent.get(channelType)
            : undefined
        );

      if (!owner) {
        continue;
      }

      channelAccountOwners[`${channelType}:${accountId}`] = owner;
      primaryOwner ??= owner;
      const existing = agentChannelSets.get(owner) ?? new Set();
      existing.add(channelType);
      agentChannelSets.set(owner, existing);
    }

    if (!primaryOwner) {
      primaryOwner = channelToAgent.get(channelType) || defaultAgentIdNorm;
      const existing = agentChannelSets.get(primaryOwner) ?? new Set();
      existing.add(channelType);
      agentChannelSets.set(primaryOwner, existing);
    }

    channelOwners[channelType] = primaryOwner;
  }

  const defaultModelConfig = (config.agents as AgentsConfig | undefined)?.defaults?.model;
  const defaultModelLabel = formatModelLabel(defaultModelConfig);
  const defaultModelRef = resolveModelRef(defaultModelConfig);
  const agents: AgentSummary[] = entries.map((entry) => {
    const explicitModelRef = resolveModelRef(entry.model);
    const modelLabel = formatModelLabel(entry.model) || defaultModelLabel || 'Not configured';
    const inheritedModel = !explicitModelRef && Boolean(defaultModelLabel);
    const entryIdNorm = normalizeAgentIdForBinding(entry.id);
    const ownedChannels = agentChannelSets.get(entryIdNorm) ?? new Set<string>();
    return {
      id: entry.id,
      name: entry.name || (entry.id === MAIN_AGENT_ID ? MAIN_AGENT_NAME : entry.id),
      isDefault: entry.id === defaultAgentId,
      modelDisplay: modelLabel,
      modelRef: explicitModelRef || defaultModelRef || null,
      overrideModelRef: explicitModelRef,
      inheritedModel,
      reasoningEffort: normalizeReasoningEffort(entry.thinkingDefault ?? entry.reasoningEffort),
      workspace: entry.workspace || (entry.id === MAIN_AGENT_ID ? getDefaultWorkspacePath(config) : `~/.openclaw/workspace-${entry.id}`),
      agentDir: entry.agentDir || getDefaultAgentDirPath(entry.id),
      mainSessionKey: buildAgentMainSessionKey(config, entry.id),
      channelTypes: configuredChannels
        .filter((ct) => ownedChannels.has(ct))
        .map((channelType) => toUiChannelType(channelType)),
    };
  });

  return {
    agents,
    defaultAgentId,
    defaultModelRef,
    configuredChannelTypes: configuredChannels.map((channelType) => toUiChannelType(channelType)),
    channelOwners,
    channelAccountOwners,
  };
}

export async function listAgentsSnapshot(): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  return buildSnapshotFromConfig(config);
}

export async function listAgentsSnapshotFromConfig(config: OpenClawConfig, configuredChannels?: string[]): Promise<AgentsSnapshot> {
  return buildSnapshotFromConfig(config as AgentConfigDocument, configuredChannels);
}

export async function listConfiguredAgentIds(): Promise<string[]> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { entries } = normalizeAgentsConfig(config);
  const ids = [...new Set(entries.map((entry) => entry.id.trim()).filter(Boolean))];
  return ids.length > 0 ? ids : [MAIN_AGENT_ID];
}

async function findAgentEntry(agentId: string): Promise<AgentListEntry> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { entries } = normalizeAgentsConfig(config);
  const entry = entries.find((candidate) => candidate.id === agentId);
  if (!entry) throw new Error(`Agent "${agentId}" not found`);
  return entry;
}

export async function readAgentSoul(agentId: string): Promise<{ soulMd: string; path: string }> {
  const entry = await findAgentEntry(agentId);
  const workspacePath = expandPath(entry.workspace || (agentId === MAIN_AGENT_ID ? DEFAULT_WORKSPACE_PATH : `~/.openclaw/workspace-${agentId}`));
  const soulPath = join(workspacePath, 'SOUL.md');
  try {
    const soulMd = await readFile(soulPath, 'utf8');
    return { soulMd, path: soulPath };
  } catch {
    await ensureDir(workspacePath);
    return { soulMd: '', path: soulPath };
  }
}

export async function writeAgentSoul(agentId: string, soulMd: string): Promise<{ soulMd: string; path: string }> {
  const entry = await findAgentEntry(agentId);
  const workspacePath = expandPath(entry.workspace || (agentId === MAIN_AGENT_ID ? DEFAULT_WORKSPACE_PATH : `~/.openclaw/workspace-${agentId}`));
  const soulPath = join(workspacePath, 'SOUL.md');
  await ensureDir(workspacePath);
  await writeFile(soulPath, soulMd, 'utf8');
  return { soulMd, path: soulPath };
}

// ── Generic bootstrap file read/write ──────────────────────────────────────

const ALL_BOOTSTRAP_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'IDENTITY.md',
  'HEARTBEAT.md',
  'BOOT.md',
] as const;

type BootstrapFileName = typeof ALL_BOOTSTRAP_FILES[number];

async function resolveAgentWorkspacePath(agentId: string): Promise<string> {
  const entry = await findAgentEntry(agentId);
  return expandPath(entry.workspace || (agentId === MAIN_AGENT_ID ? DEFAULT_WORKSPACE_PATH : `~/.openclaw/workspace-${agentId}`));
}

export async function readAgentBootstrapFile(
  agentId: string,
  filename: BootstrapFileName,
): Promise<{ content: string; path: string }> {
  const workspacePath = await resolveAgentWorkspacePath(agentId);
  const filePath = join(workspacePath, filename);
  try {
    const content = await readFile(filePath, 'utf8');
    return { content, path: filePath };
  } catch {
    await ensureDir(workspacePath);
    return { content: '', path: filePath };
  }
}

export async function writeAgentBootstrapFile(
  agentId: string,
  filename: BootstrapFileName,
  content: string,
): Promise<{ path: string }> {
  const workspacePath = await resolveAgentWorkspacePath(agentId);
  const filePath = join(workspacePath, filename);
  await ensureDir(workspacePath);
  await writeFile(filePath, content, 'utf8');
  return { path: filePath };
}

// ── Structured role profile ────────────────────────────────────────────────

function compileRoleProfileToMarkdown(profile: AgentRoleProfile): string {
  const roleLabel = profile.customRole || profile.role;
  const lines: string[] = [];
  lines.push(`${profile.displayName || 'Agent'} 是一个 ${roleLabel}。`);
  lines.push('');
  lines.push('## 回复风格');
  const verbosityMap: Record<string, string> = { concise: '简洁（尽量短）', balanced: '适中', detailed: '详细（充分解释）' };
  const toneMap: Record<string, string> = { formal: '正式', casual: '口语化', friendly: '友好', direct: '直接' };
  lines.push(`- 详细程度: ${verbosityMap[profile.verbosity] || profile.verbosity}`);
  lines.push(`- 语气: ${toneMap[profile.tone] || profile.tone}`);
  if (profile.language) lines.push(`- 语言偏好: ${profile.language}`);
  if (profile.customStyle) lines.push(`- 补充: ${profile.customStyle}`);

  if (profile.expertise.length > 0) {
    lines.push('');
    lines.push('## 擅长');
    for (const item of profile.expertise) lines.push(`- ${item}`);
  }

  if (profile.limitations.length > 0) {
    lines.push('');
    lines.push('## 不擅长');
    for (const item of profile.limitations) lines.push(`- ${item}`);
  }

  if (profile.backstory.trim()) {
    lines.push('');
    lines.push('## 背景');
    lines.push(profile.backstory);
  }

  return lines.join('\n');
}

function parseRoleProfileFromMarkdown(soulMd: string, displayName: string): AgentRoleProfile {
  const profile: AgentRoleProfile = { ...DEFAULT_ROLE_PROFILE, displayName };

  // Parse first line: "X 是一个 Y。"
  const firstLine = soulMd.split('\n')[0]?.trim() || '';
  const roleMatch = firstLine.match(/^(.+?)\s*是一个\s*(.+?)[。.]?\s*$/);
  if (roleMatch) {
    if (!profile.displayName || profile.displayName === 'Agent') {
      profile.displayName = roleMatch[1].trim();
    }
    profile.role = roleMatch[2].trim();
  }

  // Parse sections
  let currentSection = '';
  const sectionLines: Record<string, string[]> = {};
  for (const line of soulMd.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '## 回复风格') { currentSection = 'style'; continue; }
    if (trimmed === '## 擅长') { currentSection = 'expertise'; continue; }
    if (trimmed === '## 不擅长') { currentSection = 'limitations'; continue; }
    if (trimmed === '## 背景') { currentSection = 'backstory'; continue; }
    if (trimmed.startsWith('## ')) { currentSection = ''; continue; }
    if (currentSection && trimmed) {
      sectionLines[currentSection] = sectionLines[currentSection] || [];
      sectionLines[currentSection].push(trimmed);
    }
  }

  // Parse style
  if (sectionLines.style) {
    for (const line of sectionLines.style) {
      if (line.includes('详细程度') || line.includes('简洁')) {
        if (line.includes('简洁')) profile.verbosity = 'concise';
        else if (line.includes('详细')) profile.verbosity = 'detailed';
      }
      if (line.includes('语气')) {
        if (line.includes('正式')) profile.tone = 'formal';
        else if (line.includes('口语')) profile.tone = 'casual';
        else if (line.includes('友好')) profile.tone = 'friendly';
        else if (line.includes('直接')) profile.tone = 'direct';
      }
      if (line.includes('语言偏好')) {
        profile.language = line.replace(/^[-*]\s*语言偏好[:：]\s*/, '').trim();
      }
    }
  }

  // Parse expertise
  if (sectionLines.expertise) {
    profile.expertise = sectionLines.expertise.map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
  }

  // Parse limitations
  if (sectionLines.limitations) {
    profile.limitations = sectionLines.limitations.map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
  }

  // Parse backstory
  if (sectionLines.backstory) {
    profile.backstory = sectionLines.backstory.join('\n');
  }

  return profile;
}

// ── Role profile sidecar (Area 1: lossless persona round-trip) ────────────
//
// SOUL.md stays free-form and hand-editable (the model-facing artifact). The
// structured `AgentRoleProfile` is mirrored to `role-profile.json` next to it,
// keyed by a `soulHash` of the SOUL.md it compiled from. On read, if the hash
// matches, the sidecar is authoritative (lossless); if the user hand-edited
// SOUL.md, the hash mismatches and the system falls back to heuristic parse —
// user edits always win.

const ROLE_PROFILE_SIDECAR_FILENAME = 'role-profile.json';

type RoleProfileSidecar = {
  version: 1;
  profile: AgentRoleProfile;
  /** sha256 of the SOUL.md this profile compiled to. */
  soulHash: string;
  /** ISO timestamp of the compilation. */
  compiledAt: string;
};

function computeSoulHash(soulMd: string): string {
  return createHash('sha256').update(soulMd, 'utf8').digest('hex');
}

async function readRoleProfileSidecar(
  workspacePath: string,
): Promise<RoleProfileSidecar | undefined> {
  const sidecarPath = join(workspacePath, ROLE_PROFILE_SIDECAR_FILENAME);
  try {
    const raw = await readFile(sidecarPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RoleProfileSidecar>;
    if (parsed.version !== 1 || !parsed.profile || typeof parsed.profile !== 'object') {
      return undefined;
    }
    if (typeof parsed.soulHash !== 'string' || typeof parsed.compiledAt !== 'string') {
      return undefined;
    }
    return parsed as RoleProfileSidecar;
  } catch {
    return undefined;
  }
}

async function writeRoleProfileSidecar(
  workspacePath: string,
  profile: AgentRoleProfile,
  soulMd: string,
): Promise<void> {
  const sidecarPath = join(workspacePath, ROLE_PROFILE_SIDECAR_FILENAME);
  const sidecar: RoleProfileSidecar = {
    version: 1,
    profile,
    soulHash: computeSoulHash(soulMd),
    compiledAt: new Date().toISOString(),
  };
  await writeFile(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf8');
}

export async function readAgentRoleProfile(agentId: string): Promise<AgentRoleProfile> {
  const entry = await findAgentEntry(agentId);
  const displayName = entry.name || agentId;
  const { soulMd } = await readAgentSoul(agentId);
  if (!soulMd.trim()) {
    return { ...DEFAULT_ROLE_PROFILE, displayName };
  }
  // Prefer the structured sidecar when its soulHash matches the current SOUL.md;
  // a mismatch means the user hand-edited SOUL.md directly, and their edit wins.
  try {
    const workspacePath = await resolveAgentWorkspacePath(agentId);
    const sidecar = await readRoleProfileSidecar(workspacePath);
    if (sidecar && sidecar.soulHash === computeSoulHash(soulMd)) {
      return sidecar.profile;
    }
  } catch {
    // Sidecar read failure → silent fallback to heuristic parse (today's behavior).
  }
  return parseRoleProfileFromMarkdown(soulMd, displayName);
}

export async function writeAgentRoleProfile(
  agentId: string,
  profile: AgentRoleProfile,
): Promise<{ soulMd: string; path: string }> {
  const markdown = compileRoleProfileToMarkdown(profile);
  const result = await writeAgentSoul(agentId, markdown);
  // Best-effort structured sidecar for lossless round-trip. Write failure is
  // non-fatal — SOUL.md is already written and is the only artifact the runtime reads.
  try {
    const workspacePath = await resolveAgentWorkspacePath(agentId);
    await writeRoleProfileSidecar(workspacePath, profile, result.soulMd);
  } catch (error) {
    logger.warn(
      `Failed to write role-profile sidecar for agent ${agentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return result;
}

export async function readAgentBootstrapTools(agentId: string): Promise<AgentBootstrapToolsConfig> {
  await findAgentEntry(agentId);
  const store = await getAgentBootstrapStore();
  const agents = store.get('agents');
  return normalizeAgentBootstrapTools(agents?.[agentId]);
}

export async function writeAgentBootstrapTools(
  agentId: string,
  patch: Partial<AgentBootstrapToolsConfig>,
): Promise<AgentBootstrapToolsConfig> {
  await findAgentEntry(agentId);
  const store = await getAgentBootstrapStore();
  const agents = store.get('agents') ?? {};
  const current = normalizeAgentBootstrapTools(agents[agentId]);
  const next: AgentBootstrapToolsConfig = {
    defaultSkillIds: patch.defaultSkillIds === undefined
      ? current.defaultSkillIds
      : normalizeIdList(patch.defaultSkillIds),
    defaultMcpServerIds: patch.defaultMcpServerIds === undefined
      ? current.defaultMcpServerIds
      : normalizeIdList(patch.defaultMcpServerIds),
  };
  store.set('agents', {
    ...agents,
    [agentId]: next,
  });
  await syncAgentDefaultSkillsToOpenClawConfig(agentId, next.defaultSkillIds);
  return next;
}

async function syncAgentDefaultSkillsToOpenClawConfig(
  agentId: string,
  defaultSkillIds: string[],
): Promise<void> {
  await withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries, syntheticMain } = normalizeAgentsConfig(config);
    const nextEntries = syntheticMain
      ? entries.map((entry) => ({ ...entry }))
      : [...entries];
    const index = nextEntries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    nextEntries[index] = {
      ...nextEntries[index],
      skills: normalizeIdList(defaultSkillIds),
    };
    config.agents = {
      ...agentsConfig,
      list: nextEntries,
    };
    await writeOpenClawConfig(config);
  });
}

/**
 * Resolve agentId from channel and accountId using bindings.
 * Returns the agentId if found, or null if no binding exists.
 */
export async function resolveAgentIdFromChannel(channel: string, accountId?: string): Promise<string | null> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { channelToAgent, accountToAgent } = getChannelBindingMap(config.bindings);

  // First try account-specific binding
  if (accountId) {
    const agentId = accountToAgent.get(`${channel}:${accountId}`);
    if (agentId) return agentId;
  }

  // Fallback to channel-only binding
  const agentId = channelToAgent.get(channel);
  return agentId ?? null;
}

export async function createAgent(
  name: string,
  options?: { inheritWorkspace?: boolean },
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries, syntheticMain } = normalizeAgentsConfig(config);
    const normalizedName = normalizeAgentName(name);
    const existingIds = new Set(entries.map((entry) => entry.id));
    const diskIds = await listExistingAgentIdsOnDisk();
    let nextId = slugifyAgentId(normalizedName);
    let suffix = 2;

    while (existingIds.has(nextId) || diskIds.has(nextId)) {
      nextId = `${slugifyAgentId(normalizedName)}-${suffix}`;
      suffix += 1;
    }

    const nextEntries = syntheticMain ? [createImplicitMainEntry(config), ...entries.filter((_, index) => index > 0)] : [...entries];
    const newAgent: AgentListEntry = {
      id: nextId,
      name: normalizedName,
      workspace: `~/.openclaw/workspace-${nextId}`,
      agentDir: getDefaultAgentDirPath(nextId),
    };

    if (!nextEntries.some((entry) => entry.id === MAIN_AGENT_ID) && syntheticMain) {
      nextEntries.unshift(createImplicitMainEntry(config));
    }
    nextEntries.push(newAgent);

    config.agents = {
      ...agentsConfig,
      list: nextEntries,
    };

    await provisionAgentFilesystem(config, newAgent, { inheritWorkspace: options?.inheritWorkspace });
    await writeOpenClawConfig(config);
    logger.info('Created agent config entry', { agentId: nextId, inheritWorkspace: !!options?.inheritWorkspace });
    return buildSnapshotFromConfig(config);
  });
}

export async function updateAgentName(agentId: string, name: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const normalizedName = normalizeAgentName(name);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    entries[index] = {
      ...entries[index],
      name: normalizedName,
    };

    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    await writeOpenClawConfig(config);
    logger.info('Updated agent name', { agentId, name: normalizedName });
    return buildSnapshotFromConfig(config);
  });
}

function isValidModelRef(modelRef: string): boolean {
  const firstSlash = modelRef.indexOf('/');
  return firstSlash > 0 && firstSlash < modelRef.length - 1;
}

function normalizeReasoningEffort(value: unknown): AgentReasoningEffort {
  return typeof value === 'string' && AGENT_REASONING_EFFORTS.has(value as AgentReasoningEffort)
    ? value as AgentReasoningEffort
    : 'auto';
}

export async function updateAgentModel(agentId: string, modelRef: string | null): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const normalizedModelRef = typeof modelRef === 'string' ? modelRef.trim() : '';
    const nextEntry: AgentListEntry = { ...entries[index] };

    if (!normalizedModelRef) {
      delete nextEntry.model;
    } else {
      if (!isValidModelRef(normalizedModelRef)) {
        throw new Error('modelRef must be in "provider/model" format');
      }
      nextEntry.model = { primary: normalizedModelRef };
    }

    entries[index] = nextEntry;
    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    await writeOpenClawConfig(config);
    logger.info('Updated agent model', { agentId, modelRef: normalizedModelRef || null });
    return buildSnapshotFromConfig(config);
  });
}

export async function updateAgentReasoningEffort(agentId: string, reasoningEffort: AgentReasoningEffort): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries } = normalizeAgentsConfig(config);
    const index = entries.findIndex((entry) => entry.id === agentId);
    if (index === -1) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const normalizedEffort = normalizeReasoningEffort(reasoningEffort);
    const nextEntry: AgentListEntry = { ...entries[index] };

    if (normalizedEffort === 'auto') {
      delete nextEntry.reasoningEffort;
      delete nextEntry.thinkingDefault;
    } else {
      delete nextEntry.reasoningEffort;
      nextEntry.thinkingDefault = normalizedEffort;
    }

    entries[index] = nextEntry;
    config.agents = {
      ...agentsConfig,
      list: entries,
    };

    await writeOpenClawConfig(config);
    logger.info('Updated agent reasoning effort', { agentId, reasoningEffort: normalizedEffort });
    return buildSnapshotFromConfig(config);
  });
}

export async function deleteAgentConfig(agentId: string): Promise<{ snapshot: AgentsSnapshot; removedEntry: AgentListEntry }> {
  return withConfigLock(async () => {
    if (agentId === MAIN_AGENT_ID) {
      throw new Error('The main agent cannot be deleted');
    }

    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { agentsConfig, entries, defaultAgentId } = normalizeAgentsConfig(config);
    const snapshotBeforeDeletion = await buildSnapshotFromConfig(config);
    const removedEntry = entries.find((entry) => entry.id === agentId);
    const nextEntries = entries.filter((entry) => entry.id !== agentId);
    if (!removedEntry || nextEntries.length === entries.length) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    config.agents = {
      ...agentsConfig,
      list: nextEntries,
    };
    config.bindings = Array.isArray(config.bindings)
      ? config.bindings.filter((binding) => !(isChannelBinding(binding) && binding.agentId === agentId))
      : undefined;

    if (defaultAgentId === agentId && nextEntries.length > 0) {
      nextEntries[0] = {
        ...nextEntries[0],
        default: true,
      };
    }

    const normalizedAgentId = normalizeAgentIdForBinding(agentId);
    const legacyAccountId = resolveAccountIdForAgent(agentId);
    const ownedLegacyAccounts = new Set(
      Object.entries(snapshotBeforeDeletion.channelAccountOwners)
        .filter(([channelAccountKey, owner]) => {
          if (owner !== normalizedAgentId) return false;
          const accountId = channelAccountKey.slice(channelAccountKey.indexOf(':') + 1);
          return accountId === legacyAccountId;
        })
        .map(([channelAccountKey]) => channelAccountKey),
    );

    await writeOpenClawConfig(config);
    await deleteAgentChannelAccounts(agentId, ownedLegacyAccounts);
    await removeAgentRuntimeDirectory(agentId);
    // NOTE: workspace directory is NOT deleted here intentionally.
    // The caller (route handler) defers workspace removal until after
    // the Gateway process has fully restarted, so that any in-flight
    // process.chdir(workspace) calls complete before the directory
    // disappears (otherwise process.cwd() throws ENOENT for the rest
    // of the Gateway's lifetime).
    logger.info('Deleted agent config entry', { agentId });
    return { snapshot: await buildSnapshotFromConfig(config), removedEntry };
  });
}

export async function assignChannelToAgent(agentId: string, channelType: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    if (!entries.some((entry) => entry.id === agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    const accountId = resolveAccountIdForAgent(agentId);
    config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId, accountId);
    await writeOpenClawConfig(config);
    logger.info('Assigned channel to agent', { agentId, channelType, accountId });
    return buildSnapshotFromConfig(config);
  });
}

export async function assignChannelAccountToAgent(
  agentId: string,
  channelType: string,
  accountId: string,
): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    const { entries } = normalizeAgentsConfig(config);
    if (!entries.some((entry) => entry.id === agentId)) {
      throw new Error(`Agent "${agentId}" not found`);
    }
    if (!accountId.trim()) {
      throw new Error('accountId is required');
    }

    config.bindings = upsertBindingsForChannel(config.bindings, channelType, agentId, accountId.trim());
    await writeOpenClawConfig(config);
    logger.info('Assigned channel account to agent', { agentId, channelType, accountId: accountId.trim() });
    return buildSnapshotFromConfig(config);
  });
}

export async function clearChannelBinding(channelType: string, accountId?: string): Promise<AgentsSnapshot> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    config.bindings = upsertBindingsForChannel(config.bindings, channelType, null, accountId);
    await writeOpenClawConfig(config);
    logger.info('Cleared channel binding', { channelType, accountId });
    return buildSnapshotFromConfig(config);
  });
}

export async function clearAllBindingsForChannel(channelType: string): Promise<void> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig() as AgentConfigDocument;
    if (!Array.isArray(config.bindings)) return;

    const nextBindings = config.bindings.filter((binding) => {
      if (!isChannelBinding(binding)) return true;
      return binding.match?.channel !== channelType;
    });

    config.bindings = nextBindings.length > 0 ? nextBindings : undefined;
    await writeOpenClawConfig(config);
    logger.info('Cleared all bindings for channel', { channelType });
  });
}
