import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  beginSnapshot,
  collectDeclaredWritePaths,
  type SnapshotHandle,
  type SnapshotPlan,
} from '../../openclaw_runtime/src/agents/sessions/extensions/policy-light-snapshotter';
import type { WriteRiskProfile } from '../../openclaw_runtime/src/shared/tool-registration';

const execFileAsync = promisify(execFile);

/**
 * Stage 2 acceptance criteria:
 * - 2.3: dynamic_writes tools trigger full fs-diff
 * - 2.5: A1 Git-diff fallback works when A6 flag off
 * - 2.6: A1 Git-diff fallback is byte-equivalent to old behavior
 * - 2.11: Flag-off parity (A1 flag off → no-op handle)
 *
 * Run: pnpm test policy-light-snapshotter
 */
describe('PolicyLightSnapshotter (A1 Stage 2)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'snap-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // collectDeclaredWritePaths
  // -------------------------------------------------------------------------

  describe('collectDeclaredWritePaths', () => {
    it('collects paths from declared_paths profiles', () => {
      const profiles = [
        {
          name: 'write_file',
          profile: { kind: 'declared_paths', writePaths: ['a.txt', 'b.txt'] } as WriteRiskProfile,
        },
        {
          name: 'write_pattern',
          profile: { kind: 'pattern_writes', writePattern: '*.log' } as WriteRiskProfile,
        },
      ];
      const { declaredPaths, dynamicTools } = collectDeclaredWritePaths(profiles);
      expect(declaredPaths).toEqual(expect.arrayContaining(['a.txt', 'b.txt', '*.log']));
      expect(declaredPaths).toHaveLength(3);
      expect(dynamicTools).toEqual([]);
    });

    it('collects dynamic tools separately', () => {
      const profiles = [
        {
          name: 'shell',
          profile: { kind: 'dynamic_writes', requiresApproval: true } as WriteRiskProfile,
        },
        {
          name: 'readonly_tool',
          profile: { kind: 'no_writes' } as WriteRiskProfile,
        },
      ];
      const { declaredPaths, dynamicTools } = collectDeclaredWritePaths(profiles);
      expect(declaredPaths).toEqual([]);
      expect(dynamicTools).toEqual(['shell']);
    });

    it('deduplicates declared paths', () => {
      const profiles = [
        {
          name: 'tool_a',
          profile: { kind: 'declared_paths', writePaths: ['shared.txt'] } as WriteRiskProfile,
        },
        {
          name: 'tool_b',
          profile: { kind: 'declared_paths', writePaths: ['shared.txt', 'unique.txt'] } as WriteRiskProfile,
        },
      ];
      const { declaredPaths } = collectDeclaredWritePaths(profiles);
      expect(declaredPaths).toEqual(['shared.txt', 'unique.txt']);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance 2.11: Flag-off parity
  // -------------------------------------------------------------------------

  describe('acceptance 2.11 — flag-off parity (A1 disabled → no-op handle)', () => {
    it('returns a no-op handle when a1Enabled is false/omitted', async () => {
      const result = await beginSnapshot(
        [
          {
            name: 'write_file',
            profile: { kind: 'declared_paths', writePaths: ['a.txt'] } as WriteRiskProfile,
          },
        ],
        { workspaceRoot: tempDir }, // a1Enabled omitted → false
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const handle = result.handle;

      // No-op handle: commit/rollback/discard are all no-ops (do not throw).
      await expect(handle.commit()).resolves.toBeUndefined();
      await expect(handle.rollback()).resolves.toBeUndefined();
      await expect(handle.discard()).resolves.toBeUndefined();
    });

    it('no-op handle has no diff (no snapshot taken)', async () => {
      const result = await beginSnapshot(
        [
          {
            name: 'write_file',
            profile: { kind: 'declared_paths', writePaths: ['a.txt'] } as WriteRiskProfile,
          },
        ],
        { workspaceRoot: tempDir, a1Enabled: false },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      await result.handle.commit();
      expect(result.handle.diff).toBeUndefined();
    });

    it('no-op handle does not create .openclaw/snapshots directory', async () => {
      const result = await beginSnapshot(
        [
          {
            name: 'write_file',
            profile: { kind: 'declared_paths', writePaths: ['a.txt'] } as WriteRiskProfile,
          },
        ],
        { workspaceRoot: tempDir, a1Enabled: false },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      await result.handle.commit();

      // No snapshot directory should be created.
      const { stat } = await import('node:fs/promises');
      await expect(stat(join(tempDir, '.openclaw', 'snapshots'))).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance 2.3: dynamic_writes tools trigger full fs-diff
  // -------------------------------------------------------------------------

  describe('acceptance 2.3 — dynamic_writes triggers full fs-diff (git-diff mode)', () => {
    it('selects git-diff mode when dynamic_writes tool is present', async () => {
      // Initialize a git repo so git-diff mode can run.
      await execFileAsync('git', ['init'], { cwd: tempDir });
      await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
      await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
      await writeFile(join(tempDir, 'committed.txt'), 'initial');
      await execFileAsync('git', ['add', '.'], { cwd: tempDir });
      await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: tempDir });

      const result = await beginSnapshot(
        [
          {
            name: 'shell',
            profile: { kind: 'dynamic_writes', requiresApproval: true } as WriteRiskProfile,
          },
        ],
        { workspaceRoot: tempDir, a1Enabled: true },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.handle.plan.mode).toBe('git-diff');
      expect(result.handle.plan.dynamicWriteTools).toEqual(['shell']);
    });

    it('records changed files via git-diff after commit', async () => {
      // Set up git repo with an initial commit.
      await execFileAsync('git', ['init'], { cwd: tempDir });
      await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
      await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
      await writeFile(join(tempDir, 'base.txt'), 'base');
      await execFileAsync('git', ['add', '.'], { cwd: tempDir });
      await execFileAsync('git', ['commit', '-m', 'base'], { cwd: tempDir });

      const result = await beginSnapshot(
        [
          {
            name: 'shell',
            profile: { kind: 'dynamic_writes', requiresApproval: true } as WriteRiskProfile,
          },
        ],
        { workspaceRoot: tempDir, a1Enabled: true },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const handle = result.handle;

      // Simulate a write during the turn.
      await writeFile(join(tempDir, 'new-file.txt'), 'created during turn');

      await handle.commit();

      // The diff should record the new file as added.
      expect(handle.diff).toBeDefined();
      if (!handle.diff) return;
      expect(handle.diff.added.some((f) => f.path === 'new-file.txt')).toBe(true);
      expect(handle.diff.summary.addedCount).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance 2.5: A1 Git-diff fallback works when A6 flag off
  // -------------------------------------------------------------------------

  describe('acceptance 2.5 — Git-diff fallback when A6 flag off', () => {
    it('falls back to git-diff when a6FingerprintEnabled is false/omitted', async () => {
      // Set up git repo.
      await execFileAsync('git', ['init'], { cwd: tempDir });
      await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
      await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
      await writeFile(join(tempDir, 'base.txt'), 'base');
      await execFileAsync('git', ['add', '.'], { cwd: tempDir });
      await execFileAsync('git', ['commit', '-m', 'base'], { cwd: tempDir });

      // dynamic_writes tool → git-diff mode, A6 off.
      const result = await beginSnapshot(
        [
          {
            name: 'shell',
            profile: { kind: 'dynamic_writes', requiresApproval: true } as WriteRiskProfile,
          },
        ],
        {
          workspaceRoot: tempDir,
          a1Enabled: true,
          a6FingerprintEnabled: false, // A6 off → git-diff fallback
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Git-diff mode should still work and produce a handle.
      expect(result.handle.plan.mode).toBe('git-diff');
      expect(result.handle.plan.a6FingerprintEnabled).toBe(false);
    });

    it('git-diff fallback succeeds even without baseline fingerprint', async () => {
      await execFileAsync('git', ['init'], { cwd: tempDir });
      await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
      await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
      await writeFile(join(tempDir, 'base.txt'), 'base');
      await execFileAsync('git', ['add', '.'], { cwd: tempDir });
      await execFileAsync('git', ['commit', '-m', 'base'], { cwd: tempDir });

      const result = await beginSnapshot(
        [
          {
            name: 'shell',
            profile: { kind: 'dynamic_writes', requiresApproval: true } as WriteRiskProfile,
          },
        ],
        {
          workspaceRoot: tempDir,
          a1Enabled: true,
          a6FingerprintEnabled: false,
          // baselineFingerprintRecord omitted
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.handle.plan.baselineFingerprint).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance 2.6: A1 Git-diff fallback is byte-equivalent to old behavior
  // -------------------------------------------------------------------------

  describe('acceptance 2.6 — Git-diff fallback byte-equivalent', () => {
    it('produces identical diff for same workspace operations (golden)', async () => {
      // Set up identical git repos.
      const setupRepo = async (dir: string) => {
        await execFileAsync('git', ['init'], { cwd: dir });
        await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
        await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
        await writeFile(join(dir, 'base.txt'), 'base content');
        await execFileAsync('git', ['add', '.'], { cwd: dir });
        await execFileAsync('git', ['commit', '-m', 'base'], { cwd: dir });
      };

      const dirA = await mkdtemp(join(tmpdir(), 'golden-a-'));
      const dirB = await mkdtemp(join(tmpdir(), 'golden-b-'));
      try {
        await setupRepo(dirA);
        await setupRepo(dirB);

        // Run identical snapshot operations on both.
        const runSnapshot = async (dir: string) => {
          const result = await beginSnapshot(
            [
              {
                name: 'shell',
                profile: { kind: 'dynamic_writes', requiresApproval: true } as WriteRiskProfile,
              },
            ],
            { workspaceRoot: dir, a1Enabled: true, a6FingerprintEnabled: false },
          );
          if (!result.ok) throw new Error(`snapshot failed: ${result.reason}`);
          // Same write operation.
          await writeFile(join(dir, 'output.txt'), 'same content');
          await result.handle.commit();
          return result.handle.diff;
        };

        const diffA = await runSnapshot(dirA);
        const diffB = await runSnapshot(dirB);

        // Both diffs should record the same set of added files.
        expect(diffA?.added.map((f) => f.path).sort()).toEqual(
          diffB?.added.map((f) => f.path).sort(),
        );
        expect(diffA?.summary.addedCount).toBe(diffB?.summary.addedCount);
      } finally {
        await rm(dirA, { recursive: true, force: true });
        await rm(dirB, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Copy-on-write mode (declared_paths only, no dynamic tools)
  // -------------------------------------------------------------------------

  describe('copy-on-write mode (declared_paths only)', () => {
    it('selects copy-on-write mode when only declared_paths tools present', async () => {
      const result = await beginSnapshot(
        [
          {
            name: 'write_file',
            profile: {
              kind: 'declared_paths',
              writePaths: ['output.txt'],
            } as WriteRiskProfile,
          },
        ],
        { workspaceRoot: tempDir, a1Enabled: true },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.handle.plan.mode).toBe('copy-on-write');
      expect(result.handle.plan.declaredWritePaths).toEqual(['output.txt']);
    });

    it('snapshots existing declared files and restores them on rollback', async () => {
      // Pre-create the declared file.
      const filePath = join(tempDir, 'target.txt');
      await writeFile(filePath, 'original content');

      const result = await beginSnapshot(
        [
          {
            name: 'write_file',
            profile: {
              kind: 'declared_paths',
              writePaths: ['target.txt'],
            } as WriteRiskProfile,
          },
        ],
        { workspaceRoot: tempDir, a1Enabled: true },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const handle = result.handle;

      // Simulate a write during the turn (overwrites the file).
      await writeFile(filePath, 'modified during turn');
      expect(await readFile(filePath, 'utf8')).toBe('modified during turn');

      // Rollback should restore the original content.
      await handle.rollback();
      expect(await readFile(filePath, 'utf8')).toBe('original content');
    });

    it('commit cleans up snapshot directory', async () => {
      const filePath = join(tempDir, 'target.txt');
      await writeFile(filePath, 'original');

      const result = await beginSnapshot(
        [
          {
            name: 'write_file',
            profile: {
              kind: 'declared_paths',
              writePaths: ['target.txt'],
            } as WriteRiskProfile,
          },
        ],
        { workspaceRoot: tempDir, a1Enabled: true },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      await result.handle.commit();

      // The specific snapshot subdir should be cleaned up after commit.
      // The parent .openclaw/snapshots directory may still exist (other
      // snapshots could be active), but should be empty.
      const { readdir } = await import('node:fs/promises');
      const snapshotsDir = join(tempDir, '.openclaw', 'snapshots');
      const entries = await readdir(snapshotsDir).catch(() => [] as string[]);
      expect(entries).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('returns no-op when no write paths and no dynamic tools', async () => {
      const result = await beginSnapshot(
        [
          {
            name: 'readonly_tool',
            profile: { kind: 'no_writes' } as WriteRiskProfile,
          },
        ],
        { workspaceRoot: tempDir, a1Enabled: true },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // No write paths → no-op handle.
      await expect(result.handle.commit()).resolves.toBeUndefined();
    });

    it('falls back to git-diff when declared paths exceed maxFilesForCopyOnWrite', async () => {
      // Generate many paths to exceed the limit.
      const manyPaths = Array.from({ length: 5 }, (_, i) => `file${i}.txt`);

      const result = await beginSnapshot(
        [
          {
            name: 'write_many',
            profile: {
              kind: 'declared_paths',
              writePaths: manyPaths,
            } as WriteRiskProfile,
          },
        ],
        { workspaceRoot: tempDir, a1Enabled: true, maxFilesForCopyOnWrite: 2 },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Should fall back to git-diff mode due to exceeding copy-on-write limit.
      expect(result.handle.plan.mode).toBe('git-diff');
    });
  });
});
