/** Cross-process CAS lease helpers for cron job claim ownership (P5-002 / F-REL-001). */
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQuerySync } from "../../infra/kysely-sync.js";
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
} from "../../state/openclaw-state-db.js";
import { cronStoreKey } from "./key.js";
import { getCronStoreKysely } from "./schema.js";

/** Matches service/jobs STUCK_RUN_MS — leases older than this may be reclaimed. */
export const CRON_LEASE_STALE_MS = 2 * 60 * 60 * 1000;

export type CronLeaseClaimResult =
  | { claimed: true; ownerToken: string; runningAtMs: number }
  | { claimed: false; reason: "already-owned" | "not-found" | "missing-job-id" };

function ownerTokenFor(processId: number, runningAtMs: number, jobId: string): string {
  return `${processId}:${runningAtMs}:${jobId}`;
}

/**
 * Atomically claim a cron job run lease in SQLite.
 * Succeeds only when running_at_ms is null/absent or older than the stale window.
 * Same job/same moment → at most one process owner (A2).
 */
export function claimCronJobLease(params: {
  storePath: string;
  jobId: string;
  nowMs: number;
  staleMs?: number;
  ownerPid?: number;
}): CronLeaseClaimResult {
  const jobId = params.jobId?.trim();
  if (!jobId) {
    return { claimed: false, reason: "missing-job-id" };
  }
  const storeKey = cronStoreKey(path.resolve(params.storePath));
  const nowMs = Math.max(0, Math.floor(params.nowMs));
  const staleMs = params.staleMs ?? CRON_LEASE_STALE_MS;
  const staleBefore = nowMs - staleMs;
  const ownerPid = params.ownerPid ?? process.pid;

  let result: CronLeaseClaimResult = { claimed: false, reason: "not-found" };

  runOpenClawStateWriteTransaction(({ db }) => {
    const existing = executeSqliteQuerySync(
      db,
      getCronStoreKysely(db)
        .selectFrom("cron_jobs")
        .select(["job_id", "running_at_ms"])
        .where("store_key", "=", storeKey)
        .where("job_id", "=", jobId)
        .limit(1),
    ).rows[0] as { job_id?: string; running_at_ms?: number | null } | undefined;

    if (!existing) {
      result = { claimed: false, reason: "not-found" };
      return;
    }

    const update = executeSqliteQuerySync(
      db,
      getCronStoreKysely(db)
        .updateTable("cron_jobs")
        .set({
          running_at_ms: nowMs,
          runtime_updated_at_ms: nowMs,
        })
        .where("store_key", "=", storeKey)
        .where("job_id", "=", jobId)
        .where((eb) =>
          eb.or([eb("running_at_ms", "is", null), eb("running_at_ms", "<", staleBefore)]),
        ),
    );

    const affected = Number(update.numAffectedRows ?? 0n);
    if (affected >= 1) {
      result = {
        claimed: true,
        ownerToken: ownerTokenFor(ownerPid, nowMs, jobId),
        runningAtMs: nowMs,
      };
      return;
    }
    result = { claimed: false, reason: "already-owned" };
  });

  return result;
}

/**
 * Release a cron job lease when the owner finishes (or abandons) the run.
 * Only clears running_at_ms when it still matches the claimed timestamp.
 */
export function releaseCronJobLease(params: {
  storePath: string;
  jobId: string;
  runningAtMs: number;
}): boolean {
  const jobId = params.jobId?.trim();
  if (!jobId) {
    return false;
  }
  const storeKey = cronStoreKey(path.resolve(params.storePath));
  const runningAtMs = Math.floor(params.runningAtMs);
  let released = false;

  runOpenClawStateWriteTransaction(({ db }) => {
    const update = executeSqliteQuerySync(
      db,
      getCronStoreKysely(db)
        .updateTable("cron_jobs")
        .set({
          running_at_ms: null,
          runtime_updated_at_ms: Date.now(),
        })
        .where("store_key", "=", storeKey)
        .where("job_id", "=", jobId)
        .where("running_at_ms", "=", runningAtMs),
    );
    released = Number(update.numAffectedRows ?? 0n) >= 1;
  });

  return released;
}

/** Test helper: open the shared state db (ensures schema exists). */
export function ensureCronStateDatabaseOpened(): DatabaseSync {
  return openOpenClawStateDatabase().db;
}