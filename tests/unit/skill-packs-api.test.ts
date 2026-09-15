import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSkillPacksApi,
  OFFICECLI_SKILL_DEFS,
  runOfficeCliInstallForSkillPack,
  SUPERPOWERS_CORE_SKILLS,
} from '@electron/services/skill-packs-api';

describe('skill packs api', () => {
  let root: string;
  let skillsRoot: string;
  let superpowersSourceDir: string;
  let configs: Record<string, { enabled?: boolean }>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'clawx-skill-packs-'));
    skillsRoot = join(root, 'openclaw-skills');
    superpowersSourceDir = join(root, 'bundled-superpowers');
    configs = {};
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  function api() {
    return createSkillPacksApi({
      skillsRoot,
      superpowersSourceDir,
      readConfigs: async () => configs,
      updateConfigs: async (updates) => {
        for (const update of updates) {
          configs[update.skillKey] = {
            ...configs[update.skillKey],
            enabled: update.enabled,
          };
        }
        return { success: true };
      },
      runCommand: async (_command, args) => {
        if (args.includes('--version')) {
          return { exitCode: 0, stdout: 'officecli 1.2.3', stderr: '' };
        }
        const loadIndex = args.indexOf('load_skill');
        if (loadIndex >= 0) {
          const loadId = args[loadIndex + 1] ?? 'unknown';
          return {
            exitCode: 0,
            stdout: `---\nname: officecli-${loadId}\ndescription: Loaded ${loadId}\n---\nUse officecli ${loadId}.`,
            stderr: '',
          };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      resolveOfficeCli: async () => join(root, 'officecli'),
      installOfficeCli: async () => ({ success: true }),
    });
  }

  it('installs bundled Superpowers skills disabled by default, then enables the recommended core set', async () => {
    const service = api();

    await service.install({ packId: 'superpowers' });

    const skillMd = await readFile(join(skillsRoot, 'brainstorming', 'SKILL.md'), 'utf-8');
    expect(skillMd).toContain('name: brainstorming');
    expect(JSON.parse(await readFile(join(skillsRoot, 'brainstorming', '.clawx-pack.json'), 'utf-8'))).toMatchObject({
      packId: 'superpowers',
      skillId: 'brainstorming',
    });
    expect(configs.brainstorming?.enabled).toBe(false);

    await service.setEnabled({ packId: 'superpowers', enabled: true });

    for (const skillId of SUPERPOWERS_CORE_SKILLS) {
      expect(configs[skillId]?.enabled).toBe(true);
    }
    expect(configs['executing-plans']?.enabled).toBe(false);
  });

  it('syncs Office CLI skills from load_skill output and keeps them hidden until enabled', async () => {
    const service = api();

    await service.install({ packId: 'officecli' });

    const wordSkill = await readFile(join(skillsRoot, 'officecli-docx', 'SKILL.md'), 'utf-8');
    expect(wordSkill).toContain('Loaded word');
    expect(configs['officecli-docx']?.enabled).toBe(false);

    await service.setEnabled({ packId: 'officecli', enabled: true });

    for (const skill of OFFICECLI_SKILL_DEFS) {
      expect(configs[skill.id]?.enabled).toBe(true);
      await expect(stat(join(skillsRoot, skill.id, '.clawx-pack.json'))).resolves.toBeTruthy();
    }
  });

  it('normalizes Office CLI skill invocation names to Codeg-compatible ids', async () => {
    const service = api();

    await service.install({ packId: 'officecli' });

    const wordSkill = await readFile(join(skillsRoot, 'officecli-docx', 'SKILL.md'), 'utf-8');
    expect(wordSkill).toContain('name: officecli-docx');
    expect(wordSkill).toContain('Use officecli word.');
  });

  it('preserves Office CLI enabled state when syncing after a pack is enabled', async () => {
    const service = api();

    await service.install({ packId: 'officecli' });
    await service.setEnabled({ packId: 'officecli', enabled: true });
    await service.sync({ packId: 'officecli' });

    for (const skill of OFFICECLI_SKILL_DEFS) {
      expect(configs[skill.id]?.enabled).toBe(true);
    }
  });

  it('keeps newly synced Office CLI skills disabled until the pack is explicitly enabled', async () => {
    const service = api();

    await service.sync({ packId: 'officecli' });

    for (const skill of OFFICECLI_SKILL_DEFS) {
      expect(configs[skill.id]?.enabled).toBe(false);
    }
  });

  it('serializes Office CLI pack sync mutations', async () => {
    let activeLoads = 0;
    let overlapped = false;
    const service = createSkillPacksApi({
      skillsRoot,
      superpowersSourceDir,
      readConfigs: async () => configs,
      updateConfigs: async (updates) => {
        for (const update of updates) {
          configs[update.skillKey] = {
            ...configs[update.skillKey],
            enabled: update.enabled,
          };
        }
        return { success: true };
      },
      resolveOfficeCli: async () => join(root, 'officecli'),
      runCommand: async (_command, args) => {
        const loadIndex = args.indexOf('load_skill');
        if (loadIndex >= 0) {
          if (activeLoads > 0) overlapped = true;
          activeLoads += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          activeLoads -= 1;
          const loadId = args[loadIndex + 1] ?? 'unknown';
          return {
            exitCode: 0,
            stdout: `---\nname: officecli-${loadId}\n---\nUse officecli ${loadId}.`,
            stderr: '',
          };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    await Promise.all([
      service.sync({ packId: 'officecli' }),
      service.sync({ packId: 'officecli' }),
    ]);

    expect(overlapped).toBe(false);
  });

  it('reports Office CLI as not installed before running pack sync commands when no binary resolves', async () => {
    vi.stubEnv('LOCALAPPDATA', join(root, 'missing-local-app-data'));
    vi.stubEnv('HOME', join(root, 'missing-home'));
    vi.stubEnv('PATH', '');
    vi.stubEnv('Path', '');
    const runCalls: string[][] = [];
    const service = createSkillPacksApi({
      skillsRoot,
      superpowersSourceDir,
      readConfigs: async () => configs,
      updateConfigs: async () => ({ success: true }),
      runCommand: async (_command, args) => {
        runCalls.push(args);
        return { exitCode: 0, stdout: 'unexpected', stderr: '' };
      },
    });

    const result = await service.sync({ packId: 'officecli' });

    expect(result).toEqual({ success: false, error: 'officecli is not installed' });
    expect(runCalls).toEqual([]);
  });

  it('runs Office CLI pack install through the shared process-tree-aware installer runner', async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(() => true),
    });
    const spawnCalls: Array<{ command: string; args: string[]; options: { detached?: boolean; windowsHide?: boolean } }> = [];
    const runnerCalls: Array<{ child: unknown; taskId: string }> = [];

    const result = await runOfficeCliInstallForSkillPack({
      spawnProcess: ((command: string, args: string[], options: { detached?: boolean; windowsHide?: boolean } = {}) => {
        spawnCalls.push({ command, args, options });
        return child;
      }) as never,
      runInstallChildProcess: async (spawned, ctx) => {
        runnerCalls.push({ child: spawned, taskId: ctx.taskId });
        return { success: true };
      },
    });

    expect(result).toEqual({ success: true });
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].options).toMatchObject({
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    expect(runnerCalls).toEqual([{ child, taskId: '' }]);
  });
});
