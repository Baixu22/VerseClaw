import { describe, expect, it, vi } from 'vitest';
import { ResourceFabric } from '../../electron/services/resource-fabric';

describe('ResourceFabric chat.history admission', () => {
  it('coalesces duplicate in-flight chat.history requests', async () => {
    const backpressure = new ResourceFabric({ accounts: { chatHistory: { initialLimit: 2, minLimit: 1, maxLimit: 2 } } });
    let resolveRunner = ((_value: unknown) => {}) as (value: unknown) => void;
    const runner = vi.fn(() => new Promise((resolve) => {
      resolveRunner = resolve as typeof resolveRunner;
    }));

    const first = backpressure.run('chat.history', { sessionKey: 'agent:main:one', limit: 200 }, undefined, runner);
    const second = backpressure.run('chat.history', { limit: 200, sessionKey: 'agent:main:one' }, undefined, runner);

    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1));
    resolveRunner({ messages: ['ok'] });
    await expect(first).resolves.toEqual({ messages: ['ok'] });
    await expect(second).resolves.toEqual({ messages: ['ok'] });
  });

  it('limits distinct chat.history requests while allowing non-history RPCs through', async () => {
    const backpressure = new ResourceFabric({ accounts: { chatHistory: { initialLimit: 2, minLimit: 1, maxLimit: 2 } } });
    let activeHistory = 0;
    let maxActiveHistory = 0;
    const releaseHistory: Array<() => void> = [];
    const runner = vi.fn(async (method: string) => {
      if (method !== 'chat.history') {
        return { method };
      }
      activeHistory += 1;
      maxActiveHistory = Math.max(maxActiveHistory, activeHistory);
      await new Promise<void>((resolve) => releaseHistory.push(resolve));
      activeHistory -= 1;
      return { method };
    });

    const historyRuns = Array.from({ length: 5 }, (_, index) => (
      backpressure.run('chat.history', { sessionKey: `agent:main:${index}`, limit: 200 }, undefined, runner)
    ));
    const statusRun = backpressure.run('status', {}, undefined, runner);

    await expect(statusRun).resolves.toEqual({ method: 'status' });
    await vi.waitFor(() => expect(maxActiveHistory).toBe(2));
    expect(backpressure.getDiagnostics().chatHistory).toMatchObject({
      active: 2,
      queued: 3,
    });

    for (let turn = 0; turn < 200; turn += 1) {
      // A released history slot needs a microtask/macrotask turn before the next waiter is admitted.
      const diag = backpressure.getDiagnostics().chatHistory;
      if (activeHistory === 0 && releaseHistory.length === 0 && diag?.active === 0 && diag?.queued === 0) break;
      const release = releaseHistory.shift();
      if (release) {
        release();
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await Promise.resolve();
    }

    await Promise.all(historyRuns);
    expect(maxActiveHistory).toBeLessThanOrEqual(2);
    expect(backpressure.getDiagnostics().chatHistory).toMatchObject({
      active: 0,
      queued: 0,
    });
  });
});
