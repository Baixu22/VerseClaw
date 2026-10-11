import { afterEach, describe, expect, it } from "vitest";
import {
  admitManagedProcess,
  configureManagedProcessCapacity,
  managedProcessCapacityStats,
  readManagedProcessCapacityFromEnv,
  resetManagedProcessCapacity,
  resolveManagedProcessDefaultLimits,
} from "./managed-process-capacity.js";

afterEach(() => {
  resetManagedProcessCapacity();
});

describe("managed process capacity", () => {
  it("admits everything and allocates no counter until a capacity is declared", () => {
    const first = admitManagedProcess();
    const second = admitManagedProcess();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(managedProcessCapacityStats()).toMatchObject({ live: 0 });
    expect(managedProcessCapacityStats().limit).toBeUndefined();
    if (first.ok) expect(first.lease.release()).toBe(true);
    if (second.ok) expect(second.lease.release()).toBe(true);
  });

  it("bounds the instance-wide live count and refuses beyond it", () => {
    configureManagedProcessCapacity({ maxLiveProcesses: 2 });
    const first = admitManagedProcess();
    const second = admitManagedProcess();
    const third = admitManagedProcess();
    expect(first.ok && second.ok).toBe(true);
    expect(third.ok).toBe(false);
    if (third.ok) {
      throw new Error("expected capacity refusal");
    }
    expect(third).toMatchObject({ reason: "capacity", live: 2, limit: 2 });
    expect(managedProcessCapacityStats()).toMatchObject({
      live: 2,
      peakLive: 2,
      admitted: 2,
      rejectedCapacity: 1,
      limit: 2,
    });

    if (!first.ok) {
      throw new Error("first refused");
    }
    first.lease.release();
    expect(managedProcessCapacityStats()).toMatchObject({ live: 1, completed: 1 });
    const afterRelease = admitManagedProcess();
    expect(afterRelease.ok).toBe(true);
    if (afterRelease.ok) afterRelease.lease.release();
    if (second.ok) second.lease.release();
    expect(managedProcessCapacityStats()).toMatchObject({ live: 0, completed: 3, doubleRelease: 0 });
  });

  it("counts a double release without freeing a second slot", () => {
    configureManagedProcessCapacity({ maxLiveProcesses: 1 });
    const admission = admitManagedProcess();
    if (!admission.ok) {
      throw new Error("admission refused");
    }
    expect(admission.lease.release()).toBe(true);
    expect(admission.lease.release()).toBe(false);
    expect(managedProcessCapacityStats()).toMatchObject({ live: 0, completed: 1, doubleRelease: 1 });
    expect(admitManagedProcess().ok).toBe(true);
  });

  it("reads the declared capacity and per-run defaults from the environment", () => {
    expect(readManagedProcessCapacityFromEnv({})).toBeUndefined();
    expect(
      readManagedProcessCapacityFromEnv({
        OPENCLAW_VERSESHELL_MAX_LIVE_PROCESSES: "nope",
        OPENCLAW_VERSESHELL_MAX_PROCESSES: "0",
      }),
    ).toBeUndefined();
    expect(
      readManagedProcessCapacityFromEnv({
        OPENCLAW_VERSESHELL_MAX_LIVE_PROCESSES: "3",
        OPENCLAW_VERSESHELL_MAX_PROCESSES: "12",
        OPENCLAW_VERSESHELL_MAX_MEMORY_MB: "512",
      }),
    ).toEqual({
      maxLiveProcesses: 3,
      defaultLimits: { maxProcesses: 12, maxMemoryBytes: 512 * 1024 * 1024 },
    });
  });

  it("exposes the declared default limits to the process boundary", () => {
    configureManagedProcessCapacity({ defaultLimits: { maxProcesses: 4 } });
    expect(resolveManagedProcessDefaultLimits()).toEqual({ maxProcesses: 4 });
    resetManagedProcessCapacity();
    expect(resolveManagedProcessDefaultLimits()).toEqual({});
  });
});
