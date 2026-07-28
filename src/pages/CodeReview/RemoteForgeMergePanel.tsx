import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, GitMerge, Loader2, ShieldCheck, X } from 'lucide-react';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { RemoteForgeMergePayload } from '@shared/host-api/contract';
import type {
  RemoteForgeMergeStrategy,
  RemoteForgeMutationBinding,
  RemoteForgeMutationV1,
  RemoteForgePullRequestReadV1,
} from '@shared/types/remote-forge';
import type { PermissionApprovalEvent } from '@shared/types/workspace';

type PendingMerge = {
  approval: PermissionApprovalEvent;
  binding: RemoteForgeMutationBinding;
  payload: RemoteForgeMergePayload;
};

const strategies: RemoteForgeMergeStrategy[] = ['merge', 'squash', 'rebase'];

export function RemoteForgeMergePanel({
  owner,
  repository,
  pullRequest,
}: {
  owner: string;
  repository: string;
  pullRequest: RemoteForgePullRequestReadV1;
}) {
  const { t } = useTranslation('codeReview');
  const [strategy, setStrategy] = useState<RemoteForgeMergeStrategy>('squash');
  const [commitTitle, setCommitTitle] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [pending, setPending] = useState<PendingMerge | null>(null);
  const [result, setResult] = useState<RemoteForgeMutationV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPending(null);
    setResult(null);
    setError(null);
  }, [pullRequest.detail.headSha, pullRequest.detail.number, pullRequest.readiness.state]);

  const buildPayload = (): RemoteForgeMergePayload | null => {
    if (!pullRequest.detail.headSha) {
      setError(t('remote.merge.errors.missingHead'));
      return null;
    }
    if (pullRequest.readiness.state !== 'ready') {
      setError(t('remote.merge.errors.notReady'));
      return null;
    }
    return {
      provider: 'github',
      owner,
      repository,
      number: pullRequest.detail.number,
      expectedHeadSha: pullRequest.detail.headSha,
      strategy,
      ...(commitTitle.trim() ? { commitTitle } : {}),
      ...(commitMessage ? { commitMessage } : {}),
    };
  };

  const responseError = (response: Awaited<ReturnType<typeof hostApi.remoteForge.mergePullRequest>>) => {
    if (response.policy && !response.policy.allowed) {
      return t(`remote.merge.policy.${response.policy.reason}`);
    }
    if (response.readiness && response.readiness.state !== 'ready') {
      return t('remote.merge.errors.notReady');
    }
    return response.error
      ? t(`remote.merge.errors.${response.error.code}`)
      : t('remote.merge.errors.requestFailed');
  };

  const requestApproval = async () => {
    const payload = buildPayload();
    if (!payload) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await hostApi.remoteForge.mergePullRequest(payload);
      if (response.approvalRequired && response.approval && response.binding) {
        setPending({ approval: response.approval, binding: response.binding, payload });
      } else {
        setError(responseError(response));
      }
    } catch {
      setError(t('remote.merge.errors.requestFailed'));
    } finally {
      setLoading(false);
    }
  };

  const decide = async (decision: 'approved' | 'denied') => {
    if (!pending) return;
    setLoading(true);
    setError(null);
    try {
      const decided = await hostApi.permissions.decideApproval({ id: pending.approval.id, decision });
      if (!decided.success) {
        setError(t('remote.merge.errors.approvalFailed'));
        return;
      }
      if (decision === 'denied') {
        setPending(null);
        return;
      }
      if (!pending.binding.readinessDigest || !pending.binding.sandboxPolicyDigest) {
        setPending(null);
        setError(t('remote.merge.errors.approvalFailed'));
        return;
      }
      const response = await hostApi.remoteForge.mergePullRequest({
        ...pending.payload,
        approvalId: pending.approval.id,
        expectedReadinessDigest: pending.binding.readinessDigest,
        expectedPolicyDigest: pending.binding.sandboxPolicyDigest,
      });
      setPending(null);
      if (response.mutation) setResult(response.mutation);
      if (!response.mutation) setError(responseError(response));
    } catch {
      setError(t('remote.merge.errors.mergeFailed'));
    } finally {
      setLoading(false);
    }
  };

  const locked = loading || pending !== null;
  const ready = pullRequest.readiness.state === 'ready' && Boolean(pullRequest.detail.headSha);

  return (
    <section aria-labelledby="remote-forge-merge" className="border-t border-border/60 pt-5" data-testid="remote-forge-merge-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="remote-forge-merge" className="text-base font-medium text-foreground">{t('remote.merge.title')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('remote.merge.sandboxOnly')}</p>
        </div>
        <span className="rounded-md border border-border bg-surface-modal px-2 py-1 text-xs text-muted-foreground">
          {t('remote.merge.agentOff')}
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-3">
          <label className="block text-sm font-medium text-foreground">
            <span>{t('remote.merge.strategy')}</span>
            <select
              data-testid="remote-forge-merge-strategy"
              disabled={locked}
              value={strategy}
              onChange={(event) => setStrategy(event.target.value as RemoteForgeMergeStrategy)}
              className="mt-2 h-9 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
            >
              {strategies.map((value) => <option key={value} value={value}>{t(`remote.merge.strategies.${value}`)}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-foreground">
            <span>{t('remote.merge.commitTitle')}</span>
            <input
              data-testid="remote-forge-merge-title"
              disabled={locked}
              value={commitTitle}
              onChange={(event) => setCommitTitle(event.target.value)}
              className="mt-2 h-9 w-full rounded-md border border-border bg-surface-input px-3 text-sm outline-none focus:border-foreground/30"
            />
          </label>
          <label className="block text-sm font-medium text-foreground">
            <span>{t('remote.merge.commitMessage')}</span>
            <textarea
              data-testid="remote-forge-merge-message"
              disabled={locked}
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              className="mt-2 min-h-20 w-full resize-y rounded-md border border-border bg-surface-input p-3 text-sm outline-none focus:border-foreground/30"
            />
          </label>
          <button
            type="button"
            data-testid="remote-forge-merge-request"
            disabled={locked || !ready}
            onClick={() => void requestApproval()}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && !pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {t('remote.merge.requestApproval')}
          </button>
        </div>

        <aside className="space-y-3" aria-live="polite">
          {pending && (
            <div data-testid="remote-forge-merge-approval" className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
              <p className="text-sm font-medium">{t('remote.merge.approvalTitle')}</p>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between gap-3"><dt>{t('remote.merge.strategy')}</dt><dd>{t(`remote.merge.strategies.${pending.payload.strategy}`)}</dd></div>
                <div className="flex justify-between gap-3"><dt>{t('remote.merge.head')}</dt><dd className="max-w-36 truncate font-mono">{pending.payload.expectedHeadSha}</dd></div>
              </dl>
              <div className="mt-3 flex gap-2">
                <button type="button" data-testid="remote-forge-merge-deny" disabled={loading} onClick={() => void decide('denied')} className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-current/20 px-3 text-xs font-medium disabled:opacity-60">
                  <X className="h-3.5 w-3.5" />{t('remote.merge.deny')}
                </button>
                <button type="button" data-testid="remote-forge-merge-approve" disabled={loading} onClick={() => void decide('approved')} className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-amber-700 px-3 text-xs font-medium text-white disabled:opacity-60 dark:bg-amber-500 dark:text-black">
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}{t('remote.merge.approveAndMerge')}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div data-testid="remote-forge-merge-error" className="flex gap-2 rounded-md border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}

          {result && (
            <div data-testid="remote-forge-merge-result" className={cn(
              'rounded-md border p-3 text-sm',
              result.state === 'succeeded'
                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : result.state === 'partial'
                  ? 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  : 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400',
            )}>
              <p data-testid="remote-forge-merge-state" className="font-medium">{t(`remote.merge.states.${result.state}`)}</p>
              <ul className="mt-2 space-y-1 text-xs">
                {result.effects.map((effect) => (
                  <li key={`${effect.id}:${effect.operation}`} className="flex justify-between gap-3">
                    <span>{t(`remote.merge.effects.${effect.id}`)}</span>
                    <span>{t(`remote.merge.effectStates.${effect.state}`)}</span>
                  </li>
                ))}
              </ul>
              {result.reconciliation.required && (
                <p data-testid="remote-forge-merge-reconciliation" className="mt-3 text-xs font-medium">
                  {t(`remote.merge.reconciliation.${result.reconciliation.state}`)}
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
