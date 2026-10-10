// Restart reconciliation for supervisor-owned runs.
//
// After a gateway restart the supervisor's in-memory ownership is gone, but OS
// processes it spawned may have survived (notably on Windows). The persisted
// run manifest identifies those runs. Reconciliation is terminal and strictly
// fail-closed:
//
// - Runs owned by this process are skipped (still actively supervised).
// - Runs whose owner PID is still alive are skipped: another live gateway may
//   own them, and a reused owner PID cannot be distinguished without killing.
//   Leaking beats a false kill.
// - A dead owner's live run is killed only when OS containment evidence
//   captures the tree (with PID-reuse token guards). Unverifiable evidence
//   keeps the entry untouched — there is no PID-fallback scope expansion.
import { isPidDefinitelyDead } from "../../shared/pid-alive.js";
import {
  captureProcessTrees,
  type OsProcessTreeCapture,
} from "../os-containment.js";
import { signalProcessTree } from "../kill-tree.js";
import type { SupervisorRunManifestStore } from "./run-manifest.js";

const RECONCILE_SETTLE_MS = 5_000;
const RECONCILE_POLL_MS = 50;

export type SupervisorReconcileResult = {
  status: "disabled" | "corrupt" | "ok" | "partial";
  detail?: string;
  /** Entries owned by this process (still active) — untouched. */
  ours: number;
  /** Entries whose owner PID is still alive — untouched (fail-closed). */
  foreignOwner: number;
  /** Entries whose process already exited — removed from the manifest. */
  lost: number;
  /** Orphaned trees killed and verified dead — removed from the manifest. */
  reconciled: number;
  /** Live orphans whose OS containment evidence is unverifiable — untouched. */
  containmentUnknown: number;
  /** Live orphans that survived the kill attempt — untouched (no expansion). */
  residual: number;
};

export type ReconcileDependencies = {
  capture?: (roots: number[]) => Promise<OsProcessTreeCapture>;
  killTree?: (pid: number) => void;
  verifyTerminated?: (capture: OsProcessTreeCapture) => Promise<import("../os-containment.js").OsContainmentCheck>;
  settleMs?: number;
};

async function waitForCapturedTreeDeath(
  capture: OsProcessTreeCapture,
  timeoutMs: number,
  verifyTerminated?: (capture: OsProcessTreeCapture) => Promise<import("../os-containment.js").OsContainmentCheck>,
): Promise<boolean> {
  const verify = verifyTerminated ?? (await import("../os-containment.js")).verifyProcessTreesTerminated;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const probe = await verify(capture);
    if (probe.status === "empty") {
      return true;
    }
    if (probe.status === "unknown") {
      return false;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, RECONCILE_POLL_MS));
  }
}

/** Reconciles manifest entries left by previous supervisor owner processes. */
export async function reconcileManifestOrphans(
  store: SupervisorRunManifestStore,
  dependencies: ReconcileDependencies = {},
): Promise<SupervisorReconcileResult> {
  const capture = dependencies.capture ?? captureProcessTrees;
  const killTree = dependencies.killTree ?? ((pid: number) => signalProcessTree(pid, "SIGKILL"));
  const settleMs = dependencies.settleMs ?? RECONCILE_SETTLE_MS;

  const loaded = store.load();
  if (loaded.status === "corrupt") {
    return {
      status: "corrupt",
      detail: loaded.detail,
      ours: 0,
      foreignOwner: 0,
      lost: 0,
      reconciled: 0,
      containmentUnknown: 0,
      residual: 0,
    };
  }
  const result: SupervisorReconcileResult = {
    status: "ok",
    ours: 0,
    foreignOwner: 0,
    lost: 0,
    reconciled: 0,
    containmentUnknown: 0,
    residual: 0,
  };
  const entries = loaded.status === "missing" ? [] : loaded.entries;

  for (const entry of entries) {
    if (entry.ownerPid === store.ownerPid) {
      result.ours += 1;
      continue;
    }
    if (!isPidDefinitelyDead(entry.ownerPid)) {
      result.foreignOwner += 1;
      continue;
    }
    if (isPidDefinitelyDead(entry.pid)) {
      store.remove(entry.runId);
      result.lost += 1;
      continue;
    }
    const captured = await capture([entry.pid]);
    if (captured.status !== "ok") {
      result.containmentUnknown += 1;
      result.status = "partial";
      continue;
    }
    if (!captured.capturedPids.has(entry.pid)) {
      // The process exited between the liveness check and the OS capture.
      store.remove(entry.runId);
      result.lost += 1;
      continue;
    }
    killTree(entry.pid);
    const dead = await waitForCapturedTreeDeath(captured, settleMs, dependencies.verifyTerminated);
    if (!dead) {
      result.residual += 1;
      result.status = "partial";
      continue;
    }
    store.remove(entry.runId);
    result.reconciled += 1;
  }

  return result;
}
