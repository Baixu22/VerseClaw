import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import {
  admitManagedProcess,
  configureManagedProcessCapacity,
  managedProcessCapacityStats,
  readManagedProcessCapacityFromEnv,
  resetManagedProcessCapacity,
  resolveManagedProcessDefaultLimits,
  startManagedChildProcess,
} from "./managed-process-capacity.js";
import {
  managedProcessReservations,
  setManagedProcessHostPressure,
} from "./managed-process-reservation.js";

afterEach(() => {
  resetManagedProcessCapacity();
  setManagedProcessHostPressure(false);
});

describe("managed process capacity", () => {
  it("tracks unconfigured launches without declaring a normal capacity limit", () => {
    const before = new Set(managedProcessReservations().map((record) => record.id));
    const first = admitManagedProcess();
    const second = admitManagedProcess();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(managedProcessReservations().filter((record) => !before.has(record.id))).toHaveLength(2);
    expect(managedProcessCapacityStats()).toMatchObject({ live: 2 });
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
    expect(managedProcessCapacityStats()).toMatchObject({
      live: 0,
      completed: 3,
      doubleRelease: 0,
    });
  });

  it("binds an unconfigured reservation to execution identity", () => {
    const admission = admitManagedProcess({
      owner: "agent-1:agent:main:run-scope",
      identity: {
        sessionKey: "agent:main:run-scope",
        sessionGeneration: "generation-1",
        runId: "run-1",
      },
    });
    expect(admission).toMatchObject({ ok: true, live: 1, limit: undefined });
    const reservationId = admission.ok ? admission.lease.reservationId : undefined;
    expect(reservationId).toBeTruthy();
    expect(managedProcessReservations()).toContainEqual(
      expect.objectContaining({
        id: reservationId,
        sessionKey: "agent:main:run-scope",
        sessionGeneration: "generation-1",
        runId: "run-1",
      }),
    );
    expect(
      managedProcessReservations().find((record) => record.id === reservationId)?.limit,
    ).toBeUndefined();
    if (admission.ok) admission.lease.release();
    expect(managedProcessReservations().some((record) => record.id === reservationId)).toBe(false);
  });

  it("counts a double release without freeing a second slot", () => {
    configureManagedProcessCapacity({ maxLiveProcesses: 1 });
    const admission = admitManagedProcess();
    if (!admission.ok) {
      throw new Error("admission refused");
    }
    expect(admission.lease.release()).toBe(true);
    expect(admission.lease.release()).toBe(false);
    expect(managedProcessCapacityStats()).toMatchObject({
      live: 0,
      completed: 1,
      doubleRelease: 1,
    });
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

  it("contracts host admission under pressure while retaining existing and unknown owners", () => {
    configureManagedProcessCapacity({ maxLiveProcesses: 3 });
    const first = admitManagedProcess();
    const second = admitManagedProcess();
    if (!first.ok || !second.ok) throw new Error("initial host admission failed");
    second.lease.markUnknown("native-outcome-unavailable");
    setManagedProcessHostPressure(true);
    expect(admitManagedProcess()).toMatchObject({
      ok: false,
      reason: "capacity",
      live: 2,
      limit: 1,
    });
    first.lease.release();
    expect(admitManagedProcess()).toMatchObject({ ok: false, live: 1, limit: 1 });
    expect(managedProcessReservations()).toContainEqual(
      expect.objectContaining({ phase: "unknown" }),
    );
    setManagedProcessHostPressure(false);
    const recovered = admitManagedProcess();
    expect(recovered).toMatchObject({ ok: true, limit: 3 });
    if (recovered.ok) recovered.lease.release();
    second.lease.release();
  });

  it("keeps a temporary pressure limit out of a process's normal reservation", () => {
    configureManagedProcessCapacity({ maxLiveProcesses: 3 });
    setManagedProcessHostPressure(true);
    const first = admitManagedProcess();
    expect(first).toMatchObject({ ok: true, limit: 1 });
    if (!first.ok) throw new Error("pressure admission failed");
    expect(
      managedProcessReservations().find((record) => record.id === first.lease.reservationId)?.limit,
    ).toBe(3);
    setManagedProcessHostPressure(false);
    expect(admitManagedProcess()).toMatchObject({ ok: true, limit: 3 });
  });

  it("counts unconfigured running work during pressure and restores undeclared admission after recovery", () => {
    const first = admitManagedProcess();
    if (!first.ok) throw new Error("unconfigured admission failed");
    setManagedProcessHostPressure(true);
    expect(admitManagedProcess()).toMatchObject({ ok: false, live: 1, limit: 1 });
    expect(
      managedProcessReservations().find((record) => record.id === first.lease.reservationId)?.limit,
    ).toBeUndefined();
    setManagedProcessHostPressure(false);
    const second = admitManagedProcess();
    expect(second).toMatchObject({ ok: true, live: 2 });
    expect(managedProcessCapacityStats().limit).toBeUndefined();
    first.lease.release();
    if (second.ok) second.lease.release();
  });

  it("compensates Node argument rejection before a native process is created", () => {
    configureManagedProcessCapacity({ maxLiveProcesses: 1 });
    expect(() =>
      startManagedChildProcess(
        () => spawn(process.execPath, ["invalid\0argument"]),
        "invalid-node-start",
      ),
    ).toThrow();
    expect(managedProcessReservations()).toEqual([]);
    expect(managedProcessCapacityStats()).toMatchObject({ live: 0, completed: 1 });
    expect(admitManagedProcess()).toMatchObject({ ok: true, live: 1 });
  });
});
