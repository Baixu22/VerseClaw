// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBoundedConcurrencyGate, type BoundedConcurrencyLease } from '../../openclaw_runtime/src/infra/bounded-concurrency';
import {
  acquireProviderOutboundSlot, closeProviderOutboundBudget, configureProviderOutboundBudget,
  providerOutboundBudgetStats, resetProviderOutboundBudget,
  readProviderOutboundBudgetConfigFromEnv, PROVIDER_OUTBOUND_ENV,
  type ProviderOutboundAdmission, type ProviderOutboundQuotaGroup, type ProviderOutboundSlot,
} from '../../openclaw_runtime/src/agents/provider-outbound-budget';

const group = (id: string): ProviderOutboundQuotaGroup => ({ groupId: id, endpoint: 'https://fixture.invalid', account: 'test-only', provider: 'fixture', api: 'openai-completions' });
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('TF-0679 bounded gate keeps actual leases while limits change', () => {
  it('does not refill released slots while active ownership still exceeds the reduced limit', async () => {
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 2, maxQueue: 2 });
    const leases: BoundedConcurrencyLease[] = [];
    const a = await gate.acquire(), b = await gate.acquire();
    if (!a.ok || !b.ok) throw new Error('initial admission refused');
    leases.push(a.lease, b.lease);
    let granted = false;
    const pending = gate.acquire().then(result => { if (result.ok) { granted = true; leases.push(result.lease); } return result; });
    try {
      gate.setLimits({ maxConcurrent: 1 });
      a.lease.release();
      await tick();
      expect(granted).toBe(false);
      expect(gate.stats()).toMatchObject({ active: 1, queued: 1, maxConcurrent: 1 });
      b.lease.release();
      expect((await pending).ok).toBe(true);
    } finally { gate.close(); leases.forEach(lease => lease.release()); await pending; }
  });

  it('serves existing waiters immediately when the owner increases capacity', async () => {
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 1, maxQueue: 2 });
    const first = await gate.acquire();
    if (!first.ok) throw new Error('initial admission refused');
    let granted = false;
    const pending = gate.acquire().then(result => { granted = result.ok; return result; });
    try {
      gate.setLimits({ maxConcurrent: 2 });
      await tick();
      expect(granted).toBe(true);
      expect(gate.stats()).toMatchObject({ active: 2, queued: 0 });
    } finally { gate.close(); first.lease.release(); const last = await pending; if (last.ok) last.lease.release(); }
  });

  it('does not admit a waiter whose deadline passed before its timer callback ran', async () => {
    let now = 0;
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 10, now: () => now });
    const first = await gate.acquire();
    if (!first.ok) throw new Error('initial admission refused');
    const pending = gate.acquire();
    now = 11;
    first.lease.release();
    const next = await pending;
    try { expect(next).toMatchObject({ ok: false, reason: 'queue-timeout' }); }
    finally { gate.close(); if (next.ok) next.lease.release(); }
  });
});

describe('TF-0679 provider owner reconfiguration', () => {
  let slots: ProviderOutboundSlot[];
  let pending: Promise<ProviderOutboundAdmission>[];
  beforeEach(() => { resetProviderOutboundBudget(); slots = []; pending = []; });
  afterEach(async () => {
    slots.forEach(slot => slot.release());
    closeProviderOutboundBudget();
    await Promise.allSettled(pending.map(async promise => { const result = await promise; if (result.ok) result.slot.release(); }));
    resetProviderOutboundBudget();
  });
  const acquire = (id = 'a') => {
    const promise = acquireProviderOutboundSlot({ group: group(id) }).then(result => { if (result.ok) slots.push(result.slot); return result; });
    pending.push(promise);
    return promise;
  };

  it('does not create fresh capacity when the same configuration is reapplied', async () => {
    const config = { limits: { maxConcurrent: 1, maxQueue: 0 } };
    configureProviderOutboundBudget(config);
    expect((await acquire()).ok).toBe(true);
    configureProviderOutboundBudget(config);
    expect(await acquire()).toMatchObject({ ok: false, reason: 'overloaded' });
    expect(providerOutboundBudgetStats()[0]).toMatchObject({ active: 1, admitted: 1 });
  });

  it('keeps held slots and waiting callers on the same owner when capacity shrinks', async () => {
    configureProviderOutboundBudget({ limits: { maxConcurrent: 2, maxQueue: 2, queueTimeoutMs: 1000 } });
    const first = await acquire(), second = await acquire();
    if (!first.ok || !second.ok) throw new Error('initial admission refused');
    let granted = false;
    const next = acquire().then(result => { granted = result.ok; return result; });
    await tick();
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 2, queueTimeoutMs: 1000 } });
    expect(providerOutboundBudgetStats()[0]).toMatchObject({ active: 2, queued: 1, maxConcurrent: 1 });
    first.slot.release();
    await tick();
    expect(granted).toBe(false);
    second.slot.release();
    expect((await next).ok).toBe(true);
  });

  it('refuses to move an occupied quota to a new alias instead of dropping its ownership', async () => {
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0 } });
    const held = await acquire();
    if (!held.ok) throw new Error('initial admission refused');
    expect(() => configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0 }, quotaGroupAliases: { a: 'shared' } }))
      .toThrow();
    expect(await acquire()).toMatchObject({ ok: false });
    held.slot.release();
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0 }, quotaGroupAliases: { a: 'shared' } });
    expect((await acquire()).ok).toBe(true);
  });

  it('does not claim a new cap is effective while an ungated request remains alive', async () => {
    const held = await acquire();
    if (!held.ok) throw new Error('ungated request refused');
    expect(held.slot.limited).toBe(false);
    expect(() => configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0 } })).toThrow();
    held.slot.release();
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0 } });
    expect((await acquire()).ok).toBe(true);
    expect(await acquire()).toMatchObject({ ok: false, reason: 'overloaded' });
  });

  it('retains live gated requests across disable and re-enable', async () => {
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0 } });
    expect((await acquire()).ok).toBe(true);
    configureProviderOutboundBudget(undefined);
    expect(providerOutboundBudgetStats()[0]).toMatchObject({ active: 1, effectiveLimits: null });
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0 } });
    expect(await acquire()).toMatchObject({ ok: false, reason: 'overloaded' });
  });

  it('validates new limits before replacing a valid configuration', async () => {
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0 } });
    expect(() => configureProviderOutboundBudget({ limits: { maxConcurrent: 0 } })).toThrow();
    expect((await acquire()).ok).toBe(true);
    expect(await acquire()).toMatchObject({ ok: false });
  });

  it('owns its configuration snapshot instead of observing later caller mutations', async () => {
    const config = { limits: { maxConcurrent: 1, maxQueue: 0 } };
    configureProviderOutboundBudget(config);
    config.limits.maxConcurrent = 2;
    expect((await acquire()).ok).toBe(true);
    expect(await acquire()).toMatchObject({ ok: false });
  });

  it('does not let a diagnostic snapshot mutate the published owner policy', async () => {
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0 } });
    expect((await acquire('a')).ok).toBe(true);
    const view = providerOutboundBudgetStats()[0].effectiveLimits;
    if (!view) throw new Error('missing effective limit');
    view.maxConcurrent = 2;
    expect((await acquire('b')).ok).toBe(true);
    expect(await acquire('b')).toMatchObject({ ok: false });
  });

  it('shares a quota through a complete alias chain and rejects alias cycles', async () => {
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 0 }, quotaGroupAliases: { a: 'b', b: 'c', c: 'd', d: 'e', e: 'f', z: 'f' } });
    expect((await acquire('a')).ok).toBe(true);
    expect(await acquire('z')).toMatchObject({ ok: false });
    expect(() => configureProviderOutboundBudget({ quotaGroupAliases: { x: 'y', y: 'x' } })).toThrow();
  });

  it('uses one effective ceiling for differently overridden members of an aliased quota', async () => {
    configureProviderOutboundBudget({ quotas: { a: { maxConcurrent: 2, maxQueue: 0 }, b: { maxConcurrent: 1, maxQueue: 0 } },
      quotaGroupAliases: { a: 'shared', b: 'shared' } });
    expect((await acquire('a')).ok).toBe(true);
    expect(await acquire('b')).toMatchObject({ ok: false, reason: 'overloaded' });
    expect(providerOutboundBudgetStats()[0].maxConcurrent).toBe(1);
  });

  it('does not replace an occupied clock and installs a new clock once the owner is idle', async () => {
    const oldClock = () => 0;
    let now = 100;
    const newClock = () => now;
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 10 }, now: oldClock });
    const held = await acquire();
    if (!held.ok) throw new Error('initial admission refused');
    expect(() => configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 10 }, now: newClock })).toThrow();
    held.slot.release();
    configureProviderOutboundBudget({ limits: { maxConcurrent: 1, maxQueue: 1, queueTimeoutMs: 10 }, now: newClock });
    const current = await acquire();
    if (!current.ok) throw new Error('new clock admission refused');
    const waiting = acquire();
    now = 111;
    current.slot.release();
    expect(await waiting).toMatchObject({ ok: false, reason: 'queue-timeout' });
  });

  it('honors explicitly declared zero queue and timeout values', () => {
    expect(readProviderOutboundBudgetConfigFromEnv({
      [PROVIDER_OUTBOUND_ENV.maxConcurrent]: '1',
      [PROVIDER_OUTBOUND_ENV.maxQueue]: '0',
      [PROVIDER_OUTBOUND_ENV.queueTimeoutMs]: '0',
    })).toEqual({ limits: { maxConcurrent: 1, maxQueue: 0, queueTimeoutMs: 0 } });
  });
});
