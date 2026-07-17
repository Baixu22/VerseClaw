/**
 * P5-002 / F-REL-001: cron single authority, CAS lease, authorized repair.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimCronJobLease,
  releaseCronJobLease,
  CRON_LEASE_STALE_MS,
} from "./store/lease.js";
import { saveCronJobsStore } from "./store.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { CronService } from "./service.js";
import * as storeModule from "./service/store.js";
import * as ops from "./service/ops.js";
import { createCronServiceState } from "./service/state.js";
import type { CronJob } from "./types.js";

function makeJob(id: string, overrides: Partial<CronJob> = {}): CronJob {
  const now = Date.now();
  return {
    id,
    name: id,
    enabled: true,
    createdAtMs: now,
    updatedAtMs: now,
    schedule: { kind: "every", everyMs: 60_000 },
    sessionTarget: "main",
    wakeMode: "now",
    payload: { kind: "systemEvent", text: "ping" },
    state: {
      nextRunAtMs: now + 60_000,
    },
    ...overrides,
  } as CronJob;
}

describe("P5-002 cron lease CAS", () => {
  let stateDir = "";
  let storePath = "";

  beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "p5-002-cron-state-"));
    process.env.OPENCLAW_STATE_DIR = stateDir;
    storePath = path.join(stateDir, "cron", "jobs.json");
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await saveCronJobsStore(storePath, {
      version: 1,
      jobs: [makeJob("job-a"), makeJob("job-b")],
    });
  });

  afterEach(async () => {
    try {
      closeOpenClawStateDatabase();
    } catch {
      // ignore close races
    }
    delete process.env.OPENCLAW_STATE_DIR;
    if (stateDir) {
      try {
        await fs.rm(stateDir, { recursive: true, force: true });
      } catch {
        // Windows may briefly hold WAL files; leave temp for OS cleanup.
      }
    }
  });

  it("A2: only one concurrent claim owner succeeds", () => {
    const now = Date.now();
    const a = claimCronJobLease({ storePath, jobId: "job-a", nowMs: now, ownerPid: 111 });
    const b = claimCronJobLease({ storePath, jobId: "job-a", nowMs: now + 1, ownerPid: 222 });
    expect(a.claimed).toBe(true);
    expect(b.claimed).toBe(false);
    if (!b.claimed) {
      expect(b.reason).toBe("already-owned");
    }
  });

  it("A2: different jobs can be claimed independently", () => {
    const now = Date.now();
    const a = claimCronJobLease({ storePath, jobId: "job-a", nowMs: now });
    const b = claimCronJobLease({ storePath, jobId: "job-b", nowMs: now });
    expect(a.claimed).toBe(true);
    expect(b.claimed).toBe(true);
  });

  it("A2: release allows re-claim by another owner", () => {
    const now = Date.now();
    const a = claimCronJobLease({ storePath, jobId: "job-a", nowMs: now, ownerPid: 1 });
    expect(a.claimed).toBe(true);
    if (!a.claimed) return;
    expect(releaseCronJobLease({ storePath, jobId: "job-a", runningAtMs: a.runningAtMs })).toBe(
      true,
    );
    const b = claimCronJobLease({ storePath, jobId: "job-a", nowMs: now + 10, ownerPid: 2 });
    expect(b.claimed).toBe(true);
  });

  it("A2: stale lease can be reclaimed after STALE window", () => {
    const old = Date.now() - CRON_LEASE_STALE_MS - 1_000;
    const first = claimCronJobLease({ storePath, jobId: "job-a", nowMs: old, ownerPid: 1 });
    expect(first.claimed).toBe(true);
    const now = Date.now();
    const second = claimCronJobLease({
      storePath,
      jobId: "job-a",
      nowMs: now,
      ownerPid: 2,
      staleMs: CRON_LEASE_STALE_MS,
    });
    expect(second.claimed).toBe(true);
  });
});

describe("P5-002 list does not rewrite authority store", () => {
  it("A1: list/status path does not call persist when maintenance would change", async () => {
    const persistSpy = vi.spyOn(storeModule, "persist").mockResolvedValue(undefined);
    const ensureSpy = vi
      .spyOn(storeModule, "ensureLoaded")
      .mockImplementation(async (state) => {
        state.store = {
          version: 1,
          jobs: [
            makeJob("job-missing-next", {
              state: {}, // missing nextRunAtMs — would previously trigger maintenance write
            }),
          ],
        };
      });

    const state = createCronServiceState({
      storePath: "/tmp/p5-002-list-authority.json",
      cronEnabled: true,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
    });

    try {
      const jobs = await ops.list(state, { includeDisabled: true });
      expect(jobs).toHaveLength(1);
      expect(persistSpy).not.toHaveBeenCalled();
    } finally {
      ensureSpy.mockRestore();
      persistSpy.mockRestore();
    }
  });
});

describe("P5-002 authorized repair", () => {
  it("A3: repair requires non-empty audit reason", async () => {
    const state = createCronServiceState({
      storePath: "/tmp/p5-002-repair.json",
      cronEnabled: true,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
    });
    await expect(
      ops.repairCronStoreAuthorized(state, {
        authorized: true,
        reason: "   ",
      }),
    ).rejects.toThrow(/audit reason/i);
  });

  it("A3: authorized repair emits audit log and may persist", async () => {
    const logInfo = vi.fn();
    const persistSpy = vi.spyOn(storeModule, "persist").mockResolvedValue(undefined);
    const ensureSpy = vi.spyOn(storeModule, "ensureLoaded").mockImplementation(async (state) => {
      state.store = {
        version: 1,
        jobs: [makeJob("job-repair", { state: {} })],
      };
    });
    const state = createCronServiceState({
      storePath: "/tmp/p5-002-repair-ok.json",
      cronEnabled: true,
      log: { debug: vi.fn(), info: logInfo, warn: vi.fn(), error: vi.fn() } as never,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
    });

    try {
      const result = await ops.repairCronStoreAuthorized(state, {
        authorized: true,
        reason: "operator-requested-schedule-repair",
      });
      expect(result.reason).toBe("operator-requested-schedule-repair");
      expect(logInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "operator-requested-schedule-repair",
        }),
        "cron: authorized store repair completed",
      );
      // If maintenance changed nextRun, persist is called; either way audit fired.
      if (result.repaired) {
        expect(persistSpy).toHaveBeenCalled();
      }
    } finally {
      ensureSpy.mockRestore();
      persistSpy.mockRestore();
    }
  });

  it("A3: CronService.repairAuthorized facade is available", async () => {
    const cron = new CronService({
      storePath: path.join(os.tmpdir(), "p5-002-facade-jobs.json"),
      cronEnabled: false,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeat: vi.fn(),
      runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
    });
    // With no store file, repair should complete without throwing when authorized.
    const ensureSpy = vi.spyOn(storeModule, "ensureLoaded").mockResolvedValue(undefined);
    try {
      const result = await cron.repairAuthorized({
        authorized: true,
        reason: "facade-smoke",
      });
      expect(result.reason).toBe("facade-smoke");
      expect(result.repaired).toBe(false);
    } finally {
      ensureSpy.mockRestore();
      cron.stop();
    }
  });
});