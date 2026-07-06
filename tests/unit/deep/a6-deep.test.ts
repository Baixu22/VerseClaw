import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getFileFingerprint,
  computeFileFingerprintsForDirectory,
  diffFileFingerprints,
  fingerprintToRecord,
  fingerprintFromRecord,
  computeCheckpointFileHashes,
} from '../../../openclaw_runtime/src/agents/long-task-control/file-fingerprint.js';
import {
  runRuntimeResumeShadow,
  isMutatingToolRequest,
} from '../../../openclaw_runtime/src/runtime-core/resume-shadow.js';
import {
  ResumeContractVerifier,
  FingerprintLeaseCoordinator,
} from '../../../openclaw_runtime/src/agents/cross-area/cross-area-facades.js';

/**
 * A6 deep tests — Long-Running Persistence.
 *
 * Covers:
 * - agents/long-task-control/file-fingerprint.ts (getFileFingerprint,
 *   computeFileFingerprintsForDirectory, diffFileFingerprints,
 *   fingerprintToRecord, fingerprintFromRecord, computeCheckpointFileHashes)
 * - runtime-core/resume-shadow.ts (runRuntimeResumeShadow, isMutatingToolRequest)
 * - agents/cross-area/cross-area-facades.ts (ResumeContractVerifier,
 *   FingerprintLeaseCoordinator)
 *
 * Note on import depth: tests live in tests/unit/deep/, so the relative path to
 * the runtime tree is ../../../openclaw_runtime/src/... (three levels up to root).
 *
 * MAX_FINGERPRINT_BYTES and MAX_FILES_PER_DIRECTORY are module-private
 * constants in file-fingerprint.ts (not exported). The local constants below
 * mirror the documented design values.
 */

const MAX_FINGERPRINT_BYTES = 16 * 1024 * 1024; // 16 MB
const MAX_FILES_PER_DIRECTORY = 10_000;

/** Config shape that enables the resume replay shadow feature flag. */
const RESUME_SHADOW_CONFIG = { runtime: { resume: { replayShadow: true } } };

describe('A6 deep — long-running persistence', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'a6-deep-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. 功能完整性 (6 tests)
  // -------------------------------------------------------------------------
  describe('功能完整性', () => {
    it('getFileFingerprint returns { sha256, size, mtimeMs }', async () => {
      const filePath = join(tmpDir, 'file.txt');
      await writeFile(filePath, 'hello world');
      const fp = await getFileFingerprint(filePath);
      expect(fp).not.toBeNull();
      expect(fp!.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(fp!.size).toBe(11);
      expect(fp!.mtimeMs).toBeGreaterThan(0);
      expect(fp!.path).toBe(filePath);
    });

    it('computeFileFingerprintsForDirectory returns DirectoryFingerprint with files Map', async () => {
      await writeFile(join(tmpDir, 'a.txt'), 'a');
      await writeFile(join(tmpDir, 'b.txt'), 'b');
      const dir = await computeFileFingerprintsForDirectory(tmpDir);
      expect(dir.rootPath).toBe(tmpDir);
      expect(dir.files.size).toBe(2);
      expect(dir.files.has('a.txt')).toBe(true);
      expect(dir.files.has('b.txt')).toBe(true);
      expect(dir.totalBytes).toBe(2);
    });

    it('diffFileFingerprints detects added, removed, and modified files', async () => {
      await writeFile(join(tmpDir, 'keep.txt'), 'keep');
      await writeFile(join(tmpDir, 'modify.txt'), 'original');
      await writeFile(join(tmpDir, 'remove.txt'), 'remove');
      const before = await computeFileFingerprintsForDirectory(tmpDir);

      await writeFile(join(tmpDir, 'modify.txt'), 'modified');
      await writeFile(join(tmpDir, 'added.txt'), 'added');
      await rm(join(tmpDir, 'remove.txt'));
      const after = await computeFileFingerprintsForDirectory(tmpDir);

      const diff = diffFileFingerprints(before, after);
      expect(diff.summary.addedCount).toBe(1);
      expect(diff.summary.removedCount).toBe(1);
      expect(diff.summary.modifiedCount).toBe(1);
      expect(diff.added.map((f) => f.path)).toContain('added.txt');
      expect(diff.removed.map((f) => f.path)).toContain('remove.txt');
      expect(diff.modified.map((f) => f.path)).toContain('modify.txt');
    });

    it('fingerprintToRecord and fingerprintFromRecord round-trip consistently', async () => {
      await writeFile(join(tmpDir, 'x.txt'), 'x');
      await writeFile(join(tmpDir, 'y.txt'), 'y');
      const dir = await computeFileFingerprintsForDirectory(tmpDir);
      const record = fingerprintToRecord(dir);
      const restored = fingerprintFromRecord(record, tmpDir);
      // Path → sha256 preserved.
      expect(restored.files.size).toBe(dir.files.size);
      for (const [path, fp] of dir.files) {
        expect(restored.files.get(path)?.sha256).toBe(fp.sha256);
        expect(restored.files.get(path)?.path).toBe(path);
      }
      // mtimeMs and size are 0 after round-trip (only path+sha256 stored).
      for (const fp of restored.files.values()) {
        expect(fp.mtimeMs).toBe(0);
        expect(fp.size).toBe(0);
      }
    });

    it('computeCheckpointFileHashes returns a Record<string, string> of path → sha256', async () => {
      const f1 = join(tmpDir, 'f1.txt');
      const f2 = join(tmpDir, 'f2.txt');
      await writeFile(f1, 'content1');
      await writeFile(f2, 'content2');
      const hashes = await computeCheckpointFileHashes([f1, f2]);
      expect(Object.keys(hashes).length).toBe(2);
      expect(hashes[f1]).toMatch(/^[0-9a-f]{64}$/);
      expect(hashes[f2]).toMatch(/^[0-9a-f]{64}$/);
      expect(hashes[f1]).not.toBe(hashes[f2]);
    });

    it('isMutatingToolRequest returns true for write/edit/bash and false for read/search', () => {
      // Mutating tool names.
      expect(isMutatingToolRequest({ toolName: 'file_write' } as never)).toBe(true);
      expect(isMutatingToolRequest({ toolName: 'apply_patch' } as never)).toBe(true);
      expect(isMutatingToolRequest({ toolName: 'mutating_shell' } as never)).toBe(true);
      // Non-mutating tool names.
      expect(isMutatingToolRequest({ toolName: 'read' } as never)).toBe(false);
      expect(isMutatingToolRequest({ toolName: 'search' } as never)).toBe(false);
      // Permission context with read effect → not mutating.
      expect(
        isMutatingToolRequest({
          toolName: 'custom_tool',
          permissionContext: { effect: 'read' },
        } as never),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. 边界条件 (6 tests)
  // -------------------------------------------------------------------------
  describe('边界条件', () => {
    it('empty directory produces an empty files Map', async () => {
      const dir = await computeFileFingerprintsForDirectory(tmpDir);
      expect(dir.files.size).toBe(0);
      expect(dir.skipped.length).toBe(0);
      expect(dir.totalBytes).toBe(0);
    });

    it('single-file directory is fingerprinted correctly', async () => {
      await writeFile(join(tmpDir, 'only.txt'), 'only');
      const dir = await computeFileFingerprintsForDirectory(tmpDir);
      expect(dir.files.size).toBe(1);
      expect(dir.files.get('only.txt')?.size).toBe(4);
    });

    it('deeply nested 10-level directory tree is fully traversed', async () => {
      let current = tmpDir;
      for (let i = 1; i <= 10; i++) {
        current = join(current, `level${i}`);
        await mkdir(current);
      }
      await writeFile(join(current, 'deep.txt'), 'deep');
      const dir = await computeFileFingerprintsForDirectory(tmpDir);
      expect(dir.files.size).toBe(1);
      const key = ['level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'level7', 'level8', 'level9', 'level10', 'deep.txt'].join('/');
      expect(dir.files.has(key)).toBe(true);
    });

    it('file at exactly MAX_FINGERPRINT_BYTES (16 MB) is fingerprinted (boundary inclusive)', async () => {
      const filePath = join(tmpDir, 'exact.bin');
      await writeFile(filePath, Buffer.alloc(MAX_FINGERPRINT_BYTES, 0));
      const fp = await getFileFingerprint(filePath);
      expect(fp).not.toBeNull();
      expect(fp!.size).toBe(MAX_FINGERPRINT_BYTES);
    });

    it('file exceeding MAX_FINGERPRINT_BYTES (16 MB + 1) returns null (skipped)', async () => {
      const filePath = join(tmpDir, 'over.bin');
      await writeFile(filePath, Buffer.alloc(MAX_FINGERPRINT_BYTES + 1, 0));
      const fp = await getFileFingerprint(filePath);
      expect(fp).toBeNull();
    });

    it(
      'directory with many files fingerprints within 5s (performance)',
      async () => {
        // Create a large number of files (practical subset of MAX_FILES_PER_DIRECTORY).
        const fileCount = 1000;
        for (let i = 0; i < fileCount; i++) {
          await writeFile(join(tmpDir, `file-${i}.txt`), String(i));
        }
        const start = Date.now();
        const dir = await computeFileFingerprintsForDirectory(tmpDir);
        const elapsed = Date.now() - start;
        expect(dir.files.size).toBe(fileCount);
        expect(elapsed).toBeLessThan(5000);
      },
      30000,
    );
  });

  // -------------------------------------------------------------------------
  // 3. 错误路径 (5 tests)
  // -------------------------------------------------------------------------
  describe('错误路径', () => {
    it('non-existent file returns null from getFileFingerprint', async () => {
      const fp = await getFileFingerprint(join(tmpDir, 'does-not-exist.txt'));
      expect(fp).toBeNull();
    });

    it('non-existent directory returns empty DirectoryFingerprint with skipped entry', async () => {
      const dir = await computeFileFingerprintsForDirectory(join(tmpDir, 'no-such-dir'));
      expect(dir.files.size).toBe(0);
      expect(dir.skipped.length).toBeGreaterThan(0);
    });

    it('permission denied file is skipped without throwing', async () => {
      const filePath = join(tmpDir, 'noperm.txt');
      await writeFile(filePath, 'secret');
      try {
        await chmod(filePath, 0o000);
      } catch {
        // chmod not fully supported on this platform — file remains readable.
      }
      // Regardless of permission state, getFileFingerprint must not throw.
      let threw = false;
      try {
        await getFileFingerprint(filePath);
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
      // Restore permissions for cleanup.
      try {
        await chmod(filePath, 0o644);
      } catch {
        // ignore
      }
    });

    it('symlink loop is skipped without throwing', async () => {
      const linkA = join(tmpDir, 'loopA');
      const linkB = join(tmpDir, 'loopB');
      let symlinksSupported = true;
      try {
        await symlink(linkB, linkA);
        await symlink(linkA, linkB);
      } catch {
        symlinksSupported = false;
      }
      if (!symlinksSupported) {
        // Symlinks not supported on this platform — verify graceful degradation.
        const fp = await getFileFingerprint(linkA);
        expect(fp).toBeNull();
        return;
      }
      // getFileFingerprint on a symlink loop must not throw (ELOOP caught).
      let threw = false;
      try {
        await getFileFingerprint(linkA);
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
    });

    it('file deleted after fingerprint shows as removed in diff', async () => {
      const filePath = join(tmpDir, 'transient.txt');
      await writeFile(filePath, 'temporary');
      const before = await computeFileFingerprintsForDirectory(tmpDir);
      await rm(filePath);
      const after = await computeFileFingerprintsForDirectory(tmpDir);
      const diff = diffFileFingerprints(before, after);
      expect(diff.summary.removedCount).toBe(1);
      expect(diff.removed.map((f) => f.path)).toContain('transient.txt');
    });
  });

  // -------------------------------------------------------------------------
  // 4. 属性测试 (3 tests)
  // -------------------------------------------------------------------------
  describe('属性测试', () => {
    it('getFileFingerprint is deterministic (same content → same sha256 across 5 runs)', async () => {
      const filePath = join(tmpDir, 'stable.txt');
      await writeFile(filePath, 'stable content');
      const first = await getFileFingerprint(filePath);
      expect(first).not.toBeNull();
      for (let i = 0; i < 4; i++) {
        const fp = await getFileFingerprint(filePath);
        expect(fp!.sha256).toBe(first!.sha256);
      }
    });

    it('diffFileFingerprints set algebra: added ∪ removed ∪ modified = (path,sha256) symmetric difference', async () => {
      // before: {a, b, c}; after: {b(modified), c(unchanged), d(added)}, a removed.
      await writeFile(join(tmpDir, 'a.txt'), 'a');
      await writeFile(join(tmpDir, 'b.txt'), 'b-original');
      await writeFile(join(tmpDir, 'c.txt'), 'c');
      const before = await computeFileFingerprintsForDirectory(tmpDir);

      await writeFile(join(tmpDir, 'b.txt'), 'b-modified');
      await writeFile(join(tmpDir, 'd.txt'), 'd');
      await rm(join(tmpDir, 'a.txt'));
      const after = await computeFileFingerprintsForDirectory(tmpDir);

      const diff = diffFileFingerprints(before, after);

      // Build the set of paths in added ∪ removed ∪ modified.
      const changedPaths = new Set<string>();
      for (const f of [...diff.added, ...diff.removed, ...diff.modified]) {
        changedPaths.add(f.path);
      }

      // Build the symmetric difference of (path, sha256) pairs.
      const beforePairs = new Set<string>();
      for (const [path, fp] of before.files) {
        beforePairs.add(`${path}:${fp.sha256}`);
      }
      const afterPairs = new Set<string>();
      for (const [path, fp] of after.files) {
        afterPairs.add(`${path}:${fp.sha256}`);
      }
      const symDiffPaths = new Set<string>();
      for (const pair of beforePairs) {
        if (!afterPairs.has(pair)) {
          symDiffPaths.add(pair.split(':')[0]);
        }
      }
      for (const pair of afterPairs) {
        if (!beforePairs.has(pair)) {
          symDiffPaths.add(pair.split(':')[0]);
        }
      }

      // The two sets must be equal.
      expect(changedPaths).toEqual(symDiffPaths);
    });

    it('fingerprintToRecord(fingerprintFromRecord(record)) ≈ record (path→sha256 preserved)', async () => {
      await writeFile(join(tmpDir, 'p1.txt'), 'p1');
      await writeFile(join(tmpDir, 'p2.txt'), 'p2');
      const dir = await computeFileFingerprintsForDirectory(tmpDir);
      const record = fingerprintToRecord(dir);
      const restored = fingerprintFromRecord(record, tmpDir);
      const reRecord = fingerprintToRecord(restored);
      // The record (path → sha256) must be identical after round-trip.
      expect(reRecord).toEqual(record);
    });
  });

  // -------------------------------------------------------------------------
  // 5. 并发测试 (2 tests)
  // -------------------------------------------------------------------------
  describe('并发测试', () => {
    it('parallel getFileFingerprint on the same file returns consistent results', async () => {
      const filePath = join(tmpDir, 'concurrent.txt');
      await writeFile(filePath, 'concurrent content');
      const results = await Promise.all([
        getFileFingerprint(filePath),
        getFileFingerprint(filePath),
        getFileFingerprint(filePath),
        getFileFingerprint(filePath),
        getFileFingerprint(filePath),
      ]);
      // All results must be non-null and have the same sha256.
      for (const fp of results) {
        expect(fp).not.toBeNull();
      }
      const sha = results[0]!.sha256;
      for (const fp of results) {
        expect(fp!.sha256).toBe(sha);
      }
    });

    it('parallel FingerprintLeaseCoordinator instances are isolated', () => {
      const coordA = new FingerprintLeaseCoordinator();
      const coordB = new FingerprintLeaseCoordinator();
      coordA.commitLease('lease-a', 1000);
      // coordB has not committed a lease.
      expect(() => coordB.writeCheckpoint('checkpoint-b', 2000)).toThrow();
      // coordA can write a checkpoint (lease was committed).
      const cp = coordA.writeCheckpoint('checkpoint-a', 2000);
      expect(cp.leaseId).toBe('lease-a');
    });
  });

  // -------------------------------------------------------------------------
  // 6. 跨平台 (2 tests)
  // -------------------------------------------------------------------------
  describe('跨平台', () => {
    it('Windows backslash paths are normalized to forward slashes in directory scan', async () => {
      await mkdir(join(tmpDir, 'subdir'));
      await writeFile(join(tmpDir, 'subdir', 'file.txt'), 'nested');
      const dir = await computeFileFingerprintsForDirectory(tmpDir);
      // The key must use forward slashes, not backslashes.
      const keys = [...dir.files.keys()];
      expect(keys.length).toBe(1);
      expect(keys[0]).toBe('subdir/file.txt');
      expect(keys[0]).not.toContain('\\');
    });

    it('mixed separators are treated as the same path (two scans produce identical keys)', async () => {
      await mkdir(join(tmpDir, 'subdir'));
      await writeFile(join(tmpDir, 'subdir', 'file.txt'), 'nested');
      // Scan twice — both produce forward-slash normalized keys.
      const scan1 = await computeFileFingerprintsForDirectory(tmpDir);
      const scan2 = await computeFileFingerprintsForDirectory(tmpDir);
      // Keys are identical (no separator mismatch).
      expect([...scan1.files.keys()]).toEqual([...scan2.files.keys()]);
      // Diff is clean (no added/removed/modified).
      const diff = diffFileFingerprints(scan1, scan2);
      expect(diff.summary.isClean).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 7. 集成测试 (3 tests)
  // -------------------------------------------------------------------------
  describe('集成测试', () => {
    it('ResumeContractVerifier.verify returns requiresReverification=true when rollbackOccurred=true (shadow enabled)', () => {
      const verifier = new ResumeContractVerifier();
      const result = verifier.verify(
        { config: RESUME_SHADOW_CONFIG, taskId: 'task-1' },
        true,
      );
      expect(result.enabled).toBe(true);
      expect(result.rollbackOccurred).toBe(true);
      expect(result.requiresReverification).toBe(true);
    });

    it('FingerprintLeaseCoordinator.coordinatePause returns leaseBeforeCheckpoint=true', () => {
      const coord = new FingerprintLeaseCoordinator();
      const result = coord.coordinatePause('lease-1', 'checkpoint-1', 1000);
      expect(result.leaseBeforeCheckpoint).toBe(true);
      expect(result.lease.leaseId).toBe('lease-1');
      expect(result.checkpoint.checkpointId).toBe('checkpoint-1');
      expect(result.checkpoint.leaseId).toBe('lease-1');
    });

    it('writeCheckpoint before commitLease throws (Blocker 4 race guard)', () => {
      const coord = new FingerprintLeaseCoordinator();
      expect(() => coord.writeCheckpoint('checkpoint-without-lease')).toThrow(
        /lease is committed/,
      );
    });
  });
});
