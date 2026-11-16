import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const canonical = (pathname: string) => {
  const actual = realpathSync.native(resolve(pathname)).replace(/^\\\\\?\\UNC\\/u, '\\\\').replace(/^\\\\\?\\/u, '').replace(/\\/g, '/');
  return process.platform === 'win32' ? actual.toLowerCase() : actual;
};

/** Repository identity follows the physical .git binding, not core.worktree. */
export function nativeGitWorktreeRoot(workspace: string): string | null {
  let cursor = canonical(workspace);
  for (;;) {
    const marker = join(cursor, '.git');
    if (existsSync(marker)) {
      if (lstatSync(marker).isSymbolicLink()) throw new Error('GIT_WORKTREE_BINDING_REDIRECTED');
      return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

export function assertGitNativeRoot(workspace: string, reported: string): void {
  const expected = nativeGitWorktreeRoot(workspace);
  if (!expected || canonical(reported) !== expected) throw new Error('GIT_WORKTREE_ROOT_MISMATCH');
}

/** Shared refs remain reachable after a linked worktree is removed. */
export function isSharedGitRef(ref: string): boolean {
  return ref.startsWith('refs/') && !/^refs\/(?:bisect|rewritten|worktree)\//u.test(ref);
}
