/**
 * C7-3: verifier does not self-repair; failures escalate to lead for a fix task (Factory).
 *
 * Default `verifierNoSelfRepair: true` encodes the discipline. Explicit false keeps
 * a compatible fail outcome without mandating lead fix-task factory creation.
 */
export type LeadFixTask = {
  kind: "lead-fix-task";
  createdBy: "verifier-discipline";
  reason: string;
  assignee: "lead";
  selfRepairAllowed: false;
};

export type VerifierOutcome =
  | { status: "accepted" }
  | {
      status: "failed";
      reason: string;
      createFixTask: boolean;
      selfRepairAllowed: false;
      fixTask?: LeadFixTask;
    };

export type VerifierDisciplineConfig = {
  /** When true (default), verifier never self-repairs and escalates to lead. */
  verifierNoSelfRepair: boolean;
};

export const DEFAULT_VERIFIER_DISCIPLINE: VerifierDisciplineConfig = {
  verifierNoSelfRepair: true,
};

export function createLeadFixTask(reason: string): LeadFixTask {
  return {
    kind: "lead-fix-task",
    createdBy: "verifier-discipline",
    reason,
    assignee: "lead",
    selfRepairAllowed: false,
  };
}

export function handleVerifierFailure(params: {
  reason: string;
  config?: VerifierDisciplineConfig;
}): VerifierOutcome {
  const config = params.config ?? DEFAULT_VERIFIER_DISCIPLINE;
  if (config.verifierNoSelfRepair) {
    const fixTask = createLeadFixTask(params.reason);
    return {
      status: "failed",
      reason: params.reason,
      createFixTask: true,
      selfRepairAllowed: false,
      fixTask,
    };
  }
  // Explicit opt-out of discipline factory (compatible fail; still no auto code edit).
  return {
    status: "failed",
    reason: params.reason,
    createFixTask: false,
    selfRepairAllowed: false,
  };
}