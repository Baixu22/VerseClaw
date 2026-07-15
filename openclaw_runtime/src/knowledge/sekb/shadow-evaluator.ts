import type { JsonObject, Trajectory, TrajectoryOutcome } from "./types.js";

export const MAX_SEKB_SHADOW_METADATA_BYTES = 2_048;

export type SekbShadowEvaluationInput = {
  outcome: TrajectoryOutcome;
  toolCallCount: number;
  toolResultCount: number;
  toolErrorCount: number;
  errorSignaturePresent: boolean;
  priorMatchingErrorSignatureCount: number;
};

export type SekbCaptureQualityShadowV1 = {
  schema: "sekb-capture-quality-shadow.v1";
  score: number;
  recommendation: "retain" | "review_low_signal";
  factors: {
    terminalOutcome: number;
    toolEvidence: number;
    errorResolutionEvidence: number | null;
    recurrenceEvidence: number | null;
    validationEvidence: null;
    userConfirmationEvidence: null;
  };
  evidenceAvailable: string[];
  evidenceMissing: string[];
};

export type SekbCompletionEvidenceV1 = {
  schema: "sekb-completion-evidence.v1";
  status: "supported" | "partial" | "unsupported" | "unknown";
  reasons: string[];
  terminalOutcome: TrajectoryOutcome;
  validationObserved: false;
  unresolvedErrorObserved: boolean;
  explicitConfirmationObserved: false;
  evidenceAvailable: string[];
  evidenceMissing: string[];
};

export type SekbShadowMetadataV1 = {
  schema: "sekb-shadow-metadata.v1";
  captureQuality: SekbCaptureQualityShadowV1;
  completionEvidence: SekbCompletionEvidenceV1;
};

export function evaluateSekbShadowV1(input: SekbShadowEvaluationInput): SekbShadowMetadataV1 {
  const toolErrorObserved = input.toolErrorCount > 0;
  const errorResolutionEvidence = toolErrorObserved
    ? input.outcome === "success" ? 1 : 0
    : null;
  const recurrenceEvidence = input.errorSignaturePresent
    ? input.priorMatchingErrorSignatureCount > 0 ? 1 : 0
    : null;
  const factors = {
    terminalOutcome: input.outcome === "partial" ? 0.5 : 1,
    toolEvidence: input.toolCallCount > 0 ? 1 : 0,
    errorResolutionEvidence,
    recurrenceEvidence,
    validationEvidence: null,
    userConfirmationEvidence: null,
  } as const;
  const availableFactors = [
    factors.terminalOutcome,
    factors.toolEvidence,
    factors.errorResolutionEvidence,
    factors.recurrenceEvidence,
  ];
  let availableFactorTotal = 0;
  let availableFactorCount = 0;
  for (const value of availableFactors) {
    if (value !== null) {
      availableFactorTotal += value;
      availableFactorCount += 1;
    }
  }
  const score = Math.round((availableFactorTotal / availableFactorCount) * 100);
  const evidenceMissing = ["validation", "user_confirmation"];
  const evidenceAvailable = [
    "terminal_outcome",
    "tool_call_count",
    ...(input.toolResultCount > 0 ? ["tool_result_status"] : []),
    ...(toolErrorObserved ? ["error_resolution"] : []),
    ...(input.errorSignaturePresent ? ["error_signature_recurrence"] : []),
  ];
  const unresolvedErrorObserved = toolErrorObserved && input.outcome !== "success";
  const completionReasons = [
    `terminal_${input.outcome}`,
    ...(toolErrorObserved
      ? [unresolvedErrorObserved ? "tool_error_unresolved" : "tool_error_resolved"]
      : []),
    "validation_unavailable",
    "explicit_confirmation_unavailable",
  ];

  return {
    schema: "sekb-shadow-metadata.v1",
    captureQuality: {
      schema: "sekb-capture-quality-shadow.v1",
      score,
      recommendation: score >= 50 ? "retain" : "review_low_signal",
      factors,
      evidenceAvailable,
      evidenceMissing,
    },
    completionEvidence: {
      schema: "sekb-completion-evidence.v1",
      status: completionStatus(input.outcome),
      reasons: completionReasons,
      terminalOutcome: input.outcome,
      validationObserved: false,
      unresolvedErrorObserved,
      explicitConfirmationObserved: false,
      evidenceAvailable,
      evidenceMissing,
    },
  };
}

export function evaluateTrajectoryShadowV1(
  trajectory: Pick<Trajectory, "outcome" | "steps" | "error_signature">,
  priorMatchingErrorSignatureCount: number,
): SekbShadowMetadataV1 {
  let toolCallCount = 0;
  let toolResultCount = 0;
  let toolErrorCount = 0;

  for (const step of trajectory.steps) {
    if (step.action === "tool.call") {
      toolCallCount += 1;
    }
    if (step.action === "tool.result") {
      toolResultCount += 1;
      if (isRecord(step.output) && step.output.isError === true) {
        toolErrorCount += 1;
      }
    }
  }

  return evaluateSekbShadowV1({
    outcome: trajectory.outcome,
    toolCallCount,
    toolResultCount,
    toolErrorCount,
    errorSignaturePresent: Boolean(trajectory.error_signature),
    priorMatchingErrorSignatureCount: Math.max(0, Math.trunc(priorMatchingErrorSignatureCount)),
  });
}

export function isSekbShadowMetadataV1(value: unknown): value is SekbShadowMetadataV1 {
  if (!isRecord(value) || value.schema !== "sekb-shadow-metadata.v1") {
    return false;
  }
  return isRecord(value.captureQuality)
    && value.captureQuality.schema === "sekb-capture-quality-shadow.v1"
    && (value.captureQuality.recommendation === "retain" || value.captureQuality.recommendation === "review_low_signal")
    && isRecord(value.completionEvidence)
    && value.completionEvidence.schema === "sekb-completion-evidence.v1"
    && (value.completionEvidence.status === "supported"
      || value.completionEvidence.status === "partial"
      || value.completionEvidence.status === "unsupported"
      || value.completionEvidence.status === "unknown");
}

export function attachSekbShadowMetadata(metadata: JsonObject, shadow: SekbShadowMetadataV1): JsonObject {
  const next = { ...metadata, sekbShadow: shadow };
  // The V1 payload uses only fixed enums, booleans, and bounded numbers. Keep
  // the guard so future changes cannot turn this advisory metadata into a payload sink.
  if (Buffer.byteLength(JSON.stringify(next.sekbShadow), "utf8") > MAX_SEKB_SHADOW_METADATA_BYTES) {
    return { ...metadata };
  }
  return next;
}

function completionStatus(outcome: TrajectoryOutcome): SekbCompletionEvidenceV1["status"] {
  if (outcome === "success") {
    return "supported";
  }
  if (outcome === "partial") {
    return "partial";
  }
  if (outcome === "failure") {
    return "unsupported";
  }
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
