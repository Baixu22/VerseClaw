import { useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, FileText, Globe, Loader2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ToolUiPlanView, type ToolUiPlanTodo } from '@/components/tool-ui/plan-view';
import { computeLineStats, supportsInlineDocumentPreview, supportsInlineDiff } from '@/lib/generated-files';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { TurnReportItem, TurnSourceItem, TurnTaskItem, TurnWorkModel, TurnWorkPrimaryKind } from './turn-work-model';

export function TurnWorkPanel({
  model,
  onOpenReport,
}: {
  model: TurnWorkModel | null;
  onOpenReport: (report: TurnReportItem) => void;
}) {
  const { t } = useTranslation('chat');
  const availableKinds = useMemo(() => {
    const kinds: NonNullable<TurnWorkPrimaryKind>[] = [];
    if (model?.tasks.length) kinds.push('tasks');
    if (model?.reports.length) kinds.push('reports');
    if (model?.sources.length) kinds.push('sources');
    return kinds;
  }, [model]);
  const [selectedKind, setSelectedKind] = useState<TurnWorkPrimaryKind>(model?.primaryKind ?? null);
  if (!model || availableKinds.length === 0) return null;
  const activeKind = selectedKind && availableKinds.includes(selectedKind)
    ? selectedKind
    : model.primaryKind ?? availableKinds[0] ?? 'tasks';
  const countForKind = (kind: NonNullable<TurnWorkPrimaryKind>) => {
    if (kind === 'tasks') return model.tasks.length;
    if (kind === 'reports') return model.reports.length;
    return model.sources.length;
  };

  return (
    <section
      className="rounded-md border border-border bg-black/[0.025] p-3 text-xs shadow-sm dark:bg-white/[0.035]"
      data-testid="turn-work-panel"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIcon status={model.status} />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">{t('turnWork.title')}</p>
            <p className="truncate text-2xs text-muted-foreground">{t(`turnWork.status.${model.status}`)}</p>
            <WorkCountLine model={model} />
          </div>
        </div>
        {availableKinds.length > 1 && (
          <div className="flex rounded-md bg-surface-input p-1" data-testid="turn-work-tabs">
            {availableKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                className={cn(
                  'rounded-sm px-2 py-1 text-2xs font-medium transition-colors',
                  activeKind === kind
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                )}
                onClick={() => setSelectedKind(kind)}
                aria-pressed={activeKind === kind}
              >
                <span>{t(`turnWork.tabs.${kind}`)}</span>
                <span className={cn(
                  'ml-1 rounded-sm px-1 font-mono text-[10px]',
                  activeKind === kind ? 'bg-black/5 text-foreground dark:bg-white/10' : 'text-muted-foreground',
                )}>
                  {countForKind(kind)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {activeKind === 'tasks' && <TaskList tasks={model.tasks} />}
      {activeKind === 'reports' && <ReportList reports={model.reports} onOpenReport={onOpenReport} />}
      {activeKind === 'sources' && <SourceList sources={model.sources} />}
    </section>
  );
}

function StatusIcon({ status }: { status: TurnWorkModel['status'] }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />;
  if (status === 'error' || status === 'blocked') return <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />;
  return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
}

function TaskList({ tasks }: { tasks: TurnTaskItem[] }) {
  const { t } = useTranslation('chat');
  if (tasks.length === 0) return <EmptyLine label={t('turnWork.empty.tasks')} />;
  const todos: ToolUiPlanTodo[] = tasks.map((task) => ({
    id: task.id,
    label: task.label,
    status: task.status === 'completed' ? 'completed' : task.status === 'running' ? 'in_progress' : 'cancelled',
    description: task.detail,
  }));
  return (
    <div data-testid="turn-work-tasks">
      <ToolUiPlanView
        title={t('turnWork.tabs.tasks')}
        todos={todos}
        maxVisibleTodos={5}
        compact
        showTitle={false}
        testId="turn-work-plan"
      />
    </div>
  );
}

function WorkCountLine({ model }: { model: TurnWorkModel }) {
  const { t } = useTranslation('chat');
  const counters = [
    { key: 'tasks', value: model.tasks.length },
    { key: 'reports', value: model.reports.length },
    { key: 'sources', value: model.sources.length },
  ].filter((counter) => counter.value > 0);

  if (counters.length === 0) return null;

  return (
    <p className="mt-0.5 truncate text-2xs text-muted-foreground" data-testid="turn-work-counts-line">
      {counters.map((counter) => `${t(`turnWork.tabs.${counter.key}`)} ${counter.value}`).join(' / ')}
    </p>
  );
}

function ReportList({
  reports,
  onOpenReport,
}: {
  reports: TurnReportItem[];
  onOpenReport: (report: TurnReportItem) => void;
}) {
  const { t } = useTranslation('chat');
  if (reports.length === 0) return <EmptyLine label={t('turnWork.empty.reports')} />;
  return (
    <div className="flex flex-wrap gap-2" data-testid="turn-work-reports">
      {reports.slice(0, 6).map((report) => {
        const stats = computeLineStats(report.file);
        const canOpen = supportsInlineDiff(report.file) || supportsInlineDocumentPreview(report.file.ext);
        return (
          <button
            key={report.id}
            type="button"
            disabled={!canOpen}
            onClick={() => onOpenReport(report)}
            className={cn(
              'inline-flex min-w-0 max-w-full items-center gap-2 rounded-md border border-border bg-background/70 px-2.5 py-2 text-left',
              canOpen && 'transition-colors hover:bg-black/5 dark:hover:bg-white/10',
              !canOpen && 'cursor-default opacity-80',
            )}
            title={report.filePath}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-foreground">{report.fileName}</span>
              <span className="block truncate text-2xs text-muted-foreground">
                {t(`turnWork.report.${report.action}`)}
              </span>
            </span>
            {stats && (
              <span className="ml-auto shrink-0 font-mono text-2xs">
                <span className="text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
                <span className="ml-1 text-rose-600 dark:text-rose-400">-{stats.removed}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SourceList({ sources }: { sources: TurnSourceItem[] }) {
  const { t } = useTranslation('chat');
  if (sources.length === 0) return <EmptyLine label={t('turnWork.empty.sources')} />;
  return (
    <div className="space-y-1.5" data-testid="turn-work-sources">
      {sources.slice(0, 6).map((source) => (
        <button
          key={source.id}
          type="button"
          className="flex w-full min-w-0 items-center gap-2 rounded-md bg-surface-input px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          title={source.url}
          onClick={() => void hostApi.shell.openExternal(source.url)}
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
  );
}

function EmptyLine({ label }: { label: string }) {
  return <div className="rounded-md bg-surface-input px-2.5 py-2 text-2xs text-muted-foreground">{label}</div>;
}
