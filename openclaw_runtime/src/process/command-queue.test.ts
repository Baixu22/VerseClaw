import { afterEach, describe, expect, it } from 'vitest';
import {
  CommandLaneOverloadedError,
  CommandLaneQueueAbortedError,
  CommandLaneQueueTimeoutError,
  enqueueCommandInLane,
  resetCommandQueueStateForTest,
  setCommandLaneConcurrency,
} from './command-queue.js';

const LANE = 'bounded-lane-test';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

afterEach(() => {
  resetCommandQueueStateForTest();
});

describe('bounded lane queue', () => {
  it('rejects with overload when the queued depth reaches maxQueueSize', async () => {
    setCommandLaneConcurrency(LANE, 1);
    const gate = deferred();
    const running = enqueueCommandInLane(LANE, async () => { await gate.promise; });
    await Promise.resolve();

    const queued = enqueueCommandInLane(LANE, async () => undefined, { maxQueueSize: 1 });
    const overloaded = enqueueCommandInLane(LANE, async () => undefined, { maxQueueSize: 1 });

    await expect(overloaded).rejects.toBeInstanceOf(CommandLaneOverloadedError);
    gate.resolve();
    await running;
    await queued;
  });

  it('rejects a queued entry once its wait deadline elapses', async () => {
    setCommandLaneConcurrency(LANE, 1);
    const gate = deferred();
    const running = enqueueCommandInLane(LANE, async () => { await gate.promise; });
    await Promise.resolve();

    const queued = enqueueCommandInLane(LANE, async () => undefined, { queueDeadlineMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    gate.resolve();
    await running;

    await expect(queued).rejects.toBeInstanceOf(CommandLaneQueueTimeoutError);
  });

  it('rejects an already-aborted signal without running the task', async () => {
    setCommandLaneConcurrency(LANE, 1);
    const controller = new AbortController();
    controller.abort();
    let ran = false;

    await expect(enqueueCommandInLane(LANE, async () => { ran = true; }, { signal: controller.signal }))
      .rejects.toBeInstanceOf(CommandLaneQueueAbortedError);
    expect(ran).toBe(false);
  });
});
