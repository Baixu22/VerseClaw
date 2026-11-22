import { useTranslation } from 'react-i18next';
import type { FileLineStats } from '@/lib/generated-files';

export function FileLineStatsLabel({ stats }: { stats: FileLineStats }) {
  const { t } = useTranslation('chat');
  return (
    <span
      role="group"
      aria-label={t('toolUi.codeDiff.lineStatsLabel', { added: stats.added, removed: stats.removed })}
      className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums"
    >
      <span className="text-emerald-700 dark:text-emerald-400">+{stats.added}</span>{' '}
      <span className="text-rose-700 dark:text-rose-400">-{stats.removed}</span>
    </span>
  );
}
