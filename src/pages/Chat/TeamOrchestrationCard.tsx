import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  GitBranchPlus,
  Route,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { roleTone, toneClasses } from '@/lib/role-visuals';
import type {
  TeamOrchestrationAlertView,
  TeamOrchestrationDiagnosticsView,
  TeamOrchestrationNodeView,
  TeamOrchestrationView,
} from './team-orchestration-visualization';

interface TeamOrchestrationCardProps {
  orchestration: TeamOrchestrationView;
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'failed' || normalized === 'error' || normalized === 'refuted') {
    return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400';
  }
  if (normalized === 'partial' || normalized === 'running' || normalized === 'planned') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  }
  if (normalized === 'verified' || normalized === 'completed') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  }
  return 'border-border bg-surface-input text-muted-foreground';
}

function statusIcon(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'failed' || normalized === 'error' || normalized === 'refuted') {
    return <AlertTriangle className="h-3.5 w-3.5" />;
  }
  if (normalized === 'verified' || normalized === 'completed') {
    return <CheckCircle2 className="h-3.5 w-3.5" />;
  }
  return <CircleDashed className="h-3.5 w-3.5" />;
}

function compactId(value: string | undefined): string | null {
  if (!value) return null;
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function RoleChip({ role }: { role: string }) {
  const tone = toneClasses(roleTone(role));
  return (
    <span className={cn('inline-flex min-w-0 max-w-[11rem] items-center rounded-md border px-2 py-0.5 text-2xs font-medium', tone.tint)}>
      <span className="truncate">{role}</span>
    </span>
  );
}

function NodeRow({ node }: { node: TeamOrchestrationNodeView }) {
  const { t } = useTranslation('chat');
  const tone = toneClasses(roleTone(node.roleName));
  return (
    <div className="flex min-w-0 items-start gap-2 border-t border-border/60 py-2 first:border-t-0">
      <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', tone.dot)} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-xs font-medium text-foreground">{node.roleName}</span>
          {node.phase && (
            <span className="rounded-md bg-black/5 px-1.5 py-0.5 text-2xs text-muted-foreground dark:bg-white/10">
              {t(`teamOrchestration.phase.${node.phase}`, { defaultValue: node.phase })}
            </span>
          )}
          {node.isVerifier && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-2xs text-amber-700 dark:text-amber-400">
              <ShieldCheck className="h-3 w-3" />
              {t('teamOrchestration.verifier')}
            </span>
          )}
          {node.status && (
            <span className={cn('rounded-md border px-1.5 py-0.5 text-2xs', statusTone(node.status))}>
              {t(`teamOrchestration.status.${node.status}`, { defaultValue: node.status })}
            </span>
          )}
        </div>
        {node.task && (
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{node.task}</p>
        )}
      </div>
    </div>
  );
}

function AlertRow({ alert }: { alert: TeamOrchestrationAlertView }) {
  const { t } = useTranslation('chat');
  const icon = alert.kind === 'repair'
    ? <Wrench className="h-3.5 w-3.5" />
    : alert.kind === 'reroute'
      ? <Route className="h-3.5 w-3.5" />
      : <AlertTriangle className="h-3.5 w-3.5" />;
  const tone = alert.kind === 'failure' || alert.kind === 'reroute'
    ? 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400'
    : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400';

  return (
    <div className={cn('flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-2 text-xs', tone)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="font-medium">
          {t(`teamOrchestration.alert.${alert.kind}`)}
          {alert.label ? ` · ${alert.label}` : ''}
        </p>
        {alert.detail && <p className="mt-0.5 line-clamp-2 opacity-85">{alert.detail}</p>}
      </div>
    </div>
  );
}

function DiagnosticsPanel({ diagnostics }: { diagnostics: TeamOrchestrationDiagnosticsView }) {
  const { t } = useTranslation('chat');
  const hasRecommendations = diagnostics.recommendations.length > 0;
  const hasNextSteps = diagnostics.nextSteps.length > 0;

  return (
    <div
      data-testid="chat-team-orchestration-diagnostics"
      className="mt-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <p className="font-medium">{t('teamOrchestration.diagnostics.title')}</p>
        {diagnostics.status && (
          <span className="rounded-md bg-black/5 px-1.5 py-0.5 text-2xs dark:bg-white/10">
            {t(`teamOrchestration.diagnostics.status.${diagnostics.status}`, { defaultValue: diagnostics.status })}
          </span>
        )}
      </div>
      {diagnostics.summary && <p className="mt-1 leading-5 opacity-90">{diagnostics.summary}</p>}
      {hasRecommendations && (
        <div className="mt-2 space-y-1.5">
          <p className="font-medium">{t('teamOrchestration.diagnostics.recommendations')}</p>
          {diagnostics.recommendations.map((recommendation, index) => (
            <div key={`${recommendation.code ?? 'diagnostic'}-${recommendation.roleName ?? index}`} className="rounded-md bg-background/45 px-2 py-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {recommendation.roleName && <RoleChip role={recommendation.roleName} />}
                {recommendation.code && (
                  <span className="font-mono text-2xs opacity-75">{recommendation.code}</span>
                )}
              </div>
              {recommendation.message && <p className="mt-1 leading-5">{recommendation.message}</p>}
              {recommendation.recommendedAction && <p className="mt-0.5 leading-5 opacity-85">{recommendation.recommendedAction}</p>}
            </div>
          ))}
        </div>
      )}
      {hasNextSteps && (
        <div className="mt-2">
          <p className="font-medium">{t('teamOrchestration.diagnostics.nextSteps')}</p>
          <ul className="mt-1 space-y-1">
            {diagnostics.nextSteps.map((step, index) => (
              <li key={`${step}-${index}`} className="leading-5">{step}</li>
            ))}
          </ul>
        </div>
      )}
      {diagnostics.taskLoopUpgradeAvailable && (
        <p className="mt-2 leading-5 opacity-85">{t('teamOrchestration.diagnostics.taskLoopUpgrade')}</p>
      )}
    </div>
  );
}

export function TeamOrchestrationCard({ orchestration }: TeamOrchestrationCardProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(
    orchestration.status === 'running' || (orchestration.diagnostics?.status != null && orchestration.diagnostics.status !== 'ok'),
  );
  const visibleNodes = useMemo(
    () => orchestration.nodes.slice(0, expanded ? orchestration.nodes.length : 4),
    [expanded, orchestration.nodes],
  );
  const runId = compactId(orchestration.orchestrationRunId);
  const status = orchestration.graphStatus ?? orchestration.status;
  const hiddenNodeCount = Math.max(0, orchestration.nodes.length - visibleNodes.length);

  return (
    <div
      data-testid="chat-team-orchestration-card"
      className="w-full rounded-lg border border-border/70 bg-surface-modal px-3 py-3 text-muted-foreground shadow-sm"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/5 text-muted-foreground dark:bg-white/10">
            <GitBranchPlus className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">{t('teamOrchestration.title')}</p>
              <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-2xs font-medium', statusTone(status))}>
                {statusIcon(status)}
                {t(`teamOrchestration.status.${status}`, { defaultValue: status })}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {runId && <span className="font-mono">{runId}</span>}
              {orchestration.graphMode && <span>{t('teamOrchestration.mode', { mode: orchestration.graphMode })}</span>}
              {orchestration.templateId && <span>{t('teamOrchestration.template', { template: orchestration.templateId })}</span>}
              {orchestration.pendingVerifier && <span>{t('teamOrchestration.pendingVerifier')}</span>}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          aria-label={expanded ? t('teamOrchestration.collapse') : t('teamOrchestration.expand')}
          title={expanded ? t('teamOrchestration.collapse') : t('teamOrchestration.expand')}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-md bg-surface-input px-2.5 py-2">
          <p className="text-2xs uppercase text-muted-foreground">{t('teamOrchestration.metrics.workers')}</p>
          <p className="mt-0.5 text-sm font-medium text-foreground">{orchestration.workerCount}</p>
        </div>
        <div className="rounded-md bg-surface-input px-2.5 py-2">
          <p className="text-2xs uppercase text-muted-foreground">{t('teamOrchestration.metrics.waves')}</p>
          <p className="mt-0.5 text-sm font-medium text-foreground">{orchestration.waves.length || 1}</p>
        </div>
        <div className="rounded-md bg-surface-input px-2.5 py-2">
          <p className="text-2xs uppercase text-muted-foreground">{t('teamOrchestration.metrics.verifier')}</p>
          <p className="mt-0.5 text-sm font-medium text-foreground">{orchestration.verifierCount}</p>
        </div>
        <div className="rounded-md bg-surface-input px-2.5 py-2">
          <p className="text-2xs uppercase text-muted-foreground">{t('teamOrchestration.metrics.signals')}</p>
          <p className="mt-0.5 text-sm font-medium text-foreground">{orchestration.alerts.length}</p>
        </div>
      </div>

      {orchestration.task && (
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{orchestration.task}</p>
      )}

      {orchestration.waves.length > 0 && (
        <div className="mt-3 space-y-2" data-testid="chat-team-orchestration-waves">
          {orchestration.waves.map((wave) => (
            <div key={wave.wave} className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded-md bg-black/5 px-2 py-1 text-2xs font-medium text-muted-foreground dark:bg-white/10">
                {t('teamOrchestration.wave', { wave: wave.wave })}
              </span>
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {wave.roles.map((role, index) => (
                  <RoleChip key={`${wave.wave}-${role}-${index}`} role={role} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {expanded && orchestration.routeReasons.length > 0 && (
        <div className="mt-3 rounded-md border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-xs text-blue-700 dark:text-blue-400">
          <p className="font-medium">{t('teamOrchestration.routeReasons')}</p>
          <ul className="mt-1 space-y-1">
            {orchestration.routeReasons.map((reason, index) => (
              <li key={`${reason}-${index}`} className="line-clamp-2">{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {expanded && orchestration.diagnostics && (
        <DiagnosticsPanel diagnostics={orchestration.diagnostics} />
      )}

      {orchestration.alerts.length > 0 && (
        <div className="mt-3 space-y-2">
          {orchestration.alerts.slice(0, expanded ? orchestration.alerts.length : 2).map((alert, index) => (
            <AlertRow key={`${alert.kind}-${alert.label ?? index}-${index}`} alert={alert} />
          ))}
        </div>
      )}

      {orchestration.nodes.length > 0 && (
        <div className="mt-3 rounded-md bg-surface-input px-2.5 py-1">
          {visibleNodes.map((node) => (
            <NodeRow key={node.taskNodeId} node={node} />
          ))}
          {hiddenNodeCount > 0 && (
            <button
              type="button"
              className="w-full border-t border-border/60 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setExpanded(true)}
            >
              {t('teamOrchestration.showMoreNodes', { count: hiddenNodeCount })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
