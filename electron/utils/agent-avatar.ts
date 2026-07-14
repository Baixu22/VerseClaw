import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'path';
import {
  agentAvatarRevision,
  defaultAgentAvatarPreset,
  normalizeAgentAvatarPreset,
  renderAgentAvatarSvg,
} from '@shared/agent-avatar';
import type { AgentAvatarPreset, AgentAvatarView } from '@shared/types/agent';

export const MANAGED_AGENT_AVATAR_SOURCE = '.clawx/avatar/avatar.svg';
const MANAGED_AGENT_AVATAR_CONFIG = '.clawx/avatar/avatar.json';
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

type PersistedAgentAvatar = {
  schemaVersion: 1;
  provider: 'dicebear';
  preset: AgentAvatarPreset;
};

export type ParsedAgentIdentity = {
  emoji?: string;
  avatar?: string;
};

function managedPath(workspace: string, source: string): string {
  return join(workspace, ...source.split('/'));
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, 'utf8');
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export function parseAgentIdentityMarkdown(content: string | undefined): ParsedAgentIdentity {
  const result: ParsedAgentIdentity = {};
  for (const line of (content ?? '').split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^\s*-\s*/, '');
    const colonIndex = cleaned.indexOf(':');
    if (colonIndex < 0) continue;
    const label = cleaned.slice(0, colonIndex).replace(/[*_`]/g, '').trim().toLowerCase();
    const value = cleaned.slice(colonIndex + 1).replace(/^[*_`\s]+|[*_`\s]+$/g, '').trim();
    if (!value) continue;
    if (label === 'emoji') result.emoji = value;
    if (label === 'avatar') result.avatar = value;
  }
  return result;
}

export async function readManagedAgentAvatarPreset(workspace: string): Promise<AgentAvatarPreset | null> {
  try {
    const content = await readFile(managedPath(workspace, MANAGED_AGENT_AVATAR_CONFIG), 'utf8');
    const parsed = JSON.parse(content) as Partial<PersistedAgentAvatar>;
    if (parsed.schemaVersion !== 1 || parsed.provider !== 'dicebear') return null;
    return normalizeAgentAvatarPreset(parsed.preset);
  } catch {
    return null;
  }
}

export async function writeManagedAgentAvatar(
  workspace: string,
  agentId: string,
  value: unknown,
): Promise<AgentAvatarPreset> {
  const preset = normalizeAgentAvatarPreset(value);
  if (!preset) throw new Error('Avatar preset is invalid');
  const avatarDir = managedPath(workspace, '.clawx/avatar');
  await mkdir(avatarDir, { recursive: true });
  const svg = renderAgentAvatarSvg(agentId, preset, 256);
  const metadata: PersistedAgentAvatar = { schemaVersion: 1, provider: 'dicebear', preset };
  await writeAtomic(managedPath(workspace, MANAGED_AGENT_AVATAR_SOURCE), svg);
  await writeAtomic(
    managedPath(workspace, MANAGED_AGENT_AVATAR_CONFIG),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  return preset;
}

export async function removeManagedAgentAvatar(workspace: string): Promise<void> {
  await Promise.all([
    rm(managedPath(workspace, MANAGED_AGENT_AVATAR_SOURCE), { force: true }),
    rm(managedPath(workspace, MANAGED_AGENT_AVATAR_CONFIG), { force: true }),
  ]);
}

function isInsideWorkspace(workspace: string, target: string): boolean {
  const rel = relative(resolve(workspace), resolve(target));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function localAvatarDataUri(workspace: string, source: string): Promise<string | null> {
  const target = resolve(workspace, source);
  if (!isInsideWorkspace(workspace, target)) return null;
  const mime = MIME_BY_EXTENSION[extname(target).toLowerCase()];
  if (!mime) return null;
  try {
    const info = await stat(target);
    if (!info.isFile() || info.size > AVATAR_MAX_BYTES) return null;
    const content = await readFile(target);
    return `data:${mime};base64,${content.toString('base64')}`;
  } catch {
    return null;
  }
}

function imageRevision(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 12);
}

export async function resolveAgentAvatarView(params: {
  agentId: string;
  workspace: string;
  configAvatar?: string;
  identityAvatar?: string;
}): Promise<AgentAvatarView> {
  const resolveSource = async (
    source: string | undefined,
    sourceKind: 'config' | 'identity',
  ): Promise<AgentAvatarView | null> => {
    const normalizedSource = source?.trim();
    if (!normalizedSource) return null;
    if (normalizedSource === MANAGED_AGENT_AVATAR_SOURCE) {
      const preset = await readManagedAgentAvatarPreset(params.workspace);
      if (preset) {
        return {
          kind: 'dicebear',
          source: 'config',
          preset,
          revision: agentAvatarRevision(params.agentId, preset),
        };
      }
    }
    if (/^https?:\/\//i.test(normalizedSource) || /^data:image\//i.test(normalizedSource)) {
      return { kind: 'image', source: sourceKind, uri: normalizedSource, revision: imageRevision(normalizedSource) };
    }
    const uri = await localAvatarDataUri(params.workspace, normalizedSource);
    if (uri) return { kind: 'image', source: sourceKind, uri, revision: imageRevision(uri) };
    return null;
  };

  const configAvatar = await resolveSource(params.configAvatar, 'config');
  if (configAvatar) return configAvatar;
  const identityAvatar = await resolveSource(params.identityAvatar, 'identity');
  if (identityAvatar) return identityAvatar;
  if (params.agentId === 'main') {
    return { kind: 'brand', source: 'default', revision: 'verse-brand-v1' };
  }
  const preset = defaultAgentAvatarPreset(params.agentId);
  return {
    kind: 'fallback',
    source: 'default',
    preset,
    revision: agentAvatarRevision(params.agentId, preset),
  };
}
