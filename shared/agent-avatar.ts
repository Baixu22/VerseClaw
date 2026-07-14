import { Avatar, Style } from '@dicebear/core';
import identiconDefinition from '@dicebear/styles/identicon.json';
import loreleiNeutralDefinition from '@dicebear/styles/lorelei-neutral.json';
import notionistsNeutralDefinition from '@dicebear/styles/notionists-neutral.json';
import pixelArtNeutralDefinition from '@dicebear/styles/pixel-art-neutral.json';
import {
  AGENT_AVATAR_STYLES,
  type AgentAvatarPreset,
  type AgentAvatarStyle,
  type AgentAvatarView,
} from './types/agent';

export const DEFAULT_AGENT_AVATAR_STYLE: AgentAvatarStyle = 'lorelei-neutral';
export const DEFAULT_AGENT_AVATAR_BACKGROUND = '#dbeafe';
export const AGENT_AVATAR_BACKGROUNDS = [
  '#dbeafe',
  '#ede9fe',
  '#dcfce7',
  '#fef3c7',
  '#fee2e2',
  '#cffafe',
] as const;

const AGENT_AVATAR_STYLE_SET = new Set<string>(AGENT_AVATAR_STYLES);
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const STYLES = {
  'lorelei-neutral': new Style(loreleiNeutralDefinition),
  'notionists-neutral': new Style(notionistsNeutralDefinition),
  'pixel-art-neutral': new Style(pixelArtNeutralDefinition),
  identicon: new Style(identiconDefinition),
} satisfies Record<AgentAvatarStyle, Style>;

export function defaultAgentAvatarPreset(agentId: string): AgentAvatarPreset {
  return {
    style: DEFAULT_AGENT_AVATAR_STYLE,
    seed: agentId.trim() || 'agent',
    backgroundColor: DEFAULT_AGENT_AVATAR_BACKGROUND,
  };
}

export function defaultAgentAvatarView(agentId: string): AgentAvatarView {
  if (agentId === 'main') return { kind: 'brand', source: 'default', revision: 'verse-brand-v1' };
  const preset = defaultAgentAvatarPreset(agentId);
  return {
    kind: 'fallback',
    source: 'default',
    preset,
    revision: agentAvatarRevision(agentId, preset),
  };
}

export function normalizeAgentAvatarPreset(value: unknown): AgentAvatarPreset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const style = typeof record.style === 'string' && AGENT_AVATAR_STYLE_SET.has(record.style)
    ? record.style as AgentAvatarStyle
    : null;
  const seed = typeof record.seed === 'string' ? record.seed.trim() : '';
  const backgroundColor = typeof record.backgroundColor === 'string'
    ? record.backgroundColor.trim().toLowerCase()
    : '';
  if (!style || !seed || seed.length > 128 || !HEX_COLOR_PATTERN.test(backgroundColor)) return null;
  return { style, seed, backgroundColor };
}

export function agentAvatarSeed(agentId: string, preset: AgentAvatarPreset): string {
  return `verse-claw:assistant:${agentId}:${preset.seed}`;
}

export function renderAgentAvatarSvg(agentId: string, preset: AgentAvatarPreset, size = 96): string {
  const normalized = normalizeAgentAvatarPreset(preset);
  if (!normalized) throw new Error('Invalid agent avatar preset');
  return new Avatar(STYLES[normalized.style], {
    seed: agentAvatarSeed(agentId, normalized),
    size,
    borderRadius: 50,
    backgroundColor: [normalized.backgroundColor],
  }).toString();
}

export function renderAgentAvatarDataUri(agentId: string, preset: AgentAvatarPreset, size = 96): string {
  const normalized = normalizeAgentAvatarPreset(preset);
  if (!normalized) throw new Error('Invalid agent avatar preset');
  return new Avatar(STYLES[normalized.style], {
    seed: agentAvatarSeed(agentId, normalized),
    size,
    borderRadius: 50,
    backgroundColor: [normalized.backgroundColor],
  }).toDataUri();
}

export function agentAvatarRevision(agentId: string, preset: AgentAvatarPreset): string {
  const input = `${agentId}\n${preset.style}\n${preset.seed}\n${preset.backgroundColor}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
