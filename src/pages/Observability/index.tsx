import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock,
  Coins,
  FileCode2,
  Gauge,
  GitBranch,
  GitCompareArrows,
  KeyRound,
  ListTree,
  MessageSquareText,
  RefreshCw,
  Save,
  Search,
  SplitSquareHorizontal,
  Tags,
  Target,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useObservabilityStore } from '@/stores/observability';
import type {
  ObservabilityGraphNode,
  ObservabilityNodeDiagnostics,
  ObservabilityTraceGraph,
  ObservabilityTraceGraphResult,
  ObservabilityTraceStatus,
} from '@shared/types/observability';
import { cn } from '@/lib/utils';
import { roleTone, toneClasses } from '@/lib/role-visuals';
import { AgentTraceGraph } from './AgentTraceGraph';
import { TraceNodeDrawer } from './TraceNodeDrawer';
import { TraceWaterfall } from './TraceWaterfall';
import type { ObservabilityTraceIndexEntry, ObservabilityTraceIssue } from '@shared/types/observability';

type TraceRow = ObservabilityTraceIndexEntry | NonNullable<ReturnType<typeof useObservabilityStore.getState>['snapshot']>['traces'][number];
type ViewMode = 'graph' | 'tree' | 'swimlane';
type SavedViewKey = 'all' | 'recentErrors' | 'artifactRuns' | 'approvalRuns' | 'retryWarnings' | 'custom';

type TraceFilterState = {
  statusFilter: string;
  timeFilter: string;
  toolFilter: string;
  query: string;
};

type TraceAnnotation = {
  status: 'open' | 'reviewed' | 'ignored';
  tags: string;
  note: string;
  updatedAt?: number;
};

const TRACE_ANNOTATIONS_KEY = 'clawx.observability.traceAnnotations.v1';
const TRACE_SAVED_VIEW_KEY = 'clawx.observability.savedView.v1';

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    if (
      parsed
      && typeof parsed === 'object'
      && fallback
      && typeof fallback === 'object'
      && !Array.isArray(parsed)
      && !Array.isArray(fallback)
    ) {
      return { ...fallback, ...parsed };
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function persistJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ts?: number): string {
  if (!ts) return '-';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ts));
}

function statusIcon(status: ObservabilityTraceStatus) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'error':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'aborted':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    default:
      return <Activity className="h-3.5 w-3.5 text-blue-500 animate-pulse" />;
  }
}

function cardTone(tone?: string): string {
  switch (tone) {
    case 'good':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20';
    case 'warn':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
    case 'bad':
      return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20';
    default:
      return 'bg-black/5 dark:bg-white/5 text-foreground border-transparent';
  }
}

function metricIcon(id: string) {
  if (id === 'traces') return <Activity className="h-3.5 w-3.5" />;
  if (id === 'avg-duration') return <Clock className="h-3.5 w-3.5" />;
  if (id === 'errors') return <XCircle className="h-3.5 w-3.5" />;
  if (id === 'subagents') return <Zap className="h-3.5 w-3.5" />;
  if (id === 'tools') return <Gauge className="h-3.5 w-3.5" />;
  if (id === 'tokens') return <BarChart3 className="h-3.5 w-3.5" />;
  if (id === 'cost') return <Coins className="h-3.5 w-3.5" />;
  return <Activity className="h-3.5 w-3.5" />;
}

function roleBadge(role?: string) {
  if (!role) return null;
  const tone = toneClasses(roleTone(role));
  return (
    <Badge variant="secondary" className={cn('rounded-full border text-2xs', tone.tint)}>
      {role}
    </Badge>
  );
}

function issueToneClass(issue: ObservabilityTraceIssue): string {
  if (issue.severity === 'critical' || issue.severity === 'error') return 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400';
  if (issue.severity === 'warning') return 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400';
  return 'border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400';
}

function sourceStatusClass(status?: string): string {
  switch (status) {
    case 'live':
      return 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400';
    case 'stale':
      return 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400';
    case 'partial':
      return 'border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400';
    case 'rehydrated':
      return 'border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-400';
    default:
      return 'border-black/10 text-muted-foreground dark:border-white/10';
  }
}

function nodeDetailValue(value?: string | number | null): string {
  if (value == null || value === '') return '-';
  return String(value);
}

export function ObservabilityDashboard() {
  const {
    snapshot,
    loading,
    error,
    fetchDashboard,
    queryResult,
    queryTraces,
    clearTraces,
    selectTrace,
    selectedTraceId,
    selectedTrace,
    selectedGraph,
    selectedNodeDiagnostics,
    traceLoading,
    diagnosticsLoading,
    loadNodeDiagnostics,
    subscribeRealtime,
  } = useObservabilityStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [timeFilter, setTimeFilter] = useState<string>('all');
  const [toolFilter, setToolFilter] = useState<string>('all');
  const [query, setQuery] = useState<string>('');
  // Date.now() must not be called during render (react-hooks/purity), so seed
  // the cutoff via a lazy useState initializer and recompute in an effect
  // when the time filter changes. The cascading setState in the effect is the
  // standard pattern for time-based filters in React 19.
  const [timeCutoff, setTimeCutoff] = useState(() =>
    timeFilter === 'hour'
      ? Date.now() - 60 * 60 * 1000
      : timeFilter === 'day'
        ? Date.now() - 24 * 60 * 60 * 1000
        : 0,
  );
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [savedView, setSavedView] = useState<SavedViewKey>('all');
  const [customSavedView, setCustomSavedView] = useState<TraceFilterState | null>(() => loadJson<TraceFilterState | null>(TRACE_SAVED_VIEW_KEY, null));
  const [compareTraceId, setCompareTraceId] = useState<string>('none');
  const [annotations, setAnnotations] = useState<Record<string, TraceAnnotation>>(() => loadJson<Record<string, TraceAnnotation>>(TRACE_ANNOTATIONS_KEY, {}));
  // The selected node is derived from three sources (in priority order):
  //   1. URL search param `nodeId` (deep-link / share-link entry point)
  //   2. A node the user explicitly picked in this session (userNodeId)
  //   3. Auto-selected first critical/error node from the graph (unless cleared)
  // Deriving during render avoids the cascading setState-in-effect pattern
  // (see https://react.dev/learn/you-might-not-need-an-effect).
  const [userNodeId, setUserNodeId] = useState<string | null>(null);
  const [isCleared, setIsCleared] = useState(false);
  const { t } = useTranslation('observability');

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- recompute "now"-based cutoff when time filter changes; the cascade is bounded to one re-render per filter change
    setTimeCutoff(
      timeFilter === 'hour'
        ? Date.now() - 60 * 60 * 1000
        : timeFilter === 'day'
          ? Date.now() - 24 * 60 * 60 * 1000
          : 0,
    );
  }, [timeFilter]);

  useEffect(() => {
    const from = timeFilter === 'hour'
      ? Date.now() - 60 * 60 * 1000
      : timeFilter === 'day'
        ? Date.now() - 24 * 60 * 60 * 1000
        : undefined;
    void queryTraces({
      page: 1,
      pageSize: 100,
      sortBy: 'updatedAt',
      sortDir: 'desc',
      status: statusFilter === 'all' ? 'all' : statusFilter as ObservabilityTraceStatus,
      from,
      keyword: query.trim() || undefined,
      hasToolCalls: toolFilter === 'with-tools' ? true : undefined,
      hasErrors: toolFilter === 'errors' ? true : undefined,
      hasArtifacts: toolFilter === 'artifacts' ? true : undefined,
      hasApproval: toolFilter === 'approvals' ? true : undefined,
      hasRetries: toolFilter === 'retries' ? true : undefined,
      hasWarnings: toolFilter === 'warnings' ? true : undefined,
    }, { silent: true });
  }, [query, queryTraces, statusFilter, timeFilter, toolFilter]);

  useEffect(() => {
    const unsubscribe = subscribeRealtime();
    return unsubscribe;
  }, [subscribeRealtime]);

  useEffect(() => {
    persistJson(TRACE_ANNOTATIONS_KEY, annotations);
  }, [annotations]);

  useEffect(() => {
    const traceId = searchParams.get('traceId');
    if (traceId && traceId !== selectedTraceId) {
      void selectTrace(traceId);
    }
  }, [searchParams, selectTrace, selectedTraceId]);

  // Derive the effective selected node id from URL, user pick, and graph
  // fallback (see comment on the state declarations above).
  const autoNodeId = useMemo(() => {
    if (!selectedGraph || isCleared) return null;
    return selectedGraph.graph.summary?.issues?.find((issue) => issue.nodeId && (issue.severity === 'critical' || issue.severity === 'error'))?.nodeId
      ?? selectedGraph.graph.summary?.errorNodeIds[0]
      ?? selectedGraph.graph.nodes[0]?.id
      ?? null;
  }, [selectedGraph, isCleared]);

  const requestedNodeId = useMemo(() => {
    const requested = searchParams.get('nodeId');
    if (requested && selectedGraph?.graph.nodes.some((node) => node.id === requested)) {
      return requested;
    }
    return null;
  }, [searchParams, selectedGraph]);

  const selectedNodeId = useMemo(() => {
    if (requestedNodeId) return requestedNodeId;
    if (userNodeId && selectedGraph?.graph.nodes.some((node) => node.id === userNodeId)) {
      return userNodeId;
    }
    return autoNodeId;
  }, [requestedNodeId, userNodeId, autoNodeId, selectedGraph]);

  useEffect(() => {
    if (!selectedTraceId || !selectedNodeId) return;
    void loadNodeDiagnostics(selectedTraceId, selectedNodeId);
  }, [loadNodeDiagnostics, selectedNodeId, selectedTraceId]);

  const filteredTraces = useMemo(() => {
    const rows = queryResult?.items ?? snapshot?.traces ?? [];
    const needle = query.trim().toLowerCase();
    return rows.filter((trace) => {
      if (statusFilter !== 'all' && trace.status !== statusFilter) return false;
      if (toolFilter === 'with-tools' && !trace.hasToolCalls) return false;
      if (toolFilter === 'errors' && trace.errorCount === 0 && trace.status !== 'error' && trace.status !== 'aborted') return false;
      if (toolFilter === 'artifacts' && (trace.artifactCount ?? 0) === 0) return false;
      if (toolFilter === 'approvals' && (trace.approvalCount ?? 0) === 0) return false;
      if (toolFilter === 'retries' && (trace.retryCount ?? 0) === 0) return false;
      if (toolFilter === 'warnings' && (trace.warningCount ?? 0) === 0) return false;
      if (timeCutoff && (trace.startedAt ?? 0) < timeCutoff) return false;
      if (!needle) return true;
      return [
        trace.name,
        trace.sessionKey,
        trace.runId,
        trace.leadRole,
        trace.slowestNodeLabel,
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [query, queryResult?.items, snapshot?.traces, statusFilter, timeCutoff, toolFilter]);

  const selectedNode = useMemo<ObservabilityGraphNode | null>(() => {
    if (!selectedGraph || !selectedNodeId) return null;
    return selectedGraph.graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [selectedGraph, selectedNodeId]);

  const allTraceRows = useMemo(() => queryResult?.items ?? snapshot?.traces ?? [], [queryResult?.items, snapshot?.traces]);
  const selectedTraceRow = useMemo(() => allTraceRows.find((trace) => trace.id === selectedTraceId) ?? null, [allTraceRows, selectedTraceId]);
  const compareTraceRow = useMemo(() => allTraceRows.find((trace) => trace.id === compareTraceId) ?? null, [allTraceRows, compareTraceId]);
  const selectedAnnotation = selectedTraceId ? annotations[selectedTraceId] : undefined;

  const applySavedView = (value: SavedViewKey) => {
    setSavedView(value);
    if (value === 'all') {
      setStatusFilter('all');
      setTimeFilter('all');
      setToolFilter('all');
      setQuery('');
      return;
    }
    if (value === 'recentErrors') {
      setStatusFilter('all');
      setTimeFilter('day');
      setToolFilter('errors');
      setQuery('');
      return;
    }
    if (value === 'artifactRuns') {
      setStatusFilter('all');
      setTimeFilter('all');
      setToolFilter('artifacts');
      setQuery('');
      return;
    }
    if (value === 'approvalRuns') {
      setStatusFilter('all');
      setTimeFilter('all');
      setToolFilter('approvals');
      setQuery('');
      return;
    }
    if (value === 'retryWarnings') {
      setStatusFilter('all');
      setTimeFilter('all');
      setToolFilter('warnings');
      setQuery('');
      return;
    }
    if (customSavedView) {
      setStatusFilter(customSavedView.statusFilter);
      setTimeFilter(customSavedView.timeFilter);
      setToolFilter(customSavedView.toolFilter);
      setQuery(customSavedView.query);
    }
  };

  const saveCurrentView = () => {
    const nextView = { statusFilter, timeFilter, toolFilter, query };
    setCustomSavedView(nextView);
    persistJson(TRACE_SAVED_VIEW_KEY, nextView);
    setSavedView('custom');
  };

  const updateAnnotation = (traceId: string, annotation: TraceAnnotation) => {
    setAnnotations((current) => ({
      ...current,
      [traceId]: {
        ...annotation,
        updatedAt: Date.now(),
      },
    }));
  };

  const openTrace = (trace: TraceRow, nodeId?: string) => {
    setIsCleared(false);
    setUserNodeId(nodeId ?? null);
    setSearchParams(nodeId ? { traceId: trace.id, nodeId } : { traceId: trace.id });
    void selectTrace(trace.id);
  };

  const selectGraphNode = (nodeId: string) => {
    setIsCleared(false);
    setUserNodeId(nodeId);
    if (selectedTraceId) setSearchParams({ traceId: selectedTraceId, nodeId });
  };

  const clearNodeSelection = () => {
    setIsCleared(true);
    setUserNodeId(null);
    if (selectedTraceId) setSearchParams({ traceId: selectedTraceId });
  };

  const handleClear = async () => {
    await clearTraces();
    setSearchParams({});
  };

  if (!snapshot && loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <AlertTriangle className="h-8 w-8 text-red-500" />
        <p className="text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={() => fetchDashboard()} className="h-9 rounded-md px-4">
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4" data-testid="observability-page">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-serif font-normal tracking-tight">{t('title')}</h2>
          <p className="mt-1 text-meta text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => fetchDashboard()} disabled={loading} className="h-9 rounded-md px-4">
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            {t('refresh')}
          </Button>
          {(snapshot?.traces.length ?? 0) > 0 && (
            <Button variant="ghost" onClick={handleClear} className="h-9 rounded-md px-3 text-muted-foreground hover:text-destructive" title={t('clear')}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {snapshot && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {snapshot.cards.map((card) => (
            <div key={card.id} className={cn('flex flex-col gap-2 rounded-md border p-3', cardTone(card.tone))}>
              <div className="flex items-center gap-2 text-meta text-muted-foreground">
                {metricIcon(card.id)}
                <span className="truncate">{card.label}</span>
              </div>
              <p className="text-xl font-semibold">
                {typeof card.value === 'number' && card.id === 'cost'
                  ? `$${card.value.toFixed(4)}`
                  : card.value}
                {card.unit && <span className="ml-1 text-xs text-muted-foreground">{card.unit}</span>}
              </p>
            </div>
          ))}
        </div>
      )}

      {snapshot?.alerts.length ? (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            {t('alerts')}
          </div>
          <div className="mt-2 space-y-1">
            {snapshot.alerts.map((alert) => (
              <p key={alert} className="text-xs text-amber-700 dark:text-amber-300">{alert}</p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid min-h-[620px] flex-1 grid-cols-1 gap-3 xl:grid-cols-[310px_minmax(480px,1fr)]">
        <aside className="flex min-h-0 flex-col rounded-md border border-black/10 dark:border-white/10 bg-background" data-testid="observability-trace-list">
          <div className="border-b border-black/10 dark:border-white/10 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              {t('traces')}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-md border bg-surface-input px-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('filters.search')}
                className="h-8 border-0 bg-transparent px-0 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Select value={savedView} onValueChange={(value) => applySavedView(value as SavedViewKey)}>
                <SelectTrigger size="sm" data-testid="observability-saved-view">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('savedViews.all')}</SelectItem>
                  <SelectItem value="recentErrors">{t('savedViews.recentErrors')}</SelectItem>
                  <SelectItem value="artifactRuns">{t('savedViews.artifactRuns')}</SelectItem>
                  <SelectItem value="approvalRuns">{t('savedViews.approvalRuns')}</SelectItem>
                  <SelectItem value="retryWarnings">{t('savedViews.retryWarnings')}</SelectItem>
                  <SelectItem value="custom" disabled={!customSavedView}>{t('savedViews.custom')}</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" className="h-8 rounded-md px-2" onClick={saveCurrentView} title={t('savedViews.saveCurrent')}>
                <Save className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('filters.allStatus')}</SelectItem>
                  <SelectItem value="running">{t('status.running')}</SelectItem>
                  <SelectItem value="completed">{t('status.completed')}</SelectItem>
                  <SelectItem value="error">{t('status.error')}</SelectItem>
                  <SelectItem value="aborted">{t('status.aborted')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={timeFilter} onValueChange={setTimeFilter}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('filters.allTime')}</SelectItem>
                  <SelectItem value="hour">{t('filters.lastHour')}</SelectItem>
                  <SelectItem value="day">{t('filters.lastDay')}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={toolFilter} onValueChange={setToolFilter}>
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('filters.allRuns')}</SelectItem>
                  <SelectItem value="with-tools">{t('filters.withTools')}</SelectItem>
                  <SelectItem value="errors">{t('filters.withErrors')}</SelectItem>
                  <SelectItem value="artifacts">{t('filters.withArtifacts')}</SelectItem>
                  <SelectItem value="approvals">{t('filters.withApprovals')}</SelectItem>
                  <SelectItem value="retries">{t('filters.withRetries')}</SelectItem>
                  <SelectItem value="warnings">{t('filters.withWarnings')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            {filteredTraces.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">{t('noTraces')}</p>
            ) : (
              filteredTraces.map((trace) => (
                <div
                  key={trace.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openTrace(trace)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') openTrace(trace);
                  }}
                  className={cn(
                    'mb-2 cursor-pointer rounded-md border p-3 text-left transition hover:bg-black/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 dark:hover:bg-white/[0.04]',
                    selectedTraceId === trace.id ? 'border-primary/40 bg-black/[0.03] dark:bg-white/[0.05]' : 'border-black/10 dark:border-white/10',
                  )}
                  data-testid="observability-trace-row"
                >
                  <div className="w-full text-left">
                    <div className="flex items-start gap-2">
                      {statusIcon(trace.status)}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{trace.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
                          <span>{formatTime(trace.startedAt)}</span>
                          <span>{formatDuration(trace.durationMs)}</span>
                          <span>{trace.spanCount} {t('spanUnit')}</span>
                          <span>{trace.tokenCount} {t('details.tokens')}</span>
                          {trace.costUsd > 0 && <span>${trace.costUsd.toFixed(4)}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Badge variant="outline" className="rounded-full text-2xs">{t(`status.${trace.status}`)}</Badge>
                    {roleBadge(trace.leadRole)}
                    {(trace.toolCallCount ?? 0) > 0 && <Badge variant="secondary" className="rounded-full text-2xs">{trace.toolCallCount} {t('filters.toolsShort')}</Badge>}
                    {(trace.artifactCount ?? 0) > 0 && <Badge variant="outline" className="rounded-full text-2xs">{trace.artifactCount} {t('filters.artifactsShort')}</Badge>}
                    {(trace.approvalCount ?? 0) > 0 && <Badge variant="outline" className="rounded-full text-2xs">{trace.approvalCount} {t('filters.approvalsShort')}</Badge>}
                    {(trace.retryCount ?? 0) > 0 && <Badge variant="outline" className="rounded-full border-amber-500/30 text-2xs text-amber-700 dark:text-amber-400">{trace.retryCount} {t('filters.retriesShort')}</Badge>}
                    {(trace.warningCount ?? 0) > 0 && <Badge variant="outline" className="rounded-full border-amber-500/30 text-2xs text-amber-700 dark:text-amber-400">{trace.warningCount} {t('filters.warningsShort')}</Badge>}
                    {annotations[trace.id] && (
                      <Badge variant="outline" className="rounded-full border-blue-500/30 text-2xs text-blue-700 dark:text-blue-400">
                        <MessageSquareText className="mr-1 h-3 w-3" />
                        {t(`annotations.status.${annotations[trace.id].status}`)}
                      </Badge>
                    )}
                    {trace.sourceStatus && (
                      <Badge variant="outline" className={cn('rounded-full text-2xs', sourceStatusClass(trace.sourceStatus))}>
                        {t(`sourceStatus.${trace.sourceStatus}`)}
                      </Badge>
                    )}
                  </div>
                  {(trace.issues?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {trace.issues?.slice(0, 2).map((issue) => (
                        <Badge key={issue.id} variant="outline" className={cn('rounded-full text-2xs', issueToneClass(issue))}>
                          {t(`issues.categories.${issue.category}`)}
                        </Badge>
                      ))}
                      {(trace.issueCount ?? trace.issues?.length ?? 0) > 2 && (
                        <Badge variant="outline" className="rounded-full text-2xs">+{(trace.issueCount ?? trace.issues?.length ?? 0) - 2}</Badge>
                      )}
                    </div>
                  )}
                  {trace.errorCount > 0 || trace.status === 'error' || trace.status === 'aborted' ? (
                    <button
                      type="button"
                      className="mt-2 flex items-center gap-1 text-2xs font-medium text-red-700 hover:underline dark:text-red-400"
                      onClick={(event) => {
                        event.stopPropagation();
                        openTrace(trace, trace.issues?.find((issue) => issue.nodeId && (issue.severity === 'critical' || issue.severity === 'error'))?.nodeId);
                      }}
                    >
                      <XCircle className="h-3 w-3" />
                      {trace.firstError ?? t('filters.openErrorPath')}
                    </button>
                  ) : trace.slowestNodeLabel ? (
                    <div className="mt-2 truncate text-2xs text-muted-foreground">
                      {t('filters.slowest')}: {trace.slowestNodeLabel}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
          {selectedGraph && selectedGraph.graph.nodes.length > 3 && (
            <QuickLocatePanel
              graph={selectedGraph.graph}
              selectedNodeId={selectedNodeId}
              onSelectNode={selectGraphNode}
            />
          )}
        </aside>

        <main className="flex min-h-0 flex-col gap-2">
          {traceLoading && !selectedGraph ? (
            <div className="flex h-full min-h-[520px] items-center justify-center rounded-md border">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : selectedGraph ? (
            <>
              <TraceSummaryHeader
                graphResult={selectedGraph}
                traceRow={selectedTraceRow}
                selectedNode={selectedNode}
                onSelectNode={selectGraphNode}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-black/10 bg-background px-3 py-2 dark:border-white/10">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Target className="h-3.5 w-3.5" />
                  {t('views.label')}
                </div>
                <div className="flex overflow-hidden rounded-md border border-black/10 bg-surface-input/50 dark:border-white/10" data-testid="observability-view-modes">
                  {([
                    ['graph', GitBranch],
                    ['tree', ListTree],
                    ['swimlane', SplitSquareHorizontal],
                  ] as const).map(([mode, Icon]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setViewMode(mode)}
                      className={cn(
                        'flex h-8 items-center gap-1.5 px-3 text-xs transition hover:bg-black/5 dark:hover:bg-white/10',
                        viewMode === mode && 'bg-black/5 font-medium text-foreground dark:bg-white/10',
                      )}
                      data-testid={`observability-view-${mode}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t(`views.${mode}`)}
                    </button>
                  ))}
                </div>
              </div>
              {viewMode === 'graph' ? (
                <AgentTraceGraph
                  graph={selectedGraph.graph}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={selectGraphNode}
                />
              ) : viewMode === 'tree' ? (
                <RunTreeView
                  graph={selectedGraph.graph}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={selectGraphNode}
                />
              ) : (
                <SwimlaneView
                  graph={selectedGraph.graph}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={selectGraphNode}
                />
              )}
            </>
          ) : (
            <div className="flex h-full min-h-[520px] flex-col items-center justify-center rounded-md border border-dashed border-black/10 dark:border-white/10 bg-black/[0.015] dark:bg-white/[0.02] p-8 text-center">
              <GitBranch className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{t('graph.emptyTitle')}</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">{t('graph.emptyBody')}</p>
            </div>
          )}
        </main>
      </div>

      <TraceNodeDrawer
        open={selectedNode !== null}
        onClose={clearNodeSelection}
        title={selectedNode?.label ?? t('details.empty')}
        subtitle={selectedNode?.subtitle ?? (selectedNode ? t(`nodeKinds.${selectedNode.kind}`) : undefined)}
        statusIcon={selectedNode ? statusIcon(selectedNode.status) : undefined}
      >
        <Tabs defaultValue="summary" className="flex h-full min-h-[520px] flex-col">
          <div className="border-b border-black/10 dark:border-white/10 p-3">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              <TabsTrigger value="summary" className="h-6 px-2 text-xs">{t('tabs.summary')}</TabsTrigger>
                <TabsTrigger value="issues" className="h-6 px-2 text-xs">{t('tabs.issues')}</TabsTrigger>
                <TabsTrigger value="events" className="h-6 px-2 text-xs">{t('tabs.events')}</TabsTrigger>
                <TabsTrigger value="io" className="h-6 px-2 text-xs">{t('tabs.io')}</TabsTrigger>
                <TabsTrigger value="artifacts" className="h-6 px-2 text-xs">{t('tabs.artifacts')}</TabsTrigger>
                <TabsTrigger value="compare" className="h-6 px-2 text-xs">{t('tabs.compare')}</TabsTrigger>
                <TabsTrigger value="annotation" className="h-6 px-2 text-xs">{t('tabs.annotation')}</TabsTrigger>
                <TabsTrigger value="attributes" className="h-6 px-2 text-xs">{t('tabs.attributes')}</TabsTrigger>
                <TabsTrigger value="timeline" className="h-6 px-2 text-xs">{t('tabs.timeline')}</TabsTrigger>
                <TabsTrigger value="score" className="h-6 px-2 text-xs">{t('tabs.score')}</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="summary" className="m-0 min-h-0 flex-1 overflow-auto p-4">
              {!selectedTrace || !selectedNode ? (
                <p className="text-xs text-muted-foreground">{t('details.empty')}</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center gap-2">
                      {statusIcon(selectedNode.status)}
                      <h3 className="truncate text-base font-medium">{selectedNode.label}</h3>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{selectedNode.subtitle ?? t(`nodeKinds.${selectedNode.kind}`)}</p>
                    {diagnosticsLoading && <p className="mt-1 text-2xs text-muted-foreground">{t('details.loadingDiagnostics')}</p>}
                  </div>
                  <EvidenceFirstPanel
                    issues={selectedGraph?.graph.summary?.issues ?? []}
                    selectedNodeId={selectedNode.id}
                    onSelectNode={selectGraphNode}
                  />
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Info label={t('details.status')} value={t(`status.${selectedNode.status}`)} />
                    <Info label={t('details.phase')} value={selectedNode.phase ? t(`phases.${selectedNode.phase}`) : '-'} />
                    <Info label={t('details.duration')} value={formatDuration(selectedNode.durationMs ?? 0)} />
                    <Info label={t('details.role')} value={nodeDetailValue(selectedNode.roleName)} />
                    <Info label={t('details.model')} value={nodeDetailValue(selectedNode.modelRef)} />
                    <Info label={t('details.tokens')} value={String(selectedNode.tokenUsage?.totalTokens ?? selectedTrace.tokenUsage.totalTokens ?? 0)} />
                    <Info label={t('details.cost')} value={`$${(selectedNode.tokenUsage?.costUsd ?? selectedTrace.tokenUsage.costUsd ?? 0).toFixed(5)}`} />
                    <Info label={t('details.sequence')} value={String(selectedNode.sequence ?? '-')} />
                  </div>
                  <DiagnosticSections diagnostics={selectedNodeDiagnostics} />
                  <Preview label={t('details.summary')} value={selectedNodeDiagnostics?.summary ?? selectedNode.summary ?? selectedNode.diagnosticPreview} />
                  {selectedNode.error && <ErrorPreview value={selectedNodeDiagnostics?.error ?? selectedNode.error} />}
                  <div className="rounded-md bg-surface-input p-3 text-2xs text-muted-foreground">
                    <div>{t('details.traceId')}: <span className="font-mono">{selectedTrace.id}</span></div>
                    <div>{t('details.session')}: <span className="font-mono">{selectedTrace.sessionKey ?? '-'}</span></div>
                    <div>{t('details.run')}: <span className="font-mono">{selectedTrace.runId ?? '-'}</span></div>
                    <div>{t('details.source')}: <span className="font-mono">{selectedGraph?.graph.summary?.sourceStatus ? t(`sourceStatus.${selectedGraph.graph.summary.sourceStatus}`) : '-'}</span></div>
                    <div>{t('details.redacted')}: <span className="font-mono">{selectedNodeDiagnostics?.redacted ? t('details.redactedYes') : '-'}</span></div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="issues" className="m-0 min-h-0 flex-1 overflow-auto p-4">
              <DiagnosticIssues
                issues={selectedGraph?.graph.summary?.issues ?? []}
                selectedNodeId={selectedNodeId}
                onSelectNode={selectGraphNode}
              />
            </TabsContent>

            <TabsContent value="events" className="m-0 min-h-0 flex-1 overflow-auto p-4">
              <DiagnosticEvents diagnostics={selectedNodeDiagnostics} selectedNodeId={selectedNodeId} onSelectNode={selectGraphNode} />
            </TabsContent>

            <TabsContent value="io" className="m-0 min-h-0 flex-1 overflow-auto p-4">
              <div className="space-y-3">
                <Preview label={t('details.input')} value={selectedNodeDiagnostics?.inputPreview ?? selectedNode?.inputPreview} />
                <Preview label={t('details.output')} value={selectedNodeDiagnostics?.outputPreview ?? selectedNode?.outputPreview} />
                {selectedNodeDiagnostics?.redacted && (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-2xs text-amber-700 dark:text-amber-400">
                    {t('details.redactionNotice')}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="artifacts" className="m-0 min-h-0 flex-1 overflow-auto p-4">
              <DiagnosticArtifacts diagnostics={selectedNodeDiagnostics} />
            </TabsContent>

            <TabsContent value="compare" className="m-0 min-h-0 flex-1 overflow-auto p-4">
              <TraceComparePanel
                selectedTrace={selectedTraceRow}
                compareTrace={compareTraceRow}
                traceOptions={allTraceRows.filter((trace) => trace.id !== selectedTraceId)}
                compareTraceId={compareTraceId}
                onCompareTraceIdChange={setCompareTraceId}
              />
            </TabsContent>

            <TabsContent value="annotation" className="m-0 min-h-0 flex-1 overflow-auto p-4">
              <TraceAnnotationPanel
                traceId={selectedTraceId}
                annotation={selectedAnnotation}
                onSave={updateAnnotation}
              />
            </TabsContent>

            <TabsContent value="attributes" className="m-0 min-h-0 flex-1 overflow-auto p-4">
              <DiagnosticAttributes diagnostics={selectedNodeDiagnostics} />
            </TabsContent>

            <TabsContent value="timeline" className="m-0 min-h-0 flex-1 overflow-auto p-4">
              {selectedGraph ? (
                <div className="space-y-3">
                  <TraceWaterfall trace={selectedGraph.trace} />
                  <div className="space-y-2">
                    {selectedGraph.timeline.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => item.nodeId && selectGraphNode(item.nodeId)}
                        className={cn(
                          'w-full rounded-md border border-black/10 dark:border-white/10 p-2 text-left text-xs hover:bg-black/[0.02] dark:hover:bg-white/[0.04]',
                          item.nodeId === selectedNodeId && 'bg-black/[0.03] dark:bg-white/[0.05]',
                          item.status === 'error' && 'border-red-500/30 bg-red-500/5',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium">{item.label}</span>
                          <span className="font-mono text-2xs text-muted-foreground">{formatTime(item.timestamp)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
                          <span className="truncate">{item.type}</span>
                          {item.status === 'error' && <Badge variant="outline" className="rounded-full border-red-500/30 text-[10px] text-red-700 dark:text-red-400">{t('status.error')}</Badge>}
                        </div>
                        {item.summary && <div className="mt-1 line-clamp-2 text-2xs text-muted-foreground">{item.summary}</div>}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t('traceUnavailable')}</p>
              )}
            </TabsContent>

            <TabsContent value="score" className="m-0 min-h-0 flex-1 overflow-auto p-4">
              {snapshot?.scorecards.length ? (
                <div className="space-y-3">
                  {snapshot.scorecards.map((scorecard) => (
                    <div key={scorecard.traceId} className="rounded-md border border-black/10 dark:border-white/10 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">{t('scorecardTrace', { id: scorecard.traceId.slice(0, 12) })}</span>
                        <Badge variant="secondary" className="rounded-full text-2xs">{scorecard.grade} ({scorecard.score})</Badge>
                      </div>
                      <div className="mt-2 space-y-1">
                        {scorecard.items.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-2 text-2xs">
                            <span className="truncate text-muted-foreground">{item.label}</span>
                            <span className="font-mono">{item.score}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t('score.empty')}</p>
              )}
            </TabsContent>
          </Tabs>
      </TraceNodeDrawer>
    </div>
  );
}

function TraceSummaryHeader({
  graphResult,
  traceRow,
  selectedNode,
  onSelectNode,
}: {
  graphResult: ObservabilityTraceGraphResult;
  traceRow: TraceRow | null;
  selectedNode: ObservabilityGraphNode | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation('observability');
  const { trace, graph } = graphResult;
  const primaryIssue = graph.summary?.issues?.find((issue) => issue.severity === 'critical' || issue.severity === 'error')
    ?? graph.summary?.issues?.[0];
  const artifactCount = traceRow?.artifactCount ?? graph.summary?.artifactNodeIds.length ?? 0;
  const tokenCount = traceRow?.tokenCount ?? trace.tokenUsage.totalTokens;
  const costUsd = traceRow?.costUsd ?? trace.tokenUsage.costUsd;

  return (
    <div className="rounded-md border border-black/10 bg-background p-3 dark:border-white/10" data-testid="observability-summary-header">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {statusIcon(trace.status)}
            <h3 className="truncate text-sm font-medium">{trace.name}</h3>
            {graph.summary?.sourceStatus && (
              <Badge variant="outline" className={cn('rounded-full text-2xs', sourceStatusClass(graph.summary.sourceStatus))}>
                {t(`sourceStatus.${graph.summary.sourceStatus}`)}
              </Badge>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
            <span className="font-mono">{trace.id}</span>
            {trace.sessionKey && <span>{trace.sessionKey}</span>}
            {selectedNode && <span>{t('summaryHeader.selected')}: {selectedNode.label}</span>}
          </div>
          {primaryIssue ? (
            <button
              type="button"
              className={cn('mt-3 rounded-md border px-3 py-2 text-left text-xs transition hover:bg-black/[0.02] dark:hover:bg-white/[0.04]', issueToneClass(primaryIssue))}
              onClick={() => primaryIssue.nodeId && onSelectNode(primaryIssue.nodeId)}
              disabled={!primaryIssue.nodeId}
            >
              <div className="flex items-center gap-2 font-medium">
                <Target className="h-3.5 w-3.5" />
                {t('summaryHeader.rootCause')}: {t(`issues.categories.${primaryIssue.category}`)}
              </div>
              {primaryIssue.detail && <div className="mt-1 line-clamp-2 text-2xs opacity-85">{primaryIssue.detail}</div>}
            </button>
          ) : (
            <div className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              {t('summaryHeader.noIssue')}
            </div>
          )}
        </div>
        <div className="grid min-w-[220px] grid-cols-2 gap-2 text-xs">
          <Info label={t('details.duration')} value={formatDuration(trace.durationMs ?? traceRow?.durationMs ?? 0)} />
          <Info label={t('details.tokens')} value={String(tokenCount)} />
          <Info label={t('details.cost')} value={`$${costUsd.toFixed(5)}`} />
          <Info label={t('diagnostics.items.artifacts')} value={String(artifactCount)} />
        </div>
      </div>
    </div>
  );
}

function flattenGraphTree(graph: ObservabilityTraceGraph): Array<ObservabilityGraphNode & { treeDepth: number }> {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const byParent = new Map<string, ObservabilityGraphNode[]>();
  for (const node of graph.nodes) {
    if (!node.parentId || !byId.has(node.parentId)) continue;
    byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node]);
  }
  const roots = graph.nodes
    .filter((node) => !node.parentId || !byId.has(node.parentId))
    .sort((a, b) => (a.sequence ?? a.startedAt ?? 0) - (b.sequence ?? b.startedAt ?? 0));
  const result: Array<ObservabilityGraphNode & { treeDepth: number }> = [];
  const visited = new Set<string>();
  const visit = (node: ObservabilityGraphNode, treeDepth: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    result.push({ ...node, treeDepth });
    for (const child of (byParent.get(node.id) ?? []).sort((a, b) => (a.sequence ?? a.startedAt ?? 0) - (b.sequence ?? b.startedAt ?? 0))) {
      visit(child, treeDepth + 1);
    }
  };
  roots.forEach((root) => visit(root, 0));
  graph.nodes
    .filter((node) => !visited.has(node.id))
    .sort((a, b) => (a.sequence ?? a.startedAt ?? 0) - (b.sequence ?? b.startedAt ?? 0))
    .forEach((node) => visit(node, 0));
  return result;
}

function RunTreeView({
  graph,
  selectedNodeId,
  onSelectNode,
}: {
  graph: ObservabilityTraceGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation('observability');
  const rows = useMemo(() => flattenGraphTree(graph), [graph]);
  return (
    <div className="min-h-[520px] overflow-auto rounded-md border border-black/10 bg-background p-3 dark:border-white/10" data-testid="observability-run-tree">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <ListTree className="h-4 w-4 text-muted-foreground" />
        {t('runTree.title')}
      </div>
      <div className="space-y-1">
        {rows.map((node) => (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelectNode(node.id)}
            className={cn(
              'grid w-full grid-cols-[minmax(0,1fr)_80px_70px] items-center gap-2 rounded-md border border-transparent px-2 py-2 text-left text-xs transition hover:border-black/10 hover:bg-black/[0.02] dark:hover:border-white/10 dark:hover:bg-white/[0.04]',
              selectedNodeId === node.id && 'border-primary/35 bg-black/[0.03] dark:bg-white/[0.05]',
              node.status === 'error' && 'border-red-500/30 bg-red-500/5',
            )}
            data-testid="observability-run-tree-row"
          >
            <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: node.treeDepth * 18 }}>
              {statusIcon(node.status)}
              <span className="min-w-0">
                <span className="block truncate font-medium">{node.label}</span>
                <span className="block truncate text-2xs text-muted-foreground">{node.phase ? t(`phases.${node.phase}`) : t(`nodeKinds.${node.kind}`)}</span>
              </span>
            </span>
            <span className="truncate text-2xs text-muted-foreground">{node.modelRef ?? node.roleName ?? t(`nodeKinds.${node.kind}`)}</span>
            <span className="text-right font-mono text-2xs text-muted-foreground">{formatDuration(node.durationMs ?? 0)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SwimlaneView({
  graph,
  selectedNodeId,
  onSelectNode,
}: {
  graph: ObservabilityTraceGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation('observability');
  const phaseOrder = ['input', 'routing', 'context', 'model', 'tool', 'artifact', 'approval', 'subagent', 'verifier', 'output', 'warning', 'error', 'orchestration', 'memory', 'event'];
  const lanes = useMemo(() => {
    const groups = new Map<string, ObservabilityGraphNode[]>();
    for (const node of graph.nodes) {
      const phase = node.phase ?? node.kind;
      groups.set(phase, [...(groups.get(phase) ?? []), node]);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => {
        const leftIndex = phaseOrder.indexOf(left);
        const rightIndex = phaseOrder.indexOf(right);
        return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
      })
      .map(([phase, nodes]) => [phase, nodes.sort((a, b) => (a.sequence ?? a.startedAt ?? 0) - (b.sequence ?? b.startedAt ?? 0))] as const);
  }, [graph.nodes]);

  return (
    <div className="min-h-[520px] overflow-auto rounded-md border border-black/10 bg-background p-3 dark:border-white/10" data-testid="observability-swimlane">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <SplitSquareHorizontal className="h-4 w-4 text-muted-foreground" />
        {t('swimlane.title')}
      </div>
      <div className="space-y-3">
        {lanes.map(([phase, nodes]) => (
          <section key={phase} className="grid grid-cols-[92px_minmax(0,1fr)] gap-3">
            <div className="pt-2 text-2xs font-medium uppercase text-muted-foreground">{t(`phases.${phase}`, { defaultValue: phase })}</div>
            <div className="flex min-h-12 flex-wrap gap-2 rounded-md bg-surface-input/45 p-2">
              {nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelectNode(node.id)}
                  className={cn(
                    'min-w-[150px] max-w-[220px] rounded-md border border-black/10 bg-background px-3 py-2 text-left text-xs shadow-sm transition hover:bg-black/[0.02] dark:border-white/10 dark:hover:bg-white/[0.04]',
                    selectedNodeId === node.id && 'ring-2 ring-primary/30',
                    node.status === 'error' && 'border-red-500/35 bg-red-500/5',
                    node.critical && 'border-primary/30',
                  )}
                  data-testid="observability-swimlane-node"
                >
                  <div className="flex items-center gap-2">
                    {statusIcon(node.status)}
                    <span className="truncate font-medium">{node.label}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-2xs text-muted-foreground">
                    <span className="truncate">{t(`nodeKinds.${node.kind}`)}</span>
                    <span className="font-mono">{formatDuration(node.durationMs ?? 0)}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function EvidenceFirstPanel({
  issues,
  selectedNodeId,
  onSelectNode,
}: {
  issues: ObservabilityTraceIssue[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation('observability');
  const issue = issues.find((entry) => entry.nodeId === selectedNodeId) ?? issues[0];
  if (!issue) {
    return (
      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400" data-testid="observability-evidence-panel">
        {t('evidence.noIssue')}
      </div>
    );
  }
  return (
    <div className={cn('rounded-md border p-3 text-xs', issueToneClass(issue))} data-testid="observability-evidence-panel">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            <Target className="h-3.5 w-3.5" />
            {t('evidence.title')}
          </div>
          <div className="mt-1 text-2xs opacity-85">
            {t('evidence.issueMeta', {
              category: t(`issues.categories.${issue.category}`),
              severity: t(`issues.severity.${issue.severity}`),
            })}
          </div>
        </div>
        {issue.nodeId && issue.nodeId !== selectedNodeId && (
          <Button type="button" variant="outline" className="h-7 rounded-md px-2 text-[10px]" onClick={() => issue.nodeId && onSelectNode(issue.nodeId)}>
            {t('issues.openNode')}
          </Button>
        )}
      </div>
      {issue.detail && (
        <div className="mt-3">
          <div className="text-2xs font-medium opacity-80">{t('evidence.why')}</div>
          <p className="mt-1 line-clamp-3 text-2xs opacity-90">{issue.detail}</p>
        </div>
      )}
      {issue.evidence?.length ? (
        <div className="mt-3">
          <div className="text-2xs font-medium opacity-80">{t('evidence.evidence')}</div>
          <div className="mt-1 space-y-1">
            {issue.evidence.slice(0, 3).map((entry) => (
              <div key={entry} className="truncate rounded bg-black/5 px-2 py-1 font-mono text-[10px] dark:bg-white/10">{entry}</div>
            ))}
          </div>
        </div>
      ) : null}
      {issue.recommendation && (
        <div className="mt-3">
          <div className="text-2xs font-medium opacity-80">{t('evidence.nextStep')}</div>
          <p className="mt-1 text-2xs opacity-90">{issue.recommendation}</p>
        </div>
      )}
    </div>
  );
}

function TraceComparePanel({
  selectedTrace,
  compareTrace,
  traceOptions,
  compareTraceId,
  onCompareTraceIdChange,
}: {
  selectedTrace: TraceRow | null;
  compareTrace: TraceRow | null;
  traceOptions: TraceRow[];
  compareTraceId: string;
  onCompareTraceIdChange: (traceId: string) => void;
}) {
  const { t } = useTranslation('observability');
  if (!selectedTrace) return <p className="text-xs text-muted-foreground">{t('traceUnavailable')}</p>;
  return (
    <div className="space-y-4" data-testid="observability-compare-panel">
      <div>
        <div className="flex items-center gap-2 text-xs font-medium">
          <GitCompareArrows className="h-3.5 w-3.5 text-muted-foreground" />
          {t('compare.title')}
        </div>
        <p className="mt-1 text-2xs text-muted-foreground">{t('compare.subtitle')}</p>
      </div>
      <Select value={compareTraceId} onValueChange={onCompareTraceIdChange}>
        <SelectTrigger size="sm">
          <SelectValue placeholder={t('compare.selectTrace')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('compare.none')}</SelectItem>
          {traceOptions.map((trace) => (
            <SelectItem key={trace.id} value={trace.id}>{trace.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!compareTrace ? (
        <div className="rounded-md border border-dashed border-black/10 p-4 text-xs text-muted-foreground dark:border-white/10">
          {t('compare.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          <CompareMetric label={t('details.duration')} base={formatDuration(selectedTrace.durationMs)} compare={formatDuration(compareTrace.durationMs)} delta={formatDuration(compareTrace.durationMs - selectedTrace.durationMs)} />
          <CompareMetric label={t('details.tokens')} base={String(selectedTrace.tokenCount)} compare={String(compareTrace.tokenCount)} delta={String(compareTrace.tokenCount - selectedTrace.tokenCount)} />
          <CompareMetric label={t('details.cost')} base={`$${selectedTrace.costUsd.toFixed(5)}`} compare={`$${compareTrace.costUsd.toFixed(5)}`} delta={`$${(compareTrace.costUsd - selectedTrace.costUsd).toFixed(5)}`} />
          <CompareMetric label={t('tabs.issues')} base={String(selectedTrace.issueCount ?? 0)} compare={String(compareTrace.issueCount ?? 0)} delta={String((compareTrace.issueCount ?? 0) - (selectedTrace.issueCount ?? 0))} />
        </div>
      )}
    </div>
  );
}

function CompareMetric({ label, base, compare, delta }: { label: string; base: string; compare: string; delta: string }) {
  const { t } = useTranslation('observability');
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_72px] items-center gap-2 rounded-md border border-black/10 p-2 text-xs dark:border-white/10">
      <span className="truncate font-medium">{label}</span>
      <span className="truncate text-right font-mono text-2xs text-muted-foreground">{base}</span>
      <span className="truncate text-right font-mono text-2xs text-muted-foreground">{compare}</span>
      <span className="truncate text-right font-mono text-2xs">{t('compare.delta', { value: delta })}</span>
    </div>
  );
}

function TraceAnnotationPanel({
  traceId,
  annotation,
  onSave,
}: {
  traceId: string | null;
  annotation?: TraceAnnotation;
  onSave: (traceId: string, annotation: TraceAnnotation) => void;
}) {
  const { t } = useTranslation('observability');
  const [status, setStatus] = useState<TraceAnnotation['status']>(annotation?.status ?? 'open');
  const [tags, setTags] = useState(annotation?.tags ?? '');
  const [note, setNote] = useState(annotation?.note ?? '');

  // Reset form state when the trace changes. Tracking the previous traceId
  // and resetting during render avoids cascading setState-in-effect re-renders
  // (see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [prevTraceId, setPrevTraceId] = useState(traceId);
  if (traceId !== prevTraceId) {
    setPrevTraceId(traceId);
    setStatus(annotation?.status ?? 'open');
    setTags(annotation?.tags ?? '');
    setNote(annotation?.note ?? '');
  }

  if (!traceId) return <p className="text-xs text-muted-foreground">{t('traceUnavailable')}</p>;
  return (
    <div className="space-y-4" data-testid="observability-annotation-panel">
      <div>
        <div className="flex items-center gap-2 text-xs font-medium">
          <MessageSquareText className="h-3.5 w-3.5 text-muted-foreground" />
          {t('annotations.title')}
        </div>
        <p className="mt-1 text-2xs text-muted-foreground">{t('annotations.subtitle')}</p>
      </div>
      <div className="space-y-2">
        <label className="text-2xs font-medium text-muted-foreground">{t('annotations.statusLabel')}</label>
        <Select value={status} onValueChange={(value) => setStatus(value as TraceAnnotation['status'])}>
          <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{t('annotations.status.open')}</SelectItem>
            <SelectItem value="reviewed">{t('annotations.status.reviewed')}</SelectItem>
            <SelectItem value="ignored">{t('annotations.status.ignored')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
          <Tags className="h-3 w-3" />
          {t('annotations.tags')}
        </label>
        <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t('annotations.tagsPlaceholder')} className="h-8 text-xs" />
      </div>
      <div className="space-y-2">
        <label className="text-2xs font-medium text-muted-foreground">{t('annotations.note')}</label>
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('annotations.notePlaceholder')} className="min-h-24 resize-none text-xs" />
      </div>
      {annotation?.updatedAt && (
        <p className="text-2xs text-muted-foreground">{t('annotations.updatedAt', { time: formatTime(annotation.updatedAt) })}</p>
      )}
      <Button type="button" className="h-8 rounded-md px-3 text-xs" onClick={() => onSave(traceId, { status, tags, note })}>
        <Save className="mr-1.5 h-3.5 w-3.5" />
        {t('annotations.save')}
      </Button>
    </div>
  );
}

function QuickLocatePanel({
  graph,
  selectedNodeId,
  onSelectNode,
}: {
  graph: ObservabilityTraceGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation('observability');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  const filteredNodes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...graph.nodes].sort(
      (a, b) => (a.sequence ?? a.startedAt ?? 0) - (b.sequence ?? b.startedAt ?? 0),
    );
    if (!needle) return sorted;
    return sorted.filter((node) =>
      [node.label, node.subtitle, node.roleName, node.modelRef, node.kind, node.phase]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [graph.nodes, query]);

  return (
    <div className="border-t border-black/10 dark:border-white/10" data-testid="observability-quick-locate">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('quickLocate.expand') : t('quickLocate.collapse')}
        data-testid="observability-quick-locate-toggle"
      >
        <span className="flex items-center gap-2">
          <ListTree className="h-3.5 w-3.5 text-muted-foreground" />
          {t('quickLocate.title')}
          <Badge variant="secondary" className="rounded-full text-2xs">{graph.nodes.length}</Badge>
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition', collapsed && 'rotate-180')} />
      </button>
      {!collapsed && (
        <div className="space-y-2 px-3 pb-3">
          <p className="text-2xs text-muted-foreground">{t('quickLocate.subtitle')}</p>
          <div className="flex items-center gap-2 rounded-md border bg-surface-input px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('quickLocate.searchPlaceholder')}
              className="h-7 border-0 bg-transparent px-0 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <div className="max-h-[220px] overflow-auto" data-testid="observability-quick-locate-list">
            {filteredNodes.length === 0 ? (
              <p className="p-2 text-center text-2xs text-muted-foreground">{t('quickLocate.empty')}</p>
            ) : (
              filteredNodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelectNode(node.id)}
                  className={cn(
                    'mb-1 flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs transition hover:bg-black/[0.02] dark:hover:bg-white/[0.04]',
                    selectedNodeId === node.id && 'border-primary/35 bg-black/[0.03] dark:bg-white/[0.05]',
                    node.status === 'error' && 'border-red-500/30 bg-red-500/5',
                  )}
                  data-testid="observability-quick-locate-row"
                >
                  {statusIcon(node.status)}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{node.label}</span>
                    <span className="block truncate text-2xs text-muted-foreground">
                      {node.subtitle ?? (node.phase ? t(`phases.${node.phase}`) : t(`nodeKinds.${node.kind}`))}
                    </span>
                  </span>
                  {typeof node.sequence === 'number' && (
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      {t('quickLocate.turnLabel', { sequence: node.sequence })}
                    </Badge>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-input p-2">
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs">{value}</div>
    </div>
  );
}

function Preview({ label, value }: { label: string; value?: string }) {
  const { t } = useTranslation('observability');
  if (!value) return null;
  const redactedMatch = /^redacted-preview:(\d+)(?::[a-f0-9]+)?$/u.exec(value);
  const displayValue = redactedMatch
    ? t('details.redactedPreview', { chars: redactedMatch[1] })
    : value;
  return (
    <div className="rounded-md border border-black/10 dark:border-white/10 p-3">
      <div className="text-xs font-medium">{label}</div>
      <p className="mt-1 break-words text-2xs text-muted-foreground">{displayValue}</p>
    </div>
  );
}

function ErrorPreview({ value }: { value?: string }) {
  const { t } = useTranslation('observability');
  if (!value) return null;
  return (
    <div className="rounded-md border border-red-500/25 bg-red-500/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
        <XCircle className="h-3.5 w-3.5" />
        {t('details.error')}
      </div>
      <p className="mt-1 break-words text-2xs text-red-700/85 dark:text-red-300">{value}</p>
    </div>
  );
}

function DiagnosticIssues({
  issues,
  selectedNodeId,
  onSelectNode,
}: {
  issues: ObservabilityTraceIssue[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation('observability');
  if (issues.length === 0) return <p className="text-xs text-muted-foreground">{t('issues.empty')}</p>;
  return (
    <div className="space-y-2" data-testid="observability-diagnostics-issues">
      {issues.map((issue) => (
        <button
          key={issue.id}
          type="button"
          disabled={!issue.nodeId}
          onClick={() => issue.nodeId && onSelectNode(issue.nodeId)}
          className={cn(
            'w-full rounded-md border p-3 text-left text-xs transition hover:bg-black/[0.02] disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-white/[0.04]',
            issueToneClass(issue),
            issue.nodeId === selectedNodeId && 'ring-2 ring-primary/25',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{t(`issues.categories.${issue.category}`)}</div>
              <div className="mt-1 text-2xs opacity-80">{t(`issues.severity.${issue.severity}`)}</div>
            </div>
            {issue.nodeId && <Badge variant="outline" className="rounded-full text-[10px]">{t('issues.openNode')}</Badge>}
          </div>
          {issue.detail && <p className="mt-2 line-clamp-3 text-2xs opacity-85">{issue.detail}</p>}
          {issue.evidence?.length ? (
            <div className="mt-2 space-y-1">
              {issue.evidence.slice(0, 3).map((entry) => (
                <div key={entry} className="truncate rounded bg-black/5 px-2 py-1 font-mono text-[10px] dark:bg-white/10">{entry}</div>
              ))}
            </div>
          ) : null}
          {issue.recommendation && <p className="mt-2 text-2xs opacity-90">{issue.recommendation}</p>}
        </button>
      ))}
    </div>
  );
}

function diagnosticToneClass(tone?: string): string {
  switch (tone) {
    case 'good':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'warn':
      return 'text-amber-700 dark:text-amber-400';
    case 'bad':
      return 'text-red-700 dark:text-red-400';
    default:
      return 'text-foreground';
  }
}

function DiagnosticSections({ diagnostics }: { diagnostics: ObservabilityNodeDiagnostics | null }) {
  const { t } = useTranslation('observability');
  if (!diagnostics?.sections.length) return null;
  return (
    <div className="grid grid-cols-1 gap-2">
      {diagnostics.sections.map((section) => (
        <div key={section.id} className="rounded-md border border-black/10 dark:border-white/10 p-3">
          <div className="text-xs font-medium">{t(`diagnostics.sections.${section.id}`)}</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {section.items.map((item) => (
              <div key={item.id} className="rounded-md bg-surface-input p-2">
                <div className="text-2xs text-muted-foreground">{t(`diagnostics.items.${item.id}`)}</div>
                <div className={cn('mt-1 truncate font-mono text-xs', diagnosticToneClass(item.tone))}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DiagnosticEvents({
  diagnostics,
  selectedNodeId,
  onSelectNode,
}: {
  diagnostics: ObservabilityNodeDiagnostics | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation('observability');
  if (!diagnostics) return <p className="text-xs text-muted-foreground">{t('details.loadingDiagnostics')}</p>;
  if (diagnostics.events.length === 0) return <p className="text-xs text-muted-foreground">{t('details.noEvents')}</p>;
  return (
    <div className="space-y-2" data-testid="observability-diagnostics-events">
      {diagnostics.events.map((event) => (
        <button
          key={event.id}
          type="button"
          onClick={() => event.nodeId && onSelectNode(event.nodeId)}
          className={cn(
            'w-full rounded-md border border-black/10 dark:border-white/10 p-2 text-left text-xs hover:bg-black/[0.02] dark:hover:bg-white/[0.04]',
            event.nodeId === selectedNodeId && 'bg-black/[0.03] dark:bg-white/[0.05]',
            event.status === 'error' && 'border-red-500/30 bg-red-500/5',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{event.label}</span>
            <span className="font-mono text-2xs text-muted-foreground">{formatTime(event.timestamp)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-2xs text-muted-foreground">
            <span className="truncate">{event.type}</span>
            {event.status && <Badge variant="outline" className="rounded-full text-[10px]">{t(`status.${event.status}`)}</Badge>}
          </div>
          {event.summary && <div className="mt-1 line-clamp-2 text-2xs text-muted-foreground">{event.summary}</div>}
        </button>
      ))}
    </div>
  );
}

function artifactIcon(type: ObservabilityNodeDiagnostics['artifacts'][number]['type']) {
  if (type === 'file' || type === 'patch') return <FileCode2 className="h-3.5 w-3.5" />;
  if (type === 'approval') return <KeyRound className="h-3.5 w-3.5" />;
  if (type === 'command') return <Gauge className="h-3.5 w-3.5" />;
  return <Activity className="h-3.5 w-3.5" />;
}

function DiagnosticArtifacts({ diagnostics }: { diagnostics: ObservabilityNodeDiagnostics | null }) {
  const { t } = useTranslation('observability');
  if (!diagnostics) return <p className="text-xs text-muted-foreground">{t('details.loadingDiagnostics')}</p>;
  if (diagnostics.artifacts.length === 0) return <p className="text-xs text-muted-foreground">{t('details.noArtifacts')}</p>;
  return (
    <div className="space-y-2" data-testid="observability-diagnostics-artifacts">
      {diagnostics.artifacts.map((artifact) => (
        <div key={artifact.id} className="rounded-md border border-black/10 dark:border-white/10 p-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/5 text-muted-foreground dark:bg-white/10">
              {artifactIcon(artifact.type)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-medium">{artifact.label}</span>
                <Badge variant="secondary" className="rounded-full text-[10px]">{t(`diagnostics.artifactTypes.${artifact.type}`)}</Badge>
              </div>
              {artifact.path && <div className="mt-1 truncate font-mono text-2xs text-muted-foreground">{artifact.path}</div>}
              {artifact.status && <div className="mt-1 text-2xs text-muted-foreground">{t(`status.${artifact.status}`)}</div>}
            </div>
          </div>
          {artifact.preview && <p className="mt-2 break-words text-2xs text-muted-foreground">{artifact.preview}</p>}
        </div>
      ))}
    </div>
  );
}

function DiagnosticAttributes({ diagnostics }: { diagnostics: ObservabilityNodeDiagnostics | null }) {
  const { t } = useTranslation('observability');
  const entries = Object.entries(diagnostics?.attributes ?? {});
  if (!diagnostics) return <p className="text-xs text-muted-foreground">{t('details.loadingDiagnostics')}</p>;
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">{t('details.noAttributes')}</p>;
  return (
    <div className="overflow-hidden rounded-md border border-black/10 dark:border-white/10" data-testid="observability-diagnostics-attributes">
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[110px_minmax(0,1fr)] border-b border-black/10 last:border-b-0 dark:border-white/10">
          <div className="bg-black/[0.02] p-2 font-mono text-2xs text-muted-foreground dark:bg-white/[0.04]">{key}</div>
          <div className="min-w-0 break-words p-2 font-mono text-2xs">{value}</div>
        </div>
      ))}
    </div>
  );
}
