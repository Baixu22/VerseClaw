// ---------------------------------------------------------------------------
// Stage 3 (criteria 3.2-3.8): Cross-Area Composition Facades
//
// Thin facades that compose existing A1-A6 infrastructure to verify the
// composition semantics defined in `area-composition-spec.md`. These are
// NOT production wiring — they exist to make cross-area interactions testable
// at the unit level while the areas remain in shadow/pilot mode.
//
// See: net use/designs/area-composition-spec.md
// See: net use/designs/development-manual.md §1.1, Stage 3
// ---------------------------------------------------------------------------

import type { RuntimeResumeShadowResult } from "../../runtime-core/resume-shadow.js";
import { runRuntimeResumeShadow } from "../../runtime-core/resume-shadow.js";
import type { RuntimeResumeShadowInput } from "../../runtime-core/resume-shadow.js";
import {
  ResourceAwareWaveScheduler,
  type RePlanRequest,
  type RePlanResult,
  type WavePlan,
} from "../resource-aware-wave-scheduler.js";
import type { OrchestrationTaskGraph } from "../orchestration-protocol.js";

// ---------------------------------------------------------------------------
// A3+A6: ResumeContractVerifier
// ---------------------------------------------------------------------------

/**
 * Result of verifying a resume contract. When a rollback has occurred (A3
 * anomaly → repair with `replay_rollback` strategy), the verifier marks
 * `requiresReverification: true` so downstream consumers know the resumed
 * state is not trusted without re-verification.
 */
export type ResumeContractVerification = {
  /** Whether the resume shadow was enabled and ran. */
  enabled: boolean;
  /** Whether a rollback was detected prior to resume. */
  rollbackOccurred: boolean;
  /**
   * Stage 3 (criterion 3.3): when true, the resumed state must be
   * re-verified before use. Set when A3 rollback happened before A6 resume.
   */
  requiresReverification: boolean;
  /** The underlying resume shadow result (null when disabled). */
  resumeShadow: RuntimeResumeShadowResult | null;
};

/**
 * A6 resume contract verifier. Composes `runRuntimeResumeShadow` with A3
 * rollback detection. When a rollback has occurred, the resumed state is
 * marked `requiresReverification` per the A3+A6 composition contract.
 *
 * See: area-composition-spec.md §1 Blocker 4 (A1+A6 mid-turn pause)
 */
export class ResumeContractVerifier {
  /**
   * Verify a resume contract.
   *
   * @param input Resume shadow input (event log, legacy state).
   * @param rollbackOccurred Whether an A3 rollback occurred before resume.
   */
  verify(input: RuntimeResumeShadowInput, rollbackOccurred: boolean): ResumeContractVerification {
    const resumeShadow = runRuntimeResumeShadow(input);
    return {
      enabled: resumeShadow.enabled,
      rollbackOccurred,
      // Criterion 3.3: rollback before resume → requires_reverification.
      requiresReverification: rollbackOccurred && resumeShadow.enabled,
      resumeShadow: resumeShadow.enabled ? resumeShadow : null,
    };
  }
}

// ---------------------------------------------------------------------------
// A5+A6: ContextBudgetPlanner
// ---------------------------------------------------------------------------

/**
 * A5 context budget planner. Composes `ResourceAwareWaveScheduler` with
 * resume semantics: on resume (A6), the planner re-executes with the current
 * budget rather than reusing a stale plan.
 *
 * See: area-composition-spec.md (A5+A6 composition: resume re-runs budget planner)
 */
export class ContextBudgetPlanner {
  private scheduler: ResourceAwareWaveScheduler;
  private resumeCount = 0;
  private readonly initialMaxWorkers: number;

  constructor(graph: OrchestrationTaskGraph, maxWorkers: number) {
    this.scheduler = new ResourceAwareWaveScheduler(graph, { maxWorkers });
    this.initialMaxWorkers = maxWorkers;
  }

  /** Initial plan. */
  plan(): WavePlan[] {
    this.scheduler.plan();
    return this.getPlan();
  }

  /**
   * Stage 3 (criterion 3.6): on resume, re-run the budget planner with the
   * current budget. The plan is NOT reused from before pause — the planner
   * re-executes to avoid stale budget decisions.
   *
   * @param resumedMaxWorkers The budget at resume time (may differ from initial).
   * @returns The re-planned waves.
   */
  replanOnResume(resumedMaxWorkers: number): WavePlan[] {
    // P1 fix: only increment resumeCount when rePlan was actually accepted.
    // Previously resumeCount was incremented unconditionally, causing
    // hasReexecuted=true even when rePlan was rejected (wave_started),
    // making it impossible for callers to distinguish a successful re-plan
    // from a no-op rejection.
    const firstPlanned = this.scheduler.getWaves().find((w) => w.status === "planned");
    const appliesToWave = firstPlanned?.wave ?? 1;
    const result = this.scheduler.rePlan({
      appliesToWave,
      maxWorkers: resumedMaxWorkers,
    });
    if (result.accepted) {
      this.resumeCount++;
    }
    return this.getPlan();
  }

  /** Whether the planner has re-executed since the last plan (not stale). */
  get hasReexecuted(): boolean {
    return this.resumeCount > 0;
  }

  /** Number of times the planner has re-executed on resume. */
  get resumeReexecutions(): number {
    return this.resumeCount;
  }

  /** The initial maxWorkers (before any resume). */
  get initialBudget(): number {
    return this.initialMaxWorkers;
  }

  /** Current wave plan. */
  getPlan(): WavePlan[] {
    return this.scheduler.getWaves();
  }

  /** Start a wave (delegates to scheduler). */
  startWave(waveNumber: number): void {
    this.scheduler.startWave(waveNumber);
  }

  /** Re-plan with a new worker cap (delegates to scheduler). */
  rePlan(request: RePlanRequest): RePlanResult {
    return this.scheduler.rePlan(request);
  }

  /** Get the underlying scheduler (for direct testing). */
  getScheduler(): ResourceAwareWaveScheduler {
    return this.scheduler;
  }
}

// ---------------------------------------------------------------------------
// A1+A6: FingerprintLeaseCoordinator
//
// Coordinates A1 lease commit with A6 checkpoint writes to prevent I/O races
// during mid-turn pause (criterion 3.8). The lease commits BEFORE the
// checkpoint is written, per Blocker 4 resolution.
// ---------------------------------------------------------------------------

export type LeaseCommitResult = {
  committed: true;
  leaseId: string;
  committedAt: number;
};

export type CheckpointWriteResult = {
  written: true;
  checkpointId: string;
  writtenAt: number;
  leaseId: string;
};

export type PauseCoordinationResult = {
  lease: LeaseCommitResult;
  checkpoint: CheckpointWriteResult;
  /** True when the lease was committed BEFORE the checkpoint (no race). */
  leaseBeforeCheckpoint: boolean;
};

/**
 * Coordinate A1 lease commit with A6 checkpoint write during mid-turn pause.
 *
 * Per Blocker 4: A1 lease commits before A6 writes checkpoint. This prevents
 * I/O races where A6 reads partial state from an uncommitted A1 lease.
 */
export class FingerprintLeaseCoordinator {
  private lastLease: LeaseCommitResult | null = null;

  /** Commit the A1 lease. Must be called BEFORE writeCheckpoint. */
  commitLease(leaseId: string, now: number = Date.now()): LeaseCommitResult {
    const result: LeaseCommitResult = { committed: true, leaseId, committedAt: now };
    this.lastLease = result;
    return result;
  }

  /**
   * Write the A6 checkpoint. Requires a committed lease (throws if no lease
   * has been committed, preventing I/O races).
   */
  writeCheckpoint(checkpointId: string, now: number = Date.now()): CheckpointWriteResult {
    if (!this.lastLease) {
      throw new Error("Cannot write checkpoint before lease is committed (Blocker 4 race guard)");
    }
    return {
      written: true,
      checkpointId,
      writtenAt: now,
      leaseId: this.lastLease.leaseId,
    };
  }

  /**
   * Coordinate a full mid-turn pause: commit lease, then write checkpoint.
   * Returns a result confirming the lease was committed before the checkpoint.
   */
  coordinatePause(
    leaseId: string,
    checkpointId: string,
    now: number = Date.now(),
  ): PauseCoordinationResult {
    const lease = this.commitLease(leaseId, now);
    const checkpoint = this.writeCheckpoint(checkpointId, now);
    return {
      lease,
      checkpoint,
      leaseBeforeCheckpoint: lease.committedAt <= checkpoint.writtenAt,
    };
  }
}
