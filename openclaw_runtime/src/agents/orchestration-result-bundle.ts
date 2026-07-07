export type OrchestrationBundlePhase = "spawn" | "completion";

export type OrchestrationBundleStatus =
  | "pending"
  | "verified"
  | "partial"
  | "failed"
  | "schema_failed"
  | "repair_required";

export type RoleOutcomeStatus =
  | "accepted"
  | "completed"
  | "forbidden"
  | "error"
  | "timeout"
  | "schema_failed";

export type BundleEvidenceRef = {
  type: "run" | "trace" | "file" | "test" | "artifact" | "manual";
  ref: string;
  roleName?: string;
  taskId?: string;
};

export type RoleOutcomeBundle = {
  roleName: string;
  task: string;
  phase: "worker" | "verifier";
  taskId?: string;
  roleInstanceId?: string;
  attempt: number;
  status: RoleOutcomeStatus;
  childRunId?: string;
  childSessionKey?: string;
  evidenceRefs: BundleEvidenceRef[];
  outputText?: string;
  error?: string;
};

export type VerificationReport = {
  decision: "pass" | "fail" | "repair_required";
  verifierRole?: string;
  childRunId?: string;
  reasons: Array<{ code: string; message: string; evidenceRefs: BundleEvidenceRef[] }>;
  evidenceRefs: BundleEvidenceRef[];
};

export type RepairSummary = {
  allowed: boolean;
  attempted: boolean;
  attempt: number;
  maxAttempts: 1;
  action: "none" | "repair" | "replan";
  source: "schema_gate" | "verifier_gate" | "spawn_failure" | "quality_gate";
  targetTaskId?: string;
  targetRoleName?: string;
  reason: string;
};

export type MemoryProposalRef = {
  roleName: string;
  scopeKey: string;
  content: string;
  evidenceRefs: BundleEvidenceRef[];
};

export type OrchestrationResultBundle = {
  schemaVersion: 1;
  phase: OrchestrationBundlePhase;
  orchestrationRunId: string;
  taskGraphId: string;
  attempt: number;
  status: OrchestrationBundleStatus;
  leadRole: string;
  selectedRoles: string[];
  roleOutcomes: RoleOutcomeBundle[];
  artifacts: Array<{ id: string; type: string; ref: string; roleName?: string }>;
  evidenceRefs: BundleEvidenceRef[];
  permissionEvents: Array<{ roleName: string; tool?: string; decision: "allowed" | "denied"; reason: string }>;
  failures: Array<{ roleName: string; status: string; error?: string; taskId?: string }>;
  verifierReport?: VerificationReport;
  repair?: RepairSummary;
  memoryProposals: MemoryProposalRef[];
  traceIds: string[];
  budgetSummary?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number };
};

export type SpawnPhaseBundleInput = {
  orchestrationRunId: string;
  taskGraphId: string;
  attempt?: number;
  leadRole: string;
  selectedRoles: readonly string[];
  outcomes?: readonly RoleOutcomeBundle[];
  artifacts?: OrchestrationResultBundle["artifacts"];
  evidenceRefs?: readonly BundleEvidenceRef[];
  permissionEvents?: OrchestrationResultBundle["permissionEvents"];
  failures?: OrchestrationResultBundle["failures"];
  memoryProposals?: readonly MemoryProposalRef[];
  traceIds?: readonly string[];
  budgetSummary?: OrchestrationResultBundle["budgetSummary"];
};

export type CompletionPhaseBundleInput = {
  orchestrationRunId: string;
  taskGraphId: string;
  attempt?: number;
  leadRole: string;
  selectedRoles: readonly string[];
  roleOutcomes?: readonly RoleOutcomeBundle[];
  artifacts?: OrchestrationResultBundle["artifacts"];
  evidenceRefs?: readonly BundleEvidenceRef[];
  permissionEvents?: OrchestrationResultBundle["permissionEvents"];
  failures?: OrchestrationResultBundle["failures"];
  verifierReport?: VerificationReport;
  repair?: RepairSummary;
  memoryProposals?: readonly MemoryProposalRef[];
  traceIds?: readonly string[];
  budgetSummary?: OrchestrationResultBundle["budgetSummary"];
};

function copyEvidence(refs: readonly BundleEvidenceRef[] | undefined): BundleEvidenceRef[] {
  return (refs ?? []).map((ref) => ({ ...ref }));
}

function copyOutcome(outcome: RoleOutcomeBundle): RoleOutcomeBundle {
  return {
    ...outcome,
    evidenceRefs: copyEvidence(outcome.evidenceRefs),
  };
}

function copyVerifierReport(report: VerificationReport | undefined): VerificationReport | undefined {
  if (!report) {
    return undefined;
  }
  return {
    ...report,
    reasons: report.reasons.map((reason) => ({
      ...reason,
      evidenceRefs: copyEvidence(reason.evidenceRefs),
    })),
    evidenceRefs: copyEvidence(report.evidenceRefs),
  };
}

function copyMemoryProposal(proposal: MemoryProposalRef): MemoryProposalRef {
  return {
    ...proposal,
    evidenceRefs: copyEvidence(proposal.evidenceRefs),
  };
}

function isFailureStatus(status: RoleOutcomeStatus): boolean {
  return status === "forbidden" || status === "error" || status === "timeout" || status === "schema_failed";
}

function deriveBundleStatus(params: {
  phase: OrchestrationBundlePhase;
  outcomes: readonly RoleOutcomeBundle[];
  failures: readonly OrchestrationResultBundle["failures"][number][];
  verifierReport?: VerificationReport;
  repair?: RepairSummary;
}): OrchestrationBundleStatus {
  if (params.repair?.action !== "none" && params.repair?.allowed) {
    return "repair_required";
  }
  if (params.verifierReport?.decision === "repair_required") {
    return "repair_required";
  }
  if (params.verifierReport?.decision === "fail") {
    return "failed";
  }
  if (params.phase === "completion" && params.verifierReport?.decision === "pass") {
    return params.failures.length > 0 ? "partial" : "verified";
  }
  const failedOutcomes = params.outcomes.filter((outcome) => isFailureStatus(outcome.status));
  const successfulOutcomes = params.outcomes.filter((outcome) => !isFailureStatus(outcome.status));
  if (successfulOutcomes.length === 0 && (failedOutcomes.length > 0 || params.failures.length > 0)) {
    return "failed";
  }
  if (successfulOutcomes.length > 0 && (failedOutcomes.length > 0 || params.failures.length > 0)) {
    return "partial";
  }
  return params.phase === "spawn" ? "pending" : "verified";
}

export function buildSpawnPhaseResultBundle(input: SpawnPhaseBundleInput): OrchestrationResultBundle {
  const outcomes = (input.outcomes ?? []).map(copyOutcome);
  const failures = (input.failures ?? []).map((failure) => ({ ...failure }));
  const repair = input.failures?.length
    ? {
      allowed: true,
      attempted: false,
      attempt: input.attempt ?? 1,
      maxAttempts: 1,
      action: "repair",
      source: "spawn_failure",
      reason: "spawn failure recorded in orchestration result bundle",
    } satisfies RepairSummary
    : undefined;
  return {
    schemaVersion: 1,
    phase: "spawn",
    orchestrationRunId: input.orchestrationRunId,
    taskGraphId: input.taskGraphId,
    attempt: input.attempt ?? 1,
    status: deriveBundleStatus({ phase: "spawn", outcomes, failures, repair }),
    leadRole: input.leadRole,
    selectedRoles: [...input.selectedRoles],
    roleOutcomes: outcomes,
    artifacts: (input.artifacts ?? []).map((artifact) => ({ ...artifact })),
    evidenceRefs: copyEvidence(input.evidenceRefs),
    permissionEvents: (input.permissionEvents ?? []).map((event) => ({ ...event })),
    failures,
    repair,
    memoryProposals: (input.memoryProposals ?? []).map(copyMemoryProposal),
    traceIds: [...(input.traceIds ?? [])],
    ...(input.budgetSummary ? { budgetSummary: { ...input.budgetSummary } } : {}),
  };
}

export function buildCompletionPhaseResultBundle(input: CompletionPhaseBundleInput): OrchestrationResultBundle {
  const outcomes = (input.roleOutcomes ?? []).map(copyOutcome);
  const failures = (input.failures ?? []).map((failure) => ({ ...failure }));
  const verifierReport = copyVerifierReport(input.verifierReport);
  return {
    schemaVersion: 1,
    phase: "completion",
    orchestrationRunId: input.orchestrationRunId,
    taskGraphId: input.taskGraphId,
    attempt: input.attempt ?? 1,
    status: deriveBundleStatus({
      phase: "completion",
      outcomes,
      failures,
      verifierReport,
      repair: input.repair,
    }),
    leadRole: input.leadRole,
    selectedRoles: [...input.selectedRoles],
    roleOutcomes: outcomes,
    artifacts: (input.artifacts ?? []).map((artifact) => ({ ...artifact })),
    evidenceRefs: copyEvidence(input.evidenceRefs),
    permissionEvents: (input.permissionEvents ?? []).map((event) => ({ ...event })),
    failures,
    ...(verifierReport ? { verifierReport } : {}),
    ...(input.repair ? { repair: { ...input.repair } } : {}),
    memoryProposals: (input.memoryProposals ?? []).map(copyMemoryProposal),
    traceIds: [...(input.traceIds ?? [])],
    ...(input.budgetSummary ? { budgetSummary: { ...input.budgetSummary } } : {}),
  };
}

function renderEvidenceRefs(refs: readonly BundleEvidenceRef[]): string {
  return refs.length
    ? refs.map((ref) => `${ref.type}:${ref.ref}`).join(", ")
    : "none";
}

export function renderOrchestrationResultBundleForPrompt(bundle: OrchestrationResultBundle): string {
  const lines = [
    "OrchestrationResultBundle",
    `schemaVersion: ${bundle.schemaVersion}`,
    `phase: ${bundle.phase}`,
    `status: ${bundle.status}`,
    `orchestrationRunId: ${bundle.orchestrationRunId}`,
    `taskGraphId: ${bundle.taskGraphId}`,
    `attempt: ${bundle.attempt}`,
    `leadRole: ${bundle.leadRole}`,
    `selectedRoles: ${bundle.selectedRoles.length ? bundle.selectedRoles.join(", ") : "none"}`,
    `traceIds: ${bundle.traceIds.length ? bundle.traceIds.join(", ") : "none"}`,
    `evidenceRefs: ${renderEvidenceRefs(bundle.evidenceRefs)}`,
    `permissionEvents: ${bundle.permissionEvents.length}`,
    `failures: ${bundle.failures.length}`,
    `memoryProposals: ${bundle.memoryProposals.length}`,
    `verifierDecision: ${bundle.verifierReport?.decision ?? "not_required"}`,
    "memoryProposalRefs:",
    ...(bundle.memoryProposals.length
      ? bundle.memoryProposals.map((proposal) =>
        `- memoryProposal: roleName: ${proposal.roleName}; scopeKey: ${proposal.scopeKey}; evidenceRefs: ${renderEvidenceRefs(proposal.evidenceRefs)}; content: ${proposal.content}`,
      )
      : ["none"]),
    "roleOutcomes:",
    ...(bundle.roleOutcomes.length
      ? bundle.roleOutcomes.map((outcome) =>
        `- roleName: ${outcome.roleName}; phase: ${outcome.phase}; taskId: ${outcome.taskId ?? "unknown"}; status: ${outcome.status}; evidenceRefs: ${renderEvidenceRefs(outcome.evidenceRefs)}`,
      )
      : ["none"]),
  ];
  return lines.join("\n");
}
