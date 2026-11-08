import { ManagedTasks } from './ManagedTasks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, GitBranch, GitMerge, History, Link2, ListTree, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QuietLoadingSurface } from '@/components/loading/StructuralLoadingOverlay';
import { QuietListSkeleton } from '@/components/loading/PageLoadingSkeletons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { hostApi } from '@/lib/host-api';
import { isReadOnlyTaskLedgerProjection } from '@/lib/task-ledger-plan-projection';
import { cn } from '@/lib/utils';
import { activateWorkspaceScopedSession } from '@/lib/workspace-session';
import { useChatStore } from '@/stores/chat';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { TaskLedgerNode, TaskLedgerNodeKind, TaskLedgerNodeStatus, TaskLedgerSnapshot } from '@shared/types/task-ledger';

const NODE_KINDS: TaskLedgerNodeKind[] = ['goal', 'milestone', 'task', 'check', 'decision', 'risk', 'deviation', 'review'];
const NODE_STATUSES: TaskLedgerNodeStatus[] = ['todo', 'doing', 'blocked', 'review', 'done', 'dropped'];

function statusTone(status: TaskLedgerNodeStatus): string {
  if (status === 'done') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (status === 'blocked') return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400';
  if (status === 'review') return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  if (status === 'doing') return 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400';
  return 'border-border bg-black/5 text-muted-foreground dark:bg-white/10';
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

type NodeCardProps = {
  node: TaskLedgerNode;
  getChildren: (nodeId: string) => TaskLedgerNode[];
  onStatus: (node: TaskLedgerNode, status: TaskLedgerNodeStatus) => void;
  onReviewClear: (node: TaskLedgerNode) => void;
  onOpenEvidence: (ref: string, type: string) => void;
  t: ReturnType<typeof useTranslation<'taskLedger'>>['t'];
};

function NodeCard({ node, getChildren, onStatus, onReviewClear, onOpenEvidence, t }: NodeCardProps) {
  const childrenNodes = getChildren(node.id);
  const readOnlyProjection = isReadOnlyTaskLedgerProjection(node);
  return (
    <article className="rounded-md border border-border/70 bg-background p-3" data-testid="task-ledger-node">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-medium text-foreground">{node.title}</h3>
            <Badge variant="outline" className="rounded-full text-2xs">{t(`kind.${node.kind}`)}</Badge>
            <Badge variant="outline" className={cn('rounded-full text-2xs', statusTone(node.status))}>{t(`status.${node.status}`)}</Badge>
          </div>
          {node.description && <p className="mt-1 text-xs text-muted-foreground">{node.description}</p>}
          <p className="mt-1 text-2xs text-muted-foreground">{formatTime(node.updatedAt)}</p>
        </div>
        <Select
          value={node.status}
          onValueChange={(value) => onStatus(node, value as TaskLedgerNodeStatus)}
          disabled={readOnlyProjection}
        >
          <SelectTrigger
            data-testid={`task-ledger-status-${node.id}`}
            className="h-8 w-28 text-xs"
            disabled={readOnlyProjection}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NODE_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>{t(`status.${status}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {(node.evidenceRefs ?? []).length > 0 && <div className="mt-2 flex flex-wrap gap-2" data-testid={`task-ledger-evidence-${node.id}`}>
        {node.evidenceRefs!.map((evidence) => <button key={`${evidence.type}:${evidence.ref}`} type="button"
          className="max-w-full truncate text-xs underline underline-offset-2" onClick={() => onOpenEvidence(evidence.ref, evidence.type)}>
          {evidence.label || evidence.ref}
        </button>)}
      </div>}
      {node.status === 'review' && !readOnlyProjection && (
        <Button type="button" variant="outline" size="sm" className="mt-3 h-8 text-xs" onClick={() => onReviewClear(node)}>
          <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
          {t('actions.clearReview')}
        </Button>
      )}
      {childrenNodes.length > 0 && (
        <div className="mt-3 space-y-2 border-l border-border/70 pl-3">
          {childrenNodes.map((child) => (
            <NodeCard key={child.id} node={child} getChildren={getChildren} onStatus={onStatus} onReviewClear={onReviewClear} onOpenEvidence={onOpenEvidence} t={t} />
          ))}
        </div>
      )}
    </article>
  );
}

export default function TaskLedgerPage() {
  const { t } = useTranslation('taskLedger');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeWorkspace = useWorkspacesStore((state) => state.activeWorkspace);
  const profiles = useWorkspacesStore((state) => state.profiles);
  const selectedSessionKey = useChatStore((state) => state.currentSessionKey);
  const [snapshot, setSnapshot] = useState<TaskLedgerSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab,setActiveTab]=useState('tree');
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<TaskLedgerNodeKind>('task');
  const [parentId, setParentId] = useState<string>('none');
  const [linkNodeId, setLinkNodeId] = useState<string>('none');

  const workspaceId = searchParams.get('workspaceId') ?? activeWorkspace?.id ?? null;
  const scopedWorkspace = profiles.find((profile) => profile.id === workspaceId);
  const hasScopedWorkspace = Boolean(scopedWorkspace);
  const currentSessionKey = searchParams.get('sessionKey') ?? (workspaceId === activeWorkspace?.id ? selectedSessionKey : null);
  const navigationVersion = useRef(0);
  useEffect(() => () => { navigationVersion.current += 1; }, [workspaceId, currentSessionKey]);
  const loadVersion = useRef(0);
  const focusedNodeId = searchParams.get('nodeId');

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setSnapshot(null);
    if (!workspaceId || !hasScopedWorkspace) return;
    setLoading(true);
    try {
      const result = await hostApi.taskLedger.snapshot({ workspaceId });
      if (result.snapshot.sourceWorkspaceId !== workspaceId) throw new Error('Task Ledger owner scope mismatch');
      if (version === loadVersion.current) setSnapshot(result.snapshot);
    } catch {
      if (version === loadVersion.current) toast.error(t('summary.scope.unavailable'));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [workspaceId, hasScopedWorkspace, t]);

  useEffect(() => {
    void load();
    return () => { loadVersion.current += 1; };
  }, [load]);

  useEffect(() => {
    if (focusedNodeId) setQuery(focusedNodeId);
  }, [focusedNodeId]);

  const filteredNodes = useMemo(() => {
    const nodes = snapshot?.nodes ?? [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return nodes;
    return nodes.filter((node) => JSON.stringify(node).toLowerCase().includes(normalized));
  }, [query, snapshot?.nodes]);

  const childMap = useMemo(() => {
    const ids = new Set(filteredNodes.map((node) => node.id));
    const map = new Map<string, TaskLedgerNode[]>();
    for (const node of filteredNodes) {
      const key = node.parentId && ids.has(node.parentId) ? node.parentId : 'root';
      map.set(key, [...(map.get(key) ?? []), node]);
    }
    return map;
  }, [filteredNodes]);

  const nodesById = useMemo(() => new Map((snapshot?.nodes ?? []).map((node) => [node.id, node])), [snapshot?.nodes]);
  const getChildren = useCallback((nodeId: string) => childMap.get(nodeId) ?? [], [childMap]);
  const reviewNodes = (snapshot?.reviewNodeIds ?? []).map((id) => nodesById.get(id)).filter(Boolean) as TaskLedgerNode[];

  const createNode = async () => {
    if (!title.trim()) return;
    const result = await hostApi.taskLedger.createNode({
      workspaceId,
      node: {
        title: title.trim(),
        description: description.trim() || undefined,
        kind,
        parentId: parentId === 'none' ? null : parentId,
        status: kind === 'goal' ? 'doing' : 'todo',
      },
      idempotencyKey: `ui:create:${Date.now()}:${title.trim()}`,
    });
    setSnapshot(result.snapshot);
    setTitle('');
    setDescription('');
    setKind('task');
    setParentId('none');
    toast.success(t('toast.created'));
  };

  const updateStatus = async (node: TaskLedgerNode, status: TaskLedgerNodeStatus) => {
    const result = await hostApi.taskLedger.updateNode({
      workspaceId,
      nodeId: node.id,
      patch: { status },
      idempotencyKey: `ui:status:${node.id}:${status}:${Date.now()}`,
    });
    setSnapshot(result.snapshot);
  };

  const clearReview = async (node: TaskLedgerNode) => {
    const result = await hostApi.taskLedger.clearReview({
      workspaceId,
      nodeId: node.id,
      status: 'todo',
      idempotencyKey: `ui:review-clear:${node.id}:${Date.now()}`,
    });
    setSnapshot(result.snapshot);
  };

  const linkSession = async () => {
    if (!currentSessionKey) return;
    const result = await hostApi.taskLedger.linkSession({
      workspaceId,
      sessionKey: currentSessionKey,
      nodeId: linkNodeId === 'none' ? null : linkNodeId,
      summary: t('session.linkedFromChat'),
      idempotencyKey: `ui:session:${currentSessionKey}:${linkNodeId}:${Date.now()}`,
    });
    setSnapshot(result.snapshot);
    toast.success(t('toast.sessionLinked'));
  };

  const exportHtml = async () => {
    const result = await hostApi.taskLedger.exportHtml({ workspaceId, includeHistory: true });
    toast.success(t('toast.exported'));
    if (result.path) await hostApi.shell.showItemInFolder(result.path);
  };
  const openEvidence = async (ref: string, type: string, expectedGeneration?: string | null) => {
    if (!workspaceId) return;
    const sessionKey = type === 'session' ? ref.replace(/^session:/, '') : currentSessionKey;
    if (!sessionKey || !['session', 'file', 'trace'].includes(type)) return;
    const version = ++navigationVersion.current;
    const isCurrent = () => version === navigationVersion.current;
    try {
      if (type === 'session' && expectedGeneration) {
        const owner = await hostApi.gateway.rpc<{ session?: { sessionId?: string } }>('sessions.describe', { key: sessionKey });
        if (!isCurrent()) return;
        if (owner.session?.sessionId !== expectedGeneration) { toast.error(t('summary.scope.stale')); return; }
      }
      if (await activateWorkspaceScopedSession(workspaceId, sessionKey, isCurrent) && isCurrent()) navigate('/', type === 'session' ? undefined
        : { state: { workspacePanelIntent: { panel: 'files', filePath: ref } } });
    } catch { if (isCurrent()) toast.error(t('summary.scope.unavailable')); }
  };

  return (
    <div data-testid="task-ledger-page" className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-normal tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {workspaceId && currentSessionKey && <Button type="button" variant="outline" size="sm" data-testid="task-ledger-return-session"
            onClick={() => { void openEvidence(currentSessionKey, 'session'); }}>
            {t('summary.returnSession')}
          </Button>}
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('mr-1.5 h-4 w-4', loading && 'animate-spin')} />
            {t('actions.refresh')}
          </Button>
          <Button type="button" size="sm" onClick={() => void exportHtml()}>
            <Download className="mr-1.5 h-4 w-4" />
            {t('actions.exportHtml')}
          </Button>
        </div>
      </header>

      {activeTab!=='managed'&&<section className="grid shrink-0 gap-3 rounded-md border border-border/70 bg-background p-3 md:grid-cols-[1.2fr_0.8fr_auto_auto]">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('form.titlePlaceholder')} className="h-9" />
        <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('form.descriptionPlaceholder')} className="h-9" />
        <Select value={kind} onValueChange={(value) => setKind(value as TaskLedgerNodeKind)}>
          <SelectTrigger className="h-9 w-full md:w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {NODE_KINDS.map((item) => <SelectItem key={item} value={item}>{t(`kind.${item}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" className="h-9" onClick={() => void createNode()} disabled={!title.trim()}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t('actions.addNode')}
        </Button>
        <Select value={parentId} onValueChange={setParentId}>
          <SelectTrigger className="h-9 md:col-span-2"><SelectValue placeholder={t('form.parentPlaceholder')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('form.noParent')}</SelectItem>
            {(snapshot?.nodes ?? []).map((node) => <SelectItem key={node.id} value={node.id}>{node.title}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={linkNodeId} onValueChange={setLinkNodeId}>
          <SelectTrigger className="h-9"><SelectValue placeholder={t('session.nodePlaceholder')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('session.noNode')}</SelectItem>
            {(snapshot?.nodes ?? []).map((node) => <SelectItem key={node.id} value={node.id}>{node.title}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" className="h-9" onClick={() => void linkSession()} disabled={!currentSessionKey}>
          <Link2 className="mr-1.5 h-4 w-4" />
          {t('actions.linkSession')}
        </Button>
      </section>}

      {activeTab!=='managed'&&<div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} className="h-9 pl-9" />
      </div>}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 overflow-hidden">
        <TabsList className="shrink-0">
          <TabsTrigger value="managed">{t('managed.tab')}</TabsTrigger>
          <TabsTrigger value="tree"><ListTree className="mr-1.5 h-4 w-4" />{t('tabs.tree')}</TabsTrigger>
          <TabsTrigger value="dag"><GitBranch className="mr-1.5 h-4 w-4" />{t('tabs.dag')}</TabsTrigger>
          <TabsTrigger value="history"><History className="mr-1.5 h-4 w-4" />{t('tabs.history')}</TabsTrigger>
          <TabsTrigger value="review"><ShieldCheck className="mr-1.5 h-4 w-4" />{t('tabs.review')}</TabsTrigger>
        </TabsList>
        <TabsContent value="managed" className="h-[calc(100%-3rem)] overflow-y-auto">
          {workspaceId && currentSessionKey ? <ManagedTasks workspaceId={workspaceId} sessionKey={currentSessionKey} />
            : <p className="text-sm text-muted-foreground">{t('summary.scope.unavailable')}</p>}
        </TabsContent>

        <TabsContent value="tree" className="h-[calc(100%-3rem)] overflow-y-auto">
          <QuietLoadingSurface
            surfaceId="task-ledger"
            loading={loading && !snapshot}
            label={t('common:status.loading')}
            skeleton={<QuietListSkeleton rows={6} />}
          >
          <div className="space-y-3" data-testid="task-ledger-tree">
            {(childMap.get('root') ?? []).length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('empty')}</div>
            ) : (
              (childMap.get('root') ?? []).map((node) => (
                <NodeCard
                  key={node.id}
                  node={node}
                  getChildren={getChildren}
                  onStatus={updateStatus}
                  onReviewClear={clearReview}
                  onOpenEvidence={(ref, type) => { void openEvidence(ref, type); }}
                  t={t}
                />
              ))
            )}
          </div>
          </QuietLoadingSurface>
        </TabsContent>

        <TabsContent value="dag" className="h-[calc(100%-3rem)] overflow-y-auto">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="task-ledger-dag">
            {(snapshot?.edges ?? []).length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-3">{t('dag.empty')}</div>
            ) : (
              snapshot!.edges.map((edge) => (
                <article key={edge.id} className="rounded-md border border-border/70 bg-background p-3">
                  <p className="text-sm font-medium text-foreground">{nodesById.get(edge.from)?.title ?? edge.from}</p>
                  <div className="my-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <GitMerge className="h-3.5 w-3.5" />
                    <span>{t(`edge.${edge.type}`)}</span>
                  </div>
                  <p className="text-sm font-medium text-foreground">{nodesById.get(edge.to)?.title ?? edge.to}</p>
                </article>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="history" className="h-[calc(100%-3rem)] overflow-y-auto">
          <div className="space-y-2" data-testid="task-ledger-history">
            {(snapshot?.eventsCount ?? 0) === 0 ? (
              <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('history.empty')}</div>
            ) : (
              <div className="rounded-md border border-border/70 bg-background p-4 text-sm text-muted-foreground">
                {t('history.summary', { count: snapshot?.eventsCount ?? 0 })}
              </div>
            )}
            {(snapshot?.sessionLinks ?? []).map((link) => (
              <article key={link.id} className="rounded-md border border-border/70 bg-background p-3">
                <p className="text-sm font-medium text-foreground">{link.summary || t('session.link')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{link.sessionKey} · {formatTime(link.createdAt)}</p>
                <Button variant="outline" size="sm" className="mt-2" data-testid={`task-ledger-open-session-${link.id}`}
                  onClick={() => { void openEvidence(link.sessionKey, 'session', link.sessionGeneration); }}>
                  {t('session.open')}
                </Button>
              </article>
            ))}
            {(snapshot?.warnings ?? []).map((warning, index) => (
              <article key={`${warning.type}:${index}`} className="rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
                <p className="text-sm font-medium">{warning.type}</p>
                <p className="mt-1 text-xs">{warning.message}</p>
              </article>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="review" className="h-[calc(100%-3rem)] overflow-y-auto">
          <div className="space-y-3" data-testid="task-ledger-review">
            {reviewNodes.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('review.empty')}</div>
            ) : reviewNodes.map((node) => (
              <NodeCard key={node.id} node={node} getChildren={getChildren} onStatus={updateStatus} onReviewClear={clearReview} onOpenEvidence={(ref, type) => { void openEvidence(ref, type); }} t={t} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
