// @vitest-environment node
// NET-E (TF-0442): one logical deadline shared across host-action layers.
import { describe, expect, it } from 'vitest';

import {
  clampHostTimeoutToDeadline,
  createHostDeadline,
  isHostDeadlineExpired,
  readHostDeadline,
  remainingHostBudgetMs,
  toHostTimeoutDetails,
} from '@shared/host-api/host-deadline';

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe('host logical deadline', () => {
  it('anchors the deadline to an absolute timestamp instead of a second timeout', () => {
    const c = clock();
    const deadline = createHostDeadline({
      stage: 'renderer',
      timeoutMs: 60_000,
      requestId: 'req-1',
      now: c.now,
    });
    expect(deadline).toEqual({
      deadlineAtMs: 61_000,
      timeoutMs: 60_000,
      stage: 'renderer',
      requestId: 'req-1',
    });
    c.advance(20_000);
    expect(remainingHostBudgetMs(deadline, c.now)).toBe(40_000);
    expect(isHostDeadlineExpired(deadline, c.now)).toBe(false);
    c.advance(40_000);
    expect(remainingHostBudgetMs(deadline, c.now)).toBe(0);
    expect(isHostDeadlineExpired(deadline, c.now)).toBe(true);
  });

  it('clamps each layer to the remaining budget instead of adding to it', () => {
    const c = clock();
    const deadline = createHostDeadline({ stage: 'renderer', timeoutMs: 60_000, now: c.now });
    // A layer with a 30s local budget before any time is spent keeps 30s.
    expect(clampHostTimeoutToDeadline(30_000, deadline, c.now)).toBe(30_000);
    c.advance(45_000);
    // Later, the same layer is clamped to what is left (15s), never 30s again.
    expect(clampHostTimeoutToDeadline(30_000, deadline, c.now)).toBe(15_000);
    // A 15-minute long-action budget is clamped the same way.
    expect(clampHostTimeoutToDeadline(15 * 60_000, deadline, c.now)).toBe(15_000);
    c.advance(20_000);
    expect(clampHostTimeoutToDeadline(30_000, deadline, c.now)).toBe(0);
  });

  it('stays inert for callers that do not propagate a deadline', () => {
    expect(clampHostTimeoutToDeadline(60_000, undefined)).toBe(60_000);
    expect(clampHostTimeoutToDeadline(0, undefined)).toBe(0);
  });

  it('validates propagated deadline metadata', () => {
    expect(readHostDeadline({
      deadlineAtMs: 1_000,
      timeoutMs: 500,
      stage: 'renderer',
      requestId: 'req-2',
    })).toEqual({ deadlineAtMs: 1_000, timeoutMs: 500, stage: 'renderer', requestId: 'req-2' });
    for (const invalid of [
      null,
      'deadline',
      {},
      { deadlineAtMs: 1_000, timeoutMs: 500, stage: 'unknown-layer' },
      { deadlineAtMs: -1, timeoutMs: 500, stage: 'renderer' },
      { deadlineAtMs: 1_000, timeoutMs: 0, stage: 'renderer' },
    ]) {
      expect(readHostDeadline(invalid)).toBeUndefined();
    }
  });

  it('reports stage, budget, elapsed time and the local correlation id', () => {
    const deadline = createHostDeadline({ stage: 'renderer', timeoutMs: 60_000, requestId: 'req-3', now: () => 0 });
    expect(toHostTimeoutDetails({
      stage: 'main',
      deadlineMs: 12_345.7,
      elapsedMs: 678.2,
      requestId: 'req-3',
      deadline,
    })).toEqual({
      stage: 'main',
      deadlineMs: 12_345,
      elapsedMs: 678,
      requestId: 'req-3',
      deadlineAtMs: 60_000,
    });
    // Without a propagated deadline the details still carry the local fields.
    expect(toHostTimeoutDetails({ stage: 'main', deadlineMs: 60_000, elapsedMs: 60_000 })).toEqual({
      stage: 'main',
      deadlineMs: 60_000,
      elapsedMs: 60_000,
    });
  });
});
