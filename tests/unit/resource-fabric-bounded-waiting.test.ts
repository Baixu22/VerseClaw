// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEventListeners } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ResourceFabric } from '../../electron/services/resource-fabric';
import { ResourceLeaseManager, withWorkspaceResourceLease, resetResourceLeasesForTest } from '../../openclaw_runtime/src/agents/resource-leases';
import { Singleflight } from '../../shared/resources/singleflight';
import { runWithHostDeadline, getHostDeadline } from '../../electron/utils/host-deadline-context';

vi.mock('../../openclaw_runtime/src/logging/subsystem', () => ({ createSubsystemLogger: () => ({ info() {}, warn() {} }) }));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { resetResourceLeasesForTest(); vi.useRealTimers(); });

function owner(kind: 'fabric' | 'runtime', queueLength = 2, capacity = 1) {
  const fabric = new ResourceFabric({ accounts: { workspaceExec: {
    minLimit: capacity, maxLimit: capacity, initialLimit: capacity, queueLength,
  } } });
  const runtime = new ResourceLeaseManager({ queueLength });
  const leaseKind = capacity === 1 ? 'workspaceWriter' : 'workspaceExec';
  return {
    acquire: (options: { signal?: AbortSignal; deadline?: number; timeoutMs?: number } = {}) => kind === 'fabric'
      ? fabric.acquire('workspaceExec', 'bounded', options)
      : runtime.acquire(leaseKind, 'bounded', options),
    diagnostics: () => kind === 'fabric'
      ? fabric.getDiagnostics().accounts['workspaceExec:bounded'] ?? { active: 0, queued: 0 }
      : runtime.getDiagnostics(),
  };
}

describe.each(['fabric', 'runtime'] as const)('%s bounded waiting', kind => {
  it('enforces the exact waiting boundary and readmits after release', async () => {
    const o = owner(kind);
    const held = await o.acquire();
    const a = o.acquire(); const b = o.acquire();
    const rejected = o.acquire().catch(e => e);
    await flush();
    expect(o.diagnostics()).toMatchObject({ active: 1, queued: 2 });
    expect(await rejected).toMatchObject({ code: 'RESOURCE_QUEUE_FULL' });
    held.release(); held.release();
    (await a).release(); (await b).release();
    (await o.acquire()).release();
    expect(o.diagnostics()).toMatchObject({ active: 0, queued: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('allows immediate grants with zero waiting slots', async () => {
    const o = owner(kind, 0);
    const held = await o.acquire();
    await expect(o.acquire()).rejects.toMatchObject({ code: 'RESOURCE_QUEUE_FULL' });
    held.release(); (await o.acquire()).release();
  });
  it('cancels before enqueue and during waiting, removing timers and listeners', async () => {
    const o = owner(kind);
    const pre = new AbortController(); pre.abort();
    await expect(o.acquire({ signal: pre.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const held = await o.acquire();
    const c = new AbortController();
    const cancelled = o.acquire({ signal: c.signal }).catch(e => e);
    const next = o.acquire();
    c.abort(); c.abort();
    expect(await cancelled).toMatchObject({ name: 'AbortError' });
    expect(getEventListeners(c.signal, 'abort')).toHaveLength(0);
    expect(o.diagnostics()).toMatchObject({ active: 1, queued: 1 });
    held.release(); (await next).release();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('checks expired admission, waiting expiration and expiration at grant', async () => {
    const o = owner(kind);
    await expect(o.acquire({ deadline: Date.now() })).rejects.toMatchObject({ code: expect.stringContaining('TIMEOUT') });
    const held = await o.acquire();
    const c = new AbortController();
    const expired = o.acquire({ deadline: Date.now() + 10, signal: c.signal }).catch(e => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(await expired).toMatchObject({ code: expect.stringContaining('TIMEOUT') });
    expect(getEventListeners(c.signal, 'abort')).toHaveLength(0);
    const late = o.acquire({ deadline: Date.now() + 10 }).catch(e => e);
    vi.setSystemTime(Date.now() + 11); // Timer has not fired; grant must check the clock.
    held.release();
    expect(await late).toMatchObject({ code: expect.stringContaining('TIMEOUT') });
    (await o.acquire()).release();
    expect(o.diagnostics()).toMatchObject({ active: 0, queued: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('classifies all 200 requests with bounded peaks and no residual resources', async () => {
    const o = owner(kind, 64, 2);
    const controllers = Array.from({ length: 200 }, () => new AbortController());
    const outcomes: Array<{ id: number; status: string }> = [];
    const events: Array<{ active: number; queued: number }> = [];
    const sample = () => { const d = o.diagnostics(); events.push({ active: d.active, queued: d.queued }); };
    const runs = controllers.map((c, id) => {
      const p = o.acquire({ signal: c.signal, deadline: Date.now() + (id >= 20 && id < 36 ? 10 : 10_000) })
        .then(async lease => {
          sample();
          await new Promise(r => setTimeout(r, 50));
          lease.release(); lease.release(); sample();
          outcomes.push({ id, status: 'success' });
        }, error => {
          const status = error.name === 'AbortError' ? 'cancelled' : error.code === 'RESOURCE_QUEUE_FULL' ? 'rejected'
            : String(error.code).includes('TIMEOUT') ? 'timeout' : 'unexpected';
          outcomes.push({ id, status }); sample();
        });
      sample(); return p;
    });
    for (let id = 4; id < 20; id += 2) { controllers[id].abort(); sample(); }
    await vi.runAllTimersAsync(); await Promise.all(runs);
    const counts = Object.fromEntries(['success', 'rejected', 'cancelled', 'timeout', 'unexpected'].map(s => [s, outcomes.filter(o => o.status === s).length]));
    const peak = { active: Math.max(...events.map(e => e.active)), queued: Math.max(...events.map(e => e.queued)) };
    const final = { active: o.diagnostics().active, queued: o.diagnostics().queued, timers: vi.getTimerCount(),
      listeners: controllers.reduce((n, c) => n + getEventListeners(c.signal, 'abort').length, 0) };
    expect(counts).toEqual({ success: 42, rejected: 134, cancelled: 8, timeout: 16, unexpected: 0 });
    expect(new Set(outcomes.map(o => o.id)).size).toBe(200);
    expect(peak).toEqual({ active: 2, queued: 64 });
    expect(final).toEqual({ active: 0, queued: 0, timers: 0, listeners: 0 });
    if (process.env.RESOURCE_WAITING_REPORT_DIR) writeFileSync(join(process.env.RESOURCE_WAITING_REPORT_DIR, `pressure-${kind}.json`), JSON.stringify({ driven_by: 'agent', actor: 'codex', requests: 200, counts, peak, final, outcomes, events }, null, 2) + '\n');
  });
});

describe('regression: old Fabric admission', () => {
  it('rejects overflow before adding a timer or waiter', async () => {
    const o = owner('fabric', 0);
    const held = await o.acquire();
    const excess = o.acquire({ timeoutMs: 10 }).catch(e => e);
    const queued = o.diagnostics().queued;
    await vi.advanceTimersByTimeAsync(10); held.release();
    expect(await excess).toMatchObject({ code: 'RESOURCE_QUEUE_FULL' });
    expect(queued).toBe(0);
  });
  it('never invokes work cancelled between grant and callback', async () => {
    const f = new ResourceFabric(); const c = new AbortController(); const work = vi.fn(async () => 'ran');
    const p = f.runResource('workspaceExec', 'race', { signal: c.signal }, work).catch(e => e);
    c.abort(); await p;
    expect(work).not.toHaveBeenCalled();
    expect(f.getDiagnostics().accounts['workspaceExec:race'].active).toBe(0);
  });
  it('does not grant an already expired deadline', async () => {
    const o = owner('fabric'); const result = await o.acquire({ deadline: Date.now() - 1 }).catch(e => e);
    result.release?.();
    expect(result).toMatchObject({ code: 'TERMINAL_RESOURCE_LEASE_TIMEOUT' });
  });
});

describe('execution ownership and shared waits', () => {
  it('expires the actual host caller while another history subscriber keeps its own deadline', async () => {
    const f = new ResourceFabric(); const gate = deferred();
    const runner = vi.fn(async () => {
      expect(getHostDeadline()?.deadlineAtMs).toBe(101_000);
      await gate.promise; return 'done';
    });
    const a = runWithHostDeadline({ deadlineAtMs: Date.now() + 10, timeoutMs: 10, stage: 'renderer' },
      () => f.run('chat.history', { id: 'shared' }, 1000, runner)).catch(e => e);
    const b = runWithHostDeadline({ deadlineAtMs: Date.now() + 100, timeoutMs: 100, stage: 'renderer' },
      () => f.run('chat.history', { id: 'shared' }, 1000, runner));
    await vi.advanceTimersByTimeAsync(10);
    expect(await a).toMatchObject({ code: 'RESOURCE_FABRIC_TIMEOUT' });
    expect(f.getDiagnostics().chatHistory?.active).toBe(1);
    gate.resolve(); expect(await b).toBe('done'); expect(runner).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes a host-expired history waiter before it can start', async () => {
    const f = new ResourceFabric({ accounts: { chatHistory: { initialLimit: 1, maxLimit: 1, minLimit: 1 } } });
    const held = await f.acquire('chatHistory', 'held'); const never = vi.fn(async () => 'late');
    const pending = runWithHostDeadline({ deadlineAtMs: Date.now() + 10, timeoutMs: 10, stage: 'renderer' },
      () => f.run('chat.history', { id: 'queued' }, 1000, never)).catch(e => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({ code: 'RESOURCE_FABRIC_TIMEOUT' });
    held.release(); await flush();
    expect(never).not.toHaveBeenCalled();
    expect(f.getDiagnostics().chatHistory).toMatchObject({ active: 0, queued: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['fabric', 'runtime'] as const)('%s checks grant races and retains running capacity until work settles', async kind => {
    const f = new ResourceFabric(); const c = new AbortController(); const work = vi.fn(async () => {});
    const run = (signal: AbortSignal, callback: () => Promise<void>) => kind === 'fabric'
      ? f.runResource('workspaceExec', 'race', { signal }, callback)
      : withWorkspaceResourceLease('workspaceWriter', 'race', callback, { signal });
    const raced = run(c.signal, work).catch(e => e); c.abort();
    expect(await raced).toMatchObject({ name: 'AbortError' }); expect(work).not.toHaveBeenCalled();
    const gate = deferred(); const active = new AbortController(); let finished = false;
    const running = run(active.signal, () => gate.promise).finally(() => { finished = true; }).catch(e => e);
    await flush(); active.abort(); await flush(); expect(finished).toBe(false);
    gate.resolve(); expect(await running).toBeUndefined();
    expect(getEventListeners(active.signal, 'abort')).toHaveLength(0);
    await expect(run(new AbortController().signal, async () => { throw new Error('work failed'); })).rejects.toThrow('work failed');
    await run(new AbortController().signal, async () => {});
    expect(vi.getTimerCount()).toBe(0);
  });
  it('isolates subscriber aborts and deadlines, including all leaving before work begins', async () => {
    const f = new Singleflight<string, number>(); const gate = deferred();
    const a = new AbortController(); const b = new AbortController();
    const work = vi.fn(async () => { await gate.promise; return 7; });
    const first = f.run('shared', work, { signal: a.signal }).catch(e => e);
    const second = f.run('shared', work, { signal: b.signal });
    a.abort(); expect(await first).toMatchObject({ name: 'AbortError' });
    gate.resolve(); expect(await second).toBe(7); expect(work).toHaveBeenCalledOnce();
    expect(f.size).toBe(0);
    const expired = f.run('new', work, { deadline: Date.now() }).catch(e => e);
    expect(await expired).toMatchObject({ name: 'TimeoutError' });
    const c = new AbortController(); const never = vi.fn(async () => 1);
    const gone = f.run('gone', never, { signal: c.signal }).catch(e => e); c.abort();
    expect(await gone).toMatchObject({ name: 'AbortError' }); await flush();
    expect(never).not.toHaveBeenCalled(); expect(f.size).toBe(0);
    expect([a,b,c].reduce((n,c) => n + getEventListeners(c.signal,'abort').length,0)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('passes only remaining history time and cancels abandoned queued flights', async () => {
    const f = new ResourceFabric({ accounts: { chatHistory: { minLimit: 1, maxLimit: 1, initialLimit: 1 } } });
    const gate = deferred(); const held = f.run('chat.history', { id: 0 }, 1000, () => gate.promise);
    await flush(); const runner = vi.fn(async (_method: string, _params?: unknown, _timeoutMs?: number) => 'ok');
    const next = f.run('chat.history', { id: 1 }, 100, runner);
    const c = new AbortController(); const never = vi.fn(async () => 'late');
    const gone = f.run('chat.history', { id: 2 }, 100, never, { signal: c.signal }).catch(e => e);
    await flush(); c.abort(); await flush();
    expect(await gone).toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(40); gate.resolve(); await held;
    expect(await next).toBe('ok'); expect(runner.mock.calls[0][2]).toBe(60);
    expect(never).not.toHaveBeenCalled();
    expect(f.getDiagnostics().chatHistory).toMatchObject({ active: 0, queued: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a surviving subscriber when another deadline expires during shared work', async () => {
    const f = new Singleflight<string, number>(); const gate = deferred(); let signal!: AbortSignal;
    const work = async (s: AbortSignal) => { signal = s; await gate.promise; return 3; };
    const a = f.run('key', work, { deadline: Date.now() + 10 }).catch(e => e);
    const b = f.run('key', work, { deadline: Date.now() + 100 });
    await vi.advanceTimersByTimeAsync(10); expect(await a).toMatchObject({ name: 'TimeoutError' });
    expect(signal.aborted).toBe(false); gate.resolve(); expect(await b).toBe(3);
    expect(f.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, new Error('failed')])('preserves shared rejection including %s', async reason => {
    const f = new Singleflight<string, number>();
    const outcomes = await Promise.allSettled([f.run('fail', () => Promise.reject(reason), {}), f.run('fail', async () => 1, {})]);
    expect(outcomes).toEqual([{ status: 'rejected', reason }, { status: 'rejected', reason }]);
    expect(f.size).toBe(0);
  });
});
