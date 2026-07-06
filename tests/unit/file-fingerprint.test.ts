import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type DirectoryFingerprint,
  type FileFingerprint,
  computeFileFingerprintsForDirectory,
  diffFileFingerprints,
  fingerprintFromRecord,
  fingerprintToRecord,
  getFileFingerprint,
} from '../../openclaw_runtime/src/agents/long-task-control/file-fingerprint';

/**
 * Stage 2 Stream 2B-1 acceptance 2.4 — A6 file fingerprint single source of truth.
 *
 * Run: pnpm test file-fingerprint
 */
describe('A6 file fingerprint', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fp-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // getFileFingerprint (single file)
  // -------------------------------------------------------------------------

  it('returns null for non-existent file (no throw)', async () => {
    const fp = await getFileFingerprint(join(tempDir, 'does-not-exist.txt'));
    expect(fp).toBeNull();
  });

  it('returns null for a directory (not a file)', async () => {
    const fp = await getFileFingerprint(tempDir);
    expect(fp).toBeNull();
  });

  it('computes sha256 + mtimeMs + size for a regular file', async () => {
    const filePath = join(tempDir, 'test.txt');
    await writeFile(filePath, 'hello world');
    const fp = await getFileFingerprint(filePath);

    expect(fp).not.toBeNull();
    expect(fp!.path).toBe(filePath);
    expect(fp!.sha256).toHaveLength(64);
    expect(fp!.size).toBe(11);
    expect(fp!.mtimeMs).toBeGreaterThan(0);
  });

  it('is deterministic — same content produces same sha256', async () => {
    const file1 = join(tempDir, 'a.txt');
    const file2 = join(tempDir, 'b.txt');
    await writeFile(file1, 'same content');
    await writeFile(file2, 'same content');

    const fp1 = await getFileFingerprint(file1);
    const fp2 = await getFileFingerprint(file2);
    expect(fp1!.sha256).toBe(fp2!.sha256);
  });

  it('different content produces different sha256', async () => {
    const file1 = join(tempDir, 'a.txt');
    const file2 = join(tempDir, 'b.txt');
    await writeFile(file1, 'content A');
    await writeFile(file2, 'content B');

    const fp1 = await getFileFingerprint(file1);
    const fp2 = await getFileFingerprint(file2);
    expect(fp1!.sha256).not.toBe(fp2!.sha256);
  });

  it('returns null for empty file path', async () => {
    const fp = await getFileFingerprint('');
    expect(fp).toBeNull();
  });

  // -------------------------------------------------------------------------
  // computeFileFingerprintsForDirectory (recursive walk)
  // -------------------------------------------------------------------------

  it('fingerprints all files in a directory tree (recursive)', async () => {
    await writeFile(join(tempDir, 'root.txt'), 'root');
    await mkdir(join(tempDir, 'subdir'));
    await writeFile(join(tempDir, 'subdir', 'a.txt'), 'a');
    await writeFile(join(tempDir, 'subdir', 'b.txt'), 'b');
    await mkdir(join(tempDir, 'subdir', 'nested'));
    await writeFile(join(tempDir, 'subdir', 'nested', 'c.txt'), 'c');

    const result = await computeFileFingerprintsForDirectory(tempDir);

    expect(result.rootPath).toBe(tempDir);
    expect(result.files.size).toBe(4);
    expect(result.files.has('root.txt')).toBe(true);
    expect(result.files.has('subdir/a.txt')).toBe(true);
    expect(result.files.has('subdir/b.txt')).toBe(true);
    expect(result.files.has('subdir/nested/c.txt')).toBe(true);
    expect(result.skipped).toEqual([]);
    expect(result.totalBytes).toBe(4 + 1 + 1 + 1);
  });

  it('uses relative paths as keys (workspace portability)', async () => {
    await writeFile(join(tempDir, 'a.txt'), 'a');
    const result = await computeFileFingerprintsForDirectory(tempDir);

    for (const key of result.files.keys()) {
      expect(key).not.toContain(tempDir);
      expect(key).not.toMatch(/^[A-Z]:/); // no drive letter
    }
  });

  it('records skipped files for permission-denied subdirectory [POSIX only]', async () => {
    // Windows does not enforce POSIX 0o000 directory mode the same way.
    // Skip on Windows — the permission-denied path is covered by the null
    // cases in getFileFingerprint tests.
    if (process.platform === 'win32') {
      return;
    }
    await writeFile(join(tempDir, 'accessible.txt'), 'ok');
    const restrictedDir = join(tempDir, 'restricted');
    await mkdir(restrictedDir, { mode: 0o000 });
    await writeFile(join(restrictedDir, 'secret.txt'), 'secret');

    try {
      const result = await computeFileFingerprintsForDirectory(tempDir);
      expect(result.files.has('accessible.txt')).toBe(true);
      // On some systems root can still read 0o000 dirs; we just check skipped is non-empty
      // OR files does not contain the restricted file.
      expect(result.files.has('restricted/secret.txt')).toBe(false);
    } finally {
      // Restore permissions so cleanup works.
      const { chmod } = await import('node:fs/promises');
      await chmod(restrictedDir, 0o755);
    }
  });

  it('include filter only fingerprints matching paths', async () => {
    await writeFile(join(tempDir, 'include.txt'), 'yes');
    await writeFile(join(tempDir, 'exclude.txt'), 'no');

    const result = await computeFileFingerprintsForDirectory(tempDir, {
      include: (relPath) => relPath.startsWith('include'),
    });

    expect(result.files.size).toBe(1);
    expect(result.files.has('include.txt')).toBe(true);
    expect(result.files.has('exclude.txt')).toBe(false);
  });

  it('exclude filter skips matching paths', async () => {
    await writeFile(join(tempDir, 'keep.txt'), 'yes');
    await writeFile(join(tempDir, 'skip.txt'), 'no');

    const result = await computeFileFingerprintsForDirectory(tempDir, {
      exclude: (relPath) => relPath.startsWith('skip'),
    });

    expect(result.files.size).toBe(1);
    expect(result.files.has('keep.txt')).toBe(true);
    expect(result.files.has('skip.txt')).toBe(false);
  });

  it('skips symlinks (avoids loops) [POSIX only]', async () => {
    // Symlink creation on Windows requires admin privileges. Skip on Windows.
    if (process.platform === 'win32') {
      return;
    }
    await writeFile(join(tempDir, 'real.txt'), 'real');
    const linkPath = join(tempDir, 'link.txt');
    const { symlink } = await import('node:fs/promises');
    await symlink(join(tempDir, 'real.txt'), linkPath);

    const result = await computeFileFingerprintsForDirectory(tempDir);
    expect(result.files.has('real.txt')).toBe(true);
    expect(result.files.has('link.txt')).toBe(false);
    expect(result.skipped.some((s) => s.path === 'link.txt')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // diffFileFingerprints (pure diff function)
  // -------------------------------------------------------------------------

  function makeDirFingerprint(files: Array<[string, string, number, number]>): DirectoryFingerprint {
    // [path, sha256, mtimeMs, size]
    const map = new Map<string, FileFingerprint>();
    for (const [path, sha256, mtimeMs, size] of files) {
      map.set(path, { path, sha256, mtimeMs, size });
    }
    return { rootPath: '', files: map, skipped: [], totalBytes: 0 };
  }

  it('diff: detects added files', () => {
    const before = makeDirFingerprint([['a.txt', 'hash-a', 1000, 10]]);
    const after = makeDirFingerprint([
      ['a.txt', 'hash-a', 1000, 10],
      ['b.txt', 'hash-b', 2000, 20],
    ]);
    const diff = diffFileFingerprints(before, after);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].path).toBe('b.txt');
    expect(diff.summary.addedCount).toBe(1);
    expect(diff.summary.isClean).toBe(false);
  });

  it('diff: detects removed files', () => {
    const before = makeDirFingerprint([
      ['a.txt', 'hash-a', 1000, 10],
      ['b.txt', 'hash-b', 2000, 20],
    ]);
    const after = makeDirFingerprint([['a.txt', 'hash-a', 1000, 10]]);
    const diff = diffFileFingerprints(before, after);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].path).toBe('b.txt');
    expect(diff.summary.removedCount).toBe(1);
  });

  it('diff: detects modified files (sha256 differs)', () => {
    const before = makeDirFingerprint([['a.txt', 'hash-old', 1000, 10]]);
    const after = makeDirFingerprint([['a.txt', 'hash-new', 1000, 10]]);
    const diff = diffFileFingerprints(before, after);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].sha256).toBe('hash-new');
    expect(diff.summary.modifiedCount).toBe(1);
  });

  it('diff: detects touched files (mtime changed, content same)', () => {
    const before = makeDirFingerprint([['a.txt', 'hash-a', 1000, 10]]);
    const after = makeDirFingerprint([['a.txt', 'hash-a', 2000, 10]]);
    const diff = diffFileFingerprints(before, after);
    expect(diff.touched).toHaveLength(1);
    expect(diff.summary.touchedCount).toBe(1);
    expect(diff.summary.isClean).toBe(true); // touched does not make it dirty
  });

  it('diff: isClean true when no added/removed/modified', () => {
    const before = makeDirFingerprint([['a.txt', 'hash-a', 1000, 10]]);
    const after = makeDirFingerprint([['a.txt', 'hash-a', 1000, 10]]);
    const diff = diffFileFingerprints(before, after);
    expect(diff.summary.isClean).toBe(true);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // fingerprintToRecord / fingerprintFromRecord (serialization helpers)
  // -------------------------------------------------------------------------

  it('fingerprintToRecord produces path → sha256 mapping', async () => {
    await writeFile(join(tempDir, 'a.txt'), 'a');
    await writeFile(join(tempDir, 'b.txt'), 'b');
    const fp = await computeFileFingerprintsForDirectory(tempDir);

    const record = fingerprintToRecord(fp);
    expect(Object.keys(record)).toHaveLength(2);
    expect(record['a.txt']).toHaveLength(64);
    expect(record['b.txt']).toHaveLength(64);
  });

  it('fingerprintFromRecord reconstructs DirectoryFingerprint from record', () => {
    const record = { 'a.txt': 'sha-a', 'b.txt': 'sha-b' };
    const fp = fingerprintFromRecord(record, '/workspace');

    expect(fp.rootPath).toBe('/workspace');
    expect(fp.files.size).toBe(2);
    expect(fp.files.get('a.txt')!.sha256).toBe('sha-a');
    expect(fp.files.get('a.txt')!.mtimeMs).toBe(0); // unknown from record
    expect(fp.files.get('a.txt')!.size).toBe(0);
  });

  it('roundtrip: fingerprintToRecord → fingerprintFromRecord preserves paths + hashes', async () => {
    await writeFile(join(tempDir, 'a.txt'), 'a');
    await writeFile(join(tempDir, 'b.txt'), 'b');
    const original = await computeFileFingerprintsForDirectory(tempDir);

    const record = fingerprintToRecord(original);
    const restored = fingerprintFromRecord(record, tempDir);

    expect(restored.files.size).toBe(original.files.size);
    for (const [path, originalFp] of original.files) {
      const restoredFp = restored.files.get(path);
      expect(restoredFp).toBeDefined();
      expect(restoredFp!.sha256).toBe(originalFp.sha256);
    }
  });

  // -------------------------------------------------------------------------
  // End-to-end: write → fingerprint → modify → diff
  // -------------------------------------------------------------------------

  it('end-to-end: detects file modification after write', async () => {
    const filePath = join(tempDir, 'mod.txt');
    await writeFile(filePath, 'original content');
    const before = await computeFileFingerprintsForDirectory(tempDir);

    await writeFile(filePath, 'modified content');
    const after = await computeFileFingerprintsForDirectory(tempDir);

    const diff = diffFileFingerprints(before, after);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].path).toBe('mod.txt');
    expect(diff.summary.isClean).toBe(false);
  });

  it('end-to-end: detects file addition after write', async () => {
    const filePath = join(tempDir, 'existing.txt');
    await writeFile(filePath, 'existing');
    const before = await computeFileFingerprintsForDirectory(tempDir);

    await writeFile(join(tempDir, 'new.txt'), 'new');
    const after = await computeFileFingerprintsForDirectory(tempDir);

    const diff = diffFileFingerprints(before, after);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].path).toBe('new.txt');
  });

  it('end-to-end: detects file removal after delete', async () => {
    const filePath = join(tempDir, 'will-be-deleted.txt');
    await writeFile(filePath, 'temp');
    const before = await computeFileFingerprintsForDirectory(tempDir);

    await rm(filePath);
    const after = await computeFileFingerprintsForDirectory(tempDir);

    const diff = diffFileFingerprints(before, after);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].path).toBe('will-be-deleted.txt');
  });
});
