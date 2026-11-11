/**
 * TF-0714: the single recovery decision surface (read-only aggregation).
 *
 * This module owns exactly one job: turn a validated `RecoveryAuthorityRequest`
 * into exactly one `RecoveryDecision`. It delegates to the frozen pure function
 * in `shared/recovery-authority/contract.ts` so there is one implementation of
 * the 7-question contract and no second source of truth.
 *
 * It never mutates state: entry adapters read existing owners (session store,
 * subagent registry, task_runs, ACP meta, delivery state) and hand facts in.
 */
import {
  RECOVERY_AUTHORITY_CONTRACT_VERSION,
  RECOVERY_AUTHORITY_ID,
  evaluateRecoveryRequest,
  type RecoveryAuthority,
  type RecoveryAuthorityRequest,
  type RecoveryDecision,
} from '../../../../shared/recovery-authority/contract.js';

export const RECOVERY_AUTHORITY_OWNER = 'openclaw_runtime.agents.recovery-authority';

class RecoveryAuthorityV1 implements RecoveryAuthority {
  readonly contractVersion = RECOVERY_AUTHORITY_CONTRACT_VERSION;
  readonly id = RECOVERY_AUTHORITY_ID;

  decide(request: RecoveryAuthorityRequest): RecoveryDecision {
    return evaluateRecoveryRequest(request);
  }
}

/** Process-wide singleton. The authority is stateless and pure. */
export const recoveryAuthorityV1: RecoveryAuthority = new RecoveryAuthorityV1();
