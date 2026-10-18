import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { execFile, spawn } from '../utils/counted-child-process';
import { promisify } from 'node:util';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { officeCliKnownInstallPaths, resolveOfficeCliOnPath } from '../utils/officecli-path';
import { getOpenClawSkillsDir, getResourcesDir } from '../utils/paths';
import { getAllSkillConfigs, updateSkillConfigs, type SkillConfigUpdates } from '../utils/skill-config';
import {
  OFFICECLI_SKILL_DEFS,
  officeCliInstallCommand,
  runOfficeCliInstallChildProcess,
  withOfficeCliMutationLock,
  writeOfficeSkill,
  type OfficeCliInstallPlatform,
} from './office-tools-api';
import { isRecord } from './payload-utils';

const execFileAsync = promisify(execFile);

export const SUPERPOWERS_CORE_SKILLS = [
  'using-superpowers',
  'brainstorming',
  'writing-plans',
  'verification-before-completion',
  'systematic-debugging',
] as const;

export const SUPERPOWERS_SKILL_IDS = [
  'brainstorming',
  'dispatching-parallel-agents',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'using-superpowers',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
] as const;

export { OFFICECLI_SKILL_DEFS };

type SkillPackId = 'superpowers' | 'officecli';
type SkillPackStatus = 'notInstalled' | 'installing' | 'installed' | 'enabled' | 'syncNeeded' | 'error';

type SkillConfigUpdate = { skillKey: string; enabled?: boolean };

type RunCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type SkillPackApiOptions = {
  skillsRoot?: string;
  superpowersSourceDir?: string;
  readConfigs?: () => Promise<Record<string, SkillConfigUpdates>>;
  updateConfigs?: (updates: SkillConfigUpdate[]) => Promise<{ success: boolean; error?: string }>;
  resolveOfficeCli?: () => Promise<string | null>;
  installOfficeCli?: () => Promise<{ success: boolean; error?: string }>;
  runCommand?: (command: string, args: string[], options?: { timeoutMs?: number }) => Promise<RunCommandResult>;
};

type OfficeCliInstallChild = Parameters<typeof runOfficeCliInstallChildProcess>[0];
type OfficeCliInstallSpawnOptions = {
  windowsHide: boolean;
  detached: boolean;
  stdio: ['ignore', 'pipe', 'pipe'];
};
type OfficeCliInstallSpawn = (
  command: string,
  args: string[],
  options: OfficeCliInstallSpawnOptions,
) => OfficeCliInstallChild;

type PackSkillDefinition = {
  id: string;
  name: string;
  description: string;
};

function isInsideRoot(rootPath: string, candidatePath: string): boolean {
  const rel = relative(resolve(rootPath), resolve(candidatePath));
  return rel === '' || (!rel.startsWith('..') && rel !== '..');
}

function assertInsideRoot(rootPath: string, candidatePath: string): string {
  const resolved = resolve(candidatePath);
  if (!isInsideRoot(rootPath, resolved)) {
    throw new Error(`Refusing to write outside skills root: ${candidatePath}`);
  }
  return resolved;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function markerPath(skillsRoot: string, skillId: string): string {
  return join(skillsRoot, skillId, '.clawx-pack.json');
}

function skillDir(skillsRoot: string, skillId: string): string {
  return assertInsideRoot(skillsRoot, join(skillsRoot, skillId));
}

async function writeMarker(skillsRoot: string, packId: SkillPackId, skillId: string): Promise<void> {
  await writeFile(
    markerPath(skillsRoot, skillId),
    JSON.stringify({ packId, skillId, managedBy: 'clawx', updatedAt: new Date().toISOString() }, null, 2),
    'utf-8',
  );
}

async function readMarkerPack(skillsRoot: string, skillId: string): Promise<SkillPackId | null> {
  try {
    const parsed = JSON.parse(await readFile(markerPath(skillsRoot, skillId), 'utf-8')) as { packId?: unknown };
    return parsed.packId === 'superpowers' || parsed.packId === 'officecli' ? parsed.packId : null;
  } catch {
    return null;
  }
}

function fallbackSkillMarkdown(skill: PackSkillDefinition): string {
  return `---\nname: ${skill.id}\ndescription: ${skill.description}\n---\n\n# ${skill.name}\n\n${skill.description}\n`;
}

async function copyOrWriteSuperpowerSkill(skillsRoot: string, sourceRoot: string, skillId: string): Promise<void> {
  const target = skillDir(skillsRoot, skillId);
  const source = resolve(join(sourceRoot, skillId));
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  if (await pathExists(join(source, 'SKILL.md'))) {
    await cp(source, target, { recursive: true, force: true });
  } else {
    await writeFile(
      join(target, 'SKILL.md'),
      fallbackSkillMarkdown({
        id: skillId,
        name: skillId,
        description: `Superpowers workflow skill: ${skillId}.`,
      }),
      'utf-8',
    );
  }
  await writeMarker(skillsRoot, 'superpowers', skillId);
}

function normalizePackId(payload: unknown): SkillPackId {
  const body = isRecord(payload) ? payload : {};
  const packId = body.packId;
  if (packId === 'superpowers' || packId === 'officecli') return packId;
  throw new Error('packId is required');
}

function normalizeEnabled(payload: unknown): boolean {
  const body = isRecord(payload) ? payload : {};
  if (typeof body.enabled === 'boolean') return body.enabled;
  throw new Error('enabled is required');
}

function normalizeSkillId(payload: unknown): string {
  const body = isRecord(payload) ? payload : {};
  if (typeof body.skillId === 'string' && body.skillId.trim()) return body.skillId.trim();
  throw new Error('skillId is required');
}

async function defaultRunCommand(command: string, args: string[], options?: { timeoutMs?: number }): Promise<RunCommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options?.timeoutMs ?? 60_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as Error & { code?: unknown; stdout?: unknown; stderr?: unknown; signal?: unknown };
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : err.message,
    };
  }
}

async function defaultResolveOfficeCli(): Promise<string | null> {
  const onPath = resolveOfficeCliOnPath(process.env);
  if (onPath) return onPath;
  for (const candidate of officeCliKnownInstallPaths()) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export async function runOfficeCliInstallForSkillPack(options: {
  platform?: OfficeCliInstallPlatform;
  spawnProcess?: OfficeCliInstallSpawn;
  runInstallChildProcess?: typeof runOfficeCliInstallChildProcess;
} = {}): Promise<{ success: boolean; error?: string }> {
  const platform = options.platform ?? (process.platform === 'win32' ? 'windows' : 'unix');
  const { command, args } = officeCliInstallCommand(platform);
  const child = (options.spawnProcess ?? spawn)(command, args, {
    windowsHide: true,
    detached: platform !== 'windows',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const runInstallChildProcess = options.runInstallChildProcess ?? runOfficeCliInstallChildProcess;
  return runInstallChildProcess(child, { taskId: '' });
}

async function defaultInstallOfficeCli(): Promise<{ success: boolean; error?: string }> {
  return runOfficeCliInstallForSkillPack();
}

export function createSkillPacksApi(options: SkillPackApiOptions = {}): CompleteHostServiceRegistry['skillPacks'] {
  const skillsRoot = options.skillsRoot ?? getOpenClawSkillsDir();
  const superpowersSourceDir = options.superpowersSourceDir ?? join(getResourcesDir(), 'skill-packs', 'superpowers');
  const readConfigs = options.readConfigs ?? getAllSkillConfigs;
  const saveConfigs = options.updateConfigs ?? ((updates) => updateSkillConfigs(updates));
  const runCommand = options.runCommand ?? defaultRunCommand;
  const resolveOfficeCli = options.resolveOfficeCli ?? defaultResolveOfficeCli;
  const installOfficeCli = options.installOfficeCli ?? defaultInstallOfficeCli;

  async function setSkillConfigs(skillIds: string[], enabled: boolean): Promise<{ success: boolean; error?: string }> {
    return saveConfigs(skillIds.map((skillKey) => ({ skillKey, enabled })));
  }

  async function installSuperpowers(): Promise<void> {
    await mkdir(skillsRoot, { recursive: true });
    for (const skillId of SUPERPOWERS_SKILL_IDS) {
      await copyOrWriteSuperpowerSkill(skillsRoot, superpowersSourceDir, skillId);
    }
    await setSkillConfigs([...SUPERPOWERS_SKILL_IDS], false);
  }

  async function syncOfficeCli(options?: { resetEnabled?: boolean }): Promise<void> {
    const binary = await resolveOfficeCli();
    if (!binary) throw new Error('officecli is not installed');
    const configsBeforeSync = await readConfigs();
    await mkdir(skillsRoot, { recursive: true });
    for (const def of OFFICECLI_SKILL_DEFS) {
      const result = await runCommand(binary, ['load_skill', def.loadId], { timeoutMs: 60_000 });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || `officecli load_skill ${def.loadId} failed`);
      }
      await writeOfficeSkill(skillsRoot, def, result.stdout || fallbackSkillMarkdown(def));
    }
    if (options?.resetEnabled) {
      await setSkillConfigs(OFFICECLI_SKILL_DEFS.map((skill) => skill.id), false);
    } else {
      const newlySynced = OFFICECLI_SKILL_DEFS
        .map((skill) => skill.id)
        .filter((skillId) => configsBeforeSync[skillId]?.enabled === undefined);
      await setSkillConfigs(newlySynced, false);
    }
  }

  async function installOffice(): Promise<void> {
    const before = await resolveOfficeCli();
    if (!before || before === 'officecli') {
      const installed = await installOfficeCli();
      if (!installed.success) throw new Error(installed.error || 'Office CLI install failed');
    }
    await syncOfficeCli({ resetEnabled: true });
  }

  async function buildSkill(packId: SkillPackId, def: PackSkillDefinition, configs: Record<string, SkillConfigUpdates>) {
    const target = skillDir(skillsRoot, def.id);
    const installed = await pathExists(join(target, 'SKILL.md')) && (await readMarkerPack(skillsRoot, def.id)) === packId;
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      enabled: configs[def.id]?.enabled === true,
      installed,
      managedPath: installed ? target : undefined,
      sourcePath: packId === 'superpowers' ? join(superpowersSourceDir, def.id) : undefined,
    };
  }

  async function listPack(packId: SkillPackId) {
    const configs = await readConfigs();
    const defs: PackSkillDefinition[] = packId === 'superpowers'
      ? SUPERPOWERS_SKILL_IDS.map((id) => ({ id, name: id, description: `Superpowers workflow skill: ${id}.` }))
      : OFFICECLI_SKILL_DEFS.map((item) => ({ id: item.id, name: item.name, description: item.description }));
    const skills = await Promise.all(defs.map((def) => buildSkill(packId, def, configs)));
    const installedCount = skills.filter((skill) => skill.installed).length;
    const enabled = skills.some((skill) => skill.enabled);
    const status: SkillPackStatus = installedCount === 0
      ? 'notInstalled'
      : installedCount < skills.length
        ? 'syncNeeded'
        : enabled
          ? 'enabled'
          : 'installed';
    return {
      id: packId,
      name: packId === 'superpowers' ? 'Superpowers' : 'Office CLI',
      description: packId === 'superpowers'
        ? 'Curated expert workflows from the Superpowers project.'
        : 'Office document workflows powered by officecli skills.',
      status,
      enabled,
      installedVersion: undefined,
      skills,
    };
  }

  return {
    list: async () => ({ success: true, packs: [await listPack('superpowers'), await listPack('officecli')] }),
    install: async (payload) => {
      try {
        const packId = normalizePackId(payload);
        if (packId === 'superpowers') await installSuperpowers();
        else await withOfficeCliMutationLock(() => installOffice());
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    sync: async (payload) => {
      try {
        const packId = normalizePackId(payload);
        if (packId === 'superpowers') await installSuperpowers();
        else await withOfficeCliMutationLock(() => syncOfficeCli());
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    setEnabled: async (payload) => {
      try {
        const packId = normalizePackId(payload);
        const enabled = normalizeEnabled(payload);
        const ids = packId === 'superpowers'
          ? (enabled ? [...SUPERPOWERS_CORE_SKILLS] : [...SUPERPOWERS_SKILL_IDS])
          : OFFICECLI_SKILL_DEFS.map((skill) => skill.id);
        const result = packId === 'officecli'
          ? await withOfficeCliMutationLock(() => setSkillConfigs(ids, enabled))
          : await setSkillConfigs(ids, enabled);
        if (!result.success) throw new Error(result.error || 'Failed to update skill pack config');
        if (packId === 'superpowers' && enabled) {
          const nonCore = SUPERPOWERS_SKILL_IDS.filter((id) => !SUPERPOWERS_CORE_SKILLS.includes(id as typeof SUPERPOWERS_CORE_SKILLS[number]));
          await setSkillConfigs(nonCore, false);
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    readSkill: async (payload) => {
      try {
        const packId = normalizePackId(payload);
        const skillId = normalizeSkillId(payload);
        if (basename(skillId) !== skillId) throw new Error('Invalid skillId');
        if (await readMarkerPack(skillsRoot, skillId) !== packId) throw new Error('Skill is not installed by this pack');
        return { success: true, content: await readFile(join(skillDir(skillsRoot, skillId), 'SKILL.md'), 'utf-8') };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
