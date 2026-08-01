import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, GitBranch, History, Play, RefreshCw, ShieldCheck, Square, Workflow, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { useWorkspacesStore } from '@/stores/workspaces';
import type {
  ClawGraphCompileResult,
  ClawGraphDiagnostic,
  ClawGraphReviewItem,
  ClawGraphRunEvent,
  ClawGraphRunNodeSnapshot,
  ClawGraphRunSnapshot,
  ClawGraphWorkflowFile,
} from '@shared/types/clawgraph';

function formatTime(value?: number): string {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusTone(status: string): string {
  if (status === 'complete' || status === 'done') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (status === 'review') return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  if (status === 'blocked' || status === 'failed' || status === 'aborted') return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400';
  if (status === 'running' || status === 'ready' || status === 'auditing' || status === 'handoff_received') return 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400';
  return 'border-border bg-black/5 text-muted-foreground dark:bg-white/10';
}

function diagnosticIcon(diagnostic: ClawGraphDiagnostic) {
  if (diagnostic.severity === 'error') return <XCircle className="h-4 w-4 text-red-700 dark:text-red-400" />;
  if (diagnostic.severity === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400" />;
  return <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
}

function NodeCard({ node, t }: { node: ClawGraphRunNodeSnapshot; t: ReturnType<typeof useTranslation<'clawGraph'>>['t'] }) {
  return (
    <article className="rounded-md border border-border/70 bg-background p-3" data-testid="clawgraph-node">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">{node.id}</h3>
        <Badge variant="outline" className={cn('rounded-full text-2xs', statusTone(node.status))}>
          {t(`status.${node.status}`)}
        </Badge>
        <Badge variant="outline" className="rounded-full text-2xs">{t(`nodeType.${node.type}`)}</Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {node.runtimeRole ?? node.role ?? t('run.noRole')} - {t('run.attempt', { count: node.attempt })}
      </p>
      {node.dependsOn.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">{t('dag.dependsOn', { deps: node.dependsOn.join(', ') })}</p>
      )}
      {node.handoff?.summary && <p className="mt-2 text-sm text-foreground/80">{node.handoff.summary}</p>}
      {node.error && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{node.error}</p>}
    </article>
  );
}

function ReviewItem({
  item,
  onDecision,
  t,
}: {
  item: ClawGraphReviewItem;
  onDecision: (item: ClawGraphReviewItem, decision: 'approve' | 'reject') => void;
  t: ReturnType<typeof useTranslation<'clawGraph'>>['t'];
}) {
  return (
    <article className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3" data-testid="clawgraph-review-item">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">{item.title}</h3>
            <Badge variant="outline" className="rounded-full text-2xs">{item.kind}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{item.nodeId ?? item.runId} - {formatTime(item.createdAt)}</p>
          <p className="mt-2 text-sm text-foreground/80">{item.reason}</p>
        </div>
        {item.status === 'open' && (
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => onDecision(item, 'reject')}>
              {t('actions.reject')}
            </Button>
            <Button type="button" size="sm" onClick={() => onDecision(item, 'approve')}>
              {t('actions.approve')}
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

export default function ClawGraphPage() {
  const { t } = useTranslation('clawGraph');
  const [searchParams] = useSearchParams();
  const activeWorkspace = useWorkspacesStore((state) => state.activeWorkspace);
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const [workflows, setWorkflows] = useState<ClawGraphWorkflowFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [compile, setCompile] = useState<ClawGraphCompileResult | null>(null);
  const [currentRun, setCurrentRun] = useState<ClawGraphRunSnapshot | null>(null);
  const [events, setEvents] = useState<ClawGraphRunEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);

  const workspaceId = activeWorkspace?.id ?? null;
  const deepLinkedRunId = searchParams.get('runId');
  const sessionKey = currentSessionKey ?? activeWorkspace?.activeSessionKey ?? '';
  const agentId = activeWorkspace?.selectedAgentId ?? activeWorkspace?.agentId ?? undefined;

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.path === selectedPath) ?? null,
    [selectedPath, workflows],
  );
  const compileOk = compile?.ok === true;
  const openReviews = currentRun?.reviewItems.filter((item) => item.status === 'open') ?? [];

  const refreshEvents = useCallback(async (runId: string) => {
    const result = await hostApi.clawGraph.events({ runId, limit: 200 });
    setEvents(result.events ?? []);
  }, []);

  const refreshRun = useCallback(async (runId?: string) => {
    const targetRunId = runId ?? currentRun?.runId;
    if (!targetRunId) return;
    const result = await hostApi.clawGraph.status({ runId: targetRunId });
    if (result.snapshot) {
      setCurrentRun(result.snapshot);
      await refreshEvents(result.snapshot.runId);
    }
  }, [currentRun?.runId, refreshEvents]);

  const compileWorkflow = useCallback(async (sourcePath: string) => {
    if (!sourcePath) {
      setCompile(null);
      return;
    }
    const result = await hostApi.clawGraph.compile({ workspaceId, sourcePath });
    setCompile(result.compile);
    if (!result.success && result.error) toast.error(result.error);
  }, [workspaceId]);

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApi.clawGraph.listWorkflows({ workspaceId });
      setWorkflows(result.workflows ?? []);
      const nextPath = selectedPath || result.workflows?.[0]?.path || '';
      setSelectedPath(nextPath);
      if (nextPath) await compileWorkflow(nextPath);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [compileWorkflow, selectedPath, workspaceId]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    if (!deepLinkedRunId) return;
    let cancelled = false;
    void hostApi.clawGraph.status({ runId: deepLinkedRunId }).then(async (result) => {
      if (cancelled || !result.snapshot) return;
      setCurrentRun(result.snapshot);
      await refreshEvents(result.snapshot.runId);
    }).catch((error) => {
      if (!cancelled) toast.error(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [deepLinkedRunId, refreshEvents]);

  useEffect(() => {
    if (!currentRun || !['queued', 'running', 'review'].includes(currentRun.status)) return;
    const timer = window.setInterval(() => {
      void refreshRun(currentRun.runId);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [currentRun, refreshRun]);

  useEffect(() => hostEvents.onClawGraphLifecycle((payload) => {
    if (!payload.snapshot) return;
    setCurrentRun((current) => {
      if (current && current.runId !== payload.snapshot.runId) return current;
      return payload.snapshot;
    });
    if (!currentRun || currentRun.runId === payload.snapshot.runId) {
      void refreshEvents(payload.snapshot.runId);
    }
  }), [currentRun, refreshEvents]);

  const handleSelectWorkflow = async (path: string) => {
    setSelectedPath(path);
    await compileWorkflow(path);
  };

  const startRun = async () => {
    if (!selectedWorkflow || !sessionKey) return;
    setStarting(true);
    try {
      const result = await hostApi.clawGraph.run({
        workspaceId,
        sourcePath: selectedWorkflow.path,
        sessionKey,
        ...(agentId ? { agentId } : {}),
      });
      if (result.approvalRequired) {
        toast.warning(result.error ?? t('toast.approvalRequired'));
        return;
      }
      if (!result.success || !result.snapshot) {
        toast.error(result.error ?? t('toast.runFailed'));
        return;
      }
      setCompile(result.compile ?? compile);
      setCurrentRun(result.snapshot);
      await refreshEvents(result.snapshot.runId);
      toast.success(t('toast.runStarted'));
    } finally {
      setStarting(false);
    }
  };

  const abortRun = async () => {
    if (!currentRun) return;
    const result = await hostApi.clawGraph.abort({ runId: currentRun.runId, reason: 'user_abort' });
    if (result.snapshot) setCurrentRun(result.snapshot);
    await refreshEvents(currentRun.runId);
  };

  const reviewDecision = async (item: ClawGraphReviewItem, decision: 'approve' | 'reject') => {
    if (!currentRun) return;
    const result = await hostApi.clawGraph.review({
      runId: currentRun.runId,
      reviewId: item.id,
      decision,
    });
    if (result.snapshot) setCurrentRun(result.snapshot);
    await refreshEvents(currentRun.runId);
  };

  return (
    <div data-testid="clawgraph-page" className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-normal tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadWorkflows()} disabled={loading}>
            <RefreshCw className={cn('mr-1.5 h-4 w-4', loading && 'animate-spin')} />
            {t('actions.refresh')}
          </Button>
          {currentRun && ['running', 'queued', 'review'].includes(currentRun.status) && (
            <Button type="button" variant="outline" size="sm" onClick={() => void abortRun()}>
              <Square className="mr-1.5 h-4 w-4" />
              {t('actions.abort')}
            </Button>
          )}
          <Button type="button" size="sm" onClick={() => void startRun()} disabled={!compileOk || !selectedWorkflow || !sessionKey || starting}>
            <Play className="mr-1.5 h-4 w-4" />
            {starting ? t('actions.starting') : t('actions.run')}
          </Button>
        </div>
      </header>

      <section className="grid shrink-0 gap-3 rounded-md border border-border/70 bg-background p-3 md:grid-cols-[minmax(220px,0.8fr)_minmax(260px,1.2fr)_minmax(220px,0.8fr)]">
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t('workflows.label')}</p>
          <Select value={selectedPath} onValueChange={(value) => void handleSelectWorkflow(value)}>
            <SelectTrigger className="h-9" data-testid="clawgraph-workflow-select">
              <SelectValue placeholder={t('workflows.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((workflow) => (
                <SelectItem key={workflow.path} value={workflow.path}>{workflow.relativePath}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 truncate text-2xs text-muted-foreground">{selectedWorkflow?.path ?? t('workflows.empty')}</p>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t('compile.label')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn('rounded-full', compileOk ? statusTone('done') : statusTone('failed'))}>
              {compileOk ? t('compile.ok') : t('compile.notReady')}
            </Badge>
            {compile?.ir && <span className="text-xs text-muted-foreground">{compile.ir.nodes.length} {t('compile.nodes')}</span>}
            {compile?.ir && <span className="text-xs text-muted-foreground">{t('compile.parallel', { count: compile.ir.maxParallel })}</span>}
          </div>
          <div className="mt-2 max-h-20 space-y-1 overflow-y-auto">
            {(compile?.diagnostics ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('compile.noDiagnostics')}</p>
            ) : (
              compile!.diagnostics.map((diagnostic, index) => (
                <div key={`${diagnostic.code}:${index}`} className="flex items-start gap-2 text-xs text-muted-foreground">
                  {diagnosticIcon(diagnostic)}
                  <span>{diagnostic.path ? `${diagnostic.path}: ` : ''}{diagnostic.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t('run.label')}</p>
          {currentRun ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn('rounded-full', statusTone(currentRun.status))}>
                  {t(`runStatus.${currentRun.status}`)}
                </Badge>
                <span className="text-xs text-muted-foreground">{currentRun.progress}%</span>
              </div>
              <p className="truncate text-xs text-foreground">{currentRun.title}</p>
              <p className="truncate text-2xs text-muted-foreground">{currentRun.runId}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('run.empty')}</p>
          )}
        </div>
      </section>

      <Tabs defaultValue="dag" className="min-h-0 flex-1 overflow-hidden">
        <TabsList className="shrink-0">
          <TabsTrigger value="dag"><GitBranch className="mr-1.5 h-4 w-4" />{t('tabs.dag')}</TabsTrigger>
          <TabsTrigger value="events"><History className="mr-1.5 h-4 w-4" />{t('tabs.events')}</TabsTrigger>
          <TabsTrigger value="review"><ShieldCheck className="mr-1.5 h-4 w-4" />{t('tabs.review')}</TabsTrigger>
        </TabsList>

        <TabsContent value="dag" className="h-[calc(100%-3rem)] overflow-y-auto">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="clawgraph-dag">
            {(currentRun?.nodes ?? []).length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">
                <Workflow className="mx-auto mb-2 h-5 w-5" />
                {t('dag.empty')}
              </div>
            ) : (
              currentRun!.nodes.map((node) => <NodeCard key={node.id} node={node} t={t} />)
            )}
          </div>
        </TabsContent>

        <TabsContent value="events" className="h-[calc(100%-3rem)] overflow-y-auto">
          <div className="space-y-2" data-testid="clawgraph-events">
            {events.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('events.empty')}</div>
            ) : events.slice().reverse().map((event) => (
              <article key={event.id} className="rounded-md border border-border/70 bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{t(`eventType.${event.type}`)}</p>
                  {event.nodeId && <Badge variant="outline" className="rounded-full text-2xs">{event.nodeId}</Badge>}
                  <span className="text-xs text-muted-foreground">{formatTime(event.createdAt)}</span>
                </div>
                {event.message && <p className="mt-1 text-xs text-muted-foreground">{event.message}</p>}
              </article>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="review" className="h-[calc(100%-3rem)] overflow-y-auto">
          <div className="space-y-3" data-testid="clawgraph-review">
            {openReviews.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('review.empty')}</div>
            ) : openReviews.map((item) => (
              <ReviewItem key={item.id} item={item} onDecision={reviewDecision} t={t} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
