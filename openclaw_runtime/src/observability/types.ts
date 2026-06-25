export type ObservabilityTraceStatus = "running" | "completed" | "error" | "aborted";
export type ObservabilitySpanStatus = ObservabilityTraceStatus;

export type ObservabilitySpanKind =
  | "orchestrator"
  | "role-router"
  | "team"
  | "subagent"
  | "model"
  | "tool"
  | "memory"
  | "context-pack"
  | "gatekeeper"
  | "verifier"
  | "security-intercept"
  | "verification"
  | "input-mode"
  | "custom";

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
  trend?: "up" | "down" | "flat";
  tone?: "good" | "warn" | "bad" | "neutral";
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
  grade: "A" | "B" | "C" | "D" | "F";
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

export type ObservabilityDashboardSnapshot = {
  generatedAt: number;
  cards: ObservabilityMetricCard[];
  scorecards: ObservabilityScorecard[];
  traces: Array<{
    id: string;
    name: string;
    status: ObservabilityTraceStatus;
    durationMs: number;
    score?: number;
    costUsd: number;
    tokenCount: number;
    spanCount: number;
    errorCount: number;
  }>;
  alerts: string[];
};

export type ObservabilityRuntimeEvent =
  | { type: "trace.started"; trace: ObservabilityTrace }
  | { type: "trace.updated"; trace: ObservabilityTrace }
  | { type: "trace.completed"; trace: ObservabilityTrace; scorecard?: ObservabilityScorecard }
  | { type: "span.started"; traceId: string; span: ObservabilitySpan }
  | { type: "span.completed"; traceId: string; span: ObservabilitySpan }
  | { type: "event.recorded"; traceId: string; event: ObservabilityTraceEvent };
