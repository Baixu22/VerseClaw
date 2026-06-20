import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  CheckCircle2,
  CircleDot,
  Clock,
  FileCode2,
  Filter,
  GitBranch,
  KeyRound,
  LocateFixed,
  Maximize2,
  MousePointer2,
  Route,
  Search,
  ShieldCheck,
  Terminal,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ObservabilityGraphNode, ObservabilityTraceGraph } from '@shared/types/observability';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { roleTone, spanKindTone, toneClasses } from '@/lib/role-visuals';
import { useTranslation } from 'react-i18next';

const NODE_WIDTH = 208;
const NODE_HEIGHT = 92;
const X_GAP = 92;
const Y_GAP = 30;
const PADDING = 28;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.65;

function formatDuration(ms?: number): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function nodeIcon(kind: ObservabilityGraphNode['kind']) {
  switch (kind) {
    case 'root':
      return GitBranch;
    case 'agent':
    case 'subagent':
      return Bot;
    case 'orchestrator':
    case 'router':
      return Route;
    case 'model':
      return BrainCircuit;
    case 'tool':
      return Terminal;
    case 'memory':
    case 'context':
      return CircleDot;
    case 'approval':
      return KeyRound;
    case 'file':
      return FileCode2;
    case 'error':
      return AlertTriangle;
    default:
      return ShieldCheck;
  }
}

function nodeTone(node: ObservabilityGraphNode) {
  if (node.status === 'error' || node.kind === 'error') return 'red';
  if (node.status === 'aborted') return 'amber';
  if (node.status === 'running') return 'blue';
  if (node.critical) return 'violet';
  if (node.roleName) return roleTone(node.roleName);
  if (node.kind === 'tool') return spanKindTone('tool');
  if (node.kind === 'model') return spanKindTone('model');
  if (node.kind === 'subagent') return spanKindTone('subagent');
  if (node.kind === 'orchestrator') return spanKindTone('orchestrator');
  return spanKindTone('custom');
}

function statusIcon(status: ObservabilityGraphNode['status']) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'error':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'aborted':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-blue-500" />;
  }
}

type PositionedNode = ObservabilityGraphNode & {
  x: number;
  y: number;
};

function layoutGraph(graph: ObservabilityTraceGraph): { nodes: PositionedNode[]; width: number; height: number } {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const levelCache = new Map<string, number>();
  const levelOf = (node: ObservabilityGraphNode): number => {
    const cached = levelCache.get(node.id);
    if (cached != null) return cached;
    if (!node.parentId || !byId.has(node.parentId) || node.parentId === node.id) {
      levelCache.set(node.id, 0);
      return 0;
    }
    const parent = byId.get(node.parentId);
    const level = parent ? levelOf(parent) + 1 : 0;
    levelCache.set(node.id, level);
    return level;
  };

  const groups = new Map<number, ObservabilityGraphNode[]>();
  for (const node of graph.nodes) {
    const level = levelOf(node);
    groups.set(level, [...(groups.get(level) ?? []), node]);
  }

  const positioned: PositionedNode[] = [];
  for (const [level, nodes] of groups) {
    nodes
      .sort((a, b) => (a.sequence ?? a.startedAt ?? 0) - (b.sequence ?? b.startedAt ?? 0))
      .forEach((node, index) => {
        positioned.push({
          ...node,
          x: PADDING + level * (NODE_WIDTH + X_GAP),
          y: PADDING + index * (NODE_HEIGHT + Y_GAP),
        });
      });
  }

  const maxX = Math.max(...positioned.map((node) => node.x), PADDING);
  const maxY = Math.max(...positioned.map((node) => node.y), PADDING);
  return {
    nodes: positioned,
    width: maxX + NODE_WIDTH + PADDING,
    height: maxY + NODE_HEIGHT + PADDING,
  };
}

function descendantIds(graph: ObservabilityTraceGraph, rootIds: Set<string>): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.parentId) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node.id]);
  }
  const result = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop();
    if (!id) continue;
    for (const childId of byParent.get(id) ?? []) {
      if (result.has(childId)) continue;
      result.add(childId);
      stack.push(childId);
    }
  }
  return result;
}

function relatedNodeIds(graph: ObservabilityTraceGraph, selectedNodeId: string | null): Set<string> {
  if (!selectedNodeId) return new Set();
  const related = new Set<string>([selectedNodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (related.has(edge.from) && !related.has(edge.to)) {
        related.add(edge.to);
        changed = true;
      }
      if (related.has(edge.to) && !related.has(edge.from)) {
        related.add(edge.from);
        changed = true;
      }
    }
  }
  return related;
}

export function AgentTraceGraph({
  graph,
  selectedNodeId,
  onSelectNode,
}: {
  graph: ObservabilityTraceGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const { t } = useTranslation('observability');
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [phaseFilter, setPhaseFilter] = useState('all');
  const [focusMode, setFocusMode] = useState<'all' | 'root-cause' | 'critical' | 'tools' | 'artifacts' | 'cost'>('all');
  const [compactMode, setCompactMode] = useState(true);
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());

  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const nodesById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const selectedRelated = useMemo(() => relatedNodeIds(graph, selectedNodeId), [graph, selectedNodeId]);
  const hiddenDescendants = useMemo(() => descendantIds(graph, collapsedNodeIds), [graph, collapsedNodeIds]);
  const criticalIds = useMemo(() => new Set(graph.summary?.criticalPathNodeIds ?? []), [graph.summary?.criticalPathNodeIds]);
  const artifactIds = useMemo(() => new Set(graph.summary?.artifactNodeIds ?? []), [graph.summary?.artifactNodeIds]);
  const rootCauseIds = useMemo(() => new Set([
    ...(graph.summary?.issues ?? [])
      .filter((issue) => issue.nodeId && (issue.severity === 'critical' || issue.severity === 'error'))
      .map((issue) => issue.nodeId!),
    ...(graph.summary?.errorNodeIds ?? []),
  ]), [graph.summary?.errorNodeIds, graph.summary?.issues]);
  const costIds = useMemo(() => new Set(graph.summary?.tokenHotspotNodeIds ?? []), [graph.summary?.tokenHotspotNodeIds]);

  const filteredNodes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const perParentCount = new Map<string, number>();
    return layout.nodes.filter((node) => {
      if (hiddenDescendants.has(node.id)) return false;
      if (compactMode && node.kind === 'event' && !node.critical) {
        const parentId = node.parentId ?? 'root';
        const count = perParentCount.get(parentId) ?? 0;
        perParentCount.set(parentId, count + 1);
        if (count >= 4) return false;
      }
      if (statusFilter !== 'all' && node.status !== statusFilter) return false;
      if (kindFilter !== 'all' && node.kind !== kindFilter) return false;
      if (phaseFilter !== 'all' && node.phase !== phaseFilter) return false;
      if (focusMode === 'root-cause' && !rootCauseIds.has(node.id) && !criticalIds.has(node.id)) return false;
      if (focusMode === 'critical' && !criticalIds.has(node.id)) return false;
      if (focusMode === 'tools' && node.kind !== 'tool' && node.phase !== 'tool') return false;
      if (focusMode === 'artifacts' && !artifactIds.has(node.id) && node.phase !== 'artifact') return false;
      if (focusMode === 'cost' && !costIds.has(node.id)) return false;
      if (!needle) return true;
      return [
        node.label,
        node.subtitle,
        node.phase,
        node.kind,
        node.roleName,
        node.modelRef,
        node.diagnosticPreview,
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [artifactIds, compactMode, costIds, criticalIds, focusMode, hiddenDescendants, kindFilter, layout.nodes, phaseFilter, query, rootCauseIds, statusFilter]);

  const visibleNodeIds = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes]);
  const visibleEdges = useMemo(() => graph.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)), [graph.edges, visibleNodeIds]);

  const fitToScreen = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(
      (viewport.clientWidth - 64) / layout.width,
      (viewport.clientHeight - 64) / layout.height,
    )));
    setZoom(Number(nextZoom.toFixed(2)));
    setPan({ x: 24, y: 24 });
  }, [layout.height, layout.width]);

  const centerSelected = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !selectedNodeId) return;
    const node = nodesById.get(selectedNodeId);
    if (!node) return;
    setPan({
      x: viewport.clientWidth / 2 - (node.x + NODE_WIDTH / 2) * zoom,
      y: viewport.clientHeight / 2 - (node.y + NODE_HEIGHT / 2) * zoom,
    });
  }, [nodesById, selectedNodeId, zoom]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-trace-node="true"]')) return;
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({
      x: drag.panX + event.clientX - drag.x,
      y: drag.panY + event.clientY - drag.y,
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const toggleCollapse = (nodeId: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-[520px] flex-col rounded-md border border-black/10 dark:border-white/10 bg-background" data-testid="observability-trace-graph">
      <div className="space-y-2 border-b border-black/10 dark:border-white/10 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{t('graph.title')}</span>
            <Badge variant="secondary" className="rounded-full text-2xs">
              {filteredNodes.length}/{graph.nodes.length} {t('graph.nodes')}
            </Badge>
            {(graph.summary?.errorNodeIds.length ?? 0) > 0 && (
              <Badge variant="outline" className="rounded-full border-red-500/30 text-2xs text-red-700 dark:text-red-400">
                {graph.summary?.errorNodeIds.length} {t('graph.errorNodes')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, Number((value - 0.1).toFixed(2))))} title={t('graph.zoomOut')}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-2xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, Number((value + 0.1).toFixed(2))))} title={t('graph.zoomIn')}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fitToScreen} title={t('graph.fitToScreen')} data-testid="trace-graph-fit">
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={centerSelected} title={t('graph.centerSelected')} disabled={!selectedNodeId}>
              <LocateFixed className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 2xl:grid-cols-[minmax(160px,1fr)_repeat(4,130px)_auto]">
          <div className="flex items-center gap-2 rounded-md border bg-surface-input px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('graph.searchNodes')}
              className="h-8 border-0 bg-transparent px-0 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger size="sm"><SelectValue placeholder={t('graph.status')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('graph.allStatuses')}</SelectItem>
              <SelectItem value="running">{t('status.running')}</SelectItem>
              <SelectItem value="completed">{t('status.completed')}</SelectItem>
              <SelectItem value="error">{t('status.error')}</SelectItem>
              <SelectItem value="aborted">{t('status.aborted')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger size="sm"><SelectValue placeholder={t('graph.kind')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('graph.allKinds')}</SelectItem>
              {['root', 'router', 'model', 'tool', 'subagent', 'approval', 'file', 'error', 'event'].map((kind) => (
                <SelectItem key={kind} value={kind}>{t(`nodeKinds.${kind}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={phaseFilter} onValueChange={setPhaseFilter}>
            <SelectTrigger size="sm"><SelectValue placeholder={t('graph.phase')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('graph.allPhases')}</SelectItem>
              {['input', 'routing', 'context', 'model', 'tool', 'artifact', 'approval', 'subagent', 'verifier', 'output', 'warning', 'error', 'orchestration', 'memory', 'event'].map((phase) => (
                <SelectItem key={phase} value={phase}>{t(`phases.${phase}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={focusMode} onValueChange={(value) => setFocusMode(value as typeof focusMode)}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('graph.focusAll')}</SelectItem>
              <SelectItem value="root-cause">{t('graph.focusRootCause')}</SelectItem>
              <SelectItem value="critical">{t('graph.focusCritical')}</SelectItem>
              <SelectItem value="tools">{t('graph.focusTools')}</SelectItem>
              <SelectItem value="artifacts">{t('graph.focusArtifacts')}</SelectItem>
              <SelectItem value="cost">{t('graph.focusCost')}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={compactMode ? 'secondary' : 'outline'}
            className="h-8 rounded-md px-3 text-xs"
            onClick={() => setCompactMode((value) => !value)}
          >
            <Filter className="mr-1.5 h-3.5 w-3.5" />
            {compactMode ? t('graph.compactOn') : t('graph.compactOff')}
          </Button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="relative flex-1 cursor-grab overflow-hidden bg-black/[0.015] active:cursor-grabbing dark:bg-white/[0.02]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg className="absolute inset-0 pointer-events-none" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              <marker id="trace-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground/45" />
              </marker>
            </defs>
            {visibleEdges.map((edge) => {
              const from = nodesById.get(edge.from);
              const to = nodesById.get(edge.to);
              if (!from || !to) return null;
              const startX = from.x + NODE_WIDTH;
              const startY = from.y + NODE_HEIGHT / 2;
              const endX = to.x;
              const endY = to.y + NODE_HEIGHT / 2;
              const mid = Math.max(24, (endX - startX) / 2);
              const path = `M ${startX} ${startY} C ${startX + mid} ${startY}, ${endX - mid} ${endY}, ${endX} ${endY}`;
              const inSelectedPath = selectedRelated.size === 0 || (selectedRelated.has(edge.from) && selectedRelated.has(edge.to));
              return (
                <path
                  key={edge.id}
                  d={path}
                  fill="none"
                  markerEnd="url(#trace-arrow)"
                  className={cn(
                    'stroke-muted-foreground/30 transition-opacity',
                    edge.kind === 'artifact' && 'stroke-sky-500/55',
                    edge.kind === 'handoff' && 'stroke-violet-500/55',
                    edge.critical && 'stroke-red-500/75',
                    !inSelectedPath && 'opacity-20',
                  )}
                  strokeWidth={edge.critical ? 2.4 : 1.5}
                  strokeDasharray={edge.kind === 'retry' ? '4 4' : undefined}
                />
              );
            })}
          </svg>

          {filteredNodes.map((node) => {
            const Icon = nodeIcon(node.kind);
            const tone = toneClasses(nodeTone(node));
            const selected = selectedNodeId === node.id;
            const connected = selectedRelated.size === 0 || selectedRelated.has(node.id);
            const canCollapse = (node.collapsedChildrenCount ?? 0) > 0 || graph.nodes.some((candidate) => candidate.parentId === node.id);
            const collapsed = collapsedNodeIds.has(node.id);
            return (
              <div
                key={node.id}
                data-trace-node="true"
                role="button"
                tabIndex={0}
                onClick={() => onSelectNode(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onSelectNode(node.id);
                }}
                className={cn(
                  'absolute flex h-[92px] w-[208px] flex-col justify-between rounded-md border bg-background p-3 text-left shadow-sm transition',
                  selected ? 'ring-2 ring-primary/45' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.04]',
                  node.critical && 'border-primary/35',
                  node.status === 'error' && 'border-red-500/45 bg-red-500/5',
                  node.status === 'aborted' && 'border-amber-500/45 bg-amber-500/5',
                  !connected && 'opacity-35',
                )}
                style={{ left: node.x, top: node.y }}
                data-testid={`trace-graph-node-${node.kind}`}
              >
                <div className="flex min-w-0 items-start gap-2">
                  <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border', tone.tint)}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">{node.label}</span>
                    <span className="block truncate text-2xs text-muted-foreground">{node.subtitle ?? t(`nodeKinds.${node.kind}`)}</span>
                  </span>
                  {statusIcon(node.status)}
                </div>
                <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
                  <span className="truncate">{node.phase ? t(`phases.${node.phase}`) : t(`nodeKinds.${node.kind}`)}</span>
                  <span className="font-mono">{formatDuration(node.durationMs)}</span>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <div className="flex min-w-0 items-center gap-1">
                    {node.eventCount ? <Badge variant="outline" className="rounded-full px-1.5 text-[10px]">{node.eventCount}e</Badge> : null}
                    {node.artifactCount ? <Badge variant="secondary" className="rounded-full px-1.5 text-[10px]">{node.artifactCount}a</Badge> : null}
                    {node.retryCount ? <Badge variant="outline" className="rounded-full border-amber-500/30 px-1.5 text-[10px] text-amber-700 dark:text-amber-400">{node.retryCount}r</Badge> : null}
                  </div>
                  {canCollapse && (
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleCollapse(node.id);
                      }}
                    >
                      {collapsed ? t('graph.expand') : t('graph.collapse')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="absolute bottom-3 right-3 h-28 w-44 rounded-md border border-black/10 bg-background/90 p-2 shadow-sm dark:border-white/10" data-testid="trace-graph-minimap">
          <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <MousePointer2 className="h-3 w-3" />
            {t('graph.minimap')}
          </div>
          <div className="relative h-[86px] overflow-hidden rounded bg-black/[0.04] dark:bg-white/[0.06]">
            {layout.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={cn(
                  'absolute rounded-sm',
                  visibleNodeIds.has(node.id) ? 'bg-muted-foreground/55' : 'bg-muted-foreground/15',
                  node.status === 'error' && 'bg-red-500/80',
                  node.id === selectedNodeId && 'ring-1 ring-primary bg-primary/80',
                )}
                style={{
                  left: `${(node.x / layout.width) * 100}%`,
                  top: `${(node.y / layout.height) * 100}%`,
                  width: `${Math.max(3, (NODE_WIDTH / layout.width) * 100)}%`,
                  height: `${Math.max(3, (NODE_HEIGHT / layout.height) * 100)}%`,
                }}
                onClick={() => onSelectNode(node.id)}
                aria-label={node.label}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
