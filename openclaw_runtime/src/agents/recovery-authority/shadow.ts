/**
 * TF-0714: recovery-authority shadow comparison.
 *
 * The authority runs beside the legacy recovery path and records every
 * divergence. It never changes behaviour: with the gate off nothing is even
 * evaluated, and with the gate on only a drift record is produced.
 */
import type {
  RecoveryDecision,
} from '../../../../shared/recovery-authority/contract.js';
import type { RecoveryAuthorityRequest } from '../../../../shared/recovery-authority/contract.js';

export const RECOVERY_AUTHORITY_SHADOW_FLAG = 'OPENCLAW_RECOVERY_AUTHORITY_SHADOW';

/** Truthy-only, default off. Reuses the repo-wide truthy convention. */
export function isRecoveryAuthorityShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[RECOVERY_AUTHORITY_SHADOW_FLAG];
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export type LegacyRecoveryOutcome = 'resumed' | 'not-resumed' | 'delivered' | 'failed';

export type RecoveryAuthorityShadowRecord = {
  requestId: string;
  entry: RecoveryAuthorityRequest['entry'];
  legacyOutcome: LegacyRecoveryOutcome;
  authorityKind: RecoveryDecision['kind'];
  drift: boolean;
  reasons: string[];
  recordedAt: number;
};

function expectedLegacyOutcomes(decision: RecoveryDecision): LegacyRecoveryOutcome[] {
  switch (decision.kind) {
    case 'resume':
    case 'replay':
      return ['resumed'];
    case 'deliver':
      return ['delivered'];
    case 'reconcile':
      // A reconcile is neither a resume nor a failure: the legacy path has no
      // equivalent state, so any terminal legacy outcome is a divergence.
      return [];
    case 'settle':
      return ['not-resumed'];
    case 'wedge':
      return ['failed'];
    case 'reject':
      return ['not-resumed'];
    default:
      return [];
  }
}

export function compareRecoveryShadow(
  request: RecoveryAuthorityRequest,
  decision: RecoveryDecision,
  legacyOutcome: LegacyRecoveryOutcome,
  now: number = Date.now(),
): RecoveryAuthorityShadowRecord {
  const expected = expectedLegacyOutcomes(decision);
  const drift = expected.length === 0 ? true : !expected.includes(legacyOutcome);
  const reasons: string[] = [];
  if (drift) {
    reasons.push(
      `legacy=${legacyOutcome} but authority=${decision.kind} (basis=${decision.basis})`,
    );
  }
  if (decision.entry !== request.entry) {
    reasons.push(`entry mismatch: ${decision.entry} != ${request.entry}`);
  }
  return {
    requestId: request.requestId,
    entry: request.entry,
    legacyOutcome,
    authorityKind: decision.kind,
    drift,
    reasons,
    recordedAt: now,
  };
}

/** Bounded in-memory sink so a long run cannot grow without limit. */
export class RecoveryShadowSink {
  private readonly records: RecoveryAuthorityShadowRecord[] = [];
  private droppedCount = 0;

  constructor(private readonly capacity = 256) {}

  record(record: RecoveryAuthorityShadowRecord): void {
    if (this.records.length >= this.capacity) {
      this.records.shift();
      this.droppedCount += 1;
    }
    this.records.push(record);
  }

  snapshot(): { records: RecoveryAuthorityShadowRecord[]; droppedCount: number; driftCount: number } {
    return {
      records: [...this.records],
      droppedCount: this.droppedCount,
      driftCount: this.records.filter((record) => record.drift).length,
    };
  }
}

/** Process-wide shadow sink. Read-only: it never feeds a recovery decision. */
export const recoveryShadowSink = new RecoveryShadowSink();

