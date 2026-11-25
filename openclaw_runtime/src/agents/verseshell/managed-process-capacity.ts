/**
 * Host-shared capacity for VerseShell-managed tool processes and terminal PTYs.
 *
 * The Job Object limits one process tree; this module bounds how many managed trees this runtime
 * state directory keeps alive at once, so sessions, workspaces and runtime processes cannot each
 * believe they own the whole budget. Explicit capacity is shared by all launchers. Resource
 * pressure contracts admission to one tree without releasing an existing or unknown execution.
 * Without a declaration or pressure, the existing unrestricted admission stays available.
 *
 * Environment surface (all optional):
 * - `OPENCLAW_VERSESHELL_MAX_LIVE_PROCESSES` - host-shared live managed process cap
 * - `OPENCLAW_VERSESHELL_MAX_PROCESSES`     - default Job active-process cap per run
 * - `OPENCLAW_VERSESHELL_MAX_MEMORY_MB`     - default Job per-process commit cap per run
 *
 * The managed-process counter only counts processes whose owner this runtime created and whose
 * exit it verified; it never scans for, adopts or kills unknown PIDs (see #98/#99/#103).
 */

import type { ChildProcess } from "node:child_process";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";
import {
  managedProcessReservations,
  normalizeManagedPorts,
  observeManagedProcessReservation,
  releaseManagedProcessReservation,
  reserveManagedProcess,
  updateManagedProcessReservation,
  managedProcessHostPressureLimit,
  type ManagedProcessIdentity,
} from "./managed-process-reservation.js";

/** Default per-run Limits derived from the environment. */
export type ManagedProcessDefaultLimits = {
  maxProcesses?: number;
  maxMemoryBytes?: number;
};

/** Declared instance capacity. */
export type ManagedProcessCapacityConfig = {
  maxLiveProcesses?: number;
  defaultLimits?: ManagedProcessDefaultLimits;
};

/** Admission outcome for one managed process. */
export type ManagedProcessAdmission =
  | { ok: true; lease: ManagedProcessLease; live: number; limit?: number }
  | { ok: false; reason: "capacity"; live: number; limit: number };

/** Lease held for the lifetime of a managed process. */
export type ManagedProcessLease = {
  /** Releases the instance slot once; returns false when already released. */
  release(): boolean;
  readonly released: boolean;
  readonly reservationId?: string;
  markDispatched(): void;
  markTerminal(): void;
  markUnknown(reason: string): void;
  observeProcess(pid: number): Promise<void>;
};

/** Counters for diagnostics and tests. */
export type ManagedProcessCapacityStats = {
  live: number;
  peakLive: number;
  admitted: number;
  completed: number;
  rejectedCapacity: number;
  doubleRelease: number;
  limit?: number;
};

let config: ManagedProcessCapacityConfig | undefined;
let envLoaded = false;
const log = createSubsystemLogger("managed-process");
let live = 0;
const heldReservations = new Set<string>();
const terminalReceipts = resolveGlobalSingleton(
  Symbol.for("openclaw.managedProcessTerminalReceipts"),
  () => new Set<ManagedProcessLease>(),
);
const counters = {
  peakLive: 0,
  admitted: 0,
  completed: 0,
  rejectedCapacity: 0,
  doubleRelease: 0,
};

function readPositiveEnvInt(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/u.test(trimmed)) {
    return undefined;
  }
  const value = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Builds the capacity configuration from the environment; `undefined` when nothing is declared. */
export function readManagedProcessCapacityFromEnv(
  env: Record<string, string | undefined> = process.env,
): ManagedProcessCapacityConfig | undefined {
  const maxLiveProcesses = readPositiveEnvInt(env.OPENCLAW_VERSESHELL_MAX_LIVE_PROCESSES);
  const maxProcesses = readPositiveEnvInt(env.OPENCLAW_VERSESHELL_MAX_PROCESSES);
  const maxMemoryMb = readPositiveEnvInt(env.OPENCLAW_VERSESHELL_MAX_MEMORY_MB);
  const defaultLimits: ManagedProcessDefaultLimits = {
    ...(maxProcesses === undefined ? {} : { maxProcesses }),
    ...(maxMemoryMb === undefined ? {} : { maxMemoryBytes: maxMemoryMb * 1024 * 1024 }),
  };
  const hasDefaults = Object.keys(defaultLimits).length > 0;
  if (maxLiveProcesses === undefined && !hasDefaults) {
    return undefined;
  }
  return {
    ...(maxLiveProcesses === undefined ? {} : { maxLiveProcesses }),
    ...(hasDefaults ? { defaultLimits } : {}),
  };
}

/** Replaces the declaration; `undefined` restores unconfigured admission (test helper). */
export function configureManagedProcessCapacity(
  next: ManagedProcessCapacityConfig | undefined,
): void {
  config = next;
  envLoaded = true;
}

/** Drops the declaration, restores environment derivation and zeroes the counters (test helper). */
export function resetManagedProcessCapacity(): void {
  retryTerminalManagedProcesses();
  for (const id of heldReservations) releaseManagedProcessReservation(id);
  heldReservations.clear();
  config = undefined;
  envLoaded = false;
  live = 0;
  counters.peakLive = 0;
  counters.admitted = 0;
  counters.completed = 0;
  counters.rejectedCapacity = 0;
  counters.doubleRelease = 0;
}

function activeConfig(): ManagedProcessCapacityConfig | undefined {
  if (!envLoaded) {
    envLoaded = true;
    config = readManagedProcessCapacityFromEnv();
  }
  return config;
}

export function resolveManagedProcessDefaultLimits(): ManagedProcessDefaultLimits {
  return activeConfig()?.defaultLimits ?? {};
}

/** Current live count and declared limit. */
export function managedProcessCapacityStats(): ManagedProcessCapacityStats {
  retryTerminalManagedProcesses();
  const limit = managedProcessCapacityLimit();
  live = managedProcessReservations().length;
  return { live, ...counters, ...(limit === undefined ? {} : { limit }) };
}

function declaredCapacity(): number | undefined {
  const limits = managedProcessReservations().flatMap((record) =>
    record.limit === undefined ? [] : [record.limit],
  );
  const configured = activeConfig()?.maxLiveProcesses;
  if (configured !== undefined) limits.push(configured);
  return limits.length ? Math.min(...limits) : undefined;
}

/** Logical workspace admission reads the same effective cap as native launch. */
export function managedProcessCapacityLimit(): number | undefined {
  const limits = [declaredCapacity(), managedProcessHostPressureLimit()].filter(
    (value): value is number => value !== undefined,
  );
  return limits.length ? Math.min(...limits) : undefined;
}

/**
 * Requests one instance-wide slot for a managed process.
 *
 * Every accepted launch has an owner reservation so later pressure can count it.
 */
export function admitManagedProcess(
  options: {
    ports?: readonly number[];
    owner?: string;
    identity?: ManagedProcessIdentity;
  } = {},
): ManagedProcessAdmission {
  retryTerminalManagedProcesses();
  const declared = declaredCapacity();
  const ports = normalizeManagedPorts(options.ports);
  const result = reserveManagedProcess({
    limit: declared,
    ports,
    owner: options.owner,
    ...(options.identity ? { identity: options.identity } : {}),
  });
  if (!result.ok && result.reason === "port")
    throw new Error(`E_PROCESS_PORT_RESERVED:${result.port}:${result.owner}`);
  if (!result.ok) {
    counters.rejectedCapacity += 1;
    return result;
  }
  heldReservations.add(result.reservation.id);
  live = result.live;
  counters.admitted += 1;
  if (live > counters.peakLive) {
    counters.peakLive = live;
  }
  return { ok: true, lease: createLease(result.reservation.id), live, limit: result.limit };
}

export class ManagedProcessCapacityError extends Error {
  readonly code = "E_PROCESS_CAPACITY_LIMIT";
  constructor(
    readonly live: number,
    readonly limit: number,
  ) {
    super(`E_PROCESS_CAPACITY_LIMIT: live=${live} limit=${limit}`);
    this.name = "ManagedProcessCapacityError";
  }
}

/** Shared native lifetime for Node subprocesses launched by Main and the runtime. */
export function startManagedChildProcess<T extends ChildProcess>(start: () => T, owner: string): T {
  const admission = admitManagedProcess({ owner });
  if (!admission.ok) throw new ManagedProcessCapacityError(admission.live, admission.limit);
  const lease = admission.lease;
  try {
    lease.markDispatched();
  } catch (error) {
    lease.release();
    throw error;
  }
  let child: T;
  try {
    child = start();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      code === "ERR_INVALID_ARG_TYPE" ||
      code === "ERR_INVALID_ARG_VALUE" ||
      code === "ERR_OUT_OF_RANGE"
    ) {
      // Node validates these arguments before calling its native spawn handle.
      settleTerminalManagedProcess(lease);
    } else lease.markUnknown("native-child-start-did-not-return-owner-handle");
    throw error;
  }
  child.once("close", () => settleTerminalManagedProcess(lease));
  return child;
}

/** Known no-start and native-close receipts share the same terminal settlement. */
function settleTerminalManagedProcess(lease: ManagedProcessLease): void {
  try {
    lease.markTerminal();
    lease.release();
  } catch (error) {
    terminalReceipts.add(lease);
    log.warn(`Managed process terminal settlement failed: ${String(error)}`);
  }
}

function retryTerminalManagedProcesses(): void {
  for (const lease of terminalReceipts) {
    try {
      lease.markTerminal();
      lease.release();
      terminalReceipts.delete(lease);
    } catch {
      // Retain the close receipt until the store accepts terminal settlement.
    }
  }
}

function createLease(id: string): ManagedProcessLease {
  let released = false;
  return {
    reservationId: id,
    markDispatched() {
      updateManagedProcessReservation(id, { phase: "dispatched" });
    },
    markTerminal() {
      updateManagedProcessReservation(id, { phase: "terminal" });
    },
    markUnknown(reason: string) {
      updateManagedProcessReservation(id, { phase: "unknown", failure: reason });
    },
    async observeProcess(pid: number) {
      if (!released) await observeManagedProcessReservation(id, pid);
    },
    get released() {
      return released;
    },
    release(): boolean {
      if (released) {
        counters.doubleRelease += 1;
        return false;
      }
      releaseManagedProcessReservation(id);
      released = true;
      heldReservations.delete(id);
      live = Math.max(0, live - 1);
      counters.completed += 1;
      return true;
    },
  };
}
