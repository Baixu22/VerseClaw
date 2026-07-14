import type {
  ObservabilityGraphEdge,
  ObservabilityGraphEdgeKind,
  ObservabilityGraphNode,
  ObservabilityGraphNodeKind,
  ObservabilityGraphPhase,
  ObservabilityNodeDiagnostics,
  ObservabilityTimelineItem,
  ObservabilityTrace,
  ObservabilityTraceEvent,
  ObservabilityTraceGraph,
  ObservabilityTraceGraphResult,
  ObservabilityTraceSourceStatus,
  ObservabilityTraceStatus,
} from '../../shared/types/observability';
import {
  OBSERVABILITY_DIAGNOSTIC_PREVIEW_LIMIT,
  isRecord,
  readNumber,
  readString,
  sanitizeAttributes,
  shouldExposeAttribute,
  summarizeRedactedContent,
  truncatePreview,
} from './observability-redaction';
import { computeObservabilitySourceStatus, detectObservabilityIssues } from './observability-issues';

type TrajectoryEventLike = {
  type?: unknown;
  ts?: unknown;
  seq?: unknown;
  spanId?: unknown;
  runId?: unknown;
  sessionKey?: unknown;
  provider?: unknown;
  modelId?: unknown;
  modelApi?: unknown;
  data?: unknown;
};

const MAX_DIAGNOSTIC_EVENTS = 80;

function timestampFromIso(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeIdPart(value: unknown, fallback: string): string {
  const text = readString(value) ?? fallback;
  return text.replace(/[^a-z0-9_.:-]+/giu, '-').slice(0, 96) || fallback;
}


function nodeKindForSpan(kind: string): ObservabilityGraphNodeKind {
  switch (kind) {
    case 'orchestrator':
    case 'team':
      return 'orchestrator';
    case 'role-router':
      return 'router';
    case 'verifier':
      return 'subagent';
    case 'subagent':
      return 'subagent';
    case 'model':
      return 'model';
    case 'tool':
      return 'tool';
    case 'memory':
    case 'gatekeeper':
      return 'memory';
    case 'context-pack':
      return 'context';
    case 'input-mode':
      return 'event';
    default:
      return 'event';
  }
}

function agentIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  const match = sessionKey?.match(/^agent:([^:]+):/u);
  return match?.[1];
}

function phaseForSpan(kind: string): ObservabilityGraphPhase {
  switch (kind) {
    case 'role-router':
      return 'routing';
    case 'context-pack':
      return 'context';
    case 'model':
      return 'model';
    case 'tool':
      return 'tool';
    case 'memory':
    case 'gatekeeper':
      return 'memory';
    case 'subagent':
      return 'subagent';
    case 'verifier':
      return 'verifier';
    case 'orchestrator':
    case 'team':
      return 'orchestration';
    case 'input-mode':
      return 'input';
    default:
      return 'event';
  }
}

function trajectoryNodeKind(type: string): ObservabilityGraphNodeKind {
  if (type.includes('error') || type.includes('failed') || type.includes('warning')) return 'error';
  if (type.includes('model')) return 'model';
  if (type.includes('tool') || type.includes('command')) return 'tool';
  if (type.includes('context')) return 'context';
  if (type.includes('memory')) return 'memory';
  if (type.includes('approval')) return 'approval';
  if (type.includes('patch') || type.includes('file')) return 'file';
  if (type.includes('subagent') || type.includes('handoff') || type.includes('session')) return 'subagent';
  return 'event';
}

function phaseForTrajectory(type: string): ObservabilityGraphPhase {
  if (type.includes('error') || type.includes('failed')) return 'error';
  if (type.includes('warning')) return 'warning';
  if (type.includes('model')) return 'model';
  if (type.includes('tool') || type.includes('command')) return 'tool';
  if (type.includes('context')) return 'context';
  if (type.includes('memory')) return 'memory';
  if (type.includes('approval')) return 'approval';
  if (type.includes('patch') || type.includes('file')) return 'artifact';
  if (type.includes('subagent') || type.includes('handoff') || type.includes('session')) return 'subagent';
  if (type.includes('output') || type.includes('completed')) return 'output';
  return 'event';
}

function edgeKindForEvent(type: string): ObservabilityGraphEdgeKind {
  if (type.includes('error') || type.includes('failed')) return 'error';
  if (type.includes('retry')) return 'retry';
  if (type.includes('patch') || type.includes('file') || type.includes('output')) return 'artifact';
  if (type.includes('handoff') || type.includes('subagent') || type.includes('session')) return 'handoff';
  return 'causal';
}

function trajectoryLabel(type: string, data: Record<string, unknown>): string {
  const named = readString(data.name)
    ?? readString(data.toolName)
    ?? readString(data.roleName)
    ?? readString(data.path)
    ?? readString(data.filePath);
  if (named) return named;
  return type
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function statusFromError(status: ObservabilityTraceStatus | undefined, error?: string): ObservabilityTraceStatus {
  if (error) return 'error';
  return status ?? 'completed';
}

function edgeStatus(
  nodes: Map<string, ObservabilityGraphNode>,
  from: string,
  to: string,
): ObservabilityTraceStatus {
  const target = nodes.get(to);
  const source = nodes.get(from);
  if (target?.status === 'error' || source?.status === 'error') return 'error';
  if (target?.status === 'aborted' || source?.status === 'aborted') return 'aborted';
  if (target?.status === 'running' || source?.status === 'running') return 'running';
  return 'completed';
}

function addEdge(
  edges: ObservabilityGraphEdge[],
  nodes: Map<string, ObservabilityGraphNode>,
  traceId: string,
  from: string,
  to: string,
  label?: string,
  kind: ObservabilityGraphEdgeKind = 'parent-child',
): void {
  if (from === to || !nodes.has(from) || !nodes.has(to)) return;
  const id = `edge:${from}->${to}:${kind}`;
  if (edges.some((edge) => edge.id === id)) return;
  const status = edgeStatus(nodes, from, to);
  edges.push({
    id,
    traceId,
    from,
    to,
    label,
    kind,
    status,
    critical: kind === 'error' || status === 'error' || status === 'aborted',
  });
}

function trajectoryDedupKey(event: TrajectoryEventLike, index: number): string {
  const type = readString(event.type) ?? 'event';
  const seq = readNumber(event.seq);
  const spanId = readString(event.spanId);
  const runId = readString(event.runId);
  const sessionKey = readString(event.sessionKey);
  const ts = readString(event.ts);
  if (seq != null || spanId || runId || sessionKey) {
    return [spanId ?? '', runId ?? '', sessionKey ?? '', type, seq ?? '', ts ?? ''].join('|');
  }
  const data = isRecord(event.data) ? event.data : {};
  return [type, ts ?? '', trajectoryLabel(type, data), index].join('|');
}

function eventStatus(type: string): ObservabilityTraceStatus {
  if (type.includes('error') || type.includes('failed') || type.includes('warning')) return 'error';
  if (type.includes('aborted') || type.includes('cancelled')) return 'aborted';
  if (type.includes('ended') || type.includes('completed') || type.includes('updated')) return 'completed';
  return 'running';
}

function parentForTrajectory(type: string, nodes: Map<string, ObservabilityGraphNode>, rootId: string): string {
  const values = [...nodes.values()];
  if (type.includes('model')) return values.find((node) => node.kind === 'model')?.id ?? rootId;
  if (type.includes('tool') || type.includes('command')) return values.find((node) => node.kind === 'tool')?.id ?? rootId;
  if (type.includes('context')) return values.find((node) => node.kind === 'context')?.id ?? rootId;
  if (type.includes('approval')) return values.find((node) => node.kind === 'approval' || node.kind === 'tool')?.id ?? rootId;
  if (type.includes('patch') || type.includes('file')) return values.find((node) => node.kind === 'tool')?.id ?? rootId;
  if (type.includes('subagent') || type.includes('session')) return values.find((node) => node.kind === 'subagent' || node.kind === 'orchestrator')?.id ?? rootId;
  return rootId;
}

function buildAncestors(nodes: Map<string, ObservabilityGraphNode>, nodeId: string): string[] {
  const path: string[] = [];
  let current = nodes.get(nodeId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.id);
    current = current.parentId ? nodes.get(current.parentId) : undefined;
  }
  return path;
}

function applyGraphDiagnostics(
  trace: ObservabilityTrace,
  graph: ObservabilityTraceGraph,
  timeline: ObservabilityTimelineItem[],
  options: {
    trajectoryEventCount?: number;
    sourceStatus?: ObservabilityTraceSourceStatus;
  } = {},
): ObservabilityTraceGraph {
  const nodes = new Map(graph.nodes.map((node) => [node.id, { ...node }]));
  const childCounts = new Map<string, number>();
  for (const node of nodes.values()) {
    if (node.parentId) childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
  }

  const durations = [...nodes.values()].map((node) => node.durationMs ?? 0).filter((value) => value > 0);
  const avgDuration = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
  const slowThreshold = Math.max(1000, avgDuration * 1.5);
  const slowNodeIds = [...nodes.values()]
    .filter((node) => (node.durationMs ?? 0) >= slowThreshold)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, 5)
    .map((node) => node.id);

  const tokenHotspotNodeIds = [...nodes.values()]
    .filter((node) => (node.tokenUsage?.totalTokens ?? 0) > 0)
    .sort((a, b) => (b.tokenUsage?.totalTokens ?? 0) - (a.tokenUsage?.totalTokens ?? 0))
    .slice(0, 5)
    .map((node) => node.id);

  const errorNodeIds = [...nodes.values()]
    .filter((node) => node.status === 'error' || node.status === 'aborted' || node.kind === 'error')
    .map((node) => node.id);
  const artifactNodeIds = [...nodes.values()]
    .filter((node) => node.phase === 'artifact' || node.kind === 'file' || (node.artifactCount ?? 0) > 0)
    .map((node) => node.id);

  const targetIds = errorNodeIds.length
    ? errorNodeIds
    : [...nodes.values()].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0)).slice(0, 1).map((node) => node.id);
  const criticalPathNodeIds = [...new Set(targetIds.flatMap((id) => buildAncestors(nodes, id)))];
  const lastActivity = Math.max(
    trace.updatedAt ?? 0,
    trace.endedAt ?? 0,
    trace.startedAt ?? 0,
    ...timeline.map((item) => item.timestamp).filter(Number.isFinite),
  );
  const runningIsStale = trace.status === 'running' && lastActivity > 0 && Date.now() - lastActivity > 2 * 60 * 1000;
  const staleRunningNodeIds = runningIsStale
    ? [...nodes.values()].filter((node) => node.status === 'running').map((node) => node.id)
    : [];
  const { sourceStatus } = computeObservabilitySourceStatus(trace, timeline, options.sourceStatus ?? (runningIsStale ? 'stale' : undefined));

  for (const node of nodes.values()) {
    const critical = criticalPathNodeIds.includes(node.id);
    node.critical = critical;
    node.collapsedChildrenCount = Math.max(0, (childCounts.get(node.id) ?? 0) - 6);
    node.diagnosticPreview = node.error
      ?? node.summary
      ?? node.outputPreview
      ?? node.inputPreview
      ?? node.subtitle;
  }

  const nodeList = [...nodes.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const edges = graph.edges.map((edge) => ({
    ...edge,
    critical: edge.critical || (criticalPathNodeIds.includes(edge.from) && criticalPathNodeIds.includes(edge.to)),
  }));
  const baseGraph: ObservabilityTraceGraph = {
    ...graph,
    nodes: nodeList,
    edges,
    summary: {
      criticalPathNodeIds,
      errorNodeIds,
      slowNodeIds,
      tokenHotspotNodeIds,
      artifactNodeIds,
      coverage: {
        spanCount: trace.spans?.length ?? 0,
        eventCount: trace.events?.length ?? 0,
        trajectoryEventCount: options.trajectoryEventCount ?? 0,
        graphNodeCount: nodeList.length,
        graphEdgeCount: edges.length,
        hasRuntimeSpans: (trace.spans?.length ?? 0) > 0,
        hasTrajectory: (options.trajectoryEventCount ?? 0) > 0,
        redacted: true,
      },
      sourceStatus,
      staleRunningNodeIds,
    },
  };
  const issues = detectObservabilityIssues(trace, baseGraph, timeline, {
    sourceStatus,
    staleRunningNodeIds,
    trajectoryEventCount: options.trajectoryEventCount ?? 0,
  });

  return {
    ...baseGraph,
    summary: {
      ...baseGraph.summary!,
      issues,
    },
  };
}

export function buildObservabilityTraceGraph(
  trace: ObservabilityTrace,
  trajectoryEvents: TrajectoryEventLike[] = [],
  options: { sourceStatus?: ObservabilityTraceSourceStatus } = {},
): ObservabilityTraceGraphResult {
  const nodes = new Map<string, ObservabilityGraphNode>();
  const edges: ObservabilityGraphEdge[] = [];
  const timeline: ObservabilityTimelineItem[] = [];
  let sequence = 0;
  const traceEvents = trace.events ?? [];
  const traceSpans = trace.spans ?? [];
  const startedAt = trace.startedAt ?? Date.now();

  const root: ObservabilityGraphNode = {
    id: `trace:${trace.id}`,
    traceId: trace.id,
    kind: 'root',
    phase: 'input',
    label: trace.name,
    subtitle: trace.sessionKey ?? trace.runId,
    status: trace.status,
    startedAt,
    endedAt: trace.endedAt,
    durationMs: trace.durationMs,
    summary: summarizeRedactedContent(trace.task) ?? truncatePreview(trace.task),
    tokenUsage: trace.tokenUsage,
    error: truncatePreview(trace.error),
    sequence: sequence++,
    depth: 0,
    agentId: agentIdFromSessionKey(trace.sessionKey),
    eventCount: traceEvents.length,
    warningCount: traceEvents.filter((event) => /warn/iu.test(event.type)).length,
    artifactCount: traceEvents.filter((event) => /file|patch|artifact|output/iu.test(event.type)).length,
    retryCount: traceEvents.filter((event) => /retry/iu.test(event.type)).length,
  };
  nodes.set(root.id, root);
  timeline.push({
    id: `timeline:${trace.id}:start`,
    traceId: trace.id,
    nodeId: root.id,
    type: 'trace.started',
    label: trace.name,
    timestamp: startedAt,
    status: trace.status,
    summary: root.summary,
  });

  for (const span of traceSpans) {
    const kind = nodeKindForSpan(span.kind);
    const label = span.roleName ?? span.name;
    const spanEvents = traceEvents.filter((event) => event.spanId === span.id);
    const node: ObservabilityGraphNode = {
      id: `span:${span.id}`,
      traceId: trace.id,
      kind,
      phase: phaseForSpan(span.kind),
      label,
      subtitle: span.kind,
      status: statusFromError(span.status, span.error),
      startedAt: span.startedAt,
      endedAt: span.endedAt,
      durationMs: span.durationMs,
      spanId: span.id,
      parentId: span.parentSpanId ? `span:${span.parentSpanId}` : root.id,
      agentId: typeof span.attributes?.agentId === 'string'
        ? span.attributes.agentId
        : root.agentId,
      roleName: span.roleName,
      modelRef: span.modelRef,
      tokenUsage: span.tokenUsage,
      inputPreview: summarizeRedactedContent(span.input),
      outputPreview: summarizeRedactedContent(span.output),
      error: truncatePreview(span.error),
      attributes: sanitizeAttributes(span.attributes),
      sequence: sequence++,
      eventCount: spanEvents.length,
      warningCount: spanEvents.filter((event) => /warn/iu.test(event.type)).length,
      artifactCount: spanEvents.filter((event) => /file|patch|artifact|output/iu.test(event.type)).length,
      retryCount: spanEvents.filter((event) => /retry/iu.test(event.type)).length,
    };
    nodes.set(node.id, node);
    timeline.push({
      id: `timeline:${trace.id}:${span.id}`,
      traceId: trace.id,
      nodeId: node.id,
      spanId: span.id,
      type: `span.${span.status}`,
      label,
      timestamp: span.startedAt,
      status: node.status,
      summary: node.error ?? summarizeRedactedContent(span.output ?? span.input),
    });
  }

  for (const span of traceSpans) {
    const nodeId = `span:${span.id}`;
    const parentId = span.parentSpanId ? `span:${span.parentSpanId}` : root.id;
    addEdge(edges, nodes, trace.id, parentId, nodeId, undefined, 'parent-child');
  }

  const dedupedTrajectory = new Map<string, TrajectoryEventLike>();
  trajectoryEvents.forEach((event, index) => {
    dedupedTrajectory.set(trajectoryDedupKey(event, index), event);
  });

  [...dedupedTrajectory.values()].forEach((event, index) => {
    const type = readString(event.type);
    if (!type) return;
    const data = isRecord(event.data) ? event.data : {};
    const timestamp = timestampFromIso(event.ts) ?? startedAt + index;
    const status = eventStatus(type);
    const phase = phaseForTrajectory(type);
    const parentId = parentForTrajectory(type, nodes, root.id);
    const stablePart = sanitizeIdPart(readString(event.spanId) ?? readString(event.seq) ?? `${type}:${timestamp}:${index}`, String(index));
    const node: ObservabilityGraphNode = {
      id: `trajectory:${trace.id}:${stablePart}`,
      traceId: trace.id,
      kind: trajectoryNodeKind(type),
      phase,
      label: trajectoryLabel(type, data),
      subtitle: type,
      status,
      startedAt: timestamp,
      parentId,
      modelRef: readString(event.modelId) ?? readString(event.modelApi),
      summary: truncatePreview(data.summary ?? data.reason ?? data.status),
      inputPreview: summarizeRedactedContent(data.input ?? data.prompt ?? data.args),
      outputPreview: summarizeRedactedContent(data.output ?? data.result ?? data.message),
      error: truncatePreview(data.error ?? data.warning),
      attributes: sanitizeAttributes({
        provider: event.provider,
        modelId: event.modelId,
        modelApi: event.modelApi,
        runId: event.runId,
        sessionKey: event.sessionKey,
        path: data.path ?? data.filePath,
        command: data.command,
        exitCode: data.exitCode,
      }),
      sequence: sequence++,
      eventCount: 1,
      warningCount: phase === 'warning' ? 1 : 0,
      artifactCount: phase === 'artifact' ? 1 : 0,
      retryCount: type.includes('retry') ? 1 : 0,
    };
    if (nodes.has(node.id)) return;
    nodes.set(node.id, node);
    addEdge(edges, nodes, trace.id, node.parentId ?? root.id, node.id, type, edgeKindForEvent(type));
    timeline.push({
      id: `timeline:${trace.id}:trajectory:${stablePart}`,
      traceId: trace.id,
      nodeId: node.id,
      type,
      label: node.label,
      timestamp,
      status,
      summary: node.error ?? node.summary ?? node.outputPreview ?? node.inputPreview,
    });
  });

  for (const event of traceEvents) {
    const nodeId = event.spanId ? `span:${event.spanId}` : root.id;
    timeline.push(traceEventToTimelineItem(trace.id, nodeId, event));
  }

  for (const node of nodes.values()) {
    node.depth = node.parentId ? buildAncestors(nodes, node.id).length - 1 : 0;
  }

  timeline.sort((a, b) => a.timestamp - b.timestamp);

  const graph = applyGraphDiagnostics(
    trace,
    {
      traceId: trace.id,
      nodes: [...nodes.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)),
      edges,
    },
    timeline,
    {
      trajectoryEventCount: dedupedTrajectory.size,
      sourceStatus: options.sourceStatus,
    },
  );

  return {
    trace,
    graph,
    timeline,
  };
}

export function buildObservabilityNodeDiagnostics(
  trace: ObservabilityTrace,
  nodeId: string,
  trajectoryEvents: TrajectoryEventLike[] = [],
): ObservabilityNodeDiagnostics | null {
  const graphResult = buildObservabilityTraceGraph(trace, trajectoryEvents);
  const node = graphResult.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;

  const relatedEvents = graphResult.timeline
    .filter((item) => item.nodeId === nodeId || item.spanId === node.spanId)
    .slice(0, MAX_DIAGNOSTIC_EVENTS)
    .map((item) => ({
      ...item,
      summary: /input|output|prompt|message|result/iu.test(item.type)
        || item.summary === node.inputPreview
        || item.summary === node.outputPreview
        ? summarizeRedactedContent(item.summary)
        : item.summary,
    }));
  const artifacts = graphResult.graph.nodes
    .filter((candidate) => candidate.id === nodeId || candidate.parentId === nodeId)
    .filter((candidate) => candidate.phase === 'artifact' || candidate.kind === 'file' || candidate.kind === 'approval' || candidate.kind === 'tool')
    .map((candidate) => ({
      id: candidate.id,
      type: candidate.kind === 'file'
        ? 'file' as const
        : candidate.kind === 'approval'
          ? 'approval' as const
          : candidate.kind === 'tool'
            ? 'command' as const
            : 'other' as const,
      label: candidate.label,
      preview: candidate.error
        ? truncatePreview(candidate.error, OBSERVABILITY_DIAGNOSTIC_PREVIEW_LIMIT)
        : candidate.outputPreview
          ? summarizeRedactedContent(candidate.outputPreview)
          : truncatePreview(candidate.summary, OBSERVABILITY_DIAGNOSTIC_PREVIEW_LIMIT),
      path: readString(candidate.attributes?.path),
      status: candidate.status,
    }));
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.attributes ?? {})) {
    if (!shouldExposeAttribute(key)) continue;
    const preview = truncatePreview(value, 240);
    if (preview != null) attributes[key] = preview;
  }

  return {
    traceId: trace.id,
    nodeId,
    summary: truncatePreview(node.summary, OBSERVABILITY_DIAGNOSTIC_PREVIEW_LIMIT),
    inputPreview: summarizeRedactedContent(node.inputPreview),
    outputPreview: summarizeRedactedContent(node.outputPreview),
    error: truncatePreview(node.error, OBSERVABILITY_DIAGNOSTIC_PREVIEW_LIMIT),
    events: relatedEvents,
    artifacts,
    attributes,
    issues: graphResult.graph.summary?.issues?.filter((issue) => issue.nodeId === nodeId),
    redacted: true,
    sections: [
      {
        id: 'runtime',
        label: 'runtime',
        items: [
          { id: 'status', label: 'status', value: node.status, tone: node.status === 'error' ? 'bad' : node.status === 'completed' ? 'good' : 'neutral' },
          { id: 'phase', label: 'phase', value: node.phase ?? 'event' },
          { id: 'duration', label: 'duration', value: `${Math.round(node.durationMs ?? 0)}ms` },
          { id: 'sequence', label: 'sequence', value: String(node.sequence ?? 0) },
        ],
      },
      {
        id: 'hotspots',
        label: 'hotspots',
        items: [
          { id: 'events', label: 'events', value: String(node.eventCount ?? relatedEvents.length) },
          { id: 'warnings', label: 'warnings', value: String(node.warningCount ?? 0), tone: (node.warningCount ?? 0) > 0 ? 'warn' : 'neutral' },
          { id: 'artifacts', label: 'artifacts', value: String(node.artifactCount ?? artifacts.length) },
          { id: 'retries', label: 'retries', value: String(node.retryCount ?? 0), tone: (node.retryCount ?? 0) > 0 ? 'warn' : 'neutral' },
        ],
      },
    ],
  };
}

function traceEventToTimelineItem(
  traceId: string,
  nodeId: string,
  event: ObservabilityTraceEvent,
): ObservabilityTimelineItem {
  return {
    id: `timeline:${traceId}:event:${event.id}`,
    traceId,
    nodeId,
    spanId: event.spanId,
    type: event.type,
    label: event.name,
    timestamp: event.timestamp,
    status: /error|failed/iu.test(event.type) ? 'error' : /aborted/iu.test(event.type) ? 'aborted' : undefined,
    summary: truncatePreview(sanitizeAttributes(event.attributes)),
  };
}
