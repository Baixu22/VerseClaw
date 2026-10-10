// Regression for issue #102.
//
// SessionAdmissionRegistry entries used to be retained forever after their last
// permit was released, and `fence()` waited for in-flight permits with an
// unbounded `setImmediate` poll of its own. These tests pin the replacement
// behaviour:
//
//   - fence waits are event-driven and bounded by an explicit budget/cancel;
//   - a fence that cannot drain stays closed (fail closed, never auto-released);
//   - idle entries are reclaimable through a capacity bound and an explicit
//     sweep, while closed fences (deleted-generation tombstones) and entries with
//     permits or waiters are never dropped;
//   - entry/active/fenced/waiter counters and observed wait time are observable.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SessionAdmissionFenceWaitError,
  SessionAdmissionFencedError,
  SessionAdmissionRegistry,
  sessionAdmissionRegistry,
  type SessionAdmissionIdentity,
} from "./session-admission-registry.js";

let nextSession = 0;

function identity(label = "session"): SessionAdmissionIdentity {
  nextSession += 1;
  return {
    agentId: "agent-a",
    canonicalSessionKey: "agent:agent-a:main",
    expectedSessionId: `${label}-${nextSession}`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  sessionAdmissionRegistry.clearForTests();
});

afterEach(() => {
  sessionAdmissionRegistry.clearForTests();
});

describe("SessionAdmissionRegistry bounded fence waits (#102)", () => {
  it("wakes a parked fence on release instead of polling", async () => {
    const target = identity("release-wakes");
    const release = sessionAdmissionRegistry.acquirePermit(target, "chat-send");
    const fencePromise = sessionAdmissionRegistry.fence(target, {
      timeoutMs: 2_000,
      operation: "unit-release",
    });

    await sleep(20);
    expect(sessionAdmissionRegistry.stats().waiters).toBe(1);
    release();

    const fence = await fencePromise;
    expect(fence.diagnostics.activeAtFence).toBe(1);
    expect(fence.diagnostics.waitedMs).toBeGreaterThanOrEqual(0);
    expect(fence.diagnostics.waitedMs).toBeLessThan(2_000);
    expect(sessionAdmissionRegistry.stats().waiters).toBe(0);
    expect(sessionAdmissionRegistry.stats().fenceWaits).toBe(1);
    fence.release();
    expect(sessionAdmissionRegistry.isFenced(target)).toBe(false);
  });

  it("fails the fence within its budget when a permit is never released, and stays closed", async () => {
    const target = identity("timeout");
    const release = sessionAdmissionRegistry.acquirePermit(target, "chat-send");

    let failure: unknown;
    try {
      await sessionAdmissionRegistry.fence(target, { timeoutMs: 40, operation: "unit-timeout" });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(SessionAdmissionFenceWaitError);
    const error = failure as SessionAdmissionFenceWaitError;
    expect(error.reason).toBe("timeout");
    expect(error.activeAtFailure).toBe(1);
    expect(error.operation).toBe("unit-timeout");
    expect(error.waitedMs).toBeGreaterThanOrEqual(0);

    // Fail closed: the timeout must not release the fence or reopen the identity.
    expect(sessionAdmissionRegistry.isFenced(target)).toBe(true);
    expect(() => sessionAdmissionRegistry.acquirePermit(target, "chat-send")).toThrow(
      SessionAdmissionFencedError,
    );
    const stats = sessionAdmissionRegistry.stats();
    expect(stats.fenceTimeouts).toBe(1);
    expect(stats.waiters).toBe(0);
    expect(stats).toMatchObject({ fenced: 1, active: 1 });

    // Recovery is the existing explicit path, and the stale release cannot open it.
    release();
    expect(sessionAdmissionRegistry.isFenced(target)).toBe(true);
    sessionAdmissionRegistry.removeFence(target);
    expect(sessionAdmissionRegistry.isFenced(target)).toBe(false);
    expect(sessionAdmissionRegistry.acquirePermit(target, "chat-send")).toBeTypeOf("function");
  });

  it("honours a caller abort signal and keeps the fence closed", async () => {
    const target = identity("abort");
    const release = sessionAdmissionRegistry.acquirePermit(target, "embedded-agent");
    const controller = new AbortController();
    const fencePromise = sessionAdmissionRegistry.fence(target, {
      timeoutMs: 5_000,
      signal: controller.signal,
      operation: "unit-abort",
    });
    await sleep(10);
    controller.abort();

    await expect(fencePromise).rejects.toMatchObject({
      name: "SessionAdmissionFenceWaitError",
      reason: "aborted",
    });
    expect(sessionAdmissionRegistry.isFenced(target)).toBe(true);
    expect(sessionAdmissionRegistry.stats().fenceAborts).toBe(1);
    release();
    sessionAdmissionRegistry.removeFence(target);
  });

  it("keeps duplicate release idempotent and wakes the fence exactly once", async () => {
    const target = identity("idempotent");
    const release = sessionAdmissionRegistry.acquirePermit(target, "chat-send");
    const fencePromise = sessionAdmissionRegistry.fence(target, { timeoutMs: 1_000 });

    release();
    release();
    const fence = await fencePromise;
    expect(sessionAdmissionRegistry.snapshot(target)?.active).toBe(0);
    expect(sessionAdmissionRegistry.stats().waiters).toBe(0);
    fence.release();
    fence.release();
    expect(sessionAdmissionRegistry.isFenced(target)).toBe(false);
  });

  it("refuses to let a stale handle reopen a newer fence", async () => {
    const target = identity("stale-handle");
    const first = await sessionAdmissionRegistry.fence(target, { timeoutMs: 1_000 });
    sessionAdmissionRegistry.removeFence(target);
    const second = await sessionAdmissionRegistry.fence(target, { timeoutMs: 1_000 });

    first.release();
    expect(sessionAdmissionRegistry.isFenced(target)).toBe(true);
    second.release();
    expect(sessionAdmissionRegistry.isFenced(target)).toBe(false);
  });
});

describe("SessionAdmissionRegistry entry reclamation (#102)", () => {
  it("retires idle entries and reports measured counts", () => {
    for (let index = 0; index < 25; index += 1) {
      const target = identity("retire");
      sessionAdmissionRegistry.acquirePermit(target, "chat-send")();
    }

    const before = sessionAdmissionRegistry.stats();
    expect(before.entries).toBe(25);
    expect(before.active).toBe(0);

    const result = sessionAdmissionRegistry.retireInactiveEntries();

    expect(result).toEqual({ retired: 25, live: 0 });
    expect(sessionAdmissionRegistry.stats()).toMatchObject({
      entries: 0,
      active: 0,
      fenced: 0,
      waiters: 0,
      retiredEntries: 25,
    });
  });

  it("bounds idle entries through capacity without dropping live state", () => {
    const registry = new SessionAdmissionRegistry({ maxEntries: 8 });

    for (let index = 0; index < 50; index += 1) {
      registry.acquirePermit(identity("cap"), "chat-send")();
    }

    const stats = registry.stats();
    expect(stats.maxEntries).toBe(8);
    expect(stats.entries).toBeLessThanOrEqual(8);
    expect(stats.retiredEntries).toBeGreaterThanOrEqual(42);

    // A live entry (in-flight permit) must survive the bound.
    const live = identity("cap-live");
    registry.acquirePermit(live, "chat-send");
    for (let index = 0; index < 20; index += 1) {
      registry.acquirePermit(identity("cap"), "chat-send")();
    }
    expect(registry.snapshot(live)?.active).toBe(1);
  });

  it("never retires a closed fence, so a deleted generation keeps rejecting", async () => {
    const deleted = identity("deleted-generation");
    const fence = await sessionAdmissionRegistry.fence(deleted, { timeoutMs: 1_000 });
    // Delete success keeps the fence as a tombstone; the handle is intentionally
    // not released here.
    void fence;

    const result = sessionAdmissionRegistry.retireInactiveEntries();

    expect(result.retired).toBe(0);
    expect(sessionAdmissionRegistry.snapshot(deleted)?.fenced).toBe(true);
    expect(() => sessionAdmissionRegistry.acquirePermit(deleted, "chat-send")).toThrow(
      SessionAdmissionFencedError,
    );

    sessionAdmissionRegistry.removeFence(deleted);
    const reclaimed = sessionAdmissionRegistry.retireInactiveEntries();
    expect(reclaimed.retired).toBe(1);
    expect(sessionAdmissionRegistry.snapshot(deleted)).toBeUndefined();
  });

  it("never retires an entry that has a parked waiter or an in-flight permit", async () => {
    const waiting = identity("parked");
    const release = sessionAdmissionRegistry.acquirePermit(waiting, "chat-send");
    const fencePromise = sessionAdmissionRegistry.fence(waiting, { timeoutMs: 2_000 });
    await sleep(10);

    const result = sessionAdmissionRegistry.retireInactiveEntries();
    expect(result).toEqual({ retired: 0, live: 1 });
    expect(sessionAdmissionRegistry.stats().waiters).toBe(1);

    release();
    const fence = await fencePromise;
    fence.release();
    expect(sessionAdmissionRegistry.snapshot(waiting)?.active).toBe(0);
  });

  it("keeps snapshot behaviour for released entries that were not retired", () => {
    const target = identity("snapshot-compat");
    const release = sessionAdmissionRegistry.acquirePermit(target, "chat-send");
    release();

    // Default capacity is large, so an explicitly un-retired entry is still
    // observable; this is the behaviour existing callers rely on.
    expect(sessionAdmissionRegistry.snapshot(target)).toMatchObject({
      active: 0,
      fenced: false,
      totalPermits: 1,
      totalRejectedWhileFenced: 0,
    });
  });

  it("reports measured reclamation and fence-wait counters through the lifecycle audit channel", async () => {
    const registry = new SessionAdmissionRegistry({ maxEntries: 16 });
    for (let index = 0; index < 64; index += 1) {
      registry.acquirePermit(identity("audit"), "chat-send")();
    }
    const afterCap = registry.stats();
    const swept = registry.retireInactiveEntries();

    const waiting = identity("audit-timeout");
    const release = registry.acquirePermit(waiting, "chat-send");
    await registry.fence(waiting, { timeoutMs: 30, operation: "audit" }).catch(() => undefined);
    const afterTimeout = registry.stats();

    // Existing convention: lifecycle measurements are printed as counter lines
    // and scraped by the audit/E2E surfaces. Report measured values only - this
    // makes no claim about unmeasured heap growth.
    console.log(`[runtime-lifecycle-audit] admissionEntriesAfterCap=${afterCap.entries}`);
    console.log(`[runtime-lifecycle-audit] admissionRetiredEntries=${afterCap.retiredEntries}`);
    console.log(`[runtime-lifecycle-audit] admissionLiveEntriesAfterSweep=${swept.live}`);
    console.log(`[runtime-lifecycle-audit] admissionFenceTimeouts=${afterTimeout.fenceTimeouts}`);
    console.log(`[runtime-lifecycle-audit] admissionMaxFenceWaitMs=${afterTimeout.maxFenceWaitMs}`);
    console.log(`[runtime-lifecycle-audit] admissionWaitersAfterTimeout=${afterTimeout.waiters}`);

    expect(afterCap.entries).toBeLessThanOrEqual(16);
    expect(afterCap.retiredEntries).toBeGreaterThanOrEqual(48);
    expect(afterTimeout.fenceTimeouts).toBe(1);
    expect(afterTimeout.waiters).toBe(0);
    expect(Number.isFinite(afterTimeout.maxFenceWaitMs)).toBe(true);

    release();
    registry.removeFence(waiting);
  });
});
