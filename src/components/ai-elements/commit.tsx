import type { ReactNode } from 'react';
import { CircleCheck, CircleX, GitCommitHorizontal, Loader2, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  if (state === 'blocked') return <ShieldAlert className="h-3.5 w-3.5" />;
  if (state === 'failed') return <CircleX className="h-3.5 w-3.5" />;
  if (state === 'success') return <CircleCheck className="h-3.5 w-3.5" />;
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
    <section className="git-surface git-commit-card" data-testid="ai-commit-card">
      <header className="flex min-w-0 items-center gap-2.5">
        <span className="git-icon"><GitCommitHorizontal className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0"><p className="text-xs text-muted-foreground">{t('toolUi.commit.label', 'Commit')}</p>
          <h3 className="git-path text-sm font-medium">{branch ?? t('toolUi.commit.detached', 'Detached HEAD')}</h3></div>
      </header>
      <div>
        <dl className="git-commit-stats" data-testid="ai-commit-summary">
          <div><dd>{staged}</dd><dt>{t('toolUi.commit.staged', 'staged')}</dt></div>
          <div><dd>{unstaged}</dd><dt>{t('toolUi.commit.unstaged', 'unstaged')}</dt></div>
          <div><dd>{untracked}</dd><dt>{t('toolUi.commit.untracked', 'untracked')}</dt></div>
          {conflicted > 0 && <div data-tone="danger"><dd>{conflicted}</dd><dt>{t('toolUi.commit.conflicted', 'conflicted')}</dt></div>}
          <div className="font-mono text-xs">
            <span className="text-green-700 dark:text-green-400">+{additions}</span>
            <span className="text-red-700 dark:text-red-400">-{deletions}</span>
          </div>
        </dl>
        <div
          className="git-operation"
          data-state={op.state}
          role="status"
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
    </section>
  );
}
