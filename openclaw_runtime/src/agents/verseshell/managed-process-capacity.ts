/**
 * Instance-wide capacity for VerseShell-managed tool processes (issue #155).
 *
 * The Job Object limits one process tree; this module bounds how many managed trees this runtime
 * instance keeps alive at once, so several sessions, lanes or background callers cannot each
 * believe they own the whole budget. Nothing is limited until an operator declares a capacity:
 * with no declaration the admission is a no-op and no counter is allocated.
 *
 * Environment surface (all optional):
 * - `OPENCLAW_VERSESHELL_MAX_LIVE_PROCESSES` - instance-wide live managed process cap
 * - `OPENCLAW_VERSESHELL_MAX_PROCESSES`     - default Job active-process cap per run
 * - `OPENCLAW_VERSESHELL_MAX_MEMORY_MB`     - default Job per-process commit cap per run
 *
 * The managed-process counter only counts processes whose owner this runtime created and whose
 * exit it verified; it never scans for, adopts or kills unknown PIDs (see #98/#99/#103).
 */

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
  return { live, ...counters, ...(limit === undefined ? {} : { limit }) };
}

/**
 * Requests one instance-wide slot for a managed process.
 *
 * With no declared `maxLiveProcesses` this always admits and does not allocate a counter.
 */
export function admitManagedProcess(): ManagedProcessAdmission {
  const declared = activeConfig()?.maxLiveProcesses;
  if (declared === undefined) {
    return { ok: true, lease: noopLease(), live };
  }
  if (live >= declared) {
    counters.rejectedCapacity += 1;
    return { ok: false, reason: "capacity", live, limit: declared };
  }
  live += 1;
  counters.admitted += 1;
  if (live > counters.peakLive) {
    counters.peakLive = live;
  }
  return { ok: true, lease: createLease(), live, limit: declared };
}

function noopLease(): ManagedProcessLease {
  let released = false;
  return {
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

function createLease(): ManagedProcessLease {
  let released = false;
  return {
    get released() {
      return released;
    },
    release(): boolean {
      if (released) {
        counters.doubleRelease += 1;
        return false;
      }
      released = true;
      live = Math.max(0, live - 1);
      counters.completed += 1;
      return true;
    },
  };
}
