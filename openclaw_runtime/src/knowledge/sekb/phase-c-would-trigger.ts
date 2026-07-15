/**
 * SEKB Hermes Phase C (D1): mutation-free would_trigger evidence only.
 *
 * - Default-off dedicated flag (see feature-flags).
 * - Evaluates whether a future distillation/review action *would* trigger
 *   under frozen Shadow V1 threshold 50, using in-process shadow metadata only.
 * - Never mutates trajectory, principle, candidate pool, or filter authority.
 * - Never reads offline artifacts under artifacts/sekb-hermes-phase-a5/**.
 */
import { isSekbShadowMetadataV1 } from "./shadow-evaluator.js";
import type { Trajectory } from "./types.js";

export const SEKB_PHASE_C_SHADOW_V1_THRESHOLD = 50 as const;
export const SEKB_PHASE_C_POLICY_ID = "sekb-shadow-v1-score-gte-50" as const;
export const SEKB_PHASE_C_DEFAULT_OWNER = "sekb-phase-c-would-trigger";
export const SEKB_PHASE_C_DEFAULT_TIMEOUT_MS = 5_000;
export const SEKB_PHASE_C_MAX_EVIDENCE_BUFFER = 200;

export type SekbPhaseCWouldTriggerEvidence = {
  schema: "sekb-phase-c-would-trigger-evidence.v1";
  owner: string;
  workspaceKey: string;
  trajectoryId: string;
  evaluatedAt: string;
  wouldTrigger: boolean;
  reason: string;
  shadowScore: number | null;
  threshold: typeof SEKB_PHASE_C_SHADOW_V1_THRESHOLD;
  policyId: typeof SEKB_PHASE_C_POLICY_ID;
  suppressedByFlag: boolean;
  leaseBusy: boolean;
  timedOut: boolean;
  durableMutation: false;
  offlineArtifactsUsed: false;
};

export type SekbPhaseCWouldTriggerCounters = {
  /** Successful evaluations attempted while flag was on (includes false wouldTrigger). */
  count: number;
  wouldTriggerTrue: number;
  suppressed_by_flag: number;
  lease_busy: number;
  timeout_cancel: number;
  error: number;
};

export type SekbPhaseCWouldTriggerRunResult = {
  flagEnabled: boolean;
  owner: string;
  workspaceKey: string;
  counters: SekbPhaseCWouldTriggerCounters;
  evidence: SekbPhaseCWouldTriggerEvidence[];
  leaseHeld: boolean;
  timedOut: boolean;
  durableMutation: false;
};

export type SekbPhaseCWouldTriggerSchedulerOptions = {
  owner?: string;
  workspaceKey?: string;
  timeoutMs?: number;
  now?: () => Date;
  /** Injected sleep for tests; default uses setTimeout. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

function emptyCounters(): SekbPhaseCWouldTriggerCounters {
  return {
    count: 0,
    wouldTriggerTrue: 0,
    suppressed_by_flag: 0,
    lease_busy: 0,
    timeout_cancel: 0,
    error: 0,
  };
}

export function extractInProcessShadowScore(
  trajectory: Pick<Trajectory, "metadata">,
): number | null {
  const shadow = trajectory.metadata?.sekbShadow;
  if (!isSekbShadowMetadataV1(shadow)) {
    return null;
  }
  const score = shadow.captureQuality.score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

/**
 * Frozen Shadow V1 policy: score >= 50 would trigger future review/distillation consideration.
 * Does not retune weights/threshold.
 */
export function projectWouldTriggerFromShadowScore(score: number | null): {
  wouldTrigger: boolean;
  reason: string;
} {
  if (score === null) {
    return { wouldTrigger: false, reason: "missing_in_process_shadow_score" };
  }
  if (score >= SEKB_PHASE_C_SHADOW_V1_THRESHOLD) {
    return {
      wouldTrigger: true,
      reason: `shadow_v1_score_${score}_gte_${SEKB_PHASE_C_SHADOW_V1_THRESHOLD}`,
    };
  }
  return {
    wouldTrigger: false,
    reason: `shadow_v1_score_${score}_lt_${SEKB_PHASE_C_SHADOW_V1_THRESHOLD}`,
  };
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Explicit, isolated Phase C scheduler. Single-flight lease per instance/workspace.
 * Evidence is in-memory only; callers may serialize reports without durable store writes.
 */
export class SekbPhaseCWouldTriggerScheduler {
  readonly #owner: string;
  readonly #workspaceKey: string;
  readonly #timeoutMs: number;
  readonly #now: () => Date;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  #leaseHeld = false;
  #counters: SekbPhaseCWouldTriggerCounters = emptyCounters();
  #evidence: SekbPhaseCWouldTriggerEvidence[] = [];

  constructor(options: SekbPhaseCWouldTriggerSchedulerOptions = {}) {
    this.#owner = options.owner?.trim() || SEKB_PHASE_C_DEFAULT_OWNER;
    this.#workspaceKey = options.workspaceKey?.trim() || "default";
    this.#timeoutMs =
      typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs >= 1
        ? Math.min(60_000, Math.floor(options.timeoutMs))
        : SEKB_PHASE_C_DEFAULT_TIMEOUT_MS;
    this.#now = options.now ?? (() => new Date());
    this.#sleep = options.sleep ?? defaultSleep;
  }

  get counters(): SekbPhaseCWouldTriggerCounters {
    return { ...this.#counters };
  }

  get evidenceBuffer(): readonly SekbPhaseCWouldTriggerEvidence[] {
    return this.#evidence;
  }

  get owner(): string {
    return this.#owner;
  }

  get workspaceKey(): string {
    return this.#workspaceKey;
  }

  /**
   * Evaluate trajectories under Phase C flag state.
   * When flagEnabled=false: parity path — counters only record suppression; no evidence wouldTrigger true path.
   */
  async evaluate(params: {
    flagEnabled: boolean;
    trajectories: Array<Pick<Trajectory, "trajectory_id" | "metadata" | "distilled">>;
    /** Optional artificial work delay for timeout tests (ms). */
    artificialWorkMs?: number;
  }): Promise<SekbPhaseCWouldTriggerRunResult> {
    const base = {
      flagEnabled: params.flagEnabled,
      owner: this.#owner,
      workspaceKey: this.#workspaceKey,
      durableMutation: false as const,
    };

    if (!params.flagEnabled) {
      this.#counters.suppressed_by_flag += 1;
      return {
        ...base,
        counters: this.counters,
        evidence: [],
        leaseHeld: false,
        timedOut: false,
      };
    }

    if (this.#leaseHeld) {
      this.#counters.lease_busy += 1;
      return {
        ...base,
        counters: this.counters,
        evidence: [],
        leaseHeld: true,
        timedOut: false,
      };
    }

    this.#leaseHeld = true;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);

    try {
      if (params.artificialWorkMs && params.artificialWorkMs > 0) {
        await this.#sleep(params.artificialWorkMs, controller.signal);
      }

      if (controller.signal.aborted || timedOut) {
        this.#counters.timeout_cancel += 1;
        return {
          ...base,
          counters: this.counters,
          evidence: [],
          leaseHeld: false,
          timedOut: true,
        };
      }

      const evidence: SekbPhaseCWouldTriggerEvidence[] = [];
      for (const trajectory of params.trajectories) {
        if (controller.signal.aborted) {
          this.#counters.timeout_cancel += 1;
          return {
            ...base,
            counters: this.counters,
            evidence,
            leaseHeld: false,
            timedOut: true,
          };
        }

        const shadowScore = extractInProcessShadowScore(trajectory);
        const projection = projectWouldTriggerFromShadowScore(shadowScore);
        // Distilled trajectories already handled; still report wouldTrigger=false for observation honesty.
        const wouldTrigger =
          projection.wouldTrigger && trajectory.distilled !== true;
        const reason =
          trajectory.distilled === true && projection.wouldTrigger
            ? "already_distilled"
            : projection.reason;

        const item: SekbPhaseCWouldTriggerEvidence = {
          schema: "sekb-phase-c-would-trigger-evidence.v1",
          owner: this.#owner,
          workspaceKey: this.#workspaceKey,
          trajectoryId: trajectory.trajectory_id,
          evaluatedAt: this.#now().toISOString(),
          wouldTrigger,
          reason,
          shadowScore,
          threshold: SEKB_PHASE_C_SHADOW_V1_THRESHOLD,
          policyId: SEKB_PHASE_C_POLICY_ID,
          suppressedByFlag: false,
          leaseBusy: false,
          timedOut: false,
          durableMutation: false,
          offlineArtifactsUsed: false,
        };
        evidence.push(item);
        this.#pushEvidence(item);
        this.#counters.count += 1;
        if (wouldTrigger) {
          this.#counters.wouldTriggerTrue += 1;
        }
      }

      return {
        ...base,
        counters: this.counters,
        evidence,
        leaseHeld: false,
        timedOut: false,
      };
    } catch (error) {
      if (timedOut || controller.signal.aborted) {
        this.#counters.timeout_cancel += 1;
        return {
          ...base,
          counters: this.counters,
          evidence: [],
          leaseHeld: false,
          timedOut: true,
        };
      }
      this.#counters.error += 1;
      throw error;
    } finally {
      clearTimeout(timeout);
      this.#leaseHeld = false;
    }
  }

  #pushEvidence(item: SekbPhaseCWouldTriggerEvidence): void {
    this.#evidence.push(item);
    if (this.#evidence.length > SEKB_PHASE_C_MAX_EVIDENCE_BUFFER) {
      this.#evidence.splice(0, this.#evidence.length - SEKB_PHASE_C_MAX_EVIDENCE_BUFFER);
    }
  }
}

export function snapshotPhaseCObservability(
  scheduler: SekbPhaseCWouldTriggerScheduler,
  flagEnabled: boolean,
): {
  "would_trigger.count": number;
  "would_trigger.true": number;
  "would_trigger.suppressed_by_flag": number;
  "would_trigger.lease_busy": number;
  "would_trigger.timeout_cancel": number;
  "would_trigger.error": number;
  "pilot.flag_state": "on" | "off";
  owner: string;
  workspaceKey: string;
} {
  const c = scheduler.counters;
  return {
    "would_trigger.count": c.count,
    "would_trigger.true": c.wouldTriggerTrue,
    "would_trigger.suppressed_by_flag": c.suppressed_by_flag,
    "would_trigger.lease_busy": c.lease_busy,
    "would_trigger.timeout_cancel": c.timeout_cancel,
    "would_trigger.error": c.error,
    "pilot.flag_state": flagEnabled ? "on" : "off",
    owner: scheduler.owner,
    workspaceKey: scheduler.workspaceKey,
  };
}