/**
 * P6A lock-core tests: hierarchical file/directory/workspace scheduling,
 * dead-lock freedom, timeout, and observability counters.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireLocalLocks,
  canonicalLockKey,
  directoryPrefixKey,
  inspectLocalLockState,
  locksOverlap,
  resetLockCoreForTest,
  workspaceScopeKey,
} from "./lock-core.js";

let root: string;
let fileA: string;
let fileB: string;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "uftk-lock-core-"));
  fileA = path.join(root, "a.txt");
  fileB = path.join(root, "b.txt");
  await writeFile(fileA, "a", "utf8");
  await writeFile(fileB, "b", "utf8");
  resetLockCoreForTest();
});

afterEach(async () => {
  resetLockCoreForTest();
  await rm(root, { recursive: true, force: true });
});

describe("canonicalLockKey", () => {
  it("is stable for the same path", () => {
    expect(canonicalLockKey(fileA)).toBe(canonicalLockKey(fileA));
  });

  it("differs for different files", () => {
    expect(canonicalLockKey(fileA)).not.toBe(canonicalLockKey(fileB));
  });
});

describe("local read-shared / write-exclusive scheduling", () => {
  it("same-file reads run concurrently", async () => {
    const key = canonicalLockKey(fileA);
    let started = 0;
    const p1 = acquireLocalLocks([key], "read").then(async (h) => {
      started += 1;
      await delay(20);
      await h.release();
    });
    const p2 = acquireLocalLocks([key], "read").then(async (h) => {
      started += 1;
      await h.release();
    });
    await Promise.all([p1, p2]);
    expect(started).toBe(2);
  });

  it("same-file writes are serialized", async () => {
    const key = canonicalLockKey(fileA);
    let order = 0;
    const first = await acquireLocalLocks([key], "write");
    const secondP = acquireLocalLocks([key], "write").then(async (h) => {
      order += 1;
      await h.release();
      return order;
    });
    await delay(40);
    expect(order).toBe(0);
    await first.release();
    expect(await secondP).toBe(1);
  });

  it("readers are blocked by a writer", async () => {
    const key = canonicalLockKey(fileA);
    const writer = await acquireLocalLocks([key], "write");
    let readStarted = false;
    const readP = acquireLocalLocks([key], "read").then(async (h) => {
      readStarted = true;
      await h.release();
    });
    await delay(40);
    expect(readStarted).toBe(false);
    await writer.release();
    await readP;
    expect(readStarted).toBe(true);
  });

  it("a queued writer is a barrier for later readers", async () => {
    const key = canonicalLockKey(fileA);
    const firstRead = await acquireLocalLocks([key], "read");
    let writerStarted = false;
    const writerP = acquireLocalLocks([key], "write").then(async (h) => {
      writerStarted = true;
      await delay(10);
      await h.release();
    });
    await delay(20);
    expect(writerStarted).toBe(false);
    let lateReadStarted = false;
    const lateReadP = acquireLocalLocks([key], "read").then(async (h) => {
      lateReadStarted = true;
      await h.release();
    });
    await delay(20);
    expect(lateReadStarted).toBe(false);
    await firstRead.release();
    await writerP;
    await lateReadP;
    expect(writerStarted).toBe(true);
    expect(lateReadStarted).toBe(true);
  });

  it("different files acquire in parallel", async () => {
    const keyA = canonicalLockKey(fileA);
    const keyB = canonicalLockKey(fileB);
    let started = 0;
    const p1 = acquireLocalLocks([keyA], "write").then(async (h) => {
      started += 1;
      await delay(20);
      await h.release();
    });
    const p2 = acquireLocalLocks([keyB], "write").then(async (h) => {
      started += 1;
      await h.release();
    });
    await Promise.all([p1, p2]);
    expect(started).toBe(2);
  });
});

describe("multi-path deadlock avoidance", () => {
  it("reversed acquisition orders both complete", async () => {
    let order = "";
    const first = acquireLocalLocks(
      [canonicalLockKey(fileA), canonicalLockKey(fileB)],
      "write",
    ).then(async (h) => {
      order += "1";
      await delay(20);
      await h.release();
    });
    await delay(10);
    const second = acquireLocalLocks(
      [canonicalLockKey(fileB), canonicalLockKey(fileA)],
      "write",
    ).then(async (h) => {
      order += "2";
      await h.release();
    });
    await Promise.all([first, second]);
    expect(order.length).toBe(2);
  });

  it("multi-path keys are deduplicated and sorted", async () => {
    const handle = await acquireLocalLocks(
      [canonicalLockKey(fileB), canonicalLockKey(fileA), canonicalLockKey(fileA)],
      "write",
    );
    expect(handle.keys.length).toBe(2);
    expect(handle.keys[0].localeCompare(handle.keys[1])).toBeLessThanOrEqual(0);
    await handle.release();
  });
});

describe("hierarchical lock scopes", () => {
  it("a directory-prefix lock excludes a file lock under that directory", async () => {
    const dirKey = directoryPrefixKey(root);
    const dirLock = await acquireLocalLocks([dirKey], "write");
    let fileStarted = false;
    const fileP = acquireLocalLocks([canonicalLockKey(fileA)], "write").then(async (h) => {
      fileStarted = true;
      await h.release();
    });
    await delay(40);
    expect(fileStarted).toBe(false);
    await dirLock.release();
    await fileP;
    expect(fileStarted).toBe(true);
  });

  it("a workspace-scope lock excludes file and directory locks", async () => {
    const wsKey = workspaceScopeKey(root);
    const wsLock = await acquireLocalLocks([wsKey], "write");
    let fileStarted = false;
    const fileP = acquireLocalLocks([canonicalLockKey(fileA)], "read").then(async (h) => {
      fileStarted = true;
      await h.release();
    });
    await delay(40);
    expect(fileStarted).toBe(false);
    await wsLock.release();
    await fileP;
    expect(fileStarted).toBe(true);
  });

  it("workspace-scope lock excludes a second workspace-scope lock for the same root", async () => {
    const first = await acquireLocalLocks([workspaceScopeKey(root)], "write");
    let secondStarted = false;
    const secondP = acquireLocalLocks([workspaceScopeKey(root)], "write").then(async (h) => {
      secondStarted = true;
      await h.release();
    });
    await delay(40);
    expect(secondStarted).toBe(false);
    await first.release();
    await secondP;
    expect(secondStarted).toBe(true);
  });
});

describe("locksOverlap", () => {
  it("identical keys overlap", () => {
    expect(locksOverlap("a", "a")).toBe(true);
  });

  it("a directory key overlaps a file under that directory", () => {
    const dirKey = directoryPrefixKey(root);
    const fileKey = canonicalLockKey(fileA);
    expect(locksOverlap(dirKey, fileKey)).toBe(true);
    expect(locksOverlap(fileKey, dirKey)).toBe(true);
  });

  it("a workspace key overlaps everything under the root", () => {
    const wsKey = workspaceScopeKey(root);
    const fileKey = canonicalLockKey(fileA);
    const dirKey = directoryPrefixKey(root);
    expect(locksOverlap(wsKey, fileKey)).toBe(true);
    expect(locksOverlap(wsKey, dirKey)).toBe(true);
    expect(locksOverlap(wsKey, wsKey)).toBe(true);
  });

  it("disjoint files do not overlap", () => {
    expect(locksOverlap(canonicalLockKey(fileA), canonicalLockKey(fileB))).toBe(false);
  });
});

describe("timeout", () => {
  it("returns E_LOCK_TIMEOUT on blocked acquire", async () => {
    const key = canonicalLockKey(fileA);
    const holder = await acquireLocalLocks([key], "write", { owner: "holder" });
    const error = await acquireLocalLocks([key], "write", {
      owner: "waiter",
      timeoutMs: 80,
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as { code: string }).code).toBe("E_LOCK_TIMEOUT");
    expect((error as { message: string }).message).toContain("holder");
    await holder.release();
  });
});

describe("inspectLocalLockState", () => {
  it("reports held and waiting entries", async () => {
    const key = canonicalLockKey(fileA);
    const held = await acquireLocalLocks([key], "write");
    const waitingP = acquireLocalLocks([key], "write", {
      timeoutMs: 500,
    }).catch(() => {});
    await delay(30);
    const state = inspectLocalLockState();
    expect(state.held.length).toBeGreaterThanOrEqual(1);
    expect(state.waiting.length).toBeGreaterThanOrEqual(1);
    await held.release();
    await waitingP;
  });
});
