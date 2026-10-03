import { maxAsk, minSecurity, type ExecAsk, type ExecSecurity } from "../infra/exec-approvals.js";
import {
  isExternalOrUnknownProvenance,
  provenanceStatus,
  type ProvenanceStatus,
} from "../../../shared/security/content-provenance.js";

export type CommandExecProvenancePolicyInput = {
  provenance: unknown;
  security: ExecSecurity;
  ask: ExecAsk;
  /** True only for an operator-selected fullAccess/full policy. */
  explicitFullAccess: boolean;
};

export type CommandExecProvenancePolicy = {
  status: ProvenanceStatus;
  security: ExecSecurity;
  ask: ExecAsk;
  constrained: boolean;
};

/**
 * Apply the smallest source-dependent bound at the command-exec sink.
 *
 * Missing/invalid and external-derived content are not trusted for an
 * implicit bypass. The existing allowlist and approval machinery remains the
 * authority, so an already-allowlisted command still runs without a new
 * blanket approval. Explicit operator fullAccess is a deliberate exception.
 */
export function resolveCommandExecProvenancePolicy(
  input: CommandExecProvenancePolicyInput,
): CommandExecProvenancePolicy {
  const status = provenanceStatus(input.provenance);
  const risky = isExternalOrUnknownProvenance(status);

  if (!risky || input.explicitFullAccess) {
    return {
      status,
      security: input.security,
      ask: input.ask,
      constrained: false,
    };
  }

  return {
    status,
    security: minSecurity(input.security, "allowlist"),
    ask: input.security === "deny" ? input.ask : maxAsk(input.ask, "on-miss"),
    constrained: true,
  };
}
