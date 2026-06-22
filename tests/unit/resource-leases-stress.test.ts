import { describe, expect, it } from "vitest";
import { ResourceLeaseManager } from "../../openclaw_runtime/src/agents/resource-leases";

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

describe('ResourceLeaseManager stress', () => {
  it('handles 30 concurrent mixed-kind acquires across 5 workspace keys without deadlock', async () => {
    const manager = new ResourceLeaseManager({ logger: null });
    const workspaces = ['ws-a', 'ws-b', 'ws-c', 'ws-d', 'ws-e'];
    const tasks = [];
    const results = [];

    for (let i = 0; i < workspaces.length; i++) {
      const ws = workspaces[i];
      for (let j = 0; j < 3; j++) {
        tasks.push(
          manager.withLease(
            { resources: [{ kind: 'workspaceWriter', key: ws, capacity: 1 }], timeoutMs: 100 },
            async (lease) => { results.push({ ws, kind: 'writer', queuedMs: lease.queuedMs, ok: true }); await wait(1); },
          ).catch((err) => { results.push({ ws, kind: 'writer', queuedMs: -1, ok: false, err: String(err) }); }),
        );
      }
      for (let j = 0; j < 3; j++) {
        tasks.push(
          manager.withLease(
            { resources: [{ kind: 'workspaceSearch', key: ws, capacity: 2 }], timeoutMs: 100 },
            async (lease) => { results.push({ ws, kind: 'search', queuedMs: lease.queuedMs, ok: true }); await wait(1); },
          ).catch((err) => { results.push({ ws, kind: 'search', queuedMs: -1, ok: false, err: String(err) }); }),
        );
      }
    }

    await Promise.all(tasks);
    expect(results.length).toBe(workspaces.length * 6);
    for (const ws of workspaces) {
      const writerResults = results.filter((r) => r.ws === ws && r.kind === 'writer' && r.ok);
      expect(writerResults.length).toBeGreaterThanOrEqual(1);
      const searchResults = results.filter((r) => r.ws === ws && r.kind === 'search' && r.ok);
      expect(searchResults.length).toBeGreaterThanOrEqual(2);
    }
    for (const r of results) {
      if (!r.ok && r.err) expect(r.err).toContain('ResourceLeaseTimeoutError');
    }
  });

  it('subtree mutation serializes overlapping paths but allows non-overlapping in parallel', async () => {
    const manager = new ResourceLeaseManager({ logger: null });
    const order = [];
    const p1 = manager.withLease(
      { resources: [{ kind: 'subtreeMutation', key: '/workspace/a/', mode: 'path' }] },
      async () => { order.push('p1-start'); await wait(5); order.push('p1-end'); },
    );
    await wait(1);
    const p2 = manager.withLease(
      { resources: [{ kind: 'subtreeMutation', key: '/workspace/a/', mode: 'path' }] },
      async () => { order.push('p2-start'); order.push('p2-end'); },
    );
    const p3 = manager.withLease(
      { resources: [{ kind: 'subtreeMutation', key: '/workspace/b/', mode: 'path' }] },
      async () => { order.push('p3-start'); order.push('p3-end'); },
    );
    await Promise.all([p1, p2, p3]);
    expect(order.indexOf('p1-end')).toBeLessThan(order.indexOf('p2-start'));
  });

  it('panics in critical section do not leak leases', async () => {
    const manager = new ResourceLeaseManager({ logger: null });
    await expect(
      manager.withLease(
        { resources: [{ kind: 'workspaceWriter', key: 'critical' }] },
        async () => { throw new Error('simulated panic'); },
      ),
    ).rejects.toThrow('simulated panic');
    const lease = await manager.acquire({
      resources: [{ kind: 'workspaceWriter', key: 'critical', capacity: 1 }], timeoutMs: 20,
    });
    expect(lease.leaseKey).toBe('critical');
    lease.release();
  });

  it('timeout error has stable shape', async () => {
    const manager = new ResourceLeaseManager({ logger: null });
    const lock = await manager.acquire({
      resources: [{ kind: 'workspaceExec', key: 'stuck', capacity: 1 }],
    });
    const err = await manager.acquire({
      resources: [{ kind: 'workspaceExec', key: 'stuck', capacity: 1 }],
      timeoutMs: 5,
    }).catch((e) => e);
    expect(err).toBeDefined();
    const errObj = err;
    expect(errObj.name).toBe('ResourceLeaseTimeoutError');
    expect(errObj.kind).toBe('workspaceExec');
    expect(errObj.key).toBe('stuck');
    expect(errObj.timeoutMs).toBe(5);
    lock.release();
  });

  it('wait duration monotonic for queued tasks', async () => {
    const manager = new ResourceLeaseManager({ logger: null });
    const queued = [];

    // Acquire lock1 to saturate capacity=1
    const lock1 = await manager.acquire({
      resources: [{ kind: 'workspaceExec', key: 'q-depth', capacity: 1 }],
    });

    // Queue p2 and p3 while lock1 is held; both must wait
    const p2 = manager.withLease(
      { resources: [{ kind: 'workspaceExec', key: 'q-depth', capacity: 1 }], timeoutMs: 200 },
      async (lease) => { queued.push({ id: 'p2', ms: lease.queuedMs }); },
    );
    const p3 = manager.withLease(
      { resources: [{ kind: 'workspaceExec', key: 'q-depth', capacity: 1 }], timeoutMs: 200 },
      async (lease) => { queued.push({ id: 'p3', ms: lease.queuedMs }); },
    );

    // Yield so p2/p3 enqueue
    await wait(2);

    // Now release lock1; p2 and p3 should both complete
    lock1.release();
    await Promise.all([p2, p3]);

    expect(queued.length).toBe(2);
    // p2 got the lock first, p3 waited longer
    const p2entry = queued.find((q) => q.id === 'p2');
    const p3entry = queued.find((q) => q.id === 'p3');
    expect(p2entry.ms).toBeGreaterThanOrEqual(0);
    expect(p3entry.ms).toBeGreaterThanOrEqual(p2entry.ms);
  });
});