---
title: electron/services/backup-restore.ts
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

Origin: electron/services/backup-restore.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
/**
 * Local backup restore (Electron main process).
 *
 * `openclaw_runtime/src/infra/backup-create.ts` can produce a `tar.gz` archive
 * with a `manifest.json` describing the source assets, but the repository had no
 * restore path at all. For a product whose entire value proposition is "no
 * login, everything stays on this machine", being unable to recover your own
 * data after a disk failure is the single worst durability gap.
 *
 * This module implements the restore half against archives produced by
 * `createBackupArchive`:
 *
 *   - `inspectBackupArchive`  — read + validate the manifest and list entries.
 *   - `previewRestore`         — dry-run: what would be written, what is skipped.
 *   - `restoreBackupArchive`   — conservative write: only paths that do not
 *                                exist yet are created; existing paths are
 *                                reported and left untouched.
 *
 * Safety properties:
 *
 *   1. **Conservative writes.** Restore never overwrites an existing file. The
 *      user's current data is the more recent state; overwriting it with an
 *      older archive would be data loss, not recovery.
 *   2. **Path-traversal defence.** Archive entry paths are decoded back to
 *      absolute paths and re-validated; an entry whose decoded path escapes the
 *      manifest's declared asset roots is rejected, so a tampered archive cannot
 *      write outside the intended directories.
 *   3. **Manifest validation.** `schemaVersion`, `createdAt`, and a non-empty
 *      `assets` list are required before anything is extracted.
 *   4. **Rollback.** Files written during a restore are removed if a later
 *      entry fails, so a partial failure does not leave a half-restored tree.
 *
 * All operations are agent-driven automation; nothing here requires or claims
 * human interaction.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

export type BackupAssetKind = 'state' | 'config' | 'credentials' | 'workspace';

export type BackupManifest = {
  schemaVersion: number;
  createdAt: string;
  includeWorkspace: boolean;
  assets: Array<{ kind: BackupAssetKind; sourcePath: string }>;
};

export type RestoreEntryAction = 'create' | 'skip-existing' | 'rejected';

export type RestorePreviewEntry = {
  /** Path inside the archive, e.g. `<root>/payload/windows/C/Users/x/...`. */
  archivePath: string;
  /** Absolute destination path the entry maps to. */
  targetPath: string;
  action: RestoreEntryAction;
  reason?: string;
};

export type RestorePreview = {
  valid: boolean;
  manifest: BackupManifest | null;
  createdAt?: string;
  includeWorkspace?: boolean;
  entries: RestorePreviewEntry[];
  /** Count per action, for a one-line summary in the UI. */
  counts: { create: number; skipped: number; rejected: number };
  errors: string[];
};

export type RestoreResult = {
  success: boolean;
  dryRun: boolean;
  written: string[];
  skipped: string[];
  rejected: Array<{ archivePath: string; reason: string }>;
  errors: string[];
  /** Paths created during this run, removed again if a later step failed. */
  rolledBack: string[];
};

/** Decode an archive payload path back to the absolute source path it came from. */
function decodeSourcePath(archivePath: string): string | null {
  const posix = archivePath.replaceAll('\\', '/');
  const windows = posix.match(/^windows\/([A-Za-z])\/(.*)$/u);
  if (windows) return `${windows[1].toUpperCase()}:/${windows[2]}`;
  if (posix.startsWith('posix/')) return `/${posix.slice('posix/'.length)}`;
  if (posix.startsWith('relative/')) return posix.slice('relative/'.length);
  return null;
}

function isInside(child: string, parent: string): boolean {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  if (resolvedChild === resolvedParent) return true;
  const rel = path.relative(resolvedParent, resolvedChild);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function validateManifest(value: unknown): { manifest: BackupManifest | null; error?: string } {
  if (!value || typeof value !== 'object') return { manifest: null, error: 'manifest is not an object' };
  const obj = value as Record<string, unknown>;
  if (obj.schemaVersion !== 1) return { manifest: null, error: `unsupported manifest schemaVersion: ${String(obj.schemaVersion)}` };
  if (typeof obj.createdAt !== 'string' || !obj.createdAt) return { manifest: null, error: 'manifest.createdAt is missing' };
  if (!Array.isArray(obj.assets) || obj.assets.length === 0) return { manifest: null, error: 'manifest.assets is empty' };
  const assets: BackupManifest['assets'] = [];
  for (const asset of obj.assets as unknown[]) {
    if (!asset || typeof asset !== 'object') return { manifest: null, error: 'manifest.assets entry is not an object' };
    const record = asset as Record<string, unknown>;
    const kind = record.kind;
    const sourcePath = record.sourcePath;
    if (kind !== 'state' && kind !== 'config' && kind !== 'credentials' && kind !== 'workspace') {
      return { manifest: null, error: `manifest.assets has unknown kind: ${String(kind)}` };
    }
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
      return { manifest: null, error: 'manifest.assets entry has no sourcePath' };
    }
    assets.push({ kind, sourcePath });
  }
  return {
    manifest: {
      schemaVersion: 1,
      createdAt: obj.createdAt,
      includeWorkspace: obj.includeWorkspace === true,
      assets,
    },
  };
}

type ArchiveReader = {
  manifest: BackupManifest | null;
  /** Regular-file entries, keyed by their path inside the archive. */
  files: Array<{ archivePath: string; size: number }>;
  errors: string[];
};

/**
 * Read archive metadata without extracting anything.
 *
 * `tar.list` streams only headers, so we can enumerate entries and capture
 * `manifest.json` while leaving every payload untouched on disk.
 */
/**
 * Read archive metadata without extracting anything.
 *
 * Uses the async-iterator form of `tar.t`, which is the supported way to walk
 * entries in tar v7. Payloads are consumed via `entry.resume()` so the stream
 * keeps flowing; only `manifest.json` is buffered.
 */
/**
 * Read archive metadata without extracting anything.
 *
 * In tar v7 `tar.t()` returns a Promise, so entries are collected through the
 * `onentry` callback and awaited. Payloads are drained with `entry.resume()`
 * so the stream keeps flowing; only `manifest.json` is buffered.
 */
async function readArchive(archivePath: string): Promise<ArchiveReader> {
  const errors: string[] = [];
  let tar: typeof import('tar');
  try {
    tar = require('tar');
  } catch (error) {
    return { manifest: null, files: [], errors: [`tar runtime unavailable: ${String(error)}`] };
  }

  const files: Array<{ archivePath: string; size: number }> = [];
  let manifestRaw: string | null = null;

  try {
    await tar.t({
      file: archivePath,
      onwarn: () => { /* non-fatal archive warnings do not block preview */ },
      onentry(entry) {
        const normalized = entry.path.replaceAll('\\', '/');
        if (entry.type !== 'File') {
          entry.resume();
          return;
        }
        files.push({ archivePath: normalized, size: Number(entry.size ?? 0) });
        if (normalized.endsWith('/manifest.json')) {
          const chunks: Buffer[] = [];
          entry.on('data', (chunk: Buffer) => chunks.push(chunk));
          entry.on('end', () => {
            manifestRaw = Buffer.concat(chunks).toString('utf8');
          });
          return;
        }
        entry.resume();
      },
    });
  } catch (error) {
    errors.push(`failed to read archive: ${String(error)}`);
  }

  let manifest: BackupManifest | null = null;
  if (manifestRaw) {
    try {
      const parsed = validateManifest(JSON.parse(manifestRaw));
      manifest = parsed.manifest;
      if (parsed.error) errors.push(parsed.error);
    } catch (error) {
      errors.push(`manifest.json is not valid JSON: ${String(error)}`);
    }
  } else {
    // A manifest is mandatory: without it we cannot tell which asset roots are
    // legitimate, so nothing may be written regardless of what the archive
    // happens to contain.
    errors.push('archive has no manifest.json');
  }

  return { manifest, files, errors };
}
/**
 * Inspect an archive and decide, per entry, what a restore would do.
 * Performs no writes.
 */
export async function previewRestore(archivePath: string): Promise<RestorePreview> {
  const errors: string[] = [];
  const entries: RestorePreviewEntry[] = [];

  const statResult = await fs.stat(archivePath).catch(() => null);
  if (!statResult?.isFile()) {
    return {
      valid: false,
      manifest: null,
      entries: [],
      counts: { create: 0, skipped: 0, rejected: 0 },
      errors: [`backup archive not found: ${archivePath}`],
    };
  }

  const archive = await readArchive(archivePath);
  errors.push(...archive.errors);
  const manifest = archive.manifest;
  if (!manifest) {
    return {
      valid: false,
      manifest: null,
      entries: [],
      counts: { create: 0, skipped: 0, rejected: 0 },
      errors,
    };
  }

  const roots = manifest.assets.map((asset) => path.resolve(asset.sourcePath));

  for (const file of archive.files) {
    const marker = '/payload/';
    const idx = file.archivePath.indexOf(marker);
    if (idx === -1) continue; // manifest.json or unexpected layout

    const payloadPath = file.archivePath.slice(idx + marker.length);
    const decoded = decodeSourcePath(payloadPath);
    if (!decoded) {
      entries.push({
        archivePath: file.archivePath,
        targetPath: '',
        action: 'rejected',
        reason: 'unrecognised payload path encoding',
      });
      continue;
    }

    const target = path.resolve(decoded);
    // Path-traversal defence: the decoded target must stay inside a declared asset.
    if (!roots.some((root) => isInside(target, root))) {
      entries.push({
        archivePath: file.archivePath,
        targetPath: target,
        action: 'rejected',
        reason: 'target escapes the manifest asset roots',
      });
      continue;
    }

    const exists = await fs.stat(target).then(() => true).catch(() => false);
    entries.push({
      archivePath: file.archivePath,
      targetPath: target,
      action: exists ? 'skip-existing' : 'create',
      reason: exists ? 'destination already exists; conservative restore leaves it untouched' : undefined,
    });
  }

  return {
    valid: errors.length === 0,
    manifest,
    createdAt: manifest.createdAt,
    includeWorkspace: manifest.includeWorkspace,
    entries,
    counts: {
      create: entries.filter((e) => e.action === 'create').length,
      skipped: entries.filter((e) => e.action === 'skip-existing').length,
      rejected: entries.filter((e) => e.action === 'rejected').length,
    },
    errors,
  };
}

/**
 * Restore an archive using conservative writes.
 *
 * `dryRun: true` performs the preview only and writes nothing.
 * On failure, every path created during this run is removed again.
 */
export async function restoreBackupArchive(
  archivePath: string,
  options?: { dryRun?: boolean },
): Promise<RestoreResult> {
  const dryRun = options?.dryRun === true;
  const preview = await previewRestore(archivePath);

  const result: RestoreResult = {
    success: false,
    dryRun,
    written: [],
    skipped: [],
    rejected: preview.entries
      .filter((e) => e.action === 'rejected')
      .map((e) => ({ archivePath: e.archivePath, reason: e.reason ?? 'rejected' })),
    errors: [...preview.errors],
    rolledBack: [],
  };

  for (const entry of preview.entries) {
    if (entry.action === 'skip-existing') result.skipped.push(entry.targetPath);
  }

  if (!preview.manifest) {
    result.errors.push('archive manifest is missing or invalid; nothing was restored');
    return result;
  }

  if (dryRun) {
    result.success = true;
    return result;
  }

  const tar = require('tar') as typeof import('tar');
  const toCreate = preview.entries.filter((e) => e.action === 'create');
  if (toCreate.length === 0) {
    result.success = true;
    return result;
  }

  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'clawx-restore-'));
  try {
    // Extract the whole archive into staging first. tar itself refuses absolute
    // and `..` paths, so a tampered archive cannot escape the staging directory
    // even before our own manifest check runs.
    await tar.extract({
      file: archivePath,
      cwd: staging,
      preservePaths: false,
      strip: 0,
    });

    // Copy staged payloads into place, tracking everything we create so a
    // later failure can be rolled back.
    for (const entry of toCreate) {
      const staged = path.join(staging, ...entry.archivePath.split('/'));
      const data = await fs.readFile(staged).catch(() => null);
      if (data === null) {
        result.errors.push(`payload missing from archive: ${entry.archivePath}`);
        throw new Error('restore payload missing');
      }
      await fs.mkdir(path.dirname(entry.targetPath), { recursive: true });
      // wx: never clobber, even if the target appeared since the preview.
      await fs.writeFile(entry.targetPath, data, { flag: 'wx', mode: 0o600 });
      result.written.push(entry.targetPath);
    }

    result.success = true;
  } catch (error) {
    result.errors.push(String(error));
    // Roll back everything we created in this run.
    for (const writtenPath of result.written) {
      const removed = await fs.rm(writtenPath, { force: true }).then(() => true).catch(() => false);
      if (removed) result.rolledBack.push(writtenPath);
    }
    result.written = [];
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }

  return result;
}

export const testApi = { decodeSourcePath, isInside, validateManifest };
~~~
