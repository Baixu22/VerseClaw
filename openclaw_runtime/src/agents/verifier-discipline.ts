/**
 * C7-3: verifier does not self-repair; failures return to lead for fix task creation.
 */
export type VerifierOutcome =
  | { status: "accepted" }
  | { status: "failed"; reason: string; createFixTask: true; selfRepairAllowed: false };

export type VerifierDisciplineConfig = {
  /** When true (default), verifier never self-repairs. */
  verifierNoSelfRepair: boolean;
};

export const DEFAULT_VERIFIER_DISCIPLINE: VerifierDisciplineConfig = {
  verifierNoSelfRepair: true,
};

export function handleVerifierFailure(params: {
  reason: string;
  config?: VerifierDisciplineConfig;
}): VerifierOutcome {
  const config = params.config ?? DEFAULT_VERIFIER_DISCIPLINE;
  if (config.verifierNoSelfRepair) {
    return {
      status: "failed",
      reason: params.reason,
      createFixTask: true,
      selfRepairAllowed: false,
    };
  }
  // Explicit opt-in only (not recommended)
  return {
    status: "failed",
    reason: params.reason,
    createFixTask: true,
    selfRepairAllowed: false,
  };
}
