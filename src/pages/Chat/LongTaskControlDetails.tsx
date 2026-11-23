import { useTranslation } from 'react-i18next';
import type { LongTaskControlStatus } from '@shared/types/long-task-control';

/** Checkpoint and intervention receipts are available without occupying the input row. */
export function LongTaskControlDetails({ status }: { status?: LongTaskControlStatus | null }) {
  const { t } = useTranslation('chat');
  if (!status?.latestCheckpoint && !status?.latestIntervention && !status?.warnings.length) return null;
  return (
    <details className="min-w-0 py-1 text-xs text-muted-foreground" data-testid="chat-long-task-details">
      <summary className="cursor-pointer rounded py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        {t('composer.feedback.history')}
      </summary>
      <div className="space-y-1.5 break-words py-1">
        {status.latestCheckpoint?.trigger && (
          <p data-testid="chat-long-task-checkpoint">
            {t('composer.longTaskControl.checkpoint', {
              trigger: t(`composer.longTaskControl.trigger.${status.latestCheckpoint.trigger}`),
            })}
          </p>
        )}
        {status.latestIntervention && (
          <p data-testid="chat-long-task-intervention">
            {t('composer.longTaskControl.intervention', {
              mode: status.latestIntervention.mode
                ? t(`composer.longTaskControl.mode.${status.latestIntervention.mode}`)
                : t('composer.longTaskControl.mode.unknown'),
              status: t(`composer.longTaskControl.status.${status.latestIntervention.status}`),
            })}
          </p>
        )}
        {status.warnings.length > 0 && (
          <ul className="space-y-1 text-amber-700 dark:text-amber-400">
            {status.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        )}
      </div>
    </details>
  );
}
