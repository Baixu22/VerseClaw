import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  GitPullRequestCreate,
  GitCompareArrows,
  HardDrive,
  Loader2,
  PanelRightOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CommitSummary, type CommitOperationState } from '@/components/ai-elements/commit';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import { basenameFromPath, compactCommit, defaultWorktreeTargetPath, formatRelativeTime, pathEquals } from '@/lib/git-ui';
import { useWorkspacesStore } from '@/stores/workspaces';
import type {
  GitBranch as GitBranchInfo,
  GitChangeBucket,
  GitCommitInfo,
  GitDiffMode,
  GitDiffResult,
  GitFileChange,
  GitOperationResult,
  GitRepositoryStatus,
  GitStashEntry,
  GitWorktree,
  GithubAuthStatus,
  GithubRepository,
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

type LastGitOperation = {
  action: string;
  state: CommitOperationState;
  detail?: string | null;
};

type WorktreeMode = 'new' | 'existing';
type ToolPanel = 'worktrees' | 'commit' | 'branch' | 'stash' | 'github';
const CHANGE_GROUPS: GitChangeBucket[] = ['conflicted', 'staged', 'unstaged', 'untracked'];

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

function formatChangeStats(change: GitFileChange): string | null {
  if (change.binary) return null;
  if (typeof change.additions !== 'number' && typeof change.deletions !== 'number') return null;
  const additions = typeof change.additions === 'number' ? change.additions : 0;
  const deletions = typeof change.deletions === 'number' ? change.deletions : 0;
  return `+${additions} -${deletions}`;
}

function sumKnownStats(changes: GitFileChange[], key: 'additions' | 'deletions'): number {
  return changes.reduce((total, change) => (
    typeof change[key] === 'number' ? total + change[key] : total
  ), 0);
}

export function WorkspaceGitPanel({
  selectedPath,
  diffMode: controlledDiffMode,
  onSelectedPathChange,
  onDiffModeChange,
}: WorkspaceGitPanelProps) {
  const { t, i18n } = useTranslation('chat');
  const [status, setStatus] = useState<GitRepositoryStatus | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [githubAuth, setGithubAuth] = useState<GithubAuthStatus | null>(null);
  const [githubRepo, setGithubRepo] = useState<GithubRepository | null>(null);
  const [pullRequests, setPullRequests] = useState<GithubPrSummary[]>([]);
  const [diff, setDiff] = useState<GitDiffResult | null>(null);
  const [internalSelectedPath, setInternalSelectedPath] = useState<string | null>(null);
  const [internalDiffMode, setInternalDiffMode] = useState<GitDiffMode>('unstaged');
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [operationLoading, setOperationLoading] = useState<string | null>(null);
  const [lastGitOperation, setLastGitOperation] = useState<LastGitOperation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRetry | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [branchName, setBranchName] = useState('');
  const [checkoutBranchName, setCheckoutBranchName] = useState('');
  const [worktreeMode, setWorktreeMode] = useState<WorktreeMode>('new');
  const [worktreeBranch, setWorktreeBranch] = useState('');
  const [worktreeStartPoint, setWorktreeStartPoint] = useState('');
  const [stashMessage, setStashMessage] = useState('');
  const [stashIncludeUntracked, setStashIncludeUntracked] = useState(false);
  const [activeToolPanel, setActiveToolPanel] = useState<ToolPanel>('worktrees');
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [prBase, setPrBase] = useState('');
  const [prHead, setPrHead] = useState('');
  const [prDraft, setPrDraft] = useState(false);
  const [revertPath, setRevertPath] = useState<string | null>(null);
  const [selectedLogBranch, setSelectedLogBranch] = useState<string | null>(null);
  const [branchCommits, setBranchCommits] = useState<GitCommitInfo[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [logMeta, setLogMeta] = useState<{ ref: string; ahead?: number; behind?: number } | null>(null);
  const createWorkspace = useWorkspacesStore((state) => state.createWorkspace);
  const switchWorkspace = useWorkspacesStore((state) => state.switchWorkspace);

  const changes = useMemo(() => status?.changes ?? [], [status?.changes]);
  const effectiveSelectedPath = selectedPath ?? internalSelectedPath ?? changes[0]?.path ?? null;
  const effectiveDiffMode = controlledDiffMode ?? internalDiffMode;
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
      const [statusResult, branchesResult, worktreesResult, stashesResult, authResult] = await Promise.all([
        hostApi.git.status(),
        hostApi.git.branches().catch(() => ({ branches: [] })),
        hostApi.git.worktrees().catch(() => ({ worktrees: [] })),
        hostApi.git.stashList().catch(() => ({ stashes: [] })),
        hostApi.git.githubAuthStatus().catch(() => null),
      ]);
      setStatus(statusResult.status);
      setBranches(branchesResult.branches ?? []);
      setWorktrees(worktreesResult.worktrees ?? []);
      setStashes(stashesResult.stashes ?? []);
      setGithubAuth(authResult);

      if (authResult?.authenticated) {
        const [repo, prs] = await Promise.all([
          hostApi.git.githubRepo().catch(() => ({ repository: null })),
          hostApi.git.prList({ state: 'open', limit: 8 }).catch(() => ({ pullRequests: [] })),
        ]);
        setGithubRepo(repo.repository ?? null);
        setPullRequests(prs.pullRequests ?? []);
      } else {
        setGithubRepo(null);
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
    if (!selectedPath && !internalSelectedPath && changes[0]?.path) {
      setInternalSelectedPath(changes[0].path);
      setInternalDiffMode(modeForChange(changes[0]));
      onSelectedPathChange?.(changes[0].path);
      onDiffModeChange?.(modeForChange(changes[0]));
    }
  }, [changes, internalSelectedPath, onDiffModeChange, onSelectedPathChange, selectedPath]);

  useEffect(() => {
    if (!effectiveSelectedPath || !status?.isRepository) {
      setDiff(null);
      return;
    }
    let disposed = false;
    setDiffLoading(true);
    hostApi.git.fileDiff({ path: effectiveSelectedPath, mode: effectiveDiffMode })
      .then((result) => {
        if (!disposed) setDiff(result);
      })
      .catch((err) => {
        if (!disposed) {
          setDiff({
            path: effectiveSelectedPath,
            mode: effectiveDiffMode,
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
  }, [effectiveDiffMode, effectiveSelectedPath, status?.isRepository]);

  const currentBranchName = status?.detached ? null : status?.branch ?? null;
  const effectiveLogRef = selectedLogBranch ?? currentBranchName ?? 'HEAD';
  const isCurrentLogRef = effectiveLogRef === 'HEAD' || effectiveLogRef === currentBranchName;

  useEffect(() => {
    if (!status?.isRepository) {
      setBranchCommits([]);
      setLogMeta(null);
      setCommitsError(null);
      return;
    }
    let disposed = false;
    setCommitsLoading(true);
    hostApi.git.log({ ref: effectiveLogRef, limit: 20 })
      .then((result) => {
        if (disposed) return;
        setBranchCommits(result.commits ?? []);
        setLogMeta({ ref: result.ref ?? effectiveLogRef, ahead: result.ahead, behind: result.behind });
        setCommitsError(result.success ? null : result.error ?? null);
      })
      .catch((err) => {
        if (disposed) return;
        setBranchCommits([]);
        setLogMeta(null);
        setCommitsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!disposed) setCommitsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [effectiveLogRef, status]);

  useEffect(() => {
    if (!prBase && githubRepo?.defaultBranch) {
      setPrBase(githubRepo.defaultBranch);
    }
    if (!prHead && status?.branch && !status.detached) {
      setPrHead(status.branch);
    }
  }, [githubRepo?.defaultBranch, prBase, prHead, status?.branch, status?.detached]);

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
    setLastGitOperation({ action, state: 'running', detail: null });
    setNotice(null);
    setPendingApproval(null);
    try {
      const result = await operation();
      if (result.success) {
        setLastGitOperation({
          action,
          state: 'success',
          detail: operationReason(result) ?? t('workspace.git.operation.completed'),
        });
        await refresh();
        return result;
      }
      if (result.blocked || result.approvalRequired) {
        setLastGitOperation({ action, state: 'blocked', detail: operationReason(result) });
        showBlocked(action, result, retry);
      } else {
        const reason = operationReason(result) ?? t('workspace.git.toast.failed');
        setLastGitOperation({ action, state: 'failed', detail: reason });
        setNotice(reason);
        toast.error(reason);
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLastGitOperation({ action, state: 'failed', detail: message });
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
    setLastGitOperation({ action: pendingApproval.action, state: 'running', detail: null });
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
        setLastGitOperation({
          action: pendingApproval.action,
          state: 'success',
          detail: operationReason(result) ?? t('workspace.git.operation.completed'),
        });
        setPendingApproval(null);
        setNotice(null);
        await refresh();
      } else if (result.blocked || result.approvalRequired) {
        setLastGitOperation({ action: pendingApproval.action, state: 'blocked', detail: operationReason(result) });
        showBlocked(pendingApproval.action, result, pendingApproval.retry);
      } else {
        const reason = operationReason(result) ?? t('workspace.git.toast.failed');
        setLastGitOperation({ action: pendingApproval.action, state: 'failed', detail: reason });
        setNotice(reason);
      }
    } catch {
      setLastGitOperation({ action: pendingApproval.action, state: 'failed', detail: t('workspace.git.toast.approvalFailed') });
      toast.error(t('workspace.git.toast.approvalFailed'));
    } finally {
      setOperationLoading(null);
    }
  }, [pendingApproval, refresh, showBlocked, t]);

  const selectChange = (change: GitFileChange) => {
    const nextMode = modeForChange(change);
    if (selectedPath === undefined) setInternalSelectedPath(change.path);
    if (controlledDiffMode === undefined) setInternalDiffMode(nextMode);
    onSelectedPathChange?.(change.path);
    onDiffModeChange?.(nextMode);
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

  const checkoutSelectedBranch = () => {
    const name = checkoutBranchName.trim();
    if (!name) return;
    void finishOperation(
      'checkoutBranch',
      t('workspace.git.actions.checkoutBranch'),
      () => hostApi.git.checkoutBranch({ name }),
      (approvalId) => hostApi.git.checkoutBranch({ name, approvalId }),
    ).then((result) => {
      if (result.success) setCheckoutBranchName('');
    });
  };

  const fetchRepository = () => {
    void finishOperation(
      'fetch',
      t('workspace.git.actions.fetch'),
      () => hostApi.git.fetch(),
      (approvalId) => hostApi.git.fetch({ approvalId }),
    );
  };

  const pullRepository = () => {
    void finishOperation(
      'pull',
      t('workspace.git.actions.pull'),
      () => hostApi.git.pull(),
      (approvalId) => hostApi.git.pull({ approvalId }),
    );
  };

  const pushRepository = () => {
    void finishOperation(
      'push',
      t('workspace.git.actions.push'),
      () => hostApi.git.push(),
      (approvalId) => hostApi.git.push({ approvalId }),
    );
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

  const openWorktree = async (worktree: GitWorktree) => {
    try {
      await hostApi.shell.openPath(worktree.path);
      toast.success(t('workspace.git.toast.worktreeOpened'));
    } catch (err) {
      toast.error(t('workspace.git.toast.worktreeOpenFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const switchWorktreeWorkspace = async (worktree: GitWorktree) => {
    const key = `switch:${worktree.path}`;
    setOperationLoading(key);
    setNotice(null);
    try {
      const snapshot = await hostApi.workspaces.list();
      const existingWorkspace = (snapshot.profiles ?? []).find((profile) => pathEquals(profile.rootPath, worktree.path));
      const detail = existingWorkspace
        ? t('workspace.git.toast.worktreeWorkspaceSwitched')
        : t('workspace.git.toast.worktreeWorkspaceCreated');
      if (existingWorkspace) {
        await switchWorkspace(existingWorkspace.id);
      } else {
        await createWorkspace({ name: basenameFromPath(worktree.path), rootPath: worktree.path });
      }
      toast.success(detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(message);
      toast.error(t('workspace.git.toast.worktreeWorkspaceSwitchFailed', { error: message }));
    } finally {
      setOperationLoading(null);
    }
  };

  const pruneWorktrees = () => {
    void finishOperation(
      'prune',
      t('workspace.git.actions.pruneWorktrees'),
      () => hostApi.git.worktreePrune(),
      (approvalId) => hostApi.git.worktreePrune({ approvalId }),
    );
  };

  const stashChanges = () => {
    const message = stashMessage.trim();
    const payload = {
      ...(message ? { message } : {}),
      ...(stashIncludeUntracked ? { includeUntracked: true } : {}),
    };
    void finishOperation(
      'stashPush',
      t('workspace.git.actions.stashPush'),
      () => hostApi.git.stashPush(payload),
      (approvalId) => hostApi.git.stashPush({ ...payload, approvalId }),
    ).then((result) => {
      if (result.success) {
        setStashMessage('');
        setStashIncludeUntracked(false);
      }
    });
  };

  const applyStash = (stash: GitStashEntry) => {
    void finishOperation(
      `stashApply:${stash.selector}`,
      t('workspace.git.actions.stashApply'),
      () => hostApi.git.stashApply({ selector: stash.selector }),
      (approvalId) => hostApi.git.stashApply({ selector: stash.selector, approvalId }),
    );
  };

  const popStash = (stash: GitStashEntry) => {
    void finishOperation(
      `stashPop:${stash.selector}`,
      t('workspace.git.actions.stashPop'),
      () => hostApi.git.stashPop({ selector: stash.selector }),
      (approvalId) => hostApi.git.stashPop({ selector: stash.selector, approvalId }),
    );
  };

  const createPr = () => {
    const title = prTitle.trim();
    const base = prBase.trim();
    const head = prHead.trim();
    if (!title || !base || !head) return;
    const body = prBody.trim();
    const payload = { title, body, base, head, draft: prDraft };
    void finishOperation(
      'prCreate',
      t('workspace.git.actions.createPr'),
      () => hostApi.git.prCreate(payload),
      (approvalId) => hostApi.git.prCreate({ ...payload, approvalId }),
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
  const totalAdditions = sumKnownStats(changes, 'additions');
  const totalDeletions = sumKnownStats(changes, 'deletions');
  const hasKnownStats = changes.some((change) => typeof change.additions === 'number' || typeof change.deletions === 'number');
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
  const githubReady = Boolean(githubAuth?.authenticated);
  const worktreeTargetPreview = defaultWorktreeTargetPath(status?.repoRoot || status?.workspaceRoot, worktreeBranch);
  const normalizedWorktreeBranch = worktreeBranch.trim();
  const selectedWorktreeBranch = normalizedWorktreeBranch
    ? worktrees.find((worktree) => worktree.branch === normalizedWorktreeBranch)
    : undefined;
  const newWorktreeBranchExists = worktreeMode === 'new'
    && Boolean(normalizedWorktreeBranch)
    && branches.some((branch) => branch.name === normalizedWorktreeBranch);
  const worktreeBlockedReason = newWorktreeBranchExists
    ? t('workspace.git.worktrees.branchExists')
    : selectedWorktreeBranch
      ? t('workspace.git.worktrees.branchCheckedOut', { path: selectedWorktreeBranch.path })
      : null;
  const canAddWorktree = Boolean(normalizedWorktreeBranch)
    && !worktreeBlockedReason
    && operationLoading !== 'worktreeAdd';
  const canStashChanges = totalChanges > 0 && operationLoading !== 'stashPush';
  const canCreatePr = Boolean(githubAuth?.authenticated)
    && Boolean(prTitle.trim())
    && Boolean(prBase.trim())
    && Boolean(prHead.trim())
    && operationLoading !== 'prCreate';
  const commitOperation = operationLoading === 'commit'
    ? { action: t('workspace.git.actions.commit'), state: 'running' as CommitOperationState, detail: null }
    : lastGitOperation ?? { state: 'ready' as CommitOperationState, detail: t('workspace.git.operation.empty') };
  const toolTabs: Array<{ id: ToolPanel; label: string }> = [
    { id: 'worktrees', label: t('workspace.git.toolTabs.worktrees') },
    { id: 'commit', label: t('workspace.git.toolTabs.commit') },
    { id: 'branch', label: t('workspace.git.toolTabs.branch') },
    { id: 'stash', label: t('workspace.git.toolTabs.stash') },
    { id: 'github', label: t('workspace.git.toolTabs.github') },
  ];
  return (
    <>
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="workspace-git-panel">
      {/* Single slim header — branch + key stats inline */}
      <div className="shrink-0 border-b border-black/5 bg-surface-modal px-3 py-2 dark:border-white/10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium text-foreground">
              {status?.detached ? t('workspace.git.detached') : status?.branch || t('workspace.git.loading')}
            </span>
            <Badge variant={stateVariant} className="shrink-0 px-1.5 py-0 text-2xs">{stateLabel}</Badge>
            {totalChanges > 0 && (
              <span className="shrink-0 text-2xs text-muted-foreground">
                {totalChanges} {t('artifactPanel.tabs.changes')}
              </span>
            )}
            {hasKnownStats && (
              <span className="shrink-0 font-mono text-2xs">
                <span className="text-green-700 dark:text-green-400">+{totalAdditions}</span>
                <span className="ml-1 text-red-700 dark:text-red-400">-{totalDeletions}</span>
              </span>
            )}
            {(status?.ahead ?? 0) > 0 || (status?.behind ?? 0) > 0 ? (
              <span className="shrink-0 text-2xs text-muted-foreground">
                ↑{status?.ahead ?? 0} ↓{status?.behind ?? 0}
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => void refresh()}
            disabled={loading}
            title={t('workspace.git.actions.refresh')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
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

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 min-[980px]:grid-cols-[minmax(220px,0.38fr)_minmax(360px,0.62fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-md border border-black/[0.07] bg-surface-modal dark:border-white/[0.09]">
          {/* Status — working tree changes */}
          <div className="flex min-h-0 flex-[1.15] flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-black/[0.07] px-3 py-1.5 dark:border-white/[0.09]">
              <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('artifactPanel.tabs.changes')}</span>
              <Badge variant="outline" className="px-1.5 py-0 text-2xs">{totalChanges}</Badge>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && changes.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  {t('workspace.git.loading')}
                </div>
              ) : changes.length === 0 ? (
                <div className="flex h-24 items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-green-700 dark:text-green-400" />
                  {t('workspace.git.clean')}
                </div>
              ) : (
                <div className="divide-y divide-black/[0.07] dark:divide-white/[0.09]">
                  {groupedChanges.map((group) => (
                    <div key={group.bucket}>
                      <div className="sticky top-0 z-10 bg-surface-modal/95 px-3 py-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground/70 backdrop-blur">
                        {t(`workspace.git.groups.${group.bucket}`, { count: group.changes.length })}
                      </div>
                      <div className="space-y-0.5 px-1.5 pb-1.5">
                        {group.changes.length === 0 ? (
                          <p className="px-2 py-1.5 text-2xs text-muted-foreground">
                            {t('workspace.git.groups.empty')}
                          </p>
                        ) : group.changes.map((change) => {
                          const badge = changeBadge(change);
                          const changeStats = formatChangeStats(change);
                          return (
                            <button
                              key={`${change.bucket}:${change.path}`}
                              type="button"
                              className={cn(
                                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                                effectiveSelectedPath === change.path && 'bg-black/5 dark:bg-white/10',
                              )}
                              onClick={() => selectChange(change)}
                            >
                              <span className="min-w-0 flex-1 truncate font-mono text-foreground">{change.path}</span>
                              {changeStats ? (
                                <span className="shrink-0 font-mono text-2xs text-muted-foreground">{changeStats}</span>
                              ) : null}
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
          </div>

          {/* Branches — click a branch to inspect its history */}
          <div className="flex min-h-0 flex-none flex-col border-t border-black/[0.07] dark:border-white/[0.09]" data-testid="workspace-git-branches">
            <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
              <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('workspace.git.branches.title', 'Branches')}</span>
              <Badge variant="outline" className="px-1.5 py-0 text-2xs">{branches.length}</Badge>
            </div>
            <div className="max-h-[128px] min-h-0 overflow-y-auto px-1.5 pb-1.5">
              {branches.length === 0 ? (
                <p className="px-2 py-1 text-2xs text-muted-foreground">{t('workspace.git.branches.empty', 'No local branches')}</p>
              ) : branches.map((branch) => {
                const isSelected = branch.name === effectiveLogRef;
                return (
                  <button
                    key={branch.name}
                    type="button"
                    data-testid="workspace-git-branch-row"
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                      isSelected && 'bg-black/5 dark:bg-white/10',
                    )}
                    onClick={() => setSelectedLogBranch(branch.name)}
                    title={branch.upstream ? `${branch.name} → ${branch.upstream}` : branch.name}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        branch.current
                          ? 'bg-blue-500 dark:bg-blue-400'
                          : 'bg-transparent ring-1 ring-inset ring-black/20 dark:ring-white/25',
                      )}
                      aria-hidden
                    />
                    <span className={cn('min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground', branch.current && 'font-medium')}>
                      {branch.name}
                    </span>
                    {branch.commit ? (
                      <span className="shrink-0 rounded border border-black/[0.07] bg-black/[0.03] px-1 font-mono text-2xs leading-4 text-muted-foreground dark:border-white/[0.09] dark:bg-white/[0.06]">
                        {compactCommit(branch.commit)}
                      </span>
                    ) : null}
                    {branch.updatedAt ? (
                      <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{formatRelativeTime(branch.updatedAt, i18n.language)}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Commits — history of the selected branch */}
          <div className="flex min-h-0 flex-1 flex-col border-t border-black/[0.07] dark:border-white/[0.09]" data-testid="workspace-git-commits">
            <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
              <span className="min-w-0 truncate text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('workspace.git.commits.title', 'Commits')}
                {effectiveLogRef !== 'HEAD' ? <span className="ml-1.5 font-mono normal-case tracking-normal text-muted-foreground/80">{effectiveLogRef}</span> : null}
              </span>
              {logMeta && logMeta.ref !== 'HEAD' && !isCurrentLogRef && (typeof logMeta.ahead === 'number' || typeof logMeta.behind === 'number') ? (
                <span className="shrink-0 text-2xs tabular-nums text-muted-foreground" title={t('workspace.git.commits.aheadBehind', 'Ahead / behind current branch')}>
                  ↑{logMeta.ahead ?? 0} ↓{logMeta.behind ?? 0}
                </span>
              ) : null}
            </div>
            <div className="min-h-[96px] flex-1 overflow-y-auto px-1.5 pb-2">
              {commitsLoading && branchCommits.length === 0 ? (
                <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  {t('workspace.git.loading')}
                </div>
              ) : commitsError ? (
                <p className="px-2 py-1.5 text-2xs text-muted-foreground">{commitsError}</p>
              ) : branchCommits.length === 0 ? (
                <p className="px-2 py-1.5 text-2xs text-muted-foreground">{t('workspace.git.commits.empty', 'No commits')}</p>
              ) : branchCommits.map((commit) => (
                <div
                  key={commit.hash}
                  data-testid="workspace-git-commit-row"
                  className="flex items-center gap-2 rounded px-2 py-1 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                >
                  <span className="shrink-0 rounded border border-black/[0.07] bg-black/[0.03] px-1 font-mono text-2xs leading-4 text-muted-foreground dark:border-white/[0.09] dark:bg-white/[0.06]">
                    {commit.shortHash}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground" title={commit.subject}>
                    {commit.subject}
                  </span>
                  {commit.author ? (
                    <span className="max-w-[88px] shrink-0 truncate text-2xs text-muted-foreground">{commit.author}</span>
                  ) : null}
                  <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{formatRelativeTime(commit.date, i18n.language)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-md border border-black/10 bg-[#0d1117] text-slate-100 dark:border-white/10">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-slate-100">{effectiveSelectedPath || t('workspace.git.diff.empty')}</p>
              <p className="mt-0.5 text-2xs text-slate-400">
                {effectiveDiffMode === 'staged' ? t('workspace.git.diff.staged') : t('workspace.git.diff.unstaged')}
              </p>
            </div>
            <div className="inline-flex shrink-0 rounded-md border border-white/10 bg-white/5 p-0.5">
              {(['unstaged', 'staged'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={cn(
                    'rounded px-2 py-1 text-2xs text-slate-400',
                    effectiveDiffMode === mode && 'bg-white/10 text-white',
                  )}
                  onClick={() => {
                    if (controlledDiffMode === undefined) setInternalDiffMode(mode);
                    onDiffModeChange?.(mode);
                  }}
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
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-white/10 px-3 py-1.5">
            <Button type="button" size="sm" className="h-7 text-2xs" onClick={stageSelected} disabled={!canStage || operationLoading === 'stage'}>
              {operationLoading === 'stage' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
              {t('workspace.git.actions.stage')}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7 border-white/10 bg-white/5 text-2xs text-slate-100 hover:bg-white/10" onClick={unstageSelected} disabled={!canUnstage || operationLoading === 'unstage'}>
              {t('workspace.git.actions.unstage')}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7 border-white/10 bg-white/5 text-2xs text-slate-100 hover:bg-white/10" onClick={() => void copyPatch()} disabled={!canCopyPatch}>
              <ClipboardCopy className="mr-1 h-3 w-3" />
              {t('workspace.git.actions.copyPatch')}
            </Button>
            <Button type="button" variant="destructive" size="sm" className="h-7 text-2xs" onClick={() => setRevertPath(effectiveSelectedPath)} disabled={!canRevert || operationLoading === 'revert'}>
              {operationLoading === 'revert' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
              {t('workspace.git.actions.revert')}
            </Button>
          </div>
        </section>
      </div>

      {/* Collapsible tool drawer — collapsed by default to avoid clutter */}
      <div className="shrink-0 border-t border-black/5 bg-surface-modal dark:border-white/10">
        <details className="group" data-testid="workspace-git-tool-drawer">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <PanelRightOpen className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
              <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{t('workspace.git.toolTabs.worktrees')}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {worktrees.length > 0 && <Badge variant="outline" className="px-1.5 py-0 text-2xs">{worktrees.length}</Badge>}
              {stashes.length > 0 && <Badge variant="outline" className="px-1.5 py-0 text-2xs">{stashes.length}</Badge>}
              {githubReady && <Badge variant="success" className="px-1.5 py-0 text-2xs">GH</Badge>}
            </div>
          </summary>
          <div className="border-t border-black/5 p-2 dark:border-white/10">
            <div className="flex min-w-0 items-center gap-0.5 rounded-md bg-surface-input p-0.5" data-testid="workspace-git-tool-tabs">
              {toolTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={cn(
                    'h-6 shrink-0 rounded px-2.5 text-2xs text-muted-foreground',
                    activeToolPanel === tab.id && 'bg-background text-foreground shadow-sm dark:bg-white/10',
                  )}
                  onClick={() => setActiveToolPanel(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="mt-2 max-h-[220px] overflow-y-auto pr-1">
          {activeToolPanel === 'worktrees' ? (
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
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-[120px] flex-1">
                          <p className="truncate font-mono text-2xs text-foreground">{basenameFromPath(worktree.path)}</p>
                          <p className="truncate text-2xs text-muted-foreground">{worktree.branch || compactCommit(worktree.head)}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {current ? <Badge variant="success" className="px-1.5 py-0 text-2xs">{t('workspace.git.worktrees.current')}</Badge> : null}
                          {worktree.locked ? (
                            <Badge variant="warning" className="gap-1 px-1.5 py-0 text-2xs">
                              <AlertTriangle className="h-3 w-3" />
                              {t('workspace.git.worktrees.locked')}
                            </Badge>
                          ) : null}
                          {worktree.prunable ? <Badge variant="outline" className="px-1.5 py-0 text-2xs">{t('workspace.git.worktrees.prunable')}</Badge> : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-2xs"
                            onClick={() => void openWorktree(worktree)}
                          >
                            <FolderOpen className="mr-1 h-3 w-3" />
                            {t('workspace.git.actions.openWorktree')}
                          </Button>
                          {!current ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-2xs"
                              onClick={() => void switchWorktreeWorkspace(worktree)}
                              disabled={operationLoading === `switch:${worktree.path}`}
                            >
                              {operationLoading === `switch:${worktree.path}` ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <PanelRightOpen className="mr-1 h-3 w-3" />
                              )}
                              {t('workspace.git.actions.switchWorktree')}
                            </Button>
                          ) : null}
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
              <div className="mt-2 rounded-md border border-black/5 bg-surface-input px-2 py-1.5 text-2xs dark:border-white/10" data-testid="workspace-git-worktree-target">
                <p className="font-medium text-muted-foreground">{t('workspace.git.worktrees.defaultPath')}</p>
                <p className="mt-0.5 truncate font-mono text-foreground">
                  {worktreeTargetPreview || t('workspace.git.worktrees.defaultPathUnavailable')}
                </p>
              </div>
              {worktreeBlockedReason ? (
                <p className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-2xs text-amber-800 dark:text-amber-300">
                  {worktreeBlockedReason}
                </p>
              ) : null}
              <Button type="button" size="sm" className="mt-2 h-7 w-full text-xs" onClick={addWorktree} disabled={!canAddWorktree}>
                {operationLoading === 'worktreeAdd' ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <GitCompareArrows className="mr-1.5 h-3 w-3" />}
                {t('workspace.git.actions.addWorktree')}
              </Button>
            </section>
          ) : null}

          {activeToolPanel === 'commit' ? (
            <section className="min-w-0" data-testid="workspace-git-commit-panel">
              <CommitSummary
                staged={status?.stagedCount ?? changes.filter((change) => change.staged).length}
                unstaged={status?.unstagedCount ?? changes.filter((change) => change.unstaged).length}
                untracked={status?.untrackedCount ?? changes.filter((change) => change.untracked).length}
                conflicted={status?.conflictedCount ?? changes.filter((change) => change.conflicted).length}
                additions={totalAdditions}
                deletions={totalDeletions}
                branch={status?.detached ? t('workspace.git.detached') : status?.branch}
                operation={commitOperation}
              >
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
              </CommitSummary>
            </section>
          ) : null}

          {activeToolPanel === 'branch' ? (
            <section className="min-w-0 rounded-md border border-black/10 bg-background p-2 dark:border-white/10">
              <PanelTitle icon={<GitBranch className="h-3.5 w-3.5" />} title={t('workspace.git.branch.title')} />
              <div className="mt-2 rounded-md border border-black/5 bg-surface-input p-2 dark:border-white/10">
                <p className="text-2xs font-medium uppercase tracking-normal text-muted-foreground">
                  {t('workspace.git.branch.checkoutTitle')}
                </p>
                <div className="mt-1.5 flex min-w-0 gap-2">
                  <Select value={checkoutBranchName} onValueChange={setCheckoutBranchName}>
                    <SelectTrigger size="sm" aria-label={t('workspace.git.branch.checkoutSelect')} className="min-w-0 flex-1 bg-background text-xs dark:bg-white/5">
                      <SelectValue placeholder={t('workspace.git.branch.checkoutSelect')} />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem key={branch.name} value={branch.name}>
                          {branch.current ? `${branch.name} (${t('workspace.git.branch.current')})` : branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0 text-xs"
                    onClick={checkoutSelectedBranch}
                    disabled={!checkoutBranchName.trim() || operationLoading === 'checkoutBranch'}
                  >
                    {operationLoading === 'checkoutBranch' ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                    {t('workspace.git.actions.checkoutBranch')}
                  </Button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <Button type="button" variant="outline" size="sm" className="h-7 bg-surface-input text-xs" onClick={fetchRepository} disabled={operationLoading === 'fetch'}>
                  {operationLoading === 'fetch' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                  {t('workspace.git.actions.fetch')}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 bg-surface-input text-xs" onClick={pullRepository} disabled={operationLoading === 'pull'}>
                  {operationLoading === 'pull' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
                  {t('workspace.git.actions.pull')}
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 bg-surface-input text-xs" onClick={pushRepository} disabled={operationLoading === 'push'}>
                  {operationLoading === 'push' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Upload className="mr-1 h-3 w-3" />}
                  {t('workspace.git.actions.push')}
                </Button>
              </div>
              <div className="mt-2 rounded-md border border-black/5 bg-surface-input p-2 dark:border-white/10">
                <p className="text-2xs font-medium uppercase tracking-normal text-muted-foreground">
                  {t('workspace.git.branch.createTitle')}
                </p>
              <Input
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                placeholder={t('workspace.git.branchWorktree.branchPlaceholder')}
                  className="mt-1.5 h-8 bg-background text-xs dark:bg-white/5"
              />
              <Button type="button" variant="outline" size="sm" className="mt-2 h-7 w-full bg-surface-input text-xs" onClick={createBranch} disabled={!branchName.trim() || operationLoading === 'branch'}>
                {t('workspace.git.actions.createBranch')}
              </Button>
              </div>
            </section>
          ) : null}

          {activeToolPanel === 'stash' ? (
            <section className="min-w-0 rounded-md border border-black/10 bg-background p-2 dark:border-white/10" data-testid="workspace-git-stash-panel">
              <div className="flex items-center justify-between gap-2">
                <PanelTitle icon={<Archive className="h-3.5 w-3.5" />} title={t('workspace.git.stash.title')} />
                <Badge variant="outline" className="text-2xs">
                  {t('workspace.git.stash.count', { count: stashes.length })}
                </Badge>
              </div>
              <div className="mt-2 max-h-24 space-y-1 overflow-y-auto rounded-md border border-black/5 bg-surface-input p-1 dark:border-white/10">
                {stashes.length === 0 ? (
                  <p className="px-1 py-1 text-2xs text-muted-foreground">{t('workspace.git.stash.empty')}</p>
                ) : stashes.map((stash) => (
                  <div key={stash.selector} className="rounded bg-background px-2 py-1 dark:bg-white/5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-[140px] flex-1">
                        <p className="truncate text-2xs font-medium text-foreground">{stash.message}</p>
                        <p className="truncate font-mono text-2xs text-muted-foreground">
                          {stash.selector}
                          {stash.branch ? ` - ${stash.branch}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-2xs"
                          aria-label={t('workspace.git.stash.applyLabel', { selector: stash.selector })}
                          onClick={() => applyStash(stash)}
                          disabled={operationLoading === `stashApply:${stash.selector}`}
                        >
                          {operationLoading === `stashApply:${stash.selector}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                          {t('workspace.git.actions.stashApply')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-2xs text-amber-700 hover:text-amber-700 dark:text-amber-400"
                          aria-label={t('workspace.git.stash.popLabel', { selector: stash.selector })}
                          onClick={() => popStash(stash)}
                          disabled={operationLoading === `stashPop:${stash.selector}`}
                        >
                          {operationLoading === `stashPop:${stash.selector}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                          {t('workspace.git.actions.stashPop')}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 rounded-md border border-black/5 bg-surface-input p-2 dark:border-white/10">
                <Input
                  value={stashMessage}
                  onChange={(event) => setStashMessage(event.target.value)}
                  placeholder={t('workspace.git.stash.messagePlaceholder')}
                  className="h-8 bg-background text-xs dark:bg-white/5"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-2xs font-medium text-foreground">{t('workspace.git.stash.includeUntrackedLabel')}</p>
                    <p className="truncate text-2xs text-muted-foreground">{t('workspace.git.stash.includeUntrackedHelp')}</p>
                  </div>
                  <Switch
                    checked={stashIncludeUntracked}
                    onCheckedChange={setStashIncludeUntracked}
                    aria-label={t('workspace.git.stash.includeUntrackedLabel')}
                  />
                </div>
              </div>
              <Button type="button" size="sm" className="mt-2 h-7 w-full text-xs" onClick={stashChanges} disabled={!canStashChanges}>
                {operationLoading === 'stashPush' ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Archive className="mr-1.5 h-3 w-3" />}
                {t('workspace.git.actions.stashPush')}
              </Button>
            </section>
          ) : null}

          {activeToolPanel === 'github' ? (
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
                    <div key={pr.number} className="rounded bg-surface-input px-2 py-1 text-2xs text-foreground">
                      <p className="truncate">#{pr.number} {pr.title}</p>
                      <p className="truncate text-muted-foreground">
                        {t('workspace.git.github.prRefs', {
                          head: pr.headRefName || t('workspace.git.metrics.unknown'),
                          base: pr.baseRefName || t('workspace.git.metrics.unknown'),
                        })}
                      </p>
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
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <Input
                  value={prBase}
                  onChange={(event) => setPrBase(event.target.value)}
                  placeholder={t('workspace.git.github.basePlaceholder')}
                  aria-label={t('workspace.git.github.baseLabel')}
                  className="h-8 bg-surface-input text-xs"
                  disabled={!githubAuth?.authenticated}
                />
                <Input
                  value={prHead}
                  onChange={(event) => setPrHead(event.target.value)}
                  placeholder={t('workspace.git.github.headPlaceholder')}
                  aria-label={t('workspace.git.github.headLabel')}
                  className="h-8 bg-surface-input text-xs"
                  disabled={!githubAuth?.authenticated}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-black/5 bg-surface-input px-2 py-1.5 dark:border-white/10">
                <div className="min-w-0">
                  <p className="text-2xs font-medium text-foreground">{t('workspace.git.github.draftLabel')}</p>
                  <p className="truncate text-2xs text-muted-foreground">{t('workspace.git.github.draftHelp')}</p>
                </div>
                <Switch
                  checked={prDraft}
                  onCheckedChange={setPrDraft}
                  aria-label={t('workspace.git.github.draftLabel')}
                  disabled={!githubAuth?.authenticated}
                />
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-2 h-7 w-full bg-surface-input text-xs" onClick={createPr} disabled={!canCreatePr}>
                {operationLoading === 'prCreate' ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <GitPullRequestCreate className="mr-1.5 h-3 w-3" />}
                {t('workspace.git.actions.createPr')}
              </Button>
            </section>
          ) : null}
            </div>
          </div>
        </details>
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
