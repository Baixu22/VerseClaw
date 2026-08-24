import { Activity, Archive, Bot, CheckCircle2, CircleAlert, Clock3, Cpu, FilePlus2, GitBranch, GitCommitHorizontal, Goal, ListChecks, Loader2, Monitor, Network, RotateCcw, TerminalSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { SessionActivityGoal, SessionActivityLineage, SessionActivityProcess, SessionActivitySnapshot, SessionActivityTask, SessionActivityTerminal } from '@shared/types/session-activity';

type SessionActivityPanelProps = {
  snapshot: SessionActivitySnapshot;
  compact?: boolean;
  className?: string;
  onOpenRecovery?: () => void;
  onCreateMemoryDraft?: () => void;
  showGit?: boolean;
  showCommands?: boolean;
  onViewCompactionArtifact?: () => void;
};

function formatDuration(startedAt: number | null | undefined, endedAt: number | null | undefined, now: number): string {
  if (!startedAt) return '';
  const elapsed = Math.max(0, (endedAt ?? now) - startedAt);
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function statusIcon(status: SessionActivitySnapshot['session']['status']) {
  if (status === 'running' || status === 'waiting_approval') return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  if (status === 'failed' || status === 'aborted') return <CircleAlert className="h-3.5 w-3.5" />;
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5" />;
  return <Activity className="h-3.5 w-3.5" />;
}

function statusClass(status: string): string {
  if (status === 'running' || status === 'started' || status === 'sleeping' || status === 'exiting') return 'text-sky-700 dark:text-sky-400';
  if (status === 'failed' || status === 'error' || status === 'blocked' || status === 'killed' || status === 'lost') return 'text-red-700 dark:text-red-400';
  if (status === 'completed' || status === 'verified' || status === 'exited') return 'text-emerald-700 dark:text-emerald-400';
  if (status === 'review' || status === 'waiting_approval' || status === 'waiting' || status === 'paused') return 'text-amber-700 dark:text-amber-400';
  return 'text-muted-foreground';
}

function taskLabel(task: SessionActivityTask, t: (key: string, options?: Record<string, unknown>) => string): string {
  return task.title || t(`sessionActivity.taskKinds.${task.kind}`);
}

function terminalLabel(terminal: SessionActivityTerminal, t: (key: string) => string): string {
  if (terminal.kind === 'agentCommand') return t('sessionActivity.terminals.agentCommand');
  if (terminal.kind === 'webPreviewDevServer') return t('sessionActivity.terminals.webPreview');
  return t('sessionActivity.terminals.interactive');
}

function goalLabel(goal: SessionActivityGoal, t: (key: string, options?: Record<string, unknown>) => string): string {
  return goal.label || t('sessionActivity.goalKinds.mission');
}

function processLabel(process: SessionActivityProcess, t: (key: string) => string): string {
  if (process.kind === 'supervisor') return process.label || t('sessionActivity.processKinds.supervisor');
  if (process.kind === 'goalOwned') return process.label || t('sessionActivity.processKinds.goalOwned');
  return process.label || t('sessionActivity.processKinds.bash');
}

function lineageLabel(entry: SessionActivityLineage, t: (key: string) => string): string {
  return entry.role || t(`sessionActivity.lineage.${entry.kind}`);
}

export function SessionActivityPanel({
  snapshot,
  compact = false,
  className,
  onOpenRecovery,
  onCreateMemoryDraft,
  showGit = true,
  showCommands = true,
  onViewCompactionArtifact,
}: SessionActivityPanelProps) {
  const { t } = useTranslation('chat');
  const [now, setNow] = useState(() => Date.now());
  const runActive = snapshot.session.status === 'running' || snapshot.session.status === 'waiting_approval';
  useEffect(() => {
    if (!runActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [runActive, snapshot.session.startedAt]);
  const hasGit = showGit && Boolean(snapshot.git && snapshot.git.isRepository && !snapshot.git.clean);
  const hasTasks = snapshot.tasks.length > 0;
  const hasSubagents = snapshot.subagents.length > 0;
  const hasGoals = snapshot.goals.length > 0;
  const hasProcesses = snapshot.processes.length > 0;
  const hasLineage = snapshot.lineage.length > 0;
  const hasTerminals = showCommands && snapshot.terminals.length > 0;
  const hasContinuity = snapshot.continuity.queueCount > 0
    || Boolean(snapshot.continuity.contextPressure && snapshot.continuity.contextPressure !== 'low')
    || Boolean(snapshot.continuity.checkpoint)
    || Boolean(snapshot.continuity.blockedReason);
  const hasSession = snapshot.session.status !== 'idle' || Boolean(snapshot.session.phase);
  if (!hasSession && !hasGit && !hasTasks && !hasSubagents && !hasGoals && !hasProcesses && !hasLineage && !hasTerminals && !hasContinuity) return null;

  const changes = snapshot.git?.changes.length ?? 0;
  const additions = snapshot.git?.changes.reduce((sum, change) => sum + (change.additions ?? 0), 0) ?? 0;
  const deletions = snapshot.git?.changes.reduce((sum, change) => sum + (change.deletions ?? 0), 0) ?? 0;
  const statusLabel = t(`sessionActivity.status.${snapshot.session.status}`);

  return (
    <aside
      className={cn('flex w-full shrink-0 flex-col overflow-hidden border border-border/70 bg-surface-modal text-sm shadow-sm xl:w-72', className)}
      data-testid="session-activity-panel"
      aria-label={t('sessionActivity.title')}
    >
      <header className="flex items-center gap-2 border-b border-border/70 px-3 py-3">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-full bg-black/5 dark:bg-white/10', statusClass(snapshot.session.status))}>
          {statusIcon(snapshot.session.status)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{t('sessionActivity.title')}</div>
          <div className={cn('truncate text-[11px]', statusClass(snapshot.session.status))}>{statusLabel}{snapshot.session.phase ? ` 路 ${snapshot.session.phase}` : ''}</div>
        </div>
        {onCreateMemoryDraft ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                aria-label={t('sessionActivity.createMemoryDraft')}
                onClick={onCreateMemoryDraft}
                data-testid="session-activity-create-memory-draft"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" collisionPadding={8}>{t('sessionActivity.createMemoryDraft')}</TooltipContent>
          </Tooltip>
        ) : null}
        {onOpenRecovery && hasContinuity ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                aria-label={t('sessionActivity.openRecovery')}
                onClick={onOpenRecovery}
                data-testid="session-activity-open-recovery"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" collisionPadding={8}>{t('sessionActivity.openRecovery')}</TooltipContent>
          </Tooltip>
        ) : null}
        {onViewCompactionArtifact ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                aria-label={t('sessionActivity.viewCompactionArtifact')}
                onClick={onViewCompactionArtifact}
                data-testid="session-activity-view-compaction-artifact"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" collisionPadding={8}>{t('sessionActivity.viewCompactionArtifact')}</TooltipContent>
          </Tooltip>
        ) : null}
      </header>

      <div className={cn('divide-y divide-border/60', compact ? 'max-h-[min(62vh,520px)] overflow-y-auto' : '')}>
        {hasSession ? (
          <section className="px-3 py-3" data-testid="session-activity-session">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />{t('sessionActivity.sections.session')}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t('sessionActivity.duration')}</span>
              <span className="font-mono text-foreground">{formatDuration(snapshot.session.startedAt, snapshot.session.endedAt, now) || t('sessionActivity.notAvailable')}</span>
            </div>
            {snapshot.session.error ? <p className="mt-2 line-clamp-2 text-xs text-red-700 dark:text-red-400">{snapshot.session.error}</p> : null}
          </section>
        ) : null}

        {hasGit ? (
          <section className="px-3 py-3" data-testid="session-activity-git">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <GitBranch className="h-3.5 w-3.5" />{t('sessionActivity.sections.git')}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-mono text-foreground">{snapshot.git?.branch ?? t('sessionActivity.git.detached')}</span>
              <span className="shrink-0 text-muted-foreground">{t('sessionActivity.git.changes', { count: changes })}</span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><GitCommitHorizontal className="h-3 w-3" />+{additions}</span>
              <span>-{deletions}</span>
              {snapshot.git?.hasConflicts ? <span className="text-red-700 dark:text-red-400">{t('sessionActivity.git.conflicts')}</span> : null}
            </div>
          </section>
        ) : null}

        {hasTasks ? (
          <section className="px-3 py-3" data-testid="session-activity-tasks">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <ListChecks className="h-3.5 w-3.5" />{t('sessionActivity.sections.tasks')}
            </div>
            <div className="space-y-2">
              {snapshot.tasks.slice(-4).map((task) => (
                <div key={`${task.kind}:${task.id}`} className="min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={cn('shrink-0', statusClass(task.status))}><Activity className="h-3 w-3" /></span>
                    <span className="min-w-0 flex-1 truncate">{taskLabel(task, t)}</span>
                    <span className={cn('shrink-0 text-[10px]', statusClass(task.status))}>{t(`sessionActivity.taskStatus.${task.status}`)}</span>
                  </div>
                  {typeof task.progress === 'number' ? (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
                      <div className="h-full rounded-full bg-sky-500 transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, task.progress * 100))}%` }} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {hasGoals ? (
          <section className="px-3 py-3" data-testid="session-activity-goals">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <Goal className="h-3.5 w-3.5" />{t('sessionActivity.sections.goals')}
            </div>
            <div className="space-y-2">
              {snapshot.goals.slice(-4).map((goal) => (
                <div key={`${goal.kind}:${goal.id}`} className="min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={cn('shrink-0', statusClass(goal.status))}><Goal className="h-3 w-3" /></span>
                    <span className="min-w-0 flex-1 truncate">{goalLabel(goal, t)}</span>
                    <span className={cn('shrink-0 text-[10px]', statusClass(goal.status))}>{t(`sessionActivity.goalStatus.${goal.status}`)}</span>
                  </div>
                  {typeof goal.progress === 'number' ? (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
                      <div className="h-full rounded-full bg-sky-500 transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, goal.progress * 100))}%` }} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {hasProcesses ? (
          <section className="px-3 py-3" data-testid="session-activity-processes">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <Cpu className="h-3.5 w-3.5" />{t('sessionActivity.sections.processes')}
            </div>
            <div className="space-y-1.5">
              {snapshot.processes.slice(-4).map((process) => (
                <div key={`${process.kind}:${process.id}`} className="flex min-w-0 items-center gap-2 text-xs">
                  <span className={cn('shrink-0', statusClass(process.status))}><Cpu className="h-3 w-3" /></span>
                  <span className="min-w-0 flex-1 truncate">{processLabel(process, t)}</span>
                  <span className={cn('shrink-0 text-[10px]', statusClass(process.status))}>{t(`sessionActivity.processStatus.${process.status}`)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {hasLineage ? (
          <section className="px-3 py-3" data-testid="session-activity-lineage">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <Network className="h-3.5 w-3.5" />{t('sessionActivity.sections.lineage')}
            </div>
            <div className="space-y-1.5">
              {snapshot.lineage.slice(-4).map((entry) => (
                <div key={`${entry.kind}:${entry.id}`} className="flex min-w-0 items-center gap-2 text-xs">
                  <span className={cn('shrink-0', statusClass(entry.status))}><Network className="h-3 w-3" /></span>
                  <span className="min-w-0 flex-1 truncate">{lineageLabel(entry, t)}</span>
                  <span className={cn('shrink-0 text-[10px]', statusClass(entry.status))}>{t(`sessionActivity.lineageStatus.${entry.status}`)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {hasSubagents ? (
          <section className="px-3 py-3" data-testid="session-activity-subagents">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />{t('sessionActivity.sections.subagents')}
            </div>
            <div className="space-y-1.5">
              {snapshot.subagents.slice(-4).map((agent) => (
                <div key={agent.id} className="flex min-w-0 items-center gap-2 text-xs">
                  <span className={cn('shrink-0', statusClass(agent.status))}><Bot className="h-3 w-3" /></span>
                  <span className="min-w-0 flex-1 truncate">{agent.role ?? t('sessionActivity.subagents.unknown')}</span>
                  <span className={cn('shrink-0 text-[10px]', statusClass(agent.status))}>{t(`sessionActivity.subagentStatus.${agent.status}`)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {hasTerminals ? (
          <section className="px-3 py-3" data-testid="session-activity-terminals">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <TerminalSquare className="h-3.5 w-3.5" />{t('sessionActivity.sections.terminals')}
            </div>
            <div className="space-y-1.5">
              {snapshot.terminals.slice(-4).map((terminal) => (
                <div key={terminal.id} className="flex min-w-0 items-center gap-2 text-xs">
                  {terminal.kind === 'interactive' ? <Monitor className="h-3 w-3 shrink-0 text-muted-foreground" /> : <TerminalSquare className="h-3 w-3 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate font-mono">{terminal.cwd || terminalLabel(terminal, t)}</span>
                  <span className={cn('shrink-0 text-[10px]', statusClass(terminal.status))}>{t(`sessionActivity.terminalStatus.${terminal.status}`)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {hasContinuity ? (
          <section className="px-3 py-3" data-testid="session-activity-continuity">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <CircleAlert className={cn('h-3.5 w-3.5', statusClass('blocked'))} />{t('sessionActivity.sections.continuity')}
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {snapshot.continuity.queueCount > 0 ? <div>{t('sessionActivity.continuity.queue', { count: snapshot.continuity.queueCount })}</div> : null}
              {snapshot.continuity.contextPressure && snapshot.continuity.contextPressure !== 'low' ? <div>{t('sessionActivity.continuity.context', { pressure: t(`sessionActivity.continuity.pressure.${snapshot.continuity.contextPressure}`) })}</div> : null}
              {snapshot.continuity.checkpoint ? <div>{t('sessionActivity.continuity.checkpoint')}</div> : null}
              {snapshot.continuity.blockedReason ? <div className="text-red-700 dark:text-red-400">{snapshot.continuity.blockedReason}</div> : null}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
