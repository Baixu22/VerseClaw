// @vitest-environment node
// Evidence binding: a seal is invalidated by its judged inputs, not by "some
// other commit exists after it". This is the rule that replaced the TF-0592 /
// TF-0590 commit-range allowlist, which turned every unrelated commit into a
// reseal obligation.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { changedPathsBetween, splitDirtyPaths } from '../../scripts/lib/evidence-binding.mjs';

const TEMP_ROOT = 'D:/tmp';
const created: string[] = [];

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=evidence-binding-test', '-c', 'user.email=test@local', ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function makeRepo(): string {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TEMP_ROOT, 'evidence-binding-test-'));
  created.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  mkdirSync(join(root, 'bound'), { recursive: true });
  writeFileSync(join(root, 'docs.md'), 'v1\n');
  writeFileSync(join(root, 'bound', 'input.txt'), 'v1\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'seal']);
  return root;
}

afterAll(() => {
  for (const path of created) {
    if (!resolve(path).startsWith(`${resolve(TEMP_ROOT)}${sep}evidence-binding-test-`)) throw new Error('unexpected temporary cleanup path');
    rmSync(path, { recursive: true, force: true });
  }
});

describe('changedPathsBetween', () => {
  it('ignores commits that only touch unbound paths', () => {
    const root = makeRepo();
    const sealed = git(root, ['rev-parse', 'HEAD']);

    writeFileSync(join(root, 'docs.md'), 'v2\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'docs only']);

    expect(changedPathsBetween(root, sealed, 'HEAD', ['bound/input.txt'])).toEqual([]);
    // Without a path filter the same commit range is visible.
    expect(changedPathsBetween(root, sealed, 'HEAD')).toEqual(['docs.md']);
  });

  it('reports a bound input that moved after the seal', () => {
    const root = makeRepo();
    const sealed = git(root, ['rev-parse', 'HEAD']);

    writeFileSync(join(root, 'bound', 'input.txt'), 'v2\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'bound input changed']);

    expect(changedPathsBetween(root, sealed, 'HEAD', ['bound/input.txt', 'docs.md'])).toEqual(['bound/input.txt']);
  });
});

describe('splitDirtyPaths', () => {
  it('keeps a leading status space from corrupting the first path', () => {
    const root = makeRepo();
    // A staged deletion and an unstaged edit both start with a space column.
    writeFileSync(join(root, 'bound', 'input.txt'), 'v2\n');
    const split = splitDirtyPaths(root, ['bound/input.txt']);

    expect(split.judged).toEqual(['bound/input.txt']);
    expect(split.unrelated).toEqual([]);
  });

  it('separates an unbound edit from a judged input edit', () => {
    const root = makeRepo();
    writeFileSync(join(root, 'docs.md'), 'v2\n');
    writeFileSync(join(root, 'bound', 'input.txt'), 'v2\n');
    const split = splitDirtyPaths(root, ['bound/input.txt']);

    expect(split.judged).toEqual(['bound/input.txt']);
    expect(split.unrelated).toEqual(['docs.md']);
  });

  it('reports nothing for a clean tree', () => {
    const root = makeRepo();
    expect(splitDirtyPaths(root, ['bound/input.txt'])).toEqual({ judged: [], unrelated: [] });
  });
});
