import type {
  BundleEvidenceRef,
  OrchestrationResultBundle,
  RepairSummary,
  RoleOutcomeBundle,
} from "./orchestration-result-bundle.js";

export type GateDecision = "pass" | "fail" | "repair_required";

export type GateReason = {
  code: string;
  message: string;
  roleName?: string;
  taskId?: string;
  evidenceRefs: BundleEvidenceRef[];
};

export type GateResult = {
  gate: "schema_compliance" | "verifier" | "repair";
  decision: GateDecision;
  reasons: GateReason[];
};

function reason(input: Omit<GateReason, "evidenceRefs"> & { evidenceRefs?: BundleEvidenceRef[] }): GateReason {
  return {
    evidenceRefs: input.evidenceRefs ?? [],
    ...input,
  };
}

function isSuccessOutcome(outcome: RoleOutcomeBundle): boolean {
  return outcome.status === "accepted" || outcome.status === "completed";
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasEvidence(refs: readonly BundleEvidenceRef[] | undefined): boolean {
  return Boolean(refs?.some((ref) => hasText(ref.ref)));
}

function failIfAny(reasons: GateReason[], gate: GateResult["gate"]): GateResult {
  return {
    gate,
    decision: reasons.length > 0 ? "fail" : "pass",
    reasons,
  };
}

export function runSchemaComplianceGate(bundle: OrchestrationResultBundle): GateResult {
  const reasons: GateReason[] = [];
  if (!hasText(bundle.orchestrationRunId)) {
    reasons.push(reason({
      code: "missing_orchestration_run_id",
      message: "OrchestrationResultBundle requires orchestrationRunId.",
    }));
  }
  if (!hasText(bundle.taskGraphId)) {
    reasons.push(reason({
      code: "missing_task_graph_id",
      message: "OrchestrationResultBundle requires taskGraphId.",
    }));
  }
  for (const outcome of bundle.roleOutcomes) {
    if (!hasText(outcome.roleName) || !hasText(outcome.task) || !hasText(outcome.phase)) {
      reasons.push(reason({
        code: "missing_role_outcome_identity",
        message: "Role outcome requires roleName, task, and phase.",
        roleName: outcome.roleName,
        taskId: outcome.taskId,
        evidenceRefs: outcome.evidenceRefs,
      }));
    }
    if (isSuccessOutcome(outcome) && outcome.phase === "worker" && !hasEvidence(outcome.evidenceRefs)) {
      reasons.push(reason({
        code: "missing_evidence",
        message: "Successful worker outcome requires at least one evidence reference.",
        roleName: outcome.roleName,
        taskId: outcome.taskId,
      }));
    }
  }
  if (bundle.verifierReport) {
    if (!["pass", "fail", "repair_required"].includes(bundle.verifierReport.decision)) {
      reasons.push(reason({
        code: "verifier_failed",
        message: "Verifier report decision is not recognized.",
        evidenceRefs: bundle.verifierReport.evidenceRefs,
      }));
    }
    for (const reportReason of bundle.verifierReport.reasons) {
      if (!hasText(reportReason.code) || !hasText(reportReason.message)) {
        reasons.push(reason({
          code: "verifier_failed",
          message: "Verifier report reason requires code and message.",
          evidenceRefs: reportReason.evidenceRefs,
        }));
      }
    }
  }
  for (const proposal of bundle.memoryProposals) {
    if (!hasText(proposal.roleName) || !hasText(proposal.scopeKey) || !hasText(proposal.content)) {
      reasons.push(reason({
        code: "missing_role_outcome_identity",
        message: "Memory proposal requires roleName, scopeKey, and content.",
        roleName: proposal.roleName,
        evidenceRefs: proposal.evidenceRefs,
      }));
    }
  }
  if (bundle.attempt > 2 || (bundle.repair?.attempt ?? 1) > 2) {
    reasons.push(reason({
      code: "repair_attempt_exhausted",
      message: "Automatic repair/replan is capped at one follow-up attempt.",
    }));
  }
  return failIfAny(reasons, "schema_compliance");
}

export function runVerifierGate(bundle: OrchestrationResultBundle): GateResult {
  const schemaGate = runSchemaComplianceGate(bundle);
  if (schemaGate.decision === "fail") {
    return {
      gate: "verifier",
      decision: "fail",
      reasons: schemaGate.reasons,
    };
  }
  if (bundle.failures.length > 0 && bundle.roleOutcomes.every((outcome) => !isSuccessOutcome(outcome))) {
    return {
      gate: "verifier",
      decision: "fail",
      reasons: [reason({
        code: "verifier_failed",
        message: "All worker outcomes failed before verifier success.",
      })],
    };
  }
  const report = bundle.verifierReport;
  if (!report) {
    return { gate: "verifier", decision: "pass", reasons: [] };
  }
  if (report.decision === "fail") {
    return {
      gate: "verifier",
      decision: "fail",
      reasons: [
        reason({
          code: "verifier_failed",
          message: "Verifier rejected the orchestration result.",
          evidenceRefs: report.evidenceRefs,
        }),
        ...report.reasons.map((entry) => reason({ ...entry })),
      ],
    };
  }
  if (report.decision === "repair_required") {
    return {
      gate: "verifier",
      decision: "repair_required",
      reasons: report.reasons.length
        ? report.reasons.map((entry) => reason({ ...entry }))
        : [reason({
          code: "verifier_failed",
          message: "Verifier requested repair.",
          evidenceRefs: report.evidenceRefs,
        })],
    };
  }
  return { gate: "verifier", decision: "pass", reasons: [] };
}

function repairSource(params: {
  schemaGate: GateResult;
  verifierGate: GateResult;
}): RepairSummary["source"] {
  if (params.schemaGate.decision !== "pass") {
    return "schema_gate";
  }
  if (params.verifierGate.decision !== "pass") {
    return "verifier_gate";
  }
  return "quality_gate";
}

function firstReason(...gates: GateResult[]): GateReason | undefined {
  return gates.flatMap((gate) => gate.reasons)[0];
}

export function resolveMaxOneRepair(params: {
  bundle: OrchestrationResultBundle;
  schemaGate: GateResult;
  verifierGate: GateResult;
}): RepairSummary {
  const needsRepair =
    params.schemaGate.decision === "repair_required" ||
    params.verifierGate.decision === "repair_required";
  const attempted = params.bundle.attempt >= 2;
  const selectedReason = firstReason(params.schemaGate, params.verifierGate);
  if (!needsRepair || attempted) {
    return {
      allowed: false,
      attempted,
      attempt: params.bundle.attempt,
      maxAttempts: 1,
      action: "none",
      source: repairSource(params),
      targetTaskId: selectedReason?.taskId,
      targetRoleName: selectedReason?.roleName,
      reason: attempted ? "repair attempt exhausted" : "no repair required",
    };
  }
  return {
    allowed: true,
    attempted: false,
    attempt: params.bundle.attempt + 1,
    maxAttempts: 1,
    action: "repair",
    source: repairSource(params),
    targetTaskId: selectedReason?.taskId,
    targetRoleName: selectedReason?.roleName,
    reason: selectedReason?.message ?? "bounded repair required",
  };
}
