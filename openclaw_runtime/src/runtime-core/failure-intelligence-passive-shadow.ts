import {
  FAILURE_EVENT_KINDS,
  FAILURE_EVENT_STAGES,
  type FailureEvent,
  type FailureKind,
  type FailureRecoverability,
  type FailureStage,
  type FailureSuggestedAction,
  validateFailureEvent,
} from "./failure-evidence-replay-contracts.js";

export const RUNTIME_FAILURE_PASSIVE_SHADOW_SUMMARY_MAX_CHARS = 280;
export const RUNTIME_FAILURE_PASSIVE_SHADOW_EVIDENCE_REF_LIMIT = 8;
export const RUNTIME_FAILURE_PASSIVE_SHADOW_ADVISORY_ONLY = true;

export type RuntimeFailurePassiveSignalMetadata = Record<
  string,
  string | number | boolean | null | undefined
>;

export type RuntimeFailurePassiveSignal = {
  stage?: FailureStage | string;
  kind?: FailureKind | string;
  message?: string;
  status?: string | number;
  statusCode?: number;
  statusText?: string;
  code?: string;
  name?: string;
  errorName?: string;
  commandKind?: string;
  toolName?: string;
  exitCode?: number;
  timedOut?: boolean;
  interrupted?: boolean;
  metadata?: RuntimeFailurePassiveSignalMetadata;
};

export type RuntimeFailurePassiveClassifierInput = {
  id: string;
  source: string;
  occurredAt: string;
  signal: RuntimeFailurePassiveSignal | string;
  runId?: string;
  evidenceRefs?: string[];
  message?: string;
  status?: string | number;
  statusCode?: number;
  statusText?: string;
  metadata?: RuntimeFailurePassiveSignalMetadata;
};

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|secret|password|passwd|pwd)\b\s*[:=]\s*["']?[^"',\s;]+/gi, "$1=[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[redacted-secret]"],
  [/\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{10,}\b/g, "[redacted-secret]"],
  [/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]"],
  [/\b[A-Z][A-Z0-9_]{2,}\s*=\s*[^\s]+/g, "[redacted-env]"],
];

const PATH_PATTERNS: Array<[RegExp, string]> = [
  [/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/g, "[redacted-path]"],
  [/(?:\/Users|\/home|\/workspace|\/tmp|\/var\/folders)\/[^\s"',;]+/g, "[redacted-path]"],
];

const STRUCTURED_PAYLOAD_PATTERNS: Array<[RegExp, string]> = [
  [/"(prompt|messages|providerPayload|provider_payload|toolArgs|tool_args|toolResult|tool_result|args|result|secret)"\s*:\s*(?:"[^"]*"|\{[^{}]*\}|\[[^\]]*\])/gi, "\"$1\":\"[redacted]\""],
  [/\{[^{}\n]{24,}\}/g, "{redacted-object}"],
  [/\[[^[\]\n]{24,}\]/g, "[redacted-array]"],
];

export function classifyRuntimeFailurePassiveShadow(
  input: RuntimeFailurePassiveClassifierInput,
): FailureEvent {
  const signal = normalizeSignal(input);
  const searchText = buildSearchText(input, signal);
  const stage = classifyStage(signal, searchText);
  const kind = classifyKind(signal, stage, searchText);
  const recovery = classifyRecovery(stage, kind);
  const summary = buildSummary(stage, kind, recovery.recoverability, recovery.suggestedAction, input, signal);
  const event: FailureEvent = {
    id: sanitizeIdentifier(input.id, "failure-passive-shadow-unknown"),
    ...(isNonEmptyString(input.runId) ? { runId: sanitizeIdentifier(input.runId, "run-unknown") } : {}),
    stage,
    kind,
    recoverability: recovery.recoverability,
    suggestedAction: recovery.suggestedAction,
    confidence: confidenceFor(stage, kind, signal),
    source: sanitizeIdentifier(input.source, "runtime.failure_intelligence.passive_shadow"),
    occurredAt: sanitizeTimestamp(input.occurredAt),
    summary,
    evidenceRefs: sanitizeEvidenceRefs(input.evidenceRefs),
    rawRetained: false,
    redaction: "sanitized",
  };

  const validation = validateFailureEvent(event);
  if (!validation.ok) {
    return stableUnknownFailureEvent(input);
  }
  return validation.value;
}

function normalizeSignal(input: RuntimeFailurePassiveClassifierInput): RuntimeFailurePassiveSignal {
  if (typeof input.signal === "string") {
    return {
      message: input.signal,
      status: input.status,
      statusCode: input.statusCode,
      statusText: input.statusText,
      metadata: input.metadata,
    };
  }

  return {
    ...input.signal,
    message: input.signal.message ?? input.message,
    status: input.signal.status ?? input.status,
    statusCode: input.signal.statusCode ?? input.statusCode,
    statusText: input.signal.statusText ?? input.statusText,
    metadata: { ...input.metadata, ...input.signal.metadata },
  };
}

function classifyStage(signal: RuntimeFailurePassiveSignal, searchText: string): FailureStage {
  if (isFailureStage(signal.stage)) {
    return signal.stage;
  }
  if (signal.interrupted === true || matches(searchText, ["user interrupt", "interrupted by user", "cancelled by user", "aborted by user"])) {
    return "user_interrupt";
  }
  if (matches(searchText, ["gateway", "hostapi", "http proxy", "websocket", "ipc", "ws close"])) {
    return "gateway";
  }
  if (matches(searchText, ["provider", "openai", "anthropic", "model", "rate limit", "completion", "chat api"])) {
    return "provider";
  }
  if (matches(searchText, ["vitest", "jest", "playwright", "assertion", "test failed", "tests failed", "expect("])) {
    return "test";
  }
  if (matches(searchText, ["apply_patch", "patch", "hunk", "diff", "merge conflict"])) {
    return "patch";
  }
  if (matches(searchText, ["planning", "plan", "missing context", "insufficient context", "unclear requirement"])) {
    return "planning";
  }
  if (matches(searchText, ["tool", "command", "exit code", "spawn", "enoent", "eacces"])) {
    return "tool_call";
  }
  return "unknown";
}

function classifyKind(
  signal: RuntimeFailurePassiveSignal,
  stage: FailureStage,
  searchText: string,
): FailureKind {
  if (isFailureKind(signal.kind)) {
    return signal.kind;
  }
  if (stage === "user_interrupt") {
    return "unknown";
  }
  if (stage === "gateway" && matches(searchText, ["gateway", "hostapi", "http proxy", "websocket", "ipc"])) {
    return "gateway_error";
  }
  if (matches(searchText, ["permission denied", "eacces", "eperm", "unauthorized", "forbidden", "access denied"])) {
    return "permission";
  }
  if (matches(searchText, ["enoent", "no such file", "path not found", "cannot find path", "missing file"])) {
    return "path";
  }
  if (matches(searchText, ["module not found", "missing dependency", "cannot find module", "package not found", "pnpm install"])) {
    return "dependency";
  }
  if (signal.timedOut === true || matches(searchText, ["timeout", "timed out", "etimedout", "deadline exceeded"])) {
    return "timeout";
  }
  if (stage === "provider" && matches(searchText, ["provider", "openai", "anthropic", "model", "rate limit", "api error"])) {
    return "provider_error";
  }
  if (matches(searchText, ["typeerror", "type error", "ts2322", "ts2339", "typecheck"])) {
    return "type_error";
  }
  if (stage === "test" || matches(searchText, ["assertion", "test failed", "tests failed", "expected", "received"])) {
    return "test_failure";
  }
  if (matches(searchText, ["dirty workspace", "env contamination", "environment contamination", "stale state", "leftover process"])) {
    return "environment_contamination";
  }
  if (matches(searchText, ["insufficient context", "missing context", "unclear requirement", "need clarification"])) {
    return "context_insufficient";
  }
  return "unknown";
}

function classifyRecovery(
  stage: FailureStage,
  kind: FailureKind,
): { recoverability: FailureRecoverability; suggestedAction: FailureSuggestedAction } {
  if (stage === "user_interrupt") {
    return { recoverability: "non_recoverable", suggestedAction: "stop" };
  }
  switch (kind) {
    case "permission":
    case "context_insufficient":
    case "environment_contamination":
      return { recoverability: "ask_user", suggestedAction: "ask_user" };
    case "timeout":
    case "gateway_error":
      return { recoverability: "retryable", suggestedAction: "retry" };
    case "provider_error":
      return { recoverability: "retryable", suggestedAction: "degrade" };
    case "path":
    case "dependency":
    case "type_error":
    case "test_failure":
      return { recoverability: "retryable", suggestedAction: "continue_with_caution" };
    case "unknown":
      return { recoverability: "unknown", suggestedAction: "continue_with_caution" };
  }
}

function confidenceFor(
  stage: FailureStage,
  kind: FailureKind,
  signal: RuntimeFailurePassiveSignal,
): number {
  if (stage === "unknown" && kind === "unknown") {
    return 0.2;
  }
  if (isFailureStage(signal.stage) || isFailureKind(signal.kind)) {
    return 0.9;
  }
  if (stage !== "unknown" && kind !== "unknown") {
    return 0.78;
  }
  return 0.52;
}

function buildSummary(
  stage: FailureStage,
  kind: FailureKind,
  recoverability: FailureRecoverability,
  suggestedAction: FailureSuggestedAction,
  input: RuntimeFailurePassiveClassifierInput,
  signal: RuntimeFailurePassiveSignal,
): string {
  const snippet = sanitizeSummaryText(selectSummarySnippet(input, signal));
  const base = `Passive advisory failure classification: stage=${stage}; kind=${kind}; recoverability=${recoverability}; suggestedAction=${suggestedAction}.`;
  return boundSummary(snippet ? `${base} Sanitized signal: ${snippet}` : `${base} No raw payload retained.`);
}

function selectSummarySnippet(
  input: RuntimeFailurePassiveClassifierInput,
  signal: RuntimeFailurePassiveSignal,
): string {
  const parts = [
    signal.code && `code=${signal.code}`,
    signal.name && `name=${signal.name}`,
    signal.errorName && `error=${signal.errorName}`,
    signal.status !== undefined && `status=${signal.status}`,
    signal.statusCode !== undefined && `statusCode=${signal.statusCode}`,
    signal.statusText && `statusText=${signal.statusText}`,
    signal.exitCode !== undefined && `exitCode=${signal.exitCode}`,
    signal.toolName && `tool=${signal.toolName}`,
    signal.commandKind && `commandKind=${signal.commandKind}`,
    signal.message ?? input.message,
  ];
  return parts.filter(isNonEmptyString).join("; ");
}

function buildSearchText(
  input: RuntimeFailurePassiveClassifierInput,
  signal: RuntimeFailurePassiveSignal,
): string {
  const metadata = signal.metadata ?? input.metadata ?? {};
  const metadataValues = Object.entries(metadata)
    .slice(0, 16)
    .map(([key, value]) => `${key}=${String(value ?? "")}`);
  return [
    input.source,
    signal.stage,
    signal.kind,
    signal.code,
    signal.name,
    signal.errorName,
    signal.status,
    signal.statusCode,
    signal.statusText,
    signal.commandKind,
    signal.toolName,
    signal.exitCode,
    signal.message,
    input.message,
    ...metadataValues,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLowerCase();
}

function sanitizeSummaryText(value: string): string {
  let sanitized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of PATH_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of STRUCTURED_PAYLOAD_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return boundSummary(sanitized);
}

function boundSummary(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= RUNTIME_FAILURE_PASSIVE_SHADOW_SUMMARY_MAX_CHARS) {
    return trimmed || "Passive advisory failure classification. No raw payload retained.";
  }
  return `${trimmed.slice(0, RUNTIME_FAILURE_PASSIVE_SHADOW_SUMMARY_MAX_CHARS - 3).trimEnd()}...`;
}

function sanitizeEvidenceRefs(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isNonEmptyString)
    .slice(0, RUNTIME_FAILURE_PASSIVE_SHADOW_EVIDENCE_REF_LIMIT)
    .map((ref) => sanitizeSummaryText(ref).slice(0, 128));
}

function sanitizeIdentifier(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? sanitizeSummaryText(value) : "";
  const normalized = text.replace(/\s+/g, "-").slice(0, 128);
  return normalized || fallback;
}

function sanitizeTimestamp(value: unknown): string {
  if (typeof value === "string" && ISO_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value))) {
    return value;
  }
  return "1970-01-01T00:00:00.000Z";
}

function stableUnknownFailureEvent(input: RuntimeFailurePassiveClassifierInput): FailureEvent {
  return {
    id: sanitizeIdentifier(input.id, "failure-passive-shadow-unknown"),
    ...(isNonEmptyString(input.runId) ? { runId: sanitizeIdentifier(input.runId, "run-unknown") } : {}),
    stage: "unknown",
    kind: "unknown",
    recoverability: "unknown",
    suggestedAction: "continue_with_caution",
    confidence: 0.2,
    source: sanitizeIdentifier(input.source, "runtime.failure_intelligence.passive_shadow"),
    occurredAt: sanitizeTimestamp(input.occurredAt),
    summary: "Passive advisory failure classification: stage=unknown; kind=unknown; recoverability=unknown; suggestedAction=continue_with_caution. No raw payload retained.",
    evidenceRefs: sanitizeEvidenceRefs(input.evidenceRefs),
    rawRetained: false,
    redaction: "sanitized",
  };
}

function matches(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function isFailureStage(value: unknown): value is FailureStage {
  return typeof value === "string" && FAILURE_EVENT_STAGES.includes(value as FailureStage);
}

function isFailureKind(value: unknown): value is FailureKind {
  return typeof value === "string" && FAILURE_EVENT_KINDS.includes(value as FailureKind);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
