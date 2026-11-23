import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { createRequire } from 'node:module';

import {
  previewRestore,
  restoreBackupArchive,
  testApi,
} from '@electron/services/backup-restore';

const require = createRequire(import.meta.url);
const ARCHIVE_ROOT = '2026-10-19T00-00-00.000Z-openclaw-backup';

type TarEntryInput = { name: string; content: string };

/** Encode an absolute path exactly like `backup-create.ts` does. */
function encodeForArchive(absolutePath: string): string {
  const normalized = absolutePath.replaceAll('\\', '/');
  const windows = normalized.match(/^([A-Za-z]):\/(.*)$/u);
  if (windows) return `windows/${windows[1].toUpperCase()}/${windows[2]}`;
  if (normalized.startsWith('/')) return `posix/${normalized.slice(1)}`;
  return `relative/${normalized}`;
}

/** Build a backup archive shaped exactly like `createBackupArchive` output. */
async function makeArchive(
  dir: string,
  opts: { name: string; manifest: unknown; entries: TarEntryInput[] },
): Promise<string> {
  const tar = require('tar') as typeof import('tar');
  const staging = mkdtempSync(join(dir, 'stage-'));
  const root = ARCHIVE_ROOT;

  mkdirSync(join(staging, root), { recursive: true });
  writeFileSync(join(staging, root, 'manifest.json'), JSON.stringify(opts.manifest, null, 2));

  for (const entry of opts.entries) {
    const relative = entry.name.startsWith(`${root}/`)
      ? entry.name.slice(root.length + 1)
      : entry.name;
    const target = join(staging, root, ...relative.split('/'));
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, entry.content);
  }

  const archivePath = join(dir, opts.name);
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(archivePath);
    const pack = tar.c({ gzip: true, cwd: staging, portable: true, preservePaths: true }, [root]);
    out.on('finish', () => resolve());
    out.on('error', reject);
    pack.on('error', reject);
    pack.pipe(out);
  });
  return archivePath;
}

describe('backup restore path decoding', () => {
  it('round-trips a Windows source path', () => {
    expect(testApi.decodeSourcePath('windows/C/Users/me/.openclaw/openclaw.json'))
      .toBe('C:/Users/me/.openclaw/openclaw.json');
  });

  it('round-trips a POSIX source path', () => {
    expect(testApi.decodeSourcePath('posix/home/me/.openclaw/openclaw.json'))
      .toBe('/home/me/.openclaw/openclaw.json');
  });

  it('rejects an unrecognised encoding', () => {
    expect(testApi.decodeSourcePath('somewhere/else/file.txt')).toBeNull();
  });

  it('containment check rejects a sibling directory with a shared prefix', () => {
    // /data-evil must not be treated as inside /data.
    expect(testApi.isInside('/data-evil/x', '/data')).toBe(false);
    expect(testApi.isInside('/data/x', '/data')).toBe(true);
  });
});

describe('backup manifest validation', () => {
  it('accepts a well-formed manifest', () => {
    const { manifest, error } = testApi.validateManifest({
      schemaVersion: 1,
      createdAt: '2026-10-19T00:00:00.000Z',
      includeWorkspace: true,
      assets: [{ kind: 'state', sourcePath: '/state' }],
    });
    expect(error).toBeUndefined();
    expect(manifest?.assets).toHaveLength(1);
  });

  it('rejects an unsupported schema version', () => {
    const { manifest, error } = testApi.validateManifest({
      schemaVersion: 99,
      createdAt: 'x',
      assets: [{ kind: 'state', sourcePath: '/state' }],
    });
    expect(manifest).toBeNull();
    expect(error).toMatch(/schemaVersion/);
  });

  it('rejects an empty asset list', () => {
    const { manifest, error } = testApi.validateManifest({
      schemaVersion: 1,
      createdAt: 'x',
      assets: [],
    });
    expect(manifest).toBeNull();
    expect(error).toMatch(/assets/);
  });

  it('rejects an unknown asset kind', () => {
    const { manifest, error } = testApi.validateManifest({
      schemaVersion: 1,
      createdAt: 'x',
      assets: [{ kind: 'evil', sourcePath: '/state' }],
    });
    expect(manifest).toBeNull();
    expect(error).toMatch(/unknown kind/);
  });
});

describe('backup restore safety', () => {
  let dir: string;
  /** Virtual POSIX asset root declared in the manifest. */
  let assetRoot: string;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'clawx-restore-test-')));
    // A POSIX-style root keeps archive encoding platform-independent (the
    // `posix/` branch), so these tests assert restore semantics rather than
    // Windows path formatting.
    assetRoot = '/virtual/openclaw-state';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  function entryFor(absolutePosixPath: string, content: string): TarEntryInput {
    return {
      name: `${ARCHIVE_ROOT}/payload/${encodeForArchive(absolutePosixPath)}`,
      content,
    };
  }

  it.each(['before-preview', 'after-preview'])('rejects a destination junction inserted %s', async (when) => {
    const allowed = join(dir, 'allowed');
    const outside = join(dir, 'outside');
    mkdirSync(allowed);
    mkdirSync(outside);
    const linked = join(allowed, 'linked');
    const target = join(linked, 'restored.txt');
    const archivePath = await makeArchive(dir, {
      name: 'junction.tar.gz',
      manifest: { schemaVersion: 1, createdAt: '2026-11-23T00:00:00Z', assets: [{ kind: 'workspace', sourcePath: allowed }] },
      entries: [entryFor(target, 'must stay inside')],
    });
    if (when === 'before-preview') {
      symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
      const preview = await previewRestore(archivePath);
      expect(preview.counts).toEqual({ create: 0, skipped: 0, rejected: 1 });
      expect(preview.entries[0].reason).toMatch(/symbolic link|junction/);
    } else {
      const readFile = fs.readFile.bind(fs);
      vi.spyOn(fs, 'readFile').mockImplementationOnce(async (...args) => {
        symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
        return readFile(...args);
      });
    }
    const result = await restoreBackupArchive(archivePath);
    expect(result.success).toBe(false);
    expect(result.written).toEqual([]);
    expect(existsSync(join(outside, 'restored.txt'))).toBe(false);
  });

  it('creates regular nested destinations and preserves their contents on a second restore', async () => {
    const target = join(dir, 'new-state', 'agents', 'main', 'session.jsonl');
    const archivePath = await makeArchive(dir, {
      name: 'regular.tar.gz',
      manifest: { schemaVersion: 1, createdAt: '2026-11-23T00:00:00Z', assets: [{ kind: 'state', sourcePath: join(dir, 'new-state') }] },
      entries: [entryFor(target, 'restored session')],
    });
    expect(await restoreBackupArchive(archivePath)).toMatchObject({ success: true, written: [target] });
    expect(readFileSync(target, 'utf8')).toBe('restored session');
    expect(await restoreBackupArchive(archivePath)).toMatchObject({ success: true, written: [], skipped: [target] });
  });

  it('reports a missing archive instead of throwing', async () => {
    const preview = await previewRestore(join(dir, 'nope.tar.gz'));
    expect(preview.valid).toBe(false);
    expect(preview.errors.join(' ')).toMatch(/not found/i);
  });

  it('refuses an archive that has no manifest', async () => {
    const tar = require('tar') as typeof import('tar');
    const staging = mkdtempSync(join(dir, 'bare-'));
    writeFileSync(join(staging, 'random.txt'), 'x');
    const archivePath = join(dir, 'bare.tar.gz');
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(archivePath);
      const pack = tar.c({ gzip: true, cwd: staging }, ['random.txt']);
      out.on('finish', () => resolve());
      out.on('error', reject);
      pack.on('error', reject);
      pack.pipe(out);
    });

    const preview = await previewRestore(archivePath);
    expect(preview.manifest).toBeNull();
    expect(preview.errors.join(' ')).toMatch(/manifest/i);
  });

  it('classifies a missing destination as create', async () => {
    const archivePath = await makeArchive(dir, {
      name: 'simple.tar.gz',
      manifest: {
        schemaVersion: 1,
        createdAt: '2026-10-19T00:00:00.000Z',
        includeWorkspace: false,
        assets: [{ kind: 'state', sourcePath: assetRoot }],
      },
      entries: [entryFor(posix.join(assetRoot, 'agents', 'main', 'sessions', 'a.jsonl'), 'transcript')],
    });

    const preview = await previewRestore(archivePath);
    expect(preview.valid).toBe(true);
    expect(preview.counts.create).toBe(1);
    expect(preview.counts.rejected).toBe(0);
    expect(preview.entries[0]?.targetPath).toContain('a.jsonl');
  });

  it('dry-run reports the plan and writes nothing', async () => {
    const target = posix.join(assetRoot, 'openclaw.json');
    const archivePath = await makeArchive(dir, {
      name: 'dry.tar.gz',
      manifest: {
        schemaVersion: 1,
        createdAt: '2026-10-19T00:00:00.000Z',
        includeWorkspace: false,
        assets: [{ kind: 'config', sourcePath: assetRoot }],
      },
      entries: [entryFor(target, '{"restored":true}')],
    });

    const preview = await previewRestore(archivePath);
    expect(preview.counts.create).toBe(1);

    const result = await restoreBackupArchive(archivePath, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.success).toBe(true);
    expect(result.written).toEqual([]);
    // A dry run must not create the destination file.
    expect(existsSync(preview.entries[0]!.targetPath)).toBe(false);
  });

  it('rejects an entry whose target escapes the declared asset roots', async () => {
    const outside = '/etc/passwd-like-target';
    const archivePath = await makeArchive(dir, {
      name: 'evil.tar.gz',
      manifest: {
        schemaVersion: 1,
        createdAt: '2026-10-19T00:00:00.000Z',
        includeWorkspace: false,
        assets: [{ kind: 'state', sourcePath: assetRoot }],
      },
      entries: [entryFor(outside, 'pwned')],
    });

    const preview = await previewRestore(archivePath);
    expect(preview.counts.rejected).toBe(1);
    expect(preview.entries[0]?.reason).toMatch(/escapes/i);

    const result = await restoreBackupArchive(archivePath);
    expect(result.written).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('rejects an entry that only shares a path prefix with the asset root', async () => {
    const archivePath = await makeArchive(dir, {
      name: 'prefix.tar.gz',
      manifest: {
        schemaVersion: 1,
        createdAt: '2026-10-19T00:00:00.000Z',
        includeWorkspace: false,
        assets: [{ kind: 'state', sourcePath: '/virtual/data' }],
      },
      entries: [entryFor('/virtual/data-evil/secret.txt', 'pwned')],
    });

    const preview = await previewRestore(archivePath);
    expect(preview.counts.rejected).toBe(1);
  });

  it('skips an existing destination rather than overwriting it', async () => {
    const existing = join(dir, 'existing.json');
    writeFileSync(existing, 'current-user-data');

    // Declare the asset root so that the decoded target resolves to `existing`.
    const archivePath = await makeArchive(dir, {
      name: 'conflict.tar.gz',
      manifest: {
        schemaVersion: 1,
        createdAt: '2026-10-19T00:00:00.000Z',
        includeWorkspace: false,
        assets: [{ kind: 'state', sourcePath: dir }],
      },
      entries: [entryFor(existing.replaceAll('\\', '/'), 'archive-content')],
    });

    const preview = await previewRestore(archivePath);
    expect(preview.counts.skipped).toBe(1);
    expect(preview.counts.create).toBe(0);
    // The user's current data must survive untouched.
    expect(readFileSync(existing, 'utf-8')).toBe('current-user-data');

    const result = await restoreBackupArchive(archivePath);
    expect(result.success).toBe(true);
    expect(result.written).toEqual([]);
    expect(readFileSync(existing, 'utf-8')).toBe('current-user-data');
  });
});
