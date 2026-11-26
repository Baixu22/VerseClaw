import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
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
  Zap,
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
import { AgentRoleIdentity } from '@/components/agents/AgentAvatar';
import { useAgentsStore } from '@/stores/agents';

const NODE_WIDTH = 168;
const NODE_HEIGHT = 40;
const X_GAP = 56;
const Y_GAP = 14;
const PADDING = 28;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.65;

const nodeIcons: Record<ObservabilityGraphNode['kind'], typeof GitBranch> = {
  root: GitBranch, agent: Bot, subagent: Bot, orchestrator: Route, router: Route,
  model: BrainCircuit, tool: Terminal, memory: CircleDot, context: CircleDot,
  approval: KeyRound, file: FileCode2, error: AlertTriangle, event: ShieldCheck,
};

export function TraceNodeIcon({ kind, className }: { kind: ObservabilityGraphNode['kind']; className: string }) {
  const Icon = nodeIcons[kind] ?? ShieldCheck;
  return <Icon aria-hidden="true" className={className} />;
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

function statusDotClass(status: ObservabilityGraphNode['status'], stale: boolean): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500';
    case 'error':
      return 'bg-red-500';
    case 'aborted':
      return 'bg-amber-500';
    default:
      return stale ? 'bg-amber-500 animate-pulse' : 'bg-blue-500 animate-pulse';
  }
}

type PositionedNode = ObservabilityGraphNode & {
  x: number;
  y: number;
};

type DensityMode = 'focused' | 'balanced' | 'full';

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

function isLowSignalEvent(node: ObservabilityGraphNode): boolean {
  return node.kind === 'event'
    && !node.critical
    && node.status === 'completed'
    && !node.error
    && !node.warningCount
    && !node.artifactCount
    && !node.retryCount
    && node.phase !== 'error'
    && node.phase !== 'warning'
    && node.phase !== 'approval'
    && node.phase !== 'artifact';
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
  const agents = useAgentsStore((state) => state.agents);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [phaseFilter, setPhaseFilter] = useState('all');
  const [focusMode, setFocusMode] = useState<'all' | 'root-cause' | 'critical' | 'tools' | 'artifacts' | 'cost'>('all');
  const [densityMode, setDensityMode] = useState<DensityMode>('focused');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(false);

  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const nodesById = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const selectedRelated = useMemo(() => relatedNodeIds(graph, selectedNodeId), [graph, selectedNodeId]);
  const criticalIds = useMemo(() => new Set(graph.summary?.criticalPathNodeIds ?? []), [graph.summary?.criticalPathNodeIds]);
  const artifactIds = useMemo(() => new Set(graph.summary?.artifactNodeIds ?? []), [graph.summary?.artifactNodeIds]);
  const slowIds = useMemo(() => new Set(graph.summary?.slowNodeIds ?? []), [graph.summary?.slowNodeIds]);
  const staleRunningIds = useMemo(() => new Set(graph.summary?.staleRunningNodeIds ?? []), [graph.summary?.staleRunningNodeIds]);
  const rootCauseIds = useMemo(() => new Set([
    ...(graph.summary?.issues ?? [])
      .filter((issue) => issue.nodeId && (issue.severity === 'critical' || issue.severity === 'error'))
      .map((issue) => issue.nodeId!),
    ...(graph.summary?.errorNodeIds ?? []),
  ]), [graph.summary?.errorNodeIds, graph.summary?.issues]);
  const costIds = useMemo(() => new Set(graph.summary?.tokenHotspotNodeIds ?? []), [graph.summary?.tokenHotspotNodeIds]);

  const densityHiddenNodeIds = useMemo(() => {
    if (densityMode === 'full') return new Set<string>();
    const hidden = new Set<string>();
    const perParentCount = new Map<string, number>();

    for (const node of layout.nodes) {
      if (!isLowSignalEvent(node)) continue;
      if (densityMode === 'focused') {
        hidden.add(node.id);
        continue;
      }

      const parentId = node.parentId ?? 'root';
      const count = perParentCount.get(parentId) ?? 0;
      perParentCount.set(parentId, count + 1);
      if (count >= 4) hidden.add(node.id);
    }

    return hidden;
  }, [densityMode, layout.nodes]);

  const filteredNodes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return layout.nodes.filter((node) => {
      if (densityHiddenNodeIds.has(node.id)) return false;
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
  }, [artifactIds, costIds, criticalIds, densityHiddenNodeIds, focusMode, kindFilter, layout.nodes, phaseFilter, query, rootCauseIds, statusFilter]);

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

  return (
    <div className="flex h-full min-h-[520px] flex-col bg-background" data-testid="observability-trace-graph">
      <div className="space-y-2 border-b border-black/10 bg-surface-modal px-3 py-2 dark:border-white/10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{t('graph.title')}</span>
            <Badge variant="secondary" className="rounded-full text-2xs">
              {filteredNodes.length}/{graph.nodes.length} {t('graph.nodes')}
            </Badge>
            {densityHiddenNodeIds.size > 0 && (
              <Badge variant="outline" className="rounded-full text-2xs text-muted-foreground">
                {t('graph.hidden', { count: densityHiddenNodeIds.size })}
              </Badge>
            )}
            {(graph.summary?.errorNodeIds.length ?? 0) > 0 && (
              <Badge variant="outline" className="rounded-full border-red-500/30 text-2xs text-red-700 dark:text-red-400">
                {graph.summary?.errorNodeIds.length} {t('graph.errorNodes')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant={filtersOpen ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setFiltersOpen((value) => !value)} title={t('graph.expand')} data-testid="trace-graph-filter-toggle">
              <Filter className="h-4 w-4" />
            </Button>
            <Button variant={minimapOpen ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8" onClick={() => setMinimapOpen((value) => !value)} title={t('graph.minimap')} data-testid="trace-graph-minimap-toggle">
              <MousePointer2 className="h-4 w-4" />
            </Button>
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

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border bg-surface-input px-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('graph.searchNodes')}
              className="h-8 border-0 bg-transparent px-0 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <div className="flex h-8 overflow-hidden rounded-md border border-border bg-surface-input/50">
            {(['root-cause', 'critical', 'all'] as const).map((mode) => (
              <button key={mode} type="button" className={cn('px-2.5 text-xs transition-colors hover:bg-black/5 dark:hover:bg-white/10', focusMode === mode && 'bg-black/5 font-medium dark:bg-white/10')} onClick={() => setFocusMode(mode)}>
                {t(mode === 'root-cause' ? 'graph.focusRootCause' : mode === 'critical' ? 'graph.focusCritical' : 'graph.focusAll')}
              </button>
            ))}
          </div>
        </div>
        {filtersOpen && (
        <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-background p-2 lg:grid-cols-4" data-testid="trace-graph-filters">
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
          <div className="flex h-8 items-center overflow-hidden rounded-md border border-black/10 bg-surface-input/50 dark:border-white/10" title={t('graph.densityHint')}>
            <div className="flex items-center gap-1 px-2 text-2xs text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              {t('graph.density')}
            </div>
            {(['focused', 'balanced', 'full'] as DensityMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDensityMode(mode)}
                className={cn(
                  'h-full px-2.5 text-xs transition hover:bg-black/5 dark:hover:bg-white/10',
                  densityMode === mode && 'bg-black/5 font-medium text-foreground dark:bg-white/10',
                )}
                data-testid={`trace-graph-density-${mode}`}
              >
                {t(`graph.densityModes.${mode}`)}
              </button>
            ))}
          </div>
        </div>
        )}
      </div>

      <div
        ref={viewportRef}
        className="relative flex-1 cursor-grab overflow-hidden bg-black/[0.01] active:cursor-grabbing dark:bg-white/[0.015]"
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
            const agent = agents.find((candidate) => candidate.id === node.agentId) ?? null;
            const tone = toneClasses(nodeTone(node));
            const selected = selectedNodeId === node.id;
            const connected = selectedRelated.size === 0 || selectedRelated.has(node.id);
            const isSlow = slowIds.has(node.id);
            const isHotspot = costIds.has(node.id);
            const isStaleRunning = staleRunningIds.has(node.id);
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
                  'absolute flex h-[40px] w-[168px] items-center gap-2 rounded-md border bg-surface-modal px-2.5 text-left transition-[background-color,border-color,box-shadow,opacity] duration-150',
                  selected ? 'z-10 shadow-md ring-2 ring-primary/40' : 'hover:border-foreground/15 hover:bg-black/[0.02] dark:hover:bg-white/[0.04]',
                  node.critical && 'border-primary/35',
                  node.status === 'error' && 'border-red-500/45 bg-red-500/5',
                  node.status === 'aborted' && 'border-amber-500/45 bg-amber-500/5',
                  !connected && 'opacity-35',
                )}
                style={{ left: node.x, top: node.y }}
                data-testid={`trace-graph-node-${node.kind}`}
              >
                {agent && (node.kind === 'agent' || node.kind === 'subagent' || node.roleName) ? (
                  <AgentRoleIdentity agentId={agent.id} name={agent.name} avatar={agent.avatar} roleName={node.roleName ?? node.kind} size={26} />
                ) : <span className={cn('relative flex h-6 w-6 shrink-0 items-center justify-center rounded border', tone.tint)}>
                  <TraceNodeIcon kind={node.kind} className="h-3.5 w-3.5" />
                  {isSlow && (
                    <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-amber-500 text-white">
                      <Clock className="h-2 w-2" />
                    </span>
                  )}
                  {isHotspot && !isSlow && (
                    <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-orange-500 text-white">
                      <Zap className="h-2 w-2" />
                    </span>
                  )}
                </span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">{node.label}</span>
                </span>
                <span
                  className={cn('h-2 w-2 shrink-0 rounded-full', statusDotClass(node.status, isStaleRunning))}
                  title={t(`status.${node.status}`)}
                />
              </div>
            );
          })}
        </div>

        {minimapOpen && (
        <div className="absolute bottom-3 right-3 h-24 w-40 rounded-md border border-black/10 bg-surface-modal p-2 shadow-sm dark:border-white/10" data-testid="trace-graph-minimap">
          <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <MousePointer2 className="h-3 w-3" />
            {t('graph.minimap')}
          </div>
          <div className="relative h-[62px] overflow-hidden rounded bg-black/[0.04] dark:bg-white/[0.06]">
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
        )}
      </div>
    </div>
  );
}
