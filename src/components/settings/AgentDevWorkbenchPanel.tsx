import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, RadioTower, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { hostApi } from '@/lib/host-api';
import { toUserMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';

type AgentDevWorkbenchSnapshot = {
  evidence: Awaited<ReturnType<typeof hostApi.agentDev.workbenchEvidence>>['evidence'];
  status: Awaited<ReturnType<typeof hostApi.agentDev.status>>;
  trace: Awaited<ReturnType<typeof hostApi.agentDev.traceTimeline>>;
  cost: Awaited<ReturnType<typeof hostApi.agentDev.costReport>>;
  sandbox: Awaited<ReturnType<typeof hostApi.agentDev.skillSandboxReport>>;
  selector: Awaited<ReturnType<typeof hostApi.agentDev.selectorContract>>;
};

function statusTone(ok: boolean): string {
  return ok
    ? 'border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
    : 'border-amber-500/30 text-amber-700 dark:text-amber-400';
}

function decisionTone(status: string | null): string {
  if (status === 'blocked') return 'text-red-700 dark:text-red-400';
  if (status === 'needs-full-gate') return 'text-amber-700 dark:text-amber-400';
  if (status === 'daily-loop-ok') return 'text-emerald-700 dark:text-emerald-400';
  return '';
}

export function AgentDevWorkbenchPanel() {
  const { t, i18n } = useTranslation('settings');
  const [snapshot, setSnapshot] = useState<AgentDevWorkbenchSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);

  const loadWorkbench = useCallback(async () => {
    setLoading(true);
    try {
      const [evidence, status, trace, cost, sandbox, selector] = await Promise.all([
        hostApi.agentDev.workbenchEvidence(),
        hostApi.agentDev.status(),
        hostApi.agentDev.traceTimeline({ limit: 25 }),
        hostApi.agentDev.costReport(),
        hostApi.agentDev.skillSandboxReport(),
        hostApi.agentDev.selectorContract(),
      ]);
      setSnapshot({
        evidence: evidence.evidence,
        status,
        trace,
        cost,
        sandbox,
        selector,
      });
    } catch (error) {
      toast.error(t('developer.agentDevWorkbench.loadFailed', { error: toUserMessage(error) || String(error) }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadWorkbench();
  }, [loadWorkbench]);

  const recordScenario = useCallback(async () => {
    setRecording(true);
    try {
      const result = await hostApi.agentDev.recordScenario({
        slug: 'settings-developer-agent-dev-workbench',
        route: '/settings/developer',
        language: i18n.language,
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        visibleState: {
          panel: 'agent-dev-workbench',
          scenarioCount: snapshot?.evidence.scenarioCount ?? null,
          contractGapCount: (
            (snapshot?.evidence.hostApi.missingFacadeActions.length ?? 0)
            + (snapshot?.evidence.hostApi.missingServiceActions.length ?? 0)
          ),
        },
      });
      toast.success(t('developer.agentDevWorkbench.recorded', { path: result.artifactPath }));
      await loadWorkbench();
    } catch (error) {
      toast.error(t('developer.agentDevWorkbench.recordFailed', { error: toUserMessage(error) || String(error) }));
    } finally {
      setRecording(false);
    }
  }, [i18n.language, loadWorkbench, snapshot, t]);

  const gapCount = useMemo(() => {
    if (!snapshot) return 0;
    return snapshot.evidence.hostApi.missingFacadeActions.length
      + snapshot.evidence.hostApi.missingServiceActions.length;
  }, [snapshot]);

  const artifactEntries = snapshot
    ? Object.entries(snapshot.evidence.artifactStatus) as Array<[keyof AgentDevWorkbenchSnapshot['evidence']['artifactStatus'], boolean]>
    : [];
  const contractEntries = snapshot
    ? Object.entries(snapshot.evidence.contracts) as Array<[keyof AgentDevWorkbenchSnapshot['evidence']['contracts'], boolean]>
    : [];

  return (
    <div
      className="space-y-4 rounded-lg border border-black/10 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]"
      data-testid="settings-agent-dev-workbench"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Label className="text-sm font-medium text-foreground">{t('developer.agentDevWorkbench.title')}</Label>
          <p className="mt-1 text-meta text-muted-foreground">{t('developer.agentDevWorkbench.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadWorkbench()}
            disabled={loading}
            className="h-9 rounded-full border-black/10 bg-transparent px-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            data-testid="settings-agent-dev-workbench-refresh"
          >
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
            {loading ? t('common:status.loading') : t('common:actions.refresh')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void recordScenario()}
            disabled={recording || !snapshot}
            className="h-9 rounded-full border-black/10 bg-transparent px-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            data-testid="settings-agent-dev-workbench-record"
          >
            <RadioTower className={cn('mr-1.5 h-3.5 w-3.5', recording && 'animate-pulse')} />
            {recording ? t('common:status.running') : t('developer.agentDevWorkbench.record')}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-surface-modal p-3" data-testid="settings-agent-dev-workbench-scenarios">
          <p className="text-tiny uppercase text-muted-foreground">{t('developer.agentDevWorkbench.scenarios')}</p>
          <p className="mt-1 text-2xl font-semibold">{snapshot?.evidence.scenarioCount ?? '-'}</p>
        </div>
        <div className="rounded-lg bg-surface-modal p-3" data-testid="settings-agent-dev-workbench-contract-gaps">
          <p className="text-tiny uppercase text-muted-foreground">{t('developer.agentDevWorkbench.contractGaps')}</p>
          <p className={cn('mt-1 text-2xl font-semibold', gapCount > 0 && 'text-amber-700 dark:text-amber-400')}>
            {snapshot ? gapCount : '-'}
          </p>
        </div>
        <div className="rounded-lg bg-surface-modal p-3" data-testid="settings-agent-dev-workbench-trace-events">
          <p className="text-tiny uppercase text-muted-foreground">{t('developer.agentDevWorkbench.traceEvents')}</p>
          <p className="mt-1 text-2xl font-semibold">{snapshot?.trace.events.length ?? '-'}</p>
        </div>
        <div className="rounded-lg bg-surface-modal p-3" data-testid="settings-agent-dev-workbench-total-tokens">
          <p className="text-tiny uppercase text-muted-foreground">{t('developer.agentDevWorkbench.totalTokens')}</p>
          <p className="mt-1 text-2xl font-semibold">{snapshot?.cost.report.totals.totalTokens ?? '-'}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-surface-modal p-3" data-testid="settings-agent-dev-workbench-evidence-age">
          <p className="text-tiny uppercase text-muted-foreground">{t('developer.agentDevWorkbench.evidenceAge')}</p>
          <p className={cn(
            'mt-1 text-2xl font-semibold',
            snapshot
              && snapshot.evidence.evidenceAgeHours != null
              && (snapshot.evidence.maxEvidenceAgeHours == null || snapshot.evidence.evidenceAgeHours > snapshot.evidence.maxEvidenceAgeHours)
              && 'text-red-700 dark:text-red-400',
          )}>
            {snapshot
              ? (snapshot.evidence.evidenceAgeHours == null
                ? t('developer.agentDevWorkbench.unavailable')
                : `${snapshot.evidence.evidenceAgeHours.toFixed(1)}h`)
              : '-'}
          </p>
          {snapshot && snapshot.evidence.maxEvidenceAgeHours != null && (
            <p className="mt-0.5 text-tiny text-muted-foreground">
              {t('developer.agentDevWorkbench.evidenceWindow', { hours: snapshot.evidence.maxEvidenceAgeHours })}
            </p>
          )}
        </div>
        <div className="rounded-lg bg-surface-modal p-3" data-testid="settings-agent-dev-workbench-decision">
          <p className="text-tiny uppercase text-muted-foreground">{t('developer.agentDevWorkbench.decisionStatus')}</p>
          <p className={cn('mt-1 text-2xl font-semibold', snapshot && decisionTone(snapshot.evidence.decisionStatus))}>
            {snapshot
              ? (snapshot.evidence.decisionStatus ?? t('developer.agentDevWorkbench.unavailable'))
              : '-'}
          </p>
        </div>
        <div className="rounded-lg bg-surface-modal p-3 sm:col-span-2" data-testid="settings-agent-dev-workbench-required-gates">
          <p className="text-tiny uppercase text-muted-foreground">{t('developer.agentDevWorkbench.requiredGates')}</p>
          {snapshot && snapshot.evidence.requiredFullGates.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {snapshot.evidence.requiredFullGates.map((command) => (
                <li key={command} className="font-mono">{command}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-2xl font-semibold">
              {snapshot ? t('developer.agentDevWorkbench.requiredGatesNone') : '-'}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground/80">{t('developer.agentDevWorkbench.contracts')}</p>
          <div className="flex flex-wrap gap-2">
            {contractEntries.map(([key, ok]) => (
              <Badge key={key} variant="outline" className={cn('rounded-full', statusTone(ok))}>
                <ShieldCheck className="mr-1 h-3 w-3" />
                {t(`developer.agentDevWorkbench.contractLabels.${key}`)}
              </Badge>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-foreground/80">{t('developer.agentDevWorkbench.artifacts')}</p>
          <div className="flex flex-wrap gap-2">
            {artifactEntries.map(([key, ok]) => (
              <Badge key={key} variant="outline" className={cn('rounded-full', statusTone(ok))}>
                {t(`developer.agentDevWorkbench.artifactLabels.${key}`)}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {snapshot && (
        <div className="grid gap-3 text-xs md:grid-cols-3">
          {(['fastPr', 'fullLocal', 'nightlyRelease'] as const).map((gate) => (
            <div key={gate} className="rounded-lg border border-black/5 bg-surface-modal p-3 dark:border-white/5">
              <p className="mb-2 font-semibold text-foreground/80">
                {t(`developer.agentDevWorkbench.gates.${gate}`)}
              </p>
              <ul className="space-y-1 text-muted-foreground">
                {snapshot.evidence.gateCommands[gate].map((command) => (
                  <li key={command} className="font-mono">{command}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {snapshot && (
        <p className="text-tiny text-muted-foreground" data-testid="settings-agent-dev-workbench-diagnostics">
          {t('developer.agentDevWorkbench.diagnostics', {
            mockCalls: snapshot.status.mockReplay.callCount,
            sandboxEffects: snapshot.sandbox.report.effects.length,
            selectorSurfaces: snapshot.selector.requiredSurfaces.length,
          })}
        </p>
      )}
    </div>
  );
}
