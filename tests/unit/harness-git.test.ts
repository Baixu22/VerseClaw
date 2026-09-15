import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { getChangedFiles, assertDiffBase } from '../../harness/src/git.mjs';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

describe('harness git changed files', () => {
  it('preserves Unicode and leading spaces across committed, staged, unstaged, and untracked paths', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'clawx-harness-git-unicode-'));
    const names = ['已提交.txt', '已暂存.txt', '未暂存.txt', ' 新建文件.txt'];
    try {
      await git(repo, ['init']);
      await git(repo, ['config', 'user.email', 'test@example.com']);
      await git(repo, ['config', 'user.name', 'Test']);
      await git(repo, ['config', 'core.quotePath', 'true']);
      for (const name of names.slice(0, 3)) await writeFile(path.join(repo, name), 'before\n');
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-m', 'base']);
      await git(repo, ['tag', 'baseline']);
      await writeFile(path.join(repo, names[0]), 'committed\n');
      await git(repo, ['add', names[0]]);
      await git(repo, ['commit', '-m', 'change']);
      await writeFile(path.join(repo, names[1]), 'staged\n');
      await git(repo, ['add', names[1]]);
      await writeFile(path.join(repo, names[2]), 'unstaged\n');
      await writeFile(path.join(repo, names[3]), 'untracked\n');
      expect(await getChangedFiles('baseline', repo)).toEqual([...names].sort());
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('rejects a valid base with unrelated history instead of dropping the committed diff', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'clawx-harness-git-orphan-'));
    try {
      await git(repo, ['init']);
      await git(repo, ['config', 'user.email', 'test@example.com']);
      await git(repo, ['config', 'user.name', 'Test']);
      await writeFile(path.join(repo, 'tracked.txt'), 'base\n');
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-m', 'base']);
      await git(repo, ['tag', 'baseline']);
      await git(repo, ['checkout', '--orphan', 'unrelated']);
      await git(repo, ['commit', '-m', 'unrelated root']);
      await expect(getChangedFiles('baseline', repo)).rejects.toThrow(/no merge base/);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('includes staged tracked files when collecting changed paths', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'clawx-harness-git-'));
    const harnessDir = path.join(repo, 'harness', 'src');

    try {
      await mkdir(harnessDir, { recursive: true });
      await writeFile(path.join(repo, 'tracked.txt'), 'before\n');
      await git(repo, ['init']);
      await git(repo, ['config', 'user.email', 'test@example.com']);
      await git(repo, ['config', 'user.name', 'Test']);
      await git(repo, ['add', 'tracked.txt']);
      await git(repo, ['commit', '-m', 'init']);

      await writeFile(path.join(repo, 'tracked.txt'), 'after\n');
      await git(repo, ['add', 'tracked.txt']);

      const changed = await getChangedFiles('HEAD', repo);

      expect(changed).toContain('tracked.txt');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  // RC-00R regression: an unresolvable base ref previously made gitLines swallow
  // the git error and return an empty changed-file list, which turned every
  // downstream changed-path ownership check into a vacuous pass.
  it('fails closed for an invalid or empty diff base instead of returning no changed files', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'clawx-harness-git-base-'));

    try {
      await writeFile(path.join(repo, 'tracked.txt'), 'before\n');
      await git(repo, ['init']);
      await git(repo, ['config', 'user.email', 'test@example.com']);
      await git(repo, ['config', 'user.name', 'Test']);
      await git(repo, ['add', 'tracked.txt']);
      await git(repo, ['commit', '-m', 'init']);

      await expect(getChangedFiles('this-ref-does-not-exist', repo)).rejects.toThrow(
        /invalid or missing diff base ref/,
      );
      await expect(assertDiffBase('   ', repo)).rejects.toThrow(/non-empty ref/);
      await expect(assertDiffBase(undefined as unknown as string, repo)).rejects.toThrow(/non-empty ref/);

      // A valid base still resolves and still reports real changes.
      await writeFile(path.join(repo, 'tracked.txt'), 'after\n');
      await expect(getChangedFiles('HEAD', repo)).resolves.toContain('tracked.txt');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
