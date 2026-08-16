import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const { testHome } = vi.hoisted(() => ({
  testHome: `${process.env.CLAWX_TEST_TMPDIR ?? `${process.cwd()}/.tmp/vitest`}/clawx-openclaw-workspace-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

import {
  ensureVerseClawContext,
  ensureVerseClawDefaultIdentity,
  ensureVerseClawIdentityFile,
  mergeVerseClawSection,
  stripFirstRunSection,
  stripLegacyClawxSection,
} from '../../electron/utils/openclaw-workspace';

beforeEach(async () => {
  await rm(testHome, { recursive: true, force: true });
});

describe('stripFirstRunSection', () => {
  it('removes the First Run section when it exists', () => {
    const input = [
      '# AGENTS.md',
      '',
      'Some preamble content.',
      '',
      '## First Run',
      '',
      "If `BOOTSTRAP.md` exists, that's your birth certificate. Follow it, figure out who you are, then delete it. You won't need it again.",
      '',
      '## Other Section',
      '',
      'Other content.',
    ].join('\n');

    const result = stripFirstRunSection(input);
    expect(result).not.toContain('## First Run');
    expect(result).not.toContain('BOOTSTRAP.md');
    expect(result).toContain('# AGENTS.md');
    expect(result).toContain('Some preamble content.');
    expect(result).toContain('## Other Section');
    expect(result).toContain('Other content.');
  });

  it('returns content unchanged when no First Run section exists', () => {
    const input = '# AGENTS.md\n\nSome content.\n';
    expect(stripFirstRunSection(input)).toBe(input);
  });

  it('handles First Run section at end of file', () => {
    const input = [
      '# AGENTS.md',
      '',
      '## First Run',
      '',
      'Bootstrap text.',
      '',
    ].join('\n');

    const result = stripFirstRunSection(input);
    expect(result).not.toContain('## First Run');
    expect(result).not.toContain('Bootstrap text');
    expect(result).toContain('# AGENTS.md');
  });

  it('does not collapse adjacent sections', () => {
    const input = [
      '## Section A',
      'content a',
      '',
      '## First Run',
      '',
      'bootstrap text',
      '',
      '## Section B',
      'content b',
    ].join('\n');

    const result = stripFirstRunSection(input);
    expect(result).toContain('## Section A');
    expect(result).toContain('content a');
    expect(result).toContain('## Section B');
    expect(result).toContain('content b');
    expect(result).not.toContain('## First Run');
  });

  it('does not remove sections with similar but different names', () => {
    const input = [
      '## First Run Setup',
      'This should stay.',
      '',
      '## First Run',
      'This should go.',
    ].join('\n');

    const result = stripFirstRunSection(input);
    expect(result).toContain('## First Run Setup');
    expect(result).toContain('This should stay.');
    expect(result).not.toContain('This should go.');
  });

  it('collapses triple blank lines left by removal', () => {
    const input = [
      'before',
      '',
      '',
      '## First Run',
      '',
      'text',
      '',
      '',
      'after',
    ].join('\n');

    const result = stripFirstRunSection(input);
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain('before');
    expect(result).toContain('after');
  });

  it('still changes AGENTS content when only First Run is removed', () => {
    const section = [
      '## Verse Claw Environment',
      '',
      'You are Verse Claw.',
    ].join('\n');
    const original = [
      '# AGENTS.md',
      '',
      '## First Run',
      '',
      "If `BOOTSTRAP.md` exists, that's your birth certificate. Follow it, figure out who you are, then delete it. You won't need it again.",
      '',
      '## Session Startup',
      '',
      'Read SOUL.md first.',
      '',
      '<!-- clawx:begin -->',
      '## Verse Claw Environment',
      '',
      'You are Verse Claw.',
      '<!-- clawx:end -->',
      '',
    ].join('\n');

    const stripped = stripFirstRunSection(original);
    const merged = mergeVerseClawSection(stripLegacyClawxSection(stripped), section);

    expect(merged).not.toBe(original);
    expect(merged).not.toContain('## First Run');
    expect(merged).toContain('## Session Startup');
    expect(merged).not.toContain('<!-- clawx:begin -->');
    expect(merged).not.toContain('<!-- clawx:end -->');
  });
});

describe('stripLegacyClawxSection', () => {
  it('removes a legacy ClawX block while preserving surrounding content', () => {
    const input = [
      'before',
      '',
      '<!-- clawx:begin -->',
      '## ClawX Environment',
      'duplicated legacy text',
      '<!-- clawx:end -->',
      '',
      'after',
    ].join('\n');

    const result = stripLegacyClawxSection(input);
    expect(result).not.toContain('<!-- clawx:begin -->');
    expect(result).not.toContain('duplicated legacy text');
    expect(result).toContain('before');
    expect(result).toContain('after');
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('returns content unchanged when no legacy block exists', () => {
    const input = '# AGENTS.md\n\nContent.\n';
    expect(stripLegacyClawxSection(input)).toBe(input);
  });

  it('returns content unchanged for a dangling legacy begin marker', () => {
    const input = '# AGENTS.md\n\n<!-- clawx:begin -->\nno end marker';
    expect(stripLegacyClawxSection(input)).toBe(input);
  });
});

describe('ensureVerseClawIdentityFile', () => {
  it('writes a default Verse Claw identity when the workspace has none', async () => {
    const workspaceDir = join(testHome, '.openclaw', 'workspace');
    await mkdir(workspaceDir, { recursive: true });

    await ensureVerseClawIdentityFile(workspaceDir);

    await expect(readFile(join(workspaceDir, 'IDENTITY.md'), 'utf-8')).resolves.toContain('Verse Claw');
    await expect(readFile(join(workspaceDir, '.verse-claw', 'harness', 'README.md'), 'utf-8')).resolves.toContain('Verse Claw Agent Harness');
    await expect(readFile(join(workspaceDir, '.verse-claw', 'harness', 'specs', 'tasks', '_template.md'), 'utf-8')).resolves.toContain('type: task');
    await expect(readFile(join(workspaceDir, '.verse-claw', 'harness', 'workspace', 'task-index.md'), 'utf-8')).resolves.toContain('Task Ledger Bridge');
  });

  it('replaces the untouched OpenClaw identity template but preserves custom identities', async () => {
    const workspaceDir = join(testHome, '.openclaw', 'workspace');
    await mkdir(workspaceDir, { recursive: true });

    await writeFile(
      join(workspaceDir, 'IDENTITY.md'),
      [
        '# IDENTITY.md - Who Am I?',
        '',
        '_Fill this in during your first conversation. Make it yours._',
        '',
        '- **Name:**',
        '  _(pick something you like)_',
        '- **Creature:**',
        '  _(AI? robot? familiar? ghost in the machine? something weirder?)_',
        '- **Vibe:**',
        '  _(how do you come across? sharp? warm? chaotic? calm?)_',
        '- **Emoji:**',
        '  _(your signature -pick one that feels right)_',
      ].join('\n'),
      'utf-8',
    );

    await ensureVerseClawIdentityFile(workspaceDir);
    await expect(readFile(join(workspaceDir, 'IDENTITY.md'), 'utf-8')).resolves.toContain('Verse Claw');
    await expect(readFile(join(workspaceDir, 'IDENTITY.md'), 'utf-8')).resolves.not.toContain('pick something you like');

    await writeFile(join(workspaceDir, 'IDENTITY.md'), '# IDENTITY.md\n\n- **Name:** Paisley\n', 'utf-8');
    await ensureVerseClawIdentityFile(workspaceDir);
    await expect(readFile(join(workspaceDir, 'IDENTITY.md'), 'utf-8')).resolves.toBe('# IDENTITY.md\n\n- **Name:** Paisley\n');
  });

  it('removes a lingering BOOTSTRAP.md after identity seeding', async () => {
    const workspaceDir = join(testHome, '.openclaw', 'workspace');
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(join(workspaceDir, 'BOOTSTRAP.md'), 'chat-first bootstrap', 'utf-8');

    await ensureVerseClawIdentityFile(workspaceDir);

    await expect(access(join(workspaceDir, 'BOOTSTRAP.md'))).rejects.toThrow();
    await expect(readFile(join(workspaceDir, 'IDENTITY.md'), 'utf-8')).resolves.toContain('Verse Claw');
  });

  it('preserves existing Verse Claw harness files while filling missing templates', async () => {
    const workspaceDir = join(testHome, '.openclaw', 'workspace');
    const harnessDir = join(workspaceDir, '.verse-claw', 'harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(join(harnessDir, 'README.md'), '# Custom Harness\n', 'utf-8');

    await ensureVerseClawIdentityFile(workspaceDir);

    await expect(readFile(join(harnessDir, 'README.md'), 'utf-8')).resolves.toBe('# Custom Harness\n');
    await expect(readFile(join(harnessDir, 'workspace', 'schema.md'), 'utf-8')).resolves.toContain('Workspace Journal Schema');
  });
});

describe('ensureVerseClawDefaultIdentity', () => {
  it('creates the default workspace and seeds IDENTITY.md for startup-owned workspaces', async () => {
    await ensureVerseClawDefaultIdentity();

    await expect(readFile(join(testHome, '.openclaw', 'workspace', 'IDENTITY.md'), 'utf-8')).resolves.toContain('Verse Claw');
    await expect(readFile(join(testHome, '.openclaw', 'workspace', '.verse-claw', 'harness', 'README.md'), 'utf-8')).resolves.toContain('Verse Claw Agent Harness');
  });
});

describe('ensureVerseClawContext', () => {
  it('does not wait for missing files in non-default agent workspaces', async () => {
    const openclawDir = join(testHome, '.openclaw');
    const defaultWorkspace = join(openclawDir, 'workspace-main');
    const agentWorkspace = join(openclawDir, 'workspace-agent');
    await mkdir(defaultWorkspace, { recursive: true });
    await mkdir(agentWorkspace, { recursive: true });
    await writeFile(join(defaultWorkspace, 'AGENTS.md'), '# AGENTS.md\n\nExisting agents.\n', 'utf-8');
    await writeFile(join(defaultWorkspace, 'TOOLS.md'), '# TOOLS.md\n\nExisting tools.\n', 'utf-8');
    await writeFile(
      join(openclawDir, 'openclaw.json'),
      JSON.stringify({
        agents: {
          defaults: { workspace: defaultWorkspace },
          list: [{ id: 'agent', workspace: agentWorkspace }],
        },
      }),
      'utf-8',
    );

    const result = await Promise.race([
      ensureVerseClawContext().then(() => 'done'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 200)),
    ]);

    expect(result).toBe('done');
    await expect(readFile(join(defaultWorkspace, 'AGENTS.md'), 'utf-8')).resolves.toContain('## Verse Claw Environment');
    await expect(readFile(join(defaultWorkspace, 'TOOLS.md'), 'utf-8')).resolves.toContain('## Verse Claw Tool Notes');
    await expect(access(join(agentWorkspace, 'AGENTS.md'))).rejects.toThrow();
    await expect(access(join(agentWorkspace, 'TOOLS.md'))).rejects.toThrow();
  });

  it('does not wait for missing external default workspaces', async () => {
    const openclawDir = join(testHome, '.openclaw');
    const externalWorkspace = join(testHome, '..', `external-missing-${Date.now()}`);
    await mkdir(openclawDir, { recursive: true });
    await writeFile(
      join(openclawDir, 'openclaw.json'),
      JSON.stringify({
        agents: {
          defaults: { workspace: externalWorkspace },
        },
      }),
      'utf-8',
    );

    const result = await Promise.race([
      ensureVerseClawContext().then(() => 'done'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 200)),
    ]);

    expect(result).toBe('done');
  });
});
