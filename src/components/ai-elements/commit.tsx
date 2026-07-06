import type { ReactNode } from 'react';
import { CheckCircle2, GitCommitHorizontal, Loader2, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { AiElementCard, MetricPill } from './card';

export type CommitOperationState = 'ready' | 'running' | 'success' | 'blocked' | 'failed';

export type CommitSummaryProps = {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted?: number;
  additions?: number;
  deletions?: number;
  branch?: string | null;
  operation?: {
    action?: string;
    state: CommitOperationState;
    detail?: string | null;
  };
  children?: ReactNode;
};

function operationIcon(state: CommitOperationState) {
  if (state === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-700 dark:text-blue-400" />;
  if (state === 'blocked' || state === 'failed') return <ShieldAlert className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />;
  if (state === 'success') return <CheckCircle2 className="h-3.5 w-3.5 text-green-700 dark:text-green-400" />;
  return <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function CommitSummary({
  staged,
  unstaged,
  untracked,
  conflicted = 0,
  additions = 0,
  deletions = 0,
  branch,
  operation,
  children,
}: CommitSummaryProps) {
  const { t } = useTranslation('chat');
  const op = operation ?? { state: 'ready' as const };

  return (
    <AiElementCard
      icon={<GitCommitHorizontal className="h-3.5 w-3.5" />}
      label={t('toolUi.commit.label', 'Commit')}
      title={branch ?? t('toolUi.commit.detached', 'Detached HEAD')}
      data-testid="ai-commit-card"
      className="bg-background"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2" data-testid="ai-commit-summary">
          <MetricPill label={t('toolUi.commit.staged', 'staged')} value={staged} tone={staged > 0 ? 'success' : 'neutral'} />
          <MetricPill label={t('toolUi.commit.unstaged', 'unstaged')} value={unstaged} tone={unstaged > 0 ? 'warning' : 'neutral'} />
          <MetricPill label={t('toolUi.commit.untracked', 'untracked')} value={untracked} />
          {conflicted > 0 ? <MetricPill label={t('toolUi.commit.conflicted', 'conflicted')} value={conflicted} tone="danger" /> : null}
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-input px-2 py-1 font-mono text-xs">
            <span className="text-green-700 dark:text-green-400">+{additions}</span>
            <span className="text-red-700 dark:text-red-400">-{deletions}</span>
          </span>
        </div>
        <div
          className={cn(
            'rounded-md border px-2.5 py-2 text-xs',
            op.state === 'ready' && 'border-border bg-surface-input text-muted-foreground',
            op.state === 'running' && 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400',
            op.state === 'success' && 'border-green-500/25 bg-green-500/10 text-green-700 dark:text-green-400',
            (op.state === 'blocked' || op.state === 'failed') && 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300',
          )}
          data-testid="ai-commit-operation"
        >
          <div className="flex items-center gap-2">
            {operationIcon(op.state)}
            <span className="font-medium">
              {op.action
                ? t('toolUi.commit.operationWithAction', '{{action}}: {{status}}', { action: op.action, status: t(`toolUi.commit.operation.${op.state}`, op.state) })
                : t(`toolUi.commit.operation.${op.state}`, op.state)}
            </span>
          </div>
          {op.detail ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{op.detail}</p> : null}
        </div>
        {children}
      </div>
    </AiElementCard>
  );
}
