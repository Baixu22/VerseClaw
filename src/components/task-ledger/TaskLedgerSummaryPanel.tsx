import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckSquare, GitBranch, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { TaskLedgerNode, TaskLedgerSnapshot } from '@shared/types/task-ledger';

type Props = {
  workspaceId?: string | null;
  compact?: boolean;
  hideWhenEmpty?: boolean;
  className?: string;
  onVisibilityChange?: (visible: boolean) => void;
};

function nodeTone(node: TaskLedgerNode): string {
  if (node.status === 'blocked') return 'text-red-700 dark:text-red-400';
  if (node.status === 'review') return 'text-amber-700 dark:text-amber-400';
  if (node.status === 'done') return 'text-emerald-700 dark:text-emerald-400';
  if (node.status === 'doing') return 'text-blue-700 dark:text-blue-400';
  return 'text-foreground';
}

function NodeLine({ node, t }: { node: TaskLedgerNode; t: ReturnType<typeof useTranslation<'taskLedger'>>['t'] }) {
  return (
    <li className="min-w-0 rounded-md bg-surface-input px-2.5 py-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className={cn('truncate text-xs font-medium', nodeTone(node))}>{node.title}</span>
        <Badge variant="outline" className="shrink-0 rounded-full text-2xs">{t(`status.${node.status}`)}</Badge>
      </div>
      <p className="mt-1 truncate text-2xs text-muted-foreground">{t(`kind.${node.kind}`)}</p>
    </li>
  );
}

export function TaskLedgerSummaryPanel({
  workspaceId,
  compact = false,
  hideWhenEmpty = false,
  className,
  onVisibilityChange,
}: Props) {
  const { t } = useTranslation('taskLedger');
  const [snapshot, setSnapshot] = useState<TaskLedgerSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApi.taskLedger.snapshot(workspaceId ? { workspaceId } : undefined);
      setSnapshot(result.snapshot);
    } catch {
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const nodesById = new Map((snapshot?.nodes ?? []).map((node) => [node.id, node]));
    const currentGoal = snapshot?.currentGoalId ? nodesById.get(snapshot.currentGoalId) ?? null : null;
    const active = (snapshot?.activeNodeIds ?? []).map((id) => nodesById.get(id)).filter(Boolean) as TaskLedgerNode[];
    const blocked = (snapshot?.blockedNodeIds ?? []).map((id) => nodesById.get(id)).filter(Boolean) as TaskLedgerNode[];
    const review = (snapshot?.reviewNodeIds ?? []).map((id) => nodesById.get(id)).filter(Boolean) as TaskLedgerNode[];
    return { currentGoal, active, blocked, review, decisions: snapshot?.recentDecisions ?? [] };
  }, [snapshot]);

  const hasContent = !!snapshot && snapshot.nodes.length > 0;
  const visible = !hideWhenEmpty || hasContent;
  useEffect(() => {
    onVisibilityChange?.(visible);
  }, [onVisibilityChange, visible]);
  if (!visible) return null;

  return (
    <aside
      data-testid="task-ledger-summary"
      className={cn(
        'w-full shrink-0 lg:w-72 xl:w-80',
        compact && 'lg:w-64 xl:w-72',
        className,
      )}
      aria-label={t('summary.title')}
    >
      <div className="sticky top-2 max-h-full overflow-hidden rounded-md border border-black/5 bg-background/80 p-3 shadow-sm backdrop-blur dark:border-white/10">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <h2 className="truncate text-xs font-semibold text-foreground">{t('summary.title')}</h2>
              <p className="truncate text-2xs text-muted-foreground">
                {snapshot ? t('summary.counts', { nodes: snapshot.nodes.length, events: snapshot.eventsCount }) : t('summary.loading')}
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
        </div>

        {!hasContent ? (
          <div className="rounded-md bg-surface-input p-3 text-xs text-muted-foreground">
            {t('summary.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            {groups.currentGoal && (
              <section>
                <p className="mb-1.5 text-2xs font-medium uppercase text-muted-foreground">{t('summary.currentGoal')}</p>
                <NodeLine node={groups.currentGoal} t={t} />
              </section>
            )}
            <section className="grid grid-cols-3 gap-2">
              <div className="rounded-md bg-surface-input p-2 text-center">
                <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">{groups.active.length}</p>
                <p className="text-2xs text-muted-foreground">{t('summary.active')}</p>
              </div>
              <div className="rounded-md bg-surface-input p-2 text-center">
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">{groups.blocked.length}</p>
                <p className="text-2xs text-muted-foreground">{t('summary.blocked')}</p>
              </div>
              <div className="rounded-md bg-surface-input p-2 text-center">
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">{groups.review.length}</p>
                <p className="text-2xs text-muted-foreground">{t('summary.review')}</p>
              </div>
            </section>
            {groups.blocked.length > 0 && (
              <section>
                <p className="mb-1.5 flex items-center gap-1.5 text-2xs font-medium uppercase text-red-700 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  {t('summary.blockers')}
                </p>
                <ul className="space-y-1.5">{groups.blocked.slice(0, 3).map((node) => <NodeLine key={node.id} node={node} t={t} />)}</ul>
              </section>
            )}
            {groups.review.length > 0 && (
              <section>
                <p className="mb-1.5 text-2xs font-medium uppercase text-amber-700 dark:text-amber-400">{t('summary.needsReview')}</p>
                <ul className="space-y-1.5">{groups.review.slice(0, 3).map((node) => <NodeLine key={node.id} node={node} t={t} />)}</ul>
              </section>
            )}
            {groups.decisions.length > 0 && (
              <section>
                <p className="mb-1.5 text-2xs font-medium uppercase text-muted-foreground">{t('summary.decisions')}</p>
                <ul className="space-y-1.5">{groups.decisions.slice(0, 2).map((node) => <NodeLine key={node.id} node={node} t={t} />)}</ul>
              </section>
            )}
          </div>
        )}

        <Button asChild variant="outline" size="sm" className="mt-3 h-8 w-full gap-1.5 text-xs">
          <Link to={groups.currentGoal ? `/task-ledger?nodeId=${encodeURIComponent(groups.currentGoal.id)}` : '/task-ledger'}>
            <GitBranch className="h-3.5 w-3.5" />
            {t('summary.open')}
          </Link>
        </Button>
      </div>
    </aside>
  );
}
