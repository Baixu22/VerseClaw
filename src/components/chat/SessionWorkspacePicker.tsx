import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderGit2, GitBranch, Loader2, Plus, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { GitRepositoryStatus, GitWorktree } from '@shared/types/git';
import { hostApi } from '@/lib/host-api';
import { pathEquals } from '@/lib/git-ui';
import { useWorkspacesStore } from '@/stores/workspaces';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ComposerPopover } from './ComposerPopover';

export function SessionWorkspacePicker({ disabled, onSelect, onChanged }: {
  disabled?: boolean;
  onSelect: (tree: GitWorktree) => Promise<void>;
  onChanged?: () => void;
}) {
  const { t } = useTranslation('settings', { keyPrefix: 'storage' });
  const navigate = useNavigate();
  const workspace = useWorkspacesStore((state) => state.activeWorkspace);
  const workspaceId = workspace?.id;
  const workspaceRoot = workspace?.rootPath;
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [branch, setBranch] = useState('');
  const [base, setBase] = useState('HEAD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ workspaceId: string; status: GitRepositoryStatus; trees: GitWorktree[] } | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    if (!workspaceId || !workspaceRoot) return;
    const request = ++revision.current;
    try {
      const status = await hostApi.git.status();
      if (!status.success || !status.status) throw new Error(status.error || t('loadFailed'));
      const trees = status.status.isRepository ? await hostApi.git.worktrees() : { success: true, worktrees: [] };
      if (!trees.success) throw new Error('error' in trees ? trees.error : t('loadFailed'));
      if (request === revision.current) setData({ workspaceId, status: status.status, trees: trees.worktrees });
    } catch (cause) { if (request === revision.current) setError(String(cause)); }
  }, [workspaceId, workspaceRoot, t]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLInputElement>('input')?.focus();
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  const current = data?.workspaceId === workspace?.id ? data : null;
  const isLinked = current?.trees.some((tree, index) => index > 0 && pathEquals(tree.path, current.status.repoRoot));
  const run = async (operation: () => Promise<void>) => {
    if (busy || disabled) return;
    setBusy(true); setError(null);
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  if (!workspace) return null;
  return <span ref={root} className="relative inline-flex min-w-0">
    <button ref={trigger} type="button" className="codex-welcome-context__subcontrol" data-testid="session-worktree-trigger"
      aria-haspopup="dialog" aria-expanded={open} disabled={disabled || busy}
      onClick={() => { setOpen(!open); if (!open) { setError(null); void refresh(); } }}>
      <FolderGit2 className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{current && !current.status.isRepository ? t('init') : isLinked ? t('worktree') : t('local')}</span>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />}
    </button>
    <ComposerPopover open={open} className="codex-composer-menu w-[min(340px,calc(100vw-32px))] overflow-y-auto text-left"
      role="dialog" aria-label={t('environment')} data-testid="session-worktree-menu">
      <div className="px-3 pb-2 pt-2 text-xs font-medium">{t('environment')}</div>
      <p className="px-3 pb-2 text-xs text-muted-foreground">{t('environmentHint')}</p>
      {!current && !error && <p className="p-3 text-xs" role="status">{t('loading')}</p>}
      {current?.trees.map((tree, index) => <button key={tree.path} type="button" className="codex-composer-menu__item"
        disabled={busy || disabled || tree.bare || tree.prunable || pathEquals(tree.path, current.status.repoRoot)}
        title={tree.path} onClick={() => void run(async () => { await onSelect(tree); setOpen(false); })}>
        <GitBranch className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1"><span className="block truncate text-xs">{tree.branch || tree.head?.slice(0, 8) || t('worktree')}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{index === 0 ? t('local') : t('worktree')} · {tree.path}</span></span>
        {pathEquals(tree.path, current.status.repoRoot) && <Check className="h-3.5 w-3.5 shrink-0" />}
      </button>)}
      {current && !current.status.isRepository && <button type="button" className="codex-composer-menu__item" data-testid="session-git-init" disabled={busy || disabled}
        onClick={() => void run(async () => { const result = await hostApi.git.init(); if (!result.success) throw new Error(result.reason || result.stderr || t('operationFailed')); await refresh(); onChanged?.(); toast.success(t('initialized')); })}>
        <Plus className="h-4 w-4" />{t('init')}</button>}
      {current?.status.isRepository && !creating && <button type="button" className="codex-composer-menu__item" data-testid="session-worktree-create" disabled={busy || disabled}
        onClick={() => { setCreating(true); setBase(current.status.branch || 'HEAD'); }}><Plus className="h-4 w-4" />{t('createWorktree')}</button>}
      {creating && <form className="space-y-2 px-3 py-2" onSubmit={(event) => {
        event.preventDefault();
        const originId = workspace.id;
        void run(async () => {
          const result = await hostApi.git.worktreeAdd({ branch: branch.trim(), startPoint: base.trim() || 'HEAD', checkoutNewBranch: true });
          if (!result.success || !result.worktree) throw new Error(result.reason || result.stderr || t('operationFailed'));
          if (useWorkspacesStore.getState().activeWorkspaceId !== originId) return;
          await onSelect(result.worktree); setCreating(false); setOpen(false); setBranch('');
        });
      }}>
        <label className="block text-xs">{t('branchName')}<Input autoFocus value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="codex/my-task" className="mt-1 h-8" data-testid="session-worktree-branch" disabled={busy} /></label>
        <label className="block text-xs">{t('baseBranch')}<Input value={base} onChange={(event) => setBase(event.target.value)} className="mt-1 h-8" disabled={busy} /></label>
        <p className="text-[11px] text-muted-foreground">{t('committedOnly')}</p>
        <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)} disabled={busy}>{t('cancel')}</Button>
          <Button size="sm" disabled={busy || disabled || !branch.trim()} data-testid="session-worktree-submit">{busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}{t('createAndOpen')}</Button></div>
      </form>}
      {error && <p role="alert" className="break-words px-3 py-2 text-xs text-red-700 dark:text-red-400">{error}</p>}
      <div className="my-1 border-t border-border/50" />
      <button type="button" className="codex-composer-menu__item" onClick={() => { setOpen(false); navigate('/settings/storage'); }}><HardDrive className="h-4 w-4" />{t('title')}</button>
    </ComposerPopover>
  </span>;
}
