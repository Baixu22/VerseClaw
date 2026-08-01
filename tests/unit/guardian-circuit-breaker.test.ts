import { describe, expect, it, beforeEach } from 'vitest';

import {
  GuardianCircuitBreaker,
  getSessionGuardianCircuitBreaker,
  resetAllGuardianCircuitBreakersForTests,
  resetGuardianCircuitBreaker,
} from '../../openclaw_runtime/src/agents/guardian-circuit-breaker';
import type { LongConversationControlSignal } from '../../openclaw_runtime/src/agents/long-conversation-control-signals';

function blockingSignal(overrides: Partial<LongConversationControlSignal> = {}): LongConversationControlSignal {
  return {
    kind: 'risk',
    severity: 'blocking',
    message: 'blocked by guardian test',
    ...overrides,
  };
}

function cleanSignal(): LongConversationControlSignal {
  return { kind: 'evidence_gap', severity: 'warning', message: 'clean check' };
}

describe('GuardianCircuitBreaker (P2-7)', () => {
  beforeEach(() => {
    resetAllGuardianCircuitBreakersForTests();
  });

  it('trips after consecutiveBlockingThreshold blocking records (default 3)', () => {
    const breaker = new GuardianCircuitBreaker();

    expect(breaker.record([blockingSignal()])).toBe('blocking');
    expect(breaker.record([blockingSignal()])).toBe('blocking');
    expect(breaker.getSnapshot()).toMatchObject({ consecutiveBlocking: 2, tripped: false });

    expect(breaker.record([blockingSignal()])).toBe('trip');
    expect(breaker.getSnapshot()).toMatchObject({ consecutiveBlocking: 3, tripped: true });
  });

  it('resets the consecutive counter on a clean record', () => {
    const breaker = new GuardianCircuitBreaker();

    breaker.record([blockingSignal()]);
    breaker.record([blockingSignal()]);
    expect(breaker.record([cleanSignal()])).toBe('clean');
    expect(breaker.getSnapshot()).toMatchObject({ consecutiveBlocking: 0, tripped: false });

    // 再 3 次连续 blocking 仍会 trip（计数从 0 重新累积）
    breaker.record([blockingSignal()]);
    breaker.record([blockingSignal()]);
    expect(breaker.record([blockingSignal()])).toBe('trip');
  });

  it('trips when the window (50) contains >= 10 blocking records even without consecutiveness', () => {
    const breaker = new GuardianCircuitBreaker({
      windowSize: 50,
      windowBlockingThreshold: 10,
    });

    // 9 次 blocking 各自被 clean 隔开 → 不连续但窗口累计到 9
    for (let index = 0; index < 9; index += 1) {
      breaker.record([blockingSignal()]);
      breaker.record([cleanSignal()]);
    }
    expect(breaker.getSnapshot()).toMatchObject({ windowBlockingCount: 9, tripped: false });

    // 第 10 次 blocking → 窗口阈值触发
    breaker.record([blockingSignal()]);
    expect(breaker.record([blockingSignal()])).toBe('trip');
    expect(breaker.getSnapshot()).toMatchObject({ windowBlockingCount: 10, tripped: true });
  });

  it('keeps returning trip after tripped until reset()', () => {
    const breaker = new GuardianCircuitBreaker();
    breaker.record([blockingSignal()]);
    breaker.record([blockingSignal()]);
    expect(breaker.record([blockingSignal()])).toBe('trip');
    expect(breaker.record([cleanSignal()])).toBe('trip');

    breaker.reset();
    expect(breaker.getSnapshot()).toMatchObject({ tripped: false, consecutiveBlocking: 0 });
    expect(breaker.record([cleanSignal()])).toBe('clean');
  });

  it('treats empty/undefined signals as clean', () => {
    const breaker = new GuardianCircuitBreaker();
    expect(breaker.record(undefined)).toBe('clean');
    expect(breaker.record([])).toBe('clean');
  });

  it('exposes per-session instances and reset', () => {
    const first = getSessionGuardianCircuitBreaker('agent:main:session-a');
    const second = getSessionGuardianCircuitBreaker('agent:main:session-a');
    const other = getSessionGuardianCircuitBreaker('agent:main:session-b');

    expect(first).toBe(second);
    expect(first).not.toBe(other);

    first.record([blockingSignal()]);
    expect(getSessionGuardianCircuitBreaker('agent:main:session-a').getSnapshot().consecutiveBlocking).toBe(1);
    expect(getSessionGuardianCircuitBreaker('agent:main:session-b').getSnapshot().consecutiveBlocking).toBe(0);

    resetGuardianCircuitBreaker('agent:main:session-a');
    expect(getSessionGuardianCircuitBreaker('agent:main:session-a').getSnapshot().consecutiveBlocking).toBe(0);
  });

  it('rejects invalid options', () => {
    expect(() => new GuardianCircuitBreaker({ windowBlockingThreshold: 51, windowSize: 50 })).toThrow();
    expect(() => new GuardianCircuitBreaker({ consecutiveBlockingThreshold: 0 })).toThrow();
  });
});
