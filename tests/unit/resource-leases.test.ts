import { afterEach, describe, expect, it } from 'vitest';
import {
  TerminalResourceLeaseTimeoutError,
  isTerminalResourceLeaseTimeoutError,
  resetTerminalResourceLeasesForTest,
  withWorkspaceExecLease,
} from '../../electron/services/resource-leases';

afterEach(() => {
  resetTerminalResourceLeasesForTest();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('workspace exec lease', () => {
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

  it('does not free a second slot when release is called twice', async () => {
    const gate = deferred();
    const started: number[] = [];
    const hold = (id: number) =>
      withWorkspaceExecLease('ws-a', 5_000, async (lease) => {
        started.push(id);
        await gate.promise;
        // A double release must not over-free capacity.
        lease.release();
        lease.release();
      });

    const first = hold(1);
    const second = hold(2);
    const third = hold(3);
    const fourth = hold(4);
    await Promise.resolve();
    expect(started).toEqual([1, 2]);

    gate.resolve();
    await Promise.all([first, second, third, fourth]);
    expect(started).toEqual([1, 2, 3, 4]);
  });
});