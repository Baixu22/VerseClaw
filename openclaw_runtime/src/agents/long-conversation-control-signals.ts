export type LongConversationControlSignalKind =
  | "evidence_gap"
  | "validation_missing"
  | "scope_drift"
  | "unverified_claim"
  | "replan_required"
  | "permission_wait"
  | "blocked_dependency"
  | "risk"
  | "recovery_gap";

export type LongConversationControlSignalSeverity = "info" | "warning" | "blocking";

export type LongConversationSuggestedAction =
  | "continue"
  | "repair"
  | "replan"
  | "ask_user"
  | "block"
  | "sleep"
  | "verify";

export type LongConversationQualityDimension =
  | "scope"
  | "evidence"
  | "validation"
  | "risk"
  | "recovery"
  | "security";

export type LongConversationQualityStatus = "pass" | "gap" | "fail" | "unknown";

export type LongConversationEvidenceRef = {
  type: string;
  ref: string;
  label?: string;
  summary?: string;
};

export type LongConversationControlSignal = {
  kind: LongConversationControlSignalKind;
  severity: LongConversationControlSignalSeverity;
  message: string;
  suggestedAction?: LongConversationSuggestedAction;
  source?: string;
  refs?: string[];
  evidenceRefs?: LongConversationEvidenceRef[];
  details?: Record<string, unknown>;
};

export type LongConversationValidationState = {
  status: "unknown" | "not_run" | "passed" | "failed" | "partial" | "missing";
  checks: string[];
  evidenceRefs: LongConversationEvidenceRef[];
  summary?: string;
};

export type LongConversationAcceptanceStatus = {
  status: "unknown" | "satisfied" | "partial" | "missing" | "changed";
  criteria: string[];
  gaps: string[];
  summary?: string;
};

export type LongConversationQualityAssessment = {
  dimension: LongConversationQualityDimension;
  status: LongConversationQualityStatus;
  summary?: string;
  signalKinds?: LongConversationControlSignalKind[];
};

const SIGNAL_KINDS = new Set<LongConversationControlSignalKind>([
  "evidence_gap",
  "validation_missing",
  "scope_drift",
  "unverified_claim",
  "replan_required",
  "permission_wait",
  "blocked_dependency",
  "risk",
  "recovery_gap",
]);

const SIGNAL_SEVERITIES = new Set<LongConversationControlSignalSeverity>([
  "info",
  "warning",
  "blocking",
]);

const SUGGESTED_ACTIONS = new Set<LongConversationSuggestedAction>([
  "continue",
  "repair",
  "replan",
  "ask_user",
  "block",
  "sleep",
  "verify",
]);

const VALIDATION_STATUSES = new Set<LongConversationValidationState["status"]>([
  "unknown",
  "not_run",
  "passed",
  "failed",
  "partial",
  "missing",
]);

const ACCEPTANCE_STATUSES = new Set<LongConversationAcceptanceStatus["status"]>([
  "unknown",
  "satisfied",
  "partial",
  "missing",
  "changed",
]);

const QUALITY_DIMENSIONS: LongConversationQualityDimension[] = [
  "scope",
  "evidence",
  "validation",
  "risk",
  "recovery",
  "security",
];

const QUALITY_STATUSES = new Set<LongConversationQualityStatus>([
  "pass",
  "gap",
  "fail",
  "unknown",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function stringArray(value: unknown, max = 50, maxChars = 1_000): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, maxChars)] : [])
    .slice(0, max);
}

function optionalString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.slice(0, maxChars);
}

export function normalizeEvidenceRefs(value: unknown, max = 50): LongConversationEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const ref = optionalString(record.ref, 1_000);
    if (!ref) return [];
    const label = optionalString(record.label, 500);
    const summary = optionalString(record.summary, 2_000);
    return [{
      type: optionalString(record.type, 80) ?? "other",
      ref,
      ...(label ? { label } : {}),
      ...(summary ? { summary } : {}),
    }];
  }).slice(0, max);
}

export function normalizeControlSignals(value: unknown, max = 50): LongConversationControlSignal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const kind = SIGNAL_KINDS.has(record.kind as LongConversationControlSignalKind)
      ? record.kind as LongConversationControlSignalKind
      : undefined;
    const message = optionalString(record.message, 1_000);
    if (!kind || !message) return [];
    const severity = SIGNAL_SEVERITIES.has(record.severity as LongConversationControlSignalSeverity)
      ? record.severity as LongConversationControlSignalSeverity
      : "warning";
    const suggestedAction = SUGGESTED_ACTIONS.has(record.suggestedAction as LongConversationSuggestedAction)
      ? record.suggestedAction as LongConversationSuggestedAction
      : undefined;
    const source = optionalString(record.source, 120);
    const refs = stringArray(record.refs, 20);
    const evidenceRefs = normalizeEvidenceRefs(record.evidenceRefs, 20);
    const details = asRecord(record.details);
    return [{
      kind,
      severity,
      message,
      ...(suggestedAction ? { suggestedAction } : {}),
      ...(source ? { source } : {}),
      ...(refs.length ? { refs } : {}),
      ...(evidenceRefs.length ? { evidenceRefs } : {}),
      ...(details ? { details } : {}),
    }];
  }).slice(0, max);
}

export function normalizeValidationState(value: unknown): LongConversationValidationState | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const status = VALIDATION_STATUSES.has(record.status as LongConversationValidationState["status"])
    ? record.status as LongConversationValidationState["status"]
    : "unknown";
  const summary = optionalString(record.summary, 1_000);
  return {
    status,
    checks: stringArray(record.checks, 50),
    evidenceRefs: normalizeEvidenceRefs(record.evidenceRefs, 50),
    ...(summary ? { summary } : {}),
  };
}

export function normalizeAcceptanceStatus(value: unknown): LongConversationAcceptanceStatus | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const status = ACCEPTANCE_STATUSES.has(record.status as LongConversationAcceptanceStatus["status"])
    ? record.status as LongConversationAcceptanceStatus["status"]
    : "unknown";
  const summary = optionalString(record.summary, 1_000);
  return {
    status,
    criteria: stringArray(record.criteria, 50),
    gaps: stringArray(record.gaps, 50),
    ...(summary ? { summary } : {}),
  };
}

export function normalizeQualityAssessments(value: unknown): LongConversationQualityAssessment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const dimension = QUALITY_DIMENSIONS.includes(record.dimension as LongConversationQualityDimension)
      ? record.dimension as LongConversationQualityDimension
      : undefined;
    if (!dimension) return [];
    const summary = optionalString(record.summary, 500);
    const signalKinds = stringArray(record.signalKinds, 20).filter((kind): kind is LongConversationControlSignalKind =>
      SIGNAL_KINDS.has(kind as LongConversationControlSignalKind),
    );
    return [{
      dimension,
      status: QUALITY_STATUSES.has(record.status as LongConversationQualityStatus)
        ? record.status as LongConversationQualityStatus
        : "unknown",
      ...(summary ? { summary } : {}),
      ...(signalKinds.length ? { signalKinds } : {}),
    }];
  }).slice(0, QUALITY_DIMENSIONS.length);
}

export function signalsFromGaps(input: {
  missingEvidence?: readonly string[];
  verificationGaps?: readonly string[];
  risks?: readonly string[];
  source: string;
  repairable?: boolean;
}): LongConversationControlSignal[] {
  const suggestedAction: LongConversationSuggestedAction = input.repairable === false ? "block" : "repair";
  return [
    ...(input.missingEvidence ?? []).map((message): LongConversationControlSignal => ({
      kind: "evidence_gap",
      severity: input.repairable === false ? "blocking" : "warning",
      message,
      suggestedAction,
      source: input.source,
    })),
    ...(input.verificationGaps ?? []).map((message): LongConversationControlSignal => ({
      kind: "validation_missing",
      severity: input.repairable === false ? "blocking" : "warning",
      message,
      suggestedAction: input.repairable === false ? "block" : "verify",
      source: input.source,
    })),
    ...(input.risks ?? []).map((message): LongConversationControlSignal => ({
      kind: "risk",
      severity: "warning",
      message,
      suggestedAction: input.repairable === false ? "block" : "repair",
      source: input.source,
    })),
  ];
}

export function deriveValidationState(input: {
  status?: LongConversationValidationState["status"];
  checks?: readonly string[];
  gaps?: readonly string[];
  evidenceRefs?: readonly LongConversationEvidenceRef[];
  summary?: string;
}): LongConversationValidationState {
  const gaps = (input.gaps ?? []).filter(Boolean);
  const checks = (input.checks ?? []).filter(Boolean);
  return {
    status: input.status ?? (gaps.length ? "missing" : checks.length ? "passed" : "unknown"),
    checks: [...checks, ...gaps].slice(0, 50),
    evidenceRefs: [...(input.evidenceRefs ?? [])].slice(0, 50),
    ...(input.summary ? { summary: input.summary.slice(0, 1_000) } : {}),
  };
}

export function deriveAcceptanceStatus(input: {
  acceptance?: readonly string[];
  gaps?: readonly string[];
  satisfied?: boolean;
  summary?: string;
}): LongConversationAcceptanceStatus {
  const criteria = (input.acceptance ?? []).filter(Boolean);
  const gaps = (input.gaps ?? []).filter(Boolean);
  return {
    status: input.satisfied === true && gaps.length === 0
      ? "satisfied"
      : gaps.length
        ? "partial"
        : criteria.length
          ? "unknown"
          : "missing",
    criteria: criteria.slice(0, 50),
    gaps: gaps.slice(0, 50),
    ...(input.summary ? { summary: input.summary.slice(0, 1_000) } : {}),
  };
}

export function defaultQualityAssessments(input: {
  signals?: readonly LongConversationControlSignal[];
  validationState?: LongConversationValidationState;
} = {}): LongConversationQualityAssessment[] {
  const signals = input.signals ?? [];
  const hasKind = (kind: LongConversationControlSignalKind) => signals.some((signal) => signal.kind === kind);
  const blocking = (kind: LongConversationControlSignalKind) =>
    signals.some((signal) => signal.kind === kind && signal.severity === "blocking");
  return [
    {
      dimension: "scope",
      status: hasKind("scope_drift") || hasKind("replan_required") ? "gap" : "unknown",
      signalKinds: signals.filter((signal) => signal.kind === "scope_drift" || signal.kind === "replan_required").map((signal) => signal.kind),
    },
    {
      dimension: "evidence",
      status: blocking("evidence_gap") ? "fail" : hasKind("evidence_gap") || hasKind("unverified_claim") ? "gap" : "unknown",
      signalKinds: signals.filter((signal) => signal.kind === "evidence_gap" || signal.kind === "unverified_claim").map((signal) => signal.kind),
    },
    {
      dimension: "validation",
      status: input.validationState?.status === "passed"
        ? "pass"
        : blocking("validation_missing") || input.validationState?.status === "failed"
          ? "fail"
          : hasKind("validation_missing") || input.validationState?.status === "missing" || input.validationState?.status === "partial"
            ? "gap"
            : "unknown",
      signalKinds: signals.filter((signal) => signal.kind === "validation_missing").map((signal) => signal.kind),
    },
    {
      dimension: "risk",
      status: blocking("risk") ? "fail" : hasKind("risk") ? "gap" : "unknown",
      signalKinds: signals.filter((signal) => signal.kind === "risk").map((signal) => signal.kind),
    },
    {
      dimension: "recovery",
      status: hasKind("recovery_gap") ? "gap" : "unknown",
      signalKinds: signals.filter((signal) => signal.kind === "recovery_gap").map((signal) => signal.kind),
    },
    {
      dimension: "security",
      status: hasKind("permission_wait") ? "gap" : "unknown",
      signalKinds: signals.filter((signal) => signal.kind === "permission_wait").map((signal) => signal.kind),
    },
  ];
}

export function hasBlockingControlSignal(signals: readonly LongConversationControlSignal[] | undefined): boolean {
  return (signals ?? []).some((signal) => signal.severity === "blocking");
}
