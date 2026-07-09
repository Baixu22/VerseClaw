import type {
  BundleEvidenceRef,
  OrchestrationResultBundle,
  VerificationReport,
} from "./orchestration-result-bundle.js";

export type BlackboardSynthesisSummary = {
  entryCount: number;
  unresolvedConflicts: number;
  openQuestions: number;
  openRisks: number;
  memoryProposals: number;
  evidenceRefs: string[];
  trustBoundaries: string[];
};

export type OrchestrationSynthesisStatus =
  | "verified"
  | "partial"
  | "failed"
  | "repair_required";

export type OrchestrationRoleContribution = {
  roleName: string;
  task: string;
  taskId?: string;
  status: string;
  phase: "worker" | "verifier";
  evidenceRefs: BundleEvidenceRef[];
  outputPreview?: string;
};

export type OrchestrationVisibleFailure = {
  code: string;
  message: string;
  roleName?: string;
  taskId?: string;
  evidenceRefs: BundleEvidenceRef[];
};

export type OrchestrationSynthesis = {
  schemaVersion: 1;
  orchestrationRunId: string;
  taskGraphId: string;
  status: OrchestrationSynthesisStatus;
  summary: string;
  roleContributions: OrchestrationRoleContribution[];
  evidenceRefs: BundleEvidenceRef[];
  artifactRefs: OrchestrationResultBundle["artifacts"];
  visibleFailures: OrchestrationVisibleFailure[];
  verifier: Pick<VerificationReport, "decision" | "verifierRole" | "childRunId" | "evidenceRefs" | "reasons"> | {
    decision: "not_required";
    evidenceRefs: BundleEvidenceRef[];
    reasons: [];
  };
  traceIds: string[];
  blackboardSummary?: BlackboardSynthesisSummary;
  policy: {
    toolAccess: "none";
    verifierAuthority: "preserved";
    memoryWrite: "none";
  };
};

export type SynthesizeOrchestrationInput = {
  bundle: OrchestrationResultBundle;
  blackboardSummary?: BlackboardSynthesisSummary;
};

const SYNTHESIS_POLICY = {
  toolAccess: "none",
  verifierAuthority: "preserved",
  memoryWrite: "none",
} as const;

function copyEvidence(refs: readonly BundleEvidenceRef[]): BundleEvidenceRef[] {
  return refs.map((ref) => ({ ...ref }));
}

function outputPreview(text: string | undefined): string | undefined {
  const normalized = text?.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function deriveSynthesisStatus(bundle: OrchestrationResultBundle): OrchestrationSynthesisStatus {
  if (bundle.verifierReport?.decision === "fail" || bundle.status === "failed" || bundle.status === "schema_failed") {
    return "failed";
  }
  if (bundle.verifierReport?.decision === "repair_required" || bundle.status === "repair_required") {
    return "repair_required";
  }
  if (bundle.status === "partial" || bundle.failures.length > 0) {
    return "partial";
  }
  return "verified";
}

function visibleFailures(bundle: OrchestrationResultBundle): OrchestrationVisibleFailure[] {
  const verifierFailures = (bundle.verifierReport?.reasons ?? []).map((reason) => ({
    code: reason.code,
    message: reason.message,
    evidenceRefs: copyEvidence(reason.evidenceRefs),
  }));
  const roleFailures = bundle.failures.map((failure) => ({
    code: "role_failure",
    message: failure.error ?? failure.status,
    roleName: failure.roleName,
    taskId: failure.taskId,
    evidenceRefs: [],
  }));
  const permissionFailures = bundle.permissionEvents
    .filter((event) => event.decision === "denied")
    .map((event) => ({
      code: "permission_denied",
      message: event.reason,
      roleName: event.roleName,
      evidenceRefs: [],
    }));
  return [...verifierFailures, ...roleFailures, ...permissionFailures];
}

function verifierProjection(bundle: OrchestrationResultBundle): OrchestrationSynthesis["verifier"] {
  if (!bundle.verifierReport) {
    return {
      decision: "not_required",
      evidenceRefs: [],
      reasons: [],
    };
  }
  return {
    ...bundle.verifierReport,
    evidenceRefs: copyEvidence(bundle.verifierReport.evidenceRefs),
    reasons: bundle.verifierReport.reasons.map((reason) => ({
      ...reason,
      evidenceRefs: copyEvidence(reason.evidenceRefs),
    })),
  };
}

function summaryFor(params: {
  status: OrchestrationSynthesisStatus;
  bundle: OrchestrationResultBundle;
  failureCount: number;
}): string {
  const roleCount = params.bundle.roleOutcomes.length;
  const evidenceCount = params.bundle.evidenceRefs.length;
  const artifactCount = params.bundle.artifacts.length;
  if (params.status === "failed") {
    return `Verifier failed; ${params.failureCount} failure(s), ${roleCount} role contribution(s), ${evidenceCount} evidence ref(s), ${artifactCount} artifact(s).`;
  }
  if (params.status === "repair_required") {
    return `Repair required; ${roleCount} role contribution(s), ${evidenceCount} evidence ref(s), ${artifactCount} artifact(s).`;
  }
  if (params.status === "partial") {
    return `Partial result; ${params.failureCount} visible failure(s), ${roleCount} role contribution(s), ${evidenceCount} evidence ref(s), ${artifactCount} artifact(s).`;
  }
  return `Verified result; ${roleCount} role contribution(s), ${evidenceCount} evidence ref(s), ${artifactCount} artifact(s).`;
}

function copyBlackboardSummary(summary: BlackboardSynthesisSummary | undefined): BlackboardSynthesisSummary | undefined {
  if (!summary) {
    return undefined;
  }
  return {
    ...summary,
    evidenceRefs: [...summary.evidenceRefs],
    trustBoundaries: [...summary.trustBoundaries],
  };
}

export function synthesizeOrchestrationResult(input: SynthesizeOrchestrationInput): OrchestrationSynthesis {
  const status = deriveSynthesisStatus(input.bundle);
  const failures = visibleFailures(input.bundle);
  return {
    schemaVersion: 1,
    orchestrationRunId: input.bundle.orchestrationRunId,
    taskGraphId: input.bundle.taskGraphId,
    status,
    summary: summaryFor({ status, bundle: input.bundle, failureCount: failures.length }),
    roleContributions: input.bundle.roleOutcomes.map((outcome) => ({
      roleName: outcome.roleName,
      task: outcome.task,
      ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
      status: outcome.status,
      phase: outcome.phase,
      evidenceRefs: copyEvidence(outcome.evidenceRefs),
      ...(outputPreview(outcome.outputText) ? { outputPreview: outputPreview(outcome.outputText) } : {}),
    })),
    evidenceRefs: copyEvidence(input.bundle.evidenceRefs),
    artifactRefs: input.bundle.artifacts.map((artifact) => ({ ...artifact })),
    visibleFailures: failures,
    verifier: verifierProjection(input.bundle),
    traceIds: [...input.bundle.traceIds],
    ...(input.blackboardSummary ? { blackboardSummary: copyBlackboardSummary(input.blackboardSummary) } : {}),
    policy: { ...SYNTHESIS_POLICY },
  };
}
