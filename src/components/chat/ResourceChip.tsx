/**
 * ResourceChip shows running resource count in the chat toolbar.
 * Click opens a popover with the full resource list and stop controls.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Loader2, Pause, Play, Server, StopCircle, Trash2, Users, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useResourceStore } from '@/stores/resource-tracker';
import { useTranslation } from 'react-i18next';
import type { TrackedResource } from '@shared/types/resource-tracker';
import type { WorkspaceCoordinatorBinding, WorkspaceCoordinatorRecovery } from '@shared/types/workspace';
import type { RuntimeResourceEnvelopeState } from '@shared/host-api/contract';
import { hostApi } from '@/lib/host-api';
import { createPollScheduler } from '@/lib/poll-scheduler';
import { getWorkspaceCoordinatorBinding } from '@/lib/workspace-session';
import { useChatStore } from '@/stores/chat';
import { useSessionActivityStore, selectSessionActivitySnapshot } from '@/stores/session-activity';
import { useWorkspacesStore } from '@/stores/workspaces';

export function ResourceChip() {
  const { t } = useTranslation('common');
  const {
    resources,
    idleCount,
    unreachableCount,
    idleTimeoutMinutes,
    isInitialized,
    init,
    stopResource,
    stopAll,
  } = useResourceStore();

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [stoppingAll, setStoppingAll] = useState(false);
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const switchSession = useChatStore((state) => state.switchSession);
  const activeTaskNodeId = useChatStore((state) => state.activeTaskNodeId);
  const activeWorkspace = useWorkspacesStore((state) => state.activeWorkspace);
  const generation = useChatStore((state) => state.sessions.find((session) => session.key === currentSessionKey)?.sessionId);
  const activitySnapshot = useSessionActivityStore((state) => selectSessionActivitySnapshot(state, activeWorkspace?.id, currentSessionKey, generation));
  const scope = useMemo(() => ({ workspaceId: activeWorkspace?.id, rootPath: activeWorkspace?.rootPath, sessionKey: currentSessionKey, generation }), [activeWorkspace?.id, activeWorkspace?.rootPath, currentSessionKey, generation]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const [coordinatorBinding, setCoordinatorBinding] = useState<WorkspaceCoordinatorBinding | null>(null);
  const [coordinatorRecovery, setCoordinatorRecovery] = useState<WorkspaceCoordinatorRecovery | null>(null);
  const [resourceEnvelope, setResourceEnvelope] = useState<RuntimeResourceEnvelopeState | null>(null);
  const [coordinatorBusy, setCoordinatorBusy] = useState(false);
  const [coordinatorError, setCoordinatorError] = useState<string | null>(null);
  const agentId = useMemo(() => currentSessionKey.startsWith('agent:') ? currentSessionKey.split(':')[1] || null : null, [currentSessionKey]);
  const cachedBinding = activeWorkspace && agentId
    ? getWorkspaceCoordinatorBinding(activeWorkspace, agentId, currentSessionKey)
    : null;
  const completionBatches = activitySnapshot?.completionBatches ?? [];
  const activeBackgroundTerminalCount = activitySnapshot?.terminals.filter((terminal) => ['starting', 'running', 'idle', 'blocked'].includes(terminal.status)).length ?? 0;
  const loadCoordinator = useCallback(async () => {
    setCoordinatorBinding(null); setCoordinatorRecovery(null); setCoordinatorError(null);
    if (!scope.workspaceId || !agentId || !currentSessionKey) {
      setCoordinatorBinding(null);
      return;
    }
    const [resolved, envelope] = await Promise.allSettled([
      hostApi.workspaces.resolveCoordinator({ workspaceId: scope.workspaceId, agentId, sessionKey: currentSessionKey }),
      hostApi.resourceEnvelope.getState(),
    ]);
    if (scopeRef.current !== scope) return;
    if (resolved.status === 'fulfilled') {
      setCoordinatorBinding(resolved.value.binding ?? null);
      setCoordinatorRecovery(resolved.value.recovery);
    } else {
      setCoordinatorBinding(cachedBinding);
    }
    if (envelope.status === 'fulfilled') setResourceEnvelope(envelope.value);
  }, [agentId, cachedBinding, currentSessionKey, scope]);
  const binding = coordinatorBinding?.workspaceId === activeWorkspace?.id && coordinatorBinding?.sessionKey === currentSessionKey
    ? coordinatorBinding : cachedBinding;
  const runCoordinatorAction = async (action: 'bind' | 'pause' | 'resume') => {
    if (!activeWorkspace || !agentId || !currentSessionKey) return;
    setCoordinatorBusy(true);
    setCoordinatorError(null);
    try {
      if (action === 'pause' && binding) {
        const result = await hostApi.workspaces.pauseCoordinator({
          workspaceId: activeWorkspace.id,
          agentId,
          sessionKey: currentSessionKey,
          expectedRevision: binding.bindingRevision,
        });
        if (scopeRef.current !== scope) return;
        setCoordinatorBinding(result.binding);
        return;
      }
      const taskLedgerNodeIds = binding?.taskLedgerReferences.map((reference) => reference.taskLedgerNodeId)
        ?? (activeTaskNodeId ? [activeTaskNodeId] : []);
      if (taskLedgerNodeIds.length === 0 || !activeWorkspace.rootPath) throw new Error(t('resourceTracker.coordinator.taskRequired'));
      if (!binding && activeTaskNodeId) {
        await hostApi.taskLedger.linkSession({
          workspaceId: activeWorkspace.id,
          nodeId: activeTaskNodeId,
          sessionKey: currentSessionKey,
          agentId,
          relation: 'related',
          idempotencyKey: `coordinator-link-${currentSessionKey}-${activeTaskNodeId}`,
        });
      }
      const environment = binding?.environment
        ? {
            kind: binding.environment.kind,
            rootPath: binding.environment.canonicalRoot,
            setupProfile: binding.environment.setupProfile,
          }
        : { kind: 'local' as const, rootPath: activeWorkspace.rootPath, setupProfile: null };
      const result = await hostApi.workspaces.bindCoordinator({
        workspaceId: activeWorkspace.id,
        agentId,
        sessionKey: currentSessionKey,
        expectedRevision: binding?.bindingRevision ?? 0,
        taskLedgerNodeIds,
        environment,
        archiveRestorePolicy: binding?.archiveRestorePolicy ?? 'restore',
      });
      if (scopeRef.current !== scope) return;
      setCoordinatorBinding(result.binding);
      if (!result.success) setCoordinatorError(result.error ?? result.recovery.reason ?? null);
    } catch (error) {
      if (scopeRef.current === scope) setCoordinatorError(error instanceof Error ? error.message : String(error));
    } finally {
      if (scopeRef.current === scope) setCoordinatorBusy(false);
    }
  };
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    return init();
  }, [init]);

  useEffect(() => {
    if (popoverOpen) void loadCoordinator();
  }, [loadCoordinator, popoverOpen]);
  useEffect(() => { setCoordinatorBusy(false); }, [scope]);

  useEffect(() => {
    return createPollScheduler({ intervalMs: 60_000, task: () => setNowMs(Date.now()) });
  }, []);

  const totalCount = resources.length;
  const hasWarnings = idleCount > 0 || unreachableCount > 0;
  const warningCount = idleCount + unreachableCount;

  if (!isInitialized) return null;
  const coordinatorVisible = Boolean(binding || activeTaskNodeId || resourceEnvelope?.measured || completionBatches.length > 0);
  if (totalCount === 0 && !coordinatorVisible && !popoverOpen) return null;

  const handleStop = async (resourceId: string) => {
    setStoppingId(resourceId);
    await stopResource(resourceId);
    setStoppingId(null);
  };

  const handleStopAll = async () => {
    setStoppingAll(true);
    await stopAll();
    setStoppingAll(false);
    setPopoverOpen(false);
  };

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            data-testid="resource-chip"
            type="button"
            onClick={() => setPopoverOpen((prev) => !prev)}
            aria-label={t('resourceTracker.chip.ariaLabel', { count: totalCount })}
            aria-haspopup="menu"
            aria-expanded={popoverOpen}
            className={cn(
              'inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg px-2 text-2xs font-medium text-muted-foreground transition-colors',
              'hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:hover:bg-white/10',
              popoverOpen && 'bg-black/5 text-foreground dark:bg-white/10',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                totalCount === 0
                  ? 'bg-muted-foreground/40'
                  : hasWarnings
                    ? 'bg-amber-500'
                    : 'bg-emerald-500',
              )}
              aria-hidden="true"
            />
            <Server className="h-4 w-4" />
            <span className="min-w-3 text-center tabular-nums">{totalCount}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('resourceTracker.chip.tooltip', { count: totalCount })}</p>
        </TooltipContent>
      </Tooltip>

      {popoverOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setPopoverOpen(false)}
          />
          <div
            data-testid="resource-popover"
            className={cn(
              'absolute right-0 top-full z-50 mt-2 flex max-h-[min(70vh,30rem)] w-72 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg border border-black/10 bg-surface-modal p-1 shadow-xl dark:border-white/10',
            )}
          >
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <div className="flex min-w-0 items-center gap-2">
                <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <h3 className="truncate text-xs font-medium text-foreground">
                  {t('resourceTracker.popover.title')}
                </h3>
                {warningCount > 0 && (
                  <span className="shrink-0 text-[10px] text-amber-700 dark:text-amber-400">
                    {t('resourceTracker.chip.warningCount', { count: warningCount })}
                  </span>
                )}
              </div>
              <button
                type="button"
                data-testid="resource-popover-close"
                onClick={() => setPopoverOpen(false)}
                aria-label={t('resourceTracker.popover.close')}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 dark:hover:bg-white/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {(binding || activeTaskNodeId || resourceEnvelope?.measured || completionBatches.length > 0) && (
              <section data-testid="long-session-coordinator" className="mx-1 mb-1 rounded-md border border-black/5 bg-foreground/[0.025] p-2 dark:border-white/10">
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                    {t('resourceTracker.coordinator.title')}
                  </span>
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                    binding?.state === 'active'
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : binding?.state
                        ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                        : 'bg-foreground/5 text-muted-foreground',
                  )}>
                    {binding ? t('resourceTracker.coordinator.state.' + binding.state) : t('resourceTracker.coordinator.state.unbound')}
                  </span>
                </div>
                {binding ? (
                  <div className="mt-1.5 space-y-1 text-[10px] text-muted-foreground">
                    <div className="truncate" title={binding.environment.canonicalRoot}>
                      {binding.environment.backend} / {binding.environment.kind} / r{binding.bindingRevision}
                    </div>
                    <div className="truncate">{binding.environment.canonicalRoot}</div>
                    <div data-testid="coordinator-recovery">
                      {t('resourceTracker.coordinator.recovery', { state: coordinatorRecovery?.state ?? 'unknown' })}
                    </div>
                    {binding.invalidationReason && (
                      <div className="flex items-start gap-1 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{binding.invalidationReason}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {binding.taskLedgerReferences.slice(0, 3).map((reference) => (
                        <Link
                          key={reference.taskLedgerNodeId}
                          data-testid={`coordinator-task-ledger-${reference.taskLedgerNodeId}`}
                          to={'/task-ledger?nodeId=' + encodeURIComponent(reference.taskLedgerNodeId)}
                          className="inline-flex max-w-full items-center gap-0.5 rounded bg-foreground/5 px-1.5 py-0.5 text-foreground hover:bg-foreground/10"
                        >
                          <span className="truncate">{reference.taskLedgerNodeId}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </Link>
                      ))}
                    </div>
                    {completionBatches.length > 0 && (
                      <div className="space-y-0.5">
                        {completionBatches.slice(-3).map((batch) => (
                          <div key={batch.batchId} className="flex items-center justify-between gap-2">
                            <button type="button" data-testid={`coordinator-worker-${batch.batchId}`} onClick={() => { const child = batch.members[0]?.childSessionKey; if (child) switchSession(child); }} className="truncate text-left hover:text-foreground">{batch.members.map((member) => member.roleName).join(', ')}</button>
                            <span className="shrink-0 rounded bg-foreground/5 px-1 py-0.5 font-medium text-foreground">
                              {batch.outcome} / {batch.delivery.state}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      data-testid={binding.state === 'active' ? 'coordinator-pause' : 'coordinator-resume'}
                      onClick={() => void runCoordinatorAction(binding.state === 'active' ? 'pause' : 'resume')}
                      disabled={coordinatorBusy}
                      className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-foreground hover:bg-foreground/5 disabled:opacity-50"
                    >
                      {coordinatorBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : binding.state === 'active' ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      {binding.state === 'active' ? t('resourceTracker.coordinator.pause') : t('resourceTracker.coordinator.resume')}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="coordinator-start"
                    onClick={() => void runCoordinatorAction('bind')}
                    disabled={coordinatorBusy || !activeTaskNodeId}
                    className="mt-1.5 inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] text-foreground hover:bg-foreground/5 disabled:opacity-50"
                  >
                    {coordinatorBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    {t('resourceTracker.coordinator.start')}
                  </button>
                )}
                {coordinatorError && <p className="mt-1 text-[10px] text-red-700 dark:text-red-400">{coordinatorError}</p>}
                {resourceEnvelope?.measured && resourceEnvelope.snapshot && (
                  <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 border-t border-black/5 pt-1 text-[10px] text-muted-foreground dark:border-white/10">
                    <span>CPU {resourceEnvelope.snapshot.totals.treeCpuPercent.toFixed(1)}%</span>
                    <span>RSS {Math.round(resourceEnvelope.snapshot.totals.treeRssBytes / 1024 / 1024)} MB</span>
                    <span>{t('resourceTracker.coordinator.processes', { count: resourceEnvelope.snapshot.totals.processCount })}</span>
                    <span>{t('resourceTracker.coordinator.slots', { count: resourceEnvelope.snapshot.totals.activeSlots })}</span>
                    <span>{t('resourceTracker.coordinator.backgroundTerminals', { count: activeBackgroundTerminalCount })}</span>
                    <span>{t('resourceTracker.coordinator.queued', { count: resourceEnvelope.snapshot.totals.queuedCount })}</span>
                  </div>
                )}
              </section>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
              {resources.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                  {t('resourceTracker.popover.empty')}
                </p>
              ) : (
                <div className="space-y-1">
                  {resources.map((resource) => (
                    <ResourceRow
                      key={resource.id}
                      resource={resource}
                      nowMs={nowMs}
                      stopping={stoppingId === resource.id}
                      onStop={() => handleStop(resource.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-black/5 px-2 py-1 dark:border-white/10">
              <p className="min-w-0 truncate text-[10px] text-muted-foreground">
                {t('resourceTracker.popover.autoCleanup', { minutes: idleTimeoutMinutes })}
              </p>
              {resources.length > 1 && (
                <button
                  type="button"
                  data-testid="resource-popover-stop-all"
                  onClick={handleStopAll}
                  disabled={stoppingAll}
                  className={cn(
                    'flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-2xs font-medium text-red-600 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 dark:text-red-400',
                    stoppingAll && 'opacity-60',
                  )}
                >
                  {stoppingAll ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <StopCircle className="h-3.5 w-3.5" />
                  )}
                  {t('resourceTracker.popover.stopAll')}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ResourceRow({
  resource,
  nowMs,
  stopping,
  onStop,
}: {
  resource: TrackedResource;
  nowMs: number;
  stopping: boolean;
  onStop: () => void;
}) {
  const { t } = useTranslation('common');

  const statusLabel = resource.status === 'healthy'
    ? t('resourceTracker.status.healthy')
    : resource.status === 'idle'
      ? t('resourceTracker.status.idle')
      : t('resourceTracker.status.unreachable');
  const statusTone = resource.status === 'healthy'
    ? {
        dot: 'bg-emerald-500',
        text: 'text-emerald-700 dark:text-emerald-400',
      }
    : resource.status === 'idle'
      ? {
          dot: 'bg-amber-500',
          text: 'text-amber-700 dark:text-amber-400',
        }
      : {
          dot: 'bg-red-500',
          text: 'text-red-700 dark:text-red-400',
        };

  const elapsed = resource.startedAt && nowMs > 0
    ? Math.floor((nowMs - new Date(resource.startedAt).getTime()) / 60_000)
    : 0;

  const elapsedLabel = elapsed < 1
    ? t('resourceTracker.timeAgo.justNow')
    : elapsed < 60
      ? t('resourceTracker.timeAgo.m', { count: elapsed })
      : t('resourceTracker.timeAgo.h', { count: Math.floor(elapsed / 60) });

  const fallbackLabel = `localhost:${resource.port}`;
  const label = resource.label || fallbackLabel;

  return (
    <div
      data-testid={`resource-row-${resource.id}`}
      className="group flex items-start gap-2 rounded-md px-2 py-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
    >
      <span
        className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', statusTone.dot)}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium leading-tight text-foreground">
            {label}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            :{resource.port}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-tight text-muted-foreground">
          <span>{t('resourceTracker.pid', { pid: resource.pid })}</span>
          <span aria-hidden="true">/</span>
          <span className={cn('font-medium', statusTone.text)}>{statusLabel}</span>
          <span aria-hidden="true">/</span>
          <span>{elapsedLabel}</span>
        </div>
        {resource.sessionLabel && (
          <div className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground/70">
            {t('resourceTracker.fromSession', { session: resource.sessionLabel })}
          </div>
        )}
      </div>
      <button
        type="button"
        data-testid={`resource-row-stop-${resource.id}`}
        onClick={(event) => {
          event.stopPropagation();
          onStop();
        }}
        disabled={stopping}
        aria-label={t('resourceTracker.stopResource', { label })}
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-colors group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
          'hover:bg-red-500/10 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30',
          stopping && 'opacity-60',
        )}
        title={t('resourceTracker.stop')}
      >
        {stopping ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
