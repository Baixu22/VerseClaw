---
title: electron/services/path-broker.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-10T05:05:56.255Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: electron/services/path-broker.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
/**
 * Files Broker path canonicalization (P1-003 / F-SEC-004 / F-SEC-006).
 * Unified policy for realpath, reparse/junction, UNC, ADS, and device paths.
 */

import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';

export type PathBrokerErrorCode =
  | 'outsideSandbox'
  | 'readOnlyRoot'
  | 'unsafePath'
  | 'devicePath'
  | 'uncPath'
  | 'adsPath'
  | 'pathTooLong';

export class PathBrokerError extends Error {
  readonly code: PathBrokerErrorCode;

  constructor(code: PathBrokerErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'PathBrokerError';
  }
}

const WIN_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:$|\.)/i;
const UNIX_DEVICE_PREFIXES = ['/dev/', '/proc/', '/sys/'];
const MAX_PATH_CHARS = 4096;

function hasWinDevicePrefix(value: string): boolean {
  // \\.\  \\?\  //./  //?/  and mixed separators
  const n = value.replace(/\//g, '\\');
  return n.startsWith('\\\\.\\') || n.startsWith('\\\\?\\');
}

function hasUncPrefix(value: string): boolean {
  const n = value.replace(/\//g, '\\');
  // UNC: \\server\share  but not device namespaces \\.\ / \\?\
  if (!n.startsWith('\\\\')) return false;
  if (hasWinDevicePrefix(value)) return false;
  return true;
}

export function isPathInsideLexical(child: string, parent: string): boolean {
  const childPath = resolve(child);
  const parentPath = resolve(parent);
  if (process.platform === 'win32') {
    const cl = childPath.toLowerCase();
    const pl = parentPath.toLowerCase();
    return cl === pl || cl.startsWith(pl.endsWith(sep) ? pl : pl + sep);
  }
  return childPath === parentPath || childPath.startsWith(parentPath.endsWith(sep) ? parentPath : parentPath + sep);
}

/** Sync lexical membership used for non-IO classification. Prefer resolved membership for writes. */
export function isPathInsideWorkspaceLexical(path: string, workspaceRoot: string): boolean {
  const child = resolve(path);
  const parent = resolve(workspaceRoot);
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Reject Windows device namespaces, reserved device names, ADS streams, UNC,
 * and Unix device mounts before any FS IO.
 */
export function assertSafeHostFilePath(input: string): string {
  if (typeof input !== 'string' || !input.trim()) {
    throw new PathBrokerError('unsafePath', 'Invalid file path');
  }
  const trimmed = input.trim();
  if (trimmed.length > MAX_PATH_CHARS) {
    throw new PathBrokerError('pathTooLong', 'Path exceeds maximum length');
  }
  if (trimmed.includes('\0')) {
    throw new PathBrokerError('unsafePath', 'Path contains NUL');
  }

  const normalized = trimmed.replace(/\\/g, '/');

  if (hasWinDevicePrefix(trimmed) || hasWinDevicePrefix(normalized)) {
    throw new PathBrokerError('devicePath', 'Device namespace paths are not allowed');
  }

  // UNC / SMB paths (also catches //server/share)
  if (hasUncPrefix(trimmed) || normalized.startsWith('//')) {
    throw new PathBrokerError('uncPath', 'UNC paths are not allowed');
  }

  if (process.platform !== 'win32') {
    for (const prefix of UNIX_DEVICE_PREFIXES) {
      if (normalized === prefix.slice(0, -1) || normalized.startsWith(prefix)) {
        throw new PathBrokerError('devicePath', 'Device filesystem paths are not allowed');
      }
    }
  }

  if (process.platform === 'win32') {
    // ADS: extra colon beyond drive letter (e.g. C:\a.txt:Zone.Identifier)
    const withoutDrive = /^[A-Za-z]:/.test(trimmed) ? trimmed.slice(2) : trimmed;
    if (withoutDrive.includes(':')) {
      throw new PathBrokerError('adsPath', 'Alternate data streams are not allowed');
    }
    const base = win32.basename(trimmed).split(':')[0];
    if (WIN_RESERVED_NAME_RE.test(base)) {
      throw new PathBrokerError('devicePath', 'Reserved device names are not allowed');
    }
  }

  return trimmed;
}

export async function realpathOrResolve(input: string): Promise<string> {
  const safe = assertSafeHostFilePath(input);
  const fsP = await import('node:fs/promises');
  try {
    return await fsP.realpath(safe);
  } catch {
    // Parent may exist even if leaf does not (create case). Resolve parent chain.
    try {
      const dir = resolve(safe, '..');
      const realDir = await fsP.realpath(dir);
      const leaf = safe.split(/[\\/]/).filter(Boolean).pop() ?? '';
      return resolve(realDir, leaf);
    } catch {
      return resolve(safe);
    }
  }
}

export async function isResolvedPathInsideRoot(child: string, root: string): Promise<boolean> {
  const realChild = await realpathOrResolve(child);
  const realRoot = await realpathOrResolve(root);
  return isPathInsideLexical(realChild, realRoot);
}
~~~
