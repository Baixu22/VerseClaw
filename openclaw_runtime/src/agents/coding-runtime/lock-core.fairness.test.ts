import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireLocalLocks,
  canonicalLockKey,
  resetLockCoreForTest,
  workspaceScopeKey,
} from "./lock-core.js";
import { codingObservability } from "../../context-engine/coding-observability.js";

/**
 * P6A independent-acceptance probes for the §4.1 protocol invariants that the
 * existing suite does not pin: writer-barrier fairness across hierarchical
 * scopes (invariant 5 / acceptance "writer barrier 后到 reader 不饿死 writer")
 * and the observability counters (acceptance "lock observability 计数在争用 /
 * stale / timeout 场景有增量").
 */
const ROOT = process.platform === "win32" ? "D:\\uftk-probe-root" : "/uftk-probe-root";
const fileA = `${ROOT}${process.platform === "win32" ? "\\" : "/"}a.txt`;
const fileB = `${ROOT}${process.platform === "win32" ? "\\" : "/"}b.txt`;

beforeEach(() => {
  resetLockCoreForTest();
  codingObservability.reset();
});

afterEach(() => {
  resetLockCoreForTest();
});

async function tick(ms = 40): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("P6A writer-barrier fairness", () => {
  it("does not let a later same-key reader bypass a queued writer", async () => {
    const key = canonicalLockKey(fileA);
    const reader1 = await acquireLocalLocks([key], "read", { owner: "r1" });

    let writerAcquired = false;
    const writer = acquireLocalLocks([key], "write", { owner: "w1" }).then((handle) => {
      writerAcquired = true;
      return handle;
    });
    await tick();
    expect(writerAcquired).toBe(false);

    let reader2Acquired = false;
    const reader2 = acquireLocalLocks([key], "read", { owner: "r2" }).then((handle) => {
      reader2Acquired = true;
      return handle;
    });
    await tick();
    // The queued writer is a barrier: r2 must not slip in ahead of it.
    expect(reader2Acquired).toBe(false);

    await reader1.release();
    await tick();
    expect(writerAcquired).toBe(true);
    expect(reader2Acquired).toBe(false);

    await (await writer).release();
    await tick();
    expect(reader2Acquired).toBe(true);
    await (await reader2).release();
  });

  it("does not let a later file-scope reader bypass a queued workspace barrier", async () => {
    const keyA = canonicalLockKey(fileA);
    const keyB = canonicalLockKey(fileB);
    const reader1 = await acquireLocalLocks([keyA], "read", { owner: "r1" });

    // The restore barrier is a workspace-scope writer over the whole root.
    let barrierAcquired = false;
    const barrier = acquireLocalLocks([workspaceScopeKey(ROOT)], "write", {
      owner: "restore",
    }).then((handle) => {
      barrierAcquired = true;
      return handle;
    });
    await tick();
    expect(barrierAcquired).toBe(false);

    // A reader that arrives *after* the barrier queued, on a different file
    // under the same root, must not be admitted ahead of it. Otherwise a stream
    // of readers starves the restore barrier indefinitely.
    let laterReaderAcquired = false;
    const laterReader = acquireLocalLocks([keyB], "read", { owner: "r2" }).then((handle) => {
      laterReaderAcquired = true;
      return handle;
    });
    await tick();
    expect(laterReaderAcquired).toBe(false);

    await reader1.release();
    await tick();
    expect(barrierAcquired).toBe(true);
    expect(laterReaderAcquired).toBe(false);

    await (await barrier).release();
    await tick();
    expect(laterReaderAcquired).toBe(true);
    await (await laterReader).release();
  });

  it("keeps a queued workspace barrier from being starved by a reader stream", async () => {
    const keyA = canonicalLockKey(fileA);
    let held = await acquireLocalLocks([keyA], "read", { owner: "r0" });

    let barrierAcquired = false;
    const barrier = acquireLocalLocks([workspaceScopeKey(ROOT)], "write", {
      owner: "restore",
      timeoutMs: 5_000,
    }).then((handle) => {
      barrierAcquired = true;
      return handle;
    });
    await tick();

    // Hand off between overlapping readers repeatedly. If later readers can
    // bypass the queued barrier, the barrier never gets a turn.
    for (let round = 0; round < 5; round += 1) {
      const next = acquireLocalLocks([keyA], "read", { owner: `r${round + 1}`, timeoutMs: 2_000 });
      await held.release();
      await tick(10);
      if (barrierAcquired) {
        // Barrier won a turn: drain the pending reader and finish.
        await (await barrier).release();
        await (await next).release();
        return;
      }
      held = await next;
    }
    await held.release();
    await tick();
    expect(barrierAcquired, "workspace barrier was starved by a reader stream").toBe(true);
    await (await barrier).release();
  });

  it("still shares same-file reads when no writer is queued", async () => {
    const key = canonicalLockKey(fileA);
    const r1 = await acquireLocalLocks([key], "read", { owner: "r1" });
    const r2 = await acquireLocalLocks([key], "read", { owner: "r2" });
    const r3 = await acquireLocalLocks([key], "read", { owner: "r3" });
    await r1.release();
    await r2.release();
    await r3.release();
  });
});

describe("P6A lock observability counters", () => {
  it("increments contention and waitMs when an acquire actually queues", async () => {
    const key = canonicalLockKey(fileA);
    const writer = await acquireLocalLocks([key], "write", { owner: "w1" });
    const before = codingObservability.snapshot();

    const queued = acquireLocalLocks([key], "read", { owner: "r1", timeoutMs: 5_000 });
    await tick(30);
    await writer.release();
    await (await queued).release();

    const after = codingObservability.snapshot();
    expect(after.lockContention).toBeGreaterThan(before.lockContention);
    expect(after.lockWaitMs).toBeGreaterThan(before.lockWaitMs);
  });

  it("increments the timeout counter on a bounded acquire failure", async () => {
    const key = canonicalLockKey(fileA);
    const writer = await acquireLocalLocks([key], "write", { owner: "w1" });
    const before = codingObservability.snapshot();

    await expect(
      acquireLocalLocks([key], "write", { owner: "w2", timeoutMs: 60 }),
    ).rejects.toMatchObject({ code: "E_LOCK_TIMEOUT" });

    const after = codingObservability.snapshot();
    expect(after.lockTimeout).toBe(before.lockTimeout + 1);
    await writer.release();
  });
});
