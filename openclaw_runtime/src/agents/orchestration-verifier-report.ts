/**
 * Structured verification report builder (P2-005 / F-AUTH-005).
 *
 * Text heuristics must not alone authorize a pass. Prefer structured
 * verificationVerdict / outcome.status; missing provenance fails closed.
 */
import type { BundleEvidenceRef, VerificationReport } from "./orchestration-result-bundle.js";
import type { PendingFinalDeliveryPayload } from "./subagent-registry.types.js";

export type StructuredVerificationVerdict = VerificationReport["decision"];

export type VerifierReportInput = {
  payload: PendingFinalDeliveryPayload;
  resultText?: string;
};

const STRUCTURED_VERDICTS = new Set<StructuredVerificationVerdict>([
  "pass",
  "fail",
  "repair_required",
]);

const TEXT_FAIL_RE = /\b(fail|failed|refuted|reject|rejected)\b/iu;
const TEXT_REPAIR_RE = /\b(repair required|repair_required|needs repair|replan required)\b/iu;

/** Parse an explicit structured verdict from free text (JSON or key: value). Never invents pass from prose. */
export function parseStructuredVerificationVerdictFromText(
  text: string | undefined,
): StructuredVerificationVerdict | undefined {
  if (!text || !text.trim()) {
    return undefined;
  }
  // Whole structured output or the final verdict line is authoritative;
  // quoted worker text and examples elsewhere in a report are not verdicts.
  const trimmed = text.trim();
  try {
    const value = JSON.parse(trimmed) as { verificationVerdict?: unknown };
    if (typeof value.verificationVerdict === 'string' && STRUCTURED_VERDICTS.has(value.verificationVerdict.toLowerCase() as StructuredVerificationVerdict)) {
      return value.verificationVerdict.toLowerCase() as StructuredVerificationVerdict;
    }
  } catch { /* Plain reports use the final token line below. */ }
  const line = trimmed.split(/\r?\n/u).at(-1) ?? '';
  const kvMatch = line.match(/^(?:my verdict:\s*)?verificationVerdict\s*[:=]\s*["']?(pass|fail|repair_required)["']?\s*$/iu);
  if (kvMatch?.[1]) {
    const v = kvMatch[1].toLowerCase() as StructuredVerificationVerdict;
    if (STRUCTURED_VERDICTS.has(v)) return v;
  }
  // Embedded rejections may fail closed, but embedded/quoted pass never grants.
  const rejection = trimmed.match(/"verificationVerdict"\s*:\s*"(fail|repair_required)"/iu);
  if (rejection) return rejection[1].toLowerCase() as StructuredVerificationVerdict;
  return undefined;
}

export function resolveStructuredVerificationVerdict(params: {
  orchestrationVerdict?: string | null;
  outcomeStatus?: string | null;
  resultText?: string;
}): {
  verdict?: StructuredVerificationVerdict;
  source: "orchestration" | "text_structured" | "outcome_error" | "none";
} {
  const orch = typeof params.orchestrationVerdict === "string"
    ? params.orchestrationVerdict.trim().toLowerCase()
    : "";
  const fromText = parseStructuredVerificationVerdictFromText(params.resultText);
  if (params.outcomeStatus === 'error' || params.outcomeStatus === 'timeout'
    || fromText && STRUCTURED_VERDICTS.has(orch as StructuredVerificationVerdict) && orch !== fromText) {
    return { verdict: 'fail', source: 'outcome_error' };
  }
  if (!fromText && /verificationVerdict/iu.test(params.resultText ?? '')) return { source: 'none' };
  if (STRUCTURED_VERDICTS.has(orch as StructuredVerificationVerdict)) {
    return { verdict: orch as StructuredVerificationVerdict, source: 'orchestration' };
  }
  if (fromText) {
    return { verdict: fromText, source: "text_structured" };
  }

  if (params.outcomeStatus === "error" || params.outcomeStatus === "timeout") {
    return { verdict: "fail", source: "outcome_error" };
  }
  // A completed verifier run is not a business verdict. Without an explicit
  // structured verdict, leave the decision unresolved and let the report
  // fail closed below.
  return { source: "none" };
}

/**
 * Build a VerificationReport. Free-text fail/refuted heuristics alone cannot authorize pass;
 * missing structured provenance defaults to fail (no trust elevation).
 */
export function buildVerifierReport(params: VerifierReportInput): VerificationReport {
  const text = params.resultText?.trim() ?? "";
  const outcomeStatus = params.payload.outcome?.status;
  const orchestrationVerdict = params.payload.orchestration?.verificationVerdict;

  const resolved = resolveStructuredVerificationVerdict({
    orchestrationVerdict,
    outcomeStatus,
    resultText: text,
  });

  const evidenceRefs: BundleEvidenceRef[] = [{
    type: "run",
    ref: params.payload.childRunId,
    roleName: params.payload.orchestration?.roleName ?? params.payload.label,
    ...(params.payload.orchestration?.taskId ? { taskId: params.payload.orchestration.taskId } : {}),
  }];

  let decision: StructuredVerificationVerdict;
  let reasonCode: string;
  let reasonMessage: string;

  if (resolved.verdict && resolved.source !== "none") {
    decision = resolved.verdict;
    reasonCode =
      resolved.source === "orchestration" ? "structured_verdict" :
      resolved.source === "text_structured" ? "structured_verdict_text" :
      resolved.source === "outcome_error" ? "verifier_outcome_error" :
      "missing_structured_verdict";
    reasonMessage =
      decision === "pass"
        ? text || "Structured verifier verdict: pass"
        : text || `Structured verifier verdict: ${decision}`;
  } else {
    // No structured authority. Text heuristics may fail-closed but never alone grant pass (A2/A3).
    const textRepair = TEXT_REPAIR_RE.test(text);
    const textFail = TEXT_FAIL_RE.test(text);
    if (textRepair) {
      decision = "repair_required";
      reasonCode = "text_heuristic_fail_closed";
      reasonMessage = text || "Text heuristic suggested repair; structured verdict missing.";
    } else if (textFail) {
      decision = "fail";
      reasonCode = "text_heuristic_fail_closed";
      reasonMessage = text || "Text heuristic suggested fail; structured verdict missing.";
    } else {
      decision = "fail";
      reasonCode = "missing_structured_verdict";
      reasonMessage = text
        ? "Free-text verifier output cannot alone authorize pass; a structured verificationVerdict is required."
        : "Missing structured verifier provenance; defaulting to fail (no trust elevation).";
    }
  }

  return {
    decision,
    verifierRole: params.payload.orchestration?.roleName ?? params.payload.label,
    childRunId: params.payload.childRunId,
    evidenceRefs,
    reasons: decision === "pass"
      ? []
      : [{
          code: reasonCode === "structured_verdict" || reasonCode === "structured_verdict_text"
            ? (decision === "repair_required" ? "verifier_repair_required" : "verifier_failed")
            : reasonCode,
          message: reasonMessage,
          evidenceRefs,
        }],
  };
}
