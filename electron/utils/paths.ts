/**
 * Path Utilities
 * Cross-platform path resolution helpers
 */
import { createRequire } from 'node:module';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'fs';

const require = createRequire(import.meta.url);

type ElectronAppLike = Pick<typeof import('electron').app, 'isPackaged' | 'getPath' | 'getAppPath'>;

export {
  quoteForCmd,
  needsWinShell,
  prepareWinSpawn,
  normalizeNodeRequirePathForNodeOptions,
  appendNodeRequireToNodeOptions,
} from './win-shell';

function getElectronApp() {
  if (process.versions?.electron) {
    return (require('electron') as typeof import('electron')).app;
  }

  const fallbackUserData = process.env.VERSE_CLAW_USER_DATA_DIR?.trim() || join(homedir(), '.verse-claw');
  const fallbackAppPath = process.cwd();
  const fallbackApp: ElectronAppLike = {
    isPackaged: false,
    getPath: (name) => {
      if (name === 'userData') return fallbackUserData;
      return fallbackUserData;
    },
    getAppPath: () => fallbackAppPath,
  };
  return fallbackApp;
}

/**
 * Expand ~ to home directory
 */
export function expandPath(path: string): string {
  if (path.startsWith('~')) {
    return path.replace('~', homedir());
  }
  return path;
}

/**
 * Get OpenClaw config directory
 */
export function getOpenClawConfigDir(): string {
  return join(homedir(), '.openclaw');
}

/**
 * Get OpenClaw skills directory
 */
export function getOpenClawSkillsDir(): string {
  return join(getDataDir(), 'verse-claw-skills');
}

/**
 * Get Verse Claw config directory
 */
export function getVerseClawConfigDir(): string {
  return join(homedir(), '.verse-claw');
}

/**
 * Get Verse Claw logs directory
 */
export function getLogsDir(): string {
  return join(getElectronApp().getPath('userData'), 'logs');
}

/**
 * Get Verse Claw data directory
 */
export function getDataDir(): string {
  return getElectronApp().getPath('userData');
}

/**
 * Ensure directory exists
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get resources directory (for bundled assets)
 */
export function getResourcesDir(): string {
  if (getElectronApp().isPackaged) {
    return join(process.resourcesPath, 'resources');
  }
  return join(__dirname, '../../resources');
}

/**
 * Get preload script path
 */
export function getPreloadPath(): string {
  return join(__dirname, '../preload/index.js');
}

/**
 * Get OpenClaw package directory
 * - Production (packaged): from resources/openclaw (copied by electron-builder extraResources)
 * - Development: from node_modules/openclaw
 */
export function getOpenClawDir(): string {
  if (getElectronApp().isPackaged) {
    return join(process.resourcesPath, 'openclaw');
  }
  // Development: use node_modules/openclaw
  return join(__dirname, '../../node_modules/openclaw');
}

/**
 * Get OpenClaw package directory resolved to a real path.
 * Useful when consumers need deterministic module resolution under pnpm symlinks.
 */
export function getOpenClawResolvedDir(): string {
  const dir = getOpenClawDir();
  if (!existsSync(dir)) {
    return dir;
  }
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * Source-runtime selection for Verse Claw.
 *
 * Verse Claw now prefers the editable openclaw_runtime tree whenever it is
 * available. Set VERSE_CLAW_OPENCLAW_RUNTIME=npm to force the legacy published npm
 * package, or VERSE_CLAW_OPENCLAW_RUNTIME=source to fail fast if the source runtime
 * is missing.
 */
export function isOpenClawRuntimeEnabled(): boolean {
  const mode = process.env.VERSE_CLAW_OPENCLAW_RUNTIME?.trim().toLowerCase();
  if (mode === 'npm') return false;
  if (mode === 'source') return true;
  return isOpenClawRuntimePresent();
}

function realpathOrSelf(dir: string): string {
  if (!existsSync(dir)) {
    return dir;
  }
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * Get the pruned OpenClaw source runtime directory.
 */
export function getOpenClawRuntimeDir(): string {
  if (getElectronApp().isPackaged) {
    return join(process.resourcesPath, 'openclaw-runtime');
  }

  const appPath = getElectronApp().getAppPath();
  const appPathRuntime = join(appPath, 'openclaw_runtime');
  if (existsSync(appPathRuntime)) {
    return appPathRuntime;
  }

  return join(appPath, 'verse-claw', 'openclaw_runtime');
}

/**
 * Check if the editable OpenClaw runtime is available.
 */
export function isOpenClawRuntimePresent(): boolean {
  const dir = getOpenClawRuntimeDir();
  return existsSync(dir) && existsSync(join(dir, 'package.json'));
}

/**
 * Get OpenClaw source runtime entry script path.
 * Prefers compiled dist/entry.js when available because Electron utilityProcess
 * cannot reliably run the source runtime through tsx on Windows.
 */
export function getOpenClawRuntimeEntryPath(): string {
  const distEntry = join(getOpenClawRuntimeDir(), 'dist', 'entry.js');
  if (existsSync(distEntry)) {
    return distEntry;
  }
  return join(getOpenClawRuntimeDir(), 'src', 'entry.ts');
}

/**
 * Get OpenClaw source runtime tsx executable path.
 */
export function getOpenClawRuntimeTsxPath(): string {
  const binName = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
  return join(getOpenClawRuntimeDir(), 'node_modules', '.bin', binName);
}

/**
 * Get OpenClaw source runtime tsx CLI module path for Electron utilityProcess.fork.
 */
export function getOpenClawRuntimeTsxCliPath(): string {
  return join(getOpenClawRuntimeDir(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
}

/**
 * Get OpenClaw source runtime tsx loader path for Electron utilityProcess.fork.
 */
export function getOpenClawRuntimeTsxLoaderPath(): string {
  return join(getOpenClawRuntimeDir(), 'node_modules', 'tsx', 'dist', 'loader.mjs');
}

/**
 * Get OpenClaw entry script path (openclaw.mjs)
 */
export function getOpenClawEntryPath(): string {
  return join(getOpenClawDir(), 'openclaw.mjs');
}

/**
 * Get the OpenClaw runtime directory currently selected for Verse Claw.
 */
export function getActiveOpenClawDir(): string {
  return isOpenClawRuntimeEnabled() ? getOpenClawRuntimeDir() : getOpenClawDir();
}

/**
 * Get the selected OpenClaw runtime directory resolved to a real path.
 */
export function getActiveOpenClawResolvedDir(): string {
  return realpathOrSelf(getActiveOpenClawDir());
}

/**
 * Get the selected OpenClaw runtime entry script.
 */
export function getActiveOpenClawEntryPath(): string {
  return isOpenClawRuntimeEnabled() ? getOpenClawRuntimeEntryPath() : getOpenClawEntryPath();
}

/**
 * Get ClawHub CLI entry script path (clawdhub.js)
 */
export function getClawHubCliEntryPath(): string {
  return join(getElectronApp().getAppPath(), 'node_modules', 'clawhub', 'bin', 'clawdhub.js');
}

/**
 * Get ClawHub CLI binary path (node_modules/.bin)
 */
export function getClawHubCliBinPath(): string {
  const binName = process.platform === 'win32' ? 'clawhub.cmd' : 'clawhub';
  return join(getElectronApp().getAppPath(), 'node_modules', '.bin', binName);
}

/**
 * Check if OpenClaw package exists
 */
export function isOpenClawPresent(): boolean {
  const dir = getOpenClawDir();
  const pkgJsonPath = join(dir, 'package.json');
  return existsSync(dir) && existsSync(pkgJsonPath);
}

/**
 * Check if the selected OpenClaw runtime is available.
 */
export function isActiveOpenClawPresent(): boolean {
  return isOpenClawRuntimeEnabled() ? isOpenClawRuntimePresent() : isOpenClawPresent();
}

/**
 * Check if OpenClaw is built (has dist folder)
 * For the npm package, this should always be true since npm publishes the built dist.
 */
export function isOpenClawBuilt(): boolean {
  const dir = getOpenClawDir();
  const distDir = join(dir, 'dist');
  const hasDist = existsSync(distDir);
  return hasDist;
}

/**
 * Check if the selected OpenClaw runtime is built.
 */
export function isActiveOpenClawBuilt(): boolean {
  const dir = getActiveOpenClawDir();
  return existsSync(join(dir, 'dist'));
}

/**
 * Get OpenClaw status for environment check
 */
export interface OpenClawStatus {
  packageExists: boolean;
  isBuilt: boolean;
  entryPath: string;
  dir: string;
  version?: string;
}

export function getOpenClawStatus(): OpenClawStatus {
  const dir = getActiveOpenClawDir();
  const entryPath = getActiveOpenClawEntryPath();
  let version: string | undefined;

  // Try to read version from package.json
  try {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      version = pkg.version;
    }
  } catch {
    // Ignore version read errors
  }

  const status: OpenClawStatus = {
    packageExists: isActiveOpenClawPresent(),
    isBuilt: isActiveOpenClawBuilt(),
    entryPath,
    dir,
    version,
  };

  try {
    const { logger } = require('./logger') as typeof import('./logger');
    logger.info('OpenClaw status:', status);
  } catch {
    // Ignore logger bootstrap issues in non-Electron contexts such as unit tests.
  }
  return status;
}
