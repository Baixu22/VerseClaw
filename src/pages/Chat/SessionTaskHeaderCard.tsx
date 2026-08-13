import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, GitBranch, Loader2, Target } from 'lucide-react';
import { hostApi } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';
import type {
  SessionCompactionStatus,
  SessionDescribeResult,
} from '@shared/host-api/contract';
import type { LongTaskControlStatus } from '@shared/types/long-task-control';

const GOAL_ACTIONS = ['start', 'pause', 'resume', 'complete', 'block'] as const;
type GoalAction = (typeof GOAL_ACTIONS)[number];

const GOAL_STATUS_TEXT: Record<string, string> = {
  active: 'text-green-700 dark:text-green-400',
  paused: 'text-yellow-700 dark:text-yellow-400',
  blocked: 'text-red-700 dark:text-red-400',
  complete: 'text-blue-700 dark:text-blue-400',
};

function shortKey(key: string): string {
  const parts = key.split(':');
  return parts.length > 2 ? `${parts.slice(0, 2).join(':')}:…` : key;
}

/**
 * Session/task header card for the Chat page. Read-only runtime state comes
 * from existing host-api surfaces; goal lifecycle actions reuse the `/goal`
 * command channel so authorization stays with the runtime command gate.
 */
export function SessionTaskHeaderCard() {
  const { t } = useTranslation('chat');
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const sessions = useChatStore((state) => state.sessions);
  const sending = useChatStore((state) => state.sending);
  const [expanded, setExpanded] = useState(false);
  const [describe, setDescribe] = useState<SessionDescribeResult | null>(null);
  const [compaction, setCompaction] = useState<SessionCompactionStatus | null>(null);
  const [longTask, setLongTask] = useState<LongTaskControlStatus | null>(null);
  const [busyAction, setBusyAction] = useState<GoalAction | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!currentSessionKey) {
      setDescribe(null);
      setCompaction(null);
      setLongTask(null);
      return () => {
        cancelled = true;
      };
    }
    hostApi.sessions
      .describe({ sessionKey: currentSessionKey })
      .then((result) => {
        if (!cancelled) setDescribe(result);
      })
      .catch(() => {
        if (!cancelled) setDescribe({ success: false, session: null });
      });
    hostApi.sessions
      .compactionStatus({ sessionKey: currentSessionKey })
      .then((result) => {
        if (!cancelled) setCompaction(result);
      })
      .catch(() => {});
    hostApi.sessions
      .longTaskControlStatus({ sessionKey: currentSessionKey })
      .then((result) => {
        if (!cancelled) setLongTask(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentSessionKey]);

  const refreshDescribe = useCallback(async () => {
    if (!currentSessionKey) return;
    try {
      setDescribe(await hostApi.sessions.describe({ sessionKey: currentSessionKey }));
    } catch {
      /* keep last known state */
    }
  }, [currentSessionKey]);

  const runGoalAction = useCallback(
    async (action: GoalAction) => {
      if (!currentSessionKey || sending || busyAction) return;
      setBusyAction(action);
      try {
        await hostApi.chat.sendWithMedia({
          sessionKey: currentSessionKey,
          message: `/goal ${action}`,
          deliver: true,
          idempotencyKey: crypto.randomUUID(),
        });
        await refreshDescribe();
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction, currentSessionKey, refreshDescribe, sending],
  );

  if (!currentSessionKey) {
    return null;
  }

  const localSession = Array.isArray(sessions)
    ? sessions.find((session) => session.key === currentSessionKey)
    : undefined;
  const row = describe?.session ?? null;
  const goal = row?.goal ?? null;
  const title =
    localSession?.label ??
    localSession?.derivedTitle ??
    row?.label ??
    row?.displayName ??
    currentSessionKey;
  const goalStatus = goal?.status ?? 'none';
  const goalText =
    goalStatus === 'none'
      ? t('sessionTaskCard.goal.none')
      : (t(`sessionTaskCard.goalStatus.${goalStatus}`, { defaultValue: goalStatus }) as string);
  const budgetPct =
    goal?.tokenBudget && typeof goal.tokensUsed === 'number' && goal.tokenBudget > 0
      ? Math.min(100, Math.round((goal.tokensUsed / goal.tokenBudget) * 100))
      : null;
  const actionsDisabled = sending || busyAction !== null;
  const childCount = row?.childSessions?.length ?? 0;
  const parentKey = row?.parentSessionKey ?? localSession?.parentSessionKey ?? null;
  const compactionText = compaction?.inProgress
    ? t('sessionTaskCard.compaction.inProgress')
    : compaction?.truncatedMessageCount
      ? t('sessionTaskCard.compaction.truncated', { count: compaction.truncatedMessageCount })
      : t('sessionTaskCard.compaction.pressure', {
          pressure: compaction?.pressure ?? 'unknown',
        });

  return (
    <div
      data-testid="session-task-header-card"
      className="no-drag relative z-10 mx-2 mb-2 rounded-lg border border-border/60 bg-surface-modal px-3 py-2"
    >
      <button
        type="button"
        data-testid="session-task-header-expand"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 text-left"
      >
        <Target className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{title}</span>
        <span
          className={`shrink-0 text-xs font-medium ${GOAL_STATUS_TEXT[goalStatus] ?? 'text-muted-foreground'}`}
        >
          {goalText}
        </span>
        {goal?.objective ? (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {goal.objective}
          </span>
        ) : null}
        {expanded ? (
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded ? (
        <div className="mt-2 space-y-2 text-xs text-muted-foreground">
          {goal?.objective ? (
            <p className="text-foreground/80">{goal.objective}</p>
          ) : null}
          {budgetPct !== null ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${budgetPct}%` }}
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            {parentKey ? (
              <span>
                <GitBranch className="mr-1 inline h-3 w-3" />
                {t('sessionTaskCard.parent')} {shortKey(parentKey)}
              </span>
            ) : null}
            {row?.forkedFromParent ? <span>{t('sessionTaskCard.forked')}</span> : null}
            {childCount > 0 ? (
              <span>{t('sessionTaskCard.children', { count: childCount })}</span>
            ) : null}
            {compaction ? <span>{compactionText}</span> : null}
            {longTask?.available && longTask.queueCount > 0 ? (
              <span>{t('sessionTaskCard.longTask.queued', { count: longTask.queueCount })}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {GOAL_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                data-testid={`session-task-goal-${action}`}
                disabled={actionsDisabled}
                onClick={() => void runGoalAction(action)}
                className="rounded-md bg-black/5 px-2 py-1 text-xs font-medium text-foreground/80 hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/10 dark:hover:bg-white/15"
              >
                {busyAction === action ? (
                  <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                ) : null}
                {t(`sessionTaskCard.goalActions.${action}`, { defaultValue: action })}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}