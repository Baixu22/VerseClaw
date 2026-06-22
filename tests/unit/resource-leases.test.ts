import { describe, expect, it } from 'vitest';
import {
  canonicalizePathForLease,
  ResourceLeaseManager,
  ResourceLeaseTimeoutError,
} from '../../openclaw_runtime/src/agents/resource-leases';

function waitForMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ResourceLeaseManager', () => {
  it('queues same-key leases fairly in FIFO order', async () => {
    const manager = new ResourceLeaseManager({ logger: null });
    const first = await manager.acquire({
      resources: [{ kind: 'workspaceSearch', key: 'workspace', capacity: 1 }],
    });
    const order: string[] = [];
    const second = manager.acquire({
      resources: [{ kind: 'workspaceSearch', key: 'workspace', capacity: 1 }],
    }).then((lease) => {
      order.push('second');
      lease.release();
    });
    const third = manager.acquire({
      resources: [{ kind: 'workspaceSearch', key: 'workspace', capacity: 1 }],
    }).then((lease) => {
      order.push('third');
      lease.release();
    });

    await waitForMicrotasks();
    expect(order).toEqual([]);
    first.release();
    await Promise.all([second, third]);
    expect(order).toEqual(['second', 'third']);
  });

  it('allows different keys to run in parallel', async () => {
    const manager = new ResourceLeaseManager({ logger: null });
    const [first, second] = await Promise.all([
      manager.acquire({ resources: [{ kind: 'workspaceSearch', key: 'workspace-a', capacity: 1 }] }),
      manager.acquire({ resources: [{ kind: 'workspaceSearch', key: 'workspace-b', capacity: 1 }] }),
    ]);

    expect(first.leaseKey).toBe('workspace-a');
    expect(second.leaseKey).toBe('workspace-b');
    first.release();
    second.release();
  });

  it('releases leases when a scoped operation throws', async () => {
    const manager = new ResourceLeaseManager({ logger: null });
    await expect(
      manager.withLease(
        { resources: [{ kind: 'workspaceWriter', key: 'workspace' }] },
        async () => {
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow('boom');

    const next = await manager.acquire({
      resources: [{ kind: 'workspaceWriter', key: 'workspace' }],
      timeoutMs: 20,
    });
    next.release();
  });

  it('returns a stable timeout error when capacity stays saturated', async () => {
    const manager = new ResourceLeaseManager({ logger: null });
    const first = await manager.acquire({
      resources: [{ kind: 'workspaceExec', key: 'workspace', capacity: 1 }],
    });

    await expect(
      manager.acquire({
        resources: [{ kind: 'workspaceExec', key: 'workspace', capacity: 1 }],
        timeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(ResourceLeaseTimeoutError);
    first.release();
  });

  it('normalizes Windows path case, slashes, and missing file basenames', () => {
    const realpath = (input: string) => {
      const normalized = input.replace(/\//g, '\\').toLowerCase();
      if (normalized === 'c:\\repo\\src') {
        return 'C:\\Repo\\Src';
      }
      if (normalized === 'c:\\repo\\src\\existing.ts') {
        return 'C:\\Repo\\Src\\Existing.ts';
      }
      throw new Error('missing');
    };

    expect(
      canonicalizePathForLease('C:/REPO/src/existing.ts', { platform: 'win32', realpath }),
    ).toBe('c:/repo/src/existing.ts');
    expect(
      canonicalizePathForLease('c:\\repo\\SRC\\NewFile.TS', { platform: 'win32', realpath }),
    ).toBe('c:/repo/src/newfile.ts');
  });

  it('blocks child file mutations behind overlapping subtree mutations only', async () => {
    const manager = new ResourceLeaseManager({ logger: null });
    const subtree = await manager.acquire({
      resources: [{ kind: 'subtreeMutation', key: 'c:/repo/src', mode: 'path' }],
    });
    let childAcquired = false;
    const child = manager.acquire({
      resources: [{ kind: 'fileMutation', key: 'c:/repo/src/a.ts', mode: 'path' }],
    }).then((lease) => {
      childAcquired = true;
      lease.release();
    });
    const unrelated = await manager.acquire({
      resources: [{ kind: 'fileMutation', key: 'c:/repo/tests/a.ts', mode: 'path' }],
    });

    await waitForMicrotasks();
    expect(childAcquired).toBe(false);
    unrelated.release();
    subtree.release();
    await child;
    expect(childAcquired).toBe(true);
  });

  it('enforces the workspace search semaphore limit', async () => {
    const manager = new ResourceLeaseManager({ logger: null });
    const first = await manager.acquire({
      resources: [{ kind: 'workspaceSearch', key: 'workspace' }],
    });
    const second = await manager.acquire({
      resources: [{ kind: 'workspaceSearch', key: 'workspace' }],
    });
    let thirdAcquired = false;
    const third = manager.acquire({
      resources: [{ kind: 'workspaceSearch', key: 'workspace' }],
    }).then((lease) => {
      thirdAcquired = true;
      lease.release();
    });

    await waitForMicrotasks();
    expect(thirdAcquired).toBe(false);
    first.release();
    await third;
    expect(thirdAcquired).toBe(true);
    second.release();
  });
});
