/**
 * ToolUiPlanView — the agent's to-do list.
 *
 * Ported from AIcss "To-do List" (https://www.aicss.dev/components/task-list,
 * free tier) and rewritten for this codebase:
 *
 * - The upstream component is a self-contained demo: five hardcoded labels
 *   advanced by a `setTimeout` timeline. This version renders whatever the
 *   plan actually contains, so items change state because `update_plan` said
 *   so, not because a timer fired.
 * - Upstream styles with plain CSS modules themed via
 *   `@media (prefers-color-scheme: dark)`. This app themes with
 *   `darkMode: ['class']`, so that media query would show light chrome inside
 *   a dark transcript. Rewritten with the project's tokens.
 * - Upstream's bespoke digit roller is dropped in favour of the `NumberRoll`
 *   this codebase already ships, so there is one rolling-number implementation.
 *
 * Kept from the original: the collapsible header whose icon doubles as a
 * progress ring, the rolling done/total counter, and the tri-state item icons
 * that cross-fade dashed → arrow → check.
 *
 * The prop contract is unchanged from the previous implementation — both call
 * sites (the Tool UI `plan` card and the runtime `update_plan` surface) and
 * their tests keep working.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberRoll } from '@/components/assistant-ui/number-roll';
import { cn } from '@/lib/utils';

export type ToolUiPlanTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type ToolUiPlanTodo = {
  id: string;
  label: string;
  status: ToolUiPlanTodoStatus;
  description?: string;
};

/** Exported so the conversation task dock draws the same tri-state step glyphs. */
export function ToolUiPlanItemIcon({ status }: { status: ToolUiPlanTodoStatus }) {
  return <ItemIcon status={status} />;
}

function ItemIcon({ status }: { status: ToolUiPlanTodoStatus }) {
  const common = 'absolute inset-0 h-4 w-4 transition-opacity duration-300';
  return (
    <span className="relative inline-block h-4 w-4 shrink-0" aria-hidden="true">
      {/* Pending / cancelled — dashed ring */}
      <svg viewBox="0 0 24 24" className={cn(common, status === 'pending' || status === 'cancelled' ? 'opacity-100' : 'opacity-0', status === 'cancelled' ? 'text-destructive/60' : 'text-muted-foreground/45')}>
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="1.8 3.6" strokeLinecap="round" />
      </svg>
      {/* In progress — arrow */}
      <svg viewBox="0 0 24 24" className={cn(common, status === 'in_progress' ? 'opacity-100' : 'opacity-0', 'text-foreground/80')}>
        <path d="m12.75 15 3-3m0 0-3-3m3 3h-7.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {/* Completed — check */}
      <svg viewBox="0 0 24 24" className={cn(common, status === 'completed' ? 'opacity-100' : 'opacity-0', 'text-emerald-600 dark:text-emerald-500')}>
        <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function HeaderIcon({ allDone, running, progress }: { allDone: boolean; running: boolean; progress: number }) {
  if (allDone) {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-600 dark:text-emerald-500" aria-hidden="true">
        <path fillRule="evenodd" clipRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" fill="currentColor" />
      </svg>
    );
  }
  if (running) {
    // Dashed ring that fills clockwise with completion — the upstream "pie".
    return (
      <span
        className="relative inline-flex h-4 w-4 items-center justify-center text-primary"
        style={{ background: `conic-gradient(currentColor ${progress}%, transparent 0)`, borderRadius: '9999px', WebkitMaskImage: 'radial-gradient(circle, transparent 55%, #000 57%)', maskImage: 'radial-gradient(circle, transparent 55%, #000 57%)' }}
        aria-hidden="true"
      />
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted-foreground/70" aria-hidden="true">
      <path d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ToolUiPlanView({
  title,
  description,
  todos,
  maxVisibleTodos = 8,
  compact = false,
  showTitle = true,
  testId = 'chat-tool-ui-plan',
  collapsed: controlledCollapsed,
  defaultCollapsed = false,
  onCollapsedChange,
  showProgress = true,
}: {
  title: string;
  description?: string;
  todos: ToolUiPlanTodo[];
  maxVisibleTodos?: number;
  compact?: boolean;
  showTitle?: boolean;
  testId?: string;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  showProgress?: boolean;
}) {
  const { t } = useTranslation('chat');
  const [localCollapsed, setLocalCollapsed] = useState(defaultCollapsed);
  const collapsed = controlledCollapsed ?? localCollapsed;
  const [expandedList, setExpandedList] = useState(false);

  const completed = todos.filter((todo) => todo.status === 'completed').length;
  const total = todos.length;
  const allDone = total > 0 && completed === total;
  const running = todos.some((todo) => todo.status === 'in_progress');
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  const visibleTodos = expandedList ? todos : todos.slice(0, maxVisibleTodos);
  const hiddenCount = Math.max(0, todos.length - visibleTodos.length);
  const headerLabel = showTitle && title ? title : t('toolUi.plan.label');

  return (
    <div className={cn('flex w-full min-w-0 flex-col', compact && 'text-xs')} data-testid={testId}>
      <button
        type="button"
        className={cn(
          'chat-plan-toggle flex min-w-0 items-center gap-2 self-stretch rounded-sm py-0.5 text-left',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        )}
        aria-expanded={!collapsed}
        title={headerLabel}
        onClick={() => { setLocalCollapsed(!collapsed); onCollapsedChange?.(!collapsed); }}
      >
        <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
          <HeaderIcon allDone={allDone} running={running} progress={progress} />
        </span>
        <span className={cn('min-w-0 truncate font-medium text-foreground', compact ? 'text-xs' : 'text-sm')}>
          {headerLabel}
        </span>
        {showProgress && <span className="ml-auto inline-flex shrink-0 items-baseline gap-0.5 font-mono text-xs tabular-nums text-muted-foreground/70">
          <NumberRoll value={completed} />
          <span>/</span>
          <span>{total}</span>
        </span>}
        <svg
          viewBox="0 0 24 24"
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
            collapsed && '-rotate-90',
          )}
          aria-hidden="true"
        >
          <path d="m19.5 8.25-7.5 7.5-7.5-7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div
        inert={collapsed ? true : undefined}
        aria-hidden={collapsed}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          collapsed ? 'pointer-events-none grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {description && (
            <p className={cn('mt-1 text-muted-foreground', compact ? 'line-clamp-2 text-xs' : 'text-sm')}>
              {description}
            </p>
          )}
          <ul className={cn('mt-2 flex flex-col', compact ? 'gap-1' : 'gap-1.5')}>
            {visibleTodos.map((todo) => (
              <li
                key={todo.id}
                className="flex min-w-0 items-start gap-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
                data-status={todo.status}
              >
                <span className="mt-px">
                  <ItemIcon status={todo.status} />
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 leading-5 transition-colors duration-300',
                    compact ? 'text-xs' : 'text-[13px]',
                    todo.status === 'completed' && 'text-muted-foreground/60',
                    todo.status === 'in_progress' && 'font-medium text-foreground',
                    todo.status === 'pending' && 'text-muted-foreground',
                    todo.status === 'cancelled' && 'text-muted-foreground/50 line-through',
                  )}
                >
                  {todo.label}
                  {todo.description && (
                    <span className="block text-xs text-muted-foreground/60">{todo.description}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && (
            <button
              type="button"
              className="mt-1.5 self-start rounded-sm text-xs text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setExpandedList(true)}
            >
              {t('toolUi.plan.showMore', { count: hiddenCount })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
