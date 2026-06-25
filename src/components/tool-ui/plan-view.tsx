import { useState } from 'react';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type ToolUiPlanTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type ToolUiPlanTodo = {
  id: string;
  label: string;
  status: ToolUiPlanTodoStatus;
  description?: string;
};

export function ToolUiPlanView({
  title,
  description,
  todos,
  maxVisibleTodos = 8,
  compact = false,
  showTitle = true,
  testId = 'chat-tool-ui-plan',
}: {
  title: string;
  description?: string;
  todos: ToolUiPlanTodo[];
  maxVisibleTodos?: number;
  compact?: boolean;
  showTitle?: boolean;
  testId?: string;
}) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const completed = todos.filter((todo) => todo.status === 'completed').length;
  const total = Math.max(1, todos.length);
  const progress = Math.round((completed / total) * 100);
  const visibleTodos = expanded ? todos : todos.slice(0, maxVisibleTodos);
  const hiddenCount = Math.max(0, todos.length - visibleTodos.length);
  const hasIssue = todos.some((todo) => todo.status === 'cancelled');
  const hasActive = todos.some((todo) => todo.status === 'in_progress');
  const progressWidth = hasIssue && progress === 0 && todos.length > 0 ? 4 : progress;
  const progressTone = hasIssue
    ? 'bg-destructive'
    : hasActive
      ? 'bg-primary'
      : completed === todos.length && todos.length > 0
        ? 'bg-emerald-600 dark:bg-emerald-500'
        : 'bg-primary';

  return (
    <div className={cn('min-w-0 space-y-3', compact && 'space-y-2')} data-testid={testId}>
      {showTitle && (
        <div className="space-y-1">
          <h3 className={cn('font-semibold text-foreground', compact ? 'text-xs' : 'text-sm')}>{title}</h3>
          {description && <p className={cn('text-muted-foreground', compact ? 'line-clamp-2 text-xs' : 'text-sm')}>{description}</p>}
        </div>
      )}
      <div className={cn('space-y-2 rounded-md bg-surface-input/70 p-3', compact && 'bg-surface-input/55 p-2')}>
        <div className={cn('flex items-center justify-between text-muted-foreground', compact ? 'text-2xs' : 'text-xs')}>
          <span>{t('toolUi.plan.progress', { completed, total: todos.length })}</span>
          <span>{progress}%</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div className={cn('h-full rounded-full transition-all', progressTone)} style={{ width: `${progressWidth}%` }} />
        </div>
        <ul className={cn('space-y-1.5', compact && 'space-y-1')}>
          {visibleTodos.map((todo) => (
            <li
              key={todo.id}
              className={cn(
                'flex items-start gap-2 rounded-md px-1.5 py-1 transition-colors',
                todo.status === 'in_progress' && 'bg-black/5 dark:bg-white/10',
              )}
            >
              <ToolUiPlanStatusIcon status={todo.status} compact={compact} />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'break-words leading-5',
                    compact ? 'text-xs' : 'text-sm',
                    todo.status === 'pending' && 'text-muted-foreground',
                    todo.status === 'cancelled' && 'text-destructive',
                  )}
                >
                  {todo.label}
                </p>
                {todo.description && (
                  <p className={cn('line-clamp-2 break-words leading-5 text-muted-foreground', compact ? 'text-2xs' : 'text-xs')}>
                    {todo.description}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
        {hiddenCount > 0 && (
          <button
            type="button"
            className={cn(
              'rounded-sm px-1.5 py-0.5 font-medium text-primary transition-colors hover:bg-black/5 dark:hover:bg-white/10',
              compact ? 'text-2xs' : 'text-xs',
            )}
            onClick={() => setExpanded(true)}
          >
            {t('toolUi.plan.showMore', { count: hiddenCount })}
          </button>
        )}
      </div>
    </div>
  );
}

function ToolUiPlanStatusIcon({
  status,
  compact = false,
}: {
  status: ToolUiPlanTodoStatus;
  compact?: boolean;
}) {
  const className = cn('mt-0.5 shrink-0', compact ? 'h-3.5 w-3.5' : 'h-4 w-4');
  if (status === 'completed') return <CheckCircle2 className={cn(className, 'text-green-600 dark:text-green-400')} />;
  if (status === 'in_progress') return <Loader2 className={cn(className, 'animate-spin text-primary')} />;
  if (status === 'cancelled') return <XCircle className={cn(className, 'text-destructive')} />;
  return <Circle className={cn(className, 'text-muted-foreground/70')} />;
}
