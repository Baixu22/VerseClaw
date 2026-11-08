import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResourceFabric,
  TerminalResourceLeaseTimeoutError,
  isTerminalResourceLeaseTimeoutError,
  resetTerminalResourceLeasesForTest,
  withWorkspaceExecLease,
  resourceFabric,
} from '../../electron/services/resource-fabric';
import { getResourceEnvelopeLedger, resetResourceEnvelopeLedgerForTest } from '../../openclaw_runtime/src/resources/resource-envelope';

afterEach(() => {
  resetTerminalResourceLeasesForTest();
  resetResourceEnvelopeLedgerForTest();
  vi.useRealTimers();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('workspace exec lease', () => {
  it('preserves FIFO, capacity and queuedMs for 200 queued requests', async () => {
    vi.useFakeTimers();
    // Keep the 200-success FIFO workload within an explicitly sized queue;
    // resource-fabric-bounded-waiting covers overflow at the production 64 cap.
    const fabric = new ResourceFabric({ accounts: { workspaceExec: { queueLength: 200 } } });
    const started: number[] = [];
    const queuedMs: number[] = [];
    let active = 0;
    let peak = 0;
    const runs = Array.from({ length: 200 }, (_, id) =>
      fabric.runResource('workspaceExec', 'burst', { timeoutMs: 5_000 }, async (lease) => {
        started.push(id);
        queuedMs.push(lease.queuedMs);
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
      }),
    );
    await vi.runAllTimersAsync();
    await Promise.all(runs);
    expect(started).toEqual(Array.from({ length: 200 }, (_, id) => id));
    expect(peak).toBe(4);
    expect(active).toBe(0);
    expect(queuedMs[2]).toBeGreaterThan(0);
    expect(Math.max(...queuedMs)).toBeGreaterThan(0);
  });

  it('removes timed-out work and admits the next waiter after release', async () => {
    vi.useFakeTimers();
    const gate = deferred();
    const held = [1, 2].map(() => withWorkspaceExecLease('timeout', 100, () => gate.promise));
    const expired = vi.fn(async () => {});
    const rejected = withWorkspaceExecLease('timeout', 10, expired).catch((error) => error);
    const next = vi.fn(async () => {});
    const pending = withWorkspaceExecLease('timeout', 100, next);
    await vi.advanceTimersByTimeAsync(10);
    expect(await rejected).toMatchObject({
      code: 'TERMINAL_RESOURCE_LEASE_TIMEOUT', leaseKind: 'workspaceExec', leaseKey: 'timeout', timeoutMs: 10,
    });
    gate.resolve();
    await Promise.all([...held, pending]);
    expect(expired).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    await withWorkspaceExecLease('timeout', 100, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('releases a slot after synchronous throws and asynchronous rejections', async () => {
    for (const fail of [() => { throw new Error('sync'); }, () => Promise.reject(new Error('async'))]) {
      resetTerminalResourceLeasesForTest();
      const gate = deferred();
      const held = withWorkspaceExecLease('failure', 100, () => gate.promise);
      await expect(withWorkspaceExecLease('failure', 100, fail)).rejects.toThrow();
      const next = vi.fn(async () => {});
      await withWorkspaceExecLease('failure', 100, next);
      expect(next).toHaveBeenCalledOnce();
      gate.resolve();
      await held;
    }
  });

  it('does not let a stale double release over-admit while another lease is held', async () => {
    const gates = Array.from({ length: 4 }, deferred);
    const started: number[] = [];
    let firstLease: { release: () => void } | undefined;
    const runs = gates.map((gate, id) => withWorkspaceExecLease('double-release', 5_000, async (lease) => {
      started.push(id);
      if (id === 0) firstLease = lease;
      await gate.promise;
    }));
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    gates[0].resolve();
    await runs[0];
    firstLease!.release();
    firstLease!.release();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    gates.forEach((gate) => gate.resolve());
    await Promise.all(runs);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('grants up to capacity 2 immediately and queues the third', async () => {
    const gate = deferred();
    const granted: number[] = [];
    const hold = (id: number) =>
      withWorkspaceExecLease('ws-a', 5_000, async (lease) => {
        granted.push(id);
        expect(lease.leaseKind).toBe('workspaceExec');
        await gate.promise;
      });

    const first = hold(1);
    const second = hold(2);
    const third = hold(3);
    await Promise.resolve();
    expect(granted).toEqual([1, 2]);

    gate.resolve();
    await Promise.all([first, second, third]);
    expect(granted).toEqual([1, 2, 3]);
  });

  it('does not block a different workspace key', async () => {
    const gate = deferred();
    const started: string[] = [];
    const a = withWorkspaceExecLease('ws-a', 5_000, async () => {
      started.push('a');
      await gate.promise;
    });
    const b = withWorkspaceExecLease('ws-b', 5_000, async () => {
      started.push('b');
      await gate.promise;
    });
    await Promise.resolve();
    expect(started.sort()).toEqual(['a', 'b']);
    gate.resolve();
    await Promise.all([a, b]);
  });

  it('records active and queued slots in the shadow resource envelope', async () => {
    const gate = deferred();
    const runs = [1, 2, 3].map((id) => withWorkspaceExecLease('envelope-ws', 5_000, async () => {
      if (id <= 2) await gate.promise;
    }));
    await Promise.resolve();
    const entry = getResourceEnvelopeLedger().get('main:terminal-exec:envelope-ws');
    expect(entry).toMatchObject({ activeSlots: 2, queuedCount: 1, kind: 'terminal-exec', owner: 'main' });
    gate.resolve();
    await Promise.all(runs);
    const idle = getResourceEnvelopeLedger().get('main:terminal-exec:envelope-ws');
    expect(idle).toBeUndefined();
    expect(resourceFabric.getDiagnostics().accounts['workspaceExec:envelope-ws']).toMatchObject({ active: 0, queued: 0, limit: 2 });
  });
  it('rejects with a typed timeout error when the slot never frees', async () => {
    const gate = deferred();
    const held = [
      withWorkspaceExecLease('ws-a', 5_000, () => gate.promise),
      withWorkspaceExecLease('ws-a', 5_000, () => gate.promise),
    ];
    await Promise.resolve();
    const error = await withWorkspaceExecLease('ws-a', 20, async () => {}).catch((e) => e);
    expect(isTerminalResourceLeaseTimeoutError(error)).toBe(true);
    expect(error).toBeInstanceOf(TerminalResourceLeaseTimeoutError);
    gate.resolve();
    await Promise.all(held);
  });

});
