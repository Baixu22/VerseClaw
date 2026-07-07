import { describe, expect, it } from 'vitest';
import {
  basenameFromPath,
  compactCommit,
  defaultWorktreeTargetPath,
  pathEquals,
  worktreeBranchSlug,
} from '@/lib/git-ui';

describe('git UI helpers', () => {
  it('builds distinct worktree labels from path, branch, and commit', () => {
    expect(basenameFromPath('C:\\Users\\demo\\ClawX-feature-login')).toBe('ClawX-feature-login');
    expect(compactCommit('123456789abcdef')).toBe('1234567');
  });

  it('normalizes branch names into stable worktree path slugs', () => {
    expect(worktreeBranchSlug('feature/login polish')).toBe('feature-login-polish');
    expect(defaultWorktreeTargetPath('/workspace/ClawX', 'feature/login polish')).toBe('/workspace/ClawX-feature-login-polish');
  });

  it('compares Windows and POSIX paths without trailing slash noise', () => {
    expect(pathEquals('C:\\Users\\demo\\ClawX\\', 'c:/users/demo/clawx')).toBe(true);
    expect(pathEquals('/workspace/ClawX-a', '/workspace/ClawX-b')).toBe(false);
  });
});
