import type {
  ObservabilityGraphNode,
  ObservabilityTimelineItem,
  ObservabilityTrace,
  ObservabilityTraceGraph,
  ObservabilityTraceIssue,
  ObservabilityTraceIssueCategory,
  ObservabilityTraceIssueSeverity,
  ObservabilityTraceSourceStatus,
} from '../../shared/types/observability';
import { truncatePreview } from './observability-redaction';

const STALE_RUNNING_MS = 2 * 60 * 1000;
const MAX_ISSUES = 24;

function issueId(traceId: string, category: ObservabilityTraceIssueCategory, nodeId?: string, index = 0): string {
  return ['issue', traceId, category, nodeId ?? index].join(':').replace(/[^a-z0-9_.:-]+/giu, '-');
}

function addIssue(
  issues: ObservabilityTraceIssue[],
  traceId: string,
  category: ObservabilityTraceIssueCategory,
  severity: ObservabilityTraceIssueSeverity,
  title: string,
  options: {
    nodeId?: string;
    detail?: string;
    evidence?: string[];
    recommendation?: string;
  } = {},
): void {
  const id = issueId(traceId, category, options.nodeId, issues.length);
  if (issues.some((issue) => issue.id === id)) return;
  issues.push({
    id,
    traceId,
    category,
    severity,
    title,
    nodeId: options.nodeId,
    detail: truncatePreview(options.detail, 360),
    evidence: options.evidence?.map((entry) => truncatePreview(entry, 220)).filter((entry): entry is string => Boolean(entry)).slice(0, 5),
    recommendation: truncatePreview(options.recommendation, 260),
  });
}

function latestActivity(trace: ObservabilityTrace, timeline: ObservabilityTimelineItem[]): number {
  return Math.max(
    trace.updatedAt ?? 0,
    trace.endedAt ?? 0,
    trace.startedAt ?? 0,
    ...timeline.map((item) => item.timestamp).filter(Number.isFinite),
    ...(trace.spans ?? []).flatMap((span) => [span.endedAt ?? 0, span.startedAt ?? 0]),
    ...(trace.events ?? []).map((event) => event.timestamp ?? 0),
  );
}

function severityRank(severity: ObservabilityTraceIssueSeverity): number {
  switch (severity) {
    case 'critical':
      return 4;
    case 'error':
      return 3;
    case 'warning':
      return 2;
    default:
      return 1;
  }
}

function nodeLabel(node?: ObservabilityGraphNode): string {
  if (!node) return '';
  return [node.label, node.subtitle].filter(Boolean).join(' / ');
}

export function computeObservabilitySourceStatus(
  trace: ObservabilityTrace,
  timeline: ObservabilityTimelineItem[] = [],
  preferred?: ObservabilityTraceSourceStatus,
): { sourceStatus: ObservabilityTraceSourceStatus; staleRunningNodeIds: string[] } {
  if (preferred) return { sourceStatus: preferred, staleRunningNodeIds: [] };
  if (trace.status !== 'running') return { sourceStatus: 'live', staleRunningNodeIds: [] };
  const last = latestActivity(trace, timeline);
  const isStale = Boolean(last && Date.now() - last > STALE_RUNNING_MS);
  return {
    sourceStatus: isStale ? 'stale' : 'live',
    staleRunningNodeIds: [],
  };
}

export function detectObservabilityIssues(
  trace: ObservabilityTrace,
  graph: ObservabilityTraceGraph,
  timeline: ObservabilityTimelineItem[] = [],
  options: {
    sourceStatus?: ObservabilityTraceSourceStatus;
    staleRunningNodeIds?: string[];
    trajectoryEventCount?: number;
  } = {},
): ObservabilityTraceIssue[] {
  const issues: ObservabilityTraceIssue[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const staleRunningNodeIds = options.staleRunningNodeIds ?? [];

  const errorNodes = graph.nodes.filter((node) => node.status === 'error' || node.kind === 'error');
  for (const node of errorNodes.slice(0, 6)) {
    addIssue(issues, trace.id, 'error-root-cause', 'critical', 'Runtime error', {
      nodeId: node.id,
      detail: node.error ?? node.diagnosticPreview ?? node.summary,
      evidence: [nodeLabel(node), `status:${node.status}`, node.phase ? `phase:${node.phase}` : ''],
      recommendation: 'Open the node diagnostics and inspect the nearest failed tool, model call, or trajectory event.',
    });
  }

  const abortedNodes = graph.nodes.filter((node) => node.status === 'aborted');
  for (const node of abortedNodes.slice(0, 4)) {
    addIssue(issues, trace.id, 'aborted', 'error', 'Execution aborted', {
      nodeId: node.id,
      detail: node.error ?? node.diagnosticPreview,
      evidence: [nodeLabel(node)],
      recommendation: 'Check whether the run was cancelled by the user, approval policy, or runtime abort signal.',
    });
  }

  for (const nodeId of staleRunningNodeIds.slice(0, 6)) {
    const node = nodesById.get(nodeId);
    addIssue(issues, trace.id, 'stalled-running', 'warning', 'Running node looks stale', {
      nodeId,
      detail: node?.diagnosticPreview ?? node?.summary,
      evidence: [nodeLabel(node), `lastActivity:${new Date(latestActivity(trace, timeline)).toISOString()}`],
      recommendation: 'Refresh the trace or inspect the runtime logs to confirm whether the operation is still live.',
    });
  }

  for (const nodeId of graph.summary?.slowNodeIds ?? []) {
    const node = nodesById.get(nodeId);
    if (!node || (node.durationMs ?? 0) <= 0) continue;
    addIssue(issues, trace.id, 'slow-node', 'warning', 'Slow node', {
      nodeId,
      detail: `${nodeLabel(node)} took ${Math.round(node.durationMs ?? 0)}ms.`,
      evidence: [`durationMs:${Math.round(node.durationMs ?? 0)}`],
      recommendation: 'Compare this node with adjacent model/tool calls to decide whether context size, tool latency, or retries dominate.',
    });
  }

  for (const nodeId of graph.summary?.tokenHotspotNodeIds ?? []) {
    const node = nodesById.get(nodeId);
    const tokens = node?.tokenUsage?.totalTokens ?? 0;
    if (!node || tokens <= 0) continue;
    addIssue(issues, trace.id, 'token-hotspot', tokens >= 8000 ? 'warning' : 'info', 'Token or cost hotspot', {
      nodeId,
      detail: `${nodeLabel(node)} used ${tokens} token(s).`,
      evidence: [`tokens:${tokens}`, `costUsd:${node.tokenUsage?.costUsd ?? 0}`],
      recommendation: 'Inspect context and model choice before optimizing downstream tool behavior.',
    });
  }

  for (const node of graph.nodes.filter((candidate) => (candidate.retryCount ?? 0) > 0).slice(0, 6)) {
    addIssue(issues, trace.id, 'tool-retry', 'warning', 'Tool retry', {
      nodeId: node.id,
      detail: node.diagnosticPreview,
      evidence: [`retries:${node.retryCount ?? 0}`, nodeLabel(node)],
      recommendation: 'Check tool arguments, exit codes, and permission state around this node.',
    });
  }

  for (const node of graph.nodes.filter((candidate) => candidate.phase === 'approval' || candidate.kind === 'approval').slice(0, 6)) {
    addIssue(issues, trace.id, 'approval-wait', node.status === 'running' ? 'warning' : 'info', 'Approval checkpoint', {
      nodeId: node.id,
      detail: node.diagnosticPreview,
      evidence: [nodeLabel(node), `status:${node.status}`],
      recommendation: 'Verify whether the approval was granted, denied, or left waiting.',
    });
  }

  for (const node of graph.nodes.filter((candidate) => candidate.phase === 'artifact' || candidate.kind === 'file').slice(0, 6)) {
    addIssue(issues, trace.id, 'artifact', 'info', 'Artifact produced', {
      nodeId: node.id,
      detail: node.diagnosticPreview,
      evidence: [nodeLabel(node)],
      recommendation: 'Use the Artifacts tab to review file paths, patches, or command outputs linked to this node.',
    });
  }

  for (const node of graph.nodes.filter((candidate) => candidate.kind === 'tool' && candidate.status === 'error').slice(0, 4)) {
    addIssue(issues, trace.id, 'command-failed', 'error', 'Command or tool failed', {
      nodeId: node.id,
      detail: node.error ?? node.diagnosticPreview,
      evidence: [nodeLabel(node)],
      recommendation: 'Inspect command exit metadata and retry context in the node diagnostics drawer.',
    });
  }

  const hasVerifier = (trace.spans ?? []).some((span) => span.kind === 'verifier' || span.roleName === 'skeptic')
    || graph.nodes.some((node) => node.phase === 'verifier' || node.roleName === 'skeptic');
  if (trace.mode === 'adversarial-review' && !hasVerifier) {
    addIssue(issues, trace.id, 'missing-verifier', 'warning', 'Verifier missing', {
      nodeId: `trace:${trace.id}`,
      detail: 'Adversarial review trace did not produce a verifier/skeptic span.',
      evidence: [`mode:${trace.mode}`],
      recommendation: 'Confirm routing rules and role-first orchestration settings for verifier creation.',
    });
  }

  if ((options.trajectoryEventCount ?? 0) > 0 && (trace.spans ?? []).length === 0) {
    addIssue(issues, trace.id, 'orphan-trajectory', 'warning', 'Trajectory without runtime spans', {
      nodeId: `trace:${trace.id}`,
      detail: 'Trajectory events were recovered but no runtime spans are available.',
      evidence: [`trajectoryEvents:${options.trajectoryEventCount}`],
      recommendation: 'Treat this trace as partial and use session/run correlation to inspect the original transcript.',
    });
  }

  const hasFinalOutput = graph.nodes.some((node) => node.phase === 'output' || Boolean(node.outputPreview))
    || (trace.events ?? []).some((event) => /output|completed|final/iu.test(event.type) || /output|completed|final/iu.test(event.name));
  if (trace.status === 'completed' && !hasFinalOutput) {
    addIssue(issues, trace.id, 'missing-output', 'info', 'No final output marker', {
      nodeId: `trace:${trace.id}`,
      detail: 'The trace completed but no explicit final output event or output node was found.',
      evidence: [`status:${trace.status}`],
      recommendation: 'Check transcript correlation if the user-facing answer is expected but not represented in trace data.',
    });
  }

  return issues
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.category.localeCompare(b.category))
    .slice(0, MAX_ISSUES);
}
