import {
  buildEvidenceRefFixture,
  isEvidenceRef,
  type EvidenceRef,
} from "./evidence.js";
import {
  buildToolCallResultFixture,
  isNonEmptyString,
  isRecord,
  isRuntimeCoreJsonObject,
  isRuntimeTaskStatus,
  isToolCallResult,
  type RuntimeCoreJsonObject,
  type RuntimeTaskStatus,
  type ToolCallResult,
} from "./types.js";

export const EVIDENCE_VERIFIER_EVIDENCE_KINDS = [
  "file",
  "test",
  "tool",
  "trace",
  "human",
] as const;

export type EvidenceVerifierEvidenceKind =
  (typeof EVIDENCE_VERIFIER_EVIDENCE_KINDS)[number];

export const EVIDENCE_VERIFIER_DECISIONS = [
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "insufficient_evidence",
] as const;

export type EvidenceVerifierDecision =
  (typeof EVIDENCE_VERIFIER_DECISIONS)[number];

export const EVIDENCE_VERIFIER_FINDING_SEVERITIES = [
  "info",
  "warning",
  "error",
] as const;

export type EvidenceVerifierFindingSeverity =
  (typeof EVIDENCE_VERIFIER_FINDING_SEVERITIES)[number];

export const EVIDENCE_VERIFIER_FINDING_CATEGORIES = [
  "contract",
  "obligation",
  "evidence",
  "tool",
  "event_replay",
  "external_dependency",
  "cancellation",
] as const;

export type EvidenceVerifierFindingCategory =
  (typeof EVIDENCE_VERIFIER_FINDING_CATEGORIES)[number];

export const EVIDENCE_VERIFIER_FINDING_CODES = [
  "invalid_verifier_input",
  "open_obligation",
  "external_dependency_blocked",
  "blocked_without_external_dependency",
  "missing_file_evidence",
  "missing_test_evidence",
  "missing_tool_evidence",
  "missing_trace_evidence",
  "missing_human_evidence",
  "tool_result_error",
  "tool_result_denied",
  "tool_result_cancelled",
  "event_replay_not_run",
  "event_replay_inconsistent",
  "event_replay_pending_tool",
  "task_cancelled",
] as const;

export type EvidenceVerifierFindingCode =
  (typeof EVIDENCE_VERIFIER_FINDING_CODES)[number];

export const EVIDENCE_VERIFIER_OBLIGATION_STATUSES = [
  "satisfied",
  "open",
  "blocked",
  "cancelled",
] as const;

export type EvidenceVerifierObligationStatus =
  (typeof EVIDENCE_VERIFIER_OBLIGATION_STATUSES)[number];

export const EVIDENCE_VERIFIER_EVENT_REPLAY_STATUSES = [
  "consistent",
  "inconsistent",
  "not_run",
  "cancelled",
] as const;

export type EvidenceVerifierEventReplayStatus =
  (typeof EVIDENCE_VERIFIER_EVENT_REPLAY_STATUSES)[number];

export const EVIDENCE_VERIFIER_FLAG_PATHS = {
  shadow: "runtime.evidenceVerifier.shadow",
  pilot: "runtime.evidenceVerifier.pilot",
} as const;

export type EvidenceVerifierFeatureFlag =
  keyof typeof EVIDENCE_VERIFIER_FLAG_PATHS;

export type EvidenceVerifierFeatureFlags = Record<
  EvidenceVerifierFeatureFlag,
  boolean
>;

export const DEFAULT_EVIDENCE_VERIFIER_FEATURE_FLAGS = {
  shadow: false,
  pilot: false,
} as const satisfies EvidenceVerifierFeatureFlags;

export const DEFAULT_EVIDENCE_VERIFIER_REQUIRED_EVIDENCE_KINDS = [
  "file",
  "test",
  "tool",
] as const satisfies readonly EvidenceVerifierEvidenceKind[];

export type EvidenceVerifierObligation = {
  id: string;
  description: string;
  status: EvidenceVerifierObligationStatus;
  externalDependency?: boolean;
  evidenceRefs?: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type EvidenceVerifierEventReplaySummary = {
  status: EvidenceVerifierEventReplayStatus;
  state?: RuntimeTaskStatus | "unknown";
  diagnosticCodes: string[];
  pendingToolCallIds: string[];
  evidenceRefCount?: number;
  metadata?: RuntimeCoreJsonObject;
};

export type EvidenceVerifierInput = {
  taskId: string;
  objective: string;
  obligations: EvidenceVerifierObligation[];
  evidenceRefs: EvidenceRef[];
  toolResults: ToolCallResult[];
  eventReplay: EvidenceVerifierEventReplaySummary;
  metadata?: RuntimeCoreJsonObject;
};

export type EvidenceVerifierPolicy = {
  requiredEvidenceKinds?: readonly EvidenceVerifierEvidenceKind[];
};

export type EvidenceVerifierFinding = {
  code: EvidenceVerifierFindingCode;
  severity: EvidenceVerifierFindingSeverity;
  category: EvidenceVerifierFindingCategory;
  message: string;
  obligationId?: string;
  toolCallId?: string;
  evidenceRefs: EvidenceRef[];
  metadata?: RuntimeCoreJsonObject;
};

export type EvidenceVerifierReport = {
  taskId: string;
  objective: string;
  decision: EvidenceVerifierDecision;
  findings: EvidenceVerifierFinding[];
  requiredEvidenceKinds: EvidenceVerifierEvidenceKind[];
  evidenceRefs: EvidenceRef[];
  legacyDecisionUnaffected: true;
};

const EVIDENCE_VERIFIER_EVIDENCE_KIND_SET =
  new Set<EvidenceVerifierEvidenceKind>(EVIDENCE_VERIFIER_EVIDENCE_KINDS);
const EVIDENCE_VERIFIER_DECISION_SET =
  new Set<EvidenceVerifierDecision>(EVIDENCE_VERIFIER_DECISIONS);
const EVIDENCE_VERIFIER_FINDING_SEVERITY_SET =
  new Set<EvidenceVerifierFindingSeverity>(
    EVIDENCE_VERIFIER_FINDING_SEVERITIES,
  );
const EVIDENCE_VERIFIER_FINDING_CATEGORY_SET =
  new Set<EvidenceVerifierFindingCategory>(
    EVIDENCE_VERIFIER_FINDING_CATEGORIES,
  );
const EVIDENCE_VERIFIER_FINDING_CODE_SET =
  new Set<EvidenceVerifierFindingCode>(EVIDENCE_VERIFIER_FINDING_CODES);
const EVIDENCE_VERIFIER_OBLIGATION_STATUS_SET =
  new Set<EvidenceVerifierObligationStatus>(
    EVIDENCE_VERIFIER_OBLIGATION_STATUSES,
  );
const EVIDENCE_VERIFIER_EVENT_REPLAY_STATUS_SET =
  new Set<EvidenceVerifierEventReplayStatus>(
    EVIDENCE_VERIFIER_EVENT_REPLAY_STATUSES,
  );

const FAILED_FINDING_CODES = new Set<EvidenceVerifierFindingCode>([
  "invalid_verifier_input",
  "blocked_without_external_dependency",
  "tool_result_error",
  "tool_result_denied",
  "event_replay_inconsistent",
]);

const CANCELLED_FINDING_CODES = new Set<EvidenceVerifierFindingCode>([
  "tool_result_cancelled",
  "task_cancelled",
]);

const BLOCKED_FINDING_CODES = new Set<EvidenceVerifierFindingCode>([
  "external_dependency_blocked",
]);

export function isEvidenceVerifierEvidenceKind(
  value: unknown,
): value is EvidenceVerifierEvidenceKind {
  return (
    typeof value === "string" &&
    EVIDENCE_VERIFIER_EVIDENCE_KIND_SET.has(
      value as EvidenceVerifierEvidenceKind,
    )
  );
}

export function isEvidenceVerifierDecision(
  value: unknown,
): value is EvidenceVerifierDecision {
  return (
    typeof value === "string" &&
    EVIDENCE_VERIFIER_DECISION_SET.has(value as EvidenceVerifierDecision)
  );
}

export function isEvidenceVerifierFindingSeverity(
  value: unknown,
): value is EvidenceVerifierFindingSeverity {
  return (
    typeof value === "string" &&
    EVIDENCE_VERIFIER_FINDING_SEVERITY_SET.has(
      value as EvidenceVerifierFindingSeverity,
    )
  );
}

export function isEvidenceVerifierFindingCategory(
  value: unknown,
): value is EvidenceVerifierFindingCategory {
  return (
    typeof value === "string" &&
    EVIDENCE_VERIFIER_FINDING_CATEGORY_SET.has(
      value as EvidenceVerifierFindingCategory,
    )
  );
}

export function isEvidenceVerifierFindingCode(
  value: unknown,
): value is EvidenceVerifierFindingCode {
  return (
    typeof value === "string" &&
    EVIDENCE_VERIFIER_FINDING_CODE_SET.has(
      value as EvidenceVerifierFindingCode,
    )
  );
}

export function isEvidenceVerifierObligationStatus(
  value: unknown,
): value is EvidenceVerifierObligationStatus {
  return (
    typeof value === "string" &&
    EVIDENCE_VERIFIER_OBLIGATION_STATUS_SET.has(
      value as EvidenceVerifierObligationStatus,
    )
  );
}

export function isEvidenceVerifierEventReplayStatus(
  value: unknown,
): value is EvidenceVerifierEventReplayStatus {
  return (
    typeof value === "string" &&
    EVIDENCE_VERIFIER_EVENT_REPLAY_STATUS_SET.has(
      value as EvidenceVerifierEventReplayStatus,
    )
  );
}

export function isEvidenceVerifierObligation(
  value: unknown,
): value is EvidenceVerifierObligation {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.description) &&
    isEvidenceVerifierObligationStatus(value.status) &&
    (value.externalDependency === undefined ||
      typeof value.externalDependency === "boolean") &&
    (value.evidenceRefs === undefined ||
      (Array.isArray(value.evidenceRefs) &&
        value.evidenceRefs.every(isEvidenceRef))) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isEvidenceVerifierEventReplaySummary(
  value: unknown,
): value is EvidenceVerifierEventReplaySummary {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isEvidenceVerifierEventReplayStatus(value.status) &&
    (value.state === undefined ||
      value.state === "unknown" ||
      isRuntimeTaskStatus(value.state)) &&
    isStringArray(value.diagnosticCodes) &&
    isStringArray(value.pendingToolCallIds) &&
    (value.evidenceRefCount === undefined ||
      (Number.isInteger(value.evidenceRefCount) &&
        Number(value.evidenceRefCount) >= 0)) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isEvidenceVerifierInput(
  value: unknown,
): value is EvidenceVerifierInput {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.taskId) &&
    isNonEmptyString(value.objective) &&
    Array.isArray(value.obligations) &&
    value.obligations.every(isEvidenceVerifierObligation) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef) &&
    Array.isArray(value.toolResults) &&
    value.toolResults.every(isToolCallResult) &&
    isEvidenceVerifierEventReplaySummary(value.eventReplay) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isEvidenceVerifierFinding(
  value: unknown,
): value is EvidenceVerifierFinding {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isEvidenceVerifierFindingCode(value.code) &&
    isEvidenceVerifierFindingSeverity(value.severity) &&
    isEvidenceVerifierFindingCategory(value.category) &&
    isNonEmptyString(value.message) &&
    (value.obligationId === undefined || isNonEmptyString(value.obligationId)) &&
    (value.toolCallId === undefined || isNonEmptyString(value.toolCallId)) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef) &&
    (value.metadata === undefined || isRuntimeCoreJsonObject(value.metadata))
  );
}

export function isEvidenceVerifierReport(
  value: unknown,
): value is EvidenceVerifierReport {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.taskId) &&
    isNonEmptyString(value.objective) &&
    isEvidenceVerifierDecision(value.decision) &&
    Array.isArray(value.findings) &&
    value.findings.every(isEvidenceVerifierFinding) &&
    Array.isArray(value.requiredEvidenceKinds) &&
    value.requiredEvidenceKinds.every(isEvidenceVerifierEvidenceKind) &&
    Array.isArray(value.evidenceRefs) &&
    value.evidenceRefs.every(isEvidenceRef) &&
    value.legacyDecisionUnaffected === true
  );
}

export function resolveEvidenceVerifierFeatureFlags(
  value: unknown,
): EvidenceVerifierFeatureFlags {
  const runtime = runtimeConfigFrom(value);
  const evidenceVerifier = isRecord(runtime?.evidenceVerifier)
    ? runtime.evidenceVerifier
    : undefined;
  return {
    shadow: strictFlag(evidenceVerifier, "shadow"),
    pilot: strictFlag(evidenceVerifier, "pilot"),
  };
}

export function evidenceVerifierFlagEnabled(
  value: unknown,
  flag: EvidenceVerifierFeatureFlag,
): boolean {
  return resolveEvidenceVerifierFeatureFlags(value)[flag];
}

export function evaluateEvidenceVerifier(
  input: unknown,
  policy: EvidenceVerifierPolicy = {},
): EvidenceVerifierReport {
  const requiredEvidenceKinds = normalizeRequiredEvidenceKinds(
    policy.requiredEvidenceKinds,
  );
  if (!isEvidenceVerifierInput(input)) {
    const invalidFinding = makeFinding({
      code: "invalid_verifier_input",
      severity: "error",
      category: "contract",
      message: "Verifier input does not satisfy the canonical evidence verifier contract.",
      evidenceRefs: [],
    });
    return {
      taskId: taskIdFrom(input),
      objective: objectiveFrom(input),
      decision: "failed",
      findings: [invalidFinding],
      requiredEvidenceKinds,
      evidenceRefs: [],
      legacyDecisionUnaffected: true,
    };
  }

  const findings = [
    ...findObligationFindings(input),
    ...findMissingEvidence(input, requiredEvidenceKinds),
    ...findToolResultFindings(input),
    ...findEventReplayFindings(input),
  ];

  return {
    taskId: input.taskId,
    objective: input.objective,
    decision: decideEvidenceVerifier(findings),
    findings,
    requiredEvidenceKinds,
    evidenceRefs: collectEvidenceRefs(input),
    legacyDecisionUnaffected: true,
  };
}

export function buildEvidenceVerifierInputFixture(
  overrides: Partial<EvidenceVerifierInput> = {},
): EvidenceVerifierInput {
  const toolResult = buildToolCallResultFixture({
    evidence: [buildEvidenceRefFixture({ type: "tool", ref: "tool_call_1" })],
  });
  return {
    taskId: "task_1",
    objective: "Prove the requested code change is complete with evidence.",
    obligations: [
      {
        id: "obligation_1",
        description: "Implement the requested change.",
        status: "satisfied",
        evidenceRefs: [buildEvidenceRefFixture({ type: "file", ref: "src/example.ts" })],
      },
    ],
    evidenceRefs: [
      buildEvidenceRefFixture({ type: "file", ref: "src/example.ts" }),
      buildEvidenceRefFixture({ type: "test", ref: "tests/unit/example.test.ts" }),
      buildEvidenceRefFixture({ type: "tool", ref: "tool_call_1" }),
      buildEvidenceRefFixture({ type: "trace", ref: "trace_1" }),
      buildEvidenceRefFixture({ type: "human", ref: "reviewer_confirmation" }),
    ],
    toolResults: [toolResult],
    eventReplay: {
      status: "consistent",
      state: "completed",
      diagnosticCodes: [],
      pendingToolCallIds: [],
      evidenceRefCount: 5,
    },
    ...overrides,
  };
}

function findObligationFindings(
  input: EvidenceVerifierInput,
): EvidenceVerifierFinding[] {
  return input.obligations.flatMap((obligation) => {
    if (obligation.status === "satisfied") {
      return [];
    }
    if (obligation.status === "cancelled") {
      return [
        makeFinding({
          code: "task_cancelled",
          severity: "info",
          category: "cancellation",
          message: `Obligation was cancelled: ${obligation.description}`,
          obligationId: obligation.id,
          evidenceRefs: obligation.evidenceRefs ?? [],
        }),
      ];
    }
    if (obligation.status === "blocked") {
      if (obligation.externalDependency === true) {
        return [
          makeFinding({
            code: "external_dependency_blocked",
            severity: "warning",
            category: "external_dependency",
            message: `Obligation is blocked by an external dependency: ${obligation.description}`,
            obligationId: obligation.id,
            evidenceRefs: obligation.evidenceRefs ?? [],
          }),
        ];
      }
      return [
        makeFinding({
          code: "blocked_without_external_dependency",
          severity: "error",
          category: "obligation",
          message: `Blocked status requires an explicit external dependency: ${obligation.description}`,
          obligationId: obligation.id,
          evidenceRefs: obligation.evidenceRefs ?? [],
        }),
      ];
    }
    return [
      makeFinding({
        code: "open_obligation",
        severity: "warning",
        category: "obligation",
        message: `Open obligation is not yet satisfied: ${obligation.description}`,
        obligationId: obligation.id,
        evidenceRefs: obligation.evidenceRefs ?? [],
      }),
    ];
  });
}

function findMissingEvidence(
  input: EvidenceVerifierInput,
  requiredEvidenceKinds: readonly EvidenceVerifierEvidenceKind[],
): EvidenceVerifierFinding[] {
  const presentKinds = new Set(
    collectEvidenceRefs(input).flatMap((ref) =>
      isEvidenceVerifierEvidenceKind(ref.type) ? [ref.type] : []
    ),
  );

  return requiredEvidenceKinds.flatMap((kind) =>
    presentKinds.has(kind)
      ? []
      : [
          makeFinding({
            code: missingEvidenceCode(kind),
            severity: "warning",
            category: "evidence",
            message: `Missing required ${kind} evidence for verifier completion.`,
            evidenceRefs: [],
          }),
        ]
  );
}

function findToolResultFindings(
  input: EvidenceVerifierInput,
): EvidenceVerifierFinding[] {
  return input.toolResults.flatMap((result) => {
    if (result.status === "success") {
      return [];
    }
    if (result.status === "cancelled") {
      return [
        makeFinding({
          code: "tool_result_cancelled",
          severity: "info",
          category: "cancellation",
          message: `Tool result was cancelled: ${result.callId}`,
          toolCallId: result.callId,
          evidenceRefs: result.evidence,
        }),
      ];
    }
    return [
        makeFinding({
        code: result.status === "denied" ? "tool_result_denied" : "tool_result_error",
        severity: "error",
        category: "tool",
        message: `Tool result is not successful: ${result.callId}`,
        toolCallId: result.callId,
        evidenceRefs: result.evidence,
      }),
    ];
  });
}

function findEventReplayFindings(
  input: EvidenceVerifierInput,
): EvidenceVerifierFinding[] {
  const replay = input.eventReplay;
  const findings: EvidenceVerifierFinding[] = [];
  if (replay.status === "cancelled") {
    findings.push(
      makeFinding({
        code: "task_cancelled",
        severity: "info",
        category: "cancellation",
        message: "Event replay reports a cancelled task.",
        evidenceRefs: [],
      }),
    );
  }
  if (replay.status === "inconsistent") {
    findings.push(
      makeFinding({
        code: "event_replay_inconsistent",
        severity: "error",
        category: "event_replay",
        message: "Event replay reports inconsistent runtime state.",
        evidenceRefs: [],
        metadata: { diagnosticCodes: replay.diagnosticCodes },
      }),
    );
  }
  if (replay.status === "not_run") {
    findings.push(
      makeFinding({
        code: "event_replay_not_run",
        severity: "warning",
        category: "event_replay",
        message: "Event replay summary was not run for this verifier input.",
        evidenceRefs: [],
      }),
    );
  }
  if (replay.pendingToolCallIds.length > 0) {
    findings.push(
      makeFinding({
        code: "event_replay_pending_tool",
        severity: "warning",
        category: "event_replay",
        message: "Event replay still has pending tool calls.",
        evidenceRefs: [],
        metadata: { pendingToolCallIds: replay.pendingToolCallIds },
      }),
    );
  }
  return findings;
}

function decideEvidenceVerifier(
  findings: readonly EvidenceVerifierFinding[],
): EvidenceVerifierDecision {
  if (findings.some((item) => FAILED_FINDING_CODES.has(item.code))) {
    return "failed";
  }
  if (findings.some((item) => CANCELLED_FINDING_CODES.has(item.code))) {
    return "cancelled";
  }
  if (findings.some((item) => BLOCKED_FINDING_CODES.has(item.code))) {
    return "blocked";
  }
  if (findings.length > 0) {
    return "insufficient_evidence";
  }
  return "completed";
}

function collectEvidenceRefs(input: EvidenceVerifierInput): EvidenceRef[] {
  return [
    ...input.evidenceRefs,
    ...input.toolResults.flatMap((result) => result.evidence),
    ...input.obligations.flatMap((obligation) => obligation.evidenceRefs ?? []),
  ].map(cloneJson);
}

function normalizeRequiredEvidenceKinds(
  value: readonly EvidenceVerifierEvidenceKind[] | undefined,
): EvidenceVerifierEvidenceKind[] {
  const kinds = value ?? DEFAULT_EVIDENCE_VERIFIER_REQUIRED_EVIDENCE_KINDS;
  return Array.from(new Set(kinds.filter(isEvidenceVerifierEvidenceKind)));
}

function missingEvidenceCode(
  kind: EvidenceVerifierEvidenceKind,
): EvidenceVerifierFindingCode {
  switch (kind) {
    case "file":
      return "missing_file_evidence";
    case "test":
      return "missing_test_evidence";
    case "tool":
      return "missing_tool_evidence";
    case "trace":
      return "missing_trace_evidence";
    case "human":
      return "missing_human_evidence";
  }
}

function makeFinding(
  value: Omit<EvidenceVerifierFinding, "evidenceRefs"> & {
    evidenceRefs?: EvidenceRef[];
  },
): EvidenceVerifierFinding {
  return {
    ...value,
    evidenceRefs: value.evidenceRefs?.map(cloneJson) ?? [],
  };
}

function runtimeConfigFrom(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (isRecord(value.runtime)) {
    return value.runtime;
  }
  return value;
}

function strictFlag(section: unknown, key: string): boolean {
  return isRecord(section) && section[key] === true;
}

function taskIdFrom(value: unknown): string {
  return isRecord(value) && isNonEmptyString(value.taskId)
    ? value.taskId
    : "unknown";
}

function objectiveFrom(value: unknown): string {
  return isRecord(value) && isNonEmptyString(value.objective)
    ? value.objective
    : "unknown";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
