/**
 * P2 file-lock-manager tests: read-shared / write-exclusive local scheduling,
 * timeout, stale detection, stable multi-path ordering, and the reused
 * session-write-lock cross-process sidecar protocol.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drainSessionWriteLockStateForTest } from "../session-write-lock.js";
import {
  CodingRuntimeFileLockManager,
  resetCodingRuntimeFileLocksForTest,
  type CodingRuntimeFileLockHandle,
} from "./file-lock-manager.js";
import { CodingRuntimeError } from "./coding-runtime-error.js";

let root: string;
let fileA: string;
let fileB: string;
const manager = new CodingRuntimeFileLockManager();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition not met in time");
    await delay(10);
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "uftk-file-lock-"));
  fileA = path.join(root, "a.txt");
  fileB = path.join(root, "b.txt");
  await writeFile(fileA, "a", "utf8");
  await writeFile(fileB, "b", "utf8");
  resetCodingRuntimeFileLocksForTest();
});

afterEach(async () => {
  resetCodingRuntimeFileLocksForTest();
  await drainSessionWriteLockStateForTest().catch(() => {});
  // Clean up any sidecar .lock files that the infra layer leaves behind
  // on release so they don't interfere with the next test.
  try {
    const entries = await readdir(root);
    for (const name of entries) {
      if (name.endsWith(".lock") || name.includes(".lock-target")) {
        await rm(path.join(root, name), { force: true }).catch(() => {});
      }
    }
  } catch {
    // Best-effort test cleanup; the following rm removes the temp root.
  }
  await rm(root, { recursive: true, force: true });
});

describe("local reader-writer scheduling", () => {
  it("same-file reads are shared and run concurrently", async () => {
    let readStarted = 0;
    let releaseReads!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const read = () =>
      manager.withReadLock(fileA, async () => {
        readStarted += 1;
        await gate;
        return readStarted;
      });
    const first = read();
    const second = read();
    await waitFor(() => readStarted === 2);
    releaseReads();
    await expect(first).resolves.toBe(2);
    await expect(second).resolves.toBe(2);
  });

  it("readers are blocked while a writer holds the file", async () => {
    const write = await manager.acquireWrite(fileA, { owner: "writer-1" });
    let readStarted = false;
    const pendingRead = manager
      .withReadLock(fileA, async () => {
        readStarted = true;
        return "read";
      })
      .then(() => readStarted);

    await delay(60);
    expect(readStarted).toBe(false);
    await write.release();
    await expect(pendingRead).resolves.toBe(true);
  });

  it("a writer waits for active readers to drain", async () => {
    const readA = await manager.acquireRead(fileA, { owner: "reader-a" });
    const readB = await manager.acquireRead(fileA, { owner: "reader-b" });
    let writeStarted = false;
    const pendingWrite = manager
      .withWriteLock(fileA, async () => {
        writeStarted = true;
        return "write";
      })
      .then(() => writeStarted);

    await delay(60);
    expect(writeStarted).toBe(false);
    await readA.release();
    await delay(40);
    expect(writeStarted).toBe(false);
    await readB.release();
    await expect(pendingWrite).resolves.toBe(true);
  });

  it("same-file writes are serialized", async () => {
    const first = await manager.acquireWrite(fileA, { owner: "first" });
    let secondStarted = false;
    const pending = manager
      .withWriteLock(fileA, async () => {
        secondStarted = true;
        return "second";
      })
      .then(() => secondStarted);

    await delay(60);
    expect(secondStarted).toBe(false);
    await first.release();
    await expect(pending).resolves.toBe(true);
  });

  it("different files acquire write locks in parallel", async () => {
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = () =>
      manager.withWriteLock(fileA, async () => {
        started += 1;
        await gate;
      });
    const first = run();
    const second = manager.withWriteLock(fileB, async () => {
      started += 1;
      await gate;
    });
    await waitFor(() => started === 2);
    release();
    await Promise.all([first, second]);
  });

  it("multi-path locks are deduplicated and acquired in normalized sorted order", async () => {
    const handle = await manager.acquireWrite([fileB, fileA, fileA]);
    expect(handle.paths.map((entry) => entry.toLowerCase()).sort()).toEqual(
      handle.paths.map((entry) => entry.toLowerCase()),
    );
    expect(new Set(handle.paths).size).toBe(2);
    await handle.release();
  });
});

describe("timeout and stale handling", () => {
  it("returns structured E_LOCK_TIMEOUT with owner diagnostics", async () => {
    const holder = await manager.acquireWrite(fileA, { owner: "holder-owner" });
    try {
      const error = await manager
        .acquireWrite(fileA, { owner: "waiter-owner", timeoutMs: 80 })
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      expect(error).toBeInstanceOf(CodingRuntimeError);
      expect((error as CodingRuntimeError).code).toBe("E_LOCK_TIMEOUT");
      expect((error as CodingRuntimeError).message).toContain("holder-owner");
      expect((error as CodingRuntimeError).path).toBeDefined();
    } finally {
      await holder.release();
    }
  });

  it("reclaims a stale dead-pid lock file through session-write-lock semantics", async () => {
    const lockPath = `${fileA}.lock`;
    writeFileSync(
      lockPath,
      `${JSON.stringify({
        pid: 999_999_999,
        createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        maxHoldMs: 1000,
      })}\n`,
      "utf8",
    );
    const handle = await manager.acquireWrite(fileA, {
      owner: "reclaimer",
      timeoutMs: 1000,
      staleMs: 250,
    });
    expect(handle.owner).toBe("reclaimer");
    await handle.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("reports E_LOCK_TIMEOUT while another process holds the sidecar, then acquires after release", async () => {
    const childScript = `
      const fs = require("node:fs");
      const path = require("node:path");
      const target = process.argv[1];
      const lockPath = target + ".lock";
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        maxHoldMs: 10000
      }), "utf8");
      console.log("ready");
      setTimeout(() => {
        fs.closeSync(fd);
        try { fs.unlinkSync(lockPath); } catch {}
      }, 1500);
    `;
    const child = spawn(process.execPath, ["-e", childScript, fileA, "openclaw"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let childStderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      childStderr += chunk.toString();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            child.kill();
            reject(new Error("child did not become ready"));
          }
        }, 3000);
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("ready") && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        });
        child.on("error", (error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        });
        child.on("exit", (code) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error(`child exited before ready (${code}): ${childStderr}`));
          }
        });
      });

      const error = await manager
        .acquireWrite(fileA, { owner: "cross-waiter", timeoutMs: 250 })
        .then(
          () => null,
          (caught: unknown) => caught,
        );
      expect(error).toBeInstanceOf(CodingRuntimeError);
      expect((error as CodingRuntimeError).code).toBe("E_LOCK_TIMEOUT");

      await new Promise<void>((resolve) => child.once("exit", resolve));
      const handle = await manager.acquireWrite(fileA, {
        owner: "after-exit",
        timeoutMs: 1000,
        staleMs: 250,
      });
      await handle.release();
    } finally {
      if (child.exitCode === null) child.kill();
    }
  });
});

describe("multi-path deadlock avoidance", () => {
  it("reversed acquisition orders still both complete", async () => {
    const first = manager.withWriteLock([fileA, fileB], async () => {
      await delay(50);
      return "first";
    });
    const second = manager.withWriteLock([fileB, fileA], async () => {
      await delay(50);
      return "second";
    });
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
  });
});

describe("handle contract", () => {
  it("release is idempotent and exposes mode/owner/paths", async () => {
    const handle: CodingRuntimeFileLockHandle = await manager.acquireRead(fileA, {
      owner: "reader",
    });
    expect(handle.mode).toBe("read");
    expect(handle.owner).toBe("reader");
    expect(handle.paths.map((entry) => entry.toLowerCase())).toContain(fileA.toLowerCase());
    await handle.release();
    await expect(handle.release()).resolves.toBeUndefined();
  });
});
