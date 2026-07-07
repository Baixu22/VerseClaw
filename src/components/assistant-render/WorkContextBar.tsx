import { CheckCircle2, ExternalLink, FileText, GitBranch, Globe, ListChecks, Loader2, TriangleAlert } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ToolUiPlanView, type ToolUiPlanTodo } from '@/components/tool-ui/plan-view';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { GitRepositoryStatus } from '@shared/types/git';
import type { TaskLedgerNode, TaskLedgerSnapshot } from '@shared/types/task-ledger';
import type { TurnReportItem, TurnWorkModel } from './turn-work-model';

export type WorkContextWorkspace = {
  name?: string | null;
  rootPath?: string | null;
};

export type WorkContextBarProps = {
  visible: boolean;
  workspace: WorkContextWorkspace | null;
  gitStatus: GitRepositoryStatus | null;
  workModel: TurnWorkModel | null;
  taskLedgerSnapshot: TaskLedgerSnapshot | null;
  onOpenGit: () => void;
  onOpenReport: (report: TurnReportItem) => void;
  className?: string;
};

function gitChangeCount(status: GitRepositoryStatus): number {
  return status.stagedCount + status.unstagedCount + status.untrackedCount + status.conflictedCount;
}

function gitLineDelta(status: GitRepositoryStatus): { added: number; removed: number } | null {
  let added = 0;
  let removed = 0;
  let hasStats = false;
  for (const change of status.changes) {
    if (typeof change.additions === 'number') {
      added += change.additions;
      hasStats = true;
    }
    if (typeof change.deletions === 'number') {
      removed += change.deletions;
      hasStats = true;
    }
  }
  return hasStats ? { added, removed } : null;
}

function ledgerGroups(snapshot: TaskLedgerSnapshot | null): {
  currentGoal: TaskLedgerNode | null;
  active: TaskLedgerNode[];
  review: TaskLedgerNode[];
  blocked: TaskLedgerNode[];
} | null {
  if (!snapshot || snapshot.nodes.length === 0) return null;
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  return {
    currentGoal: snapshot.currentGoalId ? nodesById.get(snapshot.currentGoalId) ?? null : null,
    active: snapshot.activeNodeIds.map((id) => nodesById.get(id)).filter(Boolean) as TaskLedgerNode[],
    review: snapshot.reviewNodeIds.map((id) => nodesById.get(id)).filter(Boolean) as TaskLedgerNode[],
    blocked: snapshot.blockedNodeIds.map((id) => nodesById.get(id)).filter(Boolean) as TaskLedgerNode[],
  };
}

function taskTodos(model: TurnWorkModel | null): ToolUiPlanTodo[] {
  return (model?.tasks ?? []).map((task) => ({
    id: task.id,
    label: task.label,
    status: task.status === 'completed' ? 'completed' : task.status === 'running' ? 'in_progress' : 'cancelled',
    description: task.detail,
  }));
}

export function WorkContextBar({
  visible,
  workspace,
  gitStatus,
  workModel,
  taskLedgerSnapshot,
  onOpenGit,
  onOpenReport,
  className,
}: WorkContextBarProps) {
  const { t } = useTranslation('chat');
  const todos = useMemo(() => taskTodos(workModel), [workModel]);
  const ledger = useMemo(() => ledgerGroups(taskLedgerSnapshot), [taskLedgerSnapshot]);
  const git = gitStatus?.isRepository ? gitStatus : null;
  const artifacts = workModel?.reports ?? [];
  const sources = workModel?.sources ?? [];
  const hasPlan = todos.length > 0;
  const hasLedger = !hasPlan && !!ledger;
  const hasEnvironment = !!workspace;
  const hasArtifacts = artifacts.length > 0;
  const hasSources = sources.length > 0;
  const hasContent = hasPlan || hasLedger || hasEnvironment || hasArtifacts || hasSources;

  if (!visible || !hasContent) return null;

  return (
    <aside
      className={cn(
        'absolute left-1/2 top-2 z-20 w-[calc(100%-1rem)] max-w-4xl -translate-x-1/2',
        'rounded-lg border border-border bg-surface-modal text-foreground shadow-lg shadow-black/10 dark:shadow-black/30',
        'max-h-[50vh] overflow-y-auto p-3 backdrop-blur',
        className,
      )}
      data-testid="work-context-bar"
      aria-label={t('workContext.title')}
    >
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ListChecks className="h-4 w-4 shrink-0 text-primary" />
          <h2 className="truncate text-xs font-semibold text-foreground">{t('workContext.title')}</h2>
        </div>
        {workModel && (
          <div className="flex shrink-0 items-center gap-1.5 text-2xs text-muted-foreground" data-testid="work-context-status">
            <WorkStatusIcon status={workModel.status} />
            <span>{t(`turnWork.status.${workModel.status}`)}</span>
          </div>
        )}
      </div>

      <div className="grid gap-2">
        {hasPlan && (
          <Section title={t('workContext.sections.plan')} testId="work-context-plan">
            <ToolUiPlanView
              title={t('workContext.sections.plan')}
              todos={todos}
              maxVisibleTodos={4}
              compact
              showTitle={false}
              testId="work-context-plan-view"
            />
          </Section>
        )}

        {hasLedger && ledger && (
          <Section title={t('workContext.sections.ledger')} testId="work-context-ledger">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">
                  {ledger.currentGoal?.title ?? t('workContext.ledger.noCurrentGoal')}
                </p>
                <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                  {t('workContext.ledger.counts', {
                    active: ledger.active.length,
                    review: ledger.review.length,
                    blocked: ledger.blocked.length,
                  })}
                </p>
              </div>
              <div className="flex gap-1.5">
                <CountPill tone="blue" value={ledger.active.length} label={t('workContext.ledger.active')} />
                <CountPill tone="amber" value={ledger.review.length} label={t('workContext.ledger.review')} />
                <CountPill tone="red" value={ledger.blocked.length} label={t('workContext.ledger.blocked')} />
              </div>
            </div>
          </Section>
        )}

        {hasEnvironment && (
          <EnvironmentSection
            workspace={workspace}
            gitStatus={git}
            onOpenGit={onOpenGit}
          />
        )}

        {hasArtifacts && (
          <Section title={t('workContext.sections.artifacts')} testId="work-context-artifacts">
            <div className="flex flex-wrap gap-2">
              {artifacts.slice(0, 6).map((report) => (
                <button
                  key={report.id}
                  type="button"
                  className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border border-border bg-surface-input px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                  title={report.filePath}
                  onClick={() => onOpenReport(report)}
                  data-testid={`work-context-artifact-${report.id}`}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-foreground">{report.fileName}</span>
                    <span className="block truncate text-2xs text-muted-foreground">{t(`turnWork.report.${report.action}`)}</span>
                  </span>
                </button>
              ))}
            </div>
          </Section>
        )}

        {hasSources && (
          <Section title={t('workContext.sections.sources')} testId="work-context-sources">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {sources.slice(0, 6).map((source) => (
                <button
                  key={source.id}
                  type="button"
                  className="flex min-w-0 items-center gap-2 rounded-md bg-surface-input px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                  title={source.url}
                  onClick={() => void hostApi.shell.openExternal(source.url)}
                  data-testid={`work-context-source-${source.id}`}
                >
                  <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">{source.domain}</span>
                    <span className="block truncate text-2xs text-muted-foreground">{source.url}</span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}

function WorkStatusIcon({ status }: { status: TurnWorkModel['status'] }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
  if (status === 'error' || status === 'blocked') return <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-red-700 dark:text-red-400" />;
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-700 dark:text-green-400" />;
}

function Section({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-md bg-transparent" data-testid={testId}>
      <h3 className="mb-1.5 truncate text-2xs font-medium uppercase text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function EnvironmentSection({
  workspace,
  gitStatus,
  onOpenGit,
}: {
  workspace: WorkContextWorkspace | null;
  gitStatus: GitRepositoryStatus | null;
  onOpenGit: () => void;
}) {
  const { t } = useTranslation('chat');
  const changeCount = gitStatus ? gitChangeCount(gitStatus) : 0;
  const delta = gitStatus ? gitLineDelta(gitStatus) : null;
  return (
    <Section title={t('workContext.sections.environment')} testId="work-context-environment">
      <div className="grid gap-2 rounded-md bg-surface-input p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="grid min-w-0 gap-1.5 sm:grid-cols-3">
          <EnvironmentMetric
            label={t('workContext.environment.workspace')}
            value={workspace?.name || workspace?.rootPath || t('workContext.environment.unknownWorkspace')}
            title={workspace?.rootPath ?? undefined}
          />
          {gitStatus && (
            <>
              <EnvironmentMetric
                label={t('workContext.environment.branch')}
                value={gitStatus.detached ? t('workContext.git.detached') : gitStatus.branch || t('workContext.git.unknownBranch')}
                title={gitStatus.branch}
                icon={<GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              />
              <EnvironmentMetric
                label={t('workContext.environment.changes')}
                value={gitStatus.clean ? t('workContext.git.clean') : t('workContext.environment.changeCounts', { count: changeCount })}
                detail={delta ? t('workContext.environment.delta', { added: delta.added, removed: delta.removed }) : undefined}
              />
            </>
          )}
        </div>
        {gitStatus && (
          <div className="flex min-w-0 flex-wrap justify-start gap-1.5 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 min-w-0 max-w-full gap-1.5 rounded-md px-2 text-2xs"
              onClick={onOpenGit}
              data-testid="work-context-view-changes"
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t('workContext.actions.viewChanges')}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 max-w-full gap-1.5 rounded-md px-2 text-2xs"
              onClick={onOpenGit}
              data-testid="work-context-commit-push"
            >
              <span className="truncate">{t('workContext.actions.commitOrPush')}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 max-w-full gap-1.5 rounded-md px-2 text-2xs"
              onClick={onOpenGit}
              data-testid="work-context-create-pr"
            >
              <span className="truncate">{t('workContext.actions.createPr')}</span>
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}

function EnvironmentMetric({
  label,
  value,
  detail,
  title,
  icon,
}: {
  label: string;
  value: string;
  detail?: string;
  title?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-2xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs font-medium text-foreground" title={title ?? value}>
        {icon}
        <span className="truncate">{value}</span>
      </p>
      {detail && <p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function CountPill({
  tone,
  value,
  label,
}: {
  tone: 'blue' | 'amber' | 'red';
  value: number;
  label: string;
}) {
  const toneClass = tone === 'blue'
    ? 'text-blue-700 dark:text-blue-400'
    : tone === 'amber'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-red-700 dark:text-red-400';
  return (
    <div className="min-w-12 rounded-md bg-surface-input px-2 py-1 text-center">
      <p className={cn('text-xs font-semibold', toneClass)}>{value}</p>
      <p className="truncate text-2xs text-muted-foreground">{label}</p>
    </div>
  );
}
