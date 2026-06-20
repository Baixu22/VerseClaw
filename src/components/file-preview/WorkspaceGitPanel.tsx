import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch, GitCommit, GitPullRequest, GitPullRequestCreate, GitMerge, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import type { GitDiffMode, GitFileChange, GitRepositoryStatus, GithubPrSummary } from '@shared/types/git';

type WorkspaceGitPanelProps = {
  selectedPath?: string | null;
  diffMode?: GitDiffMode;
  onSelectedPathChange?: (path: string | null) => void;
  onDiffModeChange?: (mode: GitDiffMode) => void;
};

type LoadState = {
  status: GitRepositoryStatus | null;
  diff: string;
  pullRequests: GithubPrSummary[];
  ghAuthenticated: boolean;
  loading: boolean;
  error: string | null;
};

const initialState: LoadState = {
  status: null,
  diff: '',
  pullRequests: [],
  ghAuthenticated: false,
  loading: false,
  error: null,
};

function changeTone(change: GitFileChange): string {
  if (change.conflicted) return 'destructive';
  if (change.untracked) return 'warning';
  if (change.staged) return 'success';
  return 'secondary';
}

function shortStatus(change: GitFileChange): string {
  if (change.conflicted) return '!';
  if (change.untracked) return '?';
  if (change.staged) return '+';
  return '~';
}

function prLabel(pr: GithubPrSummary): string {
  return `#${pr.number} ${pr.title}`;
}

export function WorkspaceGitPanel({
  selectedPath,
  diffMode = 'unstaged',
  onSelectedPathChange,
  onDiffModeChange,
}: WorkspaceGitPanelProps) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState<LoadState>(initialState);
  const [commitMessage, setCommitMessage] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [worktreeBranch, setWorktreeBranch] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');

  const selectedChange = useMemo(() => (
    state.status?.changes.find((change) => change.path === selectedPath) ?? null
  ), [selectedPath, state.status?.changes]);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [statusResult, authResult] = await Promise.all([
        hostApi.git.status(),
        hostApi.git.githubAuthStatus().catch(() => null),
      ]);
      const nextStatus = statusResult.status;
      const nextSelected = selectedPath && nextStatus.changes.some((change) => change.path === selectedPath)
        ? selectedPath
        : nextStatus.changes[0]?.path ?? null;
      if (nextSelected !== selectedPath) onSelectedPathChange?.(nextSelected);
      const [diffResult, prsResult] = await Promise.all([
        nextSelected
          ? hostApi.git.fileDiff({ path: nextSelected, mode: diffMode }).catch(() => null)
          : Promise.resolve(null),
        authResult?.authenticated
          ? hostApi.git.prList({ state: 'open', limit: 20 }).catch(() => null)
          : Promise.resolve(null),
      ]);
      setState({
        status: nextStatus,
        diff: diffResult?.patch ?? '',
        pullRequests: prsResult?.pullRequests ?? [],
        ghAuthenticated: authResult?.authenticated === true,
        loading: false,
        error: null,
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [diffMode, onSelectedPathChange, selectedPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const runOperation = async (operation: () => Promise<{ success: boolean; blocked?: boolean; reason?: string; error?: string }>) => {
    try {
      const result = await operation();
      if (result.blocked) {
        toast.warning(result.reason ?? t('workspace.git.toast.blocked', 'Approval required'));
        return;
      }
      if (!result.success) {
        toast.error(result.error ?? t('workspace.git.toast.failed', 'Git operation failed'));
        return;
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const stageSelected = () => {
    if (!selectedChange) return;
    void runOperation(() => hostApi.git.stage({ paths: [selectedChange.path] }));
  };

  const unstageSelected = () => {
    if (!selectedChange) return;
    void runOperation(() => hostApi.git.unstage({ paths: [selectedChange.path] }));
  };

  const commit = () => {
    if (!commitMessage.trim()) return;
    void runOperation(async () => {
      const result = await hostApi.git.commit({ message: commitMessage.trim() });
      if (result.success) setCommitMessage('');
      return result;
    });
  };

  const createBranch = () => {
    if (!newBranch.trim()) return;
    void runOperation(async () => {
      const result = await hostApi.git.createBranch({ name: newBranch.trim(), checkout: true });
      if (result.success) setNewBranch('');
      return result;
    });
  };

  const addWorktree = () => {
    if (!worktreeBranch.trim()) return;
    void runOperation(async () => {
      const result = await hostApi.git.worktreeAdd({ branch: worktreeBranch.trim() });
      if (result.success) setWorktreeBranch('');
      return result;
    });
  };

  const createPr = () => {
    if (!prTitle.trim()) return;
    void runOperation(async () => {
      const result = await hostApi.git.prCreate({ title: prTitle.trim(), body: prBody });
      if (result.success) {
        setPrTitle('');
        setPrBody('');
      }
      return result;
    });
  };

  if (state.error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
        <GitBranch className="h-8 w-8" />
        <p>{state.error}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {t('workspace.git.actions.refresh', 'Refresh')}
        </Button>
      </div>
    );
  }

  const status = state.status;
  if (status && !status.isRepository) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
        <GitBranch className="h-8 w-8" />
        <p className="font-medium text-foreground">{t('workspace.git.empty.title', 'No Git repository')}</p>
        <p>{t('workspace.git.empty.body', 'The active workspace is not inside a Git repository.')}</p>
      </div>
    );
  }

  return (
    <div data-testid="workspace-git-panel" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="truncate text-sm font-medium text-foreground">
              {status?.branch ?? t('workspace.git.detached', 'Detached HEAD')}
            </p>
            {status?.upstream && <Badge variant="outline">{status.upstream}</Badge>}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {status
              ? t('workspace.git.summary', '{{count}} changes · ↑{{ahead}} ↓{{behind}}', {
                count: status.changes.length,
                ahead: status.ahead,
                behind: status.behind,
              })
              : t('workspace.git.loading', 'Loading Git status')}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => void load()}>
          <RefreshCw className={cn('h-4 w-4', state.loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(180px,34%)_1fr] overflow-hidden">
        <div className="min-h-0 overflow-y-auto border-r border-black/5 dark:border-white/10">
          {status?.changes.length ? (
            <div className="divide-y divide-black/5 dark:divide-white/10">
              {status.changes.map((change) => (
                <button
                  key={change.path}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-black/5 dark:hover:bg-white/10',
                    selectedPath === change.path && 'bg-black/5 dark:bg-white/10',
                  )}
                  onClick={() => onSelectedPathChange?.(change.path)}
                >
                  <Badge variant={changeTone(change) as never} className="h-5 min-w-5 justify-center px-1">
                    {shortStatus(change)}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate font-mono">{change.path}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
              {t('workspace.git.clean', 'Working tree clean')}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/5 px-3 py-2 dark:border-white/10">
            <div className="flex min-w-0 items-center gap-1">
              <Button type="button" variant={diffMode === 'unstaged' ? 'secondary' : 'ghost'} size="sm" className="h-7" onClick={() => onDiffModeChange?.('unstaged')}>
                {t('workspace.git.diff.unstaged', 'Unstaged')}
              </Button>
              <Button type="button" variant={diffMode === 'staged' ? 'secondary' : 'ghost'} size="sm" className="h-7" onClick={() => onDiffModeChange?.('staged')}>
                {t('workspace.git.diff.staged', 'Staged')}
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="sm" className="h-7" disabled={!selectedChange} onClick={stageSelected}>
                {t('workspace.git.actions.stage', 'Stage')}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7" disabled={!selectedChange} onClick={unstageSelected}>
                {t('workspace.git.actions.unstage', 'Unstage')}
              </Button>
            </div>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto bg-surface-input p-3 font-mono text-[11px] leading-relaxed text-foreground">
            {state.diff || t('workspace.git.diff.empty', 'No diff for the selected file.')}
          </pre>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-3 gap-3 border-t border-black/5 p-3 dark:border-white/10">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <GitCommit className="h-3.5 w-3.5" />
            {t('workspace.git.commit.title', 'Commit')}
          </div>
          <Textarea
            className="min-h-[58px] resize-none text-xs"
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder={t('workspace.git.commit.placeholder', 'Commit message')}
          />
          <Button type="button" size="sm" className="h-8 w-full" disabled={!commitMessage.trim()} onClick={commit}>
            {t('workspace.git.actions.commit', 'Commit staged changes')}
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <GitMerge className="h-3.5 w-3.5" />
            {t('workspace.git.branchWorktree.title', 'Branch & worktree')}
          </div>
          <Input className="h-8 text-xs" value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder={t('workspace.git.branchWorktree.branchPlaceholder', 'New branch')} />
          <Button type="button" size="sm" variant="outline" className="h-8 w-full" disabled={!newBranch.trim()} onClick={createBranch}>
            {t('workspace.git.actions.createBranch', 'Create branch')}
          </Button>
          <Input className="h-8 text-xs" value={worktreeBranch} onChange={(event) => setWorktreeBranch(event.target.value)} placeholder={t('workspace.git.branchWorktree.worktreePlaceholder', 'Branch for worktree')} />
          <Button type="button" size="sm" variant="outline" className="h-8 w-full" disabled={!worktreeBranch.trim()} onClick={addWorktree}>
            {t('workspace.git.actions.addWorktree', 'Add worktree')}
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <GitPullRequest className="h-3.5 w-3.5" />
            {t('workspace.git.github.title', 'GitHub PRs')}
          </div>
          {state.ghAuthenticated ? (
            <div className="max-h-20 overflow-y-auto rounded-md border border-black/10 dark:border-white/10">
              {state.pullRequests.length ? state.pullRequests.map((pr) => (
                <button
                  key={pr.number}
                  type="button"
                  className="block w-full truncate px-2 py-1.5 text-left text-[11px] hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => void hostApi.git.openPr({ number: pr.number })}
                >
                  {prLabel(pr)}
                </button>
              )) : (
                <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">{t('workspace.git.github.noPrs', 'No open pull requests')}</p>
              )}
            </div>
          ) : (
            <p className="rounded-md border border-black/10 px-2 py-3 text-[11px] text-muted-foreground dark:border-white/10">
              {t('workspace.git.github.notAuthenticated', 'Run gh auth login in the terminal to enable PR actions.')}
            </p>
          )}
          <Input className="h-8 text-xs" value={prTitle} onChange={(event) => setPrTitle(event.target.value)} placeholder={t('workspace.git.github.titlePlaceholder', 'PR title')} />
          <Textarea className="min-h-[44px] resize-none text-xs" value={prBody} onChange={(event) => setPrBody(event.target.value)} placeholder={t('workspace.git.github.bodyPlaceholder', 'PR body')} />
          <Button type="button" size="sm" variant="outline" className="h-8 w-full" disabled={!state.ghAuthenticated || !prTitle.trim()} onClick={createPr}>
            <GitPullRequestCreate className="mr-1.5 h-3.5 w-3.5" />
            {t('workspace.git.actions.createPr', 'Create PR')}
          </Button>
        </div>
      </div>
    </div>
  );
}
