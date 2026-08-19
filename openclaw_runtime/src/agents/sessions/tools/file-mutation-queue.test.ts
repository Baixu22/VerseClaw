import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetFileMutationQueues, withFileMutationQueue, withFileReadQueue } from "./file-mutation-queue.js";

let root: string;
let fileA: string;
let fileB: string;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition not met");
    await delay(10);
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "file-mutation-queue-"));
  fileA = path.join(root, "a.txt");
  fileB = path.join(root, "b.txt");
  await writeFile(fileA, "a", "utf8");
  await writeFile(fileB, "b", "utf8");
  __resetFileMutationQueues();
});

afterEach(async () => {
  __resetFileMutationQueues();
  await rm(root, { recursive: true, force: true });
});

describe("withFileMutationQueue compatibility", () => {
  it("keeps default write-mutex behavior", async () => {
    let first = false;
    let second = false;
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const pendingFirst = withFileMutationQueue(fileA, async () => {
      first = true;
      await gate;
    });
    await waitFor(() => first);
    const pendingSecond = withFileMutationQueue(fileA, async () => {
      second = true;
    });
    await delay(50);
    expect(second).toBe(false);
    releaseFirst();
    await Promise.all([pendingFirst, pendingSecond]);
    expect(second).toBe(true);
  });

  it("keeps independent files parallel for writes", async () => {
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withFileMutationQueue(fileA, async () => {
      started += 1;
      await gate;
    });
    const second = withFileMutationQueue(fileB, async () => {
      started += 1;
      await gate;
    });
    await waitFor(() => started === 2);
    release();
    await Promise.all([first, second]);
  });
});

describe("read sharing", () => {
  it("same-file readers run concurrently", async () => {
    let readers = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = () =>
      withFileReadQueue(fileA, async () => {
        readers += 1;
        await gate;
      });
    const first = run();
    const second = run();
    await waitFor(() => readers === 2);
    release();
    await Promise.all([first, second]);
  });

  it("readers exclude writers and writers exclude readers", async () => {
    let readStarted = false;
    let writeStarted = false;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const pendingRead = withFileReadQueue(fileA, async () => {
      readStarted = true;
      await readGate;
    });
    await waitFor(() => readStarted);
    const pendingWrite = withFileMutationQueue(fileA, async () => {
      writeStarted = true;
    });
    await delay(50);
    expect(writeStarted).toBe(false);
    releaseRead();
    await Promise.all([pendingRead, pendingWrite]);
    expect(writeStarted).toBe(true);
  });

  it("a queued writer is a barrier for later readers", async () => {
    let writerRelease!: () => void;
    const writerGate = new Promise<void>((resolve) => {
      writerRelease = resolve;
    });
    let activeReads = 0;
    const firstRead = withFileReadQueue(fileA, async () => {
      activeReads += 1;
      await delay(30);
      activeReads -= 1;
    });
    await waitFor(() => activeReads === 1);
    const writer = withFileMutationQueue(fileA, async () => {
      await writerGate;
    });
    let lateReadStarted = false;
    const lateRead = withFileReadQueue(fileA, async () => {
      lateReadStarted = true;
    });
    await delay(80);
    expect(lateReadStarted).toBe(false);
    writerRelease();
    await Promise.all([firstRead, writer, lateRead]);
    expect(lateReadStarted).toBe(true);
  });

  it("optional timeout rejects rather than waiting forever", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = withFileMutationQueue(fileA, async () => {
      await gate;
    });
    await delay(20);
    await expect(withFileMutationQueue(fileA, async () => {}, { timeoutMs: 50 })).rejects.toThrow(/Timed out/);
    release();
    await holder;
  });
});
