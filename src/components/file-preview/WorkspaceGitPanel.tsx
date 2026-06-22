import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  GitPullRequestCreate,
  GitCompareArrows,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import type {
  GitBranch as GitBranchInfo,
  GitChangeBucket,
  GitDiffMode,
  GitDiffResult,
  GitFileChange,
  GitOperationResult,
  GitRepositoryStatus,
  GitWorktree,
  GithubAuthStatus,
  GithubPrSummary,
} from '@shared/types/git';
import type { PermissionApprovalEvent } from '@shared/types/workspace';

const MonacoDiffViewerLazy = lazy(() => import('./MonacoDiffViewer'));

type WorkspaceGitPanelProps = {
  selectedPath?: string | null;
  diffMode?: GitDiffMode;
  onSelectedPathChange?: (path: string | null) => void;
  onDiffModeChange?: (mode: GitDiffMode) => void;
};

type ApprovalRetry = {
  approval: PermissionApprovalEvent;
  action: string;
  retry: (approvalId: string) => Promise<GitOperationResult>;
};

type WorktreeMode = 'new' | 'existing';

const CHANGE_GROUPS: GitChangeBucket[] = ['conflicted', 'staged', 'unstaged', 'untracked'];

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.split('/').pop() || normalized;
}

function pathEquals(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return left.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
    === right.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

function compactCommit(value: string | undefined): string {
  return value ? value.slice(0, 7) : 'HEAD';
}

function changeBadge(change: GitFileChange): { label: string; variant: 'destructive' | 'outline' | 'warning' | 'secondary' } {
  if (change.conflicted) return { label: change.status || '!!', variant: 'destructive' };
  if (change.untracked) return { label: '??', variant: 'warning' };
  if (change.staged && change.unstaged) return { label: change.status || 'MM', variant: 'secondary' };
  if (change.staged) return { label: change.status || 'S', variant: 'outline' };
  return { label: change.status || 'M', variant: 'outline' };
}

function modeForChange(change: GitFileChange): GitDiffMode {
  return change.staged && !change.unstaged && !change.untracked ? 'staged' : 'unstaged';
}

function hasApproval(result: GitOperationResult): result is GitOperationResult & { approval: PermissionApprovalEvent } {
  return Boolean(result.approvalRequired && result.approval);
}

function operationReason(result: GitOperationResult): string | null {
  return result.reason || result.stderr || result.stdout || null;
}

export function WorkspaceGitPanel({
  selectedPath,
  diffMode = 'unstaged',
  onSelectedPathChange,
  onDiffModeChange,
}: WorkspaceGitPanelProps) {
  const { t } = useTranslation('chat');
  const [status, setStatus] = useState<GitRepositoryStatus | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [githubAuth, setGithubAuth] = useState<GithubAuthStatus | null>(null);
  const [pullRequests, setPullRequests] = useState<GithubPrSummary[]>([]);
  const [diff, setDiff] = useState<GitDiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [operationLoading, setOperationLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRetry | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [branchName, setBranchName] = useState('');
  const [worktreeMode, setWorktreeMode] = useState<WorktreeMode>('new');
  const [worktreeBranch, setWorktreeBranch] = useState('');
  const [worktreeStartPoint, setWorktreeStartPoint] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [revertPath, setRevertPath] = useState<string | null>(null);

  const changes = useMemo(() => status?.changes ?? [], [status?.changes]);
  const effectiveSelectedPath = selectedPath || changes[0]?.path || null;
  const selectedChange = changes.find((change) => change.path === effectiveSelectedPath) ?? null;
  const currentWorktree = useMemo(
    () => worktrees.find((worktree) => pathEquals(worktree.path, status?.repoRoot) || pathEquals(worktree.path, status?.workspaceRoot)),
    [status?.repoRoot, status?.workspaceRoot, worktrees],
  );

  const groupedChanges = useMemo(() => {
    return CHANGE_GROUPS.map((bucket) => ({
      bucket,
      changes: changes.filter((change) => change.bucket === bucket),
    }));
  }, [changes]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusResult, branchesResult, worktreesResult, authResult] = await Promise.all([
        hostApi.git.status(),
        hostApi.git.branches().catch(() => ({ branches: [] })),
        hostApi.git.worktrees().catch(() => ({ worktrees: [] })),
        hostApi.git.githubAuthStatus().catch(() => null),
      ]);
      setStatus(statusResult.status);
      setBranches(branchesResult.branches ?? []);
      setWorktrees(worktreesResult.worktrees ?? []);
      setGithubAuth(authResult);

      if (authResult?.authenticated) {
        const prs = await hostApi.git.prList({ state: 'open', limit: 8 }).catch(() => ({ pullRequests: [] }));
        setPullRequests(prs.pullRequests ?? []);
      } else {
        setPullRequests([]);
      }
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedPath && changes[0]?.path) {
      onSelectedPathChange?.(changes[0].path);
      onDiffModeChange?.(modeForChange(changes[0]));
    }
  }, [changes, onDiffModeChange, onSelectedPathChange, selectedPath]);

  useEffect(() => {
    if (!effectiveSelectedPath || !status?.isRepository) {
      setDiff(null);
      return;
    }
    let disposed = false;
    setDiffLoading(true);
    hostApi.git.fileDiff({ path: effectiveSelectedPath, mode: diffMode })
      .then((result) => {
        if (!disposed) setDiff(result);
      })
      .catch((err) => {
        if (!disposed) {
          setDiff({
            path: effectiveSelectedPath,
            mode: diffMode,
            patch: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!disposed) setDiffLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [diffMode, effectiveSelectedPath, status?.isRepository]);

  const showBlocked = useCallback((action: string, result: GitOperationResult, retry?: (approvalId: string) => Promise<GitOperationResult>) => {
    const reason = operationReason(result) ?? t('workspace.git.toast.blocked');
    setNotice(reason);
    toast.warning(t('workspace.git.toast.blocked'));
    if (hasApproval(result) && retry) {
      setPendingApproval({ approval: result.approval, action, retry });
    }
  }, [t]);

  const finishOperation = useCallback(async (
    key: string,
    action: string,
    operation: () => Promise<GitOperationResult>,
    retry?: (approvalId: string) => Promise<GitOperationResult>,
  ) => {
    setOperationLoading(key);
    setNotice(null);
    setPendingApproval(null);
    try {
      const result = await operation();
      if (result.success) {
        await refresh();
        return result;
      }
      if (result.blocked || result.approvalRequired) {
        showBlocked(action, result, retry);
      } else {
        const reason = operationReason(result) ?? t('workspace.git.toast.failed');
        setNotice(reason);
        toast.error(reason);
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(message);
      toast.error(message);
      return { success: false, reason: message };
    } finally {
      setOperationLoading(null);
    }
  }, [refresh, showBlocked, t]);

  const approveAndRetry = useCallback(async () => {
    if (!pendingApproval) return;
    setOperationLoading('approval');
    try {
      const decision = await hostApi.permissions.decideApproval({
        id: pendingApproval.approval.id,
        decision: 'approved',
      });
      if (!decision.success) {
        toast.error(t('workspace.git.toast.approvalFailed'));
        return;
      }
      const result = await pendingApproval.retry(pendingApproval.approval.id);
      if (result.success) {
        setPendingApproval(null);
        setNotice(null);
        await refresh();
      } else if (result.blocked || result.approvalRequired) {
        showBlocked(pendingApproval.action, result, pendingApproval.retry);
      } else {
        setNotice(operationReason(result) ?? t('workspace.git.toast.failed'));
      }
    } catch {
      toast.error(t('workspace.git.toast.approvalFailed'));
    } finally {
      setOperationLoading(null);
    }
  }, [pendingApproval, refresh, showBlocked, t]);

  const selectChange = (change: GitFileChange) => {
    onSelectedPathChange?.(change.path);
    onDiffModeChange?.(modeForChange(change));
  };

  const stageSelected = () => {
    if (!effectiveSelectedPath) return;
    void finishOperation(
      'stage',
      t('workspace.git.actions.stage'),
      () => hostApi.git.stage({ paths: [effectiveSelectedPath] }),
      (approvalId) => hostApi.git.stage({ paths: [effectiveSelectedPath], approvalId }),
    );
  };

  const unstageSelected = () => {
    if (!effectiveSelectedPath) return;
    void finishOperation(
      'unstage',
      t('workspace.git.actions.unstage'),
      () => hostApi.git.unstage({ paths: [effectiveSelectedPath] }),
      (approvalId) => hostApi.git.unstage({ paths: [effectiveSelectedPath], approvalId }),
    );
  };

  const revertSelected = useCallback((path: string) => {
    void finishOperation(
      'revert',
      t('workspace.git.actions.revert'),
      () => hostApi.git.revertFile({ path }),
      (approvalId) => hostApi.git.revertFile({ path, approvalId }),
    );
  }, [finishOperation, t]);

  const copyPatch = useCallback(async () => {
    if (!diff?.patch) return;
    try {
      await navigator.clipboard.writeText(diff.patch);
      toast.success(t('workspace.git.toast.patchCopied'));
    } catch (err) {
      toast.error(t('workspace.git.toast.patchCopyFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  }, [diff?.patch, t]);

  const commit = () => {
    const message = commitMessage.trim();
    if (!message) return;
    void finishOperation(
      'commit',
      t('workspace.git.actions.commit'),
      () => hostApi.git.commit({ message }),
      (approvalId) => hostApi.git.commit({ message, approvalId }),
    ).then((result) => {
      if (result.success) setCommitMessage('');
    });
  };

  const createBranch = () => {
    const name = branchName.trim();
    if (!name) return;
    void finishOperation(
      'branch',
      t('workspace.git.actions.createBranch'),
      () => hostApi.git.createBranch({ name, checkout: true }),
      (approvalId) => hostApi.git.createBranch({ name, checkout: true, approvalId }),
    ).then((result) => {
      if (result.success) setBranchName('');
    });
  };

  const addWorktree = () => {
    const branch = worktreeBranch.trim();
    if (!branch) return;
    const startPoint = worktreeStartPoint.trim();
    const payload = {
      branch,
      checkoutNewBranch: worktreeMode === 'new',
      ...(worktreeMode === 'new' && startPoint ? { startPoint } : {}),
    };
    void finishOperation(
      'worktreeAdd',
      t('workspace.git.actions.addWorktree'),
      () => hostApi.git.worktreeAdd(payload),
      (approvalId) => hostApi.git.worktreeAdd({ ...payload, approvalId }),
    ).then((result) => {
      if (result.success) {
        setWorktreeBranch('');
        setWorktreeStartPoint('');
      }
    });
  };

  const removeWorktree = (worktree: GitWorktree) => {
    void finishOperation(
      `remove:${worktree.path}`,
      t('workspace.git.actions.removeWorktree'),
      () => hostApi.git.worktreeRemove({ path: worktree.path }),
      (approvalId) => hostApi.git.worktreeRemove({ path: worktree.path, approvalId }),
    );
  };

  const pruneWorktrees = () => {
    void finishOperation(
      'prune',
      t('workspace.git.actions.pruneWorktrees'),
      () => hostApi.git.worktreePrune(),
      (approvalId) => hostApi.git.worktreePrune({ approvalId }),
    );
  };

  const createPr = () => {
    const title = prTitle.trim();
    if (!title) return;
    const body = prBody.trim();
    void finishOperation(
      'prCreate',
      t('workspace.git.actions.createPr'),
      () => hostApi.git.prCreate({ title, body }),
      (approvalId) => hostApi.git.prCreate({ title, body, approvalId }),
    ).then((result) => {
      if (result.success) {
        setPrTitle('');
        setPrBody('');
      }
    });
  };

  if (error) {
    return (
      <div className="flex h-full min-h-0 flex-col p-3" data-testid="workspace-git-panel">
        <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-400">
          {error}
        </div>
      </div>
    );
  }

  if (status && !status.isRepository) {
    return (
      <div className="flex h-full min-h-0 flex-col p-3" data-testid="workspace-git-panel">
        <div className="flex h-full items-center justify-center rounded-md border border-dashed border-black/10 bg-surface-modal px-5 text-center dark:border-white/10">
          <div className="max-w-xs">
            <GitBranch className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">{t('workspace.git.empty.title')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('workspace.git.empty.body')}</p>
          </div>
        </div>
      </div>
    );
  }

  const totalChanges = changes.length;
  const isClean = Boolean(status?.clean);
  const stateLabel = status?.hasConflicts
    ? t('workspace.git.state.conflict')
    : isClean
      ? t('workspace.git.state.clean')
      : t('workspace.git.state.dirty');
  const stateVariant = status?.hasConflicts ? 'destructive' : isClean ? 'success' : 'warning';
  const canStage = Boolean(effectiveSelectedPath && (!selectedChange || selectedChange.bucket !== 'staged'));
  const canUnstage = Boolean(effectiveSelectedPath && selectedChange?.staged);
  const canRevert = Boolean(effectiveSelectedPath && selectedChange);
  const canCopyPatch = Boolean(diff?.patch && !diffLoading);
  const canRenderMonacoDiff = Boolean(
    diff
    && !diffLoading
    && !diff.binary
    && !diff.tooLarge
    && typeof diff.original === 'string'
    && typeof diff.modified === 'string'
    && (diff.patch || diff.original !== diff.modified),
  );

  return (
    <>
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="workspace-git-panel">
      <div className="shrink-0 border-b border-black/5 bg-surface-modal px-3 py-2 dark:border-white/10">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
                <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{status?.detached ? t('workspace.git.detached') : status?.branch || t('workspace.git.loading')}</span>
              </span>
              <Badge variant={stateVariant} className="shrink-0">{stateLabel}</Badge>
              {status?.upstream ? (
                <span className="truncate rounded border border-black/10 bg-surface-input px-1.5 py-0.5 text-2xs text-muted-foreground dark:border-white/10">
                  {status.upstream}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-2xs text-muted-foreground">
              {t('workspace.git.summary', { count: totalChanges, ahead: status?.ahead ?? 0, behind: status?.behind ?? 0 })}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 bg-surface-input text-xs"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('workspace.git.actions.refresh')}
          </Button>
        </div>
      </div>

      {pendingApproval ? (
        <div className="mx-3 mt-3 rounded-md border border-amber-500/25 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-medium">
                <ShieldAlert className="h-3.5 w-3.5" />
                {t('workspace.git.approval.title', { action: pendingApproval.action })}
              </p>
              <p className="mt-1 text-amber-900/80 dark:text-amber-200/80">
                {pendingApproval.approval.reason || notice}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-7 shrink-0 text-xs"
              onClick={() => void approveAndRetry()}
              disabled={operationLoading === 'approval'}
            >
              {operationLoading === 'approval' ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
              {t('workspace.git.actions.approveRetry')}
            </Button>
          </div>
        </div>
      ) : notice ? (
        <div className="mx-3 mt-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {notice}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 min-[980px]:grid-cols-[minmax(220px,0.38fr)_minmax(360px,0.62fr)]">
        <section className="min-h-0 overflow-hidden rounded-md border border-black/10 bg-surface-modal dark:border-white/10">
          <div className="flex items-center justify-between border-b border-black/5 px-3 py-2 dark:border-white/10">
            <span className="text-xs font-medium text-foreground">{t('artifactPanel.tabs.changes')}</span>
            <Badge variant="outline" className="text-2xs">{totalChanges}</Badge>
          </div>
          <div className="h-full min-h-0 overflow-y-auto pb-10">
            {loading && changes.length === 0 ? (
              <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                {t('workspace.git.loading')}
              </div>
            ) : changes.length === 0 ? (
              <div className="flex h-36 items-center justify-center px-4 text-center text-xs text-muted-foreground">
                <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-green-700 dark:text-green-400" />
                {t('workspace.git.clean')}
              </div>
            ) : (
              <div className="divide-y divide-black/5 dark:divide-white/10">
                {groupedChanges.map((group) => (
                  <div key={group.bucket}>
                    <div className="sticky top-0 z-10 bg-surface-modal/95 px-3 py-1.5 text-2xs font-medium uppercase tracking-normal text-muted-foreground backdrop-blur">
                      {t(`workspace.git.groups.${group.bucket}`, { count: group.changes.length })}
                    </div>
                    <div className="space-y-0.5 px-1.5 pb-1.5">
                      {group.changes.length === 0 ? (
                        <p className="px-2 py-1.5 text-2xs text-muted-foreground">
                          {t('workspace.git.groups.empty')}
                        </p>
                      ) : group.changes.map((change) => {
                        const badge = changeBadge(change);
                        return (
                          <button
                            key={`${change.bucket}:${change.path}`}
                            type="button"
                            className={cn(
                              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10',
                              effectiveSelectedPath === change.path && 'bg-black/5 dark:bg-white/10',
                            )}
                            onClick={() => selectChange(change)}
                          >
                            <span className="min-w-0 flex-1 truncate font-mono text-foreground">{change.path}</span>
                            <Badge variant={badge.variant} className="shrink-0 px-1.5 py-0 text-2xs">{badge.label}</Badge>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-md border border-black/10 bg-[#0d1117] text-slate-100 dark:border-white/10">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-slate-100">{effectiveSelectedPath || t('workspace.git.diff.empty')}</p>
              <p className="mt-0.5 text-2xs text-slate-400">
                {diffMode === 'staged' ? t('workspace.git.diff.staged') : t('workspace.git.diff.unstaged')}
              </p>
            </div>
            <div className="inline-flex shrink-0 rounded-md border border-white/10 bg-white/5 p-0.5">
              {(['unstaged', 'staged'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={cn(
                    'rounded px-2 py-1 text-2xs text-slate-400',
                    diffMode === mode && 'bg-white/10 text-white',
                  )}
                  onClick={() => onDiffModeChange?.(mode)}
                >
                  {t(`workspace.git.diff.${mode}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {canRenderMonacoDiff && effectiveSelectedPath ? (
              <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-slate-400">{t('workspace.git.loading')}</div>}>
                <MonacoDiffViewerLazy
                  filePath={effectiveSelectedPath}
                  original={diff?.original}
                  modified={diff?.modified ?? ''}
                  className="min-h-[260px]"
                />
              </Suspense>
            ) : (
              <pre className="h-full min-h-0 overflow-auto p-3 font-mono text-2xs leading-relaxed">
                {diffLoading ? (
                  <span className="text-slate-400">{t('workspace.git.loading')}</span>
                ) : diff?.binary ? (
                  <span className="text-slate-400">{t('workspace.git.diff.binary')}</span>
                ) : diff?.tooLarge ? (
                  <span className="text-slate-400">{t('workspace.git.diff.tooLarge')}</span>
                ) : diff?.patch ? (
                  diff.patch
                ) : (
                  <span className="text-slate-400">{t('workspace.git.diff.empty')}</span>
                )}
              </pre>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 px-3 py-2">
            <Button type="button" size="sm" className="h-7 text-xs" onClick={stageSelected} disabled={!canStage || operationLoading === 'stage'}>
              {operationLoading === 'stage' ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Plus className="mr-1.5 h-3 w-3" />}
              {t('workspace.git.actions.stage')}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7 border-white/10 bg-white/5 text-xs text-slate-100 hover:bg-white/10" onClick={unstageSelected} disabled={!canUnstage || operationLoading === 'unstage'}>
              {t('workspace.git.actions.unstage')}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7 border-white/10 bg-white/5 text-xs text-slate-100 hover:bg-white/10" onClick={() => void copyPatch()} disabled={!canCopyPatch}>
              <ClipboardCopy className="mr-1.5 h-3 w-3" />
              {t('workspace.git.actions.copyPatch')}
            </Button>
            <Button type="button" variant="destructive" size="sm" className="h-7 text-xs" onClick={() => setRevertPath(effectiveSelectedPath)} disabled={!canRevert || operationLoading === 'revert'}>
              {operationLoading === 'revert' ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1.5 h-3 w-3" />}
              {t('workspace.git.actions.revert')}
            </Button>
          </div>
          <div className="shrink-0 border-t border-white/10 px-3 py-2">
            <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-2.5 py-2">
              <div className="min-w-0">
                <p className="text-2xs font-medium uppercase tracking-normal text-slate-400">{t('workspace.git.validation.title')}</p>
                <p className="truncate text-xs text-slate-200">{t('workspace.git.validation.empty')}</p>
              </div>
              <Badge variant="outline" className="shrink-0 border-white/10 text-2xs text-slate-300">{t('workspace.git.validation.status')}</Badge>
            </div>
          </div>
        </section>
      </div>

      <div className="shrink-0 border-t border-black/5 bg-surface-modal p-3 dark:border-white/10">
        <div className="grid max-h-[260px] grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2 overflow-y-auto pr-1">
        <section className="min-w-0 rounded-md border border-black/10 bg-background p-2 dark:border-white/10">
          <div className="flex items-center justify-between gap-2">
            <PanelTitle icon={<HardDrive className="h-3.5 w-3.5" />} title={t('workspace.git.worktrees.title')} />
            <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-2xs" onClick={pruneWorktrees} disabled={operationLoading === 'prune'}>
              {t('workspace.git.actions.pruneWorktrees')}
            </Button>
          </div>
          <div className="mt-2 max-h-28 space-y-1 overflow-y-auto rounded-md border border-black/5 bg-surface-input p-1 dark:border-white/10">
            {worktrees.length === 0 ? (
              <p className="px-1 py-1 text-2xs text-muted-foreground">{t('workspace.git.worktrees.empty')}</p>
            ) : worktrees.map((worktree) => {
              const current = pathEquals(worktree.path, currentWorktree?.path);
              return (
                <div key={worktree.path} className="rounded bg-background px-2 py-1 dark:bg-white/5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-2xs text-foreground">{basename(worktree.path)}</p>
                      <p className="truncate text-2xs text-muted-foreground">{worktree.branch || compactCommit(worktree.head)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {current ? <Badge variant="success" className="px-1.5 py-0 text-2xs">{t('workspace.git.worktrees.current')}</Badge> : null}
                      {worktree.locked ? <AlertTriangle className="h-3 w-3 text-amber-700 dark:text-amber-400" /> : null}
                      {!current ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-2xs text-red-700 hover:text-red-700 dark:text-red-400"
                          onClick={() => removeWorktree(worktree)}
                          disabled={operationLoading === `remove:${worktree.path}`}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          {t('workspace.git.actions.removeWorktree')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-md bg-surface-input p-0.5">
            {(['new', 'existing'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={cn(
                  'rounded px-2 py-1 text-2xs text-muted-foreground',
                  worktreeMode === mode && 'bg-black/5 text-foreground dark:bg-white/10',
                )}
                onClick={() => setWorktreeMode(mode)}
              >
                {mode === 'new' ? t('workspace.git.worktrees.newBranch') : t('workspace.git.worktrees.existingBranch')}
              </button>
            ))}
          </div>
          {worktreeMode === 'existing' ? (
            <Select value={worktreeBranch} onValueChange={setWorktreeBranch}>
              <SelectTrigger size="sm" className="mt-2 bg-surface-input text-xs">
                <SelectValue placeholder={t('workspace.git.worktrees.selectBranch')} />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.name} value={branch.name}>{branch.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <>
              <Input
                value={worktreeBranch}
                onChange={(event) => setWorktreeBranch(event.target.value)}
                placeholder={t('workspace.git.branchWorktree.worktreePlaceholder')}
                className="mt-2 h-8 bg-surface-input text-xs"
              />
              <Input
                value={worktreeStartPoint}
                onChange={(event) => setWorktreeStartPoint(event.target.value)}
                placeholder={t('workspace.git.worktrees.startPointPlaceholder')}
                className="mt-1.5 h-8 bg-surface-input text-xs"
              />
            </>
          )}
          <Button type="button" size="sm" className="mt-2 h-7 w-full text-xs" onClick={addWorktree} disabled={!worktreeBranch.trim() || operationLoading === 'worktreeAdd'}>
            {operationLoading === 'worktreeAdd' ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <GitCompareArrows className="mr-1.5 h-3 w-3" />}
            {t('workspace.git.actions.addWorktree')}
          </Button>
        </section>

        <section className="min-w-0 rounded-md border border-black/10 bg-background p-2 dark:border-white/10">
          <PanelTitle icon={<GitCommitHorizontal className="h-3.5 w-3.5" />} title={t('workspace.git.commit.title')} />
          <Textarea
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder={t('workspace.git.commit.placeholder')}
            className="mt-2 h-16 resize-none bg-surface-input text-xs"
          />
          <Button type="button" size="sm" className="mt-2 h-7 w-full text-xs" onClick={commit} disabled={!commitMessage.trim() || operationLoading === 'commit'}>
            {operationLoading === 'commit' ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
            {t('workspace.git.actions.commit')}
          </Button>
        </section>

        <section className="min-w-0 rounded-md border border-black/10 bg-background p-2 dark:border-white/10">
          <PanelTitle icon={<GitBranch className="h-3.5 w-3.5" />} title={t('workspace.git.branch.title')} />
          <Input
            value={branchName}
            onChange={(event) => setBranchName(event.target.value)}
            placeholder={t('workspace.git.branchWorktree.branchPlaceholder')}
            className="mt-2 h-8 bg-surface-input text-xs"
          />
          <Button type="button" variant="outline" size="sm" className="mt-2 h-7 w-full bg-surface-input text-xs" onClick={createBranch} disabled={!branchName.trim() || operationLoading === 'branch'}>
            {t('workspace.git.actions.createBranch')}
          </Button>
        </section>

        <section className="min-w-0 rounded-md border border-black/10 bg-background p-2 dark:border-white/10">
          <PanelTitle icon={<GitPullRequest className="h-3.5 w-3.5" />} title={t('workspace.git.github.title')} />
          {!githubAuth?.authenticated ? (
            <p className="mt-2 rounded-md bg-surface-input p-2 text-2xs text-muted-foreground">
              {t('workspace.git.github.notAuthenticated')}
            </p>
          ) : (
            <div className="mt-2 max-h-16 space-y-1 overflow-y-auto">
              {pullRequests.length === 0 ? (
                <p className="text-2xs text-muted-foreground">{t('workspace.git.github.noPrs')}</p>
              ) : pullRequests.map((pr) => (
                <div key={pr.number} className="truncate rounded bg-surface-input px-2 py-1 text-2xs text-foreground">
                  #{pr.number} {pr.title}
                </div>
              ))}
            </div>
          )}
          <Input
            value={prTitle}
            onChange={(event) => setPrTitle(event.target.value)}
            placeholder={t('workspace.git.github.titlePlaceholder')}
            className="mt-2 h-8 bg-surface-input text-xs"
            disabled={!githubAuth?.authenticated}
          />
          <Textarea
            value={prBody}
            onChange={(event) => setPrBody(event.target.value)}
            placeholder={t('workspace.git.github.bodyPlaceholder')}
            className="mt-1.5 h-12 resize-none bg-surface-input text-xs"
            disabled={!githubAuth?.authenticated}
          />
          <Button type="button" variant="outline" size="sm" className="mt-2 h-7 w-full bg-surface-input text-xs" onClick={createPr} disabled={!githubAuth?.authenticated || !prTitle.trim() || operationLoading === 'prCreate'}>
            <GitPullRequestCreate className="mr-1.5 h-3 w-3" />
            {t('workspace.git.actions.createPr')}
          </Button>
        </section>
        </div>
      </div>
    </div>
    <ConfirmDialog
      open={Boolean(revertPath)}
      title={t('workspace.git.revertConfirm.title')}
      message={t('workspace.git.revertConfirm.message', { path: revertPath ?? '' })}
      confirmLabel={t('workspace.git.revertConfirm.confirm')}
      cancelLabel={t('workspace.git.revertConfirm.cancel')}
      variant="destructive"
      onConfirm={() => {
        const path = revertPath;
        setRevertPath(null);
        if (path) revertSelected(path);
      }}
      onCancel={() => setRevertPath(null)}
    />
    </>
  );
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
      <span className="text-muted-foreground">{icon}</span>
      {title}
    </p>
  );
}
