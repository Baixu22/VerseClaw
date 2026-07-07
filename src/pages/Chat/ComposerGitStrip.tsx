import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  GitBranch,
  GitCompareArrows,
  HardDrive,
  Loader2,
  PanelRightOpen,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { hostApi } from '@/lib/host-api';
import { basenameFromPath, compactCommit, defaultWorktreeTargetPath, pathEquals } from '@/lib/git-ui';
import { cn } from '@/lib/utils';
import type { GitBranch as GitBranchInfo, GitOperationResult, GitRepositoryStatus, GitWorktree } from '@shared/types/git';
import type { WorkspaceProfile } from '@shared/types/workspace';

type ComposerGitStripProps = {
  workspace: WorkspaceProfile | null;
  disabled?: boolean;
  onOpenGitPanel: () => void;
  onSwitchWorktreeWorkspace: (worktree: GitWorktree) => Promise<void>;
};

type WorktreeMode = 'new' | 'existing';

function totalChangeCount(status: GitRepositoryStatus): number {
  return status.stagedCount + status.unstagedCount + status.untrackedCount + status.conflictedCount;
}

function operationReason(result: GitOperationResult): string | null {
  return result.reason || result.stderr || result.stdout || null;
}

function sanitizeTestId(value: string): string {
  return value.replace(/[^a-z0-9._/-]+/gi, '-');
}

export function ComposerGitStrip({ workspace, disabled = false, onOpenGitPanel, onSwitchWorktreeWorkspace }: ComposerGitStripProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<GitRepositoryStatus | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [branchSearch, setBranchSearch] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [newBranchStartPoint, setNewBranchStartPoint] = useState('');
  const [worktreeMode, setWorktreeMode] = useState<WorktreeMode>('new');
  const [worktreeBranch, setWorktreeBranch] = useState('');
  const [worktreeStartPoint, setWorktreeStartPoint] = useState('');
  const [operationLoading, setOperationLoading] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    if (!workspace?.id) {
      setStatus(null);
      setBranches([]);
      setWorktrees([]);
      return;
    }
    setLoading(true);
    try {
      const [statusResult, branchesResult, worktreesResult] = await Promise.all([
        hostApi.git.status(),
        hostApi.git.branches().catch(() => ({ branches: [] })),
        hostApi.git.worktrees().catch(() => ({ worktrees: [] })),
      ]);
      setStatus(statusResult.status?.isRepository ? statusResult.status : null);
      setBranches(branchesResult.branches ?? []);
      setWorktrees(worktreesResult.worktrees ?? []);
    } catch {
      setStatus(null);
      setBranches([]);
      setWorktrees([]);
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const currentWorktree = useMemo(
    () => worktrees.find((worktree) => pathEquals(worktree.path, status?.repoRoot) || pathEquals(worktree.path, status?.workspaceRoot)),
    [status?.repoRoot, status?.workspaceRoot, worktrees],
  );
  const filteredBranches = useMemo(() => {
    const query = branchSearch.trim().toLowerCase();
    return query ? branches.filter((branch) => branch.name.toLowerCase().includes(query)) : branches;
  }, [branchSearch, branches]);

  if (!status?.isRepository) return null;

  const normalizedWorktreeBranch = worktreeBranch.trim();
  const selectedWorktreeBranch = normalizedWorktreeBranch
    ? worktrees.find((worktree) => worktree.branch === normalizedWorktreeBranch)
    : undefined;
  const newWorktreeBranchExists = worktreeMode === 'new'
    && normalizedWorktreeBranch.length > 0
    && branches.some((branch) => branch.name === normalizedWorktreeBranch);
  const worktreeBlockedReason = newWorktreeBranchExists
    ? t('composer.git.branchExists')
    : selectedWorktreeBranch
      ? t('composer.git.branchCheckedOut', { path: selectedWorktreeBranch.path })
      : null;
  const worktreeTargetPreview = defaultWorktreeTargetPath(status.repoRoot || status.workspaceRoot, worktreeBranch);
  const canAddWorktree = Boolean(normalizedWorktreeBranch) && !worktreeBlockedReason && operationLoading !== 'worktreeAdd';
  const changeCount = totalChangeCount(status);
  const branchLabel = status.detached ? t('composer.git.detached') : status.branch || t('composer.git.unknownBranch');
  const stateLabel = status.hasConflicts
    ? t('composer.git.conflicts', { count: status.conflictedCount })
    : status.clean
      ? t('composer.git.clean')
      : t('composer.git.dirty', { count: changeCount });
  const stateTone = status.hasConflicts
    ? 'text-red-700 dark:text-red-400'
    : status.clean
      ? 'text-green-700 dark:text-green-400'
      : 'text-amber-700 dark:text-amber-400';

  const finishOperation = async (key: string, action: string, operation: () => Promise<GitOperationResult>) => {
    setOperationLoading(key);
    try {
      const result = await operation();
      if (!result.success) {
        const reason = operationReason(result) ?? action;
        toast.error(result.blocked || result.approvalRequired
          ? t('composer.git.operationBlocked', { reason })
          : t('composer.git.operationFailed', { error: reason }));
        return;
      }
      toast.success(t('composer.git.operationSuccess', { action }));
      await refresh();
    } catch (error) {
      toast.error(t('composer.git.operationFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      await refresh();
      setOperationLoading(null);
    }
  };

  const checkoutBranch = (branch: GitBranchInfo) => {
    if (branch.current || disabled) return;
    void finishOperation(`checkout:${branch.name}`, t('composer.git.checkout'), () => hostApi.git.checkoutBranch({ name: branch.name }));
  };
  const createBranch = () => {
    const name = newBranch.trim();
    if (!name || disabled) return;
    const startPoint = newBranchStartPoint.trim();
    void finishOperation('createBranch', t('composer.git.createBranch'), () => hostApi.git.createBranch({
      name,
      checkout: true,
      ...(startPoint ? { startPoint } : {}),
    }));
    setNewBranch('');
    setNewBranchStartPoint('');
  };
  const addWorktree = () => {
    if (!canAddWorktree || disabled) return;
    const startPoint = worktreeStartPoint.trim();
    void finishOperation('worktreeAdd', t('composer.git.addWorktree'), () => hostApi.git.worktreeAdd({
      branch: normalizedWorktreeBranch,
      checkoutNewBranch: worktreeMode === 'new',
      ...(worktreeMode === 'new' && startPoint ? { startPoint } : {}),
    }));
    setWorktreeBranch('');
    setWorktreeStartPoint('');
  };
  const switchWorktree = async (worktree: GitWorktree) => {
    if (disabled || pathEquals(worktree.path, currentWorktree?.path)) return;
    const key = `switch:${worktree.path}`;
    setOperationLoading(key);
    try {
      await onSwitchWorktreeWorkspace(worktree);
      setOpen(false);
    } catch (error) {
      toast.error(t('composer.git.operationFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setOperationLoading(null);
    }
  };

  return (
    <div className="relative mt-1.5" ref={rootRef} data-testid="composer-git-strip">
      <button
        type="button"
        className={cn(
          'flex min-h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-black/5 bg-surface-input px-2.5 py-1.5 text-left text-2xs transition-colors dark:border-white/10',
          'hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
          open && 'bg-black/5 text-foreground dark:bg-white/10',
        )}
        onClick={() => {
          setOpen((current) => !current);
          if (!open) void refresh();
        }}
        disabled={disabled}
        data-testid="composer-git-trigger"
        title={branchLabel}
      >
        <span className="flex min-w-0 items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">{branchLabel}</span>
          <span className={cn('shrink-0 font-medium', stateTone)}>{stateLabel}</span>
          {((status.ahead ?? 0) > 0 || (status.behind ?? 0) > 0) && (
            <span className="hidden shrink-0 text-muted-foreground sm:inline">{t('composer.git.sync', { ahead: status.ahead, behind: status.behind })}</span>
          )}
        </span>
        <span className="flex min-w-0 shrink-0 items-center gap-1.5 text-muted-foreground">
          <HardDrive className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[140px] truncate font-mono">{basenameFromPath(currentWorktree?.path ?? status.workspaceRoot)}</span>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />}
        </span>
      </button>

      {open && (
        <div className="absolute left-0 bottom-full z-30 mb-2 grid max-h-[70vh] w-full min-w-0 gap-2 overflow-y-auto rounded-xl border border-black/10 bg-surface-modal p-2 shadow-xl dark:border-white/10 sm:min-w-[360px] sm:w-[520px]" data-testid="composer-git-menu">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-foreground">{branchLabel}</p>
              <p className="truncate font-mono text-2xs text-muted-foreground">{status.repoRoot || status.workspaceRoot}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-2xs" onClick={() => void refresh()} disabled={loading}>
                {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                {t('composer.git.refresh')}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-2xs" onClick={() => { setOpen(false); onOpenGitPanel(); }}>
                {t('composer.git.openPanel')}
              </Button>
            </div>
          </div>

          <section className="rounded-lg border border-black/5 bg-background p-2 dark:border-white/10">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-2xs font-medium uppercase text-muted-foreground">{t('composer.git.branches')}</h3>
              <Badge variant="outline" className="px-1.5 py-0 text-2xs">{branches.length}</Badge>
            </div>
            <div className="flex items-center gap-1.5 rounded-md bg-surface-input px-2 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input value={branchSearch} onChange={(event) => setBranchSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70" placeholder={t('composer.git.searchBranches')} data-testid="composer-git-branch-search" />
            </div>
            <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
              {filteredBranches.map((branch) => (
                <button key={branch.name} type="button" className={cn('flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors', branch.current ? 'bg-black/5 text-foreground dark:bg-white/10' : 'hover:bg-black/5 dark:hover:bg-white/5')} disabled={branch.current || disabled || operationLoading === `checkout:${branch.name}`} onClick={() => checkoutBranch(branch)} data-testid={`composer-git-checkout-${sanitizeTestId(branch.name)}`}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{branch.name}</span>
                    {branch.upstream ? <span className="block truncate text-2xs text-muted-foreground">{branch.upstream}</span> : null}
                  </span>
                  {branch.current ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : t('composer.git.checkout')}
                </button>
              ))}
            </div>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_auto]">
              <Input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder={t('composer.git.branchName')} className="h-8 bg-surface-input text-xs" data-testid="composer-git-new-branch" />
              <Input value={newBranchStartPoint} onChange={(event) => setNewBranchStartPoint(event.target.value)} placeholder={t('composer.git.startPoint')} className="h-8 bg-surface-input text-xs" />
              <Button type="button" size="sm" className="h-8 text-xs" onClick={createBranch} disabled={!newBranch.trim() || disabled || operationLoading === 'createBranch'} data-testid="composer-git-create-branch">
                {operationLoading === 'createBranch' ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                {t('composer.git.createBranch')}
              </Button>
            </div>
          </section>

          <section className="rounded-lg border border-black/5 bg-background p-2 dark:border-white/10">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-2xs font-medium uppercase text-muted-foreground">{t('composer.git.worktrees')}</h3>
              <Badge variant="outline" className="px-1.5 py-0 text-2xs">{worktrees.length}</Badge>
            </div>
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {worktrees.map((worktree) => {
                const current = pathEquals(worktree.path, currentWorktree?.path);
                const label = `${basenameFromPath(worktree.path)} · ${worktree.branch || compactCommit(worktree.head)} · ${compactCommit(worktree.head)}`;
                return (
                  <div key={worktree.path} className="rounded-md bg-surface-input px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">{label}</p>
                        <p className="truncate font-mono text-2xs text-muted-foreground">{worktree.path}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {current ? <Badge variant="success" className="px-1.5 py-0 text-2xs">{t('composer.git.current')}</Badge> : null}
                        {worktree.locked ? <Badge variant="warning" className="px-1.5 py-0 text-2xs">{t('composer.git.locked')}</Badge> : null}
                        {worktree.prunable ? <Badge variant="outline" className="px-1.5 py-0 text-2xs">{t('composer.git.prunable')}</Badge> : null}
                        {!current ? (
                          <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-2xs" onClick={() => void switchWorktree(worktree)} disabled={disabled || operationLoading === `switch:${worktree.path}`} data-testid={`composer-git-switch-worktree-${worktree.path}`}>
                            {operationLoading === `switch:${worktree.path}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <PanelRightOpen className="mr-1 h-3 w-3" />}
                            {t('composer.git.switchWorktree')}
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
                <button key={mode} type="button" className={cn('rounded px-2 py-1 text-2xs text-muted-foreground', worktreeMode === mode && 'bg-black/5 text-foreground dark:bg-white/10')} onClick={() => setWorktreeMode(mode)}>
                  {mode === 'new' ? t('composer.git.newBranch') : t('composer.git.existingBranch')}
                </button>
              ))}
            </div>
            {worktreeMode === 'existing' ? (
              <select value={worktreeBranch} onChange={(event) => setWorktreeBranch(event.target.value)} className="mt-2 h-8 w-full rounded-md border border-input bg-surface-input px-2 text-xs text-foreground" data-testid="composer-git-worktree-branch">
                <option value="">{t('composer.git.branchName')}</option>
                {branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
              </select>
            ) : (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                <Input value={worktreeBranch} onChange={(event) => setWorktreeBranch(event.target.value)} placeholder={t('composer.git.branchName')} className="h-8 bg-surface-input text-xs" data-testid="composer-git-worktree-branch" />
                <Input value={worktreeStartPoint} onChange={(event) => setWorktreeStartPoint(event.target.value)} placeholder={t('composer.git.startPoint')} className="h-8 bg-surface-input text-xs" />
              </div>
            )}
            <div className="mt-2 rounded-md border border-black/5 bg-surface-input px-2 py-1.5 text-2xs dark:border-white/10" data-testid="composer-git-worktree-target">
              <p className="font-medium text-muted-foreground">{t('composer.git.defaultPath')}</p>
              <p className="mt-0.5 truncate font-mono text-foreground">{worktreeTargetPreview || t('composer.git.defaultPathUnavailable')}</p>
            </div>
            {worktreeBlockedReason ? (
              <p className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-2xs text-amber-800 dark:text-amber-300" data-testid="composer-git-worktree-blocked">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {worktreeBlockedReason}
              </p>
            ) : null}
            <Button type="button" size="sm" className="mt-2 h-8 w-full text-xs" onClick={addWorktree} disabled={!canAddWorktree || disabled} data-testid="composer-git-add-worktree">
              {operationLoading === 'worktreeAdd' ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <GitCompareArrows className="mr-1.5 h-3.5 w-3.5" />}
              {t('composer.git.addWorktree')}
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
