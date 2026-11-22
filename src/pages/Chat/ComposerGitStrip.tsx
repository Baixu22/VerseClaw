import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutside, usePopover } from '@/components/settings/primitives/usePopover';
import { useOverlayPortalContainer } from '@/components/ui/overlay-portal';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FolderGit2,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  GitCompareArrows,
  HardDrive,
  Loader2,
  PanelRightOpen,
  RefreshCw,
} from 'lucide-react';
import { Search } from '@/components/icons/codex-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { basenameFromPath, compactCommit, defaultWorktreeTargetPath, isLinkedWorktreePath, pathEquals } from '@/lib/git-ui';
import { cn } from '@/lib/utils';
import type { GitBranch as GitBranchInfo, GitOperationResult, GitRepositoryStatus, GitWorktree } from '@shared/types/git';
import type { WorkspaceProfile } from '@shared/types/workspace';

type ComposerGitStripProps = {
  workspace: WorkspaceProfile | null;
  disabled?: boolean;
  active?: boolean;
  sessionKey?: string;
  onOpenGitPanel: () => void;
  onSwitchWorktreeWorkspace: (worktree: GitWorktree) => Promise<void>;
  onChanged?: () => void;
  refreshSignal?: number;
};

type WorktreeMode = 'new' | 'existing';

function totalChangeCount(status: GitRepositoryStatus): number {
  return new Set(status.changes.map((change) => change.path)).size;
}

function operationReason(result: GitOperationResult): string | null {
  return result.reason || result.stderr || result.stdout || null;
}

function sanitizeTestId(value: string): string {
  return value.replace(/[^a-z0-9._/-]+/gi, '-');
}

export function ComposerGitStrip({ workspace, disabled = false, active = true, sessionKey, onOpenGitPanel, onSwitchWorktreeWorkspace, onChanged, refreshSignal = 0 }: ComposerGitStripProps) {
  const { t } = useTranslation('chat');
  const popover = usePopover<HTMLButtonElement>({ align: 'left', gap: 8 });
  const { open, setOpen } = popover;
  const overlayContainer = useOverlayPortalContainer();
  useDismissOnOutside({ open, onDismiss: () => setOpen(false), refs: [popover.triggerRef, popover.layerRef] });
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

  const currentScope = useRef(workspace?.id);
  currentScope.current = workspace?.id;
  const sequence = useRef(0);
  const [loadedScope, setLoadedScope] = useState<string>();

  const refresh = useCallback(
    async (details = false) => {
      const requestedScope = workspace?.id;
      const request = ++sequence.current;
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
          details
            ? hostApi.git.branches().catch(() => ({ branches: [] }))
            : Promise.resolve({ branches: [] }),
          details
            ? hostApi.git.worktrees().catch(() => ({ worktrees: [] }))
            : Promise.resolve({ worktrees: [] }),
        ]);
        if (request !== sequence.current || requestedScope !== currentScope.current) return;
        if (
          statusResult.status?.workspaceRoot &&
          !pathEquals(statusResult.status.workspaceRoot, workspace!.rootPath)
        )
          return;
        setLoadedScope(requestedScope);
        setStatus(statusResult.status?.isRepository ? statusResult.status : null);
        if (details) {
          setBranches(branchesResult.branches ?? []);
          setWorktrees(worktreesResult.worktrees ?? []);
        }
      } catch {
        if (request !== sequence.current || requestedScope !== currentScope.current) return;
        setStatus(null);
        setBranches([]);
        setWorktrees([]);
      } finally {
        if (request === sequence.current && requestedScope === currentScope.current)
          setLoading(false);
      }
    },
    [workspace?.id, workspace?.rootPath],
  );

  useEffect(() => {
    if (!active) return;
    setOpen(false);
    setBranches([]);
    setWorktrees([]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    };
    void refresh();
    const off = hostEvents.onChatRuntimeEvent?.((event) => {
      if (
        event.sessionKey === sessionKey &&
        (event.type === "run.ended" ||
          event.type === "patch.completed" ||
          event.type === "tool.completed")
      )
        schedule();
    });
    window.addEventListener("focus", schedule);
    return () => {
      clearTimeout(timer);
      sequence.current++;
      off?.();
      window.removeEventListener("focus", schedule);
    };
  }, [active, refresh, sessionKey, refreshSignal]);

  const currentWorktree = useMemo(
    () => worktrees.find((worktree) => pathEquals(worktree.path, status?.repoRoot) || pathEquals(worktree.path, status?.workspaceRoot)),
    [status?.repoRoot, status?.workspaceRoot, worktrees],
  );
  const filteredBranches = useMemo(() => {
    const query = branchSearch.trim().toLowerCase();
    return query ? branches.filter((branch) => branch.name.toLowerCase().includes(query)) : branches;
  }, [branchSearch, branches]);

  if (
    !active ||
    loadedScope !== workspace?.id ||
    !status?.isRepository ||
    (!totalChangeCount(status) && !open)
  )
    return null;

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

  const finishOperation = async (key: string, action: string, operation: () => Promise<GitOperationResult>) => {
    if (operationLoading) return;
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
      onChanged?.();
    } catch (error) {
      toast.error(t('composer.git.operationFailed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      await refresh(true);
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

  const linkedWorktree = isLinkedWorktreePath(worktrees, currentWorktree?.path ?? status.repoRoot);
  const kindLabel = linkedWorktree ? t('composer.git.kindWorktree')
    : status.detached ? t('composer.git.kindDetached') : t('composer.git.kindBranch');
  const KindIcon = linkedWorktree ? FolderGit2 : status.detached ? GitCommitHorizontal : GitBranch;
  const ahead = status.ahead ?? 0;
  const behind = status.behind ?? 0;

  return (
    <div className="codex-composer-git-strip relative mb-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground" data-conflicts={status.hasConflicts || undefined} data-testid="composer-git-strip">
      <Button
        ref={popover.triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 min-w-0 shrink gap-1.5 px-1.5 font-normal"
        onClick={() => {
          setOpen((current) => !current);
          if (!open) void refresh(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="composer-git-trigger"
        title={t('composer.git.branches')}
      >
        <KindIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate font-mono">{branchLabel}</span>
        {loading ? <Loader2 className="size-3 shrink-0 motion-safe:animate-spin" /> : <ChevronDown className="size-3 shrink-0" />}
      </Button>
      <span className="shrink-0" data-testid="composer-git-change-count">{t('composer.git.filesChanged', { count: changeCount })}</span>
      {status.hasConflicts && (
        <span className="inline-flex min-w-0 items-center gap-1 text-orange-700 dark:text-orange-400" title={stateLabel}>
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{stateLabel}</span>
        </span>
      )}
      <Button type="button" variant="ghost" size="sm" className="composer-git-review-button ml-auto h-7 shrink-0 gap-1 px-1.5 text-xs" onClick={onOpenGitPanel} aria-label={t('composer.git.reviewChanges')} data-testid="composer-git-review">
        <GitCompareArrows className="size-3.5" aria-hidden="true" /><span className="composer-git-review-label">{t('composer.git.reviewChanges')}</span>
      </Button>

      {open && createPortal(
        <div ref={popover.layerRef} style={popover.style} className="git-surface codex-git-menu" role="dialog" aria-label={t('composer.git.branches')} data-testid="composer-git-menu">
          <div className="codex-git-menu__head">
            <span className={cn('codex-git-kind', linkedWorktree && 'codex-git-kind--worktree')}>
              <KindIcon aria-hidden="true" />
              {kindLabel}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs text-foreground">{branchLabel}</p>
              <p className="truncate text-2xs text-muted-foreground" title={status.repoRoot || status.workspaceRoot}>
                {linkedWorktree ? t('composer.git.linkedWorktree') : t('composer.git.mainCheckout')} · {status.repoRoot || status.workspaceRoot}
              </p>
              <p className="text-2xs text-muted-foreground">{stateLabel}</p>
              {(ahead > 0 || behind > 0) && <p className="text-2xs text-muted-foreground">{t('composer.git.sync', { ahead, behind })}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => void refresh(true)} disabled={loading} aria-label={t('composer.git.refresh')} title={t('composer.git.refresh')}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => { setOpen(false); onOpenGitPanel(); }} aria-label={t('composer.git.openPanel')} title={t('composer.git.openPanel')}>
                <PanelRightOpen className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <section className="codex-git-menu__section">
            <div className="codex-git-menu__label">
              <span>{t('composer.git.branches')}</span>
              <span className="codex-composer-menu__count">{branches.length}</span>
            </div>
            <label className="codex-git-menu__field flex items-center gap-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input value={branchSearch} onChange={(event) => setBranchSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70" placeholder={t('composer.git.searchBranches')} data-testid="composer-git-branch-search" />
            </label>
            <div className="max-h-40 overflow-y-auto">
              {filteredBranches.map((branch) => (
                <button key={branch.name} type="button" className="codex-git-menu__row" data-current={branch.current || undefined} disabled={branch.current || disabled || operationLoading === `checkout:${branch.name}`} onClick={() => checkoutBranch(branch)} data-testid={`composer-git-checkout-${sanitizeTestId(branch.name)}`}>
                  <GitBranch className="text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs">{branch.name}</span>
                    {branch.upstream ? <span className="block truncate text-2xs text-muted-foreground">{branch.upstream}</span> : null}
                  </span>
                  {operationLoading === `checkout:${branch.name}`
                    ? <Loader2 className="animate-spin" />
                    : branch.current ? <Check aria-label={t('composer.git.current')} /> : <span className="codex-git-menu__hint">{t('composer.git.checkout')}</span>}
                </button>
              ))}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto]">
              <input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder={t('composer.git.branchName')} className="codex-git-menu__field" data-testid="composer-git-new-branch" />
              <input value={newBranchStartPoint} onChange={(event) => setNewBranchStartPoint(event.target.value)} placeholder={t('composer.git.startPoint')} className="codex-git-menu__field" />
              <button type="button" className="codex-git-menu__primary" onClick={createBranch} disabled={!newBranch.trim() || disabled || operationLoading === 'createBranch'} data-testid="composer-git-create-branch">
                {operationLoading === 'createBranch' ? <Loader2 className="animate-spin" /> : <GitBranchPlus />}
                {t('composer.git.createBranch')}
              </button>
            </div>
          </section>

          <section className="codex-git-menu__section">
            <div className="codex-git-menu__label">
              <span>{t('composer.git.worktrees')}</span>
              <span className="codex-composer-menu__count">{worktrees.length}</span>
            </div>
            <div className="max-h-44 overflow-y-auto">
              {worktrees.map((worktree, index) => {
                const current = pathEquals(worktree.path, currentWorktree?.path);
                return (
                  <div key={worktree.path} className="codex-git-menu__row" data-current={current || undefined}>
                    {index === 0 ? <HardDrive className="text-muted-foreground" aria-hidden="true" /> : <FolderGit2 className="text-muted-foreground" aria-hidden="true" />}
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-xs font-medium">{basenameFromPath(worktree.path)}</span>
                        <span className="shrink-0 text-2xs text-muted-foreground">{' · '}</span>
                        <span className="truncate font-mono text-2xs text-muted-foreground">{worktree.branch || compactCommit(worktree.head)} · {compactCommit(worktree.head)}</span>
                      </span>
                      <span className="git-path block font-mono text-2xs text-muted-foreground">{worktree.path}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {current ? <Badge variant="success" className="rounded-full px-1.5 py-0 text-2xs">{t('composer.git.current')}</Badge> : null}
                      {worktree.locked ? <Badge variant="warning" className="rounded-full px-1.5 py-0 text-2xs">{t('composer.git.locked')}</Badge> : null}
                      {worktree.prunable ? <Badge variant="outline" className="rounded-full px-1.5 py-0 text-2xs">{t('composer.git.prunable')}</Badge> : null}
                      {!current ? (
                        <Button type="button" variant="ghost" size="sm" className="h-6 rounded-full px-2 text-2xs" onClick={() => void switchWorktree(worktree)} disabled={disabled || worktree.bare || worktree.prunable || operationLoading === `switch:${worktree.path}`} data-testid={`composer-git-switch-worktree-${worktree.path}`}>
                          {operationLoading === `switch:${worktree.path}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <PanelRightOpen className="mr-1 h-3 w-3" />}
                          {t('composer.git.switchWorktree')}
                        </Button>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="codex-git-menu__segmented">
              {(['new', 'existing'] as const).map((mode) => (
                <button key={mode} type="button" aria-pressed={worktreeMode === mode} onClick={() => setWorktreeMode(mode)}>
                  {mode === 'new' ? t('composer.git.newBranch') : t('composer.git.existingBranch')}
                </button>
              ))}
            </div>
            {worktreeMode === 'existing' ? (
              <select value={worktreeBranch} onChange={(event) => setWorktreeBranch(event.target.value)} className="codex-git-menu__field w-full" data-testid="composer-git-worktree-branch">
                <option value="">{t('composer.git.branchName')}</option>
                {branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
              </select>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                <input value={worktreeBranch} onChange={(event) => setWorktreeBranch(event.target.value)} placeholder={t('composer.git.branchName')} className="codex-git-menu__field" data-testid="composer-git-worktree-branch" />
                <input value={worktreeStartPoint} onChange={(event) => setWorktreeStartPoint(event.target.value)} placeholder={t('composer.git.startPoint')} className="codex-git-menu__field" />
              </div>
            )}
            <div className="flex min-w-0 items-center gap-2 px-1 text-2xs" data-testid="composer-git-worktree-target">
              <span className="shrink-0 text-muted-foreground">{t('composer.git.defaultPath')}</span>
              <span className="min-w-0 truncate font-mono text-foreground">{worktreeTargetPreview || t('composer.git.defaultPathUnavailable')}</span>
            </div>
            {worktreeBlockedReason ? (
              <p className="flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-2.5 py-1.5 text-2xs text-amber-700 dark:text-amber-400" data-testid="composer-git-worktree-blocked">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {worktreeBlockedReason}
              </p>
            ) : null}
            <button type="button" className="codex-git-menu__primary w-full" onClick={addWorktree} disabled={!canAddWorktree || disabled} data-testid="composer-git-add-worktree">
              {operationLoading === 'worktreeAdd' ? <Loader2 className="animate-spin" /> : <GitCompareArrows />}
              {t('composer.git.addWorktree')}
            </button>
          </section>
        </div>, overlayContainer ?? document.body
      )}
    </div>
  );
}
