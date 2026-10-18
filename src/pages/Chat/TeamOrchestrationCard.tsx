import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
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
import { AgentRoleIdentity, RoleBadge } from '@/components/agents/AgentAvatar';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import type { AgentSummary } from '@/types/agent';
import type {
  TeamOrchestrationAlertView,
  TeamOrchestrationDiagnosticsView,
  TeamOrchestrationNodeView,
  TeamOrchestrationView,
} from './team-orchestration-visualization';

interface TeamOrchestrationCardProps {
  orchestration: TeamOrchestrationView;
  embedded?: boolean;
}

function statusTone(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'failed' || normalized === 'error' || normalized === 'refuted') {
    return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400';
  }
  if (normalized === 'running') {
    return 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400';
  }
  if (normalized === 'partial' || normalized === 'planned' || normalized === 'ready') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  }
  if (normalized === 'accepted') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  }
  if (normalized === 'verified' || normalized === 'completed') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  }
  if (normalized === 'skipped') return 'border-border bg-black/5 text-muted-foreground dark:bg-white/5';
  return 'border-border bg-surface-input text-muted-foreground';
}

function statusIcon(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'failed' || normalized === 'error' || normalized === 'refuted') {
    return <AlertTriangle className="h-3.5 w-3.5" />;
  }
  if (normalized === 'accepted') {
    return <CircleDashed className="h-3.5 w-3.5" />;
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
    <span className={cn('inline-flex min-w-0 max-w-[11rem] items-center rounded-md border px-2 py-0.5 text-xs font-medium', tone.tint)}>
      <span className="truncate">{role}</span>
    </span>
  );
}

function NodeCard({ node, agent, embedded = false }: { node: TeamOrchestrationNodeView; agent: AgentSummary | null; embedded?: boolean }) {
  const { t } = useTranslation('chat');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const status = node.status ?? 'planned';
  const running = status === 'running';
  return (
    <div className={cn(
      embedded
        ? 'min-w-0 border-l border-conversation py-1 pl-3'
        : 'min-w-0 rounded-xl border border-conversation bg-surface-modal p-3 transition-colors',
      running && (embedded ? 'border-primary/50' : 'border-blue-500/30 bg-blue-500/[0.04] motion-safe:animate-pulse'),
    )}
    data-testid={`chat-team-node-${node.taskNodeId}`}
    data-completion-authority={status === 'accepted' ? 'worker-accepted' : undefined}>
      <div className="flex min-w-0 items-start gap-2.5">
        {agent ? (
          <AgentRoleIdentity agentId={agent.id} name={agent.name} avatar={agent.avatar} roleName={node.roleName} size={36} />
        ) : <RoleBadge roleName={node.roleName} size={28} />}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-foreground" title={agent?.name ?? node.agentId ?? node.roleName}>{agent?.name ?? node.agentId ?? node.roleName}</span>
            <span className="truncate text-xs text-muted-foreground" title={node.roleName}>{node.roleName}</span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          {node.phase && (
            <span className="rounded-md bg-black/5 px-1.5 py-0.5 text-xs text-muted-foreground dark:bg-white/10">
              {t(`teamOrchestration.phase.${node.phase}`, { defaultValue: node.phase })}
            </span>
          )}
          {node.isVerifier && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400">
              <ShieldCheck className="h-3 w-3" />
              {t('teamOrchestration.verifier')}
            </span>
          )}
            <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs', statusTone(status))}>
              {statusIcon(status)}
              {t(`teamOrchestration.status.${status}`, { defaultValue: status })}
            </span>
          </div>
        </div>
      </div>
      {node.task && <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground" title={node.task}>{node.task}</p>}
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          {node.modelRef && <span className="max-w-32 truncate" title={node.modelRef}>{node.modelRef}</span>}
          <span className="shrink-0">{t('teamOrchestration.dependencies', { count: node.dependsOn.length })}</span>
        </div>
        {(node.modelRef || node.childSessionKey || node.roleInstanceId) && (
          <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setDetailsOpen((value) => !value)}>
            {t('teamOrchestration.details')}
            {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        )}
      </div>
      {detailsOpen && (
        <div className="mt-2 space-y-1 border-t border-conversation pt-2 font-mono text-xs text-muted-foreground">
          {node.modelRef && <p className="truncate">{node.modelRef}</p>}
          {node.childSessionKey && <p className="break-all">{node.childSessionKey}</p>}
          {node.roleInstanceId && <p className="break-all">{node.roleInstanceId}</p>}
          {node.dependsOn.length > 0 && <p className="break-all">{node.dependsOn.join(', ')}</p>}
        </div>
      )}
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
          <span className="rounded-md bg-black/5 px-1.5 py-0.5 text-xs dark:bg-white/10">
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
                  <span className="font-mono text-xs opacity-75">{recommendation.code}</span>
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

export function TeamOrchestrationCard({ orchestration, embedded = false }: TeamOrchestrationCardProps) {
  const { t } = useTranslation('chat');
  const agents = useAgentsStore((state) => state.agents);
  const currentAgentId = useChatStore((state) => state.currentAgentId);
  const autoExpanded =
    orchestration.status === 'running'
    || (orchestration.diagnostics?.status != null && orchestration.diagnostics.status !== 'ok');
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? autoExpanded;
  const setExpanded = (value: boolean | ((prev: boolean) => boolean)) => {
    setUserExpanded((prev) => {
      const current = prev ?? autoExpanded;
      return typeof value === 'function' ? value(current) : value;
    });
  };
  const waveSections = useMemo(() => {
    if (orchestration.waves.length === 0) return [{ wave: 1, nodes: orchestration.nodes }];
    const assigned = new Set<string>();
    const sections = orchestration.waves.map((wave) => {
      const nodes = wave.taskNodeIds.flatMap((id) => {
        const node = orchestration.nodes.find((candidate) => candidate.taskNodeId === id);
        if (node) assigned.add(node.taskNodeId);
        return node ? [node] : [];
      });
      return { wave: wave.wave, nodes };
    });
    const remaining = orchestration.nodes.filter((node) => !assigned.has(node.taskNodeId));
    if (remaining.length > 0) sections.push({ wave: sections.length + 1, nodes: remaining });
    return sections;
  }, [orchestration.nodes, orchestration.waves]);
  const resolveNodeAgent = (node: TeamOrchestrationNodeView) => {
    const agentId = node.agentId ?? currentAgentId;
    return agents.find((agent) => agent.id === agentId) ?? null;
  };
  const leadAgent = agents.find((agent) => agent.id === currentAgentId)
    ?? agents.find((agent) => agent.isDefault)
    ?? null;
  const runId = compactId(orchestration.orchestrationRunId);
  const status = orchestration.graphStatus ?? orchestration.status;

  return (
    <div
      data-testid="chat-team-orchestration-card"
      className={cn(
        'w-full min-w-0 text-muted-foreground',
        embedded ? 'py-1' : 'rounded-lg border border-conversation bg-surface-modal px-3 py-3',
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {leadAgent ? (
            <AgentRoleIdentity agentId={leadAgent.id} name={leadAgent.name} avatar={leadAgent.avatar} roleName="lead" size={32} />
          ) : (
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/5 text-muted-foreground dark:bg-white/10">
              <GitBranchPlus className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">{t('teamOrchestration.title')}</p>
              <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium', statusTone(status))}>
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
        {!embedded && (
          <button
            type="button"
            onClick={() => {
              setExpanded((value) => !value);
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            aria-label={expanded ? t('teamOrchestration.collapse') : t('teamOrchestration.expand')}
            title={expanded ? t('teamOrchestration.collapse') : t('teamOrchestration.expand')}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>

      {!embedded && (
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="rounded-md bg-surface-input px-2.5 py-2">
            <p className="text-xs uppercase text-muted-foreground">{t('teamOrchestration.metrics.workers')}</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{orchestration.workerCount}</p>
          </div>
          <div className="rounded-md bg-surface-input px-2.5 py-2">
            <p className="text-xs uppercase text-muted-foreground">{t('teamOrchestration.metrics.waves')}</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{orchestration.waves.length || 1}</p>
          </div>
          <div className="rounded-md bg-surface-input px-2.5 py-2">
            <p className="text-xs uppercase text-muted-foreground">{t('teamOrchestration.metrics.verifier')}</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{orchestration.verifierCount}</p>
          </div>
          <div className="rounded-md bg-surface-input px-2.5 py-2">
            <p className="text-xs uppercase text-muted-foreground">{t('teamOrchestration.metrics.failures')}</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{orchestration.failureCount}</p>
          </div>
        </div>
      )}

      {orchestration.task && (
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{orchestration.task}</p>
      )}

      {!embedded && !expanded && orchestration.waves.length > 0 && (
        <div className="mt-3 space-y-2" data-testid="chat-team-orchestration-waves">
          {orchestration.waves.map((wave) => (
            <div key={wave.wave} className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded-md bg-black/5 px-2 py-1 text-xs font-medium text-muted-foreground dark:bg-white/10">
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

      {(embedded || expanded) && orchestration.routeReasons.length > 0 && (
        <div className="mt-3 rounded-md border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-xs text-blue-700 dark:text-blue-400">
          <p className="font-medium">{t('teamOrchestration.routeReasons')}</p>
          <ul className="mt-1 space-y-1">
            {orchestration.routeReasons.map((reason, index) => (
              <li key={`${reason}-${index}`} className="line-clamp-2">{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {(embedded || expanded) && orchestration.diagnostics && (
        <DiagnosticsPanel diagnostics={orchestration.diagnostics} />
      )}

      {orchestration.alerts.length > 0 && (
        <div className="mt-3 space-y-2">
          {orchestration.alerts.slice(0, embedded || expanded ? orchestration.alerts.length : 2).map((alert, index) => (
            <AlertRow key={`${alert.kind}-${alert.label ?? index}-${index}`} alert={alert} />
          ))}
        </div>
      )}

      {(embedded || expanded) && orchestration.nodes.length > 0 && (
        <div className="mt-4 space-y-4" data-testid="chat-team-orchestration-timeline">
          {waveSections.map((section, index) => (
            <section key={section.wave} className="relative pl-7">
              {index < waveSections.length - 1 && (
                <>
                  <span className="absolute left-[11px] top-7 h-[calc(100%+1rem)] w-px bg-border" />
                  <ArrowDown className="absolute -bottom-3 left-[5px] h-3 w-3 text-muted-foreground" aria-hidden="true" />
                </>
              )}
              <span className={cn(
                'absolute left-0 top-0 flex h-6 w-6 items-center justify-center text-xs font-semibold text-muted-foreground',
                !embedded && 'rounded-full border border-border bg-surface-modal',
              )}>
                {section.wave}
              </span>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-xs font-semibold text-foreground">{t('teamOrchestration.wave', { wave: section.wave })}</p>
                <span className="text-xs text-muted-foreground">{t('teamOrchestration.nodeCount', { count: section.nodes.length })}</span>
              </div>
              <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
                {section.nodes.map((node) => (
                  <NodeCard key={node.taskNodeId} node={node} agent={resolveNodeAgent(node)} embedded={embedded} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
