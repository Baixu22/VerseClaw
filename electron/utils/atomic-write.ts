/**
 * Atomic file commit helpers for critical JSON configs.
 *
 * Guarantees:
 * - Write via sibling temp → fsync → rename (never partial target JSON)
 * - Previous good content retained as `.bak` for recovery
 * - Optional CAS via sidecar write-meta version
 * - Cross-process exclusive lockfile for read-modify-write cycles
 * - Structured, retryable errors for disk-full / read-only / version conflict
 *
 * Used by channel-config / openclaw-auth / config-mutex paths that touch
 * ~/.openclaw/openclaw.json and auth-profiles stores.
 */

import { createHash, randomBytes } from 'crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'fs';
import {
  access,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from 'fs/promises';
import { basename, dirname, join } from 'path';

export type AtomicWriteErrorCode =
  | 'ENOSPC'
  | 'EROFS'
  | 'EPERM'
  | 'EACCES'
  | 'VERSION_CONFLICT'
  | 'LOCK_TIMEOUT'
  | 'CORRUPT'
  | 'UNKNOWN';

export class AtomicWriteError extends Error {
  readonly code: AtomicWriteErrorCode;
  readonly retryable: boolean;
  readonly causeError?: unknown;

  constructor(
    message: string,
    code: AtomicWriteErrorCode,
    options?: { retryable?: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = 'AtomicWriteError';
    this.code = code;
    this.retryable = options?.retryable ?? isRetryableCode(code);
    this.causeError = options?.cause;
  }
}

export class ConfigVersionConflictError extends AtomicWriteError {
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number, path: string) {
    super(
      `Config version conflict for ${path}: expected ${expectedVersion}, actual ${actualVersion}`,
      'VERSION_CONFLICT',
      { retryable: true },
    );
    this.name = 'ConfigVersionConflictError';
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export interface WriteMeta {
  version: number;
  sha256: string;
  updatedAt: string;
  bytes: number;
}

export interface AtomicWriteResult {
  path: string;
  meta: WriteMeta;
  recoveredFromBackup?: boolean;
}

export interface ReadJsonAtomicResult<T> {
  data: T;
  meta: WriteMeta | null;
  recoveredFromBackup: boolean;
  recoveryNote?: string;
}

export interface AtomicWriteOptions {
  /** When set, fail with VERSION_CONFLICT if sidecar version differs. */
  expectedVersion?: number;
  /** File mode for the written file (posix). */
  mode?: number;
  /** Skip writing/updating the sidecar version meta file. */
  skipMeta?: boolean;
  /** Keep a `.bak` of the previous good file (default true). */
  keepBackup?: boolean;
  /**
   * Test/injection hooks. Production callers should leave this unset.
   * `beforeTempWrite` runs after the temp path is chosen and before bytes
   * are written; throw an ErrnoException (e.g. ENOSPC/EACCES) to simulate
   * disk-full or read-only failures without mocking ESM fs exports.
   */
  hooks?: {
    beforeTempWrite?: (tmpPath: string) => void | Promise<void>;
  };
}

export interface FileLockOptions {
  /** Max wait for exclusive lock (ms). Default 10_000. */
  timeoutMs?: number;
  /** Poll interval (ms). Default 25. */
  pollMs?: number;
  /** Stale lock age (ms). Default 30_000. */
  staleMs?: number;
}

function isRetryableCode(code: AtomicWriteErrorCode): boolean {
  return code === 'ENOSPC' || code === 'VERSION_CONFLICT' || code === 'LOCK_TIMEOUT';
}

function mapErrno(error: unknown): AtomicWriteErrorCode {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOSPC') return 'ENOSPC';
  if (code === 'EROFS') return 'EROFS';
  if (code === 'EPERM') return 'EPERM';
  if (code === 'EACCES') return 'EACCES';
  return 'UNKNOWN';
}

function wrapFsError(error: unknown, action: string, path: string): AtomicWriteError {
  if (error instanceof AtomicWriteError) return error;
  const code = mapErrno(error);
  const errno = (error as NodeJS.ErrnoException | undefined)?.code;
  return new AtomicWriteError(
    `Atomic ${action} failed for ${path}${errno ? ` (${errno})` : ''}: ${
      error instanceof Error ? error.message : String(error)
    }`,
    code,
    { cause: error, retryable: isRetryableCode(code) },
  );
}

function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function metaPathFor(filePath: string): string {
  return `${filePath}.clawx-write-meta`;
}

export function backupPathFor(filePath: string): string {
  return `${filePath}.bak`;
}

export function lockPathFor(filePath: string): string {
  return `${filePath}.clawx-write.lock`;
}

function tempPathFor(filePath: string): string {
  const id = `${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`;
  return join(dirname(filePath), `.${basename(filePath)}.${id}.tmp`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function pathExistsSync(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error;
    }
  }
}

function safeUnlinkSync(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function readMeta(filePath: string): Promise<WriteMeta | null> {
  const metaPath = metaPathFor(filePath);
  try {
    const raw = await readFile(metaPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WriteMeta>;
    if (
      typeof parsed.version !== 'number' ||
      typeof parsed.sha256 !== 'string' ||
      typeof parsed.updatedAt !== 'string' ||
      typeof parsed.bytes !== 'number'
    ) {
      return null;
    }
    return parsed as WriteMeta;
  } catch {
    return null;
  }
}

function readMetaSync(filePath: string): WriteMeta | null {
  const metaPath = metaPathFor(filePath);
  try {
    const raw = readFileSync(metaPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WriteMeta>;
    if (
      typeof parsed.version !== 'number' ||
      typeof parsed.sha256 !== 'string' ||
      typeof parsed.updatedAt !== 'string' ||
      typeof parsed.bytes !== 'number'
    ) {
      return null;
    }
    return parsed as WriteMeta;
  } catch {
    return null;
  }
}

async function writeMetaAtomic(filePath: string, meta: WriteMeta): Promise<void> {
  const metaPath = metaPathFor(filePath);
  const payload = `${JSON.stringify(meta, null, 2)}\n`;
  // Meta is small; still use temp+rename to avoid half-written version files.
  await writeFileAtomicInternal(metaPath, payload, { keepBackup: false, skipMeta: true });
}

/**
 * Cross-process exclusive lock for a target file's RMW cycle.
 * Uses O_EXCL create on a sibling lockfile with stale recovery.
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollMs = options.pollMs ?? 25;
  const staleMs = options.staleMs ?? 30_000;
  const lockPath = lockPathFor(filePath);
  await mkdir(dirname(lockPath), { recursive: true });

  const started = Date.now();
  let handle: Awaited<ReturnType<typeof open>> | null = null;

  while (!handle) {
    try {
      handle = await open(lockPath, 'wx');
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
          target: filePath,
        }),
        'utf-8',
      );
      await handle.sync();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') {
        throw wrapFsError(error, 'lock', filePath);
      }

      // Stale lock recovery
      try {
        const st = await stat(lockPath);
        const age = Date.now() - st.mtimeMs;
        if (age > staleMs) {
          await safeUnlink(lockPath);
          continue;
        }
      } catch {
        // raced; retry
      }

      if (Date.now() - started >= timeoutMs) {
        throw new AtomicWriteError(
          `Timed out acquiring write lock for ${filePath}`,
          'LOCK_TIMEOUT',
          { retryable: true },
        );
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  try {
    return await fn();
  } finally {
    try {
      await handle.close();
    } catch {
      // ignore
    }
    await safeUnlink(lockPath);
  }
}

async function writeFileAtomicInternal(
  filePath: string,
  content: string | Buffer,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const existingMeta = options.skipMeta ? null : await readMeta(filePath);
  if (
    options.expectedVersion !== undefined &&
    existingMeta &&
    existingMeta.version !== options.expectedVersion
  ) {
    throw new ConfigVersionConflictError(options.expectedVersion, existingMeta.version, filePath);
  }
  // If caller requires expectedVersion but meta is missing, treat as version 0.
  if (options.expectedVersion !== undefined && !existingMeta && options.expectedVersion !== 0) {
    throw new ConfigVersionConflictError(options.expectedVersion, 0, filePath);
  }

  const keepBackup = options.keepBackup !== false;
  const tmpPath = tempPathFor(filePath);
  const bakPath = backupPathFor(filePath);
  const bytes = Buffer.isBuffer(content) ? content.byteLength : Buffer.byteLength(content, 'utf-8');
  const sha256 = hashContent(content);
  const nextVersion = (existingMeta?.version ?? 0) + 1;
  const meta: WriteMeta = {
    version: nextVersion,
    sha256,
    updatedAt: new Date().toISOString(),
    bytes,
  };

  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    if (options.hooks?.beforeTempWrite) {
      await options.hooks.beforeTempWrite(tmpPath);
    }
    fh = await open(tmpPath, 'w', options.mode ?? 0o600);
    await fh.writeFile(content);
    await fh.sync();
    await fh.close();
    fh = null;

    const targetExists = await pathExists(filePath);
    if (targetExists && keepBackup) {
      // Prefer rename of current → bak when possible so bak is a full prior snapshot.
      try {
        await safeUnlink(bakPath);
        await rename(filePath, bakPath);
      } catch {
        // Fallback: copy then continue (e.g. cross-device edge cases).
        try {
          await copyFile(filePath, bakPath);
          await safeUnlink(filePath);
        } catch (copyError) {
          // If we cannot preserve bak, still attempt atomic replace of target.
          // Original remains until rename succeeds.
          if ((copyError as NodeJS.ErrnoException)?.code === 'ENOSPC') {
            throw wrapFsError(copyError, 'backup', filePath);
          }
          await safeUnlink(filePath);
        }
      }
    } else if (targetExists) {
      await safeUnlink(filePath);
    }

    try {
      await rename(tmpPath, filePath);
    } catch (renameError) {
      // Attempt restore from bak if we moved the original aside.
      if (keepBackup && (await pathExists(bakPath)) && !(await pathExists(filePath))) {
        try {
          await rename(bakPath, filePath);
        } catch {
          // leave bak for recovery
        }
      }
      throw renameError;
    }

    // Best-effort directory fsync (durability of the rename).
    try {
      const dirFh = await open(dir, 'r');
      try {
        await dirFh.sync();
      } finally {
        await dirFh.close();
      }
    } catch {
      // Not supported on all platforms / directory handles.
    }

    if (!options.skipMeta) {
      await writeMetaAtomic(filePath, meta);
    }

    return { path: filePath, meta };
  } catch (error) {
    if (fh) {
      try {
        await fh.close();
      } catch {
        // ignore
      }
    }
    await safeUnlink(tmpPath);
    throw wrapFsError(error, 'write', filePath);
  }
}

/**
 * Atomically replace `filePath` with `content` using temp + fsync + rename.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string | Buffer,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  return writeFileAtomicInternal(filePath, content, options);
}

/**
 * Atomically write JSON (pretty-printed, trailing newline) with version meta.
 */
export async function writeJsonAtomic(
  filePath: string,
  data: unknown,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  return writeFileAtomic(filePath, content, options);
}

/**
 * Read JSON with corrupt-target recovery from `.bak` and visible recovery note.
 */
export async function readJsonAtomic<T = unknown>(
  filePath: string,
  options?: { fallback?: T },
): Promise<ReadJsonAtomicResult<T>> {
  const tryParse = async (path: string): Promise<T> => {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  };

  const meta = await readMeta(filePath);

  if (await pathExists(filePath)) {
    try {
      const data = await tryParse(filePath);
      return { data, meta, recoveredFromBackup: false };
    } catch (primaryError) {
      const bak = backupPathFor(filePath);
      if (await pathExists(bak)) {
        try {
          const data = await tryParse(bak);
          const note = `Primary config at ${filePath} was corrupt; recovered from ${bak}. Re-save recommended.`;
          // Restore bak into place so subsequent readers see valid JSON.
          try {
            await writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`, {
              keepBackup: false,
              expectedVersion: meta?.version,
              skipMeta: !meta,
            });
          } catch {
            // recovery restore best-effort
          }
          return {
            data,
            meta,
            recoveredFromBackup: true,
            recoveryNote: note,
          };
        } catch {
          // fall through
        }
      }
      throw new AtomicWriteError(
        `Corrupt JSON at ${filePath} and no usable backup: ${
          primaryError instanceof Error ? primaryError.message : String(primaryError)
        }`,
        'CORRUPT',
        { retryable: false, cause: primaryError },
      );
    }
  }

  // Primary missing: still attempt .bak recovery (crash between rename steps).
  if (await pathExists(backupPathFor(filePath))) {
    try {
      const bak = backupPathFor(filePath);
      const data = await tryParse(bak);
      const note =
        `Primary config at ${filePath} was missing; recovered from ${bak}. Re-save recommended.`;
      try {
        await writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`, {
          keepBackup: false,
          expectedVersion: meta?.version,
          skipMeta: !meta,
        });
      } catch {
        // recovery restore best-effort
      }
      return {
        data,
        meta,
        recoveredFromBackup: true,
        recoveryNote: note,
      };
    } catch {
      // fall through to fallback / not-found
    }
  }

  if (options && 'fallback' in options) {
    return {
      data: options.fallback as T,
      meta: null,
      recoveredFromBackup: false,
    };
  }

  throw new AtomicWriteError(`Config file not found: ${filePath}`, 'UNKNOWN', {
    retryable: false,
  });
}

/** Sync variant used by rare boot-path writers. */
export function writeFileAtomicSync(
  filePath: string,
  content: string | Buffer,
  options: AtomicWriteOptions = {},
): AtomicWriteResult {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const existingMeta = options.skipMeta ? null : readMetaSync(filePath);
  if (
    options.expectedVersion !== undefined &&
    existingMeta &&
    existingMeta.version !== options.expectedVersion
  ) {
    throw new ConfigVersionConflictError(options.expectedVersion, existingMeta.version, filePath);
  }
  if (options.expectedVersion !== undefined && !existingMeta && options.expectedVersion !== 0) {
    throw new ConfigVersionConflictError(options.expectedVersion, 0, filePath);
  }

  const keepBackup = options.keepBackup !== false;
  const tmpPath = tempPathFor(filePath);
  const bakPath = backupPathFor(filePath);
  const bytes = Buffer.isBuffer(content) ? content.byteLength : Buffer.byteLength(content, 'utf-8');
  const sha256 = hashContent(content);
  const nextVersion = (existingMeta?.version ?? 0) + 1;
  const meta: WriteMeta = {
    version: nextVersion,
    sha256,
    updatedAt: new Date().toISOString(),
    bytes,
  };

  let fd = -1;
  try {
    fd = openSync(tmpPath, 'w', options.mode ?? 0o600);
    writeSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    fd = -1;

    if (pathExistsSync(filePath) && keepBackup) {
      try {
        safeUnlinkSync(bakPath);
        renameSync(filePath, bakPath);
      } catch {
        try {
          writeFileSync(bakPath, readFileSync(filePath));
          safeUnlinkSync(filePath);
        } catch {
          safeUnlinkSync(filePath);
        }
      }
    } else if (pathExistsSync(filePath)) {
      safeUnlinkSync(filePath);
    }

    try {
      renameSync(tmpPath, filePath);
    } catch (renameError) {
      if (keepBackup && pathExistsSync(bakPath) && !pathExistsSync(filePath)) {
        try {
          renameSync(bakPath, filePath);
        } catch {
          // leave bak
        }
      }
      throw renameError;
    }

    if (!options.skipMeta) {
      const metaPath = metaPathFor(filePath);
      const metaTmp = tempPathFor(metaPath);
      const payload = `${JSON.stringify(meta, null, 2)}\n`;
      const mfd = openSync(metaTmp, 'w', 0o600);
      try {
        writeSync(mfd, payload);
        fsyncSync(mfd);
      } finally {
        closeSync(mfd);
      }
      if (pathExistsSync(metaPath)) safeUnlinkSync(metaPath);
      renameSync(metaTmp, metaPath);
    }

    return { path: filePath, meta };
  } catch (error) {
    if (fd >= 0) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
    safeUnlinkSync(tmpPath);
    throw wrapFsError(error, 'write', filePath);
  }
}

/**
 * Best-effort cleanup of orphaned temp files from crashed writes.
 */
export async function cleanupStaleTempFiles(
  dir: string,
  options?: { maxAgeMs?: number; prefix?: string },
): Promise<number> {
  const maxAgeMs = options?.maxAgeMs ?? 60 * 60 * 1000;
  let removed = 0;
  try {
    const { readdir } = await import('fs/promises');
    const entries = await readdir(dir);
    const now = Date.now();
    for (const name of entries) {
      if (!name.endsWith('.tmp')) continue;
      if (options?.prefix && !name.startsWith(options.prefix) && !name.includes(options.prefix)) {
        continue;
      }
      const full = join(dir, name);
      try {
        const st = await stat(full);
        if (now - st.mtimeMs > maxAgeMs) {
          await rm(full, { force: true });
          removed += 1;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore missing dir
  }
  return removed;
}

