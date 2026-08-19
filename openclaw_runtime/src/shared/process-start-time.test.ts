/**
 * P7 carry-over D: cross-platform process start-time provider.
 *
 * P6A shipped the pid + starttime invariant with a Linux-only provider, so on
 * Windows and macOS the pid-reuse half of it could not be exercised at all --
 * only injected through a test seam. These tests run against the real OS
 * provider on whichever platform they execute on, so the invariant is actually
 * demonstrated rather than simulated.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __processStartTimeCacheSize,
  __processStartTimeProbeCount,
  __resetProcessStartTimeCacheForTest,
  __setProcessStartTimeProbeForTest,
  __START_TIME_CACHE_MAX_ENTRIES,
  __START_TIME_CACHE_TTL_MS,
  getCachedProcessStartTime,
  processStartTimeProviderAvailable,
} from "./process-start-time.js";

const execFileAsync = promisify(execFile);

/** Spawn a short-lived child we can read a start time for, then reap it. */
async function spawnIdleChild(): Promise<{ pid: number; stop: () => Promise<void> }> {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const pid = child.pid;
  if (!pid) throw new Error("child failed to report a pid");
  return {
    pid,
    stop: async () => {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill();
      await exited;
    },
  };
}

beforeEach(() => {
  __resetProcessStartTimeCacheForTest();
});

afterEach(() => {
  __resetProcessStartTimeCacheForTest();
});

describe("provider availability", () => {
  it("reports availability that matches the running platform", () => {
    const expected = ["linux", "win32", "darwin"].includes(process.platform);
    expect(processStartTimeProviderAvailable()).toBe(expected);
  });
});

describe("real start-time resolution", () => {
  it("resolves a stable value for the current process", () => {
    const first = getCachedProcessStartTime(process.pid);
    if (!processStartTimeProviderAvailable()) {
      expect(first).toBeNull();
      return;
    }
    expect(first).not.toBeNull();
    expect(Number.isSafeInteger(first!)).toBe(true);
    expect(first!).toBeGreaterThan(0);

    // Immutable across reads, cache bypassed.
    __resetProcessStartTimeCacheForTest();
    expect(getCachedProcessStartTime(process.pid)).toBe(first);
  });

  it("distinguishes two live processes started at different times", async () => {
    if (!processStartTimeProviderAvailable()) return;
    const first = await spawnIdleChild();
    try {
      // Enough separation that even a coarse provider resolves them apart.
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const second = await spawnIdleChild();
      try {
        const a = getCachedProcessStartTime(first.pid);
        const b = getCachedProcessStartTime(second.pid);
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        // A later process has a later start time, in whatever units the platform
        // reports. This is the property pid-reuse detection relies on.
        expect(b!).toBeGreaterThan(a!);
      } finally {
        await second.stop();
      }
    } finally {
      await first.stop();
    }
  }, 30_000);

  it("returns null for a pid that no longer exists", async () => {
    const child = await spawnIdleChild();
    const pid = child.pid;
    await child.stop();
    __resetProcessStartTimeCacheForTest();
    expect(getCachedProcessStartTime(pid)).toBeNull();
  }, 30_000);

  it("returns null for invalid pids without probing", () => {
    for (const pid of [0, -1, 1.5, Number.NaN]) {
      expect(getCachedProcessStartTime(pid)).toBeNull();
    }
    expect(__processStartTimeProbeCount()).toBe(0);
  });
});

describe("pid-level cache", () => {
  /**
   * Cache behavior is exercised through the probe seam. The real Windows/macOS
   * probe is a subprocess, so driving eviction or TTL through it would mean
   * hundreds of spawns; the platform probes have their own real-OS coverage
   * above.
   */
  it("probes once per pid inside the cache interval", () => {
    __setProcessStartTimeProbeForTest((pid) => pid * 10);
    try {
      // The 25ms marker poll loop would otherwise probe ~40 times a second.
      expect(getCachedProcessStartTime(4242)).toBe(42_420);
      expect(__processStartTimeProbeCount()).toBe(1);
      for (let index = 0; index < 40; index += 1) {
        expect(getCachedProcessStartTime(4242)).toBe(42_420);
      }
      expect(__processStartTimeProbeCount()).toBe(1);
    } finally {
      __resetProcessStartTimeCacheForTest();
    }
  });

  it("caches negative results so a dead pid is not re-probed in a poll burst", () => {
    __setProcessStartTimeProbeForTest(() => null);
    try {
      expect(getCachedProcessStartTime(4242)).toBeNull();
      expect(__processStartTimeProbeCount()).toBe(1);
      for (let index = 0; index < 20; index += 1) {
        expect(getCachedProcessStartTime(4242)).toBeNull();
      }
      expect(__processStartTimeProbeCount()).toBe(1);
    } finally {
      __resetProcessStartTimeCacheForTest();
    }
  });

  it("re-probes once the cache interval elapses", async () => {
    let value = 1_000;
    __setProcessStartTimeProbeForTest(() => value);
    try {
      expect(getCachedProcessStartTime(4242)).toBe(1_000);
      value = 2_000;
      // Still cached.
      expect(getCachedProcessStartTime(4242)).toBe(1_000);
      await new Promise((resolve) => setTimeout(resolve, __START_TIME_CACHE_TTL_MS + 50));
      expect(getCachedProcessStartTime(4242)).toBe(2_000);
      expect(__processStartTimeProbeCount()).toBe(2);
    } finally {
      __resetProcessStartTimeCacheForTest();
    }
  }, 15_000);

  it("evicts oldest entries instead of growing without bound", () => {
    __setProcessStartTimeProbeForTest((pid) => pid);
    try {
      const overflow = __START_TIME_CACHE_MAX_ENTRIES + 200;
      for (let index = 1; index <= overflow; index += 1) {
        getCachedProcessStartTime(index);
      }
      expect(__processStartTimeCacheSize()).toBeLessThanOrEqual(
        __START_TIME_CACHE_MAX_ENTRIES,
      );
      // The newest entries are the ones still resident.
      const probesBefore = __processStartTimeProbeCount();
      expect(getCachedProcessStartTime(overflow)).toBe(overflow);
      expect(__processStartTimeProbeCount()).toBe(probesBefore);
    } finally {
      __resetProcessStartTimeCacheForTest();
    }
  });

  it("does not probe at all on Linux, where the read is a free proc lookup", () => {
    if (process.platform !== "linux") return;
    for (let index = 0; index < 50; index += 1) getCachedProcessStartTime(process.pid);
    expect(__processStartTimeProbeCount()).toBe(0);
  });
});

describe("self pid is memoized without a TTL", () => {
  /**
   * The session write-lock writes its owner payload -- including this token for
   * `process.pid` -- on every acquisition. Under the shared TTL that re-probes
   * once per second on the session-write hot path, and a cold Windows PowerShell
   * probe is hundreds of milliseconds. Our own start time cannot change, so
   * re-verifying it buys nothing.
   */
  it("probes self at most once no matter how long or how often", async () => {
    __setProcessStartTimeProbeForTest((pid) => pid * 3);
    try {
      expect(getCachedProcessStartTime(process.pid)).toBe(process.pid * 3);
      expect(__processStartTimeProbeCount()).toBe(1);
      for (let index = 0; index < 50; index += 1) {
        expect(getCachedProcessStartTime(process.pid)).toBe(process.pid * 3);
      }
      // Past the TTL a non-self pid would re-probe; self must not.
      await new Promise((resolve) => setTimeout(resolve, __START_TIME_CACHE_TTL_MS + 50));
      expect(getCachedProcessStartTime(process.pid)).toBe(process.pid * 3);
      expect(__processStartTimeProbeCount()).toBe(1);
    } finally {
      __resetProcessStartTimeCacheForTest();
    }
  });

  it("keeps self out of the bounded pid cache so it cannot be evicted", () => {
    __setProcessStartTimeProbeForTest((pid) => pid);
    try {
      expect(getCachedProcessStartTime(process.pid)).toBe(process.pid);
      // Self does not consume an entry in the eviction-bounded map.
      expect(__processStartTimeCacheSize()).toBe(0);
      for (let pid = 1; pid <= __START_TIME_CACHE_MAX_ENTRIES + 20; pid += 1) {
        if (pid === process.pid) continue;
        getCachedProcessStartTime(pid);
      }
      const probesAfterFlood = __processStartTimeProbeCount();
      // Self is still answered from the memo, not re-probed after the flood.
      expect(getCachedProcessStartTime(process.pid)).toBe(process.pid);
      expect(__processStartTimeProbeCount()).toBe(probesAfterFlood);
    } finally {
      __resetProcessStartTimeCacheForTest();
    }
  });

  it("drops the self memo on the test reset seams", () => {
    __setProcessStartTimeProbeForTest(() => 111);
    expect(getCachedProcessStartTime(process.pid)).toBe(111);
    // A stale memo here would make the probe seam unobservable for self.
    __setProcessStartTimeProbeForTest(() => 222);
    try {
      expect(getCachedProcessStartTime(process.pid)).toBe(222);
    } finally {
      __resetProcessStartTimeCacheForTest();
    }
  });
});

describe("probe robustness", () => {
  it("never throws, whatever the pid", () => {
    for (const pid of [1, process.pid]) {
      expect(() => getCachedProcessStartTime(pid)).not.toThrow();
    }
  }, 30_000);

  it("agrees with the platform's own reported start time", async () => {
    if (process.platform !== "win32") return;
    const value = getCachedProcessStartTime(process.pid);
    expect(value).not.toBeNull();
    // Cross-check against an independent query of the same fact.
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${process.pid}).StartTime.ToFileTimeUtc()`,
      ],
      { windowsHide: true, timeout: 20_000 },
    );
    const fileTime = stdout.trim();
    const expected = Number.parseInt(fileTime.slice(0, -4), 10);
    expect(value).toBe(expected);
  }, 60_000);
});
