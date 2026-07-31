// @vitest-environment node
/**
 * FP-P0-04: the acknowledgement state machine.
 *
 * `applied` must be unreachable without a complete, current-generation ack from
 * the child. These cases pin: the happy path, each of the seven fields being
 * individually load-bearing, stale-generation discard, timeout branching, and
 * partial flag rejection.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  collectRuntimeFlagAck,
  type DcsFlagAckDeps,
} from '@electron/services/dcs-flag-ack';
import {
  DCS_FLAG_ACK_REQUIRED_FIELDS,
  isCompleteDcsFlagAck,
  missingDcsFlagAckFields,
  type DcsFlagRuntimeAck,
} from '../../shared/dcs/prod-flags-control';

function completeAck(overrides: Partial<DcsFlagRuntimeAck> = {}): DcsFlagRuntimeAck {
  return {
    gatewayGeneration: '7',
    childPid: 4242,
    effectiveFlags: { 'runtime.contextBlock.working_memory.enabled': true },
    configSource: { path: 'C:/state/openclaw.json', exists: true, origin: 'state-dir' },
    runtimeBuildOrConfigHash: 'abc123',
    turnEffectProbe: { wouldChangeTurn: true, killSwitchEngaged: false, activeSurfaces: ['wm'] },
    degradedReason: null,
    answeredAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  };
}

function deps(overrides: Partial<DcsFlagAckDeps> = {}): DcsFlagAckDeps {
  return {
    expectedGeneration: () => '7',
    requestAck: async () => completeAck(),
    isRunning: () => true,
    timeoutMs: 50,
    pollIntervalMs: 5,
    sleep: async () => undefined,
    ...overrides,
  };
}

describe('FP-P0-04 ack payload completeness', () => {
  it('accepts a complete payload', () => {
    expect(missingDcsFlagAckFields(completeAck())).toEqual([]);
    expect(isCompleteDcsFlagAck(completeAck())).toBe(true);
  });

  it.each(DCS_FLAG_ACK_REQUIRED_FIELDS)(
    'rejects a payload missing %s (each of the seven is load-bearing)',
    (field) => {
      const payload = completeAck() as unknown as Record<string, unknown>;
      delete payload[field];
      expect(missingDcsFlagAckFields(payload)).toContain(field);
      expect(isCompleteDcsFlagAck(payload)).toBe(false);
    },
  );

  it('treats degradedReason: null as present, not missing', () => {
    expect(missingDcsFlagAckFields(completeAck({ degradedReason: null }))).toEqual([]);
  });

  it('accepts a string degradedReason (degraded but complete)', () => {
    expect(missingDcsFlagAckFields(completeAck({ degradedReason: 'config-file-absent' }))).toEqual(
      [],
    );
  });

  it('rejects non-object payloads outright', () => {
    for (const bad of [undefined, null, 'ack', 42, []]) {
      expect(missingDcsFlagAckFields(bad)).toEqual([...DCS_FLAG_ACK_REQUIRED_FIELDS]);
    }
  });
});

describe('FP-P0-04 collectRuntimeFlagAck', () => {
  it('reaches applied only through the full ordered trail', async () => {
    const outcome = await collectRuntimeFlagAck(deps());
    expect(outcome.state).toBe('applied');
    expect(outcome.trail).toEqual([
      'saved',
      'pending-restart',
      'restarting',
      'runtime-acknowledged',
      'applied',
    ]);
    expect(outcome.ack?.childPid).toBe(4242);
  });

  it('discards an old-generation ack instead of accepting it as proof', async () => {
    const outcome = await collectRuntimeFlagAck(
      deps({ requestAck: async () => completeAck({ gatewayGeneration: '6' }) }),
    );
    expect(outcome.state).toBe('failed');
    expect(outcome.failureReason).toBe('ack-stale-generation');
    expect(outcome.trail).not.toContain('applied');
    expect(outcome.operatorHintKey).toBe('developer.dcsProdFlags.ackHint.staleGeneration');
  });

  it('does not mark applied when a required field is missing', async () => {
    const incomplete = completeAck() as unknown as Record<string, unknown>;
    delete incomplete.turnEffectProbe;
    const outcome = await collectRuntimeFlagAck(deps({ requestAck: async () => incomplete }));
    expect(outcome.state).toBe('failed');
    expect(outcome.failureReason).toBe('ack-incomplete');
    expect(outcome.missingFields).toContain('turnEffectProbe');
  });

  it('ack timeout while running stays retryable as pending-restart', async () => {
    const outcome = await collectRuntimeFlagAck(
      deps({
        requestAck: async () => {
          throw new Error('gateway not connected');
        },
        isRunning: () => true,
      }),
    );
    expect(outcome.state).toBe('pending-restart');
    expect(outcome.failureReason).toBe('ack-timeout');
    expect(outcome.operatorHintKey).toBe('developer.dcsProdFlags.ackHint.ackTimeoutRunning');
  });

  it('ack timeout with a stopped gateway is failed', async () => {
    const outcome = await collectRuntimeFlagAck(
      deps({
        requestAck: async () => {
          throw new Error('gateway stopped');
        },
        isRunning: () => false,
      }),
    );
    expect(outcome.state).toBe('failed');
    expect(outcome.failureReason).toBe('ack-timeout');
    expect(outcome.operatorHintKey).toBe('developer.dcsProdFlags.ackHint.ackTimeoutStopped');
  });

  it('expresses partial flag rejection as failed, not applied', async () => {
    const outcome = await collectRuntimeFlagAck(
      deps({
        requestAck: async () =>
          completeAck({
            rejectedFlags: [
              {
                id: 'runtime.contextBlock.working_memory.enabled',
                requested: true,
                effective: false,
                reason: 'kill-switch-engaged',
              },
            ],
          }),
      }),
    );
    expect(outcome.state).toBe('failed');
    expect(outcome.failureReason).toBe('flag-rejected');
    expect(outcome.trail).toContain('runtime-acknowledged');
    expect(outcome.trail).not.toContain('applied');
    expect(outcome.ack?.rejectedFlags?.[0]?.reason).toBe('kill-switch-engaged');
  });

  it('recovers when the child answers only after a few polls', async () => {
    let calls = 0;
    const requestAck = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error('not ready');
      return completeAck();
    });
    const outcome = await collectRuntimeFlagAck(deps({ requestAck }));
    expect(outcome.state).toBe('applied');
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// FP-P1-09: tuning parameterization + exponential backoff.
// ---------------------------------------------------------------------------
import {
  DCS_FLAG_ACK_MAX_POLL_INTERVAL_MS,
  DCS_FLAG_ACK_POLL_INTERVAL_MS,
  DCS_FLAG_ACK_TIMEOUT_MS,
  resolveDcsFlagAckTuning,
} from '@electron/services/dcs-flag-ack';

describe('FP-P1-09 resolveDcsFlagAckTuning', () => {
  it('missing / zero / invalid overrides fall back to measured defaults', () => {
    for (const overrides of [undefined, {}, { timeoutMs: 0, pollIntervalMs: 0 }, { timeoutMs: Number.NaN, pollIntervalMs: -5 }]) {
      const tuning = resolveDcsFlagAckTuning(overrides as never);
      expect(tuning.timeoutMs).toBe(DCS_FLAG_ACK_TIMEOUT_MS);
      expect(tuning.pollIntervalMs).toBe(DCS_FLAG_ACK_POLL_INTERVAL_MS);
      expect(tuning.maxPollIntervalMs).toBe(DCS_FLAG_ACK_MAX_POLL_INTERVAL_MS);
    }
  });

  it('valid overrides are honored and clamped to sane bounds', () => {
    expect(resolveDcsFlagAckTuning({ timeoutMs: 90_000, pollIntervalMs: 1_000 })).toEqual({
      timeoutMs: 90_000,
      pollIntervalMs: 1_000,
      maxPollIntervalMs: DCS_FLAG_ACK_MAX_POLL_INTERVAL_MS,
    });
    // A typo cannot disable the wait (min 1s) or hang forever (max 10 min).
    expect(resolveDcsFlagAckTuning({ timeoutMs: 1 }).timeoutMs).toBe(1_000);
    expect(resolveDcsFlagAckTuning({ timeoutMs: 10_000_000 }).timeoutMs).toBe(600_000);
    // Poll interval above the backoff ceiling raises the ceiling with it.
    expect(resolveDcsFlagAckTuning({ pollIntervalMs: 8_000 }).maxPollIntervalMs).toBe(8_000);
  });
});

describe('FP-P1-09 exponential backoff', () => {
  async function countPollsUntilTimeout(options: { pollIntervalMs: number; maxPollIntervalMs?: number; fixedLegacy?: boolean }) {
    // Silent child for the whole window: counts requestAck calls over a
    // simulated 60s wait using a virtual clock.
    let clock = 0;
    let calls = 0;
    const outcome = await collectRuntimeFlagAck(deps({
      requestAck: async () => {
        calls += 1;
        throw new Error('child not up yet');
      },
      timeoutMs: 60_000,
      pollIntervalMs: options.pollIntervalMs,
      // fixedLegacy simulates the pre-FP-P1-09 constant interval by capping the
      // backoff ceiling at the initial interval.
      maxPollIntervalMs: options.fixedLegacy ? options.pollIntervalMs : options.maxPollIntervalMs,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    }));
    expect(outcome.state).toBe('pending-restart');
    expect(outcome.failureReason).toBe('ack-timeout');
    return calls;
  }

  it('slow start burns far fewer RPCs than the legacy fixed interval', async () => {
    const legacyCalls = await countPollsUntilTimeout({ pollIntervalMs: 500, fixedLegacy: true });
    const backoffCalls = await countPollsUntilTimeout({ pollIntervalMs: 250, maxPollIntervalMs: 4_000 });
    // Legacy: 60s / 0.5s = ~120 RPCs. Backoff: 250ms doubling to a 4s ceiling
    // ⇒ ~20 RPCs over the same 60s window.
    expect(legacyCalls).toBeGreaterThanOrEqual(100);
    expect(backoffCalls).toBeLessThanOrEqual(25);

    console.log('[fp-p1-09-rpc-count]', JSON.stringify({ legacyCalls, backoffCalls }));
  });

  it('backoff never delays a fast child: immediate ack still applies on first poll', async () => {
    let calls = 0;
    const outcome = await collectRuntimeFlagAck(deps({
      requestAck: async () => {
        calls += 1;
        return completeAck();
      },
    }));
    expect(outcome.state).toBe('applied');
    expect(calls).toBe(1);
  });

  it('an ack arriving mid-backoff is accepted (timeout still governed by deadline, not interval)', async () => {
    let clock = 0;
    let calls = 0;
    const outcome = await collectRuntimeFlagAck(deps({
      requestAck: async () => {
        calls += 1;
        if (clock < 10_000) throw new Error('booting');
        return completeAck();
      },
      timeoutMs: 60_000,
      pollIntervalMs: 250,
      maxPollIntervalMs: 4_000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    }));
    expect(outcome.state).toBe('applied');
    expect(calls).toBeLessThanOrEqual(10);
  });
});
