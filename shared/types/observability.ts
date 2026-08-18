export type ObservabilityTraceStatus = 'running' | 'completed' | 'error' | 'aborted';
export type ObservabilitySpanStatus = ObservabilityTraceStatus;

export type ObservabilitySpanKind =
  | 'orchestrator'
  | 'role-router'
  | 'team'
  | 'subagent'
  | 'model'
  | 'tool'
  | 'memory'
  | 'context-pack'
  | 'gatekeeper'
  | 'verifier'
  | 'security-intercept'
  | 'verification'
  | 'input-mode'
  | 'custom';

export type ObservabilityTokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costUsd: number;
};

export type ObservabilitySpan = {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  kind: ObservabilitySpanKind;
  roleName?: string;
  modelRef?: string;
  status: ObservabilitySpanStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  input?: string;
  output?: string;
  tokenUsage?: ObservabilityTokenUsage;
  metrics?: Record<string, number>;
  attributes?: Record<string, unknown>;
  error?: string;
};

export type ObservabilityTraceEvent = {
  id: string;
  traceId: string;
  spanId?: string;
  type: string;
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
};

export type ObservabilityTrace = {
  id: string;
  name: string;
  runId?: string;
  sessionKey?: string;
  task?: string;
  mode?: string;
  status: ObservabilityTraceStatus;
  startedAt: number;
  endedAt?: number;
  updatedAt?: number;
  durationMs?: number;
  spans: ObservabilitySpan[];
  events: ObservabilityTraceEvent[];
  tokenUsage: ObservabilityTokenUsage;
  metrics: Record<string, number>;
  tags: string[];
  error?: string;
};

export type ObservabilityMetricCard = {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  trend?: 'up' | 'down' | 'flat';
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
};

export type ObservabilityScoreItem = {
  id: string;
  label: string;
  score: number;
  weight: number;
  reason: string;
};

export type ObservabilityScorecard = {
  traceId: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  items: ObservabilityScoreItem[];
};

export type ObservabilityTraceMetrics = {
  traceId: string;
  durationMs: number;
  spanCount: number;
  errorCount: number;
  toolCallCount: number;
  subagentCount: number;
  memoryOperationCount: number;
  contextPackCount: number;
  verifierCount: number;
  tokenUsage: ObservabilityTokenUsage;
  costUsd: number;
  longestSpan?: { id: string; name: string; durationMs: number };
};

export type ObservabilityGraphNodeKind =
  | 'root'
  | 'agent'
  | 'subagent'
  | 'orchestrator'
  | 'router'
  | 'model'
  | 'tool'
  | 'memory'
  | 'context'
  | 'approval'
  | 'file'
  | 'event'
  | 'error';

export type ObservabilityGraphPhase =
  | 'input'
  | 'routing'
  | 'context'
  | 'model'
  | 'tool'
  | 'artifact'
  | 'approval'
  | 'subagent'
  | 'verifier'
  | 'output'
  | 'warning'
  | 'error'
  | 'orchestration'
  | 'memory'
  | 'event';

export type ObservabilityGraphEdgeKind =
  | 'parent-child'
  | 'causal'
  | 'artifact'
  | 'error'
  | 'retry'
  | 'handoff';

export type ObservabilityTraceIssueSeverity = 'info' | 'warning' | 'error' | 'critical';

export type ObservabilityTraceIssueCategory =
  | 'error-root-cause'
  | 'aborted'
  | 'stalled-running'
  | 'slow-node'
  | 'token-hotspot'
  | 'tool-retry'
  | 'approval-wait'
  | 'artifact'
  | 'command-failed'
  | 'missing-verifier'
  | 'orphan-trajectory'
  | 'missing-output';

export type ObservabilityTraceIssue = {
  id: string;
  traceId: string;
  nodeId?: string;
  severity: ObservabilityTraceIssueSeverity;
  category: ObservabilityTraceIssueCategory;
  title: string;
  detail?: string;
  evidence?: string[];
  recommendation?: string;
};

export type ObservabilityTraceSourceStatus = 'live' | 'stale' | 'rehydrated' | 'partial';

export type ObservabilityTraceCoverage = {
  spanCount: number;
  eventCount: number;
  trajectoryEventCount: number;
  graphNodeCount: number;
  graphEdgeCount: number;
  hasRuntimeSpans: boolean;
  hasTrajectory: boolean;
  redacted: boolean;
};

export type ObservabilityTraceCorrelation = {
  traceId: string;
  runId?: string;
  sessionKey?: string;
  workspaceId?: string;
  taskLedgerNodeIds?: string[];
  clawGraphRunId?: string;
  filePaths?: string[];
};

export type ObservabilityGraphNode = {
  id: string;
  traceId: string;
  kind: ObservabilityGraphNodeKind;
  label: string;
  subtitle?: string;
  status: ObservabilityTraceStatus;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  spanId?: string;
  parentId?: string;
  agentId?: string;
  roleName?: string;
  modelRef?: string;
  tokenUsage?: ObservabilityTokenUsage;
  summary?: string;
  inputPreview?: string;
  outputPreview?: string;
  error?: string;
  attributes?: Record<string, unknown>;
  phase?: ObservabilityGraphPhase;
  sequence?: number;
  depth?: number;
  eventCount?: number;
  warningCount?: number;
  artifactCount?: number;
  retryCount?: number;
  critical?: boolean;
  collapsedChildrenCount?: number;
  diagnosticPreview?: string;
};

export type ObservabilityGraphEdge = {
  id: string;
  traceId: string;
  from: string;
  to: string;
  label?: string;
  status?: ObservabilityTraceStatus;
  critical?: boolean;
  kind?: ObservabilityGraphEdgeKind;
};

export type ObservabilityTimelineItem = {
  id: string;
  traceId: string;
  nodeId?: string;
  spanId?: string;
  type: string;
  label: string;
  timestamp: number;
  status?: ObservabilityTraceStatus;
  summary?: string;
};

export type ObservabilityTraceGraph = {
  traceId: string;
  nodes: ObservabilityGraphNode[];
  edges: ObservabilityGraphEdge[];
  summary?: {
    criticalPathNodeIds: string[];
    errorNodeIds: string[];
    slowNodeIds: string[];
    tokenHotspotNodeIds: string[];
    artifactNodeIds: string[];
    issues?: ObservabilityTraceIssue[];
    coverage?: ObservabilityTraceCoverage;
    sourceStatus?: ObservabilityTraceSourceStatus;
    staleRunningNodeIds?: string[];
  };
};

export type ObservabilityTraceGraphResult = {
  trace: ObservabilityTrace;
  graph: ObservabilityTraceGraph;
  timeline: ObservabilityTimelineItem[];
};

export type ObservabilityNodeDiagnosticSection = {
  id: string;
  label: string;
  items: Array<{
    id: string;
    label: string;
    value: string;
    tone?: 'neutral' | 'good' | 'warn' | 'bad';
  }>;
};

export type ObservabilityNodeDiagnostics = {
  traceId: string;
  nodeId: string;
  summary?: string;
  inputPreview?: string;
  outputPreview?: string;
  error?: string;
  events: ObservabilityTimelineItem[];
  artifacts: Array<{
    id: string;
    type: 'file' | 'patch' | 'command' | 'approval' | 'session' | 'output' | 'other';
    label: string;
    preview?: string;
    path?: string;
    status?: ObservabilityTraceStatus;
  }>;
  attributes: Record<string, string>;
  sections: ObservabilityNodeDiagnosticSection[];
  issues?: ObservabilityTraceIssue[];
  redacted: boolean;
};

export type ObservabilityTraceIndexEntry = {
  id: string;
  name: string;
  status: ObservabilityTraceStatus;
  durationMs: number;
  startedAt?: number;
  updatedAt: number;
  sourceStatus: ObservabilityTraceSourceStatus;
  sourceStatusUpdatedAt?: number;
  score?: number;
  costUsd: number;
  tokenCount: number;
  spanCount: number;
  errorCount: number;
  toolCallCount: number;
  artifactCount: number;
  warningCount: number;
  retryCount: number;
  approvalCount: number;
  issueCount: number;
  issues: ObservabilityTraceIssue[];
  firstError?: string;
  slowestNodeLabel?: string;
  leadRole?: string;
  agent?: string;
  role?: string;
  model?: string;
  sessionKey?: string;
  runId?: string;
  hasToolCalls: boolean;
  hasArtifacts: boolean;
  hasApproval: boolean;
  hasRetries: boolean;
  hasWarnings: boolean;
  correlation: ObservabilityTraceCorrelation;
};

export type ObservabilityTraceQuery = {
  status?: ObservabilityTraceStatus | 'all';
  from?: number;
  to?: number;
  agent?: string;
  role?: string;
  model?: string;
  sessionKey?: string;
  runId?: string;
  hasErrors?: boolean;
  hasToolCalls?: boolean;
  hasArtifacts?: boolean;
  hasApproval?: boolean;
  hasRetries?: boolean;
  hasWarnings?: boolean;
  keyword?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'startedAt' | 'updatedAt' | 'durationMs' | 'costUsd' | 'tokenCount' | 'issueCount';
  sortDir?: 'asc' | 'desc';
};

export type ObservabilityTraceQueryFacet = {
  value: string;
  count: number;
};

export type ObservabilityTraceQueryResult = {
  generatedAt: number;
  items: ObservabilityTraceIndexEntry[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    status: ObservabilityTraceQueryFacet[];
    agent: ObservabilityTraceQueryFacet[];
    role: ObservabilityTraceQueryFacet[];
    model: ObservabilityTraceQueryFacet[];
    sourceStatus: ObservabilityTraceQueryFacet[];
  };
};

export type ObservabilitySourceHealthStatus = 'ok' | 'empty' | 'error';

export type ObservabilitySourceHealthReason = 'available' | 'not-configured' | 'no-data' | 'failed';

export type ObservabilitySourceHealthEntry = {
  status: ObservabilitySourceHealthStatus;
  reason: ObservabilitySourceHealthReason;
  /** Bounded diagnostic detail for a failed source; never used for raw trace data. */
  detail?: string;
};

export type ObservabilitySourceHealth = {
  runtime: ObservabilitySourceHealthEntry;
  index: ObservabilitySourceHealthEntry;
  trajectory: ObservabilitySourceHealthEntry;
};

export type ObservabilityDashboardSnapshot = {
  generatedAt: number;
  cards: ObservabilityMetricCard[];
  scorecards: ObservabilityScorecard[];
  traces: Array<{
    id: string;
    name: string;
    status: ObservabilityTraceStatus;
    durationMs: number;
    updatedAt?: number;
    sourceStatus?: ObservabilityTraceSourceStatus;
    score?: number;
    costUsd: number;
    tokenCount: number;
    spanCount: number;
    errorCount: number;
    toolCallCount?: number;
    artifactCount?: number;
    warningCount?: number;
    retryCount?: number;
    approvalCount?: number;
    issueCount?: number;
    issues?: ObservabilityTraceIssue[];
    firstError?: string;
    slowestNodeLabel?: string;
    startedAt?: number;
    sessionKey?: string;
    runId?: string;
    leadRole?: string;
    agent?: string;
    role?: string;
    model?: string;
    hasToolCalls?: boolean;
    hasArtifacts?: boolean;
    hasApproval?: boolean;
    hasRetries?: boolean;
    hasWarnings?: boolean;
    correlation?: ObservabilityTraceCorrelation;
  }>;
  alerts: string[];
  sourceHealth: ObservabilitySourceHealth;
};

// ---------------------------------------------------------------------------
// WV-B2-02A raw v2 trajectory supply (Main-owned bridge to the renderer).
//
// These payloads carry validated raw `TrajectoryEventV2` rows exactly as the
// B1-01 schema in `openclaw_runtime/src/trajectory` defines them. The shared
// layer stays runtime-agnostic, so the event rows are generic here; Main and
// the renderer entrypoints bind `Event` to `TrajectoryEventV2`, and Main
// re-validates every row against the B1-01 schema before it crosses the host
// boundary. v1 rows never appear here: sessions that only hold legacy v1 data
// are reported through `legacyFallback` and supply no events. `asOfSeq` is the
// cold-history/realtime handoff point — the renderer drops any buffered
// realtime event with `seq <= asOfSeq` before appending.

export type ObservabilityTrajectorySessionSupply = {
  sessionKey: string;
  /** Last validated v2 seq accepted by Main for this session (0 when none). */
  lastSeq: number;
  /** Earliest v2 seq still retained in Main memory (0 when none). */
  earliestRetainedSeq: number;
  /** True when the session only has explicit v1 legacy data (no v2 supply). */
  legacyFallback: boolean;
};

export type ObservabilityTrajectoryHistoryPage<Event = unknown> = {
  sessionKey: string;
  schemaVersion: 2;
  fromSeq: number;
  /** Validated raw v2 events in strictly ascending seq order, all > fromSeq. */
  events: Event[];
  /** Seq of the last event in this page, or fromSeq when the page is empty. */
  asOfSeq: number;
  hasMore: boolean;
  legacyFallback: boolean;
  /** Rows dropped by Main's boundary re-validation (invalid, v1, or out-of-order). */
  rejected: number;
};

export type ObservabilityTrajectorySupplyEvent<Event = unknown> = {
  sessionKey: string;
  schemaVersion: 2;
  /** Validated raw v2 events in strictly ascending seq order. */
  events: Event[];
};

export type ObservabilityRuntimeEvent =
  | { type: 'trace.started'; trace: ObservabilityTrace }
  | { type: 'trace.updated'; trace: ObservabilityTrace }
  | { type: 'trace.completed'; trace: ObservabilityTrace; scorecard?: ObservabilityScorecard }
  | { type: 'span.started'; traceId: string; span: ObservabilitySpan }
  | { type: 'span.completed'; traceId: string; span: ObservabilitySpan }
  | { type: 'event.recorded'; traceId: string; event: ObservabilityTraceEvent };

// ---------------------------------------------------------------------------
// Round 2: Observability Event Namespace Governance
//
// Each area owns a namespace (`claw.{area}.`). Spans/events outside an area's
// namespace are rejected at recording time. This prevents cross-area span
// pollution and makes traces human-readable.
//
// See: docs/runtime-design/development-manual.md §1.1, Stage 3
// ---------------------------------------------------------------------------

/** The area prefix of the observability namespace. */
export type ObservabilityAreaPrefix = 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'a6' | 'core';

/** A fully-qualified event name in the `claw.{area}.{category}.{event}` format. */
export type ObservabilityEventName = `claw.${ObservabilityAreaPrefix}.${string}`;

/** Retention/decay policy for an event category. */
export type ObservabilityRetentionPolicy = {
  /** How long to retain spans of this category, in milliseconds. */
  retentionMs: number;
  /** Sampling rate when throughput exceeds `thresholdPerMinute`. */
  highThroughputSamplingRate: number;
  /** Spans per minute above which sampling kicks in. */
  thresholdPerMinute: number;
};

/** Default retention policies by event category. */
export const OBSERVABILITY_RETENTION_POLICIES = {
  decision: { retentionMs: 7 * 24 * 60 * 60 * 1000, highThroughputSamplingRate: 1.0, thresholdPerMinute: Infinity },
  diagnostic: { retentionMs: 3 * 24 * 60 * 60 * 1000, highThroughputSamplingRate: 0.1, thresholdPerMinute: 100 },
  error: { retentionMs: 30 * 24 * 60 * 60 * 1000, highThroughputSamplingRate: 1.0, thresholdPerMinute: Infinity },
  shadow: { retentionMs: 7 * 24 * 60 * 60 * 1000, highThroughputSamplingRate: 0.01, thresholdPerMinute: 50 },
} as const satisfies Record<string, ObservabilityRetentionPolicy>;

/** Trace truncation threshold. Above this, low-priority spans are dropped. */
export const TRACE_SPAN_TRUNCATION_THRESHOLD = 200;

/**
 * Validate that an event name is within the caller's area namespace.
 * Returns `null` if valid, or an error message.
 */
export function validateEventNamespace(
  eventName: string,
  callerArea: ObservabilityAreaPrefix,
): string | null {
  const prefix = `claw.${callerArea}.`;
  if (eventName.startsWith(prefix)) return null;
  // `core.` namespace is reserved for Mission Control and existing infrastructure.
  if (callerArea === 'core' && eventName.startsWith('claw.core.')) return null;
  return `Event name "${eventName}" does not match caller area "${callerArea}" (expected prefix "claw.${callerArea}.")`;
}

/**
 * Determine if a span should be dropped during trace truncation.
 * Priority order (highest first): core > a6 > a1 > a2 > a5 > a3 > a4.
 * A4 spans are dropped first; A6 spans are dropped last.
 */
export function spanDropPriority(area: ObservabilityAreaPrefix): number {
  const priority: Record<ObservabilityAreaPrefix, number> = {
    core: 0,
    a6: 1,
    a1: 2,
    a2: 3,
    a5: 4,
    a3: 5,
    a4: 6,
  };
  return priority[area];
}
