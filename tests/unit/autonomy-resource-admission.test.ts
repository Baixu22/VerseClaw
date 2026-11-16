import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResourceFabric, type FabricLease } from '../../electron/services/resource-fabric';
import { DrfShare, PriorityQueue } from '../../shared/resources';
import { getResourceEnvelopeLedger, resetResourceEnvelopeLedgerForTest } from '../../openclaw_runtime/src/resources/resource-envelope';

describe('TF-0679 existing Fabric admission owners', () => {
  beforeEach(() => resetResourceEnvelopeLedgerForTest());
  afterEach(() => resetResourceEnvelopeLedgerForTest());

  it('does not spend the same host capacity independently for different tenants', () => {
    const shares = new DrfShare({ processes: 2, concurrency: 2 });
    shares.reserve('session-a', { processes: 2, concurrency: 1 });
    expect(() => shares.reserve('session-b', { processes: 1, concurrency: 1 })).toThrow(RangeError);
    expect(shares.share('session-b')).toBe(0);
    shares.reserve('session-b', { concurrency: 1 });
    expect(() => shares.reserve('session-c', { concurrency: 1 })).toThrow(RangeError);
    shares.release('session-a', { processes: 1 });
    expect(shares.reserve('session-c', { processes: 1 })).toEqual({ processes: 1, concurrency: 0 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0.5])('rejects a non-finite or fractional reservation: %s', value => {
    const shares = new DrfShare({ processes: 2, concurrency: 2 });
    expect(() => shares.reserve('session', { concurrency: value })).toThrow(RangeError);
    expect(shares.share('session')).toBe(0);
  });

  it.each(['background', 'opportunistic'] as const)('eventually serves old %s work before new interactive arrivals', qos => {
    let now = 0;
    const queue = new PriorityQueue<string>({ agePromotionMs: 10, now: () => now });
    queue.push('old', qos);
    now = 25;
    queue.push('new', 'interactive');
    expect(queue.dequeue()).toBe('old');
    expect(queue.dequeue()).toBe('new');
  });

  it('does not let repeated temporary boosts starve old work', () => {
    let now = 0;
    const queue = new PriorityQueue<string>({ agePromotionMs: 10, now: () => now });
    queue.push('old', 'opportunistic');
    now = 40;
    queue.push('new', 'interactive');
    queue.boost('new', 100);
    expect(queue.dequeue()).toBe('old');
  });

  it('keeps all workspace accounts within the existing shared host capacity and wakes another account', async () => {
    const fabric = new ResourceFabric();
    const leases: FabricLease[] = [];
    let overflowGranted = false;
    let overflow: Promise<FabricLease> | undefined;
    try {
      leases.push(...await Promise.all(Array.from({ length: 64 }, (_, id) => fabric.acquire(
        'workspaceExec', 'workspace-' + id, { tenant: 'session-' + id, timeoutMs: 1000 },
      ))));
      overflow = fabric.acquire('workspaceExec', 'another-workspace', { tenant: 'another-session', timeoutMs: 1000 })
        .then(lease => { overflowGranted = true; leases.push(lease); return lease; });
      await Promise.resolve();
      expect(overflowGranted).toBe(false);
      expect(Object.values(fabric.getDiagnostics().accounts).reduce((sum, account) => sum + account.active, 0)).toBe(64);
      leases[0].release();
      await expect(overflow).resolves.toMatchObject({ leaseKind: 'workspaceExec' });
      expect(Object.values(fabric.getDiagnostics().accounts).reduce((sum, account) => sum + account.active, 0)).toBe(64);
    } finally {
      leases.forEach(lease => lease.release());
      await overflow?.then(lease => lease.release());
    }
  });

  it('bounds the existing account queue without losing the older waiter', async () => {
    const fabric = new ResourceFabric({ accounts: { workspaceExec: { initialLimit: 1, minLimit: 1, maxLimit: 1, queueLength: 1 } } });
    const held = await fabric.acquire('workspaceExec', 'workspace');
    const next = fabric.acquire('workspaceExec', 'workspace', { timeoutMs: 1000 });
    try {
      await expect(fabric.acquire('workspaceExec', 'workspace', { timeoutMs: 40 }))
        .rejects.toMatchObject({ code: 'RESOURCE_QUEUE_FULL' });
      expect(fabric.getDiagnostics().accounts['workspaceExec:workspace']).toMatchObject({ active: 1, queued: 1 });
    } finally {
      held.release();
      (await next).release();
    }
  });

  it('cancels a waiting acquisition without releasing the active owner or running cancelled work', async () => {
    const fabric = new ResourceFabric({ accounts: { workspaceExec: { initialLimit: 1, minLimit: 1, maxLimit: 1 } } });
    const held = await fabric.acquire('workspaceExec', 'workspace');
    const abort = new AbortController();
    let ran = false;
    const pending = fabric.runResource('workspaceExec', 'workspace', { signal: abort.signal, timeoutMs: 40 }, async () => { ran = true; });
    abort.abort();
    try {
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(ran).toBe(false);
      expect(fabric.getDiagnostics().accounts['workspaceExec:workspace']).toMatchObject({ active: 1, queued: 0 });
    } finally { held.release(); }
  });

  it('checks cancellation again after a grant and before dispatching the work', async () => {
    const fabric = new ResourceFabric();
    const abort = new AbortController();
    let ran = false;
    const pending = fabric.runResource('workspaceExec', 'workspace', { signal: abort.signal }, async () => { ran = true; });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(ran).toBe(false);
    expect(fabric.getDiagnostics().accounts['workspaceExec:workspace']).toMatchObject({ active: 0, queued: 0 });
  });

  it('rebuilds the shadow envelope from the live Fabric owner after the view is cleared', async () => {
    const fabric = new ResourceFabric({ accounts: { workspaceExec: { initialLimit: 1, minLimit: 1, maxLimit: 1 } } });
    const held = await fabric.acquire('workspaceExec', 'workspace');
    try {
      resetResourceEnvelopeLedgerForTest();
      expect(getResourceEnvelopeLedger().list()).toHaveLength(0);
      expect(fabric.getDiagnostics().accounts['workspaceExec:workspace']).toMatchObject({ active: 1, limit: 1 });
      expect(getResourceEnvelopeLedger().get('main:terminal-exec:workspace'))
        .toMatchObject({ activeSlots: 1, limits: { concurrencySlots: 1 } });
    } finally { held.release(); }
  });

  it('keeps stop and control RPCs reachable while the history admission queue is occupied', async () => {
    const fabric = new ResourceFabric({ accounts: { chatHistory: { initialLimit: 1, minLimit: 1, maxLimit: 1 } } });
    const held = await fabric.acquire('chatHistory', 'history');
    try {
      await expect(fabric.run('agent.abort', { sessionKey: 'session' }, 100, async () => 'stopped')).resolves.toBe('stopped');
      expect(fabric.getDiagnostics().chatHistory?.active).toBe(1);
    } finally { held.release(); }
  });
});
