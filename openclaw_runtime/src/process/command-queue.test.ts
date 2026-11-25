import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandLaneOverloadedError,
  CommandLaneQueueAbortedError,
  CommandLaneQueueTimeoutError,
  CommandLaneTaskTimeoutError,
  CommandLaneClearedError,
  clearCommandLane,
  enqueueCommandInLane,
  getCommandLaneSnapshot,
  waitForActiveTasks,
  resetCommandLane,
  resetCommandQueueStateForTest,
  setCommandLaneConcurrency,
} from "./command-queue.js";
import {
  EMBEDDED_QUEUE_WAIT_MS,
  withEmbeddedRunQueueBounds,
} from "../agents/embedded-agent-runner/lanes.js";

const LANE = "bounded-lane-test";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
});
afterEach(() => {
  resetCommandQueueStateForTest();
  vi.useRealTimers();
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

describe("bounded lane queue", () => {
  it("rejects with overload when the queued depth reaches maxQueueSize", async () => {
    setCommandLaneConcurrency(LANE, 1);
    const gate = deferred();
    const running = enqueueCommandInLane(LANE, async () => {
      await gate.promise;
    });
    await Promise.resolve();

    const queued = enqueueCommandInLane(LANE, async () => undefined, { maxQueueSize: 1 });
    const overloaded = enqueueCommandInLane(LANE, async () => undefined, { maxQueueSize: 1 });

    await expect(overloaded).rejects.toBeInstanceOf(CommandLaneOverloadedError);
    gate.resolve();
    await running;
    await queued;
  });

  it("rejects a queued entry once its wait deadline elapses", async () => {
    setCommandLaneConcurrency(LANE, 1);
    const gate = deferred();
    const running = enqueueCommandInLane(LANE, async () => {
      await gate.promise;
    });
    await Promise.resolve();

    const queued = enqueueCommandInLane(LANE, async () => undefined, { queueDeadlineMs: 5 });
    const failed = queued.catch((error) => error);
    await vi.advanceTimersByTimeAsync(20);
    expect(await failed).toBeInstanceOf(CommandLaneQueueTimeoutError);
    expect(getCommandLaneSnapshot(LANE)).toMatchObject({ activeCount: 1, queuedCount: 0 });
    gate.resolve();
    await running;
  });

  it("rejects an already-aborted signal without running the task", async () => {
    setCommandLaneConcurrency(LANE, 1);
    const controller = new AbortController();
    controller.abort();
    let ran = false;

    await expect(
      enqueueCommandInLane(
        LANE,
        async () => {
          ran = true;
        },
        { signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(CommandLaneQueueAbortedError);
    expect(ran).toBe(false);
  });

  it("cancels a waiter before the active owner finishes and disposes its registrations", async () => {
    const gate = deferred();
    const running = enqueueCommandInLane(LANE, () => gate.promise);
    const controller = new AbortController();
    const task = vi.fn(async () => undefined);
    const failed = enqueueCommandInLane(LANE, task, {
      signal: controller.signal,
      queueDeadlineMs: 1000,
    }).catch((error) => error);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
    controller.abort();
    expect(await failed).toBeInstanceOf(CommandLaneQueueAbortedError);
    expect(getCommandLaneSnapshot(LANE)).toMatchObject({ activeCount: 1, queuedCount: 0 });
    expect(task).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    gate.resolve();
    await running;
  });

  it("clears a waiter with its timer and listener without releasing active execution", async () => {
    const gate = deferred();
    const controller = new AbortController();
    const running = enqueueCommandInLane(LANE, () => gate.promise);
    const failed = enqueueCommandInLane(LANE, async () => undefined, {
      signal: controller.signal,
      queueDeadlineMs: 1000,
    }).catch((error) => error);
    expect(clearCommandLane(LANE)).toBe(1);
    expect(await failed).toBeInstanceOf(CommandLaneClearedError);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(getCommandLaneSnapshot(LANE).activeCount).toBe(1);
    gate.resolve();
    await running;
  });

  it("permits immediate execution with a zero waiting capacity", async () => {
    const gate = deferred();
    const running = enqueueCommandInLane(LANE, () => gate.promise, { maxQueueSize: 0 });
    await expect(
      enqueueCommandInLane(LANE, async () => undefined, { maxQueueSize: 0 }),
    ).rejects.toBeInstanceOf(CommandLaneOverloadedError);
    expect(getCommandLaneSnapshot(LANE)).toMatchObject({ activeCount: 1, queuedCount: 0 });
    gate.resolve();
    await running;
  });

  it("retains a timed-out owner until terminal settlement before admitting its successor", async () => {
    const gate = deferred();
    let actual = 0;
    let peak = 0;
    const first = enqueueCommandInLane(
      LANE,
      async () => {
        actual++;
        peak = Math.max(peak, actual);
        await gate.promise;
        actual--;
      },
      { taskTimeoutMs: 10 },
    ).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await first).toBeInstanceOf(CommandLaneTaskTimeoutError);
    expect(await waitForActiveTasks(0)).toEqual({ drained: false });
    const next = vi.fn(async () => {
      actual++;
      peak = Math.max(peak, actual);
      actual--;
    });
    const second = enqueueCommandInLane(LANE, next);
    await flush();
    expect(next).not.toHaveBeenCalled();
    expect(getCommandLaneSnapshot(LANE)).toMatchObject({ activeCount: 1, queuedCount: 1 });
    gate.resolve();
    await second;
    await flush();
    expect(peak).toBe(1);
    expect(actual).toBe(0);
    expect(await waitForActiveTasks(0)).toEqual({ drained: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps both session and global slots when an inner execution times out", async () => {
    const globalLane = "nested-global";
    const gate = deferred();
    setCommandLaneConcurrency(globalLane, 2);
    const first = enqueueCommandInLane(LANE, () =>
      enqueueCommandInLane(globalLane, () => gate.promise, { taskTimeoutMs: 10 }),
    ).catch((error) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await first).toBeInstanceOf(CommandLaneTaskTimeoutError);
    expect(resetCommandLane(LANE)).toBe(0);
    const next = vi.fn(async () => "next");
    const second = enqueueCommandInLane(LANE, () => enqueueCommandInLane(globalLane, next));
    await flush();
    expect(getCommandLaneSnapshot(LANE)).toMatchObject({ activeCount: 1, queuedCount: 1 });
    expect(getCommandLaneSnapshot(globalLane).activeCount).toBe(1);
    expect(next).not.toHaveBeenCalled();
    gate.resolve();
    expect(await second).toBe("next");
    await flush();
    expect(getCommandLaneSnapshot(LANE).activeCount).toBe(0);
    expect(getCommandLaneSnapshot(globalLane).activeCount).toBe(0);
  });

  it("keeps active ownership when recovery resets a lane before execution settles", async () => {
    const gate = deferred();
    const running = enqueueCommandInLane(LANE, () => gate.promise);
    const next = vi.fn(async () => undefined);
    const queued = enqueueCommandInLane(LANE, next);
    const generation = getCommandLaneSnapshot(LANE).generation;
    expect(resetCommandLane(LANE)).toBe(0);
    await flush();
    expect(getCommandLaneSnapshot(LANE)).toMatchObject({ activeCount: 1, queuedCount: 1, generation });
    expect(next).not.toHaveBeenCalled();
    expect(await waitForActiveTasks(0)).toEqual({ drained: false });
    gate.resolve();
    await Promise.all([running, queued]);
    expect(next).toHaveBeenCalledOnce();
    expect(await waitForActiveTasks(0)).toEqual({ drained: true });
  });

  it("bounds 100 embedded-entry requests and expires them under one shared wait budget", async () => {
    setCommandLaneConcurrency(LANE, 0);
    const deadline = Date.now() + EMBEDDED_QUEUE_WAIT_MS;
    const requests = Array.from({ length: 100 }, () =>
      enqueueCommandInLane(
        LANE,
        async () => undefined,
        withEmbeddedRunQueueBounds(undefined, deadline),
      ).catch((error) => error),
    );
    expect(getCommandLaneSnapshot(LANE).queuedCount).toBe(64);
    await vi.advanceTimersByTimeAsync(EMBEDDED_QUEUE_WAIT_MS);
    const outcomes = await Promise.all(requests);
    expect(outcomes.filter((error) => error instanceof CommandLaneOverloadedError)).toHaveLength(
      36,
    );
    expect(outcomes.filter((error) => error instanceof CommandLaneQueueTimeoutError)).toHaveLength(
      64,
    );
    expect(getCommandLaneSnapshot(LANE).queuedCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the elapsed session wait when constructing global admission options", async () => {
    const deadline = Date.now() + EMBEDDED_QUEUE_WAIT_MS;
    const controller = new AbortController();
    const first = withEmbeddedRunQueueBounds(undefined, deadline, controller.signal);
    await vi.advanceTimersByTimeAsync(20_000);
    const second = withEmbeddedRunQueueBounds({ maxQueueSize: 2 }, deadline, controller.signal);
    expect(first).toMatchObject({
      maxQueueSize: 64,
      queueDeadlineMs: 30_000,
      signal: controller.signal,
    });
    expect(second).toMatchObject({
      maxQueueSize: 2,
      queueDeadlineMs: 10_000,
      signal: controller.signal,
    });
  });

  it("keeps the absolute admission deadline when a middleware defers enqueue", async () => {
    const options = withEmbeddedRunQueueBounds(undefined, Date.now() + 10);
    await vi.advanceTimersByTimeAsync(20);
    const task = vi.fn(async () => undefined);
    await expect(enqueueCommandInLane(LANE, task, options)).rejects.toBeInstanceOf(CommandLaneQueueTimeoutError);
    expect(task).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
