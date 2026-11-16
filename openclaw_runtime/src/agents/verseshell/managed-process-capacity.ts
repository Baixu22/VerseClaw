/**
 * Host-shared capacity for VerseShell-managed tool processes and terminal PTYs.
 *
 * The Job Object limits one process tree; this module bounds how many managed trees this runtime
 * state directory keeps alive at once, so sessions, workspaces and runtime processes cannot each
 * believe they own the whole budget. Nothing is limited until an operator declares a capacity:
 * with no declaration and no existing host reservation, admission allocates no slot.
 *
 * Environment surface (all optional):
 * - `OPENCLAW_VERSESHELL_MAX_LIVE_PROCESSES` - host-shared live managed process cap
 * - `OPENCLAW_VERSESHELL_MAX_PROCESSES`     - default Job active-process cap per run
 * - `OPENCLAW_VERSESHELL_MAX_MEMORY_MB`     - default Job per-process commit cap per run
 *
 * The managed-process counter only counts processes whose owner this runtime created and whose
 * exit it verified; it never scans for, adopts or kills unknown PIDs (see #98/#99/#103).
 */

import {
  managedProcessReservations, normalizeManagedPorts, observeManagedProcessReservation,
  releaseManagedProcessReservation, reserveManagedProcess, updateManagedProcessReservation,
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
let live = 0;
const heldReservations = new Set<string>();
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

/** Replaces the declared capacity; `undefined` disables enforcement (test helper). */
export function configureManagedProcessCapacity(next: ManagedProcessCapacityConfig | undefined): void {
  config = next;
  envLoaded = true;
}

/** Drops the declaration, restores environment derivation and zeroes the counters (test helper). */
export function resetManagedProcessCapacity(): void {
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
  const limit = activeConfig()?.maxLiveProcesses;
  if (limit !== undefined) live = managedProcessReservations().length;
  return { live, ...counters, ...(limit === undefined ? {} : { limit }) };
}

/**
 * Requests one instance-wide slot for a managed process.
 *
 * With no declared `maxLiveProcesses` this always admits and does not allocate a counter.
 */
export function admitManagedProcess(options: {
  ports?: readonly number[];
  owner?: string;
  identity?: ManagedProcessIdentity;
} = {}): ManagedProcessAdmission {
  const configured = activeConfig()?.maxLiveProcesses;
  const activeLimits = managedProcessReservations().map(record => record.limit).filter((value): value is number => value !== undefined);
  const declared = configured ?? (activeLimits.length ? Math.min(...activeLimits) : undefined);
  const ports = normalizeManagedPorts(options.ports);
  if (declared === undefined && ports.length === 0 && !options.identity) {
    return { ok: true, lease: noopLease(), live };
  }
  const result = reserveManagedProcess({
    limit: declared, ports, owner: options.owner,
    ...(options.identity ? { identity: options.identity } : {}),
  });
  if (!result.ok && result.reason === "port") throw new Error(`E_PROCESS_PORT_RESERVED:${result.port}:${result.owner}`);
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

function noopLease(): ManagedProcessLease {
  let released = false;
  return {
    markDispatched() {},
    markTerminal() {},
    markUnknown(_reason: string) {},
    async observeProcess(_pid: number) {},
    get released() {
      return released;
    },
    release(): boolean {
      if (released) {
        counters.doubleRelease += 1;
        return false;
      }
      released = true;
      return true;
    },
  };
}

function createLease(id: string): ManagedProcessLease {
  let released = false;
  return {
    reservationId: id,
    markDispatched() { updateManagedProcessReservation(id, { phase: "dispatched" }); },
    markTerminal() { updateManagedProcessReservation(id, { phase: "terminal" }); },
    markUnknown(reason: string) { updateManagedProcessReservation(id, { phase: "unknown", failure: reason }); },
    async observeProcess(pid: number) { if (!released) await observeManagedProcessReservation(id, pid); },
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
