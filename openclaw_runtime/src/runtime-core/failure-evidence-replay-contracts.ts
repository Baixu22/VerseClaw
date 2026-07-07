export const FAILURE_EVENT_STAGES = [
  "planning",
  "tool_call",
  "patch",
  "test",
  "provider",
  "gateway",
  "user_interrupt",
  "unknown",
] as const;

export type FailureStage = typeof FAILURE_EVENT_STAGES[number];

export const FAILURE_EVENT_KINDS = [
  "permission",
  "path",
  "dependency",
  "timeout",
  "type_error",
  "test_failure",
  "environment_contamination",
  "context_insufficient",
  "provider_error",
  "gateway_error",
  "unknown",
] as const;

export type FailureKind = typeof FAILURE_EVENT_KINDS[number];

export const FAILURE_RECOVERABILITIES = [
  "auto_recoverable",
  "retryable",
  "ask_user",
  "rollback_recommended",
  "non_recoverable",
  "unknown",
] as const;

export type FailureRecoverability = typeof FAILURE_RECOVERABILITIES[number];

export const FAILURE_SUGGESTED_ACTIONS = [
  "retry",
  "ask_user",
  "rollback_recommended",
  "degrade",
  "stop",
  "continue_with_caution",
] as const;

export type FailureSuggestedAction = typeof FAILURE_SUGGESTED_ACTIONS[number];

export const FAILURE_REDACTION_STATES = ["metadata_only", "sanitized"] as const;

export type FailureRedactionState = typeof FAILURE_REDACTION_STATES[number];

export type FailureEvent = {
  id: string;
  runId?: string;
  stage: FailureStage;
  kind: FailureKind;
  recoverability: FailureRecoverability;
  suggestedAction: FailureSuggestedAction;
  confidence: number;
  source: string;
  occurredAt: string;
  summary: string;
  evidenceRefs: string[];
  rawRetained: false;
  redaction: FailureRedactionState;
};

export const EVIDENCE_ENVELOPE_KINDS = [
  "failure_summary",
  "test_result_summary",
  "file_change_summary",
  "agent_map_summary",
  "benchmark_summary",
  "replay_summary",
  "tool_result_summary",
] as const;

export type EvidenceEnvelopeKind = typeof EVIDENCE_ENVELOPE_KINDS[number];

export const EVIDENCE_REDACTION_STATES = ["metadata_only", "sanitized", "redacted"] as const;

export type EvidenceRedactionState = typeof EVIDENCE_REDACTION_STATES[number];

export type EvidenceEnvelopeSource = {
  component: string;
  runId?: string;
  command?: string;
  file?: string;
};

export type EvidenceEnvelopeScope = {
  workspace?: string;
  sessionId?: string;
  runId?: string;
  taskId?: string;
  paths?: string[];
};

export type EvidenceEnvelopeRedaction = {
  state: EvidenceRedactionState;
  rawRetained: false;
  secretScan: "pass" | "not_run";
};

export type EvidenceEnvelopeProvenance = {
  producer: string;
  version: string;
  inputs: string[];
};

export type EvidenceEnvelope = {
  id: string;
  kind: EvidenceEnvelopeKind;
  source: EvidenceEnvelopeSource;
  scope: EvidenceEnvelopeScope;
  createdAt: string;
  ttlMs: number;
  confidence: number;
  redaction: EvidenceEnvelopeRedaction;
  provenance: EvidenceEnvelopeProvenance;
  authority: "none";
  payload: unknown;
  rawRetained?: false;
};

export const REPLAY_CASE_SCENARIOS = [
  "success",
  "tool_error",
  "test_failure",
  "provider_timeout",
  "dirty_workspace",
  "blocked",
  "long_context",
  "flaky_test",
  "user_interruption",
  "budget_exhausted",
] as const;

export type ReplayCaseScenario = typeof REPLAY_CASE_SCENARIOS[number];

export const REPLAY_CASE_TERMINAL_STATUSES = [
  "completed",
  "blocked",
  "failed",
  "interrupted",
] as const;

export type ReplayCaseTerminalStatus = typeof REPLAY_CASE_TERMINAL_STATUSES[number];

export type ReplayCaseInput = {
  userMessage: string;
  workspaceFixture: string;
  providerFixture: string;
  toolFixture: string;
  configFixture?: string;
};

export type ReplayCaseExpected = {
  terminalStatus: ReplayCaseTerminalStatus;
  allowedFailureKinds?: FailureKind[];
  disallowedActions?: FailureSuggestedAction[];
  touchedPaths?: string[];
};

export type ReplayCaseBudgets = {
  maxPromptBytes?: number;
  maxToolCalls?: number;
  maxDurationMs?: number;
};

export type ReplayCase = {
  id: string;
  title: string;
  scenario: ReplayCaseScenario;
  input: ReplayCaseInput;
  expected: ReplayCaseExpected;
  budgets: ReplayCaseBudgets;
};

export const RUNTIME_EVIDENCE_ENVELOPE_PAYLOAD_MAX_BYTES = 8192;

export type RuntimeFailureEvidenceReplayValidationCode =
  | "missing_required"
  | "invalid_type"
  | "invalid_enum"
  | "malformed_timestamp"
  | "expired"
  | "invalid_authority"
  | "raw_retained"
  | "invalid_confidence"
  | "invalid_ttl"
  | "payload_oversized"
  | "payload_not_json"
  | "missing_fixture"
  | "live_provider_default"
  | "invalid_budget";

export type RuntimeFailureEvidenceReplayValidationIssue = {
  path: string;
  code: RuntimeFailureEvidenceReplayValidationCode;
  message: string;
};

export type RuntimeFailureEvidenceReplayValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: RuntimeFailureEvidenceReplayValidationIssue[] };

type ValidationIssueSink = RuntimeFailureEvidenceReplayValidationIssue[];

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

const LIVE_PROVIDER_FIXTURE_PATTERN = /^(?:live|live_provider|provider:live|network|default)(?:$|[:_\-])/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isEnumValue<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function addIssue(
  issues: ValidationIssueSink,
  path: string,
  code: RuntimeFailureEvidenceReplayValidationCode,
  message: string,
): void {
  issues.push({ path, code, message });
}

function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  issues: ValidationIssueSink,
  path = key,
): void {
  if (!hasOwn(record, key)) {
    addIssue(issues, path, "missing_required", `${path} is required.`);
    return;
  }
  if (!isNonEmptyString(record[key])) {
    addIssue(issues, path, "invalid_type", `${path} must be a non-empty string.`);
  }
}

function validateEnum<const T extends readonly string[]>(
  values: T,
  value: unknown,
  issues: ValidationIssueSink,
  path: string,
): void {
  if (!isEnumValue(values, value)) {
    addIssue(issues, path, "invalid_enum", `${path} must be one of: ${values.join(", ")}.`);
  }
}

function validateConfidence(value: unknown, issues: ValidationIssueSink, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    addIssue(issues, path, "invalid_confidence", `${path} must be a finite number from 0 to 1.`);
  }
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function validateTimestamp(value: unknown, issues: ValidationIssueSink, path: string): number | undefined {
  if (!isValidTimestamp(value)) {
    addIssue(issues, path, "malformed_timestamp", `${path} must be an ISO timestamp with timezone.`);
    return undefined;
  }
  return Date.parse(value);
}

function validateStringArray(value: unknown, issues: ValidationIssueSink, path: string): void {
  if (!isStringArray(value)) {
    addIssue(issues, path, "invalid_type", `${path} must be an array of strings.`);
  }
}

function makeResult<T>(
  value: T,
  issues: ValidationIssueSink,
): RuntimeFailureEvidenceReplayValidationResult<T> {
  return issues.length ? { ok: false, errors: issues } : { ok: true, value };
}

export function validateFailureEvent(
  value: unknown,
): RuntimeFailureEvidenceReplayValidationResult<FailureEvent> {
  const issues: ValidationIssueSink = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [{ path: "$", code: "invalid_type", message: "FailureEvent must be an object." }],
    };
  }

  requireNonEmptyString(value, "id", issues);
  if (value.runId !== undefined && !isNonEmptyString(value.runId)) {
    addIssue(issues, "runId", "invalid_type", "runId must be a non-empty string when present.");
  }
  validateEnum(FAILURE_EVENT_STAGES, value.stage, issues, "stage");
  validateEnum(FAILURE_EVENT_KINDS, value.kind, issues, "kind");
  validateEnum(FAILURE_RECOVERABILITIES, value.recoverability, issues, "recoverability");
  validateEnum(FAILURE_SUGGESTED_ACTIONS, value.suggestedAction, issues, "suggestedAction");
  validateConfidence(value.confidence, issues, "confidence");
  requireNonEmptyString(value, "source", issues);
  validateTimestamp(value.occurredAt, issues, "occurredAt");
  requireNonEmptyString(value, "summary", issues);
  validateStringArray(value.evidenceRefs, issues, "evidenceRefs");
  if (value.rawRetained !== false) {
    addIssue(issues, "rawRetained", "raw_retained", "rawRetained must be false.");
  }
  validateEnum(FAILURE_REDACTION_STATES, value.redaction, issues, "redaction");

  return makeResult(value as FailureEvent, issues);
}

export type ValidateEvidenceEnvelopeOptions = {
  nowMs?: number;
  maxPayloadBytes?: number;
};

export function validateEvidenceEnvelope(
  value: unknown,
  options: ValidateEvidenceEnvelopeOptions = {},
): RuntimeFailureEvidenceReplayValidationResult<EvidenceEnvelope> {
  const issues: ValidationIssueSink = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [{ path: "$", code: "invalid_type", message: "EvidenceEnvelope must be an object." }],
    };
  }

  requireNonEmptyString(value, "id", issues);
  validateEnum(EVIDENCE_ENVELOPE_KINDS, value.kind, issues, "kind");
  validateEvidenceSource(value.source, issues);
  validateEvidenceScope(value.scope, issues);
  const createdAtMs = validateTimestamp(value.createdAt, issues, "createdAt");
  validateTtl(value.ttlMs, issues);
  validateConfidence(value.confidence, issues, "confidence");
  validateEvidenceRedaction(value.redaction, issues);
  validateEvidenceProvenance(value.provenance, issues);
  if (value.authority !== "none") {
    addIssue(issues, "authority", "invalid_authority", "authority must be none.");
  }
  if (value.rawRetained === true) {
    addIssue(issues, "rawRetained", "raw_retained", "top-level rawRetained must not be true.");
  }
  if (!hasOwn(value, "payload")) {
    addIssue(issues, "payload", "missing_required", "payload is required.");
  } else {
    validatePayloadBudget(value.payload, issues, options.maxPayloadBytes);
  }
  if (createdAtMs !== undefined && typeof value.ttlMs === "number" && Number.isFinite(value.ttlMs) && value.ttlMs > 0) {
    const nowMs = options.nowMs ?? Date.now();
    if (createdAtMs + value.ttlMs <= nowMs) {
      addIssue(issues, "ttlMs", "expired", "EvidenceEnvelope is expired.");
    }
  }

  return makeResult(value as EvidenceEnvelope, issues);
}

function validateEvidenceSource(value: unknown, issues: ValidationIssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "source", "missing_required", "source is required.");
    return;
  }
  requireNonEmptyString(value, "component", issues, "source.component");
  for (const key of ["runId", "command", "file"] as const) {
    if (value[key] !== undefined && !isNonEmptyString(value[key])) {
      addIssue(issues, `source.${key}`, "invalid_type", `source.${key} must be a non-empty string when present.`);
    }
  }
}

function validateEvidenceScope(value: unknown, issues: ValidationIssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "scope", "missing_required", "scope is required.");
    return;
  }
  for (const key of ["workspace", "sessionId", "runId", "taskId"] as const) {
    if (value[key] !== undefined && !isNonEmptyString(value[key])) {
      addIssue(issues, `scope.${key}`, "invalid_type", `scope.${key} must be a non-empty string when present.`);
    }
  }
  if (value.paths !== undefined) {
    validateStringArray(value.paths, issues, "scope.paths");
  }
}

function validateEvidenceRedaction(value: unknown, issues: ValidationIssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "redaction", "missing_required", "redaction is required.");
    return;
  }
  validateEnum(EVIDENCE_REDACTION_STATES, value.state, issues, "redaction.state");
  if (value.rawRetained !== false) {
    addIssue(issues, "redaction.rawRetained", "raw_retained", "redaction.rawRetained must be false.");
  }
  validateEnum(["pass", "not_run"] as const, value.secretScan, issues, "redaction.secretScan");
}

function validateEvidenceProvenance(value: unknown, issues: ValidationIssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "provenance", "missing_required", "provenance is required.");
    return;
  }
  requireNonEmptyString(value, "producer", issues, "provenance.producer");
  requireNonEmptyString(value, "version", issues, "provenance.version");
  validateStringArray(value.inputs, issues, "provenance.inputs");
}

function validateTtl(value: unknown, issues: ValidationIssueSink): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    addIssue(issues, "ttlMs", "invalid_ttl", "ttlMs must be a positive finite number.");
  }
}

function validatePayloadBudget(
  value: unknown,
  issues: ValidationIssueSink,
  maxPayloadBytes = RUNTIME_EVIDENCE_ENVELOPE_PAYLOAD_MAX_BYTES,
): void {
  const encoded = measureJsonPayloadBytes(value);
  if (encoded === undefined) {
    addIssue(issues, "payload", "payload_not_json", "payload must be JSON-serializable.");
    return;
  }
  if (encoded > maxPayloadBytes) {
    addIssue(
      issues,
      "payload",
      "payload_oversized",
      `payload must be at most ${maxPayloadBytes} JSON bytes.`,
    );
  }
}

function measureJsonPayloadBytes(value: unknown): number | undefined {
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

export function validateReplayCase(
  value: unknown,
): RuntimeFailureEvidenceReplayValidationResult<ReplayCase> {
  const issues: ValidationIssueSink = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: [{ path: "$", code: "invalid_type", message: "ReplayCase must be an object." }],
    };
  }

  requireNonEmptyString(value, "id", issues);
  requireNonEmptyString(value, "title", issues);
  validateEnum(REPLAY_CASE_SCENARIOS, value.scenario, issues, "scenario");
  validateReplayInput(value.input, issues);
  validateReplayExpected(value.expected, issues);
  validateReplayBudgets(value.budgets, issues);

  return makeResult(value as ReplayCase, issues);
}

function validateReplayInput(value: unknown, issues: ValidationIssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "input", "missing_required", "input is required.");
    return;
  }
  requireNonEmptyString(value, "userMessage", issues, "input.userMessage");
  for (const key of ["workspaceFixture", "providerFixture", "toolFixture"] as const) {
    if (!hasOwn(value, key)) {
      addIssue(issues, `input.${key}`, "missing_fixture", `input.${key} is required.`);
    } else if (!isNonEmptyString(value[key])) {
      addIssue(issues, `input.${key}`, "missing_fixture", `input.${key} must be a non-empty fixture id.`);
    }
  }
  if (value.configFixture !== undefined && !isNonEmptyString(value.configFixture)) {
    addIssue(issues, "input.configFixture", "invalid_type", "input.configFixture must be non-empty when present.");
  }
  if (value.liveProvider === true) {
    addIssue(issues, "input.liveProvider", "live_provider_default", "ReplayCase must not default to a live provider.");
  }
  if (typeof value.providerFixture === "string" && LIVE_PROVIDER_FIXTURE_PATTERN.test(value.providerFixture)) {
    addIssue(
      issues,
      "input.providerFixture",
      "live_provider_default",
      "providerFixture must reference a fixture, not a live provider default.",
    );
  }
}

function validateReplayExpected(value: unknown, issues: ValidationIssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "expected", "missing_required", "expected is required.");
    return;
  }
  validateEnum(REPLAY_CASE_TERMINAL_STATUSES, value.terminalStatus, issues, "expected.terminalStatus");
  if (value.allowedFailureKinds !== undefined) {
    if (!Array.isArray(value.allowedFailureKinds)) {
      addIssue(issues, "expected.allowedFailureKinds", "invalid_type", "expected.allowedFailureKinds must be an array.");
    } else {
      value.allowedFailureKinds.forEach((kind, index) => {
        validateEnum(FAILURE_EVENT_KINDS, kind, issues, `expected.allowedFailureKinds.${index}`);
      });
    }
  }
  if (value.disallowedActions !== undefined) {
    if (!Array.isArray(value.disallowedActions)) {
      addIssue(issues, "expected.disallowedActions", "invalid_type", "expected.disallowedActions must be an array.");
    } else {
      value.disallowedActions.forEach((action, index) => {
        validateEnum(FAILURE_SUGGESTED_ACTIONS, action, issues, `expected.disallowedActions.${index}`);
      });
    }
  }
  if (value.touchedPaths !== undefined) {
    validateStringArray(value.touchedPaths, issues, "expected.touchedPaths");
  }
}

function validateReplayBudgets(value: unknown, issues: ValidationIssueSink): void {
  if (!isRecord(value)) {
    addIssue(issues, "budgets", "missing_required", "budgets is required.");
    return;
  }
  const budgetKeys = ["maxPromptBytes", "maxToolCalls", "maxDurationMs"] as const;
  if (!budgetKeys.some((key) => value[key] !== undefined)) {
    addIssue(issues, "budgets", "invalid_budget", "budgets must define at least one positive limit.");
  }
  for (const key of budgetKeys) {
    if (value[key] !== undefined && (!Number.isInteger(value[key]) || Number(value[key]) <= 0)) {
      addIssue(issues, `budgets.${key}`, "invalid_budget", `budgets.${key} must be a positive integer.`);
    }
  }
}
