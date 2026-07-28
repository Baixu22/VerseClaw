/**
 * FP-P1-02: workspace preflight checks.
 *
 * Run BEFORE a directory is accepted as the (single) workspace authority.
 * Pure classification lives in isSensitiveWorkspacePath / summarizePreflight
 * so unit tests can cover the decision table without touching the filesystem.
 *
 * Decision table (task doc FP-P1-02):
 *  - exists+dir / readable        → fail blocks
 *  - writable                     → fail forces read-only fallback (explicit)
 *  - git repo                     → informational (affects undo hint only)
 *  - sensitive path               → fail (system/home/drive roots) or warn
 *                                   (credential material inside the directory)
 *  - disk space                   → warn under 1 GiB
 */
import { access, constants, lstat, mkdtemp, readdir, rm, statfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, parse, resolve } from 'node:path';
import { realpathOrResolve } from './path-broker';

export type WorkspacePreflightCheckId =
  | 'exists'
  | 'readable'
  | 'writable'
  | 'git'
  | 'sensitivePath'
  | 'diskSpace';

export type WorkspacePreflightStatus = 'ok' | 'warn' | 'fail' | 'info';

export type WorkspacePreflightCheck = {
  id: WorkspacePreflightCheckId;
  status: WorkspacePreflightStatus;
  /** Machine-stable detail token; UI translates it (never a raw errno dump). */
  detail: string;
};

export type WorkspacePreflightResult = {
  rootPath: string;
  resolvedPath: string;
  /** Whether this directory may be used as a workspace at all. */
  ok: boolean;
  /** True when usable but only in read-only mode (not writable). */
  readOnlyOnly: boolean;
  isGitRepo: boolean;
  checks: WorkspacePreflightCheck[];
};

const MIN_FREE_BYTES = 1024 * 1024 * 1024; // 1 GiB

const WINDOWS_SYSTEM_PREFIXES = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
];

const CREDENTIAL_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.kube']);
const CREDENTIAL_FILES = new Set(['id_rsa', 'id_ed25519', 'credentials', '.npmrc', '.netrc']);

/** Pure: classify a resolved path against the sensitive-path rules. */
export function isSensitiveWorkspacePath(
  resolvedPath: string,
  home: string = homedir(),
): { level: 'fail' | 'warn' | 'ok'; reason?: string } {
  const normalized = resolve(resolvedPath).toLowerCase().replace(/[\\/]+$/, '');
  const normalizedHome = resolve(home).toLowerCase().replace(/[\\/]+$/, '');
  const root = parse(normalized).root.toLowerCase().replace(/[\\/]+$/, '');

  if (normalized === root) return { level: 'fail', reason: 'driveRoot' };
  if (normalized === normalizedHome) return { level: 'fail', reason: 'homeRoot' };
  for (const prefix of WINDOWS_SYSTEM_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}\\`)) {
      return { level: 'fail', reason: 'systemDir' };
    }
  }
  if (normalized.startsWith('/etc') || normalized === '/usr' || normalized.startsWith('/usr/')) {
    return { level: 'fail', reason: 'systemDir' };
  }
  const base = basename(normalized);
  if (CREDENTIAL_DIRS.has(base)) return { level: 'fail', reason: 'credentialDir' };
  // Direct parent of a credential dir (~/.ssh's parent is home, already failed).
  return { level: 'ok' };
}

/** Pure: fold check list into the overall verdict. */
export function summarizePreflight(checks: WorkspacePreflightCheck[]): {
  ok: boolean;
  readOnlyOnly: boolean;
} {
  const failed = checks.filter((check) => check.status === 'fail');
  const writableFailed = failed.some((check) => check.id === 'writable');
  const blockingFailed = failed.some((check) => check.id !== 'writable');
  return {
    ok: !blockingFailed,
    readOnlyOnly: !blockingFailed && writableFailed,
  };
}

export async function runWorkspacePreflight(rootPath: string): Promise<WorkspacePreflightResult> {
  const checks: WorkspacePreflightCheck[] = [];
  let resolvedPath = rootPath;
  let isGitRepo = false;

  // exists + directory (after symlink resolution — the boundary is enforced on
  // realpaths, so preflight must judge the same target).
  try {
    resolvedPath = await realpathOrResolve(rootPath);
    const stat = await lstat(resolvedPath);
    if (!stat.isDirectory()) {
      checks.push({ id: 'exists', status: 'fail', detail: 'notADirectory' });
    } else {
      checks.push({ id: 'exists', status: 'ok', detail: 'directory' });
    }
  } catch {
    checks.push({ id: 'exists', status: 'fail', detail: 'missing' });
  }

  const existsOk = checks[0]?.status === 'ok';

  // readable
  if (existsOk) {
    try {
      await access(resolvedPath, constants.R_OK);
      await readdir(resolvedPath);
      checks.push({ id: 'readable', status: 'ok', detail: 'readable' });
    } catch {
      checks.push({ id: 'readable', status: 'fail', detail: 'notReadable' });
    }
  }

  // writable — probe with a real temp dir, not access(W_OK) (unreliable on Windows ACLs).
  if (existsOk) {
    try {
      const probe = await mkdtemp(join(resolvedPath, '.clawx-preflight-'));
      await rm(probe, { recursive: true, force: true });
      checks.push({ id: 'writable', status: 'ok', detail: 'writable' });
    } catch {
      checks.push({ id: 'writable', status: 'fail', detail: 'notWritable' });
    }
  }

  // git repo (informational; drives the undo-strategy hint)
  if (existsOk) {
    try {
      await access(join(resolvedPath, '.git'), constants.F_OK);
      isGitRepo = true;
      checks.push({ id: 'git', status: 'info', detail: 'gitRepo' });
    } catch {
      checks.push({ id: 'git', status: 'info', detail: 'notGitRepo' });
    }
  }

  // sensitive path
  if (existsOk) {
    const sensitive = isSensitiveWorkspacePath(resolvedPath);
    if (sensitive.level === 'fail') {
      checks.push({ id: 'sensitivePath', status: 'fail', detail: sensitive.reason ?? 'sensitive' });
    } else {
      // Credential material directly inside the chosen directory → warn.
      let warned = false;
      try {
        const entries = await readdir(resolvedPath);
        const hit = entries.find(
          (entry) => CREDENTIAL_DIRS.has(entry) || CREDENTIAL_FILES.has(entry.toLowerCase()),
        );
        if (hit) {
          warned = true;
          checks.push({ id: 'sensitivePath', status: 'warn', detail: `containsCredentialMaterial:${hit}` });
        }
      } catch {
        // readable check already reported
      }
      if (!warned) checks.push({ id: 'sensitivePath', status: 'ok', detail: 'clear' });
    }
  }

  // disk space
  if (existsOk) {
    try {
      const stats = await statfs(resolvedPath);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      if (Number.isFinite(freeBytes) && freeBytes < MIN_FREE_BYTES) {
        checks.push({ id: 'diskSpace', status: 'warn', detail: `lowDiskSpace:${Math.round(freeBytes / (1024 * 1024))}MiB` });
      } else {
        checks.push({ id: 'diskSpace', status: 'ok', detail: 'sufficient' });
      }
    } catch {
      checks.push({ id: 'diskSpace', status: 'warn', detail: 'unknown' });
    }
  }

  const summary = summarizePreflight(checks);
  return {
    rootPath,
    resolvedPath,
    ok: summary.ok,
    readOnlyOnly: summary.readOnlyOnly,
    isGitRepo,
    checks,
  };
}
