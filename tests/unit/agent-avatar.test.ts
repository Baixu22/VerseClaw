import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  agentAvatarSeed,
  defaultAgentAvatarPreset,
  defaultAgentAvatarView,
  normalizeAgentAvatarPreset,
  renderAgentAvatarSvg,
} from '@shared/agent-avatar';
import {
  MANAGED_AGENT_AVATAR_SOURCE,
  parseAgentIdentityMarkdown,
  readManagedAgentAvatarPreset,
  removeManagedAgentAvatar,
  resolveAgentAvatarView,
  writeManagedAgentAvatar,
} from '@electron/utils/agent-avatar';

const workspace = join(
  process.env.CLAWX_TEST_TMPDIR ?? join(process.cwd(), '.tmp', 'vitest'),
  `agent-avatar-${Math.random().toString(36).slice(2)}`,
);

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('local Agent avatars', () => {
  it('renders the same SVG for the same agent id and preset without using a display name', () => {
    const preset = { ...defaultAgentAvatarPreset('research'), seed: 'stable-face' };
    expect(agentAvatarSeed('research', preset)).toBe('verse-claw:assistant:research:stable-face');
    expect(renderAgentAvatarSvg('research', preset)).toBe(renderAgentAvatarSvg('research', preset));
    expect(renderAgentAvatarSvg('research', preset)).not.toBe(renderAgentAvatarSvg('renamed-id', preset));
  });

  it('validates style, seed length, and six-digit hexadecimal colors', () => {
    expect(normalizeAgentAvatarPreset({
      style: 'identicon',
      seed: ' valid ',
      backgroundColor: '#AABBCC',
    })).toEqual({ style: 'identicon', seed: 'valid', backgroundColor: '#aabbcc' });
    expect(normalizeAgentAvatarPreset({ style: 'bottts', seed: 'x', backgroundColor: '#aabbcc' })).toBeNull();
    expect(normalizeAgentAvatarPreset({ style: 'identicon', seed: '', backgroundColor: '#aabbcc' })).toBeNull();
    expect(normalizeAgentAvatarPreset({ style: 'identicon', seed: 'x'.repeat(129), backgroundColor: '#aabbcc' })).toBeNull();
    expect(normalizeAgentAvatarPreset({ style: 'identicon', seed: 'x', backgroundColor: 'red' })).toBeNull();
  });

  it('keeps the Verse brand as the main default and DiceBear as other deterministic fallbacks', () => {
    expect(defaultAgentAvatarView('main')).toMatchObject({ kind: 'brand', source: 'default' });
    expect(defaultAgentAvatarView('research')).toMatchObject({
      kind: 'fallback',
      source: 'default',
      preset: defaultAgentAvatarPreset('research'),
    });
  });

  it('atomically replaces persisted metadata and SVG, then removes only managed files', async () => {
    await mkdir(workspace, { recursive: true });
    const first = { ...defaultAgentAvatarPreset('research'), seed: 'first' };
    const second = { style: 'identicon' as const, seed: 'second', backgroundColor: '#dcfce7' };

    await writeManagedAgentAvatar(workspace, 'research', first);
    await writeManagedAgentAvatar(workspace, 'research', second);

    await expect(readManagedAgentAvatarPreset(workspace)).resolves.toEqual(second);
    await expect(readFile(join(workspace, MANAGED_AGENT_AVATAR_SOURCE), 'utf8')).resolves.toContain('<svg');
    await writeFile(join(workspace, 'IDENTITY.md'), '- Avatar: custom.png\n', 'utf8');
    await removeManagedAgentAvatar(workspace);
    await expect(readFile(join(workspace, 'IDENTITY.md'), 'utf8')).resolves.toContain('custom.png');
    await expect(readManagedAgentAvatarPreset(workspace)).resolves.toBeNull();
  });

  it('falls through an invalid config override to IDENTITY.md and projects local files as data URIs', async () => {
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, 'identity.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');
    await expect(resolveAgentAvatarView({
      agentId: 'research',
      workspace,
      configAvatar: 'missing.svg',
      identityAvatar: 'identity.svg',
    })).resolves.toMatchObject({ kind: 'image', source: 'identity', uri: expect.stringMatching(/^data:image\/svg\+xml;base64,/) });
  });

  it('parses emoji and avatar fields from IDENTITY.md bullets', () => {
    expect(parseAgentIdentityMarkdown('- **Emoji:** 🧭\n- **Avatar:** portraits/guide.svg\n')).toEqual({
      emoji: '🧭',
      avatar: 'portraits/guide.svg',
    });
  });
});
