export const RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_FLAG_PATH =
  "runtime.toolGovernance.destructiveOperationGuard.preflight.enabled";

export const RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER =
  "mutation_capable_tool_invocation_preflight";

export const RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_DENIED_REASON =
  "destructive-operation-guard";

export const RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_RUNTIME_COMPONENT_SCHEMA_VERSION =
  "runtime-failure-tool-invocation-governance-destructive-operation-guard-controlled-runtime-component.v1";

export type RuntimeFailureDestructiveOperationGuardPreflightOwner =
  typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER;

export type RuntimeFailureDestructiveOperationGuardPreflightCandidate = {
  ruleId: "destructive_operation_guard";
  toolName: string;
  toolCallId?: string;
  futureActiveCandidate: {
    action: "block";
    requiresAcceptedSpec: true;
  };
  signals: {
    deletedTouchedPathMetadata: boolean;
    wrongFileEditScorecardFail?: boolean;
    unnecessaryEditScorecardFail?: boolean;
    phase5FutureBlockCandidate: boolean;
    falseBlockCorpusPassing: boolean;
  };
  provenance: {
    replayRefs: string[];
    scorecardRefs: string[];
    touchedPathRefs: string[];
    failureRefs?: string[];
    evidenceRefs?: string[];
    phase5FindingRefs?: string[];
  };
};

type RuntimeFailureDestructiveOperationGuardPreflightInput = {
  flagEnabled: boolean;
  owner: RuntimeFailureDestructiveOperationGuardPreflightOwner | string;
  tool: {
    name: string;
    kind?: string;
    inputKind?: string;
    mutationCapable: boolean;
  };
  candidate?: RuntimeFailureDestructiveOperationGuardPreflightCandidate;
};

export type RuntimeFailureDestructiveOperationGuardPreflightAllowReason =
  | "flag_disabled"
  | "owner_not_preflight"
  | "tool_not_mutation_capable"
  | "candidate_missing"
  | "candidate_invalid"
  | "trigger_not_qualified";

export type RuntimeFailureDestructiveOperationGuardPreflightDecision =
  | {
      action: "allow";
      reason: RuntimeFailureDestructiveOperationGuardPreflightAllowReason;
      legacyBehavior: boolean;
    }
  | {
      action: "block";
      deniedReason: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_DENIED_REASON;
      reason: string;
      diagnostics: {
        ruleId: "destructive_operation_guard";
        owner: RuntimeFailureDestructiveOperationGuardPreflightOwner;
        flagPath: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_FLAG_PATH;
        toolName: string;
        toolKind?: string;
        toolInputKind?: string;
        toolCallId?: string;
        provenance: RuntimeFailureDestructiveOperationGuardPreflightCandidate["provenance"];
      };
    };

export type RuntimeFailureDestructiveOperationGuardRuntimePreflightComponentInput = {
  config?: RuntimeFailureDestructiveOperationGuardPreflightConfig;
  tool: {
    name: string;
    kind?: string;
    inputKind?: string;
    mutationCapable: boolean;
  };
  candidate?: RuntimeFailureDestructiveOperationGuardPreflightCandidate;
};

export type RuntimeFailureDestructiveOperationGuardRuntimePreflightComponentMetadata = {
  schemaVersion: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_RUNTIME_COMPONENT_SCHEMA_VERSION;
  componentId: "destructive_operation_guard.runtime_preflight_component";
  layer: "runtime_core_tool_governance_preflight";
  activeRuntimeLayer: "mutation_capable_tool_invocation_preflight";
  runtimeComponent: true;
  defaultOff: true;
  productionReady: false;
  defaultOnApproved: false;
  allowedOwner: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER;
  callerSuppliedOwner: false;
  flagPath: typeof RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_FLAG_PATH;
  activeOwnerExpansionApproved: false;
};

export type RuntimeFailureDestructiveOperationGuardRuntimePreflightComponentResult = {
  metadata: RuntimeFailureDestructiveOperationGuardRuntimePreflightComponentMetadata;
  decision: RuntimeFailureDestructiveOperationGuardPreflightDecision;
};

export type RuntimeFailureDestructiveOperationGuardPreflightConfig = {
  runtime?: {
    toolGovernance?: {
      destructiveOperationGuard?: {
        preflight?: {
          enabled?: boolean;
        };
      };
    };
  };
};

const REF_MAX_CHARS = 160;
const REF_LIMIT = 12;
const BLOCK_REASON =
  "Blocked by default-off destructive_operation_guard preflight pilot: evidence-qualified destructive operation candidate.";

export function resolveRuntimeFailureDestructiveOperationGuardPreflightEnabled(
  config?: RuntimeFailureDestructiveOperationGuardPreflightConfig,
): boolean {
  return config?.runtime?.toolGovernance?.destructiveOperationGuard?.preflight?.enabled === true;
}

function evaluateRuntimeFailureDestructiveOperationGuardPreflight(
  input: RuntimeFailureDestructiveOperationGuardPreflightInput,
): RuntimeFailureDestructiveOperationGuardPreflightDecision {
  if (!input.flagEnabled) {
    return allow("flag_disabled", true);
  }
  if (input.owner !== RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER) {
    return allow("owner_not_preflight", false);
  }
  if (!input.tool.mutationCapable) {
    return allow("tool_not_mutation_capable", false);
  }
  if (!input.candidate) {
    return allow("candidate_missing", false);
  }
  const candidate = sanitizeCandidate(input.candidate);
  if (!isCandidateValidForTool(candidate, input.tool)) {
    return allow("candidate_invalid", false);
  }
  if (!isEvidenceQualifiedTrigger(candidate)) {
    return allow("trigger_not_qualified", false);
  }
  return {
    action: "block",
    deniedReason: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_DENIED_REASON,
    reason: BLOCK_REASON,
    diagnostics: {
      ruleId: "destructive_operation_guard",
      owner: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER,
      flagPath: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_FLAG_PATH,
      toolName: normalizeToolName(input.tool.name),
      ...(input.tool.kind ? { toolKind: sanitizeRef(input.tool.kind) } : {}),
      ...(input.tool.inputKind ? { toolInputKind: sanitizeRef(input.tool.inputKind) } : {}),
      ...(candidate.toolCallId ? { toolCallId: candidate.toolCallId } : {}),
      provenance: candidate.provenance,
    },
  };
}

export function evaluateRuntimeFailureDestructiveOperationGuardRuntimePreflightComponent(
  input: RuntimeFailureDestructiveOperationGuardRuntimePreflightComponentInput,
): RuntimeFailureDestructiveOperationGuardRuntimePreflightComponentResult {
  return {
    metadata: runtimePreflightComponentMetadata(),
    decision: evaluateRuntimeFailureDestructiveOperationGuardPreflight({
      flagEnabled: resolveRuntimeFailureDestructiveOperationGuardPreflightEnabled(input.config),
      owner: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER,
      tool: input.tool,
      candidate: input.candidate,
    }),
  };
}

export function runtimePreflightComponentMetadata():
  RuntimeFailureDestructiveOperationGuardRuntimePreflightComponentMetadata {
  return {
    schemaVersion: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_RUNTIME_COMPONENT_SCHEMA_VERSION,
    componentId: "destructive_operation_guard.runtime_preflight_component",
    layer: "runtime_core_tool_governance_preflight",
    activeRuntimeLayer: "mutation_capable_tool_invocation_preflight",
    runtimeComponent: true,
    defaultOff: true,
    productionReady: false,
    defaultOnApproved: false,
    allowedOwner: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_OWNER,
    callerSuppliedOwner: false,
    flagPath: RUNTIME_FAILURE_DESTRUCTIVE_OPERATION_GUARD_PREFLIGHT_FLAG_PATH,
    activeOwnerExpansionApproved: false,
  };
}

function allow(
  reason: RuntimeFailureDestructiveOperationGuardPreflightAllowReason,
  legacyBehavior: boolean,
): RuntimeFailureDestructiveOperationGuardPreflightDecision {
  return { action: "allow", reason, legacyBehavior };
}

function isCandidateValidForTool(
  candidate: RuntimeFailureDestructiveOperationGuardPreflightCandidate,
  tool: RuntimeFailureDestructiveOperationGuardPreflightInput["tool"],
): boolean {
  return candidate.ruleId === "destructive_operation_guard"
    && candidate.toolName === normalizeToolName(tool.name)
    && candidate.futureActiveCandidate.action === "block"
    && candidate.futureActiveCandidate.requiresAcceptedSpec === true
    && candidate.provenance.replayRefs.length > 0
    && candidate.provenance.scorecardRefs.length > 0
    && candidate.provenance.touchedPathRefs.length > 0;
}

function isEvidenceQualifiedTrigger(
  candidate: RuntimeFailureDestructiveOperationGuardPreflightCandidate,
): boolean {
  return candidate.signals.deletedTouchedPathMetadata === true
    && candidate.signals.phase5FutureBlockCandidate === true
    && candidate.signals.falseBlockCorpusPassing === true
    && (
      candidate.signals.wrongFileEditScorecardFail === true
      || candidate.signals.unnecessaryEditScorecardFail === true
    );
}

function sanitizeCandidate(
  candidate: RuntimeFailureDestructiveOperationGuardPreflightCandidate,
): RuntimeFailureDestructiveOperationGuardPreflightCandidate {
  return {
    ruleId: candidate.ruleId,
    toolName: normalizeToolName(candidate.toolName),
    ...(candidate.toolCallId ? { toolCallId: sanitizeRef(candidate.toolCallId) } : {}),
    futureActiveCandidate: {
      action: candidate.futureActiveCandidate.action,
      requiresAcceptedSpec: candidate.futureActiveCandidate.requiresAcceptedSpec,
    },
    signals: {
      deletedTouchedPathMetadata: candidate.signals.deletedTouchedPathMetadata === true,
      wrongFileEditScorecardFail: candidate.signals.wrongFileEditScorecardFail === true,
      unnecessaryEditScorecardFail: candidate.signals.unnecessaryEditScorecardFail === true,
      phase5FutureBlockCandidate: candidate.signals.phase5FutureBlockCandidate === true,
      falseBlockCorpusPassing: candidate.signals.falseBlockCorpusPassing === true,
    },
    provenance: {
      replayRefs: sanitizeRefs(candidate.provenance.replayRefs),
      scorecardRefs: sanitizeRefs(candidate.provenance.scorecardRefs),
      touchedPathRefs: sanitizeRefs(candidate.provenance.touchedPathRefs),
      failureRefs: sanitizeRefs(candidate.provenance.failureRefs ?? []),
      evidenceRefs: sanitizeRefs(candidate.provenance.evidenceRefs ?? []),
      phase5FindingRefs: sanitizeRefs(candidate.provenance.phase5FindingRefs ?? []),
    },
  };
}

function normalizeToolName(value: string): string {
  return sanitizeRef(value).trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "_");
}

function sanitizeRefs(values: string[]): string[] {
  return [...new Set(values.map((value) => sanitizeRef(value)).filter(Boolean))].slice(0, REF_LIMIT);
}

function sanitizeRef(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]*/g, "[redacted-path]")
    .replace(/(?:\/Users|\/home|\/workspace|\/tmp|\/var\/folders)\/[^\s"',;]+/g, "[redacted-path]")
    .replace(/\b(?:sk|ghp|gho|github_pat)-?[A-Za-z0-9_]{10,}\b/g, "[redacted-secret]")
    .slice(0, REF_MAX_CHARS)
    .trim();
}
