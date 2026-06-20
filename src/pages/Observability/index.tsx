import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Coins,
  FileCode2,
  Gauge,
  GitBranch,
  KeyRound,
  RefreshCw,
  Search,
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
import { useObservabilityStore } from '@/stores/observability';
import type { ObservabilityGraphNode, ObservabilityNodeDiagnostics, ObservabilityTraceStatus } from '@shared/types/observability';
import { cn } from '@/lib/utils';
import { roleTone, toneClasses } from '@/lib/role-visuals';
import { AgentTraceGraph } from './AgentTraceGraph';
import { TraceWaterfall } from './TraceWaterfall';
import type { ObservabilityTraceIndexEntry, ObservabilityTraceIssue } from '@shared/types/observability';

type TraceRow = ObservabilityTraceIndexEntry | NonNullable<ReturnType<typeof useObservabilityStore.getState>['snapshot']>['traces'][number];

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
  const [query, setQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { t } = useTranslation('observability');

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

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
    const traceId = searchParams.get('traceId');
    if (traceId && traceId !== selectedTraceId) {
      void selectTrace(traceId);
    }
  }, [searchParams, selectTrace, selectedTraceId]);

  useEffect(() => {
    const requestedNode = searchParams.get('nodeId');
    const firstNode = requestedNode && selectedGraph?.graph.nodes.some((node) => node.id === requestedNode)
      ? requestedNode
      : selectedGraph?.graph.summary?.issues?.find((issue) => issue.nodeId && (issue.severity === 'critical' || issue.severity === 'error'))?.nodeId
        ?? selectedGraph?.graph.summary?.errorNodeIds[0]
        ?? selectedGraph?.graph.nodes[0]?.id
        ?? null;
    setSelectedNodeId((current) => {
      if (!selectedGraph) return null;
      if (requestedNode && selectedGraph.graph.nodes.some((node) => node.id === requestedNode)) return requestedNode;
      if (current && selectedGraph.graph.nodes.some((node) => node.id === current)) return current;
      return firstNode;
    });
  }, [searchParams, selectedGraph]);

  useEffect(() => {
    if (!selectedTraceId || !selectedNodeId) return;
    void loadNodeDiagnostics(selectedTraceId, selectedNodeId);
  }, [loadNodeDiagnostics, selectedNodeId, selectedTraceId]);

  const filteredTraces = useMemo(() => {
    const rows = queryResult?.items ?? snapshot?.traces ?? [];
    const cutoff = timeFilter === 'hour'
      ? Date.now() - 60 * 60 * 1000
      : timeFilter === 'day'
        ? Date.now() - 24 * 60 * 60 * 1000
        : 0;
    const needle = query.trim().toLowerCase();
    return rows.filter((trace) => {
      if (statusFilter !== 'all' && trace.status !== statusFilter) return false;
      if (toolFilter === 'with-tools' && !trace.hasToolCalls) return false;
      if (toolFilter === 'errors' && trace.errorCount === 0 && trace.status !== 'error' && trace.status !== 'aborted') return false;
      if (toolFilter === 'artifacts' && (trace.artifactCount ?? 0) === 0) return false;
      if (toolFilter === 'approvals' && (trace.approvalCount ?? 0) === 0) return false;
      if (toolFilter === 'retries' && (trace.retryCount ?? 0) === 0) return false;
      if (toolFilter === 'warnings' && (trace.warningCount ?? 0) === 0) return false;
      if (cutoff && (trace.startedAt ?? 0) < cutoff) return false;
      if (!needle) return true;
      return [
        trace.name,
        trace.sessionKey,
        trace.runId,
        trace.leadRole,
        trace.slowestNodeLabel,
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [query, queryResult?.items, snapshot?.traces, statusFilter, timeFilter, toolFilter]);

  const selectedNode = useMemo<ObservabilityGraphNode | null>(() => {
    if (!selectedGraph || !selectedNodeId) return null;
    return selectedGraph.graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [selectedGraph, selectedNodeId]);

  const openTrace = (trace: TraceRow, nodeId?: string) => {
    setSearchParams(nodeId ? { traceId: trace.id, nodeId } : { traceId: trace.id });
    if (nodeId) setSelectedNodeId(nodeId);
    void selectTrace(trace.id);
  };

  const selectGraphNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    if (selectedTraceId) setSearchParams({ traceId: selectedTraceId, nodeId });
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

      <div className="grid min-h-[620px] flex-1 grid-cols-1 gap-3 xl:grid-cols-[310px_minmax(480px,1fr)_330px]">
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
        </aside>

        <main className="min-h-0">
          {traceLoading && !selectedGraph ? (
            <div className="flex h-full min-h-[520px] items-center justify-center rounded-md border">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : selectedGraph ? (
            <AgentTraceGraph
              graph={selectedGraph.graph}
              selectedNodeId={selectedNodeId}
              onSelectNode={selectGraphNode}
            />
          ) : (
            <div className="flex h-full min-h-[520px] flex-col items-center justify-center rounded-md border border-dashed border-black/10 dark:border-white/10 bg-black/[0.015] dark:bg-white/[0.02] p-8 text-center">
              <GitBranch className="h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{t('graph.emptyTitle')}</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">{t('graph.emptyBody')}</p>
            </div>
          )}
        </main>

        <aside className="min-h-0 rounded-md border border-black/10 dark:border-white/10 bg-background" data-testid="observability-detail-panel">
          <Tabs defaultValue="summary" className="flex h-full min-h-[520px] flex-col">
            <div className="border-b border-black/10 dark:border-white/10 p-3">
              <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
                <TabsTrigger value="summary" className="h-6 px-2 text-xs">{t('tabs.summary')}</TabsTrigger>
                <TabsTrigger value="issues" className="h-6 px-2 text-xs">{t('tabs.issues')}</TabsTrigger>
                <TabsTrigger value="events" className="h-6 px-2 text-xs">{t('tabs.events')}</TabsTrigger>
                <TabsTrigger value="io" className="h-6 px-2 text-xs">{t('tabs.io')}</TabsTrigger>
                <TabsTrigger value="artifacts" className="h-6 px-2 text-xs">{t('tabs.artifacts')}</TabsTrigger>
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
        </aside>
      </div>
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
