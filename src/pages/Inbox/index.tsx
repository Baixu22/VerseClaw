import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/shallow';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Globe2,
  Play,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { MessageSquare } from '@/components/icons/codex-icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WorkbenchPageShell } from '@/components/ui/page-shell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  isInboxItemActionable,
  useInboxStore,
  type InboxItem,
  type InboxSource,
} from '@/stores/inbox';
import type { RemoteTaskPreview } from '@shared/types/remote-tasks';

type InboxView = 'actionable' | 'history';
type SourceFilter = 'all' | InboxSource;

const SOURCE_FILTERS: SourceFilter[] = ['all', 'permission', 'remote-task', 'browser-task'];

function parseSource(value: string | null): SourceFilter {
  return SOURCE_FILTERS.includes(value as SourceFilter) ? value as SourceFilter : 'all';
}

function sourceIcon(source: InboxSource) {
  if (source === 'permission') return <ShieldCheck className="h-4 w-4" />;
  if (source === 'remote-task') return <MessageSquare className="h-4 w-4" />;
  return <Globe2 className="h-4 w-4" />;
}

function statusKey(item: InboxItem): string {
  if (item.source === 'permission') return `status.permission.${item.status}`;
  if (item.source === 'remote-task') return `status.remoteTask.${item.status}`;
  return 'status.browserTask.waitingApproval';
}

function riskTone(risk: InboxItem['risk']): string {
  if (risk === 'dangerous' || risk === 'destructive') {
    return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400';
  }
  if (risk === 'write' || risk === 'network' || risk === 'external-write') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  }
  return 'border-border bg-black/5 text-muted-foreground dark:bg-white/10';
}

function statusTone(item: InboxItem): string {
  if (isInboxItemActionable(item)) {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  }
  if (item.status === 'failed' || item.status === 'denied' || item.status === 'rejected') {
    return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400';
  }
  return 'border-border bg-black/5 text-muted-foreground dark:bg-white/10';
}

function formatTime(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function Inbox() {
  const { t, i18n } = useTranslation('inbox');
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<InboxView>('actionable');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [remotePreviewState, setRemotePreviewState] = useState<{
    key: string | null;
    preview: RemoteTaskPreview | null;
    loading: boolean;
  }>({ key: null, preview: null, loading: false });
  const source = parseSource(searchParams.get('source'));
  const {
    items,
    loading,
    loaded,
    busyKey,
    sourceErrors,
    lastUpdatedAt,
    refresh,
    decidePermission,
    actOnRemoteTask,
    actOnBrowserTask,
    previewRemoteTask,
  } = useInboxStore(useShallow((state) => ({
    items: state.items,
    loading: state.loading,
    loaded: state.loaded,
    busyKey: state.busyKey,
    sourceErrors: state.sourceErrors,
    lastUpdatedAt: state.lastUpdatedAt,
    refresh: state.refresh,
    decidePermission: state.decidePermission,
    actOnRemoteTask: state.actOnRemoteTask,
    actOnBrowserTask: state.actOnBrowserTask,
    previewRemoteTask: state.previewRemoteTask,
  })));

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredItems = useMemo(() => items.filter((item) => {
    if (source !== 'all' && item.source !== source) return false;
    return view === 'actionable' ? isInboxItemActionable(item) : !isInboxItemActionable(item);
  }), [items, source, view]);

  const selectedItem = useMemo(
    () => filteredItems.find((item) => item.key === selectedKey) ?? null,
    [filteredItems, selectedKey],
  );

  useEffect(() => {
    if (selectedItem?.source !== 'remote-task') return;
    let cancelled = false;
    previewRemoteTask(selectedItem.id)
      .then((preview) => {
        if (!cancelled) setRemotePreviewState({ key: selectedItem.key, preview, loading: false });
      })
      .catch(() => {
        if (!cancelled) setRemotePreviewState({ key: selectedItem.key, preview: null, loading: false });
      });
    return () => { cancelled = true; };
  }, [previewRemoteTask, selectedItem?.id, selectedItem?.key, selectedItem?.source]);

  const remotePreview = selectedItem?.source === 'remote-task' && remotePreviewState.key === selectedItem.key
    ? remotePreviewState.preview
    : null;
  const previewLoading = selectedItem?.source === 'remote-task' && remotePreviewState.key !== selectedItem.key;

  const setSource = (nextSource: SourceFilter) => {
    const next = new URLSearchParams(searchParams);
    if (nextSource === 'all') next.delete('source');
    else next.set('source', nextSource);
    setSearchParams(next, { replace: true });
    setSelectedKey(null);
  };

  const runAction = async (item: InboxItem, action: string) => {
    try {
      if (item.source === 'permission') {
        await decidePermission(item.id, action === 'approve' ? 'approved' : 'denied');
      } else if (item.source === 'remote-task') {
        await actOnRemoteTask(item.id, action as 'approve' | 'reject' | 'execute');
      } else {
        await actOnBrowserTask(item.id, action as 'approve-and-run' | 'reject');
      }
      toast.success(t(`toast.${action}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const sourceErrorEntries = Object.entries(sourceErrors) as Array<[InboxSource, string]>;

  return (
    <WorkbenchPageShell
      testId="inbox-page"
      title={t('title')}
      description={t('description')}
      className="h-full min-h-0"
      actions={(
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('actions.refresh')}
          title={t('actions.refresh')}
          disabled={loading}
          onClick={() => void refresh()}
          data-testid="inbox-refresh"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin motion-reduce:animate-none')} />
        </Button>
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col border-y border-border bg-material-panel">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex items-center gap-1" role="tablist" aria-label={t('filters.view')}>
            {(['actionable', 'history'] as const).map((value) => {
              const isActive = view === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-testid={`inbox-view-${value}`}
                  className={cn(
                    'flex h-8 shrink-0 items-center gap-2 border-b-2 px-3 text-[13px] font-medium transition-colors',
                    isActive
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-black/20 hover:text-foreground dark:hover:border-white/20',
                  )}
                  onClick={() => { setView(value); setSelectedKey(null); }}
                >
                  {t(`filters.${value}`)}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            {lastUpdatedAt ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {t('updated', { time: formatTime(lastUpdatedAt, i18n.language) })}
              </span>
            ) : null}
            <Select value={source} onValueChange={(value) => setSource(value as SourceFilter)}>
              <SelectTrigger size="sm" className="w-[154px]" data-testid="inbox-source-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_FILTERS.map((filter) => (
                  <SelectItem key={filter} value={filter}>{t(`filters.source.${filter}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {sourceErrorEntries.length > 0 ? (
          <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-300" data-testid="inbox-source-errors">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-medium">{t('partialError.title')}</p>
                {sourceErrorEntries.map(([errorSource, message]) => (
                  <p key={errorSource}>{t(`source.${errorSource}`)}: {message}</p>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          <section
            aria-label={t('list.label')}
            data-testid="inbox-list"
            className={cn(
              'min-h-0 flex-col overflow-y-auto border-r border-border',
              selectedItem ? 'hidden lg:flex' : 'flex',
            )}
          >
            {!loaded && loading ? (
              <InboxListLoading />
            ) : filteredItems.length === 0 ? (
              <div className="px-3 py-2 text-xs leading-5 text-muted-foreground">
                {t(`empty.${view}.title`)}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    data-testid={`inbox-item-${item.key}`}
                    className={cn(
                      'flex min-h-[76px] w-full gap-3 px-3 py-3 text-left transition-colors duration-150 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none dark:hover:bg-white/5',
                      selectedItem?.key === item.key && 'bg-black/5 dark:bg-white/10',
                    )}
                    onClick={() => setSelectedKey(item.key)}
                  >
                    <span className="mt-0.5 text-muted-foreground">{sourceIcon(item.source)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-foreground">{item.title}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(item.timestamp, i18n.language)}</span>
                      </span>
                      <span className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">
                        {item.summary || t(`source.${item.source}`)}
                      </span>
                      <span className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{t(`source.${item.source}`)}</span>
                        <span aria-hidden="true">/</span>
                        <span>{t(statusKey(item))}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section
            aria-label={t('detail.label')}
            data-testid="inbox-detail"
            className={cn(
              'min-h-0 flex-col overflow-y-auto',
              selectedItem ? 'flex' : 'hidden lg:flex',
            )}
          >
            {selectedItem ? (
              <InboxDetail
                item={selectedItem}
                remotePreview={remotePreview}
                previewLoading={previewLoading}
                busy={busyKey === selectedItem.key}
                locale={i18n.language}
                onBack={() => setSelectedKey(null)}
                onAction={(action) => void runAction(selectedItem, action)}
              />
            ) : (
              <div className="flex min-h-64 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {t('detail.select')}
              </div>
            )}
          </section>
        </div>
      </div>
    </WorkbenchPageShell>
  );
}

function InboxListLoading() {
  return (
    <div className="divide-y divide-border" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex min-h-[76px] gap-3 px-3 py-3">
          <LoadingBar className="h-4 w-4 shrink-0" />
          <div className="flex-1 space-y-2">
            <LoadingBar className="h-3.5 w-2/3" />
            <LoadingBar className="h-3 w-full" />
            <LoadingBar className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadingBar({ className }: { className?: string }) {
  return <div className={cn('rounded bg-black/10 dark:bg-white/10', className)} />;
}

function InboxDetail({
  item,
  remotePreview,
  previewLoading,
  busy,
  locale,
  onBack,
  onAction,
}: {
  item: InboxItem;
  remotePreview: RemoteTaskPreview | null;
  previewLoading: boolean;
  busy: boolean;
  locale: string;
  onBack: () => void;
  onAction: (action: string) => void;
}) {
  const { t } = useTranslation('inbox');
  const sourceDetail = item.source === 'permission'
    ? t(`permissionSource.${item.approval.source}`)
    : item.source === 'remote-task'
      ? t(`remoteSource.${item.task.source}`)
      : item.task.profile;

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2 lg:hidden"
          onClick={onBack}
          data-testid="inbox-detail-back"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t('actions.back')}
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {sourceIcon(item.source)}
              <span>{t(`source.${item.source}`)}</span>
              <span aria-hidden="true">/</span>
              <span>{sourceDetail}</span>
            </div>
            <h2 className="mt-2 break-words text-lg font-medium leading-6 text-foreground">{item.title}</h2>
            {item.summary ? <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{item.summary}</p> : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={cn('font-normal', riskTone(item.risk))}>{t(`risk.${item.risk}`)}</Badge>
            <Badge variant="outline" className={cn('font-normal', statusTone(item))}>{t(statusKey(item))}</Badge>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{formatTime(item.timestamp, locale)}</p>
      </div>

      <div className="flex-1 px-4 py-4 sm:px-5">
        <section>
          <h3 className="text-xs font-medium uppercase text-muted-foreground">{t('evidence.title')}</h3>
          {item.evidence.length > 0 ? (
            <dl className="mt-2 divide-y divide-border border-y border-border">
              {item.evidence.map((entry, index) => (
                <div key={`${entry.kind}-${index}`} className="grid gap-1 py-2.5 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-xs text-muted-foreground">{t(`evidence.${entry.kind}`)}</dt>
                  <dd className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">{entry.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t('evidence.empty')}</p>
          )}
        </section>

        {item.source === 'remote-task' && (previewLoading || remotePreview?.changes.length) ? (
          <section className="mt-5">
            <h3 className="text-xs font-medium uppercase text-muted-foreground">{t('preview.title')}</h3>
            {previewLoading ? (
              <div className="mt-2 space-y-2"><LoadingBar className="h-4 w-1/3" /><LoadingBar className="h-12 w-full" /></div>
            ) : (
              <dl className="mt-2 divide-y divide-border border-y border-border">
                {remotePreview?.changes.map((change) => (
                  <div key={change.key} className="grid gap-1 py-2.5 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-xs text-muted-foreground">{change.key}</dt>
                    <dd className="text-xs leading-5">
                      <span className="text-muted-foreground">{t('preview.before')}: {JSON.stringify(change.before)}</span>
                      <span className="block text-foreground">{t('preview.after')}: {JSON.stringify(change.after)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        ) : null}

        {item.source === 'permission' && isInboxItemActionable(item) ? (
          <p className="mt-5 border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">
            {t('permissionRetryNote')}
          </p>
        ) : null}
      </div>

      {item.actions.length > 0 ? (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5" data-testid="inbox-detail-actions">
          {item.actions.map((action, index) => (
            <Button
              key={action}
              type="button"
              size="sm"
              variant={index === 0 ? 'default' : 'ghost'}
              disabled={busy}
              data-testid={`inbox-action-${action}`}
              onClick={() => onAction(action)}
            >
              {action === 'execute' ? <Play className="mr-1.5 h-4 w-4" /> : action === 'approve' || action === 'approve-and-run' ? <Check className="mr-1.5 h-4 w-4" /> : <X className="mr-1.5 h-4 w-4" />}
              {t(`actions.${action}`)}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
