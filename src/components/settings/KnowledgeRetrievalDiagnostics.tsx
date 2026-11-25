import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { KnowledgeObservabilityResult, RetrievalObservabilitySnapshotV1 } from '@shared/knowledge/observability';

export function KnowledgeRetrievalDiagnostics() {
  const { t } = useTranslation('settings');
  const workspaceId = useWorkspacesStore(state => state.activeWorkspaceId);
  const [snapshot, setSnapshot] = useState<RetrievalObservabilitySnapshotV1>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const epoch = useRef(0);
  const run = async (operation: () => Promise<KnowledgeObservabilityResult>) => {
    const current = epoch.current;
    setBusy(true); setFailed(false);
    try {
      const result = await operation();
      if (current !== epoch.current) return;
      if (!result.success || !result.observability || result.observability.workspaceId !== workspaceId)
        throw new Error('Retrieval diagnostics unavailable');
      setSnapshot(result.observability);
    } catch { if (current === epoch.current) { setFailed(true); setSnapshot(undefined); } }
    finally { if (current === epoch.current) setBusy(false); }
  };
  useEffect(() => {
    epoch.current += 1; setSnapshot(undefined); setFailed(false); setBusy(false);
    return () => { epoch.current += 1; };
  }, [workspaceId]);
  return <div className="space-y-3 border-t border-border/60 pt-4" data-testid="retrieval-diagnostics">
    <h3 className="font-serif text-lg font-normal tracking-tight">{t('retrievalDiagnostics.title')}</h3>
    <p className="text-sm text-muted-foreground">{t('retrievalDiagnostics.description')}</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" data-testid="retrieval-diagnostics-refresh" disabled={busy || !workspaceId}
        onClick={() => void run(hostApi.knowledge.observabilityStatus)}>{t('retrievalDiagnostics.refresh')}</Button>
      <Button variant="outline" disabled={busy || !workspaceId}
        onClick={() => void run(() => hostApi.knowledge.policyPromote({ operationId: crypto.randomUUID() }))}>
        {t('retrievalDiagnostics.importPolicy')}
      </Button>
    </div>
    {snapshot && <>
      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div><dt>{t('retrievalDiagnostics.samples')}</dt><dd data-testid="retrieval-samples">{snapshot.slo.sampleCount}</dd></div>
        <div><dt>{t('retrievalDiagnostics.p95')}</dt><dd>{snapshot.slo.p95Ms ?? t('retrievalDiagnostics.unknown')}</dd></div>
        <div><dt>{t('retrievalDiagnostics.unknownUsage')}</dt><dd>{snapshot.slo.unknownUsageCount}</dd></div>
        <div><dt>{t('retrievalDiagnostics.calibration')}</dt><dd>{t(`retrievalDiagnostics.calibrationStates.${snapshot.slo.calibration}`)}</dd></div>
      </dl>
      <ul className="space-y-2 text-sm">
        {snapshot.policies.map(policy => <li key={policy.active.profile} className="flex flex-wrap items-center gap-2">
          <span>{t(`operations.profiles.${policy.active.profile}`)}: {policy.active.version}</span>
          <Button variant="ghost" size="sm" disabled={busy || !policy.previous}
            data-testid={`retrieval-policy-rollback-${policy.active.profile}`}
            onClick={() => void run(() => hostApi.knowledge.policyRollback({ operationId: crypto.randomUUID(),
              profile: policy.active.profile, expectedPolicyDigest: policy.digest }))}>{t('retrievalDiagnostics.rollback')}</Button>
        </li>)}
      </ul>
      <ul className="space-y-2" data-testid="retrieval-receipts">
        {snapshot.receipts.map(receipt => <li key={receipt.receiptId} className="rounded-lg border border-border/60 p-3 text-sm">
          <p className="break-all font-mono text-xs">{receipt.requestId}</p>
          <p>{t('retrievalDiagnostics.receiptSummary', { sources: receipt.sources.length, milliseconds: receipt.elapsedMs,
            cost: receipt.usage.costUsd ?? t('retrievalDiagnostics.unknown') })}</p>
          {receipt.modelRuns.length > 0 && <p>{t('retrievalDiagnostics.modelUsage', {
            tokens: receipt.usage.totalModelTokens ?? t('retrievalDiagnostics.unknown'),
            cost: receipt.usage.modelCostUsd ?? t('retrievalDiagnostics.unknown'),
          })}</p>}
          <details className="my-2" data-testid="retrieval-stage-details">
            <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{t('retrievalDiagnostics.stageDetails')}</summary>
            <p>{t('retrievalDiagnostics.effectiveProfile', { profile: t(`retrievalDiagnostics.profiles.${receipt.effectiveProfile ?? 'unknown'}`) })}</p>
            <ul className="space-y-1 py-2">
              {receipt.stages.map((stage, index) => <li key={`${stage.stage}-${index}`}>
                {t('retrievalDiagnostics.stageSummary', { stage: t(`retrievalDiagnostics.stages.${stage.stage}`, { defaultValue: stage.stage }),
                  status: t(`retrievalDiagnostics.statuses.${stage.status}`, { defaultValue: t('retrievalDiagnostics.unknown') }), count: stage.candidateCount, milliseconds: Math.round(stage.elapsedMs) })}
              </li>)}
              {receipt.modelRuns.map(run => <li key={run.runId}>
                {t('retrievalDiagnostics.modelStage', { stage: t(`retrievalDiagnostics.stages.${run.purpose ?? 'answer'}`),
                  milliseconds: run.elapsedMs === undefined ? t('retrievalDiagnostics.unknown') : Math.round(run.elapsedMs) })}
                {run.support && <span> · {t('retrievalDiagnostics.supportSummary', run.support)}</span>}
              </li>)}
            </ul>
            {receipt.dcs && <p>{t('retrievalDiagnostics.retained', { count: receipt.dcs.retainedSourceDigests.length })}</p>}
            {receipt.fallbackCodes.length > 0 && <p className="break-all text-xs text-muted-foreground">{receipt.fallbackCodes.join(' · ')}</p>}
          </details>
          <div className="flex gap-2">
            {(['attach', 'dismiss'] as const).map(action => <Button key={action} variant="ghost" size="sm" disabled={busy}
              onClick={() => void run(() => hostApi.knowledge.retrievalFeedback({ operationId: crypto.randomUUID(), receiptId: receipt.receiptId, action }))}>
              {t(`retrievalDiagnostics.${action}`)} ({receipt.feedback[action]})
            </Button>)}
          </div>
        </li>)}
      </ul>
      {snapshot.promotions[0] && <p role="status" data-testid="retrieval-policy-decision" className="text-sm text-muted-foreground">
        {t(`retrievalDiagnostics.decisions.${snapshot.promotions[0].decision}`)}
      </p>}
    </>}
    {failed && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{t('retrievalDiagnostics.failed')}</p>}
  </div>;
}
