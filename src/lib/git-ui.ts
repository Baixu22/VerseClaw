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

const RELATIVE_TIME_STEPS: Array<{ limit: number; divisor: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { limit: 60_000, divisor: 1_000, unit: 'second' },
  { limit: 3_600_000, divisor: 60_000, unit: 'minute' },
  { limit: 86_400_000, divisor: 3_600_000, unit: 'hour' },
  { limit: 604_800_000, divisor: 86_400_000, unit: 'day' },
  { limit: 2_629_800_000, divisor: 604_800_000, unit: 'week' },
  { limit: 31_557_600_000, divisor: 2_629_800_000, unit: 'month' },
  { limit: Number.POSITIVE_INFINITY, divisor: 31_557_600_000, unit: 'year' },
];

export function formatRelativeTime(timestamp: number | undefined, locale?: string): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '';
  const delta = timestamp - Date.now();
  const magnitude = Math.abs(delta);
  const step = RELATIVE_TIME_STEPS.find((entry) => magnitude < entry.limit) ?? RELATIVE_TIME_STEPS[RELATIVE_TIME_STEPS.length - 1];
  const value = Math.round(delta / step.divisor);
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' }).format(value, step.unit);
  } catch {
    return new Date(timestamp).toLocaleDateString();
  }
}
