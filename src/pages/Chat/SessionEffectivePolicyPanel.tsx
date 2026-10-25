import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  SessionEffectivePolicy,
  SessionPolicyFact,
  SessionPolicyFactState,
} from '@shared/types/session-effective-policy';

type SessionEffectivePolicyPanelProps = {
  policy: SessionEffectivePolicy | null;
  className?: string;
};

function stateTone(state: SessionPolicyFactState | SessionEffectivePolicy['generation']['state']): string {
  if (state === 'effective' || state === 'current') return 'ok';
  if (state === 'configured' || state === 'ignored') return 'idle';
  return 'warn';
}

function FactRow({
  label,
  fact,
  value,
  detail,
  testId,
}: {
  label: string;
  fact: SessionPolicyFact<unknown> | null;
  value: string;
  detail?: string | null;
  testId: string;
}) {
  const { t } = useTranslation('chat');
  const state = fact?.state ?? 'unknown';
  return (
    <div className="codex-session-policy__row" data-testid={testId}>
      <div className="codex-session-policy__row-head">
        <span className="codex-session-policy__label">{label}</span>
        <span className="codex-session-policy__badge" data-state={stateTone(state)}>
          {t(`sessionPolicy.states.${state}`)}
        </span>
      </div>
      <div className="codex-session-policy__value">{value}</div>
      {fact ? <div className="codex-session-policy__source">{t('sessionPolicy.source', { source: fact.source })}</div> : null}
      {fact?.reason || detail ? <div className="codex-session-policy__reason">{fact?.reason ?? detail}</div> : null}
    </div>
  );
}

export function SessionEffectivePolicyPanel({ policy, className }: SessionEffectivePolicyPanelProps) {
  const { t } = useTranslation('chat');
  if (!policy) {
    return (
      <section className={cn('codex-session-policy', className)} data-testid="session-policy-summary" data-state="warn">
        <div className="codex-session-policy__head">
          <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
          <span>{t('sessionPolicy.title')}</span>
          <span className="codex-session-policy__badge" data-state="warn">{t('sessionPolicy.states.unknown')}</span>
        </div>
        <p className="codex-session-policy__empty" data-testid="session-policy-unavailable">{t('sessionPolicy.unavailable')}</p>
      </section>
    );
  }

  const backend = policy.backend.effective.value;
  const model = policy.model.effective.value ?? policy.model.configured.value;
  const actions = policy.grant.effectiveActions.value;
  const contextValue = policy.limits.context.value;
  const queue = policy.limits.queue.value;
  const compactionOwner = t(`sessionPolicy.compactionOwner.${policy.backend.compatibility.nativeCompactionOwner}`);
  const compatibilityDetail = policy.backend.compatibility.parameters
    .map((entry) => `${entry.path}: ${t(`sessionPolicy.states.${entry.state}`)}${entry.reason ? ` — ${entry.reason}` : ''}`)
    .join('\n');
  return (
    <section className={cn('codex-session-policy', className)} data-testid="session-policy-summary" data-state={stateTone(policy.generation.state)}>
      <div className="codex-session-policy__head">
        <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
        <span>{t('sessionPolicy.title')}</span>
        <span className="codex-session-policy__badge" data-state={stateTone(policy.generation.state)} data-testid="session-policy-generation">
          {t(`sessionPolicy.generation.${policy.generation.state}`)}
        </span>
      </div>
      <div className="codex-session-policy__rows">
        <FactRow
          label={t('sessionPolicy.backend')}
          fact={policy.backend.effective}
          value={backend ? `${backend.kind}${backend.nativeThreadId ? ` · ${backend.nativeThreadId}` : backend.nativeSessionId ? ` · ${backend.nativeSessionId}` : ''}` : '—'}
          detail={policy.backend.configured.value ? `${t('sessionPolicy.configured')}: ${policy.backend.configured.value}` : null}
          testId="session-policy-backend"
        />
        <FactRow
          label={t('sessionPolicy.binding')}
          fact={policy.backend.binding}
          value={policy.backend.binding.value ? `${policy.backend.binding.value.kind}: ${policy.backend.binding.value.id}` : '—'}
          testId="session-policy-binding"
        />
        <FactRow
          label={t('sessionPolicy.model')}
          fact={policy.model.effective}
          value={model ? `${model.provider ?? '—'} / ${model.model ?? '—'}${policy.model.effort.value ? ` · ${policy.model.effort.value}` : ''}` : '—'}
          testId="session-policy-model"
        />
        <FactRow
          label={t('sessionPolicy.grant')}
          fact={policy.grant.effectiveActions}
          value={actions ? t('sessionPolicy.actionCount', { allowed: actions.allowed.length, approval: actions.requiresApproval.length, unknown: actions.unknown.length }) : `${policy.grant.mode.value ?? '—'}`}
          testId="session-policy-grant"
        />
        <FactRow
          label={t('sessionPolicy.limits')}
          fact={policy.limits.context}
          value={contextValue ? `${contextValue.usedTokens ?? '—'} / ${contextValue.contextTokenBudget ?? '—'} · ${t('sessionPolicy.queue')}: ${queue?.cap ?? '—'}` : `${t('sessionPolicy.queue')}: ${queue?.cap ?? '—'}`}
          detail={`${t('sessionPolicy.resources')}: ${t(`sessionPolicy.states.${policy.limits.resources.state}`)} · ${t('sessionPolicy.schedule')}: ${t(`sessionPolicy.states.${policy.limits.schedule.state}`)}`}
          testId="session-policy-limits"
        />
        <FactRow
          label={t('sessionPolicy.compaction')}
          fact={null}
          value={compactionOwner}
          detail={compatibilityDetail || null}
          testId="session-policy-compaction"
        />
      </div>
      {policy.diagnostics.length > 0 ? (
        <div className="codex-session-policy__diagnostics" data-testid="session-policy-diagnostics">
          {policy.diagnostics.map((diagnostic) => (
            <p key={`${diagnostic.code}:${diagnostic.message}`} data-state={diagnostic.severity === 'error' ? 'error' : 'warn'}>{diagnostic.message}</p>
          ))}
        </div>
      ) : null}
      <details className="codex-session-policy__help" data-testid="session-policy-lifecycle-help" open>
        <summary>{t('sessionPolicy.lifecycle.title')}</summary>
        <ul>
          <li>{t('sessionPolicy.lifecycle.abort')}</li>
          <li>{t('sessionPolicy.lifecycle.retention')}</li>
          <li>{t('sessionPolicy.lifecycle.fork')}</li>
        </ul>
      </details>
    </section>
  );
}
