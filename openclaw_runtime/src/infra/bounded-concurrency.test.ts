import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoundedConcurrencyGate } from "./bounded-concurrency.js";

describe("bounded concurrency gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("admits up to the limit immediately and never exceeds it", async () => {
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 2, maxQueue: 4 });

    const first = await gate.acquire();
    const second = await gate.acquire();
    expect(first.ok && second.ok).toBe(true);
    expect(gate.stats()).toMatchObject({ active: 2, queued: 0, peakActive: 2 });

    const third = gate.acquire();
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.stats()).toMatchObject({ active: 2, queued: 1, peakActive: 2, peakQueued: 1 });

    if (!first.ok) {
      throw new Error("first admission refused");
    }
    first.lease.release();
    const admitted = await third;
    expect(admitted.ok).toBe(true);
    expect(gate.stats()).toMatchObject({ active: 2, queued: 0, peakActive: 2 });

    if (!second.ok || !admitted.ok) {
      throw new Error("admission refused");
    }
    second.lease.release();
    admitted.lease.release();
    expect(gate.stats()).toMatchObject({ active: 0, completed: 3, admitted: 3 });
  });

  it("refuses with overloaded before waiting when the queue is full", async () => {
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 1, maxQueue: 1 });

    const holder = await gate.acquire();
    expect(holder.ok).toBe(true);
    const queued = gate.acquire();
    await vi.advanceTimersByTimeAsync(0);

    const refused = await gate.acquire();
    expect(refused.ok).toBe(false);
    if (refused.ok) {
      throw new Error("expected refusal");
    }
    expect(refused.reason).toBe("overloaded");
    expect(refused.waitedMs).toBe(0);
    expect(gate.stats()).toMatchObject({ active: 1, queued: 1, rejectedOverloaded: 1 });

    if (!holder.ok) {
      throw new Error("holder refused");
    }
    holder.lease.release();
    const admitted = await queued;
    expect(admitted.ok).toBe(true);
    if (admitted.ok) {
      admitted.lease.release();
    }
  });

  it("serves queued waiters in FIFO order", async () => {
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 1, maxQueue: 4 });
    const holder = await gate.acquire();
    const order: string[] = [];
    const second = gate.acquire({ label: "second" }).then((admission) => {
      order.push("second");
      return admission;
    });
    const third = gate.acquire({ label: "third" }).then((admission) => {
      order.push("third");
      return admission;
    });
    await vi.advanceTimersByTimeAsync(0);

    if (!holder.ok) {
      throw new Error("holder refused");
    }
    holder.lease.release();
    const secondAdmission = await second;
    expect(order).toEqual(["second"]);
    if (!secondAdmission.ok) {
      throw new Error("second refused");
    }
    secondAdmission.lease.release();
    const thirdAdmission = await third;
    expect(order).toEqual(["second", "third"]);
    if (thirdAdmission.ok) {
      thirdAdmission.lease.release();
    }
  });

  it("rejects a queued waiter that passes its wait deadline and never runs it", async () => {
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 1, maxQueue: 2, queueTimeoutMs: 100 });
    const holder = await gate.acquire();
    const queued = gate.acquire();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(101);
    const refused = await queued;
    expect(refused.ok).toBe(false);
    if (refused.ok) {
      throw new Error("expected queue timeout");
    }
    expect(refused.reason).toBe("queue-timeout");
    expect(refused.waitedMs).toBeGreaterThanOrEqual(100);
    expect(gate.stats()).toMatchObject({
      active: 1,
      queued: 0,
      rejectedQueueTimeout: 1,
      admitted: 1,
      completed: 0,
    });

    if (!holder.ok) {
      throw new Error("holder refused");
    }
    holder.lease.release();
    expect(gate.stats()).toMatchObject({ active: 0, completed: 1, admitted: 1 });
  });

  it("rejects an aborted waiter and an already-aborted caller", async () => {
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 1, maxQueue: 2, queueTimeoutMs: 5_000 });
    const holder = await gate.acquire();
    const controller = new AbortController();
    const queued = gate.acquire({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.stats().queued).toBe(1);

    controller.abort();
    const aborted = await queued;
    expect(aborted.ok).toBe(false);
    if (aborted.ok) {
      throw new Error("expected abort");
    }
    expect(aborted.reason).toBe("aborted");

    const preAborted = new AbortController();
    preAborted.abort();
    const refused = await gate.acquire({ signal: preAborted.signal });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe("aborted");
    }
    expect(gate.stats()).toMatchObject({ active: 1, queued: 0, rejectedAborted: 2 });

    if (holder.ok) {
      holder.lease.release();
    }
  });

  it("counts a double release instead of freeing a second slot", async () => {
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 1, maxQueue: 0 });
    const first = await gate.acquire();
    if (!first.ok) {
      throw new Error("first refused");
    }
    expect(first.lease.release()).toBe(true);
    expect(first.lease.release()).toBe(false);

    const second = await gate.acquire();
    expect(second.ok).toBe(true);
    expect(gate.stats()).toMatchObject({
      active: 1,
      admitted: 2,
      completed: 1,
      doubleRelease: 1,
      closed: false,
    });
    if (second.ok) {
      second.lease.release();
    }
  });

  it("treats maxQueue 0 as no waiting at all", async () => {
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 1, maxQueue: 0 });
    const holder = await gate.acquire();
    const refused = await gate.acquire();
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe("overloaded");
    }
    expect(gate.stats()).toMatchObject({ queued: 0, peakQueued: 0, rejectedOverloaded: 1 });
    if (holder.ok) {
      holder.lease.release();
    }
  });

  it("rejects the queue and refuses new callers after close", async () => {
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 1, maxQueue: 3, queueTimeoutMs: 10_000 });
    const holder = await gate.acquire();
    const queued = gate.acquire();
    await vi.advanceTimersByTimeAsync(0);

    gate.close();
    const aborted = await queued;
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) {
      expect(aborted.reason).toBe("aborted");
    }
    const afterClose = await gate.acquire();
    expect(afterClose.ok).toBe(false);
    expect(gate.stats().closed).toBe(true);

    if (holder.ok) {
      holder.lease.release();
    }
    expect(gate.stats()).toMatchObject({ active: 0, queued: 0, completed: 1 });
  });

  it("keeps peak accounting and zero leaks under a burst with steady releases", async () => {
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 3, maxQueue: 50, queueTimeoutMs: 60_000 });
    const pending: Promise<unknown>[] = [];
    const leases: Array<{ release: () => boolean }> = [];

    for (let index = 0; index < 50; index += 1) {
      pending.push(
        gate.acquire().then((admission) => {
          if (admission.ok) {
            leases.push(admission.lease);
          }
          return admission;
        }),
      );
    }
    await vi.advanceTimersByTimeAsync(0);

    // Drain: release every granted lease repeatedly until every caller settled.
    for (let round = 0; round < 60; round += 1) {
      await vi.advanceTimersByTimeAsync(0);
      const batch = leases.splice(0, leases.length);
      for (const lease of batch) {
        lease.release();
      }
    }
    await Promise.all(pending);

    const stats = gate.stats();
    expect(stats.peakActive).toBeLessThanOrEqual(3);
    expect(stats.peakQueued).toBeLessThanOrEqual(50);
    expect(stats.active).toBe(0);
    expect(stats.queued).toBe(0);
    expect(stats.admitted).toBe(50);
    expect(stats.completed).toBe(50);
    expect(stats.rejectedOverloaded + stats.rejectedQueueTimeout + stats.rejectedAborted).toBe(0);
    expect(stats.doubleRelease).toBe(0);
  });

  it("applies updated limits to future admissions", async () => {
    const gate = createBoundedConcurrencyGate({ maxConcurrent: 1, maxQueue: 1 });
    const holder = await gate.acquire();
    const queuedBefore = gate.acquire();
    await vi.advanceTimersByTimeAsync(0);
    const refused = await gate.acquire();
    expect(refused.ok).toBe(false);

    gate.setLimits({ maxConcurrent: 1, maxQueue: 4 });
    const queuedAfter = gate.acquire();
    await vi.advanceTimersByTimeAsync(0);
    expect(gate.stats().maxQueue).toBe(4);

    if (holder.ok) {
      holder.lease.release();
    }
    const first = await queuedBefore;
    if (first.ok) {
      first.lease.release();
    }
    const second = await queuedAfter;
    expect(second.ok).toBe(true);
    if (second.ok) {
      second.lease.release();
    }
  });
});
