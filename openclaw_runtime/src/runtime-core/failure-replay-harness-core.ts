import {
  RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_AUTHORITY,
  createFailureSummaryEvidenceEnvelope,
} from "./failure-evidence-envelope-summary.js";
import {
  type EvidenceEnvelope,
  type FailureEvent,
  type ReplayCase,
  type ReplayCaseTerminalStatus,
  type RuntimeFailureEvidenceReplayValidationIssue,
  type RuntimeFailureEvidenceReplayValidationResult,
  validateEvidenceEnvelope,
  validateFailureEvent,
  validateReplayCase,
} from "./failure-evidence-replay-contracts.js";
import {
  classifyRuntimeFailurePassiveShadow,
  type RuntimeFailurePassiveClassifierInput,
} from "./failure-intelligence-passive-shadow.js";

export const RUNTIME_FAILURE_REPLAY_HARNESS_DIAGNOSTICS_ONLY = true;
export const RUNTIME_FAILURE_REPLAY_REPORT_MAX_BYTES = 16_384;
export const RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION = 1;

export type RuntimeFailureReplayProviderFixture = {
  ref: string;
  mode: "fixture";
  status: "ok" | "error" | "timeout";
  summary: string;
  liveProvider?: boolean;
};

export type RuntimeFailureReplayToolFixture = {
  ref: string;
  mode: "fixture";
  status: "ok" | "error";
  summary: string;
  toolCalls?: number;
};

export type RuntimeFailureReplayTouchedPathSummary = {
  path: string;
  status: "unchanged" | "created" | "modified" | "deleted" | "dirty";
  summary: string;
};

export type RuntimeFailureReplayWorkspaceFixture = {
  ref: string;
  mode: "fixture";
  status: "clean" | "dirty";
  summary: string;
  touchedPaths?: RuntimeFailureReplayTouchedPathSummary[];
};

export type RuntimeFailureReplayFixtureBundle = {
  provider: RuntimeFailureReplayProviderFixture;
  tool: RuntimeFailureReplayToolFixture;
  workspace: RuntimeFailureReplayWorkspaceFixture;
  failureSignals?: RuntimeFailurePassiveClassifierInput[];
  failureEvents?: FailureEvent[];
  evidenceEnvelopes?: EvidenceEnvelope[];
};

export type RuntimeFailureReplayEvidenceDecision = {
  id: string;
  kind: EvidenceEnvelope["kind"];
  authority: EvidenceEnvelope["authority"];
  accepted: boolean;
  confidence: number;
  failureEventId?: string;
  reason?: string;
};

export type RuntimeFailureReplayReport = {
  schemaVersion: typeof RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION;
  diagnosticsOnly: true;
  completionProof: false;
  replay: {
    id: string;
    title: string;
    scenario: ReplayCase["scenario"];
    terminalStatus: ReplayCaseTerminalStatus;
    expectedTerminalStatus: ReplayCaseTerminalStatus;
    budgets: ReplayCase["budgets"];
    fixtureRefs: {
      provider: string;
      tool: string;
      workspace: string;
    };
  };
  status: {
    passed: boolean;
    reasons: string[];
  };
  failureEvents: FailureEvent[];
  evidenceEnvelopeDecisions: RuntimeFailureReplayEvidenceDecision[];
  touchedPathSummaries: RuntimeFailureReplayTouchedPathSummary[];
};

export type RuntimeFailureReplayHarnessOptions = {
  nowMs?: number;
  maxReportBytes?: number;
};

type IssueSink = RuntimeFailureEvidenceReplayValidationIssue[];

const LIVE_PROVIDER_PATTERN = /^(?:live|live_provider|provider:live|network|default)(?:$|[:_\-])/i;
const REPORT_TEXT_MAX_CHARS = 280;
const REPORT_REF_MAX_CHARS = 160;

export function runFailureReplayHarnessCore(
  replayCase: ReplayCase,
  fixtures: RuntimeFailureReplayFixtureBundle,
  options: RuntimeFailureReplayHarnessOptions = {},
): RuntimeFailureEvidenceReplayValidationResult<RuntimeFailureReplayReport> {
  const issues: IssueSink = [];
  const replayValidation = validateReplayCase(replayCase);
  if (!replayValidation.ok) {
    issues.push(...replayValidation.errors);
  }

  validateFixtureBundle(replayCase, fixtures, issues);
  if (issues.length) {
    return { ok: false, errors: issues };
  }

  const validReplayCase = replayValidation.ok ? replayValidation.value : replayCase;
  const failureEvents = collectFailureEvents(fixtures, issues);
  if (issues.length) {
    return { ok: false, errors: issues };
  }

  const evidenceEnvelopeDecisions = collectEvidenceDecisions(validReplayCase, fixtures, failureEvents, options, issues);
  if (issues.length) {
    return { ok: false, errors: issues };
  }

  const terminalStatus = inferTerminalStatus(validReplayCase, fixtures, failureEvents);
  const touchedPathSummaries = sanitizeTouchedPathSummaries(fixtures.workspace.touchedPaths);
  const reasons = buildStatusReasons(validReplayCase, terminalStatus, failureEvents);
  const report: RuntimeFailureReplayReport = {
    schemaVersion: RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION,
    diagnosticsOnly: true,
    completionProof: false,
    replay: {
      id: sanitizeIdentifier(validReplayCase.id, "replay-unknown"),
      title: sanitizeText(validReplayCase.title, REPORT_TEXT_MAX_CHARS),
      scenario: validReplayCase.scenario,
      terminalStatus,
      expectedTerminalStatus: validReplayCase.expected.terminalStatus,
      budgets: { ...validReplayCase.budgets },
      fixtureRefs: {
        provider: sanitizeIdentifier(fixtures.provider.ref, "provider-fixture-unknown"),
        tool: sanitizeIdentifier(fixtures.tool.ref, "tool-fixture-unknown"),
        workspace: sanitizeIdentifier(fixtures.workspace.ref, "workspace-fixture-unknown"),
      },
    },
    status: {
      passed: terminalStatus === validReplayCase.expected.terminalStatus && failureKindsMatch(validReplayCase, failureEvents),
      reasons,
    },
    failureEvents,
    evidenceEnvelopeDecisions,
    touchedPathSummaries,
  };

  const reportBytes = measureJsonBytes(report);
  if (reportBytes === undefined) {
    return fail("report", "payload_not_json", "Replay report must be JSON-serializable.");
  }
  const maxReportBytes = options.maxReportBytes ?? RUNTIME_FAILURE_REPLAY_REPORT_MAX_BYTES;
  if (reportBytes > maxReportBytes) {
    return fail("report", "payload_oversized", `Replay report must be at most ${maxReportBytes} JSON bytes.`);
  }
  return { ok: true, value: report };
}

function validateFixtureBundle(
  replayCase: ReplayCase,
  fixtures: RuntimeFailureReplayFixtureBundle,
  issues: IssueSink,
): void {
  if (!isRecord(fixtures)) {
    addIssue(issues, "fixtures", "missing_fixture", "Replay fixtures are required.");
    return;
  }
  validateFixture("provider", replayCase.input.providerFixture, fixtures.provider, issues);
  validateFixture("tool", replayCase.input.toolFixture, fixtures.tool, issues);
  validateFixture("workspace", replayCase.input.workspaceFixture, fixtures.workspace, issues);
  if (isRecord(fixtures.provider) && fixtures.provider.liveProvider === true) {
    addIssue(issues, "fixtures.provider.liveProvider", "live_provider_default", "Replay must not use a live provider.");
  }
  if (isRecord(fixtures.provider) && typeof fixtures.provider.ref === "string" && LIVE_PROVIDER_PATTERN.test(fixtures.provider.ref)) {
    addIssue(issues, "fixtures.provider.ref", "live_provider_default", "Provider fixture must not reference a live provider.");
  }
}

function validateFixture(
  kind: "provider" | "tool" | "workspace",
  expectedRef: string,
  value: unknown,
  issues: IssueSink,
): void {
  if (!isRecord(value)) {
    addIssue(issues, `fixtures.${kind}`, "missing_fixture", `${kind} fixture is required.`);
    return;
  }
  if (value.mode !== "fixture") {
    addIssue(issues, `fixtures.${kind}.mode`, "missing_fixture", `${kind} fixture mode must be fixture.`);
  }
  if (typeof value.ref !== "string" || value.ref.trim().length === 0) {
    addIssue(issues, `fixtures.${kind}.ref`, "missing_fixture", `${kind} fixture ref is required.`);
    return;
  }
  if (value.ref !== expectedRef) {
    addIssue(issues, `fixtures.${kind}.ref`, "missing_fixture", `${kind} fixture ref must match ReplayCase input.`);
  }
  if (typeof value.summary !== "string" || value.summary.trim().length === 0) {
    addIssue(issues, `fixtures.${kind}.summary`, "missing_fixture", `${kind} fixture summary is required.`);
  }
}

function collectFailureEvents(
  fixtures: RuntimeFailureReplayFixtureBundle,
  issues: IssueSink,
): FailureEvent[] {
  const generated = (fixtures.failureSignals ?? []).map((signal, index) => {
    const event = classifyRuntimeFailurePassiveShadow(signal);
    const validation = validateFailureEvent(event);
    if (!validation.ok) {
      issues.push(...prefixIssues(`fixtures.failureSignals.${index}`, validation.errors));
      return undefined;
    }
    return sanitizeFailureEvent(validation.value, issues, `fixtures.failureSignals.${index}`);
  });

  const loaded = (fixtures.failureEvents ?? []).map((event, index) => {
    const validation = validateFailureEvent(event);
    if (!validation.ok) {
      issues.push(...prefixIssues(`fixtures.failureEvents.${index}`, validation.errors));
      return undefined;
    }
    return sanitizeFailureEvent(validation.value, issues, `fixtures.failureEvents.${index}`);
  });

  return [...generated, ...loaded]
    .filter((event): event is FailureEvent => Boolean(event))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function collectEvidenceDecisions(
  replayCase: ReplayCase,
  fixtures: RuntimeFailureReplayFixtureBundle,
  failureEvents: FailureEvent[],
  options: RuntimeFailureReplayHarnessOptions,
  issues: IssueSink,
): RuntimeFailureReplayEvidenceDecision[] {
  const decisions: RuntimeFailureReplayEvidenceDecision[] = [];
  for (const envelope of fixtures.evidenceEnvelopes ?? []) {
    const validation = validateEvidenceEnvelope(envelope, { nowMs: options.nowMs });
    if (!validation.ok) {
      issues.push(...prefixIssues("fixtures.evidenceEnvelopes", validation.errors));
      continue;
    }
    decisions.push(toEvidenceDecision(validation.value, true));
  }

  for (const failureEvent of failureEvents) {
    const envelope = createFailureSummaryEvidenceEnvelope({
      failureEvent,
      source: {
        component: "runtime.failure_replay_harness_core",
        runId: failureEvent.runId,
      },
      scope: {
        runId: failureEvent.runId,
        paths: replayCase.expected.touchedPaths,
      },
      ttlMs: Math.max(1, replayCase.budgets.maxDurationMs ?? 60_000),
      provenance: {
        producer: "runtime.failure_replay_harness_core",
        version: String(RUNTIME_FAILURE_REPLAY_REPORT_SCHEMA_VERSION),
        inputs: [failureEvent.id, replayCase.id],
      },
      envelopeId: `replay-evidence:${replayCase.id}:${failureEvent.id}`,
      createdAt: failureEvent.occurredAt,
      nowMs: options.nowMs,
    });
    if (!envelope.ok) {
      issues.push(...prefixIssues(`failureEvents.${failureEvent.id}.evidence`, envelope.errors));
      continue;
    }
    decisions.push(toEvidenceDecision(envelope.value, true, failureEvent.id));
  }

  return decisions.sort((left, right) => left.id.localeCompare(right.id));
}

function toEvidenceDecision(
  envelope: EvidenceEnvelope,
  accepted: boolean,
  failureEventId?: string,
): RuntimeFailureReplayEvidenceDecision {
  return {
    id: sanitizeIdentifier(envelope.id, "evidence-unknown"),
    kind: envelope.kind,
    authority: RUNTIME_FAILURE_SUMMARY_EVIDENCE_ENVELOPE_AUTHORITY,
    accepted,
    confidence: envelope.confidence,
    ...(failureEventId ? { failureEventId: sanitizeIdentifier(failureEventId, "failure-unknown") } : {}),
  };
}

function inferTerminalStatus(
  replayCase: ReplayCase,
  fixtures: RuntimeFailureReplayFixtureBundle,
  failureEvents: FailureEvent[],
): ReplayCaseTerminalStatus {
  if (replayCase.expected.terminalStatus === "blocked") {
    return "blocked";
  }
  if (replayCase.expected.terminalStatus === "interrupted") {
    return "interrupted";
  }
  if (fixtures.provider.status === "timeout" || fixtures.provider.status === "error" || fixtures.tool.status === "error") {
    return replayCase.expected.terminalStatus === "completed" ? "failed" : replayCase.expected.terminalStatus;
  }
  if (failureEvents.length > 0 && replayCase.expected.terminalStatus !== "completed") {
    return replayCase.expected.terminalStatus;
  }
  return "completed";
}

function failureKindsMatch(replayCase: ReplayCase, failureEvents: FailureEvent[]): boolean {
  const expectedKinds = replayCase.expected.allowedFailureKinds;
  if (!expectedKinds?.length) {
    return failureEvents.length === 0;
  }
  const actualKinds = new Set(failureEvents.map((event) => event.kind));
  return expectedKinds.every((kind) => actualKinds.has(kind));
}

function buildStatusReasons(
  replayCase: ReplayCase,
  terminalStatus: ReplayCaseTerminalStatus,
  failureEvents: FailureEvent[],
): string[] {
  const reasons = [
    terminalStatus === replayCase.expected.terminalStatus
      ? "terminal_status_matched"
      : "terminal_status_mismatch",
    failureKindsMatch(replayCase, failureEvents)
      ? "failure_kinds_matched"
      : "failure_kinds_mismatch",
  ];
  return reasons.sort();
}

function sanitizeFailureEvent(event: FailureEvent, issues: IssueSink, path: string): FailureEvent | undefined {
  const sanitized: FailureEvent = {
    ...event,
    id: sanitizeIdentifier(event.id, "failure-unknown"),
    ...(event.runId ? { runId: sanitizeIdentifier(event.runId, "run-unknown") } : {}),
    source: sanitizeText(event.source, REPORT_REF_MAX_CHARS),
    summary: sanitizeText(event.summary, REPORT_TEXT_MAX_CHARS) || "Sanitized failure summary unavailable.",
    evidenceRefs: event.evidenceRefs.map((ref) => sanitizeText(ref, REPORT_REF_MAX_CHARS)).filter(isNonEmptyString),
    rawRetained: false,
    redaction: event.redaction,
  };
  const validation = validateFailureEvent(sanitized);
  if (!validation.ok) {
    issues.push(...prefixIssues(path, validation.errors));
    return undefined;
  }
  return validation.value;
}

function sanitizeTouchedPathSummaries(
  value: RuntimeFailureReplayTouchedPathSummary[] | undefined,
): RuntimeFailureReplayTouchedPathSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, 16)
    .map((summary) => ({
      path: sanitizePath(summary.path),
      status: summary.status,
      summary: sanitizeText(summary.summary, REPORT_TEXT_MAX_CHARS),
    }))
    .filter((summary) => isNonEmptyString(summary.path) && isNonEmptyString(summary.summary))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function sanitizeIdentifier(value: unknown, fallback: string): string {
  const sanitized = sanitizeText(value, REPORT_REF_MAX_CHARS)
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9:._/-]/g, "")
    .slice(0, REPORT_REF_MAX_CHARS);
  return sanitized || fallback;
}

function sanitizePath(value: unknown): string {
  const text = sanitizeText(value, REPORT_REF_MAX_CHARS);
  if (!text || text.includes("[redacted-path]")) {
    return "[redacted-path]";
  }
  return text.replace(/\\/g, "/");
}

function sanitizeText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") {
    return "";
  }
  let sanitized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  if (sanitized.length <= maxChars) {
    return sanitized;
  }
  return `${sanitized.slice(0, maxChars - 3).trimEnd()}...`;
}

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|secret|password|passwd|pwd)\b\s*[:=]\s*["']?[^"',\s;]+/gi, "$1=[redacted]"],
  [/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[redacted-secret]"],
  [/\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{10,}\b/g, "[redacted-secret]"],
  [/\b[A-Z][A-Z0-9_]{2,}\s*=\s*[^\s]+/g, "[redacted-env]"],
  [/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/g, "[redacted-path]"],
  [/(?:\/Users|\/home|\/workspace|\/tmp|\/var\/folders)\/[^\s"',;]+/g, "[redacted-path]"],
  [/"(prompt|messages|providerPayload|provider_payload|toolArgs|tool_args|toolResult|tool_result|args|result|secret)"\s*:\s*(?:"[^"]*"|\{[^{}]*\}|\[[^\]]*\])/gi, "\"redactedPayload\":\"[redacted]\""],
  [/\b(prompt|messages|providerPayload|provider_payload|toolArgs|tool_args|toolResult|tool_result|args|result)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|\{[^{}]*\}|\[[^\]]*\]|[^\s;]+)/gi, "[redacted-payload]"],
  [/\{[^{}\n]{24,}\}/g, "{redacted-object}"],
  [/\[[^[\]\n]{24,}\]/g, "[redacted-array]"],
];

function addIssue(
  issues: IssueSink,
  path: string,
  code: RuntimeFailureEvidenceReplayValidationIssue["code"],
  message: string,
): void {
  issues.push({ path, code, message });
}

function fail<T>(
  path: string,
  code: RuntimeFailureEvidenceReplayValidationIssue["code"],
  message: string,
): RuntimeFailureEvidenceReplayValidationResult<T> {
  return { ok: false, errors: [{ path, code, message }] };
}

function prefixIssues(
  prefix: string,
  issues: RuntimeFailureEvidenceReplayValidationIssue[],
): RuntimeFailureEvidenceReplayValidationIssue[] {
  return issues.map((issue) => ({
    ...issue,
    path: issue.path === "$" ? prefix : `${prefix}.${issue.path}`,
  }));
}

function measureJsonBytes(value: unknown): number | undefined {
  try {
    const raw = JSON.stringify(value);
    if (raw === undefined) {
      return undefined;
    }
    return new TextEncoder().encode(raw).length;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}
