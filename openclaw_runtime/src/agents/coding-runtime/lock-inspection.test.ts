/**
 * P6A: `inspectCodingLocks()` — the read-only lock diagnostic.
 *
 * This is a §6.1 acceptance deliverable ("lock observability ... `inspectCodingLocks()`
 * 只读可用") that had no test. The P6A report cited `lock-core.test.ts` as its
 * coverage, but that suite exercises `inspectLocalLockState` — the lock-core
 * primitive — not this module, which additionally classifies scopes, reports the
 * two capability flags, and reads the cross-process marker registry off disk.
 *
 * The load-bearing property is that it is genuinely READ-ONLY. A diagnostic that
 * perturbs the locks it reports on is worse than no diagnostic: it would make the
 * observed state a function of having observed it, and could release a lease its
 * caller still depends on. So the central test holds real locks across an
 * inspection and proves nothing moved.
 *
 * The second property is tolerance. Diagnostics run when something is already
 * wrong, so a corrupt marker file or a missing state dir must degrade to nulls
 * and empties, never throw.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireCodingRuntimeFileLocks,
  resetCodingRuntimeFileLocksForTest,
  setCodingLockConcurrencyV2Enabled,
} from "./file-lock-manager.js";
import { inspectCodingLocks, sharedReaderRegistryKey } from "./lock-inspection.js";
import { processStartTimeProviderAvailable } from "../../shared/process-start-time.js";
import { drainSessionWriteLockStateForTest } from "../session-write-lock.js";

let root: string;
let stateDir: string;
let fileA: string;
let fileB: string;
let previousStateDir: string | undefined;
let previousV2: boolean;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "uftk-lock-inspect-"));
  stateDir = path.join(root, "state");
  fileA = path.join(root, "a.txt");
  fileB = path.join(root, "b.txt");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(fileA, "a", "utf8");
  await fs.writeFile(fileB, "b", "utf8");
  previousStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = stateDir;
  previousV2 = false;
  resetCodingRuntimeFileLocksForTest();
});

afterEach(async () => {
  setCodingLockConcurrencyV2Enabled(previousV2);
  resetCodingRuntimeFileLocksForTest();
  await drainSessionWriteLockStateForTest().catch(() => {});
  if (previousStateDir === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = previousStateDir;
  }
  await fs.rm(root, { recursive: true, force: true });
});

describe("inspection is read-only", () => {
  it("leaves held leases and their owners untouched", async () => {
    const held = await acquireCodingRuntimeFileLocks([fileA], {
      mode: "write",
      owner: "inspect-owner",
      timeoutMs: 5_000,
    });
    try {
      const first = await inspectCodingLocks();
      expect(first.held.some((entry) => entry.writer)).toBe(true);

      // Inspecting repeatedly must not drain, release, or renumber anything.
      const second = await inspectCodingLocks();
      const third = await inspectCodingLocks();
      expect(second.held).toEqual(first.held);
      expect(third.held).toEqual(first.held);
      expect(second.waiting).toEqual(first.waiting);

      // And the lease is still exclusive afterwards: a second writer must not
      // slip in because a diagnostic quietly let go.
      await expect(
        acquireCodingRuntimeFileLocks([fileA], {
          mode: "write",
          owner: "intruder",
          timeoutMs: 150,
        }),
      ).rejects.toMatchObject({ code: "E_LOCK_TIMEOUT" });
    } finally {
      await held.release();
    }
    // After a real release the diagnostic reflects it -- so the stability above
    // was not just the snapshot being stale.
    const after = await inspectCodingLocks();
    expect(after.held.some((entry) => entry.writer)).toBe(false);
  });

  it("reports a queued waiter without admitting or starving it", async () => {
    const held = await acquireCodingRuntimeFileLocks([fileA], {
      mode: "write",
      owner: "holder",
      timeoutMs: 5_000,
    });
    const queued = acquireCodingRuntimeFileLocks([fileA], {
      mode: "write",
      owner: "queued-writer",
      timeoutMs: 5_000,
    });
    try {
      // Give the second request time to enqueue.
      const waiting = await pollFor(async () => {
        const snapshot = await inspectCodingLocks();
        return snapshot.waiting.length > 0 ? snapshot.waiting : null;
      });
      expect(waiting.some((entry) => entry.owner === "queued-writer")).toBe(true);
      expect(waiting.every((entry) => entry.mode === "write")).toBe(true);

      // Observing the waiter must not admit it while the holder still holds.
      const stillWaiting = await inspectCodingLocks();
      expect(stillWaiting.waiting.some((entry) => entry.owner === "queued-writer")).toBe(true);
    } finally {
      await held.release();
      const admitted = await queued;
      await admitted.release();
    }
  });

  it("classifies the scope of each reported key", async () => {
    const fileLease = await acquireCodingRuntimeFileLocks([fileA], {
      mode: "read",
      owner: "file-reader",
      timeoutMs: 5_000,
    });
    try {
      const snapshot = await inspectCodingLocks();
      const entry = snapshot.held.find((item) => item.readers > 0);
      expect(entry).toBeDefined();
      expect(entry?.scope).toBe("file");
      expect(entry?.writer).toBe(false);
    } finally {
      await fileLease.release();
    }
  });
});

describe("capability reporting", () => {
  it("mirrors the concurrencyV2 flag in both positions", async () => {
    setCodingLockConcurrencyV2Enabled(false);
    expect((await inspectCodingLocks()).concurrencyV2Enabled).toBe(false);
    setCodingLockConcurrencyV2Enabled(true);
    expect((await inspectCodingLocks()).concurrencyV2Enabled).toBe(true);
  });

  it("surfaces pid-reuse detection availability so the degradation is diagnosable", async () => {
    // P6A residual R1: off Linux this used to be silently unavailable. The point
    // of exposing it is that "this platform cannot detect pid reuse" becomes a
    // readable state rather than an invisible downgrade.
    expect((await inspectCodingLocks()).pidReuseDetectionAvailable).toBe(
      processStartTimeProviderAvailable(),
    );
  });

  it("reads no marker registry at all while the flag is off", async () => {
    setCodingLockConcurrencyV2Enabled(false);
    // Plant a marker that would be reported if the flag were honored loosely.
    await writeMarker(fileA, JSON.stringify({ pid: 4242, starttime: 7, createdAt: "2026-08-19T00:00:00.000Z" }));
    expect((await inspectCodingLocks()).crossProcessSharedReaders).toEqual([]);
  });
});

describe("tolerance: diagnostics run when things are already broken", () => {
  it("reports a planted marker's fields when the flag is on", async () => {
    setCodingLockConcurrencyV2Enabled(true);
    await writeMarker(
      fileA,
      JSON.stringify({ pid: 4242, starttime: 7, createdAt: "2026-08-19T00:00:00.000Z" }),
    );
    const snapshot = await inspectCodingLocks();
    expect(snapshot.crossProcessSharedReaders).toHaveLength(1);
    expect(snapshot.crossProcessSharedReaders[0]).toMatchObject({
      pid: 4242,
      starttime: 7,
      createdAt: "2026-08-19T00:00:00.000Z",
    });
  });

  it("degrades a corrupt marker to nulls instead of throwing", async () => {
    setCodingLockConcurrencyV2Enabled(true);
    await writeMarker(fileA, "{ this is not json");
    const snapshot = await inspectCodingLocks();
    expect(snapshot.crossProcessSharedReaders).toHaveLength(1);
    expect(snapshot.crossProcessSharedReaders[0]).toMatchObject({
      pid: null,
      starttime: null,
      createdAt: null,
    });
  });

  it("returns empties when the state dir does not exist", async () => {
    setCodingLockConcurrencyV2Enabled(true);
    process.env.OPENCLAW_STATE_DIR = path.join(root, "absent-state-dir");
    const snapshot = await inspectCodingLocks();
    expect(snapshot.crossProcessSharedReaders).toEqual([]);
    // The local view still works -- a missing state dir must not blank the
    // in-process half of the diagnostic.
    expect(snapshot.concurrencyV2Enabled).toBe(true);
  });

  it("ignores non-marker files in the registry directory", async () => {
    setCodingLockConcurrencyV2Enabled(true);
    const dir = path.join(stateDir, "locks", sharedReaderRegistryKey(markerKeyFor(fileA)));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "notes.txt"), "not a marker", "utf8");
    expect((await inspectCodingLocks()).crossProcessSharedReaders).toEqual([]);
  });
});

/** The canonical lock key a marker directory is derived from. */
function markerKeyFor(filePath: string): string {
  return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

async function writeMarker(filePath: string, contents: string): Promise<void> {
  const dir = path.join(stateDir, "locks", sharedReaderRegistryKey(markerKeyFor(filePath)));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "reader-1.lock"), contents, "utf8");
}

async function pollFor<T>(probe: () => Promise<T | null>, timeoutMs = 2_000): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() - startedAt > timeoutMs) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
