/**
 * P6A independent-acceptance probes for the cross-process shared-read protocol
 * (§4.1 invariants 2 and 3, acceptance items "跨进程同文件 shared-read 与 write
 * 互斥" and "pid reuse 通过 starttime 识别").
 *
 * The protocol is file-based: readers register a marker under the state dir and
 * writers wait for those markers to drain while holding the write sidecar. These
 * tests exercise it with a real second OS process for the liveness checks, and
 * with a deliberately mismatched starttime for the pid-reuse case.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codingObservability } from "../../context-engine/coding-observability.js";
import { drainSessionWriteLockStateForTest } from "../session-write-lock.js";
import { resolveStateDir } from "../../config/paths.js";
import {
  acquireCodingRuntimeFileLocks,
  isCodingLockConcurrencyV2Enabled,
  resetCodingRuntimeFileLocksForTest,
  setCodingLockConcurrencyV2Enabled,
  setMarkerProcessStartTimeResolverForTest,
} from "./file-lock-manager.js";
import { canonicalLockKey, sharedReaderRegistryKey } from "./lock-core.js";

let root: string;
let stateRoot: string;
let target: string;
let previousStateDirEnv: string | undefined;
let previousFlag: boolean;
const children: ChildProcess[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Registry directory the reader-marker protocol uses for one file path. */
function readerRegistryDir(filePath: string): string {
  const key = canonicalLockKey(filePath);
  return path.join(resolveStateDir(process.env), "locks", sharedReaderRegistryKey(key));
}

async function writeReaderMarker(params: {
  filePath: string;
  pid: number;
  starttime?: number;
  createdAt?: string;
}): Promise<string> {
  const dir = readerRegistryDir(params.filePath);
  await mkdir(dir, { recursive: true });
  const markerPath = path.join(
    dir,
    `${params.pid}-${params.starttime ?? "ns"}-probe-${Math.abs(params.pid) % 100000}.lock`,
  );
  await writeFile(
    markerPath,
    `${JSON.stringify({
      pid: params.pid,
      ...(params.starttime !== undefined ? { starttime: params.starttime } : {}),
      createdAt: params.createdAt ?? new Date().toISOString(),
      leaseId: "probe",
    })}\n`,
    "utf8",
  );
  return markerPath;
}

/** Spawn a long-lived child so its pid is genuinely alive for liveness checks. */
function spawnIdleChild(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  children.push(child);
  return child;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "uftk-xproc-read-"));
  stateRoot = path.join(root, "state");
  await mkdir(stateRoot, { recursive: true });
  previousStateDirEnv = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = stateRoot;
  target = path.join(root, "shared.txt");
  await writeFile(target, "content", "utf8");
  previousFlag = isCodingLockConcurrencyV2Enabled();
  setCodingLockConcurrencyV2Enabled(true);
  resetCodingRuntimeFileLocksForTest();
  codingObservability.reset();
});

afterEach(async () => {
  setMarkerProcessStartTimeResolverForTest(null);
  setCodingLockConcurrencyV2Enabled(previousFlag);
  resetCodingRuntimeFileLocksForTest();
  await drainSessionWriteLockStateForTest().catch(() => {});
  for (const child of children.splice(0)) child.kill();
  if (previousStateDirEnv === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = previousStateDirEnv;
  await rm(root, { recursive: true, force: true });
});

describe("P6A cross-process shared reads", () => {
  it("registers a marker for a read lock and removes it on release", async () => {
    const handle = await acquireCodingRuntimeFileLocks(target, { mode: "read", owner: "r1" });
    const during = await readdir(readerRegistryDir(target)).catch(() => []);
    expect(during.filter((name) => name.endsWith(".lock"))).toHaveLength(1);
    await handle.release();
    const after = await readdir(readerRegistryDir(target)).catch(() => []);
    expect(after.filter((name) => name.endsWith(".lock"))).toHaveLength(0);
  });

  it("lets two same-file readers coexist across processes", async () => {
    const child = spawnIdleChild();
    await writeReaderMarker({ filePath: target, pid: child.pid! });

    // A local reader must not be blocked by another process's reader marker.
    const started = Date.now();
    const handle = await acquireCodingRuntimeFileLocks(target, {
      mode: "read",
      owner: "local-reader",
      timeoutMs: 2_000,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    const markers = (await readdir(readerRegistryDir(target))).filter((n) => n.endsWith(".lock"));
    expect(markers.length).toBeGreaterThanOrEqual(2);
    await handle.release();
  });

  it("makes a writer wait for a live cross-process reader to drain", async () => {
    const child = spawnIdleChild();
    const markerPath = await writeReaderMarker({ filePath: target, pid: child.pid! });

    let writerAcquired = false;
    const writer = acquireCodingRuntimeFileLocks(target, {
      mode: "write",
      owner: "local-writer",
      timeoutMs: 8_000,
      staleMs: 60_000,
    }).then((handle) => {
      writerAcquired = true;
      return handle;
    });

    await delay(250);
    expect(writerAcquired, "writer must wait for the cross-process reader").toBe(false);

    // The other process finishes reading.
    await rm(markerPath, { force: true });
    const handle = await writer;
    expect(writerAcquired).toBe(true);
    await handle.release();
  });

  it("returns bounded E_LOCK_TIMEOUT when a cross-process reader never drains", async () => {
    const child = spawnIdleChild();
    await writeReaderMarker({ filePath: target, pid: child.pid! });
    const before = codingObservability.snapshot();

    await expect(
      acquireCodingRuntimeFileLocks(target, {
        mode: "write",
        owner: "local-writer",
        timeoutMs: 300,
        staleMs: 60_000,
      }),
    ).rejects.toMatchObject({ code: "E_LOCK_TIMEOUT" });

    expect(codingObservability.snapshot().lockTimeout).toBeGreaterThan(before.lockTimeout);
  });

  it("treats a reused pid with a mismatched starttime as stale, not as a live reader", async () => {
    // Same pid as this very much alive process: checking pid alone would make a
    // writer wait for a reader that no longer exists. `getProcessStartTime` is
    // Linux-only, so the resolver seam pins this behavior on every platform.
    const FAKE_CURRENT_STARTTIME = 4_242;
    setMarkerProcessStartTimeResolverForTest(() => FAKE_CURRENT_STARTTIME);
    await writeReaderMarker({
      filePath: target,
      pid: process.pid,
      starttime: FAKE_CURRENT_STARTTIME + 1, // recorded by the pid's previous owner
    });
    const before = codingObservability.snapshot();

    const started = Date.now();
    const handle = await acquireCodingRuntimeFileLocks(target, {
      mode: "write",
      owner: "local-writer",
      timeoutMs: 3_000,
      staleMs: 60_000,
    });
    expect(Date.now() - started).toBeLessThan(1_500);
    await handle.release();

    // The stale marker was reclaimed and counted.
    expect(codingObservability.snapshot().staleLockReclaimed).toBeGreaterThan(
      before.staleLockReclaimed,
    );
    const remaining = (await readdir(readerRegistryDir(target)).catch(() => [])).filter((n) =>
      n.endsWith(".lock"),
    );
    expect(remaining).toHaveLength(0);
  });

  it("keeps a marker live when the starttime matches the current owner", async () => {
    const FAKE_CURRENT_STARTTIME = 4_242;
    setMarkerProcessStartTimeResolverForTest(() => FAKE_CURRENT_STARTTIME);
    const markerPath = await writeReaderMarker({
      filePath: target,
      pid: process.pid,
      starttime: FAKE_CURRENT_STARTTIME,
    });

    let writerAcquired = false;
    const writer = acquireCodingRuntimeFileLocks(target, {
      mode: "write",
      owner: "local-writer",
      timeoutMs: 8_000,
      staleMs: 60_000,
    }).then((handle) => {
      writerAcquired = true;
      return handle;
    });
    await delay(200);
    expect(writerAcquired, "a matching-starttime marker must be treated as a live reader").toBe(
      false,
    );
    await rm(markerPath, { force: true });
    await (await writer).release();
  });

  it("documents the non-Linux starttime degradation: unresolvable starttime falls back to the age bound", async () => {
    // This is the real production behavior on Windows/macOS, where
    // getProcessStartTime returns null: the starttime check cannot fire, so a
    // reused pid is only reclaimed once the marker exceeds staleMs.
    setMarkerProcessStartTimeResolverForTest(() => null);
    await writeReaderMarker({
      filePath: target,
      pid: process.pid,
      starttime: 999_999,
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    });

    // Fresh-enough marker with an unresolvable starttime still blocks.
    await expect(
      acquireCodingRuntimeFileLocks(target, {
        mode: "write",
        owner: "blocked-writer",
        timeoutMs: 250,
        staleMs: 120_000,
      }),
    ).rejects.toMatchObject({ code: "E_LOCK_TIMEOUT" });

    // Past the age bound it is reclaimed, so the wait is bounded by staleMs.
    const handle = await acquireCodingRuntimeFileLocks(target, {
      mode: "write",
      owner: "eventual-writer",
      timeoutMs: 3_000,
      staleMs: 1_000,
    });
    await handle.release();
  });

  it("treats a dead pid marker as stale", async () => {
    await writeReaderMarker({ filePath: target, pid: 999_999_999 });
    const handle = await acquireCodingRuntimeFileLocks(target, {
      mode: "write",
      owner: "local-writer",
      timeoutMs: 3_000,
      staleMs: 60_000,
    });
    await handle.release();
    const remaining = (await readdir(readerRegistryDir(target)).catch(() => [])).filter((n) =>
      n.endsWith(".lock"),
    );
    expect(remaining).toHaveLength(0);
  });

  it("registers no marker when concurrencyV2 is disabled", async () => {
    setCodingLockConcurrencyV2Enabled(false);
    const handle = await acquireCodingRuntimeFileLocks(target, { mode: "read", owner: "r1" });
    const during = (await readdir(readerRegistryDir(target)).catch(() => [])).filter((n) =>
      n.endsWith(".lock"),
    );
    expect(during).toHaveLength(0);
    await handle.release();
  });
});
