/**
 * FP-P0-04: child-runtime acknowledgement state machine.
 *
 * saved → pending-restart → restarting → runtime-acknowledged → applied | failed
 *
 * The old control plane treated "settings written + restart() resolved" as
 * `applied`, which is unverifiable: the child may have rejected the flag, read a
 * different config file, or never restarted at all. Here `applied` is reachable
 * only after the *child* answers `runtime.flags.ack` with a complete seven-field
 * payload whose generation matches the restart we are waiting on.
 */
import {
  DCS_FLAG_ACK_REQUIRED_FIELDS,
  isCompleteDcsFlagAck,
  missingDcsFlagAckFields,
  type DcsFlagAckFailureReason,
  type DcsFlagAckRequiredField,
  type DcsFlagAckState,
  type DcsFlagRuntimeAck,
} from '../../shared/dcs/prod-flags-control';

// FP-P1-09: defaults are derived from measured spawn→ack latency on the dev
// reference machine (scripts/measure-flag-ack-latency.mjs; data in
// artifacts/first-product-preview/FP-P1-09/). Margin rule: timeout ≈ 4× the
// coldest measured ack so a machine 4× slower than the reference still resolves
// before the deadline. Operators can override via AppSettings
// (dcsFlagAckTimeoutMs / dcsFlagAckPollInitialMs, 0 = use defaults).
export const DCS_FLAG_ACK_TIMEOUT_MS = 60_000;
export const DCS_FLAG_ACK_POLL_INTERVAL_MS = 250;
export const DCS_FLAG_ACK_MAX_POLL_INTERVAL_MS = 4_000;

export type DcsFlagAckTuning = {
  timeoutMs: number;
  pollIntervalMs: number;
  maxPollIntervalMs: number;
};

/**
 * FP-P1-09: resolve ack tuning from optional operator overrides. Values ≤0,
 * missing, or non-finite fall back to the measured defaults; overrides are
 * clamped to sane bounds so a typo cannot disable the ack wait entirely.
 */
export function resolveDcsFlagAckTuning(overrides?: {
  timeoutMs?: unknown;
  pollIntervalMs?: unknown;
}): DcsFlagAckTuning {
  const clamp = (raw: unknown, fallback: number, min: number, max: number): number => {
    const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 0;
    if (value <= 0) return fallback;
    return Math.min(max, Math.max(min, value));
  };
  const pollIntervalMs = clamp(
    overrides?.pollIntervalMs,
    DCS_FLAG_ACK_POLL_INTERVAL_MS,
    50,
    10_000,
  );
  return {
    timeoutMs: clamp(overrides?.timeoutMs, DCS_FLAG_ACK_TIMEOUT_MS, 1_000, 600_000),
    pollIntervalMs,
    maxPollIntervalMs: Math.max(pollIntervalMs, DCS_FLAG_ACK_MAX_POLL_INTERVAL_MS),
  };
}

export type DcsFlagAckOutcome = {
  state: Extract<DcsFlagAckState, 'applied' | 'failed' | 'pending-restart'>;
  trail: DcsFlagAckState[];
  ack?: DcsFlagRuntimeAck;
  missingFields?: DcsFlagAckRequiredField[];
  failureReason?: DcsFlagAckFailureReason;
  operatorHintKey?: string;
};

export type DcsFlagAckDeps = {
  /** Generation the host stamped on the child it is waiting for. */
  expectedGeneration: () => string;
  /** Ask the child for its acknowledgement. Rejects while the child is unreachable. */
  requestAck: () => Promise<unknown>;
  /** Whether the gateway is currently running. */
  isRunning: () => boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** FP-P1-09: exponential backoff ceiling; defaults to DCS_FLAG_ACK_MAX_POLL_INTERVAL_MS. */
  maxPollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll the child until it returns a complete, current-generation ack.
 *
 * Timeout resolves to `pending-restart` when the gateway is still running (the
 * child may simply be slow to come up — the operator can retry or restart) and to
 * `failed` when it is not (nothing is coming).
 */
export async function collectRuntimeFlagAck(
  deps: DcsFlagAckDeps,
): Promise<DcsFlagAckOutcome> {
  const trail: DcsFlagAckState[] = ['saved', 'pending-restart', 'restarting'];
  const timeoutMs = deps.timeoutMs ?? DCS_FLAG_ACK_TIMEOUT_MS;
  const pollIntervalMs = deps.pollIntervalMs ?? DCS_FLAG_ACK_POLL_INTERVAL_MS;
  const maxPollIntervalMs = Math.max(
    pollIntervalMs,
    deps.maxPollIntervalMs ?? DCS_FLAG_ACK_MAX_POLL_INTERVAL_MS,
  );
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => Date.now());
  const deadline = now() + timeoutMs;
  // FP-P1-09: exponential backoff. A slow cold start no longer burns a fixed
  // 2-per-second RPC stream; the interval doubles up to maxPollIntervalMs.
  let currentIntervalMs = pollIntervalMs;

  let lastMissing: DcsFlagAckRequiredField[] | undefined;
  let lastStaleAck: DcsFlagRuntimeAck | undefined;
  let sawStaleGeneration = false;

  for (;;) {
    let payload: unknown;
    try {
      payload = await deps.requestAck();
    } catch {
      payload = undefined;
    }

    if (payload !== undefined) {
      const missing = missingDcsFlagAckFields(payload);
      if (missing.length > 0) {
        lastMissing = missing;
      } else if (isCompleteDcsFlagAck(payload)) {
        const expected = deps.expectedGeneration();
        if (payload.gatewayGeneration !== expected) {
          // Old-generation ack: the pre-restart child answered. Discard it —
          // accepting it would let a stale process vouch for the new config.
          sawStaleGeneration = true;
          lastStaleAck = payload;
        } else {
          trail.push('runtime-acknowledged');
          if (payload.rejectedFlags && payload.rejectedFlags.length > 0) {
            trail.push('failed');
            return {
              state: 'failed',
              trail,
              ack: payload,
              failureReason: 'flag-rejected',
              operatorHintKey: 'developer.dcsProdFlags.ackHint.flagRejected',
            };
          }
          trail.push('applied');
          return { state: 'applied', trail, ack: payload };
        }
      }
    }

    if (now() >= deadline) break;
    await sleep(currentIntervalMs);
    currentIntervalMs = Math.min(currentIntervalMs * 2, maxPollIntervalMs);
    if (now() >= deadline) break;
  }

  if (sawStaleGeneration) {
    trail.push('failed');
    return {
      state: 'failed',
      trail,
      ...(lastStaleAck ? { ack: lastStaleAck } : {}),
      failureReason: 'ack-stale-generation',
      operatorHintKey: 'developer.dcsProdFlags.ackHint.staleGeneration',
    };
  }

  if (lastMissing && lastMissing.length > 0) {
    trail.push('failed');
    return {
      state: 'failed',
      trail,
      missingFields: lastMissing,
      failureReason: 'ack-incomplete',
      operatorHintKey: 'developer.dcsProdFlags.ackHint.ackIncomplete',
    };
  }

  if (deps.isRunning()) {
    // Still running but silent: keep the operator in a retryable state rather
    // than claiming a failure we cannot substantiate.
    return {
      state: 'pending-restart',
      trail,
      missingFields: [...DCS_FLAG_ACK_REQUIRED_FIELDS],
      failureReason: 'ack-timeout',
      operatorHintKey: 'developer.dcsProdFlags.ackHint.ackTimeoutRunning',
    };
  }

  trail.push('failed');
  return {
    state: 'failed',
    trail,
    missingFields: [...DCS_FLAG_ACK_REQUIRED_FIELDS],
    failureReason: 'ack-timeout',
    operatorHintKey: 'developer.dcsProdFlags.ackHint.ackTimeoutStopped',
  };
}
