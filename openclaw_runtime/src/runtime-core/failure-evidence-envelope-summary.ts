import {
  RUNTIME_EVIDENCE_ENVELOPE_PAYLOAD_MAX_BYTES,
  type EvidenceEnvelope,
  type EvidenceEnvelopeProvenance,
  type EvidenceEnvelopeScope,
  type EvidenceEnvelopeSource,
  type FailureEvent,
  type RuntimeFailureEvidenceReplayValidationIssue,
  type RuntimeFailureEvidenceReplayValidationResult,
  validateEvidenceEnvelope,
  validateFailureEvent,
} from "./failure-evidence-replay-contracts.js";

export const RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_DIAGNOSTICS_ONLY = true;
export const RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_KIND = "failure_summary";
export const RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_AUTHORITY = "none";
export const RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_PAYLOAD_MAX_BYTES = Math.min(
  4096,
  RUNTIME_EVIDENCE_ENVELOPE_PAYLOAD_MAX_BYTES,
);

const SUMMARY_MAX_CHARS = 640;
const METADATA_MAX_CHARS = 160;
const REF_LIMIT = 8;
const REF_MAX_CHARS = 160;

export type FailureSummaryEvidenceEnvelopeInput = {
  failureEvent: FailureEvent;
  source: EvidenceEnvelopeSource;
  scope: EvidenceEnvelopeScope;
  ttlMs: number;
  provenance: EvidenceEnvelopeProvenance;
  envelopeId?: string;
  createdAt?: string;
  maxPayloadBytes?: number;
  nowMs?: number;
  authority?: unknown;
  rawRetained?: unknown;
};

export type FailureSummaryEvidenceEnvelopePayload = {
  summary: string;
  classification: {
    stage: FailureEvent["stage"];
    kind: FailureEvent["kind"];
    recoverability: FailureEvent["recoverability"];
    suggestedAction: FailureEvent["suggestedAction"];
    confidence: number;
  };
  failure: {
    id: string;
    runId?: string;
    source: string;
    occurredAt: string;
  };
  refs: string[];
  redaction: {
    sourceFailureRedaction: FailureEvent["redaction"];
    rawRetained: false;
  };
};

export function createFailureSummaryEvidenceEnvelope(
  input: FailureSummaryEvidenceEnvelopeInput,
): RuntimeFailureEvidenceReplayValidationResult<EvidenceEnvelope> {
  if (!isRecord(input)) {
    return fail({
      path: "$",
      code: "invalid_type",
      message: "FailureSummaryEvidenceEnvelopeInput must be an object.",
    });
  }

  const preflightIssues: RuntimeFailureEvidenceReplayValidationIssue[] = [];
  if (input.authority !== undefined && input.authority !== RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_AUTHORITY) {
    preflightIssues.push({
      path: "authority",
      code: "invalid_authority",
      message: "Failure summary evidence authority must be none.",
    });
  }
  if (input.rawRetained !== undefined && input.rawRetained !== false) {
    preflightIssues.push({
      path: "rawRetained",
      code: "raw_retained",
      message: "Failure summary evidence must not retain raw data.",
    });
  }

  const failureValidation = validateFailureEvent(input.failureEvent);
  let failureEvent: FailureEvent | undefined;
  if (!failureValidation.ok) {
    preflightIssues.push(...prefixIssues("failureEvent", failureValidation.errors));
  } else {
    failureEvent = failureValidation.value;
  }
  if (preflightIssues.length) {
    return { ok: false, errors: preflightIssues };
  }
  if (!failureEvent) {
    return fail({
      path: "failureEvent",
      code: "invalid_type",
      message: "Failure event validation did not return a value.",
    });
  }

  const envelope = {
    id: sanitizeIdentifier(input.envelopeId ?? `failure-summary:${failureEvent.id}`, "failure-summary-unknown"),
    kind: RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_KIND,
    source: sanitizeEvidenceSource(input.source),
    scope: sanitizeEvidenceScope(input.scope),
    createdAt: input.createdAt ?? failureEvent.occurredAt,
    ttlMs: input.ttlMs,
    confidence: failureEvent.confidence,
    redaction: {
      state: "sanitized",
      rawRetained: false,
      secretScan: "pass",
    },
    provenance: sanitizeEvidenceProvenance(input.provenance),
    authority: RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_AUTHORITY,
    payload: buildFailureSummaryPayload(failureEvent),
    rawRetained: false,
  };

  return validateEvidenceEnvelope(envelope, {
    nowMs: input.nowMs,
    maxPayloadBytes: input.maxPayloadBytes ?? RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_PAYLOAD_MAX_BYTES,
  });
}

function buildFailureSummaryPayload(failureEvent: FailureEvent): FailureSummaryEvidenceEnvelopePayload {
  return {
    summary: sanitizeBoundedText(failureEvent.summary, SUMMARY_MAX_CHARS)
      || "Sanitized failure summary unavailable.",
    classification: {
      stage: failureEvent.stage,
      kind: failureEvent.kind,
      recoverability: failureEvent.recoverability,
      suggestedAction: failureEvent.suggestedAction,
      confidence: failureEvent.confidence,
    },
    failure: {
      id: sanitizeIdentifier(failureEvent.id, "failure-unknown"),
      ...(failureEvent.runId ? { runId: sanitizeIdentifier(failureEvent.runId, "run-unknown") } : {}),
      source: sanitizeBoundedText(failureEvent.source, METADATA_MAX_CHARS) || "unknown-source",
      occurredAt: failureEvent.occurredAt,
    },
    refs: failureEvent.evidenceRefs
      .slice(0, REF_LIMIT)
      .map((ref) => sanitizeBoundedText(ref, REF_MAX_CHARS))
      .filter(isNonEmptyString),
    redaction: {
      sourceFailureRedaction: failureEvent.redaction,
      rawRetained: false,
    },
  };
}

function sanitizeEvidenceSource(value: unknown): EvidenceEnvelopeSource | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    component: sanitizeBoundedText(value.component, METADATA_MAX_CHARS),
    ...(value.runId !== undefined ? { runId: sanitizeBoundedText(value.runId, METADATA_MAX_CHARS) } : {}),
    ...(value.command !== undefined ? { command: sanitizeBoundedText(value.command, METADATA_MAX_CHARS) } : {}),
    ...(value.file !== undefined ? { file: sanitizeBoundedText(value.file, METADATA_MAX_CHARS) } : {}),
  };
}

function sanitizeEvidenceScope(value: unknown): EvidenceEnvelopeScope | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    ...(value.workspace !== undefined ? { workspace: sanitizeBoundedText(value.workspace, METADATA_MAX_CHARS) } : {}),
    ...(value.sessionId !== undefined ? { sessionId: sanitizeBoundedText(value.sessionId, METADATA_MAX_CHARS) } : {}),
    ...(value.runId !== undefined ? { runId: sanitizeBoundedText(value.runId, METADATA_MAX_CHARS) } : {}),
    ...(value.taskId !== undefined ? { taskId: sanitizeBoundedText(value.taskId, METADATA_MAX_CHARS) } : {}),
    ...(value.paths !== undefined ? { paths: sanitizeStringArray(value.paths, REF_LIMIT, REF_MAX_CHARS) } : {}),
  };
}

function sanitizeEvidenceProvenance(value: unknown): EvidenceEnvelopeProvenance | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    producer: sanitizeBoundedText(value.producer, METADATA_MAX_CHARS),
    version: sanitizeBoundedText(value.version, METADATA_MAX_CHARS),
    inputs: sanitizeStringArray(value.inputs, REF_LIMIT, REF_MAX_CHARS),
  };
}

function sanitizeStringArray(value: unknown, limit: number, maxChars: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, limit)
    .map((item) => sanitizeBoundedText(item, maxChars))
    .filter(isNonEmptyString);
}

function sanitizeIdentifier(value: unknown, fallback: string): string {
  const sanitized = sanitizeBoundedText(value, METADATA_MAX_CHARS)
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9:._-]/g, "")
    .slice(0, METADATA_MAX_CHARS);
  return sanitized || fallback;
}

function sanitizeBoundedText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") {
    return "";
  }
  let sanitized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of RAW_PAYLOAD_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of PATH_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  if (sanitized.length <= maxChars) {
    return sanitized;
  }
  return `${sanitized.slice(0, maxChars - 3).trimEnd()}...`;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|secret|password|passwd|pwd)\b\s*[:=]\s*["']?[^"',\s;]+/gi, "$1=[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[redacted-secret]"],
  [/\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{10,}\b/g, "[redacted-secret]"],
  [/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[redacted-token]"],
  [/\b[A-Z][A-Z0-9_]{2,}\s*=\s*[^\s]+/g, "[redacted-env]"],
];

const RAW_PAYLOAD_PATTERNS: Array<[RegExp, string]> = [
  [/"(prompt|messages|providerPayload|provider_payload|toolArgs|tool_args|toolResult|tool_result|args|result|secret)"\s*:\s*(?:"[^"]*"|\{[^{}]*\}|\[[^\]]*\])/gi, "\"$1\":\"[redacted]\""],
  [/\b(prompt|messages|providerPayload|provider_payload|toolArgs|tool_args|toolResult|tool_result|args|result)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|\{[^{}]*\}|\[[^\]]*\]|[^\s;]+)/gi, "$1=[redacted]"],
  [/\{[^{}\n]{24,}\}/g, "{redacted-object}"],
  [/\[[^[\]\n]{24,}\]/g, "[redacted-array]"],
];

const PATH_PATTERNS: Array<[RegExp, string]> = [
  [/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/g, "[redacted-path]"],
  [/(?:\/Users|\/home|\/workspace|\/tmp|\/var\/folders)\/[^\s"',;]+/g, "[redacted-path]"],
];

function prefixIssues(
  prefix: string,
  issues: RuntimeFailureEvidenceReplayValidationIssue[],
): RuntimeFailureEvidenceReplayValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path === "$" ? prefix : `${prefix}.${issue.path}`,
  }));
}

function fail<T>(
  issue: RuntimeFailureEvidenceReplayValidationIssue,
): RuntimeFailureEvidenceReplayValidationResult<T> {
  return { ok: false, errors: [issue] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}
