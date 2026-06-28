import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { storeRuntimeTrace } from "../observability/trace-buffer.js";
import type { ObservabilityTrace } from "../observability/types.js";
import { isEvidenceRefType } from "../runtime-core/index.js";
import {
  deserializeRuntimeCheckpoint,
  evaluateEvidenceVerifier,
  isRuntimeTaskEvent,
  replayRuntimeTaskEvents,
  resolveRuntimeEventLogFeatureFlags,
  setRuntimeVerificationShadowSink,
} from "../runtime-core/index.js";
import type {
  EvidenceVerifierDecision,
  EvidenceVerifierEvidenceKind,
  EvidenceVerifierFindingCategory,
  RuntimeCoreJsonObject,
  RuntimeCoreJsonValue,
  RuntimeErrorType,
  RuntimeTraceContext,
  EvidenceRefType,
  RuntimeVerificationShadowSampleSource,
  RuntimeVerificationShadowSampleTrigger,
  ToolCallRequest,
  ToolCallResult,
  ToolCallResultStatus,
} from "../runtime-core/index.js";

export type SecurityShadowDecision = "allow" | "warn" | "would_require_approval" | "would_block";
export type SecurityShadowSeverity = "info" | "low" | "medium" | "high";
export type VerificationShadowStatus = "passed" | "warning" | "failed" | "insufficient_evidence";
export type SecurityVerificationShadowHealthLevel = "healthy" | "degraded" | "failing";
export type SecurityVerificationShadowSamplingMode = "manual" | "auto";
export type ShadowRecordSource = "tools.invoke" | "security.policy.simulate" | "verification.run";
export type ShadowRecordSubject = "tool_call" | "event_log" | "checkpoint";

export type SecurityShadowFinding = {
  code: string;
  message: string;
  severity: SecurityShadowSeverity;
};

export type SecurityShadowEvaluation = {
  decision: SecurityShadowDecision;
  severity: SecurityShadowSeverity;
  findings: SecurityShadowFinding[];
};

export type VerificationShadowFinding = {
  code: string;
  message: string;
  severity: SecurityShadowSeverity;
};

export type VerificationShadowEvaluation = {
  status: VerificationShadowStatus;
  findings: VerificationShadowFinding[];
};

export type EvidenceVerifierDecisionSummary = {
  decision: EvidenceVerifierDecision;
  findingCount: number;
  evidenceRefCount: number;
  requiredEvidenceKinds: EvidenceVerifierEvidenceKind[];
  findingCodes: string[];
  findingCategories: EvidenceVerifierFindingCategory[];
  legacyDecisionUnaffected: true;
};

export type SanitizedToolCallRequest = {
  callId: string;
  taskId: string;
  toolName: string;
  argKeys: string[];
  argKeyCount: number;
  sensitiveArgKeyCount: number;
  hasPermissionContext: boolean;
  traceId?: string;
  spanId?: string;
};

export type SanitizedToolCallResult = {
  callId: string;
  status: ToolCallResultStatus;
  contextItemCount: number;
  evidenceCount: number;
  structuredDataType?: string;
  errorType?: RuntimeErrorType;
  hasErrorMessage: boolean;
};

export type SanitizedRuntimeEventLog = {
  eventCount: number;
  validEventCount: number;
  taskIds: string[];
  traceIds: string[];
  firstEventKind?: string;
  lastEventKind?: string;
  replayState: string;
  replayStatus: string;
  toolRequestCount: number;
  toolResultCount: number;
  pendingToolCallCount: number;
  checkpointCount: number;
  evidenceRefCount: number;
  duplicateEventCount: number;
  diagnosticCount: number;
  diagnosticCodes: string[];
};

export type SanitizedRuntimeCheckpoint = {
  checkpointId?: string;
  taskId?: string;
  state?: string;
  toolResultCount: number;
  evidenceRefCount: number;
  openObligationCount: number;
  fileHashCount: number;
  diagnosticCount: number;
  diagnosticCodes: string[];
  schemaMarker?: string;
};

export type SecurityVerificationShadowSampling = {
  mode: SecurityVerificationShadowSamplingMode;
  trigger: RuntimeVerificationShadowSampleTrigger;
};

export type SecurityVerificationShadowRecord = {
  id: string;
  runId: string;
  subject: ShadowRecordSubject;
  source: ShadowRecordSource;
  sampling: SecurityVerificationShadowSampling;
  createdAt: number;
  request?: SanitizedToolCallRequest;
  result?: SanitizedToolCallResult;
  eventLog?: SanitizedRuntimeEventLog;
  checkpoint?: SanitizedRuntimeCheckpoint;
  security: SecurityShadowEvaluation;
  verification: VerificationShadowEvaluation;
  evidenceVerifier?: EvidenceVerifierDecisionSummary;
  observabilityTraceId?: string;
};

export type SecurityVerificationShadowRecordFilter = {
  limit?: number;
  runId?: string;
  source?: ShadowRecordSource;
  subject?: ShadowRecordSubject;
  securityDecision?: SecurityShadowDecision;
  verificationStatus?: VerificationShadowStatus;
  verifierDecision?: EvidenceVerifierDecision;
};

export type SecurityVerificationShadowSummary = {
  totalRecords: number;
  healthLevel: SecurityVerificationShadowHealthLevel;
  securityDecisionCounts: Record<SecurityShadowDecision, number>;
  verificationStatusCounts: Record<VerificationShadowStatus, number>;
  evidenceVerifierDecisionCounts: Record<EvidenceVerifierDecision, number>;
  sourceCounts: Record<ShadowRecordSource, number>;
  subjectCounts: Record<ShadowRecordSubject, number>;
  samplingModeCounts: Record<SecurityVerificationShadowSamplingMode, number>;
  findingCounts: {
    security: number;
    verification: number;
    evidenceVerifier: number;
  };
  recentFindingCodes: string[];
  latestRunId: string | null;
  latestRecordAt: number | null;
};

const MAX_SHADOW_RECORDS = 100;
const shadowRecords: SecurityVerificationShadowRecord[] = [];

const DANGEROUS_COMMAND_PATTERN =
  /\b(rm\s+.*(-r|-f)|remove-item\b.*(-recurse|-force)|git\s+(reset|clean)\b|format\s+[a-z]:|diskpart|shutdown|restart-computer)\b/i;
const APPROVAL_TOOL_PATTERN = /\b(exec|shell|bash|terminal|command|run)\b/i;
const WARN_TOOL_PATTERN = /\b(write|edit|patch|apply|delete|remove|rename|move|browser|web|fetch|search)\b/i;
const SENSITIVE_ARG_KEY_PATTERN = /\b(secret|token|password|credential|apikey|api_key|authorization|cookie)\b/i;

function normalizeToolNameForPolicy(toolName: string): string {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._:-]+/g, " ");
}

function isSensitiveArgKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._:-]+/g, " ");
  return SENSITIVE_ARG_KEY_PATTERN.test(key) || SENSITIVE_ARG_KEY_PATTERN.test(normalized);
}

function normalizeEvidenceRefType(value: unknown): EvidenceRefType {
  return isEvidenceRefType(value) ? value : "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeMetadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 256) : undefined;
}

function normalizeSampling(params: {
  source: ShadowRecordSource;
  sampling?: Partial<SecurityVerificationShadowSampling>;
}): SecurityVerificationShadowSampling {
  const trigger = params.sampling?.trigger ??
    (params.source === "tools.invoke" ? "tools-invoke" : "gateway-rpc");
  const mode = params.sampling?.mode ?? (trigger === "gateway-rpc" || trigger === "tools-invoke" ? "manual" : "auto");
  return { mode, trigger };
}

function zeroSecurityDecisionCounts(): Record<SecurityShadowDecision, number> {
  return {
    allow: 0,
    warn: 0,
    would_require_approval: 0,
    would_block: 0,
  };
}

function zeroVerificationStatusCounts(): Record<VerificationShadowStatus, number> {
  return {
    passed: 0,
    warning: 0,
    failed: 0,
    insufficient_evidence: 0,
  };
}

function zeroEvidenceVerifierDecisionCounts(): Record<EvidenceVerifierDecision, number> {
  return {
    completed: 0,
    failed: 0,
    blocked: 0,
    cancelled: 0,
    insufficient_evidence: 0,
  };
}

function zeroSourceCounts(): Record<ShadowRecordSource, number> {
  return {
    "tools.invoke": 0,
    "security.policy.simulate": 0,
    "verification.run": 0,
  };
}

function zeroSubjectCounts(): Record<ShadowRecordSubject, number> {
  return {
    tool_call: 0,
    event_log: 0,
    checkpoint: 0,
  };
}

function zeroSamplingModeCounts(): Record<SecurityVerificationShadowSamplingMode, number> {
  return {
    manual: 0,
    auto: 0,
  };
}

export function resolveSecurityVerificationShadowHealthLevel(
  summary: Pick<SecurityVerificationShadowSummary, "securityDecisionCounts" | "verificationStatusCounts"> &
    Partial<Pick<SecurityVerificationShadowSummary, "evidenceVerifierDecisionCounts">>,
): SecurityVerificationShadowHealthLevel {
  const verifierCounts = summary.evidenceVerifierDecisionCounts;
  if (summary.verificationStatusCounts.failed > 0 || (verifierCounts?.failed ?? 0) > 0) {
    return "failing";
  }
  if (
    summary.securityDecisionCounts.would_block > 0 ||
    summary.verificationStatusCounts.insufficient_evidence > 0 ||
    (verifierCounts?.blocked ?? 0) > 0 ||
    (verifierCounts?.cancelled ?? 0) > 0 ||
    (verifierCounts?.insufficient_evidence ?? 0) > 0
  ) {
    return "degraded";
  }
  return "healthy";
}

function isShadowRecordSource(value: unknown): value is ShadowRecordSource {
  return value === "tools.invoke" || value === "security.policy.simulate" || value === "verification.run";
}

function isShadowRecordSubject(value: unknown): value is ShadowRecordSubject {
  return value === "tool_call" || value === "event_log" || value === "checkpoint";
}

function isSecurityShadowDecision(value: unknown): value is SecurityShadowDecision {
  return value === "allow" || value === "warn" || value === "would_require_approval" || value === "would_block";
}

function isVerificationShadowStatus(value: unknown): value is VerificationShadowStatus {
  return value === "passed" || value === "warning" || value === "failed" || value === "insufficient_evidence";
}

function isEvidenceVerifierDecisionValue(value: unknown): value is EvidenceVerifierDecision {
  return value === "completed" || value === "failed" || value === "blocked" || value === "cancelled" ||
    value === "insufficient_evidence";
}

function normalizeRecordFilter(
  filterOrLimit: number | SecurityVerificationShadowRecordFilter | undefined,
): Required<Pick<SecurityVerificationShadowRecordFilter, "limit">> &
  Omit<SecurityVerificationShadowRecordFilter, "limit"> {
  if (typeof filterOrLimit === "number" && Number.isFinite(filterOrLimit)) {
    return { limit: Math.max(0, Math.min(MAX_SHADOW_RECORDS, Math.floor(filterOrLimit))) };
  }
  const filter = isRecord(filterOrLimit) ? filterOrLimit : {};
  return {
    limit: typeof filter.limit === "number" && Number.isFinite(filter.limit)
      ? Math.max(0, Math.min(MAX_SHADOW_RECORDS, Math.floor(filter.limit)))
      : MAX_SHADOW_RECORDS,
    ...(normalizeMetadataString(filter.runId) ? { runId: normalizeMetadataString(filter.runId) } : {}),
    ...(isShadowRecordSource(filter.source) ? { source: filter.source } : {}),
    ...(isShadowRecordSubject(filter.subject) ? { subject: filter.subject } : {}),
    ...(isSecurityShadowDecision(filter.securityDecision) ? { securityDecision: filter.securityDecision } : {}),
    ...(isVerificationShadowStatus(filter.verificationStatus) ? { verificationStatus: filter.verificationStatus } : {}),
    ...(isEvidenceVerifierDecisionValue(filter.verifierDecision) ? { verifierDecision: filter.verifierDecision } : {}),
  };
}

function uniqueStrings(values: readonly string[], limit = 20): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0))).slice(0, limit);
}

function diagnosticSeverity(code: string): SecurityShadowSeverity {
  return code === "terminal_event_continuation" ? "medium" : "high";
}

function verificationFromDiagnosticCodes(params: {
  missingCode: string;
  missingMessage: string;
  diagnosticCodes: string[];
}): VerificationShadowEvaluation {
  if (params.diagnosticCodes.length === 0) {
    return { status: "passed", findings: [] };
  }
  const findings = params.diagnosticCodes.map((code) => ({
    code,
    message: `Runtime verification diagnostic: ${code}.`,
    severity: diagnosticSeverity(code),
  }));
  const severity = maxSeverity(findings);
  return {
    status: severity === "high" ? "failed" : "warning",
    findings,
  };
}

function missingVerification(code: string, message: string): VerificationShadowEvaluation {
  return {
    status: "insufficient_evidence",
    findings: [{ code, message, severity: "medium" }],
  };
}

function summarizeEvidenceVerifierDecision(input: unknown): EvidenceVerifierDecisionSummary {
  const report = evaluateEvidenceVerifier(input);
  return {
    decision: report.decision,
    findingCount: report.findings.length,
    evidenceRefCount: report.evidenceRefs.length,
    requiredEvidenceKinds: [...report.requiredEvidenceKinds],
    findingCodes: uniqueStrings(report.findings.map((finding) => finding.code)),
    findingCategories: uniqueStrings(report.findings.map((finding) => finding.category))
      .filter((category): category is EvidenceVerifierFindingCategory => typeof category === "string"),
    legacyDecisionUnaffected: true,
  };
}

function toJsonValue(value: unknown): RuntimeCoreJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (isRecord(value)) return toJsonObject(value);
  return null;
}

function toJsonObject(value: Record<string, unknown>): RuntimeCoreJsonObject {
  const output: RuntimeCoreJsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
    output[key] = toJsonValue(item);
  }
  return output;
}

function structuredDataType(value: RuntimeCoreJsonValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function maxSeverity(findings: Array<{ severity: SecurityShadowSeverity }>): SecurityShadowSeverity {
  if (findings.some((finding) => finding.severity === "high")) return "high";
  if (findings.some((finding) => finding.severity === "medium")) return "medium";
  if (findings.some((finding) => finding.severity === "low")) return "low";
  return "info";
}

export function isSecurityVerificationShadowEnabled(cfg?: OpenClawConfig): boolean {
  if (process.env.OPENCLAW_SECURITY_VERIFICATION_SHADOW === "1") return true;
  const security = cfg?.security as (OpenClawConfig["security"] & {
    validationShadow?: { enabled?: boolean };
  }) | undefined;
  return security?.validationShadow?.enabled === true;
}

export function isRuntimeVerificationAutoSamplingEnabled(
  cfg: OpenClawConfig | undefined,
  subject: Extract<ShadowRecordSubject, "event_log" | "checkpoint">,
): boolean {
  const flags = resolveRuntimeEventLogFeatureFlags(cfg);
  return subject === "event_log"
    ? flags.eventLogShadow === true
    : flags.checkpointSerializerShadow === true;
}

export function sampleRuntimeEventLogVerification(params: {
  cfg?: OpenClawConfig;
  enabled?: boolean;
  events: unknown;
  runId?: string;
  source?: RuntimeVerificationShadowSampleSource;
  trigger?: RuntimeVerificationShadowSampleTrigger;
  storeTrace?: boolean;
}): SecurityVerificationShadowRecord | undefined {
  const enabled = params.enabled ?? isRuntimeVerificationAutoSamplingEnabled(params.cfg, "event_log");
  if (!enabled) return undefined;
  return recordSecurityVerificationShadow({
    source: params.source ?? "verification.run",
    events: params.events,
    ...(params.runId ? { runId: params.runId } : {}),
    sampling: { mode: "auto", trigger: params.trigger ?? "event-log-append" },
    storeTrace: params.storeTrace,
  });
}

export function sampleRuntimeCheckpointVerification(params: {
  cfg?: OpenClawConfig;
  enabled?: boolean;
  checkpoint: unknown;
  runId?: string;
  source?: RuntimeVerificationShadowSampleSource;
  trigger?: RuntimeVerificationShadowSampleTrigger;
  storeTrace?: boolean;
}): SecurityVerificationShadowRecord | undefined {
  const enabled = params.enabled ?? isRuntimeVerificationAutoSamplingEnabled(params.cfg, "checkpoint");
  if (!enabled) return undefined;
  return recordSecurityVerificationShadow({
    source: params.source ?? "verification.run",
    checkpoint: params.checkpoint,
    ...(params.runId ? { runId: params.runId } : {}),
    sampling: { mode: "auto", trigger: params.trigger ?? "checkpoint-serialize" },
    storeTrace: params.storeTrace,
  });
}

export function sanitizeToolCallRequest(request: ToolCallRequest): SanitizedToolCallRequest {
  const argKeys = Object.keys(request.args).sort();
  return {
    callId: request.callId,
    taskId: request.taskId,
    toolName: request.toolName,
    argKeys,
    argKeyCount: argKeys.length,
    sensitiveArgKeyCount: argKeys.filter(isSensitiveArgKey).length,
    hasPermissionContext: request.permissionContext !== undefined,
    ...(request.traceContext?.traceId ? { traceId: request.traceContext.traceId } : {}),
    ...(request.traceContext?.spanId ? { spanId: request.traceContext.spanId } : {}),
  };
}

export function sanitizeToolCallResult(result: ToolCallResult): SanitizedToolCallResult {
  return {
    callId: result.callId,
    status: result.status,
    contextItemCount: result.contextItems.length,
    evidenceCount: result.evidence.length,
    structuredDataType: structuredDataType(result.structuredData),
    ...(result.error?.type ? { errorType: result.error.type } : {}),
    hasErrorMessage: Boolean(result.error?.message),
  };
}

export function evaluateSecurityShadow(
  request: ToolCallRequest,
  result?: ToolCallResult,
): SecurityShadowEvaluation {
  const findings: SecurityShadowFinding[] = [];
  const command = typeof request.args.command === "string" ? request.args.command : "";
  const normalizedToolName = normalizeToolNameForPolicy(request.toolName);

  if (command && DANGEROUS_COMMAND_PATTERN.test(command)) {
    findings.push({
      code: "dangerous-command-pattern",
      message: "Tool arguments contain a command pattern that would be blocked by active policy.",
      severity: "high",
    });
  }
  if (result?.status === "denied") {
    findings.push({
      code: "tool-result-denied",
      message: "Tool execution was denied by the legacy path.",
      severity: "high",
    });
  }
  if (APPROVAL_TOOL_PATTERN.test(normalizedToolName)) {
    findings.push({
      code: "approval-class-tool",
      message: "Tool family would require approval in active policy.",
      severity: "medium",
    });
  }
  if (WARN_TOOL_PATTERN.test(normalizedToolName)) {
    findings.push({
      code: "mutating-or-network-tool",
      message: "Tool family is mutating or network-capable and should stay visible in review surfaces.",
      severity: "low",
    });
  }
  if (Object.keys(request.args).some(isSensitiveArgKey)) {
    findings.push({
      code: "sensitive-argument-key",
      message: "Tool arguments include sensitive-looking keys; only key names are retained.",
      severity: "low",
    });
  }

  const severity = maxSeverity(findings);
  const decision: SecurityShadowDecision = findings.some((finding) => finding.severity === "high")
    ? "would_block"
    : findings.some((finding) => finding.code === "approval-class-tool")
      ? "would_require_approval"
      : findings.length > 0
        ? "warn"
        : "allow";

  return { decision, severity, findings };
}

export function evaluateVerificationShadow(
  request: ToolCallRequest,
  result?: ToolCallResult,
): VerificationShadowEvaluation {
  const findings: VerificationShadowFinding[] = [];

  if (!result) {
    findings.push({
      code: "result-missing",
      message: "No tool result was available for deterministic verification.",
      severity: "medium",
    });
  } else if (result.status === "error" || result.status === "denied") {
    findings.push({
      code: `tool-result-${result.status}`,
      message: "Tool result is not successful.",
      severity: "high",
    });
  } else if (result.status === "cancelled") {
    findings.push({
      code: "tool-result-cancelled",
      message: "Tool result was cancelled before completion.",
      severity: "medium",
    });
  }

  if (!request.traceContext?.traceId) {
    findings.push({
      code: "trace-context-missing",
      message: "Tool call is missing trace context.",
      severity: "low",
    });
  }
  if (result && result.evidence.length === 0) {
    findings.push({
      code: "evidence-missing",
      message: "Tool result did not include evidence refs.",
      severity: "medium",
    });
  }

  const severity = maxSeverity(findings);
  const status: VerificationShadowStatus = severity === "high"
    ? "failed"
    : findings.some((finding) => finding.code === "result-missing" || finding.code === "evidence-missing")
      ? "insufficient_evidence"
      : findings.length > 0
        ? "warning"
        : "passed";

  return { status, findings };
}

export function evaluateRuntimeEventLogShadow(events: unknown): {
  eventLog: SanitizedRuntimeEventLog;
  verification: VerificationShadowEvaluation;
} {
  const eventEntries = Array.isArray(events) ? events : [];
  if (eventEntries.length === 0) {
    return {
      eventLog: {
        eventCount: 0,
        validEventCount: 0,
        taskIds: [],
        traceIds: [],
        replayState: "created",
        replayStatus: "created",
        toolRequestCount: 0,
        toolResultCount: 0,
        pendingToolCallCount: 0,
        checkpointCount: 0,
        evidenceRefCount: 0,
        duplicateEventCount: 0,
        diagnosticCount: 1,
        diagnosticCodes: ["event-log-missing"],
      },
      verification: missingVerification(
        "event-log-missing",
        "No runtime task events were provided for deterministic verification.",
      ),
    };
  }

  const replay = replayRuntimeTaskEvents(eventEntries);
  const validEvents = eventEntries.filter(isRuntimeTaskEvent);
  const diagnosticCodes = replay.diagnostics.map((diagnostic) => diagnostic.code);
  return {
    eventLog: {
      eventCount: eventEntries.length,
      validEventCount: validEvents.length,
      taskIds: uniqueStrings(validEvents.map((event) => event.taskId)),
      traceIds: uniqueStrings(validEvents.flatMap((event) => event.traceContext?.traceId ? [event.traceContext.traceId] : [])),
      ...(validEvents[0]?.kind ? { firstEventKind: validEvents[0].kind } : {}),
      ...(validEvents.at(-1)?.kind ? { lastEventKind: validEvents.at(-1)?.kind } : {}),
      replayState: replay.state.state,
      replayStatus: replay.state.status,
      toolRequestCount: replay.state.toolRequests.length,
      toolResultCount: replay.state.toolResults.length,
      pendingToolCallCount: replay.state.pendingToolCallIds.length,
      checkpointCount: replay.state.checkpoints.length,
      evidenceRefCount: replay.state.evidenceRefs.length,
      duplicateEventCount: replay.state.duplicateEventIds.length,
      diagnosticCount: replay.diagnostics.length,
      diagnosticCodes: uniqueStrings(diagnosticCodes),
    },
    verification: verificationFromDiagnosticCodes({
      missingCode: "event-log-missing",
      missingMessage: "No runtime task events were provided for deterministic verification.",
      diagnosticCodes: uniqueStrings(diagnosticCodes),
    }),
  };
}

export function evaluateRuntimeCheckpointShadow(checkpoint: unknown): {
  checkpoint: SanitizedRuntimeCheckpoint;
  verification: VerificationShadowEvaluation;
} {
  if (checkpoint === undefined || checkpoint === null) {
    return {
      checkpoint: {
        toolResultCount: 0,
        evidenceRefCount: 0,
        openObligationCount: 0,
        fileHashCount: 0,
        diagnosticCount: 1,
        diagnosticCodes: ["checkpoint-missing"],
      },
      verification: missingVerification(
        "checkpoint-missing",
        "No runtime checkpoint was provided for deterministic verification.",
      ),
    };
  }

  const deserialized = deserializeRuntimeCheckpoint(checkpoint);
  const diagnosticCodes = uniqueStrings(deserialized.diagnostics.map((diagnostic) => diagnostic.code));
  const snapshot = deserialized.snapshot;
  const canonicalCheckpoint = deserialized.checkpoint;
  const source = snapshot?.checkpoint ?? canonicalCheckpoint;
  return {
    checkpoint: {
      ...(source?.checkpointId ? { checkpointId: source.checkpointId } : {}),
      ...(source?.taskId ? { taskId: source.taskId } : {}),
      ...(source?.state ? { state: source.state } : {}),
      toolResultCount: source?.toolResults.length ?? 0,
      evidenceRefCount: source?.evidenceRefs.length ?? 0,
      openObligationCount: source?.openObligations.length ?? 0,
      fileHashCount: source ? Object.keys(source.fileHashes).length : 0,
      diagnosticCount: deserialized.diagnostics.length,
      diagnosticCodes,
      ...(snapshot?.schemaMarker ? { schemaMarker: snapshot.schemaMarker } : {}),
    },
    verification: checkpoint === undefined || checkpoint === null
      ? missingVerification("checkpoint-missing", "No runtime checkpoint was provided for deterministic verification.")
      : verificationFromDiagnosticCodes({
          missingCode: "checkpoint-missing",
          missingMessage: "No runtime checkpoint was provided for deterministic verification.",
          diagnosticCodes,
        }),
  };
}

function recordToTrace(record: SecurityVerificationShadowRecord): ObservabilityTrace {
  const startedAt = record.createdAt;
  const traceId = `shadow_${record.id}`;
  const baseAttributes = {
    shadowRecordId: record.id,
    runId: record.runId,
    subject: record.subject,
    source: record.source,
    samplingMode: record.sampling.mode,
    samplingTrigger: record.sampling.trigger,
    toolName: record.request?.toolName,
    callId: record.request?.callId,
    originalTraceId: record.request?.traceId,
  };
  return {
    id: traceId,
    name: "Security verification shadow",
    mode: "shadow",
    status: "completed",
    startedAt,
    endedAt: startedAt,
    durationMs: 0,
    spans: [
      {
        id: `${traceId}_security`,
        traceId,
        name: "Security shadow evaluation",
        kind: "security-intercept",
        status: "completed",
        startedAt,
        endedAt: startedAt,
        durationMs: 0,
        metrics: { findingCount: record.security.findings.length },
        attributes: {
          ...baseAttributes,
          decision: record.security.decision,
          severity: record.security.severity,
          findingCodes: record.security.findings.map((finding) => finding.code),
        },
      },
      {
        id: `${traceId}_verification`,
        traceId,
        name: "Verification shadow evaluation",
        kind: "verification",
        status: "completed",
        startedAt,
        endedAt: startedAt,
        durationMs: 0,
        metrics: { findingCount: record.verification.findings.length },
        attributes: {
          ...baseAttributes,
          verificationStatus: record.verification.status,
          evidenceVerifierDecision: record.evidenceVerifier?.decision,
          findingCodes: record.verification.findings.map((finding) => finding.code),
        },
      },
    ],
    events: [],
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 },
    metrics: {
      securityFindingCount: record.security.findings.length,
      verificationFindingCount: record.verification.findings.length,
      evidenceVerifierFindingCount: record.evidenceVerifier?.findingCount ?? 0,
    },
    tags: ["security-verification-shadow"],
  };
}

export function recordSecurityVerificationShadow(params: {
  source: ShadowRecordSource;
  request?: ToolCallRequest;
  result?: ToolCallResult;
  events?: unknown;
  checkpoint?: unknown;
  evidenceVerifier?: unknown;
  runId?: string;
  sampling?: Partial<SecurityVerificationShadowSampling>;
  storeTrace?: boolean;
}): SecurityVerificationShadowRecord {
  const eventLogEvaluation = params.events !== undefined ? evaluateRuntimeEventLogShadow(params.events) : undefined;
  const checkpointEvaluation = params.checkpoint !== undefined
    ? evaluateRuntimeCheckpointShadow(params.checkpoint)
    : undefined;
  const subject: ShadowRecordSubject = eventLogEvaluation
    ? "event_log"
    : checkpointEvaluation
      ? "checkpoint"
      : "tool_call";
  const runId = normalizeMetadataString(params.runId) ?? normalizeMetadataString(params.request?.traceContext?.traceId) ??
    `svr_${randomUUID()}`;
  const security = params.request
    ? evaluateSecurityShadow(params.request, params.result)
    : { decision: "allow" as const, severity: "info" as const, findings: [] };
  const verification = eventLogEvaluation?.verification ?? checkpointEvaluation?.verification ??
    (params.request
      ? evaluateVerificationShadow(params.request, params.result)
      : missingVerification("tool-call-request-missing", "No tool call request was available for verification."));
  const evidenceVerifier = params.evidenceVerifier === undefined
    ? undefined
    : summarizeEvidenceVerifierDecision(params.evidenceVerifier);
  const record: SecurityVerificationShadowRecord = {
    id: `svs_${randomUUID()}`,
    runId,
    subject,
    source: params.source,
    sampling: normalizeSampling({ source: params.source, sampling: params.sampling }),
    createdAt: Date.now(),
    ...(params.request ? { request: sanitizeToolCallRequest(params.request) } : {}),
    ...(params.result ? { result: sanitizeToolCallResult(params.result) } : {}),
    ...(eventLogEvaluation ? { eventLog: eventLogEvaluation.eventLog } : {}),
    ...(checkpointEvaluation ? { checkpoint: checkpointEvaluation.checkpoint } : {}),
    security,
    verification,
    ...(evidenceVerifier ? { evidenceVerifier } : {}),
  };
  if (params.storeTrace !== false) {
    const trace = recordToTrace(record);
    storeRuntimeTrace(trace);
    record.observabilityTraceId = trace.id;
  }
  shadowRecords.unshift(record);
  if (shadowRecords.length > MAX_SHADOW_RECORDS) {
    shadowRecords.splice(MAX_SHADOW_RECORDS);
  }
  return record;
}

setRuntimeVerificationShadowSink({
  recordEventLog(params) {
    recordSecurityVerificationShadow({
      source: params.source,
      events: params.events,
      ...(params.runId ? { runId: params.runId } : {}),
      sampling: { mode: "auto", trigger: params.trigger },
      storeTrace: params.storeTrace,
    });
  },
  recordCheckpoint(params) {
    recordSecurityVerificationShadow({
      source: params.source,
      checkpoint: params.checkpoint,
      ...(params.runId ? { runId: params.runId } : {}),
      sampling: { mode: "auto", trigger: params.trigger },
      storeTrace: params.storeTrace,
    });
  },
});

export function getSecurityVerificationShadowRecords(
  filterOrLimit?: number | SecurityVerificationShadowRecordFilter,
): SecurityVerificationShadowRecord[] {
  const filter = normalizeRecordFilter(filterOrLimit);
  return shadowRecords
    .filter((record) => !filter.runId || record.runId === filter.runId)
    .filter((record) => !filter.source || record.source === filter.source)
    .filter((record) => !filter.subject || record.subject === filter.subject)
    .filter((record) => !filter.securityDecision || record.security.decision === filter.securityDecision)
    .filter((record) => !filter.verificationStatus || record.verification.status === filter.verificationStatus)
    .filter((record) => !filter.verifierDecision || record.evidenceVerifier?.decision === filter.verifierDecision)
    .slice(0, filter.limit);
}

export function getSecurityVerificationShadowRecord(id: string): SecurityVerificationShadowRecord | undefined {
  return shadowRecords.find((record) => record.id === id);
}

export function clearSecurityVerificationShadowRecords(): void {
  shadowRecords.splice(0);
}

export function getSecurityVerificationShadowSummary(
  filterOrLimit?: number | SecurityVerificationShadowRecordFilter,
): SecurityVerificationShadowSummary {
  const records = getSecurityVerificationShadowRecords(filterOrLimit);
  const securityDecisionCounts = zeroSecurityDecisionCounts();
  const verificationStatusCounts = zeroVerificationStatusCounts();
  const evidenceVerifierDecisionCounts = zeroEvidenceVerifierDecisionCounts();
  const sourceCounts = zeroSourceCounts();
  const subjectCounts = zeroSubjectCounts();
  const samplingModeCounts = zeroSamplingModeCounts();
  const recentFindingCodes: string[] = [];
  let securityFindingCount = 0;
  let verificationFindingCount = 0;
  let evidenceVerifierFindingCount = 0;
  for (const record of records) {
    securityDecisionCounts[record.security.decision] += 1;
    verificationStatusCounts[record.verification.status] += 1;
    if (record.evidenceVerifier) {
      evidenceVerifierDecisionCounts[record.evidenceVerifier.decision] += 1;
      evidenceVerifierFindingCount += record.evidenceVerifier.findingCount;
    }
    sourceCounts[record.source] += 1;
    subjectCounts[record.subject] += 1;
    samplingModeCounts[record.sampling.mode] += 1;
    securityFindingCount += record.security.findings.length;
    verificationFindingCount += record.verification.findings.length;
    for (const finding of [...record.security.findings, ...record.verification.findings]) {
      if (!recentFindingCodes.includes(finding.code)) {
        recentFindingCodes.push(finding.code);
      }
      if (recentFindingCodes.length >= 10) break;
    }
  }
  const healthLevel = resolveSecurityVerificationShadowHealthLevel({
    securityDecisionCounts,
    verificationStatusCounts,
    evidenceVerifierDecisionCounts,
  });
  return {
    totalRecords: records.length,
    healthLevel,
    securityDecisionCounts,
    verificationStatusCounts,
    evidenceVerifierDecisionCounts,
    sourceCounts,
    subjectCounts,
    samplingModeCounts,
    findingCounts: {
      security: securityFindingCount,
      verification: verificationFindingCount,
      evidenceVerifier: evidenceVerifierFindingCount,
    },
    recentFindingCodes,
    latestRunId: records[0]?.runId ?? null,
    latestRecordAt: records[0]?.createdAt ?? null,
  };
}

export function getSecurityVerificationShadowStatus(cfg?: OpenClawConfig) {
  const records = getSecurityVerificationShadowRecords();
  const summary = getSecurityVerificationShadowSummary();
  return {
    enabled: isSecurityVerificationShadowEnabled(cfg),
    healthLevel: summary.healthLevel,
    bufferSize: records.length,
    maxBufferSize: MAX_SHADOW_RECORDS,
    lastRecordAt: records[0]?.createdAt ?? null,
    securityFindingCount: records.reduce((sum, record) => sum + record.security.findings.length, 0),
    verificationFindingCount: records.reduce((sum, record) => sum + record.verification.findings.length, 0),
    evidenceVerifierFindingCount: records.reduce((sum, record) => sum + (record.evidenceVerifier?.findingCount ?? 0), 0),
    summary,
  };
}

export function buildToolCallRequestFromUnknown(params: {
  source: ShadowRecordSource;
  value: unknown;
}): ToolCallRequest {
  const body = isRecord(params.value) ? params.value : {};
  const args = isRecord(body.args) ? toJsonObject(body.args) : {};
  const traceRaw = isRecord(body.traceContext) ? body.traceContext : {};
  const traceContext: RuntimeTraceContext = {
    ...(typeof traceRaw.traceId === "string" ? { traceId: traceRaw.traceId } : {}),
    ...(typeof traceRaw.spanId === "string" ? { spanId: traceRaw.spanId } : {}),
    ...(typeof traceRaw.parentSpanId === "string" ? { parentSpanId: traceRaw.parentSpanId } : {}),
    ...(isRecord(traceRaw.attributes) ? { attributes: toJsonObject(traceRaw.attributes) } : {}),
  };
  const toolName = typeof body.toolName === "string"
    ? body.toolName
    : typeof body.name === "string"
      ? body.name
      : "unknown";
  const callId = typeof body.callId === "string" ? body.callId : `${params.source}-${randomUUID()}`;
  return {
    callId,
    taskId: typeof body.taskId === "string" ? body.taskId : params.source,
    toolName,
    args,
    ...(isRecord(body.permissionContext) ? { permissionContext: toJsonObject(body.permissionContext) } : {}),
    ...(Object.keys(traceContext).length > 0 ? { traceContext } : {}),
  };
}

export function buildToolCallResultFromUnknown(params: {
  request: ToolCallRequest;
  value: unknown;
}): ToolCallResult | undefined {
  if (!isRecord(params.value)) {
    return undefined;
  }
  const status = params.value.status;
  if (status !== "success" && status !== "error" && status !== "denied" && status !== "cancelled") {
    return undefined;
  }
  const startedAt = typeof params.value.startedAt === "number" ? params.value.startedAt : Date.now();
  const finishedAt = typeof params.value.finishedAt === "number" ? params.value.finishedAt : startedAt;
  return {
    callId: typeof params.value.callId === "string" ? params.value.callId : params.request.callId,
    status,
    contextItems: [],
    ...(params.value.structuredData === undefined ? {} : { structuredData: toJsonValue(params.value.structuredData) }),
    ...(isRecord(params.value.error)
      ? {
          error: {
            type: params.value.error.type === "model" || params.value.error.type === "permission" || params.value.error.type === "budget" ||
              params.value.error.type === "context" || params.value.error.type === "verifier" || params.value.error.type === "runtime"
              ? params.value.error.type
              : "tool",
            message: typeof params.value.error.message === "string" ? params.value.error.message : "tool result error",
            retryable: params.value.error.retryable === true,
            evidenceRefs: [],
          },
        }
      : {}),
    startedAt,
    finishedAt,
    evidence: Array.isArray(params.value.evidence)
      ? params.value.evidence.flatMap((entry) => {
          if (!isRecord(entry) || typeof entry.type !== "string" || typeof entry.ref !== "string") return [];
          return [{
            type: normalizeEvidenceRefType(entry.type),
            ref: entry.ref,
            ...(typeof entry.label === "string" ? { label: entry.label } : {}),
            ...(typeof entry.summary === "string" ? { summary: entry.summary } : {}),
          }];
        })
      : [],
  };
}
