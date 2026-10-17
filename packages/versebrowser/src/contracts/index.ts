/**
 * P0 公共类型与工具结果契约 — MCP / CLI / SDK 共用。
 */

export type EvidenceKind =
  | 'screenshot'
  | 'console'
  | 'network'
  | 'snapshot'
  | 'summary'
  | 'explain'
  | 'verify'
  | 'timeline'
  | 'har';

export type EvidenceRef = {
  id: string;
  kind: EvidenceKind;
  label: string;
  /** Absolute or workspace-relative path on disk. Prefer path over inline bytes. */
  path?: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
};

export type ToolResultError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

/** Canonical tool result for MCP / CLI surfaces. Context stays summary-sized. */
export type ToolResult = {
  ok: boolean;
  /** Short human-readable summary for the model / CLI stdout. */
  content: string;
  /** Structured payload when the caller needs machine-readable fields. */
  data?: unknown;
  evidence?: EvidenceRef[];
  error?: ToolResultError;
};

export type StackFrame = {
  url?: string;
  line?: number;
  column?: number;
  functionName?: string;
  raw: string;
};

export type ExplainErrorFrameResult = StackFrame & {
  source?: string;
  originalLine?: number;
  originalColumn?: number;
  name?: string;
  snippet?: string;
  redacted?: boolean;
  truncated?: boolean;
  mapped: boolean;
  /** Why mapping is missing (no source map / filtered frame / fetch blocked). */
  reason?: string;
};

export type ExplainErrorResult = {
  message: string;
  frames: ExplainErrorFrameResult[];
  /** First mapped app frame — the line an agent should edit. */
  primary?: ExplainErrorFrameResult;
  suggestion?: string;
  content: string;
};

export type VerifySelectorResult = {
  selector: string;
  found: boolean;
  visible?: boolean;
  enabled?: boolean;
  detail?: string;
};

/**
 * How a signal channel itself was collected.
 * `failed`/`degraded` means empty lists must NOT be read as "no problems observed".
 */
export type SignalCollectionStatus = 'ok' | 'degraded' | 'failed';

/** verify outcome: PASS only when checks passed AND collection is complete. */
export type VerifyOutcome = 'pass' | 'fail' | 'unknown';

export type ConsoleIncrementalDiff = {
  baselineCount: number;
  newErrors: string[];
  newWarnings: string[];
  collection: SignalCollectionStatus;
  collectionError?: string;
  /**
   * The watermark line is no longer in the captured log (host evicted it), so
   * the whole log was judged instead of silently skipping everything.
   */
  watermarkMissing?: boolean;
};

export type NetworkFailureItem = {
  id: string;
  url: string;
  method: string;
  status?: number;
  error?: string;
};

export type NetworkFailureSummary = {
  count: number;
  failures: NetworkFailureItem[];
  collection: SignalCollectionStatus;
  collectionError?: string;
  /**
   * Number of earlier session requests excluded from this summary (the
   * "current page" window). Present when > 0 so a reader can tell a scoped
   * count from a whole-session count.
   */
  baseline?: number;
  /**
   * The watermark request is no longer in the captured list (host evicted it),
   * so the whole list was judged instead of silently skipping everything.
   */
  baselineMissing?: boolean;
};

export type VerifyCollectionReport = {
  console: SignalCollectionStatus;
  network: SignalCollectionStatus;
  overall: SignalCollectionStatus;
  notes: string[];
};

/**
 * Business-level assertion for verify_flow.
 * Health signals (no console/network errors) are NOT business success.
 */
export type VerifyExpectation =
  | {
      type: 'text';
      selector: string;
      contains?: string;
      equals?: string;
      pattern?: string;
      label?: string;
    }
  | {
      type: 'value';
      selector: string;
      contains?: string;
      equals?: string;
      pattern?: string;
      label?: string;
    }
  | { type: 'enabled'; selector: string; label?: string }
  | { type: 'disabled'; selector: string; label?: string }
  | { type: 'url'; contains?: string; equals?: string; pattern?: string; label?: string };

export type VerifyExpectationResult = {
  type: VerifyExpectation['type'];
  label: string;
  passed: boolean;
  detail?: string;
};

export type VerifyReport = {
  schemaVersion: 1;
  /** True only when outcome === 'pass'. Never true when collection is incomplete. */
  ok: boolean;
  outcome: VerifyOutcome;
  collection: VerifyCollectionReport;
  startedAt: string;
  endedAt: string;
  sessionId: string;
  selectors: VerifySelectorResult[];
  /** Business assertions. Empty means only health signals were checked. */
  expectations: VerifyExpectationResult[];
  consoleDiff: ConsoleIncrementalDiff;
  networkFailures: NetworkFailureSummary;
  screenshotPaths: string[];
  summaryMarkdown: string;
  evidence: EvidenceRef[];
};

/** Flight Recorder event classes (m3-timeline). */
export type TimelineEventKind = 'action' | 'network' | 'console' | 'snapshot' | 'mode';

export type TimelineEvent = {
  seq: number;
  at: string;
  kind: TimelineEventKind;
  sessionId?: string;
  name: string;
  detail?: Record<string, unknown>;
  ok?: boolean;
};

export type TimelineRecord = {
  schemaVersion: 1;
  startedAt: string;
  endedAt?: string;
  sessionId?: string;
  events: TimelineEvent[];
};

export type DiagnosisFailurePoint = {
  index: number;
  kind: TimelineEventKind | 'assertion';
  name: string;
  at: string;
  summary: string;
  context?: TimelineEvent[];
};

export type DiagnosisReport = {
  schemaVersion: 1;
  createdAt: string;
  sessionId?: string;
  ok: boolean;
  failureCount: number;
  firstFailure?: DiagnosisFailurePoint;
  failures: DiagnosisFailurePoint[];
  summaryMarkdown: string;
};

export function okResult(content: string, data?: unknown, evidence?: EvidenceRef[]): ToolResult {
  return { ok: true, content, ...(data !== undefined ? { data } : {}), ...(evidence?.length ? { evidence } : {}) };
}

export function errResult(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ToolResult {
  return {
    ok: false,
    content: message,
    error: { code, message, ...(details ? { details } : {}) },
  };
}

export function createEvidenceRef(
  input: Omit<EvidenceRef, 'createdAt' | 'id'> & { id?: string; createdAt?: string },
): EvidenceRef {
  return {
    id: input.id ?? `ev-${input.kind}-${Date.now().toString(36)}`,
    kind: input.kind,
    label: input.label,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.path ? { path: input.path } : {}),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(input.size !== undefined ? { size: input.size } : {}),
  };
}
