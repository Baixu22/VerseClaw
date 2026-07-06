import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { EvidenceRef } from "../runtime-core/index.js";

export const LOCAL_CONTROL_PLANE_REPORT_SCHEMA = "openclaw.local-control-plane.report.v1";

export const LOCAL_CONTROL_PLANE_REPORT_KINDS = [
  "context",
  "model_router",
  "capability",
  "evidence",
  "mission",
] as const;

export type LocalControlPlaneReportKind = (typeof LOCAL_CONTROL_PLANE_REPORT_KINDS)[number];

export type LocalControlPlaneReportMode = "observe";

export type LocalControlPlaneDiagnosticSeverity = "info" | "warning" | "error";

export type LocalControlPlaneJsonPrimitive = string | number | boolean | null;
export type LocalControlPlaneJsonValue =
  | LocalControlPlaneJsonPrimitive
  | LocalControlPlaneJsonValue[]
  | { [key: string]: LocalControlPlaneJsonValue };

export type LocalControlPlaneJsonObject = { [key: string]: LocalControlPlaneJsonValue };

export type LocalControlPlaneDiagnostic = {
  code: string;
  severity: LocalControlPlaneDiagnosticSeverity;
  message: string;
  metadata?: LocalControlPlaneJsonObject;
};

export type LocalControlPlaneReport = {
  schema: typeof LOCAL_CONTROL_PLANE_REPORT_SCHEMA;
  id: string;
  kind: LocalControlPlaneReportKind;
  mode: LocalControlPlaneReportMode;
  legacyUnaffected: true;
  timestamp: string;
  sessionKey?: string;
  runId?: string;
  taskId?: string;
  summary: string;
  diagnostics: LocalControlPlaneDiagnostic[];
  evidenceRefs: EvidenceRef[];
  payload?: LocalControlPlaneJsonValue;
};

export type LocalControlPlaneFlags = Record<
  "contextReport" | "modelRouterReport" | "capabilityReport" | "evidenceReport" | "missionReport",
  boolean
>;

export type LocalControlPlaneReportInput = {
  kind: LocalControlPlaneReportKind;
  summary: string;
  sessionKey?: string;
  runId?: string;
  taskId?: string;
  timestamp?: string | number | Date;
  diagnostics?: readonly Partial<LocalControlPlaneDiagnostic>[];
  evidenceRefs?: readonly EvidenceRef[];
  payload?: unknown;
};

export type LocalControlPlaneReportFilter = {
  kind?: LocalControlPlaneReportKind;
  sessionKey?: string;
  runId?: string;
  taskId?: string;
  limit?: number;
};

export type LocalControlPlaneCorrelationGroupBy = "task" | "run" | "session" | "evidence";

export type LocalControlPlaneCorrelationFilter = LocalControlPlaneReportFilter & {
  groupBy?: LocalControlPlaneCorrelationGroupBy;
  evidenceType?: string;
  evidenceRef?: string;
};

export type LocalControlPlaneCorrelationGroup = {
  key: string;
  groupBy: LocalControlPlaneCorrelationGroupBy;
  sessionKey?: string;
  runId?: string;
  taskId?: string;
  evidenceRefs: EvidenceRef[];
  reportIds: string[];
  kinds: LocalControlPlaneReportKind[];
  reportCount: number;
  firstReportAt: string;
  lastReportAt: string;
  diagnosticsBySeverity: Record<LocalControlPlaneDiagnosticSeverity, number>;
  diagnosticCodes: string[];
};

export type LocalControlPlaneCorrelationSummary = {
  schema: "openclaw.local-control-plane.correlations.v1";
  mode: LocalControlPlaneReportMode;
  legacyUnaffected: true;
  generatedAt: string;
  filter: LocalControlPlaneCorrelationFilter;
  totals: {
    reportCount: number;
    groupCount: number;
    evidenceRefCount: number;
  };
  groups: LocalControlPlaneCorrelationGroup[];
};

export type LocalControlPlaneStatus = {
  schema: "openclaw.local-control-plane.status.v1";
  mode: LocalControlPlaneReportMode;
  legacyUnaffected: true;
  flags: LocalControlPlaneFlags;
  enabledKinds: LocalControlPlaneReportKind[];
  buffer: {
    size: number;
    maxSize: number;
    lastReportAt: string | null;
  };
  countsByKind: Record<LocalControlPlaneReportKind, number>;
};

export type LocalControlPlaneReportTraceEvent = {
  type: "local_control_plane.report";
  name: string;
  timestamp: string;
  attributes: {
    reportId: string;
    kind: LocalControlPlaneReportKind;
    mode: LocalControlPlaneReportMode;
    legacyUnaffected: true;
    sessionKey?: string;
    runId?: string;
    taskId?: string;
    summary: string;
    diagnosticCount: number;
    diagnosticsBySeverity: Record<LocalControlPlaneDiagnosticSeverity, number>;
    diagnosticCodes: string[];
    evidenceRefCount: number;
    evidenceRefTypes: string[];
    payloadOmitted: true;
    durableTaskState: false;
    reportStorage: "bounded_in_memory";
  };
};

export type LocalControlPlaneReportTraceEventListener = (event: LocalControlPlaneReportTraceEvent) => void;

const DEFAULT_FLAGS: LocalControlPlaneFlags = {
  contextReport: false,
  modelRouterReport: false,
  capabilityReport: false,
  evidenceReport: false,
  missionReport: false,
};

const KIND_TO_FLAG = {
  context: "contextReport",
  model_router: "modelRouterReport",
  capability: "capabilityReport",
  evidence: "evidenceReport",
  mission: "missionReport",
} as const satisfies Record<LocalControlPlaneReportKind, keyof LocalControlPlaneFlags>;

// ---------------------------------------------------------------------------
// Round 2: LCP Kind Registry Governance
//
// Every LCP report kind must declare a decay policy. The kind count is capped
// at MAX_LCP_KINDS (currently 10) to prevent observability surface explosion.
// New kinds require project-lead approval and a decay policy entry here.
//
// See: net use/designs/development-manual.md §1.1, Stage 0
// ---------------------------------------------------------------------------

/** Hard cap on the number of LCP report kinds. Currently 5; ceiling is 10. */
export const MAX_LCP_KINDS = 10;

/** Decay policy for an LCP report kind. Required for every kind. */
export type LcpKindDecayPolicy = {
  /** How long the report is retained in the ring buffer, in milliseconds. */
  retentionMs: number;
  /** Sampling rate after the shadow phase for this kind is promoted. */
  postPromotionSamplingRate: number;
};

/**
 * Metadata for each LCP report kind. Every kind in
 * `LOCAL_CONTROL_PLANE_REPORT_KINDS` MUST have an entry here — enforced by
 * `satisfies`. Adding a kind without a decay policy is a compile error.
 */
export const LCP_KIND_METADATA = {
  context: { retentionMs: 7 * 24 * 60 * 60 * 1000, postPromotionSamplingRate: 1.0 },
  model_router: { retentionMs: 7 * 24 * 60 * 60 * 1000, postPromotionSamplingRate: 1.0 },
  capability: { retentionMs: 7 * 24 * 60 * 60 * 1000, postPromotionSamplingRate: 1.0 },
  evidence: { retentionMs: 30 * 24 * 60 * 60 * 1000, postPromotionSamplingRate: 1.0 },
  mission: { retentionMs: 7 * 24 * 60 * 60 * 1000, postPromotionSamplingRate: 1.0 },
} as const satisfies Record<LocalControlPlaneReportKind, LcpKindDecayPolicy>;

/** Compile-time assertion: current kind count does not exceed the cap. */
const _KIND_COUNT_ASSERTION: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 =
  LOCAL_CONTROL_PLANE_REPORT_KINDS.length;
void _KIND_COUNT_ASSERTION;

/**
 * Validate that adding a new LCP kind would not exceed the cap.
 * Returns `null` if allowed, or an error message.
 */
export function validateLcpKindRegistration(currentCount: number): string | null {
  if (currentCount >= MAX_LCP_KINDS) {
    return `Cannot register new LCP kind: current count (${currentCount}) >= cap (${MAX_LCP_KINDS}). ` +
      `Must deprecate an existing kind or raise the cap (requires project-lead + architecture review).`;
  }
  return null;
}

const MAX_REPORTS = 200;
const MAX_STRING_CHARS = 1_000;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 80;
const MAX_DEPTH = 6;

const HIGH_RISK_KEYS = new Set([
  "apikey",
  "api-key",
  "api_key",
  "secret",
  "token",
  "password",
  "credential",
  "credentials",
  "authorization",
  "authheader",
  "auth-header",
  "auth_header",
  "cookie",
  "headers",
  "requestheaders",
  "request-headers",
  "request_headers",
  "responseheaders",
  "response-headers",
  "response_headers",
  "privatekey",
  "private-key",
  "private_key",
  "clientkey",
  "client-key",
  "client_key",
  "env",
  "environment",
  "environmentvariables",
  "environment-variables",
  "environment_variables",
  "processenv",
  "process-env",
  "process_env",
  "passenv",
  "pass-env",
  "pass_env",
  "command",
  "commandline",
  "command-line",
  "command_line",
  "shellcommand",
  "shell-command",
  "shell_command",
  "args",
  "stdout",
  "stderr",
  "output",
  "rawoutput",
  "raw-output",
  "raw_output",
  "fulloutput",
  "full-output",
  "full_output",
]);

let reportSequence = 0;
let reports: LocalControlPlaneReport[] = [];
const traceEventListeners = new Set<LocalControlPlaneReportTraceEventListener>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function shouldRedactKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (HIGH_RISK_KEYS.has(normalized)) return true;
  if (normalized.endsWith("env") || normalized.includes("environment")) return true;
  if (normalized.includes("command") || normalized === "cmd") return true;
  if (normalized.includes("header")) return true;
  if (normalized.includes("stdout") || normalized.includes("stderr") || normalized.includes("output")) return true;
  return /(?:api[_-]?key|secret|token|password|credential|authorization|auth[_-]?header|private[_-]?key)$/i.test(key);
}

function redactedValue(value: unknown): string {
  if (Array.isArray(value)) return "[redacted:array]";
  if (isRecord(value)) return "[redacted:object]";
  return "[redacted]";
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_CHARS) return value;
  const omitted = value.length - MAX_STRING_CHARS;
  return `${value.slice(0, MAX_STRING_CHARS)}[truncated ${omitted} chars]`;
}

function sanitizeJsonValue(value: unknown, depth: number): LocalControlPlaneJsonValue | undefined {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[truncated:depth]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((entry) => sanitizeJsonValue(entry, depth + 1) ?? null);
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[truncated ${value.length - MAX_ARRAY_ITEMS} items]`);
    }
    return items;
  }
  if (!isRecord(value)) return String(value);

  const out: LocalControlPlaneJsonObject = {};
  const entries = Object.entries(value);
  for (const [key, entry] of entries.slice(0, MAX_OBJECT_KEYS)) {
    out[key] = shouldRedactKey(key)
      ? redactedValue(entry)
      : sanitizeJsonValue(entry, depth + 1) ?? null;
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    out.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
  }
  return out;
}

function sanitizeJsonObject(value: unknown): LocalControlPlaneJsonObject | undefined {
  const sanitized = sanitizeJsonValue(value, 0);
  return isRecord(sanitized) ? sanitized : undefined;
}

function sanitizeDiagnostics(
  diagnostics: readonly Partial<LocalControlPlaneDiagnostic>[] | undefined,
): LocalControlPlaneDiagnostic[] {
  return (diagnostics ?? []).flatMap((diagnostic, index) => {
    const code = nonEmptyString(diagnostic.code) ?? `diagnostic_${index + 1}`;
    const severity = diagnostic.severity === "warning" || diagnostic.severity === "error"
      ? diagnostic.severity
      : "info";
    const message = nonEmptyString(diagnostic.message) ?? code;
    const metadata = sanitizeJsonObject(diagnostic.metadata);
    return [{
      code,
      severity,
      message: truncateString(message),
      ...(metadata ? { metadata } : {}),
    }];
  });
}

function sanitizeEvidenceRef(ref: EvidenceRef): EvidenceRef | undefined {
  const type = nonEmptyString(ref.type);
  const refValue = nonEmptyString(ref.ref);
  if (!type || !refValue) return undefined;
  const metadata = sanitizeJsonObject(ref.metadata);
  return {
    type: ref.type,
    ref: truncateString(refValue),
    ...(nonEmptyString(ref.label) ? { label: truncateString(nonEmptyString(ref.label)!) } : {}),
    ...(nonEmptyString(ref.summary) ? { summary: truncateString(nonEmptyString(ref.summary)!) } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function sanitizeEvidenceRefs(refs: readonly EvidenceRef[] | undefined): EvidenceRef[] {
  return (refs ?? []).slice(0, MAX_ARRAY_ITEMS).flatMap((ref) => {
    const sanitized = sanitizeEvidenceRef(ref);
    return sanitized ? [sanitized] : [];
  });
}

function normalizeTimestamp(value: string | number | Date | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  return new Date().toISOString();
}

function nextReportId(kind: LocalControlPlaneReportKind): string {
  reportSequence += 1;
  return `lcp_${kind}_${Date.now()}_${reportSequence}`;
}

function emptyCounts(): Record<LocalControlPlaneReportKind, number> {
  return {
    context: 0,
    model_router: 0,
    capability: 0,
    evidence: 0,
    mission: 0,
  };
}

export function isLocalControlPlaneReportKind(value: unknown): value is LocalControlPlaneReportKind {
  return typeof value === "string" && LOCAL_CONTROL_PLANE_REPORT_KINDS.includes(value as LocalControlPlaneReportKind);
}

export function resolveLocalControlPlaneFlags(cfg: OpenClawConfig | undefined): LocalControlPlaneFlags {
  const raw = cfg?.runtime?.localControlPlane;
  if (!isRecord(raw)) return { ...DEFAULT_FLAGS };
  return {
    contextReport: raw.contextReport === true,
    modelRouterReport: raw.modelRouterReport === true,
    capabilityReport: raw.capabilityReport === true,
    evidenceReport: raw.evidenceReport === true,
    missionReport: raw.missionReport === true,
  };
}

export function localControlPlaneReportEnabled(
  cfg: OpenClawConfig | undefined,
  kind: LocalControlPlaneReportKind,
): boolean {
  const flags = resolveLocalControlPlaneFlags(cfg);
  return flags[KIND_TO_FLAG[kind]] === true;
}

export function sanitizeLocalControlPlanePayload(value: unknown): LocalControlPlaneJsonValue | undefined {
  return sanitizeJsonValue(value, 0);
}

export function recordLocalControlPlaneReport(
  cfg: OpenClawConfig | undefined,
  input: LocalControlPlaneReportInput,
): LocalControlPlaneReport | undefined {
  if (!localControlPlaneReportEnabled(cfg, input.kind)) return undefined;
  const payload = sanitizeLocalControlPlanePayload(input.payload);
  const report: LocalControlPlaneReport = {
    schema: LOCAL_CONTROL_PLANE_REPORT_SCHEMA,
    id: nextReportId(input.kind),
    kind: input.kind,
    mode: "observe",
    legacyUnaffected: true,
    timestamp: normalizeTimestamp(input.timestamp),
    ...(nonEmptyString(input.sessionKey) ? { sessionKey: nonEmptyString(input.sessionKey) } : {}),
    ...(nonEmptyString(input.runId) ? { runId: nonEmptyString(input.runId) } : {}),
    ...(nonEmptyString(input.taskId) ? { taskId: nonEmptyString(input.taskId) } : {}),
    summary: truncateString(nonEmptyString(input.summary) ?? `${input.kind} report`),
    diagnostics: sanitizeDiagnostics(input.diagnostics),
    evidenceRefs: sanitizeEvidenceRefs(input.evidenceRefs),
    ...(payload !== undefined ? { payload } : {}),
  };
  reports.push(report);
  if (reports.length > MAX_REPORTS) {
    reports = reports.slice(reports.length - MAX_REPORTS);
  }
  notifyLocalControlPlaneReportTraceEvent(report);
  return report;
}

export function listLocalControlPlaneReports(
  filter: LocalControlPlaneReportFilter = {},
): LocalControlPlaneReport[] {
  const limit = typeof filter.limit === "number" && Number.isFinite(filter.limit)
    ? Math.max(0, Math.min(MAX_REPORTS, Math.floor(filter.limit)))
    : undefined;
  const filtered = reports.filter((report) =>
    (!filter.kind || report.kind === filter.kind)
    && (!filter.sessionKey || report.sessionKey === filter.sessionKey)
    && (!filter.runId || report.runId === filter.runId)
    && (!filter.taskId || report.taskId === filter.taskId)
  );
  return (limit === undefined ? filtered : filtered.slice(-limit)).map(cloneLocalControlPlaneReport);
}

function evidenceRefKey(ref: EvidenceRef): string {
  return `${ref.type}:${ref.ref}`;
}

function matchesEvidenceRef(
  ref: EvidenceRef,
  filter: LocalControlPlaneCorrelationFilter,
): boolean {
  return (!filter.evidenceType || ref.type === filter.evidenceType)
    && (!filter.evidenceRef || ref.ref === filter.evidenceRef || evidenceRefKey(ref) === filter.evidenceRef);
}

function matchesCorrelationEvidenceFilter(
  report: LocalControlPlaneReport,
  filter: LocalControlPlaneCorrelationFilter,
): boolean {
  if (!filter.evidenceType && !filter.evidenceRef) return true;
  return report.evidenceRefs.some((ref) => matchesEvidenceRef(ref, filter));
}

function emptyDiagnosticsBySeverity(): Record<LocalControlPlaneDiagnosticSeverity, number> {
  return { info: 0, warning: 0, error: 0 };
}

export function projectLocalControlPlaneReportTraceEvent(
  report: LocalControlPlaneReport,
): LocalControlPlaneReportTraceEvent {
  const diagnosticsBySeverity = emptyDiagnosticsBySeverity();
  const diagnosticCodes: string[] = [];
  for (const diagnostic of report.diagnostics) {
    diagnosticsBySeverity[diagnostic.severity] += 1;
    if (!diagnosticCodes.includes(diagnostic.code)) {
      diagnosticCodes.push(diagnostic.code);
    }
  }
  return {
    type: "local_control_plane.report",
    name: `${report.kind}: ${report.summary}`,
    timestamp: report.timestamp,
    attributes: {
      reportId: report.id,
      kind: report.kind,
      mode: report.mode,
      legacyUnaffected: report.legacyUnaffected,
      ...(report.sessionKey ? { sessionKey: report.sessionKey } : {}),
      ...(report.runId ? { runId: report.runId } : {}),
      ...(report.taskId ? { taskId: report.taskId } : {}),
      summary: report.summary,
      diagnosticCount: report.diagnostics.length,
      diagnosticsBySeverity,
      diagnosticCodes,
      evidenceRefCount: report.evidenceRefs.length,
      evidenceRefTypes: [...new Set(report.evidenceRefs.map((ref) => ref.type))],
      payloadOmitted: true,
      durableTaskState: false,
      reportStorage: "bounded_in_memory",
    },
  };
}

export function subscribeLocalControlPlaneReportTraceEvents(
  listener: LocalControlPlaneReportTraceEventListener,
): () => void {
  traceEventListeners.add(listener);
  return () => {
    traceEventListeners.delete(listener);
  };
}

function notifyLocalControlPlaneReportTraceEvent(report: LocalControlPlaneReport): void {
  if (traceEventListeners.size === 0) return;
  const event = projectLocalControlPlaneReportTraceEvent(report);
  for (const listener of traceEventListeners) {
    try {
      listener(event);
    } catch {
      // Observability projection must never affect report recording.
    }
  }
}

function addReportToCorrelationGroup(
  group: LocalControlPlaneCorrelationGroup,
  report: LocalControlPlaneReport,
  evidenceRefs: readonly EvidenceRef[] = report.evidenceRefs,
): void {
  group.reportIds.push(report.id);
  if (!group.kinds.includes(report.kind)) group.kinds.push(report.kind);
  group.reportCount += 1;
  if (report.timestamp < group.firstReportAt) group.firstReportAt = report.timestamp;
  if (report.timestamp > group.lastReportAt) group.lastReportAt = report.timestamp;
  for (const diagnostic of report.diagnostics) {
    group.diagnosticsBySeverity[diagnostic.severity] += 1;
    if (!group.diagnosticCodes.includes(diagnostic.code)) {
      group.diagnosticCodes.push(diagnostic.code);
    }
  }
  const existingEvidenceKeys = new Set(group.evidenceRefs.map(evidenceRefKey));
  for (const ref of evidenceRefs) {
    const key = evidenceRefKey(ref);
    if (!existingEvidenceKeys.has(key)) {
      group.evidenceRefs.push(cloneEvidenceRef(ref));
      existingEvidenceKeys.add(key);
    }
  }
}

function cloneEvidenceRef(ref: EvidenceRef): EvidenceRef {
  return {
    ...ref,
    ...(ref.metadata ? { metadata: cloneJsonObject(ref.metadata as LocalControlPlaneJsonObject) } : {}),
  };
}

function correlationKeyForReport(
  report: LocalControlPlaneReport,
  groupBy: LocalControlPlaneCorrelationGroupBy,
): string {
  if (groupBy === "session") return `session:${report.sessionKey ?? "unknown"}`;
  if (groupBy === "run") return `run:${report.runId ?? report.taskId ?? report.sessionKey ?? "unknown"}`;
  if (groupBy === "task") return `task:${report.taskId ?? report.runId ?? report.sessionKey ?? "unknown"}`;
  return "evidence:none";
}

function createCorrelationGroup(
  key: string,
  groupBy: LocalControlPlaneCorrelationGroupBy,
  report: LocalControlPlaneReport,
  evidenceRefs: EvidenceRef[] = report.evidenceRefs,
): LocalControlPlaneCorrelationGroup {
  return {
    key,
    groupBy,
    ...(report.sessionKey ? { sessionKey: report.sessionKey } : {}),
    ...(report.runId ? { runId: report.runId } : {}),
    ...(report.taskId ? { taskId: report.taskId } : {}),
    evidenceRefs: evidenceRefs.map(cloneEvidenceRef),
    reportIds: [],
    kinds: [],
    reportCount: 0,
    firstReportAt: report.timestamp,
    lastReportAt: report.timestamp,
    diagnosticsBySeverity: emptyDiagnosticsBySeverity(),
    diagnosticCodes: [],
  };
}

export function listLocalControlPlaneCorrelations(
  filter: LocalControlPlaneCorrelationFilter = {},
): LocalControlPlaneCorrelationSummary {
  const groupBy = filter.groupBy ?? "task";
  const reports = listLocalControlPlaneReports(filter)
    .filter((report) => matchesCorrelationEvidenceFilter(report, filter));
  const groupsByKey = new Map<string, LocalControlPlaneCorrelationGroup>();

  for (const report of reports) {
    if (groupBy === "evidence") {
      const refs = filter.evidenceType || filter.evidenceRef
        ? report.evidenceRefs.filter((ref) => matchesEvidenceRef(ref, filter))
        : report.evidenceRefs;
      if (!refs.length) {
        const key = "evidence:none";
        const group = groupsByKey.get(key) ?? createCorrelationGroup(key, groupBy, report, []);
        addReportToCorrelationGroup(group, report);
        groupsByKey.set(key, group);
        continue;
      }
      for (const ref of refs) {
        const key = `evidence:${evidenceRefKey(ref)}`;
        const group = groupsByKey.get(key) ?? createCorrelationGroup(key, groupBy, report, [ref]);
        addReportToCorrelationGroup(group, report, [ref]);
        groupsByKey.set(key, group);
      }
      continue;
    }

    const key = correlationKeyForReport(report, groupBy);
    const group = groupsByKey.get(key) ?? createCorrelationGroup(key, groupBy, report);
    addReportToCorrelationGroup(group, report);
    groupsByKey.set(key, group);
  }

  const groups = [...groupsByKey.values()].sort((left, right) =>
    right.lastReportAt.localeCompare(left.lastReportAt) || left.key.localeCompare(right.key)
  );
  const evidenceKeys = new Set(groups.flatMap((group) => group.evidenceRefs.map(evidenceRefKey)));
  return {
    schema: "openclaw.local-control-plane.correlations.v1",
    mode: "observe",
    legacyUnaffected: true,
    generatedAt: new Date().toISOString(),
    filter: { ...filter, groupBy },
    totals: {
      reportCount: reports.length,
      groupCount: groups.length,
      evidenceRefCount: evidenceKeys.size,
    },
    groups,
  };
}

export function getLocalControlPlaneStatus(cfg: OpenClawConfig | undefined): LocalControlPlaneStatus {
  const flags = resolveLocalControlPlaneFlags(cfg);
  const countsByKind = emptyCounts();
  for (const report of reports) {
    countsByKind[report.kind] += 1;
  }
  return {
    schema: "openclaw.local-control-plane.status.v1",
    mode: "observe",
    legacyUnaffected: true,
    flags,
    enabledKinds: LOCAL_CONTROL_PLANE_REPORT_KINDS.filter((kind) => flags[KIND_TO_FLAG[kind]]),
    buffer: {
      size: reports.length,
      maxSize: MAX_REPORTS,
      lastReportAt: reports.at(-1)?.timestamp ?? null,
    },
    countsByKind,
  };
}

function cloneJsonValue(value: LocalControlPlaneJsonValue): LocalControlPlaneJsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]),
  );
}

function cloneJsonObject(value: LocalControlPlaneJsonObject): LocalControlPlaneJsonObject {
  return cloneJsonValue(value) as LocalControlPlaneJsonObject;
}

function cloneLocalControlPlaneReport(report: LocalControlPlaneReport): LocalControlPlaneReport {
  return {
    ...report,
    diagnostics: report.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      ...(diagnostic.metadata ? { metadata: cloneJsonObject(diagnostic.metadata) } : {}),
    })),
    evidenceRefs: report.evidenceRefs.map((ref) => ({
      ...ref,
      ...(ref.metadata ? { metadata: cloneJsonObject(ref.metadata as LocalControlPlaneJsonObject) } : {}),
    })),
    ...(report.payload !== undefined ? { payload: cloneJsonValue(report.payload) } : {}),
  };
}

export function clearLocalControlPlaneReportsForTests(): void {
  reports = [];
  reportSequence = 0;
  traceEventListeners.clear();
}
