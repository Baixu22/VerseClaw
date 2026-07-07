export function basenameFromPath(path: string | null | undefined): string {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.split('/').pop() || normalized;
}

export function parentDir(path: string | null | undefined): string {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

export function worktreeBranchSlug(branch: string): string {
  return branch.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '') || 'worktree';
}

export function defaultWorktreeTargetPath(repoRoot: string | undefined, branch: string): string | null {
  const name = branch.trim();
  if (!repoRoot || !name) return null;
  const repoFolder = basenameFromPath(repoRoot) || 'workspace';
  const parent = parentDir(repoRoot);
  return parent ? `${parent}/${repoFolder}-${worktreeBranchSlug(name)}` : `${repoFolder}-${worktreeBranchSlug(name)}`;
}

export function pathEquals(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return left.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
    === right.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

export function compactCommit(value: string | undefined): string {
  return value ? value.slice(0, 7) : 'HEAD';
}
