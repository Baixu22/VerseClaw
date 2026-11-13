import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckSquare, ChevronDown, ExternalLink, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useOverlayPortalContainer } from '@/components/ui/overlay-portal';
import { useDismissOnOutside, usePopover } from '@/components/settings/primitives/usePopover';
import { hostApi } from '@/lib/host-api';
import { normalizeAppError, type AppErrorCode } from '@/lib/error-model';
import { cn } from '@/lib/utils';
import type { TaskLedgerNode, TaskLedgerSnapshot } from '@shared/types/task-ledger';
import type { ChatSession } from '@shared/chat/types';
import type { WorkspaceCoordinatorBinding } from '@shared/types/workspace';
import { readSessionTaskContainer } from '@/lib/session-read-model';
import { toast } from 'sonner';

type Props = {
  workspaceId?: string | null;
  compact?: boolean;
  hideWhenEmpty?: boolean;
  className?: string;
  onVisibilityChange?: (visible: boolean) => void;
  session?: ChatSession;
  binding?: WorkspaceCoordinatorBinding | null;
  mode?: 'panel' | 'bar';
  projectWide?: boolean;
  refreshKey?: string;
  onTaskSelected?: () => void | Promise<void>;
};

function nodeTone(node: TaskLedgerNode): string {
  if (node.status === 'blocked') return 'text-red-700 dark:text-red-400';
  if (node.status === 'review') return 'text-amber-700 dark:text-amber-400';
  if (node.status === 'done') return 'text-emerald-700 dark:text-emerald-400';
  if (node.status === 'doing') return 'text-blue-700 dark:text-blue-400';
  return 'text-foreground';
}

function NodeLine({ node, t }: { node: TaskLedgerNode; t: ReturnType<typeof useTranslation<'taskLedger'>>['t'] }) {
  return (
    <li className="min-w-0 rounded-md bg-surface-input px-2.5 py-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className={cn('truncate text-xs font-medium', nodeTone(node))}>{node.title}</span>
        <Badge variant="outline" className="shrink-0 rounded-full text-2xs">{t(`status.${node.status}`)}</Badge>
      </div>
      <p className="mt-1 truncate text-2xs text-muted-foreground">{t(`kind.${node.kind}`)}</p>
    </li>
  );
}

const SCOPE_CHIP = 'inline-flex h-7 min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10';

/**
 * The session's task container as a quiet header chip.
 *
 * It used to be a full-width strip pinned over every transcript, which made a
 * conversation with no business task announce "0 tasks" in the most prominent
 * slot on the page. The container is still always present — empty, unavailable
 * and stale stay distinguishable (`data-state`, the status line) — but only the
 * states that ask something of the user are spelled out; refresh and the ledger
 * link surface on hover/focus. The list opens as an anchored popover (a bottom
 * sheet on narrow windows), so opening it never reflows the conversation.
 */
function SessionTaskScopeChip({
  className,
  state,
  attention,
  loading,
  narrow,
  expanded,
  setExpanded,
  title,
  count,
  statusText,
  ledgerPath,
  onRefresh,
  list,
  t,
}: {
  className?: string;
  state: string;
  attention: boolean;
  loading: boolean;
  narrow: boolean;
  expanded: boolean;
  setExpanded: (next: boolean | ((value: boolean) => boolean)) => void;
  title: string;
  count: number;
  statusText: string;
  ledgerPath: string;
  onRefresh: () => void;
  list: React.ReactNode;
  t: ReturnType<typeof useTranslation<'taskLedger'>>['t'];
}) {
  const { triggerRef, layerRef, setOpen, style: popoverStyle } = usePopover<HTMLButtonElement>({ align: 'left', gap: 6 });
  const overlayContainer = useOverlayPortalContainer();
  const open = expanded && !narrow;
  useDismissOnOutside({ open, onDismiss: () => setExpanded(false), refs: [triggerRef, layerRef] });
  useEffect(() => { setOpen(open); }, [open, setOpen]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') triggerRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, triggerRef]);
  const toggle = <button ref={triggerRef} type="button" data-testid="session-tasks-toggle" aria-expanded={expanded}
    aria-haspopup="dialog" onClick={narrow ? undefined : () => setExpanded((value) => !value)} title={statusText}
    className={cn(SCOPE_CHIP, expanded && 'bg-black/5 text-foreground dark:bg-white/10', attention && 'text-amber-700 dark:text-amber-400')}>
    {attention
      ? <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      : state === 'loading'
        ? <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        : <CheckSquare className="size-3.5 shrink-0" aria-hidden="true" />}
    <span className="hidden truncate sm:inline">{title}</span><span className="tabular-nums">{count}</span>
    <ChevronDown className={cn('size-3 shrink-0 opacity-70 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
  </button>;
  return (
    <section data-testid="session-task-container" data-state={state} aria-label={title}
      className={cn('group/task-scope relative inline-flex min-w-0 shrink items-center gap-0.5 text-xs', className)}>
      {narrow ? <Sheet open={expanded} onOpenChange={setExpanded}>
        <SheetTrigger asChild>{toggle}</SheetTrigger>
        <SheetContent side="bottom" aria-describedby={undefined} data-testid="session-task-drawer">
          <SheetTitle>{title}</SheetTitle>
          {list}
        </SheetContent>
      </Sheet> : toggle}
      <span className={cn('min-w-0 truncate', attention ? 'max-w-[220px] text-amber-700 dark:text-amber-400' : state === 'loading' ? 'max-w-[160px] text-muted-foreground' : 'sr-only')} role="status">
        {statusText}
      </span>
      {/* Secondary actions stay reachable for pointer and keyboard but only
        * claim attention when the scope needs it. */}
      <span className={cn('inline-flex items-center transition-opacity duration-150',
        attention ? 'opacity-100' : 'opacity-0 group-hover/task-scope:opacity-100 group-focus-within/task-scope:opacity-100')}>
        <button type="button" aria-label={t('summary.refresh')} title={t('summary.refresh')} onClick={onRefresh} disabled={loading}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:hover:bg-white/10">
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
        </button>
        <Link data-testid="session-task-ledger-open" to={ledgerPath} title={t('summary.open')}
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10">
          <ExternalLink className="size-3.5" aria-hidden="true" />
          <span className="sr-only">{t('summary.open')}</span>
        </Link>
      </span>
      {open && createPortal(
        <div ref={layerRef} style={popoverStyle} role="dialog" aria-label={title} data-testid="session-task-popover"
          className="w-[min(380px,calc(100vw-16px))] rounded-xl border border-border/70 bg-surface-modal p-1.5 text-xs shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150">
          <div className="flex min-w-0 items-center gap-2 px-2 pb-1 pt-1">
            <span className="shrink-0 font-medium text-foreground">{title}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{statusText}</span>
            <button type="button" onClick={onRefresh} disabled={loading} aria-label={t('summary.refresh')} className="rounded p-1 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10">
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
            </button>
            <Link to={ledgerPath} className="shrink-0 text-muted-foreground hover:text-foreground hover:underline">{t('summary.open')}</Link>
          </div>
          {list}
        </div>, overlayContainer ?? document.body,
      )}
    </section>
  );
}

export function TaskLedgerSummaryPanel({
  workspaceId,
  compact = false,
  hideWhenEmpty = false,
  className,
  onVisibilityChange,
  session,
  binding,
  mode = 'panel',
  projectWide = false,
  refreshKey,
  onTaskSelected,
}: Props) {
  const { t } = useTranslation('taskLedger');
  const [loaded, setLoaded] = useState<{ key: string; snapshot: TaskLedgerSnapshot | null; error?: AppErrorCode } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 960px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 960px)');
    const update = () => setNarrow(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const [selection, setSelection] = useState<{ scope: object; task: string } | null>(null);
  const selectingTaskRef = useRef<object | null>(null);
  const requestVersion = useRef(0);
  const scopeKey = JSON.stringify([workspaceId, session?.key, session?.sessionId]);
  const viewScope = useMemo(() => ({ key: scopeKey }), [scopeKey]);
  const scopeRef = useRef(viewScope); scopeRef.current = viewScope;
  const selectingTask = selection?.scope === viewScope ? selection.task : null;
  const snapshot = loaded?.key === scopeKey ? loaded.snapshot : null;
  const loadError = loaded?.key === scopeKey ? loaded.error : undefined;
  const unavailableText = t(loadError === 'PERMISSION' ? 'summary.permissionDenied' : 'summary.scope.unavailable');

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const result = await hostApi.taskLedger.snapshot(workspaceId ? { workspaceId } : undefined);
      if (workspaceId && result.snapshot.sourceWorkspaceId !== workspaceId) throw new Error('Task Ledger owner scope mismatch');
      if (version === requestVersion.current) setLoaded({ key: scopeKey, snapshot: result.snapshot });
    } catch (error) {
      if (version === requestVersion.current) setLoaded({ key: scopeKey, snapshot: null, error: normalizeAppError(error).code });
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [workspaceId, scopeKey]);

  useEffect(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load, refreshKey]);

  const groups = useMemo(() => {
    const nodesById = new Map((snapshot?.nodes ?? []).map((node) => [node.id, node]));
    const currentGoal = snapshot?.currentGoalId ? nodesById.get(snapshot.currentGoalId) ?? null : null;
    const active = (snapshot?.activeNodeIds ?? []).map((id) => nodesById.get(id)).filter(Boolean) as TaskLedgerNode[];
    const blocked = (snapshot?.blockedNodeIds ?? []).map((id) => nodesById.get(id)).filter(Boolean) as TaskLedgerNode[];
    const review = (snapshot?.reviewNodeIds ?? []).map((id) => nodesById.get(id)).filter(Boolean) as TaskLedgerNode[];
    return { currentGoal, active, blocked, review, decisions: snapshot?.recentDecisions ?? [] };
  }, [snapshot]);

  const hasContent = !!snapshot && snapshot.nodes.length > 0;
  const visible = mode === 'bar' || !hideWhenEmpty || hasContent || Boolean(loadError);
  useEffect(() => {
    onVisibilityChange?.(visible);
  }, [onVisibilityChange, visible]);
  if (!visible) return null;

  const query = new URLSearchParams({ ...(workspaceId ? { workspaceId } : {}), ...(session ? { sessionKey: session.key } : {}) });
  const ledgerPath = `/task-ledger?${query}`;
  if (mode === 'bar' && workspaceId && session) {
    const container = readSessionTaskContainer({ workspaceId, session, binding,
      read: loaded?.key === scopeKey ? { workspaceId, sessionKey: session.key, generation: session.sessionId, snapshot, error: loaded.error } : null });
    const projectReadable = projectWide && ['ready', 'empty'].includes(container.status);
    const nodes = projectReadable ? (snapshot?.nodes ?? []).filter((node) => node.kind === 'task') : container.nodes;
    const status = projectReadable ? nodes.length ? 'ready' : 'empty' : container.status;
    const statusText = loading && !snapshot ? t('summary.loading')
      : status === 'unavailable' ? unavailableText : t(`summary.scope.${status}`);
    const scopeTitle = t(projectWide ? 'summary.projectTasks' : 'summary.sessionTasks');
    /* Only states that ask something of the user are spelled out on the chip;
     * a linked or still-empty scope reads from its count alone. */
    const attention = !(loading && !snapshot) && (status === 'unavailable' || status === 'stale');
    const list = <ul className={cn('space-y-0.5 overflow-y-auto overscroll-contain py-1', narrow ? 'max-h-[70vh]' : 'max-h-64')} data-testid="session-task-list">
      {nodes.map((node) => <li key={node.id} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/5">
        <Link to={`${ledgerPath}&nodeId=${encodeURIComponent(node.id)}`} className="min-w-0 flex-1 truncate text-foreground hover:underline">{node.title}</Link>
        <span className={cn('shrink-0 text-2xs', nodeTone(node))}>{t('summary.recordedStatus', { status: t(`status.${node.status}`) })}</span>
        <button type="button" className="shrink-0 rounded-md px-1.5 py-0.5 text-muted-foreground hover:bg-black/5 hover:text-foreground disabled:opacity-50 dark:hover:bg-white/10"
          data-testid={`session-task-select-${node.id}`} aria-label={t('summary.useTask', { title: node.title })}
          disabled={status !== 'ready' || Boolean(selectingTask) || session.hasActiveRun === true || binding?.activeTaskNodeId === node.id}
          onClick={() => {
            if (selectingTaskRef.current === viewScope) return;
            selectingTaskRef.current = viewScope; setSelection({ scope: viewScope, task: node.id });
            void hostApi.workspaces.selectSessionTask({ workspaceId, sessionKey: session.key, taskNodeId: node.id,
              expectedSessionGeneration: session.sessionId, expectedRevision: binding?.bindingRevision,
            }).then(async () => {
              if (scopeRef.current !== viewScope) return;
              await onTaskSelected?.(); await load();
            }).catch((error) => {
              if (scopeRef.current === viewScope) toast.error(t(String(error).includes('BUSY') || String(error).includes('SWITCH_BLOCKED') ? 'summary.selectBusy' : 'summary.selectFailed'));
            }).finally(() => {
              if (selectingTaskRef.current === viewScope) selectingTaskRef.current = null;
              setSelection((value) => value?.scope === viewScope ? null : value);
            });
          }}>{t(binding?.activeTaskNodeId === node.id ? 'summary.selected' : 'summary.select')}</button>
      </li>)}
      {!nodes.length && <li className="px-2 py-2 text-muted-foreground">{statusText}</li>}
    </ul>;
    return (
      <SessionTaskScopeChip
        className={className}
        state={loading && !snapshot ? 'loading' : status}
        attention={attention}
        loading={loading}
        narrow={narrow}
        expanded={expanded}
        setExpanded={setExpanded}
        title={scopeTitle}
        count={nodes.length}
        statusText={statusText}
        ledgerPath={ledgerPath}
        onRefresh={() => void load()}
        list={list}
        t={t}
      />
    );
  }

  return (
    <aside
      data-testid="task-ledger-summary"
      className={cn(
        'w-full shrink-0 lg:w-72 xl:w-80',
        compact && 'lg:w-64 xl:w-72',
        className,
      )}
      aria-label={t('summary.title')}
    >
      <div className="sticky top-2 max-h-full overflow-hidden rounded-md border border-black/5 bg-background/80 p-3 shadow-sm backdrop-blur dark:border-white/10">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <h2 className="truncate text-xs font-semibold text-foreground">{t('summary.title')}</h2>
              <p className="truncate text-2xs text-muted-foreground">
                {snapshot ? t('summary.counts', { nodes: snapshot.nodes.length, events: snapshot.eventsCount })
                  : loadError && !loading ? unavailableText : t('summary.loading')}
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label={t('summary.refresh')} className="h-7 w-7 shrink-0" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
        </div>

        {!hasContent ? (
          <div className="rounded-md bg-surface-input p-3 text-xs text-muted-foreground">
            {loading ? t('summary.loading') : loadError ? unavailableText : t('summary.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            {groups.currentGoal && (
              <section>
                <p className="mb-1.5 text-2xs font-medium uppercase text-muted-foreground">{t('summary.currentGoal')}</p>
                <NodeLine node={groups.currentGoal} t={t} />
              </section>
            )}
            <section className="grid grid-cols-3 gap-2">
              <div className="rounded-md bg-surface-input p-2 text-center">
                <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">{groups.active.length}</p>
                <p className="text-2xs text-muted-foreground">{t('summary.active')}</p>
              </div>
              <div className="rounded-md bg-surface-input p-2 text-center">
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">{groups.blocked.length}</p>
                <p className="text-2xs text-muted-foreground">{t('summary.blocked')}</p>
              </div>
              <div className="rounded-md bg-surface-input p-2 text-center">
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">{groups.review.length}</p>
                <p className="text-2xs text-muted-foreground">{t('summary.review')}</p>
              </div>
            </section>
            {groups.blocked.length > 0 && (
              <section>
                <p className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium uppercase text-red-700 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  {t('summary.blockers')}
                </p>
                <ul className="space-y-1.5">{groups.blocked.slice(0, 3).map((node) => <NodeLine key={node.id} node={node} t={t} />)}</ul>
              </section>
            )}
            {groups.review.length > 0 && (
              <section>
                <p className="mb-1.5 text-2xs font-medium uppercase text-amber-700 dark:text-amber-400">{t('summary.needsReview')}</p>
                <ul className="space-y-1.5">{groups.review.slice(0, 3).map((node) => <NodeLine key={node.id} node={node} t={t} />)}</ul>
              </section>
            )}
            {groups.decisions.length > 0 && (
              <section>
                <p className="mb-1.5 text-2xs font-medium uppercase text-muted-foreground">{t('summary.decisions')}</p>
                <ul className="space-y-1.5">{groups.decisions.slice(0, 2).map((node) => <NodeLine key={node.id} node={node} t={t} />)}</ul>
              </section>
            )}
          </div>
        )}

        <Button asChild variant="outline" size="sm" className="mt-3 h-8 w-full gap-1.5 text-xs">
          <Link to={groups.currentGoal ? `${ledgerPath}&nodeId=${encodeURIComponent(groups.currentGoal.id)}` : ledgerPath}>
            <GitBranch className="h-3.5 w-3.5" />
            {t('summary.open')}
          </Link>
        </Button>
      </div>
    </aside>
  );
}
