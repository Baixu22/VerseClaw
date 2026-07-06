import { existsSync as nodeExistsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

type EnvMap = Record<string, string | undefined>;

export type OfficeCliPathOptions = {
  platform?: NodeJS.Platform;
  env?: EnvMap;
  existsSync?: (candidate: string) => boolean;
  homeDir?: string;
  fallbackPath?: string;
};

export type OfficeCliPathEnvResult = {
  env: EnvMap;
  changed: boolean;
  dir?: string;
  path?: string;
};

function currentPlatform(options?: OfficeCliPathOptions): NodeJS.Platform {
  return options?.platform ?? process.platform;
}

function isWindows(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

function pathModule(platform: NodeJS.Platform): typeof path.win32 {
  return isWindows(platform) ? path.win32 : path.posix;
}

function pathDelimiter(platform: NodeJS.Platform): string {
  return isWindows(platform) ? ';' : ':';
}

function isPathKey(key: string, platform: NodeJS.Platform): boolean {
  return isWindows(platform) ? key.toLowerCase() === 'path' : key === 'PATH';
}

function preferredPathKey(platform: NodeJS.Platform): string {
  return isWindows(platform) ? 'Path' : 'PATH';
}

function getPathKeys(env: EnvMap, platform: NodeJS.Platform): string[] {
  return Object.keys(env).filter((key) => isPathKey(key, platform));
}

function getPathKey(env: EnvMap, platform: NodeJS.Platform): string {
  const keys = getPathKeys(env, platform);
  if (keys.length === 0) return preferredPathKey(platform);
  if (isWindows(platform)) {
    if (keys.includes('Path')) return 'Path';
    if (keys.includes('PATH')) return 'PATH';
  } else if (keys.includes('PATH')) {
    return 'PATH';
  }
  return keys[0] ?? preferredPathKey(platform);
}

function getPathValue(env: EnvMap, platform: NodeJS.Platform, fallbackPath = ''): string {
  const keys = getPathKeys(env, platform);
  if (keys.length === 0) return fallbackPath;
  return env[getPathKey(env, platform)] ?? fallbackPath;
}

function setPathValue(env: EnvMap, platform: NodeJS.Platform, nextPath: string): EnvMap {
  const key = getPathKey(env, platform);
  const nextEnv: EnvMap = { ...env };
  for (const existingKey of Object.keys(nextEnv)) {
    if (isPathKey(existingKey, platform)) {
      delete nextEnv[existingKey];
    }
  }
  nextEnv[key] = nextPath;
  return nextEnv;
}

function normalizePathEntry(entry: string, platform: NodeJS.Platform): string {
  const stripped = entry.trim().replace(/^"|"$/g, '');
  const normalized = pathModule(platform).normalize(stripped);
  return isWindows(platform) ? normalized.toLowerCase() : normalized;
}

function commandCandidates(command: string, env: EnvMap, platform: NodeJS.Platform): string[] {
  if (!isWindows(platform) || path.win32.extname(command)) return [command];
  const pathext = env.PATHEXT || '.EXE;.CMD;.BAT';
  const extensions = pathext
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);
  return [
    command,
    ...extensions.map((ext) => `${command}${ext.startsWith('.') ? ext : `.${ext}`}`),
  ];
}

export function resolveOfficeCliOnPath(env: EnvMap, options: OfficeCliPathOptions = {}): string | null {
  const platform = currentPlatform(options);
  const exists = options.existsSync ?? nodeExistsSync;
  const currentPath = getPathValue(env, platform, options.fallbackPath);
  if (!currentPath) return null;

  const pathApi = pathModule(platform);
  for (const dir of currentPath.split(pathDelimiter(platform))) {
    const normalizedDir = dir.trim().replace(/^"|"$/g, '');
    if (!normalizedDir) continue;
    for (const candidateName of commandCandidates('officecli', env, platform)) {
      const candidate = pathApi.join(normalizedDir, candidateName);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

export function officeCliKnownInstallPaths(options: OfficeCliPathOptions = {}): string[] {
  const platform = currentPlatform(options);
  const env = options.env ?? process.env;
  const pathApi = pathModule(platform);

  if (isWindows(platform)) {
    const localAppData = env.LOCALAPPDATA?.trim();
    return localAppData ? [pathApi.join(localAppData, 'OfficeCLI', 'officecli.exe')] : [];
  }

  const home = options.homeDir ?? env.HOME ?? homedir();
  return home ? [pathApi.join(home, '.local', 'bin', 'officecli')] : [];
}

export function officeCliAgentPathDir(options: OfficeCliPathOptions = {}): string | null {
  const platform = currentPlatform(options);
  const env = options.env ?? process.env;
  const exists = options.existsSync ?? nodeExistsSync;

  if (resolveOfficeCliOnPath(env, options)) return null;

  const pathApi = pathModule(platform);
  for (const candidate of officeCliKnownInstallPaths({ ...options, env, platform })) {
    if (exists(candidate)) {
      return pathApi.dirname(candidate);
    }
  }
  return null;
}

export function prependOfficeCliPathToEnv(
  env: EnvMap,
  options: OfficeCliPathOptions = {},
): OfficeCliPathEnvResult {
  const platform = currentPlatform(options);
  const fallbackPath = options.fallbackPath ?? getPathValue(options.env ?? process.env, platform);
  const dir = officeCliAgentPathDir({ ...options, env, platform, fallbackPath });
  if (!dir) return { env: { ...env }, changed: false };

  const currentPath = getPathValue(env, platform, fallbackPath);
  const existingEntries = currentPath
    .split(pathDelimiter(platform))
    .filter((entry) => entry.trim().length > 0);
  if (existingEntries.some((entry) => normalizePathEntry(entry, platform) === normalizePathEntry(dir, platform))) {
    return { env: { ...env }, changed: false, dir, path: currentPath };
  }

  const nextPath = currentPath ? `${dir}${pathDelimiter(platform)}${currentPath}` : dir;
  return {
    env: setPathValue(env, platform, nextPath),
    changed: true,
    dir,
    path: nextPath,
  };
}
