import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, FolderGit2, GitBranch, GitBranchPlus, HardDrive, Loader2, MoreHorizontal, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GitBranch as Branch, GitRepositoryStatus, GitWorktree } from '@shared/types/git';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { isLinkedWorktreePath, pathEquals } from '@/lib/git-ui';
import { cn } from '@/lib/utils';
import { useDismissOnOutside, usePopover } from '@/components/settings/primitives/usePopover';
import { useOverlayPortalContainer } from '@/components/ui/overlay-portal';
import { useWorkspacesStore } from '@/stores/workspaces';
import { WelcomeProjectPicker } from './WelcomeProjectPicker';
import type { WorktreeCreationProgressState } from './WorktreeCreationProgress';

type Snapshot = { status: GitRepositoryStatus; trees: GitWorktree[]; branches: Branch[] };
const newBranchName = () => `codex/task-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 4)}`;

/** The composer owns one execution picker; Git effects remain in the Host API. */
export function SessionWorkspacePicker({ disabled = false, setupVisible = true, onSelect, onChanged, refreshSignal = 0,
  onSelectProject, onPickFolder, onBeforeChange, onBusyChange, onProgressChange, sessionKey, children,
}: {
  disabled?: boolean;
  setupVisible?: boolean;
  onSelect: (tree: GitWorktree) => Promise<void>;
  onChanged?: () => void;
  refreshSignal?: number;
  onSelectProject?: (id: string) => Promise<unknown>;
  onPickFolder?: () => void | Promise<unknown>;
  onBeforeChange?: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onProgressChange?: (progress: WorktreeCreationProgressState | null) => void;
  sessionKey: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation('settings', { keyPrefix: 'storage' });
  const { t: chatT } = useTranslation('chat');
  const workspace = useWorkspacesStore(state => state.activeWorkspace);
  const workspaceId = workspace?.id, workspaceRoot = workspace?.rootPath;
  const scope = JSON.stringify([workspaceId, workspaceRoot, sessionKey]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const disabledRef = useRef(disabled); disabledRef.current = disabled || !setupVisible;
  const alive = useRef(true);
  const requestId = useRef(0);
  const operation = useRef<string | null>(null);
  const [data, setData] = useState<{ scope: string; snapshot: Snapshot } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState(newBranchName);
  const [base, setBase] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState('');
  const [created, setCreated] = useState<GitWorktree | null>(null);
  const createdRef = useRef<GitWorktree | null>(null);
  const attemptRef = useRef<{ branch: string; startPoint: string } | null>(null);
  const stayRef = useRef(false);
  const stageRef = useRef<WorktreeCreationProgressState['stage']>('saving');
  const branchInput = useRef<HTMLInputElement>(null);
  const { open, setOpen, triggerRef, layerRef, style } = usePopover<HTMLButtonElement>({ align: 'left', gap: 6, fitViewport: true, preferredSide: 'top' });
  const overlay = useOverlayPortalContainer();
  const current = data?.scope === scope ? data.snapshot : null;
  const linked = current ? isLinkedWorktreePath(current.trees, current.status.repoRoot) : false;
  const canMutate = Boolean(setupVisible && current?.status.isRepository && !disabled && !busy && !loading);
  const filteredBranches = current?.branches.filter(item => item.name.toLowerCase().includes(branchSearch.trim().toLowerCase())) ?? [];
  const isCurrent = (owner: string) => {
    const active = useWorkspacesStore.getState().activeWorkspace;
    return alive.current && scopeRef.current === owner && active?.id === workspaceId && pathEquals(active?.rootPath, workspaceRoot);
  };

  const refresh = useCallback(async () => {
    if (!workspaceId || !workspaceRoot) return;
    const request = ++requestId.current;
    setLoading(true);
    try {
      const status = await hostApi.git.status();
      if (!status.success || !status.status) throw new Error(status.error || t('loadFailed'));
      const [trees, branches] = status.status.isRepository
        ? await Promise.all([hostApi.git.worktrees(), hostApi.git.branches()])
        : [{ success: true, worktrees: [] }, { success: true, branches: [] }];
      if (!trees.success || !branches.success) throw new Error(t('loadFailed'));
      if (!alive.current || request !== requestId.current || scopeRef.current !== scope
        || !pathEquals(status.status.workspaceRoot, workspaceRoot)) return;
      setData({ scope, snapshot: { status: status.status, trees: trees.worktrees, branches: branches.branches } });
    } catch (cause) {
      if (alive.current && request === requestId.current && scopeRef.current === scope) {
        setData(null); setError(cause instanceof Error ? cause.message : t('loadFailed'));
      }
    } finally {
      if (alive.current && request === requestId.current) setLoading(false);
    }
  }, [workspaceId, workspaceRoot, scope, t]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const off = hostEvents.onChatRuntimeEvent(event => {
      if (event.sessionKey === sessionKey && ['run.ended', 'patch.completed'].includes(event.type)) void refresh();
    });
    return () => { alive.current = false; requestId.current++; off(); onBusyChange?.(false); onProgressChange?.(null); };
  }, [refresh, refreshSignal, sessionKey, onBusyChange, onProgressChange]);
  useDismissOnOutside({ open, onDismiss: () => setOpen(false), onEscape: () => {
    setOpen(false); triggerRef.current?.focus();
  }, refs: [triggerRef, layerRef] });
  useEffect(() => {
    if (!setupVisible) setOpen(false);
  }, [setupVisible, setOpen]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const search = layerRef.current?.querySelector<HTMLInputElement>('[data-testid="composer-context-branch-search"]');
      (search ?? layerRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, branchesOpen, layerRef]);

  const show = (anchor: HTMLButtonElement, showBranches = false) => {
    const differentAnchor = triggerRef.current !== anchor;
    triggerRef.current = anchor;
    setOpen(!open || differentAnchor);
    if (!open) setAdvanced(false);
    setBranchesOpen(showBranches); setBranchSearch(''); setError(null);
    void refresh();
  };
  const run = async (kind: string, action: (owner: string) => Promise<void>) => {
    if (operation.current || disabledRef.current || loading || !current) return;
    const owner = scope;
    operation.current = owner; setBusy(kind); setError(null); onBusyChange?.(true);
    try {
      await onBeforeChange?.();
      if (!isCurrent(owner) || disabledRef.current) {
        if (isCurrent(owner) && kind === 'create') dismissProgress();
        return;
      }
      await action(owner);
    } catch (cause) {
      if (isCurrent(owner)) {
        const message = cause instanceof Error ? cause.message : t('operationFailed');
        setError(message);
        if (kind === 'create') publishProgress(stageRef.current, message);
        if (kind === 'create' && !createdRef.current) {
          setAdvanced(true);
          requestAnimationFrame(() => branchInput.current?.focus());
        }
      }
    } finally {
      if (isCurrent(owner)) {
        operation.current = null; setBusy(null); onBusyChange?.(false); void refresh();
      }
    }
  };
  const dismissProgress = () => {
    onProgressChange?.(null);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="chat-composer-input"]')?.focus());
  };
  const publishProgress = (stage: WorktreeCreationProgressState['stage'], failure?: string) => {
    stageRef.current = stage;
    onProgressChange?.({ stage, branch: attemptRef.current?.branch ?? branch, path: createdRef.current?.path, error: failure, stay: stayRef.current,
      onStay: () => { stayRef.current = true; publishProgress(stageRef.current); }, onRetry: create, onDismiss: dismissProgress });
  };
  const create = () => {
    if (operation.current || disabledRef.current || loading || !current) return;
    attemptRef.current ??= { branch: branch.trim(), startPoint: base.trim() || current.status.branch || 'HEAD' };
    stayRef.current = false;
    publishProgress('saving');
    if (onProgressChange) setOpen(false);
    void run('create', async owner => {
    let tree = createdRef.current;
    if (!tree) {
      publishProgress('creating');
      const result = await hostApi.git.worktreeAdd({ ...attemptRef.current!, checkoutNewBranch: true });
      if (!result.success || !result.worktree) throw new Error(result.reason || result.stderr || t('operationFailed'));
      tree = result.worktree;
      if (!isCurrent(owner)) return;
      createdRef.current = tree;
      setCreated(tree);
    }
    if (stayRef.current) { dismissProgress(); return; }
    publishProgress('opening');
    await onSelect(tree);
    if (isCurrent(owner)) {
      dismissProgress(); setOpen(false); setCreated(null); createdRef.current = null; attemptRef.current = null;
      setBranch(newBranchName()); setAdvanced(false);
    }
    });
  };
  const switchTree = (tree: GitWorktree) => void run('switch', async owner => {
    await onSelect(tree);
    if (isCurrent(owner)) setOpen(false);
  });
  const switchBranch = (name: string) => void run('branch', async owner => {
    const result = await hostApi.git.checkoutBranch({ name });
    if (!result.success) throw new Error(result.reason || result.stderr || t('operationFailed'));
    if (isCurrent(owner)) { onChanged?.(); setOpen(false); triggerRef.current?.focus(); }
  });

  return <div className="composer-execution-tray" data-testid="composer-execution-tray" data-setup-visible={setupVisible}>
    {children}
    {setupVisible && created && !busy && <div className="composer-context-ready" data-testid="worktree-creation-ready">
      <Check aria-hidden="true" /><span>{t('creation.ready')}</span>
      <button type="button" disabled={disabled} onClick={create}>{t('openCreated')}</button>
      <button type="button" onClick={() => { setCreated(null); createdRef.current = null; attemptRef.current = null; setBranch(newBranchName()); }} aria-label={t('creation.dismissReady')}>×</button>
    </div>}
    {setupVisible && <div className="composer-context-row" data-testid="composer-context-row">
      <WelcomeProjectPicker disabled={disabled || Boolean(busy)} onSelect={onSelectProject} onPickFolder={onPickFolder} />
      {workspace && <>
        {linked && <button type="button" className="composer-context-chip composer-context-location" data-testid="session-worktree-trigger"
          data-git-kind="worktree" aria-haspopup="dialog" aria-expanded={open}
          onClick={event => show(event.currentTarget)} title={workspaceRoot}>
          <FolderGit2 aria-hidden="true" /><span>{t('worktree')}</span>
        </button>}
        {current?.status.isRepository && <button type="button" className="composer-context-chip composer-context-branch"
          data-testid="composer-context-branch" title={current.status.branch || 'HEAD'} aria-label={chatT('welcome.branchPickerTitle')} aria-haspopup="dialog" aria-expanded={open && branchesOpen}
          onClick={event => show(event.currentTarget, true)}>
          <GitBranch aria-hidden="true" /><span>{current.status.branch || 'HEAD'}</span>
          {!current.status.clean && <i className="composer-context-dirty" aria-label={t('uncommittedChanges')} />}
          <ChevronDown aria-hidden="true" />
        </button>}
        <button type="button" className="composer-context-more" data-testid="composer-context-more" aria-label={t('executionSettings')}
          aria-haspopup="dialog" aria-expanded={open} onClick={event => show(event.currentTarget)}><MoreHorizontal aria-hidden="true" /></button>
      </>}
    </div>}
    {setupVisible && open && createPortal(<div ref={layerRef} style={style} className="composer-context-menu" role="dialog" tabIndex={-1}
      aria-label={branchesOpen ? chatT('welcome.branchPickerTitle') : t('executionSettings')} data-testid="session-worktree-menu"
      onKeyDown={event => {
        if (!branchesOpen || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-branch-option]:not(:disabled)'));
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[index < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }}>
      <p className="composer-context-label">{branchesOpen ? t('branches') : t('executionSettings')}</p>
      {disabled && <p className="composer-context-hint" role="status">{t('runningHint')}</p>}
      {!current && <button type="button" className="composer-context-option" disabled={loading} onClick={() => void refresh()}>
        {loading ? <Loader2 className="motion-safe:animate-spin" /> : <RefreshCw />}<span>{t(loading ? 'loadingDirectory' : 'refresh')}</span>
      </button>}
      {!branchesOpen && current?.status.isRepository && <>
        <div className="composer-context-create">
          <GitBranchPlus aria-hidden="true" />
          <div className="min-w-0 flex-1"><span className="block">{t('createWorktree')}</span><span className="composer-context-hint block truncate" title={branch}>{branch}</span></div>
          <button type="button" className="composer-context-primary" disabled={!canMutate || !branch.trim()} data-testid="session-worktree-submit" onClick={create}>
            {busy === 'create' && <Loader2 className="motion-safe:animate-spin" />}{t(created ? 'openCreated' : 'createAndOpen')}
          </button>
        </div>
        <button type="button" className="composer-context-customize" data-testid="session-worktree-create" aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)} disabled={Boolean(busy) || Boolean(created)}>{t('customizeWorktree')}<ChevronDown className={cn(advanced && 'rotate-180')} /></button>
        {advanced && <form className="composer-context-form" onSubmit={event => { event.preventDefault(); if (canMutate && branch.trim()) create(); }}
          onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }}>
          <label>{t('branchName')}<input ref={branchInput} value={branch} onChange={event => { setBranch(event.target.value); setCreated(null); createdRef.current = null; attemptRef.current = null; }} disabled={Boolean(busy)} data-testid="session-worktree-branch" /></label>
          <label>{t('baseBranch')}<select value={base || current.status.branch || 'HEAD'} onChange={event => { setBase(event.target.value); attemptRef.current = null; }} disabled={Boolean(busy)} data-testid="session-worktree-base">
            <option value="HEAD">HEAD</option>{current.branches.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select></label>
          <p className="composer-context-hint">{t('committedOnly')}</p>
        </form>}
      </>}
      {error && <p className="composer-context-error" role="alert">{error}</p>}
      {!branchesOpen && current && <>
        {!current.status.isRepository && <p className="composer-context-hint">{t('notGit')}</p>}
        <div className="composer-context-divider" />
        <p className="composer-context-label">{t('environment')}</p>
        <div className="composer-context-directories">
          {current.trees.map((tree, index) => <button key={tree.path} type="button" className="composer-context-option"
            title={tree.path} disabled={!canMutate || tree.bare || tree.prunable || pathEquals(tree.path, current.status.repoRoot)}
            data-testid={`session-worktree-option-${index}`} onClick={() => switchTree(tree)}>
            {index === 0 ? <HardDrive aria-hidden="true" /> : <FolderGit2 aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate">{index === 0 ? `${t('mainDirectory')} · ` : ''}{tree.branch || tree.head?.slice(0, 8) || t('worktree')}</span>
            {pathEquals(tree.path, current.status.repoRoot) && <Check aria-hidden="true" />}
          </button>)}
        </div>
        {current.status.isRepository && <>
          <div className="composer-context-divider" />
          <button type="button" className="composer-context-option" data-testid="composer-context-branches-toggle" aria-expanded={branchesOpen} onClick={() => { setBranchesOpen(true); setBranchSearch(''); }}>
            <GitBranch aria-hidden="true" /><span className="flex-1">{t('branches')}</span><span className="max-w-28 truncate composer-context-hint">{current.status.branch || 'HEAD'}</span><ChevronDown className={cn(branchesOpen && 'rotate-180')} />
          </button>
        </>}
      </>}
      {branchesOpen && <>
        <div className="composer-context-form">
          <input data-testid="composer-context-branch-search" aria-label={chatT('welcome.branchSearch')} placeholder={chatT('welcome.branchSearch')}
            value={branchSearch} onChange={event => setBranchSearch(event.target.value)} />
        </div>
        <div className="composer-context-branches" data-testid="composer-context-branches">
          {filteredBranches.map(item => <button key={item.name} type="button" className="composer-context-option" disabled={!canMutate || item.current}
            title={item.name} data-branch-option aria-current={item.current || undefined}
            data-testid={`composer-context-checkout-${item.name.replace(/[^a-z0-9._/-]+/gi, '-')}`} onClick={() => switchBranch(item.name)}>
            <GitBranch aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{item.name}</span>{item.current && <Check aria-hidden="true" />}
          </button>)}
          {current && !loading && filteredBranches.length === 0 && <p className="composer-context-hint p-2">{chatT('welcome.branchEmpty')}</p>}
        </div>
      </>}
    </div>, overlay ?? document.body)}
  </div>;
}
